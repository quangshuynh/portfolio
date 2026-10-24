// Creative stage: film-inspired effects and colour grading, after the display stages
// (curves, HSL, LUT) on the sRGB-encoded, display-referred values. Order:
//   glow (bloom, halation) -> bleach bypass -> film fade -> colour grading -> vignette -> grain.
// Glow, vignette and grain depend on the pixel's position in the output frame (after
// geometry), so renderers that only see a pixel (cpuRenderer.renderRgba8) hand photos with
// `positional` effects to the detail renderer, which knows x, y and the render scale. The
// GLSL in shader.mjs mirrors these functions; the parameters are derived here once for both.
//
// Every effect is an approximation chosen to be smooth and bounded, not a reproduction of
// a chemical process or of another application:
// - Bleach bypass: a black-and-white "silver" copy (contrast S-curve on luma) laid over the
//   colour in soft-light mode (on greys that is the S-curve 3p² − 2p³: denser shadows, brighter
//   highlights), mixed by amount with highlight protection, then desaturated toward luma by
//   amount × desaturation (protection limits the tonal change only, so 100/100 is monochrome).
// - Film fade: lifted (optionally tinted) blacks and a rational highlight shoulder.
// - Colour grading: zero-luma tint offsets and small luminance offsets for shadows, midtones,
//   highlights (weights (1 − L)^q, L^q and the rest, so they sum to 1 with no edges) and global;
//   tints fade out toward pure black so blacks stay neutral.
// - Bloom and halation: a bright pass of the image (soft threshold) blurred on the guide grid
//   (pipeline/detail.mjs, at most 768 px) and sampled bilinearly, screen-added in linear light;
//   bloom takes the image's colour and a wide radius, halation a red-orange tint and a tight one.
// - Grain: unit-variance cubic B-spline value noise on a lattice in the photo's native output
//   pixels from an integer hash of the lattice point and the photo's seed (deterministic,
//   no tiles to repeat), two octaves mixed by roughness, weaker in deep shadows and highlights,
//   and scaled down at smaller renders as a downscale would average it.

import { LUMA } from './colorMath.mjs';
import { boxRadiusForSigma, createFilters } from './detail.mjs';

const [LR, LG, LB] = LUMA;

export const CREATIVE = Object.freeze({
  /** Bleach bypass: share of the S-curve on the silver layer at contrast 100; luma where highlight protection starts. */
  bleachCurve: 0.9,
  bleachProtectFrom: 0.6,
  /** Skin hues (HSV degrees) and the largest share of desaturation they are spared at moderate strengths. */
  skinHue: 25,
  skinWidth: 25,
  skinProtect: 0.6,
  /** Film fade: black level (encoded) at 100, shoulder strength at 100, tint strength of lifted blacks / lowered whites. */
  fadeBlack: 0.22,
  fadeShoulder: 1.5,
  fadeTint: 1.5,
  /** Colour grading: tint offset at saturation 100, luminance offset at ±100 (encoded), range exponent from tight to wide blending, balance. */
  gradeTint: 0.3,
  gradeLuminance: 0.07,
  gradeExponent: Object.freeze([3.5, 1.2]),
  gradeBalance: 0.8,
  /** Encoded luma below which grading tints fade out linearly. */
  gradeBlack: 0.1,
  /** Vignette: darkening and lightening at ±100; start of the falloff and its width (ellipse units) from 0 to 100. */
  vignetteDarken: 0.8,
  vignetteLighten: 0.75,
  vignetteStart: Object.freeze([0.2, 1.3]),
  vignetteWidth: Object.freeze([0.1, 1.4]),
  vignetteSquare: 6,
  /** Grain: amplitude (encoded) at 100, lattice spacing in native px from size 0 to 100, tonal floor. */
  grainAmplitude: 0.09,
  grainSpacing: Object.freeze([1, 4]),
  grainFloor: 0.3,
  /** Glow radii (Gaussian sigma, fraction of the long edge), thresholds (encoded luma), soft knee and gain. */
  bloomSigma: Object.freeze([0.01, 0.08]),
  bloomThreshold: Object.freeze([0.45, 0.95]),
  bloomKnee: 0.15,
  bloomGain: 0.8,
  halationSigma: Object.freeze([0.002, 0.02]),
  halationThreshold: Object.freeze([0.6, 0.98]),
  halationKnee: 0.08,
  halationGain: 2,
});

