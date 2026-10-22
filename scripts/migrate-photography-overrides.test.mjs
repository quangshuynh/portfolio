// @vitest-environment node
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { photographOverrides } from '../src/data/photographs.overrides.mjs';
import { publicPhotographs, serializeCatalog } from './photography-catalog.mjs';
import { DEFAULT_CATALOG_PATH } from './photography-catalog-files.mjs';
import { migrateOverrides } from './migrate-photography-overrides.mjs';

test('the committed catalog is exactly the migration of the overrides', () => {
  expect(readFileSync(DEFAULT_CATALOG_PATH, 'utf8')).toBe(serializeCatalog(migrateOverrides()));
});

test('the catalog reproduces every override field, order and curated number', () => {
  const catalog = JSON.parse(readFileSync(DEFAULT_CATALOG_PATH, 'utf8'));
  expect(isDeepStrictEqual(publicPhotographs(catalog), photographOverrides.map((override) => ({ ...override })))).toBe(true);
});
