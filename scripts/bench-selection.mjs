// Quality and speed of intelligent selections on real photographs, with the editor's own code
// (segment/segmenter.mjs) and models on onnxruntime-web's WebAssembly backend, one thread, as in
// the browser. Photos are decoded with sharp and reduced to the analysis size (as the editor's
// developed preview is). Reports and overlays go to --out, never into the repository.
//
// Usage: node scripts/bench-selection.mjs --out <dir> [--refs <dir>] [--kinds sky,subject]
//          [--only id,id] [--extra <dir>] [--root <checkout>] [photo …]
//   Without photos: the benchmark in scripts/selection-benchmark.json (published photos; entries
//   marked local need --extra or SELECTION_BENCH_EXTRA, a folder of <id>.jpg kept off the repo).
//   --refs: reference masks from scripts/selection-references.mjs (<id>.<kind>.<n>.png); scores
//   IoU, precision, recall, boundary F (2 px), false-positive and false-negative regions, and how
//   well the warnings separate wrong from right selections.
//   --root: run another checkout's segmentation code (e.g. a worktree of main) for a baseline.
//   --object x,y (fractions): an Object tap per photo, in addition to the kinds.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import * as ort from 'onnxruntime-web/wasm';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(`--${name}`); return i < 0 ? null : args.splice(i, 2)[1]; };
const out = option('out');
const kinds = (option('kinds') ?? 'sky,subject').split(',').filter(Boolean);
const refs = option('refs');
const only = option('only')?.split(',');
const extra = option('extra') ?? process.env.SELECTION_BENCH_EXTRA;
const root = path.resolve(option('root') ?? here);
const objectTap = option('object')?.split(',').map(Number) ?? null;
if (!out) { console.error('Usage: node scripts/bench-selection.mjs --out <dir> [--refs <dir>] [--kinds sky,subject] [--only ids] [--extra <dir>] [--root <checkout>] [photo …]'); process.exit(2); }
mkdirSync(out, { recursive: true });
const load = (file) => import(pathToFileURL(path.join(root, 'src/editor/segment', file)).href);
const { analysisSize, decodeCodes, resizeMap, components } = await load('analysis.mjs');
const { MODELS } = await load('models.mjs');
const { createSegmenter } = await load('segmenter.mjs');
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = `${pathToFileURL(path.join(here, 'node_modules/onnxruntime-web/dist')).href}/`;

const segmenter = createSegmenter({
  ort,
  loadModel: async (name) => readFileSync(path.join(root, 'public', 'photography', 'editor-models', MODELS[name].file)),
  sessionOptions: { executionProviders: ['wasm'], graphOptimizationLevel: 'all' },
});
// Warning thresholds the panel uses (model/MaskPanel): a result below them is shown as doubtful.
const WARN = { sky: 0.7, subject: 0.6, background: 0.6, object: 0.6 };

/** The benchmark's photos: [{ id, file, expect: { kind: answers | 'none' | 'review' }, tags, known }]. */
function benchmarkPhotos(manifestFile = path.join(here, 'scripts/selection-benchmark.json'), extraDir = extra) {
  const { photos } = JSON.parse(readFileSync(manifestFile, 'utf8'));
  return photos.map((p) => ({
    ...p,
    file: p.local ? (extraDir ? path.join(extraDir, `${p.id}.jpg`) : null) : path.join(here, 'src/assets/photography/generated', `${p.id}-viewer.jpg`),
  }));
}

