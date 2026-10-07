import { access, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import exifr from 'exifr';
import sharp from 'sharp';
import { EXIF_CAPTURE_TIMEZONE, photographOverrides as publicOverrides } from '../src/data/photographs.overrides.mjs';
import { photographLibraryPaths } from './photography-sources.mjs';
import { derivativeFilenames, normalizeCamera, parseExifTimestamp } from './photography-utils.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicSourcePath = path.join(projectRoot, 'src', 'assets', 'about', 'photography');
const outputDirectory = path.join(projectRoot, 'src', 'assets', 'photography', 'generated');
const manifestPath = path.join(projectRoot, 'src', 'data', 'photographs.generated.json');
const photographOverrides = publicOverrides.map((record) => (
  photographLibraryPaths[record.id] ? { ...record, libraryPath: photographLibraryPaths[record.id] } : record
));

function readOption(args, name, envName) {
  const index = args.indexOf(name);
  if (index >= 0 && !args[index + 1]) throw new Error(`${name} requires a value.`);
  return index >= 0 ? args[index + 1] : envName && process.env[envName];
}

// --source-dir is the flat originals folder; --library-dir is the read-only camera library
// that records with a `libraryPath` are read from. --only regenerates a subset and leaves
// every other derivative and manifest entry untouched.
function readArguments() {
  const args = process.argv.slice(2);
  const sourceValue = readOption(args, '--source-dir', 'PHOTOGRAPHY_ORIGINALS_DIR');
  const libraryValue = readOption(args, '--library-dir', 'PHOTOGRAPHY_LIBRARY_DIR');
  const onlyValue = readOption(args, '--only');
  return {
    sourceDirectory: sourceValue ? path.resolve(sourceValue) : null,
    libraryDirectory: libraryValue ? path.resolve(libraryValue) : null,
    only: onlyValue ? new Set(onlyValue.split(',').map((id) => id.trim()).filter(Boolean)) : null,
    allowPublicSource: args.includes('--allow-public-source'),
  };
}

function sourceKey(record) {
  return (record.libraryPath ?? record.sourceFilename).split(path.sep).join('/').toLowerCase();
}

function validateDeclarations() {
  const ids = new Set();
  const sources = new Set();
  for (const id of Object.keys(photographLibraryPaths)) {
    if (!publicOverrides.some((record) => record.id === id)) throw new Error(`Library path declared for unknown photograph: ${id}`);
  }
  for (const record of photographOverrides) {
    const key = sourceKey(record);
    if (ids.has(record.id)) throw new Error(`Duplicate photography ID: ${record.id}`);
    if (sources.has(key)) throw new Error(`Duplicate source: ${record.libraryPath ?? record.sourceFilename}`);
    if (record.libraryPath && path.posix.basename(record.libraryPath) !== record.sourceFilename) {
      throw new Error(`libraryPath and sourceFilename disagree for ${record.id}.`);
    }
    ids.add(record.id);
    sources.add(key);
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

async function resolveSources(records, { sourceDirectory, libraryDirectory }) {
  let flatFiles = null;
  if (records.some((record) => !record.libraryPath)) {
    if (!sourceDirectory) throw new Error('Provide --source-dir <path> or set PHOTOGRAPHY_ORIGINALS_DIR.');
    flatFiles = await readdir(sourceDirectory);
    const caseInsensitiveFiles = new Set();
    for (const filename of flatFiles) {
      const key = filename.toLowerCase();
      if (caseInsensitiveFiles.has(key)) throw new Error(`Duplicate source filenames differ only by case: ${filename}`);
      caseInsensitiveFiles.add(key);
    }
  }
  if (records.some((record) => record.libraryPath) && !libraryDirectory) {
    throw new Error('Provide --library-dir <path> or set PHOTOGRAPHY_LIBRARY_DIR.');
  }

  const resolved = new Map();
  for (const record of records) {
    if (record.libraryPath) {
      const sourcePath = path.resolve(libraryDirectory, record.libraryPath);
      if (!sourcePath.startsWith(`${libraryDirectory}${path.sep}`)) throw new Error(`libraryPath escapes the library: ${record.id}`);
      try {
        await access(sourcePath);
      } catch {
        throw new Error(`Declared library original not found: ${record.libraryPath}`);
      }
      resolved.set(record.id, sourcePath);
    } else {
      if (!flatFiles.includes(record.sourceFilename)) throw new Error(`Declared source original not found: ${record.sourceFilename}`);
      resolved.set(record.id, path.join(sourceDirectory, record.sourceFilename));
    }
  }
  return resolved;
}

async function readExistingManifest() {
  try {
    return JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function main() {
  const options = readArguments();
  if (options.sourceDirectory === publicSourcePath && !options.allowPublicSource) {
    throw new Error('The production asset directory cannot be used as an originals source without --allow-public-source.');
  }
  validateDeclarations();
  for (const id of options.only ?? []) {
    if (!photographOverrides.some((record) => record.id === id)) throw new Error(`--only names an undeclared photograph: ${id}`);
  }
  const selected = photographOverrides.filter(({ id }) => !options.only || options.only.has(id));
  const sources = await resolveSources(selected, options);

  await mkdir(outputDirectory, { recursive: true });
  const generatedById = new Map((await readExistingManifest()).map((record) => [record.id, record]));
  const audit = [];
  for (const override of selected) {
    const sourcePath = sources.get(override.id);
    const sourceMetadata = await sharp(sourcePath).metadata();
    const exif = await extractExif(sourcePath);
    const gpsPresent = await hasGps(sourcePath);
    const { galleryFilename, viewerFilename } = derivativeFilenames(override.id);
    const gallery = await createDerivative(sourcePath, path.join(outputDirectory, galleryFilename), { width: 900, height: 1200 }, 82);
    const viewer = await createDerivative(sourcePath, path.join(outputDirectory, viewerFilename), { width: 2200, height: 1800 }, 88);
    const publicMetadata = normalizeExif(exif);
    generatedById.set(override.id, {
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

  const missing = photographOverrides.filter(({ id }) => !generatedById.has(id));
  if (missing.length) throw new Error(`No generated metadata for: ${missing.map(({ id }) => id).join(', ')}`);
  const generated = photographOverrides.map(({ id }) => generatedById.get(id));
  const serialized = `${JSON.stringify(generated, null, 2)}\n`;
  if (/latitude|longitude|coordinates/i.test(serialized)) throw new Error('Coordinate-like fields cannot be written to public metadata.');
  await writeFile(manifestPath, serialized, 'utf8');
  console.log(JSON.stringify({ outputDirectory, manifestPath, audit }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
