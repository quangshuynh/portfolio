// QuangEdit Recipes: portable, human-readable editing instructions in JSON that a person or an
// AI assistant can write, paste into the editor, review and apply. A recipe holds reusable
// settings only (the adjustment registry's own keys, ranges and defaults); everything that
// belongs to one photo stays out: sources, RAW development, HDR merges, crop and transform,
// layers, text, masks and local adjustments, and the grain pattern's seed.
//
// Format (version 1, independent of the edit document version):
//   { format: 'quangedit-recipe', version: 1, name, description?,
//     adjustments: { light?, color?, hsl?, detail?, toneCurve?, colorGrading?, creative? },
//     filter: { id, strength? } | null, lut: { name, sha256, intensity?, size?, title?, colorSpace? } | null }
// A group present in `adjustments` (even `{}`) is part of the recipe. Applying:
//   replace — each chosen group is set exactly: keys the recipe leaves out are neutral (with a
//     filter, the filter's values are the base of Creative and Color grading instead);
//   merge — only the keys the recipe states change; everything else of the photo stays.
// The filter always replaces the Creative and Color grading groups (as in the Filter Library),
// before the recipe's own Creative and Color grading values. A LUT is used only when a loaded
// .cube has exactly the recipe's SHA-256; recipes never embed LUT data.
//
// Parsing treats the text as untrusted: strict JSON, size, depth and entry limits, allowlisted
// fields only (unknown ones are errors naming the field), ranges checked, never evaluated.

import { ADJUSTMENTS, adjustmentSpec, clampAdjustment, formatAdjustment, normalizeAdjustments } from './adjustments.mjs';
import { BUILT_IN_FILTERS, filterPatch } from './filters.mjs';
import { PRESET_GROUPS, PRESET_PACK_TYPE, PRESET_TYPE, cleanPresetName, parsePreset, presetPatch } from './presets.mjs';
import { CURVE_CHANNELS, MAX_CURVE_POINTS, isNeutralCurve, neutralCurves } from '../pipeline/curves.mjs';
import { MAX_LUT_SIZE, MIN_LUT_SIZE } from '../pipeline/lut.mjs';

export const RECIPE_FORMAT = 'quangedit-recipe';
export const RECIPE_VERSION = 1;
export const MAX_RECIPE_BYTES = 64 * 1024;
export const MAX_RECIPE_DEPTH = 6;
export const MAX_RECIPE_ENTRIES = 1000;
export const MAX_RECIPE_DESCRIPTION = 280;
export const MAX_RECIPES = 200;
export const RECIPES_STORAGE_KEY = 'photo-editor:recipes:v1';
export const RECIPE_LIBRARY_FORMAT = 'quangedit-recipe-library';
export const RECIPE_MODES = Object.freeze(['replace', 'merge']);

const numericGroup = (id, label, test) => ({ id, label, keys: ADJUSTMENTS.filter((spec) => test(spec) && !spec.hidden).map(({ key }) => key) });

/** Recipe groups in canonical order. `adjustments` groups hold registry keys; filter and lut are top-level. */
export const RECIPE_GROUPS = Object.freeze([
  numericGroup('light', 'Light', ({ group }) => group === 'light'),
  numericGroup('color', 'Color', ({ group }) => group === 'color'),
  numericGroup('hsl', 'HSL', ({ group }) => group === 'hsl'),
  numericGroup('detail', 'Detail', ({ group }) => group === 'detail'),
  { id: 'toneCurve', label: 'Tone curve', keys: [], channels: CURVE_CHANNELS },
  numericGroup('colorGrading', 'Color grading', ({ group, section }) => group === 'creative' && section === 'grading'),
  numericGroup('creative', 'Creative effects', ({ group, section }) => group === 'creative' && section !== 'grading'),
  { id: 'filter', label: 'Filter', keys: [], topLevel: true },
  { id: 'lut', label: 'LUT', keys: [], topLevel: true },
].map((group) => Object.freeze({ ...group, keys: Object.freeze(group.keys) })));

