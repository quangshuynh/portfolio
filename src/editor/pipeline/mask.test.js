import { describe, expect, test } from 'vitest';
import { canvasMaskMap, imageMaskMap, layerMaskMap, maskMap, maskRows, rasterizeMask } from './mask.mjs';
import { adjustmentPass, compositeImage, compositeImageSync, localPasses, rasterPass } from './composite.mjs';
import { geometryPlan, normalizeGeometry, project } from './geometry.mjs';
import { layerMatrix, offsetMatrix } from './layerTransform.mjs';
import { createBrush, createLinear, createMask, createRadial, normalizeMask, splitLocalSettings } from '../model/masks.mjs';
import { createAdjustmentLayer } from '../model/layers.mjs';

const canvas = { width: 64, height: 48 };
const mask = (components, patch = {}, space = 'canvas') => normalizeMask({ base: 'none', ...patch, components }, space);
const at = (raster, x, y) => raster.data[y * raster.width + x];
const solid = (width, height, rgba) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width, height, data };
};
const noise = (width, height, seed = 7) => {
  let s = seed;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 1) {
    s = (s * 1103515245 + 12345) % 2147483648;
    data[i] = i % 4 === 3 ? 255 : (s >> 16) & 255;
  }
  return { width, height, data };
};

describe('gradient coverage', () => {
  test('linear: full before the start, none past the end, a straight ramp at feather 0', () => {
    const m = mask([createLinear('g', { x0: 0.5, y0: 0.25, x1: 0.5, y1: 0.75, feather: 0 })]);
    const r = rasterizeMask(m, canvasMaskMap(canvas), canvas);
    expect(at(r, 10, 2)).toBe(255);
    expect(at(r, 10, 45)).toBe(0);
    // Row 23 (centre 23.5) is 23.5 − 12 = 11.5 of 24 px into the ramp.
    expect(at(r, 30, 23)).toBe(Math.round(255 * (1 - 11.5 / 24)));
    const column = Array.from({ length: canvas.height }, (_, y) => at(r, 5, y));
    column.slice(1).forEach((value, y) => expect(value).toBeLessThanOrEqual(column[y]));
    // Every column is the same for a vertical gradient.
    expect(at(r, 0, 20)).toBe(at(r, 63, 20));
  });

  test('linear feather 1 is a smooth curve with the same ends and midpoint', () => {
    const r = rasterizeMask(mask([createLinear('g', { x0: 0, y0: 0, x1: 0, y1: 1, feather: 1 })]), canvasMaskMap({ width: 4, height: 101 }), { width: 4, height: 101 });
    expect(at(r, 0, 50)).toBe(128);
    expect(at(r, 0, 5)).toBeGreaterThan(Math.round(255 * (1 - 5.5 / 101)));
  });

  test('a gradient may start and end outside the image', () => {
    const r = rasterizeMask(mask([createLinear('g', { x0: 0.5, y0: -1, x1: 0.5, y1: 2, feather: 0 })]), canvasMaskMap(canvas), canvas);
    expect(at(r, 0, 0)).toBeLessThan(255);
    expect(at(r, 0, 47)).toBeGreaterThan(0);
  });

  test('radial: full inside, none outside, feathered towards the edge, ellipses rotate', () => {
    const square = { width: 101, height: 101 };
    const m = mask([createRadial('r', { x: 0.5, y: 0.5, rx: 0.4, ry: 0.2, feather: 0.5 })]);
    const r = rasterizeMask(m, canvasMaskMap(square), square);
    expect(at(r, 50, 50)).toBe(255);
    expect(at(r, 50 + 15, 50)).toBe(255);
    expect(at(r, 50, 50 + 25)).toBe(0);
    expect(at(r, 50 + 30, 50)).toBeGreaterThan(0);
    expect(at(r, 50 + 30, 50)).toBeLessThan(255);
    const turned = rasterizeMask(mask([createRadial('r', { x: 0.5, y: 0.5, rx: 0.4, ry: 0.2, feather: 0.5, rotation: 90 })]), canvasMaskMap(square), square);
    expect(at(turned, 50, 80)).toBe(at(r, 80, 50));
    expect(at(turned, 80, 50)).toBe(at(r, 50, 80));
  });

  test('radii are in short edges, so a circle stays round on a wide canvas', () => {
    const wide = { width: 200, height: 100 };
    const r = rasterizeMask(mask([createRadial('r', { rx: 0.3, ry: 0.3, feather: 0 })]), canvasMaskMap(wide), wide);
    expect(at(r, 100 + 28, 50)).toBe(255);
    expect(at(r, 100, 50 + 28)).toBe(255);
    expect(at(r, 100 + 32, 50)).toBe(0);
    expect(at(r, 100, 50 + 32)).toBe(0);
  });

  test('a hard edge is antialiased over about one canvas pixel', () => {
    const r = rasterizeMask(mask([createRadial('r', { rx: 0.25, ry: 0.25, feather: 0 })]), canvasMaskMap({ width: 200, height: 200 }), { width: 200, height: 200 });
    const row = Array.from({ length: 200 }, (_, x) => at(r, x, 100));
    const partial = row.filter((v) => v > 0 && v < 255);
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThanOrEqual(4);
  });
});

