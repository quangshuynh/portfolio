// Masks and local adjustments: plain data, like every other setting, so they live in the undo
// history, autosave and edit documents. A mask never holds pixels: it is a list of components
// (brush strokes, linear and radial gradients) evaluated per pixel at whatever size a preview
// or export renders (pipeline/mask.mjs), so it costs a few kilobytes at any resolution.
//
// A mask: { space, base, invert, opacity, enabled, components }
// - `space` names the coordinates of its components, fixed by what owns it:
//   'image'  the photo as imported, before Crop & Transform (local adjustments): a mask stays on
//            the same content through crop, rotation, perspective, stretch and resize;
//   'canvas' the composition, i.e. the photo's output frame (adjustment and text layer masks),
//            as layer positions are;
//   'layer'  an image layer's own box (its masks move, rotate and flip with the layer).
//   Positions are fractions of that space's width and height (0–1, beyond for gradients that
//   start outside it); lengths (brush radius, radial radii) are in units of its short edge, so
//   circles stay round and nothing depends on the render size or the zoom.
// - `base` is the coverage before any component: 'none' (local adjustments start empty) or
//   'all' (a new layer mask reveals the whole layer; paint Erase or subtract to hide).
// - Components apply in order: 'add' unites (m + c − m·c), 'subtract' removes (m·(1 − c)).
//   Each has its own `opacity` and `invert`; the mask's `invert` and `opacity` apply last.
// - A disabled mask (or component) is skipped: a layer then shows fully, as without a mask.
//
// Brush components keep their strokes: each stroke is a path of [x, y, pressure] points with a
// radius, hardness, opacity and mode ('add' paints, 'erase' removes). Strokes do not build up
// within themselves (a stroke's coverage is the most any of its segments gives a pixel);
// overlapping strokes do.
//
// A local adjustment: { id, name, enabled, amount, mask, settings }. `settings` are Light,
// Color, HSL and Detail values (relative to neutral, like a photo's); `amount` (0–1) scales how
// strongly the mask applies them. Settings are reusable; masks are specific to one photo.

import { ADJUSTMENTS, adjustmentSpec, clampAdjustment } from './adjustments.mjs';

export const MASK_SPACES = Object.freeze(['image', 'canvas', 'layer']);
export const COMPONENT_TYPES = Object.freeze(['brush', 'linear', 'radial']);
/** Groups a local adjustment can hold (Detail is rendered on the CPU). */
export const LOCAL_GROUPS = Object.freeze(['light', 'color', 'hsl', 'detail']);

export const MASK_LIMITS = Object.freeze({
  local: 16,
  components: 16,
  strokes: 400,
  strokePoints: 2000,
  // Points of all brush strokes of one photo (local adjustments and layer masks together),
  // which keeps edit documents within their size limit.
  photoPoints: 40_000,
  name: 60,
  // Brush radius and radial radii, in short edges of the mask's space.
  radius: Object.freeze([0.001, 2]),
  position: Object.freeze([-2, 3]),
});

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = (value, [min, max], fallback) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback);
const round = (value, digits = 5) => Number(value.toFixed(digits)) + 0;
const unit = (value, fallback) => round(number(value, [0, 1], fallback), 3);
const position = (value, fallback) => round(number(value, MASK_LIMITS.position, fallback));
const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(id);
const angle = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const wrapped = ((value % 360) + 360) % 360;
  return round(wrapped > 180 ? wrapped - 360 : wrapped, 2);
};

/** A mask or component name: control and bidi-override characters removed, at most MASK_LIMITS.name characters. */
export function cleanMaskName(input) {
  return Array.from(String(input ?? '').replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, MASK_LIMITS.name).join('');
}

let localKeys = null;
/** Numeric controls a local adjustment may set. */
export function localSettingKeys() {
  localKeys ??= Object.freeze(ADJUSTMENTS.filter(({ group }) => LOCAL_GROUPS.includes(group)).map(({ key }) => key));
  return localKeys;
}

