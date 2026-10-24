// The layer stack: image, text and adjustment layers composited over the photo (the
// background), all plain data in `adjustments.layers`, so they live in the undo history,
// autosave and edit documents like every other setting. Layers never hold pixels: an image
// layer names its source file by SHA-256 (and name, size, format, dimensions to ask for it
// again), and its pixels are decoded from that file when a preview or export needs them.
//
// Order: `layers[0]` lies directly on the background, the last entry is the top; each layer
// is composited over the result of everything below it (pipeline/composite.mjs). The
// background is the photo with all its own settings (RAW or HDR development, every
// adjustment, Detail, Creative, Crop & Transform): its output frame is the canvas.
//
// Coordinates are relative to that canvas, never to the screen: `x`, `y` are the layer's
// centre (0–1 of the canvas width and height); an image layer's `width` and `height` are its
// box in units of the canvas's short edge (so it keeps its proportions after a crop and at any
// export size); `rotation` is clockwise in degrees about the centre; `flipH`/`flipV` mirror
// the layer's content within its box. Text layers keep the Interval 11 text fields
// (model/overlays.mjs): `size` and `scale` instead of a box.
//
// Locked layers keep their content, transform, opacity, blend mode and settings: only
// visibility, the lock itself and the name change, and they cannot be deleted. They can
// still be reordered and duplicated (the copy is unlocked).

import { DEFAULT_OUTLINE, DEFAULT_SHADOW, TEXT_LIMITS, normalizeTextOverlay } from './overlays.mjs';
import { ADJUSTMENTS, groupIsNeutral, normalizeAdjustments } from './adjustments.mjs';
import { CURVE_CHANNELS, isNeutralCurve } from '../pipeline/curves.mjs';

export const LAYER_TYPES = Object.freeze(['image', 'text', 'adjustment']);

/** Blend modes (W3C Compositing and Blending Level 1), in menu order. */
export const BLEND_MODES = Object.freeze([
  { id: 'normal', label: 'Normal' },
  { id: 'multiply', label: 'Multiply' },
  { id: 'screen', label: 'Screen' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'soft-light', label: 'Soft Light' },
  { id: 'hard-light', label: 'Hard Light' },
  { id: 'darken', label: 'Darken' },
  { id: 'lighten', label: 'Lighten' },
  { id: 'color-dodge', label: 'Color Dodge' },
  { id: 'color-burn', label: 'Color Burn' },
  { id: 'difference', label: 'Difference' },
  { id: 'exclusion', label: 'Exclusion' },
  { id: 'hue', label: 'Hue' },
  { id: 'saturation', label: 'Saturation' },
  { id: 'color', label: 'Color' },
  { id: 'luminosity', label: 'Luminosity' },
].map(Object.freeze));
const BLEND_IDS = new Set(BLEND_MODES.map(({ id }) => id));

export const LAYER_LIMITS = Object.freeze({
  layers: 40,
  image: 8,
  adjustment: 12,
  text: TEXT_LIMITS.objects,
  name: 60,
  // An image layer's box, in canvas short edges.
  size: Object.freeze([0.01, 20]),
  // Source dimensions an image layer may name (the import limits are lower).
  sourceSide: 65_535,
});

export const IMAGE_SOURCE_FORMATS = Object.freeze(['jpeg', 'png', 'webp', 'arw', 'dng']);

// Settings an image or adjustment layer may carry: the per-pixel colour controls, which the
// compositor applies to the layer's pixels or to the composite below. Detail, glow, grain,
// vignette, noise, capture and lens effects need neighbouring pixels or the frame position and
// stay with the background; RAW and HDR controls stay with their own source.
const CREATIVE_COLOR_SECTIONS = new Set(['bleach', 'film', 'grading']);
const CREATIVE_COLOR_KEYS = new Set(['sensorColor', 'cameraResponse', 'highlightClip', 'quantizeAmount']);
// Computed on first use: adjustments.mjs imports this module, so its registry is not ready
// while this module is first evaluated.
let settingKeys = null;
export function layerSettingKeys() {
  settingKeys ??= Object.freeze(ADJUSTMENTS.filter(({ key, group, section }) => ['light', 'color', 'hsl'].includes(group)
    || key === 'lutIntensity'
    || (group === 'creative' && (CREATIVE_COLOR_SECTIONS.has(section) || CREATIVE_COLOR_KEYS.has(key)))).map(({ key }) => key));
  return settingKeys;
}
/** Panel groups that edit a layer's settings. */
export const LAYER_SETTING_GROUPS = Object.freeze(['light', 'color', 'hsl', 'curves', 'lut', 'creative']);
export const LAYER_CREATIVE_SECTIONS = Object.freeze([...CREATIVE_COLOR_SECTIONS, 'camera', 'capture']);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = (value, [min, max], fallback) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback);
const round = (value, digits = 5) => Number(value.toFixed(digits)) + 0;
const angle = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const wrapped = ((value % 360) + 360) % 360;
  return round(wrapped > 180 ? wrapped - 360 : wrapped, 2);
};
const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(id);
const positiveInteger = (value) => (Number.isInteger(value) && value > 0 && value <= LAYER_LIMITS.sourceSide ? value : null);

