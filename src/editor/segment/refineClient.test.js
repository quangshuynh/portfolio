import { afterEach, describe, expect, it } from 'vitest';
import { encodeCodes } from './analysis.mjs';
import { REFINE_VERSION, refineSelection } from './refine.mjs';
import {
  createRefiner, layerOwnerKey, newRefine, photoOwnerKey, refinedMapsOf, refinedMask, refinedValues, refinementsOf,
} from './refineClient.mjs';
import { forgetRefined, prepareSelection, refinedBytes, refinedMap, refinementKey, registerRefined, selectionAt, setRefinedBudget, textHash } from './selectionMask.mjs';
import { createSelection, normalizeMask } from '../model/masks.mjs';
import { DOCUMENT_VERSION, createEditDocument, parseEditDocument, serializeEditDocument } from '../model/editDocument.mjs';
import { neutralAdjustments } from '../model/adjustments.mjs';
import { layerMaskMap, maskMap, rasterizeMask } from '../pipeline/mask.mjs';
import { layerMatrix } from '../pipeline/layerTransform.mjs';
import { handlers } from '../io/imageTasks.mjs';

// A 32 × 8 grid with a soft vertical edge at cell 15, and a 256 × 64 guide whose edge is at 125 px.
const GW = 32; const GH = 8; const W = 256; const H = 64;
function grid() {
  const codes = new Uint8Array(GW * GH);
  for (let y = 0; y < GH; y += 1) for (let x = 0; x < GW; x += 1) codes[y * GW + x] = Math.round(255 * Math.min(1, Math.max(0, 0.5 - (x + 0.5 - 15) / 3)));
  return codes;
}
function guide(edge = 125) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i += 1) data.set((i % W) < edge ? [210, 50, 40, 255] : [30, 80, 210, 255], i * 4);
  return { width: W, height: H, data };
}
const selection = (patch = {}) => createSelection('s1', { kind: 'subject', version: 'test/1', width: GW, height: GH, data: encodeCodes(grid()), confidence: 0.9 }, { refine: newRefine(), ...patch });
const photoKey = 'photo|abc';

afterEach(() => { forgetRefined(); setRefinedBudget(96 * 1024 * 1024); });

describe('document and schema', () => {
  it('stores refine settings and nothing derived (version 19)', () => {
    const c = selection({ refine: { version: REFINE_VERSION, radius: 0.37777 } });
    expect(c.refine).toEqual({ version: REFINE_VERSION, radius: 0.378 });
    const local = { id: 'L', name: '', enabled: true, amount: 1, settings: {}, mask: normalizeMask({ base: 'none', components: [{ ...c, refinedKey: 'x' }] }, 'image') };
    expect(local.mask.components[0].refinedKey).toBeUndefined();
    const photo = { id: 'p', name: 'p.jpg', size: 100, sha256: 'a'.repeat(64), format: 'jpeg', width: W, height: H, adjustments: { ...neutralAdjustments(), local: [local] } };
    const text = serializeEditDocument(createEditDocument([photo]));
    expect(JSON.parse(text).version).toBe(DOCUMENT_VERSION);
    expect(DOCUMENT_VERSION).toBe(20);
    const back = parseEditDocument(text).photos[0].adjustments.local[0].mask.components[0];
    expect(back.refine).toEqual({ version: REFINE_VERSION, radius: 0.378 });
  });
  it('reads selections without refine (version 18) unchanged: they stay unrefined', () => {
    const { refine, ...legacy } = selection();
    const mask = normalizeMask({ base: 'none', components: [legacy] }, 'image');
    expect(mask.components[0].refine).toBeUndefined();
    expect(refinementsOf({ local: [{ mask }], layers: [] }, photoKey)).toEqual([]);
  });
  it('turning refinement off removes it', () => {
    const mask = normalizeMask({ base: 'none', components: [selection({ refine: null })] }, 'image');
    expect(mask.components[0].refine).toBeUndefined();
  });
});

