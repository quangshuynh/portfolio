// Detail stage: Texture, Clarity, Dehaze, Sharpening and noise reduction. Unlike every
// other stage these are spatial, so they live here instead of in the per-pixel spec.
//
// Position: after the base stage (processLinear, then sRGB encoding) and before the
// display stages (curves, HSL, LUT). Work is on the encoded values E (0–1) split into
// luma P = LUMA·E and chroma Cr = R − P, Cb = B − P, so luminance edits never shift hue.
// Order inside the stage:
//   colour NR and luminance NR (both from the same input) -> Dehaze -> Clarity
//   -> Texture and Sharpening (both from the same input) -> range fit toward P.
//
// Two kinds of filter keep previews and exports of any size consistent:
// - Fine filters (noise reduction, Texture, Sharpening) run at render resolution with
//   radii in the photo's native pixels times `scale` (render / native long edge), so a
//   preview looks like the export downscaled. Below 1 native px they fade out, exactly
//   as fine detail does when an export is downscaled.
// - Large-scale filters (Clarity, Dehaze) use a guide: the base stage of the image
//   area-averaged to at most DETAIL.guideEdge px, where guided-filter coefficients are
//   computed (He et al. 2010; "fast guided filter", He & Sun 2015). Every render samples
//   them bilinearly and applies them to its own full-resolution luma, so edges stay sharp
//   and the result does not depend on the render size or on tiling.
// Fine filters need neighbours: a tile is processed with a halo of `detailHalo()` px
// (clamped at the image edge, which replicates the border) and only its core is kept.

import { LUMA } from './colorMath.mjs';

const [LR, LG, LB] = LUMA;

export const DETAIL = Object.freeze({
  /** Long edge of the guide grid for Clarity and Dehaze. */
  guideEdge: 768,
  /** Luminance NR: box radius (native px) from 0 to 100, and the noise level (encoded) treated as noise at 100. */
  lumaRadius: [1, 3],
  lumaNoise: 0.06,
  /** Share of the removed luminance noise put back, so surfaces never look plastic. */
  lumaRetain: 0.1,
  /** Colour NR: box radius (native px) from 0 to 100, and the local luma plus chroma variation (encoded) at which chroma is kept. */
  colorRadius: [1, 8],
  colorEdge: 0.1,
  /** Texture: band between Gaussians of these sigmas (native px); band values above `textureLimit` are boosted less. */
  textureFine: 1,
  textureCoarse: 4,
  textureLimit: 0.04,
  /** Band values around the noise level (encoded) are boosted less, so Texture does not amplify grain. */
  textureThreshold: 0.012,
  textureGain: Object.freeze({ negative: 1, positive: 1.5 }),
  /** Sharpening: unsharp mask against the `textureFine` Gaussian; gain at 100, noise threshold and overshoot limit (encoded). */
  sharpenGain: 2,
  sharpenThreshold: 0.008,
  sharpenLimit: 0.08,
  /** Clarity: guided-filter radius (fraction of the long edge) and edge threshold (variance, encoded). */
  clarityRadius: 0.012,
  clarityEps: 0.015,
  clarityGain: Object.freeze({ negative: 0.9, positive: 1 }),
  clarityLimit: 0.15,
  /** Detail below this amplitude (encoded) is boosted less, so positive Clarity does not amplify grain. */
  clarityThreshold: 0.02,
  /**
   * Dehaze: dark-channel patch for choosing the airlight, and the refinement radius of the
   * per-pixel transmission (fractions of the long edge). He et al. also take the
   * transmission over the patch; on a 768 px guide that leaves sky halos around trees.
   */
  hazePatch: 0.01,
  hazeRadius: 0.003,
  hazeEps: 1e-3,
  hazeOmega: 0.95,
  /** Lowest transmission divided by (bounds noise and gain amplification at 1/0.25 = 4x). */
  hazeFloor: 0.25,
  /** Negative Dehaze: largest share of airlight added, more where the estimate says farther. */
  hazeAdd: 0.5,
  hazeAirTop: 0.001,
  hazeAirMin: 0.05,
});

