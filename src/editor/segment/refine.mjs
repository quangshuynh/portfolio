// Edge refinement of a selection (Interval 24.2): the selection's coverage grid (analysis
// resolution, usually 1024 px) is refined against the image it describes at high resolution
// (the owner's own pixels, up to REFINE_EDGE on the long edge), so a 24 MP export has edges at
// its own detail instead of an upscaled 1024 px outline. The models never run again.
//
// Method (`contour-colour/1`, chosen on synthetic composites with exact alpha and 24 MP car
// photos; see docs/photography-editor.md, Edge refinement):
//  1. The grid, sampled bilinearly as before, is sharpened around its 0.5 contour to a ramp of
//     about 1.5 px. This removes the soft, background-textured fringe a 1024 px grid has at 24 MP
//     while keeping its edge where the models put it, sub-pixel.
//  2. Within D px of that contour, each pixel's coverage is estimated from its colour against the
//     local inside and outside colours (means of the confident pixels just beyond the band, in a
//     triangle window), as simple matting, so the edge lands on the photo's own edge and mixed
//     pixels get partial coverage. The estimate is trusted only where the two sides differ well
//     beyond their own texture, both are sampled, an image edge lies within reach, the pixel is
//     explained by a mix of the two colours (a reflection or highlight is not), and fading with
//     the distance from the original contour, so interiors and outlines never move far.
//  3. A light guided filter smooths the estimate; changes forming islands (a hole inside a panel,
//     a speck outside) are undone.
//  4. Edge (shift) and Feather apply afterwards, at this resolution.
// Only tiles near the outline are computed (each in a window with a halo, so a tile's result
// never depends on the order of computation); everything else is exactly 0 or 1. The result is a
// sparse tile map of 8-bit codes, sampled like the grid (segment/selectionMask.mjs).
import { boxMean } from './analysis.mjs';

export const REFINE_VERSION = 'contour-colour/1';
/** Longest edge refinement runs at (24 MP sensors are refined at their own size). */
export const REFINE_EDGE = 6144;
const TILE = 128;
const GATE = 0.08; // colour step (RGB distance, 0–1 channels, over 2 px) that counts as an image edge
const CONTRAST = [1, 2]; // side difference / side spread: untrusted below, trusted above

const sstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The size refinement runs at for an owner of `width` × `height` (never larger than it). */
export function refineSize(width, height, edge = REFINE_EDGE) {
  const scale = Math.min(1, edge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Band half-width and reach (px) for `radius` (0–1) at `scale` refinement px per grid cell. */
export function refineReach(scale, radius = 0) {
  const grow = 1 + 3 * clamp01(radius);
  return { band: Math.max(3, Math.round(Math.max(1, scale) * grow)), reach: Math.max(2, (Math.max(1, scale) / 2) * grow) };
}

// ---- Tile maps: { width, height, tile, cols, rows, states (0 empty, 255 full, 1 data), offsets, data } ----

function emptyMap(width, height) {
  const cols = Math.ceil(width / TILE); const rows = Math.ceil(height / TILE);
  return { width, height, tile: TILE, cols, rows, states: new Uint8Array(cols * rows), offsets: new Int32Array(cols * rows).fill(-1), data: new Uint8Array(0) };
}

/** Code (0–255) of a tile map at integer pixel (x, y), clamped to its edges. */
export function tileMapCode(map, x, y) {
  const cx = x < 0 ? 0 : x >= map.width ? map.width - 1 : x;
  const cy = y < 0 ? 0 : y >= map.height ? map.height - 1 : y;
  const t = ((cy / map.tile) | 0) * map.cols + ((cx / map.tile) | 0);
  const state = map.states[t];
  if (state !== 1) return state;
  return map.data[map.offsets[t] + (cy % map.tile) * map.tile + (cx % map.tile)];
}

/** Bytes a tile map holds. */
export const tileMapBytes = (map) => map.data.byteLength + map.states.byteLength + map.offsets.byteLength;

/** The transferable buffers of a tile map (postMessage). */
export const tileMapTransfer = (map) => [map.data.buffer, map.states.buffer, map.offsets.buffer];

/** Packs per-tile code arrays (Map tile index → Uint8Array, or constants) into a tile map. */
function pack(width, height, tiles) {
  const map = emptyMap(width, height);
  let count = 0;
  for (const [t, v] of tiles) {
    if (typeof v === 'number') { map.states[t] = v; continue; } // eslint-disable-line no-continue
    let lo = 255; let hi = 0;
    for (let i = 0; i < v.length; i += 1) { if (v[i] < lo) lo = v[i]; if (v[i] > hi) hi = v[i]; }
    if (lo === hi && (lo === 0 || lo === 255)) { map.states[t] = lo; tiles.set(t, lo); } else { map.states[t] = 1; count += 1; }
  }
  map.data = new Uint8Array(count * TILE * TILE);
  let k = 0;
  for (const [t, v] of tiles) {
    if (typeof v === 'number') continue; // eslint-disable-line no-continue
    map.offsets[t] = k * TILE * TILE;
    map.data.set(v, k * TILE * TILE);
    k += 1;
  }
  return map;
}

/** Reads a window [x0, x0 + w) × [y0, y0 + h) of a tile map (clamped at its edges) as 0–1 values. */
function readWindow(map, x0, y0, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) out[y * w + x] = tileMapCode(map, x0 + x, y0 + y) / 255;
  return out;
}

// ---- Refinement ----

/** The coarse grid bilinearly at refinement pixels of a window (as segment/selectionMask.mjs samples it). */
function coarseWindow(grid, W, H, x0, y0, w, h) {
  const { codes, width: gw, height: gh } = grid;
  const out = new Float32Array(w * h);
  const fx = gw / W; const fy = gh / H;
  for (let y = 0; y < h; y += 1) {
    const sy = Math.min(gh - 1, Math.max(0, (Math.min(H - 1, Math.max(0, y0 + y)) + 0.5) * fy - 0.5));
    const iy = Math.floor(sy); const jy = Math.min(gh - 1, iy + 1); const ty = sy - iy;
    for (let x = 0; x < w; x += 1) {
      const sx = Math.min(gw - 1, Math.max(0, (Math.min(W - 1, Math.max(0, x0 + x)) + 0.5) * fx - 0.5));
      const ix = Math.floor(sx); const jx = Math.min(gw - 1, ix + 1); const tx = sx - ix;
      const top = codes[iy * gw + ix] * (1 - tx) + codes[iy * gw + jx] * tx;
      const bottom = codes[jy * gw + ix] * (1 - tx) + codes[jy * gw + jx] * tx;
      out[y * w + x] = (top * (1 - ty) + bottom * ty) / 255;
    }
  }
  return out;
}

/** Pixels within d (Chebyshev) of the 0.5 contour of U. */
function contourBand(U, w, h, d) {
  const e = new Float32Array(U.length);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x; const a = U[i] >= 0.5;
      if (x + 1 < w && (U[i + 1] >= 0.5) !== a) { e[i] = 1; e[i + 1] = 1; }
      if (y + 1 < h && (U[i + w] >= 0.5) !== a) { e[i] = 1; e[i + w] = 1; }
    }
  }
  const m = boxMean(e, w, h, d);
  const band = new Uint8Array(U.length);
  for (let i = 0; i < U.length; i += 1) band[i] = m[i] > 1e-7 ? 1 : 0;
  return band;
}

function greyGuided(guide, p, w, h, r, eps) {
  const n = p.length;
  const gp = new Float32Array(n); const gg = new Float32Array(n);
  for (let i = 0; i < n; i += 1) { gp[i] = guide[i] * p[i]; gg[i] = guide[i] * guide[i]; }
  const mI = boxMean(guide, w, h, r); const mp = boxMean(p, w, h, r); const mIp = boxMean(gp, w, h, r); const mII = boxMean(gg, w, h, r);
  const a = new Float32Array(n); const b = new Float32Array(n);
  for (let i = 0; i < n; i += 1) { const v = mII[i] - mI[i] * mI[i]; a[i] = (mIp[i] - mI[i] * mp[i]) / (v + eps); b[i] = mp[i] - a[i] * mI[i]; }
  const ma = boxMean(a, w, h, r); const mb = boxMean(b, w, h, r);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = ma[i] * guide[i] + mb[i];
  return out;
}

/** Undoes changes that form islands: a pixel turned to one side must connect to that side of the prior. */
function undoIslands(alpha, prior, w, h) {
  const n = w * h;
  const seen = new Uint8Array(n); const stack = new Int32Array(n);
  for (const side of [0, 1]) {
    seen.fill(0);
    let top = 0;
    const now = (i) => (side ? alpha[i] >= 0.5 : alpha[i] < 0.5);
    const was = (i) => (side ? prior[i] >= 0.5 : prior[i] < 0.5);
    for (let i = 0; i < n; i += 1) if (now(i) && was(i)) { seen[i] = 1; stack[top++] = i; }
    while (top) {
      const i = stack[--top]; const x = i % w;
      if (x > 0 && !seen[i - 1] && now(i - 1)) { seen[i - 1] = 1; stack[top++] = i - 1; }
      if (x < w - 1 && !seen[i + 1] && now(i + 1)) { seen[i + 1] = 1; stack[top++] = i + 1; }
      if (i >= w && !seen[i - w] && now(i - w)) { seen[i - w] = 1; stack[top++] = i - w; }
      if (i + w < n && !seen[i + w] && now(i + w)) { seen[i + w] = 1; stack[top++] = i + w; }
    }
    for (let i = 0; i < n; i += 1) if (now(i) && !was(i) && !seen[i]) alpha[i] = prior[i];
  }
}

