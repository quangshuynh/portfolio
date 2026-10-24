import { describe, expect, test } from 'vitest';
import { adjustmentSpec, groupKeys, normalizeAdjustments } from '../model/adjustments.mjs';
import { deriveParams } from './spec.mjs';
import { createAreaAccumulator, prepareDetailRender, renderAnyImage, renderDetailImage, renderDetailRows } from './detailRenderer.mjs';
import { renderRegion } from './detailRegion.mjs';
import {
  DIGITAL, applyQuantize, bayerThreshold, captureSize, digitalParams, edgeWeight, jpegCompress, noiseValues, quantTable, shiftHalo,
} from './digital.mjs';
import { SYNTHETIC_RAW_INFO } from '../dev/hdrFixtures.mjs';

// A photo-like test image: gradients, edges, a skin-like and a saturated patch, a highlight.
function scene(width = 96, height = 64, { alpha = false } = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const i = (y * width + x) * 4;
    const t = x / (width - 1);
    let rgb = [t * 255, (0.3 + 0.5 * t) * 255, (1 - t) * 200 + 20 * Math.sin(y / 3)];
    if (y < height / 8) rgb = [20, 22, 25];
    if (y >= height * 0.6 && y < height * 0.75 && x < width / 3) rgb = [224, 172, 140];
    if (y >= height * 0.6 && y < height * 0.75 && x >= width / 3 && x < (2 * width) / 3) rgb = [40, 200, 60];
    if ((x - width * 0.73) ** 2 + (y - height * 0.37) ** 2 < (height / 12) ** 2) rgb = [255, 250, 240];
    data.set([...rgb.map((v) => Math.max(0, Math.min(255, Math.round(v)))), alpha && x < width / 6 && y > height * 0.75 ? 0 : 255], i);
  }
  return { width, height, data };
}

const native = (image) => ({ nativeWidth: image.width, nativeHeight: image.height });
const render = (image, adjustments, options = native(image)) => renderAnyImage(image, deriveParams(adjustments), options);
const meanAbs = (a, b) => {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c += 1) { sum += Math.abs(a[i + c] - b[i + c]); n += 1; }
  return sum / n;
};
const downscale = (image, width, height) => {
  const accumulator = createAreaAccumulator(undefined, image.width, image.height, width, height);
  accumulator.add(image.data, 0, image.height);
  return accumulator.finish();
};

const DIGITAL_KEYS = ['sensorColor', 'cameraResponse', 'highlightClip', 'noiseAmount', 'captureResolution', 'jpegAmount', 'quantizeAmount', 'chromaticAberration', 'channelShift', 'diffusionAmount'];
const CHARACTER_KEYS = { noiseColor: 100, pixelEdges: 100, quantizeDither: 100, channelShiftAngle: 90, diffusionRadius: 100 };

describe('digital effect registry', () => {
  test('every digital control belongs to the Creative group, is neutral by default and scales with filter strength', () => {
    const creative = groupKeys('creative');
    [...DIGITAL_KEYS, ...Object.keys(CHARACTER_KEYS)].forEach((key) => expect(creative).toContain(key));
    DIGITAL_KEYS.forEach((key) => expect(adjustmentSpec(key).scales).toBe(true));
    Object.keys(CHARACTER_KEYS).forEach((key) => expect(adjustmentSpec(key).scales).toBeUndefined());
    expect(Object.values(digitalParams(normalizeAdjustments({}))).every((value) => value === null)).toBe(true);
  });

  test('character settings alone change nothing; every amount changes real pixels', () => {
    const image = scene(320, 200);
    const neutral = render(image, {});
    expect(deriveParams(CHARACTER_KEYS).creativeActive).toBe(false);
    expect(Array.from(render(image, CHARACTER_KEYS))).toEqual(Array.from(neutral));
    DIGITAL_KEYS.forEach((key) => {
      const out = render(image, { [key]: 70 });
      expect(meanAbs(out, neutral), key).toBeGreaterThan(0.25);
    });
    expect(meanAbs(render(image, { sensorColor: -80 }), neutral)).toBeGreaterThan(0.5);
  });

  test('only capture and channel shift need the CPU renderer; the rest are per pixel or GPU-mirrored', () => {
    ['captureResolution', 'jpegAmount', 'chromaticAberration', 'channelShift'].forEach((key) => expect(deriveParams({ [key]: 50 }).cpuOnly, key).toBe(true));
    ['sensorColor', 'cameraResponse', 'highlightClip', 'quantizeAmount', 'noiseAmount', 'diffusionAmount'].forEach((key) => expect(deriveParams({ [key]: 50 }).cpuOnly, key).toBe(false));
    // Sensor colour, response, clipping and posterisation run in the per-pixel renderer too.
    expect(deriveParams({ sensorColor: 40, cameraResponse: 40, highlightClip: 40, quantizeAmount: 40 }).spatialActive).toBe(false);
  });
});