/** Slider values (normalised settings) -> detail parameters, all in −1…1 or 0…1. */
export function detailParams(a) {
  const detail = {
    texture: a.texture / 100,
    clarity: a.clarity / 100,
    dehaze: a.dehaze / 100,
    sharpening: a.sharpening / 100,
    luminanceNoise: a.luminanceNoise / 100,
    colorNoise: a.colorNoise / 100,
  };
  detail.active = Object.values(detail).some((value) => value !== 0);
  return detail;
}

const lerp = ([a, b], t) => a + (b - a) * t;

/**
 * Box radius whose three-fold repetition has the variance of a Gaussian of `sigma`.
 * A fractional radius n + f weights the taps at ±(n + 1) by f, so it varies smoothly.
 */
export function boxRadiusForSigma(sigma) {
  const target = (sigma * sigma) / 3;
  if (target <= 0) return 0;
  let n = 0;
  while (((n + 1) * (n + 2)) / 3 <= target) n += 1;
  const a = (n * (n + 1) * (2 * n + 1)) / 3;
  const b = 2 * n + 1;
  return n + (target * b - a) / (2 * ((n + 1) ** 2 - target));
}

/** Render-size radii of the fine filters. */
export function detailRadii(detail, scale) {
  return {
    luma: scale * lerp(DETAIL.lumaRadius, detail.luminanceNoise),
    color: scale * lerp(DETAIL.colorRadius, detail.colorNoise),
    fine: boxRadiusForSigma(scale * DETAIL.textureFine),
    coarse: boxRadiusForSigma(scale * DETAIL.textureCoarse),
  };
}

/** Pixels on each side a tile needs beyond its core so the fine filters see real neighbours. */
export function detailHalo(detail, scale) {
  const r = detailRadii(detail, scale);
  const noise = Math.max(detail.luminanceNoise ? Math.ceil(r.luma) : 0, detail.colorNoise ? Math.ceil(r.color) : 0);
  const fine = detail.texture || detail.sharpening
    ? 3 * Math.ceil(detail.texture ? r.coarse : r.fine)
    : 0;
  return noise + fine;
}

// --- Box filters on w×h Float32 planes, clamped (edge replicated) at the buffer edge ---

function boxRows(src, dst, w, h, r) {
  const n = Math.floor(r);
  const f = r - n;
  const norm = 1 / (2 * n + 1 + 2 * f);
  const last = w - 1;
  for (let y = 0; y < h; y += 1) {
    const o = y * w;
    let sum = 0;
    for (let k = -n; k <= n; k += 1) sum += src[o + (k < 0 ? 0 : k > last ? last : k)];
    for (let x = 0; x < w; x += 1) {
      const ahead = x + n + 1;
      const behind = x - n;
      const aheadValue = src[o + (ahead > last ? last : ahead)];
      let value = sum;
      if (f) {
        const before = x - n - 1;
        value += f * (src[o + (before < 0 ? 0 : before)] + aheadValue);
      }
      dst[o + x] = value * norm;
      sum += aheadValue - src[o + (behind < 0 ? 0 : behind > last ? last : behind)];
    }
  }
}

function boxColumns(src, dst, w, h, r, sums) {
  const n = Math.floor(r);
  const f = r - n;
  const norm = 1 / (2 * n + 1 + 2 * f);
  const last = h - 1;
  const row = (y) => (y < 0 ? 0 : y > last ? last : y) * w;
  sums.fill(0, 0, w);
  for (let k = -n; k <= n; k += 1) {
    const o = row(k);
    for (let x = 0; x < w; x += 1) sums[x] += src[o + x];
  }
  for (let y = 0; y < h; y += 1) {
    const out = y * w;
    if (f) {
      const a = row(y - n - 1);
      const b = row(y + n + 1);
      for (let x = 0; x < w; x += 1) dst[out + x] = (sums[x] + f * (src[a + x] + src[b + x])) * norm;
    } else {
      for (let x = 0; x < w; x += 1) dst[out + x] = sums[x] * norm;
    }
    const add = row(y + n + 1);
    const sub = row(y - n);
    for (let x = 0; x < w; x += 1) sums[x] += src[add + x] - src[sub + x];
  }
}

/**
 * Plane filters over a w×h buffer with shared scratch space. With `weight` (alpha,
 * 0–1) every blur is normalised by the blurred weight, so transparent pixels' colours
 * never leak into visible ones; pixels with no weight nearby keep their own value.
 */
