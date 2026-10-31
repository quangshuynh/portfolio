// Content-aware fill for the Remove brush: multi-scale PatchMatch inpainting (Wexler, Shechtman
// and Irani's expectation–maximisation over a coarse-to-fine pyramid, with Barnes et al.'s
// randomised PatchMatch for the nearest-neighbour field). Every unknown pixel is rebuilt from
// patches of the surrounding photo that best match its neighbourhood in colour and in luminance
// gradient (so edges and structure continue into the hole), averaged with weights that favour
// close matches and patches anchored near the hole's edge; reusing one source patch many times is
// penalised, so large fills do not repeat the same texture. Structures that cross the hole from
// side to side (pipeline/structure.mjs) add a guide channel, so lines continue and line up.
// Deterministic for the same pixels and seed; no network, no model, no server.
// Environment-free; cancellable between iterations; reports progress.

import { DETECT_EXTENT, GUIDE_OFF, drawGuides, findStructures } from './structure.mjs';

const PATCH = 7;
const HALF = (PATCH - 1) >> 1;
// The coarsest level holds the hole within about this many pixels across.
const COARSEST_HOLE = 24;
const GRADIENT_WEIGHT = 0.6;
// Voting trusts patches centred near the hole's edge (anchored in real pixels) over those deep
// inside it (built on earlier guesses): weight × CONFIDENCE_DECAY^-distance (Wexler et al.).
const CONFIDENCE_DECAY = 1.3;
// Each further target reusing one source patch costs this share of the typical patch distance,
// so a large fill spreads over the photo instead of stamping the same patch again and again.
const REUSE_PENALTY = 0.5;
// Along a structure (few sources, which the fill must reuse) only this share of it applies.
const GUIDED_REUSE = 0.2;

export class InpaintCancelled extends Error {
  constructor() {
    super('Content-aware fill was cancelled.');
    this.code = 'cancelled';
  }
}

/** A seeded pseudo-random generator (mulberry32): the same seed gives the same fill. */
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A 32-bit seed from a string (an operation id). */
export function seedOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

// One pyramid level: the hole and where patches may come from. Its feature channels (r, g, b,
// gx, gy, and the structure guide when there is one) exist only while the level is filled.
function makeLevel(width, height, color = new Float32Array(width * height * 3), hole = new Uint8Array(width * height)) {
  return { width, height, color, hole, allowed: new Uint8Array(width * height), features: null, guide: null, channels: 5 };
}

function downsample(level) {
  const width = Math.max(1, level.width >> 1);
  const height = Math.max(1, level.height >> 1);
  const out = makeLevel(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let n = 0; let r = 0; let g = 0; let b = 0; let hole = 0; let allowed = 1;
      for (let dy = 0; dy < 2; dy += 1) for (let dx = 0; dx < 2; dx += 1) {
        const sx = Math.min(level.width - 1, 2 * x + dx); const sy = Math.min(level.height - 1, 2 * y + dy);
        const i = sy * level.width + sx;
        if (level.hole[i]) hole = 1;
        if (!level.allowed[i]) allowed = 0;
        if (!level.hole[i]) { r += level.color[i * 3]; g += level.color[i * 3 + 1]; b += level.color[i * 3 + 2]; n += 1; }
      }
      const o = y * width + x;
      out.hole[o] = hole;
      out.allowed[o] = allowed && !hole ? 1 : 0;
      if (n) { out.color[o * 3] = r / n; out.color[o * 3 + 1] = g / n; out.color[o * 3 + 2] = b / n; }
    }
  }
  return out;
}

/** Fills the hole by repeated averaging of known neighbours, from the edge inwards (the first guess). */
function diffuse(level) {
  const { width, height, color, hole } = level;
  const known = new Uint8Array(width * height);
  for (let i = 0; i < known.length; i += 1) known[i] = hole[i] ? 0 : 1;
  let pending = true;
  for (let pass = 0; pending && pass < width + height; pass += 1) {
    pending = false;
    const next = known.slice();
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        if (known[i]) continue; // eslint-disable-line no-continue
        let n = 0; let r = 0; let g = 0; let b = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const nx = x + dx; const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue; // eslint-disable-line no-continue
          const j = ny * width + nx;
          if (!known[j]) continue; // eslint-disable-line no-continue
          r += color[j * 3]; g += color[j * 3 + 1]; b += color[j * 3 + 2]; n += 1;
        }
        if (n) { color[i * 3] = r / n; color[i * 3 + 1] = g / n; color[i * 3 + 2] = b / n; next[i] = 1; } else pending = true;
      }
    }
    known.set(next);
  }
}

