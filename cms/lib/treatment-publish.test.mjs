// @vitest-environment node
// Approved QuangEdit treatments in publication: only approved renders of published
// photographs reach the branch, under their existing file names; drafts, rejected
// proposals, attached RAW files and private renders never do.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { createEditDocument, serializeEditDocument } from '../../src/editor/model/editDocument.mjs';
import { neutralAdjustments } from '../../src/editor/model/adjustments.mjs';
import { fakeGitHub, fixtureRepo, photograph } from '../test-helpers.mjs';
import { addDraft, setStatus } from './catalog-ops.mjs';
import { createGit } from './git.mjs';
import { preparePublication, resolveBase } from './publish.mjs';
import { approvedImageChanges } from './treatment-publish.mjs';
import {
  approveTreatment, attachSource, canonicalDocument, editingSources, readTreatment, rejectTreatment, removeApprovedTreatment, saveTreatment, storeRender,
} from './treatments.mjs';
import { ingestUpload } from './uploads.mjs';
import { initWorkspace, readWorkspace, saveCatalog } from './workspace.mjs';

let fixture;
let git;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const show = (ref, file) => execFileSync('git', ['show', `${ref}:${file}`], { cwd: fixture.repo });
const tree = (ref) => execFileSync('git', ['ls-tree', '-r', '--name-only', ref], { cwd: fixture.repo, encoding: 'utf8' }).trim().split('\n');
const changed = (ref) => execFileSync('git', ['diff', '--name-only', 'origin/main', ref], { cwd: fixture.repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean);

beforeEach(async () => {
  fixture = await fixtureRepo();
  git = createGit(fixture.repo);
  const tip = await resolveBase(git, { remote: 'origin', baseBranch: 'main' });
  await initWorkspace(fixture.workspace, { baseRef: tip.ref, baseCommit: tip.commit, baseCatalog: tip.catalog });
}, 60_000);
afterEach(() => fixture.cleanup());

const document = (source, adjustments) => serializeEditDocument(createEditDocument([{ ...source, lastModified: 0, width: 1600, height: 1000, adjustments: { ...neutralAdjustments(), ...adjustments } }], {}));

/** Attaches a source, saves a treatment, renders and (optionally) approves it. */
async function treat(id, { approve = true, color = { r: 220, g: 90, b: 30 }, source = null } = {}) {
  const dir = fixture.workspace;
  let treatment = await readTreatment(dir, id);
  if (source) treatment = await attachSource(dir, id, { request: Readable.from([source.bytes]), filename: source.name, revision: treatment.revision });
  const { catalog } = await readWorkspace(dir);
  const sources = await editingSources({ workspaceDir: dir, record: catalog.photographs.find((photo) => photo.id === id), treatment, derivativesDir: `${fixture.repo}/src/assets/photography/generated` });
  treatment = await saveTreatment(dir, id, { text: document(sources[0], { exposure: 0.5 }), revision: treatment.revision, sources });
  treatment = await storeRender(dir, id, { request: Readable.from([await photograph({ width: 2600, height: 1700, color })]), name: sources[0].name, documentHash: treatment.documentHash, revision: treatment.revision });
  if (approve) treatment = await approveTreatment(dir, id, treatment.revision);
  return treatment;
}

test('the canonical document is stable and drops what the editor would drop', () => {
  const source = { name: 'a.jpg', size: 10, sha256: 'a'.repeat(64), format: 'jpeg' };
  const first = canonicalDocument(document(source, { exposure: 0.25, notAControl: 3 }));
  const second = canonicalDocument(JSON.stringify(first.document));
  expect(second.documentHash).toBe(first.documentHash);
  expect(first.document.photos[0].adjustments.notAControl).toBeUndefined();
  expect(first.document.savedAt).toBeUndefined();
});

test('a treatment developed from a Nikon NEF publishes only its JPEG derivatives', async () => {
  await treat('beta', { source: { name: '_DSC0051.NEF', bytes: Buffer.concat([Buffer.from([0x4d, 0x4d, 0, 0x2a]), Buffer.alloc(2048, 5)]) } });
  const state = await preparePublication({ allowUnwatermarked: true, git, workspaceDir: fixture.workspace, github: fakeGitHub(), dryRun: true });
  expect(state.summary.images).toEqual(['beta']);
  expect(changed(state.branch).filter((file) => !file.endsWith('.json')).sort()).toEqual(['src/assets/photography/generated/beta-gallery.jpg', 'src/assets/photography/generated/beta-viewer.jpg']);
  expect(tree(state.branch).some((file) => /\.nef$|sources|renders|treatments/i.test(file))).toBe(false);
});

test('an approved render replaces a published photograph\'s images under the same names', async () => {
  const treatment = await treat('alpha', { source: { name: 'DSC09640.ARW', bytes: Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0]), Buffer.alloc(2048, 3)]) } });
  const state = await preparePublication({ allowUnwatermarked: true, git, workspaceDir: fixture.workspace, github: fakeGitHub(), dryRun: true });
  expect(state.summary.images).toEqual(['alpha']);
  expect(state.title).toMatch(/new images for 1/);
  expect(state.body).toContain('New images from QuangEdit (1)');
  expect(changed(state.branch).sort()).toEqual(['src/assets/photography/generated/alpha-gallery.jpg', 'src/assets/photography/generated/alpha-viewer.jpg', 'src/data/photographs.generated.json']);
  expect(sha256(show(state.branch, 'src/assets/photography/generated/alpha-viewer.jpg'))).toBe(treatment.approved.render.viewer.sha256);
  const manifest = JSON.parse(show(state.branch, 'src/data/photographs.generated.json'));
  expect(manifest.find(({ id }) => id === 'alpha')).toMatchObject({ viewerFilename: 'alpha-viewer.jpg', viewerWidth: 2200, viewerHeight: 1438, galleryWidth: 900 });
  // Nothing private: no workspace folders, no RAW, no full-size render.
  expect(tree(state.branch).some((file) => /sources|renders|treatments|quangedit|\.(arw|nef|dng)$/i.test(file))).toBe(false);
  // Once the base has these images, there is nothing left to publish for alpha.
  expect(await approvedImageChanges({ git, commit: state.commit, workspaceDir: fixture.workspace, ids: ['alpha'] })).toEqual([]);
});