export function createFilters(w, h, pool, weight = null) {
  const n = w * h;
  const tmp = pool('tmp', n);
  const sums = pool('sums', w, Float64Array);
  const product = weight ? pool('product', n) : null;
  const weightBlurs = new Map();
  const box = (src, dst, r) => {
    if (r <= 0) { if (dst !== src) dst.set(src.subarray(0, n)); return; }
    boxRows(src, tmp, w, h, r);
    boxColumns(tmp, dst, w, h, r, sums);
  };
  const gauss = (src, dst, r) => {
    box(src, dst, r);
    box(dst, dst, r);
    box(dst, dst, r);
  };
  const normalised = (filter, key) => (src, dst, r) => {
    if (!weight || r <= 0) return filter(src, dst, r);
    let weights = weightBlurs.get(`${key}:${r}`);
    if (!weights) {
      weights = pool(`weights:${key}:${r}`, n);
      filter(weight, weights, r);
      weightBlurs.set(`${key}:${r}`, weights);
    }
    for (let i = 0; i < n; i += 1) product[i] = src[i] * weight[i];
    filter(product, product, r);
    for (let i = 0; i < n; i += 1) dst[i] = weights[i] > 1e-6 ? product[i] / weights[i] : src[i];
    return undefined;
  };
  return { box: normalised(box, 'box'), gauss: normalised(gauss, 'gauss'), rawBox: box };
}

/** Square min filter (separable), clamped at the edges. Used on the small guide grid only. */
function minFilter(src, w, h, r) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const o = y * w;
    for (let x = 0; x < w; x += 1) {
      const end = x + r < w ? x + r : w - 1;
      let m = Infinity;
      for (let k = x - r > 0 ? x - r : 0; k <= end; k += 1) if (src[o + k] < m) m = src[o + k];
      tmp[o + x] = m;
    }
  }
  out.set(tmp);
  for (let k = 1; k <= r; k += 1) {
    // Rows k above and below, folded in one offset at a time (row-wise, cache friendly).
    for (let y = 0; y < h; y += 1) {
      const o = y * w;
      const up = (y - k > 0 ? y - k : 0) * w;
      const down = (y + k < h ? y + k : h - 1) * w;
      for (let x = 0; x < w; x += 1) {
        const a = tmp[up + x];
        const b = tmp[down + x];
        const m = a < b ? a : b;
        if (m < out[o + x]) out[o + x] = m;
      }
    }
  }
  return out;
}

const simplePool = () => {
  const planes = new Map();
  return (name, size, Type = Float32Array) => {
    let plane = planes.get(name);
    if (!plane || plane.length < size) { plane = new Type(size); planes.set(name, plane); }
    return plane;
  };
};

/**
 * Guided filter coefficients (box means), already averaged, so q = a·I + b at any
 * resolution where I is sampled. `input` null means the guide filters itself.
 */
function guidedCoefficients(guide, input, w, h, r, eps) {
  const n = w * h;
  const { rawBox: box } = createFilters(w, h, simplePool());
  const p = input ?? guide;
  const meanI = new Float32Array(n);
  const meanP = input ? new Float32Array(n) : meanI;
  const corrIp = new Float32Array(n);
  const corrII = input ? new Float32Array(n) : corrIp;
  for (let i = 0; i < n; i += 1) {
    corrIp[i] = guide[i] * p[i];
    if (input) corrII[i] = guide[i] * guide[i];
  }
  box(guide, meanI, r);
  if (input) box(p, meanP, r);
  box(corrIp, corrIp, r);
  if (input) box(corrII, corrII, r);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const variance = corrII[i] - meanI[i] * meanI[i];
    const covariance = corrIp[i] - meanI[i] * meanP[i];
    a[i] = covariance / (variance + eps);
    b[i] = meanP[i] - a[i] * meanI[i];
  }
  box(a, a, r);
  box(b, b, r);
  return { a, b };
}

/** Dehaze of one linear RGB pixel (mutates `lin`) for transmission t, amount k and airlight. */
export function dehazePixel(lin, t, k, air) {
  const transmission = t < 0 ? 0 : t > 1 ? 1 : t;
  if (k > 0) {
    const tk = Math.max(DETAIL.hazeFloor, 1 - k * (1 - transmission));
    for (let c = 0; c < 3; c += 1) lin[c] = Math.max(0, (lin[c] - air[c]) / tk + air[c]);
  } else if (k < 0) {
    const haze = -k * DETAIL.hazeAdd * (1 - 0.5 * transmission);
    for (let c = 0; c < 3; c += 1) lin[c] = lin[c] * (1 - haze) + air[c] * haze;
  }
  return lin;
}

