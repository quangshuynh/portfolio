// Layer compositing parity (dev server only): the WebGL2 passes (glRenderer.composite) against
// the CPU reference (composite.mjs) for every blend mode, transforms, alpha and adjustment
// layers, masked passes (gradients, brush strokes, inverted and layer-space masks, local
// adjustments), and the CPU reference against the browser's own canvas blend modes (an independent
// implementation of the same W3C formulas). The frame cache (render with a `baseKey`, as the
// viewer draws) must equal the uncached render exactly, on a miss, on a hit and while a brush mask
// grows under one key, then after the photo changes under that key. Results land on window.layerParityResult for
// scripts/check-editor-layers.mjs and check-editor-masks.mjs.
import { BLEND_MODES, createAdjustmentLayer, normalizeLayer } from '../model/layers.mjs';
import { GlRenderer, createEditorContext } from '../pipeline/glRenderer.mjs';
import { renderRgba8 } from '../pipeline/cpuRenderer.mjs';
import { deriveParams } from '../pipeline/spec.mjs';
import { adjustmentParams, adjustmentPass, compositeImageSync, groupPass, rasterPass } from '../pipeline/composite.mjs';
import { layerMatrix, offsetMatrix } from '../pipeline/layerTransform.mjs';
import { normalizeAdjustments } from '../model/adjustments.mjs';
import { lookLut } from './lutFixtures.mjs';
import { canvasMaskMap, imageMaskMap, layerMaskMap, rasterizeMask } from '../pipeline/mask.mjs';
import { localPasses } from '../pipeline/composite.mjs';
import { createBrush, createLinear, createRadial, normalizeMask, splitLocalSettings } from '../model/masks.mjs';
import { geometryPlan, normalizeGeometry } from '../pipeline/geometry.mjs';

const W = 96;
const H = 64;
function backdrop(alpha = false) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const i = (y * W + x) * 4;
    data.set([(x * 255) / (W - 1), (y * 255) / (H - 1), ((x + y) * 37) % 256, alpha ? (x < W / 2 ? 255 : Math.round((y / (H - 1)) * 255)) : 255], i);
  }
  return { width: W, height: H, data };
}
// A layer raster with colour, soft alpha and a transparent border.
function raster(width = 40, height = 30) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const edge = Math.min(x, y, width - 1 - x, height - 1 - y);
    data.set([255 - (x * 6) % 256, (y * 8) % 256, (x * y) % 256, edge === 0 ? 0 : edge === 1 ? 128 : 230 - x], (y * width + x) * 4);
  }
  return { width, height, data };
}
const source = { sha256: 'a'.repeat(64), name: 'layer.png', size: 1, format: 'png', width: 40, height: 30 };
const imageLayer = (patch) => normalizeLayer({ id: 'L', type: 'image', source, x: 0.45, y: 0.55, width: 0.9, height: 0.65, rotation: 23, flipH: true, opacity: 0.8, ...patch });
const LUT = lookLut(17);

