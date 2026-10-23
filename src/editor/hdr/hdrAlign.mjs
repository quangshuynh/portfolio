// Registration of exposure brackets: median threshold bitmaps (Ward 2003), which do
// not depend on exposure, searched over an image pyramid for translation, plus a small
// rotation search (±1°) and a sub-pixel refinement from the error's parabola. The
// reported confidence is the measured bitmap mismatch, never an invented score.
//
// A transform maps a reference pixel p to frame coordinates R(angle)(p − c) + c + t,
// with c the image centre. Translations are stored as fractions of the width so the
// same transform applies at preview and export resolution.

export const ALIGN = Object.freeze({
  /** Coarsest pyramid level has at least this many pixels on its short side. */
  minLevelSide: 24,
  coarseSearch: 4,
  /** Rotation is searched on the first level whose long side is at most this. */
  rotationLevelEdge: 640,
  angles: Object.freeze([-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1]),
  /** Pixels within this fraction of the ranks around the median are ignored (noise). */
  exclusion: 0.04,
  /** Mismatch after alignment: below `good` aligned; up to `usable` uncertain; above, failed. */
  good: 0.1,
  usable: 0.2,
  /** Mismatch that even the best transform leaves for unrelated scenes. */
  unrelated: 0.3,
  /** Largest shift accepted, as a fraction of the width. */
  maxShift: 0.06,
});

export const IDENTITY = Object.freeze({ tx: 0, ty: 0, angle: 0 });

/** Box 2× downscale of a float plane. */
export function halve(plane, width, height) {
  const w = Math.max(1, width >> 1);
  const h = Math.max(1, height >> 1);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const r0 = Math.min(height - 1, y * 2) * width;
    const r1 = Math.min(height - 1, y * 2 + 1) * width;
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.min(width - 1, x * 2);
      const x1 = Math.min(width - 1, x * 2 + 1);
      out[y * w + x] = (plane[r0 + x0] + plane[r0 + x1] + plane[r1 + x0] + plane[r1 + x1]) * 0.25;
    }
  }
  return { plane: out, width: w, height: h };
}

/** Separable box blur (radius r) of a float plane into a new plane; edges repeat the border pixel. */
export function boxBlur(plane, width, height, r) {
  if (r < 1) return plane;
  const tmp = new Float32Array(plane.length);
  const out = new Float32Array(plane.length);
  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    const row = y * width;
    for (let x = -r; x <= r; x += 1) sum += plane[row + Math.min(width - 1, Math.max(0, x))];
    for (let x = 0; x < width; x += 1) {
      tmp[row + x] = sum / (2 * r + 1);
      sum += plane[row + Math.min(width - 1, x + r + 1)] - plane[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = -r; y <= r; y += 1) sum += tmp[Math.min(height - 1, Math.max(0, y)) * width + x];
    for (let y = 0; y < height; y += 1) {
      out[y * width + x] = sum / (2 * r + 1);
      sum += tmp[Math.min(height - 1, y + r + 1) * width + x] - tmp[Math.max(0, y - r) * width + x];
    }
  }
  return out;
}

/** Value at a rank fraction, from a strided sample (deterministic). */
function quantiles(plane, fractions) {
  const step = Math.max(1, Math.floor(plane.length / 65536));
  const sample = [];
  for (let i = 0; i < plane.length; i += step) sample.push(plane[i]);
  sample.sort((a, b) => a - b);
  return fractions.map((f) => sample[Math.min(sample.length - 1, Math.max(0, Math.round(f * (sample.length - 1))))]);
}

/** Median threshold bitmap and its exclusion mask (1 = usable). */
export function thresholdBitmap(plane) {
  const [low, median, high] = quantiles(plane, [0.5 - ALIGN.exclusion, 0.5, 0.5 + ALIGN.exclusion]);
  const bits = new Uint8Array(plane.length);
  const valid = new Uint8Array(plane.length);
  for (let i = 0; i < plane.length; i += 1) {
    const v = plane[i];
    bits[i] = v > median ? 1 : 0;
    // Strictly outside the band, so flat (clipped or black) regions never count.
    valid[i] = v < low || v > high ? 1 : 0;
  }
  return { bits, valid };
}

/**
 * Fraction of usable pixels whose bits disagree between the reference and a frame
 * sampled through the transform (nearest pixel). Pixels mapped outside are skipped.
 */
