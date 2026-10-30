// HUYNH Photography watermark: the one design specification, the per-photo settings, the
// layout and the colour choice. Everything here is plain data and arithmetic (no canvas), so
// the preview, every export path, the CMS and Node tests share it; watermarkRender.mjs draws
// a layout. The mark's text, typography and proportions are fixed by DESIGN: settings choose
// only whether it is drawn, where, how large, how opaque and in which colour variant, so the
// brand looks the same on every photograph.
//
// Units: the layout is computed in pixels of the output frame (after crop, rotation and the
// export's resize), from its width and height only, so the mark keeps its place and share of
// the picture at any export size; the preview computes it for its own pixel size the same way.
// Glyph advances are those of the bundled Schibsted Grotesk (OFL 1.1, text/fonts.mjs) at the
// weights used, measured in Chromium, Firefox and WebKit (they agree to 0.01/1000 em), so text
// positions never depend on the browser; only glyph rasterisation (anti-aliasing) does.

export const WATERMARK_PRESET = 'huynh-photography';
export const WATERMARK_PRESET_LABEL = 'HUYNH Photography';

/**
 * The approved mark, in units of the HUYNH font size `s`. Lines are centred; `tracking` is
 * the space added between letters (em of the line), not after the last one. `gapBefore` is
 * the space from the previous line's baseline to this line's cap top. Rules flank the second
 * line and reach the width of the first; the border and rules share one stroke width.
 */
export const DESIGN = Object.freeze({
  font: 'sans',
  capHeight: 0.703,
  descender: 0.203,
  lines: Object.freeze([
    Object.freeze({ id: 'name', text: 'HUYNH', weight: 800, size: 1, tracking: 0.16, gapBefore: 0 }),
    Object.freeze({ id: 'title', text: 'PHOTOGRAPHY', weight: 500, size: 0.27, tracking: 0.32, gapBefore: 0.36 }),
    Object.freeze({ id: 'site', text: 'quanghuynh.com', weight: 500, size: 0.22, tracking: 0.1, gapBefore: 0.26 }),
  ]),
  padding: Object.freeze({ x: 0.55, top: 0.42, bottom: 0.42 }),
  stroke: 0.035,
  rule: Object.freeze({ gap: 0.2, min: 0.25 }),
  colors: Object.freeze({ white: '#ffffff', dark: '#1f1f22' }),
});

// Advance widths in 1/1000 em (Schibsted Grotesk variable, latin subset).
const ADVANCES = {
  500: { P: 630.37, H: 729, O: 769.04, T: 655.76, G: 721.19, R: 647.95, A: 710.45, Y: 632.81, q: 600.1, u: 590.82, a: 563.48, n: 590.82, g: 561.52, h: 577.15, y: 564.45, '.': 286.62, c: 559.57, o: 600.59, m: 883.3 },
  800: { H: 766.6, U: 735.84, Y: 673.34, N: 783.2 },
};

export const WATERMARK_POSITIONS = Object.freeze([
  { id: 'bottom-right', label: 'Bottom right' },
  { id: 'bottom-left', label: 'Bottom left' },
  { id: 'top-right', label: 'Top right' },
  { id: 'top-left', label: 'Top left' },
  { id: 'center', label: 'Center' },
].map(Object.freeze));
export const WATERMARK_COLORS = Object.freeze([
  { id: 'white', label: 'White' },
  { id: 'dark', label: 'Charcoal' },
  { id: 'auto', label: 'Auto' },
].map(Object.freeze));

export const WATERMARK_LIMITS = Object.freeze({
  size: Object.freeze([0.04, 0.3]),
  opacity: Object.freeze([0.05, 1]),
  margin: Object.freeze([0, 0.15]),
  // The mark never covers more than this share of the frame's width or height.
  maxWidth: 0.5,
  maxHeight: 0.3,
  // Below this width (output pixels) the web address would be under ~7 px tall.
  minWidthPx: 180,
});

/** The approved defaults: bottom right, about 11% of a 3:2 frame's width, 65% white. */
export const WATERMARK_DEFAULTS = Object.freeze({
  enabled: true,
  preset: WATERMARK_PRESET,
  position: 'bottom-right',
  size: 0.11,
  opacity: 0.65,
  color: 'white',
  margin: 0.025,
  border: true,
  rules: true,
});

const SETTING_KEYS = Object.keys(WATERMARK_DEFAULTS);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const clamp = (value, [min, max], fallback) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback);
const round = (value, digits) => Number(value.toFixed(digits)) + 0;

