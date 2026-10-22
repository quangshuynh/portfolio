// @vitest-environment node
import {
  CatalogError,
  assetReport,
  catalogErrors,
  mergeGenerated,
  parseCatalog,
  publicPhotographs,
  serializeCatalog,
} from './photography-catalog.mjs';

const record = (id, overrides = {}) => ({
  id,
  slug: id,
  status: 'published',
  sourceFilename: `${id}.JPG`,
  caption: `Caption ${id}`,
  alt: `Alt text for ${id}`,
  shape: 'landscape',
  category: 'Places',
  ...overrides,
});

const fixture = (photographs = [record('a', { featured: 1 }), record('b'), record('c', { featured: 2 })]) => ({
  schemaVersion: 1,
  captureTimeZone: 'America/New_York',
  hero: 'a',
  categories: ['Places', 'Nature'],
  photographs,
});

const generatedFor = (id) => ({
  id,
  sourceFilename: `${id}.JPG`,
  galleryFilename: `${id}-gallery.jpg`,
  viewerFilename: `${id}-viewer.jpg`,
  galleryWidth: 900,
  galleryHeight: 600,
  viewerWidth: 2200,
  viewerHeight: 1467,
  camera: 'ILCE-7M3',
  lens: 'Extracted lens',
});

describe('parsing and validation', () => {
  test('accepts a valid catalog', () => {
    expect(catalogErrors(fixture())).toEqual([]);
    expect(parseCatalog(JSON.stringify(fixture()))).toEqual(fixture());
  });

  test('rejects malformed JSON and unsupported versions without partial results', () => {
    expect(() => parseCatalog('{"schemaVersion": 1,')).toThrow(CatalogError);
    expect(() => parseCatalog('{"schemaVersion": 1,')).toThrow(/Not valid JSON/);
    expect(catalogErrors({ ...fixture(), schemaVersion: 2 })).toEqual([
      'Unsupported schemaVersion 2; this build reads version 1.',
    ]);
    expect(catalogErrors([])).toEqual(['The catalog must be a JSON object.']);
  });

  test('reports duplicate IDs, slugs and sources with both positions', () => {
    const errors = catalogErrors(fixture([
      record('a', { featured: 1 }),
      record('a', { slug: 'b', sourceFilename: 'A.jpg' }),
    ]));
    expect(errors).toContain('photographs[1] ("a"): duplicate id "a" (also photographs[0] ("a")).');
    expect(errors).toContain('photographs[1] ("a"): duplicate sourceFilename "A.jpg" (also photographs[0] ("a")).');
  });

  test('reports invalid metadata with the record and field', () => {
    const errors = catalogErrors(fixture([
      record('a', { featured: 1, shape: 'square', category: 'Cars', tags: ['Night', 'Night'], captoin: 'typo' }),
      record('b', { caption: ' padded ', alt: '', slug: '../b', metadata: { gps: 1, lens: {} } }),
      { id: 'c' },
    ]));
    expect(errors).toEqual(expect.arrayContaining([
      'photographs[0] ("a"): unknown field "captoin".',
      'photographs[0] ("a"): "shape" must be one of landscape, portrait.',
      'photographs[0] ("a"): unknown category "Cars"; declare it in "categories" first.',
      'photographs[0] ("a"): "tags" must be a non-empty list of distinct text values (omit it for none).',
      'photographs[1] ("b"): "slug" must contain only letters, digits, "_" and "-".',
      'photographs[1] ("b"): "caption" must be non-empty text without surrounding spaces.',
      'photographs[1] ("b"): "alt" must be non-empty text without surrounding spaces.',
      'photographs[1] ("b"): unknown metadata field "gps".',
      'photographs[1] ("b"): metadata "lens" must be text, a number, or null to hide the extracted value.',
      'photographs[2] ("c"): missing required field "status".',
    ]));
  });

  test('reports conflicting and gapped featured ordering', () => {
    expect(catalogErrors(fixture([record('a', { featured: 1 }), record('b', { featured: 1 }), record('c', { featured: 3 })])))
      .toEqual([
        'featured 1 is used by more than one photograph: a, b.',
        'featured ordinals must run 1..3 without gaps; missing 2.',
      ]);
  });

  test('keeps drafts out of the hero and the featured selection', () => {
    const errors = catalogErrors(fixture([record('a', { status: 'draft', featured: 1 })]));
    expect(errors).toEqual([
      'photographs[0] ("a"): a draft cannot be featured; remove "featured" or publish it.',
      '"hero" "a" is a draft; the hero must be published.',
    ]);
  });

  test('rejects unknown top-level fields and time zones', () => {
    expect(catalogErrors({ ...fixture(), captureTimeZone: 'Mars/Olympus', extra: true })).toEqual([
      'Unknown top-level field "extra".',
      '"captureTimeZone" "Mars/Olympus" is not a known time zone.',
    ]);
  });
});

