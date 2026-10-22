// Upload ingestion: validates a file, stores the original privately in the workspace
// (never overwriting), generates its gallery and viewer derivatives with the public
// pipeline, and describes the draft record to add. Retrying the same file is safe: a
// file already in the workspace is reported as a duplicate, not stored twice.
import { createHash, randomBytes } from 'node:crypto';
import { link, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { serializeCatalog } from '../../scripts/photography-catalog.mjs';
import { idFromFilename } from './catalog-ops.mjs';
import { prepareDerivatives } from './derivatives.mjs';
import { paths, readJson, writeAtomic } from './workspace.mjs';

export const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;
export const MAX_UPLOAD_PIXELS = 120_000_000;

export class UploadError extends Error {
  constructor(code, message, status = 422, details) {
    super(message);
    this.name = 'UploadError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Identifies JPEG, PNG and WebP by content; the file name and declared type are not trusted. */
export function sniffImageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => bytes[i] === byte)) return 'png';
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

const EXTENSIONS = { jpeg: ['.jpg', '.jpeg'], png: ['.png'], webp: ['.webp'] };

/** A file name made of safe characters with an extension that matches the content. */
export function safeSourceFilename(original, type) {
  const base = path.basename(String(original ?? '').replace(/\\/g, '/'));
  const extension = path.extname(base);
  const allowed = EXTENSIONS[type];
  const stem = base.slice(0, base.length - extension.length).normalize('NFKD')
    .replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'photograph';
  const ext = allowed.includes(extension.toLowerCase()) ? extension.replace(/[^A-Za-z.]/g, '') : allowed[0];
  return `${stem}${ext}`;
}

async function decodeCheck(bytes) {
  try {
    const image = sharp(bytes, { failOn: 'error', limitInputPixels: MAX_UPLOAD_PIXELS });
    const metadata = await image.metadata();
    // Decoding the whole image catches truncated or corrupt data that a header read misses.
    await image.rotate().resize(32, 32, { fit: 'inside' }).raw().toBuffer();
    return metadata;
  } catch (error) {
    throw new UploadError('unreadable', `The image could not be decoded: ${error.message}`);
  }
}

/**
 * :param dir: workspace folder
 * :param upload: { filename, bytes: Buffer }
 * :param catalog: current working catalog
 * :returns: { duplicate: true, id } or { duplicate: false, record, sha256 }
 */
export async function ingestUpload(dir, { filename, bytes }, catalog) {
  if (!bytes?.length) throw new UploadError('empty', 'The file is empty.');
  if (bytes.length > MAX_UPLOAD_BYTES) throw new UploadError('too-large', `Files are limited to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`, 413);
  const type = sniffImageType(bytes);
  if (!type) throw new UploadError('unsupported', 'Only JPEG, PNG and WebP images can be uploaded (RAW files stay in the camera archive).', 415);
  await decodeCheck(bytes);

  const p = paths(dir);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const index = await readJson(p.originalsIndex, {});
  if (index[sha256]) {
    const known = index[sha256];
    const inCatalog = catalog.photographs.some(({ id }) => id === known.id);
    if (inCatalog) return { duplicate: true, id: known.id, sourceFilename: known.sourceFilename };
  }

  // Unique ignoring case against the catalog and stored originals; collisions get the
  // hash suffix the archive already uses (name--abcd1234.ext).
  let sourceFilename = safeSourceFilename(filename, type);
  const taken = new Set([
    ...catalog.photographs.map((record) => record.sourceFilename.toLowerCase()),
    ...Object.values(index).map((entry) => entry.sourceFilename.toLowerCase()),
  ]);
  if (taken.has(sourceFilename.toLowerCase()) && index[sha256]?.sourceFilename !== sourceFilename) {
    const ext = path.extname(sourceFilename);
    sourceFilename = `${sourceFilename.slice(0, -ext.length)}--${sha256.slice(0, 8)}${ext}`;
  }
  const id = index[sha256]?.id ?? idFromFilename(sourceFilename.replace(/--[0-9a-f]{8}(?=\.)/, ''), catalog.photographs.map((record) => record.id));

  // Store the original without ever replacing an existing file: write a temporary file,
  // hard-link it to the final name (fails if the name exists), then drop the temporary.
  const finalPath = path.join(p.originals, sourceFilename);
  if (!index[sha256]) {
    const temporary = path.join(p.originals, `.incoming-${randomBytes(6).toString('hex')}`);
    await writeFile(temporary, bytes, { flag: 'wx' });
    try {
      await link(temporary, finalPath);
    } catch (error) {
      if (error.code === 'EEXIST') {
        const existing = await readFile(finalPath);
        if (createHash('sha256').update(existing).digest('hex') !== sha256) {
          throw new UploadError('name-conflict', `A different original is already stored as ${sourceFilename}.`, 409);
        }
      } else throw error;
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }

  // Derivatives through the public pipeline, from a one-photograph catalog in a temp folder.
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'cms-upload-'));
  try {
    const catalogFile = path.join(scratch, 'catalog.json');
    const manifest = path.join(scratch, 'manifest.json');
    await writeFile(catalogFile, serializeCatalog({
      schemaVersion: 1,
      captureTimeZone: catalog.captureTimeZone,
      hero: id,
      categories: catalog.categories,
      photographs: [{ id, slug: id, status: 'published', sourceFilename, caption: id, alt: id, shape: 'landscape', category: catalog.categories[0] }],
    }));
    try {
      await prepareDerivatives({ catalogFile, sourceDir: p.originals, outputDir: p.previewDir, manifest, only: [id] });
    } catch (error) {
      throw new UploadError('generation-failed', error.message, 500);
    }
    const [generated] = await readJson(manifest);
    const previewManifest = (await readJson(p.previewManifest, [])).filter((entry) => entry.id !== id);
    await writeAtomic(p.previewManifest, `${JSON.stringify([...previewManifest, generated], null, 2)}\n`);
    index[sha256] = { sourceFilename, id, bytes: bytes.length, uploadedAt: new Date().toISOString() };
    await writeAtomic(p.originalsIndex, `${JSON.stringify(index, null, 2)}\n`);
    return {
      duplicate: false,
      sha256,
      record: {
        id,
        slug: id,
        status: 'draft',
        sourceFilename,
        caption: '',
        alt: '',
        shape: generated.galleryWidth >= generated.galleryHeight ? 'landscape' : 'portrait',
        category: catalog.categories[0],
      },
      generated,
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
