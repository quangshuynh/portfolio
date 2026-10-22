// @vitest-environment node
// Runs the real image pipeline on synthetic originals in a temporary folder.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { assetReport, serializeCatalog } from './photography-catalog.mjs';
import { projectRoot } from './photography-catalog-files.mjs';

const run = promisify(execFile);
const script = path.join(projectRoot, 'scripts', 'prepare-photography.mjs');
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

const record = (id, overrides) => ({
  id, slug: id, status: 'published', sourceFilename: `${id}.jpg`, caption: id, alt: `Alt ${id}`,
  shape: 'landscape', category: 'Places', ...overrides,
});

let dir;
let paths;
const prepare = (...extra) => run(process.execPath, [script,
  '--catalog', paths.catalog, '--source-dir', paths.sources, '--output-dir', paths.output, '--manifest', paths.manifest, ...extra]);

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'prepare-photography-'));
  paths = {
    catalog: path.join(dir, 'catalog.json'),
    sources: path.join(dir, 'originals'),
    output: path.join(dir, 'generated'),
    manifest: path.join(dir, 'generated.json'),
  };
  mkdirSync(paths.sources);
  for (const id of ['published-one', 'draft-one']) {
    await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 40, g: 90, b: 140 } } })
      .withExif({ IFD0: { Make: 'SONY', Model: 'ILCE-7M3' }, IFD2: { DateTimeOriginal: '2026:10:17 16:00:00' } })
      .jpeg({ quality: 90 })
      .toFile(path.join(paths.sources, `${id}.jpg`));
  }
  writeFileSync(paths.catalog, serializeCatalog({
    schemaVersion: 1,
    captureTimeZone: 'America/New_York',
    hero: 'published-one',
    categories: ['Places'],
    photographs: [record('published-one', { featured: 1 }), record('draft-one', { status: 'draft' })],
  }));
}, 60_000);

afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

test('generates published photographs only, leaves originals untouched, and is deterministic', async () => {
  const originals = readdirSync(paths.sources).map((name) => [name, sha256(path.join(paths.sources, name))]);

  await prepare();
  const files = readdirSync(paths.output).sort();
  expect(files).toEqual(['published-one-gallery.jpg', 'published-one-viewer.jpg']);
  const manifestText = readFileSync(paths.manifest, 'utf8');
  const manifest = JSON.parse(manifestText);
  expect(manifest).toEqual([expect.objectContaining({
    id: 'published-one',
    sourceFilename: 'published-one.jpg',
    galleryWidth: 900,
    galleryHeight: 600,
    viewerWidth: 2200,
    viewerHeight: 1467,
    camera: 'SONY ILCE-7M3',
    capturedAt: '2026-10-17T20:00:00.000Z',
  })]);
  const catalog = JSON.parse(readFileSync(paths.catalog, 'utf8'));
  expect(assetReport(catalog, manifest, files).errors).toEqual([]);
  const viewer = await sharp(path.join(paths.output, 'published-one-viewer.jpg')).metadata();
  expect(viewer.exif).toBeUndefined();

  const firstBytes = files.map((name) => sha256(path.join(paths.output, name)));
  await prepare();
  expect(readFileSync(paths.manifest, 'utf8')).toBe(manifestText);
  expect(files.map((name) => sha256(path.join(paths.output, name)))).toEqual(firstBytes);

  expect(readdirSync(paths.sources).map((name) => [name, sha256(path.join(paths.sources, name))])).toEqual(originals);
}, 60_000);

test('refuses to generate a draft', async () => {
  await expect(prepare('--only', 'draft-one')).rejects.toMatchObject({
    stderr: expect.stringContaining('--only names draft "draft-one"; set its status to "published" first.'),
  });
}, 60_000);

test('refuses a malformed catalog before touching any file', async () => {
  const broken = path.join(dir, 'broken.json');
  writeFileSync(broken, JSON.stringify({ schemaVersion: 1, captureTimeZone: 'America/New_York', hero: 'x', categories: ['Places'], photographs: [record('x', { shape: 'round' })] }));
  const before = readdirSync(paths.output).map((name) => sha256(path.join(paths.output, name)));
  await expect(run(process.execPath, [script, '--catalog', broken, '--source-dir', paths.sources, '--output-dir', paths.output, '--manifest', paths.manifest]))
    .rejects.toMatchObject({ stderr: expect.stringContaining('"shape" must be one of landscape, portrait.') });
  expect(readdirSync(paths.output).map((name) => sha256(path.join(paths.output, name)))).toEqual(before);
}, 60_000);