describe('keys and annotation', () => {
  it('keys depend on the owner, the grid and every setting the map depends on', () => {
    const c = selection();
    const k = refinementKey(photoKey, c);
    expect(k).toContain(textHash(c.data));
    expect(refinementKey('photo|other', c)).not.toBe(k);
    expect(refinementKey(photoKey, { ...c, shift: 0.2 })).not.toBe(k);
    expect(refinementKey(photoKey, { ...c, feather: 0.2 })).not.toBe(k);
    expect(refinementKey(photoKey, { ...c, refine: { ...c.refine, radius: 0.5 } })).not.toBe(k);
    expect(refinementKey(photoKey, { ...c, refine: undefined })).toBeNull();
    expect(textHash('a')).not.toBe(textHash('b'));
  });
  it('owners: the photo file (not a merged HDR) and an image layer source', () => {
    expect(photoOwnerKey({ sha256: 'h', file: {} })).toBe('photo|h');
    expect(photoOwnerKey({ sha256: 'h', file: {}, hdr: {} })).toBeNull();
    expect(layerOwnerKey({ type: 'image', source: { sha256: 's' } })).toBe('layer|s');
  });
  it('annotates only registered maps and keeps object identity while nothing changes', () => {
    const mask = normalizeMask({ base: 'none', components: [selection()] }, 'image');
    const values = { ...neutralAdjustments(), local: [{ id: 'L', mask }], layers: [] };
    expect(refinedValues(values, photoKey)).toBe(values);
    expect(refinedMask(mask, photoKey)).toBe(mask);
    const [request] = refinementsOf(values, photoKey);
    registerRefined(request.key, refineSelection({ width: GW, height: GH, codes: grid() }, guide()));
    const shown = refinedValues(values, photoKey);
    expect(shown).not.toBe(values);
    expect(shown.local[0].mask.components[0].refinedKey).toBe(request.key);
    // the Viewer's mask tool and the edit's local share one annotated object (paint cache)
    expect(refinedMask(mask, photoKey)).toBe(shown.local[0].mask);
    expect(refinedValues(values, photoKey)).toBe(shown);
    expect(refinedMapsOf(shown).map((m) => m.key)).toEqual([request.key]);
  });
  it('selections of an image layer belong to its source; canvas-mask selections to the photo', () => {
    const layerMask = normalizeMask({ base: 'none', components: [selection()] }, 'layer');
    const canvasMask = normalizeMask({ base: 'none', components: [selection({ id: 's2' })] }, 'canvas');
    const values = { local: [], layers: [{ id: 'A', type: 'image', source: { sha256: 'src' }, mask: layerMask }, { id: 'B', type: 'adjustment', mask: canvasMask }] };
    const owners = refinementsOf(values, photoKey).map((r) => r.ownerKey).sort();
    expect(owners).toEqual(['layer|src', photoKey]);
  });
  it('Select Object drafts are not refined', () => {
    const mask = normalizeMask({ base: 'none', components: [selection({ id: 'object-draft' })] }, 'image');
    expect(refinementsOf({ local: [{ mask }], layers: [] }, photoKey)).toEqual([]);
  });
});

