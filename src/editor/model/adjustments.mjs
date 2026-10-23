// The adjustment registry: one entry per numeric control. The UI, the edit document
// validator and the parameter derivation all read this list, so a control cannot
// exist in one place and not another. Every value is relative to neutral (its
// `default`), so a missing key in a saved document means "no change".
//
// A photo's settings are these numbers plus three structured values: `curves` (tone
// curve control points, see pipeline/curves.mjs), `lut` (a reference to an
// imported .cube LUT by content hash, or null) and `raw` (white balance of a RAW
// photo's development; ignored for JPEG, PNG and WebP). The `hdr` controls only act on
// merged RAW HDR photos.

import { CURVE_CHANNELS, curvesEqual, curvesNeutral, isNeutralCurve, neutralCurves, normalizeCurves } from '../pipeline/curves.mjs';
import { MAX_LUT_SIZE, MIN_LUT_SIZE } from '../pipeline/lut.mjs';
import { DAYLIGHT_KELVIN, RAW_KELVIN, RAW_TINT, WHITE_BALANCE_MODES } from '../raw/rawColor.mjs';

/** Colour ranges for HSL, with their hue centres in degrees (HSV hue of sRGB values). */
export const HSL_RANGES = Object.freeze([
  { id: 'red', label: 'Red', center: 0, swatch: '#d9473f' },
  { id: 'orange', label: 'Orange', center: 30, swatch: '#e08a32' },
  { id: 'yellow', label: 'Yellow', center: 60, swatch: '#d8c53a' },
  { id: 'green', label: 'Green', center: 120, swatch: '#4fa84a' },
  { id: 'aqua', label: 'Aqua', center: 180, swatch: '#3fb3b0' },
  { id: 'blue', label: 'Blue', center: 240, swatch: '#4a6fd8' },
  { id: 'purple', label: 'Purple', center: 270, swatch: '#8a52d0' },
  { id: 'magenta', label: 'Magenta', center: 300, swatch: '#cf4aa8' },
].map(Object.freeze));

export const HSL_PROPERTIES = Object.freeze([
  { id: 'hue', label: 'Hue' },
  { id: 'saturation', label: 'Saturation' },
  { id: 'luminance', label: 'Luminance' },
]);

export const hslKey = (range, property) => `${range}${property[0].toUpperCase()}${property.slice(1)}`;

export const ADJUSTMENTS = Object.freeze([
  { key: 'exposure', group: 'light', label: 'Exposure', min: -5, max: 5, step: 0.05, unit: 'EV', digits: 2 },
  { key: 'contrast', group: 'light', label: 'Contrast', min: -100, max: 100, step: 1 },
  { key: 'highlights', group: 'light', label: 'Highlights', min: -100, max: 100, step: 1 },
  { key: 'shadows', group: 'light', label: 'Shadows', min: -100, max: 100, step: 1 },
  { key: 'whites', group: 'light', label: 'Whites', min: -100, max: 100, step: 1 },
  { key: 'blacks', group: 'light', label: 'Blacks', min: -100, max: 100, step: 1 },
  { key: 'temperature', group: 'color', label: 'Temperature', min: -100, max: 100, step: 1, track: 'temperature' },
  { key: 'tint', group: 'color', label: 'Tint', min: -100, max: 100, step: 1, track: 'tint' },
  { key: 'vibrance', group: 'color', label: 'Vibrance', min: -100, max: 100, step: 1 },
  { key: 'saturation', group: 'color', label: 'Saturation', min: -100, max: 100, step: 1 },
  ...HSL_RANGES.flatMap((range) => HSL_PROPERTIES.map((property) => ({
    key: hslKey(range.id, property.id),
    group: 'hsl',
    label: `${range.label} ${property.label.toLowerCase()}`,
    shortLabel: property.label,
    range: range.id,
    property: property.id,
    min: -100,
    max: 100,
    step: 1,
  }))),
  { key: 'rawTemperature', group: 'raw', label: 'RAW temperature', ...RAW_KELVIN, unit: 'K', default: DAYLIGHT_KELVIN, signed: false, track: 'temperature' },
  { key: 'rawTint', group: 'raw', label: 'RAW tint', ...RAW_TINT, track: 'tint' },
  // Merged RAW HDR only: tone mapping of the scene values (spec.hdrKnee, shadowLift).
  { key: 'hdrHighlights', group: 'hdr', label: 'Highlight compression', min: 0, max: 100, step: 1, default: 50, signed: false },
  { key: 'hdrShadows', group: 'hdr', label: 'Shadow lift', min: 0, max: 100, step: 1, signed: false },
  { key: 'lutIntensity', group: 'lut', label: 'Intensity', min: 0, max: 100, step: 1, unit: '%', default: 100, signed: false },
].map((entry) => Object.freeze({ digits: 0, unit: '', default: 0, signed: true, ...entry })));

/** Panel groups in display order. `curves` and `lut` also own the structured values. */
export const ADJUSTMENT_GROUPS = Object.freeze([
  { id: 'light', label: 'Light' },
  { id: 'color', label: 'Color' },
  { id: 'hsl', label: 'HSL' },
  { id: 'curves', label: 'Tone Curve' },
  { id: 'lut', label: 'LUT' },
  { id: 'raw', label: 'RAW' },
  { id: 'hdr', label: 'HDR' },
].map(Object.freeze));

export const ADJUSTMENT_KEYS = Object.freeze(ADJUSTMENTS.map(({ key }) => key));
const byKey = new Map(ADJUSTMENTS.map((entry) => [entry.key, entry]));

export const adjustmentSpec = (key) => byKey.get(key);