describe('per-pixel digital colour', () => {
  test('sensor colour keeps greys grey; response keeps black, mid-grey and white; clipping shifts hue per channel', () => {
    const greys = { width: 3, height: 1, data: Uint8ClampedArray.from([0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]) };
    [{ sensorColor: 100 }, { sensorColor: -100 }, { cameraResponse: 100 }].forEach((settings) => {
      const out = render(greys, settings);
      for (let i = 0; i < 12; i += 4) {
        expect(Math.abs(out[i] - out[i + 1]), JSON.stringify(settings)).toBeLessThanOrEqual(1);
        expect(Math.abs(out[i + 2] - out[i + 1])).toBeLessThanOrEqual(1);
      }
      expect(Math.abs(out[4] - 128)).toBeLessThanOrEqual(2);
    });
    const orange = { width: 1, height: 1, data: Uint8ClampedArray.from([240, 160, 90, 255]) };
    const [r, g, b] = render(orange, { highlightClip: 100 });
    expect(r).toBe(255);
    expect(g / b).toBeGreaterThan(160 / 90);
  });

  test('quantisation rounds to levels; ordered dither only on a capture grid', () => {
    const p = [0.49, 0.51, 0.2];
    applyQuantize(p, { levels: 2, dither: 0 }, null);
    expect(p).toEqual([0, 1, 0]);
    const levels = new Set();
    for (let v = 0; v <= 255; v += 1) {
      const q = [v / 255, 0, 0];
      applyQuantize(q, { levels: 5, dither: 0 }, null);
      levels.add(q[0]);
    }
    expect(levels.size).toBe(5);
    // Dither: the 8 × 8 Bayer thresholds are 64 distinct values covering (0, 1).
    const thresholds = new Set();
    for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) thresholds.add(bayerThreshold(x, y));
    expect(thresholds.size).toBe(64);
    expect(Math.min(...thresholds)).toBeGreaterThan(0);
    expect(Math.max(...thresholds)).toBeLessThan(1);
    // A flat mid-tone is dithered between two levels on a capture, and stays one level without.
    const flat = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4).fill(150) };
    const plain = render(flat, { quantizeAmount: 90, quantizeDither: 100 });
    const dithered = render(flat, { quantizeAmount: 90, quantizeDither: 100, jpegAmount: 1 });
    expect(new Set(Array.from(plain).filter((_, i) => i % 4 === 0)).size).toBe(1);
    expect(new Set(Array.from(dithered).filter((_, i) => i % 4 === 0)).size).toBeGreaterThan(1);
  });
});

describe('sensor noise', () => {
  test('deterministic per photo seed, different between seeds, and independent per channel', () => {
    const image = scene();
    const a = render(image, { noiseAmount: 60, grainSeed: 5 });
    expect(Array.from(render(image, { noiseAmount: 60, grainSeed: 5 }))).toEqual(Array.from(a));
    expect(meanAbs(render(image, { noiseAmount: 60, grainSeed: 6 }), a)).toBeGreaterThan(1);
    const values = noiseValues(10, 20, 1234);
    expect(new Set(values).size).toBe(4);
  });

  test('a downscaled render shows the standard deviation a downscale of the full render leaves', () => {
    const flat = { width: 400, height: 400, data: new Uint8ClampedArray(400 * 400 * 4).fill(120) };
    const deviation = (out) => {
      let sum = 0;
      let sq = 0;
      const n = out.length / 4;
      for (let i = 0; i < out.length; i += 4) { sum += out[i + 1]; sq += out[i + 1] * out[i + 1]; }
      return Math.sqrt(sq / n - (sum / n) ** 2);
    };
    const settings = { noiseAmount: 100, noiseColor: 0, grainSeed: 3 };
    const full = render(flat, settings);
    const half = render({ width: 200, height: 200, data: new Uint8ClampedArray(200 * 200 * 4).fill(120) }, settings, { nativeWidth: 400, nativeHeight: 400 });
    const fullDown = downscale({ width: 400, height: 400, data: full }, 200, 200);
    expect(deviation(full)).toBeGreaterThan(5);
    expect(deviation(half) / deviation(fullDown.data)).toBeGreaterThan(0.8);
    expect(deviation(half) / deviation(fullDown.data)).toBeLessThan(1.25);
  });
});

