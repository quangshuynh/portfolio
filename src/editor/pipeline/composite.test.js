import { describe, expect, test } from 'vitest';
import { BLEND_CODES, blendRgb } from './blend.mjs';
import { adjustmentPass, compositeImage, compositeImageSync, rasterPass } from './composite.mjs';
import { layerCorners, layerMatrix, offsetMatrix, rasterBounds, rasterSize } from './layerTransform.mjs';
import { BLEND_MODES, createAdjustmentLayer, createImageLayer, normalizeLayer } from '../model/layers.mjs';
import { renderRgba8 } from './cpuRenderer.mjs';
import { sourceRows } from './warp.mjs';
import { handlers } from '../io/imageTasks.mjs';
import { deriveParams } from './spec.mjs';
import { normalizeAdjustments } from '../model/adjustments.mjs';

// Independent reference: the W3C Compositing and Blending Level 1 pseudo-code written out as
// published (max/mid/min assignment for SetSat), not shared with blend.mjs.
const W3C = {
  normal: (b, s) => s,
  multiply: (b, s) => b * s,
  screen: (b, s) => b + s - b * s,
  overlay: (b, s) => W3C['hard-light'](s, b),
  darken: Math.min,
  lighten: Math.max,
  'color-dodge': (b, s) => { if (b === 0) return 0; if (s === 1) return 1; return Math.min(1, b / (1 - s)); },
  'color-burn': (b, s) => { if (b === 1) return 1; if (s === 0) return 0; return 1 - Math.min(1, (1 - b) / s); },
  'hard-light': (b, s) => (s <= 0.5 ? W3C.multiply(b, 2 * s) : W3C.screen(b, 2 * s - 1)),
  'soft-light': (b, s) => {
    if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
    const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
    return b + (2 * s - 1) * (d - b);
  },
  difference: (b, s) => Math.abs(b - s),
  exclusion: (b, s) => b + s - 2 * b * s,
};
const Lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
function ClipColor(c) {
  const l = Lum(c);
  const n = Math.min(...c);
  const x = Math.max(...c);
  let out = [...c];
  if (n < 0) out = out.map((v) => l + ((v - l) * l) / (l - n));
  if (x > 1) out = out.map((v) => l + ((v - l) * (1 - l)) / (x - l));
  return out;
}
const SetLum = (c, l) => ClipColor(c.map((v) => v + l - Lum(c)));
const Sat = (c) => Math.max(...c) - Math.min(...c);
function SetSat(c, s) {
  const order = [0, 1, 2].sort((a, b) => c[a] - c[b]);
  const [min, mid, max] = order;
  const out = [0, 0, 0];
  if (c[max] > c[min]) {
    out[mid] = ((c[mid] - c[min]) * s) / (c[max] - c[min]);
    out[max] = s;
  }
  out[min] = 0;
  return out;
}
const W3C_NON_SEPARABLE = {
  hue: (b, s) => SetLum(SetSat(s, Sat(b)), Lum(b)),
  saturation: (b, s) => SetLum(SetSat(b, Sat(s)), Lum(b)),
  color: (b, s) => SetLum(s, Lum(b)),
  luminosity: (b, s) => SetLum(b, Lum(s)),
};
function referenceComposite(mode, backdrop, source, alphaS) {
  const cb = backdrop.slice(0, 3).map((v) => v / 255);
  const cs = source.slice(0, 3).map((v) => v / 255);
  const ab = backdrop[3] / 255;
  const B = W3C_NON_SEPARABLE[mode] ? W3C_NON_SEPARABLE[mode](cb, cs) : cb.map((b, i) => W3C[mode](b, cs[i]));
  const ao = alphaS + ab * (1 - alphaS);
  const co = cs.map((s, i) => alphaS * ((1 - ab) * s + ab * B[i]) + (1 - alphaS) * ab * cb[i]);
  return [...co.map((v) => Math.round((v / ao) * 255)), Math.round(ao * 255)];
}

const image = (width, height, fill) => ({ width, height, data: Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => fill(Math.floor(i / 4) % width, Math.floor(i / 4 / width), i % 4)) });
const solid = (width, height, rgba) => image(width, height, (x, y, c) => rgba[c]);
const pixel = (img, x, y) => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
const source = { sha256: 'a'.repeat(64), name: 'layer.png', size: 1, format: 'png', width: 4, height: 4 };
const layer = (patch = {}) => normalizeLayer({ id: 'L1', type: 'image', source, x: 0.5, y: 0.5, width: 0.5, height: 0.5, ...patch });

