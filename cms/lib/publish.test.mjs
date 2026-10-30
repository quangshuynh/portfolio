// @vitest-environment node
// Publication against real temporary git repositories (a bare "origin" stands in for
// GitHub's git hosting) with a fake GitHub API. No network, no real repository.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assetReport, serializeCatalog } from '../../scripts/photography-catalog.mjs';
import { fakeGitHub, fixtureRepo, photograph } from '../test-helpers.mjs';
import { addDraft, setFeatured, setStatus, updatePhotograph, movePhotograph } from './catalog-ops.mjs';
import { createGit } from './git.mjs';
import { GitHubError } from './github.mjs';
import { preparePublication, publicationStatus, resolveBase } from './publish.mjs';
import { ingestUpload } from './uploads.mjs';
import { initWorkspace, readWorkspace, saveCatalog } from './workspace.mjs';

let fixture;
let git;

async function setup() {
  fixture = await fixtureRepo();
  git = createGit(fixture.repo);
  const tip = await resolveBase(git, { remote: 'origin', baseBranch: 'main' });
  await initWorkspace(fixture.workspace, { baseRef: tip.ref, baseCommit: tip.commit, baseCatalog: tip.catalog });
}

async function edit(change) {
  const workspace = await readWorkspace(fixture.workspace);
  await saveCatalog(fixture.workspace, change(workspace.catalog), workspace.revision);
}

/** Uploads a synthetic photograph and returns its draft id. */
async function upload(name, overrides = {}) {
  const workspace = await readWorkspace(fixture.workspace);
  // Distinct pixels per name: identical bytes would (correctly) be rejected as a duplicate.
  const shade = [...name].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 200, 7);
  const bytes = await photograph({ color: { r: shade, g: 255 - shade, b: 90 } });
  const { record } = await ingestUpload(fixture.workspace, { filename: name, bytes }, workspace.catalog);
  await edit((catalog) => addDraft(catalog, { ...record, caption: `Caption ${record.id}`, alt: `Alt ${record.id}`, ...overrides }));
  return record.id;
}

const show = (ref, file) => execFileSync('git', ['show', `${ref}:${file}`], { cwd: fixture.origin, encoding: 'utf8' });
const tree = (ref) => execFileSync('git', ['ls-tree', '-r', '--name-only', ref], { cwd: fixture.origin, encoding: 'utf8' }).trim().split('\n');

beforeEach(setup, 60_000);
afterEach(() => fixture.cleanup());