describe('JPEG compression', () => {
  test('standard tables scaled as the IJG library does', () => {
    expect(Array.from(quantTable([16, 11, 10, 16], 50))).toEqual([16, 11, 10, 16]);
    expect(Array.from(quantTable([16, 11, 10, 16], 100))).toEqual([1, 1, 1, 1]);
    expect(Array.from(quantTable([16, 11], 10))).toEqual([80, 55]);
  });

  test('high quality is close to the input; low quality makes 8 × 8 blocks; alpha untouched; deterministic', () => {
    const image = scene(64, 48, { alpha: true });
    const good = jpegCompress(new Uint8ClampedArray(image.data), 64, 48, 98);
    expect(meanAbs(good, image.data)).toBeLessThan(4);
    const bad = jpegCompress(new Uint8ClampedArray(image.data), 64, 48, 5);
    expect(Array.from(jpegCompress(new Uint8ClampedArray(image.data), 64, 48, 5))).toEqual(Array.from(bad));
    for (let i = 3; i < bad.length; i += 4) expect(bad[i]).toBe(image.data[i]);
    // Steps between neighbouring columns are larger across block edges than inside blocks.
    let across = 0;
    let inside = 0;
    for (let y = 8; y < 40; y += 1) for (let x = 1; x < 63; x += 1) {
      const step = Math.abs(bad[(y * 64 + x) * 4 + 1] - bad[(y * 64 + x - 1) * 4 + 1]);
      if (x % 8 === 0) across += step; else inside += step / 7;
    }
    expect(across).toBeGreaterThan(inside * 1.5);
  });
});

describe('capture: low resolution and reconstruction', () => {
  test('the capture grid is a fraction of the guide grid, the same at any render size', () => {
    const { capture } = digitalParams(normalizeAdjustments({ captureResolution: 100 }));
    expect(capture.edge).toBe(DIGITAL.captureEdge[1]);
    expect(captureSize({ width: 768, height: 512 }, capture)).toEqual({ width: 48, height: 32 });
    expect(captureSize({ width: 300, height: 200 }, { edge: 768 })).toEqual({ width: 300, height: 200 });
    expect(edgeWeight(0.3, 1)).toBe(0);
    expect(edgeWeight(0.7, 1)).toBe(1);
    expect(edgeWeight(0.3, 0)).toBeCloseTo(0.3, 10);
  });

  test('pixel edges 100 makes flat blocks of the capture grid', () => {
    const image = scene(192, 128);
    const out = render(image, { captureResolution: 100, pixelEdges: 100 });
    // 192 px over a 48 px grid: blocks of 4 × 4 output pixels with one colour.
    for (let by = 0; by < 32; by += 5) for (let bx = 0; bx < 48; bx += 7) {
      const first = (by * 4 * 192 + bx * 4) * 4;
      for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) {
        const i = ((by * 4 + y) * 192 + bx * 4 + x) * 4;
        expect([out[i], out[i + 1], out[i + 2]]).toEqual([out[first], out[first + 1], out[first + 2]]);
      }
    }
  });

  test('a preview-size render agrees with the full-size render scaled down (capture, JPEG, noise, shift, soft focus)', () => {
    const full = scene(480, 320);
    const small = downscale(full, 120, 80);
    [
      { captureResolution: 70, pixelEdges: 100 },
      { jpegAmount: 80, captureResolution: 40 },
      { chromaticAberration: 100, channelShift: 40 },
      { diffusionAmount: 80 },
      { captureResolution: 30, jpegAmount: 60, noiseAmount: 40, quantizeAmount: 50, quantizeDither: 100, sensorColor: -50 },
    ].forEach((settings) => {
      const exported = render(full, settings);
      // The preview's guide source comes from the proxy (at least the guide grid's size), as here.
      const preview = render(small, settings, { nativeWidth: 480, nativeHeight: 320, guideImage: full });
      const expected = downscale({ width: 480, height: 320, data: exported }, 120, 80).data;
      expect(meanAbs(preview, expected), JSON.stringify(settings)).toBeLessThan(6);
    });
  });

  test('transparent areas keep their alpha and do not darken the colours captured beside them', () => {
    const image = scene(96, 64, { alpha: true });
    const opaque = { ...image, data: Uint8ClampedArray.from(image.data, (v, i) => (i % 4 === 3 ? 255 : v)) };
    const settings = { captureResolution: 85, pixelEdges: 0, jpegAmount: 40 };
    const out = render(image, settings);
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(image.data[i]);
    // The visible pixels next to the transparent corner are not pulled toward black.
    const reference = render(opaque, settings);
    let darker = 0;
    for (let y = 50; y < 64; y += 1) for (let x = 16; x < 22; x += 1) {
      const i = (y * 96 + x) * 4;
      darker = Math.max(darker, (reference[i] + reference[i + 1] + reference[i + 2]) - (out[i] + out[i + 1] + out[i + 2]));
    }
    expect(darker).toBeLessThan(120);
  });
});

