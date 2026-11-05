// A "good coarse grid" from a synthetic scene's exact alpha: reduced to 1024 px, softened by one cell,
// quantised (a controlled condition where the models' own outline is unusable, as for branches).
// Usage: node gtcoarse.mjs <repoRoot> <dir> name …  → <dir>/coarse/<name>-gt.json
import sharp from 'sharp'; import { writeFileSync } from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const [root, dir, ...names] = process.argv.slice(2);
const { encodeCodes, quantize, boxMean, analysisSize } = await import(pathToFileURL(path.join(root, 'src/editor/segment/analysis.mjs')).href);
for (const name of names) {
  const meta = await sharp(path.join(dir, 'synth', `${name}.alpha.png`)).metadata();
  const size = analysisSize(meta.width, meta.height);
  const { data } = await sharp(path.join(dir, 'synth', `${name}.alpha.png`)).greyscale().resize(size.width, size.height, { kernel: 'cubic' }).raw().toBuffer({ resolveWithObject: true });
  const cov = boxMean(Float32Array.from(data, (v) => v / 255), size.width, size.height, 1);
  writeFileSync(path.join(dir, 'coarse', `${name}-gt.json`), JSON.stringify({ width: size.width, height: size.height, data: encodeCodes(quantize(cov)), native: [meta.width, meta.height] }));
  console.log(name);
}