function cases() {
  const out = [];
  const r = raster();
  const canvas = { width: W, height: H };
  for (const { id } of BLEND_MODES) {
    const l = imageLayer({ blend: id });
    out.push({ name: `image ${id}`, passes: [rasterPass(l, r, layerMatrix(l, canvas, r), canvas)] });
  }
  for (const { id } of BLEND_MODES.filter((_, i) => i % 3 === 0)) {
    const l = imageLayer({ blend: id, rotation: -61, flipH: false, flipV: true, opacity: 1, width: 0.5, height: 0.4 });
    out.push({ name: `image ${id} over transparency`, alpha: true, passes: [rasterPass(l, r, layerMatrix(l, canvas, r), canvas)] });
  }
  const sprite = raster(30, 20);
  out.push({ name: 'sprite exact', passes: [rasterPass({ id: 'T', opacity: 1, blend: 'normal' }, sprite, offsetMatrix(11, 7), canvas)] });
  const adjustments = [
    ['adjust light', { exposure: 0.7, contrast: 40, shadows: 30 }, 'normal', 1],
    ['adjust colour + curves', { temperature: -30, vibrance: 40, curves: { master: [[0, 20], [128, 150], [255, 240]] } }, 'normal', 0.6],
    ['adjust HSL', { redHue: 60, blueSaturation: -80, greenLuminance: 50 }, 'multiply', 1],
    ['adjust grading + bleach', { gradeShadowsSat: 60, gradeHighlightsSat: 40, bleachAmount: 70 }, 'luminosity', 0.75],
    ['adjust LUT', { lut: { name: 'look', sha256: 'b'.repeat(64), size: 17 }, lutIntensity: 80 }, 'soft-light', 1],
  ];
  for (const [name, settings, blend, opacity] of adjustments) {
    const layer = { ...createAdjustmentLayer('A', settings), blend, opacity };
    out.push({ name, passes: [adjustmentPass(layer, settings.lut ? LUT : null)] });
  }
  const below = imageLayer({ blend: 'normal', rotation: 10, opacity: 1 });
  const above = imageLayer({ blend: 'screen', rotation: -15, x: 0.6, flipH: false });
  out.push({
    name: 'stack image + adjustment + image',
    passes: [
      rasterPass(below, r, layerMatrix(below, canvas, r), canvas),
      adjustmentPass({ ...createAdjustmentLayer('A', { exposure: -1, saturation: -60 }), opacity: 0.9 }),
      rasterPass(above, r, layerMatrix(above, canvas, r), canvas),
    ],
  });
  // Masked passes: the preview's precomputed coverage (as the viewer passes it).
  const withRaster = (def, map) => ({ def, map, key: JSON.stringify(def), raster: rasterizeMask(def, map, canvas) });
  const strokes = [{ mode: 'add', radius: 0.12, hardness: 0.4, opacity: 0.9, points: [[0.1, 0.2], [0.5, 0.7, 0.6], [0.9, 0.3]] }, { mode: 'erase', radius: 0.05, hardness: 1, opacity: 1, points: [[0.5, 0.65]] }];
  const canvasMask = normalizeMask({ base: 'none', components: [createLinear('g', { x0: 0.2, y0: 0, x1: 0.8, y1: 1, feather: 0.5 }), createBrush('b', { strokes }), createRadial('r', { op: 'subtract', rx: 0.15, ry: 0.1, rotation: 30 })] }, 'canvas');
  for (const blend of ['normal', 'multiply', 'color']) {
    const l = imageLayer({ blend });
    const m = normalizeMask({ base: 'all', invert: blend === 'multiply', components: [createRadial('r', { x: 0.4, rx: 0.3, ry: 0.2, feather: 0.7 })] }, 'layer');
    out.push({ name: `masked image ${blend}`, passes: [rasterPass(l, r, layerMatrix(l, canvas, r), canvas, withRaster(m, layerMaskMap(layerMatrix(l, canvas, r), r)))] });
  }
  out.push({ name: 'adjust masked (gradient, brush, subtract)', passes: [adjustmentPass({ ...createAdjustmentLayer('A', { exposure: -1.2, saturation: 40 }), blend: 'soft-light', opacity: 0.85 }, null, withRaster(canvasMask, canvasMaskMap(canvas)))] });
  const native = { width: 192, height: 128 };
  const plan = geometryPlan(normalizeGeometry({ angle: 9, crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, perspective: { vertical: 15, horizontal: 0 } }), native);
  const local = { id: 'L', amount: 0.8, settings: { exposure: 0.8, temperature: -30, blueSaturation: -60 }, mask: normalizeMask({ components: [createLinear('sky', { x0: 0.5, y0: 0.1, x1: 0.5, y1: 0.6 }), createRadial('r', { x: 0.7, y: 0.6, rx: 0.2, ry: 0.15 })] }, 'image') };
  out.push({ name: 'adjust local (image space under geometry)', passes: localPasses(local, withRaster(local.mask, imageMaskMap(plan, canvas, native)), native, splitLocalSettings(local.settings)) });
  // Groups and clipping (Interval 24): isolated targets, atop compositing, pass-through fades.
  const base = imageLayer({ blend: 'normal', opacity: 1, rotation: 8 });
  const clipped = imageLayer({ blend: 'multiply', opacity: 0.9, rotation: -20, x: 0.55, clip: true });
  const clipRun = (alpha) => ({
    name: `clip run (atop image + adjustment, base screen 0.7)${alpha ? ' over transparency' : ''}`,
    alpha,
    passes: [
      groupPass({ op: 'begin', id: 'clip', isolate: true }),
      rasterPass(base, r, layerMatrix(base, canvas, r), canvas),
      rasterPass(clipped, r, layerMatrix(clipped, canvas, r), canvas),
      adjustmentPass({ ...createAdjustmentLayer('A', { exposure: 0.8, saturation: -40 }), blend: 'soft-light', opacity: 0.8 }),
      groupPass({ op: 'end', id: 'clip', isolate: true, blend: 'screen', opacity: 0.7 }),
    ],
  });
  out.push(clipRun(false), clipRun(true));
  out.push({
    name: 'nested groups (isolated multiply > pass-through masked)',
    passes: [
      groupPass({ op: 'begin', id: 'outer', isolate: true }),
      rasterPass(below, r, layerMatrix(below, canvas, r), canvas),
      groupPass({ op: 'begin', id: 'inner', isolate: false }),
      adjustmentPass({ ...createAdjustmentLayer('A', { exposure: -1, temperature: 40 }), opacity: 1 }),
      rasterPass(above, r, layerMatrix(above, canvas, r), canvas),
      groupPass({ op: 'end', id: 'inner', isolate: false, blend: 'normal', opacity: 0.5 }, withRaster(canvasMask, canvasMaskMap(canvas))),
      groupPass({ op: 'end', id: 'outer', isolate: true, blend: 'multiply', opacity: 0.8 }),
    ],
  });
  return out;
}

