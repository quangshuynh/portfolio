// Resampling for geometry: every output pixel is mapped back to the source through the
// plan's matrix (inverse mapping, so there are no holes) and sampled with a Catmull-Rom
// bicubic kernel, edges clamped. RGBA is interpolated premultiplied by alpha, so colours
// under transparent pixels never bleed in; results are clamped to the type's range (the
// kernel's small overshoot). When the matrix maps pixel centres onto pixel centres (crop,
// quarter turns, flips at full size) pixels are copied exactly. The GPU preview runs the
// same kernel (shader.mjs) on the matrix built by geometry.mjs.
//
// Pixels outside the source are filled from its nearest edge; `applyCoverage` then fades
// them to the background after rendering, so filters never see a hard artificial edge.

import { SRGB_TO_LINEAR_8BIT } from './colorMath.mjs';
import { encodeSrgb8 } from './cpuRenderer.mjs';
import { project, sourcePixelsPerOutput } from './geometry.mjs';

const channelsOf = (image) => (image.kind === 'raw' || image.kind === 'hdr' ? 3 : 4);

// Sample positions are snapped to 1/256 px (exact in float32 up to 16 384 px) and values
// rounded with a small bias, so float32 (GPU) and float64 (CPU) agree at exact ties, which
// regular patterns hit at half-pixel positions. Both are far below what is visible.
export const POSITION_GRID = 256;
export const ROUNDING_BIAS = 1 / 1024;
const roundCode = (v) => Math.floor(v + 0.5 + ROUNDING_BIAS);

/** Catmull-Rom weights for fraction t of the distance between taps 1 and 2. */
export function cubicWeights(t, out) {
  const t2 = t * t;
  const t3 = t2 * t;
  out[0] = (-t3 + 2 * t2 - t) / 2;
  out[1] = (3 * t3 - 5 * t2 + 2) / 2;
  out[2] = (-3 * t3 + 4 * t2 + t) / 2;
  out[3] = (t3 - t2) / 2;
  return out;
}

const snap = (value) => (Math.abs(value - Math.round(value)) < 1e-9 ? Math.round(value) : value);

/**
 * The exact pixel mapping a matrix describes, or null: { xx, xy, yx, yy, tx, ty } with
 * source column = xx·x + xy·y + tx and row = yx·x + yy·y + ty for output pixel (x, y).
 */
export function exactMapping(m) {
  const s = m.map(snap);
  if (s[6] !== 0 || s[7] !== 0 || s[8] !== 1) return null;
  const linear = [s[0], s[1], s[3], s[4]];
  if (!linear.every((v) => v === 0 || v === 1 || v === -1)) return null;
  if (Math.abs(s[0]) + Math.abs(s[1]) !== 1 || Math.abs(s[3]) + Math.abs(s[4]) !== 1) return null;
  // Centre of output pixel (x, y) maps to the centre of a source pixel.
  const tx = snap(s[0] * 0.5 + s[1] * 0.5 + s[2] - 0.5);
  const ty = snap(s[3] * 0.5 + s[4] * 0.5 + s[5] - 0.5);
  if (!Number.isInteger(tx) || !Number.isInteger(ty)) return null;
  return { xx: s[0], xy: s[1], yx: s[3], yy: s[4], tx, ty };
}

// Whether a source has transparency decides premultiplication for the whole image (so the
// result never depends on banding); scanned once per pixel buffer.
const alphaCache = new WeakMap();
const hasAlpha = (image) => {
  if (channelsOf(image) !== 4) return false;
  if (!alphaCache.has(image.data)) {
    let found = false;
    for (let i = 3; i < image.data.length && !found; i += 4) found = image.data[i] !== 255;
    alphaCache.set(image.data, found);
  }
  return alphaCache.get(image.data);
};

/**
 * Warps rows [y0, y1) of the output into `target` (same type and channels as the source).
 * :param source: { kind?, width, height, data } RGBA8, RAW Uint16 RGB or HDR Float32 RGB
 * :param matrix: output px → source px (geometryPlan().toSource)
 * :param width: columns to write, from output column `x0`
 * :param options: { opaque } skip premultiplication (computed when omitted); { x0 } first
 *   output column (a region of the output, bit for bit the same pixels as a whole warp)
 */