export function bitmapMismatch(ref, frame, width, height, { tx, ty, angle }) {
  const cos = Math.cos((angle * Math.PI) / 180);
  const sin = Math.sin((angle * Math.PI) / 180);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  let wrong = 0;
  let total = 0;
  for (let y = 0; y < height; y += 1) {
    const dy = y - cy;
    let qx = cos * -cx - sin * dy + cx + tx;
    let qy = sin * -cx + cos * dy + cy + ty;
    const row = y * width;
    for (let x = 0; x < width; x += 1, qx += cos, qy += sin) {
      const ix = Math.round(qx);
      const iy = Math.round(qy);
      if (ix < 0 || iy < 0 || ix >= width || iy >= height) continue;
      const i = row + x;
      const j = iy * width + ix;
      if (!ref.valid[i] || !frame.valid[j]) continue;
      total += 1;
      wrong += ref.bits[i] ^ frame.bits[j];
    }
  }
  return total ? wrong / total : 1;
}

function pyramid(plane, width, height) {
  const levels = [{ plane, width, height }];
  while (Math.min(levels.at(-1).width, levels.at(-1).height) >= ALIGN.minLevelSide * 2) {
    const last = levels.at(-1);
    levels.push(halve(last.plane, last.width, last.height));
  }
  return levels.map((level) => ({ ...level, bitmap: thresholdBitmap(level.plane) }));
}

function search(level, refLevel, start, radius, angles = [start.angle]) {
  let best = { ...start, error: Infinity };
  for (const angle of angles) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const candidate = { tx: start.tx + dx, ty: start.ty + dy, angle };
        const error = bitmapMismatch(refLevel.bitmap, level.bitmap, level.width, level.height, candidate);
        // Ties go to the smaller motion, so flat scenes stay at the identity.
        if (error < best.error - 1e-12 || (Math.abs(error - best.error) <= 1e-12 && Math.abs(candidate.tx) + Math.abs(candidate.ty) + Math.abs(angle) < Math.abs(best.tx) + Math.abs(best.ty) + Math.abs(best.angle))) {
          best = { ...candidate, error };
        }
      }
    }
  }
  return best;
}

/**
 * Finds the transform from the reference to a frame: bitmap search down to half size,
 * then Lucas–Kanade on rank-equalised luminance (blurred, then sharp) at half size and
 * a short polish at full size.
 * :param ref, frame: { plane: Float32Array, width, height } luminance (any monotone scale)
 * :param options: { rotation } search rotation too (default true)
 * :returns: { transform: { tx, ty, angle } in pixels at this size, before, after }
 *   `before`/`after` are the bitmap mismatch without and with the transform
 */
export function estimateTransform(ref, frame, { rotation = true } = {}) {
  const refLevels = pyramid(ref.plane, ref.width, ref.height);
  const levels = pyramid(frame.plane, frame.width, frame.height);
  const stop = levels.length > 1 ? 1 : 0;
  let current = { tx: 0, ty: 0, angle: 0 };
  for (let index = levels.length - 1; index >= stop; index -= 1) {
    const coarsest = index === levels.length - 1;
    const level = levels[index];
    if (!coarsest) current = { ...current, tx: current.tx * 2, ty: current.ty * 2 };
    const rotate = rotation && level.width <= ALIGN.rotationLevelEdge && level.height <= ALIGN.rotationLevelEdge
      && (index === stop || levels[index - 1].width > ALIGN.rotationLevelEdge || levels[index - 1].height > ALIGN.rotationLevelEdge);
    current = search(level, refLevels[index], current, coarsest ? ALIGN.coarseSearch : 1, rotate ? ALIGN.angles : undefined);
  }
  // Coarse to fine: blurred planes widen the basin beyond the ±0.5 px of sharp edges.
  const { width: w, height: h } = levels[stop];
  const refEq = equalize(refLevels[stop].plane);
  const frameEq = equalize(levels[stop].plane);
  const options = { rotation };
  current = refineTransform(boxBlur(refEq, w, h, 2), boxBlur(frameEq, w, h, 2), w, h, current, options) ?? current;
  current = refineTransform(refEq, frameEq, w, h, current, options) ?? current;
  if (stop === 1) {
    current = { ...current, tx: current.tx * 2, ty: current.ty * 2 };
    current = refineTransform(equalize(ref.plane), equalize(frame.plane), ref.width, ref.height, current, { ...options, iterations: 2 }) ?? current;
  }
  const finest = levels[0];
  const mismatch = (t) => bitmapMismatch(refLevels[0].bitmap, finest.bitmap, finest.width, finest.height, t);
  return { transform: current, before: mismatch(IDENTITY), after: mismatch(current) };
}

