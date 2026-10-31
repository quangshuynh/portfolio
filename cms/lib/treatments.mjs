// QuangEdit treatments: the complete, non-destructive edit of one CMS photograph, kept
// privately in the workspace. A treatment holds the editor's own edit document (version 11:
// every setting, geometry, layers, masks, watermark), never pixels; a rendered full-resolution image and
// its public derivatives are staged beside it. Saving a treatment, approving it and
// publishing the photograph are three separate steps (docs/photography-cms.md).
//
//   treatments/<id>.json                    the treatment record (below)
//   sources/<sha256>.<ext>                  editing sources the owner attached (RAW, brackets)
//   renders/<id>/<sha16>/<name>-quangedit.jpg + <id>-gallery.jpg + <id>-viewer.jpg
//
// Record: { format, version, photoId, revision, updatedAt, attached: [source], document,
// documentHash, status: none|draft|approved|rejected, render, approved: { document,
// documentHash, render, approvedAt }, restore, history }. `approved` is what publication uses;
// the working document may be newer (draft) or rejected while the approved one still stands.
// `restore` (after Remove approved treatment): the original's derivatives, made from the
// original source with the public pipeline and staged under renders/<id>/<sha16>/, which the
// next publication puts back. `history`: removals, for the record.
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { link, mkdir, open, readdir, rename, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { DERIVATIVES_DIRECTORY } from '../../scripts/photography-catalog-files.mjs';
import { DERIVATIVE_SIZES, createDerivative } from '../../scripts/photography-derivatives.mjs';
import { photographLibraryPaths } from '../../scripts/photography-sources.mjs';
import { derivativeFilenames } from '../../scripts/photography-utils.mjs';
import {
  EditDocumentError, MAX_DOCUMENT_BYTES, createEditDocument, parseEditDocument,
} from '../../src/editor/model/editDocument.mjs';
import { RAW_FORMATS, RAW_SNIFF_BYTES, RAW_SUPPORT, sniffRaw } from '../../src/editor/raw/rawFormat.mjs';
import { sniffImageType } from './uploads.mjs';
import { paths, readJson, writeAtomic } from './workspace.mjs';

export const TREATMENT_FORMAT = 'quangedit-cms-treatment';
export const TREATMENT_VERSION = 1;
// The editor's own import limits (src/editor/io/files.mjs): 200 MB, 100 MP.
export const MAX_SOURCE_BYTES = 200 * 1024 * 1024;
export const MAX_RENDER_BYTES = 200 * 1024 * 1024;
export const MAX_RENDER_PIXELS = 120_000_000;
export const MAX_ATTACHED = 3;
const ID = /^[A-Za-z0-9_-]+$/;
const SHA = /^[0-9a-f]{64}$/;
// RAW formats validated with genuine files (docs/raw-compatibility.md), identified by content.
const EXTENSIONS = { jpeg: '.jpg', png: '.png', webp: '.webp', ...Object.fromEntries(Object.keys(RAW_FORMATS).map((key) => [key, `.${key}`])) };
const RAW_EXTENSIONS = Object.fromEntries(Object.keys(RAW_FORMATS).map((key) => [`.${key}`, key]));
// Camera RAW extensions the editor cannot develop: a library original with one is passed over.
const OTHER_RAW_EXTENSIONS = /^\.(srf|srw|x3f|mrw|3fr|fff|iiq|rwl|dcr|kdc|erf|mef|mos|raw|rwz)$/i;

export class TreatmentError extends Error {
  constructor(code, message, status = 422, details) {
    super(message);
    this.name = 'TreatmentError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const treatmentFile = (dir, id) => {
  if (!ID.test(id)) throw new TreatmentError('bad-id', 'Not a photograph id.', 400);
  return path.join(paths(dir).treatments, `${id}.json`);
};
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const exists = (file) => stat(file).then(() => true, () => false);

export const emptyTreatment = (photoId) => ({
  format: TREATMENT_FORMAT, version: TREATMENT_VERSION, photoId, revision: 0, updatedAt: null,
  attached: [], document: null, documentHash: null, status: 'none', render: null, approved: null,
});

export async function readTreatment(dir, id) {
  const stored = await readJson(treatmentFile(dir, id), null);
  if (!stored) return emptyTreatment(id);
  if (stored.format !== TREATMENT_FORMAT || stored.version !== TREATMENT_VERSION || stored.photoId !== id) {
    throw new TreatmentError('bad-treatment', `The saved treatment of "${id}" is not a version ${TREATMENT_VERSION} treatment.`, 500);
  }
  return stored;
}

export async function listTreatments(dir) {
  const names = await readdir(paths(dir).treatments).catch(() => []);
  const result = {};
  for (const name of names.filter((file) => file.endsWith('.json'))) {
    const id = name.slice(0, -5);
    if (ID.test(id)) result[id] = await readTreatment(dir, id);
  }
  return result;
}

/** Writes a new revision if nobody saved since `expected` was read. */
async function writeTreatment(dir, id, expected, next) {
  const current = await readTreatment(dir, id);
  if (expected !== current.revision) {
    throw new TreatmentError('stale-revision', 'The treatment changed in another tab; reload to see the latest version.', 409, { current: current.revision });
  }
  const record = { ...next, revision: current.revision + 1, updatedAt: new Date().toISOString() };
  await writeAtomic(treatmentFile(dir, id), `${JSON.stringify(record, null, 2)}\n`);
  await collectGarbage(dir);
  return record;
}

// Hash of what the document does (not when it was saved): the identity a render belongs to.
const hashOf = (document) => sha256(JSON.stringify({ exportSettings: document.exportSettings, photos: document.photos }));

/**
 * Validates an edit document with the editor's own parser and returns its canonical form:
 * exactly one photo, unknown fields dropped, values clamped as the editor would read them.
 */
export function canonicalDocument(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_DOCUMENT_BYTES) throw new TreatmentError('too-large', 'Treatments are limited to 4 MB.', 413);
  let parsed;
  try {
    parsed = parseEditDocument(text);
  } catch (error) {
    if (error instanceof EditDocumentError) throw new TreatmentError('invalid-document', error.message);
    throw error;
  }
  if (parsed.photos.length !== 1) throw new TreatmentError('invalid-document', 'A treatment holds exactly one photo.');
  const [{ source, adjustments }] = parsed.photos;
  const document = createEditDocument([{ ...source, adjustments }], parsed.exportSettings);
  delete document.savedAt;
  return { document, documentHash: hashOf(document), source };
}

/** SHA-256 hashes the document's source needs: the photo itself, or a merge's three inputs. */
export const documentSourceHashes = (source) => (source.hdr ? source.hdr.inputs.map(({ sha256: hash }) => hash) : [source.sha256]);

// --- Sources -------------------------------------------------------------------------

const hashCache = new Map();
async function fileHash(file) {
  const info = await stat(file);
  const key = `${file}:${info.size}:${info.mtimeMs}`;
  if (hashCache.has(key)) return hashCache.get(key);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  const value = hash.digest('hex');
  hashCache.set(key, value);
  return value;
}

const formatFromName = (name) => {
  const ext = path.extname(name).toLowerCase();
  return RAW_EXTENSIONS[ext] ?? ({ '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.webp': 'webp' })[ext] ?? null;
};

/** Resolves a library-relative path inside the read-only camera library, or null. */
function libraryFile(libraryDir, relative) {
  if (!libraryDir || !relative) return null;
  const root = path.resolve(libraryDir);
  const file = path.resolve(root, relative);
  return file.startsWith(`${root}${path.sep}`) ? file : null;
}

/**
 * Where the editor reads a photograph from, best first. Each entry has `file` (server only,
 * never sent to the browser). Attached sources win; then the uploaded original; then the
 * camera library (read in place, never copied); and only if none exists, the public
 * 2200 px derivative, marked `limited`. With `hash: false` (overviews), files are only checked
 * for existence and library and derivative entries carry no `sha256`.
 */
export async function editingSources({ workspaceDir, libraryDir, record, treatment, derivativesDir = DERIVATIVES_DIRECTORY, hash = true }) {
  const p = paths(workspaceDir);
  if (treatment.attached.length) {
    const index = await readJson(p.originalsIndex, {});
    return Promise.all(treatment.attached.map(async (entry) => {
      const file = entry.stored === 'originals' && index[entry.sha256]
        ? path.join(p.originals, index[entry.sha256].sourceFilename)
        : path.join(p.sources, `${entry.sha256}${EXTENSIONS[entry.format]}`);
      const available = await exists(file);
      return { ...entry, kind: 'attached', file, available, problem: available ? null : 'The attached file is missing from the workspace; attach it again.' };
    }));
  }
  const index = await readJson(p.originalsIndex, {});
  const upload = Object.entries(index).find(([, entry]) => entry.id === record.id && entry.sourceFilename === record.sourceFilename);
  if (upload) {
    const file = path.join(p.originals, upload[1].sourceFilename);
    const available = await exists(file);
    return [{ kind: 'original', name: record.sourceFilename, format: formatFromName(record.sourceFilename), size: upload[1].bytes, sha256: upload[0], file, available,
      problem: available ? null : 'The uploaded original is missing from the workspace.' }];
  }
  const library = libraryFile(libraryDir, photographLibraryPaths[record.id]);
  let unsupported = null;
  if (library) {
    if (await exists(library) && OTHER_RAW_EXTENSIONS.test(path.extname(library))) {
      unsupported = `The camera-library original (${path.extname(library).slice(1).toUpperCase()}) is a RAW format QuangEdit cannot develop; attach a JPEG or a DNG conversion of it instead. RAW support covers ${RAW_SUPPORT}.`;
    } else if (await exists(library)) {
      const info = await stat(library);
      return [{ kind: 'library', name: record.sourceFilename, format: formatFromName(record.sourceFilename), size: info.size, sha256: hash ? await fileHash(library) : null, file: library, available: true, problem: null }];
    }
    // Moved or renamed in the archive: fall through to the public image, saying so.
  }
  const { viewerFilename } = derivativeFilenames(record.id);
  for (const directory of [derivativesDir, p.previewDir]) {
    const file = path.join(directory, viewerFilename);
    if (await exists(file)) {
      return [{ kind: 'derivative', limited: true, name: viewerFilename, format: 'jpeg', size: (await stat(file)).size, sha256: hash ? await fileHash(file) : null, file, available: true,
        problem: unsupported ?? (library ? 'The camera-library original was not found (moved or renamed); only the 2200 px public image is available.'
          : 'Only the 2200 px public image is available. Attach the original (JPEG or a supported RAW file) to edit at full quality.') }];
    }
  }
  return [];
}

/** The browser's view of sources: no file paths. */
export const publicSources = (sources) => sources.map(({ file, ...source }, index) => ({ ...source, index }));

/** Streams a request body to a temporary file, hashing it; refuses bodies over `limit`. */
export async function receiveFile(request, directory, limit) {
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.incoming-${randomBytes(6).toString('hex')}`);
  const handle = await open(temporary, 'wx');
  const hash = createHash('sha256');
  let size = 0;
  let head = Buffer.alloc(0);
  try {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > limit) throw new TreatmentError('too-large', `Files are limited to ${Math.round(limit / 1024 / 1024)} MB.`, 413);
      // Enough to identify a RAW file by its IFD0 (rawFormat.mjs).
      if (head.length < RAW_SNIFF_BYTES) head = Buffer.concat([head, chunk.subarray(0, RAW_SNIFF_BYTES - head.length)]);
      hash.update(chunk);
      await handle.write(chunk);
    }
  } catch (error) {
    await handle.close();
    await unlink(temporary).catch(() => {});
    throw error;
  }
  await handle.close();
  if (!size) {
    await unlink(temporary).catch(() => {});
    throw new TreatmentError('empty', 'The file is empty.');
  }
  return { temporary, sha256: hash.digest('hex'), size, head };
}

/** Moves a temporary file to `final` unless a file is already there (never overwrites). */
async function settle(temporary, final) {
  try {
    await link(temporary, final);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

const safeName = (name, fallbackExt) => {
  const base = path.basename(String(name ?? '').replace(/\\/g, '/'));
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length).normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'photograph';
  return `${stem}${/^\.[A-Za-z0-9]{1,5}$/.test(ext) ? ext : fallbackExt}`;
};

/**
 * Attaches an editing source (JPEG, PNG, WebP or a supported RAW file) to a photograph: stored once
 * by content in sources/, or referenced in originals/ when it is already an upload.
 */
export async function attachSource(dir, id, { request, filename, revision }) {
  const p = paths(dir);
  const received = await receiveFile(request, p.sources, MAX_SOURCE_BYTES);
  try {
    let format = sniffImageType(received.head);
    // RAW files by content, never by name; an unvalidated RAW format is refused with its name.
    if (!format) {
      try {
        format = sniffRaw(new Uint8Array(received.head.buffer, received.head.byteOffset, received.head.length));
      } catch (error) {
        throw new TreatmentError('unsupported', error.message, 415);
      }
    }
    if (!format) throw new TreatmentError('unsupported', `Attach a JPEG, PNG or WebP file, or a RAW file (${RAW_SUPPORT}).`, 415);
    const treatment = await readTreatment(dir, id);
    if (treatment.attached.some((entry) => entry.sha256 === received.sha256)) return treatment;
    if (treatment.attached.length >= MAX_ATTACHED) throw new TreatmentError('too-many', `A photograph has at most ${MAX_ATTACHED} editing sources (an HDR bracket).`, 409);
    const index = await readJson(p.originalsIndex, {});
    const entry = { sha256: received.sha256, name: safeName(filename, EXTENSIONS[format]), format, size: received.size, attachedAt: new Date().toISOString() };
    if (index[received.sha256]) {
      entry.stored = 'originals';
      await unlink(received.temporary).catch(() => {});
    } else {
      await settle(received.temporary, path.join(p.sources, `${received.sha256}${EXTENSIONS[format]}`));
    }
    return writeTreatment(dir, id, revision, { ...treatment, attached: [...treatment.attached, entry] });
  } finally {
    await unlink(received.temporary).catch(() => {});
  }
}

export async function clearSources(dir, id, revision) {
  const treatment = await readTreatment(dir, id);
  return writeTreatment(dir, id, revision, { ...treatment, attached: [] });
}

// --- Saving, rendering, review ---------------------------------------------------------

/**
 * Saves the working edit document. It must describe one of the photograph's sources (by
 * SHA-256), so edits never attach to the wrong photograph. A changed document becomes a
 * draft; the approved one, if any, is kept for publication until another is approved.
 */
export async function saveTreatment(dir, id, { text, revision, sources }) {
  const { document, documentHash, source } = canonicalDocument(text);
  const known = new Set(sources.filter(({ available }) => available).map(({ sha256: hash }) => hash));
  const needed = documentSourceHashes(source);
  if (needed.some((hash) => !hash || !known.has(hash))) {
    throw new TreatmentError('source-mismatch', source.hdr
      ? 'This merged HDR uses files that are not this photograph\'s editing sources; attach all three exposures first.'
      : 'These edits belong to a different file than this photograph\'s source.');
  }
  const treatment = await readTreatment(dir, id);
  if (treatment.documentHash === documentHash) return treatment;
  const status = treatment.approved?.documentHash === documentHash ? 'approved' : 'draft';
  const render = treatment.render?.documentHash === documentHash ? treatment.render
    : treatment.approved?.documentHash === documentHash ? treatment.approved.render : treatment.render;
  return writeTreatment(dir, id, revision, { ...treatment, document, documentHash, status, render });
}

const renderSafeName = (name) => {
  const stem = safeName(name, '.jpg').replace(/\.[^.]*$/, '').replace(/-quangedit$/i, '');
  return `${stem}-quangedit.jpg`;
};

/**
 * Stores a full-resolution render of the saved document and generates its gallery and
 * viewer derivatives with the public pipeline. Written to a temporary folder first, then
 * moved into place, so a failed render never replaces a good one or touches the treatment.
 */
export async function storeRender(dir, id, { request, name, documentHash, revision }) {
  const treatment = await readTreatment(dir, id);
  if (!treatment.document) throw new TreatmentError('no-treatment', 'Save the treatment before rendering it.', 409);
  if (documentHash !== treatment.documentHash) throw new TreatmentError('stale-render', 'The treatment changed since this render started; save and render again.', 409);
  if (revision !== treatment.revision) throw new TreatmentError('stale-revision', 'The treatment changed in another tab; reload to see the latest version.', 409);
  const root = path.join(paths(dir).renders, id);
  const received = await receiveFile(request, root, MAX_RENDER_BYTES);
  const scratch = path.join(root, `.render-${randomBytes(6).toString('hex')}`);
  try {
    if (sniffImageType(received.head) !== 'jpeg') throw new TreatmentError('unsupported', 'Renders are JPEG files.', 415);
    let metadata;
    try {
      const image = sharp(received.temporary, { failOn: 'error', limitInputPixels: MAX_RENDER_PIXELS });
      metadata = await image.metadata();
      await image.resize(16, 16, { fit: 'inside' }).raw().toBuffer();
    } catch (error) {
      throw new TreatmentError('unreadable', `The render could not be decoded: ${error.message}`);
    }
    const fileName = renderSafeName(name);
    await mkdir(scratch, { recursive: true });
    await rename(received.temporary, path.join(scratch, fileName));
    const { galleryFilename, viewerFilename } = derivativeFilenames(id);
    const gallery = await createDerivative(path.join(scratch, fileName), path.join(scratch, galleryFilename), DERIVATIVE_SIZES.gallery.dimensions, DERIVATIVE_SIZES.gallery.quality);
    const viewer = await createDerivative(path.join(scratch, fileName), path.join(scratch, viewerFilename), DERIVATIVE_SIZES.viewer.dimensions, DERIVATIVE_SIZES.viewer.quality);
    const folder = received.sha256.slice(0, 16);
    const final = path.join(root, folder);
    if (await exists(final)) await rm(scratch, { recursive: true, force: true });
    else await rename(scratch, final);
    const hashFile = async (file) => fileHash(path.join(final, file));
    const render = {
      folder, file: fileName, sha256: received.sha256, width: metadata.width, height: metadata.height, bytes: received.size, documentHash, renderedAt: new Date().toISOString(),
      gallery: { ...gallery, sha256: await hashFile(galleryFilename) },
      viewer: { ...viewer, sha256: await hashFile(viewerFilename) },
    };
    const fresh = await readTreatment(dir, id);
    if (fresh.documentHash !== documentHash) throw new TreatmentError('stale-render', 'The treatment changed while rendering; render again.', 409);
    return writeTreatment(dir, id, fresh.revision, { ...fresh, render });
  } finally {
    await unlink(received.temporary).catch(() => {});
    await rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
}

export const renderIsFresh = (treatment) => Boolean(treatment.document && treatment.render && treatment.render.documentHash === treatment.documentHash);

/** Approves the working treatment and its render for publication. */
export async function approveTreatment(dir, id, revision) {
  const treatment = await readTreatment(dir, id);
  if (!treatment.document) throw new TreatmentError('no-treatment', 'There is no treatment to approve.', 409);
  if (!renderIsFresh(treatment)) throw new TreatmentError('stale-render', 'Render the current treatment before approving it, so the approved image is exactly what you reviewed.', 409);
  const approved = { document: treatment.document, documentHash: treatment.documentHash, render: treatment.render, approvedAt: new Date().toISOString() };
  return writeTreatment(dir, id, revision, { ...treatment, status: 'approved', approved, restore: null });
}

/** Rejects the working treatment; an earlier approved treatment still stands. */
export async function rejectTreatment(dir, id, revision) {
  const treatment = await readTreatment(dir, id);
  if (!treatment.document) throw new TreatmentError('no-treatment', 'There is no treatment to reject.', 409);
  return writeTreatment(dir, id, revision, { ...treatment, status: 'rejected' });
}

/**
 * Removes the approved treatment so the photograph returns to its original appearance at the
 * next publication. The original's gallery and viewer images are generated now from the
 * original source (uploaded original or camera-library file, JPEG/PNG/WebP) with the public
 * pipeline and staged; nothing public changes until a publication pull request is merged.
 * The working document is kept as a draft (or as it was), so the edit can be approved again.
 * :param sources: editingSources() of the photograph
 */
export async function removeApprovedTreatment(dir, id, revision, sources) {
  const treatment = await readTreatment(dir, id);
  if (!treatment.approved) throw new TreatmentError('no-approved', 'There is no approved treatment to remove.', 409);
  if (revision !== treatment.revision) throw new TreatmentError('stale-revision', 'The treatment changed in another tab; reload to see the latest version.', 409, { current: treatment.revision });
  const original = sources.find((source) => (source.kind === 'original' || source.kind === 'library') && source.available && ['jpeg', 'png', 'webp'].includes(source.format));
  if (!original) {
    throw new TreatmentError('no-original', 'The original image is not available (only the public image, an attached RAW, or a missing library file), so the original appearance cannot be regenerated. Upload or reconnect the original JPEG first.', 409);
  }
  const root = path.join(paths(dir).renders, id);
  const folder = original.sha256.slice(0, 16);
  const final = path.join(root, folder);
  const { galleryFilename, viewerFilename } = derivativeFilenames(id);
  if (!(await exists(path.join(final, viewerFilename)))) {
    const scratch = path.join(root, `.restore-${randomBytes(6).toString('hex')}`);
    try {
      await mkdir(scratch, { recursive: true });
      await createDerivative(original.file, path.join(scratch, galleryFilename), DERIVATIVE_SIZES.gallery.dimensions, DERIVATIVE_SIZES.gallery.quality);
      await createDerivative(original.file, path.join(scratch, viewerFilename), DERIVATIVE_SIZES.viewer.dimensions, DERIVATIVE_SIZES.viewer.quality);
      await rm(final, { recursive: true, force: true });
      await rename(scratch, final);
    } finally {
      await rm(scratch, { recursive: true, force: true }).catch(() => {});
    }
  }
  const describeImage = async (name) => {
    const { width, height } = await sharp(path.join(final, name)).metadata();
    return { width, height, sha256: await fileHash(path.join(final, name)) };
  };
  const now = new Date().toISOString();
  const restore = { folder, source: { kind: original.kind, sha256: original.sha256 }, gallery: await describeImage(galleryFilename), viewer: await describeImage(viewerFilename), requestedAt: now };
  const history = [...(treatment.history ?? []), { action: 'remove-approved', at: now, documentHash: treatment.approved.documentHash, approvedAt: treatment.approved.approvedAt }];
  return writeTreatment(dir, id, revision, { ...treatment, approved: null, restore, history, status: treatment.status === 'approved' ? 'draft' : treatment.status });
}

/** Drops the working treatment: back to the approved one, or to no treatment at all. */
export async function discardTreatment(dir, id, revision) {
  const treatment = await readTreatment(dir, id);
  const { approved } = treatment;
  return writeTreatment(dir, id, revision, approved
    ? { ...treatment, document: approved.document, documentHash: approved.documentHash, render: approved.render, status: 'approved' }
    : { ...treatment, document: null, documentHash: null, render: null, status: 'none' });
}

/** Absolute path of a staged original image of a removed treatment (gallery or viewer), or null. */
export function restoreImage(dir, id, restore, which) {
  if (!restore || !/^[0-9a-f]{16}$/.test(restore.folder)) return null;
  const name = derivativeFilenames(id)[`${which}Filename`];
  return name ? path.join(paths(dir).renders, id, restore.folder, name) : null;
}

/** Absolute path of a staged image of a render (`file`, gallery or viewer), or null. */
export function renderImage(dir, id, render, which) {
  if (!render) return null;
  const { galleryFilename, viewerFilename } = derivativeFilenames(id);
  const name = { gallery: galleryFilename, viewer: viewerFilename, full: render.file }[which];
  if (!name || !/^[0-9a-f]{16}$/.test(render.folder)) return null;
  return path.join(paths(dir).renders, id, render.folder, name);
}

/** Removes render folders and attached sources nothing refers to any more. */
async function collectGarbage(dir) {
  const p = paths(dir);
  const treatments = await listTreatments(dir);
  const keepSources = new Set(Object.values(treatments).flatMap(({ attached }) => attached.map(({ sha256: hash }) => hash)));
  for (const name of await readdir(p.sources).catch(() => [])) {
    const hash = name.split('.')[0];
    if (SHA.test(hash) && !keepSources.has(hash)) await rm(path.join(p.sources, name), { force: true });
  }
  for (const id of await readdir(p.renders).catch(() => [])) {
    if (!ID.test(id)) continue;
    const keep = new Set([treatments[id]?.render?.folder, treatments[id]?.approved?.render?.folder, treatments[id]?.restore?.folder].filter(Boolean));
    for (const folder of await readdir(path.join(p.renders, id)).catch(() => [])) {
      if (!folder.startsWith('.') && !keep.has(folder)) await rm(path.join(p.renders, id, folder), { recursive: true, force: true });
    }
  }
}

/** Short status for the library: what the dashboard shows on each card. */
export function treatmentSummary(treatment) {
  return {
    status: treatment.status,
    hasApproved: Boolean(treatment.approved),
    restorePending: Boolean(!treatment.approved && treatment.restore),
    renderFresh: renderIsFresh(treatment),
    attached: treatment.attached.length,
    revision: treatment.revision,
  };
}
