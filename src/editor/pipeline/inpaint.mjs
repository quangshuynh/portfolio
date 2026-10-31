// Content-aware fill for the Remove brush: multi-scale PatchMatch inpainting (Wexler, Shechtman
// and Irani's expectation–maximisation over a coarse-to-fine pyramid, with Barnes et al.'s
// randomised PatchMatch for the nearest-neighbour field). Every unknown pixel is rebuilt from
// patches of the surrounding photo that best match its neighbourhood in colour and in luminance
// gradient (so edges and structure continue into the hole), averaged with weights that favour
// close matches. Deterministic for the same pixels and seed; no network, no model, no server.
// Environment-free; cancellable between iterations; reports progress.

const PATCH = 7;
const HALF = (PATCH - 1) >> 1;
// The coarsest level holds the hole within about this many pixels across.
const COARSEST_HOLE = 24;
const GRADIENT_WEIGHT = 0.6;

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

// One pyramid level: feature channels (r, g, b, gx, gy), the hole and where patches may come from.
function makeLevel(width, height) {
  return { width, height, color: new Float32Array(width * height * 3), hole: new Uint8Array(width * height), allowed: new Uint8Array(width * height), features: new Float32Array(width * height * 5) };
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

/** Colour and weighted luminance gradient, the channels patches are compared on. */
function computeFeatures(level) {
  const { width, height, color, features } = level;
  const lum = (x, y) => {
    const i = (Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 3;
    return 0.2126 * color[i] + 0.7152 * color[i + 1] + 0.0722 * color[i + 2];
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      features[i * 5] = color[i * 3]; features[i * 5 + 1] = color[i * 3 + 1]; features[i * 5 + 2] = color[i * 3 + 2];
      features[i * 5 + 3] = GRADIENT_WEIGHT * (lum(x + 1, y) - lum(x - 1, y));
      features[i * 5 + 4] = GRADIENT_WEIGHT * (lum(x, y + 1) - lum(x, y - 1));
    }
  }
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
  const centres = [];
  for (let y = HALF; y < height - HALF; y += 1) {
    for (let x = HALF; x < width - HALF; x += 1) {
      const x0 = x - HALF; const y0 = y - HALF; const x1 = x + HALF + 1; const y1 = y + HALF + 1;
      const count = sat[y1 * (width + 1) + x1] - sat[y0 * (width + 1) + x1] - sat[y1 * (width + 1) + x0] + sat[y0 * (width + 1) + x0];
      if (count === PATCH * PATCH) centres.push(y * width + x);
    }
  }
  const valid = new Uint8Array(width * height);
  for (const c of centres) valid[c] = 1;
  return { centres: Int32Array.from(centres), valid };
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
  const out = [];
  for (let i = 0; i < mark.length; i += 1) if (mark[i]) out.push(i);
  return Int32Array.from(out);
}

/** PatchMatch: propagation from scan-order neighbours, then random search in shrinking windows. */
function patchMatch(level, targets, nnf, dist, sources, rand, iterations) {
  const { width, height } = level;
  const index = new Int32Array(width * height).fill(-1);
  targets.forEach((p, i) => { index[p] = i; });
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const forward = iteration % 2 === 0;
    const step = forward ? 1 : -1;
    for (let n = 0; n < targets.length; n += 1) {
      const i = forward ? n : targets.length - 1 - n;
      const p = targets[i];
      const px = p % width; const py = (p - px) / width;
      let best = nnf[i];
      let bestD = dist[i];
      for (const [dx, dy] of [[-step, 0], [0, -step]]) {
        const nx = px + dx; const ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue; // eslint-disable-line no-continue
        const j = index[ny * width + nx];
        if (j < 0) continue; // eslint-disable-line no-continue
        const q = nnf[j] - dx - dy * width;
        const qx = q % width;
        if (q < 0 || q >= width * height || Math.abs(qx - ((nnf[j] % width) - dx)) > 0 || !sources.valid[q] || q === best) continue; // eslint-disable-line no-continue
        const d = distance(level, p, q, bestD);
        if (d < bestD) { best = q; bestD = d; }
      }
      const bx = best % width; const by = (best - bx) / width;
      for (let radius = Math.max(width, height); radius >= 1; radius >>= 1) {
        const qx = Math.round(bx + (rand() * 2 - 1) * radius);
        const qy = Math.round(by + (rand() * 2 - 1) * radius);
        if (qx < 0 || qy < 0 || qx >= width || qy >= height) continue; // eslint-disable-line no-continue
        const q = qy * width + qx;
        if (!sources.valid[q] || q === best) continue; // eslint-disable-line no-continue
        const d = distance(level, p, q, bestD);
        if (d < bestD) { best = q; bestD = d; }
      }
      nnf[i] = best;
      dist[i] = bestD;
    }
  }
}