const groupById = new Map(RECIPE_GROUPS.map((group) => [group.id, group]));
const ADJUSTMENT_GROUP_IDS = RECIPE_GROUPS.filter(({ topLevel }) => !topLevel).map(({ id }) => id);
const groupOfKey = new Map(RECIPE_GROUPS.flatMap(({ id, keys }) => keys.map((key) => [key, id])));
const FILTERS_BY_ID = new Map(BUILT_IN_FILTERS.map((filter) => [filter.id, filter]));
const TOP_LEVEL = new Set(['format', 'version', 'name', 'description', 'adjustments', 'filter', 'lut']);
const FILTER_FIELDS = new Set(['id', 'strength']);
const LUT_FIELDS = new Set(['name', 'title', 'sha256', 'intensity', 'size', 'colorSpace']);
const FILTER_BASED = new Set(['creative', 'colorGrading']);

/** Older recipe versions and how to bring them to the current one (none yet). */
const MIGRATIONS = new Map();

export class RecipeError extends Error {
  constructor(errors) {
    const list = Array.isArray(errors) ? errors : [errors];
    super(list[0]);
    this.errors = list;
  }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const quote = (text) => JSON.stringify(String(text).slice(0, 40));
const cleanText = (text, max) => String(text).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// Depth and entry count of plain JSON data, without recursion limits of its own.
function measure(data) {
  let entries = 0;
  let depth = 0;
  const stack = [[data, 1]];
  while (stack.length) {
    const [value, level] = stack.pop();
    if (value === null || typeof value !== 'object') continue;
    depth = Math.max(depth, level);
    const children = Array.isArray(value) ? value : Object.values(value);
    entries += children.length;
    if (entries > MAX_RECIPE_ENTRIES || depth > MAX_RECIPE_DEPTH) break;
    children.forEach((child) => stack.push([child, level + 1]));
  }
  return { entries, depth };
}

function readNumber(value, key, path, errors) {
  const spec = adjustmentSpec(key);
  if (typeof value !== 'number' || !Number.isFinite(value)) { errors.push(`${path} must be a number.`); return null; }
  if (value < spec.min || value > spec.max) { errors.push(`${path} must be between ${spec.min} and ${spec.max} (got ${value}).`); return null; }
  // The editor's own rule: values are rounded to the control's step.
  return clampAdjustment(key, value);
}

function readCurve(points, path, errors) {
  if (!Array.isArray(points) || points.length < 2 || points.length > MAX_CURVE_POINTS) {
    errors.push(`${path} must be a list of 2 to ${MAX_CURVE_POINTS} [x, y] points.`);
    return null;
  }
  const out = [];
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (!Array.isArray(point) || point.length !== 2 || !point.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) {
      errors.push(`${path}[${i}] must be [x, y] with whole numbers from 0 to 255.`);
      return null;
    }
    if (i > 0 && point[0] <= out[i - 1][0]) { errors.push(`${path}[${i}]: x values must increase from point to point.`); return null; }
    out.push([point[0], point[1]]);
  }
  return out;
}

function readGroup(id, input, errors) {
  const path = `adjustments.${id}`;
  if (!isObject(input)) { errors.push(`${path} must be an object.`); return null; }
  const group = groupById.get(id);
  const out = {};
  if (group.channels) {
    Object.keys(input).forEach((channel) => {
      if (!CURVE_CHANNELS.includes(channel)) { errors.push(`Unknown field ${path}.${channel}; tone curve channels are ${CURVE_CHANNELS.join(', ')}.`); return; }
      const curve = readCurve(input[channel], `${path}.${channel}`, errors);
      if (curve) out[channel] = curve;
    });
    return Object.fromEntries(CURVE_CHANNELS.filter((channel) => out[channel]).map((channel) => [channel, out[channel]]));
  }
  const allowed = new Set(group.keys);
  Object.keys(input).forEach((key) => {
    if (!allowed.has(key)) {
      const home = groupOfKey.get(key);
      errors.push(home ? `${path}.${key} belongs in adjustments.${home}.` : `Unknown field ${path}.${quote(key).slice(1, -1)}.`);
      return;
    }
    const value = readNumber(input[key], key, `${path}.${key}`, errors);
    if (value !== null) out[key] = value;
  });
  return Object.fromEntries(group.keys.filter((key) => Object.hasOwn(out, key)).map((key) => [key, out[key]]));
}

