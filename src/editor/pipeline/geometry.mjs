// Geometry: crop, rotation, flips, perspective, stretch and resize as parameters. A photo's
// pixels are never changed; every render (preview, CPU fallback, Detail, 1:1, export) maps
// each output pixel back to the source through one 3×3 matrix built here, so the preview
// and the export cannot disagree about where a pixel comes from.
//
// Forward order, source to output (all at the photo's native size):
//   1. Orient   quarter turns clockwise, then flips, in the turned frame. Exact.
//   2. Rotate   `angle` degrees clockwise about the frame centre; the frame keeps its size,
//               so rotated corners leave empty areas (cropped by `constrain`).
//   3. Perspective  a homography taking a quad of the rotated frame (from the keystone
//               sliders, or four corners) onto the whole frame, so it is applied along the
//               straightened axes.
//   4. Stretch  the frame scaled by stretch.x and stretch.y, normalised so the larger is 1:
//               proportions change, the output never gains pixels.
//   5. Crop     `crop` in normalised coordinates of the stretched frame (0–1, origin top
//               left), snapped to whole native pixels.
//   6. Resize   `resize` fits the crop within width × height (never upscales); unlocked, it
//               scales each axis to its own size (distorts).
// Export resize (Export panel) applies after this, to the geometry's output size.
// Pixel coordinates are continuous: pixel (i, j) covers [i, i + 1) × [j, j + 1), so its
// centre is (i + 0.5, j + 0.5).

export const ANGLE_LIMIT = 45;
export const ANGLE_STEP = 0.05;
export const STRETCH_LIMITS = Object.freeze({ min: 50, max: 200 });
/** Fraction of an edge the keystone sliders shorten at ±100. */
export const KEYSTONE_MAX = 0.4;
/** Smallest crop side, as a fraction of the frame. */
export const MIN_CROP = 0.01;
export const BACKGROUNDS = Object.freeze(['transparent', 'white', 'black']);
export const MAX_OUTPUT_SIDE = 16_384;

export const ASPECT_PRESETS = Object.freeze([
  { id: 'free', label: 'Freeform' },
  { id: 'original', label: 'Original' },
  { id: '1:1', label: '1:1' },
  { id: '4:3', label: '4:3' },
  { id: '3:2', label: '3:2' },
  { id: '16:9', label: '16:9' },
  { id: '5:4', label: '5:4' },
  { id: '9:16', label: '9:16' },
  { id: '4:5', label: '4:5' },
].map(Object.freeze));

const ASPECT_PATTERN = /^(\d{1,4}(?:\.\d{1,2})?):(\d{1,4}(?:\.\d{1,2})?)$/;

export const neutralGeometry = () => ({
  quarterTurns: 0,
  flipH: false,
  flipV: false,
  angle: 0,
  perspective: { vertical: 0, horizontal: 0 },
  quad: null,
  stretch: { x: 100, y: 100 },
  crop: null,
  aspect: 'free',
  constrain: true,
  background: 'transparent',
  resize: null,
});

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const round = (value, digits) => Number(value.toFixed(digits)) + 0;

/** 'w:h' with both sides in (0, 1000], or null. */
export function parseAspect(aspect) {
  const match = typeof aspect === 'string' ? ASPECT_PATTERN.exec(aspect) : null;
  if (!match) return null;
  const [w, h] = [Number(match[1]), Number(match[2])];
  return w > 0 && h > 0 && w <= 1000 && h <= 1000 ? { w, h } : null;
}

const normalizeAspect = (aspect) => (aspect === 'free' || aspect === 'original' || parseAspect(aspect) ? aspect : 'free');

function normalizeCrop(crop) {
  if (!isObject(crop)) return null;
  const values = ['x', 'y', 'width', 'height'].map((key) => finite(crop[key], NaN));
  if (values.some(Number.isNaN)) return null;
  const x = clamp(values[0], 0, 1 - MIN_CROP);
  const y = clamp(values[1], 0, 1 - MIN_CROP);
  const width = clamp(values[2], MIN_CROP, 1 - x);
  const height = clamp(values[3], MIN_CROP, 1 - y);
  const rect = { x: round(x, 6), y: round(y, 6), width: round(width, 6), height: round(height, 6) };
  return rect.x === 0 && rect.y === 0 && rect.width === 1 && rect.height === 1 ? null : rect;
}

