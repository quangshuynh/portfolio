// Colour science shared by the CPU reference renderer, the WebGL2 preview and the
// tests. Plain ESM with no browser APIs, so Node tests and workers import it as is.

/** Rec.709 / sRGB luminance weights (linear light). */
export const LUMA = Object.freeze([0.2126, 0.7152, 0.0722]);

/** sRGB electro-optical transfer: encoded [0, 1] -> linear light. */
export function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** sRGB opto-electronic transfer: linear light -> encoded. Extended above 1 with the same power. */
export function linearToSrgb(value) {
  if (value <= 0) return 0;
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}

/** Linear value of every 8-bit sRGB code, so decoding never repeats the power function. */
export const SRGB_TO_LINEAR_8BIT = Float64Array.from({ length: 256 }, (_, code) => srgbToLinear(code / 255));

// sRGB (D65) primaries to CIE XYZ, IEC 61966-2-1.
export const SRGB_TO_XYZ = Object.freeze([
  0.4124564, 0.3575761, 0.1804375,
  0.2126729, 0.7151522, 0.0721750,
  0.0193339, 0.1191920, 0.9503041,
]);

// Bradford cone response matrix.
const BRADFORD = [
  0.8951, 0.2664, -0.1614,
  -0.7502, 1.7135, 0.0367,
  0.0389, -0.0685, 1.0296,
];

/** Row-major 3x3 product a·b. */
export function multiply3(a, b) {
  const out = new Array(9);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      out[row * 3 + col] = a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col];
    }
  }
  return out;
}

/** Row-major 3x3 inverse. */
export function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error('Matrix is not invertible.');
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

const applyMatrix = (m, [x, y, z]) => [
  m[0] * x + m[1] * y + m[2] * z,
  m[3] * x + m[4] * y + m[5] * z,
  m[6] * x + m[7] * y + m[8] * z,
];

export const XYZ_TO_SRGB = Object.freeze(invert3(SRGB_TO_XYZ));
const BRADFORD_INVERSE = invert3(BRADFORD);

/**
 * Chromaticity of the CIE daylight locus at a correlated colour temperature.
 * Valid from 4000 K to 25000 K (CIE 15:2004).
 */
export function daylightChromaticity(kelvin) {
  const t = Math.min(25000, Math.max(4000, kelvin));
  const x = t <= 7000
    ? -4.6070e9 / t ** 3 + 2.9678e6 / t ** 2 + 0.09911e3 / t + 0.244063
    : -2.0064e9 / t ** 3 + 1.9018e6 / t ** 2 + 0.24748e3 / t + 0.237040;
  const y = -3.000 * x * x + 2.870 * x - 0.275;
  return [x, y];
}

const xyToUv = ([x, y]) => {
  const d = -2 * x + 12 * y + 3;
  return [(4 * x) / d, (6 * y) / d];
};
const uvToXy = ([u, v]) => {
  const d = 2 * u - 8 * v + 4;
  return [(3 * u) / d, (2 * v) / d];
};

// Slider scales. Temperature moves the assumed scene illuminant in mireds, which is
// close to perceptually even; tint moves it off the locus in CIE 1960 uv (Duv).
export const NEUTRAL_KELVIN = 6504;
export const MIRED_PER_TEMPERATURE_UNIT = 0.75;
export const DUV_PER_TINT_UNIT = 0.0002;

/**
 * Chromaticity of the illuminant the photograph is assumed to have been lit by.
 * Positive temperature assumes a bluer illuminant, so correcting it warms the image;
 * positive tint assumes a greener one, so correcting it adds magenta.
 */
export function sourceWhite(temperature, tint) {
  const mired = 1e6 / NEUTRAL_KELVIN - MIRED_PER_TEMPERATURE_UNIT * temperature;
  const kelvin = 1e6 / mired;
  const [u, v] = xyToUv(daylightChromaticity(kelvin));
  // Unit normal to the locus, from a numerical derivative along it.
  const [u2, v2] = xyToUv(daylightChromaticity(1e6 / (mired - 1)));
  const length = Math.hypot(u2 - u, v2 - v);
  const normal = [-(v2 - v) / length, (u2 - u) / length];
  // Orient the normal toward green (+v), the conventional positive Duv side.
  const sign = normal[1] >= 0 ? 1 : -1;
  const duv = DUV_PER_TINT_UNIT * tint;
  return uvToXy([u + sign * normal[0] * duv, v + sign * normal[1] * duv]);
}

const xyToXyz = ([x, y]) => [x / y, 1, (1 - x - y) / y];

/** Bradford chromatic adaptation between two white points, as an XYZ matrix. */
export function bradfordAdaptation(fromXy, toXy) {
  const [rs, gs, bs] = applyMatrix(BRADFORD, xyToXyz(fromXy));
  const [rd, gd, bd] = applyMatrix(BRADFORD, xyToXyz(toXy));
  const scale = [rd / rs, 0, 0, 0, gd / gs, 0, 0, 0, bd / bs];
  return multiply3(BRADFORD_INVERSE, multiply3(scale, BRADFORD));
}

export const IDENTITY3 = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]);

/**
 * Linear-sRGB white balance matrix: adapts the assumed source illuminant to the
 * illuminant the neutral slider position stands for. Exactly the identity at 0/0.
 */
export function whiteBalanceMatrix(temperature, tint) {
  if (!temperature && !tint) return [...IDENTITY3];
  const adaptation = bradfordAdaptation(sourceWhite(temperature, tint), sourceWhite(0, 0));
  return multiply3(XYZ_TO_SRGB, multiply3(adaptation, SRGB_TO_XYZ));
}