/** Colour and weighted luminance gradient (and the structure guide, when there is one): the channels patches are compared on. */
function computeFeatures(level) {
  const { width, height, color, features, guide, channels: C } = level;
  const lum = (x, y) => {
    const i = (Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 3;
    return 0.2126 * color[i] + 0.7152 * color[i + 1] + 0.0722 * color[i + 2];
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      features[i * C] = color[i * 3]; features[i * C + 1] = color[i * 3 + 1]; features[i * C + 2] = color[i * 3 + 2];
      features[i * C + 3] = GRADIENT_WEIGHT * (lum(x + 1, y) - lum(x - 1, y));
      features[i * C + 4] = GRADIENT_WEIGHT * (lum(x, y + 1) - lum(x, y - 1));
      if (guide) features[i * C + 5] = guide[i];
    }
  }
}

/** Per pixel: 1 outside the hole, CONFIDENCE_DECAY^-d inside it (d: chamfer distance to its edge). */
function confidenceOf(level) {
  const { width, height, hole } = level;
  const d = new Float32Array(width * height);
  for (let i = 0; i < d.length; i += 1) d[i] = hole[i] ? Infinity : 0;
  const relax = (i, j, w) => { if (d[j] + w < d[i]) d[i] = d[j] + w; };
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const i = y * width + x;
    if (x > 0) relax(i, i - 1, 1);
    if (y > 0) { relax(i, i - width, 1); if (x > 0) relax(i, i - width - 1, Math.SQRT2); if (x < width - 1) relax(i, i - width + 1, Math.SQRT2); }
  }
  for (let y = height - 1; y >= 0; y -= 1) for (let x = width - 1; x >= 0; x -= 1) {
    const i = y * width + x;
    if (x < width - 1) relax(i, i + 1, 1);
    if (y < height - 1) { relax(i, i + width, 1); if (x < width - 1) relax(i, i + width + 1, Math.SQRT2); if (x > 0) relax(i, i + width - 1, Math.SQRT2); }
  }
  for (let i = 0; i < d.length; i += 1) d[i] = d[i] === Infinity ? 1e-6 : CONFIDENCE_DECAY ** -d[i];
  return d;
}

/** The indices of the n set entries of a flag array, as typed array (no growing JS array for millions of pixels). */
function indicesOf(flags, n) {
  const out = new Int32Array(n);
  for (let i = 0, k = 0; i < flags.length; i += 1) if (flags[i]) { out[k] = i; k += 1; }
  return out;
}

/** Patch centres a fill may copy from: the whole patch inside the level and allowed. */
function sourceCentres(level) {
  const { width, height, allowed } = level;
  // Summed-area table of allowed pixels: a patch is usable when all PATCH² are allowed.
  const sat = new Int32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    for (let x = 0; x < width; x += 1) {
      row += allowed[y * width + x];
      sat[(y + 1) * (width + 1) + x + 1] = sat[y * (width + 1) + x + 1] + row;
    }
  }
  const valid = new Uint8Array(width * height);
  let n = 0;
  for (let y = HALF; y < height - HALF; y += 1) {
    for (let x = HALF; x < width - HALF; x += 1) {
      const x0 = x - HALF; const y0 = y - HALF; const x1 = x + HALF + 1; const y1 = y + HALF + 1;
      const count = sat[y1 * (width + 1) + x1] - sat[y0 * (width + 1) + x1] - sat[y1 * (width + 1) + x0] + sat[y0 * (width + 1) + x0];
      if (count === PATCH * PATCH) { valid[y * width + x] = 1; n += 1; }
    }
  }
  return { centres: indicesOf(valid, n), valid };
}

/** Patch distance between centres p (target) and q (source), over the five feature channels; stops past `limit`. */
function distance(level, p, q, limit) {
  const { width, features } = level;
  const px = p % width; const py = (p - px) / width;
  const qx = q % width; const qy = (q - qx) / width;
  let sum = 0;
  for (let dy = -HALF; dy <= HALF; dy += 1) {
    const ty = py + dy;
    if (ty < 0 || ty >= level.height) continue; // eslint-disable-line no-continue
    for (let dx = -HALF; dx <= HALF; dx += 1) {
      const tx = px + dx;
      if (tx < 0 || tx >= width) continue; // eslint-disable-line no-continue
      const a = (ty * width + tx) * 5;
      const b = ((qy + dy) * width + qx + dx) * 5;
      for (let k = 0; k < 5; k += 1) { const d = features[a + k] - features[b + k]; sum += d * d; }
      if (sum >= limit) return sum;
    }
  }
  return sum;
}