/** Four [x, y] corners (top left, top right, bottom right, bottom left) inside the frame, or null. */
function normalizeQuad(quad) {
  if (!Array.isArray(quad) || quad.length !== 4) return null;
  const points = quad.map((point) => (Array.isArray(point) && point.length === 2 ? point.map((v) => finite(v, NaN)) : [NaN, NaN]));
  if (points.flat().some(Number.isNaN)) return null;
  const clamped = points.map(([x, y]) => [round(clamp(x, 0, 1), 6), round(clamp(y, 0, 1), 6)]);
  if (!quadIsUsable(clamped)) return null;
  const unit = [[0, 0], [1, 0], [1, 1], [0, 1]];
  return clamped.every(([x, y], i) => x === unit[i][0] && y === unit[i][1]) ? null : clamped;
}

function normalizeResize(resize) {
  if (!isObject(resize)) return null;
  const width = Math.round(finite(resize.width, NaN));
  const height = Math.round(finite(resize.height, NaN));
  if (!(width >= 1 && height >= 1)) return null;
  return { width: Math.min(width, MAX_OUTPUT_SIDE), height: Math.min(height, MAX_OUTPUT_SIDE), locked: resize.locked !== false };
}

/** Validated geometry from untrusted input: values clamped, malformed parts neutral, unknown keys dropped. */
export function normalizeGeometry(input) {
  const source = isObject(input) ? input : {};
  const neutral = neutralGeometry();
  const perspective = isObject(source.perspective) ? source.perspective : {};
  const stretch = isObject(source.stretch) ? source.stretch : {};
  return {
    quarterTurns: ((Math.round(finite(source.quarterTurns, 0)) % 4) + 4) % 4,
    flipH: source.flipH === true,
    flipV: source.flipV === true,
    angle: round(clamp(Math.round(finite(source.angle, 0) / ANGLE_STEP) * ANGLE_STEP, -ANGLE_LIMIT, ANGLE_LIMIT), 2),
    perspective: {
      vertical: clamp(Math.round(finite(perspective.vertical, 0)), -100, 100),
      horizontal: clamp(Math.round(finite(perspective.horizontal, 0)), -100, 100),
    },
    quad: normalizeQuad(source.quad),
    stretch: {
      x: clamp(Math.round(finite(stretch.x, 100)), STRETCH_LIMITS.min, STRETCH_LIMITS.max),
      y: clamp(Math.round(finite(stretch.y, 100)), STRETCH_LIMITS.min, STRETCH_LIMITS.max),
    },
    crop: normalizeCrop(source.crop),
    aspect: normalizeAspect(source.aspect ?? neutral.aspect),
    constrain: source.constrain !== false,
    background: BACKGROUNDS.includes(source.background) ? source.background : neutral.background,
    resize: normalizeResize(source.resize),
  };
}

const quadEqual = (a, b) => (a === null || b === null ? a === b : a.every((point, i) => point[0] === b[i][0] && point[1] === b[i][1]));
const cropEqual = (a, b) => (a === null || b === null ? a === b : a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);
const resizeEqual = (a, b) => (a === null || b === null ? a === b : a.width === b.width && a.height === b.height && a.locked === b.locked);

export const geometryEqual = (a, b) => a.quarterTurns === b.quarterTurns && a.flipH === b.flipH && a.flipV === b.flipV
  && a.angle === b.angle && a.perspective.vertical === b.perspective.vertical && a.perspective.horizontal === b.perspective.horizontal
  && quadEqual(a.quad, b.quad) && a.stretch.x === b.stretch.x && a.stretch.y === b.stretch.y && cropEqual(a.crop, b.crop)
  && a.aspect === b.aspect && a.constrain === b.constrain && a.background === b.background && resizeEqual(a.resize, b.resize);

/** True when the geometry changes no pixel (aspect, constrain and background alone change nothing). */
export const geometryNeutral = (g) => !g.quarterTurns && !g.flipH && !g.flipV && !g.angle && !g.perspective.vertical
  && !g.perspective.horizontal && !g.quad && g.stretch.x === 100 && g.stretch.y === 100 && !g.crop && !g.resize;