/** Rank transform (histogram equalisation, 4096 bins on log values): removes exposure differences. */
export function equalize(plane) {
  const bins = 4096;
  const logOf = (v) => Math.log2(Math.max(v, 1e-6));
  const [lo, hi] = quantiles(plane, [0, 1]).map(logOf);
  const span = Math.max(1e-6, hi - lo);
  const bin = (v) => Math.min(bins - 1, Math.max(0, Math.floor(((logOf(v) - lo) / span) * bins)));
  const cdf = new Float64Array(bins);
  for (let i = 0; i < plane.length; i += 1) cdf[bin(plane[i])] += 1;
  let total = 0;
  for (let i = 0; i < bins; i += 1) { total += cdf[i]; cdf[i] = total / plane.length; }
  const out = new Float32Array(plane.length);
  for (let i = 0; i < plane.length; i += 1) out[i] = cdf[bin(plane[i])];
  return out;
}

/** Solves a 3×3 system by Cramer's rule; null when singular. */
function solve3(m, b) {
  const det = (a) => a[0] * (a[4] * a[8] - a[5] * a[7]) - a[1] * (a[3] * a[8] - a[5] * a[6]) + a[2] * (a[3] * a[7] - a[4] * a[6]);
  const d = det(m);
  if (!(Math.abs(d) > 1e-12)) return null;
  return [0, 1, 2].map((col) => det(m.map((value, i) => (i % 3 === col ? b[Math.floor(i / 3)] : value))) / d);
}

/**
 * Sub-pixel translation and rotation by Lucas–Kanade on rank-equalised luminance,
 * using the reference's central-difference gradients (independent of the noise in the
 * residual, so they add no bias). Pixels in flat or clipped tone ranges are left out.
 * Returns null when the system is degenerate or the result moves more than 2 px or 0.6°.
 */
export function refineTransform(ref, frame, width, height, start, { rotation = true, iterations = 6 } = {}) {
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  let { tx, ty } = start;
  let theta = (start.angle * Math.PI) / 180;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const a = new Float64Array(9);
    const b = new Float64Array(3);
    for (let y = 1; y < height - 1; y += 1) {
      const dy = y - cy;
      for (let x = 1; x < width - 1; x += 1) {
        const i = y * width + x;
        const r = ref[i];
        if (r < 0.01 || r > 0.99) continue;
        const dx = x - cx;
        const qx = cos * dx - sin * dy + cx + tx;
        const qy = sin * dx + cos * dy + cy + ty;
        if (qx < 1 || qy < 1 || qx >= width - 2 || qy >= height - 2) continue;
        const x0 = Math.floor(qx);
        const y0 = Math.floor(qy);
        const ax = qx - x0;
        const ay = qy - y0;
        const j = y0 * width + x0;
        const f = (frame[j] * (1 - ax) + frame[j + 1] * ax) * (1 - ay) + (frame[j + width] * (1 - ax) + frame[j + width + 1] * ax) * ay;
        if (f < 0.01 || f > 0.99) continue;
        const gx = (ref[i + 1] - ref[i - 1]) * 0.5;
        const gy = (ref[i + width] - ref[i - width]) * 0.5;
        // d(q)/d(theta) = (-sin dx - cos dy, cos dx - sin dy).
        const gt = gx * (-sin * dx - cos * dy) + gy * (cos * dx - sin * dy);
        const e = f - r;
        a[0] += gx * gx; a[1] += gx * gy; a[2] += gx * gt;
        a[4] += gy * gy; a[5] += gy * gt; a[8] += gt * gt;
        b[0] += gx * e; b[1] += gy * e; b[2] += gt * e;
      }
    }
    a[3] = a[1]; a[6] = a[2]; a[7] = a[5];
    let step;
    if (rotation) step = solve3(Array.from(a), Array.from(b));
    else {
      const det = a[0] * a[4] - a[1] * a[1];
      step = det > 1e-9 ? [(a[4] * b[0] - a[1] * b[1]) / det, (a[0] * b[1] - a[1] * b[0]) / det, 0] : null;
    }
    if (!step) return null;
    tx -= step[0];
    ty -= step[1];
    theta -= step[2];
    if (Math.abs(tx - start.tx) > 2 || Math.abs(ty - start.ty) > 2 || Math.abs((theta * 180) / Math.PI - start.angle) > 0.6) return null;
    if (Math.abs(step[0]) < 0.005 && Math.abs(step[1]) < 0.005 && Math.abs(step[2]) < 2e-6) break;
  }
  return { tx, ty, angle: (theta * 180) / Math.PI };
}