/** The photo as RGBA at analysis size. */
async function analysisImage(file) {
  const meta = await sharp(file).rotate().metadata();
  const [w, h] = (meta.orientation ?? 1) >= 5 ? [meta.height, meta.width] : [meta.width, meta.height];
  const size = analysisSize(w, h);
  const { data } = await sharp(file).rotate().resize(size.width, size.height, { kernel: 'cubic' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: size.width, height: size.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

/** Regions (8-connected) of at least 0.5 % of the photo where `a` is set and `b` is not. */
function regions(a, b, width, height) {
  const m = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i += 1) m[i] = a[i] && !b[i] ? 1 : 0;
  return components(m, width, height).stats.filter((s) => s && s.area >= 0.005 * a.length).length;
}

function scores(pred, ref, width, height) {
  let tp = 0; let fp = 0; let fn = 0;
  for (let i = 0; i < pred.length; i += 1) {
    if (pred[i] && ref[i]) tp += 1; else if (pred[i]) fp += 1; else if (ref[i]) fn += 1;
  }
  const edge = (m) => {
    const e = new Uint8Array(m.length);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const i = y * width + x;
        if (m[i] !== m[i - 1] || m[i] !== m[i + 1] || m[i] !== m[i - width] || m[i] !== m[i + width]) e[i] = 1;
      }
    }
    return e;
  };
  const near = (e, r) => {
    const o = new Uint8Array(e.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!e[y * width + x]) continue; // eslint-disable-line no-continue
        for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) { const yy = y + dy; const xx = x + dx; if (yy >= 0 && yy < height && xx >= 0 && xx < width) o[yy * width + xx] = 1; }
      }
    }
    return o;
  };
  const ea = edge(pred); const eb = edge(ref); const na = near(ea, 2); const nb = near(eb, 2);
  let ma = 0; let ca = 0; let mb = 0; let cb = 0;
  for (let i = 0; i < ea.length; i += 1) { if (ea[i]) { ca += 1; if (nb[i]) ma += 1; } if (eb[i]) { cb += 1; if (na[i]) mb += 1; } }
  const bp = ca ? ma / ca : 1; const br = cb ? mb / cb : 1;
  return {
    iou: tp + fp + fn ? tp / (tp + fp + fn) : 1,
    precision: tp + fp ? tp / (tp + fp) : 1,
    recall: tp + fn ? tp / (tp + fn) : 1,
    boundaryF: bp + br ? (2 * bp * br) / (bp + br) : 0,
    fpRegions: regions(pred, ref, width, height),
    fnRegions: regions(ref, pred, width, height),
  };
}

const round = (v) => Math.round(v * 1000) / 1000;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

