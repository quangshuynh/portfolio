// One-off migration (Interval 1): converts src/data/photographs.overrides.mjs into
// src/data/photography.catalog.json. Every existing photograph becomes "published", array
// order is kept, and manual EXIF corrections move under "metadata". Writes nothing if the
// result would not reproduce the overrides exactly.
import { isDeepStrictEqual } from 'node:util';
import { writeFile } from 'node:fs/promises';
import {
  EXIF_CAPTURE_TIMEZONE,
  PHOTOGRAPHY_CATEGORIES,
  PHOTOGRAPHY_HERO_SLUG,
  photographOverrides,
} from '../src/data/photographs.overrides.mjs';
import { assertValidCatalog, publicPhotographs, serializeCatalog } from './photography-catalog.mjs';
import { DEFAULT_CATALOG_PATH } from './photography-catalog-files.mjs';
import { PUBLIC_METADATA_FIELDS } from './photography-utils.mjs';

export function migrateOverrides() {
  const photographs = photographOverrides.map(({ curatedOrder, ...override }) => {
    const record = { status: 'published' };
    const metadata = {};
    for (const [key, value] of Object.entries(override)) {
      if (PUBLIC_METADATA_FIELDS.includes(key)) metadata[key] = value;
      else record[key] = value;
    }
    return Object.keys(metadata).length ? { ...record, metadata } : record;
  });
  const hero = photographOverrides.find(({ slug }) => slug === PHOTOGRAPHY_HERO_SLUG);
  const catalog = assertValidCatalog({
    schemaVersion: 1,
    captureTimeZone: EXIF_CAPTURE_TIMEZONE,
    hero: hero.id,
    categories: [...PHOTOGRAPHY_CATEGORIES],
    photographs,
  });
  if (!isDeepStrictEqual(publicPhotographs(catalog), photographOverrides.map((override) => ({ ...override })))) {
    throw new Error('Migration would change the public photographs; nothing written.');
  }
  return catalog;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/').replace(/^\//, '')}`) {
  const text = serializeCatalog(migrateOverrides());
  await writeFile(DEFAULT_CATALOG_PATH, text, 'utf8');
  console.log(`Wrote ${DEFAULT_CATALOG_PATH}`);
}
