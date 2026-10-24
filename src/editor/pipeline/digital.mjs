// Digital-camera and degraded-digital effects of the creative stage (creative.mjs): early
// camera colour and tone response, highlight clipping, colour quantisation, sensor noise, a
// low-resolution capture with JPEG compression and its reconstruction, chromatic aberration
// and colour-channel displacement. Every one is an independent, approximate model chosen to
// be bounded and deterministic; none reproduces a specific camera, sensor or codec setting.
//
// Resolution semantics (preview and export must agree):
// - Capture (low resolution, JPEG, dithered quantisation) happens on a capture grid whose long
//   edge is CAPTURE.edge px or less, a fraction of the guide grid (detail.mjs, at most 768 px)
//   that every renderer already has. The grid is the same size relative to the frame at any
//   render size, so pixel blocks and 8 × 8 JPEG blocks cover the same part of the photo in a
//   preview and in a full-resolution export; the output is reconstructed from it by resampling.
// - Sensor noise is white noise per pixel of a virtual sensor whose long edge is
//   DIGITAL.noiseSensorEdge px (or the photo's, if smaller), or per capture pixel inside a capture.
//   A smaller render shows the noise of one sensor pixel per render pixel at the standard
//   deviation a downscale would leave (scale × cell, at most 1).
// - Chromatic aberration and channel displacement are fractions of the frame (radial scale,
//   long-edge offset), so they also scale with the render.

import { LUMA } from './colorMath.mjs';
import { grainHash } from './creative.mjs';

const [LR, LG, LB] = LUMA;

export const DIGITAL = Object.freeze({
  /** Sensor colour matrices (encoded RGB, rows sum to 1 so greys stay grey) at −100 (cool) and +100 (warm). */
  sensorCool: Object.freeze([1.12, -0.04, -0.08, -0.06, 1.1, -0.04, -0.02, -0.1, 1.12]),
  sensorWarm: Object.freeze([1.1, -0.02, -0.08, 0.02, 1.02, -0.04, 0.06, 0.1, 0.84]),
  /** Response: S-curve exponent added at 100, saturation added at 100. */
  responseCurve: 0.6,
  responseSaturation: 0.5,
  /** Clipping: share of the encoded range pushed past white at 100. */
  clipRange: 0.35,
  /** Quantisation: levels per channel from 256 (0) to 2 (100), geometric. */
  quantizeLevels: Object.freeze([256, 2]),
  /** Noise: standard deviation (encoded) at 100, shadow share, per-channel chroma gains (blue noisiest). */
  noiseAmplitude: 0.12,
  noiseFloor: 0.35,
  noiseChannelGain: Object.freeze([1, 0.8, 1.35]),
  /** Long edge (px) of the virtual sensor the noise is drawn on: about 2 MP at 4:3. */
  noiseSensorEdge: 1600,
  /** Capture grid: long edge in px at resolution 0 (or JPEG alone) and at 100, geometric. */
  captureEdge: Object.freeze([768, 48]),
  /** JPEG quality (IJG scale) at amount → 0 and at 100; shaped by `jpegCurve`. */
  jpegQuality: Object.freeze([92, 2]),
  jpegCurve: 0.6,
  /** Chromatic aberration: radial scale of red (+) and blue (−) at 100. */
  aberration: 0.006,
  /** Channel displacement: red and blue offsets (fraction of the long edge) at 100. */
  displacement: 0.008,
  /** Diffusion: blur radius (Gaussian sigma, fraction of the long edge) from radius 0 to 100, and mix at 100. */
  diffusionSigma: Object.freeze([0.004, 0.03]),
  diffusionMix: 0.9,
});

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const luma = (p) => LR * p[0] + LG * p[1] + LB * p[2];

