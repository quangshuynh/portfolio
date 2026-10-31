// The adjustment registry: one entry per numeric control. The UI, the edit document
// validator and the parameter derivation all read this list, so a control cannot
// exist in one place and not another. Every value is relative to neutral (its
// `default`), so a missing key in a saved document means "no change".
//
// A photo's settings are these numbers plus four structured values: `curves` (tone
// curve control points, see pipeline/curves.mjs), `lut` (a reference to an
// imported .cube LUT by content hash, or null), `raw` (white balance and rendering profile of a
// RAW photo's development; ignored for JPEG, PNG and WebP) and `geometry` (crop, rotation,
// flips, perspective, stretch and resize; pipeline/geometry.mjs) and `layers` (image, text and
// adjustment layers composited over the finished photo; model/layers.mjs) and `local` (masked local adjustments
// over the finished photo, below the layers; model/masks.mjs) and `filter` (which Filter Library
// filter set the Creative group, and at what strength; model/filters.mjs) and `watermark` (the HUYNH
// Photography mark over the final output, or null; watermark/watermark.mjs). The `hdr` controls only act on
// merged RAW HDR photos. Creative controls (pipeline/creative.mjs) carry a `section` for the
// panel, and `scales` when a look's intensity scales them from neutral.

import { CURVE_CHANNELS, curvesEqual, curvesNeutral, isNeutralCurve, neutralCurves, normalizeCurves } from '../pipeline/curves.mjs';
import { MAX_LUT_SIZE, MIN_LUT_SIZE } from '../pipeline/lut.mjs';
import { compactGeometry, geometryEqual, geometryNeutral, neutralGeometry, normalizeGeometry } from '../pipeline/geometry.mjs';
import { DAYLIGHT_KELVIN, RAW_KELVIN, RAW_TINT, WHITE_BALANCE_MODES } from '../raw/rawColor.mjs';
import { LEGACY_RAW_PROFILE, RAW_PROFILE_IDS, profileVersionOf } from '../raw/rawProfiles.mjs';
import { compactLayers, layersEqual, normalizeLayers, textLayers } from './layers.mjs';
import { MASK_LIMITS, compactLocals, localsEqual, normalizeLocalAdjustments } from './masks.mjs';
import { normalizeWatermark, watermarksEqual } from '../watermark/watermark.mjs';
import { normalizeRetouch, retouchEqual } from './retouch.mjs';

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