/** Saved form: only what differs from neutral (null when nothing does). */
export function compactGeometry(geometry) {
  const g = normalizeGeometry(geometry);
  const neutral = neutralGeometry();
  const out = {};
  Object.keys(neutral).forEach((key) => {
    if (JSON.stringify(g[key]) !== JSON.stringify(neutral[key])) out[key] = g[key];
  });
  return Object.keys(out).length ? out : null;
}

// ---------------------------------------------------------------------------------------
// 3×3 matrices, row-major [a, b, c, d, e, f, g, h, i]; points are column vectors.

export const IDENTITY3 = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]);

export function multiply3(a, b) {
  const out = new Array(9);
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  }
  return out;
}

/** Inverse, or null when the matrix is singular or too badly conditioned to trust. */
export function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const scale = Math.max(...m.map(Math.abs));
  if (!Number.isFinite(det) || scale === 0 || Math.abs(det) < 1e-12 * scale ** 3) return null;
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
}

/** Applies a homography to (x, y): [x', y', w] before the division. */
export function project(m, x, y) {
  const w = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w, w];
}

const scale3 = (sx, sy) => [sx, 0, 0, 0, sy, 0, 0, 0, 1];
const translate3 = (tx, ty) => [1, 0, tx, 0, 1, ty, 0, 0, 1];

/** Homography taking four points `from` onto four points `to` (8×8 solve, partial pivoting), or null. */
export function homography(from, to) {
  const rows = [];
  for (let k = 0; k < 4; k += 1) {
    const [x, y] = from[k];
    const [u, v] = to[k];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let col = 0; col < 8; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < 8; r += 1) if (Math.abs(rows[r][col]) > Math.abs(rows[pivot][col])) pivot = r;
    if (Math.abs(rows[pivot][col]) < 1e-12) return null;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    for (let r = 0; r < 8; r += 1) {
      if (r === col) continue; // eslint-disable-line no-continue
      const factor = rows[r][col] / rows[col][col];
      for (let c = col; c < 9; c += 1) rows[r][c] -= factor * rows[col][c];
    }
  }
  const h = rows.map((row, r) => row[8] / row[r]);
  const m = [...h, 1];
  return m.every(Number.isFinite) ? m : null;
}

// ---------------------------------------------------------------------------------------
// Quads and the keystone sliders.

const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Convex, clockwise in image coordinates (y down), and not degenerate: area ≥ 0.2, angles 15°–165°. */
export function quadIsUsable(quad) {
  let area = 0;
  for (let i = 0; i < 4; i += 1) {
    const [a, b, c] = [quad[i], quad[(i + 1) % 4], quad[(i + 2) % 4]];
    if (cross(a, b, c) <= 0) return false;
    const u = [a[0] - b[0], a[1] - b[1]];
    const v = [c[0] - b[0], c[1] - b[1]];
    const cos = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v));
    if (!(Math.abs(cos) < Math.cos((15 * Math.PI) / 180))) return false;
    area += quad[i][0] * b[1] - b[0] * quad[i][1];
  }
  return area / 2 >= 0.2;
}

/**
 * The quad of the rotated frame that the keystone sliders map onto the whole frame.
 * Vertical +: the top edge of the quad is shorter, so the top of the photo widens
 * (verticals converging upwards become parallel); −: the bottom. Horizontal +: the left
 * edge is shorter (the left side grows); −: the right.
 */
export function keystoneQuad(vertical, horizontal) {
  const a = (Math.abs(vertical) / 100) * KEYSTONE_MAX / 2;
  const b = (Math.abs(horizontal) / 100) * KEYSTONE_MAX / 2;
  const quad = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const [top, bottom] = vertical >= 0 ? [a, 0] : [0, a];
  const [left, right] = horizontal >= 0 ? [b, 0] : [0, b];
  quad[0][0] += top; quad[1][0] -= top; quad[3][0] += bottom; quad[2][0] -= bottom;
  quad[0][1] += left; quad[3][1] -= left; quad[1][1] += right; quad[2][1] -= right;
  return quad;
}

export const perspectiveQuad = (g) => g.quad ?? keystoneQuad(g.perspective.vertical, g.perspective.horizontal);

// ---------------------------------------------------------------------------------------
// The plan: sizes and matrices for one photo.