/** Rounds to the control's step and clamps to its range. Non-numbers become the default. */
export function clampAdjustment(key, value) {
  const spec = byKey.get(key);
  if (!spec) throw new Error(`Unknown adjustment: ${key}`);
  const number = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(number)) return spec.default;
  const stepped = Math.round(number / spec.step) * spec.step;
  const clamped = Math.min(spec.max, Math.max(spec.min, stepped));
  // Removes binary noise such as 0.15000000000000002 and normalises -0.
  return Number(clamped.toFixed(spec.digits)) + 0;
}

/**
 * A LUT reference: which imported .cube a photo uses, identified by the SHA-256 of
 * the file. The LUT data itself stays in this browser session (never in documents).
 */
export function normalizeLutRef(input) {
  if (input === null || typeof input !== 'object') return null;
  const { sha256, name, title, size } = input;
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  return {
    sha256,
    name: typeof name === 'string' ? name.slice(0, 255) : 'LUT',
    title: typeof title === 'string' ? title.slice(0, 120) : '',
    size: Number.isInteger(size) && size >= MIN_LUT_SIZE && size <= MAX_LUT_SIZE ? size : null,
  };
}

export const RAW_DEFAULTS = Object.freeze({ whiteBalance: 'as-shot' });

/**
 * RAW development settings beyond the numeric controls: the white balance mode (as
 * shot, daylight, or custom from rawTemperature and rawTint).
 */
export function normalizeRawSettings(input) {
  const mode = input !== null && typeof input === 'object' && WHITE_BALANCE_MODES.includes(input.whiteBalance) ? input.whiteBalance : 'as-shot';
  return { whiteBalance: mode };
}

const rawEqual = (a, b) => a.whiteBalance === b.whiteBalance;

/** A fresh all-neutral settings object. */
export function neutralAdjustments() {
  return {
    ...Object.fromEntries(ADJUSTMENTS.map(({ key, default: value }) => [key, value])),
    curves: neutralCurves(),
    lut: null,
    raw: { ...RAW_DEFAULTS },
  };
}

/** Fills missing keys with neutral values and clamps the rest; unknown keys are dropped. */
export function normalizeAdjustments(input = {}) {
  const source = input !== null && typeof input === 'object' ? input : {};
  return {
    ...Object.fromEntries(ADJUSTMENTS.map(({ key, default: value }) => [
      key,
      Object.hasOwn(source, key) ? clampAdjustment(key, source[key]) : value,
    ])),
    curves: normalizeCurves(source.curves),
    lut: normalizeLutRef(source.lut),
    raw: normalizeRawSettings(source.raw),
  };
}

const lutRefsEqual = (a, b) => (a === null || b === null ? a === b : a.sha256 === b.sha256);

export const adjustmentsEqual = (a, b) => ADJUSTMENT_KEYS.every((key) => a[key] === b[key])
  && curvesEqual(a.curves, b.curves) && lutRefsEqual(a.lut, b.lut) && rawEqual(a.raw ?? RAW_DEFAULTS, b.raw ?? RAW_DEFAULTS);

const numericNeutral = (adjustments, keys) => keys.every((key) => (adjustments[key] ?? byKey.get(key).default) === byKey.get(key).default);

/** Keys of one group's numeric controls. */
export const groupKeys = (group) => ADJUSTMENTS.filter((spec) => spec.group === group).map(({ key }) => key);

/** True when a group leaves the photo unchanged (LUT intensity alone changes nothing). */
export function groupIsNeutral(adjustments, group) {
  if (group === 'curves') return curvesNeutral(adjustments.curves);
  if (group === 'lut') return !adjustments.lut;
  if (group === 'raw') return rawEqual(normalizeRawSettings(adjustments.raw), RAW_DEFAULTS) && numericNeutral(adjustments, groupKeys('raw'));
  return numericNeutral(adjustments, groupKeys(group));
}

export const isNeutral = (adjustments) => ADJUSTMENT_GROUPS.every(({ id }) => groupIsNeutral(adjustments, id))
  && numericNeutral(adjustments, ['lutIntensity']);

/** Settings of one group, as a patch that resets it to neutral. */
export function neutralGroup(group) {
  const neutral = neutralAdjustments();
  const patch = Object.fromEntries(groupKeys(group).map((key) => [key, neutral[key]]));
  if (group === 'curves') patch.curves = neutral.curves;
  if (group === 'lut') patch.lut = null;
  if (group === 'raw') patch.raw = neutral.raw;
  return patch;
}

/** Display string for a value: signed (unless the control is a plain amount), fixed digits, with unit. */
export function formatAdjustment(key, value) {
  const spec = byKey.get(key);
  const fixed = value.toFixed(spec.digits);
  const signed = spec.signed && value > 0 ? `+${fixed}` : fixed;
  if (spec.unit === '%') return `${signed}%`;
  return spec.unit ? `${signed} ${spec.unit}` : signed;
}

/**
 * The compact form saved in documents and presets: the original ten controls always
 * (readable, and what older editors expect), anything else only when not neutral.
 */
export function compactAdjustments(adjustments) {
  const a = normalizeAdjustments(adjustments);
  const out = {};
  ADJUSTMENTS.forEach(({ key, group, default: value }) => {
    if (group === 'light' || group === 'color' || a[key] !== value) out[key] = a[key];
  });
  if (!curvesNeutral(a.curves)) out.curves = Object.fromEntries(CURVE_CHANNELS.filter((c) => !isNeutralCurve(a.curves[c])).map((c) => [c, a.curves[c].map((point) => [...point])]));
  if (a.lut) out.lut = a.lut;
  if (!rawEqual(a.raw, RAW_DEFAULTS)) out.raw = a.raw;
  return out;
}