function compare(a, b) {
  let max = 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < a.length; i += 4) {
    // Colour is undefined where both are fully transparent.
    if (a[i + 3] === 0 && b[i + 3] === 0) continue; // eslint-disable-line no-continue
    for (let c = 0; c < 4; c += 1) {
      const d = Math.abs(a[i + c] - b[i + c]);
      max = Math.max(max, d);
      sum += d;
      count += 1;
    }
  }
  return { max, mean: count ? sum / count : 0 };
}

// The browser's canvas as an independent reference: an exact (unscaled) sprite composited
// with globalCompositeOperation over an opaque backdrop, against composite.mjs.
function canvasReference() {
  const base = backdrop();
  const sprite = raster(30, 20);
  const results = [];
  for (const { id } of BLEND_MODES) {
    const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
    const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
    context.putImageData(new ImageData(Uint8ClampedArray.from(base.data), W, H), 0, 0);
    const layer = Object.assign(document.createElement('canvas'), { width: sprite.width, height: sprite.height });
    layer.getContext('2d', { colorSpace: 'srgb' }).putImageData(new ImageData(Uint8ClampedArray.from(sprite.data), sprite.width, sprite.height), 0, 0);
    context.globalCompositeOperation = id === 'normal' ? 'source-over' : id;
    context.globalAlpha = 0.8;
    context.drawImage(layer, 11, 7);
    const browser = context.getImageData(0, 0, W, H).data;
    const cpu = { width: W, height: H, data: Uint8ClampedArray.from(base.data) };
    compositeImageSync(cpu, [rasterPass({ id: 'T', opacity: 0.8, blend: id }, sprite, offsetMatrix(11, 7), cpu)]);
    // Only where the sprite is nearly opaque: canvases store premultiplied 8-bit values.
    let max = 0;
    for (let y = 9; y < 25; y += 1) for (let x = 13; x < 39; x += 1) {
      const i = (y * W + x) * 4;
      for (let c = 0; c < 3; c += 1) max = Math.max(max, Math.abs(browser[i + c] - cpu.data[i + c]));
    }
    results.push({ name: id, max });
  }
  return results;
}

function run() {
  const canvas = document.createElement('canvas');
  const gl = createEditorContext(canvas);
  if (!gl) return { error: 'WebGL2 unavailable' };
  const renderer = new GlRenderer(canvas, gl);
  const results = [];
  for (const test of cases()) {
    const base = backdrop(test.alpha);
    renderer.setSource(base);
    const params = deriveParams(normalizeAdjustments({ exposure: 0.2, contrast: 10 }));
    const passes = test.passes.map((pass, i) => (pass.kind === 'adjust' ? { ...pass, params: adjustmentParams(pass) } : { ...pass, key: `${test.name}:${i}` }));
    const gpu = renderer.readPixels(params, { layers: passes });
    const cpu = { width: W, height: H, data: renderRgba8(base.data, params) };
    compositeImageSync(cpu, test.passes);
    // The layer passes alone: the CPU composite over the GPU's own photo render (the photo's
    // shader-vs-CPU parity is checked by parity.html; dodge and burn amplify any 1-code difference).
    const gpuBase = { width: W, height: H, data: Uint8ClampedArray.from(renderer.readPixels(params)) };
    compositeImageSync(gpuBase, test.passes);
    // Cached frames: every case under the same base key (the source is new each case, so the
    // renderer's state key must tell them apart); the first render is a miss, the second a hit.
    const miss = renderer.readPixels(params, { layers: passes, baseKey: 'parity' });
    const hit = renderer.readPixels(params, { layers: passes, baseKey: 'parity' });
    const cached = Math.max(compare(gpu, miss).max, compare(gpu, hit).max);
    results.push({ name: test.name, ...compare(gpu, gpuBase.data), endToEnd: compare(gpu, cpu.data), cached });
  }
  const brush = brushCache(renderer);
  renderer.dispose();
  return { results, brush, canvas: canvasReference() };
}