describe('blend modes', () => {
  test('every menu mode has a code, and the codes match the W3C formulas on a grid of colours', () => {
    expect(BLEND_MODES.map(({ id }) => id).every((id) => Number.isInteger(BLEND_CODES[id]))).toBe(true);
    const levels = [0, 1, 30, 64, 127, 128, 190, 254, 255];
    const out = [0, 0, 0];
    for (const mode of BLEND_MODES.map(({ id }) => id)) {
      for (const b of levels) {
        for (const s of levels) {
          const cb = [b / 255, (255 - b) / 255, ((b * 7) % 256) / 255];
          const cs = [s / 255, ((s * 3) % 256) / 255, (255 - s) / 255];
          blendRgb(BLEND_CODES[mode], ...cb, ...cs, out);
          const expected = W3C_NON_SEPARABLE[mode] ? W3C_NON_SEPARABLE[mode](cb, cs) : cb.map((v, i) => W3C[mode](v, cs[i]));
          out.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 12));
        }
      }
    }
  });

  test('known values (independent of either implementation)', () => {
    const out = [0, 0, 0];
    const at = (mode, b, s) => blendRgb(BLEND_CODES[mode], b, b, b, s, s, s, out)[0];
    expect(at('multiply', 0.5, 0.5)).toBe(0.25);
    expect(at('screen', 0.5, 0.5)).toBe(0.75);
    expect(at('overlay', 0.25, 0.5)).toBe(0.25);
    expect(at('hard-light', 0.25, 1)).toBe(1);
    expect(at('difference', 0.2, 0.7)).toBeCloseTo(0.5, 12);
    expect(at('exclusion', 0.5, 0.5)).toBe(0.5);
    expect(at('color-dodge', 0.5, 0.5)).toBe(1);
    expect(at('color-burn', 0.5, 0.5)).toBe(0);
    expect(at('soft-light', 0.25, 0.75)).toBeCloseTo(0.25 + 0.5 * (((16 * 0.25 - 12) * 0.25 + 4) * 0.25 - 0.25), 12);
    // Luminosity of grey on a colour keeps the colour's hue with the grey's lightness.
    blendRgb(BLEND_CODES.luminosity, 1, 0, 0, 0.5, 0.5, 0.5, out);
    expect(0.3 * out[0] + 0.59 * out[1] + 0.11 * out[2]).toBeCloseTo(0.5, 12);
  });

  test('pixel composites equal the W3C general formula with alpha on both sides (within rounding)', () => {
    const backdrops = [[200, 40, 90, 255], [10, 220, 180, 128], [120, 120, 120, 0], [255, 255, 255, 64]];
    const sources = [[30, 160, 240, 255], [250, 10, 10, 90], [0, 0, 0, 200]];
    for (const { id: mode } of BLEND_MODES) {
      for (const b of backdrops) {
        for (const s of sources) {
          const canvas = { width: 1, height: 1, data: Uint8ClampedArray.from(b) };
          const raster = { width: 1, height: 1, data: Uint8ClampedArray.from(s) };
          compositeImageSync(canvas, [{ ...rasterPass({ id: 'x', opacity: 0.8, blend: mode }, raster, offsetMatrix(0, 0), canvas) }]);
          const expected = referenceComposite(mode, b, s, (s[3] / 255) * 0.8);
          const got = Array.from(canvas.data);
          // Colour is undefined where the result is fully transparent.
          if (expected[3] === 0) expect(got[3]).toBe(0);
          else got.forEach((v, i) => expect(Math.abs(v - expected[i])).toBeLessThanOrEqual(1));
        }
      }
    }
  });
});

