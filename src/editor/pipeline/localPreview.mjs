// Preview of local adjustments and layers over a CPU-rendered frame (the Detail preview). A
// Detail pass is a spatial filter: its unmasked result over the whole canvas depends only on its
// backdrop and its settings, not on its mask, so it is rendered once (in a worker) and kept, and
// while a brush paints, each move only mixes it again through the new mask. When the mask cache
// reports the box a move changed (mask.mjs `change`), only that box is mixed again. Every pixel
// goes through the arithmetic of composite.compositeImageSync, so the frame is identical to it.
import { mixPixel } from './blend.mjs';
import { COMPOSITE_BAND_ROWS, adjustRows, adjustmentParams, compositeRasterRows, detailPassOptions, prepareDetailPass } from './composite.mjs';
import { prepareRender } from './cpuRenderer.mjs';
import { renderDetailRows } from './detailRenderer.mjs';

/**
 * A Detail pass's unmasked result over a whole canvas `image` ({ width, height, data } RGBA8):
 * the rows composite.detailBandRows renders, for every pixel. Band by band, as an export does.
 */
export function renderDetailFrame(image, pass) {
  const { width, height, data } = image;
  const plain = { width, height, data };
  const context = prepareDetailPass(pass, detailPassOptions(plain, pass));
  const out = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += COMPOSITE_BAND_ROWS) {
    const last = Math.min(height, row + COMPOSITE_BAND_ROWS);
    renderDetailRows(plain, context, row, last, out.subarray(row * width * 4, last * width * 4));
  }
  return out;
}

// What a pass draws, apart from its mask (a Detail pass's filtered frame depends on this and its backdrop).
const ids = new WeakMap();
let nextId = 1;
const idOf = (object) => { if (!ids.has(object)) ids.set(object, nextId++); return ids.get(object); };
const filterKey = (pass) => (pass.kind === 'detail' ? `d|${JSON.stringify(pass.adjustments)}|${pass.native.width}x${pass.native.height}` : '');
const maskKey = (pass) => (pass.mask ? `${pass.mask.key ?? ''}#${pass.mask.raster ? idOf(pass.mask.raster) : ''}` : '');
// A pass without its mask.
const drawnKey = (pass) => {
  if (pass.kind === 'detail') return `${filterKey(pass)}|${pass.opacity}`;
  if (pass.kind === 'adjust') return `a|${JSON.stringify(pass.adjustments)}|${pass.lut?.sha256 ?? ''}|${pass.opacity}|${pass.mode}`;
  return `r|${idOf(pass.raster)}|${JSON.stringify([pass.matrix, pass.opacity, pass.mode, pass.bounds, pass.scale, pass.opaque])}`;
};
const passKey = (pass) => `${drawnKey(pass)}|${maskKey(pass)}`;

/** Mixes a Detail pass's filtered frame into `out` over rows [y0, y1), columns [x0, x1), through its mask. */
function mixDetail(out, detailed, pass, width, { x0, y0, x1, y1 }) {
  const codes = pass.mask?.raster?.data ?? null;
  // The opacity of each mask code, as detailBandRows computes it per pixel.
  const opacities = Float64Array.from({ length: 256 }, (_, code) => pass.opacity * (code / 255));
  for (let y = y0; y < y1; y += 1) {
    for (let p = y * width + x0, end = y * width + x1; p < end; p += 1) {
      const opacity = codes ? opacities[codes[p]] : pass.opacity;
      if (opacity > 0) mixPixel(out, p * 4, detailed, p * 4, opacity);
    }
  }
}

/** Applies a per-pixel pass (adjustment or raster) to rows [y0, y1) of `out`, as compositeImageSync does. */
function applyRows(out, pass, width, y0, y1) {
  const rows = out.subarray(y0 * width * 4, y1 * width * 4);
  if (pass.kind === 'adjust') adjustRows(rows, pass, prepareRender(adjustmentParams(pass)), { width, y0 });
  else compositeRasterRows(rows, width, y0, y1, pass);
}

/**
 * Keeps the last composited frame and the Detail passes' filtered frames.
 * :param renderDetail: async (backdrop { width, height, data }, pass) → filtered RGBA8, run in a
 *   worker; its result is kept by the backdrop and settings
 * :param onReady: called when a filtered frame arrives, to compose again
 * :param keep: filtered frames kept (each is 4 bytes per canvas pixel)
 */
