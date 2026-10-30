import { describe, expect, test } from 'vitest';
import { InpaintCancelled, inpaint } from './inpaint.mjs';
import { applyRetouch, applyRetouchAsync, applyRetouchOperation, removeContext, removeJob } from './retouch.mjs';
import { createRetouchOperation, normalizeRetouch } from '../model/retouch.mjs';

// Reproducible scenes (RGBA8): each pixel from a function of (x, y), so the clean truth is known.
const scenes = {
  sky: (x, y, w, h) => { const v = 0.45 + 0.4 * (y / h); return [v * 0.7, v * 0.85, v]; },
  stripes: (x) => { const v = Math.floor(x / 6) % 2 ? 0.75 : 0.3; return [v, v, v * 0.9]; },
  grass: (x, y) => { const n = 0.06 * Math.sin(x * 1.31 + Math.sin(y * 0.7) * 3) + 0.05 * Math.cos(y * 2.17 + x * 0.3); return [0.25 + n, 0.5 + n, 0.2 + n]; },
};
function render(scene, width, height, scale = 1) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const [r, g, b] = scene(x / scale, y / scale, width / scale, height / scale);
    const i = (y * width + x) * 4;
    data[i] = Math.round(r * 255); data[i + 1] = Math.round(g * 255); data[i + 2] = Math.round(b * 255); data[i + 3] = 255;
  }
  return { width, height, data };
}
// Paints a dark object (disk, or a thick line) into an image.
function paint(image, test) {
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
    if (!test(x, y)) continue; // eslint-disable-line no-continue
    const i = (y * image.width + x) * 4;
    image.data[i] = 15; image.data[i + 1] = 10; image.data[i + 2] = 12;
  }
}
// Mean absolute error (green channel) against the clean scene inside `inside(x, y)`.
function error(image, clean, inside) {
  let sum = 0; let n = 0;
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
    if (!inside(x, y)) continue; // eslint-disable-line no-continue
    sum += Math.abs(image.data[(y * image.width + x) * 4 + 1] - clean.data[(y * image.width + x) * 4 + 1]); n += 1;
  }
  return sum / n;
}
// Horizontal detail (mean |x-gradient|) inside a region: a blurred fill loses it.
function detail(image, inside) {
  let sum = 0; let n = 0;
  for (let y = 0; y < image.height; y += 1) for (let x = 1; x < image.width - 1; x += 1) {
    if (!inside(x, y)) continue; // eslint-disable-line no-continue
    sum += Math.abs(image.data[(y * image.width + x + 1) * 4 + 1] - image.data[(y * image.width + x - 1) * 4 + 1]); n += 1;
  }
  return sum / n;
}
const disk = (cx, cy, r) => (x, y) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r;