/**
 * Watermark settings from untrusted input, or null when there are none. Unknown presets and
 * fields are refused or dropped; numbers are clamped, so no value can make the mark huge.
 */
export function normalizeWatermark(input) {
  if (!isObject(input)) return null;
  if (input.preset !== undefined && input.preset !== WATERMARK_PRESET) return null;
  return {
    enabled: input.enabled === true,
    preset: WATERMARK_PRESET,
    position: WATERMARK_POSITIONS.some(({ id }) => id === input.position) ? input.position : WATERMARK_DEFAULTS.position,
    size: round(clamp(input.size, WATERMARK_LIMITS.size, WATERMARK_DEFAULTS.size), 4),
    opacity: round(clamp(input.opacity, WATERMARK_LIMITS.opacity, WATERMARK_DEFAULTS.opacity), 3),
    color: WATERMARK_COLORS.some(({ id }) => id === input.color) ? input.color : WATERMARK_DEFAULTS.color,
    margin: round(clamp(input.margin, WATERMARK_LIMITS.margin, WATERMARK_DEFAULTS.margin), 4),
    border: input.border !== false,
    rules: input.rules !== false,
  };
}

export const watermarkActive = (settings) => Boolean(settings?.enabled);

export const watermarksEqual = (a, b) => (a === null || b === null ? a === b : SETTING_KEYS.every((key) => a[key] === b[key]));

/** Fields of `settings` that differ from `base` (the CMS shows these as the photo's overrides). */
export const watermarkOverrides = (settings, base) => (settings && base ? SETTING_KEYS.filter((key) => key !== 'enabled' && settings[key] !== base[key]) : []);

// Portable watermark configuration: a small file of its own, separate from QuangEdit Recipes
// (reusable photographic adjustments), so branding never travels inside a recipe.
export const WATERMARK_CONFIG_TYPE = 'quanghuynh.watermark';
export const WATERMARK_CONFIG_VERSION = 1;
export const MAX_WATERMARK_CONFIG_BYTES = 16 * 1024;

export class WatermarkConfigError extends Error {}

export const createWatermarkConfig = (settings, name = WATERMARK_PRESET_LABEL) => ({
  type: WATERMARK_CONFIG_TYPE,
  version: WATERMARK_CONFIG_VERSION,
  name: String(name).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80) || WATERMARK_PRESET_LABEL,
  settings: { ...normalizeWatermark({ ...settings }), enabled: true },
});

export const serializeWatermarkConfig = (settings, name) => `${JSON.stringify(createWatermarkConfig(settings, name), null, 2)}\n`;

/** Parses a watermark configuration file; throws WatermarkConfigError with a readable message. */
export function parseWatermarkConfig(text) {
  if (typeof text !== 'string' || text.length > MAX_WATERMARK_CONFIG_BYTES) throw new WatermarkConfigError('A watermark file is plain JSON of at most 16 KB.');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new WatermarkConfigError('The watermark file is not valid JSON.');
  }
  if (!isObject(data) || data.type !== WATERMARK_CONFIG_TYPE) throw new WatermarkConfigError(`This is not a watermark file (type "${WATERMARK_CONFIG_TYPE}").`);
  if (data.version !== WATERMARK_CONFIG_VERSION) throw new WatermarkConfigError(`The watermark file is version ${JSON.stringify(data.version)}; this editor reads version ${WATERMARK_CONFIG_VERSION}.`);
  if (!isObject(data.settings) || (data.settings.preset ?? WATERMARK_PRESET) !== WATERMARK_PRESET) throw new WatermarkConfigError(`The watermark file must use the ${WATERMARK_PRESET_LABEL} preset.`);
  return { name: typeof data.name === 'string' ? data.name.slice(0, 80) : WATERMARK_PRESET_LABEL, settings: normalizeWatermark({ ...data.settings, enabled: true }) };
}

/** Width of a line in units of `s`: advances plus tracking between letters. */
export function lineWidth(line) {
  const table = ADVANCES[line.weight];
  const chars = [...line.text];
  const advance = chars.reduce((sum, char) => sum + table[char], 0) / 1000;
  return line.size * (advance + line.tracking * (chars.length - 1));
}

/** The mark's size in units of `s` and its parts, independent of any output. */
function markUnits() {
  const [name, title, site] = DESIGN.lines;
  const widths = DESIGN.lines.map(lineWidth);
  const content = Math.max(widths[0], widths[2], widths[1] + 2 * (DESIGN.rule.gap + DESIGN.rule.min));
  const width = content + 2 * DESIGN.padding.x;
  const baselines = [];
  let y = DESIGN.padding.top;
  DESIGN.lines.forEach((line, i) => {
    y += (i ? line.gapBefore : 0) + line.size * DESIGN.capHeight;
    baselines.push(y);
  });
  const height = baselines[2] + DESIGN.padding.bottom;
  return { width, height, widths, baselines, lines: [name, title, site] };
}
const UNITS = markUnits();
/** Width / height of the mark (about 2.2). */
export const MARK_ASPECT = UNITS.width / UNITS.height;

