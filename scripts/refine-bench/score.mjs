// Edge refinement benchmark (Interval 24.2): the stored grid as Interval 24.1 renders it (bilinear)
// against the refined map (segment/refine.mjs), both at the image's full resolution, scored
// against exact alpha (synthetic scenes from synth.mjs) or reviewed references (refs.mjs).
// Images and results stay outside the repository.
// Usage: node --max-old-space-size=16000 scripts/refine-bench/score.mjs <dir> <originalsDir> name …
//   <dir>/synth/<name>.png + .alpha.png (synthetic) or <originalsDir>/<name>.JPG + <dir>/refs/<name>.png;
//   coarse grids in <dir>/coarse/<name>.json; RADIUS=0–1; CROPS=1 writes <dir>/crops/<name>.png
//   (image | grid | refined over blue, where they differ most); results in <dir>/score.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { decodeCodes } from '../../src/editor/segment/analysis.mjs';
import { refineSelection, tileMapBytes, tileMapCode } from '../../src/editor/segment/refine.mjs';
import { contourBand, scores, upsample } from './maps.mjs';

const [dir, originals, ...names] = process.argv.slice(2);
const radius = Number(process.env.RADIUS ?? 0);
const rows = [];
const r3 = (v) => (v === null ? null : Math.round(v * 1000) / 1000);
let peakRss = 0;
const sample = () => { peakRss = Math.max(peakRss, process.memoryUsage().rss); };

async function crops(name, img, W, x0, y0, w, h, a, b) {
  const cw = 240; const ch = 180; const found = [];
  for (let y = 0; y + ch <= h; y += ch / 2) for (let x = 0; x + cw <= w; x += cw / 2) {
    let d = 0;
    for (let yy = y; yy < y + ch; yy += 3) for (let xx = x; xx < x + cw; xx += 3) d += Math.abs(a[yy * w + xx] - b[yy * w + xx]);
    found.push({ x, y, d });
  }
  found.sort((p, q) => q.d - p.d);
  const picked = [];
  for (const f of found) if (picked.length < 4 && !picked.some((p) => Math.abs(p.x - f.x) < cw && Math.abs(p.y - f.y) < ch)) picked.push(f);
  const tiles = [];
  for (const [r, p] of picked.entries()) {
    for (const [col, m] of [null, a, b].entries()) {
      const o = Buffer.alloc(cw * ch * 3);
      for (let yy = 0; yy < ch; yy += 1) for (let xx = 0; xx < cw; xx += 1) {
        const s = ((y0 + p.y + yy) * W + x0 + p.x + xx) * 3; const al = m ? m[(p.y + yy) * w + p.x + xx] : 1; const bg = [30, 110, 230];
        for (let k = 0; k < 3; k += 1) o[(yy * cw + xx) * 3 + k] = img[s + k] * al + bg[k] * (1 - al);
      }
      tiles.push({ input: await sharp(o, { raw: { width: cw, height: ch, channels: 3 } }).png().toBuffer(), left: col * (cw + 4), top: r * (ch + 4) });
    }
  }
  mkdirSync(path.join(dir, 'crops'), { recursive: true });
  await sharp({ create: { width: 3 * (cw + 4), height: picked.length * (ch + 4), channels: 3, background: '#f0f' } }).composite(tiles).png().toFile(path.join(dir, 'crops', `${name}.png`));
}

for (const name of names) {
  const synthetic = existsSync(path.join(dir, 'synth', `${name.replace(/-gt$/, '')}.png`));
  const base = name.replace(/-gt$/, '');
  const file = synthetic ? path.join(dir, 'synth', `${base}.png`) : path.join(originals, `${name}.JPG`);
  const { data: img, info } = await sharp(file).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width; const H = info.height;
  const refFile = synthetic ? path.join(dir, 'synth', `${base}.alpha.png`) : path.join(dir, 'refs', `${name}.png`);
  const gtFull = Float32Array.from(await sharp(refFile).extractChannel(0).raw().toBuffer(), (v) => v / 255);
  const cover = !synthetic && existsSync(path.join(dir, 'refs', `${name}.cover.png`)) ? await sharp(path.join(dir, 'refs', `${name}.cover.png`)).extractChannel(0).raw().toBuffer() : null;
  const coarse = JSON.parse(readFileSync(path.join(dir, 'coarse', `${name}.json`), 'utf8'));
  const grid = { width: coarse.width, height: coarse.height, codes: decodeCodes(coarse.data, coarse.width * coarse.height) };
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i += 1) { rgba[i * 4] = img[i * 3]; rgba[i * 4 + 1] = img[i * 3 + 1]; rgba[i * 4 + 2] = img[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
  sample();
  const t0 = performance.now();
  const map = refineSelection(grid, { width: W, height: H, data: rgba }, { radius });
  const ms = performance.now() - t0;
  sample();
  // Scored over the bounding box of everything soft (in the grid or the reference), with a margin.
  const U = upsample(grid, W, H);
  let x0 = W; let y0 = H; let x1 = 0; let y1 = 0;
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) { const i = y * W + x; if ((U[i] > 0.01 && U[i] < 0.99) || (gtFull[i] > 0.01 && gtFull[i] < 0.99)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }
  const s = W / coarse.width; const m = Math.round(8 * s);
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(W, x1 + m); y1 = Math.min(H, y1 + m);
  const w = x1 - x0; const h = y1 - y0;
  const cut = (arr) => { const o = new Float32Array(w * h); for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) o[y * w + x] = arr(x0 + x, y0 + y); return o; };
  const before = cut((x, y) => U[y * W + x]);
  const after = cut((x, y) => tileMapCode(map, x, y) / 255);
  const gt = cut((x, y) => gtFull[y * W + x]);
  const zone = contourBand(before, w, h, Math.round(2 * s));
  if (cover) for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) if (!cover[(y0 + y) * W + x0 + x]) zone[y * w + x] = 0;
  for (const [cand, a] of [['grid (24.1)', before], ['refined', after]]) {
    const row = { name, kind: synthetic ? 'synthetic' : 'photo', cand, ...Object.fromEntries(Object.entries(scores(a, gt, w, h, zone)).map(([k, v]) => [k, r3(v)])) };
    if (cand === 'refined') Object.assign(row, { ms: Math.round(ms), mapKb: Math.round(tileMapBytes(map) / 1024), refinedAt: `${W}×${H}` });
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  if (process.env.CROPS) await crops(name, img, W, x0, y0, w, h, before, after);
}
console.log(`peak RSS ${Math.round(peakRss / 2 ** 20)} MB`);
writeFileSync(path.join(dir, 'score.json'), JSON.stringify({ radius, rows, peakRssMb: Math.round(peakRss / 2 ** 20) }, null, 1));