/**
 * Refined coverage of one window (refinement pixels; see the comment at the top).
 * :param U: the coarse grid sampled over the window; `rgb` 0–1 channel planes, `lum` luminance
 * :returns: Float32 coverage of the window
 */
export function refineWindow(U, rgb, lum, w, h, { scale, radius = 0 }) {
  const n = w * h;
  const k = Math.max(1, scale / 1.5);
  const { band: D, reach } = refineReach(scale, radius);
  const S = new Float32Array(n);
  for (let i = 0; i < n; i += 1) S[i] = clamp01((U[i] - 0.5) * k + 0.5);
  if (scale <= 1 && !radius) return S;
  const band = contourBand(U, w, h, D);
  // Side statistics: confident pixels beyond the band, triangle window of radius 3D.
  const r2 = Math.max(1, Math.round(1.5 * D));
  const tri = (a) => boxMean(boxMean(a, w, h, r2), w, h, r2);
  const sides = [0, 1].map((inside) => {
    const wgt = new Float32Array(n);
    for (let i = 0; i < n; i += 1) if (!band[i] && (U[i] >= 0.5) === Boolean(inside)) wgt[i] = 1;
    const m = rgb.map((ch) => { const o = new Float32Array(n); for (let i = 0; i < n; i += 1) o[i] = ch[i] * wgt[i]; return tri(o); });
    const q = new Float32Array(n);
    for (let i = 0; i < n; i += 1) q[i] = (rgb[0][i] ** 2 + rgb[1][i] ** 2 + rgb[2][i] ** 2) * wgt[i];
    return { w: tri(wgt), m, q: tri(q) };
  });
  // Image edges within reach.
  const strong = new Float32Array(n);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      let g = 0;
      for (let c = 0; c < 3; c += 1) g += (rgb[c][i + 1] - rgb[c][i - 1]) ** 2 + (rgb[c][i + w] - rgb[c][i - w]) ** 2;
      if (g > GATE * GATE) strong[i] = 1;
    }
  }
  const edgeNear = boxMean(strong, w, h, Math.max(1, Math.round(reach)));
  const alpha = Float32Array.from(S);
  const fade = Math.max(reach + 0.5, 0.75 * D);
  const [b, f] = sides;
  for (let i = 0; i < n; i += 1) {
    if (!band[i] || edgeNear[i] <= 1e-7 || f.w[i] < 1e-4 || b.w[i] < 1e-4) continue; // eslint-disable-line no-continue
    let num = 0; let den = 0; let f2 = 0; let b2 = 0;
    const F = [0, 0, 0]; const B = [0, 0, 0];
    for (let c = 0; c < 3; c += 1) { F[c] = f.m[c][i] / f.w[i]; B[c] = b.m[c][i] / b.w[i]; f2 += F[c] ** 2; b2 += B[c] ** 2; }
    for (let c = 0; c < 3; c += 1) { const d = F[c] - B[c]; num += (rgb[c][i] - B[c]) * d; den += d * d; }
    if (den < 1e-8) continue; // eslint-disable-line no-continue
    const spread = Math.sqrt(Math.max(0, f.q[i] / f.w[i] - f2)) + Math.sqrt(Math.max(0, b.q[i] / b.w[i] - b2));
    let wt = sstep(CONTRAST[0], CONTRAST[1], Math.sqrt(den) / (spread + 0.015)) * sstep(0.005, 0.03, Math.min(f.w[i], b.w[i]));
    wt *= 1 - sstep(reach, fade, Math.abs(U[i] - 0.5) * 2 * scale);
    if (wt <= 0) continue; // eslint-disable-line no-continue
    const a = clamp01(num / den);
    let err = 0;
    for (let c = 0; c < 3; c += 1) err += (rgb[c][i] - (a * F[c] + (1 - a) * B[c])) ** 2;
    wt *= 1 - sstep(0.25, 0.6, Math.sqrt(err) / (Math.sqrt(den) + 0.02));
    alpha[i] = wt * a + (1 - wt) * S[i];
  }
  const smooth = greyGuided(lum, alpha, w, h, 1, 1e-4);
  for (let i = 0; i < n; i += 1) if (band[i]) alpha[i] = clamp01(smooth[i]);
  undoIslands(alpha, S, w, h);
  return alpha;
}