/**
 * Where and how large the mark is drawn on an output of `width` × `height` pixels.
 * Size: the mark covers the same share of the picture's area at any aspect ratio (its width
 * is `size` of the frame width on a 3:2 landscape, `size` × √(1.5·W·H) in general), at least
 * minWidthPx and at most maxWidth / maxHeight of the frame. Margins are equal on both axes
 * (`margin` × √(W·H)). With `snap`, the box and strokes fall on whole pixels, so the border
 * is crisp at every resolution. `scale` draws that same layout on a canvas `scale` times the
 * output's size (the preview at screen resolution): sizes are decided in output pixels first.
 * :returns: { s, x, y, width, height, stroke, lines: [{ text, weight, px, tracking, x, baseline, advances }], rules: [{ x, y, width, height }] }
 *   in output pixels, text `x` the left edge of the first letter
 */
export function layoutWatermark(settings, width, height, { snap = true, scale = 1 } = {}) {
  const area = Math.sqrt(width * height);
  let markWidth = Math.max(settings.size * Math.sqrt(1.5) * area, WATERMARK_LIMITS.minWidthPx);
  markWidth = Math.min(markWidth, width * WATERMARK_LIMITS.maxWidth, height * WATERMARK_LIMITS.maxHeight * MARK_ASPECT);
  const s = (markWidth / UNITS.width) * scale;
  const pixel = (value) => (snap ? Math.round(value) : value);
  const boxWidth = Math.max(1, pixel(UNITS.width * s));
  const boxHeight = Math.max(1, pixel(UNITS.height * s));
  const margin = settings.margin * area * scale;
  const [vertical, horizontal = 'center'] = settings.position === 'center' ? ['center'] : settings.position.split('-');
  const place = (side, total, box) => {
    if (side === 'center') return (total - box) / 2;
    const at = side === 'left' || side === 'top' ? margin : total - margin - box;
    return Math.min(Math.max(0, at), Math.max(0, total - box));
  };
  const x = pixel(place(horizontal, width * scale, boxWidth));
  const y = pixel(place(vertical, height * scale, boxHeight));
  const stroke = snap ? Math.max(1, Math.round(DESIGN.stroke * s)) : DESIGN.stroke * s;
  const ky = boxHeight / UNITS.height;
  const lines = UNITS.lines.map((line, i) => {
    const px = line.size * s;
    const table = ADVANCES[line.weight];
    return {
      id: line.id,
      text: line.text,
      weight: line.weight,
      px,
      tracking: line.tracking * px,
      advances: [...line.text].map((char) => (table[char] / 1000) * px),
      x: x + boxWidth / 2 - (UNITS.widths[i] * s) / 2,
      baseline: y + UNITS.baselines[i] * ky,
    };
  });
  const rules = [];
  if (settings.rules) {
    const title = lines[1];
    const textWidth = UNITS.widths[1] * s;
    const reach = (Math.max(UNITS.widths[0], UNITS.widths[2]) * s - textWidth) / 2 - DESIGN.rule.gap * s;
    const length = Math.max(DESIGN.rule.min * s, reach);
    const centre = title.baseline - (title.px * DESIGN.capHeight) / 2;
    const top = pixel(centre - stroke / 2);
    const gap = DESIGN.rule.gap * s;
    rules.push({ x: title.x - gap - length, y: top, width: length, height: stroke });
    rules.push({ x: title.x + textWidth + gap, y: top, width: length, height: stroke });
  }
  return { s, x, y, width: boxWidth, height: boxHeight, stroke, border: settings.border, lines, rules };
}