/** A local adjustment's settings from untrusted input: only what differs from neutral, clamped. */
export function normalizeLocalSettings(input) {
  const source = isObject(input) ? input : {};
  const out = {};
  for (const key of localSettingKeys()) {
    if (!Object.hasOwn(source, key)) continue; // eslint-disable-line no-continue
    const value = clampAdjustment(key, source[key]);
    if (value !== adjustmentSpec(key).default) out[key] = value;
  }
  return out;
}

export const localSettingsNeutral = (settings) => !Object.keys(settings ?? {}).length;
// Computed on first use: adjustments.mjs imports this module, so its registry is not ready
// while this module is first evaluated.
let detailKeys = null;
/** The Detail part and the colour part (Light, Color, HSL) of local settings. */
export const splitLocalSettings = (settings) => {
  detailKeys ??= new Set(ADJUSTMENTS.filter(({ group }) => group === 'detail').map(({ key }) => key));
  const detail = {};
  const color = {};
  Object.entries(settings ?? {}).forEach(([key, value]) => { (detailKeys.has(key) ? detail : color)[key] = value; });
  return { detail, color };
};

// Strokes this module produced, which are never changed afterwards: normalising them again
// returns them as they are, so every undo step shares the stroke data instead of copying it.
const normalizedStrokes = new WeakSet();

function normalizeStroke(input, budget) {
  if (normalizedStrokes.has(input) && input.points.length <= budget.points) {
    budget.points -= input.points.length;
    return input;
  }
  if (!isObject(input) || !Array.isArray(input.points)) return null;
  const points = [];
  for (const point of input.points.slice(0, MASK_LIMITS.strokePoints)) {
    if (budget.points <= 0) break;
    if (!Array.isArray(point) || point.length < 2) continue; // eslint-disable-line no-continue
    const [x, y, pressure = 1] = point;
    if (![x, y].every((v) => typeof v === 'number' && Number.isFinite(v))) continue; // eslint-disable-line no-continue
    points.push([position(x, 0), position(y, 0), round(number(pressure, [0.05, 1], 1), 2)]);
    budget.points -= 1;
  }
  if (!points.length) return null;
  const stroke = Object.freeze({
    mode: input.mode === 'erase' ? 'erase' : 'add',
    radius: round(number(input.radius, MASK_LIMITS.radius, 0.05)),
    hardness: unit(input.hardness, 0.5),
    opacity: unit(input.opacity, 1),
    points: Object.freeze(points),
  });
  normalizedStrokes.add(stroke);
  return stroke;
}

/** One component from untrusted input, or null. */
export function normalizeComponent(input, budget = { points: MASK_LIMITS.photoPoints }) {
  if (!isObject(input) || !validId(input.id) || !COMPONENT_TYPES.includes(input.type)) return null;
  const common = {
    id: input.id,
    type: input.type,
    name: cleanMaskName(input.name),
    enabled: input.enabled !== false,
    op: input.op === 'subtract' ? 'subtract' : 'add',
    invert: input.invert === true,
    opacity: unit(input.opacity, 1),
  };
  if (input.type === 'linear') {
    return { ...common, x0: position(input.x0, 0.5), y0: position(input.y0, 0.2), x1: position(input.x1, 0.5), y1: position(input.y1, 0.6), feather: unit(input.feather, 1) };
  }
  if (input.type === 'radial') {
    return {
      ...common,
      x: position(input.x, 0.5),
      y: position(input.y, 0.5),
      rx: round(number(input.rx, MASK_LIMITS.radius, 0.3)),
      ry: round(number(input.ry, MASK_LIMITS.radius, 0.3)),
      rotation: angle(input.rotation),
      feather: unit(input.feather, 0.5),
    };
  }
  const strokes = [];
  for (const entry of (Array.isArray(input.strokes) ? input.strokes : []).slice(0, MASK_LIMITS.strokes)) {
    const stroke = normalizeStroke(entry, budget);
    if (stroke) strokes.push(stroke);
  }
  return { ...common, strokes };
}