function readFilter(input, errors) {
  if (input === null || input === undefined) return null;
  if (!isObject(input)) { errors.push('filter must be an object { "id", "strength" } or null.'); return null; }
  Object.keys(input).forEach((key) => { if (!FILTER_FIELDS.has(key)) errors.push(`Unknown field filter.${quote(key).slice(1, -1)}.`); });
  if (typeof input.id !== 'string' || !FILTERS_BY_ID.has(input.id)) {
    errors.push(`filter.id${typeof input.id === 'string' ? ` ${quote(input.id)}` : ''} is not a built-in filter id; see the recipe reference for the list.`);
    return null;
  }
  let strength = 100;
  if (input.strength !== undefined) {
    if (!Number.isInteger(input.strength) || input.strength < 0 || input.strength > 100) { errors.push('filter.strength must be a whole number from 0 to 100.'); return null; }
    strength = input.strength;
  }
  return { id: input.id, strength };
}

function readLut(input, errors) {
  if (input === null || input === undefined) return null;
  if (!isObject(input)) { errors.push('lut must be an object { "name", "sha256", "intensity" } or null.'); return null; }
  const before = errors.length;
  Object.keys(input).forEach((key) => {
    if (!LUT_FIELDS.has(key)) errors.push(key === 'data' || key === 'path' || key === 'url'
      ? `lut.${key} is not supported: recipes reference a LUT by its SHA-256 and never embed, fetch or locate it.`
      : `Unknown field lut.${quote(key).slice(1, -1)}.`);
  });
  if (typeof input.sha256 !== 'string' || !/^[0-9a-fA-F]{64}$/.test(input.sha256)) errors.push('lut.sha256 must be the 64-character SHA-256 of the .cube file.');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 255) errors.push('lut.name must be the .cube file name (1–255 characters).');
  else if (/[\\/]|^[a-zA-Z]:/.test(input.name)) errors.push('lut.name must be a file name only, without folders or a drive.');
  if (input.title !== undefined && (typeof input.title !== 'string' || input.title.length > 120)) errors.push('lut.title must be text of up to 120 characters.');
  if (input.size !== undefined && (!Number.isInteger(input.size) || input.size < MIN_LUT_SIZE || input.size > MAX_LUT_SIZE)) errors.push(`lut.size must be a whole number from ${MIN_LUT_SIZE} to ${MAX_LUT_SIZE}.`);
  if (input.colorSpace !== undefined && input.colorSpace !== 'srgb') errors.push('lut.colorSpace must be "srgb": the editor feeds LUTs sRGB display values.');
  let intensity = 100;
  if (input.intensity !== undefined) {
    if (!Number.isInteger(input.intensity) || input.intensity < 0 || input.intensity > 100) errors.push('lut.intensity must be a whole number from 0 to 100.');
    else intensity = input.intensity;
  }
  if (errors.length > before) return null;
  return {
    name: cleanText(input.name, 255),
    ...(input.title ? { title: cleanText(input.title, 120) } : {}),
    sha256: input.sha256.toLowerCase(),
    intensity,
    ...(input.size !== undefined ? { size: input.size } : {}),
    colorSpace: 'srgb',
  };
}

/**
 * Validates a recipe object (already parsed JSON) and returns it in canonical form.
 * Throws RecipeError whose `errors` lists every problem found, each naming its field.
 */