/**
 * Guide for Clarity and Dehaze from the base stage of a small image.
 * :param planes: { r, g, b } encoded Float32 planes of the guide image, w×h
 * :param transfer: { toLinear, toSrgb }
 * :returns: { width, height, air, haze: { a, b } | null, clarity: { a, b } | null }
 */
export function computeGuide(planes, w, h, detail, transfer) {
  const n = w * h;
  const edge = Math.max(w, h);
  const luma = new Float32Array(n);
  for (let i = 0; i < n; i += 1) luma[i] = LR * planes.r[i] + LG * planes.g[i] + LB * planes.b[i];
  const guide = { width: w, height: h, air: [1, 1, 1], haze: null, clarity: null };
  if (detail.dehaze) {
    const lin = [planes.r, planes.g, planes.b].map((plane) => {
      const out = new Float32Array(n);
      for (let i = 0; i < n; i += 1) out[i] = transfer.toLinear(plane[i]);
      return out;
    });
    const patch = Math.max(1, Math.round(DETAIL.hazePatch * edge));
    const darkest = new Float32Array(n);
    for (let i = 0; i < n; i += 1) darkest[i] = Math.min(lin[0][i], lin[1][i], lin[2][i]);
    const dark = minFilter(darkest, w, h, patch);
    // Airlight: mean colour of the haziest pixels (the top 0.1% of the dark channel).
    // Threshold from a 4096-bin histogram (dark values are linear, about 0–1); ties at the
    // threshold are all included, so the result does not depend on pixel order.
    const bins = 4096;
    const histogram = new Uint32Array(bins);
    const bin = (value) => Math.min(bins - 1, Math.max(0, Math.floor(value * bins)));
    for (let i = 0; i < n; i += 1) histogram[bin(dark[i])] += 1;
    let threshold = bins - 1;
    for (let count = 0, wanted = Math.max(1, Math.round(n * DETAIL.hazeAirTop)); threshold > 0; threshold -= 1) {
      count += histogram[threshold];
      if (count >= wanted) break;
    }
    const sums = [0, 0, 0];
    let selected = 0;
    for (let i = 0; i < n; i += 1) {
      if (bin(dark[i]) < threshold) continue;
      sums[0] += lin[0][i]; sums[1] += lin[1][i]; sums[2] += lin[2][i];
      selected += 1;
    }
    // The airlight is taken as grey of the haziest pixels' luminance: removing (or adding)
    // a coloured airlight such as blue sky would tint the whole photo.
    const air = Math.max(DETAIL.hazeAirMin, Math.min(1, (LR * sums[0] + LG * sums[1] + LB * sums[2]) / selected));
    guide.air = [air, air, air];
    const transmission = new Float32Array(n);
    for (let i = 0; i < n; i += 1) transmission[i] = 1 - DETAIL.hazeOmega * (Math.min(lin[0][i], lin[1][i], lin[2][i]) / air);
    guide.haze = guidedCoefficients(luma, transmission, w, h, Math.max(1, DETAIL.hazeRadius * edge), DETAIL.hazeEps);
    if (detail.clarity) {
      // Clarity follows Dehaze, so its guide is the dehazed luma.
      const pixel = [0, 0, 0];
      for (let i = 0; i < n; i += 1) {
        pixel[0] = lin[0][i]; pixel[1] = lin[1][i]; pixel[2] = lin[2][i];
        dehazePixel(pixel, guide.haze.a[i] * luma[i] + guide.haze.b[i], detail.dehaze, guide.air);
        luma[i] = LR * transfer.toSrgb(pixel[0]) + LG * transfer.toSrgb(pixel[1]) + LB * transfer.toSrgb(pixel[2]);
      }
    }
  }
  if (detail.clarity) guide.clarity = guidedCoefficients(luma, null, w, h, Math.max(1, DETAIL.clarityRadius * edge), DETAIL.clarityEps);
  return guide;
}

