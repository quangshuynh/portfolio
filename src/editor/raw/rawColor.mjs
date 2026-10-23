// RAW white balance and camera colour. Pure math, shared by the decoder worker, both
// renderers and the tests.
//
// The decoder (LibRaw) returns demosaiced camera RGB, white balanced with the as-shot
// multipliers `a` and normalised by their largest value, so nothing is clipped
// ("highlight 1"). Any other white balance `t` is then exactly a per-channel gain
// followed by LibRaw's own clip at the sensor white ("highlight 0"):
//   v_c = min(1, x_c · (a_max / a_c) · (t_c / t_min))
// and camera RGB goes to linear sRGB with LibRaw's `rgb_cam` (built from the camera's
// Adobe-derived D65 colour matrix). Checked against LibRaw's own decodes with as-shot,
// daylight and custom multipliers on genuine A7 III files (≤ 4 / 65535).

import { daylightChromaticity, invert3 } from '../pipeline/colorMath.mjs';

export const RAW_KELVIN = Object.freeze({ min: 2000, max: 12000, step: 50 });
export const RAW_TINT = Object.freeze({ min: -150, max: 150, step: 1 });
/** Tint units to CIE 1960 Duv. Positive tint assumes a greener light, so the photo turns magenta. */
export const DUV_PER_RAW_TINT = 0.0002;
/** "Daylight" white balance: the CIE daylight illuminant at 5500 K (D55). */
export const DAYLIGHT_KELVIN = 5500;
export const WHITE_BALANCE_MODES = Object.freeze(['as-shot', 'daylight', 'custom']);

const xyToUv = ([x, y]) => {
  const d = -2 * x + 12 * y + 3;
  return [(4 * x) / d, (6 * y) / d];
};
const uvToXy = ([u, v]) => {
  const d = 2 * u - 8 * v + 4;
  return [(3 * u) / d, (2 * v) / d];
};

/** Chromaticity of a black body (Kim et al. 2002 cubic fit, 1667–25000 K). */
export function planckianXy(kelvin) {
  const t = Math.min(25000, Math.max(1667, kelvin));
  const x = t <= 4000
    ? -0.2661239e9 / t ** 3 - 0.2343589e6 / t ** 2 + 0.8776956e3 / t + 0.179910
    : -3.0258469e9 / t ** 3 + 2.1070379e6 / t ** 2 + 0.2226347e3 / t + 0.240390;
  let y;
  if (t <= 2222) y = -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683;
  else if (t <= 4000) y = -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867;
  else y = 3.0817580 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  return [x, y];
}

// Unit normal to the Planckian locus in uv, oriented toward green (+v).
function locusFrame(kelvin) {
  const uv = xyToUv(planckianXy(kelvin));
  const next = xyToUv(planckianXy(1e6 / (1e6 / kelvin - 1)));
  const length = Math.hypot(next[0] - uv[0], next[1] - uv[1]);
  let normal = [-(next[1] - uv[1]) / length, (next[0] - uv[0]) / length];
  if (normal[1] < 0) normal = [-normal[0], -normal[1]];
  return { uv, normal };
}

/** Illuminant chromaticity for a colour temperature and tint (Duv off the Planckian locus). */
export function kelvinTintToXy(kelvin, tint) {
  const { uv, normal } = locusFrame(kelvin);
  const duv = DUV_PER_RAW_TINT * tint;
  return uvToXy([uv[0] + normal[0] * duv, uv[1] + normal[1] * duv]);
}

/** Nearest temperature and tint for an illuminant chromaticity, rounded to the slider steps. */
export function xyToKelvinTint(xy) {
  const uv = xyToUv(xy);
  const distance = (mired) => {
    const p = xyToUv(planckianXy(1e6 / mired));
    return Math.hypot(uv[0] - p[0], uv[1] - p[1]);
  };
  // Golden-section search over mireds (40–600 covers 1667–25000 K).
  let lo = 40;
  let hi = 600;
  const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 80; i += 1) {
    const a = hi - g * (hi - lo);
    const b = lo + g * (hi - lo);
    if (distance(a) < distance(b)) hi = b; else lo = a;
  }
  const kelvin = 1e6 / ((lo + hi) / 2);
  const { uv: p, normal } = locusFrame(kelvin);
  const duv = (uv[0] - p[0]) * normal[0] + (uv[1] - p[1]) * normal[1];
  return { kelvin, tint: duv / DUV_PER_RAW_TINT };
}

