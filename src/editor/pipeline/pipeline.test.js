import { ADJUSTMENTS, neutralAdjustments } from '../model/adjustments.mjs';
import { SRGB_TO_LINEAR_8BIT, linearToSrgb, srgbToLinear, whiteBalanceMatrix } from './colorMath.mjs';
import { encodeSrgb8, renderRgba8, renderRgba8InBands } from './cpuRenderer.mjs';
import { deriveParams, processLinear, toneCurve } from './spec.mjs';
import { FRAGMENT_SHADER } from './shader.mjs';

const pixel = (r, g, b, a = 255) => new Uint8ClampedArray([r, g, b, a]);
const render = (adjustments, rgba) => Array.from(renderRgba8(rgba, deriveParams(adjustments)));
const grey = (code, adjustments) => render(adjustments, pixel(code, code, code))[0];

// Every 8-bit RGB value in steps of 15, plus alpha variations.
function chart() {
  const values = [];
  for (let r = 0; r <= 255; r += 15) for (let g = 0; g <= 255; g += 15) for (let b = 0; b <= 255; b += 15) values.push(r, g, b, (r + g) % 256);
  return new Uint8ClampedArray(values);
}

describe('transfer functions', () => {
  test('sRGB decode and encode are inverse and continuous', () => {
    for (let code = 0; code <= 255; code += 1) {
      expect(linearToSrgb(srgbToLinear(code / 255)) * 255).toBeCloseTo(code, 9);
      expect(SRGB_TO_LINEAR_8BIT[code]).toBe(srgbToLinear(code / 255));
    }
  });

  test('threshold encoder matches the rounded formula', () => {
    for (let i = 0; i <= 20000; i += 1) {
      const value = (i / 20000) ** 2.2;
      expect(encodeSrgb8(value)).toBe(Math.round(linearToSrgb(value) * 255));
    }
    expect(encodeSrgb8(-1)).toBe(0);
    expect(encodeSrgb8(2)).toBe(255);
  });
});