describe('raster passes', () => {
  test('a layer at 0% opacity, or fully transparent, leaves the canvas bit for bit', () => {
    const base = image(9, 7, (x, y, c) => (c === 3 ? 255 : (x * 29 + y * 13 + c * 70) % 256));
    const before = Uint8ClampedArray.from(base.data);
    const raster = image(4, 4, (x, y, c) => (c === 3 ? 0 : 200));
    compositeImageSync(base, [rasterPass(layer(), raster, layerMatrix(layer(), base, raster), base)]);
    compositeImageSync(base, [rasterPass(layer({ opacity: 0 }), solid(4, 4, [255, 0, 0, 255]), layerMatrix(layer(), base, raster), base)]);
    expect(base.data).toEqual(before);
  });

  test('an unscaled, unrotated layer copies its pixels exactly; Normal at 100% replaces the backdrop', () => {
    const base = solid(8, 8, [10, 20, 30, 255]);
    const raster = image(4, 4, (x, y, c) => (c === 3 ? 255 : (x * 50 + y * 20 + c * 30) % 256));
    // Box of 4 px on an 8 px canvas (short edge 8 → width 0.5), centred: raster px = canvas px − 2.
    const l = layer();
    const m = layerMatrix(l, base, raster);
    expect(m).toEqual([1, 0, -2, 0, 1, -2, 0, 0, 1]);
    compositeImageSync(base, [rasterPass(l, raster, m, base)]);
    expect(pixel(base, 2, 2)).toEqual(pixel(raster, 0, 0));
    expect(pixel(base, 5, 5)).toEqual(pixel(raster, 3, 3));
    expect(pixel(base, 1, 1)).toEqual([10, 20, 30, 255]);
    expect(pixel(base, 6, 6)).toEqual([10, 20, 30, 255]);
  });

  test('scaled transparent edges never darken: semi-transparent pixels keep the layer colour', () => {
    const canvas = solid(40, 40, [0, 0, 0, 0]);
    // A red square with a transparent border, upscaled and rotated.
    const raster = image(8, 8, (x, y, c) => (x > 1 && x < 6 && y > 1 && y < 6 ? [255, 0, 0, 255][c] : [0, 255, 0, 0][c]));
    const l = layer({ source: { ...source, width: 8, height: 8 }, width: 0.6, height: 0.6, rotation: 17 });
    compositeImageSync(canvas, [rasterPass(l, raster, layerMatrix(l, canvas, raster), canvas)]);
    let partial = 0;
    for (let i = 0; i < canvas.data.length; i += 4) {
      const a = canvas.data[i + 3];
      if (a > 0 && a < 255) {
        partial += 1;
        // Premultiplied interpolation: no green from the transparent pixels, no darkening.
        expect(canvas.data[i]).toBe(255);
        expect(canvas.data[i + 1]).toBe(0);
      }
    }
    expect(partial).toBeGreaterThan(20);
  });

  test('bands and tiles give the same pixels as one pass (no seams)', async () => {
    const make = () => image(37, 53, (x, y, c) => (c === 3 ? 255 : (x * 7 + y * 11 + c * 50) % 256));
    const raster = image(16, 12, (x, y, c) => (c === 3 ? (x + y) * 10 : (x * 15 + c * 80) % 256));
    const l = layer({ source: { ...source, width: 16, height: 12 }, width: 0.7, height: 0.5, rotation: -33, x: 0.45, y: 0.55, flipH: true, blend: 'overlay', opacity: 0.85 });
    const adjust = createAdjustmentLayer('A1', { exposure: 0.6, saturation: -40, curves: { master: [[0, 20], [255, 230]] } });
    const run = async (bandRows) => {
      const canvas = make();
      await compositeImage(canvas, [rasterPass(l, raster, layerMatrix(l, canvas, raster), canvas), adjustmentPass(adjust)], { bandRows });
      return canvas.data;
    };
    const whole = await run(1000);
    expect(await run(1)).toEqual(whole);
    expect(await run(7)).toEqual(whole);
  });
});

describe('band workers', () => {
  test('a band holding only the raster rows it reads gives the same pixels as the whole pass', async () => {
    const make = () => image(64, 300, (x, y, c) => (c === 3 ? 255 : (x * 3 + y + c * 60) % 256));
    const raster = image(40, 90, (x, y, c) => (c === 3 ? 255 - y : (x * 6 + c * 40) % 256));
    const l = layer({ source: { ...source, width: 40, height: 90 }, width: 0.5, height: 1.1, rotation: 8, blend: 'hard-light', opacity: 0.9 });
    const whole = make();
    const pass = rasterPass(l, raster, layerMatrix(l, whole, raster), whole);
    compositeImageSync(whole, [pass]);
    const banded = make();
    const { raster: full, ...plain } = pass;
    for (let row = 0; row < banded.height; row += 64) {
      const end = Math.min(banded.height, row + 64);
      const [top, bottom] = sourceRows(pass.matrix, banded.width, row, end, full.height);
      const slice = { width: full.width, height: full.height, top, data: full.data.slice(top * full.width * 4, bottom * full.width * 4) };
      const rows = banded.data.slice(row * 64 * 4, end * 64 * 4);
      const { result } = await handlers.compositeRows({ pass: plain, raster: slice, rows, width: 64, y0: row, y1: end });
      banded.data.set(result, row * 64 * 4);
    }
    expect(banded.data).toEqual(whole.data);
  });
});