const lerp = ([a, b], t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const luma = (p) => LR * p[0] + LG * p[1] + LB * p[2];

/** Fully saturated colour of a hue (degrees) as encoded RGB, as spec.hsvToRgb with s = v = 1. */
export function hueColor(hue) {
  return [0, 1, 2].map((c) => {
    const k = (5 - 2 * c + hue / 60) % 6;
    return 1 - Math.max(0, Math.min(k, 4 - k, 1));
  });
}

/** Zero-luma direction of a hue: adding it changes colour, not encoded luma. */
export function chromaDirection(hue) {
  const color = hueColor(hue);
  const y = luma(color);
  return color.map((v) => v - y);
}

/** Slider values (normalised settings) -> creative parameters for both renderers. */
export function creativeParams(a) {
  const c = { bleach: null, fade: null, grading: null, vignette: null, grain: null, bloom: null, halation: null };
  if (a.bleachAmount) {
    c.bleach = { amount: a.bleachAmount / 100, contrast: (a.bleachContrast / 100) * CREATIVE.bleachCurve, desaturation: a.bleachDesaturation / 100, protect: a.bleachProtect / 100 };
  }
  if (a.fade || a.fadeHighlights) {
    const black = (a.fade / 100) * CREATIVE.fadeBlack;
    const shoulder = (a.fadeHighlights / 100) * CREATIVE.fadeShoulder;
    const lowered = 1 - 1 / (1 + shoulder) ** 0.25;
    const blackTint = chromaDirection(a.fadeShadowHue).map((d) => d * (a.fadeShadowTint / 100) * CREATIVE.fadeTint);
    const whiteTint = chromaDirection(a.fadeHighlightHue).map((d) => d * (a.fadeHighlightTint / 100) * CREATIVE.fadeTint);
    c.fade = {
      black: blackTint.map((d) => Math.max(0, black * (1 + d))),
      shoulder,
      white: whiteTint.map((d) => lowered * d),
    };
  }
  const ranges = ['Shadows', 'Midtones', 'Highlights', 'Global'];
  if (ranges.some((range) => a[`grade${range}Sat`] || a[`grade${range}Lum`])) {
    c.grading = {
      tints: ranges.map((range) => chromaDirection(a[`grade${range}Hue`]).map((d) => d * (a[`grade${range}Sat`] / 100) * CREATIVE.gradeTint)),
      luminance: ranges.map((range) => (a[`grade${range}Lum`] / 100) * CREATIVE.gradeLuminance),
      balance: (a.gradeBalance / 100) * CREATIVE.gradeBalance,
      exponent: lerp(CREATIVE.gradeExponent, a.gradeBlending / 100),
    };
  }
  if (a.vignetteAmount) {
    const roundness = a.vignetteRoundness / 100;
    c.vignette = {
      amount: a.vignetteAmount / 100,
      start: lerp(CREATIVE.vignetteStart, a.vignetteMidpoint / 100),
      width: lerp(CREATIVE.vignetteWidth, a.vignetteFeather / 100),
      round: Math.max(0, roundness),
      exponent: 2 + Math.max(0, -roundness) * CREATIVE.vignetteSquare,
    };
  }
  if (a.grainAmount) {
    c.grain = { amount: (a.grainAmount / 100) * CREATIVE.grainAmplitude, spacing: lerp(CREATIVE.grainSpacing, a.grainSize / 100), roughness: a.grainRoughness / 100, seed: a.grainSeed >>> 0 };
  }
  if (a.bloomAmount) {
    c.bloom = { amount: (a.bloomAmount / 100) * CREATIVE.bloomGain, sigma: lerp(CREATIVE.bloomSigma, a.bloomRadius / 100), threshold: lerp(CREATIVE.bloomThreshold, a.bloomThreshold / 100), knee: CREATIVE.bloomKnee };
  }
  if (a.halationAmount) {
    // Red at hue 0 to orange at 60, in linear light.
    const tint = hueColor(a.halationHue).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    c.halation = { amount: (a.halationAmount / 100) * CREATIVE.halationGain, sigma: lerp(CREATIVE.halationSigma, a.halationRadius / 100), threshold: lerp(CREATIVE.halationThreshold, a.halationThreshold / 100), knee: CREATIVE.halationKnee, tint };
  }
  c.glowActive = Boolean(c.bloom || c.halation);
  c.positional = Boolean(c.glowActive || c.vignette || c.grain);
  c.active = Boolean(c.positional || c.bleach || c.fade || c.grading);
  return c;
}

/** What the glow map depends on besides the image: radii and thresholds, not amounts. */
export const glowKey = (c) => JSON.stringify([c.bloom && [c.bloom.sigma, c.bloom.threshold], c.halation && [c.halation.sigma, c.halation.threshold]]);

// --- Grain: integer hash, B-spline value noise ---

/** 32-bit hash of a lattice point and seed (murmur3-style finaliser); the shader computes the same bits. */
export function grainHash(i, j, seed) {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

const SQRT6 = Math.sqrt(6);
/** Unit-variance triangular value of a lattice point. */
const latticeValue = (i, j, seed) => {
  const h = grainHash(i, j, seed);
  return ((h & 0xffff) / 65536 + (h >>> 16) / 65536 - 1) * SQRT6;
};

const bspline = (t, out) => {
  const t2 = t * t;
  const t3 = t2 * t;
  const u = 1 - t;
  out[0] = (u * u * u) / 6;
  out[1] = (3 * t3 - 6 * t2 + 4) / 6;
  out[2] = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6;
  out[3] = t3 / 6;
  return out;
};
const wx = [0, 0, 0, 0];
const wy = [0, 0, 0, 0];

/** Cubic B-spline value noise at lattice position (x, y), normalised to unit variance everywhere. */
export function valueNoise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  bspline(x - ix, wx);
  bspline(y - iy, wy);
  let sum = 0;
  for (let j = 0; j < 4; j += 1) {
    let row = 0;
    for (let i = 0; i < 4; i += 1) row += wx[i] * latticeValue(ix - 1 + i, iy - 1 + j, seed);
    sum += wy[j] * row;
  }
  const norm = (wx[0] * wx[0] + wx[1] * wx[1] + wx[2] * wx[2] + wx[3] * wx[3]) * (wy[0] * wy[0] + wy[1] * wy[1] + wy[2] * wy[2] + wy[3] * wy[3]);
  return sum / Math.sqrt(norm);
}

/** Seed of the finer octave. */
export const FINE_SEED = (seed) => (seed ^ 0x5bd1e995) >>> 0;

/**
 * Grain of an output pixel (unit variance, before amplitude and tone weighting).
 * :param x, y: pixel indices in the render; scale: render / native long edge (≤ 1)
 */
export function grainValue(x, y, scale, grain) {
  const gx = (x + 0.5) / scale / grain.spacing;
  const gy = (y + 0.5) / scale / grain.spacing;
  const coarse = valueNoise(gx, gy, grain.seed);
  if (!grain.roughness) return coarse;
  const fine = valueNoise(gx * 2 + 17.31, gy * 2 + 5.77, FINE_SEED(grain.seed));
  const r = grain.roughness;
  return ((1 - r) * coarse + r * fine) / Math.sqrt((1 - r) * (1 - r) + r * r);
}

/**
 * Amplitude factor of grain rendered at `scale`: a downscale averages grain of lattice
 * `spacing` (native px) over 1/scale px, which leaves this share of its standard deviation.
 */
export const grainScale = (spacing, scale) => Math.sqrt((spacing * spacing + 1) / (spacing * spacing + 1 / (scale * scale)));

// --- Glow map ---

/**
 * Bloom and halation sources of a small image (the guide grid), blurred.
 * :param planes: { r, g, b, alpha } encoded Float32 planes after the display stages
 * :param transfer: { toLinear }
 * :returns: { width, height, bloom: Float32Array RGB | null, halation: Float32Array | null }
 */
export function computeGlow(planes, w, h, c, transfer) {
  const n = w * h;
  const edge = Math.max(w, h);
  const pool = (() => {
    const map = new Map();
    return (name, size, Type = Float32Array) => {
      let plane = map.get(name);
      if (!plane || plane.length < size) { plane = new Type(size); map.set(name, plane); }
      return plane;
    };
  })();
  const { gauss } = createFilters(w, h, pool);
  const out = { width: w, height: h, bloom: null, halation: null };
  const blur = (plane, sigma) => {
    const blurred = new Float32Array(n);
    gauss(plane, blurred, boxRadiusForSigma(sigma * edge));
    return blurred;
  };
  const weightOf = (i, threshold, knee) => {
    const p = LR * planes.r[i] + LG * planes.g[i] + LB * planes.b[i];
    return smoothstep(threshold - knee, threshold + knee, p) * (planes.alpha ? planes.alpha[i] : 1);
  };
  if (c.bloom) {
    const channels = [planes.r, planes.g, planes.b].map(() => new Float32Array(n));
    for (let i = 0; i < n; i += 1) {
      const weight = weightOf(i, c.bloom.threshold, c.bloom.knee);
      if (!weight) continue;
      channels[0][i] = transfer.toLinear(planes.r[i]) * weight;
      channels[1][i] = transfer.toLinear(planes.g[i]) * weight;
      channels[2][i] = transfer.toLinear(planes.b[i]) * weight;
    }
    const blurred = channels.map((plane) => blur(plane, c.bloom.sigma));
    out.bloom = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      out.bloom[i * 3] = blurred[0][i]; out.bloom[i * 3 + 1] = blurred[1][i]; out.bloom[i * 3 + 2] = blurred[2][i];
    }
  }
  if (c.halation) {
    const source = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      const weight = weightOf(i, c.halation.threshold, c.halation.knee);
      if (weight) source[i] = (LR * transfer.toLinear(planes.r[i]) + LG * transfer.toLinear(planes.g[i]) + LB * transfer.toLinear(planes.b[i])) * weight;
    }
    out.halation = blur(source, c.halation.sigma);
  }
  return out;
}