test('draft treatments, rejected proposals and draft photographs are not published', async () => {
  await treat('beta', { approve: false });
  // Approved, then a new proposal rejected: the approved render still stands.
  await treat('gamma');
  const before = await readTreatment(fixture.workspace, 'gamma');
  const next = await treat('gamma', { approve: false, color: { r: 10, g: 10, b: 10 } });
  await rejectTreatment(fixture.workspace, 'gamma', next.revision);
  // A draft photograph with an approved treatment.
  const workspace = await readWorkspace(fixture.workspace);
  const { record } = await ingestUpload(fixture.workspace, { filename: 'secret.jpg', bytes: await photograph({ color: { r: 1, g: 200, b: 1 } }) }, workspace.catalog);
  await saveCatalog(fixture.workspace, addDraft(workspace.catalog, { ...record, caption: 'Secret', alt: 'Secret' }), workspace.revision);
  await treat(record.id);

  const state = await preparePublication({ allowUnwatermarked: true, git, workspaceDir: fixture.workspace, github: fakeGitHub(), dryRun: true });
  expect(state.summary.images).toEqual(['gamma']);
  expect(sha256(show(state.branch, 'src/assets/photography/generated/gamma-viewer.jpg'))).toBe(before.approved.render.viewer.sha256);
  expect(changed(state.branch).some((file) => file.includes('beta') || file.includes(record.id))).toBe(false);
});