describe('spatial rendering of the digital effects', () => {
  const EVERYTHING = [
    { chromaticAberration: 100, channelShift: 60, channelShiftAngle: 30, diffusionAmount: 50, noiseAmount: 50, grainAmount: 30, vignetteAmount: -40, texture: 40 },
    { captureResolution: 40, jpegAmount: 70, noiseAmount: 40, quantizeAmount: 40, quantizeDither: 80, grainAmount: 30, chromaticAberration: 60, sharpening: 50 },
  ];

  test('bands and tiles of any size give the same pixels as one pass (no seams)', () => {
    const image = scene(97, 61, { alpha: true });
    EVERYTHING.forEach((settings) => {
      const params = deriveParams(settings);
      const whole = renderDetailImage(image, params);
      expect(Array.from(renderDetailImage(image, params, { bandRows: 7, tileWidth: 13 }))).toEqual(Array.from(whole));
    });
  });

  test('channel shift grows the halo with the displacement; a band with its halo equals the whole render', () => {
    const image = scene(160, 120);
    const params = deriveParams({ channelShift: 100, chromaticAberration: 100 });
    const context = prepareDetailRender(params, { width: 160, height: 120, guideImage: image });
    expect(context.halo).toBe(shiftHalo(params.creative.shift, 160, 120));
    expect(context.halo).toBeGreaterThan(1);
    const whole = renderDetailImage(image, params);
    const y0 = 40;
    const y1 = 72;
    const top = y0 - context.halo;
    const band = { width: 160, height: y1 + context.halo - top, y0: top, data: image.data.slice(top * 160 * 4, (y1 + context.halo) * 160 * 4) };
    const out = new Uint8ClampedArray((y1 - y0) * 160 * 4);
    renderDetailRows(band, context, y0, y1, out);
    expect(Array.from(out)).toEqual(Array.from(whole.subarray(y0 * 160 * 4, y1 * 160 * 4)));
    // A capture needs no halo: it reads only its map.
    expect(prepareDetailRender(deriveParams({ jpegAmount: 50 }), { width: 160, height: 120, guideImage: image }).halo).toBe(0);
  });

  test('a 1:1 region equals the same rows and columns of the whole render', () => {
    const image = scene(200, 140);
    const settings = { chromaticAberration: 100, channelShift: 50, captureResolution: 30, jpegAmount: 40 };
    [settings, { chromaticAberration: 100, channelShift: 50 }].forEach((values) => {
      const whole = render(image, values);
      const region = { x: 60, y: 30, width: 50, height: 40 };
      const kept = { source: { width: 200, height: 140, x0: 0, y0: 0, data: image.data }, guideImage: image, native: { width: 200, height: 140 } };
      const { after } = renderRegion(kept, region, { adjustments: values });
      for (let y = 0; y < region.height; y += 1) {
        const row = Array.from(after.subarray(y * region.width * 4, (y + 1) * region.width * 4));
        const start = ((region.y + y) * 200 + region.x) * 4;
        expect(row).toEqual(Array.from(whole.subarray(start, start + region.width * 4)));
      }
    });
  });

  test('RAW and merged HDR sources take every digital effect', () => {
    const raw = { kind: 'raw', width: 40, height: 24, data: Uint16Array.from({ length: 40 * 24 * 3 }, (_, i) => (i * 97) % 65535) };
    const hdr = { kind: 'hdr', width: 40, height: 24, data: Float32Array.from(raw.data, (v, i) => (v / 65535) * (i % 5 === 0 ? 3 : 1)) };
    [[raw, SYNTHETIC_RAW_INFO], [hdr, { ...SYNTHETIC_RAW_INFO, hdrWhite: 3 }]].forEach(([image, info]) => {
      EVERYTHING.forEach((settings) => {
        const params = deriveParams(settings, { raw: info });
        const out = renderAnyImage(image, params);
        const plain = renderAnyImage(image, deriveParams({}, { raw: info }));
        expect(meanAbs(out, plain)).toBeGreaterThan(2);
        expect(Array.from(renderDetailImage(image, params, { bandRows: 5, tileWidth: 9 }))).toEqual(Array.from(out));
      });
    });
  });

  test('a long render can be cancelled between bands', () => {
    const image = scene(64, 64);
    let calls = 0;
    expect(() => renderDetailImage(image, deriveParams({ jpegAmount: 50 }), { bandRows: 8, cancelled: () => (calls += 1) > 2 })).toThrow(/Cancelled/);
  });
});