export function createLocalPreview({ renderDetail, onReady = () => {}, keep = 2 }) {
  const filtered = new Map();
  const pending = new Map();
  let last = null;
  let generation = 0;

  const request = (key, backdrop, pass) => {
    if (pending.has(key)) return;
    const token = generation;
    pending.set(key, token);
    renderDetail({ width: backdrop.width, height: backdrop.height, data: backdrop.data.slice() }, pass).then((data) => {
      if (pending.get(key) !== token) return;
      pending.delete(key);
      filtered.set(key, data);
      while (filtered.size > keep) filtered.delete(filtered.keys().next().value);
      onReady();
    }, (error) => {
      if (pending.get(key) === token) pending.delete(key);
      if (error?.code !== 'cancelled') onReady(error);
    });
  };

  return {
    /**
     * The frame `base` (canvas size) with `passes` composited, or with the Detail passes whose
     * filtered frames are not ready yet left out (`complete` false; they are requested).
     * :returns: { image, dirty, complete } dirty: the box that differs from the previous result
     *   (empty: nothing), or null (all)
     */
    compose(base, passes) {
      const { width, height } = base;
      const keys = passes.map(passKey);
      // The backdrop of pass j: the base and every pass before it.
      const backdropKeys = [];
      let chain = `${idOf(base)}|${width}x${height}`;
      for (const key of keys) { backdropKeys.push(chain); chain += `>${key}`; }
      const wanted = new Set(passes.map((pass, j) => (pass.kind === 'detail' ? `${backdropKeys[j]}|${filterKey(pass)}` : null)).filter(Boolean));
      // Requests nobody needs any more cannot deliver.
      for (const key of pending.keys()) if (!wanted.has(key)) pending.delete(key);
      const ready = (j) => filtered.get(`${backdropKeys[j]}|${filterKey(passes[j])}`);
      const complete = passes.every((pass, j) => pass.kind !== 'detail' || ready(j));

      // What is drawn: the passes applied (a Detail pass still rendering is left out).
      const applied = keys.map((key, j) => (passes[j].kind !== 'detail' || ready(j) ? key : '-')).join('>');
      const same = last && last.base === base && last.complete === complete && keys.length === last.keys.length;
      // Nothing drawn changed (a pass still rendering has a new mask, a split moved): the last frame.
      if (same && applied === last.applied && [...wanted].every((key) => filtered.has(key) || pending.has(key))) {
        Object.assign(last, { keys, passes });
        return { image: last.image, dirty: { x0: 0, y0: 0, x1: 0, y1: 0 }, complete };
      }
      // Incremental: the same passes as last time except for one mask, whose raster follows the
      // last one and says which box changed; the first pass it changes is a Detail pass (its
      // backdrop is unchanged) and no Detail pass comes after it. In that box the backdrop is
      // restored and every pass from there on applied again.
      if (same && complete) {
        const changed = keys.map((key, j) => (key !== last.keys[j] ? j : -1)).filter((j) => j >= 0);
        const j = changed[0];
        const raster = passes[j].mask?.raster;
        const change = raster?.change;
        const before = last.passes[j].mask?.raster?.change;
        const onlyMask = changed.every((k) => passes[k].mask?.raster === raster && drawnKey(passes[k]) === drawnKey(last.passes[k]));
        if (onlyMask && passes[j].kind === 'detail' && last.backdrops.has(j) && passes.slice(j + 1).every(({ kind }) => kind !== 'detail')
          && change && before && change.from !== null && change.key === before.key && change.from === before.version) {
          const { dirty } = change;
          const backdrop = last.backdrops.get(j);
          Object.assign(last, { keys, passes, applied });
          if (!dirty) return { image: last.image, dirty: { x0: 0, y0: 0, x1: 0, y1: 0 }, complete };
          const out = last.image.data;
          const later = passes.slice(j + 1);
          // Later passes work on whole rows; on its own the box is enough.
          const box = later.length ? { x0: 0, x1: width, y0: dirty.y0, y1: dirty.y1 } : dirty;
          for (let y = box.y0; y < box.y1; y += 1) out.set(backdrop.subarray((y * width + box.x0) * 4, (y * width + box.x1) * 4), (y * width + box.x0) * 4);
          mixDetail(out, ready(j), passes[j], width, box);
          for (const pass of later) applyRows(out, pass, width, box.y0, box.y1);
          return { image: last.image, dirty: box, complete };
        }
      }

      const data = last?.image.width === width && last.image.height === height ? last.image.data : new Uint8ClampedArray(width * height * 4);
      data.set(base.data);
      const backdrops = new Map();
      passes.forEach((pass, j) => {
        if (pass.kind !== 'detail') { applyRows(data, pass, width, 0, height); return; }
        const detailed = ready(j);
        if (!detailed) { request(`${backdropKeys[j]}|${filterKey(pass)}`, { width, height, data }, pass); return; }
        // The backdrop is kept for the box updates (the base itself for a first pass), for two Detail passes at most.
        if (j === 0) backdrops.set(j, base.data);
        else if (backdrops.size < 2) {
          const kept = last?.backdrops.get(j);
          backdrops.set(j, kept && kept !== last.base.data && kept.length === data.length ? kept : new Uint8ClampedArray(data.length));
          backdrops.get(j).set(data);
        }
        mixDetail(data, detailed, pass, width, { x0: 0, y0: 0, x1: width, y1: height });
      });
      last = { base, keys, passes, applied, complete, backdrops, image: { width, height, data } };
      return { image: last.image, dirty: null, complete };
    },
    /** Starts filtering `base` for a Detail pass that will be the first pass (a mask about to be painted). */
    warm(base, pass) {
      const key = `${idOf(base)}|${base.width}x${base.height}|${filterKey(pass)}`;
      if (!filtered.has(key)) request(key, base, pass);
    },
    /** Forgets every frame (another photo, or the Detail preview is off). */
    clear() {
      generation += 1;
      pending.clear();
      filtered.clear();
      last = null;
    },
  };
}