describe('sampling refined maps', () => {
  it('a registered map replaces the grid, in any transform of an image layer', () => {
    const c = normalizeMask({ base: 'none', components: [selection()] }, 'layer').components[0];
    const coarse = prepareSelection(c);
    registerRefined('k', refineSelection({ width: GW, height: GH, codes: grid() }, guide()));
    const refined = prepareSelection({ ...c, refinedKey: 'k' });
    expect(refined.refined).toBeTruthy();
    const map = { width: W, height: H };
    // the coarse edge (cell 15 = 120 px) moved to the image edge (125 px)
    expect(selectionAt(coarse, map, 122.5, 30)).toBeLessThan(0.5);
    expect(selectionAt(refined, map, 122.5, 30)).toBeGreaterThan(0.9);
    // unregistered keys fall back to the grid
    expect(prepareSelection({ ...c, refinedKey: 'missing' })).toBe(coarse);
    // the mask follows the layer when it is moved and flipped (sampled through its matrix)
    const m = normalizeMask({ base: 'none', components: [{ ...c, refinedKey: 'k' }] }, 'layer');
    m.components[0].refinedKey = 'k';
    const canvas = { width: 400, height: 200 };
    const layer = { x: 0.5, y: 0.5, width: 0.64, height: 0.32, rotation: 0, flipH: false, flipV: false };
    const r1 = rasterizeMask(m, layerMaskMap(layerMatrix(layer, canvas, guide()), guide()), canvas);
    const r2 = rasterizeMask(m, layerMaskMap(layerMatrix({ ...layer, flipH: true }, canvas, guide()), guide()), canvas);
    const at = (r, x, y) => r.data[y * canvas.width + x];
    // layer box spans x 72..328 (256 px over 256 source px); source x 122 → canvas 194; flipped → 206
    expect(at(r1, 72 + 122, 100)).toBeGreaterThan(230);
    expect(at(r2, 328 - 123, 100)).toBeGreaterThan(230);
    expect(at(r1, 72 + 130, 100)).toBeLessThan(20);
  });
  it('preview and export sample the same map: a reduced export matches the preview', () => {
    const c = { ...normalizeMask({ base: 'none', components: [selection()] }, 'image').components[0], refinedKey: 'k' };
    registerRefined('k', refineSelection({ width: GW, height: GH, codes: grid() }, guide()));
    const m = { ...normalizeMask({ base: 'none', components: [c] }, 'image'), components: [c] };
    const full = rasterizeMask(m, maskMap([1, 0, 0, 0, 1, 0, 0, 0, 1], W, H), { width: W, height: H });
    const half = rasterizeMask(m, maskMap([2, 0, 0, 0, 2, 0, 0, 0, 1], W, H), { width: W / 2, height: H / 2 });
    let worst = 0;
    for (let y = 0; y < H / 2; y += 1) for (let x = 0; x < W / 2; x += 1) {
      const avg = (full.data[(2 * y) * W + 2 * x] + full.data[(2 * y) * W + 2 * x + 1] + full.data[(2 * y + 1) * W + 2 * x] + full.data[(2 * y + 1) * W + 2 * x + 1]) / 4;
      worst = Math.max(worst, Math.abs(avg - half.data[y * (W / 2) + x]));
    }
    expect(worst).toBeLessThan(40); // one edge pixel at most, half resolution
  });
  it('drops least recently registered maps past the byte budget', () => {
    const map = refineSelection({ width: GW, height: GH, codes: grid() }, guide());
    setRefinedBudget(1);
    registerRefined('a', map);
    registerRefined('b', { ...map });
    expect(refinedMap('a')).toBeNull();
    expect(refinedMap('b')).toBeTruthy();
    expect(refinedBytes()).toBeGreaterThan(0);
  });
});

describe('the refiner', () => {
  const values = () => ({ ...neutralAdjustments(), local: [{ id: 'L', mask: normalizeMask({ base: 'none', components: [selection()] }, 'image') }], layers: [] });
  const client = (log, fail = false) => () => ({
    async call(name, payload) {
      log.push(name);
      if (fail) throw new Error('out of memory');
      const g = { ...payload, source: guide(), raw: null };
      return (await handlers.refineSelections(g)).result;
    },
    terminate() { log.push('terminate'); },
  });
  const source = () => ({ file: {}, header: {}, raw: null, width: W, height: H });

  it('refines every selection of an owner in one short-lived worker and registers the maps', async () => {
    const log = [];
    let changes = 0;
    const refiner = createRefiner({ createClient: client(log), developRaw: null, onChange: () => { changes += 1; } });
    const requests = refinementsOf(values(), photoKey);
    await refiner.ensure(requests, source);
    expect(refinedMap(requests[0].key)).toBeTruthy();
    expect(log).toEqual(['refineSelections', 'terminate']);
    expect(changes).toBe(1);
    await refiner.ensure(requests, source); // cached: no second job
    expect(log.length).toBe(2);
  });
  it('reports failures (an export must not fall back silently)', async () => {
    const refiner = createRefiner({ createClient: client([], true), developRaw: null });
    const requests = refinementsOf(values(), photoKey);
    await expect(refiner.ensure(requests, source)).rejects.toThrow('out of memory');
    expect(refiner.failure(requests[0].key)).toBe('out of memory');
    await expect(refiner.ensure(requests, () => null)).rejects.toThrow('not loaded');
  });
  it('RAW owners are developed first, then refined from the development', async () => {
    const log = [];
    const refiner = createRefiner({ createClient: client(log), developRaw: async (s, size) => { log.push(`develop ${size.width}x${size.height}`); return { width: size.width, height: size.height, data: new Uint16Array(size.width * size.height * 3) }; } });
    await refiner.ensure(refinementsOf(values(), photoKey), () => ({ ...source(), raw: { width: W, height: H } }));
    expect(log[0]).toBe(`develop ${W}x${H}`);
  });
  it('cancels jobs no longer wanted', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const log = [];
    const refiner = createRefiner({ createClient: () => ({ async call() { await gate; return []; }, terminate() { log.push('terminate'); } }), developRaw: null });
    const requests = refinementsOf(values(), photoKey);
    const job = refiner.ensure(requests, source);
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    refiner.cancelExcept(new Set());
    release();
    await job;
    expect(log).toContain('terminate');
    expect(refinedMap(requests[0].key)).toBeNull();
  });
});

