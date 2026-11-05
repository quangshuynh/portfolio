// Detail on adjustment layers (Interval 24.1): a neighbourhood filter of the composite at the
// layer's place, then its colour settings, mixed back once through its blend mode, opacity and
// mask. Checked against references built from the Detail and colour renderers on their own, and
// for band, worker, preview and export parity, groups, clipping and transparency.
import { describe, expect, test } from 'vitest';
import { createAdjustmentLayer, normalizeLayers } from '../model/layers.mjs';
import { layerProgram } from '../model/layerTree.mjs';
import { createLinear, createRadial, normalizeMask } from '../model/masks.mjs';
import { adjustmentLayerPass, adjustmentParams, compositeImage, compositeImageSync, contentBox, detailBandRows, detailPassOptions, groupPass, prepareDetailPass, rasterPass } from './composite.mjs';
import { prepareRender, renderRgba8 } from './cpuRenderer.mjs';
import { createLocalPreview, renderDetailFrame } from './localPreview.mjs';
import { offsetMatrix } from './layerTransform.mjs';
import { canvasMaskMap, rasterizeMask } from './mask.mjs';
import { adjustPixel, BLEND_CODES } from './blend.mjs';

const W = 64;
const H = 48;
const size = { width: W, height: H };
const native = { width: W * 4, height: H * 4 };

// A textured photo: gradients, fine stripes and a few hard edges, so every Detail control acts.
function photo() {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const stripe = (x + y) % 4 < 2 ? 18 : -18;
      const edge = x > 30 && y > 12 && y < 36 ? 60 : 0;
      data.set([90 + x + stripe + edge, 70 + y * 2 - stripe, 120 + ((x * y) % 23) + edge / 2, 255], (y * W + x) * 4);
    }
  }
  return { width: W, height: H, data };
}
const copy = (image) => ({ width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) });
const layer = (settings, patch = {}) => ({ ...createAdjustmentLayer('D', settings), ...patch });
const detailOnly = (settings) => ({ kind: 'detail', id: 'ref', adjustments: adjustmentLayerPass(layer(settings), null, null, native).adjustments, color: null, native, opacity: 1, mode: 0, mask: null });

/** Reference: the Detail renderer's whole-image result, then the colour renderer, then one mix per pixel. */
function reference(image, settings, colour, { opacity = 1, mode = 'normal', coverage = () => 1 } = {}) {
  const filtered = renderDetailFrame(copy(image), detailOnly(settings));
  const adjusted = colour ? renderRgba8(filtered, prepareRender(adjustmentParams({ adjustments: adjustmentLayerPass(layer({ ...settings, ...colour }), null, null, native).color.adjustments, lut: null }))) : filtered;
  const out = copy(image);
  for (let p = 0; p < W * H; p += 1) adjustPixel(BLEND_CODES[mode], out.data, p * 4, adjusted, p * 4, opacity * coverage(p % W, Math.floor(p / W)));
  return out.data;
}

function worst(a, b) {
  let max = 0;
  for (let i = 0; i < a.length; i += 1) max = Math.max(max, Math.abs(a[i] - b[i]));
  return max;
}

