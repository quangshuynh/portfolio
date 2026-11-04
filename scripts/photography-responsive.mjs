// A build-time intermediate width between the 900 px gallery and 2200 px viewer derivatives.
// With only those two, any frame needing more than 900 device pixels (a retina archive frame,
// the desktop hero, a phone's full-width featured frame) fetched the 2200 px file, about four
// times the bytes. The 1600 px file is resized from the viewer derivative (never enlarged),
// so it carries the same treatment and watermark, needs no change to the CMS publication,
// and is cached by content hash so unchanged photographs are not re-encoded.
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export const MEDIUM_DERIVATIVE = Object.freeze({ width: 1600, height: 1600, quality: 84 });
// No medium file when the viewer derivative is barely larger: the saving would be small.
const MIN_VIEWER_RATIO = 1.15;
const CONCURRENCY = 4;

export function needsMedium({ viewerWidth, viewerHeight }) {
  return Math.max(viewerWidth, viewerHeight) >= MEDIUM_DERIVATIVE.width * MIN_VIEWER_RATIO;
}

const settings = `${MEDIUM_DERIVATIVE.width}x${MEDIUM_DERIVATIVE.height}q${MEDIUM_DERIVATIVE.quality}-v1`;

/**
 * Writes (or reuses) each photograph's medium derivative in `cacheDir`.
 * :param records: generated records ({ id, viewerFilename, viewerWidth, viewerHeight })
 * :param derivativesDir: folder holding the viewer derivatives
 * :returns: Map id -> { file, width, height }
 */
export async function ensureMediumDerivatives(records, derivativesDir, cacheDir) {
  await mkdir(cacheDir, { recursive: true });
  const existing = new Set(await readdir(cacheDir));
  const wanted = new Set();
  const result = new Map();
  const queue = records.filter(needsMedium);
  const work = async (record) => {
    const source = path.join(derivativesDir, record.viewerFilename);
    // Buffers, not paths, so sharp keeps no handle open on Windows (the files are replaced and removed).
    const bytes = await readFile(source);
    const hash = createHash('sha256').update(settings).update(bytes).digest('hex').slice(0, 12);
    const name = `${record.id}-medium-${hash}.jpg`;
    const file = path.join(cacheDir, name);
    wanted.add(name);
    if (!existing.has(name) || !(await stat(file)).size) {
      await sharp(bytes)
        .resize({ width: MEDIUM_DERIVATIVE.width, height: MEDIUM_DERIVATIVE.height, fit: 'inside', withoutEnlargement: true, kernel: 'lanczos3' })
        .jpeg({ quality: MEDIUM_DERIVATIVE.quality, mozjpeg: true })
        .toFile(file);
    }
    const { width, height, exif, xmp, iptc } = await sharp(await readFile(file)).metadata();
    if (exif || xmp || iptc) throw new Error(`Metadata survived in ${name}.`);
    result.set(record.id, { file, width, height });
  };
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) await work(queue.shift());
  });
  await Promise.all(workers);
  // Cached files of photographs since changed or unpublished.
  await Promise.all([...existing].filter((name) => name.endsWith('.jpg') && !wanted.has(name)).map((name) => rm(path.join(cacheDir, name), { force: true })));
  return result;
}
