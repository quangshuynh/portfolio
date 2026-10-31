// Deterministic quality and speed benchmark for the Remove brush (pipeline/inpaint.mjs): runs a
// baseline revision and the working tree on the same scenes and reports quality metrics against
// the known clean picture, plus 24 MP fill time and additional memory.
//
//   node scripts/bench-remove.mjs [--baseline <git ref>] [--out <dir>] [--only <names>] [--no-timing]
//
// Scenes: synthetic ones (exact truth) and crops of published portfolio photos with an object
// painted over them (the photo is the truth). `regression` scenes are the cases Remove already
// handled well and must not get worse; `hard` scenes are large objects on structure and texture.
// Writes report.json and side-by-side PNGs (with object | baseline | candidate | truth) to --out
// (default: a temporary folder). Never committed: outputs only.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const SEEDS = Number(option('--seeds', 3));

// ---- algorithms: the baseline revision's retouch + inpaint, and the working tree's -------------

async function loadAlgorithm(ref) {
  if (!ref) return import(pathToFileURL(path.join(root, 'src/editor/pipeline/retouch.mjs')).href);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bench-remove-'));
  for (const file of ['retouch.mjs', 'inpaint.mjs']) {
    writeFileSync(path.join(dir, file), execFileSync('git', ['show', `${ref}:src/editor/pipeline/${file}`], { cwd: root }));
  }
  return import(pathToFileURL(path.join(dir, 'retouch.mjs')).href);
}

// ---- scenes ------------------------------------------------------------------------------------

const hash = (x, y, s = 0) => { let h = Math.imul(x * 374761393 + y * 668265263 + s * 2147483647, 1274126177); h ^= h >>> 13; h = Math.imul(h, 1103515245); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const noise = (x, y, s) => hash(Math.floor(x), Math.floor(y), s) - 0.5;
function synth(width, height, fn) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const [r, g, b] = fn(x, y, width, height);
    const i = (y * width + x) * 4;
    data[i] = Math.round(r * 255); data[i + 1] = Math.round(g * 255); data[i + 2] = Math.round(b * 255); data[i + 3] = 255;
  }
  return { width, height, data };
}
const pictures = {
  sky: (x, y, w, h) => { const v = 0.45 + 0.4 * (y / h); return [v * 0.7, v * 0.85, v]; },
  wall: (x, y) => { const n = 0.03 * noise(x, y, 1) + 0.02 * noise(x / 6, y / 6, 2); return [0.72 + n, 0.68 + n, 0.6 + n]; },
  stripes: (x) => { const v = Math.floor(x / 6) % 2 ? 0.75 : 0.3; return [v, v, v * 0.9]; },
  grass: (x, y) => { const n = 0.06 * Math.sin(x * 1.31 + Math.sin(y * 0.7) * 3) + 0.05 * Math.cos(y * 2.17 + x * 0.3); return [0.25 + n, 0.5 + n, 0.2 + n]; },
  brick: (x, y) => {
    const row = Math.floor(y / 12); const shift = row % 2 ? 13 : 0; const col = Math.floor((x + shift) / 26);
    const mortar = y % 12 < 2 || (x + shift) % 26 < 2;
    const n = 0.04 * noise(x, y, 3);
    if (mortar) return [0.78 + n, 0.76 + n, 0.72 + n];
    const t = 0.12 * (hash(col, row, 4) - 0.5);
    return [0.62 + t + n, 0.3 + t * 0.6 + n, 0.24 + t * 0.5 + n];
  },
  fence: (x, y, w, h) => {
    const n = 0.03 * noise(x, y, 5);
    const post = x % 34 < 7; const rail = Math.abs(y - h * 0.35) < 4 || Math.abs(y - h * 0.7) < 4;
    if (post || rail) return [0.55 + n, 0.42 + n, 0.3 + n];
    const g = 0.35 + 0.25 * (y / h) + 0.06 * noise(x / 3, y / 3, 6);
    return [g * 0.5 + n, g + n, g * 0.45 + n];
  },
  road: (x, y, w, h) => {
    const n = 0.05 * noise(x, y, 7) + 0.03 * noise(x / 4, y / 4, 8);
    const kerb = y > h * 0.78 + (x - w / 2) * 0.12;
    if (kerb) return [0.62 + n, 0.6 + n, 0.56 + n];
    const line = Math.abs(y - (h * 0.45 - (x - w / 2) * 0.08)) < 3 && Math.floor(x / 40) % 2 === 0;
    if (line) return [0.9 + n * 0.3, 0.88 + n * 0.3, 0.8 + n * 0.3];
    return [0.3 + n, 0.31 + n, 0.33 + n];
  },
};

