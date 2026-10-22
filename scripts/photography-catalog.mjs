// The photography catalog: one machine-writable JSON document holding every photograph
// (published and draft), its public copy, category, tags and curated order. This module
// is pure (no file access), so the site build, the image pipeline, tests and a future CMS
// share one definition of a valid catalog. Schema: docs/photography-catalog.md.
import { derivativeFilenames, mergePhotographyMetadata, PUBLIC_METADATA_FIELDS } from './photography-utils.mjs';

export const CATALOG_SCHEMA_VERSION = 1;
export const PHOTOGRAPH_STATUSES = Object.freeze(['published', 'draft']);
export const PHOTOGRAPH_SHAPES = Object.freeze(['landscape', 'portrait']);

const CATALOG_KEYS = ['schemaVersion', 'captureTimeZone', 'hero', 'categories', 'photographs'];
// Also the serialization order, so a CMS rewrite produces a minimal diff.
const RECORD_KEYS = ['id', 'slug', 'status', 'sourceFilename', 'caption', 'alt', 'shape', 'category', 'tags', 'featured', 'metadata'];
const REQUIRED_RECORD_KEYS = ['id', 'slug', 'status', 'sourceFilename', 'caption', 'alt', 'shape', 'category'];
const SAFE_NAME = /^[A-Za-z0-9_-]+$/;

