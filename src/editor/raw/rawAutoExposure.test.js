// @vitest-environment node
// Auto Exposure: synthetic scenes with known exposure (normal, underexposed, night, high-key,
// backlit, bright automotive, high ISO, clipped), its limits, determinism and the sampler.

import { describe, expect, test } from 'vitest';
import { AUTO_EXPOSURE, exposureValue100, luminanceSamples, previewLightness, suggestExposure, targetKey } from './rawAutoExposure.mjs';
import { NATURAL_CURVE, naturalTone, rawProfileParams } from './rawProfiles.mjs';
import { rawDevelopParams } from './rawColor.mjs';

const W = 96;
const H = 64;
/** Samples from a luminance function of (x, y) in 0–1; values ≥ 1 are sensor-clipped. */
function scene(luminance) {
  const y = new Float32Array(W * H);
  const clipped = new Uint8Array(W * H);
  for (let row = 0; row < H; row += 1) {
    for (let column = 0; column < W; column += 1) {
      const value = luminance((column + 0.5) / W, (row + 0.5) / H);
      y[row * W + column] = Math.min(1, value);
      clipped[row * W + column] = value >= 1 ? 1 : 0;
    }
  }
  return { width: W, height: H, y, clipped };
}
// Exposure metadata for a scene of brightness EV100 at ISO 100 (1/125 s).
const metered = (ev100, iso = 100) => ({ shutter: 1 / 125, aperture: Math.sqrt((2 ** (ev100 + Math.log2(iso / 100))) / 125), iso });
const natural = rawProfileParams('camera-natural', {}, 2);
const options = (ev100, iso) => ({ baseEv: natural.exposureEv, curve: natural.curve, raw: metered(ev100, iso) });
// A textured daylight scene whose key sits on the target.
const keyAtTarget = targetKey(null) / 2 ** natural.exposureEv;
const textured = (key) => (x, y) => key * 2 ** (1.5 * Math.sin(9 * x) * Math.cos(7 * y));
const nearWhiteShare = (samples, stops) => {
  let n = 0;
  samples.y.forEach((value, i) => {
    const gain = 2 ** (natural.exposureEv + stops);
    if (!samples.clipped[i] && naturalTone(value * gain, natural.curve, Math.max(2 ** natural.exposureEv, gain)) >= AUTO_EXPOSURE.nearWhite) n += 1;
  });
  return n / samples.y.length;
};