export function warpRows(source, matrix, width, y0, y1, target, { opaque = !hasAlpha(source), x0 = 0 } = {}) {
  const channels = channelsOf(source);
  const { width: sw, height: sh, data } = source;
  const maxValue = source.kind === 'raw' ? 65535 : source.kind === 'hdr' ? Infinity : 255;
  const exact = exactMapping(matrix);
  if (exact) {
    const { xx, xy, yx, yy, tx, ty } = exact;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x0 + width; x += 1) {
        const sx = Math.min(sw - 1, Math.max(0, xx * x + xy * y + tx));
        const sy = Math.min(sh - 1, Math.max(0, yx * x + yy * y + ty));
        const i = (sy * sw + sx) * channels;
        const o = ((y - y0) * width + x - x0) * channels;
        for (let c = 0; c < channels; c += 1) target[o + c] = data[i + c];
      }
    }
    return target;
  }
  const wx = new Float64Array(4);
  const wy = new Float64Array(4);
  const columns = new Int32Array(4);
  const rows = new Int32Array(4);
  const sum = new Float64Array(4);
  const premultiply = channels === 4 && !opaque;
  const integral = maxValue !== Infinity;
  for (let y = y0; y < y1; y += 1) {
    const cy = y + 0.5;
    for (let x = x0; x < x0 + width; x += 1) {
      const cx = x + 0.5;
      const w = matrix[6] * cx + matrix[7] * cy + matrix[8];
      const px = Math.floor(((matrix[0] * cx + matrix[1] * cy + matrix[2]) / w) * POSITION_GRID + 0.5) / POSITION_GRID - 0.5;
      const py = Math.floor(((matrix[3] * cx + matrix[4] * cy + matrix[5]) / w) * POSITION_GRID + 0.5) / POSITION_GRID - 0.5;
      const ix = Math.floor(px);
      const iy = Math.floor(py);
      cubicWeights(px - ix, wx);
      cubicWeights(py - iy, wy);
      for (let k = 0; k < 4; k += 1) {
        columns[k] = Math.min(sw - 1, Math.max(0, ix - 1 + k));
        rows[k] = Math.min(sh - 1, Math.max(0, iy - 1 + k)) * sw;
      }
      sum[0] = 0; sum[1] = 0; sum[2] = 0; sum[3] = 0;
      for (let j = 0; j < 4; j += 1) {
        const row = rows[j];
        const weightY = wy[j];
        for (let k = 0; k < 4; k += 1) {
          const weight = weightY * wx[k];
          const i = (row + columns[k]) * channels;
          if (premultiply) {
            const a = data[i + 3] * weight;
            sum[0] += data[i] * a; sum[1] += data[i + 1] * a; sum[2] += data[i + 2] * a; sum[3] += a;
          } else {
            sum[0] += data[i] * weight; sum[1] += data[i + 1] * weight; sum[2] += data[i + 2] * weight;
          }
        }
      }
      const o = ((y - y0) * width + x - x0) * channels;
      if (premultiply) {
        const alpha = Math.min(255, Math.max(0, sum[3]));
        for (let c = 0; c < 3; c += 1) target[o + c] = alpha > 0 ? Math.min(255, roundCode(Math.min(255, Math.max(0, sum[c] / sum[3])))) : 0;
        target[o + 3] = Math.min(255, roundCode(alpha));
      } else {
        for (let c = 0; c < 3; c += 1) {
          const v = Math.min(maxValue, Math.max(0, sum[c]));
          target[o + c] = integral ? Math.min(maxValue, roundCode(v)) : v;
        }
        if (channels === 4) target[o + 3] = 255;
      }
    }
  }
  return target;
}

/**
 * Warps a whole image into a new one of `out` size, in bands so a caller can yield.
 * :returns: { kind?, width, height, data }
 */
export function warpImage(source, matrix, out, { cancelled, bandRows = 256 } = {}) {
  const channels = channelsOf(source);
  const data = new source.data.constructor(out.width * out.height * channels);
  const opaque = !hasAlpha(source);
  for (let row = 0; row < out.height; row += bandRows) {
    if (cancelled?.()) throw Object.assign(new Error('Cancelled.'), { code: 'cancelled' });
    const last = Math.min(out.height, row + bandRows);
    warpRows(source, matrix, out.width, row, last, data.subarray(row * out.width * channels, last * out.width * channels), { opaque });
  }
  return { ...(source.kind ? { kind: source.kind } : {}), width: out.width, height: out.height, data };
}

/**
 * Everything a worker needs to warp one render (plain data, so it can be posted):
 * the matrix for a source of `src` size and an output of `out` size, and whether the
 * output reaches outside the source (then applyCoverage runs after rendering).
 */
export function warpSpec(plan, out, src) {
  const matrix = plan.toSource(out, src);
  return {
    matrix,
    width: out.width,
    height: out.height,
    src: { width: src.width, height: src.height },
    scale: sourcePixelsPerOutput(matrix, out),
    coverage: !plan.covered,
    background: plan.background,
  };
}

/**
 * Applies a warp spec's coverage to rendered rows, when it has any.
 * :param region: { x, width } when the rows hold only those output columns
 */
export function finishRows(spec, rgba, y0, rows, flatten, region = null) {
  if (spec?.coverage) applyCoverage(rgba, region?.width ?? spec.width, y0, rows, { ...spec, flatten, x0: region?.x ?? 0 });
  return rgba;
}

const BACKGROUND_LINEAR = { white: 1, black: 0, transparent: null };

/**
 * Coverage of output pixel centres by the source, faded over one output pixel at the edge.
 * :param matrix: output px → source px; `src`: source size; `scale`: source px per output px
 */
export function coverageAt(matrix, src, scale, x, y) {
  const [sx, sy] = project(matrix, x + 0.5, y + 0.5);
  const d = Math.min(sx, src.width - sx, sy, src.height - sy);
  return Math.min(1, Math.max(0, d / scale + 0.5));
}

/**
 * Fades rendered RGBA8 rows (starting at output row `y0`) outside the source to the
 * background: alpha for 'transparent', else composited in linear light ('transparent' with
 * `flatten`, for JPEG, composites onto white like every other transparent pixel).
 * :param options: { matrix, src, scale, background, flatten }
 */
export function applyCoverage(rgba, width, y0, rows, { matrix, src, scale, background = 'transparent', flatten = false, x0 = 0 }) {
  const solid = BACKGROUND_LINEAR[background] ?? (flatten ? 1 : null);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const coverage = coverageAt(matrix, src, scale, x0 + x, y0 + y);
      if (coverage >= 1) continue; // eslint-disable-line no-continue
      const i = (y * width + x) * 4;
      const alpha = (rgba[i + 3] / 255) * coverage;
      if (solid === null) {
        rgba[i + 3] = Math.round(alpha * 255);
      } else {
        for (let c = 0; c < 3; c += 1) rgba[i + c] = encodeSrgb8(SRGB_TO_LINEAR_8BIT[rgba[i + c]] * alpha + solid * (1 - alpha));
        rgba[i + 3] = 255;
      }
    }
  }
  return rgba;
}