/** Source px → oriented px (quarter turns clockwise, then flips) for a W × H source. */
function orientMatrix(turns, flipH, flipV, width, height) {
  const [w0, h0] = turns % 2 ? [height, width] : [width, height];
  const turn = [IDENTITY3, [0, -1, height, 1, 0, 0, 0, 0, 1], [-1, 0, width, 0, -1, height, 0, 0, 1], [0, 1, 0, -1, 0, width, 0, 0, 1]][turns];
  const flip = [flipH ? -1 : 1, 0, flipH ? w0 : 0, 0, flipV ? -1 : 1, flipV ? h0 : 0, 0, 0, 1];
  return { matrix: multiply3(flip, turn), width: w0, height: h0 };
}

const rotationMatrix = (degrees, cx, cy) => {
  const t = (degrees * Math.PI) / 180;
  const [c, s] = [Math.cos(t), Math.sin(t)];
  // Clockwise on screen (y down) for positive angles.
  return multiply3(translate3(cx, cy), multiply3([c, -s, 0, s, c, 0, 0, 0, 1], translate3(-cx, -cy)));
};

export class GeometryError extends Error {}

const insideRect = (rect, [x, y], tolerance = 1e-9) => x >= rect.x - tolerance && y >= rect.y - tolerance && x <= rect.x + rect.width + tolerance && y <= rect.y + rect.height + tolerance;

/** True when a point lies in a convex clockwise quad (with a small tolerance). */
export function insideQuad(quad, point, tolerance = 1e-9) {
  for (let i = 0; i < 4; i += 1) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    if (cross(a, b, point) / length < -tolerance) return false;
  }
  return true;
}

