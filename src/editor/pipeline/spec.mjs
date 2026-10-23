// The rendering specification. `deriveParams` turns slider values into the numbers
// both renderers use, and `toneCurve`/`processLinear`/`processDisplay` are the
// reference per-pixel definition. The GLSL in shader.mjs mirrors these functions line
// for line; the browser parity check compares the two. Change both together, and
// update docs/photography-editor.md.
//
// Fixed order. In linear sRGB (Rec.709 primaries, D65):
//   decode sRGB -> white balance -> exposure -> tone (contrast, highlights, shadows,
//   whites, blacks on luminance) -> vibrance -> saturation -> range fit -> encode sRGB.
// Then on the sRGB-encoded values (display-referred, 0–1):
//   tone curves (master, then per channel) -> HSL -> 3D LUT (mixed by intensity).
// Each later stage is skipped when neutral, so earlier edits render unchanged.
//
// RAW photos start before that from 16-bit linear camera RGB (see raw/rawColor.mjs):
//   per-channel white balance gain, clip at the sensor white -> camera matrix to
//   linear sRGB -> the steps above, with a highlight rolloff right after exposure.
// Their "decode" step is this development, never the sRGB EOTF, and nothing is
// rounded to 8 bits before the final quantisation.
//
// Merged RAW HDR photos (hdr/) are float camera RGB in the reference exposure's space,
// unclipped up to `raw.white` (> 1). They develop the same way, clipped at that white
// instead of 1, then get the HDR tone stage right after exposure: a shadow lift and the
// highlight rolloff with an adjustable knee, mapping the merged white to display white.

import { LUMA, linearToSrgb, srgbToLinear, whiteBalanceMatrix } from './colorMath.mjs';
import { HSL_RANGES, hslKey, normalizeAdjustments } from '../model/adjustments.mjs';
import { curveTables, sampleCurve } from './curves.mjs';
import { sampleLut } from './lut.mjs';
import { rawDevelopParams } from '../raw/rawColor.mjs';

// Middle grey (18% linear) in the sRGB-encoded tone domain: the contrast pivot.
export const TONE_PIVOT = linearToSrgb(0.18);

// Curve strengths at ±100. Each pair keeps its curve monotonic on [0, 1] (see the
// derivative bounds in the docs), so no slider can invert tones.
export const TONE_LIMITS = Object.freeze({
  contrast: 0.75,
  highlightsDown: 4.5,
  highlightsUp: 0.95,
  shadowsUp: 3.5,
  shadowsDown: 0.95,
  whites: 0.25,
  blacks: 0.1,
});

/** Luminance below which a pixel is treated as black for ratio-based tone mapping. */
export const BLACK_EPSILON = 1e-7;

/**
 * RAW highlight rolloff: luminance below the knee is untouched; above it a rational
 * shoulder (slope 1 at the knee) maps the sensor white, after positive exposure, to
 * display white instead of clipping. It only compresses data that exists in the file.
 */
export const ROLLOFF_KNEE = 0.5;

/** Highlight rolloff of linear luminance `y` for a sensor white at `white` (> 1). */
export function highlightRolloff(y, white, knee = ROLLOFF_KNEE) {
  if (y <= knee) return y;
  const excess = y - knee;
  const a = (white - 1) / ((1 - knee) * (white - knee));
  return knee + excess / (1 + excess * a);
}

/**
 * HDR tone stage. Highlight compression 0–100 moves the rolloff knee from 0.9 to 0.1
 * (50 is the RAW knee, 0.5); shadow lift 0–100 brightens the darkest tones by up to
 * 2x with a gain that fades above SHADOW_LIFT_SCALE: y + a·c·y / (y + c), monotonic.
 */
export const hdrKnee = (compression) => 0.9 - 0.8 * (compression / 100);
export const SHADOW_LIFT_SCALE = 0.05;
export const shadowLift = (y, amount) => y + (amount * SHADOW_LIFT_SCALE * y) / (y + SHADOW_LIFT_SCALE);

