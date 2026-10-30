// Renders retouch operations (model/retouch.mjs) into source pixels, in place, before any
// other stage: on the decoded photo (RGBA8), developed RAW sensor data (RGB16) or a merged HDR
// (float RGB), at the size being rendered (preview proxy, 1:1 region or export). Operations run
// in order, each reading the result of the ones before it.
//
// Clone copies the source under a feathered brush mask. Heal copies the same way, then adds a
// correction field so the copied texture takes the tone and colour of the target's own
// surroundings: the field is the target-minus-source difference on a ring around the stroke,
// interpolated smoothly inside it (a membrane, i.e. Laplace's equation, solved on a coarse grid
// fixed relative to the stroke, not to the image size). Detail comes from the source, low
// frequencies from the target: no circular patch, halo or seam. Because every size is derived
// from the operation's normalised geometry, a preview and an export of the same photo give the
// same result up to resampling. Pixels whose source falls outside the photo are left untouched.
// Alpha is never changed. Environment-free (page, worker, Node).

// Coarse grid of the heal field: cells across the longer side of the stroke's box.
const HEAL_GRID = 48;
const HEAL_ITERATIONS = 400;
// The heal box extends this far (in radii) beyond the brush, so a ring of target pixels surrounds it.
const HEAL_MARGIN = 0.35;

const channelsOf = (image) => Math.round(image.data.length / (image.width * image.height));
const maxOf = (data) => (data instanceof Uint8Array || data instanceof Uint8ClampedArray ? 255 : data instanceof Uint16Array ? 65535 : Infinity);
const smooth = (t) => t * t * (3 - 2 * t);

/** Brush falloff at normalised distance q (1 at the edge) for a hardness h: 1 inside h, smooth to 0 at the edge. */
export function brushFalloff(q, hardness) {
  if (q >= 1) return 0;
  if (q <= hardness) return 1;
  return 1 - smooth((q - hardness) / (1 - hardness));
}

/** Stamp centres along an operation's stroke, in pixels of a width × height image. */
export function stampCentres(op, width, height) {
  const radius = op.radius * Math.min(width, height);
  const step = Math.max(0.5, op.spacing * radius);
  const points = op.points.map(([x, y]) => [x * width, y * height]);
  const out = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    const length = Math.hypot(bx - ax, by - ay);
    const n = Math.floor(length / step);
    for (let k = 1; k <= n; k += 1) out.push([ax + ((bx - ax) * k * step) / length, ay + ((by - ay) * k * step) / length]);
    if (length - n * step > step * 0.25) out.push([bx, by]);
  }
  return { centres: out, radius };
}

/** The pixel box an operation changes in a width × height image (clipped), or null. */
export function retouchBounds(op, width, height) {
  const { centres, radius } = stampCentres(op, width, height);
  const reach = radius * (op.type === 'heal' ? 1 + HEAL_MARGIN : 1) + 1;
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [x, y] of centres) {
    x0 = Math.min(x0, x - reach); y0 = Math.min(y0, y - reach);
    x1 = Math.max(x1, x + reach); y1 = Math.max(y1, y + reach);
  }
  const box = { x0: Math.max(0, Math.floor(x0)), y0: Math.max(0, Math.floor(y0)), x1: Math.min(width, Math.ceil(x1)), y1: Math.min(height, Math.ceil(y1)) };
  return box.x1 > box.x0 && box.y1 > box.y0 ? box : null;
}

const union = (a, b) => (!a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });

/** Brush coverage (0–1) over `box`, the maximum of every stamp's falloff. */
function brushMask(op, width, height, box) {
  const { centres, radius } = stampCentres(op, width, height);
  const bw = box.x1 - box.x0;
  const mask = new Float32Array(bw * (box.y1 - box.y0));
  for (const [cx, cy] of centres) {
    const xa = Math.max(box.x0, Math.floor(cx - radius)); const xb = Math.min(box.x1, Math.ceil(cx + radius));
    const ya = Math.max(box.y0, Math.floor(cy - radius)); const yb = Math.min(box.y1, Math.ceil(cy + radius));
    for (let y = ya; y < yb; y += 1) {
      const dy = y + 0.5 - cy;
      for (let x = xa; x < xb; x += 1) {
        const q = Math.hypot(x + 0.5 - cx, dy) / radius;
        if (q >= 1) continue; // eslint-disable-line no-continue
        const value = brushFalloff(q, op.hardness);
        const i = (y - box.y0) * bw + (x - box.x0);
        if (value > mask[i]) mask[i] = value;
      }
    }
  }
  return mask;
}