describe('adjustment layers', () => {
  test('affect only what is below them; visibility and opacity scale the change', () => {
    const base = solid(6, 6, [100, 100, 100, 255]);
    const top = solid(2, 2, [50, 150, 250, 255]);
    const l = layer({ source: { ...source, width: 2, height: 2 }, width: 2 / 6, height: 2 / 6 });
    const adjust = createAdjustmentLayer('A1', { exposure: 1 });
    const brightened = renderRgba8(Uint8ClampedArray.from([100, 100, 100, 255]), deriveParams(normalizeAdjustments({ exposure: 1 })));
    const passes = [adjustmentPass(adjust), rasterPass(l, top, layerMatrix(l, base, top), base)];
    compositeImageSync(base, passes);
    expect(pixel(base, 0, 0)).toEqual(Array.from(brightened));
    // The layer above the adjustment is untouched.
    expect(pixel(base, 2, 2)).toEqual([50, 150, 250, 255]);
    // Reordered (adjustment on top), it changes the layer too.
    const again = solid(6, 6, [100, 100, 100, 255]);
    compositeImageSync(again, [passes[1], passes[0]]);
    expect(pixel(again, 2, 2)).not.toEqual([50, 150, 250, 255]);
    // Half opacity lands halfway (in encoded values).
    const half = solid(1, 1, [100, 100, 100, 255]);
    compositeImageSync(half, [adjustmentPass({ ...adjust, opacity: 0.5 })]);
    expect(Math.abs(half.data[0] - (100 + brightened[0]) / 2)).toBeLessThanOrEqual(0.5);
  });

  test('keep the backdrop alpha', () => {
    const canvas = { width: 1, height: 1, data: Uint8ClampedArray.from([100, 50, 25, 77]) };
    compositeImageSync(canvas, [adjustmentPass(createAdjustmentLayer('A1', { exposure: -1 }))]);
    expect(canvas.data[3]).toBe(77);
  });
});

describe('layer transforms', () => {
  test('the matrix maps each box corner onto the matching raster corner, with flips and rotation', () => {
    const canvas = { width: 1200, height: 800 };
    const l = layer({ source: { ...source, width: 300, height: 200 }, x: 0.3, y: 0.6, width: 0.6, height: 0.4, rotation: 30, flipV: true });
    const raster = { width: 300, height: 200 };
    const m = layerMatrix(l, canvas, raster);
    const map = ([x, y]) => [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]];
    const corners = layerCorners(l, canvas).map(map);
    [[0, 0], [300, 0], [300, 200], [0, 200]].forEach((expected, i) => {
      expect(corners[i][0]).toBeCloseTo(expected[0], 6);
      expect(corners[i][1]).toBeCloseTo(expected[1], 6);
    });
    const bounds = rasterBounds(m, raster, canvas);
    expect(bounds.x).toBeLessThanOrEqual(Math.min(...layerCorners(l, canvas).map(([x]) => x)));
  });

  test('raster size: one raster pixel per canvas pixel, never more than the source', () => {
    const l = layer({ source: { ...source, width: 6000, height: 4000 }, width: 0.3, height: 0.2 });
    expect(rasterSize(l, { width: 3000, height: 2000 })).toEqual({ width: 600, height: 400 });
    expect(rasterSize({ ...l, width: 9, height: 6 }, { width: 3000, height: 2000 })).toEqual({ width: 6000, height: 4000 });
    // Positions are relative to the canvas, so a 300 px render places the layer where the full size does.
    const small = layerCorners(l, { width: 300, height: 200 });
    const full = layerCorners(l, { width: 3000, height: 2000 });
    small.forEach(([x, y], i) => { expect(x * 10).toBeCloseTo(full[i][0], 6); expect(y * 10).toBeCloseTo(full[i][1], 6); });
  });

  test('new image layers fit the canvas with their own proportions', () => {
    const l = createImageLayer('img', { ...source, width: 400, height: 100 }, { width: 1000, height: 500 });
    const corners = layerCorners(l, { width: 1000, height: 500 });
    expect(corners[1][0] - corners[0][0]).toBeCloseTo(600, 6);
    expect(corners[2][1] - corners[1][1]).toBeCloseTo(150, 6);
  });
});