async function main() {
  const listed = args.length ? args.map((file) => ({ id: path.basename(file).replace(/\.[^.]+$/, ''), file })) : benchmarkPhotos();
  const photos = listed.filter((p) => p.file && existsSync(p.file) && (!only || only.includes(p.id)));
  const skipped = listed.filter((p) => !photos.includes(p) && (!only || only.includes(p.id))).map((p) => p.id);
  if (skipped.length) console.log(`skipped (no file): ${skipped.join(', ')}`);
  const rows = [];
  let peak = 0;
  for (const photo of photos) {
    const image = await analysisImage(photo.file); // eslint-disable-line no-await-in-loop
    const { width, height } = image;
    const tasks = kinds.map((kind) => ({ kind }));
    if (objectTap) tasks.push({ kind: 'object', points: [[objectTap[0] * width, objectTap[1] * height, 1]] });
    for (const task of tasks) {
      const result = await segmenter.select({ ...task, image, imageKey: photo.id }); // eslint-disable-line no-await-in-loop
      peak = Math.max(peak, process.memoryUsage().rss);
      let codes = new Uint8Array(width * height);
      if (result.data) {
        const grid = decodeCodes(result.data, result.width * result.height);
        codes = result.width === width ? grid : Uint8Array.from(resizeMap(Float32Array.from(grid), result.width, result.height, width, height), (v) => Math.round(v));
      }
      const pred = Uint8Array.from(codes, (v) => (v >= 128 ? 1 : 0));
      const warned = !result.found || result.confidence < WARN[task.kind];
      const row = { photo: photo.id, kind: task.kind, tags: photo.tags ?? [], found: result.found, confidence: round(result.confidence), warned, warnings: result.warnings ?? [], area: round(result.area), ms: result.ms, encodedKb: result.data ? Math.round(result.data.length / 102.4) / 10 : 0 };
      const expect = photo[task.kind];
      if (expect === 'review' || expect === undefined) row.expect = 'review';
      else {
        const answers = expect === 'none' ? ['none'] : expect;
        row.expect = answers.includes('none') && answers.length === 1 ? 'none' : 'present';
        let best = null;
        for (let k = 0; k < answers.length; k += 1) {
          if (answers[k] === 'none') { if (!result.found || result.area < 0.002) best = { iou: 1, none: true }; continue; } // eslint-disable-line no-continue
          const refFile = refs && path.join(refs, `${photo.id}.${task.kind}.${k}.png`);
          if (!refFile || !existsSync(refFile)) continue; // eslint-disable-line no-continue
          const ref = await sharp(refFile).greyscale().resize(width, height, { kernel: 'nearest' }).raw().toBuffer(); // eslint-disable-line no-await-in-loop
          const s = scores(pred, Uint8Array.from(ref, (v) => (v >= 128 ? 1 : 0)), width, height);
          if (!best || s.iou > best.iou) best = { ...s, answer: k };
        }
        if (expect === 'none') {
          row.correct = !result.found || result.area < 0.002;
          row.leak = round(result.found ? result.area : 0);
        } else if (best) {
          Object.assign(row, Object.fromEntries(Object.entries(best).map(([k, v]) => [k, typeof v === 'number' ? round(v) : v])));
          row.correct = best.iou >= 0.75;
        }
      }
      rows.push(row);
      console.log(JSON.stringify(row));
      // Overlay: the selection tinted over the photo (inspection only).
      const tint = task.kind === 'sky' ? [255, 200, 0] : [40, 255, 60];
      const shown = Buffer.from(image.data);
      for (let i = 0; i < codes.length; i += 1) { const a = (codes[i] / 255) * 0.6; for (let c = 0; c < 3; c += 1) shown[i * 4 + c] = shown[i * 4 + c] * (1 - a) + tint[c] * a; }
      await sharp(shown, { raw: { width, height, channels: 4 } }).jpeg({ quality: 80 }).toFile(path.join(out, `${photo.id}.${task.kind}.jpg`)); // eslint-disable-line no-await-in-loop
    }
  }
  const summary = {};
  for (const kind of [...new Set(rows.map((r) => r.kind))]) {
    const r = rows.filter((x) => x.kind === kind);
    const judged = r.filter((x) => 'correct' in x);
    const scored = r.filter((x) => 'iou' in x && !x.none);
    const wrong = judged.filter((x) => !x.correct);
    const right = judged.filter((x) => x.correct);
    summary[kind] = {
      photos: r.length,
      found: r.filter((x) => x.found).length,
      judged: judged.length,
      correct: right.length,
      iouMean: round(mean(scored.map((x) => x.iou)) ?? 0),
      iouMedian: median(scored.map((x) => x.iou)),
      precisionMedian: median(scored.map((x) => x.precision)),
      recallMedian: median(scored.map((x) => x.recall)),
      boundaryFMedian: median(scored.map((x) => x.boundaryF)),
      fpRegions: scored.reduce((a, x) => a + x.fpRegions, 0) + judged.filter((x) => x.expect === 'none' && !x.correct).length,
      fnRegions: scored.reduce((a, x) => a + x.fnRegions, 0),
      // Warnings: share of wrong selections flagged (or not made), and of right ones flagged anyway.
      wrongFlagged: `${wrong.filter((x) => x.warned).length}/${wrong.length}`,
      rightFlagged: `${right.filter((x) => x.warned && x.found).length}/${right.filter((x) => x.found).length}`,
      msMedian: median(r.map((x) => x.ms)),
      msMax: Math.max(...r.map((x) => x.ms)),
      wrong: wrong.map((x) => `${x.photo}${x.iou !== undefined ? ` (${x.iou})` : ''}${x.warned ? ' flagged' : ''}`),
    };
  }
  summary.peakRssMb = Math.round(peak / 1e6);
  writeFileSync(path.join(out, 'report.json'), JSON.stringify({ root, rows, summary }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

await main();