/**
 * As distance, with the structure guide as a sixth channel. The guide only pulls: a pixel near
 * a structure needs a source at the same place across that structure; any other pixel may come
 * from anywhere.
 */
function guidedDistance(level, p, q, limit) {
  const { width, features } = level;
  const px = p % width; const py = (p - px) / width;
  const qx = q % width; const qy = (q - qx) / width;
  let sum = 0;
  for (let dy = -HALF; dy <= HALF; dy += 1) {
    const ty = py + dy;
    if (ty < 0 || ty >= level.height) continue; // eslint-disable-line no-continue
    for (let dx = -HALF; dx <= HALF; dx += 1) {
      const tx = px + dx;
      if (tx < 0 || tx >= width) continue; // eslint-disable-line no-continue
      const a = (ty * width + tx) * 6;
      const b = ((qy + dy) * width + qx + dx) * 6;
      for (let k = 0; k < 5; k += 1) { const d = features[a + k] - features[b + k]; sum += d * d; }
      if (features[a + 5] < GUIDE_OFF) { const d = features[a + 5] - features[b + 5]; sum += d * d; }
      if (sum >= limit) return sum;
    }
  }
  return sum;
}

/** Target centres: every pixel whose patch touches the hole. */
function targetCentres(level) {
  const { width, height, hole } = level;
  const mark = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (!hole[y * width + x]) continue; // eslint-disable-line no-continue
    for (let dy = -HALF; dy <= HALF; dy += 1) for (let dx = -HALF; dx <= HALF; dx += 1) {
      const nx = x + dx; const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) mark[ny * width + nx] = 1;
    }
  }
  let n = 0;
  for (let i = 0; i < mark.length; i += 1) n += mark[i];
  return indicesOf(mark, n);
}

/**
 * PatchMatch: propagation from scan-order neighbours, then random search in shrinking windows.
 * A candidate costs its patch distance plus `penalty` for every other target already using it.
 */
function patchMatch(level, targets, nnf, dist, sources, rand, iterations, penalty) {
  const { width, height } = level;
  const measure = level.guide ? guidedDistance : distance;
  // Target number by pixel, over the hole's box grown by half a patch (where every target lies).
  const bx0 = Math.max(0, level.bounds.x0 - HALF); const by0 = Math.max(0, level.bounds.y0 - HALF);
  const bw = Math.min(width - 1, level.bounds.x1 + HALF) - bx0 + 1; const bh = Math.min(height - 1, level.bounds.y1 + HALF) - by0 + 1;
  const index = new Int32Array(bw * bh).fill(-1);
  const at = (x, y) => (x < bx0 || y < by0 || x >= bx0 + bw || y >= by0 + bh ? -1 : index[(y - by0) * bw + (x - bx0)]);
  targets.forEach((p, i) => { const x = p % width; index[((p - x) / width - by0) * bw + (x - bx0)] = i; });
  const uses = new Int32Array(width * height);
  for (let i = 0; i < nnf.length; i += 1) uses[nnf[i]] += 1;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const forward = iteration % 2 === 0;
    const step = forward ? 1 : -1;
    for (let n = 0; n < targets.length; n += 1) {
      const i = forward ? n : targets.length - 1 - n;
      const p = targets[i];
      const px = p % width; const py = (p - px) / width;
      let best = nnf[i];
      let bestD = dist[i];
      uses[best] -= 1;
      const share
 = level.guide && level.guide[p] < GUIDE_OFF ? GUIDED_REUSE : 1;
      let bestCost = bestD + share * penalty * uses[best];
      const consider = (q) => {
        const extra = share * penalty * uses[q];
        if (extra >= bestCost) return;
        const d = measure(level, p, q, bestCost - extra);
        if (d + extra < bestCost) { best = q; bestD = d; bestCost = d + extra; }
      };
      for (const [dx, dy] of [[-step, 0], [0, -step]]) {
        const nx = px + dx; const ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue; // eslint-disable-line no-continue
        const j = at(nx, ny);
        if (j < 0) continue; // eslint-disable-line no-continue
        const q = nnf[j] - dx - dy * width;
        const qx = q % width;
        if (q < 0 || q >= width * height || Math.abs(qx - ((nnf[j] % width) - dx)) > 0 || !sources.valid[q] || q === best) continue; // eslint-disable-line no-continue
        consider(q);
      }
      const bx = best % width; const by = (best - bx) / width;
      for (let radius = Math.max(width, height); radius >= 1; radius >>= 1) {
        const qx = Math.round(bx + (rand() * 2 - 1) * radius);
        const qy = Math.round(by + (rand() * 2 - 1) * radius);
        if (qx < 0 || qy < 0 || qx >= width || qy >= height) continue; // eslint-disable-line no-continue
        const q = qy * width + qx;
        if (!sources.valid[q] || q === best) continue; // eslint-disable-line no-continue
        consider(q);
      }
      nnf[i] = best;
      dist[i] = bestD;
      uses[best] += 1;
    }
  }
}

