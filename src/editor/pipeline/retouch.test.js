import { describe, expect, test } from 'vitest';
import { applyRetouch, applyRetouchOperation, brushFalloff, findHealSource, retouchBounds, retouchTouching } from './retouch.mjs';
import { createRetouchOperation, normalizeRetouch, retouchEqual } from '../model/retouch.mjs';

// A reproducible photo-like field: a diagonal light gradient with fine texture (RGBA8).
function texture(width, height, { channels = 4, scale = 1, max = 255 } = {}) {
  const data = channels === 4 ? new Uint8ClampedArray(width * height * 4) : new Uint16Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = x / width; const v = y / height;
      const base = 0.25 + 0.45 * u + 0.15 * v;
      const grain = 0.04 * Math.sin((x * 1.7) / scale) * Math.cos((y * 2.3) / scale) + 0.02 * Math.sin(((x + y) * 0.9) / scale);
      const i = (y * width + x) * channels;
      data[i] = Math.round((base + grain) * max);
      data[i + 1] = Math.round((base * 0.9 + grain) * max);
      data[i + 2] = Math.round((base * 0.7 + grain) * max);
      if (channels === 4) data[i + 3] = 255;
    }
  }
  return { width, height, data };
}
const blemish = (image, cx, cy, r, value = 20) => {
  const channels = image.data.length / (image.width * image.height);
  for (let y = Math.floor(cy - r); y <= cy + r; y += 1) for (let x = Math.floor(cx - r); x <= cx + r; x += 1) {
    if (Math.hypot(x - cx, y - cy) > r) continue; // eslint-disable-line no-continue
    const i = (y * image.width + x) * channels;
    image.data[i] = value; image.data[i + 1] = value; image.data[i + 2] = value;
  }
};
const meanIn = (image, test) => {
  let sum = 0; let n = 0;
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) if (test(x, y)) { sum += image.data[(y * image.width + x) * 4 + 1]; n += 1; }
  return sum / n;
};

describe('retouch data', () => {
  test('operations are normalised, clamped and stay within the limits', () => {
    const list = normalizeRetouch([
      { id: 'a', type: 'heal', points: [[0.5, 0.5]], radius: 9, hardness: -1, opacity: 2, offset: { x: 0.1, y: Number.NaN } },
      { id: 'a', type: 'clone', points: [[0.2, 0.2], [0.3, 0.3]], offset: { x: -0.05, y: 0 } },
      { type: 'erase', points: [[0, 0]] },
      { type: 'clone', points: [] },
    ]);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: 'a', radius: 0.25, hardness: 0, opacity: 1, offset: { x: 0.1, y: 0 }, enabled: true });
    expect(list[1].id).not.toBe('a');
    const long = normalizeRetouch([{ type: 'clone', points: Array.from({ length: 5000 }, (_, i) => [i / 5000, 0.5]) }]);
    expect(long[0].points.length).toBeLessThanOrEqual(1000);
    expect(long[0].points.at(-1)).toEqual([0.9998, 0.5]);
    expect(retouchEqual(list, normalizeRetouch(JSON.parse(JSON.stringify(list))))).toBe(true);
  });

  test('brush falloff: full inside the hardness, smooth to zero at the edge', () => {
    expect(brushFalloff(0.2, 0.5)).toBe(1);
    expect(brushFalloff(0.75, 0.5)).toBeCloseTo(0.5, 5);
    expect(brushFalloff(1, 0.5)).toBe(0);
    expect(brushFalloff(0.99, 1)).toBe(1);
  });
});

