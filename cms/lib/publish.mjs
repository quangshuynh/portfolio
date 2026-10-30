// "Prepare Publication": turns the workspace into a pull request against the base branch.
//
//  1. Validate the publication catalog (drafts removed) with the Interval 1 validator.
//  2. Fetch the base branch; if its public catalog moved, three-way merge or stop on conflict.
//  3. In a temporary git worktree (the owner's checkout is never touched): write the public
//     catalog, generate derivatives for newly published photographs from the private
//     originals, remove derivatives and manifest entries of withdrawn ones.
//     Approved QuangEdit renders replace the derivatives of their photographs (same file
//     names, so URLs and deep links are unchanged); drafts' treatments are never considered.
//  4. Check assets, check that nothing private is in the diff, commit.
//  5. Push the branch and open the pull request. Never merges.
//
// Each step records progress in publication.json, so a failure after the commit (push or
// pull request creation) is retried without redoing earlier work.
import { randomBytes } from 'node:crypto';
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assetReport, catalogErrors, serializeCatalog } from '../../scripts/photography-catalog.mjs';
import { derivativeFilenames } from '../../scripts/photography-utils.mjs';
import { publicationCatalog, workspaceProblems } from './catalog-ops.mjs';
import { pullRequestBody, summarizeChanges } from './changes.mjs';
import { prepareDerivatives } from './derivatives.mjs';
import { mergeCatalogs } from './merge.mjs';
import { approvedImageChanges } from './treatment-publish.mjs';
import { paths, readWorkspace, saveCatalog, setBase, withPublishLock, writePublication } from './workspace.mjs';

export const CATALOG_PATH = 'src/data/photography.catalog.json';
export const MANIFEST_PATH = 'src/data/photographs.generated.json';
export const DERIVATIVES_PATH = 'src/assets/photography/generated';
const PUBLISHED_PATHS = [CATALOG_PATH, MANIFEST_PATH, DERIVATIVES_PATH];

export class PublishError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'PublishError';
    this.code = code;
    this.details = details;
  }
}

const timestamp = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-');

/** Reads the public catalog at a commit; null if that commit has none. */
export async function catalogAt(git, commit) {
  try {
    return JSON.parse(await git(['show', `${commit}:${CATALOG_PATH}`]));
  } catch {
    return null;
  }
}

/** Fetches the base branch and resolves the commit to build on. */
export async function resolveBase(git, { remote, baseBranch, offline }) {
  const ref = offline ? baseBranch : `${remote}/${baseBranch}`;
  if (!offline) await git(['fetch', '--quiet', remote, baseBranch]);
  const commit = await git(['rev-parse', '--verify', `${ref}^{commit}`]);
  const catalog = await catalogAt(git, commit);
  if (!catalog) {
    throw new PublishError('base-missing-catalog', `${ref} has no ${CATALOG_PATH}. Merge the photography catalog work (Interval 1) into ${baseBranch} before publishing from the CMS.`);
  }
  return { ref, commit, catalog };
}

/**
 * The catalog to publish, merged onto the current base if the base moved.
 * :returns: { catalog, merged } or throws PublishError('conflict')
 */
export function reconcile(workspace, tip) {
  if (JSON.stringify(tip.catalog) === JSON.stringify(workspace.base)) return { catalog: workspace.catalog, merged: false };
  const { catalog, conflicts } = mergeCatalogs(workspace.base, workspace.catalog, tip.catalog);
  if (conflicts.length) {
    throw new PublishError('conflict', `The public catalog on ${tip.ref} changed since this workspace started, and some changes collide. Resolve them, then try again.`, { conflicts });
  }
  return { catalog, merged: true };
}