describe('brush coverage', () => {
  const stroke = (points, patch = {}) => ({ mode: 'add', radius: 0.1, hardness: 1, opacity: 1, points, ...patch });

  test('a stroke covers its whole path without gaps, however far apart its points are', () => {
    const brush = createBrush('b', { strokes: [stroke([[0.1, 0.5], [0.9, 0.5]])] });
    const r = rasterizeMask(mask([brush]), canvasMaskMap(canvas), canvas);
    for (let x = 8; x < 56; x += 1) expect(at(r, x, 23)).toBe(255);
    expect(at(r, 30, 2)).toBe(0);
  });

  test('a single point is a round dab; hardness softens it', () => {
    const hard = rasterizeMask(mask([createBrush('b', { strokes: [stroke([[0.5, 0.5]], { radius: 0.25 })] })]), canvasMaskMap({ width: 100, height: 100 }), { width: 100, height: 100 });
    expect(at(hard, 50, 50)).toBe(255);
    expect(at(hard, 50 + 20, 50)).toBe(255);
    expect(at(hard, 50 + 30, 50)).toBe(0);
    const soft = rasterizeMask(mask([createBrush('b', { strokes: [stroke([[0.5, 0.5]], { radius: 0.25, hardness: 0 })] })]), canvasMaskMap({ width: 100, height: 100 }), { width: 100, height: 100 });
    expect(at(soft, 50 + 12, 50)).toBeLessThan(255);
    expect(at(soft, 50 + 12, 50)).toBeGreaterThan(at(soft, 50 + 20, 50));
  });

  test('strokes do not build up over themselves; overlapping strokes do; erase removes', () => {
    const half = stroke([[0.2, 0.5], [0.8, 0.5], [0.2, 0.5]], { opacity: 0.5 });
    const once = rasterizeMask(mask([createBrush('b', { strokes: [half] })]), canvasMaskMap(canvas), canvas);
    expect(at(once, 32, 24)).toBe(128);
    const twice = rasterizeMask(mask([createBrush('b', { strokes: [half, half] })]), canvasMaskMap(canvas), canvas);
    expect(at(twice, 32, 24)).toBe(191);
    const erased = rasterizeMask(mask([createBrush('b', { strokes: [stroke([[0.2, 0.5], [0.8, 0.5]]), stroke([[0.5, 0.5]], { mode: 'erase', radius: 0.05 })] })]), canvasMaskMap(canvas), canvas);
    expect(at(erased, 32, 24)).toBe(0);
    expect(at(erased, 14, 24)).toBe(255);
  });

  test('pressure narrows the stroke', () => {
    const r = rasterizeMask(mask([createBrush('b', { strokes: [stroke([[0.1, 0.5, 1], [0.9, 0.5, 0.05]], { radius: 0.2 })] })]), canvasMaskMap({ width: 200, height: 100 }), { width: 200, height: 100 });
    expect(at(r, 25, 50 + 15)).toBe(255);
    expect(at(r, 175, 50 + 15)).toBe(0);
  });
});