/** Bilinear sampling positions of image coordinates [start, start + count) on a guide axis. */
function guideAxis(start, count, imageSize, guideSize) {
  const lo = new Int32Array(count);
  const hi = new Int32Array(count);
  const t = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const g = Math.min(guideSize - 1, Math.max(0, ((start + i + 0.5) * guideSize) / imageSize - 0.5));
    lo[i] = Math.floor(g);
    hi[i] = Math.min(guideSize - 1, lo[i] + 1);
    t[i] = g - lo[i];
  }
  return { lo, hi, t };
}

const sample = (plane, gw, ylo, yhi, ty, xlo, xhi, tx) => {
  const top = plane[ylo * gw + xlo] + (plane[ylo * gw + xhi] - plane[ylo * gw + xlo]) * tx;
  const bottom = plane[yhi * gw + xlo] + (plane[yhi * gw + xhi] - plane[yhi * gw + xlo]) * tx;
  return top + (bottom - top) * ty;
};

/**
 * Applies the detail stage to one buffer of encoded planes in place.
 * :param buffer: { r, g, b, alpha (Float32 0–1 or null), w, h, x, y } with (x, y) the
 *   buffer's position in the image; values are valid on return for pixels at least
 *   `detailHalo()` from any buffer edge that is not an image edge
 * :param context: { detail, scale, guide, imageWidth, imageHeight, transfer, pool }
 */
