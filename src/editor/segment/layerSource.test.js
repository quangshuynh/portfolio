import { describe, expect, test } from 'vitest';
import { decodeCodes, encodeCodes } from './analysis.mjs';
import { flattenForAnalysis, layerAnalysisKey, limitToSourceAlpha } from './layerSource.mjs';

const image = (w, h, alphaAt) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p += 1) data.set([250, 10, 10, alphaAt(p % w, Math.floor(p / w))], p * 4);
  return { width: w, height: h, data };
};

describe('image layer analysis sources', () => {
  test('opaque sources pass through; transparent pixels go over mid grey and keep their alpha', () => {
    const opaque = image(4, 2, () => 255);
    expect(flattenForAnalysis(opaque)).toEqual({ image: opaque, alpha: null });
    const cut = flattenForAnalysis(image(4, 2, (x) => [0, 128, 255, 255][x]));
    expect(Array.from(cut.image.data.slice(0, 4))).toEqual([128, 128, 128, 255]);
    expect(Array.from(cut.image.data.slice(4, 8))).toEqual([189, 69, 69, 255]);
    expect(Array.from(cut.image.data.slice(8, 12))).toEqual([250, 10, 10, 255]);
    expect(Array.from(cut.alpha.slice(0, 4))).toEqual([0, 128 / 255, 1, 1].map(Math.fround));
  });

  test('a selection is limited to the visible source, resampled to its grid; nothing visible is not found', () => {
    const W = 8;
    const H = 4;
    const all = encodeCodes(new Uint8Array(W * H).fill(255));
    const result = { found: true, width: W, height: H, data: all, confidence: 0.9 };
    const alpha = Float32Array.from({ length: 16 * 8 }, (_, i) => ((i % 16) < 8 ? 0 : 1));
    const limited = limitToSourceAlpha(result, alpha, 16, 8);
    const codes = decodeCodes(limited.data, W * H);
    expect(codes[0]).toBe(0);
    expect(codes[W - 1]).toBe(255);
    expect(limited.confidence).toBe(0.9);
    expect(limitToSourceAlpha(result, null, 16, 8)).toBe(result);
    const none = limitToSourceAlpha(result, new Float32Array(16 * 8), 16, 8);
    expect(none).toMatchObject({ found: false, data: null });
  });

  test('the analysis key follows the source and the settings it is developed with, never its placement', () => {
    const layer = { source: { sha256: 'c'.repeat(64) }, settings: { exposure: 1 }, x: 0.5, rotation: 0 };
    expect(layerAnalysisKey({ ...layer, x: 0.1, rotation: 45, width: 3 })).toBe(layerAnalysisKey(layer));
    expect(layerAnalysisKey({ ...layer, settings: { exposure: 2 } })).not.toBe(layerAnalysisKey(layer));
    expect(layerAnalysisKey({ ...layer, rawProfile: { profile: 'natural', profileVersion: 2 } })).not.toBe(layerAnalysisKey(layer));
  });
});
