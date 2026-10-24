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
export const hasAlpha = (image) => {
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
 *   `source.top`: `data` holds only rows from `top` of a source `height` rows tall (a band
 *   worker's slice; every tap must fall inside it, see sourceRows)
 */
export function warpRows(source, matrix, width, y0, y1, target, { opaque = !hasAlpha(source), x0 = 0 } = {}) {
  const channels = channelsOf(source);
  const { width: sw, height: sh, data } = source;
  const top = source.top ?? 0;
  const maxValue = source.kind === 'raw' ? 65535 : source.kind === 'hdr' ? Infinity : 255;
  const exact = exactMapping(matrix);
  if (exact) {
    const { xx, xy, yx, yy, tx, ty } = exact;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x0 + width; x += 1) {
        const sx = Math.min(sw - 1, Math.max(0, xx * x + xy * y + tx));
        const sy = Math.min(sh - 1, Math.max(0, yx * x + yy * y + ty));
        const i = ((sy - top) * sw + sx) * channels;
        const o = ((y - y0) * width + x - x0) * channels;
        for (let c = 0; c < channels; c += 1) target[o + c] = data[i + c];
      }
    }
    return target;
  }
  const premultiply = channels === 4 && !opaque;
  const integral = maxValue !== Infinity;
  const stride = sw * channels;
  const lastX = sw - 1;
  const lastY = sh - 1;
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = matrix;
  for (let y = y0; y < y1; y += 1) {
    const cy = y + 0.5;
    for (let x = x0; x < x0 + width; x += 1) {
      const cx = x + 0.5;
      const w = m6 * cx + m7 * cy + m8;
      const px = Math.floor(((m0 * cx + m1 * cy + m2) / w) * POSITION_GRID + 0.5) / POSITION_GRID - 0.5;
      const py = Math.floor(((m3 * cx + m4 * cy + m5) / w) * POSITION_GRID + 0.5) / POSITION_GRID - 0.5;
      const ix = Math.floor(px);
      const iy = Math.floor(py);
      // Catmull-Rom weights (cubicWeights), inline.
      const tx = px - ix;
      const tx2 = tx * tx;
      const tx3 = tx2 * tx;
      const wx0 = (-tx3 + 2 * tx2 - tx) / 2;
      const wx1 = (3 * tx3 - 5 * tx2 + 2) / 2;
      const wx2 = (-3 * tx3 + 4 * tx2 + tx) / 2;
      const wx3 = (tx3 - tx2) / 2;
      const ty = py - iy;
      const ty2 = ty * ty;
      const ty3 = ty2 * ty;
      const wy0 = (-ty3 + 2 * ty2 - ty) / 2;
      const wy1 = (3 * ty3 - 5 * ty2 + 2) / 2;
      const wy2 = (-3 * ty3 + 4 * ty2 + ty) / 2;
      const wy3 = (ty3 - ty2) / 2;
      // Tap offsets, clamped to the edge.
      const c0 = (ix - 1 < 0 ? 0 : ix - 1 > lastX ? lastX : ix - 1) * channels;
      const c1 = (ix < 0 ? 0 : ix > lastX ? lastX : ix) * channels;
      const c2 = (ix + 1 < 0 ? 0 : ix + 1 > lastX ? lastX : ix + 1) * channels;
      const c3 = (ix + 2 < 0 ? 0 : ix + 2 > lastX ? lastX : ix + 2) * channels;
      let s0 = 0;
      let s1 = 0;
      let s2 = 0;
      let s3 = 0;
      for (let j = 0; j < 4; j += 1) {
        const yy = iy - 1 + j;
        const row = ((yy < 0 ? 0 : yy > lastY ? lastY : yy) - top) * stride;
        const wyj = j === 0 ? wy0 : j === 1 ? wy1 : j === 2 ? wy2 : wy3;
        const a = row + c0;
        const b = row + c1;
        const c = row + c2;
        const d = row + c3;
        const k0 = wyj * wx0;
        const k1 = wyj * wx1;
        const k2 = wyj * wx2;
        const k3 = wyj * wx3;
        if (premultiply) {
          const q0 = data[a + 3] * k0;
          const q1 = data[b + 3] * k1;
          const q2 = data[c + 3] * k2;
          const q3 = data[d + 3] * k3;
          s0 += data[a] * q0 + data[b] * q1 + data[c] * q2 + data[d] * q3;
          s1 += data[a + 1] * q0 + data[b + 1] * q1 + data[c + 1] * q2 + data[d + 1] * q3;
          s2 += data[a + 2] * q0 + data[b + 2] * q1 + data[c + 2] * q2 + data[d + 2] * q3;
          s3 += q0 + q1 + q2 + q3;
        } else {
          s0 += data[a] * k0 + data[b] * k1 + data[c] * k2 + data[d] * k3;
          s1 += data[a + 1] * k0 + data[b + 1] * k1 + data[c + 1] * k2 + data[d + 1] * k3;
          s2 += data[a + 2] * k0 + data[b + 2] * k1 + data[c + 2] * k2 + data[d + 2] * k3;
        }
      }
      const o = ((y - y0) * width + x - x0) * channels;
      if (premultiply) {
        const alpha = Math.min(255, Math.max(0, s3));
        if (alpha > 0) {
          target[o] = Math.min(255, roundCode(Math.min(255, Math.max(0, s0 / s3))));
          target[o + 1] = Math.min(255, roundCode(Math.min(255, Math.max(0, s1 / s3))));
          target[o + 2] = Math.min(255, roundCode(Math.min(255, Math.max(0, s2 / s3))));
        } else {
          target[o] = 0; target[o + 1] = 0; target[o + 2] = 0;
        }
        target[o + 3] = Math.min(255, roundCode(alpha));
      } else if (integral) {
        target[o] = Math.min(maxValue, roundCode(Math.min(maxValue, Math.max(0, s0))));
        target[o + 1] = Math.min(maxValue, roundCode(Math.min(maxValue, Math.max(0, s1))));
        target[o + 2] = Math.min(maxValue, roundCode(Math.min(maxValue, Math.max(0, s2))));
        if (channels === 4) target[o + 3] = 255;
      } else {
        target[o] = Math.max(0, s0);
        target[o + 1] = Math.max(0, s1);
        target[o + 2] = Math.max(0, s2);
      }
    }
  }
  return target;
}

/**
 * Source rows [top, bottom) that output rows [y0, y1) read (the band's corners mapped
 * back, plus the kernel's reach), or the whole source when the mapping is not finite there.
 */
export function sourceRows(matrix, width, y0, y1, height) {
  const ys = [[0, y0], [width, y0], [0, y1], [width, y1]].map(([x, y]) => {
    const w = matrix[6] * x + matrix[7] * y + matrix[8];
    return w > 0 ? (matrix[3] * x + matrix[4] * y + matrix[5]) / w : NaN;
  });
  if (!ys.every(Number.isFinite)) return [0, height];
  return [Math.max(0, Math.min(height - 1, Math.floor(Math.min(...ys)) - 3)), Math.min(height, Math.max(1, Math.ceil(Math.max(...ys)) + 3))];
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