/** Rebuilds the hole pixels as the weighted average of every overlapping patch's source pixel. */
function vote(level, targets, nnf, dist, sharpness = 0.75, confidence = null) {
  const { width, color, hole } = level;
  const sorted = Float32Array.from(dist).sort();
  // Weights fall off with the patch distance, relative to a typical match: the lower the
  // percentile, the more the closest matches dominate (sharper, at the finest level).
  const sigma2 = Math.max(1e-8, sorted[Math.floor(sorted.length * sharpness)] ?? 1);
  // Accumulators over the hole's box only (a large fill's context is many times its size).
  const { x0, y0, x1, y1 } = level.bounds;
  const bw = x1 - x0 + 1;
  const acc = new Float32Array(bw * (y1 - y0 + 1) * 3);
  const weight = new Float32Array(bw * (y1 - y0 + 1));
  for (let i = 0; i < targets.length; i += 1) {
    const p = targets[i]; const q = nnf[i];
    const w = (Math.exp(-dist[i] / (2 * sigma2)) + 1e-6) * (confidence ? confidence[p] : 1);
    const px = p % width; const py = (p - px) / width;
    const qx = q % width; const qy = (q - qx) / width;
    for (let dy = -HALF; dy <= HALF; dy += 1) {
      const ty = py + dy;
      if (ty < 0 || ty >= level.height) continue; // eslint-disable-line no-continue
      for (let dx = -HALF; dx <= HALF; dx += 1) {
        const tx = px + dx;
        if (tx < 0 || tx >= width) continue; // eslint-disable-line no-continue
        const t = ty * width + tx;
        if (!hole[t]) continue; // eslint-disable-line no-continue
        const s = ((qy + dy) * width + qx + dx) * 3;
        const a = (ty - y0) * bw + (tx - x0);
        acc[a * 3] += w * color[s]; acc[a * 3 + 1] += w * color[s + 1]; acc[a * 3 + 2] += w * color[s + 2];
        weight[a] += w;
      }
    }
  }
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const t = y * width + x; const a = (y - y0) * bw + (x - x0);
      if (!hole[t] || !weight[a]) continue; // eslint-disable-line no-continue
      color[t * 3] = acc[a * 3] / weight[a]; color[t * 3 + 1] = acc[a * 3 + 1] / weight[a]; color[t * 3 + 2] = acc[a * 3 + 2] / weight[a];
    }
  }
}