/** The glow map packed as RGBA (bloom RGB, halation in A) for a float texture. */
export function packGlow(glow) {
  const n = glow.width * glow.height;
  const data = new Float32Array(n * 4);
  for (let i = 0; i < n; i += 1) {
    if (glow.bloom) { data[i * 4] = glow.bloom[i * 3]; data[i * 4 + 1] = glow.bloom[i * 3 + 1]; data[i * 4 + 2] = glow.bloom[i * 3 + 2]; }
    if (glow.halation) data[i * 4 + 3] = glow.halation[i];
  }
  return { width: glow.width, height: glow.height, data };
}

/** Bilinear position of output pixel `x` (of `size`) on a glow axis of `count` samples. */
const glowAxis = (x, size, count) => Math.min(count - 1, Math.max(0, ((x + 0.5) * count) / size - 0.5));

const glowSample = [0, 0, 0, 0];
/** Samples the glow map (bloom RGB, halation) at an output pixel. */
function sampleGlow(glow, x, y, width, height) {
  const gx = glowAxis(x, width, glow.width);
  const gy = glowAxis(y, height, glow.height);
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(glow.width - 1, x0 + 1);
  const y1 = Math.min(glow.height - 1, y0 + 1);
  const tx = gx - x0;
  const ty = gy - y0;
  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;
  const i00 = y0 * glow.width + x0;
  const i10 = y0 * glow.width + x1;
  const i01 = y1 * glow.width + x0;
  const i11 = y1 * glow.width + x1;
  if (glow.bloom) {
    const b = glow.bloom;
    for (let c = 0; c < 3; c += 1) glowSample[c] = b[i00 * 3 + c] * w00 + b[i10 * 3 + c] * w10 + b[i01 * 3 + c] * w01 + b[i11 * 3 + c] * w11;
  }
  if (glow.halation) {
    const hv = glow.halation;
    glowSample[3] = hv[i00] * w00 + hv[i10] * w10 + hv[i01] * w01 + hv[i11] * w11;
  }
  return glowSample;
}