export class CatalogError extends Error {
  constructor(errors) {
    super(`Photography catalog is invalid:\n${errors.map((error) => `  - ${error}`).join('\n')}`);
    this.name = 'CatalogError';
    this.errors = errors;
  }
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '' && value === value.trim();
const label = (record, index) => `photographs[${index}]${isText(record?.id) ? ` ("${record.id}")` : ''}`;

function validateRecord(record, index, categories, errors) {
  const at = label(record, index);
  if (!isPlainObject(record)) {
    errors.push(`${at}: must be an object.`);
    return;
  }
  for (const key of Object.keys(record)) {
    if (!RECORD_KEYS.includes(key)) errors.push(`${at}: unknown field "${key}".`);
  }
  for (const key of REQUIRED_RECORD_KEYS) {
    if (!(key in record)) errors.push(`${at}: missing required field "${key}".`);
  }
  for (const key of ['id', 'slug']) {
    if (key in record && !(typeof record[key] === 'string' && SAFE_NAME.test(record[key]))) {
      errors.push(`${at}: "${key}" must contain only letters, digits, "_" and "-".`);
    }
  }
  if ('status' in record && !PHOTOGRAPH_STATUSES.includes(record.status)) {
    errors.push(`${at}: "status" must be one of ${PHOTOGRAPH_STATUSES.join(', ')}.`);
  }
  if ('sourceFilename' in record && !(isText(record.sourceFilename) && !/[\\/]/.test(record.sourceFilename))) {
    errors.push(`${at}: "sourceFilename" must be a file name without directories.`);
  }
  for (const key of ['caption', 'alt']) {
    if (key in record && !isText(record[key])) errors.push(`${at}: "${key}" must be non-empty text without surrounding spaces.`);
  }
  if ('shape' in record && !PHOTOGRAPH_SHAPES.includes(record.shape)) {
    errors.push(`${at}: "shape" must be one of ${PHOTOGRAPH_SHAPES.join(', ')}.`);
  }
  if ('category' in record && !categories.includes(record.category)) {
    errors.push(`${at}: unknown category "${record.category}"; declare it in "categories" first.`);
  }
  if ('tags' in record) {
    const tags = record.tags;
    if (!Array.isArray(tags) || !tags.length || !tags.every(isText) || new Set(tags).size !== tags.length) {
      errors.push(`${at}: "tags" must be a non-empty list of distinct text values (omit it for none).`);
    }
  }
  if ('featured' in record) {
    if (!Number.isInteger(record.featured) || record.featured < 1) errors.push(`${at}: "featured" must be a positive whole number.`);
    else if (record.status === 'draft') errors.push(`${at}: a draft cannot be featured; remove "featured" or publish it.`);
  }
  if ('metadata' in record) {
    if (!isPlainObject(record.metadata) || !Object.keys(record.metadata).length) {
      errors.push(`${at}: "metadata" must be an object with at least one field (omit it for none).`);
    } else {
      for (const [key, value] of Object.entries(record.metadata)) {
        if (!PUBLIC_METADATA_FIELDS.includes(key)) errors.push(`${at}: unknown metadata field "${key}".`);
        else if (!(value === null || isText(value) || (typeof value === 'number' && Number.isFinite(value)))) {
          errors.push(`${at}: metadata "${key}" must be text, a number, or null to hide the extracted value.`);
        }
      }
    }
  }
}

function findDuplicates(records, key, normalize = (value) => value) {
  const seen = new Map();
  const errors = [];
  records.forEach((record, index) => {
    if (!isPlainObject(record) || typeof record[key] !== 'string') return;
    const value = normalize(record[key]);
    if (seen.has(value)) errors.push(`${label(record, index)}: duplicate ${key} "${record[key]}" (also ${label(records[seen.get(value)], seen.get(value))}).`);
    else seen.set(value, index);
  });
  return errors;
}

/**
 * Checks a parsed catalog and lists every problem found.
 * :param catalog: parsed catalog document
 * :returns: array of actionable error messages (empty when valid)
 */
export function catalogErrors(catalog) {
  const errors = [];
  if (!isPlainObject(catalog)) return ['The catalog must be a JSON object.'];
  if (catalog.schemaVersion !== CATALOG_SCHEMA_VERSION) {
    return [`Unsupported schemaVersion ${JSON.stringify(catalog.schemaVersion)}; this build reads version ${CATALOG_SCHEMA_VERSION}.`];
  }
  for (const key of Object.keys(catalog)) {
    if (!CATALOG_KEYS.includes(key)) errors.push(`Unknown top-level field "${key}".`);
  }
  if (!isText(catalog.captureTimeZone)) {
    errors.push('"captureTimeZone" must be an IANA time zone such as "America/New_York".');
  } else {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: catalog.captureTimeZone });
    } catch {
      errors.push(`"captureTimeZone" "${catalog.captureTimeZone}" is not a known time zone.`);
    }
  }
  const categories = catalog.categories;
  if (!Array.isArray(categories) || !categories.length || !categories.every(isText) || new Set(categories).size !== categories.length) {
    errors.push('"categories" must be a non-empty list of distinct names.');
  }
  const records = catalog.photographs;
  if (!Array.isArray(records)) return [...errors, '"photographs" must be a list.'];

  records.forEach((record, index) => validateRecord(record, index, Array.isArray(categories) ? categories : [], errors));
  errors.push(...findDuplicates(records, 'id'), ...findDuplicates(records, 'slug'));
  errors.push(...findDuplicates(records, 'sourceFilename', (value) => value.toLowerCase()));

  // Featured ordinals order the editorial selection, so published ones must run 1..n.
  const published = records.filter((record) => isPlainObject(record) && record.status === 'published');
  const ordinals = published.filter((record) => Number.isInteger(record.featured)).map((record) => record.featured);
  const repeated = [...new Set(ordinals.filter((ordinal, index) => ordinals.indexOf(ordinal) !== index))];
  for (const ordinal of repeated) {
    const ids = published.filter((record) => record.featured === ordinal).map((record) => record.id);
    errors.push(`featured ${ordinal} is used by more than one photograph: ${ids.join(', ')}.`);
  }
  const missingOrdinals = ordinals.length ? Array.from({ length: Math.max(...ordinals) }, (_, i) => i + 1).filter((n) => !ordinals.includes(n)) : [];
  if (missingOrdinals.length) errors.push(`featured ordinals must run 1..${ordinals.length} without gaps; missing ${missingOrdinals.join(', ')}.`);

  const hero = records.find((record) => isPlainObject(record) && record.id === catalog.hero);
  if (!hero) errors.push(`"hero" "${catalog.hero}" does not name a photograph in the catalog.`);
  else if (hero.status !== 'published') errors.push(`"hero" "${catalog.hero}" is a draft; the hero must be published.`);
  return errors;
}

/** Throws a CatalogError listing every problem, or returns the catalog unchanged. */
export function assertValidCatalog(catalog) {
  const errors = catalogErrors(catalog);
  if (errors.length) throw new CatalogError(errors);
  return catalog;
}