/** Slider values -> digital parameters (part of creative.creativeParams). */
export function digitalParams(a) {
  const d = { sensor: null, response: null, clip: null, quantize: null, noise: null, capture: null, shift: null, diffusion: null };
  if (a.sensorColor) {
    const t = Math.abs(a.sensorColor) / 100;
    const target = a.sensorColor > 0 ? DIGITAL.sensorWarm : DIGITAL.sensorCool;
    d.sensor = target.map((v, i) => (i % 4 === 0 ? 1 : 0) + (v - (i % 4 === 0 ? 1 : 0)) * t);
  }
  if (a.cameraResponse) {
    const t = a.cameraResponse / 100;
    d.response = { exponent: 1 + DIGITAL.responseCurve * t, saturation: 1 + DIGITAL.responseSaturation * t };
  }
  if (a.highlightClip) d.clip = 1 / (1 - DIGITAL.clipRange * (a.highlightClip / 100));
  if (a.quantizeAmount) {
    const [from, to] = DIGITAL.quantizeLevels;
    d.quantize = { levels: Math.max(2, Math.round(from * (to / from) ** (a.quantizeAmount / 100))), dither: a.quantizeDither / 100 };
  }
  if (a.noiseAmount) {
    d.noise = { amount: (a.noiseAmount / 100) * DIGITAL.noiseAmplitude, chroma: a.noiseColor / 100, seed: noiseSeed(a.grainSeed >>> 0), cell: 0 };
  }
  if (a.captureResolution || a.jpegAmount) {
    const [from, to] = DIGITAL.captureEdge;
    const [best, worst] = DIGITAL.jpegQuality;
    d.capture = {
      edge: Math.round(from * (to / from) ** (a.captureResolution / 100)),
      hardness: a.pixelEdges / 100,
      quality: a.jpegAmount ? Math.max(1, Math.round(best + (worst - best) * (a.jpegAmount / 100) ** DIGITAL.jpegCurve)) : 0,
    };
  }
  if (a.chromaticAberration || a.channelShift) {
    const angle = (a.channelShiftAngle * Math.PI) / 180;
    const offset = (a.channelShift / 100) * DIGITAL.displacement;
    d.shift = { radial: (a.chromaticAberration / 100) * DIGITAL.aberration, dx: offset * Math.cos(angle), dy: -offset * Math.sin(angle) };
  }
  if (a.diffusionAmount) {
    const [lo, hi] = DIGITAL.diffusionSigma;
    d.diffusion = { amount: (a.diffusionAmount / 100) * DIGITAL.diffusionMix, sigma: lo + (hi - lo) * (a.diffusionRadius / 100) };
  }
  return d;
}

/** Seed of the sensor noise, derived from the photo's grain seed (one stored pattern per photo). */
export const noiseSeed = (seed) => (seed ^ 0x9e3779b9) >>> 0;

// --- Per-pixel colour (shader.mjs mirrors these) ---

/** Sensor colour: a channel-crosstalk matrix on encoded RGB. */
export function applySensor(p, m) {
  const [r, g, b] = p;
  p[0] = clamp01(m[0] * r + m[1] * g + m[2] * b);
  p[1] = clamp01(m[3] * r + m[4] * g + m[5] * b);
  p[2] = clamp01(m[6] * r + m[7] * g + m[8] * b);
}

/** Response curve: a symmetric power S-curve per channel (0, ½ and 1 fixed), then saturation about luma. */
export function applyResponse(p, response) {
  for (let c = 0; c < 3; c += 1) {
    const v = clamp01(p[c]);
    p[c] = v < 0.5 ? 0.5 * (2 * v) ** response.exponent : 1 - 0.5 * (2 - 2 * v) ** response.exponent;
  }
  const y = luma(p);
  for (let c = 0; c < 3; c += 1) p[c] = clamp01(y + (p[c] - y) * response.saturation);
}

/** Highlight clipping: each channel scaled and clipped on its own, so clipped colours shift hue as on early sensors. */
export function applyClip(p, gain) {
  for (let c = 0; c < 3; c += 1) p[c] = Math.min(1, Math.max(0, p[c]) * gain);
}