describe('combining components', () => {
  const left = createLinear('a', { x0: 0.4, y0: 0.5, x1: 0.6, y1: 0.5, feather: 0 });
  test('add unites, subtract removes, invert and opacity per component and for the mask', () => {
    const radial = createRadial('r', { x: 0.2, y: 0.5, rx: 0.15, ry: 0.15, feather: 0 });
    const added = rasterizeMask(mask([left, { ...createRadial('r2', { x: 0.9, y: 0.5, rx: 0.1, ry: 0.1, feather: 0 }) }]), canvasMaskMap(canvas), canvas);
    expect(at(added, 5, 24)).toBe(255);
    expect(at(added, 58, 24)).toBe(255);
    expect(at(added, 50, 24)).toBe(0);
    const removed = rasterizeMask(mask([left, { ...radial, op: 'subtract' }]), canvasMaskMap(canvas), canvas);
    expect(at(removed, 13, 24)).toBe(0);
    expect(at(removed, 2, 2)).toBe(255);
    const inverted = rasterizeMask(mask([{ ...left, invert: true }]), canvasMaskMap(canvas), canvas);
    expect(at(inverted, 5, 24)).toBe(0);
    expect(at(inverted, 60, 24)).toBe(255);
    const faint = rasterizeMask(mask([{ ...left, opacity: 0.5 }], { invert: true, opacity: 0.5 }), canvasMaskMap(canvas), canvas);
    expect(at(faint, 5, 24)).toBe(64);
    expect(at(faint, 60, 24)).toBe(128);
  });

  test('a layer mask starts full; an empty local mask covers nothing', () => {
    expect(at(rasterizeMask(createMask('canvas'), canvasMaskMap(canvas), canvas), 3, 3)).toBe(255);
    expect(at(rasterizeMask(createMask('image'), canvasMaskMap(canvas), canvas), 3, 3)).toBe(0);
  });

  test('order is deterministic: subtract then add differs from add then subtract', () => {
    const r = createRadial('r', { rx: 0.2, ry: 0.2, feather: 0 });
    const a = rasterizeMask(mask([{ ...r, op: 'subtract' }, left]), canvasMaskMap(canvas), canvas);
    const b = rasterizeMask(mask([left, { ...r, op: 'subtract' }]), canvasMaskMap(canvas), canvas);
    expect(at(a, 28, 24)).toBeGreaterThan(150);
    expect(at(b, 28, 24)).toBe(0);
    expect(rasterizeMask(mask([left, r]), canvasMaskMap(canvas), canvas).data).toEqual(rasterizeMask(mask([left, r]), canvasMaskMap(canvas), canvas).data);
  });

  test('bands and column regions give the same codes as the whole canvas', () => {
    const m = mask([left, createRadial('r', { rotation: 30, rx: 0.3, ry: 0.1 }), createBrush('b', { strokes: [{ mode: 'add', radius: 0.08, hardness: 0.3, opacity: 0.7, points: [[0.1, 0.1], [0.7, 0.9, 0.4], [0.9, 0.2]] }] })]);
    const map = canvasMaskMap(canvas);
    const whole = maskRows(m, map, canvas.width, 0, canvas.height);
    const bands = new Uint8ClampedArray(whole.length);
    for (let y = 0; y < canvas.height; y += 7) bands.set(maskRows(m, map, canvas.width, y, Math.min(canvas.height, y + 7)), y * canvas.width);
    expect(bands).toEqual(whole);
    const region = maskRows(m, map, 20, 10, 30, { x0: 13 });
    for (let y = 10; y < 30; y += 1) expect(Array.from(region.subarray((y - 10) * 20, (y - 9) * 20))).toEqual(Array.from(whole.subarray(y * 64 + 13, y * 64 + 33)));
  });
});

