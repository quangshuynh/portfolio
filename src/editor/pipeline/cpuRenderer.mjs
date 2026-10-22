// Deterministic CPU renderer: the reference the GPU preview is tested against,
// the full-resolution export engine, and the preview fallback without WebGL2.
// It runs spec.processLinear per pixel with two exact-enough speedups: tone mapping
// is tabulated per render, and 8-bit encoding uses code thresholds instead of a power.

import { SRGB_TO_LINEAR_8BIT, srgbToLinear } from './colorMath.mjs';
import { exactToneLuminance, processLinear } from './spec.mjs';

// Linear value at which each sRGB code begins: code c covers [T[c], T[c + 1]).
const ENCODE_THRESHOLDS = Float64Array.from({ length: 256 }, (_, code) => (code === 0 ? -Infinity : srgbToLinear((code - 0.5) / 255)));

const GUESS_SIZE = 16384;
const CODE_GUESS = Uint8Array.from({ length: GUESS_SIZE + 1 }, (_, i) => {
  let code = 0;
  while (code < 255 && i / GUESS_SIZE >= ENCODE_THRESHOLDS[code + 1]) code += 1;
  return code;
});

/** Linear [0, 1] -> nearest 8-bit sRGB code, identical to round(oetf(v) * 255). */
export function encodeSrgb8(value) {
  let code = CODE_GUESS[Math.min(GUESS_SIZE, Math.max(0, Math.floor(value * GUESS_SIZE)))];
  while (code < 255 && value >= ENCODE_THRESHOLDS[code + 1]) code += 1;
  while (code > 0 && value < ENCODE_THRESHOLDS[code]) code -= 1;
  return code;
}

// The tone table is indexed by sqrt(luminance), which spends samples on the shadows.
const TONE_TABLE_SIZE = 8192;

/** Tabulated tone mapping of linear luminance for one parameter set. */
export function toneTable(tone, maxLuminance) {
  const maxRoot = Math.sqrt(Math.max(1, maxLuminance));
  const scale = (TONE_TABLE_SIZE - 1) / maxRoot;
  const table = new Float64Array(TONE_TABLE_SIZE);
  for (let i = 0; i < TONE_TABLE_SIZE; i += 1) {
    const root = i / scale;
    table[i] = exactToneLuminance(root * root, tone);
  }
  return (y) => {
    const position = Math.sqrt(y) * scale;
    if (position >= TONE_TABLE_SIZE - 1) return exactToneLuminance(y, tone);
    const index = Math.floor(position);
    const fraction = position - index;
    return table[index] + (table[index + 1] - table[index]) * fraction;
  };
}

// Brightest luminance white balance can produce from an 8-bit source, times exposure.
const maxLuminance = (params) => {
  const rowSums = params.whiteBalanceActive
    ? [0, 1, 2].map((row) => params.whiteBalance.slice(row * 3, row * 3 + 3).reduce((sum, v) => sum + Math.max(0, v), 0))
    : [1, 1, 1];
  return Math.max(...rowSums) * params.exposureGain;
};

/** Per-render state for renderRgba8: build once, reuse across bands. */
export function prepareRender(params) {
  return { params, tone: params.toneActive ? toneTable(params.tone, maxLuminance(params)) : exactToneLuminance };
}

/**
 * Renders 8-bit RGBA pixels (straight, not premultiplied alpha). Alpha is copied.
 * :param source: Uint8ClampedArray or Uint8Array RGBA
 * :param params: deriveParams() result, or a prepareRender() result
 * :param options: { target, start, end, flattenAlpha } where start/end are pixel
 *   indices and flattenAlpha composites onto white (for JPEG output)
 * :returns: target array (a new Uint8ClampedArray unless one is given)
 */
export function renderRgba8(source, params, {
  target = new Uint8ClampedArray(source.length),
  start = 0,
  end = source.length / 4,
  flattenAlpha = false,
} = {}) {
  const prepared = params.tone && params.params ? params : prepareRender(params);
  const { params: p, tone } = prepared;
  const rgb = [0, 0, 0];
  for (let pixel = start; pixel < end; pixel += 1) {
    const i = pixel * 4;
    const alpha = source[i + 3];
    if (p.neutral) {
      target[i] = source[i]; target[i + 1] = source[i + 1]; target[i + 2] = source[i + 2];
    } else {
      rgb[0] = SRGB_TO_LINEAR_8BIT[source[i]];
      rgb[1] = SRGB_TO_LINEAR_8BIT[source[i + 1]];
      rgb[2] = SRGB_TO_LINEAR_8BIT[source[i + 2]];
      processLinear(rgb, p, tone);
      target[i] = encodeSrgb8(rgb[0]);
      target[i + 1] = encodeSrgb8(rgb[1]);
      target[i + 2] = encodeSrgb8(rgb[2]);
    }
    if (flattenAlpha && alpha < 255) {
      // "Over" white in linear light, so semi-transparent edges do not darken.
      const coverage = alpha / 255;
      for (let c = 0; c < 3; c += 1) {
        target[i + c] = encodeSrgb8(SRGB_TO_LINEAR_8BIT[target[i + c]] * coverage + (1 - coverage));
      }
      target[i + 3] = 255;
    } else {
      target[i + 3] = alpha;
    }
  }
  return target;
}

/**
 * Renders in row bands so a worker can report progress between them.
 * :param onBand: called with the fraction done after each band
 */
export function renderRgba8InBands(source, params, { width, height, target, flattenAlpha, bandRows = 256, onBand } = {}) {
  const prepared = prepareRender(params);
  const out = target ?? new Uint8ClampedArray(source.length);
  for (let row = 0; row < height; row += bandRows) {
    const last = Math.min(height, row + bandRows);
    renderRgba8(source, prepared, { target: out, start: row * width, end: last * width, flattenAlpha });
    onBand?.(last / height);
  }
  return out;
}