export const rectCorners = ({ x, y, width, height }) => [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
export const rectInsideQuad = (rect, quad, tolerance = 1e-9) => rectCorners(rect).every((point) => insideQuad(quad, point, tolerance));

/**
 * Sizes and matrices of a photo's geometry.
 * :param geometry: normalised geometry
 * :param size: { width, height } of the oriented original at native resolution
 * :returns: { identity, oriented, frame, crop (px of the frame), cropRect (normalised),
 *   native (output size), content (normalised quad of the frame the image covers),
 *   covered (crop inside content), toSource(out, src) }
 */
export function geometryPlan(geometry, { width, height }) {
  const g = geometry;
  if (geometryNeutral(g)) {
    return {
      identity: true,
      oriented: { width, height },
      frame: { width, height },
      crop: { x: 0, y: 0, width, height },
      cropRect: { x: 0, y: 0, width: 1, height: 1 },
      native: { width, height },
      content: [[0, 0], [1, 0], [1, 1], [0, 1]],
      covered: true,
      background: g.background,
      toSource: (out, src) => scale3(src.width / out.width, src.height / out.height),
    };
  }
  const orient = orientMatrix(g.quarterTurns, g.flipH, g.flipV, width, height);
  const { width: w0, height: h0 } = orient;
  const rotation = rotationMatrix(g.angle, w0 / 2, h0 / 2);
  const quad = perspectiveQuad(g).map(([x, y]) => [x * w0, y * h0]);
  const frameCorners = [[0, 0], [w0, 0], [w0, h0], [0, h0]];
  const perspective = g.quad || g.perspective.vertical || g.perspective.horizontal ? homography(quad, frameCorners) : [...IDENTITY3];
  if (!perspective) throw new GeometryError('The perspective correction is degenerate.');
  // Oriented px → frame px; the image of the oriented rectangle is the content.
  const forward = multiply3(perspective, rotation);
  const projected = frameCorners.map(([x, y]) => project(forward, x, y));
  // The perspective must not send any point of the content to infinity (w stays positive
  // over the oriented rectangle, so also over the frame between them).
  if (projected.some(([, , w]) => !(w > 0.05))) throw new GeometryError('The perspective correction is too strong for this photo.');
  const content = projected.map(([x, y]) => [x / w0, y / h0]);
  const m = Math.max(g.stretch.x, g.stretch.y);
  const frame = {
    width: Math.max(1, Math.round((w0 * g.stretch.x) / m)),
    height: Math.max(1, Math.round((h0 * g.stretch.y) / m)),
  };
  // Whole native pixels, rounded inwards (so a crop inside the photo stays inside it), with
  // 0.02 px of slack for the 6-decimal rounding of saved crops.
  const cropRect = g.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const inward = (from, length, size) => {
    const start = Math.min(size - 1, Math.max(0, Math.ceil(from * size - 0.02)));
    const end = Math.min(size, Math.floor((from + length) * size + 0.02));
    return [start, Math.max(1, end - start)];
  };
  const [cx, cw] = inward(cropRect.x, cropRect.width, frame.width);
  const [cy, ch] = inward(cropRect.y, cropRect.height, frame.height);
  const crop = { x: cx, y: cy, width: Math.min(cw, frame.width - cx), height: Math.min(ch, frame.height - cy) };
  let native = { width: crop.width, height: crop.height };
  if (g.resize) {
    if (g.resize.locked) {
      const s = Math.min(1, g.resize.width / crop.width, g.resize.height / crop.height);
      native = { width: Math.max(1, Math.round(crop.width * s)), height: Math.max(1, Math.round(crop.height * s)) };
    } else {
      native = { width: Math.min(crop.width, g.resize.width), height: Math.min(crop.height, g.resize.height) };
    }
  }
  // Frame px → oriented px → source px.
  const backward = invert3(forward);
  const unorient = invert3(orient.matrix);
  if (!backward || !unorient) throw new GeometryError('The transform cannot be inverted.');
  const frameToSource = multiply3(unorient, multiply3(backward, scale3(w0 / frame.width, h0 / frame.height)));
  const croppedRect = { x: crop.x / frame.width, y: crop.y / frame.height, width: crop.width / frame.width, height: crop.height / frame.height };
  return {
    identity: false,
    oriented: { width: w0, height: h0 },
    frame,
    crop,
    cropRect: croppedRect,
    native,
    content,
    covered: rectInsideQuad(croppedRect, content, 1e-6),
    background: g.background,
    /**
     * Output px → source px for a render of `out` ({ width, height }) from a source image of
     * `src` size (the original or a proxy of it, same proportions).
     */
    toSource(out, src) {
      const outToCrop = multiply3(translate3(crop.x, crop.y), scale3(crop.width / out.width, crop.height / out.height));
      return multiply3(scale3(src.width / width, src.height / height), multiply3(frameToSource, outToCrop));
    },
  };
}

/** The same geometry without its crop and resize: the whole transformed frame (crop tool view). */
export const frameGeometry = (geometry) => ({ ...geometry, crop: null, resize: null });

/**
 * Output size of an export: the geometry's output, then the export resize (never upscaled),
 * capped at MAX_OUTPUT_SIDE per side.
 */
export function outputSize(plan, exportSize) {
  const size = exportSize(plan.native);
  const s = Math.min(1, MAX_OUTPUT_SIDE / Math.max(size.width, size.height));
  return s < 1 ? { width: Math.max(1, Math.round(size.width * s)), height: Math.max(1, Math.round(size.height * s)) } : { width: size.width, height: size.height };
}

/** Smaller singular value of the 2×2 Jacobian of `m` at output point (x, y). */
function minStretchAt(m, x, y) {
  const [x0, y0] = project(m, x, y);
  const [x1, y1] = project(m, x + 1, y);
  const [x2, y2] = project(m, x, y + 1);
  const [a, b, c, d] = [x1 - x0, x2 - x0, y1 - y0, y2 - y0];
  const s = a * a + b * b + c * c + d * d;
  const det = a * d - b * c;
  return Math.sqrt(Math.max(0, (s - Math.sqrt(Math.max(0, s * s - 4 * det * det))) / 2));
}

/**
 * Size at which to decode the original for an output: as small as possible while every
 * output pixel still has at least one source pixel in each direction (the smallest
 * stretch of the transform over the output's corners and centre), never above the original.
 * Decoding smaller lets the browser or LibRaw downscale with area averaging; the warp then
 * resamples at about 1:1.
 */
export function decodeSize(plan, output, source) {
  const m = plan.toSource(output, source);
  const points = [[0, 0], [output.width - 1, 0], [0, output.height - 1], [output.width - 1, output.height - 1], [output.width / 2, output.height / 2]];
  const least = Math.min(...points.map(([x, y]) => minStretchAt(m, x, y)));
  const scale = least > 0 ? Math.min(1, 1 / least) : 1;
  return { width: Math.max(1, Math.round(source.width * scale)), height: Math.max(1, Math.round(source.height * scale)) };
}

/** Source px per output px near the output centre (for edge coverage). */
export function sourcePixelsPerOutput(matrix, out) {
  const [cx, cy] = [out.width / 2, out.height / 2];
  const [x0, y0] = project(matrix, cx, cy);
  const [x1, y1] = project(matrix, cx + 1, cy);
  const [x2, y2] = project(matrix, cx, cy + 1);
  return Math.sqrt(Math.abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0))) || 1;
}