describe('preparing a publication', () => {
  test('pushes a branch with exactly the published changes and opens a pull request', async () => {
    const added = await upload('new-lake.jpg');
    const secret = await upload('secret-draft.jpg', { caption: 'Private caption' });
    await edit((catalog) => setFeatured(setStatus(catalog, [added], 'published'), added, 1));
    await edit((catalog) => setStatus(catalog, ['beta'], 'draft'));
    await edit((catalog) => updatePhotograph(catalog, 'gamma', { caption: 'Renamed' }));
    const github = fakeGitHub();

    const state = await preparePublication({ allowUnwatermarked: true, git, workspaceDir: fixture.workspace, github });
    expect(state).toMatchObject({ status: 'pr-open', number: 101 });
    const [, request] = github.calls.find(([name]) => name === 'createPullRequest');
    expect(request).toMatchObject({ head: state.branch, base: 'main' });
    expect(request.body).toContain(`- \`${added}\``);
    expect(request.body).toContain('### Withdrawn (1)');

    const branch = state.branch;
    const catalog = JSON.parse(show(branch, 'src/data/photography.catalog.json'));
    expect(catalog.photographs.map(({ id }) => id)).toEqual(['alpha', 'gamma', added]);
    expect(catalog.photographs.every(({ status }) => status === 'published')).toBe(true);
    expect(catalog.photographs.find(({ id }) => id === 'gamma').caption).toBe('Renamed');
    const manifest = JSON.parse(show(branch, 'src/data/photographs.generated.json'));
    const files = tree(branch).filter((file) => file.startsWith('src/assets/photography/generated/')).map((file) => path.basename(file));
    expect(assetReport(catalog, manifest, files).errors).toEqual([]);
    expect(files).toEqual(expect.arrayContaining([`${added}-gallery.jpg`, `${added}-viewer.jpg`]));
    expect(files).not.toEqual(expect.arrayContaining(['beta-gallery.jpg']));

    // Nothing private anywhere in the pushed branch: no draft id, caption, file or original.
    const grep = (pattern) => {
      try {
        return execFileSync('git', ['grep', '-I', '-l', '-e', pattern, branch], { cwd: fixture.origin, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch (error) {
        if (error.status === 1) return ''; // git grep exits 1 when nothing matches
        throw error;
      }
    };
    expect(grep('Caption alpha')).not.toBe(''); // control: the search does see published text
    for (const pattern of [secret, 'Private caption', 'secret-draft']) expect(grep(pattern)).toBe('');
    expect(tree(branch).some((file) => /originals|\.photography-cms/.test(file))).toBe(false);
    const changed = execFileSync('git', ['diff', '--name-only', 'main', branch], { cwd: fixture.origin, encoding: 'utf8' }).trim().split('\n');
    expect(changed.every((file) => file.startsWith('src/data/') || file.startsWith('src/assets/photography/generated/'))).toBe(true);
    // The owner's checkout is untouched and main did not move.
    expect(fixture.git('status', '--porcelain')).toBe('');
    expect(execFileSync('git', ['rev-parse', 'main'], { cwd: fixture.origin, encoding: 'utf8' }).trim()).toBe((await readWorkspace(fixture.workspace)).meta.baseCommit);
  }, 120_000);

  test('photographs without an approved watermark block publication unless the owner overrides', async () => {
    await edit((catalog) => movePhotograph(catalog, 'gamma', 0));
    const github = fakeGitHub();
    const refused = preparePublication({ git, workspaceDir: fixture.workspace, github, dryRun: true });
    await expect(refused).rejects.toMatchObject({ code: 'unwatermarked', details: { ids: expect.arrayContaining(['alpha', 'gamma']) } });
    expect(fixture.git('branch', '--list', 'cms/*')).toBe('');
    const state = await preparePublication({ allowUnwatermarked: true, git, workspaceDir: fixture.workspace, github, dryRun: true });
    expect(state.summary.unwatermarked).toEqual(expect.arrayContaining(['alpha', 'gamma']));
    expect(state.body).toContain('Published without the watermark');
    expect(state.body).toContain('The owner chose to publish these without the HUYNH Photography watermark.');
  }, 120_000);

  test('a dry run commits a local branch but pushes nothing and calls no GitHub API', async () => {
    await edit((catalog) => movePhotograph(catalog, 'gamma', 0));
    const github = fakeGitHub();
    const state = await preparePublication({ allowUnwatermarked: true, git, workspaceDir: fixture.workspace, github, dryRun: true });
    expect(state.status).toBe('dry-run');
    expect(github.calls).toEqual([]);
    expect(fixture.git('branch', '--list', state.branch)).toContain(state.branch);
    expect(() => execFileSync('git', ['rev-parse', '--verify', state.branch], { cwd: fixture.origin, stdio: 'ignore' })).toThrow();
  }, 120_000);

  test('refuses invalid catalogs, empty publications and duplicate attempts', async () => {
    const github = fakeGitHub();
    await expect(preparePublication({ allowUnwatermarked: true, git, workspaceDir: fixture.workspace, github })).rejects.toMatchObject({ code: 'nothing' });
    await edit((catalog) => updatePhotograph(catalog, 'alpha', { alt: '' }));
    await expect(preparePublication({ allowUnwatermarked: true, git, workspaceDir: fixture.workspace, github })).rejects.toMatchObject({ code: 'invalid' });
    await edit((catalog) => updatePhotograph(catalog, 'alpha', { alt: 'Fixed' }));
    const first = await preparePublication({ allowUnwatermarked: true, git, workspaceDir: fixture.workspace, github });
    await edit((catalog) => updatePhotograph(catalog, 'beta', { caption: 'Another' }));
    await expect(preparePublication({ allowUnwatermarked: true, git, workspaceDir: fixture.workspace, github })).rejects.toMatchObject({ code: 'already-open', details: { url: first.url } });
    // Once that pull request is closed, a new publication may start.
    github.pulls.get(first.number).state = 'closed';
    await expect(preparePublication({ allowUnwatermarked: true, git, workspaceDir: fixture.workspace, github })).resolves.toMatchObject({ status: 'pr-open', number: 102 });
  }, 120_000);

  test('a publication whose original is missing fails without leaving branches behind', async () => {
    await edit((catalog) => setStatus(addDraft(catalog, {
      id: 'ghost', slug: 'ghost', status: 'draft', sourceFilename: 'ghost.jpg', caption: 'Ghost', alt: 'Ghost', shape: 'landscape', category: 'Places',
    }), ['ghost'], 'published'));
    await expect(preparePublication({ allowUnwatermarked: true, git, workspaceDir: fixture.workspace, github: fakeGitHub() })).rejects.toMatchObject({ code: 'missing-original' });
    expect(fixture.git('branch', '--list', 'cms/*')).toBe('');
    expect(fixture.git('worktree', 'list').split('\n')).toHaveLength(1);
  }, 120_000);
});

describe('stale bases and conflicts', () => {
  test('merges onto a base branch that moved with non-conflicting changes', async () => {
    await edit((catalog) => updatePhotograph(catalog, 'alpha', { caption: 'Ours' }));
    fixture.pushToMain((dir) => {
      const file = path.join(dir, 'src/data/photography.catalog.json');
      const catalog = JSON.parse(readFileSync(file, 'utf8'));
      catalog.photographs[1].alt = 'Changed upstream';
      writeFileSync(file, serializeCatalog(catalog));
    });
    const state = await preparePublication({ allowUnwatermarked: true, git, workspaceDir: fixture.workspace, github: fakeGitHub() });
    const catalog = JSON.parse(show(state.branch, 'src/data/photography.catalog.json'));
    expect(catalog.photographs[0].caption).toBe('Ours');
    expect(catalog.photographs[1].alt).toBe('Changed upstream');
    const workspace = await readWorkspace(fixture.workspace);
    expect(workspace.meta.baseCommit).toBe(state.baseCommit);
  }, 120_000);

  test('stops on conflicting changes and reports them', async () => {
    await edit((catalog) => updatePhotograph(catalog, 'alpha', { caption: 'Ours' }));
    fixture.pushToMain((dir) => {
      const file = path.join(dir, 'src/data/photography.catalog.json');
      const catalog = JSON.parse(readFileSync(file, 'utf8'));
      catalog.photographs[0].caption = 'Theirs';
      writeFileSync(file, serializeCatalog(catalog));
    });
    await expect(preparePublication({ allowUnwatermarked: true, git, workspaceDir: fixture.workspace, github: fakeGitHub() }))
      .rejects.toMatchObject({ code: 'conflict', details: { conflicts: ['"alpha": caption changed on both sides'] } });
    expect(fixture.git('branch', '--list', 'cms/*')).toBe('');
  }, 120_000);
});

describe('recovery and status', () => {
  test('a failed push or pull request is resumed without redoing the commit', async () => {
    await edit((catalog) => updatePhotograph(catalog, 'beta', { caption: 'Resumed' }));
    fixture.git('remote', 'set-url', '--push', 'origin', path.join(fixture.root, 'missing.git'));
    await expect(preparePublication({ allowUnwatermarked: true, git, workspaceDir: fixture.workspace, github: fakeGitHub() })).rejects.toMatchObject({ name: 'GitError' });
    const committed = (await readWorkspace(fixture.workspace)).publication;
    expect(committed.status).toBe('committed');

    fixture.git('remote', 'set-url', '--push', 'origin', fixture.origin);
    const failing = fakeGitHub({ createPullRequest: async () => { throw new GitHubError('auth', 'GitHub rejected the token (401).', 401); } });
    await expect(preparePublication({ allowUnwatermarked: true, git, workspaceDir: fixture.workspace, github: failing })).rejects.toMatchObject({ code: 'auth' });
    const pushed = (await readWorkspace(fixture.workspace)).publication;
    expect(pushed).toMatchObject({ status: 'pushed', commit: committed.commit, branch: committed.branch });

    const github = fakeGitHub();
    const done = await preparePublication({ allowUnwatermarked: true, git, workspaceDir: fixture.workspace, github });
    expect(done).toMatchObject({ status: 'pr-open', branch: committed.branch, commit: committed.commit });
    expect(github.calls.map(([name]) => name)).toEqual(['findOpenPullRequest', 'createPullRequest']);
  }, 120_000);

  test('status distinguishes an open pull request, a merge and a finished deployment', async () => {
    await edit((catalog) => updatePhotograph(catalog, 'beta', { caption: 'Merged' }));
    const github = fakeGitHub();
    const state = await preparePublication({ allowUnwatermarked: true, git, workspaceDir: fixture.workspace, github });
    expect((await publicationStatus({ github, workspaceDir: fixture.workspace })).status).toBe('pr-open');
    Object.assign(github.pulls.get(state.number), { state: 'merged', mergeCommit: 'f'.repeat(40) });
    const merged = await publicationStatus({ github, workspaceDir: fixture.workspace });
    expect(merged).toMatchObject({ status: 'merged', mergeCommit: 'f'.repeat(40), deployed: true, deployments: { Production: 'success' } });
  }, 120_000);
});
