// Groups, clipping and the blend arithmetic behind them, checked pixel by pixel against
// independent float references (Porter–Duff "over"/"atop" and the W3C blend formulas written out
// here, not the compositor's own helpers). Codes may differ by 1 where two 8-bit roundings meet.
import { describe, expect, test } from 'vitest';
import { normalizeLayers } from '../model/layers.mjs';
import { layerProgram } from '../model/layerTree.mjs';
import { createLinear, createMask } from '../model/masks.mjs';
import { adjustmentPass, compositeImage, compositeImageSync, groupPass, rasterPass } from './composite.mjs';
import { atopPixel, blendChannel, fadePixel } from './blend.mjs';
import { offsetMatrix } from './layerTransform.mjs';
import { canvasMaskMap, layerMaskMap } from './mask.mjs';
import { createLocalPreview } from './localPreview.mjs';
import { prepareRender, renderRgba8 } from './cpuRenderer.mjs';
import { adjustmentParams } from './composite.mjs';

const W = 16;
const H = 8;
const canvas = { width: W, height: H };
const source = { sha256: 'a'.repeat(64), name: 'x.png', size: 1, format: 'png', width: W, height: H };

function backdrop() {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p += 1) data.set([(p * 37) % 256, (p * 91 + 40) % 256, (p * 13 + 200) % 256, 255], p * 4);
  return { width: W, height: H, data };
}
// A canvas-sized raster: colour `rgb`, alpha from `alpha(x, y)` (0–255).
function raster(rgb, alpha = () => 255) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) data.set([...rgb, alpha(x, y)], (y * W + x) * 4);
  return { width: W, height: H, data };
}
// Soft alpha across the base: 0 at the left edge to 255 at the right, never a hard edge.
const ramp = (x) => Math.round((x / (W - 1)) * 255);

const image = (id, patch = {}) => ({ id, type: 'image', source, x: 0.5, y: 0.5, width: 2, height: 1, ...patch });
const adjust = (id, settings, patch = {}) => ({ id, type: 'adjustment', settings, ...patch });
const group = (id, patch = {}) => ({ id, type: 'group', ...patch });

// The compositor's passes for a program, with each image layer drawn from rasters[id] pixel for pixel.
function passes(layers, rasters) {
  return layerProgram(normalizeLayers(layers)).map((step) => {
    if (step.op !== 'layer') return groupPass(step, step.owner ? { def: step.owner.mask, map: canvasMaskMap(canvas) } : null);
    if (step.layer.type === 'adjustment') return adjustmentPass(step.layer);
    const r = rasters[step.layer.id];
    return rasterPass(step.layer, r, offsetMatrix(0, 0), canvas, step.layer.mask ? { def: step.layer.mask, map: layerMaskMap(offsetMatrix(0, 0), r) } : null);
  });
}
const render = (layers, rasters, base = backdrop()) => compositeImageSync(base, passes(layers, rasters)).data;

function expectClose(actual, expected, tolerance = 1) {
  let worst = 0;
  for (let i = 0; i < expected.length; i += 1) worst = Math.max(worst, Math.abs(actual[i] - expected[i]));
  expect(worst).toBeLessThanOrEqual(tolerance);
}
// Float reference per pixel: fn(backdrop [r, g, b] in 0–1, x, y) → [r, g, b] in 0–1; alpha stays 255.
function reference(fn) {
  const b = backdrop().data;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const i = (y * W + x) * 4;
    const rgb = fn([b[i] / 255, b[i + 1] / 255, b[i + 2] / 255], x, y);
    out.set([...rgb.map((v) => Math.round(v * 255)), 255], i);
  }
  return out;
}
const lerp = (a, b, t) => a.map((v, c) => v + t * (b[c] - v));

const BASE = [200, 40, 90].map((v) => v / 255);
const TOP = [20, 180, 60].map((v) => v / 255);

