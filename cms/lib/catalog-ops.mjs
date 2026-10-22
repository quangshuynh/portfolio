// Catalog edits for the photography CMS. Pure functions over the Interval 1 catalog
// object (schema in docs/photography-catalog.md): each returns a new catalog and never
// mutates its input. The admin UI applies them for immediate feedback and the local
// server re-checks the result with the same validator, so rules live in one place.
import { catalogErrors, publishedRecords } from '../../scripts/photography-catalog.mjs';

export class CatalogEditError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CatalogEditError';
  }
}

const OPTIONAL_FIELDS = ['tags', 'featured', 'metadata'];
// Fields that make up a published photograph's identity and public URLs.
const STABLE_FIELDS = ['id', 'slug', 'sourceFilename'];

function indexOf(catalog, id) {
  const index = catalog.photographs.findIndex((record) => record.id === id);
  if (index < 0) throw new CatalogEditError(`No photograph "${id}".`);
  return index;
}

const withPhotographs = (catalog, photographs) => ({ ...catalog, photographs });

// Optional fields are omitted rather than empty, which is what the validator expects.
function tidy(record) {
  const next = { ...record };
  for (const key of OPTIONAL_FIELDS) {
    const value = next[key];
    if (value === undefined || value === null || value === ''
      || (Array.isArray(value) && !value.length)
      || (key === 'metadata' && typeof value === 'object' && !Object.keys(value).length)) delete next[key];
  }
  return next;
}

/** IDs of photographs that are published in `base`, whose identity must not change. */
export function publishedIds(base) {
  return new Set(base ? publishedRecords(base).map(({ id }) => id) : []);
}

/**
 * Edits that would break a published photograph's URLs or derivatives.
 * :param base: catalog the workspace started from (the public catalog)
 * :param catalog: edited workspace catalog
 * :returns: error messages (empty when identities are intact)
 */
export function stableIdentityErrors(base, catalog) {
  const errors = [];
  for (const original of base ? publishedRecords(base) : []) {
    const current = catalog.photographs.find(({ id }) => id === original.id);
    if (!current) continue;
    for (const key of STABLE_FIELDS.slice(1)) {
      if (current[key] !== original[key]) errors.push(`"${original.id}" is published, so its ${key} cannot change (was "${original[key]}").`);
    }
  }
  return errors;
}

export function addDraft(catalog, record, { index = catalog.photographs.length } = {}) {
  if (catalog.photographs.some(({ id }) => id === record.id)) throw new CatalogEditError(`A photograph "${record.id}" already exists.`);
  const photographs = [...catalog.photographs];
  photographs.splice(index, 0, tidy({ ...record, status: 'draft' }));
  return withPhotographs(catalog, photographs);
}

/**
 * Applies field changes to one photograph. `null`, empty strings and empty lists remove
 * optional fields. A published photograph keeps its id, slug and source file.
 */
export function updatePhotograph(catalog, id, patch, { base } = {}) {
  const index = indexOf(catalog, id);
  const locked = publishedIds(base).has(id) ? STABLE_FIELDS : ['id'];
  for (const key of locked) {
    if (key in patch && patch[key] !== catalog.photographs[index][key]) {
      throw new CatalogEditError(`"${id}" ${locked.length > 1 ? 'has been published, so its' : 'has a fixed'} ${key} cannot change.`);
    }
  }
  if ('status' in patch || 'featured' in patch) throw new CatalogEditError('Use setStatus or setFeatured for status and featured changes.');
  const photographs = [...catalog.photographs];
  photographs[index] = tidy({ ...photographs[index], ...patch });
  return withPhotographs(catalog, photographs);
}

/** Moves a photograph to a position in the curated order (clamped to the list). */
export function movePhotograph(catalog, id, toIndex) {
  const from = indexOf(catalog, id);
  const target = Math.max(0, Math.min(catalog.photographs.length - 1, toIndex));
  if (from === target) return catalog;
  const photographs = [...catalog.photographs];
  const [record] = photographs.splice(from, 1);
  photographs.splice(target, 0, record);
  return withPhotographs(catalog, photographs);
}

export const movePhotographBy = (catalog, id, delta) => movePhotograph(catalog, id, indexOf(catalog, id) + delta);

/** Renumbers featured ordinals 1..n in their current order, keeping the validator's rule. */
function compactFeatured(photographs) {
  const featured = photographs.filter((record) => Number.isInteger(record.featured)).sort((a, b) => a.featured - b.featured);
  const ordinal = new Map(featured.map((record, i) => [record.id, i + 1]));
  return photographs.map((record) => (ordinal.has(record.id) ? { ...record, featured: ordinal.get(record.id) } : record));
}

/**
 * Puts a published photograph at a position in the Featured selection (1-based), or
 * removes it with `null`. Other featured photographs shift so ordinals stay 1..n.
 */
export function setFeatured(catalog, id, position) {
  const index = indexOf(catalog, id);
  const record = catalog.photographs[index];
  if (position !== null && record.status !== 'published') throw new CatalogEditError(`Publish "${id}" before featuring it.`);
  const others = catalog.photographs
    .filter((item) => item.id !== id && Number.isInteger(item.featured))
    .sort((a, b) => a.featured - b.featured)
    .map(({ id: otherId }) => otherId);
  if (position !== null) others.splice(Math.max(0, Math.min(others.length, position - 1)), 0, id);
  const ordinal = new Map(others.map((otherId, i) => [otherId, i + 1]));
  return withPhotographs(catalog, catalog.photographs.map((item) => {
    const { featured, ...rest } = item;
    return ordinal.has(item.id) ? { ...rest, featured: ordinal.get(item.id) } : rest;
  }));
}