test('a newly published upload uses its approved render and keeps the original\'s metadata record', async () => {
  const workspace = await readWorkspace(fixture.workspace);
  const { record } = await ingestUpload(fixture.workspace, { filename: 'harbor.jpg', bytes: await photograph({ color: { r: 40, g: 40, b: 160 } }) }, workspace.catalog);
  await saveCatalog(fixture.workspace, addDraft(workspace.catalog, { ...record, caption: 'Harbor', alt: 'A harbor' }), workspace.revision);
  const treatment = await treat(record.id);
  const fresh = await readWorkspace(fixture.workspace);
  await saveCatalog(fixture.workspace, setStatus(fresh.catalog, [record.id], 'published'), fresh.revision);
  const state = await preparePublication({ allowUnwatermarked: true, git, workspaceDir: fixture.workspace, github: fakeGitHub(), dryRun: true });
  expect(state.summary.added).toEqual([record.id]);
  expect(state.summary.images).toEqual([record.id]);
  expect(sha256(show(state.branch, `src/assets/photography/generated/${record.id}-gallery.jpg`))).toBe(treatment.approved.render.gallery.sha256);
  const entry = JSON.parse(show(state.branch, 'src/data/photographs.generated.json')).find(({ id }) => id === record.id);
  expect(entry).toMatchObject({ sourceFilename: 'harbor.jpg', galleryWidth: 900, galleryHeight: 588 });
});

test('a render changed on disk after approval stops publication', async () => {
  const treatment = await treat('alpha');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(`${fixture.workspace}/renders/alpha/${treatment.approved.render.folder}/alpha-viewer.jpg`, await photograph({ width: 10, height: 10 }));
  await expect(preparePublication({ allowUnwatermarked: true, git, workspaceDir: fixture.workspace, github: fakeGitHub(), dryRun: true })).rejects.toMatchObject({ code: 'render-missing' });
});

test('removing an approved treatment stages the original images for the next publication', async () => {
  const workspace = await readWorkspace(fixture.workspace);
  const { record } = await ingestUpload(fixture.workspace, { filename: 'pier.jpg', bytes: await photograph({ color: { r: 60, g: 120, b: 180 } }) }, workspace.catalog);
  await saveCatalog(fixture.workspace, addDraft(workspace.catalog, { ...record, caption: 'Pier', alt: 'A pier' }), workspace.revision);
  const approved = await treat(record.id);
  const fresh = await readWorkspace(fixture.workspace);
  await saveCatalog(fixture.workspace, setStatus(fresh.catalog, [record.id], 'published'), fresh.revision);
  const sources = await editingSources({ workspaceDir: fixture.workspace, record, treatment: approved });

  await expect(removeApprovedTreatment(fixture.workspace, record.id, approved.revision - 1, sources)).rejects.toMatchObject({ code: 'stale-revision' });
  const removed = await removeApprovedTreatment(fixture.workspace, record.id, approved.revision, sources);
  expect(removed).toMatchObject({ approved: null, status: 'draft', restore: { source: { kind: 'original', sha256: sources[0].sha256 }, viewer: { width: 1600 } } });
  expect(removed.document).toEqual(approved.document);
  expect(removed.history).toEqual([expect.objectContaining({ action: 'remove-approved', documentHash: approved.documentHash, approvedAt: approved.approved.approvedAt })]);
  await expect(removeApprovedTreatment(fixture.workspace, record.id, removed.revision, sources)).rejects.toMatchObject({ code: 'no-approved' });

  const state = await preparePublication({ allowUnwatermarked: true, git, workspaceDir: fixture.workspace, github: fakeGitHub(), dryRun: true });
  const viewer = sha256(show(state.branch, `src/assets/photography/generated/${record.id}-viewer.jpg`));
  expect(viewer).toBe(removed.restore.viewer.sha256);
  expect(viewer).not.toBe(approved.approved.render.viewer.sha256);
  expect(tree(state.branch).some((file) => /sources|renders|treatments|quangedit/i.test(file))).toBe(false);
  // Approving again replaces the restore.
  const again = await approveTreatment(fixture.workspace, record.id, removed.revision);
  expect(again.restore).toBeNull();
});

test('without the original file an approved treatment cannot be removed', async () => {
  const treatment = await treat('alpha');
  const { catalog } = await readWorkspace(fixture.workspace);
  const sources = await editingSources({ workspaceDir: fixture.workspace, record: catalog.photographs.find((photo) => photo.id === 'alpha'), treatment: { ...treatment, attached: [] }, derivativesDir: `${fixture.repo}/src/assets/photography/generated` });
  expect(sources[0].kind).toBe('derivative');
  await expect(removeApprovedTreatment(fixture.workspace, 'alpha', treatment.revision, sources)).rejects.toMatchObject({ code: 'no-original' });
  expect((await readTreatment(fixture.workspace, 'alpha')).approved).not.toBeNull();
});
