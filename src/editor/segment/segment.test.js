import { describe, expect, test } from 'vitest';
import {
  analysisSize, components, decodeCodes, encodeCodes, fromBase64, quantize, refineEdges, salientRegions, skyFromProbability, subjectFromParts, toBase64,
} from './analysis.mjs';
import { createSegmenter } from './segmenter.mjs';
import { prepareSelection, selectionAt } from './selectionMask.mjs';
import { MODELS, downloadBytes } from './models.mjs';
import {
  MASK_LIMITS, createLocalAdjustment, createMask, createSelection, gradientLocals, maskHasComponents, normalizeMask, selectionChars, visibleLocals,
} from '../model/masks.mjs';
import { normalizeLayer } from '../model/layers.mjs';
import { canvasMaskMap, imageMaskMap, maskBounds, maskRows, rasterizeMask } from '../pipeline/mask.mjs';
import { geometryPlan, normalizeGeometry } from '../pipeline/geometry.mjs';
import { createEditDocument, parseEditDocument, serializeEditDocument } from '../model/editDocument.mjs';
import { normalizeAdjustments } from '../model/adjustments.mjs';

/** An RGBA image: dark left of column `edge`, bright right of it. */
function split(width, height, edge) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) data.set(x < edge ? [30, 30, 30, 255] : [220, 220, 220, 255], (y * width + x) * 4);
  return { width, height, data };
}
/** A coverage grid: 1 left of `edge`. */
const half = (width, height, edge) => Float32Array.from({ length: width * height }, (_, i) => (i % width < edge ? 1 : 0));
/** A selection result for a grid. */
const result = (grid, width, height, kind = 'sky') => ({ kind, version: 'test/1', width, height, data: encodeCodes(quantize(grid)), confidence: 0.9 });

