// The CMS workspace: a private folder outside the repository holding the working catalog
// (drafts included), uploaded originals, preview derivatives and publication state.
// Nothing in it is ever committed, built or served publicly. Layout:
//
//   workspace.json        base ref and commit the workspace started from
//   base.catalog.json     the public catalog at that commit
//   catalog.json          the working catalog (Interval 1 schema, drafts allowed)
//   originals/            uploaded source files, never overwritten
//   originals.json        SHA-256 -> { sourceFilename, id, bytes, uploadedAt }
//   preview/generated/    gallery and viewer derivatives of uploads
//   preview/manifest.json generated records for those derivatives
//   publication.json      the pending or last pull request
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { serializeCatalog } from '../../scripts/photography-catalog.mjs';

export class WorkspaceError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'WorkspaceError';
    this.code = code;
    this.details = details;
  }
}

export const defaultWorkspaceDir = () => path.join(os.homedir(), '.photography-cms', 'portfolio');

/** Refuses workspace folders inside the repository, where Vite, Git or a build could see them. */
export function resolveWorkspaceDir(dir, repoDir) {
  const resolved = path.resolve(dir ?? defaultWorkspaceDir());
  const relative = path.relative(path.resolve(repoDir), resolved);
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new WorkspaceError('unsafe-location', `The CMS workspace must be outside the repository; ${resolved} is inside it.`);
  }
  return resolved;
}

export const paths = (dir) => ({
  meta: path.join(dir, 'workspace.json'),
  base: path.join(dir, 'base.catalog.json'),
  catalog: path.join(dir, 'catalog.json'),
  originals: path.join(dir, 'originals'),
  originalsIndex: path.join(dir, 'originals.json'),
  previewDir: path.join(dir, 'preview', 'generated'),
  previewManifest: path.join(dir, 'preview', 'manifest.json'),
  publication: path.join(dir, 'publication.json'),
  lock: path.join(dir, 'publish.lock'),
});

export const revisionOf = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/** Writes through a temporary file and a rename, so a crash never leaves half a file. */
export async function writeAtomic(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, text, 'utf8');
  await rename(temporary, file);
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw error;
  }
}

const exists = (file) => stat(file).then(() => true, () => false);

/** Creates the workspace from the public catalog if it does not exist yet. */
export async function initWorkspace(dir, { baseRef, baseCommit, baseCatalog }) {
  const p = paths(dir);
  if (await exists(p.meta)) return false;
  await mkdir(p.originals, { recursive: true });
  await mkdir(p.previewDir, { recursive: true });
  const text = serializeCatalog(baseCatalog);
  await writeAtomic(p.base, text);
  await writeAtomic(p.catalog, text);
  await writeAtomic(p.originalsIndex, '{}\n');
  await writeAtomic(p.previewManifest, '[]\n');
  await writeAtomic(p.meta, `${JSON.stringify({ version: 1, baseRef, baseCommit, createdAt: new Date().toISOString() }, null, 2)}\n`);
  return true;
}

export async function readWorkspace(dir) {
  const p = paths(dir);
  if (!(await exists(p.meta))) throw new WorkspaceError('missing', `No CMS workspace at ${dir}.`);
  const catalogText = await readFile(p.catalog, 'utf8');
  return {
    meta: await readJson(p.meta),
    base: await readJson(p.base),
    catalog: JSON.parse(catalogText),
    revision: revisionOf(catalogText),
    originals: await readJson(p.originalsIndex, {}),
    previewManifest: await readJson(p.previewManifest, []),
    publication: await readJson(p.publication, null),
  };
}

/**
 * Saves the working catalog if nobody saved since `expectedRevision` was read.
 * :returns: the new revision
 */
export async function saveCatalog(dir, catalog, expectedRevision) {
  const p = paths(dir);
  const current = revisionOf(await readFile(p.catalog, 'utf8'));
  if (expectedRevision !== current) {
    throw new WorkspaceError('stale-revision', 'The workspace changed since it was loaded; reload to see the latest version.', { current });
  }
  const text = serializeCatalog(catalog);
  await writeAtomic(p.catalog, text);
  return revisionOf(text);
}

/** Moves the workspace onto a newer public catalog (after a merge or a rebase). */
export async function setBase(dir, { baseCatalog, baseCommit, baseRef }) {
  const p = paths(dir);
  const meta = await readJson(p.meta);
  await writeAtomic(p.base, serializeCatalog(baseCatalog));
  await writeAtomic(p.meta, `${JSON.stringify({ ...meta, baseCommit, baseRef: baseRef ?? meta.baseRef, rebasedAt: new Date().toISOString() }, null, 2)}\n`);
}

export async function writePublication(dir, state) {
  const file = paths(dir).publication;
  if (state === null) await rm(file, { force: true });
  else await writeAtomic(file, `${JSON.stringify(state, null, 2)}\n`);
}

/** Serialises publication attempts across processes; a lock older than an hour is stale. */
export async function withPublishLock(dir, action) {
  const file = paths(dir).lock;
  try {
    await writeFile(file, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const held = await readJson(file, { at: 0 });
    if (Date.now() - held.at < 60 * 60 * 1000) throw new WorkspaceError('busy', 'Another publication is already being prepared.');
    await writeFile(file, JSON.stringify({ pid: process.pid, at: Date.now() }));
  }
  try {
    return await action();
  } finally {
    await rm(file, { force: true });
  }
}

/** Removes leftovers of interrupted uploads (temporary files never listed in the index). */
export async function cleanInterruptedUploads(dir) {
  const p = paths(dir);
  const removed = [];
  for (const name of await readdir(p.originals).catch(() => [])) {
    if (name.startsWith('.incoming-')) {
      await rm(path.join(p.originals, name), { force: true });
      removed.push(name);
    }
  }
  return removed;
}
