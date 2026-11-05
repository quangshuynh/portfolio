// High-resolution reference masks: SAM on native-resolution 1024 px windows along the coarse outline.
// Prompts per window: box of the coarse mask inside the window, 3 points deep inside, 3 deep outside.
// Pixels no window covers keep the coarse mask (thresholded). Writes <dir>/refs/<name>.png (0/255) and
// <name>.cover.png (pixels a window covered). Model-assisted: review the overlays before scoring.
// Usage: node refs.mjs <repoRoot> <dir> <originalsDir> name …   (coarse grids in <dir>/coarse)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import * as ort from 'onnxruntime-web/wasm';

const [root, dir, originals, ...names] = process.argv.slice(2);
mkdirSync(path.join(dir, 'refs'), { recursive: true });
const { upsample, contourBand } = await import(pathToFileURL(path.join(root, 'scripts/refine-bench/maps.mjs')).href);
const load = (f) => import(pathToFileURL(path.join(root, 'src/editor/segment', f)).href);
const { decodeCodes } = await load('analysis.mjs');
const { MODELS } = await load('models.mjs');
const { createSegmenter } = await load('segmenter.mjs');
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = `${pathToFileURL(path.join(root, 'node_modules/onnxruntime-web/dist')).href}/`;
const seg = createSegmenter({ ort, loadModel: async (n) => readFileSync(path.join(root, 'public/photography/editor-models', MODELS[n].file)), sessionOptions: { executionProviders: ['wasm'], graphOptimizationLevel: 'all' } });
const WIN = 1024; const STRIDE = 640;

for (const name of names) {
  const t0 = Date.now();
  const { data: rgb, info } = await sharp(path.join(originals, `${name}.JPG`)).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width; const H = info.height;
  const c = JSON.parse(readFileSync(path.join(dir, 'coarse', `${name}.json`), 'utf8'));
  const U = upsample({ width: c.width, height: c.height, codes: decodeCodes(c.data, c.width * c.height) }, W, H);
  const s = W / c.width;
  // distance-ish: far inside / far outside = beyond 4 cells of the contour
  const near = contourBand(U, W, H, Math.round(4 * s));
  const acc = new Float32Array(W * H); const wsum = new Float32Array(W * H);
  let windows = 0;
  for (let y0 = 0; y0 < H; y0 += STRIDE) {
    for (let x0 = 0; x0 < W; x0 += STRIDE) {
      const x = Math.min(x0, W - WIN); const y = Math.min(y0, H - WIN);
      // windows that hold the contour
      let has = false; const ins = []; const outs = []; let bx0 = WIN; let by0 = WIN; let bx1 = 0; let by1 = 0;
      for (let yy = 0; yy < WIN; yy += 8) for (let xx = 0; xx < WIN; xx += 8) {
        const i = (y + yy) * W + x + xx;
        if (near[i] && U[i] > 0.3 && U[i] < 0.7) has = true;
        if (U[i] >= 0.5) { bx0 = Math.min(bx0, xx); by0 = Math.min(by0, yy); bx1 = Math.max(bx1, xx); by1 = Math.max(by1, yy); }
        if (!near[i]) (U[i] >= 0.5 ? ins : outs).push([xx, yy]);
      }
      if (!has || !ins.length || !outs.length) continue; // eslint-disable-line no-continue
      const pick = (arr, k) => Array.from({ length: k }, (_, j) => arr[Math.floor(((j + 0.5) / k) * arr.length)]);
      const crop = new Uint8ClampedArray(WIN * WIN * 4);
      for (let yy = 0; yy < WIN; yy += 1) crop.set(rgb.subarray(((y + yy) * W + x) * 4, ((y + yy) * W + x + WIN) * 4), yy * WIN * 4);
      const pts = [...pick(ins, 3), ...pick(outs, 3)];
      const masks = await seg.outline({ image: { width: WIN, height: WIN, data: crop }, imageKey: `${name}-${x}-${y}`, points: [[bx0, by0], [bx1 + 8, by1 + 8], ...pts], labels: [2, 3, 1, 1, 1, 0, 0, 0] }); // eslint-disable-line no-await-in-loop
      const best = masks.reduce((b, m) => (m.score > b.score ? m : b));
      // agreement with the coarse far from the contour, else the window is unreliable
      let agree = 0; let total = 0;
      for (let yy = 0; yy < WIN; yy += 8) for (let xx = 0; xx < WIN; xx += 8) { const i = (y + yy) * W + x + xx; if (near[i]) continue; total += 1; if ((best.coverage[yy * WIN + xx] >= 0.5) === (U[i] >= 0.5)) agree += 1; } // eslint-disable-line no-continue
      windows += 1;
      if (agree / total < 0.97 || best.score < 0.85) { console.log(name, 'window rejected', x, y, (agree / total).toFixed(3), best.score.toFixed(3)); continue; } // eslint-disable-line no-continue
      for (let yy = 0; yy < WIN; yy += 1) for (let xx = 0; xx < WIN; xx += 1) {
        const wgt = Math.min(xx + 1, WIN - xx, yy + 1, WIN - yy) / (WIN / 2); // tent: favour window centres
        const i = (y + yy) * W + x + xx;
        acc[i] += wgt * best.coverage[yy * WIN + xx]; wsum[i] += wgt;
      }
    }
  }
  const ref = Buffer.alloc(W * H); const cover = Buffer.alloc(W * H);
  for (let i = 0; i < W * H; i += 1) { if (wsum[i] > 0) { ref[i] = acc[i] / wsum[i] >= 0.5 ? 255 : 0; cover[i] = 255; } else ref[i] = U[i] >= 0.5 ? 255 : 0; }
  await sharp(ref, { raw: { width: W, height: H, channels: 1 } }).png().toFile(path.join(dir, 'refs', `${name}.png`));
  await sharp(cover, { raw: { width: W, height: H, channels: 1 } }).png().toFile(path.join(dir, 'refs', `${name}.cover.png`));
  console.log(name, 'windows', windows, 's', ((Date.now() - t0) / 1000).toFixed(0));
}