// --- Per-pixel stages ---

const screen = (a, b) => a + b - a * b;
const hsv = [0, 0];

/** HSV hue (degrees) and saturation of encoded RGB. */
function hueSaturation(p) {
  const max = Math.max(p[0], p[1], p[2]);
  const chroma = max - Math.min(p[0], p[1], p[2]);
  if (chroma <= 0) { hsv[0] = 0; hsv[1] = 0; return hsv; }
  let hue = max === p[0] ? (p[1] - p[2]) / chroma : max === p[1] ? (p[2] - p[0]) / chroma + 2 : (p[0] - p[1]) / chroma + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  hsv[0] = hue;
  hsv[1] = chroma / max;
  return hsv;
}

/** How much a colour looks like skin (0–1): hues around orange at moderate saturation. */
export function skinWeight(p) {
  const [hue, s] = hueSaturation(p);
  const distance = Math.abs(hue - CREATIVE.skinHue);
  const d = Math.min(distance, 360 - distance);
  if (d >= CREATIVE.skinWidth) return 0;
  return (0.5 + 0.5 * Math.cos((Math.PI * d) / CREATIVE.skinWidth)) * smoothstep(0.08, 0.2, s) * (1 - smoothstep(0.55, 0.75, s));
}

const silver = [0, 0, 0];

