import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import exifr from 'exifr';
import sharp from 'sharp';
import { EXIF_CAPTURE_TIMEZONE, photographOverrides } from '../src/data/photographs.overrides.mjs';
import { derivativeFilenames, normalizeCamera, parseExifTimestamp } from './photography-utils.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicSourcePath = path.join(projectRoot, 'src', 'assets', 'about', 'photography');
const outputDirectory = path.join(projectRoot, 'src', 'assets', 'photography', 'generated');
const manifestPath = path.join(projectRoot, 'src', 'data', 'photographs.generated.json');

function readArguments() {
  const args = process.argv.slice(2);
  const sourceIndex = args.indexOf('--source-dir');
  const sourceValue = sourceIndex >= 0 ? args[sourceIndex + 1] : process.env.PHOTOGRAPHY_ORIGINALS_DIR;
  if (!sourceValue) throw new Error('Provide --source-dir <path> or set PHOTOGRAPHY_ORIGINALS_DIR.');
  if (sourceIndex >= 0 && !sourceValue) throw new Error('--source-dir requires a path.');
  return { sourceDirectory: path.resolve(sourceValue), allowPublicSource: args.includes('--allow-public-source') };
}

function validateDeclarations() {
  const ids = new Set();
  const filenames = new Set();
  for (const record of photographOverrides) {
    const normalizedFilename = record.sourceFilename.toLowerCase();
    if (ids.has(record.id)) throw new Error(`Duplicate photography ID: ${record.id}`);
    if (filenames.has(normalizedFilename)) throw new Error(`Duplicate source filename: ${record.sourceFilename}`);
    ids.add(record.id);
    filenames.add(normalizedFilename);
    derivativeFilenames(record.id);
  }
}

function finiteNumber(value, precision = 6) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(precision)) : null;
}

function normalizeExif(exif) {
  const capturedAt = parseExifTimestamp(
    exif?.DateTimeOriginal ?? exif?.CreateDate,
    exif?.OffsetTimeOriginal ?? exif?.OffsetTime,
    EXIF_CAPTURE_TIMEZONE,
  );
  const values = {
    capturedAt,
    camera: normalizeCamera(exif?.Make, exif?.Model),
    lens: exif?.LensModel ? String(exif.LensModel).trim() : null,
    focalLength: finiteNumber(exif?.FocalLength, 3),
    aperture: finiteNumber(exif?.FNumber, 2),
    shutterSpeed: finiteNumber(exif?.ExposureTime, 8),
    iso: finiteNumber(exif?.ISO, 0),
  };
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null && value !== ''));
}

async function extractExif(sourcePath) {
  try {
    return await exifr.parse(sourcePath, {
      pick: ['DateTimeOriginal', 'CreateDate', 'OffsetTimeOriginal', 'OffsetTime', 'Make', 'Model', 'LensModel', 'FocalLength', 'FNumber', 'ExposureTime', 'ISO', 'Orientation'],
      reviveValues: false,
    }) ?? {};
  } catch (error) {
    throw new Error(`EXIF parsing failed for ${path.basename(sourcePath)}: ${error.message}`);
  }
}

async function hasGps(sourcePath) {
  try {
    const gps = await exifr.gps(sourcePath);
    return Number.isFinite(gps?.latitude) && Number.isFinite(gps?.longitude);
  } catch (error) {
    throw new Error(`GPS parsing failed for ${path.basename(sourcePath)}: ${error.message}`);
  }
}

async function createDerivative(sourcePath, destination, dimensions, quality) {
  await sharp(sourcePath)
    .rotate()
    .resize({ ...dimensions, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toFile(destination);
  const metadata = await sharp(destination).metadata();
  if (metadata.exif || metadata.xmp || metadata.iptc) throw new Error(`Metadata was not stripped from ${path.basename(destination)}`);
  return { width: metadata.width, height: metadata.height, bytes: (await stat(destination)).size };
}

async function main() {
  const { sourceDirectory, allowPublicSource } = readArguments();
  if (sourceDirectory === publicSourcePath && !allowPublicSource) {
    throw new Error('The production asset directory cannot be used as an originals source without --allow-public-source.');
  }
  validateDeclarations();
  const availableFiles = await readdir(sourceDirectory);
  const caseInsensitiveFiles = new Map();
  for (const filename of availableFiles) {
    const key = filename.toLowerCase();
    if (caseInsensitiveFiles.has(key)) throw new Error(`Duplicate source filenames differ only by case: ${filename}`);
    caseInsensitiveFiles.set(key, filename);
  }
  for (const { sourceFilename } of photographOverrides) {
    if (!availableFiles.includes(sourceFilename)) throw new Error(`Declared source original not found: ${sourceFilename}`);
  }

  await mkdir(outputDirectory, { recursive: true });
  const generated = [];
  const audit = [];
  for (const override of photographOverrides) {
    const sourcePath = path.join(sourceDirectory, override.sourceFilename);
    const sourceMetadata = await sharp(sourcePath).metadata();
    const exif = await extractExif(sourcePath);
    const gpsPresent = await hasGps(sourcePath);
    const { galleryFilename, viewerFilename } = derivativeFilenames(override.id);
    const gallery = await createDerivative(sourcePath, path.join(outputDirectory, galleryFilename), { width: 900, height: 1200 }, 82);
    const viewer = await createDerivative(sourcePath, path.join(outputDirectory, viewerFilename), { width: 2200, height: 1800 }, 88);
    const publicMetadata = normalizeExif(exif);
    generated.push({
      id: override.id,
      sourceFilename: override.sourceFilename,
      galleryFilename,
      viewerFilename,
      galleryWidth: gallery.width,
      galleryHeight: gallery.height,
      viewerWidth: viewer.width,
      viewerHeight: viewer.height,
      ...publicMetadata,
    });
    audit.push({
      id: override.id,
      sourceFilename: override.sourceFilename,
      originalWidth: sourceMetadata.autoOrient?.width ?? sourceMetadata.width,
      originalHeight: sourceMetadata.autoOrient?.height ?? sourceMetadata.height,
      originalBytes: (await stat(sourcePath)).size,
      gallery,
      viewer,
      extractedFields: Object.keys(publicMetadata),
      gpsPresent,
    });
  }

  const serialized = `${JSON.stringify(generated, null, 2)}\n`;
  if (/latitude|longitude|coordinates/i.test(serialized)) throw new Error('Coordinate-like fields cannot be written to public metadata.');
  await writeFile(manifestPath, serialized, 'utf8');
  console.log(JSON.stringify({ outputDirectory, manifestPath, audit }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