async function writeTree(worktree, { publication, tipCatalog, workspaceDir, images }) {
  const p = paths(workspaceDir);
  const catalogFile = path.join(worktree, CATALOG_PATH);
  const manifestFile = path.join(worktree, MANIFEST_PATH);
  const derivativesDir = path.join(worktree, DERIVATIVES_PATH);
  await writeFile(catalogFile, serializeCatalog(publication), 'utf8');

  const publishedNow = new Set(publication.photographs.map(({ id }) => id));
  const publishedBefore = new Set(tipCatalog.photographs.filter(({ status }) => status === 'published').map(({ id }) => id));
  const withdrawn = [...publishedBefore].filter((id) => !publishedNow.has(id));
  let manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const added = publication.photographs.filter(({ id }) => !manifest.some((entry) => entry.id === id)).map(({ id }) => id);

  // Withdrawn photographs lose their derivatives in this branch only; the live site keeps
  // them until the pull request is merged.
  for (const id of withdrawn) {
    for (const name of Object.values(derivativeFilenames(id))) await rm(path.join(derivativesDir, name), { force: true });
  }
  manifest = manifest.filter((entry) => publishedNow.has(entry.id));
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  if (added.length) {
    const originals = new Set(await readdir(p.originals));
    const missing = publication.photographs.filter(({ id, sourceFilename }) => added.includes(id) && !originals.has(sourceFilename));
    if (missing.length) {
      throw new PublishError('missing-original', `No uploaded original for ${missing.map(({ id }) => id).join(', ')}; upload it again before publishing.`);
    }
    await prepareDerivatives({ catalogFile, sourceDir: p.originals, outputDir: derivativesDir, manifest: manifestFile, only: added });
  }

  // Approved renders: their staged derivatives replace the photograph's images. The manifest
  // keeps the original's public metadata (capture date, camera); only sizes change.
  const finalManifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const byId = new Map(finalManifest.map((entry) => [entry.id, entry]));
  // A removed treatment (`restore`) puts the original's images back the same way.
  for (const { id, render, restore, files } of images) {
    const entry = byId.get(id);
    if (!entry) throw new PublishError('assets', `No image record for "${id}".`);
    const sizes = render ?? restore;
    await copyFile(files.gallery, path.join(derivativesDir, entry.galleryFilename));
    await copyFile(files.viewer, path.join(derivativesDir, entry.viewerFilename));
    byId.set(id, { ...entry, galleryWidth: sizes.gallery.width, galleryHeight: sizes.gallery.height, viewerWidth: sizes.viewer.width, viewerHeight: sizes.viewer.height });
  }
  const ordered = publication.photographs.map(({ id }) => byId.get(id)).filter(Boolean);
  await writeFile(manifestFile, `${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
  const { errors } = assetReport(publication, ordered, await readdir(derivativesDir));
  if (errors.length) throw new PublishError('assets', 'The published images do not match the catalog.', { errors });
  return { added, withdrawn };
}

/** Fails if anything outside the published paths changed, or if a draft appears in the diff. */
async function checkDiff(git, worktree, { workspace, publication }) {
  // NUL-separated and untrimmed: each entry is "XY path", and X may be a space.
  const entries = (await git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: worktree, raw: true }))
    .split('\0').filter(Boolean).map((entry) => ({ code: entry.slice(0, 2), file: entry.slice(3) }));
  const changed = entries.map(({ file }) => file);
  // Deleting a withdrawn photograph's derivatives is expected; adding one for a draft is not.
  const written = entries.filter(({ code }) => !code.includes('D')).map(({ file }) => file);
  const outside = changed.filter((file) => !PUBLISHED_PATHS.some((allowed) => file === allowed || file.startsWith(`${allowed}/`)));
  if (outside.length) throw new PublishError('unexpected-changes', 'Publication tried to change files it must not touch.', { files: outside });
  const publishedIds = new Set(publication.photographs.map(({ id }) => id));
  const drafts = workspace.catalog.photographs.filter(({ id, status }) => status === 'draft' && !publishedIds.has(id));
  const catalogText = await readFile(path.join(worktree, CATALOG_PATH), 'utf8');
  const draftFiles = (id) => Object.values(derivativeFilenames(id)).map((name) => `${DERIVATIVES_PATH}/${name}`);
  const leaked = drafts.filter(({ id, sourceFilename }) => catalogText.includes(`"${id}"`)
    || draftFiles(id).some((file) => written.includes(file))
    || catalogText.includes(`"${sourceFilename}"`));
  if (leaked.length) throw new PublishError('draft-leak', 'A draft would have been published; nothing was committed.', { drafts: leaked.map(({ id }) => id) });
  return changed;
}

/**
 * :param options.repoDir: the owner's checkout (used only for git objects and worktrees)
 * :param options.workspaceDir: CMS workspace
 * :param options.github: client from github.mjs, or null with dryRun
 * :param options.dryRun: build and commit the branch locally, but do not push or open a PR
 */
export async function preparePublication({
  git, workspaceDir, github, remote = 'origin', baseBranch = 'main', offline = false, dryRun = false, now = new Date(),
}) {
  return withPublishLock(workspaceDir, async () => {
    const workspace = await readWorkspace(workspaceDir);

    // Resume a publication whose commit exists but whose push or pull request failed.
    const pending = workspace.publication;
    if (pending && ['committed', 'pushed'].includes(pending.status) && !dryRun) return finish({ git, github, workspaceDir, remote, baseBranch, state: pending });
    if (pending?.status === 'pr-open' && !dryRun) {
      const pull = await github.getPullRequest(pending.number);
      if (pull.state === 'open') {
        throw new PublishError('already-open', `Pull request #${pending.number} is still open. Merge or close it before preparing another publication.`, { url: pending.url });
      }
    }

    const tip = await resolveBase(git, { remote, baseBranch, offline });
    const { catalog: target, merged } = reconcile(workspace, tip);
    const problems = workspaceProblems(target, { base: tip.catalog });
    if (problems.publication.length) throw new PublishError('invalid', 'Fix these problems before publishing.', { errors: problems.publication });
    const publication = publicationCatalog(target);
    const images = await approvedImageChanges({ git, commit: tip.commit, workspaceDir, ids: publication.photographs.map(({ id }) => id) })
      .catch((error) => { throw new PublishError(error.code ?? 'assets', error.message); });
    const summary = { ...summarizeChanges(tip.catalog, target), images: images.map(({ id }) => id) };
    summary.count += images.length;
    if (!summary.count) throw new PublishError('nothing', `Nothing to publish: the public gallery on ${tip.ref} already matches the workspace.`);
    if (catalogErrors(publication).length) throw new PublishError('invalid', 'The merged catalog is invalid.', { errors: catalogErrors(publication) });

    // Timestamp plus a random suffix, so two publications in the same second never collide.
    const branch = `cms/photography-${timestamp(now)}-${randomBytes(3).toString('hex')}`;
    const worktree = await mkdtemp(path.join(os.tmpdir(), 'cms-publish-'));
    let commit;
    let files;
    let failed = true;
    try {
      await git(['worktree', 'add', '--quiet', '-b', branch, worktree, tip.commit]);
      const { added, withdrawn } = await writeTree(worktree, { publication, tipCatalog: tip.catalog, workspaceDir, images });
      files = await checkDiff(git, worktree, { workspace: { ...workspace, catalog: target }, publication });
      await git(['add', '--all', '--', ...PUBLISHED_PATHS], { cwd: worktree });
      const message = [
        `feat(photography): publish gallery changes from the CMS`,
        '',
        `Added: ${added.join(', ') || 'none'}`,
        `Withdrawn: ${withdrawn.join(', ') || 'none'}`,
        `Edited: ${summary.edited.map(({ id }) => id).join(', ') || 'none'}`,
        `Reordered: ${summary.moved.join(', ') || 'none'}`,
        `New images (QuangEdit): ${summary.images.join(', ') || 'none'}`,
      ].join('\n');
      await git(['commit', '--quiet', '-m', message], { cwd: worktree });
      commit = await git(['rev-parse', 'HEAD'], { cwd: worktree });
      failed = false;
    } finally {
      // The worktree must go first: git refuses to delete a branch checked out in one.
      await git(['worktree', 'remove', '--force', worktree]).catch(() => {});
      await rm(worktree, { recursive: true, force: true });
      await git(['worktree', 'prune']).catch(() => {});
      if (failed) await git(['branch', '-D', branch]).catch(() => {});
    }

    if (merged) {
      // Keep the workspace in step with what was published on top of.
      const { revision } = await readWorkspace(workspaceDir);
      await saveCatalog(workspaceDir, target, revision);
      await setBase(workspaceDir, { baseCatalog: tip.catalog, baseCommit: tip.commit });
    }
    const body = pullRequestBody(summary, target, { baseRef: tip.ref, baseCommit: tip.commit });
    const state = {
      status: dryRun ? 'dry-run' : 'committed',
      branch,
      commit,
      baseRef: tip.ref,
      baseCommit: tip.commit,
      title: `Photography: ${[summary.added.length && `add ${summary.added.length}`, summary.withdrawn.length && `withdraw ${summary.withdrawn.length}`,
        summary.edited.length && `edit ${summary.edited.length}`, summary.images.length && `new images for ${summary.images.length}`, summary.moved.length && 'reorder'].filter(Boolean).join(', ') || 'update featured and collections'}`,
      body,
      files,
      summary,
      submittedCatalog: serializeCatalog(target),
      preparedAt: now.toISOString(),
    };
    await writePublication(workspaceDir, state);
    if (dryRun) return state;
    return finish({ git, github, workspaceDir, remote, baseBranch, state });
  });
}