function bleachBypass(p, b) {
  const l = Math.min(1, Math.max(0, luma(p)));
  const curve = l < 0.5 ? 2 * l * l : 1 - 2 * (1 - l) * (1 - l);
  const s = l + b.contrast * (curve - l);
  const desaturation = b.amount * b.desaturation * (1 - CREATIVE.skinProtect * skinWeight(p) * (1 - b.desaturation * b.desaturation));
  const k = b.amount * (1 - b.protect * smoothstep(CREATIVE.bleachProtectFrom, 1, l));
  for (let c = 0; c < 3; c += 1) silver[c] = p[c] + ((1 - 2 * s) * p[c] * p[c] + 2 * s * p[c] - p[c]) * k;
  const y = luma(silver);
  for (let c = 0; c < 3; c += 1) p[c] = Math.min(1, Math.max(0, y + (silver[c] - y) * (1 - desaturation)));
}

function filmFade(p, f) {
  for (let c = 0; c < 3; c += 1) {
    const v = Math.min(1, Math.max(0, p[c]));
    const g = f.shoulder ? v / (1 + f.shoulder * v * v * v * v) ** 0.25 : v;
    p[c] = Math.min(1, Math.max(0, f.black[c] + (1 - f.black[c]) * g + f.white[c] * g * g));
  }
}

/** Pulls encoded RGB into 0–1 toward its luma `y` (keeps the colour's direction); luma 1 is white, 0 black. */
function fitEncoded(p, y) {
  if (y >= 1 || y <= 0) { p[0] = y; p[1] = y; p[2] = y; return; }
  const max = Math.max(p[0], p[1], p[2]);
  const min = Math.min(p[0], p[1], p[2]);
  let t = 1;
  if (max > 1) t = Math.min(t, (1 - y) / (max - y));
  if (min < 0) t = Math.min(t, y / (y - min));
  for (let c = 0; c < 3; c += 1) p[c] = Math.min(1, Math.max(0, y + (p[c] - y) * t));
}