describe('coordinate spaces', () => {
  const native = { width: 600, height: 400 };
  const geometry = normalizeGeometry({ angle: 7, crop: { x: 0.1, y: 0.15, width: 0.7, height: 0.6 }, perspective: { vertical: 20, horizontal: -10 }, stretch: { x: 110, y: 100 } });
  const plan = geometryPlan(geometry, native);
  const sourcePoint = { x: 0.45, y: 0.5 };
  const local = mask([createRadial('r', { ...sourcePoint, rx: 0.05, ry: 0.05, feather: 0 })], {}, 'image');

  test('an image-space mask stays on the same source content through crop, rotation, perspective and stretch, at any render size', () => {
    for (const scale of [0.25, 0.5, 1]) {
      const out = { width: Math.round(plan.native.width * scale), height: Math.round(plan.native.height * scale) };
      const map = imageMaskMap(plan, out, native);
      const r = rasterizeMask(local, map, out);
      // The canvas pixel whose centre maps closest to the radial's centre is fully covered.
      let best = null;
      for (let y = 0; y < out.height; y += 1) {
        for (let x = 0; x < out.width; x += 1) {
          const [sx, sy] = project(map.matrix, x + 0.5, y + 0.5);
          const d = Math.hypot(sx - sourcePoint.x * native.width, sy - sourcePoint.y * native.height);
          if (!best || d < best.d) best = { d, x, y };
        }
      }
      expect(at(r, best.x, best.y)).toBe(255);
      // Coverage area in source pixels is the same at every scale (within edge rounding).
      const area = (x, y) => {
        const [ax, ay] = project(map.matrix, x, y);
        const [bx, by] = project(map.matrix, x + 1, y);
        const [cx, cy] = project(map.matrix, x, y + 1);
        return Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
      };
      const covered = Array.from(r.data).reduce((sum, v, i) => sum + (v / 255) * area(i % out.width, Math.floor(i / out.width)), 0);
      expect(covered).toBeGreaterThan(Math.PI * 20 ** 2 * 0.8);
      expect(covered).toBeLessThan(Math.PI * 20 ** 2 * 1.25);
    }
  });

  test('a layer-space mask follows an image layer when it moves and rotates', () => {
    const raster = { width: 80, height: 40 };
    const layer = { x: 0.5, y: 0.5, width: 0.5, height: 0.25, rotation: 0, flipH: false, flipV: false };
    const big = { width: 200, height: 160 };
    const m = mask([createLinear('g', { x0: 0, y0: 0.5, x1: 1, y1: 0.5, feather: 0 })], {}, 'layer');
    const still = rasterizeMask(m, layerMaskMap(layerMatrix(layer, big, raster), raster), big);
    const moved = rasterizeMask(m, layerMaskMap(layerMatrix({ ...layer, x: 0.6 }, big, raster), raster), big);
    expect(at(moved, 100 + 20, 80)).toBe(at(still, 100, 80));
    const turned = rasterizeMask(m, layerMaskMap(layerMatrix({ ...layer, rotation: 90 }, big, raster), raster), big);
    // The layer's left edge (full coverage) is now at its top.
    expect(at(turned, 100, 80 - 35)).toBeGreaterThan(200);
    expect(at(turned, 100, 80 + 35)).toBeLessThan(55);
  });

  test('maskMap keeps space pixels per canvas pixel for edge widths', () => {
    expect(maskMap([2, 0, 0, 0, 2, 0, 0, 0, 1], 10, 10).scale).toBe(2);
  });
});

describe('masked compositing', () => {
  const backdrop = () => noise(32, 24);
  const half = (space = 'canvas') => mask([createLinear('g', { x0: 0.5, y0: 0, x1: 0.5 + 1e-4, y1: 0, feather: 0 })], {}, space);
  const pass = (m) => ({ def: m, map: canvasMaskMap({ width: 32, height: 24 }) });

  test('an adjustment pass changes only where its mask covers, by the coverage', () => {
    const layer = createAdjustmentLayer('A', { exposure: 1, saturation: -50 });
    const full = compositeImageSync(backdrop(), [adjustmentPass(layer)]);
    const masked = compositeImageSync(backdrop(), [adjustmentPass(layer, null, pass(half()))]);
    const original = backdrop();
    for (let y = 0; y < 24; y += 1) {
      for (let x = 0; x < 32; x += 1) {
        const i = (y * 32 + x) * 4;
        expect(Array.from(masked.data.subarray(i, i + 4))).toEqual(Array.from((x < 16 ? full : original).data.subarray(i, i + 4)));
      }
    }
  });

  test('a raster pass is hidden where its mask is empty and keeps its alpha, opacity and blend elsewhere', () => {
    const raster = solid(32, 24, [200, 30, 90, 180]);
    const layer = { id: 'L', opacity: 0.7, blend: 'multiply' };
    const canvas32 = { width: 32, height: 24 };
    const full = compositeImageSync(backdrop(), [rasterPass(layer, raster, offsetMatrix(0, 0), canvas32)]);
    const masked = compositeImageSync(backdrop(), [rasterPass(layer, raster, offsetMatrix(0, 0), canvas32, pass(half()))]);
    const original = backdrop();
    expect(masked.data.subarray(0, 4)).toEqual(full.data.subarray(0, 4));
    expect(masked.data.subarray(31 * 4, 32 * 4)).toEqual(original.data.subarray(31 * 4, 32 * 4));
  });

  test('a precomputed coverage raster gives the same pixels as evaluating the mask', () => {
    const layer = createAdjustmentLayer('A', { contrast: 60 });
    const m = mask([createRadial('r', { rx: 0.3, ry: 0.2, feather: 0.6, rotation: 20 })]);
    const map = canvasMaskMap({ width: 32, height: 24 });
    const evaluated = compositeImageSync(backdrop(), [adjustmentPass(layer, null, { def: m, map })]);
    const precomputed = compositeImageSync(backdrop(), [adjustmentPass(layer, null, { def: m, map, raster: rasterizeMask(m, map, { width: 32, height: 24 }) })]);
    expect(precomputed.data).toEqual(evaluated.data);
  });

  test('transparent edges keep their alpha under a masked adjustment', () => {
    const image = noise(16, 16);
    for (let i = 3; i < image.data.length; i += 8) image.data[i] = 40;
    const before = new Uint8ClampedArray(image.data);
    compositeImageSync(image, [adjustmentPass(createAdjustmentLayer('A', { exposure: 2 }), null, { def: createMask('canvas'), map: canvasMaskMap(image) })]);
    for (let i = 3; i < image.data.length; i += 4) expect(image.data[i]).toBe(before[i]);
  });
});