/** Parses catalog JSON text and validates it. */
export function parseCatalog(text) {
  let catalog;
  try {
    catalog = JSON.parse(text);
  } catch (error) {
    throw new CatalogError([`Not valid JSON: ${error.message}`]);
  }
  return assertValidCatalog(catalog);
}

/** Canonical text form: fixed key order, two-space indent, trailing newline. */
export function serializeCatalog(catalog) {
  const ordered = (object, keys) => Object.fromEntries(keys.filter((key) => key in object).map((key) => [key, object[key]]));
  return `${JSON.stringify({
    ...ordered(catalog, CATALOG_KEYS),
    photographs: catalog.photographs.map((record) => ordered(record, RECORD_KEYS)),
  }, null, 2)}\n`;
}

export function publishedRecords(catalog) {
  return catalog.photographs.filter(({ status }) => status === 'published');
}

/**
 * The public view of a catalog: published photographs only, in curated order, in the
 * shape the gallery has always used (metadata overrides flattened, `curatedOrder`
 * numbered among published photographs). Drafts contribute nothing.
 */
export function publicPhotographs(catalog) {
  return publishedRecords(catalog).map(({ status, metadata, ...record }, index) => ({
    ...record,
    ...metadata,
    curatedOrder: index + 1,
  }));
}

/** Merges each public photograph with its generated (EXIF and derivative) record. */
export function mergeGenerated(photographs, generatedRecords) {
  const generatedById = new Map(generatedRecords.map((record) => [record.id, record]));
  return photographs.map((photograph) => mergePhotographyMetadata(generatedById.get(photograph.id), photograph));
}

/**
 * Checks the catalog against the generated manifest and derivative files.
 * :param catalog: valid catalog
 * :param generatedRecords: parsed photographs.generated.json
 * :param derivativeFiles: names of the files in the derivatives folder
 * :returns: { errors, orphans } where orphans are derivative files no record uses
 */
export function assetReport(catalog, generatedRecords, derivativeFiles) {
  const errors = [];
  const byId = new Map(catalog.photographs.map((record) => [record.id, record]));
  const files = new Set(derivativeFiles);
  const generatedIds = new Set();
  for (const generated of generatedRecords) {
    const record = byId.get(generated.id);
    if (generatedIds.has(generated.id)) errors.push(`photographs.generated.json lists "${generated.id}" more than once.`);
    generatedIds.add(generated.id);
    if (!record) errors.push(`photographs.generated.json has "${generated.id}", which is not in the catalog.`);
    else if (record.status === 'draft') errors.push(`Draft "${generated.id}" has generated public metadata; drafts must not be generated until published.`);
    else if (generated.sourceFilename !== record.sourceFilename) {
      errors.push(`"${generated.id}": generated from "${generated.sourceFilename}" but the catalog names "${record.sourceFilename}"; regenerate it.`);
    }
  }
  const used = new Set();
  for (const record of catalog.photographs) {
    const names = derivativeFilenames(record.id);
    if (record.status === 'draft') {
      for (const name of Object.values(names)) {
        if (files.has(name)) errors.push(`Draft "${record.id}" has a public derivative ${name}; delete it until the photograph is published.`);
      }
      continue;
    }
    const generated = generatedRecords.find(({ id }) => id === record.id);
    if (!generated) {
      errors.push(`Published "${record.id}" has no generated metadata; run npm run prepare:photography -- --only ${record.id}.`);
      continue;
    }
    for (const [key, name] of Object.entries(names)) {
      if (generated[key] !== name) errors.push(`"${record.id}": ${key} should be ${name}.`);
      if (!files.has(name)) errors.push(`Published "${record.id}" is missing its derivative ${name}.`);
      used.add(name);
    }
    for (const key of ['galleryWidth', 'galleryHeight', 'viewerWidth', 'viewerHeight']) {
      if (!Number.isInteger(generated[key]) || generated[key] < 1) errors.push(`"${record.id}": generated ${key} must be a positive whole number.`);
    }
  }
  const orphans = derivativeFiles.filter((name) => name.endsWith('.jpg') && !used.has(name)).sort();
  return { errors, orphans };
}
