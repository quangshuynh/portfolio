// @vitest-environment node
// Checks the repository's own catalog, manifest and derivatives.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { assetReport, catalogErrors, serializeCatalog } from './photography-catalog.mjs';
import { DEFAULT_CATALOG_PATH, DERIVATIVES_DIRECTORY, GENERATED_MANIFEST_PATH, projectRoot } from './photography-catalog-files.mjs';
import { photographLibraryPaths } from './photography-sources.mjs';

const text = readFileSync(DEFAULT_CATALOG_PATH, 'utf8');
const catalog = JSON.parse(text);
const generated = JSON.parse(readFileSync(GENERATED_MANIFEST_PATH, 'utf8'));
const derivatives = readdirSync(DERIVATIVES_DIRECTORY).sort();

// Derivatives of earlier removals. They still ship (the folder is globbed) and are kept
// until the owner approves deleting them; see docs/photography-catalog.md.
const KNOWN_ORPHANS = [
  'bird-in-bare-branches-viewer.jpg', 'genesee-gorge-kodak-tower-viewer.jpg', 'gorge-cascade-viewer.jpg',
  'high-falls-rochester-viewer.jpg', 'impreza-through-the-fence-viewer.jpg', 'letchworth-gorge-wall-viewer.jpg',
  'letchworth-upper-falls-viewer.jpg', 'orange-domes-viewer.jpg', 'rochester-skyline-dusk-viewer.jpg',
  'rush-rhees-reading-room-viewer.jpg', 'shoreline-at-dusk-viewer.jpg', 'south-bristol-overlook-viewer.jpg',
  'steel-over-white-water-viewer.jpg', 'waterfall-spring-runoff-viewer.jpg',
];

test('the catalog is valid and in canonical form', () => {
  expect(catalogErrors(catalog)).toEqual([]);
  expect(text.replace(/\r\n/g, '\n')).toBe(serializeCatalog(catalog));
});

test('every published photograph has its metadata and derivatives, and drafts have none', () => {
  expect(assetReport(catalog, generated, derivatives).errors).toEqual([]);
});

test('camera-library sources are JPEG or PNG files of published photographs, never RAW originals', () => {
  const published = new Map(catalog.photographs.filter(({ status }) => status === 'published').map((record) => [record.id, record]));
  const manifest = new Map(generated.map((entry) => [entry.id, entry]));
  for (const [id, file] of Object.entries(photographLibraryPaths)) {
    expect(file, id).toMatch(/\.(jpe?g|png)$/i);
    expect(published.has(id), id).toBe(true);
    expect(path.posix.basename(file)).toBe(manifest.get(id).sourceFilename);
  }
});

test('the orphaned derivatives are preserved and accounted for', () => {
  expect(assetReport(catalog, generated, derivatives).orphans).toEqual(KNOWN_ORPHANS);
});

test('browser code reads the catalog only through the build-time public view', () => {
  const offenders = [];
  const walk = (directory) => readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(file);
    if (!/\.(jsx?|mjs)$/.test(entry.name) || /\.test\./.test(entry.name)) return undefined;
    if (/(from\s*|import\s*\(\s*)['"][^'"]*photography\.catalog\.json['"]/.test(readFileSync(file, 'utf8'))) {
      offenders.push(path.relative(projectRoot, file));
    }
    return undefined;
  });
  walk(path.join(projectRoot, 'src'));
  expect(offenders).toEqual([]);
});