/**
 * A mask from untrusted input in `space` (the owner's; a mismatching saved space is replaced,
 * since its coordinates would mean something else), or null when there is no mask.
 * :param budget: { points } brush points still allowed for this photo (decremented)
 */
export function normalizeMask(input, space, budget = { points: MASK_LIMITS.photoPoints }) {
  if (!isObject(input) || !MASK_SPACES.includes(space)) return null;
  const seen = new Set();
  const components = [];
  for (const entry of (Array.isArray(input.components) ? input.components : []).slice(0, MASK_LIMITS.components * 2)) {
    const component = normalizeComponent(entry, budget);
    if (!component || seen.has(component.id)) continue; // eslint-disable-line no-continue
    seen.add(component.id);
    components.push(component);
    if (components.length === MASK_LIMITS.components) break;
  }
  return {
    space,
    base: input.base === 'all' ? 'all' : 'none',
    enabled: input.enabled !== false,
    invert: input.invert === true,
    opacity: unit(input.opacity, 1),
    components,
  };
}

export const createMask = (space, base = space === 'image' ? 'none' : 'all') => normalizeMask({ base, components: [] }, space);

/** A local adjustment from untrusted input, or null. */
export function normalizeLocalAdjustment(input, budget = { points: MASK_LIMITS.photoPoints }) {
  if (!isObject(input) || !validId(input.id)) return null;
  return {
    id: input.id,
    name: cleanMaskName(input.name),
    enabled: input.enabled !== false,
    amount: unit(input.amount, 1),
    mask: normalizeMask(isObject(input.mask) ? input.mask : {}, 'image', budget),
    settings: normalizeLocalSettings(input.settings),
  };
}

/** The local adjustments of a photo from untrusted input: valid, unique ids, within the limits. */
export function normalizeLocalAdjustments(input, budget = { points: MASK_LIMITS.photoPoints }) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of input.slice(0, MASK_LIMITS.local * 2)) {
    const local = normalizeLocalAdjustment(entry, budget);
    if (!local || seen.has(local.id)) continue; // eslint-disable-line no-continue
    seen.add(local.id);
    out.push(local);
    if (out.length === MASK_LIMITS.local) break;
  }
  return out;
}

export const localsEqual = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** True when no component of a mask can change any pixel's coverage away from its base. */
export const maskHasComponents = (mask) => Boolean(mask?.components.some((component) => component.enabled && (component.type !== 'brush' || component.strokes.length)));

/**
 * Whether a mask changes anything when applied: a disabled mask, or a full mask that is not
 * inverted and has nothing that removes, leaves its owner as without a mask.
 */
export function maskActive(mask) {
  if (!mask?.enabled) return false;
  return mask.invert || mask.opacity < 1 || mask.base === 'none' || maskHasComponents(mask);
}

/** Local adjustments that change pixels: enabled, with settings, an amount and a mask that covers something. */
export const visibleLocals = (locals) => (locals ?? []).filter((local) => local.enabled && local.amount > 0 && !localSettingsNeutral(local.settings)
  && local.mask.enabled && local.mask.opacity > 0 && (local.mask.invert || local.mask.base === 'all' || maskHasComponents(local.mask)));

/** Label shown for a mask component. */
export function componentLabel(component, index = 0) {
  if (component.name) return component.name;
  return `${{ brush: 'Brush', linear: 'Linear gradient', radial: 'Radial gradient' }[component.type]} ${index + 1}`;
}

/** Points of all brush strokes of a mask. */
export const maskPoints = (mask) => (mask?.components ?? []).reduce((sum, c) => sum + (c.type === 'brush' ? c.strokes.reduce((n, s) => n + s.points.length, 0) : 0), 0);

// Editing helpers: each returns a new normalised mask (or the same one when nothing changes).

export function addComponent(mask, component) {
  if (mask.components.length >= MASK_LIMITS.components || mask.components.some(({ id }) => id === component.id)) return mask;
  return normalizeMask({ ...mask, components: [...mask.components, component] }, mask.space) ?? mask;
}