/** Colour grading ranges and the hue each starts at (a classic cool-shadow, warm-highlight split). */
export const GRADE_RANGES = Object.freeze([
  { id: 'Shadows', label: 'Shadows', hue: 220 },
  { id: 'Midtones', label: 'Midtones', hue: 30 },
  { id: 'Highlights', label: 'Highlights', hue: 45 },
  { id: 'Global', label: 'Global', hue: 30 },
].map(Object.freeze));

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
  // Detail (pipeline/detail.mjs): spatial, rendered on the CPU in preview and export.
  { key: 'texture', group: 'detail', label: 'Texture', min: -100, max: 100, step: 1 },
  { key: 'clarity', group: 'detail', label: 'Clarity', min: -100, max: 100, step: 1 },
  { key: 'dehaze', group: 'detail', label: 'Dehaze', min: -100, max: 100, step: 1 },
  { key: 'sharpening', group: 'detail', label: 'Sharpening', min: 0, max: 100, step: 1, signed: false },
  { key: 'luminanceNoise', group: 'detail', label: 'Luminance noise reduction', shortLabel: 'Luminance NR', min: 0, max: 100, step: 1, signed: false },
  { key: 'colorNoise', group: 'detail', label: 'Color noise reduction', shortLabel: 'Color NR', min: 0, max: 100, step: 1, signed: false },
  { key: 'rawTemperature', group: 'raw', label: 'RAW temperature', ...RAW_KELVIN, unit: 'K', default: DAYLIGHT_KELVIN, signed: false, track: 'temperature' },
  { key: 'rawTint', group: 'raw', label: 'RAW tint', ...RAW_TINT, track: 'tint' },
  // Merged RAW HDR only: tone mapping of the scene values (spec.hdrKnee, shadowLift).
  { key: 'hdrHighlights', group: 'hdr', label: 'Highlight compression', min: 0, max: 100, step: 1, default: 50, signed: false },
  { key: 'hdrShadows', group: 'hdr', label: 'Shadow lift', min: 0, max: 100, step: 1, signed: false },
  // Creative (pipeline/creative.mjs): after the LUT, on the finished colours.
  { key: 'bleachAmount', group: 'creative', section: 'bleach', label: 'Bleach bypass amount', shortLabel: 'Amount', min: 0, max: 100, step: 1, signed: false, scales: true },
  { key: 'bleachContrast', group: 'creative', section: 'bleach', label: 'Bleach bypass contrast', shortLabel: 'Contrast', min: 0, max: 100, step: 1, default: 50, signed: false },
  { key: 'bleachDesaturation', group: 'creative', section: 'bleach', label: 'Bleach bypass desaturation', shortLabel: 'Desaturation', min: 0, max: 100, step: 1, default: 60, signed: false },
  { key: 'bleachProtect', group: 'creative', section: 'bleach', label: 'Bleach bypass highlight protection', shortLabel: 'Highlight protection', min: 0, max: 100, step: 1, default: 30, signed: false },
  { key: 'fade', group: 'creative', section: 'film', label: 'Fade', min: 0, max: 100, step: 1, signed: false, scales: true },
  { key: 'fadeHighlights', group: 'creative', section: 'film', label: 'Highlight roll-off', min: 0, max: 100, step: 1, signed: false, scales: true },
  { key: 'fadeShadowTint', group: 'creative', section: 'film', label: 'Black tint', min: 0, max: 100, step: 1, signed: false, scales: true },
  { key: 'fadeShadowHue', group: 'creative', section: 'film', label: 'Black tint hue', shortLabel: 'Black hue', min: 0, max: 359, step: 1, default: 210, unit: '°', signed: false, track: 'hue' },
  { key: 'fadeHighlightTint', group: 'creative', section: 'film', label: 'White tint', min: 0, max: 100, step: 1, signed: false, scales: true },
  { key: 'fadeHighlightHue', group: 'creative', section: 'film', label: 'White tint hue', shortLabel: 'White hue', min: 0, max: 359, step: 1, default: 45, unit: '°', signed: false, track: 'hue' },
  { key: 'grainAmount', group: 'creative', section: 'grain', label: 'Grain amount', shortLabel: 'Amount', min: 0, max: 100, step: 1, signed: false, scales: true },
  { key: 'grainSize', group: 'creative', section: 'grain', label: 'Grain size', shortLabel: 'Size', min: 0, max: 100, step: 1, default: 35, signed: false },
  { key: 'grainRoughness', group: 'creative', section: 'grain', label: 'Grain roughness', shortLabel: 'Roughness', min: 0, max: 100, step: 1, default: 50, signed: false },
  // The grain pattern's seed, stored with the photo so the pattern never changes by itself.
  { key: 'grainSeed', group: 'creative', section: 'grain', label: 'Grain pattern', min: 0, max: 65535, step: 1, signed: false, hidden: true },
  { key: 'bloomAmount', group: 'creative', section: 'glow', label: 'Bloom amount', shortLabel: 'Bloom', min: 0, max: 100, step: 1, signed: false, scales: true },
  { key: 'bloomRadius', group: 'creative', section: 'glow', label: 'Bloom radius', shortLabel: 'Radius', min: 0, max: 100, step: 1, default: 40, signed: false },
  { key: 'bloomThreshold', group: 'creative', section: 'glow', label: 'Bloom threshold', shortLabel: 'Threshold', min: 0, max: 100, step: 1, default: 60, signed: false },
  { key: 'halationAmount', group: 'creative', section: 'glow', label: 'Halation amount', shortLabel: 'Halation', min: 0, max: 100, step: 1, signed: false, scales: true },
  { key: 'halationRadius', group: 'creative', section: 'glow', label: 'Halation radius', shortLabel: 'Radius', min: 0, max: 100, step: 1, default: 30, signed: false },
  { key: 'halationThreshold', group: 'creative', section: 'glow', label: 'Halation threshold', shortLabel: 'Threshold', min: 0, max: 100, step: 1, default: 60, signed: false },
  { key: 'halationHue', group: 'creative', section: 'glow', label: 'Halation hue', shortLabel: 'Hue', min: 0, max: 60, step: 1, default: 15, unit: '°', signed: false, track: 'warmth' },
  { key: 'vignetteAmount', group: 'creative', section: 'vignette', label: 'Vignette amount', shortLabel: 'Amount', min: -100, max: 100, step: 1, scales: true },
  { key: 'vignetteMidpoint', group: 'creative', section: 'vignette', label: 'Vignette midpoint', shortLabel: 'Midpoint', min: 0, max: 100, step: 1, default: 50, signed: false },
  { key: 'vignetteRoundness', group: 'creative', section: 'vignette', label: 'Vignette roundness', shortLabel: 'Roundness', min: -100, max: 100, step: 1 },
  { key: 'vignetteFeather', group: 'creative', section: 'vignette', label: 'Vignette feather', shortLabel: 'Feather', min: 0, max: 100, step: 1, default: 50, signed: false },
  ...GRADE_RANGES.flatMap(({ id, label, hue }) => [
    { key: `grade${id}Hue`, group: 'creative', section: 'grading', range: id, label: `${label} hue`, shortLabel: 'Hue', min: 0, max: 359, step: 1, default: hue, unit: '°', signed: false, track: 'hue' },
    { key: `grade${id}Sat`, group: 'creative', section: 'grading', range: id, label: `${label} saturation`, shortLabel: 'Saturation', min: 0, max: 100, step: 1, signed: false, scales: true },
    { key: `grade${id}Lum`, group: 'creative', section: 'grading', range: id, label: `${label} luminance`, shortLabel: 'Luminance', min: -100, max: 100, step: 1, scales: true },
  ]),
  { key: 'gradeBalance', group: 'creative', section: 'grading', label: 'Grading balance', shortLabel: 'Balance', min: -100, max: 100, step: 1 },
  { key: 'gradeBlending', group: 'creative', section: 'grading', label: 'Grading blending', shortLabel: 'Blending', min: 0, max: 100, step: 1, default: 50, signed: false },
  // Digital camera, capture and lens effects (pipeline/digital.mjs).
  { key: 'sensorColor', group: 'creative', section: 'camera', label: 'Sensor color', shortLabel: 'Sensor color', min: -100, max: 100, step: 1, scales: true, track: 'temperature' },
  { key: 'cameraResponse', group: 'creative', section: 'camera', label: 'Camera response', shortLabel: 'Response', min: 0, max: 100, step: 1, signed: false, scales: true },
  { key: 'highlightClip', group: 'creative', section: 'camera', label: 'Highlight clipping', shortLabel: 'Highlight clipping', min: 0, max: 100, step: 1, signed: false, scales: true },
  { key: 'noiseAmount', group: 'creative', section: 'camera', label: 'Sensor noise amount', shortLabel: 'Noise', min: 0, max: 100, step: 1, signed: false, scales: true },
  { key: 'noiseColor', group: 'creative', section: 'camera', label: 'Sensor noise color', shortLabel: 'Noise color', min: 0, max: 100, step: 1, default: 50, signed: false },
  { key: 'captureResolution', group: 'creative', section: 'capture', label: 'Low resolution', shortLabel: 'Low resolution', min: 0, max: 100, step: 1, signed: false, scales: true },
  { key: 'pixelEdges', group: 'creative', section: 'capture', label: 'Pixel edges', shortLabel: 'Pixel edges', min: 0, max: 100, step: 1, signed: false },
  { key: 'jpegAmount', group: 'creative', section: 'capture', label: 'JPEG compression', shortLabel: 'JPEG compression', min: 0, max: 100, step: 1, signed: false, scales: true },
  { key: 'quantizeAmount', group: 'creative', section: 'capture', label: 'Color quantization', shortLabel: 'Quantization', min: 0, max: 100, step: 1, signed: false, scales: true },
  { key: 'quantizeDither', group: 'creative', section: 'capture', label: 'Quantization dither', shortLabel: 'Dither', min: 0, max: 100, step: 1, signed: false },
  { key: 'chromaticAberration', group: 'creative', section: 'lens', label: 'Chromatic aberration', shortLabel: 'Chromatic aberration', min: 0, max: 100, step: 1, signed: false, scales: true },
  { key: 'channelShift', group: 'creative', section: 'lens', label: 'Channel shift', shortLabel: 'Channel shift', min: 0, max: 100, step: 1, signed: false, scales: true },
  { key: 'channelShiftAngle', group: 'creative', section: 'lens', label: 'Channel shift angle', shortLabel: 'Shift angle', min: 0, max: 359, step: 1, unit: '°', signed: false },
  { key: 'diffusionAmount', group: 'creative', section: 'lens', label: 'Soft focus', shortLabel: 'Soft focus', min: 0, max: 100, step: 1, signed: false, scales: true },
  { key: 'diffusionRadius', group: 'creative', section: 'lens', label: 'Soft focus radius', shortLabel: 'Radius', min: 0, max: 100, step: 1, default: 40, signed: false },
  { key: 'lutIntensity', group: 'lut', label: 'Intensity', min: 0, max: 100, step: 1, unit: '%', default: 100, signed: false },
].map((entry) => Object.freeze({ digits: 0, unit: '', default: 0, signed: true, ...entry })));

