import { describe, expect, test } from 'vitest';
import { ADJUSTMENTS, adjustmentSpec, groupIsNeutral, groupKeys, neutralAdjustments, normalizeAdjustments } from '../model/adjustments.mjs';
import { renderRgba8 } from './cpuRenderer.mjs';
import { deriveParams } from './spec.mjs';
import { computeImageGlow, guideSource, prepareDetailRender, renderAnyImage, renderDetailImage, renderDetailRows } from './detailRenderer.mjs';
import { prepareRender } from './cpuRenderer.mjs';
import { CREATIVE, applyCreative, gradeWeights, grainHash, grainScale, grainValue, valueNoise, vignetteFalloff } from './creative.mjs';
import { fastTransfer } from './cpuRenderer.mjs';

// A photo-like test image: a colour gradient, a dark band, skin-like and saturated patches,
// a bright highlight and a semi-transparent corner.
function scene(width = 96, height = 64, { alpha = false } = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const i = (y * width + x) * 4;
    const t = x / (width - 1);
    let rgb = [t * 255, (0.3 + 0.5 * t) * 255, (1 - t) * 200];
    if (y < 8) rgb = [20, 22, 25];
    if (y >= 40 && y < 48 && x < 32) rgb = [224, 172, 140];
    if (y >= 40 && y < 48 && x >= 32 && x < 64) rgb = [40, 200, 60];
    if ((x - 70) ** 2 + (y - 24) ** 2 < 25) rgb = [255, 250, 240];
    data.set([...rgb.map(Math.round), alpha && x < 16 && y > 48 ? 96 : 255], i);
  }
  return { width, height, data };
}

const creativeKeys = groupKeys('creative');
const render = (image, adjustments) => renderAnyImage(image, deriveParams(adjustments), { nativeWidth: image.width, nativeHeight: image.height });
const meanAbs = (a, b) => {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c += 1) { sum += Math.abs(a[i + c] - b[i + c]); n += 1; }
  return sum / n;
};
const pixelAt = (image, out, x, y) => Array.from(out.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));

describe('creative registry', () => {
  test('every creative control is neutral by default and documents its range', () => {
    const neutral = neutralAdjustments();
    creativeKeys.forEach((key) => {
      const spec = adjustmentSpec(key);
      expect(spec.min).toBeLessThanOrEqual(spec.default);
      expect(spec.max).toBeGreaterThanOrEqual(spec.default);
      expect(neutral[key]).toBe(spec.default);
    });
    expect(groupIsNeutral(neutral, 'creative')).toBe(true);
    expect(deriveParams(neutral).creativeActive).toBe(false);
    // Amounts scale with a look's intensity; character settings (hue, radius, threshold) do not.
    expect(ADJUSTMENTS.filter((spec) => spec.scales).map(({ key }) => key)).toEqual(expect.arrayContaining(['bleachAmount', 'grainAmount', 'bloomAmount', 'halationAmount', 'vignetteAmount', 'fade', 'gradeShadowsSat']));
    expect(adjustmentSpec('bloomRadius').scales).toBeUndefined();
    expect(adjustmentSpec('grainSeed').hidden).toBe(true);
  });

  test('character settings alone change nothing until their amount is set', () => {
    const image = scene();
    const neutral = render(image, {});
    const characters = { bleachContrast: 100, bleachDesaturation: 0, grainSize: 100, bloomRadius: 0, halationHue: 60, vignetteFeather: 0, gradeShadowsHue: 100, gradeBlending: 100, gradeBalance: 80, fadeShadowHue: 0, grainSeed: 99 };
    expect(deriveParams(characters).creativeActive).toBe(false);
    expect(Array.from(render(image, characters))).toEqual(Array.from(neutral));
  });
});

