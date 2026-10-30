// @vitest-environment node
// Interval 15 optimisations of selective editing must not change a pixel: the masked adjustment
// pass renders only its mask's box, local Detail bands run on render workers, and the preview's
// brush cache updates only the box a new stroke segment touches.
import { adjustPixel } from './blend.mjs';
import { COMPOSITE_BAND_ROWS, adjustmentParams, compositeImage, compositeImageSync, localPasses } from './composite.mjs';
import { prepareRender, renderRgba8 } from './cpuRenderer.mjs';
import { maskBounds, maskMap, maskRows, rasterizeMask } from './mask.mjs';
import { splitLocalSettings } from '../model/masks.mjs';
import { runTask } from '../io/imageTasks.mjs';

const W = 96;
const H = COMPOSITE_BAND_ROWS * 2 + 90;
const map = maskMap([1, 0, 0, 0, 1, 0, 0, 0, 1], W, H);

function photo() {
  const data = new Uint8ClampedArray(W * H * 4);
  let seed = 5;
  for (let i = 0; i < W * H; i += 1) {
    seed = (seed * 16807) % 2147483647;
    const v = 70 + 90 * ((i % W) / W) + 40 * Math.sin(i / W / 9) + (seed / 2147483647 - 0.5) * 50;
    data.set([v + 20, v, v - 20, 255], i * 4);
  }
  return { width: W, height: H, data };
}
const component = (extra) => ({ id: 'c', name: 'c', enabled: true, op: 'add', invert: false, opacity: 1, ...extra });
const mask = (...components) => ({ space: 'image', base: 'none', enabled: true, invert: false, opacity: 1, components });
const radial = component({ type: 'radial', x: 0.5, y: 0.55, rx: 0.3, ry: 0.2, rotation: 20, feather: 0.6 });
const linear = component({ id: 'l', type: 'linear', x0: 0.5, y0: 0.05, x1: 0.5, y1: 0.4, feather: 0.5 });

function fakeWorker() {
  const listeners = [];
  return {
    addEventListener: (type, listener) => type === 'message' && listeners.push(listener),
    postMessage({ id, type, payload }) {
      setTimeout(async () => {
        try {
          const { result } = await runTask(type, structuredClone(payload), () => {});
          listeners.forEach((listener) => listener({ data: { id, ok: true, result } }));
        } catch (error) {
          listeners.forEach((listener) => listener({ data: { id, ok: false, error: { code: error.code, message: error.message } } }));
        }
      }, 0);
    },
    terminate() {},
  };
}
const contextOf = (image) => ({ getImageData: () => ({ width: image.width, height: image.height, data: image.data.slice() }), putImageData: (data) => image.data.set(data.data) });

test('a masked adjustment pass equals rendering the whole frame and mixing through the mask', () => {
  const local = { id: 'a', name: '', enabled: true, amount: 0.8, settings: { exposure: -0.7, saturation: 30 }, mask: mask(linear) };
  const [pass] = localPasses(local, { def: local.mask, map }, { width: W, height: H }, splitLocalSettings(local.settings));
  const result = compositeImageSync(photo(), [pass]);
  const reference = photo();
  const adjusted = renderRgba8(reference.data.slice(), prepareRender(adjustmentParams(pass)));
  const codes = maskRows(local.mask, map, W, 0, H);
  for (let p = 0; p < W * H; p += 1) adjustPixel(0, reference.data, p * 4, adjusted, p * 4, pass.opacity * (codes[p] / 255));
  expect(result.data).toEqual(reference.data);
});