export function validateRecipe(data) {
  if (!isObject(data)) throw new RecipeError('A recipe must be a JSON object.');
  const { entries, depth } = measure(data);
  if (depth > MAX_RECIPE_DEPTH) throw new RecipeError(`The recipe is nested more than ${MAX_RECIPE_DEPTH} levels deep.`);
  if (entries > MAX_RECIPE_ENTRIES) throw new RecipeError(`The recipe has more than ${MAX_RECIPE_ENTRIES} entries.`);
  if (data.format !== RECIPE_FORMAT) throw new RecipeError(`format must be "${RECIPE_FORMAT}".`);
  if (!Number.isInteger(data.version) || data.version < 1) throw new RecipeError('version must be a whole number (1).');
  let input = data;
  if (data.version > RECIPE_VERSION) throw new RecipeError(`This recipe is version ${data.version}; this editor reads version ${RECIPE_VERSION}. Update the editor or ask for a version ${RECIPE_VERSION} recipe.`);
  for (let version = data.version; version < RECIPE_VERSION; version += 1) {
    const migrate = MIGRATIONS.get(version);
    if (!migrate) throw new RecipeError(`Recipe version ${version} cannot be read.`);
    input = migrate(input);
  }

  const errors = [];
  Object.keys(input).forEach((key) => { if (!TOP_LEVEL.has(key)) errors.push(`Unknown field ${quote(key)} at the top level.`); });
  const name = typeof input.name === 'string' ? cleanPresetName(input.name) : '';
  if (!name) errors.push('name must be a short title (1–60 characters).');
  if (input.description !== undefined && typeof input.description !== 'string') errors.push('description must be text.');
  const description = typeof input.description === 'string' ? cleanText(input.description, MAX_RECIPE_DESCRIPTION) : '';

  const adjustments = {};
  if (input.adjustments !== undefined) {
    if (!isObject(input.adjustments)) errors.push('adjustments must be an object of groups.');
    else {
      Object.keys(input.adjustments).forEach((id) => {
        if (!ADJUSTMENT_GROUP_IDS.includes(id)) {
          const home = groupOfKey.get(id);
          errors.push(home ? `${id} must be inside adjustments.${home}.` : `Unknown group adjustments.${quote(id).slice(1, -1)}; groups are ${ADJUSTMENT_GROUP_IDS.join(', ')}.`);
          return;
        }
        const group = readGroup(id, input.adjustments[id], errors);
        if (group) adjustments[id] = group;
      });
    }
  }
  const filter = readFilter(input.filter, errors);
  const lut = readLut(input.lut, errors);
  if (!errors.length && !Object.keys(adjustments).length && !filter && !lut) errors.push('The recipe contains no settings: add adjustments, a filter or a LUT.');
  if (errors.length) throw new RecipeError(errors.slice(0, 12));

  return {
    format: RECIPE_FORMAT,
    version: RECIPE_VERSION,
    name,
    ...(description ? { description } : {}),
    adjustments: Object.fromEntries(ADJUSTMENT_GROUP_IDS.filter((id) => adjustments[id]).map((id) => [id, adjustments[id]])),
    filter,
    lut,
  };
}

/**
 * Parses recipe text (strict JSON). A photo editor preset file (single preset) is read as a
 * recipe too, so older presets can be pasted and reviewed the same way.
 */
export function parseRecipe(text) {
  if (typeof text !== 'string') throw new RecipeError('The recipe could not be read.');
  if (text.length > MAX_RECIPE_BYTES) throw new RecipeError(`The recipe is larger than ${MAX_RECIPE_BYTES / 1024} KB.`);
  const trimmed = text.trim();
  if (!trimmed) throw new RecipeError('Paste a recipe first.');
  let data;
  try {
    data = JSON.parse(trimmed);
  } catch (error) {
    // The engine's message names the position only (it never contains file paths).
    throw new RecipeError(`The recipe is not valid JSON: ${String(error.message).slice(0, 120)}`);
  }
  if (isObject(data) && data.type === 'quanghuynh.photo-editor.edits') throw new RecipeError('This is a saved edits file for whole photographs. Open it with Open edits; recipes hold reusable settings only.');
  if (isObject(data) && data.type === PRESET_TYPE) return recipeFromPreset(data.preset ?? data);
  if (isObject(data) && data.type === PRESET_PACK_TYPE) throw new RecipeError('This is a pack of presets. Import it under Presets; recipes are read one at a time.');
  return validateRecipe(data);
}

/** Reads a recipe File, refusing an oversized one before reading it. */
export async function readRecipeFile(file) {
  if (file.size > MAX_RECIPE_BYTES) throw new RecipeError(`The recipe file is larger than ${MAX_RECIPE_BYTES / 1024} KB.`);
  return parseRecipe(await file.text());
}

/** Canonical JSON: fixed field order, two-space indentation, curve points on one line. */
export function serializeRecipe(recipe) {
  const canonical = validateRecipe(recipe);
  const text = JSON.stringify(canonical, null, 2)
    .replace(/\[\s+(\d+),\s+(\d+)\s+\]/g, '[$1, $2]')
    .replace(/\[\s+(\[\d+, \d+\](?:,\s+\[\d+, \d+\])*)\s+\]/g, (match, points) => `[${points.replace(/,\s+/g, ', ')}]`);
  return `${text}\n`;
}