/** 8 × 8 Bayer matrix, thresholds 0–63. */
const BAYER = Uint8Array.from([0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21]);
export const bayerThreshold = (x, y) => (BAYER[(y & 7) * 8 + (x & 7)] + 0.5) / 64;

/**
 * Quantisation to `levels` per channel. `ditherAt` is [x, y] of a capture pixel (ordered
 * dither) or null (plain rounding: posterisation).
 */
export function applyQuantize(p, q, ditherAt) {
  const steps = q.levels - 1;
  const offset = ditherAt && q.dither ? q.dither * (bayerThreshold(ditherAt[0], ditherAt[1]) - 0.5) : 0;
  for (let c = 0; c < 3; c += 1) p[c] = Math.min(steps, Math.max(0, Math.floor(clamp01(p[c]) * steps + 0.5 + offset))) / steps;
}

// --- Sensor noise ---

/** Unit-variance triangular value of a hash (as creative.latticeValue). */
const SQRT6 = Math.sqrt(6);
const triangular = (h) => ((h & 0xffff) / 65536 + (h >>> 16) / 65536 - 1) * SQRT6;

/** The four independent noise values (luma, red, green, blue) of a sensor pixel. */
export function noiseValues(ix, iy, seed, out = [0, 0, 0, 0]) {
  for (let k = 0; k < 4; k += 1) out[k] = triangular(grainHash(ix, iy, (seed + Math.imul(k, 0x632be5ab)) >>> 0));
  return out;
}

const noiseOut = [0, 0, 0, 0];
/** Native px per sensor pixel of the virtual sensor for a photo whose output long edge is `nativeLong`. */
export const noiseCell = (nativeLong) => Math.max(1, nativeLong / DIGITAL.noiseSensorEdge);

/**
 * Adds sensor noise to an output pixel.
 * :param at: { x, y, width, height, scale } render position; noise.cell is native px per
 *   sensor pixel (0: the virtual sensor's, see noiseCell)
 */
export function applyNoise(p, noise, at) {
  const unit = at.scale * (noise.cell || noiseCell(Math.max(at.width, at.height) / at.scale));
  const ix = Math.floor((at.x + 0.5) / unit);
  const iy = Math.floor((at.y + 0.5) / unit);
  noiseValues(ix, iy, noise.seed, noiseOut);
  const l = clamp01(luma(p));
  const sigma = noise.amount * Math.min(1, unit) * (DIGITAL.noiseFloor + (1 - DIGITAL.noiseFloor) * (1 - l) * (1 - l));
  const norm = 1 / Math.sqrt((1 - noise.chroma) ** 2 + noise.chroma ** 2);
  for (let c = 0; c < 3; c += 1) {
    p[c] = clamp01(p[c] + sigma * norm * ((1 - noise.chroma) * noiseOut[0] + noise.chroma * DIGITAL.noiseChannelGain[c] * noiseOut[c + 1]));
  }
}

// --- Capture grid and reconstruction ---

/** Size of the capture grid for an image whose guide grid is `guide` ({ width, height }). */
export function captureSize(guide, capture) {
  const scale = Math.min(1, capture.edge / Math.max(guide.width, guide.height));
  return { width: Math.max(1, Math.round(guide.width * scale)), height: Math.max(1, Math.round(guide.height * scale)) };
}

/** Interpolation weight of a fraction for a pixel-edge hardness (0 bilinear, 1 nearest neighbour). */
export const edgeWeight = (f, hardness) => (hardness >= 1 ? (f >= 0.5 ? 1 : 0) : clamp01((f - 0.5) / (1 - hardness) + 0.5));

/**
 * Resamples the capture map (RGBA8) at an output pixel of a `width` × `height` render.
 * Writes encoded RGB (0–1) into `p`.
 */