test('local Detail on render workers equals the one-thread pass, with and without a mask', async () => {
  const { composeLayers } = await import('../io/composeLayers.mjs');
  const locals = [
    { id: 'd1', name: '', enabled: true, amount: 1, settings: { clarity: 45, sharpening: 40 }, mask: mask(radial) },
    { id: 'd2', name: '', enabled: true, amount: 0.7, settings: { dehaze: 30, exposure: 0.3 }, mask: mask(linear) },
  ];
  const options = { size: { width: W, height: H }, local: locals, imageMap: () => map, native: { width: W * 4, height: H * 4 }, loadRaster: null, rasterizeText: null, lutFor: () => null };
  const page = photo();
  await composeLayers(contextOf(page), [], { ...options, workers: 0 });
  const banded = photo();
  await composeLayers(contextOf(banded), [], { ...options, workers: 3, spawn: fakeWorker });
  expect(banded.data).toEqual(page.data);
  expect(page.data).not.toEqual(photo().data);
}, 60_000);

test('the brush cache gives the same codes as a full evaluation, point by point, with gradients and erasing', () => {
  const stroke = (count, mode = 'add') => ({ mode, radius: 0.06, hardness: 0.4, opacity: 0.9, points: Array.from({ length: count }, (_, i) => [0.1 + (0.8 * i) / 40, 0.5 + 0.25 * Math.sin(i / 5), 1]) });
  const brush = (strokes) => ({ ...component({ id: 'b' }), type: 'brush', strokes });
  const cache = new Map();
  const first = stroke(40);
  for (let count = 1; count <= 40; count += 1) {
    const def = mask(radial, brush([first, stroke(count, 'erase')]));
    def.components[0] = { ...radial, op: 'subtract', invert: true };
    expect(rasterizeMask(def, map, { width: W, height: H }, cache).data).toEqual(rasterizeMask(def, map, { width: W, height: H }).data);
  }
  // Undo (a stroke removed) and a moved gradient recompute in full.
  const undone = mask(radial, brush([first]));
  expect(rasterizeMask(undone, map, { width: W, height: H }, cache).data).toEqual(rasterizeMask(undone, map, { width: W, height: H }).data);
  const moved = mask({ ...radial, x: 0.3 }, brush([first]));
  expect(rasterizeMask(moved, map, { width: W, height: H }, cache).data).toEqual(rasterizeMask(moved, map, { width: W, height: H }).data);
}, 60_000);

test('a cached raster reports the box that changed, so redrawing only that box rebuilds the new codes', () => {
  const stroke = (count) => ({ mode: 'add', radius: 0.05, hardness: 0.5, opacity: 1, points: Array.from({ length: count }, (_, i) => [0.1 + (0.8 * i) / 30, 0.4 + 0.2 * Math.sin(i / 4), 1]) });
  const def = (count) => mask(linear, { ...component({ id: 'b' }), type: 'brush', strokes: [stroke(count)] });
  // A small canvas of its own: the test is about boxes, not band sizes.
  const size = { width: 96, height: 80 };
  const small = maskMap([1, 0, 0, 0, 1, 0, 0, 0, 1], size.width, size.height);
  const mismatches = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) n += 1; return n; };
  const cache = new Map();
  let shown = null;
  let previous = null;
  for (let count = 1; count <= 30; count += 1) {
    const raster = rasterizeMask(def(count), small, size, cache);
    const { change } = raster;
    if (!previous) {
      expect(change.from).toBeNull();
      shown = raster.data.slice();
    } else {
      expect(change.from).toBe(previous.change.version);
      // Only the dirty box is copied over what was shown before.
      if (change.dirty) {
        for (let y = change.dirty.y0; y < change.dirty.y1; y += 1) {
          for (let x = change.dirty.x0; x < change.dirty.x1; x += 1) shown[y * size.width + x] = raster.data[y * size.width + x];
        }
        expect(change.dirty.x1 - change.dirty.x0).toBeLessThan(size.width);
      }
    }
    expect(mismatches(shown, raster.data)).toBe(0);
    previous = raster;
  }
  // The same raster again: nothing changed. A different shape: everything.
  expect(rasterizeMask(def(30), small, size, cache).change).toMatchObject({ dirty: null, from: previous.change.version });
  const moved = rasterizeMask(mask({ ...linear, y1: 0.6 }, { ...component({ id: 'b' }), type: 'brush', strokes: [stroke(30)] }), small, size, cache);
  expect(moved.change).toMatchObject({ from: null, dirty: { x0: 0, y0: 0, x1: size.width, y1: size.height } });
  expect(rasterizeMask(def(5), small, size).change).toBeUndefined();
});

