// Recover Detail benchmark (Interval 24.3), on synthetic scenes from synth.mjs (exact alpha):
// the antenna, wing and its two struts that the 1024 px selection misses, recovered by
//   24.2       the refined selection alone;
//   add brush  the same strokes painted with the Add brush (everything under them);
//   guided     Recover Detail on those strokes (segment/recover.mjs, through refineSelection);
//   automatic  the same detection over the whole outline band, no strokes (rejected).
// Scores in the strokes and the band: share of the missing structure recovered, pixels wrongly
// added, background coverage added (halo), mean |error|; time and working memory.
// Usage: node --expose-gc --max-old-space-size=12000 scripts/refine-bench/recover.mjs <dir> scene …
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { decodeCodes } from '../../src/editor/segment/analysis.mjs';
import { refineSelection, tileMapCode } from '../../src/editor/segment/refine.mjs';
import { recoverWindow, strokeRegion } from '../../src/editor/segment/recover.mjs';
import { contourBand } from './maps.mjs';

const [dir, ...scenes] = process.argv.slice(2);
// Strokes as a user paints them: along each part, a little wider than it (synth.mjs geometry).
const STROKES = [
  { part: 'antenna', points: [[4205, 1790], [4275, 1500], [4345, 1210]], r: 16 },
  { part: 'strut', points: [[4805, 1885], [4805, 2175]], r: 14 },
  { part: 'strut', points: [[5055, 1905], [5055, 2215]], r: 14 },
  { part: 'wing', points: [[4665, 1885], [5285, 1862]], r: 48 },
];
const CROP = { x0: 3900, y0: 1050, w: 1600, h: 1250 };
const mb = (b) => Math.round(b / 2 ** 20);
const rows = [];
for (const scene of scenes) {
  const { data, info } = await sharp(path.join(dir, 'synth', `${scene}.png`)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width; const H = info.height;
  const gtFull = await sharp(path.join(dir, 'synth', `${scene}.alpha.png`)).extractChannel(0).raw().toBuffer();
  const c = JSON.parse(readFileSync(path.join(dir, 'coarse', `${scene}.json`), 'utf8'));
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i += 1) rgba.set([data[i * 3], data[i * 3 + 1], data[i * 3 + 2], 255], i * 4);
  const guide = { width: W, height: H, data: rgba };
  const grid = { width: c.width, height: c.height, codes: decodeCodes(c.data, c.width * c.height) };
  const recover = STROKES.map((s) => ({ radius: s.r / Math.min(W, H), points: s.points.map(([x, y]) => [x / W, y / H, 1]) }));
  refineSelection(grid, guide); // warm-up, so the timings below compare like with like
  let t = performance.now();
  const refined = refineSelection(grid, guide);
  const refineMs = performance.now() - t;
  global.gc?.();
  const before = process.memoryUsage();
  let peak = 0;
  t = performance.now();
  const guided = refineSelection(grid, guide, { recover }, { onProgress: () => { const m = process.memoryUsage(); peak = Math.max(peak, m.heapUsed + m.arrayBuffers - before.heapUsed - before.arrayBuffers); } });
  const guidedMs = performance.now() - t - refineMs;
  const { x0, y0, w, h } = CROP; const n = w * h;
  const at = (map) => Float32Array.from({ length: n }, (_, i) => tileMapCode(map, x0 + (i % w), y0 + Math.floor(i / w)) / 255);
  const base = at(refined); const withStrokes = at(guided);
  const gt = Float32Array.from({ length: n }, (_, i) => gtFull[(y0 + Math.floor(i / w)) * W + x0 + (i % w)] / 255);
  const region = new Uint8Array(n);
  for (const s of STROKES) {
    const r = strokeRegion({ r: s.r, points: s.points }, x0, y0, w, h).region;
    for (let i = 0; i < n; i += 1) if (r[i]) region[i] = 1;
  }
  const addBrush = Float32Array.from(base, (v, i) => (region[i] ? 1 : v));
  // Automatic: the band within 18 px of the outline, outside the selection, as one "stroke".
  const band = contourBand(base, w, h, 18);
  const rgb = [0, 1, 2].map((k) => Float32Array.from({ length: n }, (_, i) => data[((y0 + Math.floor(i / w)) * W + x0 + (i % w)) * 3 + k] / 255));
  t = performance.now();
  const auto = recoverWindow(base, rgb, w, h, Uint8Array.from(band, (v, i) => (v && base[i] < 0.5 ? 1 : 0)), Infinity).coverage;
  const autoMs = performance.now() - t;
  const zone = Uint8Array.from(region, (v, i) => (v || band[i] ? 1 : 0));
  for (const [cand, a, ms] of [['24.2', base, refineMs], ['add brush', addBrush, 0], ['guided', withStrokes, guidedMs], ['automatic', auto, autoMs]]) {
    let missing = 0; let found = 0; let falsePx = 0; let halo = 0; let sad = 0; let zn = 0;
    for (let i = 0; i < n; i += 1) {
      if (!zone[i]) continue; // eslint-disable-line no-continue
      zn += 1; sad += Math.abs(a[i] - gt[i]);
      if (gt[i] >= 0.5 && base[i] < 0.5) { missing += 1; if (a[i] >= 0.5) found += 1; }
      if (gt[i] < 0.5 && base[i] < 0.5 && a[i] >= 0.5) falsePx += 1;
      if (gt[i] < 0.02 && a[i] > base[i]) halo += a[i] - base[i];
    }
    const row = { scene, cand, recall: +(found / missing).toFixed(3), falsePx, halo: Math.round(halo), sad: +(sad / zn).toFixed(4), ms: Math.round(ms) };
    if (cand === 'guided') Object.assign(row, { perStroke: guided.recovered.map((r) => r.added), workingMb: mb(peak) });
    rows.push(row);
    console.log(JSON.stringify(row));
  }
}
writeFileSync(path.join(dir, 'recover.json'), JSON.stringify(rows, null, 1));
