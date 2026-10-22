// The rendering specification. `deriveParams` turns slider values into the numbers
// both renderers use, and `toneCurve`/`processPixel` are the reference per-pixel
// definition. The GLSL in shader.mjs mirrors these functions line for line; the
// browser parity check compares the two. Change both together, and update
// docs/photography-editor.md.
//
// Fixed order, in linear sRGB (Rec.709 primaries, D65):
//   decode sRGB -> white balance -> exposure -> tone (contrast, highlights, shadows,
//   whites, blacks on luminance) -> vibrance -> saturation -> range fit -> encode sRGB.

import { LUMA, linearToSrgb, srgbToLinear, whiteBalanceMatrix } from './colorMath.mjs';
import { normalizeAdjustments } from '../model/adjustments.mjs';

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
 * Slider values -> renderer parameters.
 * :param adjustments: adjustment values (normalised here)
 * :returns: plain object; `neutral` is true when the pipeline is the identity
 */
export function deriveParams(adjustments) {
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
  params.neutral = !whiteBalanceActive && params.exposureGain === 1 && !toneActive
    && params.vibrance === 0 && params.saturation === 1;
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