/** Ids of the groups a recipe contains, in canonical order. */
export const recipeGroups = (recipe) => RECIPE_GROUPS.map(({ id }) => id).filter((id) => (id === 'filter' || id === 'lut' ? Boolean(recipe[id]) : Boolean(recipe.adjustments?.[id])));

export const recipeGroupLabel = (id) => groupById.get(id)?.label ?? id;

/** Groups whose values differ from neutral in a photo's settings: the default Copy selection. */
export function changedRecipeGroups(adjustments) {
  const a = normalizeAdjustments(adjustments);
  return RECIPE_GROUPS.filter(({ id, keys }) => {
    if (id === 'filter') return Boolean(builtInFilterRef(a));
    if (id === 'lut') return Boolean(a.lut);
    if (id === 'toneCurve') return CURVE_CHANNELS.some((channel) => !isNeutralCurve(a.curves[channel]));
    return keys.some((key) => a[key] !== adjustmentSpec(key).default);
  }).map(({ id }) => id);
}

// The photo's filter record when it is a built-in filter whose values are unchanged.
function builtInFilterRef(a) {
  const filter = a.filter && FILTERS_BY_ID.get(a.filter.id);
  if (!filter) return null;
  const patch = filterPatch(filter, a.filter.strength);
  return Object.entries(patch).every(([key, value]) => key === 'filter' || a[key] === value) ? { id: filter.id, strength: a.filter.strength } : null;
}

/**
 * A recipe from a photo's settings (Copy Settings, Save as recipe).
 * :param options: { groups (recipe group ids), name, description }
 * Selected numeric groups list only the values that differ from neutral; in replace mode
 * that reproduces the group exactly.
 */
export function recipeFromAdjustments(adjustments, { groups = RECIPE_GROUPS.map(({ id }) => id), name = 'Copied settings', description = '' } = {}) {
  const a = normalizeAdjustments(adjustments);
  const chosen = new Set(groups);
  const out = {};
  RECIPE_GROUPS.forEach(({ id, keys }) => {
    if (!chosen.has(id) || id === 'filter' || id === 'lut') return;
    if (id === 'toneCurve') {
      out.toneCurve = Object.fromEntries(CURVE_CHANNELS.filter((channel) => !isNeutralCurve(a.curves[channel])).map((channel) => [channel, a.curves[channel].map(([x, y]) => [x, y])]));
      return;
    }
    out[id] = Object.fromEntries(keys.filter((key) => a[key] !== adjustmentSpec(key).default).map((key) => [key, a[key]]));
  });
  const filter = chosen.has('filter') ? builtInFilterRef(a) : null;
  const lut = chosen.has('lut') && a.lut
    ? { name: a.lut.name, ...(a.lut.title ? { title: a.lut.title } : {}), sha256: a.lut.sha256, intensity: a.lutIntensity, ...(a.lut.size ? { size: a.lut.size } : {}), colorSpace: 'srgb' }
    : null;
  return validateRecipe({ format: RECIPE_FORMAT, version: RECIPE_VERSION, name: cleanPresetName(name) || 'Copied settings', description, adjustments: out, filter, lut });
}

/**
 * A recipe with the same settings as an editor preset. Every key of the preset's groups is
 * listed (neutral ones too), so merge mode reproduces the preset exactly; replace mode also
 * resets the rest of a recipe group the preset only partly covers (Light = exposure + tone).
 */