/** HSL hue sliders at ±100 move hues by this many degrees. */
export const HUE_SHIFT_MAX = 30;
/** HSL luminance sliders at ±100 change fully saturated colours by this many stops. */
export const HSL_LUMINANCE_EV = 1;
export const HSL_CENTERS = Object.freeze(HSL_RANGES.map(({ center }) => center));

/**
 * Slider values -> renderer parameters.
 * :param adjustments: settings (normalised here)
 * :param options: { lut, raw } `lut` is the parsed LUT that `adjustments.lut` refers
 *   to, if loaded (a referenced LUT that is not loaded is skipped; the UI reports it as
 *   missing); `raw` is the photo's decoder colour info for a RAW source, else null
 * :returns: plain object; `neutral` is true when the pipeline is the identity
 */
export function deriveParams(adjustments, { lut = null, raw = null } = {}) {
  const a = normalizeAdjustments(adjustments);
  const highlights = a.highlights / 100;
  const shadows = a.shadows / 100;
  const tone = {
    contrast: (a.contrast / 100) * TONE_LIMITS.contrast,
    highlights: highlights * (highlights < 0 ? TONE_LIMITS.highlightsDown : TONE_LIMITS.highlightsUp),
    shadows: shadows * (shadows > 0 ? TONE_LIMITS.shadowsUp : TONE_LIMITS.shadowsDown),
    whites: (a.whites / 100) * TONE_LIMITS.whites,
    blacks: (a.blacks / 100) * TONE_LIMITS.blacks,
  };
  const toneActive = Object.values(tone).some((value) => value !== 0);
  const whiteBalanceActive = a.temperature !== 0 || a.tint !== 0;
  const params = {
    whiteBalanceActive,
    whiteBalance: whiteBalanceMatrix(a.temperature, a.tint),
    exposureGain: 2 ** a.exposure,
    toneActive,
    tone,
    vibrance: a.vibrance / 100,
    saturation: 1 + a.saturation / 100,
  };
  params.raw = raw ? rawDevelopParams(raw, { ...a.raw, temperature: a.rawTemperature, tint: a.rawTint }) : null;
  params.hdr = Boolean(params.raw && params.raw.white > 1);
  // The rolloff keeps the sensor (or merged) white at display white when it would clip.
  const white = (params.raw?.white ?? 1) * params.exposureGain;
  params.rolloffWhite = params.raw && white > 1 ? white : 0;
  params.rolloffKnee = params.hdr ? hdrKnee(a.hdrHighlights) : ROLLOFF_KNEE;
  params.shadowLift = params.hdr ? a.hdrShadows / 100 : 0;
  // A RAW source always needs developing, so its base stage is never the identity.
  params.baseNeutral = !params.raw && !whiteBalanceActive && params.exposureGain === 1 && !toneActive
    && params.vibrance === 0 && params.saturation === 1;

  params.curves = curveTables(a.curves);
  params.curvesActive = params.curves.active.some(Boolean);
  const hsl = { hue: [], saturation: [], luminance: [] };
  HSL_RANGES.forEach(({ id }) => {
    hsl.hue.push((a[hslKey(id, 'hue')] / 100) * HUE_SHIFT_MAX);
    hsl.saturation.push(a[hslKey(id, 'saturation')] / 100);
    hsl.luminance.push(a[hslKey(id, 'luminance')] / 100);
  });
  params.hsl = hsl;
  params.hslActive = [...hsl.hue, ...hsl.saturation, ...hsl.luminance].some((value) => value !== 0);
  params.lut = a.lut && lut ? lut : null;
  params.lutIntensity = a.lutIntensity / 100;
  params.lutActive = Boolean(params.lut) && params.lutIntensity > 0;
  params.lutMissing = Boolean(a.lut) && !lut;
  params.postActive = params.curvesActive || params.hslActive || params.lutActive;
  params.neutral = params.baseNeutral && !params.postActive;
  return params;
}