describe('local adjustments', () => {
  const image = () => noise(48, 40, 3);
  const local = (settings, components = [createRadial('r', { rx: 0.25, ry: 0.25, feather: 0.4 })]) => ({ id: 'L', amount: 1, settings, mask: mask(components, {}, 'image') });
  const native = { width: 48, height: 40 };
  const map = canvasMaskMap(native);
  const passesOf = (l, m = { def: l.mask, map }) => localPasses(l, m, native, splitLocalSettings(l.settings));

  test('Detail settings become a Detail pass before the colour pass', () => {
    expect(passesOf(local({ clarity: 50, exposure: 1 })).map(({ kind }) => kind)).toEqual(['detail', 'adjust']);
    expect(passesOf(local({ hueRedHue: 10 })).map(({ kind }) => kind)).toEqual(['adjust']);
  });

  test('outside the mask every pixel is unchanged; amount 0 changes nothing', () => {
    const l = local({ clarity: 80, sharpening: 60, texture: 40, exposure: -1 });
    const out = compositeImageSync(image(), passesOf(l));
    const original = image();
    let changed = 0;
    for (let p = 0; p < 48 * 40; p += 1) {
      const x = p % 48;
      const y = Math.floor(p / 48);
      const inside = Math.hypot(x + 0.5 - 24, y + 0.5 - 20) < 10 * 0.95;
      const same = out.data.slice(p * 4, p * 4 + 4).every((v, c) => v === original.data[p * 4 + c]);
      if (Math.hypot(x + 0.5 - 24, y + 0.5 - 20) > 10.5) expect(same).toBe(true);
      if (inside && !same) changed += 1;
    }
    expect(changed).toBeGreaterThan(200);
    expect(compositeImageSync(image(), passesOf({ ...l, amount: 0 })).data).toEqual(image().data);
  });

  test('a Detail pass is seam-free: any band height gives the same pixels', async () => {
    const l = local({ clarity: 70, dehaze: 30, sharpening: 80, luminanceNoise: 40, colorNoise: 30, texture: -40 }, [createLinear('g', { x0: 0, y0: 0, x1: 1, y1: 1 })]);
    const whole = compositeImageSync(image(), passesOf(l));
    for (const bandRows of [1, 5, 16]) {
      const banded = await compositeImage(image(), passesOf(l), { bandRows });
      expect(banded.data).toEqual(whole.data);
    }
  });
});

