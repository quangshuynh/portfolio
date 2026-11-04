// Reference masks for the selection benchmark (Interval 23.1), from the prompts in
// scripts/selection-benchmark.json: SAM (MobileSAM, the editor's own decoder) outlines each
// answer from a box and points placed by hand, its parts are joined, and the edge is refined
// against the photo. Each mask is written with an overlay for visual review; a reference that
// does not look right is corrected by changing its prompts, never accepted as is. These are
// SAM-assisted references, not hand-painted ones: boundary scores against them favour SAM.
// Usage: node scripts/selection-references.mjs --out <dir> [--only id,id] [--extra <dir>]
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import * as ort from 'onnxruntime-web/wasm';
import { analysisSize, refineEdges } from '../src/editor/segment/analysis.mjs';
import { MODELS } from '../src/editor/segment/models.mjs';
import { createSegmenter } from '../src/editor/segment/segmenter.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(`--${name}`); return i < 0 ? null : args.splice(i, 2)[1]; };
const out = option('out');
const only = option('only')?.split(',');
const extra = option('extra') ?? process.env.SELECTION_BENCH_EXTRA;
if (!out) { console.error('Usage: node scripts/selection-references.mjs --out <dir> [--only ids] [--extra <dir>]'); process.exit(2); }
mkdirSync(out, { recursive: true });
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = `${pathToFileURL(path.join(root, 'node_modules/onnxruntime-web/dist')).href}/`;
const segmenter = createSegmenter({
  ort,
  loadModel: async (name) => readFileSync(path.join(root, 'public', 'photography', 'editor-models', MODELS[name].file)),
  sessionOptions: { executionProviders: ['wasm'], graphOptimizationLevel: 'all' },
});

const { photos } = JSON.parse(readFileSync(path.join(root, 'scripts/selection-benchmark.json'), 'utf8'));
for (const photo of photos.filter((p) => !only || only.includes(p.id))) {
  const file = photo.local ? extra && path.join(extra, `${photo.id}.jpg`) : path.join(root, 'src/assets/photography/generated', `${photo.id}-viewer.jpg`);
  if (!file || !existsSync(file)) { console.log(`${photo.id}: no file`); continue; } // eslint-disable-line no-continue
  const meta = await sharp(file).rotate().metadata();
  const [w, h] = (meta.orientation ?? 1) >= 5 ? [meta.height, meta.width] : [meta.width, meta.height];
  const { width, height } = analysisSize(w, h);
  const { data } = await sharp(file).rotate().resize(width, height, { kernel: 'cubic' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const image = { width, height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
  for (const kind of ['subject', 'sky']) {
    if (!Array.isArray(photo[kind])) continue; // eslint-disable-line no-continue
    for (const [k, answer] of photo[kind].entries()) {
      if (answer === 'none') continue; // eslint-disable-line no-continue
      const union = new Float32Array(width * height);
      for (const part of answer.parts ?? [answer]) {
        const points = []; const labels = [];
        if (part.box) { points.push([part.box[0] * width, part.box[1] * height], [part.box[2] * width, part.box[3] * height]); labels.push(2, 3); }
        for (const [u, v, label] of part.points ?? []) { points.push([u * width, v * height]); labels.push(label); }
        const masks = await segmenter.outline({ image, imageKey: photo.id, points, labels }); // eslint-disable-line no-await-in-loop
        // A box asks for the whole object; points alone take SAM's best-scored answer.
        const areas = masks.map((m) => m.coverage.reduce((a, v) => a + (v >= 0.5), 0));
        const pick = part.pick === 'largest' || part.box ? areas.indexOf(Math.max(...areas)) : masks.reduce((b, m, i) => (m.score > masks[b].score ? i : b), 0);
        const c = masks[pick].coverage;
        for (let i = 0; i < c.length; i += 1) if (c[i] > union[i]) union[i] = c[i];
      }
      const refined = refineEdges(union, image, { band: 3 });
      const codes = Uint8Array.from(refined, (v) => (v >= 0.5 ? 255 : 0));
      await sharp(Buffer.from(codes), { raw: { width, height, channels: 1 } }).png().toFile(path.join(out, `${photo.id}.${kind}.${k}.png`)); // eslint-disable-line no-await-in-loop
      const shown = Buffer.from(image.data);
      const tint = kind === 'sky' ? [255, 200, 0] : [255, 40, 200];
      for (let i = 0; i < codes.length; i += 1) if (codes[i]) for (let ch = 0; ch < 3; ch += 1) shown[i * 4 + ch] = shown[i * 4 + ch] * 0.45 + tint[ch] * 0.55;
      await sharp(shown, { raw: { width, height, channels: 4 } }).jpeg({ quality: 80 }).toFile(path.join(out, `${photo.id}.${kind}.${k}.review.jpg`)); // eslint-disable-line no-await-in-loop
      console.log(`${photo.id}.${kind}.${k}`);
    }
  }
}
