// @vitest-environment node
// The local Detail preview (localPreview.mjs) keeps each Detail pass's filtered frame and mixes it
// through the mask again on every brush move: its frames must equal compositeImageSync exactly.
import { COMPOSITE_BAND_ROWS, compositeImageSync, localPasses } from './composite.mjs';
import { createLocalPreview, renderDetailFrame } from './localPreview.mjs';
import { maskMap, rasterizeMask } from './mask.mjs';
import { splitLocalSettings } from '../model/masks.mjs';

const W = 120;
const H = COMPOSITE_BAND_ROWS + 70;
const map = maskMap([1, 0, 0, 0, 1, 0, 0, 0, 1], W, H);
const size = { width: W, height: H };

function photo() {
  const data = new Uint8ClampedArray(W * H * 4);
  let seed = 11;
  for (let i = 0; i < W * H; i += 1) {
    seed = (seed * 16807) % 2147483647;
    const v = 60 + 100 * ((i % W) / W) + 40 * Math.sin(i / W / 7) + (seed / 2147483647 - 0.5) * 60;
    data.set([v + 25, v, v - 25, 255], i * 4);
  }
  return { width: W, height: H, data };
}
const brush = (count) => ({ id: 'b', name: 'b', enabled: true, op: 'add', invert: false, opacity: 1, type: 'brush', strokes: [{ mode: 'add', radius: 0.08, hardness: 0.4, opacity: 0.9, points: Array.from({ length: count }, (_, i) => [0.15 + (0.7 * i) / 16, 0.35 + 0.2 * Math.sin(i / 3), 1]) }] });
const radial = { id: 'r', name: 'r', enabled: true, op: 'add', invert: false, opacity: 1, type: 'radial', x: 0.6, y: 0.7, rx: 0.3, ry: 0.2, rotation: 10, feather: 0.5 };
const mask = (...components) => ({ space: 'image', base: 'none', enabled: true, invert: false, opacity: 1, components });
const local = (id, settings, def) => ({ id, name: id, enabled: true, amount: 0.85, settings, mask: def });
// As the viewer does: a raster per mask, made once; the brush's mask through the paint cache.
const rasters = new Map();
const passesOf = (locals, cache) => locals.flatMap((l) => {
  const key = `${l.id}|${JSON.stringify(l.mask)}`;
  if (!rasters.has(key)) rasters.set(key, rasterizeMask(l.mask, map, size, l.id === 'a' ? cache : null));
  return localPasses(l, { def: l.mask, map, key, raster: rasters.get(key) }, size, splitLocalSettings(l.settings));
});
// Differing bytes (a count keeps failures readable).
const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) n += 1; return n; };
const reference = (base, passes) => compositeImageSync({ width: W, height: H, data: base.data.slice() }, passes).data;

test('mixing a kept Detail frame through each new mask equals compositing the passes, box by box', { timeout: 60_000 }, async () => {
  const base = photo();
  let ready = 0;
  const preview = createLocalPreview({ renderDetail: async (image, pass) => renderDetailFrame(image, pass), onReady: () => { ready += 1; } });
  const cache = new Map();
  // A Detail and colour local adjustment painted by the brush, under a second (colour) adjustment.
  const after = local('after', { exposure: 0.4, saturation: -20 }, mask(radial));
  let passes = passesOf([local('a', { clarity: 60, texture: 30, exposure: -0.3 }, mask(brush(1))), after], cache);
  const first = preview.compose(base, passes);
  expect(first.complete).toBe(false);
  // While the filtered frame renders, the Detail pass is left out.
  expect(diff(first.image.data, reference(base, passes.filter(({ kind }) => kind !== 'detail')))).toBe(0);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(ready).toBe(1);
  let shown = preview.compose(base, passes);
  expect(shown.complete).toBe(true);
  expect(diff(shown.image.data, reference(base, passes))).toBe(0);
  const view = shown.image.data.slice();
  for (let count = 2; count <= 16; count += 1) {
    passes = passesOf([local('a', { clarity: 60, texture: 30, exposure: -0.3 }, mask(brush(count))), after], cache);
    shown = preview.compose(base, passes);
    // A move changes one box (whole rows, as a colour pass follows); copying it rebuilds the frame.
    expect(shown.dirty).not.toBeNull();
    for (let y = shown.dirty.y0; y < shown.dirty.y1; y += 1) view.set(shown.image.data.subarray((y * W + shown.dirty.x0) * 4, (y * W + shown.dirty.x1) * 4), (y * W + shown.dirty.x0) * 4);
    expect(diff(shown.image.data, reference(base, passes))).toBe(0);
    expect(diff(view, shown.image.data)).toBe(0);
  }
  expect(ready).toBe(1);
  // New Detail settings render a new filtered frame; until then the pass is left out.
  passes = passesOf([local('a', { clarity: -40 }, mask(brush(16))), after], cache);
  expect(preview.compose(base, passes).complete).toBe(false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(diff(preview.compose(base, passes).image.data, reference(base, passes))).toBe(0);
});

test('a filtered frame that arrives after the settings changed again is not kept', async () => {
  const base = photo();
  const resolvers = [];
  const preview = createLocalPreview({ renderDetail: (image, pass) => new Promise((resolve) => resolvers.push(() => resolve(renderDetailFrame(image, pass)))) });
  const cache = new Map();
  const old = passesOf([local('a', { clarity: 50 }, mask(brush(8)))], cache);
  preview.compose(base, old);
  const current = passesOf([local('a', { clarity: -50 }, mask(brush(8)))], cache);
  preview.compose(base, current);
  resolvers[0]();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(preview.compose(base, current).complete).toBe(false);
  resolvers[1]();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(diff(preview.compose(base, current).image.data, reference(base, current))).toBe(0);
  // After clear (another photo), a late result is dropped too.
  preview.clear();
  expect(preview.compose(base, old).complete).toBe(false);
});

test('while deferred (an export runs) nothing is filtered; afterwards the pass is requested', async () => {
  const base = photo();
  const calls = [];
  const preview = createLocalPreview({ renderDetail: async (image, pass) => { calls.push(pass); return renderDetailFrame(image, pass); } });
  const passes = passesOf([local('a', { clarity: 30 }, mask(brush(6)))], new Map());
  expect(preview.compose(base, passes, { defer: true }).complete).toBe(false);
  expect(preview.compose(base, passes, { defer: true }).complete).toBe(false);
  expect(calls).toHaveLength(0);
  preview.compose(base, passes);
  expect(calls).toHaveLength(1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(diff(preview.compose(base, passes).image.data, reference(base, passes))).toBe(0);
});