describe('neutral settings', () => {
  test('are the exact identity for every pixel, alpha included', () => {
    const source = chart();
    expect(deriveParams(neutralAdjustments()).neutral).toBe(true);
    expect(renderRgba8(source, deriveParams({}))).toEqual(source);
  });

  test('the full non-neutral path reproduces the source within rounding', () => {
    // Exposure 0 with an inactive pipeline would short-circuit; force the full path.
    const params = { ...deriveParams({}), neutral: false };
    const source = chart();
    const output = renderRgba8(source, params);
    source.forEach((value, i) => expect(Math.abs(output[i] - value)).toBeLessThanOrEqual(0));
  });

  test('white balance matrix is exactly the identity at 0/0', () => {
    expect(whiteBalanceMatrix(0, 0)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });
});

describe('light adjustments', () => {
  test('exposure multiplies linear light by 2^EV', () => {
    const params = deriveParams({ exposure: 1 });
    expect(processLinear([0.1, 0.2, 0.05], params)).toEqual([0.2, 0.4, 0.1]);
    expect(deriveParams({ exposure: -2 }).exposureGain).toBe(0.25);
    expect(grey(255, { exposure: -1 })).toBe(Math.round(linearToSrgb(0.5) * 255));
  });

  test('exposure clips to white without hue shift', () => {
    const [r, g, b] = processLinear([0.5, 0.25, 0.1], deriveParams({ exposure: 1.5 }));
    expect(Math.max(r, g, b)).toBeCloseTo(1, 12);
    // Range fit keeps the colour between its luminance and the original hue direction.
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  test('every tone curve is monotonic at every slider extreme', () => {
    const tones = ['contrast', 'highlights', 'shadows', 'whites', 'blacks'];
    tones.forEach((key) => [-100, -50, 50, 100].forEach((value) => {
      const { tone } = deriveParams({ [key]: value });
      let previous = -Infinity;
      for (let i = 0; i <= 1000; i += 1) {
        const out = toneCurve(i / 1000, tone);
        expect(out).toBeGreaterThanOrEqual(previous);
        previous = out;
      }
    }));
  });

  test('contrast pivots on middle grey and spreads tones', () => {
    const mid = Math.round(linearToSrgb(0.18) * 255);
    expect(Math.abs(grey(mid, { contrast: 100 }) - mid)).toBeLessThanOrEqual(1);
    expect(grey(60, { contrast: 60 })).toBeLessThan(60);
    expect(grey(200, { contrast: 60 })).toBeGreaterThan(200);
    expect(grey(60, { contrast: -60 })).toBeGreaterThan(60);
  });

  test('highlights act on bright tones, keep black and white fixed, and barely move shadows', () => {
    expect(grey(255, { highlights: -100 })).toBe(255);
    expect(grey(0, { highlights: -100 })).toBe(0);
    const brightDrop = 215 - grey(215, { highlights: -100 });
    const midDrop = 118 - grey(118, { highlights: -100 });
    expect(brightDrop).toBeGreaterThan(30);
    expect(midDrop).toBeLessThan(brightDrop / 2);
    expect(grey(40, { highlights: -100 })).toBeGreaterThanOrEqual(39);
    expect(grey(215, { highlights: 100 })).toBeGreaterThan(215);
  });

  test('shadows lift dark tones and leave highlights nearly alone', () => {
    expect(grey(0, { shadows: 100 })).toBe(0);
    expect(grey(255, { shadows: 100 })).toBe(255);
    expect(grey(45, { shadows: 100 }) - 45).toBeGreaterThan(30);
    expect(grey(220, { shadows: 100 }) - 220).toBeLessThanOrEqual(1);
    expect(grey(45, { shadows: -100 })).toBeLessThan(45);
  });

  test('whites move the white point and blacks the black point', () => {
    expect(grey(230, { whites: 100 })).toBe(255);
    expect(grey(255, { whites: -100 })).toBeLessThan(245);
    expect(grey(0, { blacks: 100 })).toBeGreaterThan(20);
    expect(grey(20, { blacks: -100 })).toBe(0);
    expect(Math.abs(grey(250, { blacks: 100 }) - 250)).toBeLessThanOrEqual(1);
  });

  test('tone changes keep the hue of coloured pixels', () => {
    const [r, g, b] = render({ shadows: 80, contrast: 30 }, pixel(90, 50, 30));
    const ratio = (x, y) => srgbToLinear(x / 255) / srgbToLinear(y / 255);
    expect(ratio(r, g)).toBeCloseTo(ratio(90, 50), 1);
    expect(ratio(g, b)).toBeCloseTo(ratio(50, 30), 1);
  });
});

describe('colour adjustments', () => {
  test('temperature warms or cools a neutral grey', () => {
    const [wr, , wb] = render({ temperature: 60 }, pixel(128, 128, 128));
    const [cr, , cb] = render({ temperature: -60 }, pixel(128, 128, 128));
    expect(wr).toBeGreaterThan(wb);
    expect(cb).toBeGreaterThan(cr);
  });

  test('tint shifts between magenta and green', () => {
    const [mr, mg, mb] = render({ tint: 60 }, pixel(128, 128, 128));
    const [gr, gg, gb] = render({ tint: -60 }, pixel(128, 128, 128));
    expect(mg).toBeLessThan(Math.min(mr, mb));
    expect(gg).toBeGreaterThan(Math.max(gr, gb));
  });

  test('white balance roughly preserves the luminance of grey', () => {
    [-100, 100].forEach((temperature) => {
      const [r, g, b] = processLinear([0.18, 0.18, 0.18], deriveParams({ temperature }));
      expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeCloseTo(0.18, 2);
    });
  });

  test('saturation -100 produces grey with the same luminance', () => {
    const [r, g, b] = processLinear([0.6, 0.2, 0.05], deriveParams({ saturation: -100 }));
    expect(r).toBeCloseTo(g, 12);
    expect(g).toBeCloseTo(b, 12);
    expect(r).toBeCloseTo(0.2126 * 0.6 + 0.7152 * 0.2 + 0.0722 * 0.05, 12);
  });

  test('vibrance boosts muted colours more than saturated ones', () => {
    const spread = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b);
    const muted = [0.30, 0.26, 0.24];
    const vivid = [0.60, 0.10, 0.05];
    const gain = (rgb) => spread(processLinear([...rgb], deriveParams({ vibrance: 100 }))) / spread(rgb);
    expect(gain(muted)).toBeGreaterThan(gain(vivid));
    expect(gain(vivid)).toBeGreaterThanOrEqual(1);
  });

  test('greys are unaffected by saturation and vibrance', () => {
    expect(render({ saturation: 100, vibrance: 100 }, pixel(77, 77, 77)).slice(0, 3)).toEqual([77, 77, 77]);
  });
});

describe('CPU renderer', () => {
  const edit = { exposure: 0.35, contrast: 25, highlights: -60, shadows: 40, whites: 10, blacks: -15, temperature: 18, tint: -6, vibrance: 30, saturation: -10 };

  test('tabulated rendering matches the exact per-pixel spec within one code', () => {
    const source = chart();
    const params = deriveParams(edit);
    const fast = renderRgba8(source, params);
    for (let i = 0; i < source.length; i += 4) {
      const exact = processLinear([0, 1, 2].map((c) => SRGB_TO_LINEAR_8BIT[source[i + c]]), params);
      exact.forEach((value, c) => expect(Math.abs(fast[i + c] - Math.round(linearToSrgb(value) * 255))).toBeLessThanOrEqual(1));
    }
  });

  test('is deterministic and band rendering equals a single pass', () => {
    const source = chart();
    const params = deriveParams(edit);
    const width = 16;
    const height = source.length / 4 / width;
    const once = renderRgba8(source, params);
    expect(renderRgba8(source, params)).toEqual(once);
    const progress = [];
    expect(renderRgba8InBands(source, params, { width, height, bandRows: 7, onBand: (f) => progress.push(f) })).toEqual(once);
    expect(progress.at(-1)).toBe(1);
  });

  test('matches the reference fixture', () => {
    // Locked output of the spec for a small chart. A change here is a change to the
    // rendering of every saved edit, so update it only on purpose (and the docs).
    const source = new Uint8ClampedArray([
      0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 255, 200, 60, 30, 255,
      30, 120, 200, 255, 240, 220, 180, 255, 20, 40, 25, 255, 90, 160, 70, 128,
    ]);
    expect(Array.from(renderRgba8(source, deriveParams(edit)))).toMatchSnapshot();
  });

  test('flattens transparency onto white for JPEG output', () => {
    const out = renderRgba8(pixel(0, 0, 0, 0), deriveParams({}), { flattenAlpha: true });
    expect(Array.from(out)).toEqual([255, 255, 255, 255]);
    const half = renderRgba8(pixel(0, 0, 0, 128), deriveParams({}), { flattenAlpha: true });
    expect(half[0]).toBe(Math.round(linearToSrgb(1 - 128 / 255) * 255));
  });

  test('every slider extreme stays in range and finite', () => {
    const source = chart();
    ADJUSTMENTS.forEach(({ key, min, max }) => [min, max].forEach((value) => {
      const out = renderRgba8(source, deriveParams({ [key]: value }));
      expect(out.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)).toBe(true);
    }));
  });
});

describe('shader source', () => {
  test('mirrors every tone and colour parameter of the spec', () => {
    ['uContrast', 'uHighlights', 'uShadows', 'uWhites', 'uBlacks', 'uVibrance', 'uSaturation', 'uExposureGain', 'uWhiteBalance'].forEach((name) => {
      expect(FRAGMENT_SHADER).toContain(`uniform`);
      expect(FRAGMENT_SHADER).toContain(name);
    });
    expect(FRAGMENT_SHADER).not.toMatch(/\bNaN\b|undefined/);
  });
});
