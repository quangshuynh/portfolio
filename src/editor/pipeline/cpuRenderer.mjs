// Deterministic CPU renderer: the reference the GPU preview is tested against,
// the full-resolution export engine, and the preview fallback without WebGL2.
// It runs spec.processLinear per pixel with two exact-enough speedups: tone mapping
// is tabulated per render, and 8-bit encoding uses code thresholds instead of a power.

import { SRGB_TO_LINEAR_8BIT, linearToSrgb, srgbToLinear } from './colorMath.mjs';
import { developRaw, exactToneLuminance, processDisplay, processLinear } from './spec.mjs';
import { applyCreative } from './creative.mjs';

// Tabulated transfer functions for the display stages (curves, HSL, LUT), linear between
// entries: the encode table is indexed by sqrt(linear) to spend samples on the shadows.
// Both stay within 1e-7 of the exact functions, far below one 8-bit code.
const TRANSFER_TABLE_SIZE = 4096;
const OETF_TABLE = Float64Array.from({ length: TRANSFER_TABLE_SIZE + 1 }, (_, i) => linearToSrgb((i / TRANSFER_TABLE_SIZE) ** 2));
const EOTF_TABLE = Float64Array.from({ length: TRANSFER_TABLE_SIZE + 1 }, (_, i) => srgbToLinear(i / TRANSFER_TABLE_SIZE));
const lookup = (table, position) => {
  const index = Math.min(TRANSFER_TABLE_SIZE - 1, Math.floor(position));
  return table[index] + (table[index + 1] - table[index]) * (position - index);
};
export const fastTransfer = Object.freeze({
  toSrgb: (v) => (v <= 0 ? 0 : v >= 1 ? linearToSrgb(v) : lookup(OETF_TABLE, Math.sqrt(v) * TRANSFER_TABLE_SIZE)),
  toLinear: (p) => (p <= 0 ? srgbToLinear(Math.max(0, p)) : p >= 1 ? srgbToLinear(p) : lookup(EOTF_TABLE, p * TRANSFER_TABLE_SIZE)),
});

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

const positiveRowSums = (m) => [0, 1, 2].map((row) => m.slice(row * 3, row * 3 + 3).reduce((sum, v) => sum + Math.max(0, v), 0));

// Brightest luminance white balance can produce from the source (8-bit, or a RAW
// development clipped at the sensor white), times exposure. Beyond it the table falls
// back to the exact function, so this only needs to be a sensible range.
const maxLuminance = (params) => {
  const source = params.raw ? Math.max(...positiveRowSums(params.raw.matrix)) * params.raw.white : 1;
  const balance = params.whiteBalanceActive ? Math.max(...positiveRowSums(params.whiteBalance)) : 1;
  return source * balance * params.exposureGain * (1 + params.shadowLift);
};

// Glow, vignette and grain need the pixel's position, so detailRenderer.mjs renders those photos.
const assertPerPixel = (p) => {
  if (p.creative?.positional) throw new Error('Positional creative effects need the spatial renderer (detailRenderer.mjs).');
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
  assertPerPixel(p);
  const rgb = [0, 0, 0];
  for (let pixel = start; pixel < end; pixel += 1) {
    const i = pixel * 4;
    const alpha = source[i + 3];
    if (p.neutral) {
      target[i] = source[i]; target[i + 1] = source[i + 1]; target[i + 2] = source[i + 2];
    } else if (p.postActive) {
      if (p.baseNeutral) {
        rgb[0] = source[i] / 255; rgb[1] = source[i + 1] / 255; rgb[2] = source[i + 2] / 255;
      } else {
        rgb[0] = SRGB_TO_LINEAR_8BIT[source[i]];
        rgb[1] = SRGB_TO_LINEAR_8BIT[source[i + 1]];
        rgb[2] = SRGB_TO_LINEAR_8BIT[source[i + 2]];
        processLinear(rgb, p, tone);
        rgb[0] = fastTransfer.toSrgb(rgb[0]); rgb[1] = fastTransfer.toSrgb(rgb[1]); rgb[2] = fastTransfer.toSrgb(rgb[2]);
      }
      processDisplay(rgb, p, fastTransfer);
      if (p.creativeActive) applyCreative(rgb, p.creative, null, fastTransfer);
      target[i] = Math.round(rgb[0] * 255);
      target[i + 1] = Math.round(rgb[1] * 255);
      target[i + 2] = Math.round(rgb[2] * 255);
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

/**
 * Renders a RAW development to 8-bit RGBA (opaque).
 * :param source: Uint16Array of RGB camera values (decoder output, 0–65535), or the
 *   Float32Array of a merged HDR (1 = the reference exposure's sensor white)
 * :param params: deriveParams() result with `raw`, or a prepareRender() result
 * :param options: { target, start, end } with start/end pixel indices
 */
export function renderRawRgba8(source, params, {
  target = new Uint8ClampedArray((source.length / 3) * 4),
  start = 0,
  end = source.length / 3,
} = {}) {
  const prepared = params.tone && params.params ? params : prepareRender(params);
  const { params: p, tone } = prepared;
  assertPerPixel(p);
  const rgb = [0, 0, 0];
  const scale = source instanceof Float32Array ? 1 : 1 / 65535;
  for (let pixel = start; pixel < end; pixel += 1) {
    const i = pixel * 3;
    const o = pixel * 4;
    developRaw(source[i] * scale, source[i + 1] * scale, source[i + 2] * scale, p.raw, rgb);
    processLinear(rgb, p, tone);
    if (p.postActive) {
      rgb[0] = fastTransfer.toSrgb(rgb[0]); rgb[1] = fastTransfer.toSrgb(rgb[1]); rgb[2] = fastTransfer.toSrgb(rgb[2]);
      processDisplay(rgb, p, fastTransfer);
      if (p.creativeActive) applyCreative(rgb, p.creative, null, fastTransfer);
      target[o] = Math.round(rgb[0] * 255);
      target[o + 1] = Math.round(rgb[1] * 255);
      target[o + 2] = Math.round(rgb[2] * 255);
    } else {
      target[o] = encodeSrgb8(rgb[0]);
      target[o + 1] = encodeSrgb8(rgb[1]);
      target[o + 2] = encodeSrgb8(rgb[2]);
    }
    target[o + 3] = 255;
  }
  return target;
}

/**
 * Renders a decoded image of any kind: { kind: 'raw', data: Uint16Array RGB },
 * { kind: 'hdr', data: Float32Array RGB } or RGBA8 { data }. RAW and HDR sources need
 * params derived with the photo's RAW colour info.
 */
export function renderImage(image, params, options) {
  if (image.kind === 'raw' || image.kind === 'hdr') {
    if (!(params.params ?? params).raw) throw new Error('A RAW image needs RAW development parameters.');
    return renderRawRgba8(image.data, params, options);
  }
  return renderRgba8(image.data, params, options);
}
