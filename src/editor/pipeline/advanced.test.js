// @vitest-environment node
import { HSL_RANGES, hslKey } from '../model/adjustments.mjs';
import { LUMA, SRGB_TO_LINEAR_8BIT, linearToSrgb, srgbToLinear } from './colorMath.mjs';
import { CURVE_TABLE_SIZE, NEUTRAL_CURVE, curveEvaluator, curveTables, normalizeCurve, sampleCurve } from './curves.mjs';
import { fastTransfer, renderRgba8 } from './cpuRenderer.mjs';
import { LutError, identityLut, parseCube, sampleLut } from './lut.mjs';
import { applyHsl, deriveParams, hslWeights, processDisplay, processLinear } from './spec.mjs';
import { FRAGMENT_SHADER } from './shader.mjs';
import { lookLut } from '../dev/lutFixtures.mjs';

function chart() {
  const values = [];
  for (let r = 0; r <= 255; r += 15) for (let g = 0; g <= 255; g += 15) for (let b = 0; b <= 255; b += 15) values.push(r, g, b, (r + g) % 256);
  return new Uint8ClampedArray(values);
}

const cube = (size, rows, header = '') => `${header}LUT_3D_SIZE ${size}\n${rows.join('\n')}\n`;
const identityRows = (size) => {
  const rows = [];
  for (let b = 0; b < size; b += 1) for (let g = 0; g < size; g += 1) for (let r = 0; r < size; r += 1) rows.push(`${r / (size - 1)} ${g / (size - 1)} ${b / (size - 1)}`);
  return rows;
};

/** Exact (untabulated) reference for one 8-bit pixel through every stage. */
function exactPixel(source, i, params) {
  let p;
  if (params.baseNeutral) p = [0, 1, 2].map((c) => source[i + c] / 255);
  else p = processLinear([0, 1, 2].map((c) => SRGB_TO_LINEAR_8BIT[source[i + c]]), params).map(linearToSrgb);
  return processDisplay(p, params).map((v) => Math.round(v * 255));
}

describe('tone curves', () => {
  test('control points are validated, sorted and de-duplicated', () => {
    expect(normalizeCurve([[255, 200], [0, 10], [128.4, 300]])).toEqual([[0, 10], [128, 255], [255, 200]]);
    expect(normalizeCurve([[0, 0], [0, 40], [255, 255]])).toEqual([[0, 40], [255, 255]]);
    expect(normalizeCurve([[0, 0]])).toBe(NEUTRAL_CURVE);
    expect(normalizeCurve([[0, 0], ['a', 3]])).toBe(NEUTRAL_CURVE);
    expect(normalizeCurve(Array.from({ length: 17 }, (_, i) => [i * 15, i * 15]))).toBe(NEUTRAL_CURVE);
    expect(normalizeCurve([[0, 0], [100, 100], [255, 255]])).toBe(NEUTRAL_CURVE);
    expect(normalizeCurve('0,0;255,255')).toBe(NEUTRAL_CURVE);
  });

  test('the curve passes through its points, is flat outside them and never overshoots', () => {
    const points = [[20, 0], [60, 90], [70, 95], [180, 100], [230, 250]];
    const curve = curveEvaluator(points);
    points.forEach(([x, y]) => expect(curve(x)).toBeCloseTo(y, 9));
    expect(curve(0)).toBe(0);
    expect(curve(255)).toBe(250);
    // Monotone data stays monotone, and every segment stays between its end values.
    let previous = -1;
    for (let x = 0; x <= 255; x += 0.25) {
      const y = curve(x);
      expect(y).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = y;
      const k = points.findIndex(([px], i) => i < points.length - 1 && x >= px && x <= points[i + 1][0]);
      if (k >= 0) {
        expect(y).toBeGreaterThanOrEqual(Math.min(points[k][1], points[k + 1][1]) - 1e-9);
        expect(y).toBeLessThanOrEqual(Math.max(points[k][1], points[k + 1][1]) + 1e-9);
      }
    }
  });

  test('a non-monotone curve has no overshoot past its extreme points', () => {
    const curve = curveEvaluator([[0, 0], [128, 255], [255, 0]]);
    for (let x = 0; x <= 255; x += 0.5) {
      expect(curve(x)).toBeLessThanOrEqual(255);
      expect(curve(x)).toBeGreaterThanOrEqual(0);
    }
  });

  test('the shared table stays within 0.05 code of the exact curve for smooth curves', () => {
    const points = [[0, 0], [64, 40], [192, 220], [255, 255]];
    const { table } = curveTables({ master: points, red: NEUTRAL_CURVE, green: NEUTRAL_CURVE, blue: NEUTRAL_CURVE });
    const exact = curveEvaluator(points);
    for (let code = 0; code <= 255; code += 1) expect(Math.abs(sampleCurve(table, 3, code / 255) * 255 - exact(code))).toBeLessThan(0.05);
    expect(table.length).toBe(CURVE_TABLE_SIZE * 4);
  });

  test('neutral curves are exactly the identity, alpha included', () => {
    const source = chart();
    const params = deriveParams({ curves: { master: [[0, 0], [255, 255]] } });
    expect(params.curvesActive).toBe(false);
    expect(renderRgba8(source, params)).toEqual(source);
  });

  test('a channel curve changes only its channel; the master curve applies first', () => {
    const red = renderRgba8(new Uint8ClampedArray([100, 100, 100, 77]), deriveParams({ curves: { red: [[0, 0], [100, 150], [255, 255]] } }));
    expect(Array.from(red)).toEqual([150, 100, 100, 77]);
    const both = renderRgba8(new Uint8ClampedArray([100, 100, 100, 255]), deriveParams({ curves: { master: [[0, 255], [255, 0]], blue: [[0, 0], [155, 0], [255, 255]] } }));
    expect(Array.from(both)).toEqual([155, 155, 0, 255]);
  });
});