/** Panel groups in display order. `curves` and `lut` also own the structured values. */
export const ADJUSTMENT_GROUPS = Object.freeze([
  { id: 'retouch', label: 'Retouch' },
  { id: 'geometry', label: 'Crop & Transform' },
  { id: 'light', label: 'Light' },
  { id: 'color', label: 'Color' },
  { id: 'hsl', label: 'HSL' },
  { id: 'detail', label: 'Detail' },
  { id: 'curves', label: 'Tone Curve' },
  { id: 'lut', label: 'LUT' },
  { id: 'creative', label: 'Creative' },
  { id: 'text', label: 'Text' },
  { id: 'layers', label: 'Layers' },
  { id: 'masks', label: 'Masks' },
  { id: 'watermark', label: 'Watermark' },
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

/**
 * The filter a photo's Creative settings came from: `id` (a built-in filter or a custom one)
 * and `strength` 0–100. It records the choice only; the pixels follow the Creative values.
 */
export function normalizeFilterRef(input) {
  if (input === null || typeof input !== 'object') return null;
  const { id, strength } = input;
  if (typeof id !== 'string' || id.length > 100 || !/^(filter|look|preset):[^\u0000-\u001f\u007f]+$/.test(id)) return null;
  const value = Number(strength);
  return { id, strength: Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : 100 };
}

const filterRefsEqual = (a, b) => (a === null || b === null ? a === b : a.id === b.id && a.strength === b.strength);

// Settings without a profile (every edit saved before document version 14) keep the legacy
// rendering; new RAW imports start with Camera Natural version 2 (editorState.mjs). Camera Natural
// without a version (Interval 22, document version 14) is version 1.
export const RAW_DEFAULTS = Object.freeze({ whiteBalance: 'as-shot', profile: LEGACY_RAW_PROFILE, profileVersion: 1, autoExposure: null });

/** Accepted Auto Exposure corrections are kept within ±3 EV in 0.05 EV steps. */
export const AUTO_EXPOSURE_LIMIT = 3;
const normalizeAutoExposure = (value) => {
  const number = Number(value);
  if (value === null || value === undefined || !Number.isFinite(number)) return null;
  const rounded = Math.round(Math.min(AUTO_EXPOSURE_LIMIT, Math.max(-AUTO_EXPOSURE_LIMIT, number)) * 20) / 20;
  return rounded === 0 ? null : rounded;
};

/**
 * RAW development settings beyond the numeric controls: the white balance mode (as
 * shot, daylight, or custom from rawTemperature and rawTint), the rendering profile and its
 * version (raw/rawProfiles.mjs), and an accepted Auto Exposure correction in EV
 * (raw/rawAutoExposure.mjs; null when none), which adds to the Exposure slider without changing it.
 */
export function normalizeRawSettings(input) {
  const source = input !== null && typeof input === 'object' ? input : {};
  const profile = RAW_PROFILE_IDS.includes(source.profile) ? source.profile : LEGACY_RAW_PROFILE;
  return {
    whiteBalance: WHITE_BALANCE_MODES.includes(source.whiteBalance) ? source.whiteBalance : 'as-shot',
    profile,
    profileVersion: profileVersionOf(profile, source.profileVersion),
    autoExposure: normalizeAutoExposure(source.autoExposure),
  };
}

const rawEqual = (a, b) => {
  const [x, y] = [normalizeRawSettings(a), normalizeRawSettings(b)];
  return x.whiteBalance === y.whiteBalance && x.profile === y.profile && x.profileVersion === y.profileVersion && x.autoExposure === y.autoExposure;
};

/**
 * Saved form of RAW settings: only what differs from a document before profiles, so edits saved
 * by earlier versions keep their exact form (and CMS treatment hashes): no legacy profile, no
 * version 1, no Auto Exposure unless accepted.
 */
function compactRaw(raw) {
  const out = { whiteBalance: raw.whiteBalance };
  if (raw.profile !== LEGACY_RAW_PROFILE) out.profile = raw.profile;
  if (raw.profileVersion !== 1) out.profileVersion = raw.profileVersion;
  if (raw.autoExposure !== null) out.autoExposure = raw.autoExposure;
  return out;
}

/**
 * Neutral settings that keep the photo's RAW rendering profile: what Reset gives and what
 * Before shows. The profile is the photo's starting point, not an edit.
 */
export function developmentBase(current = null) {
  const neutral = neutralAdjustments();
  const { profile, profileVersion } = normalizeRawSettings(current?.raw);
  neutral.raw = { ...neutral.raw, profile, profileVersion };
  return neutral;
}

/** A fresh all-neutral settings object. */
export function neutralAdjustments() {
  return {
    ...Object.fromEntries(ADJUSTMENTS.map(({ key, default: value }) => [key, value])),
    curves: neutralCurves(),
    lut: null,
    raw: { ...RAW_DEFAULTS },
    geometry: neutralGeometry(),
    layers: [],
    local: [],
    filter: null,
    watermark: null,
    retouch: [],
  };
}

/** Fills missing keys with neutral values and clamps the rest; unknown keys are dropped. */
export function normalizeAdjustments(input = {}) {
  const source = input !== null && typeof input === 'object' ? input : {};
  // Brush points allowed for the whole photo, shared by local adjustments and layer masks.
  const budget = { points: MASK_LIMITS.photoPoints };
  const local = normalizeLocalAdjustments(source.local, budget);
  return {
    ...Object.fromEntries(ADJUSTMENTS.map(({ key, default: value }) => [
      key,
      Object.hasOwn(source, key) ? clampAdjustment(key, source[key]) : value,
    ])),
    curves: normalizeCurves(source.curves),
    lut: normalizeLutRef(source.lut),
    raw: normalizeRawSettings(source.raw),
    geometry: normalizeGeometry(source.geometry),
    // Documents before version 9 kept text in `overlays`; they become text layers.
    layers: normalizeLayers(source.layers, source.overlays, budget),
    local,
    filter: normalizeFilterRef(source.filter),
    watermark: normalizeWatermark(source.watermark),
    // Clone and heal operations on the source (documents before version 12 have none).
    retouch: normalizeRetouch(source.retouch),
  };
}

const NEUTRAL_GEOMETRY = neutralGeometry();
const lutRefsEqual = (a, b) => (a === null || b === null ? a === b : a.sha256 === b.sha256);

export const adjustmentsEqual = (a, b) => ADJUSTMENT_KEYS.every((key) => a[key] === b[key])
  && curvesEqual(a.curves, b.curves) && lutRefsEqual(a.lut, b.lut) && rawEqual(a.raw ?? RAW_DEFAULTS, b.raw ?? RAW_DEFAULTS)
  && geometryEqual(a.geometry ?? NEUTRAL_GEOMETRY, b.geometry ?? NEUTRAL_GEOMETRY) && layersEqual(a.layers ?? [], b.layers ?? []) && localsEqual(a.local ?? [], b.local ?? []) && filterRefsEqual(a.filter ?? null, b.filter ?? null)
  && watermarksEqual(a.watermark ?? null, b.watermark ?? null) && retouchEqual(a.retouch ?? [], b.retouch ?? []);

const numericNeutral = (adjustments, keys) => keys.every((key) => (adjustments[key] ?? byKey.get(key).default) === byKey.get(key).default);

/** Keys of one group's numeric controls. */
export const groupKeys = (group) => ADJUSTMENTS.filter((spec) => spec.group === group).map(({ key }) => key);

/** True when a group leaves the photo unchanged (LUT intensity alone changes nothing). */
export function groupIsNeutral(adjustments, group) {
  if (group === 'curves') return curvesNeutral(adjustments.curves);
  if (group === 'lut') return !adjustments.lut;
  if (group === 'raw') {
    const raw = normalizeRawSettings(adjustments.raw);
    return raw.whiteBalance === RAW_DEFAULTS.whiteBalance && raw.autoExposure === null && numericNeutral(adjustments, groupKeys('raw'));
  }
  if (group === 'geometry') return geometryNeutral(adjustments.geometry ?? NEUTRAL_GEOMETRY);
  if (group === 'text') return !textLayers(adjustments.layers ?? []).length;
  if (group === 'layers') return !adjustments.layers?.length;
  if (group === 'masks') return !adjustments.local?.length;
  if (group === 'watermark') return !adjustments.watermark;
  if (group === 'retouch') return !adjustments.retouch?.length;
  return numericNeutral(adjustments, groupKeys(group));
}

export const isNeutral = (adjustments) => ADJUSTMENT_GROUPS.every(({ id }) => groupIsNeutral(adjustments, id))
  && numericNeutral(adjustments, ['lutIntensity']);

/** Settings of one group, as a patch that resets it to neutral (Text needs the `current` settings: it keeps other layers). */
export function neutralGroup(group, current = null) {
  const neutral = neutralAdjustments();
  const patch = Object.fromEntries(groupKeys(group).map((key) => [key, neutral[key]]));
  if (group === 'curves') patch.curves = neutral.curves;
  if (group === 'lut') patch.lut = null;
  if (group === 'raw') patch.raw = developmentBase(current).raw;
  if (group === 'geometry') patch.geometry = neutral.geometry;
  if (group === 'layers') patch.layers = [];
  if (group === 'masks') patch.local = [];
  if (group === 'text') patch.layers = (current?.layers ?? []).filter((layer) => layer.type !== 'text' || layer.locked);
  if (group === 'creative') patch.filter = null;
  if (group === 'watermark') patch.watermark = null;
  if (group === 'retouch') patch.retouch = [];
  return patch;
}

/** Display string for a value: signed (unless the control is a plain amount), fixed digits, with unit. */
export function formatAdjustment(key, value) {
  const spec = byKey.get(key);
  const fixed = value.toFixed(spec.digits);
  const signed = spec.signed && value > 0 ? `+${fixed}` : fixed;
  if (spec.unit === '%' || spec.unit === '°') return `${signed}${spec.unit}`;
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
  if (!rawEqual(a.raw, RAW_DEFAULTS)) out.raw = compactRaw(a.raw);
  const geometry = compactGeometry(a.geometry);
  if (geometry) out.geometry = geometry;
  if (a.layers.length) out.layers = compactLayers(a.layers);
  if (a.local.length) out.local = compactLocals(a.local);
  if (a.filter) out.filter = a.filter;
  if (a.watermark) out.watermark = a.watermark;
  if (a.retouch.length) out.retouch = a.retouch;
  return out;
}