test('starting a stroke, or a first stroke on a new brush, updates only its box and gives the codes of a full evaluation', () => {
  const size = { width: 96, height: 80 };
  const small = maskMap([1, 0, 0, 0, 1, 0, 0, 0, 1], size.width, size.height);
  const stroke = (count, y, mode = 'add', opacity = 0.8) => ({ mode, radius: 0.05, hardness: 0.3, opacity, points: Array.from({ length: count }, (_, i) => [0.15 + (0.7 * i) / 12, y + 0.1 * Math.sin(i / 3), 1]) });
  const brush = (id, strokes) => ({ ...component({ id }), type: 'brush', strokes });
  const cache = new Map();
  let shown = null;
  let version = null;
  // Paints `def` through the cache: the codes equal a full evaluation, and copying the reported
  // box over what was shown before (the overlay and the mask texture do this) rebuilds them.
  const paint = (def, incremental = true) => {
    const raster = rasterizeMask(def, small, size, cache);
    expect(raster.data).toEqual(rasterizeMask(def, small, size).data);
    const { change } = raster;
    if (incremental) {
      expect(change.from).toBe(version);
      if (change.dirty) {
        expect((change.dirty.x1 - change.dirty.x0) * (change.dirty.y1 - change.dirty.y0)).toBeLessThan(size.width * size.height);
        for (let y = change.dirty.y0; y < change.dirty.y1; y += 1) for (let x = change.dirty.x0; x < change.dirty.x1; x += 1) shown[y * size.width + x] = raster.data[y * size.width + x];
      }
      expect(shown).toEqual(raster.data);
    } else {
      shown = raster.data.slice();
    }
    version = change.version;
  };
  const strokes = [stroke(12, 0.3), stroke(12, 0.5, 'erase', 0.6), stroke(12, 0.7)];
  paint(mask(linear, brush('b', [])), false);
  // The brush's first stroke, then two more strokes (one erasing), each painted point by point.
  for (let s = 0; s < strokes.length; s += 1) {
    for (let count = 1; count <= 12; count += 1) paint(mask(linear, brush('b', [...strokes.slice(0, s), { ...strokes[s], points: strokes[s].points.slice(0, count) }])));
  }
  // A second brush added with its first stroke (the editor adds the component and the point at once).
  const done = brush('b', strokes);
  for (let count = 1; count <= 6; count += 1) paint(mask(linear, done, brush('c', [{ ...stroke(6, 0.2), points: stroke(6, 0.2).points.slice(0, count) }])));
  // An inverted mask and a subtracting brush are still exact.
  const inverted = { ...mask(linear, done, brush('c', [stroke(6, 0.2)])), invert: true };
  paint(inverted, false);
  const subtract = { ...brush('d', [stroke(4, 0.6)]), op: 'subtract' };
  paint({ ...inverted, components: [...inverted.components, subtract] });
  // Undo of a stroke recomputes in full.
  const undone = rasterizeMask(mask(linear, brush('b', strokes.slice(0, 2))), small, size, cache);
  expect(undone.change.from).toBeNull();
  expect(undone.data).toEqual(rasterizeMask(mask(linear, brush('b', strokes.slice(0, 2))), small, size).data);
});