describe('worker tasks', () => {
  it('refineSelections returns transferable tile maps; registerRefined makes them sampleable', async () => {
    const { result, transfer } = await handlers.refineSelections({ source: guide(), size: { width: W, height: H }, items: [{ key: 'k1', width: GW, height: GH, data: encodeCodes(grid()), options: { radius: 0 } }] });
    expect(result[0].key).toBe('k1');
    expect(transfer.length).toBe(3);
    await handlers.registerRefined({ key: 'k1', map: result[0].map });
    expect(refinedMap('k1')).toBe(result[0].map);
  });
  it('rejects a guide of the wrong size', async () => {
    await expect(handlers.refineSelections({ source: guide(), size: { width: 10, height: 10 }, items: [] })).rejects.toThrow('instead of');
  });
});

describe('exports', () => {
  it('registers refined maps on every render worker, and banded results equal the page result', async () => {
    const { composeLayers } = await import('../io/composeLayers.mjs');
    const { runTask } = await import('../io/imageTasks.mjs');
    const registered = [];
    // A worker running image tasks in this module realm, as imageWorker.mjs does in its own.
    const spawn = () => {
      const listeners = [];
      return {
        addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn); },
        removeEventListener() {},
        terminate() {},
        postMessage({ id, type, payload }) {
          if (type === 'registerRefined') registered.push(payload.key);
          Promise.resolve(runTask(type, payload, () => {})).then(({ result }) => listeners.forEach((fn) => fn({ data: { id, ok: true, result } })));
        },
      };
    };
    const c = { ...normalizeMask({ base: 'none', components: [selection()] }, 'canvas').components[0], refinedKey: 'k' };
    registerRefined('k', refineSelection({ width: GW, height: GH, codes: grid() }, guide()));
    const mask = { ...normalizeMask({ base: 'none', components: [c] }, 'canvas') };
    mask.components = [c];
    const layer = { id: 'A', type: 'adjustment', visible: true, opacity: 1, blend: 'normal', settings: { exposure: -2 }, mask };
    const size = { width: W, height: H };
    const run = async (workers) => {
      const image = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(200) };
      const context = { getImageData: () => ({ ...image, data: new Uint8ClampedArray(image.data) }), putImageData: (d) => image.data.set(d.data) };
      const { normalizeLayer } = await import('../model/layers.mjs');
      await composeLayers(context, [normalizeLayer ? normalizeLayer(layer) ?? layer : layer].map((l) => ({ ...l, mask })), { size, workers, spawn, loadRaster: null, rasterizeText: null, lutFor: () => null, imageMap: () => maskMap([1, 0, 0, 0, 1, 0, 0, 0, 1], W, H), refined: refinedMapsOf({ local: [], layers: [{ mask }] }) });
      return image.data;
    };
    const page = await run(0);
    const banded = await run(2);
    expect(registered).toEqual(['k', 'k']);
    expect(Buffer.from(banded).equals(Buffer.from(page))).toBe(true);
    // darkened left of the image edge (125 px), untouched right of it
    expect(page[(30 * W + 100) * 4]).toBeLessThan(150);
    expect(page[(30 * W + 140) * 4]).toBe(200);
    // between the grid's edge (120 px) and the image edge: refined, so adjusted
    expect(page[(30 * W + 122) * 4]).toBeLessThan(150);
  });
});
