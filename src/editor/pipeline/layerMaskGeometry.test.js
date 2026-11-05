// Image layer masks holding selections of the layer's own source (Interval 24.1): the grid is in
// the layer's space, so it must land on the same content however the layer is placed, at any
// render size, and Object taps must map back to the source pixel under the pointer.
import { describe, expect, test } from 'vitest';
import { createImageLayer, normalizeLayer, updateLayer } from '../model/layers.mjs';
import { addSelection, createMask, createSelection, replaceWithSelection } from '../model/masks.mjs';
import { encodeCodes } from '../segment/analysis.mjs';
import { compositeImageSync, rasterPass } from './composite.mjs';
import { invert3, project } from './geometry.mjs';
import { layerMatrix } from './layerTransform.mjs';
import { layerMaskMap, maskRows, maskUsesImage, rasterizeMask } from './mask.mjs';

const SW = 600;
const SH = 400;
const source = { sha256: 'b'.repeat(64), name: 'car.png', size: 1, format: 'png', width: SW, height: SH };

// A grid over the source: 1 inside a rectangle (fractions of the source), 0 elsewhere.
function gridSelection(id, [u0, v0, u1, v1], width = 120, height = 80) {
  const codes = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const u = (x + 0.5) / width; const v = (y + 0.5) / height;
    if (u >= u0 && u < u1 && v >= v0 && v < v1) codes[y * width + x] = 255;
  }
  return createSelection(id, { kind: 'subject', version: 'test/1', width, height, data: encodeCodes(codes), confidence: 0.8 });
}
const BOX = [0.25, 0.3, 0.6, 0.8];
const maskOf = (component) => replaceWithSelection(createMask('layer'), component);

/** Canvas position of a source point (fractions u, v), from the layer's fields alone (layerTransform's placement, written out). */
function forward(layer, canvas, u, v) {
  const short = Math.min(canvas.width, canvas.height);
  const a = (layer.rotation * Math.PI) / 180;
  const x = (u - 0.5) * layer.width * short * (layer.flipH ? -1 : 1);
  const y = (v - 0.5) * layer.height * short * (layer.flipV ? -1 : 1);
  return [layer.x * canvas.width + x * Math.cos(a) - y * Math.sin(a), layer.y * canvas.height + x * Math.sin(a) + y * Math.cos(a)];
}
const coverageAt = (mask, layer, canvas, raster, [cx, cy]) => {
  const map = layerMaskMap(layerMatrix(layer, canvas, raster), raster);
  const x = Math.floor(cx);
  const y = Math.floor(cy);
  return maskRows(mask, map, 1, y, y + 1, { x0: x })[0];
};

const PLACEMENTS = [
  { name: 'centred, uniform', patch: {} },
  { name: 'translated', patch: { x: 0.2, y: 0.75 } },
  { name: 'nonuniform scale', patch: { width: 1.4, height: 0.5 } },
  { name: 'rotated', patch: { rotation: 33 } },
  { name: 'rotated, scaled, flipped, off-centre', patch: { x: 0.65, y: 0.4, width: 0.9, height: 1.3, rotation: -127, flipH: true } },
  { name: 'flipped vertically', patch: { flipV: true, rotation: 90 } },
  { name: 'partly outside the canvas', patch: { x: 0.95, y: 0.1, width: 1.2, height: 0.8 } },
];
const CANVASES = [{ width: 800, height: 600 }, { width: 333, height: 777 }];