export function recipeFromPreset(input) {
  let preset;
  try { preset = parsePreset(input); } catch (error) { throw new RecipeError(error.message); }
  const values = normalizeAdjustments(presetPatch(preset));
  const presetKeys = new Set(preset.groups.flatMap((id) => PRESET_GROUPS.find((group) => group.id === id).keys));
  const adjustments = {};
  RECIPE_GROUPS.forEach(({ id, keys }) => {
    if (id === 'toneCurve') {
      if (preset.groups.includes('curves')) adjustments.toneCurve = Object.fromEntries(CURVE_CHANNELS.map((channel) => [channel, values.curves[channel].map(([x, y]) => [x, y])]));
      return;
    }
    const owned = keys.filter((key) => presetKeys.has(key));
    if (owned.length) adjustments[id] = Object.fromEntries(owned.map((key) => [key, values[key]]));
  });
  const lut = preset.groups.includes('lut') && values.lut
    ? { name: values.lut.name, ...(values.lut.title ? { title: values.lut.title } : {}), sha256: values.lut.sha256, intensity: values.lutIntensity, ...(values.lut.size ? { size: values.lut.size } : {}) }
    : null;
  return validateRecipe({ format: RECIPE_FORMAT, version: RECIPE_VERSION, name: preset.name, description: preset.description ?? '', adjustments, filter: null, lut });
}

/**
 * LUT and filter resources a recipe needs that this session cannot provide.
 * :param hasLut: (sha256) => boolean, true when that exact .cube is loaded
 * :returns: { lut: the recipe's LUT reference when it is not loaded, else null }
 */
export const recipeResources = (recipe, { hasLut = () => false } = {}) => ({ lut: recipe.lut && !hasLut(recipe.lut.sha256) ? recipe.lut : null });

/**
 * Applies chosen groups of a validated recipe to a photo's settings. Pure: returns new settings;
 * geometry, layers, local adjustments, RAW and HDR settings and the grain seed are untouched.
 * :param options: { groups (default: all the recipe has), mode: 'replace' | 'merge', lut: loaded
 *   LUT { sha256, name, title, size } matching recipe.lut (required to apply the LUT group) }
 */
export function applyRecipe(adjustments, recipe, { groups = recipeGroups(recipe), mode = 'replace', lut = null } = {}) {
  if (!RECIPE_MODES.includes(mode)) throw new RecipeError(`Unknown mode "${mode}".`);
  const current = normalizeAdjustments(adjustments);
  const chosen = new Set(recipeGroups(recipe).filter((id) => groups.includes(id)));
  const patch = {};
  const filter = chosen.has('filter') ? FILTERS_BY_ID.get(recipe.filter.id) : null;
  const base = filter ? filterPatch(filter, recipe.filter.strength) : null;
  if (base) Object.assign(patch, base);
  RECIPE_GROUPS.forEach(({ id, keys }) => {
    if (!chosen.has(id) || id === 'filter' || id === 'lut') return;
    const values = recipe.adjustments[id];
    if (id === 'toneCurve') {
      const neutral = neutralCurves();
      patch.curves = Object.fromEntries(CURVE_CHANNELS.map((channel) => [channel, values[channel] ?? (mode === 'replace' ? neutral[channel] : current.curves[channel])]));
      return;
    }
    keys.forEach((key) => {
      if (Object.hasOwn(values, key)) patch[key] = values[key];
      else if (mode === 'replace') patch[key] = base && FILTER_BASED.has(id) ? base[key] : adjustmentSpec(key).default;
    });
  });
  // Creative replaced without a filter: its values are the recipe's own, not a filter's.
  if (!filter && chosen.has('creative') && mode === 'replace') patch.filter = null;
  if (chosen.has('lut')) {
    if (!lut || lut.sha256 !== recipe.lut.sha256) throw new RecipeError(`The LUT "${recipe.lut.title || recipe.lut.name}" is not loaded.`);
    patch.lut = { sha256: lut.sha256, name: lut.name, title: lut.title ?? '', size: lut.size ?? null };
    patch.lutIntensity = recipe.lut.intensity;
  }
  return normalizeAdjustments({ ...current, ...patch });
}

/**
 * The individual settings that differ between two settings objects, for the review list.
 * :returns: [{ group, label, from, to }] with display strings
 */