describe('adjustment layer Detail passes', () => {
  test('a layer without Detail stays a per-pixel adjustment pass; with Detail it filters', () => {
    expect(adjustmentLayerPass(layer({ exposure: 1 }), null, null, native).kind).toBe('adjust');
    const pass = adjustmentLayerPass(layer({ clarity: 60, exposure: 0.5 }), null, null, native);
    expect(pass).toMatchObject({ kind: 'detail', mode: 0, opacity: 1, native });
    expect(pass.adjustments.clarity).toBe(60);
    expect(pass.color.adjustments.exposure).toBe(0.5);
    expect(pass.color.adjustments.clarity).toBe(0);
    expect(adjustmentLayerPass(layer({ sharpening: 40 }), null, null, native).color).toBeNull();
    // Each Detail control alone changes the composite (not a renamed global effect).
    for (const key of ['texture', 'clarity', 'dehaze', 'sharpening', 'luminanceNoise', 'colorNoise']) {
      const out = compositeImageSync(photo(), [adjustmentLayerPass(layer({ [key]: key === 'texture' || key === 'clarity' || key === 'dehaze' ? 80 : 100 }), null, null, native)]);
      expect(worst(out.data, photo().data), key).toBeGreaterThan(0);
    }
  });

  test('Detail then colour, mixed once at partial opacity and through a blend mode', () => {
    const settings = { clarity: 70, sharpening: 60 };
    const colour = { exposure: 0.6, saturation: -40 };
    for (const [opacity, mode] of [[1, 'normal'], [0.45, 'normal'], [0.7, 'luminosity'], [1, 'soft-light']]) {
      const pass = adjustmentLayerPass(layer({ ...settings, ...colour }, { opacity, blend: mode }), null, null, native);
      const out = compositeImageSync(photo(), [pass]);
      // Mixing Detail and colour separately at partial opacity would differ from this one-step reference.
      expect(worst(out.data, reference(photo(), settings, colour, { opacity, mode })), `${opacity} ${mode}`).toBe(0);
    }
  });

  test('through a mask: unchanged outside, mixed by coverage inside, the same in any band size', async () => {
    const mask = normalizeMask({ base: 'none', components: [createRadial('r', { x: 0.5, y: 0.5, rx: 0.3, ry: 0.25, feather: 0.6 })] }, 'canvas');
    const map = canvasMaskMap(size);
    const raster = rasterizeMask(mask, map, size);
    const settings = { texture: 90, luminanceNoise: 60 };
    const pass = adjustmentLayerPass(layer(settings), null, { def: mask, map }, native);
    const whole = compositeImageSync(photo(), [pass]);
    expect(worst(whole.data, reference(photo(), settings, null, { coverage: (x, y) => raster.data[y * W + x] / 255 }))).toBe(0);
    for (let p = 0; p < W * H; p += 1) if (!raster.data[p]) expect(whole.data.slice(p * 4, p * 4 + 4)).toEqual(photo().data.slice(p * 4, p * 4 + 4));
    // No seams at band edges: band sizes that cut through the filter's halo give the same pixels.
    for (const bandRows of [5, 16]) {
      const banded = await compositeImage(photo(), [adjustmentLayerPass(layer(settings), null, { def: mask, map }, native)], { bandRows });
      expect(worst(banded.data, whole.data), `bands of ${bandRows}`).toBe(0);
    }
    // The preview's precomputed coverage gives the same result as the export's evaluated one.
    const previewed = compositeImageSync(photo(), [adjustmentLayerPass(layer(settings), null, { def: mask, map, raster }, native)]);
    expect(worst(previewed.data, whole.data)).toBe(0);
  });

  test('band workers render the same pixels as the page (colour settings included)', async () => {
    const { handlers } = await import('../io/imageTasks.mjs');
    const mask = normalizeMask({ base: 'none', components: [createLinear('g', { x0: 0.2, y0: 0, x1: 0.8, y1: 0 })] }, 'canvas');
    const pass = adjustmentLayerPass(layer({ dehaze: 50, sharpening: 70, contrast: 30 }, { opacity: 0.8, blend: 'overlay' }), null, { def: mask, map: canvasMaskMap(size) }, native);
    const whole = compositeImageSync(photo(), [pass]);
    const image = photo();
    const options = detailPassOptions(image, pass);
    const { halo } = prepareDetailPass(pass, options);
    await handlers.localDetailBegin({ job: 'j', pass: structuredClone(pass), options: structuredClone(options) });
    const out = new Uint8ClampedArray(image.data);
    for (let row = 0; row < H; row += 16) {
      const last = Math.min(H, row + 16);
      const top = Math.max(0, row - halo);
      const bottom = Math.min(H, last + halo);
      const { result } = await handlers.localDetailRows({ job: 'j', source: { width: W, height: bottom - top, y0: top, data: image.data.slice(top * W * 4, bottom * W * 4) }, row, last });
      if (result) out.set(result, row * W * 4);
    }
    expect(worst(out, whole.data)).toBe(0);
    // The preview worker's whole-frame filter includes the colour settings too.
    const { result: frame } = await handlers.localDetailFrame({ image: photo(), pass: structuredClone(pass) });
    expect(worst(frame, renderDetailFrame(photo(), pass))).toBe(0);
  });

  test('clipped to a transparent base: alpha kept, no dark fringe from empty pixels', () => {
    // A flat orange square on transparency: with alpha-weighted neighbourhoods, filtering it
    // leaves its colour flat up to its edge; unweighted, the edge would darken toward black.
    const base = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
    for (let y = 10; y < 38; y += 1) for (let x = 12; x < 50; x += 1) base.data.set([210, 120, 40, x === 12 || y === 10 ? 128 : 255], (y * W + x) * 4);
    const layers = normalizeLayers([
      { id: 'img', type: 'image', source: { sha256: 'a'.repeat(64), name: 'x.png', size: 1, format: 'png', width: W, height: H }, x: 0.5, y: 0.5, width: W / H, height: 1 },
      { ...createAdjustmentLayer('D', { clarity: 100, texture: 100, sharpening: 100, dehaze: 60 }), clip: true },
    ]);
    const passes = layerProgram(layers).map((step) => {
      if (step.op !== 'layer') return groupPass(step);
      if (step.layer.type === 'adjustment') return adjustmentLayerPass(step.layer, null, null, native);
      return rasterPass(step.layer, base, offsetMatrix(0, 0), size);
    });
    expect(passes.map(({ kind }) => kind)).toEqual(['begin', 'raster', 'detail', 'end']);
    const below = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(255) };
    const out = compositeImageSync(below, passes);
    // Dehaze shifts the flat colour as a whole; the edge must match the middle.
    const c = (24 * W + 31) * 4;
    const middle = out.data.slice(c, c + 3);
    for (let y = 11; y < 38; y += 1) {
      for (let x = 13; x < 50; x += 1) {
        const i = (y * W + x) * 4;
        expect(Math.abs(out.data[i] - middle[0]) + Math.abs(out.data[i + 1] - middle[1]) + Math.abs(out.data[i + 2] - middle[2]), `${x},${y}`).toBeLessThanOrEqual(1);
      }
    }
    // Outside the base nothing is drawn (the white below stays white).
    expect(Array.from(out.data.slice(0, 4))).toEqual([255, 255, 255, 255]);
  });

  test('on a transparent canvas only the visible content is filtered; the result does not change', () => {
    const canvas = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
    for (let y = 20; y < 30; y += 1) for (let x = 5; x < 15; x += 1) canvas.data.set([...photo().data.slice((y * W + x) * 4, (y * W + x) * 4 + 3), 255], (y * W + x) * 4);
    expect(contentBox(canvas)).toEqual({ x0: 5, y0: 20, x1: 15, y1: 30 });
    expect(contentBox({ width: 2, height: 2, data: new Uint8ClampedArray(16) })).toEqual({ x0: 0, y0: 0, x1: 0, y1: 0 });
    const pass = adjustmentLayerPass(layer({ clarity: 80, sharpening: 80 }), null, null, native);
    const options = detailPassOptions(canvas, pass);
    expect(options.content).toEqual({ x0: 5, y0: 20, x1: 15, y1: 30 });
    const context = prepareDetailPass(pass, options);
    expect(detailBandRows(canvas, context, pass, 0, 16)).toBeNull();
    // Unlimited reference: the whole frame filtered (the preview's path), mixed in full.
    const whole = renderDetailFrame(copy(canvas), pass);
    const limited = compositeImageSync(copy(canvas), [pass]);
    for (let p = 0; p < W * H; p += 1) {
      if (!canvas.data[p * 4 + 3]) { expect(limited.data[p * 4 + 3]).toBe(0); continue; } // eslint-disable-line no-continue
      expect(Array.from(limited.data.slice(p * 4, p * 4 + 4))).toEqual(Array.from(whole.slice(p * 4, p * 4 + 4)));
    }
  });

  test('inside an isolated group it filters only the group, over a pass-through group the whole composite', () => {
    const settings = { clarity: 80, sharpening: 80 };
    const groupPasses = (blend) => layerProgram(normalizeLayers([
      { id: 'g', type: 'group', blend },
      { ...createAdjustmentLayer('D', settings), parent: 'g' },
    ])).map((step) => (step.op === 'layer' ? adjustmentLayerPass(step.layer, null, null, native) : groupPass(step)));
    // Pass-through: as without the group.
    expect(worst(compositeImageSync(photo(), groupPasses('pass-through')).data, compositeImageSync(photo(), [adjustmentLayerPass(layer(settings), null, null, native)]).data)).toBe(0);
    // Isolated (Normal): the group's own canvas is empty, so the layer changes nothing.
    expect(worst(compositeImageSync(photo(), groupPasses('normal')).data, photo().data)).toBe(0);
  });

  test('the preview composes Detail layers inside groups like the export, keeping every filtered frame it needs', async () => {
    const layers = normalizeLayers([
      { id: 'g', type: 'group', blend: 'normal', opacity: 0.8 },
      { id: 'img', type: 'image', parent: 'g', source: { sha256: 'a'.repeat(64), name: 'x.png', size: 1, format: 'png', width: W, height: H }, x: 0.5, y: 0.5, width: W / H, height: 1 },
      { ...createAdjustmentLayer('D1', { clarity: 70 }), parent: 'g', clip: true },
      { ...createAdjustmentLayer('D2', { sharpening: 90, exposure: 0.3 }), parent: 'g' },
      createAdjustmentLayer('D3', { texture: -60 }),
      createAdjustmentLayer('D4', { luminanceNoise: 70 }),
    ]);
    const passes = layerProgram(layers).map((step) => {
      if (step.op !== 'layer') return groupPass(step);
      if (step.layer.type === 'adjustment') return adjustmentLayerPass(step.layer, null, null, native);
      return rasterPass(step.layer, photo(), offsetMatrix(0, 0), size);
    });
    expect(passes.filter(({ kind }) => kind === 'detail')).toHaveLength(4);
    const expected = compositeImageSync(photo(), passes).data;
    let requests = 0;
    let ready = null;
    const preview = createLocalPreview({ renderDetail: async (image, pass) => { requests += 1; return renderDetailFrame(image, pass); }, onReady: () => ready?.() });
    const base = photo();
    let result = preview.compose(base, passes);
    for (let round = 0; round < 12 && !result.complete; round += 1) {
      await new Promise((resolve) => { ready = resolve; });
      result = preview.compose(base, passes);
    }
    expect(result.complete).toBe(true);
    expect(worst(result.image.data, expected)).toBe(0);
    // Four Detail passes, four filtered frames, none filtered twice (no eviction loop).
    expect(requests).toBe(4);
    expect(preview.compose(base, passes).complete).toBe(true);
    expect(requests).toBe(4);
  });
});