describe('creative stage', () => {
  test('neutral settings reproduce the source exactly, with and without the spatial renderer', () => {
    const image = scene(48, 32, { alpha: true });
    expect(Array.from(renderRgba8(image.data, deriveParams({})))).toEqual(Array.from(image.data));
    // Character settings without amounts on the spatial path (Detail sharpening 0 keeps it per pixel there).
    const spatial = renderDetailImage(image, deriveParams({ vignetteAmount: 0, grainAmount: 0 }));
    expect(Array.from(spatial)).toEqual(Array.from(image.data));
  });

  test('bleach bypass: desaturates, adds contrast, keeps skin warmer and protects highlights', () => {
    const image = scene();
    const base = render(image, {});
    const out = render(image, { bleachAmount: 100 });
    const chroma = (p) => Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]);
    const green = [pixelAt(image, base, 40, 44), pixelAt(image, out, 40, 44)];
    expect(chroma(green[1])).toBeLessThan(chroma(green[0]) * 0.75);
    // Darker shadows and brighter light tones along the gradient: more contrast.
    const lumaOf = (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
    expect(lumaOf(pixelAt(image, out, 10, 20))).toBeLessThan(lumaOf(pixelAt(image, base, 10, 20)));
    expect(lumaOf(pixelAt(image, out, 90, 20))).toBeGreaterThan(lumaOf(pixelAt(image, base, 90, 20)) - 1);
    // Skin keeps more of its chroma than the green patch at the same strength.
    const skin = [pixelAt(image, base, 10, 44), pixelAt(image, out, 10, 44)];
    expect(chroma(skin[1]) / chroma(skin[0])).toBeGreaterThan(chroma(green[1]) / chroma(green[0]));
    // Highlight protection keeps the specular highlight within a few codes.
    const highlight = [pixelAt(image, base, 70, 24), pixelAt(image, render(image, { bleachAmount: 100, bleachProtect: 100 }), 70, 24)];
    expect(Math.abs(lumaOf(highlight[1]) - lumaOf(highlight[0]))).toBeLessThan(6);
    // Subtle at low amounts, growing monotonically.
    const differences = [10, 40, 100].map((amount) => meanAbs(render(image, { bleachAmount: amount }), base));
    expect(differences[0]).toBeLessThan(4);
    expect(differences[0]).toBeLessThan(differences[1]);
    expect(differences[1]).toBeLessThan(differences[2]);
    // Full desaturation and amount is monochrome (the Black & White Film look).
    const mono = render(image, { bleachAmount: 100, bleachDesaturation: 100 });
    for (let i = 0; i < mono.length; i += 4) expect(Math.max(mono[i], mono[i + 1], mono[i + 2]) - Math.min(mono[i], mono[i + 1], mono[i + 2])).toBeLessThanOrEqual(1);
  });

  test('film fade lifts and tints blacks, rolls off whites, and stays monotonic', () => {
    const ramp = { width: 256, height: 1, data: new Uint8ClampedArray(256 * 4) };
    for (let x = 0; x < 256; x += 1) ramp.data.set([x, x, x, 255], x * 4);
    const out = render(ramp, { fade: 100, fadeHighlights: 100 });
    expect(out[0]).toBe(Math.round(CREATIVE.fadeBlack * 255));
    expect(out[255 * 4]).toBeLessThan(230);
    for (let x = 1; x < 256; x += 1) expect(out[x * 4]).toBeGreaterThanOrEqual(out[(x - 1) * 4]);
    const tinted = render(ramp, { fade: 60, fadeShadowTint: 100, fadeShadowHue: 220 });
    expect(tinted[2]).toBeGreaterThan(tinted[0] + 20);
    // The tint colours the lifted black only: white stays white.
    expect(Array.from(tinted.subarray(255 * 4, 255 * 4 + 3))).toEqual([255, 255, 255]);
  });

  test('colour grading: smooth range weights that sum to 1, neutral blacks and monotonic luminance', () => {
    for (const exponent of CREATIVE.gradeExponent) for (const balance of [-0.8, 0, 0.8]) {
      let previous = null;
      for (let l = 0; l <= 1.0001; l += 0.01) {
        const w = gradeWeights(l, balance, exponent);
        expect(w[0] + w[1] + w[2]).toBeCloseTo(1, 12);
        w.forEach((value) => expect(value).toBeGreaterThanOrEqual(-1e-12));
        if (previous) w.forEach((value, i) => expect(Math.abs(value - previous[i])).toBeLessThan(0.12));
        previous = [...w];
      }
    }
    const ramp = { width: 256, height: 1, data: new Uint8ClampedArray(256 * 4) };
    for (let x = 0; x < 256; x += 1) ramp.data.set([x, x, x, 255], x * 4);
    const split = render(ramp, { gradeShadowsSat: 60, gradeShadowsHue: 220, gradeHighlightsSat: 60, gradeHighlightsHue: 45 });
    expect(Array.from(split.subarray(0, 3))).toEqual([0, 0, 0]);
    expect(split[60 * 4 + 2]).toBeGreaterThan(split[60 * 4]); // cool shadows
    expect(split[220 * 4]).toBeGreaterThan(split[220 * 4 + 2]); // warm highlights
    // The worst luminance combination stays monotonic.
    const extreme = render(ramp, { gradeShadowsLum: 100, gradeMidtonesLum: -100, gradeHighlightsLum: 100, gradeBlending: 0, gradeBalance: 100 });
    const luma = (x) => 0.2126 * extreme[x * 4] + 0.7152 * extreme[x * 4 + 1] + 0.0722 * extreme[x * 4 + 2];
    for (let x = 1; x < 256; x += 1) expect(luma(x)).toBeGreaterThanOrEqual(luma(x - 1) - 0.5);
  });

  test('vignette: centred on the output, darkens or lightens the edges, follows the frame and keeps alpha', () => {
    const flat = { width: 120, height: 60, data: new Uint8ClampedArray(120 * 60 * 4).fill(160) };
    const dark = render(flat, { vignetteAmount: -100 });
    const centre = pixelAt(flat, dark, 60, 30);
    const corner = pixelAt(flat, dark, 0, 0);
    expect(centre[0]).toBe(160);
    expect(corner[0]).toBeLessThan(80);
    expect(corner[3]).toBe(160);
    const light = render(flat, { vignetteAmount: 100 });
    expect(pixelAt(flat, light, 0, 0)[0]).toBeGreaterThan(220);
    // Symmetric, and the elliptical default follows a portrait frame the same way.
    expect(pixelAt(flat, dark, 119, 59)).toEqual(corner);
    const v = deriveParams({ vignetteAmount: -50 }).creative.vignette;
    expect(vignetteFalloff(0, 0, 120, 60, v)).toBeCloseTo(vignetteFalloff(0, 0, 60, 120, v), 12);
    // Round makes a circle: left edge darker than top edge on a landscape frame.
    const round = deriveParams({ vignetteAmount: -50, vignetteRoundness: 100 }).creative.vignette;
    expect(vignetteFalloff(0, 29, 120, 60, round)).toBeGreaterThan(vignetteFalloff(59, 0, 120, 60, round));
    // No visible boundary: neighbouring pixels differ by at most a few codes.
    for (let x = 1; x < 120; x += 1) expect(Math.abs(dark[(10 * 120 + x) * 4] - dark[(10 * 120 + x - 1) * 4])).toBeLessThanOrEqual(3);
  });

  test('grain: deterministic, seeded, unit variance, no repeating tiles, weaker in deep tones', () => {
    expect(grainHash(3, 7, 11)).toBe(grainHash(3, 7, 11));
    expect(grainHash(-1, 7, 11)).not.toBe(grainHash(1, 7, 11));
    const grain = { spacing: 2, roughness: 0.5, seed: 7 };
    let sum = 0;
    let sum2 = 0;
    const n = 256 * 256;
    for (let y = 0; y < 256; y += 1) for (let x = 0; x < 256; x += 1) {
      const v = grainValue(x, y, 1, grain);
      sum += v; sum2 += v * v;
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.05);
    expect(sum2 / n - (sum / n) ** 2).toBeCloseTo(1, 1);
    // The variance does not depend on the position inside a lattice cell (no grid pattern).
    const cellVariance = (fx) => {
      let s2 = 0;
      for (let i = 0; i < 4000; i += 1) s2 += valueNoise(i + fx, (i * 7) % 4001 + 0.37, 5) ** 2;
      return s2 / 4000;
    };
    expect(Math.abs(cellVariance(0) - cellVariance(0.5))).toBeLessThan(0.12);
    // No correlation with a shifted copy (a repeating tile would correlate).
    for (const shift of [64, 128, 256, 512]) {
      let c = 0;
      for (let i = 0; i < 2000; i += 1) c += grainValue(i, 3, 1, grain) * grainValue(i + shift, 3, 1, grain);
      expect(Math.abs(c / 2000)).toBeLessThan(0.15);
    }
    const image = scene();
    const a = render(image, { grainAmount: 60 });
    expect(Array.from(render(image, { grainAmount: 60 }))).toEqual(Array.from(a));
    expect(Array.from(render(image, { grainAmount: 60, grainSeed: 1 }))).not.toEqual(Array.from(a));
    // Changing the amount scales the same pattern instead of re-rolling it.
    const base = render(image, {});
    const half = render(image, { grainAmount: 30 });
    let same = 0;
    let total = 0;
    for (let i = 0; i < a.length; i += 4) {
      const d1 = a[i + 1] - base[i + 1];
      const d2 = half[i + 1] - base[i + 1];
      if (Math.abs(d1) > 4) { total += 1; if (Math.sign(d1) === Math.sign(d2)) same += 1; }
    }
    expect(same / total).toBeGreaterThan(0.95);
    // Deep shadows (the dark band) get less grain than mid-tones.
    const spread = (y0, y1, x0, x1) => {
      let s = 0;
      let k = 0;
      for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) { s += Math.abs(a[(y * 96 + x) * 4 + 1] - base[(y * 96 + x) * 4 + 1]); k += 1; }
      return s / k;
    };
    expect(spread(0, 8, 0, 96)).toBeLessThan(spread(12, 36, 30, 60));
  });

  test('grain at a smaller render is the downscale of the full-size grain, statistically', () => {
    const flat = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(128) });
    const full = flat(400, 400);
    const big = renderDetailImage(full, deriveParams({ grainAmount: 80, grainSize: 50 }));
    // Box-downscale the full render by 4 and compare its spread with a render at 1/4 scale.
    let s2Down = 0;
    for (let y = 0; y < 100; y += 1) for (let x = 0; x < 100; x += 1) {
      let s = 0;
      for (let dy = 0; dy < 4; dy += 1) for (let dx = 0; dx < 4; dx += 1) s += big[((y * 4 + dy) * 400 + x * 4 + dx) * 4];
      s2Down += (s / 16 - 128) ** 2;
    }
    const small = renderDetailImage(flat(100, 100), deriveParams({ grainAmount: 80, grainSize: 50 }), { nativeWidth: 400, nativeHeight: 400 });
    let s2Small = 0;
    for (let i = 0; i < small.length; i += 4) s2Small += (small[i] - 128) ** 2;
    const ratio = Math.sqrt(s2Small / s2Down);
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(1.4);
    expect(grainScale(3, 1)).toBe(1);
  });

  test('bloom and halation: only bright areas glow, halation is red and tighter, bloom keeps colour', () => {
    const w = 128;
    const h = 64;
    const dark = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    for (let i = 0; i < w * h; i += 1) dark.data.set([30, 30, 34, 255], i * 4);
    // A dark scene stays untouched below the threshold.
    expect(meanAbs(render(dark, { bloomAmount: 100, halationAmount: 100 }), render(dark, {}))).toBe(0);
    const light = { width: w, height: h, data: new Uint8ClampedArray(dark.data) };
    for (let y = 28; y < 36; y += 1) for (let x = 60; x < 68; x += 1) light.data.set([255, 255, 255, 255], (y * w + x) * 4);
    for (let y = 28; y < 36; y += 1) for (let x = 10; x < 18; x += 1) light.data.set([120, 220, 255, 255], (y * w + x) * 4);
    const base = render(light, {});
    const halation = render(light, { halationAmount: 100, halationThreshold: 30 });
    const near = pixelAt(light, halation, 70, 32);
    const near0 = pixelAt(light, base, 70, 32);
    expect(near[0] - near0[0]).toBeGreaterThan(near[2] - near0[2] + 5); // red-orange light bleed
    const far = pixelAt(light, halation, 100, 8);
    expect(Math.abs(far[0] - pixelAt(light, base, 100, 8)[0])).toBeLessThanOrEqual(2);
    const bloom = render(light, { bloomAmount: 100, bloomThreshold: 20 });
    const aroundCyan = pixelAt(light, bloom, 22, 32);
    const aroundCyan0 = pixelAt(light, base, 22, 32);
    expect(aroundCyan[2] - aroundCyan0[2]).toBeGreaterThan(aroundCyan[0] - aroundCyan0[0]); // the cyan patch glows cyan
    // Bloom reaches farther than halation at the default radii.
    const reach = (out) => out[(32 * w + 76) * 4] - base[(32 * w + 76) * 4];
    expect(reach(render(light, { bloomAmount: 100, bloomThreshold: 20 }))).toBeGreaterThan(reach(render(light, { halationAmount: 50, halationThreshold: 30 })));
    // The glow map changes with radius and threshold, not with the amounts.
    const map = (values) => computeImageGlow(prepareRender(deriveParams(values)), guideSource(light));
    expect(map({ bloomAmount: 10 }).bloom).toEqual(map({ bloomAmount: 90 }).bloom);
    expect(map({ bloomAmount: 10, bloomRadius: 90 }).bloom).not.toEqual(map({ bloomAmount: 10 }).bloom);
  });

  test('spatial creative effects are identical however the image is split into tiles and bands', () => {
    const image = scene(96, 64, { alpha: true });
    const values = { bloomAmount: 70, halationAmount: 60, vignetteAmount: -60, grainAmount: 50, bleachAmount: 40, fade: 20, gradeShadowsSat: 30, sharpening: 40 };
    const params = deriveParams(values);
    const whole = renderDetailImage(image, params);
    const banded = renderDetailImage(image, params, { bandRows: 1, tileWidth: 7 });
    expect(Array.from(banded)).toEqual(Array.from(whole));
    // A 1:1 region (columns) equals the same pixels of the whole render.
    const context = prepareDetailRender(params, { width: 96, height: 64, guideImage: guideSource(image), transparent: true });
    const region = new Uint8ClampedArray(20 * 10 * 4);
    renderDetailRows(image, context, 30, 40, region, { columns: [50, 70] });
    for (let y = 0; y < 10; y += 1) for (let x = 0; x < 20; x += 1) {
      expect(Array.from(region.subarray((y * 20 + x) * 4, (y * 20 + x) * 4 + 4))).toEqual(Array.from(whole.subarray(((30 + y) * 96 + 50 + x) * 4, ((30 + y) * 96 + 51 + x) * 4)));
    }
    // Alpha is copied untouched.
    for (let i = 3; i < whole.length; i += 4) expect(whole[i]).toBe(image.data[i]);
  });

  test('RAW and merged HDR sources go through the creative stage on the spatial renderer', () => {
    const info = {
      asShot: [2.33984375, 1, 1.53515625],
      rgbCam: [1.635386, -0.421962, -0.213424, -0.131072, 1.542707, -0.411635, 0.01143, -0.419593, 1.408163],
      camXyz: [0.7374, -0.2389, -0.0551, -0.5435, 1.3162, 0.2519, -0.1006, 0.1795, 0.6552],
    };
    const raw = { kind: 'raw', width: 32, height: 16, data: Uint16Array.from({ length: 32 * 16 * 3 }, (_, i) => (i * 97) % 65535) };
    const hdr = { kind: 'hdr', width: 32, height: 16, data: Float32Array.from(raw.data, (v, i) => (v / 65535) * (i % 5 === 0 ? 3 : 1)) };
    [[raw, info], [hdr, { ...info, hdrWhite: 3 }]].forEach(([image, rawInfo]) => {
      const values = { bloomAmount: 50, grainAmount: 40, vignetteAmount: -40, bleachAmount: 50 };
      const params = deriveParams(values, { raw: rawInfo });
      const out = renderAnyImage(image, params);
      const plain = renderAnyImage(image, deriveParams({}, { raw: rawInfo }));
      expect(meanAbs(out, plain)).toBeGreaterThan(2);
      expect(Array.from(renderDetailImage(image, params, { bandRows: 3, tileWidth: 5 }))).toEqual(Array.from(out));
    });
  });

  test('per-pixel renderers refuse positional effects instead of silently dropping them', () => {
    const image = scene(8, 8);
    expect(() => renderRgba8(image.data, deriveParams({ grainAmount: 10 }))).toThrow(/spatial renderer/);
    // Colour-only creative effects run per pixel, on the CPU and in the shader.
    const params = deriveParams({ bleachAmount: 50, fade: 20, gradeHighlightsSat: 40 });
    expect(params.spatialActive).toBe(false);
    expect(Array.from(renderRgba8(image.data, params))).toEqual(Array.from(renderDetailImage(image, params)));
  });

  test('applyCreative leaves values in range for every control extreme', () => {
    const at = { x: 3, y: 4, width: 16, height: 16, scale: 0.5, glow: { width: 1, height: 1, bloom: new Float32Array([1, 1, 1]), halation: new Float32Array([1]) } };
    ADJUSTMENTS.filter(({ group }) => group === 'creative').forEach(({ key, min, max }) => [min, max].forEach((value) => {
      const c = deriveParams(normalizeAdjustments({ [key]: value, bleachAmount: 100, bloomAmount: 100, halationAmount: 100, grainAmount: 100, vignetteAmount: -100, fade: 100 })).creative;
      for (const p of [[0, 0, 0], [1, 1, 1], [0.9, 0.1, 0.3]]) {
        const out = applyCreative([...p], c, at, fastTransfer);
        out.forEach((v) => { expect(Number.isFinite(v)).toBe(true); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); });
      }
    }));
  });
});