describe('publication filtering and ordering', () => {
  const catalog = fixture([
    record('a', { featured: 1 }),
    record('secret', { status: 'draft', caption: 'Unreleased caption' }),
    record('b', { metadata: { lens: 'Corrected lens', camera: null } }),
  ]);

  test('public photographs exclude drafts and number curated order among published only', () => {
    const photographs = publicPhotographs(catalog);
    expect(photographs.map(({ id, curatedOrder }) => [id, curatedOrder])).toEqual([['a', 1], ['b', 2]]);
    expect(JSON.stringify(photographs)).not.toMatch(/secret|Unreleased|status/);
  });

  test('metadata overrides replace extracted values and null hides them', () => {
    const [, b] = mergeGenerated(publicPhotographs(catalog), [generatedFor('a'), generatedFor('b')]);
    expect(b.lens).toBe('Corrected lens');
    expect(b).not.toHaveProperty('camera');
  });

  test('reordering the list reorders the collection', () => {
    const reversed = { ...catalog, photographs: [...catalog.photographs].reverse() };
    expect(publicPhotographs(reversed).map(({ id }) => id)).toEqual(['b', 'a']);
  });
});

describe('canonical serialization', () => {
  test('is stable, key-ordered and round-trips', () => {
    const shuffled = { photographs: [{ category: 'Places', ...record('a', { featured: 1 }) }], categories: ['Places'], hero: 'a', captureTimeZone: 'America/New_York', schemaVersion: 1 };
    const text = serializeCatalog(shuffled);
    expect(text.endsWith('}\n')).toBe(true);
    expect(Object.keys(JSON.parse(text))).toEqual(['schemaVersion', 'captureTimeZone', 'hero', 'categories', 'photographs']);
    expect(Object.keys(JSON.parse(text).photographs[0])).toEqual(['id', 'slug', 'status', 'sourceFilename', 'caption', 'alt', 'shape', 'category', 'featured']);
    expect(serializeCatalog(parseCatalog(text))).toBe(text);
  });
});

describe('asset report', () => {
  const files = ['a-gallery.jpg', 'a-viewer.jpg', 'b-gallery.jpg', 'b-viewer.jpg', 'old-viewer.jpg', 'legacy-480w.webp'];

  test('passes when every published photograph has metadata and derivatives, and lists orphans', () => {
    const catalog = fixture([record('a', { featured: 1 }), record('b')]);
    expect(assetReport(catalog, [generatedFor('a'), generatedFor('b')], files)).toEqual({ errors: [], orphans: ['old-viewer.jpg'] });
  });

  test('reports missing assets and stale metadata', () => {
    const catalog = fixture([record('a', { featured: 1 }), record('b'), record('c')]);
    const { errors } = assetReport(catalog, [generatedFor('a'), { ...generatedFor('b'), sourceFilename: 'other.JPG' }, generatedFor('ghost')], files.slice(1));
    expect(errors).toEqual([
      '"b": generated from "other.JPG" but the catalog names "b.JPG"; regenerate it.',
      'photographs.generated.json has "ghost", which is not in the catalog.',
      'Published "a" is missing its derivative a-gallery.jpg.',
      'Published "c" has no generated metadata; run npm run prepare:photography -- --only c.',
    ]);
  });

  test('reports drafts that have public metadata or derivatives', () => {
    const catalog = fixture([record('a', { featured: 1 }), record('b', { status: 'draft' })]);
    const { errors } = assetReport(catalog, [generatedFor('a'), generatedFor('b')], files);
    expect(errors).toEqual([
      'Draft "b" has generated public metadata; drafts must not be generated until published.',
      'Draft "b" has a public derivative b-gallery.jpg; delete it until the photograph is published.',
      'Draft "b" has a public derivative b-viewer.jpg; delete it until the photograph is published.',
    ]);
  });
});