describe('image layer selection masks: source → layer → canvas', () => {
  const component = gridSelection('s', BOX);
  const mask = maskOf(component);

  test('a layer mask holds the selection and is evaluated in the layer\'s own space', () => {
    expect(mask).toMatchObject({ space: 'layer', base: 'none' });
    expect(mask.components[0]).toMatchObject({ type: 'selection', kind: 'subject' });
    expect(maskUsesImage(mask)).toBe(false);
    // A new layer mask reveals everything: adding a selection to it starts it from nothing.
    expect(addSelection(createMask('layer'), component).base).toBe('none');
    const painted = { ...createMask('layer'), components: [] };
    expect(addSelection({ ...painted, invert: true }, component).base).toBe('all');
  });

  for (const canvas of CANVASES) {
    for (const { name, patch } of PLACEMENTS) {
      test(`${name} on ${canvas.width}×${canvas.height}: inside and outside the selection land where the source content does`, () => {
        const layer = { ...createImageLayer('img', source, canvas), ...patch, mask };
        // Preview-sized and export-sized rasters: the same canvas coverage.
        for (const raster of [{ width: 300, height: 200 }, { width: SW, height: SH }]) {
          for (const [u, v] of [[0.4, 0.55], [0.3, 0.35], [0.55, 0.75]]) {
            const at = forward(layer, canvas, u, v);
            if (at[0] < 1 || at[1] < 1 || at[0] > canvas.width - 1 || at[1] > canvas.height - 1) continue; // eslint-disable-line no-continue
            expect(coverageAt(mask, layer, canvas, raster, at), `inside ${u},${v} raster ${raster.width}`).toBe(255);
          }
          for (const [u, v] of [[0.1, 0.1], [0.8, 0.5], [0.4, 0.95], [0.15, 0.6]]) {
            const at = forward(layer, canvas, u, v);
            if (at[0] < 1 || at[1] < 1 || at[0] > canvas.width - 1 || at[1] > canvas.height - 1) continue; // eslint-disable-line no-continue
            expect(coverageAt(mask, layer, canvas, raster, at), `outside ${u},${v} raster ${raster.width}`).toBe(0);
          }
        }
      });
    }
  }

  test('Object taps: stage pixel → canvas → source fraction, at any zoom and pan, inverts the placement', () => {
    const canvas = CANVASES[0];
    for (const { patch } of PLACEMENTS) {
      const layer = { ...createImageLayer('img', source, canvas), ...patch };
      const raster = { width: SW, height: SH };
      const map = layerMaskMap(layerMatrix(layer, canvas, raster), raster);
      for (const view of [{ k: 0.5, x: 10, y: 20 }, { k: 2.75, x: -900, y: -340 }]) {
        for (const [u, v] of [[0.1, 0.2], [0.5, 0.5], [0.93, 0.71]]) {
          const [cx, cy] = forward(layer, canvas, u, v);
          // MaskTool.toSpace: (stage − box) / k is the canvas pixel; the map takes it to the space.
          const stage = [view.x + cx * view.k, view.y + cy * view.k];
          const [sx, sy] = project(map.matrix, (stage[0] - view.x) / view.k, (stage[1] - view.y) / view.k);
          expect(sx / map.width).toBeCloseTo(u, 9);
          expect(sy / map.height).toBeCloseTo(v, 9);
          // And back (MaskTool.toStage), where the tapped points are drawn.
          const [bx, by] = project(invert3(map.matrix), u * map.width, v * map.height);
          expect(view.x + bx * view.k).toBeCloseTo(stage[0], 6);
          expect(view.y + by * view.k).toBeCloseTo(stage[1], 6);
        }
      }
    }
  });

  test('moving, scaling, rotating or flipping a layer keeps its mask data as it is (nothing re-rasterised)', () => {
    const layers = [normalizeLayer({ ...createImageLayer('img', source, CANVASES[0]), mask })];
    let next = layers;
    for (const { patch } of PLACEMENTS) next = updateLayer(next, 'img', patch);
    expect(next[0].mask).toEqual(layers[0].mask);
    expect(next[0].mask.components[0].data).toBe(component.data);
  });

  test('canvas size changes (a crop of the photo) keep the mask on the same content', () => {
    const layer = { ...createImageLayer('img', source, CANVASES[0]), rotation: 20, mask };
    for (const canvas of [{ width: 800, height: 600 }, { width: 640, height: 600 }, { width: 400, height: 300 }]) {
      expect(coverageAt(mask, layer, canvas, { width: SW, height: SH }, forward(layer, canvas, 0.4, 0.55))).toBe(255);
      expect(coverageAt(mask, layer, canvas, { width: SW, height: SH }, forward(layer, canvas, 0.1, 0.1))).toBe(0);
    }
  });

  test('preview (precomputed coverage) and export (evaluated per band) composite the masked layer identically', () => {
    const canvas = { width: 160, height: 120 };
    const raster = { width: 60, height: 40, data: new Uint8ClampedArray(60 * 40 * 4) };
    for (let p = 0; p < 60 * 40; p += 1) raster.data.set([200, 40 + (p % 60), 90, p % 7 === 0 ? 128 : 255], p * 4);
    const soft = maskOf({ ...component, feather: 0.6, shift: 0.2 });
    const layer = { ...createImageLayer('img', { ...source, width: 60, height: 40 }, canvas), rotation: 12, opacity: 0.9, mask: soft };
    const matrix = layerMatrix(layer, canvas, raster);
    const map = layerMaskMap(matrix, raster);
    const backdrop = () => ({ ...canvas, data: new Uint8ClampedArray(canvas.width * canvas.height * 4).fill(255) });
    const exported = compositeImageSync(backdrop(), [rasterPass(layer, raster, matrix, canvas, { def: soft, map })]);
    const previewed = compositeImageSync(backdrop(), [rasterPass(layer, raster, matrix, canvas, { def: soft, map, raster: rasterizeMask(soft, map, canvas) })]);
    expect(previewed.data).toEqual(exported.data);
    // Soft alpha: somewhere the selection's feathered edge meets semi-transparent source pixels,
    // and the result lies strictly between the backdrop and the layer.
    const unmasked = compositeImageSync(backdrop(), [rasterPass(layer, raster, matrix, canvas)]);
    let partial = 0;
    for (let i = 0; i < exported.data.length; i += 4) if (exported.data[i + 1] < 255 && exported.data[i + 1] > unmasked.data[i + 1]) partial += 1;
    expect(partial).toBeGreaterThan(10);
  });
});