export function applyDetail(buffer, { detail, scale, guide, imageWidth, imageHeight, transfer, pool }) {
  const { r: R, g: G, b: B, alpha, w, h } = buffer;
  const n = w * h;
  const P = pool('P', n);
  const Cr = pool('Cr', n);
  const Cb = pool('Cb', n);
  for (let i = 0; i < n; i += 1) {
    const p = LR * R[i] + LG * G[i] + LB * B[i];
    P[i] = p; Cr[i] = R[i] - p; Cb[i] = B[i] - p;
  }
  const radii = detailRadii(detail, scale);
  const filters = createFilters(w, h, pool, alpha);
  const M = pool('M', n);
  const Q = pool('Q', n);

  if (detail.colorNoise) {
    // Chroma toward its local mean, except where luma or chroma varies by more than
    // noise does (an edge, also between colours of equal luma): no bleeding there.
    const MR = pool('MR', n);
    const MB = pool('MB', n);
    const QC = pool('QC', n);
    for (let i = 0; i < n; i += 1) {
      Q[i] = P[i] * P[i];
      QC[i] = Cr[i] * Cr[i] + Cb[i] * Cb[i];
    }
    filters.box(P, M, radii.color);
    filters.box(Q, Q, radii.color);
    filters.box(Cr, MR, radii.color);
    filters.box(Cb, MB, radii.color);
    filters.box(QC, QC, radii.color);
    const eps = (DETAIL.colorEdge * detail.colorNoise) ** 2;
    for (let i = 0; i < n; i += 1) {
      const variance = Math.max(0, Q[i] - M[i] * M[i]) + Math.max(0, QC[i] - MR[i] * MR[i] - MB[i] * MB[i]);
      const keep = variance / (variance + eps);
      Cr[i] = MR[i] + keep * (Cr[i] - MR[i]);
      Cb[i] = MB[i] + keep * (Cb[i] - MB[i]);
    }
  }
  if (detail.luminanceNoise) {
    // Adaptive Wiener (Lee) filter: smooth where local variance is at the noise level.
    for (let i = 0; i < n; i += 1) Q[i] = P[i] * P[i];
    filters.box(P, M, radii.luma);
    filters.box(Q, Q, radii.luma);
    const eps = (DETAIL.lumaNoise * detail.luminanceNoise) ** 2;
    for (let i = 0; i < n; i += 1) {
      const variance = Math.max(0, Q[i] - M[i] * M[i]);
      const filtered = M[i] + (variance / (variance + eps)) * (P[i] - M[i]);
      P[i] = filtered + DETAIL.lumaRetain * (P[i] - filtered);
    }
  }

  if (guide && (guide.haze || guide.clarity)) {
    const gw = guide.width;
    const xs = guideAxis(buffer.x, w, imageWidth, gw);
    const ys = guideAxis(buffer.y, h, imageHeight, guide.height);
    const lin = [0, 0, 0];
    const { haze, clarity, air } = guide;
    const clarityGain = detail.clarity * (detail.clarity > 0 ? DETAIL.clarityGain.positive : DETAIL.clarityGain.negative);
    for (let y = 0; y < h; y += 1) {
      const ylo = ys.lo[y]; const yhi = ys.hi[y]; const ty = ys.t[y];
      for (let x = 0; x < w; x += 1) {
        const i = y * w + x;
        let p = P[i];
        if (haze) {
          const t = sample(haze.a, gw, ylo, yhi, ty, xs.lo[x], xs.hi[x], xs.t[x]) * p + sample(haze.b, gw, ylo, yhi, ty, xs.lo[x], xs.hi[x], xs.t[x]);
          const red = p + Cr[i];
          const blue = p + Cb[i];
          lin[0] = transfer.toLinear(red);
          lin[1] = transfer.toLinear((p - LR * red - LB * blue) / LG);
          lin[2] = transfer.toLinear(blue);
          dehazePixel(lin, t, detail.dehaze, air);
          const er = transfer.toSrgb(lin[0]);
          const eg = transfer.toSrgb(lin[1]);
          const eb = transfer.toSrgb(lin[2]);
          p = LR * er + LG * eg + LB * eb;
          Cr[i] = er - p; Cb[i] = eb - p;
        }
        if (clarity) {
          const base = sample(clarity.a, gw, ylo, yhi, ty, xs.lo[x], xs.hi[x], xs.t[x]) * p + sample(clarity.b, gw, ylo, yhi, ty, xs.lo[x], xs.hi[x], xs.t[x]);
          const d = p - base;
          const c = p < 0 ? 0 : p > 1 ? 1 : p;
          const midtones = 1 - (2 * c - 1) ** 2;
          const coring = d / DETAIL.clarityThreshold;
          const delta = clarityGain * d * (clarityGain > 0 ? 1 - Math.exp(-coring * coring) : 1);
          p += (midtones * delta) / (1 + Math.abs(delta) / DETAIL.clarityLimit);
        }
        P[i] = p;
      }
    }
  }

  if (detail.texture || detail.sharpening) {
    // Both from the same luma: Sharpening = P − G(σ 1), Texture = G(σ 1) − G(σ 4).
    filters.gauss(P, M, radii.fine);
    if (detail.texture) filters.gauss(P, Q, radii.coarse);
    const textureGain = detail.texture * (detail.texture > 0 ? DETAIL.textureGain.positive : DETAIL.textureGain.negative);
    const sharpenGain = detail.sharpening * DETAIL.sharpenGain;
    for (let i = 0; i < n; i += 1) {
      let delta = 0;
      if (detail.texture) {
        const band = M[i] - Q[i];
        const ratio = band / DETAIL.textureLimit;
        const coring = band / DETAIL.textureThreshold;
        // Softening removes the band evenly; enhancing skips noise-level detail.
        const gain = textureGain > 0 ? textureGain * (1 - Math.exp(-coring * coring)) : textureGain;
        delta += (gain * band) / (1 + ratio * ratio);
      }
      if (detail.sharpening) {
        const high = P[i] - M[i];
        const ratio = high / DETAIL.sharpenThreshold;
        const boost = sharpenGain * high * (1 - Math.exp(-ratio * ratio));
        delta += boost / (1 + Math.abs(boost) / DETAIL.sharpenLimit);
      }
      P[i] += delta;
    }
  }

  // Back to RGB, pulled into range toward the new luma (no per-channel clipping).
  for (let i = 0; i < n; i += 1) {
    const p = P[i];
    let r = p + Cr[i];
    let b = p + Cb[i];
    let g = (p - LR * r - LB * b) / LG;
    const max = Math.max(r, g, b);
    if (max > 1) {
      if (p >= 1) { r = 1; g = 1; b = 1; } else {
        const t = (1 - p) / (max - p);
        r = p + (r - p) * t; g = p + (g - p) * t; b = p + (b - p) * t;
      }
    }
    const min = Math.min(r, g, b);
    if (min < 0) {
      if (p <= 0) { r = 0; g = 0; b = 0; } else {
        const t = p / (p - min);
        r = p + (r - p) * t; g = p + (g - p) * t; b = p + (b - p) * t;
      }
    }
    R[i] = r < 0 ? 0 : r > 1 ? 1 : r;
    G[i] = g < 0 ? 0 : g > 1 ? 1 : g;
    B[i] = b < 0 ? 0 : b > 1 ? 1 : b;
  }
}
