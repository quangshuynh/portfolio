// The public gallery's image derivatives: sizes, quality and the metadata-stripping check.
// Shared by prepare-photography.mjs and the CMS (rendered QuangEdit treatments), so every
// public image comes from the same code.
import { stat } from 'node:fs/promises';
import sharp from 'sharp';

export const DERIVATIVE_SIZES = Object.freeze({
  gallery: Object.freeze({ dimensions: { width: 900, height: 1200 }, quality: 82 }),
  viewer: Object.freeze({ dimensions: { width: 2200, height: 1800 }, quality: 88 }),
});

/** Auto-oriented, never enlarged, mozjpeg; fails if any metadata survived. */
export async function createDerivative(sourcePath, destination, dimensions, quality) {
  await sharp(sourcePath)
    .rotate()
    .resize({ ...dimensions, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toFile(destination);
  const metadata = await sharp(destination).metadata();
  if (metadata.exif || metadata.xmp || metadata.iptc) throw new Error(`Metadata was not stripped from ${destination.split(/[\/]/).pop()}`);
  return { width: metadata.width, height: metadata.height, bytes: (await stat(destination)).size };
}
