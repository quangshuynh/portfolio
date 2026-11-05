// CPU cost of layer compositing at 6 MP in Node (one thread), the Interval 24 reference
// composition (3 image + 2 adjustment layers, flat and as a clip run in nested groups) and the
// same with Detail on adjustment layers (Interval 24.1): whole canvas, clipped to an image layer,
// and masked by an image layer's selection. Prints time and peak resident memory per case.
// Usage: node scripts/bench-layer-detail.mjs
import { performance } from 'node:perf_hooks';
import { normalizeLayers } from '../src/editor/model/layers.mjs';
import { layerProgram } from '../src/editor/model/layerTree.mjs';
import { maskActive, normalizeMask } from '../src/editor/model/masks.mjs';
import { adjustmentLayerPass, compositeImageSync, groupPass, rasterPass } from '../src/editor/pipeline/composite.mjs';
import { layerMatrix } from '../src/editor/pipeline/layerTransform.mjs';
import { canvasMaskMap, layerMaskMap } from '../src/editor/pipeline/mask.mjs';
import { encodeCodes } from '../src/editor/segment/analysis.mjs';

const W = 3000;
const H = 2000;
const canvas = { width: W, height: H };
function image(width, height, seed) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const v = 60 + ((x * 7 + y * 3 + seed) % 120) + 30 * Math.sin((x + seed) / 23);
    data.set([v, v * 0.8, 200 - v * 0.5, 255], (y * width + x) * 4);
  }
  return { width, height, data };
}
const sources = [image(1500, 1000, 1), image(1200, 1600, 2), image(900, 600, 3)];
const src = (i) => ({ sha256: String(i).repeat(64), name: `l${i}.png`, size: 1, format: 'png', width: sources[i].width, height: sources[i].height });
const imageLayer = (i, patch = {}) => ({ id: `img${i}`, type: 'image', source: src(i), x: 0.3 + 0.2 * i, y: 0.5, width: sources[i].width / 1000, height: sources[i].height / 1000, rotation: 7 * i, ...patch });
const adjust = (id, settings, patch = {}) => ({ id, type: 'adjustment', settings, ...patch });
// A subject-like selection over image layer 1 (an ellipse in its own space).
function ellipseSelection() {
  const gw = 384; const gh = 512;
  const codes = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y += 1) for (let x = 0; x < gw; x += 1) codes[y * gw + x] = ((x / gw - 0.5) / 0.35) ** 2 + ((y / gh - 0.55) / 0.4) ** 2 < 1 ? 255 : 0;
  return { id: 's', type: 'selection', kind: 'subject', version: 'bench', width: gw, height: gh, data: encodeCodes(codes), confidence: 1, feather: 0.2 };
}
const subjectMask = normalizeMask({ base: 'none', components: [ellipseSelection()] }, 'layer');

const CASES = {
  'flat (Interval 24 reference)': [imageLayer(0), adjust('a1', { exposure: 0.3 }), imageLayer(1, { blend: 'multiply' }), adjust('a2', { saturation: -30 }), imageLayer(2)],
  'clip run in nested groups (Interval 24 reference)': [
    { id: 'g1', type: 'group', blend: 'normal' }, { id: 'g2', type: 'group', blend: 'screen', parent: 'g1' },
    { ...imageLayer(0), parent: 'g2' }, adjust('a1', { exposure: 0.3 }, { parent: 'g2', clip: true }), { ...imageLayer(1, { blend: 'multiply' }), parent: 'g2', clip: true },
    adjust('a2', { saturation: -30 }, { parent: 'g1' }), { ...imageLayer(2), parent: 'g1' },
  ],
  'flat, Detail on the whole canvas': [imageLayer(0), adjust('a1', { exposure: 0.3, clarity: 30, sharpening: 40 }), imageLayer(1, { blend: 'multiply' }), adjust('a2', { saturation: -30 }), imageLayer(2)],
  'masked subject layer + clipped Detail adjustment': [imageLayer(0), adjust('a1', { exposure: 0.3 }), imageLayer(1, { mask: subjectMask }), adjust('d', { clarity: 30, sharpening: 40, exposure: -0.2 }, { clip: true }), imageLayer(2)],
};

function passes(layers) {
  return layerProgram(normalizeLayers(layers)).map((step) => {
    if (step.op !== 'layer') return groupPass(step);
    const { layer } = step;
    const mask = maskActive(layer.mask) ? layer.mask : null;
    if (layer.type === 'adjustment') return adjustmentLayerPass(layer, null, mask && { def: mask, map: canvasMaskMap(canvas) }, canvas);
    const raster = sources[Number(layer.id.slice(3))];
    const matrix = layerMatrix(layer, canvas, raster);
    return rasterPass(layer, raster, matrix, canvas, mask && { def: mask, map: layerMaskMap(matrix, raster) });
  });
}

// Each case runs in its own process, so its peak resident memory is its own.
const only = process.argv[2];
if (only === undefined) {
  const { execFileSync } = await import('node:child_process');
  for (const index of Object.keys(CASES).keys()) process.stdout.write(execFileSync(process.execPath, [new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), String(index)]));
} else {
  const [name, layers] = Object.entries(CASES)[Number(only)];
  const base = image(W, H, 9);
  const before = process.resourceUsage().maxRSS;
  const started = performance.now();
  compositeImageSync(base, passes(layers));
  const ms = performance.now() - started;
  console.log(`${name}: ${(ms / 1000).toFixed(2)} s, peak RSS ${Math.round(process.resourceUsage().maxRSS / 1024)} MB (+${Math.round((process.resourceUsage().maxRSS - before) / 1024)} MB while compositing)`);
}