/** Tone curve on the sRGB-encoded luminance `p`. Values above 1 keep their excess. */
export function toneCurve(p, tone) {
  let x = Math.min(1, Math.max(0, p));
  const excess = Math.max(0, p - 1);
  // Contrast: blend toward a symmetric power S-curve through 0, the pivot and 1.
  const m = TONE_PIVOT;
  const s = x < m ? m * (x / m) ** 2 : 1 - (1 - m) * ((1 - x) / (1 - m)) ** 2;
  x += tone.contrast * (s - x);
  // Highlights and shadows: mirrored x^5(1-x) bumps peaking at 5/6 and 1/6 that
  // leave black and white fixed and only lightly touch middle grey.
  const x2 = x * x;
  x += tone.highlights * x2 * x2 * x * (1 - x);
  const inv = 1 - x;
  const inv2 = inv * inv;
  x += tone.shadows * x * inv2 * inv2 * inv;
  // Whites scale the top of the range; blacks offset the bottom.
  x *= 1 + tone.whites * x * x;
  const below = Math.max(0, 1 - x);
  x += tone.blacks * below * below;
  return x + excess;
}

/** Exact tone mapping of linear luminance. */
export const exactToneLuminance = (y, tone) => srgbToLinear(toneCurve(linearToSrgb(y), tone));

/**
 * Reference implementation for one pixel of linear RGB. Mutates and returns `rgb`.
 * :param rgb: [r, g, b] linear, usually in [0, 1]
 * :param params: deriveParams() result
 * :param toneLuminance: (y, tone) -> y'; the CPU renderer passes a tabulated version
 * :returns: linear RGB in [0, 1]
 */
export function processLinear(rgb, params, toneLuminance = exactToneLuminance) {
  let [r, g, b] = rgb;
  if (params.whiteBalanceActive) {
    const m = params.whiteBalance;
    const wr = m[0] * r + m[1] * g + m[2] * b;
    const wg = m[3] * r + m[4] * g + m[5] * b;
    const wb = m[6] * r + m[7] * g + m[8] * b;
    r = Math.max(0, wr); g = Math.max(0, wg); b = Math.max(0, wb);
  }
  const gain = params.exposureGain;
  r *= gain; g *= gain; b *= gain;

  let y = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b;
  if (params.shadowLift && y > BLACK_EPSILON) {
    const ratio = shadowLift(y, params.shadowLift) / y;
    r *= ratio; g *= ratio; b *= ratio;
    y *= ratio;
  }
  if (params.rolloffWhite && y > params.rolloffKnee) {
    const ratio = highlightRolloff(y, params.rolloffWhite, params.rolloffKnee) / y;
    r *= ratio; g *= ratio; b *= ratio;
    y *= ratio;
  }
  if (params.toneActive) {
    if (y > BLACK_EPSILON) {
      const ratio = toneLuminance(y, params.tone) / y;
      r *= ratio; g *= ratio; b *= ratio;
      y *= ratio;
    } else {
      y = toneLuminance(0, params.tone);
      r = y; g = y; b = y;
    }
  }

  // Vibrance, then saturation, both about luminance, so luminance is unchanged.
  if (params.vibrance !== 0) {
    const max = Math.max(r, g, b);
    const chroma = max > BLACK_EPSILON ? (max - Math.min(r, g, b)) / max : 0;
    const factor = Math.max(0, 1 + params.vibrance * (1 - chroma));
    r = y + (r - y) * factor; g = y + (g - y) * factor; b = y + (b - y) * factor;
  }
  if (params.saturation !== 1) {
    const factor = params.saturation;
    r = y + (r - y) * factor; g = y + (g - y) * factor; b = y + (b - y) * factor;
  }

  // Range fit: pull out-of-range colours toward their own luminance instead of
  // clipping channels independently, which would shift hue.
  const max = Math.max(r, g, b);
  if (max > 1) {
    if (y >= 1) {
      r = 1; g = 1; b = 1;
    } else {
      const t = (1 - y) / (max - y);
      r = y + (r - y) * t; g = y + (g - y) * t; b = y + (b - y) * t;
    }
  }
  const min = Math.min(r, g, b);
  if (min < 0) {
    if (y <= 0) {
      r = 0; g = 0; b = 0;
    } else {
      const t = y / (y - min);
      r = y + (r - y) * t; g = y + (g - y) * t; b = y + (b - y) * t;
    }
  }
  rgb[0] = Math.min(1, Math.max(0, r));
  rgb[1] = Math.min(1, Math.max(0, g));
  rgb[2] = Math.min(1, Math.max(0, b));
  return rgb;
}