// Real photographs: a crop of a published derivative, scaled down by `scale`.
const photo = (file, x, y, width, height, scale = 1) => ({ file, x, y, width, height, scale });

// Object shapes in pixels: disks and strokes (the brush covers them with room to spare).
const disk = (cx, cy, r) => (x, y) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r;
const capsule = (ax, ay, bx, by, r) => (x, y) => {
  const px = x + 0.5 - ax; const py = y + 0.5 - ay; const dx = bx - ax; const dy = by - ay;
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - t * dx, py - t * dy) <= r;
};
const any = (...shapes) => (x, y) => shapes.some((s) => s(x, y));

// Each scene: picture or photo, object shape, brush points (pixels), brush radius (pixels).
const SCENES = [
  { name: 'sky-small', group: 'regression', picture: 'sky', size: [200, 140], object: disk(100, 70, 12), points: [[100, 70]], radius: 17 },
  { name: 'wire', group: 'regression', picture: 'sky', size: [240, 120], object: capsule(0, 40, 240, 76, 1.2), points: [[4, 40.6], [236, 75.4]], radius: 3.6, spacing: 0.2 },
  { name: 'wall-medium', group: 'regression', picture: 'wall', size: [220, 160], object: disk(110, 80, 20), points: [[110, 80]], radius: 26 },
  { name: 'stripes', group: 'regression', picture: 'stripes', size: [200, 140], object: disk(100, 70, 14), points: [[100, 70]], radius: 18 },
  { name: 'grass-medium', group: 'regression', picture: 'grass', size: [220, 160], object: disk(110, 80, 16), points: [[110, 80]], radius: 19 },
  { name: 'brick-small', group: 'regression', picture: 'brick', size: [220, 160], object: disk(110, 80, 9), points: [[110, 80]], radius: 13 },
  { name: 'edge-grass', group: 'regression', picture: 'grass', size: [200, 140], object: disk(3, 70, 12), points: [[3, 70]], radius: 15.4 },
  { name: 'photo-grass-small', group: 'regression', photo: photo('DIBS2164', 300, 1300, 640, 480, 2), object: disk(160, 120, 10), points: [[160, 120]], radius: 14 },
  { name: 'photo-pavement-small', group: 'regression', photo: photo('DSC00006', 500, 900, 640, 480, 2), object: disk(160, 120, 11), points: [[160, 120]], radius: 15 },
  { name: 'brick-large', group: 'hard', picture: 'brick', size: [320, 240], object: disk(160, 120, 38), points: [[160, 120]], radius: 44 },
  { name: 'fence-large', group: 'hard', picture: 'fence', size: [320, 240], object: any(disk(150, 120, 28), capsule(150, 120, 200, 150, 22)), points: [[150, 120], [175, 135], [200, 150]], radius: 34 },
  { name: 'road-large', group: 'hard', picture: 'road', size: [320, 240], object: any(disk(150, 115, 30), capsule(130, 100, 190, 125, 24)), points: [[130, 100], [160, 112], [190, 125]], radius: 36 },
  { name: 'photo-brick-large', group: 'hard', photo: photo('DSC09579', 200, 700, 640, 480, 2), object: disk(160, 120, 34), points: [[160, 120]], radius: 40 },
  { name: 'photo-road-large', group: 'hard', photo: photo('DSC09696', 700, 900, 640, 480, 2), object: any(disk(150, 120, 30), capsule(120, 110, 200, 130, 24)), points: [[120, 110], [160, 120], [200, 130]], radius: 36 },
  { name: 'photo-boardwalk-large', group: 'hard', photo: photo('DSC09893', 280, 1050, 640, 480, 2), object: disk(160, 130, 32), points: [[160, 130]], radius: 38 },
  { name: 'photo-foliage-large', group: 'hard', photo: photo('DSC09673', 800, 400, 640, 480, 2), object: any(disk(160, 120, 30), capsule(160, 120, 210, 90, 24)), points: [[160, 120], [185, 105], [210, 90]], radius: 36 },
  { name: 'photo-rails-large', group: 'hard', photo: photo('DSC09912', 300, 1200, 640, 480, 2), object: disk(160, 120, 32), points: [[160, 120]], radius: 38 },
];