export function sampleCapture(map, x, y, width, height, hardness, p) {
  const gx = Math.min(map.width - 1, Math.max(0, ((x + 0.5) * map.width) / width - 0.5));
  const gy = Math.min(map.height - 1, Math.max(0, ((y + 0.5) * map.height) / height - 0.5));
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(map.width - 1, x0 + 1);
  const y1 = Math.min(map.height - 1, y0 + 1);
  const tx = edgeWeight(gx - x0, hardness);
  const ty = edgeWeight(gy - y0, hardness);
  const d = map.data;
  const i00 = (y0 * map.width + x0) * 4;
  const i10 = (y0 * map.width + x1) * 4;
  const i01 = (y1 * map.width + x0) * 4;
  const i11 = (y1 * map.width + x1) * 4;
  // Weighted by alpha, so colours under transparent capture pixels never bleed in.
  const w00 = (1 - tx) * (1 - ty) * d[i00 + 3];
  const w10 = tx * (1 - ty) * d[i10 + 3];
  const w01 = (1 - tx) * ty * d[i01 + 3];
  const w11 = tx * ty * d[i11 + 3];
  const total = w00 + w10 + w01 + w11;
  if (total <= 0) { p[0] = d[i00] / 255; p[1] = d[i00 + 1] / 255; p[2] = d[i00 + 2] / 255; return p; }
  for (let c = 0; c < 3; c += 1) p[c] = (d[i00 + c] * w00 + d[i10 + c] * w10 + d[i01 + c] * w01 + d[i11 + c] * w11) / (total * 255);
  return p;
}

// --- JPEG compression (baseline DCT, 4:2:0, IJG quality scaling) ---

// The example quantisation tables of the JPEG standard (ITU-T T.81, Annex K).
const LUMA_TABLE = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const CHROMA_TABLE = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, ...new Array(32).fill(99)];

/** A standard table scaled to a quality (1–100) as the IJG library does. */
export function quantTable(table, quality) {
  const q = Math.min(100, Math.max(1, quality));
  const scale = q < 50 ? 5000 / q : 200 - 2 * q;
  return Float64Array.from(table, (v) => Math.min(255, Math.max(1, Math.floor((v * scale + 50) / 100))));
}

// DCT basis: COS[u * 8 + x] = c(u) / 2 · cos((2x + 1)uπ / 16).
const COS = Float64Array.from({ length: 64 }, (_, i) => {
  const u = i >> 3;
  const x = i & 7;
  return (u === 0 ? Math.SQRT1_2 : 1) / 2 * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
});

const block = new Float64Array(64);
const temp = new Float64Array(64);

/** Forward DCT, quantisation and inverse DCT of one 8 × 8 block in place. */
function codeBlock(b, table) {
  for (let y = 0; y < 8; y += 1) {
    for (let u = 0; u < 8; u += 1) {
      let s = 0;
      for (let x = 0; x < 8; x += 1) s += COS[u * 8 + x] * b[y * 8 + x];
      temp[y * 8 + u] = s;
    }
  }
  for (let u = 0; u < 8; u += 1) {
    for (let v = 0; v < 8; v += 1) {
      let s = 0;
      for (let y = 0; y < 8; y += 1) s += COS[v * 8 + y] * temp[y * 8 + u];
      const q = table[v * 8 + u];
      b[v * 8 + u] = Math.round(s / q) * q;
    }
  }
  for (let u = 0; u < 8; u += 1) {
    for (let y = 0; y < 8; y += 1) {
      let s = 0;
      for (let v = 0; v < 8; v += 1) s += COS[v * 8 + y] * b[v * 8 + u];
      temp[y * 8 + u] = s;
    }
  }
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      let s = 0;
      for (let u = 0; u < 8; u += 1) s += COS[u * 8 + x] * temp[y * 8 + u];
      b[y * 8 + x] = s;
    }
  }
}