describe('.cube LUTs', () => {
  test('parses size, title, domain, comments and blank lines', () => {
    const text = `# made by hand\n\nTITLE "Warm look"\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n${cube(2, identityRows(2)).replace('LUT_3D_SIZE 2', 'LUT_3D_SIZE 2 # two')}`;
    const lut = parseCube(text);
    expect(lut).toMatchObject({ title: 'Warm look', size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] });
    expect(Array.from(lut.data)).toEqual(Array.from(identityLut(2).data));
    expect(parseCube(cube(2, identityRows(2), 'LUT_3D_INPUT_RANGE 0 2\n')).domainMax).toEqual([2, 2, 2]);
    expect(parseCube(cube(2, identityRows(2)).replace(/\n/g, '\r\n')).size).toBe(2);
  });

  test.each([
    ['', 'empty'],
    ['LUT_1D_SIZE 1024\n0 0 0', 'Only 3D LUTs'],
    ['0 0 0\n1 1 1', 'data before LUT_3D_SIZE'],
    [cube(2, identityRows(2).slice(0, 7)), 'incomplete'],
    [cube(2, [...identityRows(2), '1 1 1']), 'more than'],
    [cube(2, ['0 0 zero', ...identityRows(2).slice(1)]), 'not a number'],
    [cube(2, ['0 0', ...identityRows(2).slice(1)]), 'expected 3 numbers'],
    [cube(2, identityRows(2), 'LUT_IN_VIDEO_RANGE\n'), 'unsupported keyword "LUT_IN_VIDEO_RANGE"'],
    ['LUT_3D_SIZE 129\n', 'not supported'],
    ['LUT_3D_SIZE 1\n0 0 0', 'not supported'],
    [cube(2, identityRows(2), 'DOMAIN_MIN 0 0 1\n'), 'DOMAIN_MAX must be greater'],
    [cube(2, identityRows(2), 'TITLE unquoted\n'), 'quoted'],
    [`LUT_3D_SIZE 2\nLUT_3D_SIZE 2\n${identityRows(2).join('\n')}`, 'twice'],
    [`LUT_3D_SIZE 2\n${identityRows(2).slice(0, 3).join('\n')}\nTITLE "late"\n${identityRows(2).slice(3).join('\n')}`, 'before the data'],
  ])('rejects malformed input with an actionable error (%#)', (text, message) => {
    expect(() => parseCube(text)).toThrow(LutError);
    expect(() => parseCube(text)).toThrow(message);
  });

  test('accepts the common 17, 33 and 65 point sizes', () => {
    [17, 33, 65].forEach((size) => expect(parseCube(cube(size, identityRows(size))).data.length).toBe(size ** 3 * 3));
  }, 30_000);

  test('tetrahedral interpolation reproduces any linear LUT exactly and grid points exactly', () => {
    const lut = identityLut(5);
    const look = lookLut(9);
    for (let i = 0; i < 2000; i += 1) {
      const rgb = [Math.random(), Math.random(), Math.random()];
      sampleLut(lut, [...rgb]).forEach((v, c) => expect(v).toBeCloseTo(rgb[c], 6));
    }
    const grid = [2 / 8, 5 / 8, 7 / 8];
    const index = ((7 * 9 + 5) * 9 + 2) * 3;
    expect(sampleLut(look, [...grid])).toEqual(Array.from(look.data.subarray(index, index + 3)));
  });

  test('interpolation is continuous across tetrahedra and cells', () => {
    const look = lookLut(9);
    for (let i = 0; i < 3000; i += 1) {
      const rgb = [Math.random(), Math.random(), Math.random()];
      const nudged = rgb.map((v) => Math.min(1, v + 1e-6));
      const a = sampleLut(look, [...rgb]);
      const b = sampleLut(look, nudged);
      a.forEach((v, c) => expect(Math.abs(v - b[c])).toBeLessThan(1e-4));
    }
  });

  test('an identity LUT at full intensity leaves every pixel unchanged', () => {
    const source = chart();
    const ref = { sha256: 'a'.repeat(64), name: 'identity.cube' };
    expect(renderRgba8(source, deriveParams({ lut: ref }, { lut: identityLut(33) }))).toEqual(source);
  });

  test('intensity mixes source and LUT output in the encoded domain', () => {
    const look = lookLut();
    const ref = { sha256: 'b'.repeat(64), name: 'look.cube' };
    const pixel = [0.42, 0.61, 0.17];
    const full = sampleLut(look, [...pixel]);
    const at = (intensity) => processDisplay([...pixel], deriveParams({ lut: ref, lutIntensity: intensity }, { lut: look }));
    at(100).forEach((v, c) => expect(v).toBeCloseTo(full[c], 12));
    at(50).forEach((v, c) => expect(v).toBeCloseTo((pixel[c] + full[c]) / 2, 12));
    expect(deriveParams({ lut: ref, lutIntensity: 0 }, { lut: look }).lutActive).toBe(false);
  });

  test('a referenced LUT that is not loaded is skipped and reported as missing', () => {
    const params = deriveParams({ lut: { sha256: 'c'.repeat(64), name: 'gone.cube' } });
    expect(params).toMatchObject({ lutActive: false, lutMissing: true, neutral: true });
  });
});

