// Evaluating a saved selection component (model/masks.mjs, type 'selection'): its coverage grid
// (in the photo's own space, at analysis resolution) decoded once, with its edge refinements
// (shift, feather) applied once, then sampled bilinearly wherever a preview or an export renders.
// Grids are cached by their data string (a few at a time: each is at most about 4 MB of floats).
//
// Refined selections (Interval 24.2, segment/refine.mjs): a component whose `refine` is set is
// sampled from its refined tile map once one is registered here under the key the editor gave it
// (`refinedKey`, set on render copies of the mask, never saved). Until then it is sampled from its
// grid, as before; an export registers every map it needs first (on its render workers too), so a
// preview and its export sample the same map.
import { boxMean, decodeCodes } from './analysis.mjs';
import { tileMapBytes, tileMapSample } from './refine.mjs';

const REFINED = new Map();
let refinedBudget = 96 * 1024 * 1024;
let refinedVersion = 0;

/** A short hash of a string (two FNV-1a lanes, hex): identifies a selection's data in keys. */
export function textHash(text) {
  let h1 = 0x811c9dc5; let h2 = 0x050c5d1f;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/**
 * The key of a component's refinement for an owner (the image its grid describes): everything the
 * refined map depends on. Null when the component is not refined.
 */
export const refinementKey = (ownerKey, c) => (c?.type === 'selection' && c.refine
  ? `${ownerKey}|${textHash(c.data)}|${c.width}x${c.height}|${c.refine.version}|${c.refine.radius}|${c.shift}|${c.feather}`
  : null);

/** Registers a refined tile map; the least recently registered leave past the byte budget. */
export function registerRefined(key, map) {
  REFINED.delete(key);
  REFINED.set(key, map);
  let bytes = 0;
  for (const m of REFINED.values()) bytes += tileMapBytes(m);
  for (const [k, m] of REFINED) {
    if (bytes <= refinedBudget || k === key) break;
    REFINED.delete(k);
    bytes -= tileMapBytes(m);
  }
  refinedVersion += 1;
}
export const refinedMap = (key) => REFINED.get(key) ?? null;
/** Changes whenever a map is registered or dropped. */
export const refinedState = () => refinedVersion;
/** Drops maps (those `keep(key)` rejects, or all). */
export function forgetRefined(keep = null) {
  for (const k of [...REFINED.keys()]) if (!keep || !keep(k)) REFINED.delete(k);
  refinedVersion += 1;
}
export function setRefinedBudget(bytes) { refinedBudget = bytes; }
export const refinedBytes = () => [...REFINED.values()].reduce((sum, m) => sum + tileMapBytes(m), 0);

/** Box (refined pixels, exclusive) of a tile map's non-zero tiles, or null. */
function tileBox(map) {
  let box = null;
  for (let ty = 0; ty < map.rows; ty += 1) {
    for (let tx = 0; tx < map.cols; tx += 1) {
      if (!map.states[ty * map.cols + tx]) continue; // eslint-disable-line no-continue
      const b = { x0: tx * map.tile, y0: ty * map.tile, x1: Math.min(map.width, (tx + 1) * map.tile), y1: Math.min(map.height, (ty + 1) * map.tile) };
      box = box ? { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) } : b;
    }
  }
  return box;
}
const REFINED_PREP = new WeakMap();

const CACHE = new Map();
const CACHE_ENTRIES = 6;

/** Coverage after moving the edge out (shift > 0) or in (< 0) by up to 1 % of the long edge. */
function shifted(grid, width, height, shift) {
  const reach = Math.round(Math.abs(shift) * 0.01 * Math.max(width, height));
  if (!reach) return grid;
  const g = boxMean(boxMean(grid, width, height, reach), width, height, Math.max(1, reach >> 1));
  const centre = 0.5 - 0.45 * shift;
  const out = new Float32Array(grid.length);
  for (let i = 0; i < out.length; i += 1) out[i] = Math.min(1, Math.max(0, (g[i] - centre) / 0.5 + 0.5));
  return out;
}

