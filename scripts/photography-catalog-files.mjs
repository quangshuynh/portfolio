// File access for the photography catalog (Node only). PHOTOGRAPHY_CATALOG points the
// build and tools at another catalog file, which tests use to prove drafts stay private.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeGenerated, parseCatalog, publicPhotographs } from './photography-catalog.mjs';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_CATALOG_PATH = path.join(projectRoot, 'src', 'data', 'photography.catalog.json');
export const GENERATED_MANIFEST_PATH = path.join(projectRoot, 'src', 'data', 'photographs.generated.json');
export const DERIVATIVES_DIRECTORY = path.join(projectRoot, 'src', 'assets', 'photography', 'generated');

export function catalogPath() {
  return process.env.PHOTOGRAPHY_CATALOG ? path.resolve(process.env.PHOTOGRAPHY_CATALOG) : DEFAULT_CATALOG_PATH;
}

export async function readCatalog(file = catalogPath()) {
  try {
    return parseCatalog(await readFile(file, 'utf8'));
  } catch (error) {
    error.message = `${path.relative(projectRoot, file)}: ${error.message}`;
    throw error;
  }
}

export async function readGeneratedManifest(file = GENERATED_MANIFEST_PATH) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function listDerivatives(directory = DERIVATIVES_DIRECTORY) {
  return (await readdir(directory)).sort();
}

/**
 * Everything public about the photography collection, read from disk: the published
 * photographs merged with their generated metadata, and the generated records for
 * exactly those photographs. Drafts never appear in the result.
 */
export async function loadPublicCollection(file = catalogPath()) {
  const catalog = await readCatalog(file);
  const photographs = publicPhotographs(catalog);
  const publishedIds = new Set(photographs.map(({ id }) => id));
  const generated = (await readGeneratedManifest()).filter(({ id }) => publishedIds.has(id));
  return {
    captureTimeZone: catalog.captureTimeZone,
    categories: catalog.categories,
    heroSlug: photographs.find(({ id }) => id === catalog.hero).slug,
    photographs,
    generated,
    merged: mergeGenerated(photographs, generated),
  };
}