describe('HSL', () => {
  const hueOf = ([r, g, b]) => {
    const max = Math.max(r, g, b);
    const c = max - Math.min(r, g, b);
    const h = max === r ? (g - b) / c : max === g ? (b - r) / c + 2 : (r - g) / c + 4;
    return ((h * 60) + 360) % 360;
  };
  const luminance = (p) => p.reduce((sum, v, c) => sum + LUMA[c] * srgbToLinear(v), 0);
  const hsl = (values) => deriveParams(values).hsl;

  test('range weights sum to one, are exact at each centre and change smoothly', () => {
    HSL_RANGES.forEach(({ center }, index) => expect(hslWeights(center)).toEqual([index, (index + 1) % 8, 1, 0]));
    let previous = hslWeights(0);
    for (let hue = 0.1; hue < 360; hue += 0.1) {
      const [k, n, wk, wn] = hslWeights(hue);
      expect(wk + wn).toBeCloseTo(1, 12);
      const weightOf = ([pk, pn, pwk, pwn], range) => (pk === range ? pwk : 0) + (pn === range ? pwn : 0);
      for (let range = 0; range < 8; range += 1) expect(Math.abs(weightOf([k, n, wk, wn], range) - weightOf(previous, range))).toBeLessThan(0.01);
      previous = [k, n, wk, wn];
    }
  });

  test('greys are never changed, whatever the sliders', () => {
    const all = Object.fromEntries(HSL_RANGES.flatMap(({ id }) => [[hslKey(id, 'hue'), 100], [hslKey(id, 'saturation'), -100], [hslKey(id, 'luminance'), 100]]));
    [0, 0.2, 0.5, 1].forEach((v) => expect(applyHsl([v, v, v], hsl(all))).toEqual([v, v, v]));
  });

  test('red hue +100 turns red toward orange at the same luminance', () => {
    const red = [0.8, 0.15, 0.12];
    const out = applyHsl([...red], hsl({ redHue: 100 }));
    expect(hueOf(out) - hueOf(red)).toBeGreaterThan(20);
    expect(luminance(out)).toBeCloseTo(luminance(red), 6);
  });

  test('saturation −100 in every range gives grey of the same luminance', () => {
    const values = Object.fromEntries(HSL_RANGES.map(({ id }) => [hslKey(id, 'saturation'), -100]));
    const out = applyHsl([0.2, 0.5, 0.9], hsl(values));
    expect(out[0]).toBeCloseTo(out[1], 9);
    expect(out[1]).toBeCloseTo(out[2], 9);
    expect(luminance(out)).toBeCloseTo(luminance([0.2, 0.5, 0.9]), 6);
  });

  test('a range only affects nearby hues, with a smooth falloff and no jumps', () => {
    const params = hsl({ greenLuminance: -100, greenSaturation: 60 });
    let previous = null;
    // A hard range boundary would jump by the full effect however small the step; a
    // smooth one changes in proportion to it. Steepest here is the gamut limit, where
    // extra saturation drives a bright yellow-green's blue channel to zero.
    for (let tenth = 0; tenth < 7200; tenth += 1) {
      const hue = tenth / 20;
      const k = (n) => (n + hue / 60) % 6;
      const base = [5, 3, 1].map((n) => 0.9 - 0.9 * 0.7 * Math.max(0, Math.min(k(n), 4 - k(n), 1)));
      const out = applyHsl([...base], params);
      const change = Math.max(...out.map((v, c) => Math.abs(v - base[c])));
      if (hue <= 60 || hue >= 180) expect(change).toBeLessThan(1e-12);
      if (hue === 120) expect(change).toBeGreaterThan(0.05);
      const effect = out.map((v, c) => v - base[c]);
      if (previous) effect.forEach((v, c) => expect(Math.abs(v - previous[c])).toBeLessThan(0.006));
      previous = effect;
    }
  });

  test('luminance acts in proportion to the pixel\'s saturation', () => {
    const params = hsl({ blueLuminance: 100 });
    const strong = applyHsl([0.1, 0.1, 0.9], params);
    const weak = applyHsl([0.5, 0.5, 0.55], params);
    expect(luminance(strong) / luminance([0.1, 0.1, 0.9])).toBeGreaterThan(1.5);
    expect(luminance(weak) / luminance([0.5, 0.5, 0.55])).toBeLessThan(1.1);
  });
});