export function setHero(catalog, id) {
  const record = catalog.photographs[indexOf(catalog, id)];
  if (record.status !== 'published') throw new CatalogEditError(`The hero must be published; "${id}" is a draft.`);
  return { ...catalog, hero: id };
}

/** Publishes or unpublishes photographs. Unpublishing drops them from Featured. */
export function setStatus(catalog, ids, status) {
  if (!['published', 'draft'].includes(status)) throw new CatalogEditError(`Unknown status "${status}".`);
  const targets = new Set(ids);
  for (const id of targets) indexOf(catalog, id);
  if (status === 'draft' && targets.has(catalog.hero)) {
    throw new CatalogEditError(`"${catalog.hero}" is the hero; choose another hero before unpublishing it.`);
  }
  const photographs = catalog.photographs.map((record) => {
    if (!targets.has(record.id)) return record;
    const { featured, ...rest } = record;
    return status === 'draft' ? { ...rest, status } : { ...record, status };
  });
  return withPhotographs(catalog, compactFeatured(photographs));
}

/** Removes drafts from the workspace. Published photographs must be unpublished first. */
export function removeDrafts(catalog, ids) {
  const targets = new Set(ids);
  for (const id of targets) {
    if (catalog.photographs[indexOf(catalog, id)].status !== 'draft') throw new CatalogEditError(`Unpublish "${id}" before removing it.`);
  }
  return withPhotographs(catalog, catalog.photographs.filter(({ id }) => !targets.has(id)));
}

export function setCollection(catalog, ids, category) {
  if (!catalog.categories.includes(category)) throw new CatalogEditError(`Unknown collection "${category}".`);
  const targets = new Set(ids);
  for (const id of targets) indexOf(catalog, id);
  return withPhotographs(catalog, catalog.photographs.map((record) => (targets.has(record.id) ? { ...record, category } : record)));
}

const cleanName = (name) => String(name ?? '').trim();

export function addCollection(catalog, name) {
  const value = cleanName(name);
  if (!value) throw new CatalogEditError('A collection needs a name.');
  if (catalog.categories.some((category) => category.toLowerCase() === value.toLowerCase())) throw new CatalogEditError(`Collection "${value}" already exists.`);
  return { ...catalog, categories: [...catalog.categories, value] };
}

/** Renames a collection everywhere. Its public filter label changes on publication. */
export function renameCollection(catalog, from, to) {
  const value = cleanName(to);
  if (!catalog.categories.includes(from)) throw new CatalogEditError(`Unknown collection "${from}".`);
  if (!value) throw new CatalogEditError('A collection needs a name.');
  if (value !== from && catalog.categories.some((category) => category.toLowerCase() === value.toLowerCase())) {
    throw new CatalogEditError(`Collection "${value}" already exists.`);
  }
  return {
    ...catalog,
    categories: catalog.categories.map((category) => (category === from ? value : category)),
    photographs: catalog.photographs.map((record) => (record.category === from ? { ...record, category: value } : record)),
  };
}

export function moveCollection(catalog, name, toIndex) {
  const from = catalog.categories.indexOf(name);
  if (from < 0) throw new CatalogEditError(`Unknown collection "${name}".`);
  const categories = [...catalog.categories];
  categories.splice(from, 1);
  categories.splice(Math.max(0, Math.min(categories.length, toIndex)), 0, name);
  return { ...catalog, categories };
}

export function removeCollection(catalog, name) {
  if (!catalog.categories.includes(name)) throw new CatalogEditError(`Unknown collection "${name}".`);
  const used = catalog.photographs.filter((record) => record.category === name).length;
  if (used) throw new CatalogEditError(`Move the ${used} photograph${used === 1 ? '' : 's'} out of "${name}" before removing it.`);
  if (catalog.categories.length === 1) throw new CatalogEditError('The catalog needs at least one collection.');
  return { ...catalog, categories: catalog.categories.filter((category) => category !== name) };
}

/** The catalog that publication writes to the public repository: drafts removed entirely. */
export function publicationCatalog(catalog) {
  return withPhotographs(catalog, publishedRecords(catalog));
}

/**
 * Problems in a workspace, split by whether they block publication.
 * :returns: { publication: [...], drafts: { [id]: [...] } }
 */
export function workspaceProblems(catalog, { base } = {}) {
  const publication = [...catalogErrors(publicationCatalog(catalog)), ...stableIdentityErrors(base, catalog)];
  const draftIds = new Set(catalog.photographs.filter(({ status }) => status === 'draft').map(({ id }) => id));
  const drafts = {};
  for (const error of catalogErrors(catalog)) {
    const id = error.match(/^photographs\[\d+\] \("([^"]+)"\)/)?.[1];
    if (id && draftIds.has(id)) (drafts[id] ??= []).push(error.replace(/^photographs\[\d+\] \("[^"]+"\): /, ''));
  }
  return { publication, drafts };
}

/** A safe, unused photograph id derived from an uploaded file name. */
export function idFromFilename(filename, existingIds) {
  const stem = String(filename).split(/[\\/]/).pop().replace(/\.[^.]*$/, '').normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'photograph';
  const taken = new Set([...existingIds].map((id) => id.toLowerCase()));
  let id = stem;
  for (let n = 2; taken.has(id.toLowerCase()); n += 1) id = `${stem}-${n}`;
  return id;
}