/** Coverage softened over up to 2 % of the long edge (three box passes ≈ a Gaussian). */
function feathered(grid, width, height, feather) {
  const r = Math.round(feather * 0.02 * Math.max(width, height) / 3);
  if (!r) return grid;
  return boxMean(boxMean(boxMean(grid, width, height, r), width, height, r), width, height, r);
}

/**
 * A selection component's grid ready for sampling, or null when its data cannot be decoded.
 * :returns: { grid (Float32, 0–1), width, height, box } with `box` the cells that are non-zero
 *   ({ x0, y0, x1, y1 }, exclusive) or null when none is
 */
export function prepareSelection(c) {
  const refined = c.refinedKey ? REFINED.get(c.refinedKey) : null;
  if (refined) {
    if (!REFINED_PREP.has(refined)) REFINED_PREP.set(refined, { refined, width: refined.width, height: refined.height, box: tileBox(refined) });
    return REFINED_PREP.get(refined);
  }
  const params = `${c.width}x${c.height}|${c.shift}|${c.feather}`;
  let entry = CACHE.get(c.data);
  if (entry) { CACHE.delete(c.data); CACHE.set(c.data, entry); }
  else {
    const codes = decodeCodes(c.data, c.width * c.height);
    entry = { codes, prepared: new Map() };
    CACHE.set(c.data, entry);
    while (CACHE.size > CACHE_ENTRIES) CACHE.delete(CACHE.keys().next().value);
  }
  if (!entry.codes) return null;
  if (!entry.prepared.has(params)) {
    let grid = new Float32Array(entry.codes.length);
    for (let i = 0; i < grid.length; i += 1) grid[i] = entry.codes[i] / 255;
    grid = feathered(shifted(grid, c.width, c.height, c.shift), c.width, c.height, c.feather);
    let box = null;
    for (let y = 0; y < c.height; y += 1) {
      for (let x = 0; x < c.width; x += 1) {
        if (grid[y * c.width + x] <= 1 / 512) continue; // eslint-disable-line no-continue
        if (!box) box = { x0: x, y0: y, x1: x + 1, y1: y + 1 };
        else { box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y); box.x1 = Math.max(box.x1, x + 1); box.y1 = Math.max(box.y1, y + 1); }
      }
    }
    entry.prepared.clear();
    entry.prepared.set(params, { grid, width: c.width, height: c.height, box });
  }
  return entry.prepared.get(params);
}

/** Whether a selection component's data decodes to its grid (validation of untrusted input). */
export const selectionDecodes = (c) => Boolean(prepareSelection(c));

/** Coverage (0–1) at a point of the mask's space, in its pixels (`map.width` × `map.height`). */
export function selectionAt(prep, map, sx, sy) {
  if (prep.refined) return tileMapSample(prep.refined, (sx / map.width) * prep.width, (sy / map.height) * prep.height);
  const { grid, width, height } = prep;
  const gx = Math.min(width - 1, Math.max(0, (sx / map.width) * width - 0.5));
  const gy = Math.min(height - 1, Math.max(0, (sy / map.height) * height - 0.5));
  const ix = Math.floor(gx); const iy = Math.floor(gy);
  const jx = Math.min(width - 1, ix + 1); const jy = Math.min(height - 1, iy + 1);
  const tx = gx - ix; const ty = gy - iy;
  const top = grid[iy * width + ix] * (1 - tx) + grid[iy * width + jx] * tx;
  const bottom = grid[jy * width + ix] * (1 - tx) + grid[jy * width + jx] * tx;
  return top * (1 - ty) + bottom * ty;
}

/** The space box (mask-space pixels) outside which the selection is 0, or null when it is empty. */
export function selectionSpaceBox(prep, map) {
  if (!prep.box) return null;
  const sx = map.width / prep.width;
  const sy = map.height / prep.height;
  return { x0: (prep.box.x0 - 1) * sx, y0: (prep.box.y0 - 1) * sy, x1: (prep.box.x1 + 1) * sx, y1: (prep.box.y1 + 1) * sy };
}