/** A layer name: control and bidi-override characters removed, at most LAYER_LIMITS.name characters. */
export function cleanName(input) {
  return Array.from(String(input ?? '').replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, LAYER_LIMITS.name).join('');
}

/**
 * A layer's colour settings from untrusted input: the LAYER_SETTING_KEYS (clamped), tone
 * curves and a LUT reference; anything else is dropped. Missing keys are neutral.
 */
export function normalizeLayerSettings(input) {
  const source = isObject(input) ? input : {};
  const keys = layerSettingKeys();
  const full = normalizeAdjustments(Object.fromEntries(Object.entries(source).filter(([key]) => keys.includes(key) || key === 'curves' || key === 'lut')));
  return { ...Object.fromEntries(keys.map((key) => [key, full[key]])), curves: full.curves, lut: full.lut };
}

/** Full adjustments (neutral outside the layer's settings) for deriveParams and the panels. */
export const layerAdjustments = (settings) => normalizeAdjustments(settings ?? {});

/** True when a layer's settings change nothing. */
export const settingsNeutral = (settings) => ['light', 'color', 'hsl', 'curves', 'lut', 'creative'].every((group) => groupIsNeutral(layerAdjustments(settings), group));

/** Settings in their saved form: only what differs from neutral. */
export function compactLayerSettings(settings) {
  const s = normalizeLayerSettings(settings);
  const neutral = normalizeLayerSettings({});
  const out = {};
  layerSettingKeys().forEach((key) => { if (s[key] !== neutral[key]) out[key] = s[key]; });
  const curves = CURVE_CHANNELS.filter((channel) => !isNeutralCurve(s.curves[channel]));
  if (curves.length) out.curves = Object.fromEntries(curves.map((channel) => [channel, s.curves[channel].map((point) => [...point])]));
  if (s.lut) out.lut = s.lut;
  return out;
}

function normalizeSource(input) {
  if (!isObject(input) || typeof input.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(input.sha256)) return null;
  const width = positiveInteger(input.width);
  const height = positiveInteger(input.height);
  if (!width || !height || !IMAGE_SOURCE_FORMATS.includes(input.format)) return null;
  return {
    sha256: input.sha256,
    name: typeof input.name === 'string' ? cleanName(input.name).slice(0, 255) : '',
    size: Number.isSafeInteger(input.size) && input.size >= 0 ? input.size : null,
    format: input.format,
    width,
    height,
  };
}

function common(input) {
  return {
    id: input.id,
    type: input.type,
    name: cleanName(input.name),
    visible: input.visible !== false,
    locked: input.locked === true,
    opacity: round(number(input.opacity, [0, 1], 1), 3),
    blend: BLEND_IDS.has(input.blend) ? input.blend : 'normal',
  };
}

/** One layer from untrusted input, or null when it is not a valid layer. Values are clamped. */
export function normalizeLayer(input) {
  if (!isObject(input) || !validId(input.id) || !LAYER_TYPES.includes(input.type)) return null;
  if (input.type === 'text') {
    const text = normalizeTextOverlay(input);
    if (!text) return null;
    const { opacity, ...fields } = text;
    return { ...common(input), ...fields, type: 'text', flipH: input.flipH === true, flipV: input.flipV === true };
  }
  if (input.type === 'adjustment') return { ...common(input), settings: normalizeLayerSettings(input.settings) };
  const source = normalizeSource(input.source);
  if (!source) return null;
  return {
    ...common(input),
    source,
    x: round(number(input.x, [-1, 2], 0.5)),
    y: round(number(input.y, [-1, 2], 0.5)),
    width: round(number(input.width, LAYER_LIMITS.size, 0.5)),
    height: round(number(input.height, LAYER_LIMITS.size, 0.5)),
    rotation: angle(input.rotation),
    flipH: input.flipH === true,
    flipV: input.flipV === true,
    settings: normalizeLayerSettings(input.settings),
  };
}

/** A text layer from an Interval 11 text object (same id, fields and stacking position). */
export const textLayerFromOverlay = (overlay) => (isObject(overlay) && (overlay.type === undefined || overlay.type === 'text') ? { ...overlay, type: 'text', name: '' } : null);

/**
 * The layer stack from untrusted input: valid layers with unique ids within the limits per
 * type and in total. `legacyOverlays` (documents before version 9) become text layers in
 * their order when there is no `layers` list.
 */
export function normalizeLayers(input, legacyOverlays = undefined) {
  const list = Array.isArray(input) ? input : Array.isArray(legacyOverlays) ? legacyOverlays.map(textLayerFromOverlay) : [];
  const seen = new Set();
  const counts = { image: 0, text: 0, adjustment: 0 };
  const out = [];
  for (const entry of list.slice(0, LAYER_LIMITS.layers * 2)) {
    const layer = normalizeLayer(entry);
    if (!layer || seen.has(layer.id) || counts[layer.type] >= LAYER_LIMITS[layer.type]) continue;
    seen.add(layer.id);
    counts[layer.type] += 1;
    out.push(layer);
    if (out.length === LAYER_LIMITS.layers) break;
  }
  return out;
}