describe('clone stamp', () => {
  test('a hard brush copies the source exactly at the offset; nothing outside the brush changes', () => {
    const image = texture(200, 120);
    const before = new Uint8ClampedArray(image.data);
    const op = createRetouchOperation('c1', 'clone', [[0.5, 0.5]], { radius: 0.1, hardness: 1, opacity: 1 }, { x: 0.2, y: 0 });
    const box = applyRetouchOperation(image, op);
    expect(box).toEqual({ x0: 87, y0: 47, x1: 113, y1: 73 });
    for (const [x, y] of [[100, 60], [95, 55], [106, 64]]) {
      for (let k = 0; k < 3; k += 1) expect(image.data[(y * 200 + x) * 4 + k]).toBe(before[(y * 200 + x + 40) * 4 + k]);
    }
    // Outside the brush, and every alpha value, untouched.
    let changedOutside = 0;
    for (let y = 0; y < 120; y += 1) for (let x = 0; x < 200; x += 1) {
      const i = (y * 200 + x) * 4;
      if (Math.hypot(x + 0.5 - 100, y + 0.5 - 60) > 12.5 && image.data[i] !== before[i]) changedOutside += 1;
      expect(image.data[i + 3]).toBe(255);
    }
    expect(changedOutside).toBe(0);
  });

  test('a stroke keeps one offset along its path; a source outside the photo leaves the target alone', () => {
    const image = texture(200, 120);
    const before = new Uint8ClampedArray(image.data);
    applyRetouchOperation(image, createRetouchOperation('c2', 'clone', [[0.2, 0.3], [0.6, 0.3]], { radius: 0.05, hardness: 1 }, { x: 0, y: 0.4 }));
    for (const x of [45, 80, 115]) expect(image.data[(36 * 200 + x) * 4]).toBe(before[((36 + 48) * 200 + x) * 4]);
    const edge = texture(200, 120);
    const untouched = new Uint8ClampedArray(edge.data);
    applyRetouchOperation(edge, createRetouchOperation('c3', 'clone', [[0.98, 0.5]], { radius: 0.05, hardness: 1 }, { x: 0.1, y: 0 }));
    expect(Array.from(edge.data)).toEqual(Array.from(untouched));
  });
});