/**
 * RAW development of one pixel: decoded camera RGB (0–1, as-shot white balance,
 * normalised by the largest multiplier; up to `raw.white` for a merged HDR) -> linear sRGB. Writes into and returns `out`;
 * values may be negative or above 1 (out of gamut) until processLinear fits them.
 */
export function developRaw(r, g, b, raw, out) {
  const { gain, matrix: m, white } = raw;
  const cr = Math.min(white, r * gain[0]);
  const cg = Math.min(white, g * gain[1]);
  const cb = Math.min(white, b * gain[2]);
  out[0] = m[0] * cr + m[1] * cg + m[2] * cb;
  out[1] = m[3] * cr + m[4] * cg + m[5] * cb;
  out[2] = m[6] * cr + m[7] * cg + m[8] * cb;
  return out;
}

/**
 * HSL range weights for a hue in degrees [0, 360): the two ranges whose centres
 * enclose it, blended with a raised cosine so the weights sum to 1 and change
 * smoothly (no hard boundary between ranges).
 * :returns: [index, nextIndex, weight, nextWeight]
 */
export function hslWeights(hue, out = [0, 0, 0, 0]) {
  let k = HSL_CENTERS.length - 1;
  while (k > 0 && hue < HSL_CENTERS[k]) k -= 1;
  const next = (k + 1) % HSL_CENTERS.length;
  const end = next === 0 ? 360 : HSL_CENTERS[next];
  const t = (hue - HSL_CENTERS[k]) / (end - HSL_CENTERS[k]);
  const nextWeight = 0.5 - 0.5 * Math.cos(Math.PI * t);
  out[0] = k; out[1] = next; out[2] = 1 - nextWeight; out[3] = nextWeight;
  return out;
}

/** HSV colour (hue in degrees) to RGB, all encoded 0–1. */
function hsvToRgb(hue, s, v, out) {
  for (let c = 0; c < 3; c += 1) {
    const k = (5 - 2 * c + hue / 60) % 6;
    out[c] = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  }
  return out;
}

/** Pulls linear RGB into 0–1 toward its luminance `y`, as the range fit in processLinear. */
function fitRange(rgb, y) {
  let r = rgb[0];
  let g = rgb[1];
  let b = rgb[2];
  const max = Math.max(r, g, b);
  if (max > 1) {
    if (y >= 1) { r = 1; g = 1; b = 1; } else {
      const t = (1 - y) / (max - y);
      r = y + (r - y) * t; g = y + (g - y) * t; b = y + (b - y) * t;
    }
  }
  const min = Math.min(r, g, b);
  if (min < 0) {
    if (y <= 0) { r = 0; g = 0; b = 0; } else {
      const t = y / (y - min);
      r = y + (r - y) * t; g = y + (g - y) * t; b = y + (b - y) * t;
    }
  }
  rgb[0] = Math.min(1, Math.max(0, r));
  rgb[1] = Math.min(1, Math.max(0, g));
  rgb[2] = Math.min(1, Math.max(0, b));
  return rgb;
}