describe('clipping masks', () => {
  const rasters = { base: raster([200, 40, 90], ramp), top: raster([20, 180, 60]), half: raster([20, 180, 60], () => 128) };

  test('an opaque clipped layer shows only through the base, with the base\'s soft edge', () => {
    const actual = render([image('base'), image('top', { clip: true })], rasters);
    expectClose(actual, reference((b, x) => lerp(b, TOP, ramp(x) / 255)));
  });

  test('a semi-transparent clipped layer mixes into the base colour by its own alpha and opacity', () => {
    const actual = render([image('base', { opacity: 0.8 }), image('half', { clip: true, opacity: 0.5 })], rasters);
    const a = (128 / 255) * 0.5;
    expectClose(actual, reference((b, x) => lerp(b, lerp(BASE, TOP, a), (ramp(x) / 255) * 0.8)));
  });

  test('a clipped layer\'s blend mode mixes with the base, not with what lies below it', () => {
    const actual = render([image('base'), image('top', { clip: true, blend: 'multiply' })], rasters);
    const multiplied = BASE.map((v, c) => v * TOP[c]);
    expectClose(actual, reference((b, x) => lerp(b, multiplied, ramp(x) / 255)));
  });

  test('a clipped adjustment changes only its base; the backdrop outside the base is untouched exactly', () => {
    const settings = { exposure: 1, saturation: -50 };
    const actual = render([image('base'), adjust('a', settings, { clip: true })], rasters);
    // Reference: the base's own pixels adjusted first (the renderer on opaque base colour), then composited.
    const adjusted = renderRgba8(new Uint8ClampedArray([200, 40, 90, 255]), prepareRender(adjustmentParams(adjustmentPass({ id: 'a', settings: normalizeLayers([adjust('a', settings)])[0].settings, opacity: 1, blend: 'normal' }))));
    const A = [adjusted[0], adjusted[1], adjusted[2]].map((v) => v / 255);
    expectClose(actual, reference((b, x) => lerp(b, A, ramp(x) / 255)));
    const b = backdrop().data;
    for (let y = 0; y < H; y += 1) expect([...actual.slice(y * W * 4, y * W * 4 + 4)]).toEqual([...b.slice(y * W * 4, y * W * 4 + 4)]);
  });

  test('the base\'s mask is part of the alpha that clips', () => {
    const mask = { ...createMask('canvas', 'none'), components: [createLinear('l', { x0: 0, y0: 0.5, x1: 0.9, y1: 0.5, feather: 0 })] };
    const masked = render([image('base', { mask }), image('top', { clip: true })], { ...rasters, base: raster([200, 40, 90]) });
    // Linear gradient: coverage 1 at the left falling to 0 at the right, so the clipped colour fades out with it.
    expect(Math.abs(masked[0] - 20)).toBeLessThanOrEqual(2);
    expect(masked[(W - 1) * 4]).toBe(backdrop().data[(W - 1) * 4]);
  });

  test('an unclipped stack renders exactly as before (no isolation)', () => {
    const plain = [image('base'), image('top', { opacity: 0.4 })];
    const direct = backdrop();
    compositeImageSync(direct, [rasterPass(normalizeLayers(plain)[0], rasters.base, offsetMatrix(0, 0), canvas), rasterPass(normalizeLayers(plain)[1], rasters.top, offsetMatrix(0, 0), canvas)]);
    expect([...render(plain, rasters)]).toEqual([...direct.data]);
  });
});

describe('groups', () => {
  const rasters = { a: raster([20, 180, 60]), soft: raster([200, 40, 90], ramp) };

  test('a pass-through group at full opacity is exactly its children ungrouped', () => {
    const settings = { exposure: 0.6, contrast: 30 };
    expect([...render([image('soft', { parent: 'g' }), adjust('x', settings, { parent: 'g' }), group('g')], rasters)])
      .toEqual([...render([image('soft'), adjust('x', settings)], rasters)]);
  });

  test('a pass-through group\'s opacity fades its children\'s result toward what lay below', () => {
    const settings = { exposure: 1 };
    const grouped = render([adjust('x', settings, { parent: 'g' }), group('g', { opacity: 0.5 })], rasters);
    // The same as the adjustment at half opacity (both are a linear mix of backdrop and adjusted).
    expectClose(grouped, render([adjust('x', settings, { opacity: 0.5 })], rasters));
  });

  test('an isolated group keeps adjustments inside it to its own content', () => {
    const settings = { exposure: -2 };
    const actual = render([image('soft', { parent: 'g' }), adjust('x', settings, { parent: 'g' }), group('g', { blend: 'normal' })], rasters);
    const b = backdrop().data;
    // Column 0: the soft layer is fully transparent there, so the backdrop is untouched.
    for (let y = 0; y < H; y += 1) expect([...actual.slice(y * W * 4, y * W * 4 + 4)]).toEqual([...b.slice(y * W * 4, y * W * 4 + 4)]);
    // Pass-through would darken the backdrop too.
    const through = render([image('soft', { parent: 'g' }), adjust('x', settings, { parent: 'g' }), group('g')], rasters);
    expect(through[2]).toBeLessThan(b[2]);
  });

  test('nested group opacities multiply', () => {
    const actual = render([image('a', { parent: 'inner' }), group('inner', { parent: 'outer', blend: 'normal', opacity: 0.5 }), group('outer', { blend: 'normal', opacity: 0.5 })], rasters);
    expectClose(actual, reference((b) => lerp(b, TOP, 0.25)));
  });

  test('an isolated group\'s blend mode applies to its flattened content', () => {
    const actual = render([image('a', { parent: 'g' }), group('g', { blend: 'screen', opacity: 0.75 })], rasters);
    expectClose(actual, reference((b) => lerp(b, b.map((v, c) => v + TOP[c] - v * TOP[c]), 0.75)));
  });

  test('a group mask limits the whole group', () => {
    const mask = { ...createMask('canvas', 'none'), components: [createLinear('l', { x0: 0, y0: 0.5, x1: 0.9, y1: 0.5, feather: 0 })] };
    const actual = render([image('a', { parent: 'g' }), { ...group('g'), mask }], rasters);
    expect(Math.abs(actual[0] - 20)).toBeLessThanOrEqual(2);
    expect(actual[(W - 1) * 4]).toBe(backdrop().data[(W - 1) * 4]);
  });

  test('banded compositing (exports) equals the whole-image composite', async () => {
    const layers = [image('soft', { parent: 'g' }), adjust('x', { exposure: 0.5 }, { parent: 'g', clip: true }), group('g', { blend: 'multiply', opacity: 0.9 }), image('a', { clip: true, opacity: 0.3 })];
    const whole = render(layers, rasters);
    const banded = backdrop();
    await compositeImage(banded, passes(layers, rasters), { bandRows: 3 });
    expect([...banded.data]).toEqual([...whole]);
  });

  test('the CPU preview cache composes groups exactly as compositeImageSync', () => {
    const layers = [image('soft', { parent: 'g' }), group('g', { opacity: 0.6 }), image('a', { clip: true })];
    const preview = createLocalPreview({ renderDetail: async () => null });
    const base = backdrop();
    const { image: shown } = preview.compose(base, passes(layers, rasters));
    expect([...shown.data]).toEqual([...render(layers, rasters)]);
  });
});