/** The hole's pixel box { x0, y0, x1, y1 } (inclusive), or null when there is no hole. */
function holeBounds({ width, hole }) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1;
  for (let i = 0; i < hole.length; i += 1) {
    if (!hole[i]) continue; // eslint-disable-line no-continue
    const x = i % width; const y = (i - x) / width;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/**
 * Fills the hole of a region.
 * :param region: { width, height, color: Float32Array RGB (normalised, any range), hole: Uint8Array
 *   (1 = to fill), allowed: Uint8Array (1 = may be copied from) }
 * :param options: { seed, signal: { cancelled }, onProgress(fraction) }
 * :returns: the filled colour: `region.color` itself, filled in place (known pixels unchanged)
 * :throws: InpaintCancelled when `signal.cancelled` turns true (region.color is then partly filled)
 */
export function inpaint(region, { seed = 1, signal = null, onProgress = () => {} } = {}) {
  const base = makeLevel(region.width, region.height, region.color, region.hole);
  for (let i = 0; i < base.allowed.length; i += 1) base.allowed[i] = region.allowed[i] && !region.hole[i] ? 1 : 0;
  // The hole's extent decides the pyramid's depth, so preview and export start at the same scale.
  base.bounds = holeBounds(base);
  if (!base.bounds) return base.color;
  const levels = [base];
  let extent = Math.max(base.bounds.x1 - base.bounds.x0 + 1, base.bounds.y1 - base.bounds.y0 + 1);
  while (extent > COARSEST_HOLE && levels.at(-1).width >= 4 * PATCH && levels.at(-1).height >= 4 * PATCH) {
    const level = downsample(levels.at(-1));
    level.bounds = holeBounds(level);
    levels.push(level);
    extent /= 2;
  }
  // Structures are found where the hole is small enough to see them whole, then guide every level.
  const small = levels.findIndex((level) => Math.max(level.bounds.x1 - level.bounds.x0, level.bounds.y1 - level.bounds.y0) + 1 <= DETECT_EXTENT);
  const detect = small < 0 ? levels.length - 1 : small;
  const guides = findStructures(levels[detect]);

  const rand = random(seed);
  const total = levels.reduce((sum, _, i) => sum + (i === levels.length - 1 ? 6 : i === 0 ? 2 : 3), 0);
  let done = 0;
  let previous = null;
  for (let l = levels.length - 1; l >= 0; l -= 1) {
    const level = levels[l];
    const sources = sourceCentres(level);
    const targets = targetCentres(level);
    if (!sources.centres.length) {
      // Nowhere to copy from (the region is almost all hole): a smooth fill is all there is.
      diffuse(level);
      previous = null;
      if (l > 0) for (let i = 0; i < levels[l - 1].hole.length; i += 1) if (levels[l - 1].hole[i]) { const x = i % levels[l - 1].width; const y = (i - x) / levels[l - 1].width; const j = Math.min(level.height - 1, y >> 1) * level.width + Math.min(level.width - 1, x >> 1); levels[l - 1].color.set(level.color.subarray(j * 3, j * 3 + 3), i * 3); }
      continue; // eslint-disable-line no-continue
    }
    const nnf = new Int32Array(targets.length);
    const dist = new Float32Array(targets.length);
    if (previous) {
      // Finer level: the coarse field, doubled, gives each target its first source.
      const coarse = levels[l + 1];
      for (let i = 0; i < targets.length; i += 1) {
        const p = targets[i];
        const px = p % level.width; const py = (p - px) / level.width;
        const cp = Math.min(coarse.height - 1, py >> 1) * coarse.width + Math.min(coarse.width - 1, px >> 1);
        const cq = previous[cp];
        let q = -1;
        if (cq >= 0) {
          const qx = 2 * (cq % coarse.width) + (px & 1); const qy = 2 * Math.floor(cq / coarse.width) + (py & 1);
          if (qx < level.width && qy < level.height) q = qy * level.width + qx;
        }
        nnf[i] = q >= 0 && sources.valid[q] ? q : sources.centres[Math.floor(rand() * sources.centres.length)];
      }
      // The hole still holds the removed object here: rebuild it from the doubled field first
      // (equal weights), then refine.
      dist.fill(0);
      vote(level, targets, nnf, dist);
    } else {
      diffuse(level);
      for (let i = 0; i < targets.length; i += 1) nnf[i] = sources.centres[Math.floor(rand() * sources.centres.length)];
    }
    const rounds = l === levels.length - 1 ? 6 : l === 0 ? 2 : 3;
    const confidence = confidenceOf(level);
    if (guides.length) { level.guide = drawGuides(level, guides, 2 ** (detect - l), l); level.channels = 6; }
    level.features = new Float32Array(level.width * level.height * level.channels);
    for (let round = 0; round < rounds; round += 1) {
      if (signal?.cancelled) throw new InpaintCancelled();
      computeFeatures(level);
      const measure = level.guide ? guidedDistance : distance;
      for (let i = 0; i < targets.length; i += 1) dist[i] = measure(level, targets[i], nnf[i], Infinity);
      // The typical match among pixels away from structures (the guide adds to guided ones'
      // distances, which would raise every pixel's reuse penalty).
      const free = level.guide ? dist.filter((_, i) => level.guide[targets[i]] >= GUIDE_OFF) : dist;
      const pool = free.length ? free : dist;
      const typical = Float32Array.from(pool).sort()[pool.length >> 1];
      patchMatch(level, targets, nnf, dist, sources, rand, round === 0 ? 3 : 2, REUSE_PENALTY * typical);
      vote(level, targets, nnf, dist, l === 0 ? 0.1 : 0.5, confidence);
      done += 1;
      onProgress(done / total);
    }
    if (l === 0) {

      // Finest level: each hole pixel takes the centre of its own best patch, which keeps fine
      // texture (averaging overlapping patches softens it); the photo's own pixels are untouched.
      for (let i = 0; i < targets.length; i += 1) {
        const p = targets[i];
        if (!level.hole[p]) continue; // eslint-disable-line no-continue
        level.color.copyWithin(p * 3, nnf[i] * 3, nnf[i] * 3 + 3);
      }
    }
    level.features = null; level.guide = null;
    // Each target's source, by pixel, for the next finer level to start from.
    previous = new Int32Array(level.width * level.height).fill(-1);
    for (let i = 0; i < targets.length; i += 1) previous[targets[i]] = nnf[i];
  }
  return base.color;
}