export function updateComponent(mask, id, patch) {
  return normalizeMask({ ...mask, components: mask.components.map((c) => (c.id === id ? { ...c, ...patch, id, type: c.type } : c)) }, mask.space) ?? mask;
}

export const removeComponent = (mask, id) => ({ ...mask, components: mask.components.filter((c) => c.id !== id) });

/** A copy of component `id` named `newId` directly above it; gradients are nudged so the copy is visible. */
export function duplicateComponent(mask, id, newId) {
  const index = mask.components.findIndex((c) => c.id === id);
  if (index === -1 || mask.components.length >= MASK_LIMITS.components) return mask;
  const original = mask.components[index];
  const nudge = original.type === 'linear' ? { x0: original.x0 + 0.03, y0: original.y0 + 0.03, x1: original.x1 + 0.03, y1: original.y1 + 0.03 }
    : original.type === 'radial' ? { x: original.x + 0.03, y: original.y + 0.03 } : {};
  const copy = { ...original, ...nudge, id: newId, name: original.name ? cleanMaskName(`${original.name} copy`) : '' };
  return normalizeMask({ ...mask, components: [...mask.components.slice(0, index + 1), copy, ...mask.components.slice(index + 1)] }, mask.space) ?? mask;
}

/** Appends a stroke to brush component `id` (dropped when the photo's point budget is used up). */
export function appendStroke(mask, id, stroke) {
  return normalizeMask({ ...mask, components: mask.components.map((c) => (c.id === id && c.type === 'brush' ? { ...c, strokes: [...c.strokes, stroke] } : c)) }, mask.space) ?? mask;
}

export const clearStrokes = (mask, id) => ({ ...mask, components: mask.components.map((c) => (c.id === id && c.type === 'brush' ? { ...c, strokes: [] } : c)) });

export const createLinear = (id, patch = {}) => normalizeComponent({ id, type: 'linear', ...patch });
export const createRadial = (id, patch = {}) => normalizeComponent({ id, type: 'radial', ...patch });
export const createBrush = (id, patch = {}) => normalizeComponent({ id, type: 'brush', strokes: [], ...patch });

export const createLocalAdjustment = (id, patch = {}) => normalizeLocalAdjustment({ id, name: '', ...patch, mask: patch.mask ?? createMask('image') });

/** Saved form of a mask: as normalised (already compact). */
export const compactLocals = (locals) => locals.map((local) => ({ ...local }));

/**
 * Local adjustments without their brush components (and without any that are left with no
 * component): what can be reused on another photo, since gradients are geometric and
 * strokes follow one photo's content.
 */
export function gradientLocals(locals) {
  return (locals ?? []).map((local) => ({ ...local, mask: { ...local.mask, components: local.mask.components.filter((c) => c.type !== 'brush') } }))
    .filter((local) => local.mask.components.length || local.mask.base === 'all' || local.mask.invert);
}

/** Linear-gradient geometry from the gradient's centre, angle (degrees clockwise from "down") and length, in the space's pixels. */
export function linearFromCentre({ cx, cy, angle: degrees, length }, space) {
  const a = (degrees * Math.PI) / 180;
  const dx = (-Math.sin(a) * length) / 2;
  const dy = (Math.cos(a) * length) / 2;
  return { x0: (cx - dx) / space.width, y0: (cy - dy) / space.height, x1: (cx + dx) / space.width, y1: (cy + dy) / space.height };
}

/** A linear gradient's centre, angle and length in the space's pixels (inverse of linearFromCentre). */
export function linearCentre(component, space) {
  const ax = component.x0 * space.width;
  const ay = component.y0 * space.height;
  const bx = component.x1 * space.width;
  const by = component.y1 * space.height;
  const length = Math.hypot(bx - ax, by - ay);
  return { cx: (ax + bx) / 2, cy: (ay + by) / 2, angle: round((Math.atan2(-(bx - ax), by - ay) * 180) / Math.PI, 2), length };
}