/** Coverage after moving the edge out (shift > 0) or in by up to 1 % of the long edge, keeping a crisp ramp. */
function shiftWindow(a, w, h, shift, long) {
  const reach = Math.round(Math.abs(shift) * 0.01 * long);
  if (!reach) return a;
  const r2 = Math.max(1, reach >> 1);
  const g = boxMean(boxMean(a, w, h, reach), w, h, r2);
  const centre = 0.5 - 0.45 * shift;
  const slope = Math.max(2, (reach + r2) / 0.75);
  const out = new Float32Array(a.length);
  for (let i = 0; i < out.length; i += 1) out[i] = clamp01((g[i] - centre) * slope + 0.5);
  return out;
}
const featherRadius = (feather, long) => Math.round((feather * 0.02 * long) / 3);
function featherWindow(a, w, h, r) {
  if (!r) return a;
  return boxMean(boxMean(boxMean(a, w, h, r), w, h, r), w, h, r);
}

const toCodes = (a, w, x0, y0, tw, th) => {
  const out = new Uint8Array(TILE * TILE);
  for (let y = 0; y < th; y += 1) for (let x = 0; x < tw; x += 1) out[y * TILE + x] = Math.round(clamp01(a[(y0 + y) * w + x0 + x]) * 255);
  // Pixels beyond the image (last row and column of tiles) repeat the edge, for sampling.
  for (let y = 0; y < TILE; y += 1) for (let x = 0; x < TILE; x += 1) if (x >= tw || y >= th) out[y * TILE + x] = out[Math.min(th - 1, y) * TILE + Math.min(tw - 1, x)];
  return out;
};

/**
 * Refines a selection grid against `guide` (RGBA8 at the refinement size; transparent pixels are
 * seen over mid grey and coverage is limited to the guide's alpha).
 * :param grid: { width, height, codes } (codes: Uint8 0–255, the stored grid)
 * :param options: { radius 0–1, shift −1–1, feather 0–1 }
 * :param hooks: { onProgress(fraction), cancelled() }
 * :returns: a tile map at the guide's size
 */