/**
 * A float copy of the colour channels in the source box (the target box moved by the offset,
 * plus one pixel for bilinear sampling), read before anything is written.
 */
function sourceSnapshot(image, channels, box, ox, oy) {
  const sx0 = Math.max(0, Math.floor(box.x0 + ox) - 1);
  const sy0 = Math.max(0, Math.floor(box.y0 + oy) - 1);
  const sx1 = Math.min(image.width, Math.ceil(box.x1 + ox) + 1);
  const sy1 = Math.min(image.height, Math.ceil(box.y1 + oy) + 1);
  if (sx1 <= sx0 || sy1 <= sy0) return null;
  const w = sx1 - sx0;
  const data = new Float32Array(w * (sy1 - sy0) * 3);
  for (let y = sy0; y < sy1; y += 1) {
    for (let x = sx0; x < sx1; x += 1) {
      const i = (y * image.width + x) * channels;
      const o = ((y - sy0) * w + (x - sx0)) * 3;
      data[o] = image.data[i]; data[o + 1] = image.data[i + 1]; data[o + 2] = image.data[i + 2];
    }
  }
  return { x0: sx0, y0: sy0, x1: sx1, y1: sy1, w, data };
}

/** Bilinear sample of the snapshot at image coordinates (x, y) into out[0..2]; false when outside the photo. */
function sample(snap, image, x, y, out) {
  if (x < 0 || y < 0 || x > image.width - 1 || y > image.height - 1) return false;
  const fx = Math.min(Math.max(x, snap.x0), snap.x1 - 1);
  const fy = Math.min(Math.max(y, snap.y0), snap.y1 - 1);
  const xa = Math.floor(fx); const ya = Math.floor(fy);
  const xb = Math.min(xa + 1, snap.x1 - 1); const yb = Math.min(ya + 1, snap.y1 - 1);
  const tx = fx - xa; const ty = fy - ya;
  const a = ((ya - snap.y0) * snap.w + (xa - snap.x0)) * 3;
  const b = ((ya - snap.y0) * snap.w + (xb - snap.x0)) * 3;
  const c = ((yb - snap.y0) * snap.w + (xa - snap.x0)) * 3;
  const d = ((yb - snap.y0) * snap.w + (xb - snap.x0)) * 3;
  for (let k = 0; k < 3; k += 1) {
    out[k] = (snap.data[a + k] * (1 - tx) + snap.data[b + k] * tx) * (1 - ty) + (snap.data[c + k] * (1 - tx) + snap.data[d + k] * tx) * ty;
  }
  return true;
}

/**
 * The heal correction field over `box`: (target − source) on the cells outside the brush,
 * interpolated across the cells inside by Gauss–Seidel relaxation of Laplace's equation on a
 * grid of HEAL_GRID cells across the box's longer side. Returns a per-pixel sampler.
 */