test('a mask is exactly 0 outside its bounds, so exports can skip those bands', () => {
  const size = { width: 140, height: 100 };
  const zeroOutside = (def, map) => {
    const box = maskBounds(def, map, size);
    const codes = maskRows(def, map, size.width, 0, size.height);
    let outside = 0;
    let inside = 0;
    for (let y = 0; y < size.height; y += 1) {
      for (let x = 0; x < size.width; x += 1) {
        const code = codes[y * size.width + x];
        const within = !box || (x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1);
        if (code && !within) outside += 1;
        if (code) inside += 1;
      }
    }
    return { box, outside, inside };
  };
  const flat = maskMap([1, 0, 0, 0, 1, 0, 0, 0, 1], size.width, size.height);
  // An affine map (rotated and scaled) and a projective one (perspective).
  const a = (20 * Math.PI) / 180;
  const rotated = maskMap([1.3 * Math.cos(a), -1.3 * Math.sin(a), 30, 1.3 * Math.sin(a), 1.3 * Math.cos(a), -10, 0, 0, 1], 160, 120);
  const perspective = maskMap([1, 0.1, 0, 0.05, 1, 0, 0.0008, 0.0004, 1], size.width, size.height);
  const brushStroke = { ...component({ id: 'b' }), type: 'brush', strokes: [{ mode: 'add', radius: 0.05, hardness: 0.3, opacity: 1, points: [[0.2, 0.3, 1], [0.35, 0.4, 0.5], [0.45, 0.35, 1]] }, { mode: 'erase', radius: 0.2, hardness: 0.5, opacity: 1, points: [[0.9, 0.9, 1]] }] };
  const cases = [mask(radial), mask(linear), mask({ ...linear, x0: 0.1, y0: 0.5, x1: 0.4, y1: 0.7 }), mask(brushStroke), mask(radial, brushStroke), mask(radial, { ...linear, op: 'subtract' })];
  for (const map of [flat, rotated, perspective]) {
    for (const def of cases) {
      const { box, outside, inside } = zeroOutside(def, map);
      expect(outside).toBe(0);
      if (box && inside) expect((box.x1 - box.x0) * (box.y1 - box.y0)).toBeLessThanOrEqual(size.width * size.height);
    }
  }
  // Bounded where it matters: a radial and a brush leave most of a flat canvas out; inverted or
  // "everything" masks are unbounded.
  const area = (box) => (box.x1 - box.x0) * (box.y1 - box.y0);
  expect(area(maskBounds(mask(radial), flat, size))).toBeLessThan(0.5 * size.width * size.height);
  expect(area(maskBounds(mask(brushStroke), flat, size))).toBeLessThan(0.25 * size.width * size.height);
  expect(maskBounds(mask(linear), flat, size).y1).toBeLessThan(0.5 * size.height);
  expect(maskBounds({ ...mask(radial), invert: true }, flat, size)).toBeNull();
  expect(maskBounds({ ...mask(radial), base: 'all' }, flat, size)).toBeNull();
  expect(maskBounds(mask({ ...radial, invert: true }), flat, size)).toBeNull();
  expect(maskBounds(mask(linear), perspective, size)).toBeNull();
});

test('skipping bands outside mask bounds leaves the composite unchanged', async () => {
  const local = (id, settings, def) => ({ id, name: id, enabled: true, amount: 0.9, settings, mask: def });
  const locals = [local('d', { dehaze: 40, exposure: -0.4 }, mask({ ...linear, y0: 0.05, y1: 0.3 })), local('c', { clarity: 60 }, mask({ ...radial, y: 0.8, ry: 0.1 }))];
  const passes = () => locals.flatMap((l) => localPasses(l, { def: l.mask, map }, { width: W, height: H }, splitLocalSettings(l.settings)));
  // Reference: the same passes with unbounded masks (bounds set to null: every band evaluated).
  const unbounded = passes().map((pass) => ({ ...pass, mask: { ...pass.mask, bounds: null } }));
  const reference = await compositeImage(photo(), unbounded);
  const bounded = passes();
  const result = await compositeImage(photo(), bounded);
  expect(bounded.every((pass) => pass.mask.bounds && pass.mask.bounds.y1 - pass.mask.bounds.y0 < H)).toBe(true);
  expect(result.data).toEqual(reference.data);
}, 60_000);
