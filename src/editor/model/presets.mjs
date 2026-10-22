// Presets: named, portable subsets of a photo's settings. A preset lists the groups
// it contains; applying it sets each of those groups exactly to the preset's values
// (anything the preset leaves out of a group is neutral) and leaves every other group
// of the photo as it was. Built-in presets are ordinary presets defined here and run
// through the same engine. Files are strict JSON with schema checks; nothing in them
// is executed.

import { ADJUSTMENTS, HSL_RANGES, compactAdjustments, hslKey, normalizeAdjustments } from './adjustments.mjs';

export const PRESET_TYPE = 'quanghuynh.photo-editor.preset';
export const PRESET_PACK_TYPE = 'quanghuynh.photo-editor.presets';
export const PRESET_VERSION = 1;
export const MAX_PRESETS = 200;
export const MAX_PRESET_FILE_BYTES = 1024 * 1024;
export const MAX_PRESET_NAME = 60;
export const PRESETS_STORAGE_KEY = 'photo-editor:presets:v1';

const HSL_KEYS = ADJUSTMENTS.filter(({ group }) => group === 'hsl').map(({ key }) => key);

/** Preset groups. Exposure and white balance are usually per-photo corrections, so they are separate. */
export const PRESET_GROUPS = Object.freeze([
  { id: 'exposure', label: 'Exposure', keys: ['exposure'] },
  { id: 'whiteBalance', label: 'White balance', keys: ['temperature', 'tint'] },
  { id: 'tone', label: 'Tone', keys: ['contrast', 'highlights', 'shadows', 'whites', 'blacks'] },
  { id: 'presence', label: 'Vibrance and saturation', keys: ['vibrance', 'saturation'] },
  { id: 'hsl', label: 'HSL', keys: HSL_KEYS },
  { id: 'curves', label: 'Tone curve', keys: [], structured: 'curves' },
  { id: 'lut', label: 'LUT', keys: ['lutIntensity'], structured: 'lut' },
].map(Object.freeze));
const groupById = new Map(PRESET_GROUPS.map((group) => [group.id, group]));

export class PresetError extends Error {}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function cleanPresetName(name) {
  return String(name ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_PRESET_NAME);
}

/** Groups in which these settings differ from neutral: the default selection when saving. */
export function changedPresetGroups(adjustments) {
  const a = normalizeAdjustments(adjustments);
  const neutral = normalizeAdjustments({});
  return PRESET_GROUPS.filter((group) => {
    if (group.structured === 'lut') return Boolean(a.lut);
    if (group.structured === 'curves') return JSON.stringify(a.curves) !== JSON.stringify(neutral.curves);
    return group.keys.some((key) => a[key] !== neutral[key]);
  }).map(({ id }) => id);
}

/** The settings of the given groups, in compact form. */
function groupSettings(adjustments, groups) {
  const compact = compactAdjustments(adjustments);
  const settings = {};
  groups.forEach((id) => {
    const group = groupById.get(id);
    group.keys.forEach((key) => { if (Object.hasOwn(compact, key)) settings[key] = compact[key]; });
    if (group.structured && compact[group.structured]) settings[group.structured] = compact[group.structured];
  });
  return settings;
}

/**
 * Creates a preset from a photo's settings.
 * :param groups: preset group ids to include (at least one)
 */
export function createPreset(name, adjustments, groups) {
  const cleanName = cleanPresetName(name);
  if (!cleanName) throw new PresetError('Give the preset a name.');
  const included = PRESET_GROUPS.map(({ id }) => id).filter((id) => groups.includes(id));
  if (!included.length) throw new PresetError('Choose at least one group of settings to include.');
  return { name: cleanName, groups: included, settings: groupSettings(adjustments, included) };
}

/**
 * The settings patch a preset applies: every key of each included group, from the
 * preset or neutral. Merge it over a photo's settings.
 */
export function presetPatch(preset) {
  const values = normalizeAdjustments(preset.settings);
  const patch = {};
  preset.groups.forEach((id) => {
    const group = groupById.get(id);
    group.keys.forEach((key) => { patch[key] = values[key]; });
    if (group.structured) patch[group.structured] = values[group.structured];
  });
  return patch;
}

export const applyPreset = (adjustments, preset) => normalizeAdjustments({ ...adjustments, ...presetPatch(preset) });

/** Validates one preset object from a file or storage; throws PresetError. */
export function parsePreset(input, index = 0) {
  const label = `Preset ${index + 1}`;
  if (!isObject(input)) throw new PresetError(`${label} is not an object.`);
  const name = cleanPresetName(input.name);
  if (!name) throw new PresetError(`${label} has no name.`);
  if (!Array.isArray(input.groups) || !input.groups.length) throw new PresetError(`"${name}" lists no groups of settings.`);
  const unknown = input.groups.filter((id) => !groupById.has(id));
  if (unknown.length) throw new PresetError(`"${name}" has unknown groups: ${unknown.slice(0, 3).join(', ')}.`);
  const groups = PRESET_GROUPS.map(({ id }) => id).filter((id) => input.groups.includes(id));
  const settings = isObject(input.settings) ? input.settings : {};
  const numeric = Object.fromEntries(Object.entries(settings).filter(([, value]) => typeof value === 'number' && Number.isFinite(value)));
  const values = normalizeAdjustments({ ...numeric, curves: settings.curves, lut: settings.lut });
  return { name, groups, settings: groupSettings(values, groups) };
}