async function cleanImage(scene) {
  if (scene.picture) return synth(scene.size[0], scene.size[1], pictures[scene.picture]);
  const p = scene.photo;
  const file = path.join(root, 'src/assets/photography/generated', `${p.file}-viewer.jpg`);
  const width = Math.round(p.width / p.scale); const height = Math.round(p.height / p.scale);
  const { data } = await sharp(file).extract({ left: p.x, top: p.y, width: p.width, height: p.height }).resize(width, height, { kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width, height, data: new Uint8ClampedArray(data) };
}

// A saturated magenta object with a little texture: easy to detect if any of it leaks back.
function withObject(clean, shape) {
  const image = { ...clean, data: clean.data.slice() };
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
    if (!shape(x, y)) continue; // eslint-disable-line no-continue
    const i = (y * image.width + x) * 4; const t = 30 * hash(x, y, 9);
    image.data[i] = 230 - t; image.data[i + 1] = 20 + t * 0.3; image.data[i + 2] = 190 - t;
  }
  return image;
}

function operation(scene, image, seed = 0) {
  const short = Math.min(image.width, image.height);
  return {
    id: `bench-${scene.name}${seed ? `-${seed}` : ''}`, type: 'remove', enabled: true, hardness: 0.6, opacity: 1, spacing: scene.spacing ?? 0.25,
    offset: { x: 0, y: 0 }, radius: scene.radius / short, points: scene.points.map(([x, y]) => [x / image.width, y / image.height]),
  };
}

// ---- metrics -----------------------------------------------------------------------------------

const lum = (img, x, y) => { const i = (Math.min(img.height - 1, Math.max(0, y)) * img.width + Math.min(img.width - 1, Math.max(0, x))) * 4; return 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2]; };
const grad = (img, x, y) => [(lum(img, x + 1, y) - lum(img, x - 1, y)) / 2, (lum(img, x, y + 1) - lum(img, x, y - 1)) / 2];
function boxBlur(img, r) {
  const { width, height } = img; const out = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    let n = 0; const s = [0, 0, 0];
    for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) {
      const nx = x + dx; const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue; // eslint-disable-line no-continue
      const i = (ny * width + nx) * 4; s[0] += img.data[i]; s[1] += img.data[i + 1]; s[2] += img.data[i + 2]; n += 1;
    }
    out.set([s[0] / n, s[1] / n, s[2] / n], (y * width + x) * 3);
  }
  return out;
}
// Fraction of 8×8 blocks inside the region with a near-identical twin elsewhere in it (repeated patches).
function repetition(img, region) {
  const B = 8; const blocks = [];
  for (let y = 0; y + B <= img.height; y += 4) for (let x = 0; x + B <= img.width; x += 4) {
    let inside = true;
    for (let dy = 0; dy < B && inside; dy += 1) for (let dx = 0; dx < B; dx += 1) if (!region[(y + dy) * img.width + x + dx]) { inside = false; break; }
    if (!inside) continue; // eslint-disable-line no-continue
    const v = new Float32Array(B * B); let mean = 0;
    for (let dy = 0; dy < B; dy += 1) for (let dx = 0; dx < B; dx += 1) { v[dy * B + dx] = lum(img, x + dx, y + dy); mean += v[dy * B + dx]; }
    mean /= B * B; let variance = 0;
    for (let k = 0; k < v.length; k += 1) { v[k] -= mean; variance += v[k] * v[k]; }
    blocks.push({ x, y, v, variance: variance / v.length });
  }
  if (blocks.length < 2) return 0;
  let twins = 0;
  for (const a of blocks) {
    if (a.variance < 9) continue; // eslint-disable-line no-continue
    for (const b of blocks) {
      if (Math.abs(a.x - b.x) < B && Math.abs(a.y - b.y) < B) continue; // eslint-disable-line no-continue
      let ssd = 0; for (let k = 0; k < a.v.length; k += 1) { const d = a.v[k] - b.v[k]; ssd += d * d; }
      if (ssd / a.v.length < 0.08 * a.variance + 2) { twins += 1; break; }
    }
  }
  return twins / blocks.length;
}