describe('coverage encoding', () => {
  test('codes survive run-length and base64 coding exactly, and damaged data is refused', () => {
    const codes = Uint8Array.from({ length: 5000 }, (_, i) => (i < 1200 ? 0 : i < 1300 ? (i * 7) % 256 : i < 4000 ? 255 : 3));
    const text = encodeCodes(codes);
    expect(decodeCodes(text, codes.length)).toEqual(codes);
    // A mask-like grid (two flat areas and a soft edge) codes to a small fraction of its cells.
    expect(text.length).toBeLessThan(codes.length / 4);
    expect(decodeCodes(text, codes.length + 1)).toBeNull();
    expect(decodeCodes(text.slice(0, -4), codes.length)).toBeNull();
    expect(decodeCodes('not base64!', 10)).toBeNull();
    expect(fromBase64(toBase64(Uint8Array.from([1, 2, 3, 4])))).toEqual(Uint8Array.from([1, 2, 3, 4]));
    // Runs longer than 127 cells use more than one length byte.
    expect(decodeCodes(encodeCodes(new Uint8Array(70_000).fill(255)), 70_000).every((v) => v === 255)).toBe(true);
  });

  test('the analysis size keeps the aspect ratio with a long edge of at most 1024', () => {
    expect(analysisSize(6000, 4000)).toEqual({ width: 1024, height: 683 });
    expect(analysisSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe('selection post-processing', () => {
  test('edge refinement moves a coarse edge onto the photo\'s edge and leaves the rest in or out', () => {
    const image = split(64, 32, 30);
    // The model's edge is 3 px right of the photo's.
    const refined = refineEdges(half(64, 32, 33), image);
    const row = Array.from(refined.subarray(16 * 64, 17 * 64));
    expect(row.slice(0, 30).every((v) => v === 1)).toBe(true);
    expect(row.slice(30).every((v) => v === 0)).toBe(true);
    // Where both sides look alike (no edge in the photo) the model's edge stays (softened by a pixel).
    const flat = refineEdges(half(64, 32, 33), split(64, 32, 0));
    expect(flat[16 * 64 + 32]).toBeGreaterThan(0.5);
    expect(flat[16 * 64 + 33]).toBeLessThan(0.5);
    expect(flat[16 * 64 + 30]).toBe(1);
  });

  test('connected components report area, box and peak', () => {
    const mask = Uint8Array.from([1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]);
    const { stats } = components(mask, 4, 3, Float32Array.from({ length: 12 }, (_, i) => i / 12));
    expect(stats.slice(1).map(({ area, x0, y0, x1, y1 }) => ({ area, x0, y0, x1, y1 }))).toEqual([{ area: 3, x0: 0, y0: 0, x1: 1, y1: 1 }, { area: 1, x0: 3, y0: 2, x1: 3, y1: 2 }]);
    expect(stats[2].peak).toBeCloseTo(11 / 12, 5);
  });

  test('sky drops small or never-certain regions and says when there is none', () => {
    const image = split(200, 200, 100);
    const size = 40;
    const prob = new Float32Array(size * size);
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      if (y < 15) prob[y * size + x] = 0.99;
      if (y === 31 && x === 31) prob[y * size + x] = 0.99; // a lit window: too small
      if (y >= 20 && y < 28 && x < 8) prob[y * size + x] = 0.7; // never certain
    }
    const sky = skyFromProbability(prob, size, image);
    expect(sky.found).toBe(true);
    expect(sky.regions).toBe(1);
    const at = (x, y) => sky.coverage[y * 200 + x];
    expect(at(100, 25)).toBe(1);
    expect(at(157, 157)).toBe(0);
    expect(at(15, 120)).toBe(0);
    const none = skyFromProbability(new Float32Array(size * size).fill(0.1), size, image);
    expect(none).toMatchObject({ found: false, confidence: 0, note: 'No sky was found in this photo.' });
  });

  test('a subject SAM outlines differently from the salient region is reported as uncertain', () => {
    const image = split(40, 40, 20);
    const region = Uint8Array.from({ length: 1600 }, (_, i) => (i % 40 < 20 ? 1 : 0));
    const agreeing = subjectFromParts([{ coverage: Float32Array.from(region), score: 0.95 }], [region], image);
    expect(agreeing.confidence).toBeGreaterThan(0.9);
    expect(agreeing.note).toBeNull();
    const other = Float32Array.from({ length: 1600 }, (_, i) => (i % 40 >= 32 ? 1 : 0));
    const disagreeing = subjectFromParts([{ coverage: other, score: 0.97 }], [region], image);
    expect(disagreeing.confidence).toBeLessThan(0.6);
    expect(disagreeing.note).toMatch(/uncertain/);
    expect(subjectFromParts([], [], image)).toMatchObject({ found: false });
  });

  test('salient regions keep the main subject and others of comparable size', () => {
    const size = 20;
    const s = new Float32Array(size * size);
    const fill = (x0, y0, x1, y1) => { for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) s[y * size + x] = 1; };
    fill(2, 2, 9, 9); fill(12, 12, 17, 17); fill(18, 0, 19, 1);
    const { regions } = salientRegions(s, size, split(100, 100, 50));
    expect(regions.length).toBe(2);
    expect(regions[0].area).toBeGreaterThan(regions[1].area);
  });
});

describe('segmenter', () => {
  // A stand-in onnxruntime: sessions answer by model, recording runs.
  function fakeOrt(runs) {
    class Tensor { constructor(type, data, dims) { Object.assign(this, { type, data, dims }); } }
    return {
      Tensor,
      InferenceSession: {
        create: async (bytes) => {
          const name = new TextDecoder().decode(bytes);
          return {
            inputNames: ['input'],
            outputNames: ['output'],
            run: async (feeds) => {
              runs.push(name);
              if (name === 'sky') return { output: { data: new Float32Array(320 * 320).map((_, i) => (i < 320 * 120 ? 0.99 : 0.01)) } };
              if (name === 'saliency') return { output: { data: new Float32Array(320 * 320).map((_, i) => ((i % 320) > 100 && (i % 320) < 220 && i > 320 * 100 && i < 320 * 220 ? 1 : 0)) } };
              if (name === 'samEncoder') return { image_embeddings: { data: new Float32Array(4) } };
              const [h, w] = feeds.orig_im_size.data;
              const n = w * h;
              const masks = new Float32Array(4 * n);
              // Mask k covers a square growing with k around the centre.
              for (let k = 0; k < 4; k += 1) for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) masks[k * n + y * w + x] = Math.abs(x - w / 2) < (k + 1) * w / 10 && Math.abs(y - h / 2) < (k + 1) * h / 10 ? 10 : -10;
              return { masks: { data: masks }, iou_predictions: { data: Float32Array.from([0.9, 0.7, 0.95, 0.8]) } };
            },
          };
        },
      },
    };
  }

  test('models load once, the SAM embedding is reused per photo, and results carry their version', async () => {
    const runs = [];
    const loads = [];
    const segmenter = createSegmenter({ ort: fakeOrt(runs), loadModel: async (name) => { loads.push(name); return new TextEncoder().encode(name); } });
    const image = split(64, 48, 32);
    const sky = await segmenter.select({ kind: 'sky', image, imageKey: 'a' });
    expect(sky).toMatchObject({ found: true, width: 64, height: 48, version: 'sky-u2net-int8/1' });
    expect(decodeCodes(sky.data, 64 * 48)[0]).toBe(255);
    const subject = await segmenter.select({ kind: 'subject', image, imageKey: 'a' });
    expect(subject.found).toBe(true);
    const progress = [];
    const object = await segmenter.select({ kind: 'object', image, imageKey: 'a', points: [[32, 24, 1]] }, (p) => progress.push(p.stage));
    // Candidates run from the smallest part to the whole; the best scored is picked.
    expect(object.candidates.map(({ area }) => area)).toEqual([...object.candidates.map(({ area }) => area)].sort((a, b) => a - b));
    expect(object.candidate).toBe(1);
    const larger = await segmenter.select({ kind: 'object', image, imageKey: 'a', points: [[32, 24, 1]], candidate: 2 });
    expect(larger.area).toBeGreaterThan(object.area);
    expect(runs.filter((name) => name === 'samEncoder')).toHaveLength(1);
    expect(progress).not.toContain('download');
    await segmenter.select({ kind: 'object', image, imageKey: 'b', points: [[10, 10, 1]] });
    expect(runs.filter((name) => name === 'samEncoder')).toHaveLength(2);
    expect(loads.sort()).toEqual(['saliency', 'samDecoder', 'samEncoder', 'sky']);
    await expect(segmenter.select({ kind: 'object', image, imageKey: 'b', points: [[10, 10, 0]] })).rejects.toMatchObject({ code: 'bad-request' });
  });

  test('a model that fails to load can be tried again', async () => {
    let fail = true;
    const segmenter = createSegmenter({ ort: fakeOrt([]), loadModel: async (name) => { if (fail) throw new Error('offline'); return new TextEncoder().encode(name); } });
    await expect(segmenter.select({ kind: 'sky', image: split(8, 8, 4), imageKey: 'a' })).rejects.toThrow('offline');
    fail = false;
    await expect(segmenter.select({ kind: 'sky', image: split(8, 8, 4), imageKey: 'a' })).resolves.toMatchObject({ found: true });
  });

  test('download sizes are what a kind still needs', () => {
    expect(downloadBytes('sky')).toBe(MODELS.sky.bytes);
    expect(downloadBytes('object', new Set(['samEncoder']))).toBe(MODELS.samDecoder.bytes);
  });
});

describe('selection masks', () => {
  const W = 40; const H = 30;
  const grid = half(W, H, 20);
  const selection = (patch = {}) => createSelection('s1', result(grid, W, H), patch);

  test('a selection normalises from untrusted input, within its limits, only in image space', () => {
    expect(selection()).toMatchObject({ type: 'selection', kind: 'sky', width: W, height: H, shift: 0, feather: 0, confidence: 0.9 });
    expect(createSelection('s', { ...result(grid, W, H), kind: 'face' })).toBeNull();
    expect(createSelection('s', { ...result(grid, W, H), data: '<svg>' })).toBeNull();
    expect(createSelection('s', { ...result(grid, W, H), width: MASK_LIMITS.selectionEdge + 1 })).toBeNull();
    expect(createSelection('s', result(grid, W, H), { version: 'x'.repeat(41) }).version).toBe('unknown');
    const mask = normalizeMask({ components: [selection()] }, 'image');
    expect(maskHasComponents(mask)).toBe(true);
    expect(selectionChars(mask)).toBe(selection().data.length);
    expect(normalizeMask({ components: [selection()] }, 'canvas').components).toEqual([]);
    expect(normalizeLayer({ id: 'a', type: 'adjustment', settings: { exposure: 1 }, mask: { components: [selection()] } }).mask?.components ?? []).toEqual([]);
    // The photo's budget: selections beyond it are dropped.
    const big = { ...result(grid, W, H), data: encodeCodes(Uint8Array.from({ length: 300_000 }, (_, i) => i % 251)) };
    const adjustments = normalizeAdjustments({ local: [0, 1, 2, 3].map((i) => ({ id: `l${i}`, settings: { exposure: 1 }, mask: { components: [{ id: 'c', type: 'selection', ...big, width: 600, height: 500 }] } })) });
    expect(adjustments.local.filter((l) => l.mask.components.length).length).toBeLessThanOrEqual(Math.floor(MASK_LIMITS.photoSelectionChars / big.data.length));
  });

  test('evaluation samples the grid in the photo\'s space; shift and feather move and soften the edge', () => {
    const prep = prepareSelection(selection());
    const map = { width: 400, height: 300 };
    expect(selectionAt(prep, map, 100, 150)).toBe(1);
    expect(selectionAt(prep, map, 300, 150)).toBe(0);
    expect(selectionAt(prep, map, 200, 150)).toBeCloseTo(0.5, 1);
    // A larger grid, so 1 % of its edge is a few cells.
    const big = (patch) => prepareSelection(createSelection('b', result(half(400, 300, 200), 400, 300), patch));
    const total = (p) => p.grid.reduce((a, v) => a + v, 0);
    const base = total(big({}));
    expect(total(big({ shift: 1 }))).toBeGreaterThan(base + 300 * 2);
    expect(total(big({ shift: -1 }))).toBeLessThan(base - 300 * 2);
    const soft = big({ feather: 1 });
    expect(selectionAt(soft, map, 196, 150)).toBeLessThan(1);
    expect(selectionAt(soft, map, 196, 150)).toBeGreaterThan(0.5);
    expect(selectionAt(soft, map, 10, 150)).toBe(1);
    expect(prepareSelection({ ...selection(), data: encodeCodes(new Uint8Array(5)) })).toBeNull();
  });

  test('a selection stays on the photo\'s content through crop and rotation, in previews and exports alike', () => {
    const native = { width: 400, height: 300 };
    const mask = normalizeMask({ components: [selection()] }, 'image');
    const geometry = normalizeGeometry({ crop: { x: 0.25, y: 0, width: 0.5, height: 1 }, rotation: 90 });
    const plan = geometryPlan(geometry, native);
    const out = { width: 120, height: 200 };
    const map = imageMaskMap(plan, out, native);
    const raster = rasterizeMask(mask, map, out);
    // Every canvas pixel equals the selection at the source point it shows.
    for (const [x, y] of [[10, 10], [60, 100], [110, 190], [60, 5], [60, 195]]) {
      const [sx, sy] = plan.toSource(out, native) ? (() => { const m = map.matrix; const cx = x + 0.5; const cy = y + 0.5; const w = m[6] * cx + m[7] * cy + m[8]; return [(m[0] * cx + m[1] * cy + m[2]) / w, (m[3] * cx + m[4] * cy + m[5]) / w]; })() : [0, 0];
      const expected = Math.min(255, Math.max(0, Math.floor(selectionAt(prepareSelection(selection()), native, sx, sy) * 255 + 0.5)));
      expect(raster.data[y * out.width + x]).toBe(expected);
    }
    // An export band gives the same rows as the whole canvas.
    expect(maskRows(mask, map, out.width, 50, 60)).toEqual(raster.data.subarray(50 * out.width, 60 * out.width));
    // The cached path (painting) agrees too.
    expect(rasterizeMask(mask, map, out, new Map()).data).toEqual(raster.data);
    expect(maskBounds(mask, map, out)).not.toEqual({ x0: 0, y0: 0, x1: 0, y1: 0 });
  });

  test('inverted, subtracted and brushed together like any other component', () => {
    const map = canvasMaskMap({ width: W, height: H });
    const inverted = normalizeMask({ components: [selection({ invert: true })] }, 'image');
    const plain = normalizeMask({ components: [selection()] }, 'image');
    const a = maskRows(plain, map, W, 0, H); const b = maskRows(inverted, map, W, 0, H);
    for (let i = 0; i < a.length; i += 1) expect(a[i] + b[i]).toBeGreaterThanOrEqual(254);
    const cut = normalizeMask({ base: 'all', components: [selection({ op: 'subtract' })] }, 'image');
    expect(maskRows(cut, map, W, 0, H)[5]).toBe(0);
    expect(maskRows(cut, map, W, 0, H)[35]).toBe(255);
  });

  test('selections are never copied to other photos, and survive saving and reopening', () => {
    const local = { ...createLocalAdjustment('l1', { settings: { exposure: 1 } }), mask: normalizeMask({ components: [selection(), { id: 'g', type: 'linear' }] }, 'image') };
    expect(gradientLocals([local])[0].mask.components.map(({ type }) => type)).toEqual(['linear']);
    expect(gradientLocals([{ ...local, mask: normalizeMask({ components: [selection()] }, 'image') }])).toEqual([]);
    expect(visibleLocals([local])).toHaveLength(1);
    const photo = { id: 'p', name: 'a.jpg', size: 10, sha256: 'a'.repeat(64), format: 'jpeg', width: 400, height: 300, adjustments: { ...normalizeAdjustments({}), local: [local] } };
    const reopened = parseEditDocument(serializeEditDocument(createEditDocument([photo])));
    expect(reopened.photos[0].adjustments.local[0].mask.components[0]).toEqual(selection());
    expect(createMask('image').components).toEqual([]);
  });
});