// ---------------------------------------------------------------------------------------
// Crop rectangles: aspect ratios, constraints, dragging.

/**
 * The ratio a crop must keep, as width / height in normalised frame units, or null (free).
 * :param aspect: 'free' | 'original' | 'w:h'
 * :param frame: the stretched frame size in px; `original` is the uncropped frame's ratio
 */
export function cropRatio(aspect, frame) {
  if (aspect === 'free') return null;
  if (aspect === 'original') return 1;
  const parsed = parseAspect(aspect);
  return parsed ? (parsed.w / parsed.h) * (frame.height / frame.width) : null;
}

/** The ratio turned the other way ('3:2' ↔ '2:3'); free and original stay. */
export function swapAspect(aspect) {
  const parsed = parseAspect(aspect);
  return parsed ? `${parsed.h}:${parsed.w}` : aspect;
}

const UNIT_QUAD = Object.freeze([[0, 0], [1, 0], [1, 1], [0, 1]]);

/** True when a crop is allowed: inside the frame, and inside the content when constrained. */
export function cropAllowed(rect, content = null) {
  if (rect.width < MIN_CROP - 1e-9 || rect.height < MIN_CROP - 1e-9) return false;
  if (!rectInsideQuad(rect, UNIT_QUAD, 1e-9)) return false;
  return !content || rectInsideQuad(rect, content, 1e-9);
}

const scaled = (rect, s, [ax, ay]) => ({ x: ax + (rect.x - ax) * s, y: ay + (rect.y - ay) * s, width: rect.width * s, height: rect.height * s });

/** Largest scale in [0, 1] of `rect` about `anchor` that is allowed (bisection). */
function shrinkToFit(rect, anchor, content) {
  if (cropAllowed(rect, content)) return rect;
  let [low, high] = [0, 1];
  for (let i = 0; i < 40; i += 1) {
    const mid = (low + high) / 2;
    if (cropAllowed(scaled(rect, mid, anchor), content)) low = mid; else high = mid;
  }
  return scaled(rect, low, anchor);
}

const centroid = (quad) => [quad.reduce((s, p) => s + p[0], 0) / 4, quad.reduce((s, p) => s + p[1], 0) / 4];

/**
 * The largest crop with `ratio` (null: the rect's own) centred as close to `center` as the
 * content allows. Used for crop-to-fill after rotation or perspective changes.
 */
export function fitCrop(rect, ratio, content = null) {
  const r = ratio ?? rect.width / rect.height;
  let center = [rect.x + rect.width / 2, rect.y + rect.height / 2];
  const allowed = (point) => insideQuad(UNIT_QUAD, point) && (!content || insideQuad(content, point));
  if (!allowed(center)) {
    // Move the centre towards the content's centre until it is inside.
    const target = content ? centroid(content) : [0.5, 0.5];
    let [low, high] = [0, 1];
    for (let i = 0; i < 40; i += 1) {
      const mid = (low + high) / 2;
      const point = [center[0] + (target[0] - center[0]) * mid, center[1] + (target[1] - center[1]) * mid];
      if (allowed(point)) high = mid; else low = mid;
    }
    center = [center[0] + (target[0] - center[0]) * high, center[1] + (target[1] - center[1]) * high];
  }
  // Start from the rect's size with the ratio (the larger side kept), then shrink about the centre.
  let width = rect.width;
  let height = width / r;
  if (height > rect.height) { height = rect.height; width = height * r; }
  const start = { x: center[0] - width / 2, y: center[1] - height / 2, width, height };
  const fitted = shrinkToFit(start, center, content);
  return clampRect(fitted);
}

/** The largest crop with `ratio` (null: the frame's) centred on the frame, inside the content. */
export function largestCrop(ratio, content = null) {
  const r = ratio ?? 1;
  const [width, height] = r >= 1 ? [1, 1 / r] : [r, 1];
  return fitCrop({ x: (1 - width) / 2, y: (1 - height) / 2, width, height }, r, content);
}