describe('content-aware remove', () => {
  test('sky: a dark object disappears into the gradient', () => {
    const clean = render(scenes.sky, 200, 140);
    const image = render(scenes.sky, 200, 140);
    paint(image, disk(100, 70, 12));
    applyRetouchOperation(image, createRetouchOperation('r1', 'remove', [[0.5, 0.5]], { radius: 0.12, hardness: 0.6 }));
    expect(error(image, clean, disk(100, 70, 14))).toBeLessThan(3);
  });

  test('stripes: structure continues through the hole, sharp rather than blurred', () => {
    const clean = render(scenes.stripes, 200, 140);
    const image = render(scenes.stripes, 200, 140);
    paint(image, disk(100, 70, 14));
    applyRetouchOperation(image, createRetouchOperation('r2', 'remove', [[0.5, 0.5]], { radius: 0.13, hardness: 0.7 }));
    const inside = disk(100, 70, 12);
    expect(detail(image, inside)).toBeGreaterThan(0.6 * detail(clean, inside));
    expect(error(image, clean, inside)).toBeLessThan(40);
  });

  test('grass: fine texture is rebuilt, not smoothed', () => {
    const clean = render(scenes.grass, 220, 160);
    const image = render(scenes.grass, 220, 160);
    paint(image, disk(110, 80, 16));
    applyRetouchOperation(image, createRetouchOperation('r3', 'remove', [[0.5, 0.5]], { radius: 0.12, hardness: 0.6 }));
    const inside = disk(110, 80, 14);
    expect(detail(image, inside)).toBeGreaterThan(0.6 * detail(clean, inside));
    expect(error(image, clean, inside)).toBeLessThan(14);
  });

  test('a thin wire across the sky is removed along its whole length', () => {
    const clean = render(scenes.sky, 240, 120);
    const image = render(scenes.sky, 240, 120);
    const line = (x, y) => Math.abs(y - (40 + x * 0.15)) <= 1.2;
    paint(image, line);
    const points = [[0.02, (40 + 4.8 * 0.15) / 120], [0.98, (40 + 235.2 * 0.15) / 120]];
    applyRetouchOperation(image, createRetouchOperation('r4', 'remove', points, { radius: 0.03, hardness: 0.5, spacing: 0.2 }));
    expect(error(image, clean, line)).toBeLessThan(4);
  });

  test('an object at the photo edge is filled from inside the photo', () => {
    const clean = render(scenes.grass, 200, 140);
    const image = render(scenes.grass, 200, 140);
    paint(image, disk(3, 70, 12));
    applyRetouchOperation(image, createRetouchOperation('r5', 'remove', [[0.015, 0.5]], { radius: 0.11, hardness: 0.6 }));
    expect(error(image, clean, disk(3, 70, 10))).toBeLessThan(16);
    expect(Array.from(image.data).every(Number.isFinite)).toBe(true);
  });

  test('a chosen source area is the only place the fill copies from', () => {
    // Left half red texture, right half blue; the hole sits on the boundary.
    const scene = (x, y) => (x < 100 ? [0.7 + 0.05 * Math.sin(x + y), 0.2, 0.2] : [0.2, 0.2, 0.7 + 0.05 * Math.sin(x - y)]);
    const make = () => { const img = render(scene, 200, 140); paint(img, disk(100, 70, 12)); return img; };
    const left = make();
    applyRetouchOperation(left, { ...createRetouchOperation('r6', 'remove', [[0.5, 0.5]], { radius: 0.11 }), source: { x: 0.05, y: 0.1, width: 0.35, height: 0.8 } });
    const right = make();
    applyRetouchOperation(right, { ...createRetouchOperation('r6', 'remove', [[0.5, 0.5]], { radius: 0.11 }), source: { x: 0.6, y: 0.1, width: 0.35, height: 0.8 } });
    const i = (70 * 200 + 100) * 4;
    expect(left.data[i]).toBeGreaterThan(left.data[i + 2] + 80);
    expect(right.data[i + 2]).toBeGreaterThan(right.data[i] + 80);
    expect(removeContext({ ...createRetouchOperation('a', 'remove', [[0.5, 0.5]], { radius: 0.05 }), source: { x: 0, y: 0, width: 0.1, height: 0.1 } }, 200, 140)).toMatchObject({ x0: 0, y0: 0 });
  });

  test('deterministic for the same pixels and operation; cancellable', () => {
    const run = () => { const img = render(scenes.grass, 160, 120); paint(img, disk(80, 60, 10)); applyRetouchOperation(img, createRetouchOperation('same', 'remove', [[0.5, 0.5]], { radius: 0.1 })); return img; };
    expect(Array.from(run().data)).toEqual(Array.from(run().data));
    const img = render(scenes.grass, 160, 120);
    const job = removeJob(img, createRetouchOperation('c', 'remove', [[0.5, 0.5]], { radius: 0.1 }));
    expect(() => inpaint(job.payload, { signal: { cancelled: true } })).toThrow(InpaintCancelled);
  });

  test('preview size and export size give the same fill up to resampling', () => {
    const op = createRetouchOperation('scale', 'remove', [[0.5, 0.5]], { radius: 0.1, hardness: 0.6 });
    const at = (w, h, scale) => { const img = render(scenes.sky, w, h, scale); paint(img, disk(w / 2, h / 2, w * 0.05)); applyRetouchOperation(img, op); return img; };
    const small = at(200, 140, 1);
    const big = at(800, 560, 4);
    let worst = 0;
    for (const [u, v] of [[0.5, 0.5], [0.47, 0.52], [0.53, 0.48]]) {
      const a = small.data[(Math.round(v * 140) * 200 + Math.round(u * 200)) * 4 + 1];
      const b = big.data[(Math.round(v * 560) * 800 + Math.round(u * 800)) * 4 + 1];
      worst = Math.max(worst, Math.abs(a - b));
    }
    expect(worst).toBeLessThan(6);
  });

  test('16-bit RAW and float HDR data are filled in their own range; the async path equals the sync one', async () => {
    const raw = { width: 120, height: 90, data: new Uint16Array(120 * 90 * 3) };
    for (let i = 0; i < raw.data.length; i += 3) { raw.data[i] = 30000; raw.data[i + 1] = 32000; raw.data[i + 2] = 28000; }
    for (let y = 40; y < 50; y += 1) for (let x = 55; x < 65; x += 1) raw.data.fill(500, (y * 120 + x) * 3, (y * 120 + x) * 3 + 3);
    const op = createRetouchOperation('raw', 'remove', [[0.5, 0.5]], { radius: 0.1 });
    applyRetouchOperation(raw, op);
    expect(Math.abs(raw.data[(45 * 120 + 60) * 3 + 1] - 32000)).toBeLessThan(400);
    const hdr = { width: 80, height: 60, data: new Float32Array(80 * 60 * 3).fill(4) };
    for (let y = 26; y < 34; y += 1) for (let x = 36; x < 44; x += 1) hdr.data.fill(0.01, (y * 80 + x) * 3, (y * 80 + x) * 3 + 3);
    applyRetouchOperation(hdr, createRetouchOperation('hdr', 'remove', [[0.5, 0.5]], { radius: 0.12 }));
    expect(hdr.data[(30 * 80 + 40) * 3]).toBeCloseTo(4, 1);
    const ops = normalizeRetouch([{ id: 'a', type: 'remove', points: [[0.3, 0.4]], radius: 0.08 }, { id: 'b', type: 'clone', points: [[0.7, 0.6]], radius: 0.05, offset: { x: -0.2, y: 0 } }]);
    const sync = render(scenes.grass, 160, 120);
    applyRetouch(sync, ops);
    const async = render(scenes.grass, 160, 120);
    await applyRetouchAsync(async, ops, { runRemove: async (payload) => inpaint(payload) });
    expect(Array.from(async.data)).toEqual(Array.from(sync.data));
  });
});