/** Weights of shadows, midtones and highlights for encoded luma `l`. */
export function gradeWeights(l, balance, exponent, out = [0, 0, 0]) {
  const x = Math.min(1, Math.max(0, l));
  const shifted = x + balance * x * (1 - x);
  out[0] = (1 - shifted) ** exponent;
  out[2] = shifted ** exponent;
  out[1] = 1 - out[0] - out[2];
  return out;
}

const weights = [0, 0, 0];

function colorGrade(p, g) {
  const l = luma(p);
  gradeWeights(l, g.balance, g.exponent, weights);
  const [ts, tm, th, tg] = g.tints;
  const offset = weights[0] * g.luminance[0] + weights[1] * g.luminance[1] + weights[2] * g.luminance[2] + g.luminance[3];
  const tint = Math.min(1, Math.max(0, l) / CREATIVE.gradeBlack);
  for (let c = 0; c < 3; c += 1) p[c] += (weights[0] * ts[c] + weights[1] * tm[c] + weights[2] * th[c] + tg[c]) * tint + offset;
  fitEncoded(p, Math.min(1, Math.max(0, luma(p))));
}

/** Vignette falloff (0 centre, 1 fully affected) of an output pixel. */
export function vignetteFalloff(x, y, width, height, v) {
  let u = ((x + 0.5) / width) * 2 - 1;
  let w = ((y + 0.5) / height) * 2 - 1;
  if (v.round) {
    const long = Math.max(width, height);
    u *= 1 + v.round * (width / long - 1);
    w *= 1 + v.round * (height / long - 1);
  }
  const d = v.exponent === 2 ? Math.sqrt(u * u + w * w) : (Math.abs(u) ** v.exponent + Math.abs(w) ** v.exponent) ** (1 / v.exponent);
  return smoothstep(v.start - v.width / 2, v.start + v.width / 2, d);
}

/**
 * The creative stage on one pixel of encoded values. Mutates and returns `p`.
 * :param at: { x, y, width, height, scale, glow } for the positional effects (glow,
 *   vignette, grain), or null when there are none
 * :param transfer: { toLinear, toSrgb }
 */
export function applyCreative(p, c, at, transfer) {
  if (c.glowActive && at?.glow) {
    const sample = sampleGlow(at.glow, at.x, at.y, at.width, at.height);
    for (let k = 0; k < 3; k += 1) {
      let lin = transfer.toLinear(Math.min(1, Math.max(0, p[k])));
      if (c.bloom) lin = screen(lin, Math.min(1, c.bloom.amount * sample[k]));
      if (c.halation) lin = screen(lin, Math.min(1, c.halation.amount * sample[3] * c.halation.tint[k]));
      p[k] = transfer.toSrgb(lin);
    }
  }
  if (c.bleach) bleachBypass(p, c.bleach);
  if (c.fade) filmFade(p, c.fade);
  if (c.grading) colorGrade(p, c.grading);
  if (c.vignette && at) {
    const fall = vignetteFalloff(at.x, at.y, at.width, at.height, c.vignette);
    if (fall > 0) {
      if (c.vignette.amount < 0) {
        const gain = 1 + c.vignette.amount * CREATIVE.vignetteDarken * fall;
        for (let k = 0; k < 3; k += 1) p[k] = transfer.toSrgb(transfer.toLinear(Math.min(1, Math.max(0, p[k]))) * gain);
      } else {
        const lift = c.vignette.amount * CREATIVE.vignetteLighten * fall;
        for (let k = 0; k < 3; k += 1) p[k] += (1 - p[k]) * lift;
      }
    }
  }
  if (c.grain && at) {
    const l = Math.min(1, Math.max(0, luma(p)));
    const tone = CREATIVE.grainFloor + (1 - CREATIVE.grainFloor) * 4 * l * (1 - l);
    const delta = c.grain.amount * grainScale(c.grain.spacing, at.scale) * tone * grainValue(at.x, at.y, at.scale, c.grain);
    for (let k = 0; k < 3; k += 1) p[k] = Math.min(1, Math.max(0, p[k] + delta));
  }
  return p;
}