function measure(result, clean, object, region) {
  const { width, height } = clean;
  let n = 0; let mae = 0; let structNum = 0; let structDen = 0; let gr = 0; let gt = 0; let leak = 0; let leakN = 0;
  const blurR = boxBlur(result, 4); const blurT = boxBlur(clean, 4); let low = 0;
  // Seam: the smoothed colour error on a 4 px band just inside the changed region, next to
  // untouched pixels, i.e. the step a viewer sees at the edge of the fill.
  const blurE = boxBlur(result, 2); const blurC = boxBlur(clean, 2);
  let seamN = 0; let seam = 0;
  const objectness = (d, i) => Math.max(0, Math.min(d[i] - d[i + 1], d[i + 2] - d[i + 1]));
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const p = y * width + x; const i = p * 4;
    if (!region[p]) continue; // eslint-disable-line no-continue
    let band = false;
    for (let dy = -4; dy <= 4 && !band; dy += 1) for (let dx = -4; dx <= 4; dx += 1) {
      const nx = x + dx; const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height && !region[ny * width + nx]) { band = true; break; }
    }
    if (band) { for (let k = 0; k < 3; k += 1) seam += Math.abs(blurE[p * 3 + k] - blurC[p * 3 + k]) / 3; seamN += 1; }
    n += 1;
    for (let k = 0; k < 3; k += 1) { mae += Math.abs(result.data[i + k] - clean.data[i + k]) / 3; low += Math.abs(blurR[p * 3 + k] - blurT[p * 3 + k]) / 3; }
    const [rx, ry] = grad(result, x, y); const [tx, ty] = grad(clean, x, y);
    const tm = Math.hypot(tx, ty);
    gr += Math.hypot(rx, ry); gt += tm;
    if (tm > 4) { structNum += Math.min(tm, Math.max(0, (rx * tx + ry * ty) / tm)); structDen += tm; }
    if (object(x, y)) { leak += Math.max(0, objectness(result.data, i) - objectness(clean.data, i)); leakN += 1; }
  }
  return {
    colorError: +(mae / n).toFixed(2),
    colorConsistency: +(low / n).toFixed(2),
    structure: structDen ? +(structNum / structDen).toFixed(3) : null,
    sharpness: gt ? +(gr / gt).toFixed(3) : null,
    seam: seamN ? +(seam / seamN).toFixed(2) : 0,
    repetition: +(repetition(result, region) - repetition(clean, region)).toFixed(3),
    leak: +(leak / Math.max(1, leakN)).toFixed(2),
  };
}

// ---- run ---------------------------------------------------------------------------------------

async function sidebyside(file, images, box) {
  const scale = Math.max(1, Math.floor(260 / Math.max(box.w, box.h)));
  const tiles = await Promise.all(images.map((img) => sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), { raw: { width: img.width, height: img.height, channels: 4 } })
    .extract({ left: box.x, top: box.y, width: box.w, height: box.h }).resize(box.w * scale, box.h * scale, { kernel: 'nearest' }).png().toBuffer()));
  const w = box.w * scale; const h = box.h * scale;
  await sharp({ create: { width: tiles.length * (w + 4), height: h, channels: 3, background: '#000' } })
    .composite(tiles.map((input, i) => ({ input, left: i * (w + 4), top: 0 }))).png().toFile(file);
}