describe('exports', () => {
  const size = { width: 40, height: 30 };
  const native = { width: 80, height: 60 };
  const photo = () => noise(40, 30, 11);
  const contextOf = (image) => ({
    getImageData: () => ({ width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) }),
    putImageData: (data) => image.data.set(data.data),
  });

  test('composeLayers applies local adjustments then masked layers, as the preview passes do', async () => {
    const { composeLayers } = await import('../io/composeLayers.mjs');
    const plan = geometryPlan(normalizeGeometry({ angle: 5 }), native);
    const local = { id: 'L', name: '', enabled: true, amount: 0.9, settings: { exposure: -1, clarity: 40 }, mask: mask([createLinear('g', { x0: 0.5, y0: 0, x1: 0.5, y1: 0.6 })], {}, 'image') };
    const layer = { ...createAdjustmentLayer('A', { saturation: -80 }), blend: 'luminosity', mask: mask([createRadial('r', { rx: 0.3, ry: 0.3 })], {}, 'canvas') };
    const exported = photo();
    await composeLayers(contextOf(exported), [layer], { size, local: [local], imageMap: (canvas) => imageMaskMap(plan, canvas, native), native, loadRaster: null, rasterizeText: null, lutFor: () => null });
    const expected = photo();
    const map = imageMaskMap(plan, size, native);
    compositeImageSync(expected, [
      ...localPasses(local, { def: local.mask, map, raster: rasterizeMask(local.mask, map, size) }, native, splitLocalSettings(local.settings)),
      adjustmentPass(layer, null, { def: layer.mask, map: canvasMaskMap(size), raster: rasterizeMask(layer.mask, canvasMaskMap(size), size) }),
    ]);
    expect(exported.data).toEqual(expected.data);
  });

  test('a band worker evaluates a posted mask and matches the whole pass', async () => {
    const { handlers } = await import('../io/imageTasks.mjs');
    const pass = adjustmentPass(createAdjustmentLayer('A', { exposure: 1 }), null, { def: mask([createRadial('r', { rx: 0.2, ry: 0.4, rotation: 45 })]), map: canvasMaskMap(size) });
    const whole = compositeImageSync(photo(), [pass]);
    const banded = photo();
    for (let row = 0; row < 30; row += 8) {
      const end = Math.min(30, row + 8);
      const { result } = await handlers.compositeRows({ pass: structuredClone(pass), rows: banded.data.slice(row * 160, end * 160), width: 40, y0: row, y1: end });
      banded.data.set(result, row * 160);
    }
    expect(banded.data).toEqual(whole.data);
  });
});

test('a Detail pass over a canvas ImageData (prototype getters) renders like a plain image', () => {
  class FakeImageData {
    #data;
    constructor(image) { this.#data = image.data; this.w = image.width; this.h = image.height; }
    get width() { return this.w; }
    get height() { return this.h; }
    get data() { return this.#data; }
  }
  const local = { id: 'L', amount: 1, settings: { clarity: 60 }, mask: mask([createRadial('r')], {}, 'image') };
  const passes = (image) => localPasses(local, { def: local.mask, map: canvasMaskMap(image) }, image, splitLocalSettings(local.settings));
  const plain = compositeImageSync(noise(40, 30), passes({ width: 40, height: 30 }));
  const wrapped = new FakeImageData(noise(40, 30));
  compositeImageSync(wrapped, passes(wrapped));
  expect(wrapped.data).toEqual(plain.data);
});

test('the painting cache gives the same coverage as a fresh evaluation at every step', () => {
  const size = { width: 90, height: 70 };
  const map = canvasMaskMap(size);
  const cache = new Map();
  const first = { mode: 'add', radius: 0.1, hardness: 0.4, opacity: 0.8, points: [] };
  const second = { mode: 'erase', radius: 0.05, hardness: 0.9, opacity: 1, points: [] };
  const check = (strokes) => {
    const m = mask([createBrush('b', { strokes: strokes.filter((s) => s.points.length) }), createRadial('r', { op: 'subtract', rx: 0.1, ry: 0.1 })]);
    expect(rasterizeMask(m, map, size, cache).data).toEqual(rasterizeMask(m, map, size).data);
    return m;
  };
  let m;
  for (let i = 0; i < 12; i += 1) m = check([{ ...first, points: [...first.points, ...Array.from({ length: i + 1 }, (_, k) => [0.1 + k * 0.07, 0.3 + 0.03 * k])] }]);
  const done = m.components[0].strokes[0];
  for (let i = 0; i < 6; i += 1) m = check([done, { ...second, points: Array.from({ length: i + 1 }, (_, k) => [0.5 + k * 0.03, 0.4]) }]);
  // Undo the second stroke, then paint another one.
  check([done]);
  check([done, { ...first, points: [[0.2, 0.8], [0.6, 0.85]] }]);
});

test('an export cancelled during a local Detail pass stops between bands', async () => {
  const local = { id: 'L', amount: 1, settings: { clarity: 50 }, mask: mask([createLinear('g', { x0: 0, y0: 0, x1: 0, y1: 1 })], {}, 'image') };
  const image = noise(40, 60);
  const passes = localPasses(local, { def: local.mask, map: canvasMaskMap(image) }, image, splitLocalSettings(local.settings));
  let bands = 0;
  await expect(compositeImage(image, passes, { bandRows: 8, onBand: () => { bands += 1; }, cancelled: () => bands >= 2 })).rejects.toMatchObject({ code: 'cancelled' });
  expect(bands).toBe(2);
});