const xyToXyz = ([x, y]) => [x / y, 1, (1 - x - y) / y];
const apply3 = (m, v) => [0, 1, 2].map((r) => m[r * 3] * v[0] + m[r * 3 + 1] * v[1] + m[r * 3 + 2] * v[2]);

/** White balance multipliers (green = 1) that make an illuminant neutral for this camera. */
export function multipliersForXy(xy, camXyz) {
  const neutral = apply3(camXyz, xyToXyz(xy));
  return neutral.map((value) => neutral[1] / value);
}

/** The illuminant that a set of multipliers neutralises, as chromaticity. */
export function xyForMultipliers(multipliers, camXyz) {
  const xyz = apply3(invert3(camXyz), multipliers.map((value) => 1 / value));
  const sum = xyz[0] + xyz[1] + xyz[2];
  return [xyz[0] / sum, xyz[1] / sum];
}

const roundTo = (value, step) => Math.round(value / step) * step;
const clamp = (value, { min, max }) => Math.min(max, Math.max(min, value));

/** As-shot (or any) multipliers as slider values: temperature in kelvin and tint. */
export function multipliersToKelvinTint(multipliers, camXyz) {
  const { kelvin, tint } = xyToKelvinTint(xyForMultipliers(multipliers, camXyz));
  return { temperature: clamp(roundTo(kelvin, RAW_KELVIN.step), RAW_KELVIN), tint: clamp(Math.round(tint), RAW_TINT) + 0 };
}

/**
 * Target multipliers for a photo's RAW white balance setting.
 * :param raw: decoder colour info { asShot: [r, g, b], camXyz: 9 numbers }
 * :param settings: { whiteBalance: 'as-shot' | 'daylight' | 'custom', temperature, tint }
 */
export function targetMultipliers(raw, settings) {
  if (settings.whiteBalance === 'daylight') return multipliersForXy(daylightChromaticity(DAYLIGHT_KELVIN), raw.camXyz);
  if (settings.whiteBalance === 'custom') return multipliersForXy(kelvinTintToXy(settings.temperature, settings.tint), raw.camXyz);
  return raw.asShot;
}

/** Per-channel gains from the decoded (as-shot, max-normalised) data to the target white balance. */
export function channelGains(asShot, target) {
  const aMax = Math.max(...asShot);
  const tMin = Math.min(...target);
  return asShot.map((a, c) => (aMax / a) * (target[c] / tMin));
}

/**
 * Renderer parameters for a RAW photo.
 * :returns: { gain: [3], matrix: 9 row-major camera RGB -> linear sRGB, multipliers,
 *   white } where `white` is the clip level after the gain: 1 (the sensor white), or
 *   for a merged HDR the darkest exposure's sensor white in reference units (`hdrWhite`)
 */
export function rawDevelopParams(raw, settings) {
  const multipliers = targetMultipliers(raw, settings);
  return { gain: channelGains(raw.asShot, multipliers), matrix: raw.rgbCam, multipliers, white: raw.hdrWhite > 1 ? raw.hdrWhite : 1 };
}

/** Camera-to-linear-sRGB matrix check: real colour data, invertible, rows near 1 (white stays white). */
export function validColorMatrix(rgbCam) {
  if (!Array.isArray(rgbCam) || rgbCam.length !== 9 || !rgbCam.every(Number.isFinite)) return false;
  try { invert3(rgbCam); } catch { return false; }
  return [0, 3, 6].every((row) => Math.abs(rgbCam[row] + rgbCam[row + 1] + rgbCam[row + 2] - 1) < 0.02);
}

