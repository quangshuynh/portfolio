// Run against a checkout of the version 17 editor (git worktree add <dir> e77b003):
// node scripts/fixture-edits-v17.mjs <dir> src/editor/model/fixtures
// Writes edits-v17.json (a v17 document), parsed-by-v17-editor.json (how that editor reads it) and
// render-v17.json (a hash of its composite over a synthetic backdrop with synthetic rasters).
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, out] = process.argv.slice(2);
const load = (rel) => import(pathToFileURL(path.join(repo, rel)).href);
const { createEditDocument, parseEditDocument, serializeEditDocument, DOCUMENT_VERSION } = await load('src/editor/model/editDocument.mjs');
const { normalizeAdjustments } = await load('src/editor/model/adjustments.mjs');
const { layerProgram } = await load('src/editor/model/layerTree.mjs');
const { maskActive } = await load('src/editor/model/masks.mjs');
const { adjustmentPass, compositeImageSync, groupPass, rasterPass } = await load('src/editor/pipeline/composite.mjs');
const { layerMatrix } = await load('src/editor/pipeline/layerTransform.mjs');
const { canvasMaskMap, layerMaskMap, imageMaskMap } = await load('src/editor/pipeline/mask.mjs');
const { geometryPlan, normalizeGeometry } = await load('src/editor/pipeline/geometry.mjs');
const { encodeCodes } = await load('src/editor/segment/analysis.mjs');
if (DOCUMENT_VERSION !== 17) throw new Error(`expected the version 17 editor, got ${DOCUMENT_VERSION}`);

const W = 96; const H = 64;
const codes = new Uint8Array(24 * 16);
for (let i = 0; i < codes.length; i += 1) codes[i] = (i % 24) < 12 ? 255 : (i % 24) < 14 ? 128 : 0;
const sky = { id: 'sel', type: 'selection', kind: 'sky', version: 'fixture/1', width: 24, height: 16, data: encodeCodes(codes), confidence: 0.8, feather: 0.3 };
const src = (c) => ({ sha256: c.repeat(64), name: `${c}.png`, size: 100, format: 'png', width: 48, height: 32 });
const layers = [
  { id: 'img1', type: 'image', name: 'Over', source: src('a'), x: 0.4, y: 0.5, width: 0.9, height: 0.6, rotation: 15, blend: 'multiply', opacity: 0.85,
    mask: { base: 'all', components: [{ id: 'b1', type: 'brush', op: 'add', strokes: [{ mode: 'erase', radius: 0.1, hardness: 0.5, opacity: 1, points: [[0.2, 0.3, 1], [0.6, 0.5, 1]] }] }] } },
  { id: 'adj1', type: 'adjustment', name: 'Clip', settings: { exposure: -0.6, saturation: 30 }, clip: true },
  { id: 'grp', type: 'group', name: 'G', blend: 'screen', opacity: 0.7 },
  { id: 'img2', type: 'image', source: src('b'), x: 0.6, y: 0.4, width: 0.5, height: 0.4, flipH: true, parent: 'grp' },
  { id: 'adj2', type: 'adjustment', settings: { contrast: 25, temperature: -15 }, parent: 'grp', mask: { base: 'none', components: [sky] } },
  { id: 'adj3', type: 'adjustment', settings: { exposure: 0.3 }, blend: 'soft-light' },
];
const adjustments = normalizeAdjustments({ exposure: 0.1, geometry: { angle: 3 }, layers });
const doc = createEditDocument([{ name: 'photo.png', size: 1000, sha256: 'f'.repeat(64), format: 'png', width: W, height: H, adjustments }], {});
const text = serializeEditDocument(doc);
const parsed = parseEditDocument(text);
writeFileSync(path.join(out, 'edits-v17.json'), `${text}\n`);
writeFileSync(path.join(out, 'parsed-by-v17-editor.json'), `${JSON.stringify(parsed.photos.map((p) => p.adjustments), null, 2)}\n`);

// The composite of the parsed layers over a synthetic backdrop (the photo's own render aside).
const read = parsed.photos[0].adjustments;
const canvas = { width: W, height: H };
const raster = (seed) => { const data = new Uint8ClampedArray(48 * 32 * 4); for (let p = 0; p < 48 * 32; p += 1) data.set([(p * seed) % 256, (p * 7 + seed * 40) % 256, (p * 3) % 256, p % 11 ? 255 : 0], p * 4); return { width: 48, height: 32, data }; };
const rasters = { a: raster(5), b: raster(9) };
const image = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
for (let p = 0; p < W * H; p += 1) image.data.set([(p * 13) % 256, (p * 29 + 50) % 256, (p * 5 + 100) % 256, 255], p * 4);
const plan = geometryPlan(normalizeGeometry(read.geometry), { width: W, height: H });
const imageMap = imageMaskMap(plan, canvas, { width: W, height: H });
const passes = layerProgram(read.layers).map((step) => {
  if (step.op !== 'layer') return groupPass(step, step.owner && maskActive(step.owner.mask) ? { def: step.owner.mask, map: canvasMaskMap(canvas, imageMap) } : null);
  const { layer } = step;
  const mask = maskActive(layer.mask) ? layer.mask : null;
  if (layer.type === 'adjustment') return adjustmentPass(layer, null, mask && { def: mask, map: canvasMaskMap(canvas, imageMap) });
  const r = rasters[layer.source.sha256[0]];
  const matrix = layerMatrix(layer, canvas, r);
  return rasterPass(layer, r, matrix, canvas, mask && { def: mask, map: layerMaskMap(matrix, r) });
});
compositeImageSync(image, passes);
writeFileSync(path.join(out, 'render-v17.json'), `${JSON.stringify({ size: [W, H], sha256: createHash('sha256').update(image.data).digest('hex') })}\n`);
console.log('written with editor version', DOCUMENT_VERSION);
