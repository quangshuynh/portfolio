import { describe, expect, test } from 'vitest';
import { GUIDE_OFF, drawGuides, findStructures } from './structure.mjs';
import { applyRetouchOperation, removeJob } from './retouch.mjs';
import { createRetouchOperation } from '../model/retouch.mjs';

// Reproducible scenes (RGBA8) with a known truth; the object is painted magenta.
function render(scene, width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const [r, g, b] = scene(x, y, width, height);
    const i = (y * width + x) * 4;
    data[i] = Math.round(r * 255); data[i + 1] = Math.round(g * 255); data[i + 2] = Math.round(b * 255); data[i + 3] = 255;
  }
  return { width, height, data };
}
function paint(image, inside) {
  const out = { ...image, data: image.data.slice() };
  for (let y = 0; y < out.height; y += 1) for (let x = 0; x < out.width; x += 1) {
    if (!inside(x, y)) continue; // eslint-disable-line no-continue
    const i = (y * out.width + x) * 4;
    out.data[i] = 230; out.data[i + 1] = 20; out.data[i + 2] = 190;
  }
  return out;
}
const disk = (cx, cy, r) => (x, y) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r;
const sky = (x, y, w, h) => { const v = 0.5 + 0.35 * (y / h); return [v * 0.7, v * 0.85, v]; };
// Three thin dark wires at 28°.
const wires = (x, y, w, h) => {
  const d = (y - h / 2 - 0.53 * (x - w / 2)) / Math.hypot(1, 0.53);
  return [-18, 0, 18].some((c) => Math.abs(d - c) < 0.9) ? [0.15, 0.15, 0.17] : sky(x, y, w, h);
};
// A grey kerb under dark asphalt, its edge gently curved.
const kerb = (x, y, w, h) => (y > h * 0.45 + 0.0018 * (x - w / 2) ** 2 ? [0.55, 0.54, 0.52] : [0.3, 0.31, 0.33]);
// A post that ends inside the hole (evidence on one side only).
const post = (x, y) => (Math.abs(x - 160) < 3 && y < 120 ? [0.2, 0.2, 0.22] : [0.6, 0.6, 0.58]);

/** The pyramid level findStructures sees for a Remove at one point of an image. */
function levelOf(image, cx, cy, radius) {
  const op = createRetouchOperation('s', 'remove', [[cx / image.width, cy / image.height]], { radius: radius / Math.min(image.width, image.height), hardness: 0.6 });
  const { payload } = removeJob(image, op);
  let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1;
  payload.hole.forEach((h, i) => {
    if (!h) return;
    const x = i % payload.width; const y = (i - x) / payload.width;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  });
  return { ...payload, bounds: { x0, y0, x1, y1 } };
}
const meanError = (image, clean, inside) => {
  let sum = 0; let n = 0;
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
    if (!inside(x, y)) continue; // eslint-disable-line no-continue
    const i = (y * image.width + x) * 4;
    sum += (Math.abs(image.data[i] - clean.data[i]) + Math.abs(image.data[i + 1] - clean.data[i + 1]) + Math.abs(image.data[i + 2] - clean.data[i + 2])) / 3; n += 1;
  }
  return sum / n;
};

describe('structure guidance for Remove', () => {
  test('finds each wire crossing a large hole and pairs its two ends in line', () => {
    const level = levelOf(paint(render(wires, 320, 240), disk(160, 120, 28)), 160, 120, 34);
    const guides = findStructures(level);
    expect(guides.length).toBeGreaterThanOrEqual(3);
    for (const { hole: [a, b], confidence } of guides) {
      expect(Math.abs((b[1] - a[1]) / (b[0] - a[0]) - 0.53)).toBeLessThan(0.05);
      expect(confidence).toBeGreaterThan(0.45);
    }
  });

  test('a gently curved edge is paired as an arc', () => {
    const level = levelOf(paint(render(kerb, 320, 240), disk(200, 120, 30)), 200, 120, 36);
    const guides = findStructures(level);
    expect(guides.length).toBeGreaterThanOrEqual(1);
    // The path through the hole bends the way the kerb does (below the chord in the middle).
    const { path, hole: [a, b] } = guides[0];
    const middle = path.reduce((best, p) => (Math.abs(p[0] - (a[0] + b[0]) / 2) < Math.abs(best[0] - (a[0] + b[0]) / 2) ? p : best));
    expect(middle[1]).toBeLessThan((a[1] + b[1]) / 2);
  });

  test('no guide without evidence on both sides, and none on plain sky', () => {
    expect(findStructures(levelOf(paint(render(post, 320, 240), disk(160, 128, 26)), 160, 128, 32))).toEqual([]);
    expect(findStructures(levelOf(paint(render(sky, 200, 140), disk(100, 70, 12)), 100, 70, 17))).toEqual([]);
  });

  test('the guide channel is signed across a guide and off elsewhere', () => {
    const channel = drawGuides({ width: 40, height: 20 }, [{ path: [[0, 10], [39, 10]] }], 1);
    expect(channel[10 * 40 + 20]).toBeCloseTo(0, 5);
    expect(Math.sign(channel[7 * 40 + 20])).toBe(-Math.sign(channel[13 * 40 + 20]));
    expect(channel[0]).toBe(GUIDE_OFF);
  });

  test('a large removal across wires continues them (and the same seed gives the same fill)', () => {
    const clean = render(wires, 320, 240);
    const run = () => {
      const image = paint(clean, disk(160, 120, 28));
      applyRetouchOperation(image, createRetouchOperation('wires', 'remove', [[0.5, 0.5]], { radius: 34 / 240, hardness: 0.6 }));
      return image;
    };
    const image = run();
    // Along each wire inside the hole the fill is dark (the wire), not sky: unguided, the wires
    // stopped at the hole's edge (Interval 19: continuity 0.16 in scripts/bench-remove.mjs).
    for (const offset of [-18, 0, 18]) {
      let dark = 0; let n = 0;
      for (let x = 145; x <= 175; x += 1) {
        // Nearest pixel row on the wire (its centre line, offset across the 28° slope).
        const y = Math.round(120 + 0.53 * (x - 160) + offset * Math.hypot(1, 0.53) - 0.5);
        if (!disk(160, 120, 24)(x, y)) continue; // eslint-disable-line no-continue
        const i = (y * 320 + x) * 4;
        n += 1; if (Math.min(image.data[i], image.data[i + 1], image.data[i + 2]) < 110) dark += 1;
      }
      expect(dark / n).toBeGreaterThan(0.7);
    }
    expect(meanError(image, clean, disk(160, 120, 26))).toBeLessThan(14);

    expect(run().data).toEqual(image.data);
  });
});