describe('Auto Exposure suggestions', () => {
  test('a normally exposed daylight photo gets no suggestion', () => {
    const result = suggestExposure(scene(textured(keyAtTarget)), options(12));
    expect(result.ev).toBeNull();
    expect(result.reason).toMatch(/normal range/);
  });

  test('an underexposed daylight photo is brightened by the excess beyond the normal range', () => {
    const result = suggestExposure(scene(textured(keyAtTarget / 4)), options(15));
    // About two stops under; the first stop is within the normal range.
    expect(result.ev).toBeGreaterThan(0.75);
    expect(result.ev).toBeLessThan(1.25);
    expect(Math.round(result.ev / AUTO_EXPOSURE.step) * AUTO_EXPOSURE.step).toBeCloseTo(result.ev, 9);
    // Much further under: limited to the range.
    expect(suggestExposure(scene(textured(keyAtTarget / 16)), options(15))).toMatchObject({ ev: AUTO_EXPOSURE.max, limitedBy: 'range' });
  });

  test('night and dim scenes stay dark', () => {
    const night = scene((x, y) => (Math.hypot(x - 0.5, y - 0.3) < 0.03 ? 1.2 : keyAtTarget / 30));
    expect(suggestExposure(night, options(3)).ev).toBeNull();
    expect(suggestExposure(night, options(3)).reason).toMatch(/low-light/);
    // Unknown exposure and a very dark frame: no guess.
    const dark = scene(() => 0.0005);
    expect(suggestExposure(dark, { baseEv: natural.exposureEv, curve: natural.curve, raw: {} }).ev).toBeNull();
    expect(targetKey(3)).toBeLessThan(targetKey(12));
  });

  test('a bright high-key photo whose highlights hold detail is not darkened', () => {
    const highKey = scene(textured(keyAtTarget * 5));
    expect(nearWhiteShare(highKey, 0)).toBeLessThan(AUTO_EXPOSURE.darkenEvidence);
    const result = suggestExposure(highKey, options(14));
    expect(result.ev).toBeNull();
    expect(result.reason).toMatch(/high-key/);
  });

  test('an overexposed photo with clipped highlights is darkened', () => {
    const over = scene((x, y) => (y < 0.25 ? 1.3 : keyAtTarget * 8 * (1 + 0.5 * Math.sin(12 * x))));
    const result = suggestExposure(over, options(13));
    expect(result.ev).toBeLessThan(0);
    expect(result.ev).toBeGreaterThanOrEqual(AUTO_EXPOSURE.min);
  });

  test('a backlit subject and a dark car with specular highlights: brightening never pushes unclipped highlights into white', () => {
    const backlit = scene((x, y) => (Math.hypot(x - 0.5, y - 0.55) < 0.45 ? keyAtTarget / 30 : 0.35));
    const car = scene((x, y) => ((Math.round(x * 40) + Math.round(y * 30)) % 23 === 0 ? 1.1 : (y > 0.4 ? keyAtTarget / 10 : 0.35)));
    for (const samples of [backlit, car]) {
      const result = suggestExposure(samples, options(13));
      if (result.ev !== null && result.ev > 0) {
        expect(nearWhiteShare(samples, result.ev) - nearWhiteShare(samples, 0)).toBeLessThanOrEqual(AUTO_EXPOSURE.highlightBudget + 1e-9);
      }
    }
    // Camera Natural's shoulder already keeps the bright background off white; with Linear the
    // background would reach white, so the suggestion stops short of it.
    const linear = suggestExposure(backlit, { baseEv: 0, curve: null, raw: metered(13) });
    expect(linear.limitedBy).toBe('highlights');
    expect(linear.ev).toBeLessThan(suggestExposure(backlit, options(13)).ev);
  });

  test('high ISO limits brightening; a mostly clipped frame gets no suggestion', () => {
    const under = scene(textured(keyAtTarget / 16));
    expect(suggestExposure(under, options(15, 6400)).ev).toBe(AUTO_EXPOSURE.highIsoMax);
    expect(suggestExposure(under, options(15, 6400)).limitedBy).toBe('high ISO');
    const blown = scene((x) => (x < 0.5 ? 1.5 : 0.4));
    expect(suggestExposure(blown, options(14)).ev).toBeNull();
    expect(suggestExposure(blown, options(14)).reason).toMatch(/clipped/);
  });

  test('Linear / Neutral: suggestions without a tone curve', () => {
    const linear = rawProfileParams('linear', {});
    const result = suggestExposure(scene(textured(keyAtTarget / 8)), { baseEv: linear.exposureEv, curve: null, raw: metered(15) });
    expect(result.ev).toBeGreaterThan(0);
  });

  test('deterministic: the same samples and metadata always give the same suggestion', () => {
    const samples = scene(textured(keyAtTarget / 6));
    const first = suggestExposure(samples, options(14));
    const copy = { ...samples, y: Float32Array.from(samples.y), clipped: Uint8Array.from(samples.clipped) };
    expect(suggestExposure(copy, options(14))).toEqual(first);
    expect(exposureValue100({ shutter: 1 / 125, aperture: 8, iso: 100 })).toBeCloseTo(Math.log2(64 * 125), 9);
    expect(exposureValue100({ shutter: 1 / 125, aperture: 8 })).toBeNull();
  });
});