async function quality(baseline, candidate, out) {
  const only = option('--only')?.split(',');
  const rows = [];
  for (const scene of SCENES.filter((s) => !only || only.includes(s.name))) {
    const clean = await cleanImage(scene);
    const dirty = withObject(clean, scene.object);
    const row = { name: scene.name, group: scene.group };
    let outputs = null;
    // Several seeds (operation ids) per scene, so a change is not judged on one lucky fill; both
    // algorithms are measured on the same region: everything either changed, plus the object.
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const op = operation(scene, dirty, seed);
      const runs = [baseline, candidate].map((algorithm) => {
        const image = { ...dirty, data: dirty.data.slice() };
        const started = performance.now();
        algorithm.applyRetouchOperation(image, op);
        return { image, ms: performance.now() - started };
      });
      const region = new Uint8Array(clean.width * clean.height);
      for (let p = 0; p < region.length; p += 1) {
        const changed = runs.some(({ image }) => image.data[p * 4] !== dirty.data[p * 4] || image.data[p * 4 + 1] !== dirty.data[p * 4 + 1] || image.data[p * 4 + 2] !== dirty.data[p * 4 + 2]);
        if (changed || scene.object(p % clean.width, Math.floor(p / clean.width))) region[p] = 1;
      }
      ['baseline', 'candidate'].forEach((label, k) => {
        const metrics = { ...measure(runs[k].image, clean, scene.object, region), ms: runs[k].ms };
        row[label] ??= {};
        for (const [key, value] of Object.entries(metrics)) row[label][key] = (row[label][key] ?? 0) + (value ?? 0) / SEEDS;
      });
      outputs ??= runs.map((r) => r.image);
    }
    for (const label of ['baseline', 'candidate']) for (const key of Object.keys(row[label])) row[label][key] = +row[label][key].toFixed(key === 'ms' ? 0 : 3);
    rows.push(row);
    if (out) {
      const [x0, y0, x1, y1] = scene.points.reduce(([a, b, c, d], [x, y]) => [Math.min(a, x), Math.min(b, y), Math.max(c, x), Math.max(d, y)], [Infinity, Infinity, -Infinity, -Infinity]);
      const m = scene.radius * 1.8;
      const bx = Math.max(0, Math.floor(x0 - m)); const by = Math.max(0, Math.floor(y0 - m));
      const box = { x: bx, y: by, w: Math.min(clean.width, Math.ceil(x1 + m)) - bx, h: Math.min(clean.height, Math.ceil(y1 + m)) - by };
      await sidebyside(path.join(out, `${scene.name}.png`), [dirty, ...outputs, clean], box);
    }
    const b = row.baseline; const c = row.candidate;
    console.log(`${scene.name.padEnd(22)} ${scene.group.padEnd(10)} err ${b.colorError}→${c.colorError}  low ${b.colorConsistency}→${c.colorConsistency}  struct ${b.structure}→${c.structure}  sharp ${b.sharpness}→${c.sharpness}  seam ${b.seam}→${c.seam}  rep ${b.repetition}→${c.repetition}  leak ${b.leak}→${c.leak}  ms ${b.ms}→${c.ms}`);
  }
  for (const group of ['regression', 'hard']) {
    const members = rows.filter((r) => r.group === group);
    if (!members.length) continue; // eslint-disable-line no-continue
    const mean = (label, key) => +(members.reduce((sum, r) => sum + (r[label][key] ?? 0), 0) / members.length).toFixed(3);
    const keys = ['colorError', 'colorConsistency', 'structure', 'sharpness', 'seam', 'repetition', 'leak', 'ms'];
    console.log(`mean ${group}: ${keys.map((k) => `${k} ${mean('baseline', k)}→${mean('candidate', k)}`).join('  ')}`);
  }
  return rows;
}

// 24 MP timing and memory, each measurement in its own process (peak RSS above the loaded photo).
async function timing(ref) {
  const raw = path.join(os.tmpdir(), 'bench-remove-24mp.rgba');
  const file = path.join(root, 'src/assets/photography/generated/DSC09696-viewer.jpg');
  const { data } = await sharp(file).resize(6000, 4000, { fit: 'fill', kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  writeFileSync(raw, data);
  const rows = [];
  for (const radius of [40, 120, 240]) {
    const row = { radius };
    for (const [label, which] of [['baseline', ref], ['candidate', '']]) {
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', which, raw, String(radius)], { cwd: root, encoding: 'utf8' });
      if (child.status !== 0) throw new Error(child.stderr);
      row[label] = JSON.parse(child.stdout.trim().split('\n').at(-1));
    }
    rows.push(row);
    console.log(`24 MP radius ${radius}px: ${row.baseline.seconds}s / +${row.baseline.extraMB} MB → ${row.candidate.seconds}s / +${row.candidate.extraMB} MB`);
  }
  return rows;
}

async function child([ref, raw, radius]) {
  const algorithm = await loadAlgorithm(ref || null);
  const image = { width: 6000, height: 4000, data: new Uint8ClampedArray(readFileSync(raw)) };
  const r = Number(radius);
  const op = { id: 'bench-24mp', type: 'remove', enabled: true, hardness: 0.6, opacity: 1, spacing: 0.25, offset: { x: 0, y: 0 }, radius: r / 4000, points: [[0.5, 0.55]] };
  const before = process.memoryUsage().rss;
  const started = performance.now();
  algorithm.applyRetouchOperation(image, op);
  const seconds = (performance.now() - started) / 1000;
  const peak = process.resourceUsage().maxRSS * 1024;
  console.log(JSON.stringify({ seconds: +seconds.toFixed(2), extraMB: Math.max(0, Math.round((peak - before) / 2 ** 20)) }));
}

if (args[0] === '--child') await child(args.slice(1));
else {
  const ref = option('--baseline', '298dcf0');
  const out = option('--out') ?? mkdtempSync(path.join(os.tmpdir(), 'bench-remove-report-'));
  mkdirSync(out, { recursive: true });
  const [baseline, candidate] = [await loadAlgorithm(ref), await loadAlgorithm(null)];
  const report = { baseline: ref, quality: await quality(baseline, candidate, out) };
  if (!args.includes('--no-timing')) report.timing = await timing(ref);
  writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report and side-by-side images: ${out}`);
}
