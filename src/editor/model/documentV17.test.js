// Version 17 documents (Interval 24) in the version 18 editor: read exactly as the version 17
// editor read them and composited to the same pixels. The fixtures were written by the version 17
// editor (main at e77b003) running scripts/fixture-edits-v17.mjs: a
// clipped adjustment, a Screen group, a canvas mask with a selection and an image layer mask with
// a brush stroke.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseEditDocument } from './editDocument.mjs';
import { layerProgram } from './layerTree.mjs';
import { maskActive } from './masks.mjs';
import { adjustmentLayerPass, compositeImageSync, groupPass, rasterPass } from '../pipeline/composite.mjs';
import { layerMatrix } from '../pipeline/layerTransform.mjs';
import { canvasMaskMap, imageMaskMap, layerMaskMap } from '../pipeline/mask.mjs';
import { geometryPlan, normalizeGeometry } from '../pipeline/geometry.mjs';

const fixture = (name) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

describe('version 17 documents', () => {
  test('open exactly as the version 17 editor read them, without Detail or layer-space selections', () => {
    const document = parseEditDocument(fixture('edits-v17.json'));
    expect(document.version).toBe(17);
    const adjustments = document.photos.map((p) => p.adjustments);
    expect(adjustments).toEqual(JSON.parse(fixture('parsed-by-v17-editor.json')));
    adjustments[0].layers.filter(({ type }) => type === 'adjustment').forEach((layer) => expect(Object.keys(layer.settings)).not.toContain('texture'));
  });

  test('composite to the same pixels as in the version 17 editor', () => {
    const read = parseEditDocument(fixture('edits-v17.json')).photos[0].adjustments;
    const { size: [W, H], sha256 } = JSON.parse(fixture('render-v17.json'));
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
      if (layer.type === 'adjustment') return adjustmentLayerPass(layer, null, mask && { def: mask, map: canvasMaskMap(canvas, imageMap) }, canvas);
      const r = rasters[layer.source.sha256[0]];
      const matrix = layerMatrix(layer, canvas, r);
      return rasterPass(layer, r, matrix, canvas, mask && { def: mask, map: layerMaskMap(matrix, r) });
    });
    expect(passes.map(({ kind }) => kind)).not.toContain('detail');
    compositeImageSync(image, passes);
    expect(createHash('sha256').update(image.data).digest('hex')).toBe(sha256);
  });
});