describe('Auto Exposure matched to the camera preview', () => {
  const withPreview = (samples, lightness) => ({ ...samples, previewLightness: lightness });
  const lightnessAt = (samples, stops) => {
    const gain = 2 ** (natural.exposureEv + stops);
    const values = Array.from(samples.y, (v) => naturalTone(v * gain, natural.curve, Math.max(2 ** natural.exposureEv, gain)))
      .map((y) => (y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y)).sort((a, b) => a - b);
    return values[values.length >> 1];
  };

  test("suggests the exposure at which the median lightness meets the camera's rendering", () => {
    const samples = scene(textured(keyAtTarget));
    const camera = Math.round(lightnessAt(samples, 0.8) * 2) / 2;
    const result = suggestExposure(withPreview(samples, camera), options(12));
    expect(result).toMatchObject({ source: 'camera', previewLightness: camera });
    expect(result.ev).toBeGreaterThanOrEqual(0.7);
    expect(result.ev).toBeLessThanOrEqual(0.9);
    // Darker camera rendering: darker suggestion, whatever the scene statistics say.
    expect(suggestExposure(withPreview(samples, Math.round(lightnessAt(samples, -0.6) * 2) / 2), options(12)).ev).toBeCloseTo(-0.6, 1);
  });

  test("keeps the camera's intent: a night or high-key rendering is matched, not normalised", () => {
    const night = scene((x, y) => (Math.hypot(x - 0.5, y - 0.3) < 0.03 ? 1.2 : keyAtTarget / 30));
    // The camera showed it as dark as we do: nothing to suggest.
    expect(suggestExposure(withPreview(night, Math.round(lightnessAt(night, 0) * 2) / 2), options(3)).ev).toBeNull();
    const highKey = scene(textured(keyAtTarget * 5));
    expect(suggestExposure(withPreview(highKey, Math.round(lightnessAt(highKey, 0) * 2) / 2), options(14))).toMatchObject({ ev: null, source: 'camera' });
  });

  test('differences under the threshold are not offered; brightening keeps the highlight guard', () => {
    const samples = scene(textured(keyAtTarget));
    expect(suggestExposure(withPreview(samples, Math.round(lightnessAt(samples, 0.15) * 2) / 2), options(12)).ev).toBeNull();
    const backlit = scene((x, y) => (Math.hypot(x - 0.5, y - 0.55) < 0.45 ? keyAtTarget / 30 : 0.35));
    const linear = suggestExposure(withPreview(backlit, 90), { baseEv: 0, curve: null, raw: metered(13) });
    expect(linear.limitedBy).toBe('highlights');
  });

  test('preview lightness: median L* rounded to 0.5; small previews are not trusted', () => {
    const grey = { width: 4, height: 2, data: new Uint8ClampedArray(32).fill(119) };
    expect(previewLightness(grey, 1616)).toBe(50);
    expect(previewLightness(grey, 160)).toBeNull();
    expect(previewLightness(null, 1616)).toBeNull();
  });
});

describe('luminance samples', () => {
  test('box-average a developed proxy and mark green clipped at the sensor', () => {
    const raw = { asShot: [2, 1, 1.5], rgbCam: [1, 0, 0, 0, 1, 0, 0, 0, 1], camXyz: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
    const develop = rawDevelopParams(raw, { whiteBalance: 'as-shot' });
    const image = { width: 400, height: 200, data: new Uint16Array(400 * 200 * 3) };
    for (let i = 0; i < 400 * 200; i += 1) {
      const value = i % 400 < 200 ? 16384 : 65535;
      image.data.set([value, value, value], i * 3);
    }
    const samples = luminanceSamples(image, develop, 40);
    expect([samples.width, samples.height]).toEqual([40, 20]);
    // Max-normalised data: green's gain restores white for the right half.
    expect(samples.y[0]).toBeCloseTo((16384 / 65535) * develop.gain[1], 6);
    expect(samples.clipped[0]).toBe(0);
    expect(samples.clipped[39]).toBe(1);
    expect(NATURAL_CURVE.baselineEv).toBe(1.35);
  });
});