describe('combined pipeline', () => {
  const look = lookLut(17);
  const ref = { sha256: 'd'.repeat(64), name: 'look.cube' };
  const everything = {
    exposure: 0.35, contrast: 25, highlights: -60, shadows: 40, temperature: 18, vibrance: 30, saturation: -10,
    curves: { master: [[0, 10], [128, 140], [255, 245]], blue: [[0, 0], [200, 180], [255, 255]] },
    orangeHue: -20, orangeSaturation: 25, blueLuminance: -40, greenSaturation: -50,
    lut: ref, lutIntensity: 70,
  };

  test('the tabulated CPU renderer matches the exact spec within one code', () => {
    const source = chart();
    [everything, { ...everything, exposure: 0, contrast: 0, highlights: 0, shadows: 0, temperature: 0, vibrance: 0, saturation: 0 }].forEach((values) => {
      const params = deriveParams(values, { lut: look });
      const fast = renderRgba8(source, params);
      for (let i = 0; i < source.length; i += 4) {
        exactPixel(source, i, params).forEach((v, c) => expect(Math.abs(fast[i + c] - v)).toBeLessThanOrEqual(1));
        expect(fast[i + 3]).toBe(source[i + 3]);
      }
    });
  });

  test('fast transfer tables stay within 1e-6 of the exact functions', () => {
    for (let i = 0; i <= 10000; i += 1) {
      const v = i / 10000;
      expect(Math.abs(fastTransfer.toSrgb(v) - linearToSrgb(v))).toBeLessThan(1e-6);
      expect(Math.abs(fastTransfer.toLinear(v) - srgbToLinear(v))).toBeLessThan(1e-6);
    }
  });

  test('matches the advanced reference fixture', () => {
    // Locked output of every stage together; update only on purpose (and the docs).
    const source = new Uint8ClampedArray([
      0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 255, 200, 60, 30, 255,
      30, 120, 200, 255, 240, 220, 180, 255, 20, 40, 25, 255, 90, 160, 70, 128,
    ]);
    expect(Array.from(renderRgba8(source, deriveParams(everything, { lut: look })))).toMatchSnapshot();
  });

  test('the shader declares every stage and samples curves and LUTs by texelFetch', () => {
    ['uCurves', 'uCurveActive', 'uHslHue', 'uHslSat', 'uHslLum', 'uLut', 'uLutIntensity', 'uBaseNeutral', 'precision highp sampler3D'].forEach((name) => expect(FRAGMENT_SHADER).toContain(name));
    expect(FRAGMENT_SHADER).toMatch(/texelFetch\(uLut/);
    expect(FRAGMENT_SHADER).not.toMatch(/\bNaN\b|undefined/);
  });
});
