// Coarse selections exactly as the editor stores them (Interval 24.1 code): the photo reduced to
// 1024 px, SAM prompted with a box + point (Select Object path: best-scored mask, refineEdges band 4),
// or Select Subject for real photos; quantised and run-length coded.
// Usage: node coarse.mjs <repoRoot> <outDir> <name=file=u0,v0,u1,v1=u,v | name=file=subject> ...
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import * as ort from 'onnxruntime-web/wasm';

const [root, out, ...items] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const load = (f) => import(pathToFileURL(path.join(root, 'src/editor/segment', f)).href);
const { analysisSize, encodeCodes, quantize, subjectFromParts } = await load('analysis.mjs');
const { MODELS } = await load('models.mjs');
const { createSegmenter } = await load('segmenter.mjs');
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = `${pathToFileURL(path.join(root, 'node_modules/onnxruntime-web/dist')).href}/`;
const seg = createSegmenter({ ort, loadModel: async (n) => readFileSync(path.join(root, 'public/photography/editor-models', MODELS[n].file)), sessionOptions: { executionProviders: ['wasm'], graphOptimizationLevel: 'all' } });

for (const item of items) {
  const [name, file, box, point] = item.split('=');
  const meta = await sharp(file).rotate().metadata();
  const [w, h] = (meta.orientation ?? 1) >= 5 ? [meta.height, meta.width] : [meta.width, meta.height];
  const size = analysisSize(w, h);
  const { data } = await sharp(file).rotate().resize(size.width, size.height, { kernel: 'cubic' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const image = { ...size, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
  let coverage;
  if (box === 'subject') {
    const r = await seg.select({ kind: 'subject', image, imageKey: name });
    writeFileSync(path.join(out, `${name}.json`), JSON.stringify({ width: r.width, height: r.height, data: r.data, native: [w, h], confidence: r.confidence }));
    console.log(name, 'subject', r.confidence, r.width, r.height);
    continue; // eslint-disable-line no-continue
  }
  const [u0, v0, u1, v1] = box.split(',').map(Number);
  const [pu, pv] = point.split(',').map(Number);
  const pts = [[u0 * size.width, v0 * size.height], [u1 * size.width, v1 * size.height], [pu * size.width, pv * size.height]];
  const masks = await seg.outline({ image, imageKey: name, points: pts, labels: [2, 3, 1] });
  const best = masks.reduce((b, m) => (m.score > b.score ? m : b));
  coverage = subjectFromParts([{ coverage: best.coverage, score: best.score }], [best.coverage], image).coverage;
  writeFileSync(path.join(out, `${name}.json`), JSON.stringify({ width: size.width, height: size.height, data: encodeCodes(quantize(coverage)), native: [w, h], confidence: best.score }));
  console.log(name, 'object', best.score.toFixed(3));
}