async function finish({ git, github, workspaceDir, remote, baseBranch, state }) {
  let current = state;
  if (current.status === 'committed') {
    await git(['push', '--quiet', remote, `${current.branch}:refs/heads/${current.branch}`]);
    current = { ...current, status: 'pushed', pushedAt: new Date().toISOString() };
    await writePublication(workspaceDir, current);
  }
  const existing = await github.findOpenPullRequest(current.branch);
  const pull = existing ?? await github.createPullRequest({ head: current.branch, base: baseBranch, title: current.title, body: current.body });
  current = { ...current, status: 'pr-open', number: pull.number, url: pull.url, openedAt: new Date().toISOString() };
  await writePublication(workspaceDir, current);
  return current;
}

/**
 * Refreshes a submitted publication: open, closed, merged, and whether the merge commit
 * has been deployed (GitHub deployments for Vercel "Production" and "github-pages").
 */
export async function publicationStatus({ github, workspaceDir }) {
  const { publication } = await readWorkspace(workspaceDir);
  if (!publication || !['pr-open', 'merged', 'closed'].includes(publication.status) || !github) return publication;
  const pull = await github.getPullRequest(publication.number);
  let next = { ...publication, checkedAt: new Date().toISOString() };
  if (pull.state === 'merged') {
    const deployments = await github.deploymentStates(pull.mergeCommit);
    next = { ...next, status: 'merged', mergeCommit: pull.mergeCommit, deployments, deployed: deployments.Production === 'success' };
  } else if (pull.state === 'closed') {
    next = { ...next, status: 'closed' };
  }
  await writePublication(workspaceDir, next);
  return next;
}
