// Quality and speed of intelligent selections (Interval 23) on real photographs, with the
// editor's own code (segment/segmenter.mjs) and models on onnxruntime-web's WebAssembly backend,
// one thread, as in the browser. Photos are decoded with sharp and reduced to the analysis size
// (as the editor's developed preview is); nothing is written into the repository.
// Usage: node scripts/bench-selection.mjs --out <dir> [--kinds sky,subject] [--refs <dir>] photo.jpg …
//   --refs: reference masks named <photo>.<kind>.png (white = selected), e.g. visually verified
//   corrections; reports IoU, precision, recall, boundary F-score (2 px) and background leakage.
//   --object x,y (fractions): an Object tap per photo, in addition to the kinds.
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import * as ort from 'onnxruntime-web/wasm';
import { analysisSize, decodeCodes } from '../src/editor/segment/analysis.mjs';
import { MODELS } from '../src/editor/segment/models.mjs';
import { createSegmenter } from '../src/editor/segment/segmenter.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(`--${name}`); return i < 0 ? null : args.splice(i, 2)[1]; };
const out = option('out');
const kinds = (option('kinds') ?? 'sky,subject').split(',').filter(Boolean);
const refs = option('refs');
const objectTap = option('object')?.split(',').map(Number) ?? null;
if (!out || !args.length) { console.error('Usage: node scripts/bench-selection.mjs --out <dir> [--kinds sky,subject,object] [--refs <dir>] photo …'); process.exit(2); }
mkdirSync(out, { recursive: true });
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = `${pathToFileURL(path.join(root, 'node_modules/onnxruntime-web/dist')).href}/`;

const segmenter = createSegmenter({
  ort,
  loadModel: async (name) => readFileSync(path.join(root, 'public', 'photography', 'editor-models', MODELS[name].file)),
  sessionOptions: { executionProviders: ['wasm'], graphOptimizationLevel: 'all' },
});

function scores(codes, ref, width, height) {
  let tp = 0; let fp = 0; let fn = 0;
  for (let i = 0; i < codes.length; i += 1) {
    const a = codes[i] >= 128; const b = ref[i] >= 128;
    if (a && b) tp += 1; else if (a) fp += 1; else if (b) fn += 1;
  }
  const edge = (m) => {
    const e = new Uint8Array(m.length);
    for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x; const v = m[i] >= 128;
      if (v !== (m[i - 1] >= 128) || v !== (m[i + 1] >= 128) || v !== (m[i - width] >= 128) || v !== (m[i + width] >= 128)) e[i] = 1;
    }
    return e;
  };
  const near = (e, r) => { const o = new Uint8Array(e.length); for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (e[y * width + x]) for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) { const yy = y + dy; const xx = x + dx; if (yy >= 0 && yy < height && xx >= 0 && xx < width) o[yy * width + xx] = 1; } return o; };
  const ea = edge(codes); const eb = edge(ref); const na = near(ea, 2); const nb = near(eb, 2);
  let ma = 0; let ca = 0; let mb = 0; let cb = 0;
  for (let i = 0; i < ea.length; i += 1) { if (ea[i]) { ca += 1; if (nb[i]) ma += 1; } if (eb[i]) { cb += 1; if (na[i]) mb += 1; } }
  const bp = ca ? ma / ca : 1; const br = cb ? mb / cb : 1;
  const negatives = codes.length - (tp + fn);
  return { iou: tp / Math.max(1, tp + fp + fn), precision: tp / Math.max(1, tp + fp), recall: tp / Math.max(1, tp + fn), boundaryF: bp + br ? (2 * bp * br) / (bp + br) : 0, leakage: fp / Math.max(1, negatives) };
}

const rows = [];
for (const file of args) {
  const name = path.basename(file).replace(/\.[^.]+$/, '');
  const meta = await sharp(file).metadata();
  const size = analysisSize(meta.width, meta.height);
  const { data } = await sharp(file).rotate().resize(size.width, size.height, { kernel: 'cubic' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const image = { width: size.width, height: size.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
  const tasks = kinds.map((kind) => ({ kind }));
  if (objectTap) tasks.push({ kind: 'object', points: [[objectTap[0] * size.width, objectTap[1] * size.height, 1]] });
  for (const task of tasks.filter((t) => t.kind !== 'object' || t.points)) {
    const peak = process.memoryUsage().rss;
    const result = await segmenter.select({ ...task, image, imageKey: name });
    const codes = result.data ? decodeCodes(result.data, size.width * size.height) : new Uint8Array(size.width * size.height);
    const row = { photo: name, kind: task.kind, found: result.found, confidence: Math.round(result.confidence * 100) / 100, area: Math.round(result.area * 1000) / 1000, ms: result.ms, encodedKb: result.data ? Math.round(result.data.length / 102.4) / 10 : 0, rssMb: Math.round(Math.max(peak, process.memoryUsage().rss) / 1e6) };
    const refFile = refs && path.join(refs, `${name}.${task.kind}.png`);
    if (refFile && existsSync(refFile)) {
      const ref = await sharp(refFile).greyscale().resize(size.width, size.height, { kernel: 'nearest' }).raw().toBuffer();
      Object.assign(row, Object.fromEntries(Object.entries(scores(codes, ref, size.width, size.height)).map(([k, v]) => [k, Math.round(v * 1000) / 1000])));
    }
    rows.push(row);
    console.log(JSON.stringify(row));
    // Overlay: the selection tinted over the photo (inspection only, outside the repository).
    const tint = task.kind === 'sky' ? [255, 200, 0] : [40, 255, 60];
    const shown = Buffer.from(image.data);
    for (let i = 0; i < codes.length; i += 1) { const a = (codes[i] / 255) * 0.6; for (let c = 0; c < 3; c += 1) shown[i * 4 + c] = shown[i * 4 + c] * (1 - a) + tint[c] * a; }
    await sharp(shown, { raw: { width: size.width, height: size.height, channels: 4 } }).jpeg({ quality: 80 }).toFile(path.join(out, `${name}.${task.kind}.jpg`));
    await sharp(Buffer.from(codes), { raw: { width: size.width, height: size.height, channels: 1 } }).png().toFile(path.join(out, `${name}.${task.kind}.png`));
  }
}
const by = (kind) => rows.filter((r) => r.kind === kind);
for (const kind of [...new Set(rows.map((r) => r.kind))]) {
  const r = by(kind); const ms = r.map((x) => x.ms).sort((a, b) => a - b);
  const scored = r.filter((x) => 'iou' in x);
  console.log(`${kind}: ${r.length} photos, found ${r.filter((x) => x.found).length}, time p50 ${ms[Math.floor(ms.length / 2)]} ms max ${ms.at(-1)} ms${scored.length ? `, IoU median ${scored.map((x) => x.iou).sort((a, b) => a - b)[Math.floor(scored.length / 2)]} (n=${scored.length})` : ''}`);
}