function healField(image, channels, box, mask, snap, ox, oy) {
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  const cell = Math.max(1, Math.max(bw, bh) / HEAL_GRID);
  const gw = Math.max(2, Math.round(bw / cell));
  const gh = Math.max(2, Math.round(bh / cell));
  const cw = bw / gw;
  const ch = bh / gh;
  const sums = new Float64Array(gw * gh * 3);
  const counts = new Uint32Array(gw * gh);
  const inside = new Uint8Array(gw * gh);
  const s = [0, 0, 0];
  for (let y = 0; y < bh; y += 1) {
    const gy = Math.min(gh - 1, Math.floor(y / ch));
    for (let x = 0; x < bw; x += 1) {
      const g = gy * gw + Math.min(gw - 1, Math.floor(x / cw));
      if (mask[y * bw + x] > 0) { inside[g] = 1; continue; } // eslint-disable-line no-continue
      const px = box.x0 + x; const py = box.y0 + y;
      if (!sample(snap, image, px + ox, py + oy, s)) continue; // eslint-disable-line no-continue
      const i = (py * image.width + px) * channels;
      sums[g * 3] += image.data[i] - s[0]; sums[g * 3 + 1] += image.data[i + 1] - s[1]; sums[g * 3 + 2] += image.data[i + 2] - s[2];
      counts[g] += 1;
    }
  }
  const field = new Float64Array(gw * gh * 3);
  const fixed = new Uint8Array(gw * gh);
  const mean = [0, 0, 0];
  let fixedCount = 0;
  for (let g = 0; g < gw * gh; g += 1) {
    if (inside[g] || !counts[g]) continue; // eslint-disable-line no-continue
    fixed[g] = 1;
    fixedCount += 1;
    for (let k = 0; k < 3; k += 1) { field[g * 3 + k] = sums[g * 3 + k] / counts[g]; mean[k] += field[g * 3 + k]; }
  }
  if (!fixedCount) return () => [0, 0, 0];
  for (let k = 0; k < 3; k += 1) mean[k] /= fixedCount;
  for (let g = 0; g < gw * gh; g += 1) if (!fixed[g]) for (let k = 0; k < 3; k += 1) field[g * 3 + k] = mean[k];
  for (let iteration = 0; iteration < HEAL_ITERATIONS; iteration += 1) {
    for (let gy = 0; gy < gh; gy += 1) {
      for (let gx = 0; gx < gw; gx += 1) {
        const g = gy * gw + gx;
        if (fixed[g]) continue; // eslint-disable-line no-continue
        for (let k = 0; k < 3; k += 1) {
          let total = 0; let n = 0;
          if (gx > 0) { total += field[(g - 1) * 3 + k]; n += 1; }
          if (gx < gw - 1) { total += field[(g + 1) * 3 + k]; n += 1; }
          if (gy > 0) { total += field[(g - gw) * 3 + k]; n += 1; }
          if (gy < gh - 1) { total += field[(g + gw) * 3 + k]; n += 1; }
          field[g * 3 + k] = total / n;
        }
      }
    }
  }
  const out = [0, 0, 0];
  // Bilinear between cell centres.
  return (x, y) => {
    const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / cw - 0.5));
    const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / ch - 0.5));
    const xa = Math.floor(fx); const ya = Math.floor(fy);
    const xb = Math.min(gw - 1, xa + 1); const yb = Math.min(gh - 1, ya + 1);
    const tx = fx - xa; const ty = fy - ya;
    for (let k = 0; k < 3; k += 1) {
      out[k] = (field[(ya * gw + xa) * 3 + k] * (1 - tx) + field[(ya * gw + xb) * 3 + k] * tx) * (1 - ty)
        + (field[(yb * gw + xa) * 3 + k] * (1 - tx) + field[(yb * gw + xb) * 3 + k] * tx) * ty;
    }
    return out;
  };
}

/**
 * Renders one operation into `image` ({ width, height, data } with 3 or 4 channels: RGBA8,
 * RGB16 or float RGB), in place. :returns: the changed pixel box, or null
 */
export function applyRetouchOperation(image, op) {
  if (!op?.enabled) return null;
  const { width, height } = image;
  const channels = channelsOf(image);
  const box = retouchBounds(op, width, height);
  if (!box) return null;
  const ox = op.offset.x * width;
  const oy = op.offset.y * height;
  const snap = sourceSnapshot(image, channels, box, ox, oy);
  if (!snap) return null;
  const mask = brushMask(op, width, height, box);
  const field = op.type === 'heal' ? healField(image, channels, box, mask, snap, ox, oy) : null;
  const top = maxOf(image.data);
  const bw = box.x1 - box.x0;
  const s = [0, 0, 0];
  for (let y = box.y0; y < box.y1; y += 1) {
    for (let x = box.x0; x < box.x1; x += 1) {
      const m = mask[(y - box.y0) * bw + (x - box.x0)] * op.opacity;
      if (m <= 0 || !sample(snap, image, x + ox, y + oy, s)) continue; // eslint-disable-line no-continue
      const add = field ? field(x - box.x0, y - box.y0) : null;
      const i = (y * width + x) * channels;
      for (let k = 0; k < 3; k += 1) {
        const target = image.data[i + k];
        const value = target + ((add ? s[k] + add[k] : s[k]) - target) * m;
        image.data[i + k] = top === Infinity ? Math.max(0, value) : Math.min(top, Math.max(0, Math.round(value)));
      }
    }
  }
  return box;
}