/** Relative luminance (0–1) of an sRGB channel value 0–255, linearised. */
const LINEAR = Array.from({ length: 256 }, (_, v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

// Above this mean linear luminance (sRGB ≈ 0.55, L* ≈ 58) the charcoal variant reads better.
export const AUTO_THRESHOLD = 0.26;

/**
 * Mean and spread of the luminance behind a box, from straight RGBA8 pixels, weighting each
 * pixel by its alpha (a transparent backdrop counts as dark). Samples at most ~40 000 pixels.
 * :param image: { width, height, data } covering the region `box` ({ x, y, width, height }) of
 *   the frame, or the whole frame when `box` is omitted
 */
export function regionLuminance(image, box = { x: 0, y: 0, width: image.width, height: image.height }) {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(image.width, Math.ceil(box.x + box.width));
  const y1 = Math.min(image.height, Math.ceil(box.y + box.height));
  const step = Math.max(1, Math.round(Math.sqrt(((x1 - x0) * (y1 - y0)) / 40000)));
  let sum = 0;
  let squares = 0;
  let count = 0;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = (y * image.width + x) * 4;
      const alpha = image.data[i + 3] / 255;
      const value = alpha * (0.2126 * LINEAR[image.data[i]] + 0.7152 * LINEAR[image.data[i + 1]] + 0.0722 * LINEAR[image.data[i + 2]]);
      sum += value;
      squares += value * value;
      count += 1;
    }
  }
  if (!count) return { mean: 0, spread: 0 };
  const mean = sum / count;
  return { mean, spread: Math.sqrt(Math.max(0, squares / count - mean * mean)) };
}

/** The colour variant for `settings` over a backdrop of mean luminance `mean` (auto chooses). */
export const resolveWatermarkColor = (settings, mean = 0) => (settings.color === 'auto' ? (mean > AUTO_THRESHOLD ? 'dark' : 'white') : settings.color);

/** The region auto colour reads: the box plus one stroke around it. */
export const sampleBox = (layout) => ({ x: layout.x - layout.stroke, y: layout.y - layout.stroke, width: layout.width + 2 * layout.stroke, height: layout.height + 2 * layout.stroke });

/** Mean gradient magnitude of luminance (0–1 per pixel) in a box, on every `step`-th pixel. */
function busyness(image, box, step) {
  const lum = (x, y) => {
    const i = (y * image.width + x) * 4;
    return 0.2126 * LINEAR[image.data[i]] + 0.7152 * LINEAR[image.data[i + 1]] + 0.0722 * LINEAR[image.data[i + 2]];
  };
  const x0 = Math.max(1, Math.floor(box.x));
  const y0 = Math.max(1, Math.floor(box.y));
  const x1 = Math.min(image.width - 1, Math.ceil(box.x + box.width));
  const y1 = Math.min(image.height - 1, Math.ceil(box.y + box.height));
  let sum = 0;
  let count = 0;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      sum += Math.abs(lum(x + 1, y) - lum(x - 1, y)) + Math.abs(lum(x, y + 1) - lum(x, y - 1));
      count += 1;
    }
  }
  return count ? sum / count : 0;
}

// A region this much busier than the whole picture, or this busy outright, is flagged.
const BUSY_RATIO = 1.25;
const BUSY_ABSOLUTE = 0.06;

/**
 * Placement heuristic for review (not subject detection): how much detail and contrast lie
 * behind the mark at each corner of a (small) rendition of the photo. A corner much busier
 * than the picture as a whole likely holds part of the subject, text or other detail, and
 * mid-grey backdrops with high spread read poorly in either colour; both are flagged for
 * manual review, with the calmest corner suggested.
 * :param image: straight RGBA8 { width, height, data } of the whole output frame
 * :returns: { position, flags: ['busy' | 'low-contrast'], busy, overall, luminance, suggestion }
 */
export function placementReport(image, settings) {
  const step = Math.max(1, Math.round(Math.sqrt((image.width * image.height) / 250000)));
  const overall = busyness(image, { x: 0, y: 0, width: image.width, height: image.height }, step);
  const measure = (position) => {
    const layout = layoutWatermark({ ...settings, position }, image.width, image.height, { snap: false });
    const box = sampleBox(layout);
    return { position, busy: busyness(image, box, step), luminance: regionLuminance(image, box) };
  };
  const current = measure(settings.position);
  const flags = [];
  if (current.busy > Math.max(BUSY_ABSOLUTE, overall * BUSY_RATIO)) flags.push('busy');
  const { mean, spread } = current.luminance;
  if (Math.abs(mean - AUTO_THRESHOLD) < 0.08 && spread > 0.12) flags.push('low-contrast');
  const corners = WATERMARK_POSITIONS.filter(({ id }) => id !== 'center').map(({ id }) => (id === settings.position ? current : measure(id)));
  const calmest = corners.reduce((best, entry) => (entry.busy < best.busy ? entry : best));
  return {
    position: settings.position,
    flags,
    busy: current.busy,
    overall,
    luminance: current.luminance,
    suggestion: flags.length && calmest.position !== settings.position ? calmest.position : null,
  };
}