/**
 * Classifies a measured alignment.
 * :returns: 'aligned' | 'uncertain' | 'failed' | 'unrelated'
 */
export function alignmentStatus({ before, after, transform }, width) {
  if (after > ALIGN.unrelated && before > ALIGN.unrelated) return 'unrelated';
  if (Math.hypot(transform.tx, transform.ty) > ALIGN.maxShift * width) return 'failed';
  if (after <= ALIGN.good) return 'aligned';
  if (after <= ALIGN.usable) return 'uncertain';
  return 'failed';
}

/** Transform in pixels at one size -> resolution-independent form (fractions of the width). */
export const normalizeTransform = ({ tx, ty, angle }, width) => ({ tx: tx / width, ty: ty / width, angle });
/** Resolution-independent transform -> pixels at a frame width. */
export const transformAt = ({ tx, ty, angle }, width) => ({ tx: tx * width, ty: ty * width, angle });

/**
 * Largest crop of the reference (as fractions of its size) in which every frame has
 * data, so alignment never leaves empty borders. Shrinks each side until the crop's
 * corners map inside every frame.
 */
export function commonCrop(transforms, width, height) {
  let x0 = 0;
  let y0 = 0;
  let x1 = width - 1;
  let y1 = height - 1;
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  for (let pass = 0; pass < 50; pass += 1) {
    let changed = false;
    for (const t of transforms) {
      const cos = Math.cos((t.angle * Math.PI) / 180);
      const sin = Math.sin((t.angle * Math.PI) / 180);
      for (const [px, py] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
        const qx = cos * (px - cx) - sin * (py - cy) + cx + t.tx;
        const qy = sin * (px - cx) + cos * (py - cy) + cy + t.ty;
        // Bilinear sampling needs the next pixel too.
        const fix = (q, max) => (q < 0 ? -q : q > max - 1 ? q - (max - 1) : 0);
        const ox = fix(qx, width);
        const oy = fix(qy, height);
        if (ox > 0) { if (px === x0) x0 += Math.ceil(ox); else x1 -= Math.ceil(ox); changed = true; }
        if (oy > 0) { if (py === y0) y0 += Math.ceil(oy); else y1 -= Math.ceil(oy); changed = true; }
      }
    }
    if (!changed || x1 <= x0 || y1 <= y0) break;
  }
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0 / width, y: y0 / height, width: (x1 - x0 + 1) / width, height: (y1 - y0 + 1) / height };
}

/** A normalised crop in whole pixels of an image of this size (always inside it). */
export function cropAt(crop, width, height) {
  const x = Math.min(width - 1, Math.ceil(crop.x * width - 1e-6));
  const y = Math.min(height - 1, Math.ceil(crop.y * height - 1e-6));
  const right = Math.max(x + 1, Math.floor((crop.x + crop.width) * width + 1e-6));
  const bottom = Math.max(y + 1, Math.floor((crop.y + crop.height) * height + 1e-6));
  return { x, y, width: Math.min(width, right) - x, height: Math.min(height, bottom) - y };
}

/**
 * Sampler for one frame through a transform, evaluated per output row (bilinear).
 * :returns: (x, y) -> [qx, qy] frame coordinates for output pixel (x, y) of the full frame
 */
export function frameMapper({ tx, ty, angle }, width, height) {
  const cos = Math.cos((angle * Math.PI) / 180);
  const sin = Math.sin((angle * Math.PI) / 180);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const identity = tx === 0 && ty === 0 && angle === 0;
  return { identity, cos, sin, cx, cy, tx, ty };
}