function clampRect(rect) {
  const width = clamp(rect.width, MIN_CROP, 1);
  const height = clamp(rect.height, MIN_CROP, 1);
  return { x: clamp(rect.x, 0, 1 - width), y: clamp(rect.y, 0, 1 - height), width, height };
}

/** Handles of the crop box: corners, edges and the whole box. */
export const CROP_HANDLES = Object.freeze(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'move']);

/**
 * A crop after dragging one handle by (dx, dy) normalised frame units from `start`.
 * Corners keep the opposite corner fixed; edges keep the opposite edge (and, with a ratio,
 * the centre of the other axis); 'move' translates. With a ratio, the larger relative
 * change wins. The result is kept inside the frame and, when `content` is given, the
 * content, shrinking towards the fixed point (or stopping the move) as needed.
 */
export function dragCrop(start, handle, dx, dy, { ratio = null, content = null } = {}) {
  if (handle === 'move') {
    const moved = (t) => ({ ...start, x: start.x + dx * t, y: start.y + dy * t });
    if (cropAllowed(moved(1), content)) return moved(1);
    // Slide along each axis separately so the box follows the pointer along an edge.
    let rect = start;
    for (const [ax, ay] of [[dx, 0], [0, dy]]) {
      let [low, high] = [0, 1];
      for (let i = 0; i < 40; i += 1) {
        const mid = (low + high) / 2;
        if (cropAllowed({ ...rect, x: rect.x + ax * mid, y: rect.y + ay * mid }, content)) low = mid; else high = mid;
      }
      rect = { ...rect, x: rect.x + ax * low, y: rect.y + ay * low };
    }
    return rect;
  }
  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');
  let left = start.x;
  let right = start.x + start.width;
  let top = start.y;
  let bottom = start.y + start.height;
  if (west) left = Math.min(right - MIN_CROP, left + dx);
  if (east) right = Math.max(left + MIN_CROP, right + dx);
  if (north) top = Math.min(bottom - MIN_CROP, top + dy);
  if (south) bottom = Math.max(top + MIN_CROP, bottom + dy);
  let rect = { x: left, y: top, width: right - left, height: bottom - top };
  let anchor;
  if (ratio) {
    const horizontal = west || east;
    const vertical = north || south;
    let { width, height } = rect;
    const widthLeads = horizontal && (!vertical || Math.abs(width / start.width - 1) >= Math.abs(height / start.height - 1));
    if (widthLeads) height = width / ratio; else width = height * ratio;
    const ax = west ? start.x + start.width : east ? start.x : start.x + start.width / 2;
    const ay = north ? start.y + start.height : south ? start.y : start.y + start.height / 2;
    anchor = [ax, ay];
    rect = {
      x: west ? ax - width : east ? ax : ax - width / 2,
      y: north ? ay - height : south ? ay : ay - height / 2,
      width,
      height,
    };
  } else {
    anchor = [west ? start.x + start.width : east ? start.x : rect.x + rect.width / 2, north ? start.y + start.height : south ? start.y : rect.y + rect.height / 2];
    // Without a ratio, each dragged edge stops at the boundary on its own axis.
    if (!cropAllowed(rect, content)) {
      const edges = { left, right, top, bottom };
      const fixed = { left: start.x, right: start.x + start.width, top: start.y, bottom: start.y + start.height };
      const toRect = (e) => ({ x: e.left, y: e.top, width: e.right - e.left, height: e.bottom - e.top });
      let current = { ...fixed };
      for (const key of ['left', 'right', 'top', 'bottom']) {
        if (edges[key] === fixed[key]) continue; // eslint-disable-line no-continue
        let [low, high] = [0, 1];
        for (let i = 0; i < 40; i += 1) {
          const mid = (low + high) / 2;
          const trial = { ...current, [key]: fixed[key] + (edges[key] - fixed[key]) * mid };
          if (cropAllowed(toRect(trial), content)) low = mid; else high = mid;
        }
        current = { ...current, [key]: fixed[key] + (edges[key] - fixed[key]) * low };
      }
      return toRect(current);
    }
    return rect;
  }
  return shrinkToFit(rect, anchor, content);
}

