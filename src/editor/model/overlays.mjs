// Text overlays: editable objects drawn over the finished photo (after every adjustment
// and the geometry), never flattened into the photo's settings. Each is plain data, so it
// lives in the edit document and the undo history like any other setting.
//
// Coordinates are relative to the photo's output frame (after crop, rotation and resize):
// `x`, `y` are the centre of the text box (0–1 of the output width and height), `size` is
// the font size as a fraction of the output's short edge, so text keeps its place and
// proportions on any screen, after a crop and at any export size. `rotation` (degrees,
// clockwise) and `scale` are the object's transform about its centre; the array order is
// the z-order (later objects are drawn on top). The shape (`type`, `id`, transform, content)
// is meant to become a text layer when layers arrive without rewriting saved documents.
//
// Text is plain data: it is drawn with fillText, never parsed as HTML or markup.

export const TEXT_FONTS = Object.freeze([
  { id: 'sans', label: 'Schibsted Grotesk', generic: 'sans-serif', weights: [400, 700], italic: true },
  { id: 'mono', label: 'Martian Mono', generic: 'monospace', weights: [400, 700], italic: false },
].map(Object.freeze));
const fontById = new Map(TEXT_FONTS.map((font) => [font.id, font]));

export const TEXT_ALIGNS = Object.freeze(['left', 'center', 'right']);

export const TEXT_LIMITS = Object.freeze({
  objects: 30,
  characters: 500,
  lines: 20,
  size: Object.freeze([0.005, 0.5]),
  scale: Object.freeze([0.1, 10]),
  outline: Object.freeze([0.01, 0.3]),
  shadowBlur: Object.freeze([0, 1]),
  shadowDistance: Object.freeze([0, 1]),
});

/** Line height as a multiple of the font size. */
export const LINE_HEIGHT = 1.2;

export const TEXT_DEFAULTS = Object.freeze({
  type: 'text',
  text: 'Text',
  font: 'sans',
  weight: 700,
  italic: false,
  size: 0.08,
  x: 0.5,
  y: 0.5,
  rotation: 0,
  scale: 1,
  color: '#ffffff',
  opacity: 1,
  align: 'center',
  outline: null,
  shadow: null,
});

export const DEFAULT_OUTLINE = Object.freeze({ color: '#000000', width: 0.06 });
export const DEFAULT_SHADOW = Object.freeze({ color: '#000000', opacity: 0.6, blur: 0.15, distance: 0.08, angle: 45 });

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = (value, [min, max], fallback) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback);
const round = (value, digits = 4) => Number(value.toFixed(digits)) + 0;
/** An angle in degrees wrapped into (−180, 180]. */
const angle = (value, fallback) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const wrapped = ((value % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
};
const color = (value, fallback) => (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback);

/** Splits into user-perceived characters where the browser can, else code points. */
function characters(text) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), ({ segment }) => segment);
  return Array.from(text);
}

/**
 * Cleans text content: line breaks normalised to \n, tabs to spaces, other control
 * characters (and bidi overrides that could disguise the text) removed, then limited to
 * TEXT_LIMITS characters and lines.
 */
export function cleanText(input) {
  const text = String(input ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, '');
  const lines = text.split('\n').slice(0, TEXT_LIMITS.lines).join('\n');
  const chars = characters(lines);
  return chars.length > TEXT_LIMITS.characters ? chars.slice(0, TEXT_LIMITS.characters).join('') : lines;
}

const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(id);