/** Saved form: settings compacted, text fields as in Interval 11. */
export const compactLayers = (layers) => layers.map((layer) => (layer.settings ? { ...layer, settings: compactLayerSettings(layer.settings) } : layer));

// Layers are small plain data with a fixed key order once normalised.
export const layersEqual = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

export const textLayers = (layers) => layers.filter((layer) => layer.type === 'text');

/** Whether another layer of `type` fits within the limits. */
export const canAddLayer = (layers, type) => layers.length < LAYER_LIMITS.layers && layers.filter((layer) => layer.type === type).length < LAYER_LIMITS[type];

/** Label shown for a layer: its name, else derived from its content. */
export function layerLabel(layer) {
  if (layer.name) return layer.name;
  if (layer.type === 'text') return (layer.text.split('\n')[0] || 'Empty text').slice(0, 40);
  if (layer.type === 'image') return layer.source.name || 'Image';
  return 'Adjustment';
}

/** Keys a locked layer still accepts. */
const LOCK_FREE = new Set(['visible', 'locked', 'name']);

/** Applies `patch` to layer `id` (normalised); a locked layer accepts only visibility, lock and name. */
export function updateLayer(layers, id, patch) {
  return layers.map((layer) => {
    if (layer.id !== id) return layer;
    const allowed = layer.locked ? Object.fromEntries(Object.entries(patch).filter(([key]) => LOCK_FREE.has(key))) : patch;
    return normalizeLayer({ ...layer, ...allowed, id: layer.id, type: layer.type }) ?? layer;
  });
}

/** Inserts `layer` directly above index `below` (−1: at the bottom), or at the top. */
export function insertLayer(layers, layer, below = layers.length - 1) {
  const normalized = normalizeLayer(layer);
  if (!normalized || !canAddLayer(layers, normalized.type) || layers.some(({ id }) => id === normalized.id)) return layers;
  const at = Math.min(layers.length, Math.max(0, below + 1));
  return [...layers.slice(0, at), normalized, ...layers.slice(at)];
}

/** A copy of layer `id` named `newId`, unlocked, directly above it and nudged so it does not hide the original. */
export function duplicateLayer(layers, id, newId) {
  const index = layers.findIndex((layer) => layer.id === id);
  if (index === -1) return layers;
  const original = layers[index];
  const nudge = original.type === 'adjustment' ? {} : { x: original.x + 0.03, y: original.y + 0.03 };
  const name = original.name ? cleanName(`${original.name} copy`) : '';
  return insertLayer(layers, { ...original, ...nudge, id: newId, name, locked: false }, index);
}

/** Removes layer `id` unless it is locked. The source file is never touched. */
export const removeLayer = (layers, id) => layers.filter((layer) => layer.id !== id || layer.locked);

/** Moves layer `id` to stack index `to` (clamped). */
export function moveLayer(layers, id, to) {
  const from = layers.findIndex((layer) => layer.id === id);
  if (from === -1) return layers;
  const target = Math.min(layers.length - 1, Math.max(0, to));
  if (target === from) return layers;
  const next = [...layers];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

/** Layers that change pixels: visible, opaque enough, with something to draw. */
export const visibleLayers = (layers) => layers.filter((layer) => layer.visible && layer.opacity > 0
  && (layer.type !== 'text' || layer.text.trim() !== '')
  && (layer.type !== 'adjustment' || !settingsNeutral(layer.settings)));

/**
 * A new image layer for `source` ({ sha256, name, size, format, width, height }) fitted
 * inside `fit` (default 60%) of a canvas of `canvas` size, centred.
 */
export function createImageLayer(id, source, canvas, fit = 0.6) {
  const short = Math.min(canvas.width, canvas.height);
  const scale = Math.min((canvas.width * fit) / source.width, (canvas.height * fit) / source.height);
  return normalizeLayer({
    id,
    type: 'image',
    name: '',
    source,
    x: 0.5,
    y: 0.5,
    width: (source.width * scale) / short,
    height: (source.height * scale) / short,
  });
}

export const createAdjustmentLayer = (id, settings = {}) => normalizeLayer({ id, type: 'adjustment', name: '', settings });

/** An image layer's transform reset: its source proportions, fitted inside the canvas, centred, unrotated. */
export function resetImageTransform(layer, canvas) {
  const fitted = createImageLayer(layer.id, layer.source, canvas, 1);
  return { x: 0.5, y: 0.5, width: fitted.width, height: fitted.height, rotation: 0, flipH: false, flipV: false };
}

export const TEXT_RESET = Object.freeze({ x: 0.5, y: 0.5, rotation: 0, scale: 1, flipH: false, flipV: false });

export { DEFAULT_OUTLINE, DEFAULT_SHADOW };