describe('spot healing', () => {
  test('removes a blemish from texture: the patch takes the surrounding tone, without a halo or seam', () => {
    const clean = texture(240, 160);
    const image = texture(240, 160);
    blemish(image, 120, 80, 6);
    const op = createRetouchOperation('h1', 'heal', [[0.5, 0.5]], { radius: 0.075, hardness: 0.4 }, { x: 0, y: 0 });
    const source = findHealSource(image, op);
    expect(source).not.toBeNull();
    applyRetouchOperation(image, { ...op, offset: source });
    // The healed spot matches the clean photo's tone there, within the texture's own amplitude.
    const healed = meanIn(image, (x, y) => Math.hypot(x - 120, y - 80) <= 6);
    const truth = meanIn(clean, (x, y) => Math.hypot(x - 120, y - 80) <= 6);
    expect(Math.abs(healed - truth)).toBeLessThan(6);
    // No halo: the ring at the brush edge stays as bright as the clean photo's.
    const ring = (img) => meanIn(img, (x, y) => { const d = Math.hypot(x - 120, y - 80); return d > 9 && d < 12; });
    expect(Math.abs(ring(image) - ring(clean))).toBeLessThan(3);
    // No seam: the largest step between neighbours near the edge is no bigger than the texture's own.
    const step = (img) => {
      let worst = 0;
      for (let y = 66; y < 94; y += 1) for (let x = 106; x < 134; x += 1) worst = Math.max(worst, Math.abs(img.data[(y * 240 + x) * 4 + 1] - img.data[(y * 240 + x + 1) * 4 + 1]));
      return worst;
    };
    expect(step(image)).toBeLessThanOrEqual(step(clean) + 4);
  });

  test('a copied patch without healing keeps the source tone; healing corrects it to the target', () => {
    const image = texture(240, 160);
    const op = { ...createRetouchOperation('h2', 'heal', [[0.3, 0.5]], { radius: 0.06, hardness: 0.5 }, { x: 0.4, y: 0 }) };
    const cloned = texture(240, 160);
    applyRetouchOperation(cloned, { ...op, type: 'clone' });
    applyRetouchOperation(image, op);
    const original = texture(240, 160);
    const at = (img) => meanIn(img, (x, y) => Math.hypot(x - 72, y - 80) <= 4);
    // The source is 96 px to the right, much brighter; healing brings the spot back to its own tone.
    expect(at(cloned) - at(original)).toBeGreaterThan(20);
    expect(Math.abs(at(image) - at(original))).toBeLessThan(4);
  });

  test('the automatic source clears the stroke and stays inside the photo, even near an edge', () => {
    const image = texture(240, 160);
    const op = createRetouchOperation('h3', 'heal', [[0.04, 0.06]], { radius: 0.03 }, { x: 0, y: 0 });
    const { x, y } = findHealSource(image, op);
    const r = 0.03 * 160;
    expect(Math.hypot(x * 240, y * 160)).toBeGreaterThan(2 * r);
    expect(0.04 * 240 + x * 240).toBeGreaterThan(r);
    expect(0.06 * 160 + y * 160).toBeGreaterThan(r);
  });

  test('deterministic, and a preview-size render matches an export-size render up to resampling', () => {
    const ops = normalizeRetouch([
      { id: 'a', type: 'heal', points: [[0.4, 0.4]], radius: 0.05, hardness: 0.5, offset: { x: 0.15, y: 0.05 } },
      { id: 'b', type: 'clone', points: [[0.7, 0.6], [0.75, 0.62]], radius: 0.03, hardness: 0.7, offset: { x: -0.2, y: 0 } },
    ]);
    const make = (w, h) => {
      const img = texture(w, h, { scale: w / 240 });
      blemish(img, w * 0.4, h * 0.4, w * 0.02);
      applyRetouch(img, ops);
      return img;
    };
    const a = make(240, 160);
    const again = make(240, 160);
    expect(Array.from(again.data)).toEqual(Array.from(a.data));
    const big = make(960, 640);
    let worst = 0;
    for (const [u, v] of [[0.4, 0.4], [0.42, 0.38], [0.7, 0.6], [0.74, 0.62]]) {
      const small = a.data[(Math.round(v * 160) * 240 + Math.round(u * 240)) * 4 + 1];
      const large = big.data[(Math.round(v * 640) * 960 + Math.round(u * 960)) * 4 + 1];
      worst = Math.max(worst, Math.abs(small - large));
    }
    expect(worst).toBeLessThan(12);
  });

  test('16-bit RAW data and float HDR data are healed in their own range', () => {
    const raw = texture(160, 120, { channels: 3, max: 65535 });
    blemish(raw, 80, 60, 5, 1000);
    const op = createRetouchOperation('h4', 'heal', [[0.5, 0.5]], { radius: 0.08 }, { x: 0.25, y: 0 });
    applyRetouchOperation(raw, op);
    expect(raw.data[(60 * 160 + 80) * 3 + 1]).toBeGreaterThan(20000);
    const hdr = { width: 64, height: 64, data: new Float32Array(64 * 64 * 3).fill(2.5) };
    applyRetouchOperation(hdr, createRetouchOperation('h5', 'heal', [[0.5, 0.5]], { radius: 0.1 }, { x: 0.3, y: 0 }));
    expect(hdr.data[(32 * 64 + 32) * 3]).toBeCloseTo(2.5, 4);
  });
});

test('bounds and the operations touching a region', () => {
  const op = createRetouchOperation('b', 'clone', [[0.1, 0.1]], { radius: 0.05 }, { x: 0.5, y: 0 });
  expect(retouchBounds(op, 100, 100)).toEqual({ x0: 4, y0: 4, x1: 16, y1: 16 });
  expect(retouchTouching([op], 100, 100, { x: 50, y: 50, width: 10, height: 10 })).toEqual([]);
  expect(retouchTouching([op], 100, 100, { x: 10, y: 10, width: 10, height: 10 })).toEqual([op]);
  expect(retouchTouching([{ ...op, enabled: false }], 100, 100, { x: 10, y: 10, width: 10, height: 10 })).toEqual([]);
});