/** Keyboard step for crop handles and moves, in normalised units. */
export const cropKeyStep = (large) => (large ? 0.05 : 0.005);

// ---------------------------------------------------------------------------------------
// Edits that keep everything else in place. Turning or flipping acts on the result as
// shown: the crop, straighten angle, perspective, stretch, resize and ratio are carried
// into the new orientation, so the same pixels stay inside the crop.

function turnOnce(g) {
  return {
    ...g,
    quarterTurns: (g.quarterTurns + 1) % 4,
    flipH: g.flipV,
    flipV: g.flipH,
    perspective: { vertical: g.perspective.horizontal, horizontal: -g.perspective.vertical },
    quad: g.quad ? [g.quad[3], g.quad[0], g.quad[1], g.quad[2]].map(([x, y]) => [1 - y, x]) : null,
    crop: g.crop ? { x: 1 - g.crop.y - g.crop.height, y: g.crop.x, width: g.crop.height, height: g.crop.width } : null,
    aspect: swapAspect(g.aspect),
    stretch: { x: g.stretch.y, y: g.stretch.x },
    resize: g.resize ? { ...g.resize, width: g.resize.height, height: g.resize.width } : null,
  };
}

/** The geometry turned by `turns` quarter turns clockwise (−1: counterclockwise, 2: 180°). */
export function turnGeometry(geometry, turns) {
  let next = normalizeGeometry(geometry);
  for (let i = 0; i < ((turns % 4) + 4) % 4; i += 1) next = turnOnce(next);
  return normalizeGeometry(next);
}

/** The geometry with its result mirrored: axis 'horizontal' (left–right) or 'vertical'. */
export function flipGeometry(geometry, axis) {
  const g = normalizeGeometry(geometry);
  const horizontal = axis === 'horizontal';
  const mirror = ([x, y]) => (horizontal ? [1 - x, y] : [x, 1 - y]);
  const quad = g.quad ? (horizontal ? [g.quad[1], g.quad[0], g.quad[3], g.quad[2]] : [g.quad[3], g.quad[2], g.quad[1], g.quad[0]]).map(mirror) : null;
  return normalizeGeometry({
    ...g,
    flipH: horizontal ? !g.flipH : g.flipH,
    flipV: horizontal ? g.flipV : !g.flipV,
    angle: -g.angle,
    perspective: horizontal ? { ...g.perspective, horizontal: -g.perspective.horizontal } : { ...g.perspective, vertical: -g.perspective.vertical },
    quad,
    crop: g.crop ? (horizontal ? { ...g.crop, x: 1 - g.crop.x - g.crop.width } : { ...g.crop, y: 1 - g.crop.y - g.crop.height }) : null,
  });
}

/**
 * Crop to fill: with `constrain`, a crop that reaches outside the photo (after rotation or
 * perspective) is shrunk about its centre, keeping its ratio; with no crop yet, the largest
 * crop with the chosen ratio (else the frame's proportions) is made. Otherwise unchanged.
 * Throws GeometryError when the transform itself is invalid.
 */
export function constrainGeometry(geometry, native) {
  const g = normalizeGeometry(geometry);
  if (!g.constrain) return g;
  const plan = geometryPlan(frameGeometry(g), native);
  const ratio = cropRatio(g.aspect, plan.frame);
  const current = g.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  if (cropAllowed(current, plan.content)) return g;
  const crop = g.crop ? fitCrop(current, ratio, plan.content) : largestCrop(ratio ?? 1, plan.content);
  return normalizeGeometry({ ...g, crop });
}

/**
 * A new crop ratio: the largest crop with that ratio around the current crop's centre
 * (inside the photo when constrained). 'free' keeps the crop.
 */
export function setAspect(geometry, aspect, native) {
  const g = normalizeGeometry({ ...geometry, aspect });
  if (g.aspect === 'free') return g;
  const plan = geometryPlan(frameGeometry(g), native);
  const ratio = cropRatio(g.aspect, plan.frame);
  const current = g.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const center = [current.x + current.width / 2, current.y + current.height / 2];
  const [width, height] = ratio >= 1 ? [1, 1 / ratio] : [ratio, 1];
  const start = { x: center[0] - width / 2, y: center[1] - height / 2, width, height };
  return normalizeGeometry({ ...g, crop: fitCrop(start, ratio, g.constrain ? plan.content : null) });
}