export function recipeChanges(before, after) {
  const a = normalizeAdjustments(before);
  const b = normalizeAdjustments(after);
  const out = [];
  RECIPE_GROUPS.forEach(({ id, keys }) => {
    keys.forEach((key) => {
      if (a[key] !== b[key]) out.push({ group: id, label: adjustmentSpec(key).label, from: formatAdjustment(key, a[key]), to: formatAdjustment(key, b[key]) });
    });
    if (id === 'toneCurve') {
      CURVE_CHANNELS.forEach((channel) => {
        if (JSON.stringify(a.curves[channel]) !== JSON.stringify(b.curves[channel])) {
          out.push({ group: id, label: `${channel[0].toUpperCase()}${channel.slice(1)} curve`, from: `${a.curves[channel].length} points`, to: `${b.curves[channel].length} points` });
        }
      });
    }
    if (id === 'filter' && (a.filter?.id !== b.filter?.id || a.filter?.strength !== b.filter?.strength)) {
      const show = (ref) => (ref ? `${FILTERS_BY_ID.get(ref.id)?.name ?? ref.id} ${ref.strength}%` : 'none');
      out.push({ group: id, label: 'Filter', from: show(a.filter), to: show(b.filter) });
    }
    if (id === 'lut') {
      if (a.lut?.sha256 !== b.lut?.sha256) out.push({ group: id, label: 'LUT', from: a.lut ? a.lut.title || a.lut.name : 'none', to: b.lut ? b.lut.title || b.lut.name : 'none' });
      if (a.lutIntensity !== b.lutIntensity) out.push({ group: id, label: 'LUT intensity', from: `${a.lutIntensity}%`, to: `${b.lutIntensity}%` });
    }
  });
  return out;
}

// Saved recipes: kept in this browser as a library document, validated on every read.

export function serializeRecipeLibrary(recipes) {
  const canonical = recipes.map((recipe) => validateRecipe(recipe));
  return `${JSON.stringify({ format: RECIPE_LIBRARY_FORMAT, version: RECIPE_VERSION, recipes: canonical })}\n`;
}

/** Reads a stored library; recipes that no longer validate are left out rather than failing the rest. */
export function parseRecipeLibrary(text) {
  let data;
  try { data = JSON.parse(text); } catch { return []; }
  if (!isObject(data) || data.format !== RECIPE_LIBRARY_FORMAT || !Array.isArray(data.recipes)) return [];
  return data.recipes.slice(0, MAX_RECIPES).flatMap((recipe) => {
    try { return [validateRecipe(recipe)]; } catch { return []; }
  });
}

/**
 * Recipes from an imported file: one recipe, or a whole library exported from another editor
 * (for example the public editor's library brought into the CMS editor, which runs on another
 * origin and so never shares browser storage with it). A library is read strictly: every recipe
 * must validate, or nothing is imported and each problem is listed. Libraries hold recipes
 * only (no photos, file names or edit documents).
 */
export async function readRecipeImport(file) {
  if (file.size > MAX_RECIPE_BYTES * MAX_RECIPES) throw new RecipeError(`The file is larger than ${(MAX_RECIPE_BYTES * MAX_RECIPES) / 1024 / 1024} MB.`);
  const text = await file.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* parseRecipe reports it */ }
  if (!isObject(data) || data.format !== RECIPE_LIBRARY_FORMAT) {
    if (file.size > MAX_RECIPE_BYTES) throw new RecipeError(`The recipe file is larger than ${MAX_RECIPE_BYTES / 1024} KB.`);
    return [parseRecipe(text)];
  }
  if (data.version !== RECIPE_VERSION || !Array.isArray(data.recipes)) throw new RecipeError(`This is not a version ${RECIPE_VERSION} recipe library.`);
  if (!data.recipes.length) throw new RecipeError('The recipe library is empty.');
  if (data.recipes.length > MAX_RECIPES) throw new RecipeError(`The library has more than ${MAX_RECIPES} recipes.`);
  const errors = [];
  const recipes = data.recipes.map((recipe, index) => {
    try { return validateRecipe(recipe); } catch (error) {
      errors.push(`Recipe ${index + 1}: ${error instanceof RecipeError ? error.errors[0] : error.message}`);
      return null;
    }
  });
  if (errors.length) throw new RecipeError(errors);
  return recipes;
}

/** A file name for an exported library of recipes. */
export const recipeLibraryFileName = () => 'quangedit-recipes.quangedit-recipes.json';

/** A file name for an exported recipe: the name in lowercase words. */
export const recipeFileName = (recipe) => `${(recipe.name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'recipe').slice(0, 60)}.quangedit-recipe.json`;
