// @vitest-environment node
// Detail stage (detail.mjs, detailRenderer.mjs) on synthetic images with known structure:
// neutral identity, each control's direction and limits, distinct filters, alpha, tiling,
// resolution independence, cancellation and memory bounds.

import { describe, expect, test } from 'vitest';
import { ADJUSTMENTS, groupKeys, normalizeAdjustments } from '../model/adjustments.mjs';
import { renderRawRgba8, renderRgba8 } from './cpuRenderer.mjs';
import { DETAIL, boxRadiusForSigma, detailHalo } from './detail.mjs';
import { DETAIL_BAND_ROWS, DETAIL_TILE, createAreaAccumulator, prepareDetailRender, renderDetailImage, renderDetailRows } from './detailRenderer.mjs';
import { deriveParams } from './spec.mjs';
import { SYNTHETIC_RAW_INFO, random, syntheticRawFrame } from '../dev/hdrFixtures.mjs';

const DETAIL_KEYS = ['texture', 'clarity', 'dehaze', 'sharpening', 'luminanceNoise', 'colorNoise'];

/** RGBA8 image from fn(x, y) -> [r, g, b, a?] in 0–255 (encoded). */
function image(width, height, fn) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a = 255] = fn(x, y);
      data.set([r, g, b, a], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

const render = (img, settings, options) => renderDetailImage(img, deriveParams(settings), options);
const luma = (data, i) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
function difference(a, b) {
  let max = 0;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = Math.abs(a[i] - b[i]);
    max = Math.max(max, d);
    sum += d;
  }
  return { max, mean: sum / a.length };
}
/** Standard deviation of luma over a rectangle (after removing its mean). */
function lumaStd(img, data, x0, y0, w, h) {
  let sum = 0;
  let sq = 0;
  for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) { const v = luma(data, (y * img.width + x) * 4); sum += v; sq += v * v; }
  const n = w * h;
  return Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2));
}
const meanLuma = (img, data, x0, y0, w, h) => {
  let sum = 0;
  for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) sum += luma(data, (y * img.width + x) * 4);
  return sum / (w * h);
};

const noisy = (seed, sigma) => { const rand = random(seed); return () => (rand() + rand() + rand() - 1.5) * 2 * sigma; };

describe('controls and parameters', () => {
  test('six Detail controls with the documented ranges, all neutral at 0', () => {
    expect(groupKeys('detail')).toEqual(DETAIL_KEYS);
    const ranges = Object.fromEntries(ADJUSTMENTS.filter(({ group }) => group === 'detail').map(({ key, min, max, default: neutral }) => [key, [min, max, neutral]]));
    expect(ranges).toEqual({
      texture: [-100, 100, 0], clarity: [-100, 100, 0], dehaze: [-100, 100, 0],
      sharpening: [0, 100, 0], luminanceNoise: [0, 100, 0], colorNoise: [0, 100, 0],
    });
    expect(normalizeAdjustments({ sharpening: -20, texture: 300 })).toMatchObject({ sharpening: 0, texture: 100 });
  });

  test('neutral Detail leaves every existing parameter, including `neutral`, as before', () => {
    const plain = deriveParams({});
    expect(plain.detailActive).toBe(false);
    expect(plain.neutral).toBe(true);
    const sharpened = deriveParams({ sharpening: 1 });
    expect(sharpened.detailActive).toBe(true);
    expect(sharpened.neutral).toBe(false);
    expect(sharpened.baseNeutral).toBe(true);
    expect(sharpened.postActive).toBe(false);
  });

  test('halo covers every fine filter radius and grows with the render scale', () => {
    const all = deriveParams(Object.fromEntries(DETAIL_KEYS.map((key) => [key, 100]))).detail;
    expect(detailHalo(all, 1)).toBe(Math.ceil(DETAIL.colorRadius[1]) + 3 * Math.ceil(boxRadiusForSigma(DETAIL.textureCoarse)));
    expect(detailHalo(all, 0.25)).toBeLessThan(detailHalo(all, 1));
    expect(detailHalo(deriveParams({ clarity: 100, dehaze: 100 }).detail, 1)).toBe(0);
  });

  test('box radius for a Gaussian: three boxes match the variance, fractional radii vary smoothly', () => {
    const variance = (r) => {
      const n = Math.floor(r); const f = r - n;
      let sum = 0; for (let k = -n; k <= n; k += 1) sum += k * k;
      return (sum + 2 * f * (n + 1) ** 2) / (2 * n + 1 + 2 * f);
    };
    for (const sigma of [0.2, 0.5, 1, 1.7, 4, 9]) expect(3 * variance(boxRadiusForSigma(sigma))).toBeCloseTo(sigma * sigma, 6);
    expect(boxRadiusForSigma(0)).toBe(0);
  });
});