/** Reads a preset file: a single preset or a pack. Returns validated presets. */
export function parsePresetFile(text) {
  if (typeof text !== 'string') throw new PresetError('The preset file could not be read.');
  if (text.length > MAX_PRESET_FILE_BYTES) throw new PresetError('The preset file is larger than 1 MB.');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new PresetError('The preset file is not valid JSON.');
  }
  if (!isObject(data) || ![PRESET_TYPE, PRESET_PACK_TYPE].includes(data.type)) throw new PresetError('This is not a photo editor preset file.');
  if (!Number.isInteger(data.version) || data.version < 1) throw new PresetError('The preset file has no valid version.');
  if (data.version > PRESET_VERSION) throw new PresetError(`The preset file is version ${data.version}; this editor reads version ${PRESET_VERSION}.`);
  if (data.type === PRESET_TYPE) return [parsePreset(data.preset ?? data)];
  if (!Array.isArray(data.presets)) throw new PresetError('The preset file lists no presets.');
  if (data.presets.length > MAX_PRESETS) throw new PresetError(`The preset file has more than ${MAX_PRESETS} presets.`);
  return data.presets.map(parsePreset);
}

export function serializePresets(presets) {
  return `${JSON.stringify({ type: PRESET_PACK_TYPE, version: PRESET_VERSION, presets: presets.map(({ name, groups, settings }) => ({ name, groups, settings })) }, null, 2)}\n`;
}

/** A name not yet used: "Name", then "Name (2)", "Name (3)"… */
export function uniquePresetName(name, existing) {
  const taken = new Set(existing.map((preset) => preset.name.toLowerCase()));
  const base = cleanPresetName(name) || 'Preset';
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base.slice(0, MAX_PRESET_NAME - 5)} (${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

const allHsl = (property, value) => Object.fromEntries(HSL_RANGES.map(({ id }) => [hslKey(id, property), value]));

/** Restrained starting looks. None touches exposure or white balance. */
export const BUILT_IN_PRESETS = Object.freeze([
  {
    id: 'builtin:natural',
    name: 'Natural',
    description: 'Gentle contrast, opened shadows, a little vibrance.',
    groups: ['tone', 'presence'],
    settings: { contrast: 8, highlights: -20, shadows: 15, vibrance: 15 },
  },
  {
    id: 'builtin:warm-portrait',
    name: 'Warm Portrait',
    description: 'Softer contrast, warmer mid-tones, calmer skin tones.',
    groups: ['tone', 'presence', 'hsl', 'curves'],
    settings: {
      contrast: -5, highlights: -15, shadows: 10, vibrance: 5, saturation: -5,
      redSaturation: -8, orangeSaturation: -10, orangeLuminance: 8,
      curves: { red: [[0, 0], [128, 134], [255, 255]], blue: [[0, 0], [128, 122], [255, 250]] },
    },
  },
  {
    id: 'builtin:cool-landscape',
    name: 'Cool Landscape',
    description: 'Clear skies and water, held highlights, slightly cooler.',
    groups: ['tone', 'presence', 'hsl', 'curves'],
    settings: {
      contrast: 12, highlights: -25, shadows: 10, whites: 5, vibrance: 20,
      greenHue: 8, greenSaturation: -10, aquaSaturation: 10, blueSaturation: 15, blueLuminance: -10,
      curves: { red: [[0, 0], [128, 124], [255, 255]], blue: [[0, 4], [128, 134], [255, 255]] },
    },
  },
  {
    id: 'builtin:soft-film',
    name: 'Soft Film',
    description: 'Lifted blacks, rolled-off highlights, muted colour.',
    groups: ['tone', 'presence', 'hsl', 'curves'],
    settings: {
      contrast: -10, highlights: -10, saturation: -12, greenHue: -10, greenSaturation: -15,
      curves: { master: [[0, 18], [64, 66], [192, 196], [255, 240]] },
    },
  },
  {
    id: 'builtin:high-contrast',
    name: 'High Contrast',
    description: 'Deeper blacks and brighter whites with detail kept in the highlights.',
    groups: ['tone', 'presence', 'curves'],
    settings: {
      contrast: 35, highlights: -20, shadows: -10, whites: 10, blacks: -15, vibrance: 10,
      curves: { master: [[0, 0], [64, 52], [192, 206], [255, 255]] },
    },
  },
  {
    id: 'builtin:black-and-white',
    name: 'Black & White',
    description: 'Monochrome from the colour channels: brighter skin, darker skies.',
    groups: ['tone', 'presence', 'hsl'],
    settings: {
      contrast: 15, ...allHsl('saturation', -100),
      redLuminance: 10, orangeLuminance: 15, greenLuminance: 5, aquaLuminance: -10, blueLuminance: -20,
    },
  },
].map((preset) => Object.freeze({ ...parsePreset(preset), id: preset.id, description: preset.description, builtIn: true })));
