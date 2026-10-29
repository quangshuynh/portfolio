// Layer compositing parity (dev server only): the WebGL2 passes (glRenderer.composite) against
// the CPU reference (composite.mjs) for every blend mode, transforms, alpha and adjustment
// layers, masked passes (gradients, brush strokes, inverted and layer-space masks, local
// adjustments), and the CPU reference against the browser's own canvas blend modes (an independent
// implementation of the same W3C formulas). Results land on window.layerParityResult for
// scripts/check-editor-layers.mjs.
import { BLEND_MODES, createAdjustmentLayer, normalizeLayer } from '../model/layers.mjs';
import { GlRenderer, createEditorContext } from '../pipeline/glRenderer.mjs';
import { renderRgba8 } from '../pipeline/cpuRenderer.mjs';
import { deriveParams } from '../pipeline/spec.mjs';
import { adjustmentParams, adjustmentPass, compositeImageSync, rasterPass } from '../pipeline/composite.mjs';
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
  out.push({ name: 'masked adjustment (gradient, brush, subtract)', passes: [adjustmentPass({ ...createAdjustmentLayer('A', { exposure: -1.2, saturation: 40 }), blend: 'soft-light', opacity: 0.85 }, null, withRaster(canvasMask, canvasMaskMap(canvas)))] });
  const native = { width: 192, height: 128 };
  const plan = geometryPlan(normalizeGeometry({ angle: 9, crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, perspective: { vertical: 15, horizontal: 0 } }), native);
  const local = { id: 'L', amount: 0.8, settings: { exposure: 0.8, temperature: -30, blueSaturation: -60 }, mask: normalizeMask({ components: [createLinear('sky', { x0: 0.5, y0: 0.1, x1: 0.5, y1: 0.6 }), createRadial('r', { x: 0.7, y: 0.6, rx: 0.2, ry: 0.15 })] }, 'image') };
  out.push({ name: 'local adjustment (image space under geometry)', passes: localPasses(local, withRaster(local.mask, imageMaskMap(plan, canvas, native)), native, splitLocalSettings(local.settings)) });
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
    results.push({ name: test.name, ...compare(gpu, gpuBase.data), endToEnd: compare(gpu, cpu.data) });
  }
  renderer.dispose();
  return { results, canvas: canvasReference() };
}

window.layerParityResult = run();