/** Renders every enabled operation in order, in place. :returns: the changed pixel box, or null */
export function applyRetouch(image, operations) {
  let dirty = null;
  for (const op of operations ?? []) dirty = union(dirty, applyRetouchOperation(image, op));
  return dirty;
}

/** The operations whose changes can reach the pixel box `rect` of a width × height image (for a 1:1 region). */
export function retouchTouching(operations, width, height, rect) {
  return (operations ?? []).filter((op) => {
    if (!op.enabled) return false;
    const box = retouchBounds(op, width, height);
    return box && box.x0 < rect.x + rect.width && box.x1 > rect.x && box.y0 < rect.y + rect.height && box.y1 > rect.y;
  });
}

const luminance = (image, channels, top, x, y) => {
  const i = (Math.round(y) * image.width + Math.round(x)) * channels;
  const scale = top === Infinity ? 1 : 1 / top;
  return (0.2126 * image.data[i] + 0.7152 * image.data[i + 1] + 0.0722 * image.data[i + 2]) * scale;
};

/**
 * A source offset for a heal stroke where nothing was chosen: the nearby region whose
 * surroundings and texture best match the target's, never overlapping the stroke and never
 * outside the photo. Deterministic for the same pixels.
 * :param op: the operation (its offset is ignored)
 * :returns: { x, y } normalised offset, or null when no candidate fits
 */
export function findHealSource(image, op) {
  const { width, height } = image;
  const channels = channelsOf(image);
  const top = maxOf(image.data);
  const { centres, radius } = stampCentres(op, width, height);
  const step = Math.max(1, Math.floor(centres.length / 24));
  const spine = centres.filter((_, i) => i % step === 0);
  const ring = [];
  const inner = [];
  for (const [cx, cy] of spine) {
    for (let a = 0; a < 16; a += 1) {
      const angle = (a / 16) * Math.PI * 2;
      ring.push([cx + Math.cos(angle) * radius * 1.35, cy + Math.sin(angle) * radius * 1.35]);
      if (a % 2 === 0) inner.push([cx + Math.cos(angle) * radius * 0.55, cy + Math.sin(angle) * radius * 0.55]);
    }
    inner.push([cx, cy]);
  }
  const usable = (points, dx, dy) => points.every(([x, y]) => x + dx >= 1 && y + dy >= 1 && x + dx <= width - 2 && y + dy <= height - 2);
  const gradient = (x, y) => Math.abs(luminance(image, channels, top, x + 1, y) - luminance(image, channels, top, x - 1, y)) + Math.abs(luminance(image, channels, top, x, y + 1) - luminance(image, channels, top, x, y - 1));
  const ringTargets = ring.filter(([x, y]) => x >= 1 && y >= 1 && x <= width - 2 && y <= height - 2);
  if (!ringTargets.length) return null;
  const ringTexture = ringTargets.reduce((sum, [x, y]) => sum + gradient(x, y), 0) / ringTargets.length;
  // Shortest distance from any stamp to the stroke shifted by (dx, dy): the source must clear the brush.
  const clearance = (dx, dy) => {
    let best = Infinity;
    for (const [ax, ay] of spine) for (const [bx, by] of spine) best = Math.min(best, Math.hypot(ax + dx - bx, ay + dy - by));
    return best;
  };
  let best = null;
  for (const distance of [2.4, 3.2, 4.2, 5.5, 7]) {
    for (let a = 0; a < 24; a += 1) {
      const angle = (a / 24) * Math.PI * 2;
      const dx = Math.cos(angle) * radius * distance;
      const dy = Math.sin(angle) * radius * distance;
      if (clearance(dx, dy) < radius * 2.1 || !usable(ringTargets, dx, dy) || !usable(inner, dx, dy)) continue; // eslint-disable-line no-continue
      let context = 0;
      for (const [x, y] of ringTargets) context += Math.abs(luminance(image, channels, top, x, y) - luminance(image, channels, top, x + dx, y + dy));
      context /= ringTargets.length;
      const texture = inner.reduce((sum, [x, y]) => sum + gradient(x + dx, y + dy), 0) / inner.length;
      const score = context + 0.6 * Math.abs(texture - ringTexture) + 0.004 * distance;
      if (!best || score < best.score) best = { score, dx, dy };
    }
  }
  return best ? { x: best.dx / width, y: best.dy / height } : null;
}