/** Rebuilds the hole pixels as the weighted average of every overlapping patch's source pixel. */
function vote(level, targets, nnf, dist, sharpness = 0.75) {
  const { width, color, hole } = level;
  const sorted = Float32Array.from(dist).sort();
  // Weights fall off with the patch distance, relative to a typical match: the lower the
  // percentile, the more the closest matches dominate (sharper, at the finest level).
  const sigma2 = Math.max(1e-8, sorted[Math.floor(sorted.length * sharpness)] ?? 1);
  const acc = new Float64Array(width * level.height * 3);
  const weight = new Float64Array(width * level.height);
  for (let i = 0; i < targets.length; i += 1) {
    const p = targets[i]; const q = nnf[i];
    const w = Math.exp(-dist[i] / (2 * sigma2)) + 1e-6;
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
        acc[t * 3] += w * color[s]; acc[t * 3 + 1] += w * color[s + 1]; acc[t * 3 + 2] += w * color[s + 2];
        weight[t] += w;
      }
    }
  }
  for (let t = 0; t < weight.length; t += 1) {
    if (!hole[t] || !weight[t]) continue; // eslint-disable-line no-continue
    color[t * 3] = acc[t * 3] / weight[t]; color[t * 3 + 1] = acc[t * 3 + 1] / weight[t]; color[t * 3 + 2] = acc[t * 3 + 2] / weight[t];
  }
}

/**
 * Fills the hole of a region.
 * :param region: { width, height, color: Float32Array RGB (normalised, any range), hole: Uint8Array
 *   (1 = to fill), allowed: Uint8Array (1 = may be copied from) }
 * :param options: { seed, signal: { cancelled }, onProgress(fraction) }
 * :returns: the filled colour (Float32Array RGB, the region's size); known pixels unchanged
 * :throws: InpaintCancelled when `signal.cancelled` turns true
 */
export function inpaint(region, { seed = 1, signal = null, onProgress = () => {} } = {}) {
  const base = makeLevel(region.width, region.height);
  base.color.set(region.color);
  base.hole.set(region.hole);
  for (let i = 0; i < base.allowed.length; i += 1) base.allowed[i] = region.allowed[i] && !region.hole[i] ? 1 : 0;
  // The hole's extent decides the pyramid's depth, so preview and export start at the same scale.
  let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1;
  for (let i = 0; i < base.hole.length; i += 1) {
    if (!base.hole[i]) continue; // eslint-disable-line no-continue
    const x = i % base.width; const y = (i - x) / base.width;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  if (x1 < 0) return base.color;
  const levels = [base];
  let extent = Math.max(x1 - x0 + 1, y1 - y0 + 1);
  while (extent > COARSEST_HOLE && levels.at(-1).width >= 4 * PATCH && levels.at(-1).height >= 4 * PATCH) {
    levels.push(downsample(levels.at(-1)));
    extent /= 2;
  }
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
        const cq = previous.map.get(cp);
        let q = -1;
        if (cq !== undefined) {
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
    for (let round = 0; round < rounds; round += 1) {
      if (signal?.cancelled) throw new InpaintCancelled();
      computeFeatures(level);
      for (let i = 0; i < targets.length; i += 1) dist[i] = distance(level, targets[i], nnf[i], Infinity);
      patchMatch(level, targets, nnf, dist, sources, rand, round === 0 ? 3 : 2);
      vote(level, targets, nnf, dist, l === 0 ? 0.1 : 0.5);
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
    const map = new Map();
    for (let i = 0; i < targets.length; i += 1) map.set(targets[i], nnf[i]);
    previous = { map };
  }
  return base.color;
}