// A brush stroke painted point by point on a masked adjustment layer: each point is a new mask
// under the same base key (cached photo and adjustment frames), compared with an uncached render
// of the same pass; then retouched pixels under the same key (the renderer's state key must miss).
function brushCache(renderer) {
  const canvas = { width: W, height: H };
  const photo = backdrop();
  renderer.setSource(photo);
  const params = deriveParams(normalizeAdjustments({ exposure: 0.2, contrast: 10 }));
  const layer = { ...createAdjustmentLayer('A', { exposure: -1.2, saturation: 40 }), blend: 'soft-light', opacity: 0.85 };
  const points = [];
  let max = 0;
  for (let i = 0; i < 8; i += 1) {
    points.push([0.1 + i * 0.1, 0.3 + (i % 3) * 0.15, 0.7]);
    const def = normalizeMask({ base: 'none', components: [createBrush('b', { strokes: [{ mode: 'add', radius: 0.1, hardness: 0.5, opacity: 1, points: points.slice() }] })] }, 'canvas');
    const pass = adjustmentPass(layer, null, { def, key: JSON.stringify(def), raster: rasterizeMask(def, canvasMaskMap(canvas), canvas) });
    const passes = [{ ...pass, params: adjustmentParams(pass) }];
    const cached = renderer.readPixels(params, { layers: passes, baseKey: 'brush' });
    max = Math.max(max, compare(renderer.readPixels(params, { layers: passes }), cached).max);
    if (i === 7) {
      renderer.setRetouched({ ...photo, data: photo.data.map((v, j) => (j % 4 === 3 ? v : 255 - v)) });
      max = Math.max(max, compare(renderer.readPixels(params, { layers: passes }), renderer.readPixels(params, { layers: passes, baseKey: 'brush' })).max);
    }
  }
  return { points: points.length, max, hits: renderer.frameHits ?? 0, misses: renderer.frameMisses ?? 0, ...brushBoxes(renderer, params, layer) };
}

// As the viewer paints (Interval 22.9): consecutive cached frames with a paint cache, so only the
// box each mask change touched is composited, including an unchanged frame, an erase stroke and an
// undo (full recomputes) mid-stroke. Each frame must equal an uncached render of the same pass.
function brushBoxes(renderer, params, layer) {
  renderer.setRetouched(null);
  const canvas = { width: W, height: H };
  const map = canvasMaskMap(canvas);
  const cache = new Map();
  const add = { mode: 'add', radius: 0.08, hardness: 0.6, opacity: 1 };
  const points = [];
  const steps = [];
  for (let i = 0; i < 6; i += 1) { points.push([0.15 + i * 0.12, 0.6 - (i % 2) * 0.2, 0.8]); steps.push([{ ...add, points: points.slice() }]); }
  steps.push(steps.at(-1));
  steps.push([...steps.at(-1), { ...add, mode: 'erase', points: [[0.4, 0.2], [0.45, 0.8]] }]);
  steps.push(steps[5]);
  steps.push([{ ...add, points: [...points, [0.9, 0.9, 0.8]] }]);
  const boxesBefore = renderer.compositeBoxes ?? 0;
  const frames = steps.map((strokes) => {
    const def = normalizeMask({ base: 'none', components: [createBrush('b', { strokes })] }, 'canvas');
    const pass = adjustmentPass(layer, null, { def, key: JSON.stringify(def), raster: rasterizeMask(def, map, canvas, cache) });
    const passes = [{ ...pass, params: adjustmentParams(pass) }];
    return { passes, cached: renderer.readPixels(params, { layers: passes, baseKey: 'brush-boxes' }) };
  });
  const boxes = (renderer.compositeBoxes ?? 0) - boxesBefore;
  let boxMax = 0;
  for (const { passes, cached } of frames) boxMax = Math.max(boxMax, compare(renderer.readPixels(params, { layers: passes }), cached).max);
  return { boxFrames: frames.length, boxes, boxMax };
}

window.layerParityResult = run();