export function refineSelection(grid, guide, { radius = 0, shift = 0, feather = 0 } = {}, { onProgress = () => {}, cancelled = () => false } = {}) {
  const { width: W, height: H, data } = guide;
  const scale = W / grid.width;
  const k = Math.max(1, scale / 1.5);
  const { band: D } = refineReach(scale, radius);
  const halo = 4 * D + 4;
  const cols = Math.ceil(W / TILE); const rows = Math.ceil(H / TILE);
  const lo = Math.floor(255 * (0.5 - 0.5 / k)); const hi = Math.ceil(255 * (0.5 + 0.5 / k));
  let opaque = true;
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) { opaque = false; break; }
  // A tile is constant when every grid cell it (with a band's margin) interpolates is decisively
  // outside or inside, and the guide is opaque there.
  const constantOf = (tx, ty) => {
    const m = D + 2;
    const gx0 = Math.max(0, Math.floor(((tx * TILE - m) / W) * grid.width) - 1); const gx1 = Math.min(grid.width - 1, Math.ceil((((tx + 1) * TILE + m) / W) * grid.width) + 1);
    const gy0 = Math.max(0, Math.floor(((ty * TILE - m) / H) * grid.height) - 1); const gy1 = Math.min(grid.height - 1, Math.ceil((((ty + 1) * TILE + m) / H) * grid.height) + 1);
    let all0 = true; let all1 = true;
    for (let y = gy0; y <= gy1 && (all0 || all1); y += 1) {
      for (let x = gx0; x <= gx1; x += 1) { const c = grid.codes[y * grid.width + x]; if (c > lo) all0 = false; if (c < hi) all1 = false; }
    }
    if (!all0 && !all1) return null;
    if (!opaque && all1) {
      for (let y = ty * TILE; y < Math.min(H, (ty + 1) * TILE); y += 1) for (let x = tx * TILE; x < Math.min(W, (tx + 1) * TILE); x += 1) if (data[(y * W + x) * 4 + 3] !== 255) return null;
    }
    return all0 ? 0 : 255;
  };
  const tiles = new Map();
  const work = [];
  for (let ty = 0; ty < rows; ty += 1) for (let tx = 0; tx < cols; tx += 1) { const c = constantOf(tx, ty); if (c === null) work.push(ty * cols + tx); else tiles.set(ty * cols + tx, c); }
  const long = Math.max(W, H);
  const shiftReach = Math.round(Math.abs(shift) * 0.01 * long);
  const fr = featherRadius(feather, long);
  const later = shiftReach || fr ? 0.5 : 1;
  for (const [done, t] of work.entries()) {
    if (cancelled()) throw new Error('cancelled');
    const tx = t % cols; const ty = (t / cols) | 0;
    const x0 = tx * TILE - halo; const y0 = ty * TILE - halo;
    const wx0 = Math.max(0, x0); const wy0 = Math.max(0, y0);
    const w = Math.min(W, (tx + 1) * TILE + halo) - wx0; const h = Math.min(H, (ty + 1) * TILE + halo) - wy0;
    const U = coarseWindow(grid, W, H, wx0, wy0, w, h);
    const rgb = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)];
    const lum = new Float32Array(w * h);
    const alphaGuide = opaque ? null : new Float32Array(w * h);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const s = ((wy0 + y) * W + wx0 + x) * 4; const i = y * w + x;
        const a = data[s + 3] / 255;
        for (let c = 0; c < 3; c += 1) rgb[c][i] = (data[s + c] * a + 128 * (1 - a)) / 255;
        lum[i] = 0.299 * rgb[0][i] + 0.587 * rgb[1][i] + 0.114 * rgb[2][i];
        if (alphaGuide) alphaGuide[i] = a;
      }
    }
    const refined = refineWindow(U, rgb, lum, w, h, { scale, radius });
    if (alphaGuide) for (let i = 0; i < refined.length; i += 1) refined[i] *= alphaGuide[i];
    const tw = Math.min(TILE, W - tx * TILE); const th = Math.min(TILE, H - ty * TILE);
    tiles.set(t, toCodes(refined, w, tx * TILE - wx0, ty * TILE - wy0, tw, th));
    if (done % 8 === 0) onProgress(((done + 1) / work.length) * later);
  }
  let map = pack(W, H, tiles);
  if (!shiftReach && !fr) { onProgress(1); return map; }
  // Edge and Feather, at this resolution, on the tiles they can reach.
  const h2 = (shiftReach ? shiftReach + Math.max(1, shiftReach >> 1) : 0) + 3 * fr + 1;
  const reachT = Math.ceil(h2 / TILE);
  const next = new Map();
  const todo = [];
  for (let ty = 0; ty < rows; ty += 1) {
    for (let tx = 0; tx < cols; tx += 1) {
      const t = ty * cols + tx;
      let near = false;
      for (let y = Math.max(0, ty - reachT); y <= Math.min(rows - 1, ty + reachT) && !near; y += 1) for (let x = Math.max(0, tx - reachT); x <= Math.min(cols - 1, tx + reachT); x += 1) if (map.states[y * cols + x] === 1) { near = true; break; }
      if (near) todo.push(t); else next.set(t, map.states[t]);
    }
  }
  for (const [done, t] of todo.entries()) {
    if (cancelled()) throw new Error('cancelled');
    const tx = t % cols; const ty = (t / cols) | 0;
    const wx0 = tx * TILE - h2; const wy0 = ty * TILE - h2; const w = TILE + 2 * h2; const h = TILE + 2 * h2;
    let a = readWindow(map, wx0, wy0, w, h);
    a = featherWindow(shiftWindow(a, w, h, shift, long), w, h, fr);
    const tw = Math.min(TILE, W - tx * TILE); const th = Math.min(TILE, H - ty * TILE);
    next.set(t, toCodes(a, w, h2, h2, tw, th));
    if (done % 8 === 0) onProgress(0.5 + ((done + 1) / todo.length) * 0.5);
  }
  map = pack(W, H, next);
  onProgress(1);
  return map;
}

/** Bilinear coverage (0–1) of a tile map at refinement-pixel coordinates (gx, gy), pixel centres at +0.5. */
export function tileMapSample(map, gx, gy) {
  const x = Math.min(map.width - 1, Math.max(0, gx - 0.5));
  const y = Math.min(map.height - 1, Math.max(0, gy - 0.5));
  const ix = x | 0; const iy = y | 0; const tx = x - ix; const ty = y - iy;
  const jx = Math.min(map.width - 1, ix + 1); const jy = Math.min(map.height - 1, iy + 1);
  const top = tileMapCode(map, ix, iy) * (1 - tx) + tileMapCode(map, jx, iy) * tx;
  const bottom = tileMapCode(map, ix, jy) * (1 - tx) + tileMapCode(map, jx, jy) * tx;
  return (top * (1 - ty) + bottom * ty) / 255;
}