const scratchHsv = [0, 0, 0];
const scratchWeights = [0, 0, 0, 0];
const scratchLinear = [0, 0, 0];
const scratchLut = [0, 0, 0];

/**
 * HSL on one encoded pixel. Range weights come from the HSV hue of the encoded
 * values; greys (no chroma) are untouched. Hue turns around the HSV colour wheel at
 * constant luminance; saturation scales chroma about luminance in linear light;
 * luminance is a gain of up to ±HSL_LUMINANCE_EV stops, scaled by the pixel's HSV
 * saturation so near-greys barely change. The result is range-fitted like the base.
 */
export function applyHsl(p, hsl, toLinear = srgbToLinear, toSrgb = linearToSrgb) {
  const r = p[0];
  const g = p[1];
  const b = p[2];
  const max = Math.max(r, g, b);
  const chroma = max - Math.min(r, g, b);
  if (chroma <= 0) return p;
  let hue = max === r ? (g - b) / chroma : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  const s = chroma / max;
  hslWeights(hue, scratchWeights);
  const k = scratchWeights[0];
  const n = scratchWeights[1];
  const wk = scratchWeights[2];
  const wn = scratchWeights[3];
  const shift = wk * hsl.hue[k] + wn * hsl.hue[n];
  const saturation = 1 + wk * hsl.saturation[k] + wn * hsl.saturation[n];
  const luminance = wk * hsl.luminance[k] + wn * hsl.luminance[n];
  // Pixels in ranges nobody adjusted are returned exactly (the shader does the same).
  if (shift === 0 && saturation === 1 && luminance === 0) return p;
  const lin = scratchLinear;
  for (let c = 0; c < 3; c += 1) lin[c] = toLinear(p[c]);
  let y = LUMA[0] * lin[0] + LUMA[1] * lin[1] + LUMA[2] * lin[2];
  if (shift !== 0) {
    const turned = hue + shift;
    hsvToRgb(turned - 360 * Math.floor(turned / 360), s, max, scratchHsv);
    for (let c = 0; c < 3; c += 1) lin[c] = toLinear(scratchHsv[c]);
    const turnedY = LUMA[0] * lin[0] + LUMA[1] * lin[1] + LUMA[2] * lin[2];
    if (turnedY > BLACK_EPSILON) for (let c = 0; c < 3; c += 1) lin[c] *= y / turnedY;
  }
  if (saturation !== 1) {
    const factor = Math.max(0, saturation);
    for (let c = 0; c < 3; c += 1) lin[c] = y + (lin[c] - y) * factor;
  }
  if (luminance !== 0) {
    const gain = 2 ** (HSL_LUMINANCE_EV * luminance * s);
    for (let c = 0; c < 3; c += 1) lin[c] *= gain;
    y *= gain;
  }
  fitRange(lin, y);
  for (let c = 0; c < 3; c += 1) p[c] = toSrgb(lin[c]);
  return p;
}

/**
 * The display-referred stages on one pixel of sRGB-encoded values. Mutates and returns `p`.
 * :param transfer: { toLinear, toSrgb }; the CPU renderer passes tabulated versions
 */
export function processDisplay(p, params, { toLinear = srgbToLinear, toSrgb = linearToSrgb } = {}) {
  if (params.curvesActive) {
    const { table, active } = params.curves;
    for (let c = 0; c < 3; c += 1) {
      let v = p[c];
      if (active[3]) v = sampleCurve(table, 3, v);
      if (active[c]) v = sampleCurve(table, c, v);
      p[c] = v;
    }
  }
  if (params.hslActive) applyHsl(p, params.hsl, toLinear, toSrgb);
  if (params.lutActive) {
    scratchLut[0] = p[0]; scratchLut[1] = p[1]; scratchLut[2] = p[2];
    sampleLut(params.lut, scratchLut);
    const t = params.lutIntensity;
    for (let c = 0; c < 3; c += 1) p[c] += (scratchLut[c] - p[c]) * t;
  }
  return p;
}