describe('blend arithmetic', () => {
  const at = (rgba) => new Uint8ClampedArray(rgba);

  test('fadePixel interpolates in premultiplied colour, so a transparent end adds no dark fringe', () => {
    const out = at([255, 0, 0, 255]);
    fadePixel(out, 0, at([0, 0, 0, 0]), 0, 0.5);
    // Half the red pixel's coverage, still pure red (a straight-colour mix would give 128, 0, 0).
    expect([...out]).toEqual([255, 0, 0, 128]);
    const keep = at([10, 20, 30, 255]);
    fadePixel(keep, 0, at([200, 200, 200, 255]), 0, 1);
    expect([...keep]).toEqual([10, 20, 30, 255]);
    fadePixel(keep, 0, at([200, 200, 200, 255]), 0, 0);
    expect([...keep]).toEqual([200, 200, 200, 255]);
  });

  test('atopPixel keeps the base alpha and mixes colour by the source alpha', () => {
    const out = at([100, 100, 100, 64]);
    atopPixel(0, out, 0, at([200, 0, 50, 255]), 0, 0.5);
    expect([...out]).toEqual([150, 50, 75, 64]);
  });

  test.each([
    ['multiply', 1, (b, s) => b * s],
    ['screen', 2, (b, s) => b + s - b * s],
    ['overlay', 3, (b, s) => (b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s))],
    ['hard-light', 5, (b, s) => (s <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s))],
    ['darken', 6, Math.min],
    ['lighten', 7, Math.max],
  ])('%s matches the W3C formula over a grid of values', (_, code, formula) => {
    for (let b = 0; b <= 1; b += 0.125) for (let s = 0; s <= 1; s += 0.125) expect(blendChannel(code, b, s)).toBeCloseTo(formula(b, s), 12);
  });

  test('soft light follows the W3C definition (its square-root branch above a quarter)', () => {
    const D = (b) => (b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b));
    for (let b = 0; b <= 1; b += 0.125) for (let s = 0; s <= 1; s += 0.125) {
      const expected = s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b) : b + (2 * s - 1) * (D(b) - b);
      expect(blendChannel(4, b, s)).toBeCloseTo(expected, 12);
    }
  });
});

describe('selections in layer masks', () => {
  test('a canvas mask evaluates its selection in the photo\'s space, exactly as a local adjustment\'s mask does', async () => {
    const { geometryPlan, normalizeGeometry } = await import('./geometry.mjs');
    const { imageMaskMap, maskRows } = await import('./mask.mjs');
    const { createSelection } = await import('../model/masks.mjs');
    const { encodeCodes } = await import('../segment/analysis.mjs');
    const grid = new Uint8Array(32 * 24);
    for (let y = 0; y < 24; y += 1) for (let x = 0; x < 32; x += 1) grid[y * 32 + x] = y < 10 ? 255 : y < 12 ? 128 : 0;
    const selection = createSelection('s', { kind: 'sky', version: 't/1', width: 32, height: 24, data: encodeCodes(grid), confidence: 0.9 }, { feather: 0.3 });
    const native = { width: 320, height: 240 };
    const plan = geometryPlan(normalizeGeometry({ rotation: 7 }), native);
    const out = { width: 160, height: 120 };
    const local = { ...createMask('image'), components: [selection] };
    const layer = { ...createMask('canvas', 'none'), components: [selection] };
    const expected = maskRows(local, imageMaskMap(plan, out, native), out.width, 0, out.height);
    expect([...maskRows(layer, canvasMaskMap(out, imageMaskMap(plan, out, native)), out.width, 0, out.height)]).toEqual([...expected]);
    expect(expected.some((v) => v > 0) && expected.some((v) => v === 0)).toBe(true);
    // Without the photo's map (a layer box) a selection covers nothing.
    expect(maskRows(layer, canvasMaskMap(out), out.width, 0, out.height).every((v) => v === 0)).toBe(true);
  });
});