/** Codes every 8 × 8 block of a plane (edges replicated into partial blocks). */
function codePlane(plane, w, h, table) {
  for (let by = 0; by < h; by += 8) {
    for (let bx = 0; bx < w; bx += 8) {
      for (let y = 0; y < 8; y += 1) {
        const row = Math.min(h - 1, by + y) * w;
        for (let x = 0; x < 8; x += 1) block[y * 8 + x] = plane[row + Math.min(w - 1, bx + x)] - 128;
      }
      codeBlock(block, table);
      for (let y = 0; y < 8 && by + y < h; y += 1) {
        for (let x = 0; x < 8 && bx + x < w; x += 1) plane[(by + y) * w + bx + x] = block[y * 8 + x] + 128;
      }
    }
  }
}

/**
 * JPEG-style compression of an RGBA8 image in place: full-range YCbCr, 2 × 2 chroma
 * subsampling (averaged), 8 × 8 DCT blocks quantised with the standard tables at `quality`,
 * chroma replicated back. Alpha is untouched. Deterministic.
 */
export function jpegCompress(data, width, height, quality) {
  const n = width * height;
  const cw = Math.ceil(width / 2);
  const ch = Math.ceil(height / 2);
  const Y = new Float64Array(n);
  const Cb = new Float64Array(cw * ch);
  const Cr = new Float64Array(cw * ch);
  const counts = new Float64Array(cw * ch);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      Y[y * width + x] = 0.299 * r + 0.587 * g + 0.114 * b;
      const c = (y >> 1) * cw + (x >> 1);
      Cb[c] += -0.168736 * r - 0.331264 * g + 0.5 * b + 128;
      Cr[c] += 0.5 * r - 0.418688 * g - 0.081312 * b + 128;
      counts[c] += 1;
    }
  }
  for (let c = 0; c < cw * ch; c += 1) { Cb[c] /= counts[c]; Cr[c] /= counts[c]; }
  codePlane(Y, width, height, quantTable(LUMA_TABLE, quality));
  const chroma = quantTable(CHROMA_TABLE, quality);
  codePlane(Cb, cw, ch, chroma);
  codePlane(Cr, cw, ch, chroma);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const l = Y[y * width + x];
      const c = (y >> 1) * cw + (x >> 1);
      const cb = Cb[c] - 128;
      const cr = Cr[c] - 128;
      data[i] = Math.round(Math.min(255, Math.max(0, l + 1.402 * cr)));
      data[i + 1] = Math.round(Math.min(255, Math.max(0, l - 0.344136 * cb - 0.714136 * cr)));
      data[i + 2] = Math.round(Math.min(255, Math.max(0, l + 1.772 * cb)));
    }
  }
  return data;
}

// --- Chromatic aberration and channel displacement ---

/**
 * Source positions of the red and blue channels for output pixel (x, y) of a `width` ×
 * `height` render (green stays put). Writes [rx, ry, bx, by] into `out`.
 */
export function shiftPositions(x, y, width, height, shift, out) {
  const cx = width / 2;
  const cy = height / 2;
  const long = Math.max(width, height);
  const dx = x + 0.5 - cx;
  const dy = y + 0.5 - cy;
  out[0] = cx + dx * (1 + shift.radial) + shift.dx * long - 0.5;
  out[1] = cy + dy * (1 + shift.radial) + shift.dy * long - 0.5;
  out[2] = cx + dx * (1 - shift.radial) - shift.dx * long - 0.5;
  out[3] = cy + dy * (1 - shift.radial) - shift.dy * long - 0.5;
  return out;
}

/** Largest displacement (render px) of any channel: the halo the spatial renderer needs. */
export function shiftHalo(shift, width, height) {
  if (!shift) return 0;
  const long = Math.max(width, height);
  return Math.ceil(Math.hypot(width, height) / 2 * shift.radial + Math.hypot(shift.dx, shift.dy) * long) + 2;
}