/** A text object from untrusted input, or null when it is not one. Values are clamped. */
export function normalizeTextOverlay(input) {
  if (!isObject(input) || (input.type !== undefined && input.type !== 'text') || !validId(input.id)) return null;
  const font = fontById.get(input.font) ?? fontById.get(TEXT_DEFAULTS.font);
  const weight = font.weights.includes(input.weight) ? input.weight : (font.weights.includes(TEXT_DEFAULTS.weight) ? TEXT_DEFAULTS.weight : font.weights[0]);
  const outline = isObject(input.outline) ? {
    color: color(input.outline.color, DEFAULT_OUTLINE.color),
    width: round(number(input.outline.width, TEXT_LIMITS.outline, DEFAULT_OUTLINE.width)),
  } : null;
  const shadow = isObject(input.shadow) ? {
    color: color(input.shadow.color, DEFAULT_SHADOW.color),
    opacity: round(number(input.shadow.opacity, [0, 1], DEFAULT_SHADOW.opacity), 3),
    blur: round(number(input.shadow.blur, TEXT_LIMITS.shadowBlur, DEFAULT_SHADOW.blur)),
    distance: round(number(input.shadow.distance, TEXT_LIMITS.shadowDistance, DEFAULT_SHADOW.distance)),
    angle: round(angle(input.shadow.angle, DEFAULT_SHADOW.angle), 2),
  } : null;
  return {
    id: input.id,
    type: 'text',
    text: cleanText(input.text ?? ''),
    font: font.id,
    weight,
    italic: font.italic && input.italic === true,
    size: round(number(input.size, TEXT_LIMITS.size, TEXT_DEFAULTS.size), 5),
    x: round(number(input.x, [-1, 2], TEXT_DEFAULTS.x), 5),
    y: round(number(input.y, [-1, 2], TEXT_DEFAULTS.y), 5),
    rotation: round(angle(input.rotation, 0), 2),
    scale: round(number(input.scale, TEXT_LIMITS.scale, 1)),
    color: color(input.color, TEXT_DEFAULTS.color),
    opacity: round(number(input.opacity, [0, 1], 1), 3),
    align: TEXT_ALIGNS.includes(input.align) ? input.align : TEXT_DEFAULTS.align,
    outline,
    shadow,
  };
}

/** The overlay list from untrusted input: valid text objects with unique ids, at most TEXT_LIMITS.objects. */
export function normalizeOverlays(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of input.slice(0, TEXT_LIMITS.objects * 2)) {
    const overlay = normalizeTextOverlay(entry);
    if (!overlay || seen.has(overlay.id)) continue;
    seen.add(overlay.id);
    out.push(overlay);
    if (out.length === TEXT_LIMITS.objects) break;
  }
  return out;
}

const fieldsEqual = (a, b) => (a === null || b === null ? a === b : Object.keys(a).every((key) => a[key] === b[key]));

export const overlaysEqual = (a, b) => a.length === b.length && a.every((overlay, i) => {
  const other = b[i];
  return Object.keys(overlay).every((key) => (key === 'outline' || key === 'shadow' ? fieldsEqual(overlay[key], other[key]) : overlay[key] === other[key]));
});

/** A new text object (after normalisation) with `id`, centred unless `patch` says otherwise. */
export const createTextOverlay = (id, patch = {}) => normalizeTextOverlay({ ...TEXT_DEFAULTS, ...patch, id });

/** A copy of `overlay` with a new id, nudged so it does not hide the original. */
export const duplicateOverlay = (overlay, id) => normalizeTextOverlay({ ...overlay, id, x: overlay.x + 0.03, y: overlay.y + 0.03 });

/** Moves the object at `index` by `offset` places in the z-order. */
export function reorderOverlays(overlays, index, offset) {
  const to = index + offset;
  if (index < 0 || index >= overlays.length || to < 0 || to >= overlays.length) return overlays;
  const next = [...overlays];
  const [moved] = next.splice(index, 1);
  next.splice(to, 0, moved);
  return next;
}

export const fontOf = (overlay) => fontById.get(overlay.font) ?? fontById.get(TEXT_DEFAULTS.font);

/** Font size of an overlay in pixels of an output of `width` × `height` (scale included). */
export const fontPixels = (overlay, width, height) => overlay.size * Math.min(width, height) * overlay.scale;