describe('neutral identity', () => {
  const rand = random(3);
  const photo = image(97, 61, (x, y) => [40 + ((x * 7 + y * 3) % 180), 30 + rand() * 200, (x * y) % 256, 255]);

  test('all-zero Detail through the detail renderer equals the per-pixel renderer', () => {
    for (const settings of [{}, { contrast: 30, exposure: 0.5 }, { curves: { master: [[0, 10], [128, 140], [255, 250]] } }, { redSaturation: -40, blueHue: 30, vibrance: 20 }]) {
      // Float32 planes move values that sit exactly on a rounding boundary by one code;
      // the editor never sends zero Detail here, so its output stays bit for bit.
      const diff = difference(render(photo, settings), renderRgba8(photo.data, deriveParams(settings)));
      expect(diff.max).toBeLessThanOrEqual(1);
      expect(diff.mean).toBeLessThan(0.01);
    }
  });

  test('RAW and merged HDR sources: all-zero Detail equals renderRawRgba8', () => {
    const raw = syntheticRawFrame(80, 56, { seed: 4 });
    const params = deriveParams({ exposure: 0.3 }, { raw: SYNTHETIC_RAW_INFO });
    expect(difference(renderDetailImage(raw, params), renderRawRgba8(raw.data, params)).max).toBeLessThanOrEqual(1);
    const hdr = { kind: 'hdr', width: 64, height: 40, data: Float32Array.from({ length: 64 * 40 * 3 }, (_, i) => ((i * 37) % 400) / 100) };
    const hdrParams = deriveParams({}, { raw: { ...SYNTHETIC_RAW_INFO, hdrWhite: 4 } });
    expect(difference(renderDetailImage(hdr, hdrParams), renderRawRgba8(hdr.data, hdrParams)).max).toBeLessThanOrEqual(1);
  });

  test('a flat colour stays flat under every spatial control, at the borders too', () => {
    const flat = image(70, 50, () => [150, 120, 90, 255]);
    const reference = renderRgba8(flat.data, deriveParams({}));
    for (const key of ['texture', 'clarity', 'sharpening', 'luminanceNoise', 'colorNoise']) {
      for (const value of key === 'texture' || key === 'clarity' ? [-100, 100] : [100]) {
        expect(difference(render(flat, { [key]: value }), reference).max, `${key} ${value}`).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('Sharpening', () => {
  const W = 120;
  const step = image(W, 40, (x) => { const v = x < W / 2 ? 70 : 170; return [v, v, v]; });

  test('raises edge contrast with bounded overshoot; far areas, alpha and grey stay unchanged', () => {
    const out = render(step, { sharpening: 100 });
    const row = (data, x) => data[(20 * W + x) * 4];
    expect(row(out, W / 2 - 1)).toBeLessThan(70);
    expect(row(out, W / 2)).toBeGreaterThan(170);
    const overshoot = Math.max(70 - Math.min(...Array.from({ length: W }, (_, x) => row(out, x))), Math.max(...Array.from({ length: W }, (_, x) => row(out, x))) - 170);
    expect(overshoot).toBeLessThanOrEqual(DETAIL.sharpenLimit * 255 + 1);
    expect(row(out, 5)).toBe(70);
    expect(row(out, W - 5)).toBe(170);
    for (let i = 0; i < out.length; i += 4) {
      expect(out[i + 3]).toBe(255);
      expect(out[i]).toBe(out[i + 1]);
      expect(out[i + 1]).toBe(out[i + 2]);
    }
  });

  test('more amount, more edge contrast; noise near one code is barely amplified (threshold)', () => {
    const edge = (settings) => { const out = render(step, settings); return out[(20 * W + W / 2) * 4] - out[(20 * W + W / 2 - 1) * 4]; };
    expect(edge({ sharpening: 50 })).toBeGreaterThan(edge({}));
    expect(edge({ sharpening: 100 })).toBeGreaterThan(edge({ sharpening: 50 }));
    const noise = noisy(5, 1);
    const grain = image(80, 80, () => { const v = 128 + noise(); return [v, v, v]; });
    const before = lumaStd(grain, renderRgba8(grain.data, deriveParams({})), 4, 4, 72, 72);
    expect(lumaStd(grain, render(grain, { sharpening: 100 }), 4, 4, 72, 72)).toBeLessThan(before * 1.7);
    expect(lumaStd(grain, render(grain, { clarity: 100 }), 4, 4, 72, 72)).toBeLessThan(before * 1.3);
  });
});

describe('Texture and Clarity', () => {
  // 2048 px wide, so Clarity's scale (a fraction of the long edge) is well apart from
  // Texture's (native pixels), as in real photos. Fine structure (period 12 px) on the
  // left, broad structure (period 160 px) on the right.
  const W = 2048;
  const H = 160;
  const pattern = image(W, H, (x, y) => {
    const period = x < W / 2 ? 12 : 160;
    const v = 128 + 20 * Math.sin((2 * Math.PI * x) / period) * Math.sin((2 * Math.PI * y) / period);
    return [v, v, v];
  });
  const amplitude = (data, x0, x1) => lumaStd(pattern, data, x0, 0, x1 - x0, H);
  const base = renderRgba8(pattern.data, deriveParams({}));
  const fine = (data) => amplitude(data, 32, W / 2 - 32);
  const coarse = (data) => amplitude(data, W / 2 + 160, W - 160);

  test('Texture acts on fine structure, leaves broad structure; negative softens it', () => {
    const up = render(pattern, { texture: 100 });
    const down = render(pattern, { texture: -100 });
    expect(fine(up)).toBeGreaterThan(fine(base) * 1.3);
    expect(fine(down)).toBeLessThan(fine(base) * 0.8);
    expect(Math.abs(coarse(up) / coarse(base) - 1)).toBeLessThan(0.03);
  });

  test('Clarity acts on broad structure as well; negative flattens it; not the same filter as Texture', () => {
    const up = render(pattern, { clarity: 100 });
    const down = render(pattern, { clarity: -100 });
    expect(coarse(up)).toBeGreaterThan(coarse(base) * 1.2);
    expect(coarse(down)).toBeLessThan(coarse(base) * 0.85);
    expect(difference(up, render(pattern, { texture: 100 })).mean).toBeGreaterThan(1);
  });

  test('exposure is preserved: mean brightness moves less than one code', () => {
    const reference = meanLuma(pattern, base, 0, 0, W, H);
    for (const settings of [{ texture: 100 }, { texture: -100 }, { clarity: 100 }, { clarity: -100 }, { sharpening: 100 }]) {
      expect(Math.abs(meanLuma(pattern, render(pattern, settings), 0, 0, W, H) - reference), JSON.stringify(settings)).toBeLessThan(1);
    }
  });

  test('Clarity at a black-to-white step: edge-aware base keeps halos small', () => {
    const steps = image(256, 64, (x) => { const v = x < 128 ? 30 : 225; return [v, v, v]; });
    const out = render(steps, { clarity: 100 });
    let worst = 0;
    for (let x = 0; x < 256; x += 1) {
      const v = out[(32 * 256 + x) * 4];
      worst = Math.max(worst, x < 128 ? Math.abs(v - 30) : Math.abs(v - 225));
    }
    expect(worst).toBeLessThanOrEqual(6);
  });
});

describe('Dehaze', () => {
  // A textured scene seen through haze that thickens from left (t = 1) to right (t = 0.35),
  // with grey airlight: I = J·t + A(1 − t) in linear light.
  const W = 256;
  const H = 96;
  const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const toSrgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  const rand = random(9);
  const scene = Array.from({ length: W * H }, () => 0.05 + 0.4 * rand());
  const air = 0.85;
  const hazy = image(W, H, (x, y) => {
    const t = 1 - 0.65 * (x / (W - 1));
    const j = scene[y * W + x];
    const v = 255 * toSrgb(j * t + air * (1 - t));
    return [v, v * 0.98, v * 0.96];
  });
  const contrast = (data) => lumaStd(hazy, data, W - 64, 8, 56, H - 16);
  const base = renderRgba8(hazy.data, deriveParams({}));

  test('positive Dehaze restores contrast where the haze is; negative adds haze', () => {
    expect(contrast(render(hazy, { dehaze: 100 }))).toBeGreaterThan(contrast(base) * 1.5);
    expect(contrast(render(hazy, { dehaze: -100 }))).toBeLessThan(contrast(base) * 0.8);
    // The haze-free side changes much less than the hazy side.
    const clear = (data) => lumaStd(hazy, data, 8, 8, 40, H - 16);
    expect(clear(render(hazy, { dehaze: 100 })) / clear(base)).toBeLessThan(contrast(render(hazy, { dehaze: 100 })) / contrast(base));
  });

  test('near neutral the change is small and grows with the amount; no colour cast from grey haze', () => {
    expect(difference(render(hazy, { dehaze: 5 }), base).mean).toBeLessThan(1.5);
    expect(difference(render(hazy, { dehaze: 50 }), base).mean).toBeGreaterThan(difference(render(hazy, { dehaze: 5 }), base).mean);
    const grey = image(64, 64, (x, y) => { const v = 90 + 120 * (x / 63) + 10 * Math.sin(y); return [v, v, v]; });
    const out = render(grey, { dehaze: 100 });
    for (let i = 0; i < out.length; i += 4) expect(Math.max(Math.abs(out[i] - out[i + 1]), Math.abs(out[i + 1] - out[i + 2]))).toBeLessThanOrEqual(1);
  });
});

describe('noise reduction', () => {
  const W = 160;
  const H = 80;
  const lumaNoise = noisy(11, 10);
  const chromaNoise = noisy(12, 12);
  // Grey 80 | grey 170 step with luma noise and independent colour speckle.
  const photo = image(W, H, (x) => {
    const v = (x < W / 2 ? 80 : 170) + lumaNoise();
    const c = chromaNoise();
    return [v + c, v - 0.3 * c, v - c];
  });
  const chroma = (data) => {
    let sq = 0; let n = 0;
    for (let y = 8; y < H - 8; y += 1) for (let x = 8; x < W / 2 - 8; x += 1) { const i = (y * W + x) * 4; const l = luma(data, i); sq += (data[i] - l) ** 2 + (data[i + 2] - l) ** 2; n += 2; }
    return Math.sqrt(sq / n);
  };
  const base = renderRgba8(photo.data, deriveParams({}));
  const flatLuma = (data) => lumaStd(photo, data, 8, 8, W / 2 - 16, H - 16);
  const stepHeight = (data) => meanLuma(photo, data, W / 2 + 3, 8, 6, H - 16) - meanLuma(photo, data, W / 2 - 9, 8, 6, H - 16);

  test('luminance NR reduces luma noise, keeps the step and leaves colour noise', () => {
    const out = render(photo, { luminanceNoise: 100 });
    expect(flatLuma(out)).toBeLessThan(flatLuma(base) * 0.5);
    expect(stepHeight(out)).toBeGreaterThan(stepHeight(base) * 0.95);
    expect(Math.abs(chroma(out) / chroma(base) - 1)).toBeLessThan(0.1);
    expect(flatLuma(render(photo, { luminanceNoise: 50 }))).toBeLessThan(flatLuma(base));
    expect(flatLuma(render(photo, { luminanceNoise: 50 }))).toBeGreaterThan(flatLuma(out));
  });

  test('colour NR reduces chroma speckle and leaves luma noise', () => {
    const out = render(photo, { colorNoise: 100 });
    expect(chroma(out)).toBeLessThan(chroma(base) * 0.4);
    expect(Math.abs(flatLuma(out) / flatLuma(base) - 1)).toBeLessThan(0.1);
  });

  test('colour NR does not bleed across a colour edge, even between colours of equal luma', () => {
    const boundary = image(120, 40, (x) => (x < 60 ? [200, 40, 40] : [40, 60, 220]));
    const out = render(boundary, { colorNoise: 100 });
    const reference = renderRgba8(boundary.data, deriveParams({}));
    for (const x of [57, 62]) {
      const i = (20 * 120 + x) * 4;
      expect(Math.max(...[0, 1, 2].map((c) => Math.abs(out[i + c] - reference[i + c])))).toBeLessThanOrEqual(3);
    }
  });
});

describe('alpha, tiles and resolution', () => {
  const rand = random(21);
  const W = 150;
  const H = 90;
  const ALL = { texture: 60, clarity: 40, dehaze: 30, sharpening: 70, luminanceNoise: 40, colorNoise: 50 };
  const transparent = (garbage) => image(W, H, (x, y) => {
    const inside = (x - 75) ** 2 + (y - 45) ** 2 < 30 ** 2;
    if (!inside) return garbage ? [garbage[0], garbage[1], garbage[2], 0] : [0, 0, 0, 0];
    return [120 + 60 * Math.sin(x / 3), 100 + rand() * 40, 90, x % 7 === 0 ? 128 : 255];
  });

  test('alpha is copied exactly; colours under transparent pixels never leak into visible ones', () => {
    const a = transparent(null);
    const b = { ...a, data: Uint8ClampedArray.from(a.data) };
    for (let i = 0; i < b.data.length; i += 4) if (b.data[i + 3] === 0) b.data.set([255, 0, 255], i);
    const outA = render(a, ALL);
    const outB = render(b, ALL);
    for (let i = 0; i < outA.length; i += 4) {
      expect(outA[i + 3]).toBe(a.data[i + 3]);
      if (a.data[i + 3] > 0) expect(Math.max(Math.abs(outA[i] - outB[i]), Math.abs(outA[i + 1] - outB[i + 1]), Math.abs(outA[i + 2] - outB[i + 2]))).toBeLessThanOrEqual(1);
    }
  });

  test('tiles and bands of any size give bit-identical output (no seams), raster and RAW', () => {
    const photo = image(W, H, (x, y) => [rand() * 255, 128 + 100 * Math.sin(x / 5 + y / 9), (x * 3 + y) % 256]);
    const whole = render(photo, ALL, { bandRows: H, tileWidth: W });
    for (const [bandRows, tileWidth] of [[1, 7], [13, 37], [64, 64], [DETAIL_BAND_ROWS, DETAIL_TILE]]) {
      expect(difference(render(photo, ALL, { bandRows, tileWidth }), whole).max, `${bandRows}×${tileWidth}`).toBe(0);
    }
    const alpha = transparent(null);
    expect(difference(render(alpha, ALL, { bandRows: 11, tileWidth: 29 }), render(alpha, ALL, { bandRows: H, tileWidth: W })).max).toBe(0);
    const raw = syntheticRawFrame(W, H, { seed: 6 });
    const params = deriveParams(ALL, { raw: SYNTHETIC_RAW_INFO });
    expect(difference(renderDetailImage(raw, params, { bandRows: 17, tileWidth: 23 }), renderDetailImage(raw, params, { bandRows: H, tileWidth: W })).max).toBe(0);
  });

  test('deterministic and stateless: repeated renders match, also after other settings', () => {
    const photo = image(W, H, (x, y) => [(x * 5) % 256, (y * 7) % 256, 100]);
    const first = render(photo, ALL);
    render(photo, { clarity: -80, colorNoise: 100 });
    expect(difference(render(photo, ALL), first).max).toBe(0);
  });

  test('a half-size render looks like the full-size render downscaled', () => {
    const N = 384;
    const full = image(N, N, (x, y) => {
      const v = 110 + 50 * Math.sin(x / 9) * Math.cos(y / 13) + 30 * Math.sin((x + y) / 40) + (x > 200 && y > 150 ? 50 : 0);
      return [v, v * 0.9 + 10, v * 0.8 + 20];
    });
    const shrink = (data, size) => { const acc = createAreaAccumulator(undefined, N, N, size, size); acc.add(data, 0, N); return acc.finish(); };
    const half = shrink(full.data, N / 2);
    for (const settings of [{ clarity: 100 }, { clarity: -100 }, { dehaze: 60 }, { texture: 100 }, { sharpening: 100 }, ALL]) {
      const params = deriveParams(settings);
      const downscaled = shrink(renderDetailImage(full, params), N / 2).data;
      const direct = renderDetailImage(half, params, { nativeWidth: N, nativeHeight: N });
      const baseline = difference(shrink(renderRgba8(full.data, deriveParams({})), N / 2).data, renderRgba8(half.data, deriveParams({})));
      expect(difference(downscaled, direct).mean - baseline.mean, JSON.stringify(settings)).toBeLessThan(1.5);
    }
  });

  test('cancellation stops between bands', () => {
    const photo = image(64, 600, () => [100, 100, 100]);
    let bands = 0;
    expect(() => renderDetailImage(photo, deriveParams({ sharpening: 50 }), { bandRows: 64, onBand: () => { bands += 1; }, cancelled: () => bands >= 2 })).toThrow(expect.objectContaining({ code: 'cancelled' }));
    expect(bands).toBe(2);
  });

  test('memory: scratch planes are sized by one tile plus halo, not by the image', () => {
    const photo = image(2000, 600, () => [100, 120, 140]);
    const params = deriveParams({ ...ALL, colorNoise: 100, texture: 100 });
    const context = prepareDetailRender(params, { width: 2000, height: 600, guide: null });
    expect(context.pool.bytes()).toBe(0);
    const out = new Uint8ClampedArray(2000 * 600 * 4);
    for (let row = 0; row < 600; row += DETAIL_BAND_ROWS) {
      const last = Math.min(600, row + DETAIL_BAND_ROWS);
      renderDetailRows(photo, context, row, last, out.subarray(row * 2000 * 4, last * 2000 * 4));
    }
    const tilePixels = (DETAIL_TILE + 2 * context.halo) * (DETAIL_BAND_ROWS + 2 * context.halo);
    expect(context.pool.bytes()).toBeLessThanOrEqual(20 * 4 * tilePixels);
    expect(context.pool.bytes()).toBeLessThan(photo.data.length * 2);
  });
});
