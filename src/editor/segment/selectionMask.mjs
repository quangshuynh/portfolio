// Evaluating a saved selection component (model/masks.mjs, type 'selection'): its coverage grid
// (in the photo's own space, at analysis resolution) decoded once, with its edge refinements
// (shift, feather) applied once, then sampled bilinearly wherever a preview or an export renders.
// Grids are cached by their data string (a few at a time: each is at most about 4 MB of floats).
import { boxMean, decodeCodes } from './analysis.mjs';

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
