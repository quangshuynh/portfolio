// Bracket merging. Environment-free (worker, main thread, Node tests).
//
// RAW (radiance): LibRaw's 16-bit linear camera RGB of each frame is brought to the
// reference frame's white balance, divided by its exposure relative to the reference
// (measured from the images, checked against the metadata), and averaged with weights
// proportional to that exposure (brighter frames have less relative noise), falling to
// zero as any channel nears the sensor white. Moving areas found by deghosting use the
// reference only. The result is float32 camera RGB in reference units, unclipped up to
// the darkest frame's sensor white (`white`); nothing is tone mapped here.
//
// JPEG, PNG, WebP (fusion): values are already tone mapped and clipped, so no radiance
// is reconstructed. Exposure fusion (Mertens, Kautz and Van Reeth 2007) blends the
// frames by contrast, saturation and well-exposedness in a Laplacian pyramid, and the
// result is an ordinary 8-bit image.
//
// Frames are added one at a time (`add`), so an export holds one decoded frame plus the
// accumulators, never all three full-size inputs. Analysis (alignment, exposure ratios,
// ghost masks) runs once on preview-size frames and is reused at any output size.

import { ALIGN, IDENTITY, alignmentStatus, boxBlur, commonCrop, cropAt, estimateTransform, halve, normalizeTransform, transformAt } from './hdrAlign.mjs';
import { LUMA, SRGB_TO_LINEAR_8BIT } from '../pipeline/colorMath.mjs';

export const MERGE = Object.freeze({
  analysisEdge: 1024,
  /** Weight falls from 1 to 0 between these fractions of the sensor white. */
  saturationLow: 0.8,
  saturationHigh: 0.96,
  /** Exposure-ratio samples: both frames between these fractions of their white. */
  ratioLow: 0.02,
  ratioHigh: 0.75,
  minRatioSamples: 500,
  /** Measured and recorded exposure differences further apart than this are reported. */
  metadataTolerance: 0.35,
  /** Below this measured difference between all frames, the files hold the same exposure. */
  sameExposure: 0.08,
  ghostRadius: 0.01,
});

export const DEFAULT_MERGE_SETTINGS = Object.freeze({ align: true, deghost: true, deghostStrength: 50 });

export class HdrError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Per-channel scale from a frame's decoded (as-shot, max-normalised) camera RGB to the
 * reference frame's, and the reference's per-channel sensor white in that space.
 */
export function whiteBalanceToReference(frameAsShot, refAsShot) {
  const fMax = Math.max(...frameAsShot);
  const rMax = Math.max(...refAsShot);
  return {
    scale: frameAsShot.map((a, c) => (fMax / a) * (refAsShot[c] / rMax)),
    clip: refAsShot.map((a) => a / rMax),
  };
}

/** Luminance plane of a frame, and the per-pixel saturation (largest channel / its white). */
export function framePlanes(image, { scale = [1, 1, 1], clip = [1, 1, 1] } = {}) {
  const n = image.width * image.height;
  const luma = new Float32Array(n);
  const saturation = new Float32Array(n);
  const { data } = image;
  if (image.kind === 'raw') {
    const k = scale.map((s) => s / 65535);
    const ic = clip.map((c) => 1 / c);
    for (let i = 0, j = 0; i < n; i += 1, j += 3) {
      const r = data[j] * k[0];
      const g = data[j + 1] * k[1];
      const b = data[j + 2] * k[2];
      luma[i] = (r + 2 * g + b) * 0.25;
      saturation[i] = Math.max(r * ic[0], g * ic[1], b * ic[2]);
    }
  } else {
    for (let i = 0, j = 0; i < n; i += 1, j += 4) {
      const r = data[j];
      const g = data[j + 1];
      const b = data[j + 2];
      // Encoded luminance: monotone, which is all alignment and fusion matching need.
      luma[i] = (LUMA[0] * r + LUMA[1] * g + LUMA[2] * b) / 255;
      saturation[i] = Math.max(r, g, b) / 255;
    }
  }
  return { luma, saturation, width: image.width, height: image.height };
}

/** Bilinear sample of a float plane at (x, y), clamped to the edges. */
function sample(plane, width, height, x, y) {
  const fx = Math.min(width - 1, Math.max(0, x));
  const fy = Math.min(height - 1, Math.max(0, y));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const ax = fx - x0;
  const ay = fy - y0;
  const top = plane[y0 * width + x0] * (1 - ax) + plane[y0 * width + x1] * ax;
  const bottom = plane[y1 * width + x0] * (1 - ax) + plane[y1 * width + x1] * ax;
  return top * (1 - ay) + bottom * ay;
}

/** A plane resampled through a transform (pixels at this size), same size. */
function warpPlane(plane, width, height, { tx, ty, angle }) {
  if (tx === 0 && ty === 0 && angle === 0) return plane;
  const out = new Float32Array(width * height);
  const cos = Math.cos((angle * Math.PI) / 180);
  const sin = Math.sin((angle * Math.PI) / 180);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const qx = cos * (x - cx) - sin * (y - cy) + cx + tx;
      const qy = sin * (x - cx) + cos * (y - cy) + cy + ty;
      out[y * width + x] = sample(plane, width, height, qx, qy);
    }
  }
  return out;
}

function shrink(planes, width, height, edge) {
  let w = width;
  let h = height;
  let current = planes;
  while (Math.max(w, h) > edge) {
    const next = current.map((plane) => halve(plane, w, h));
    w = next[0].width;
    h = next[0].height;
    current = next.map(({ plane }) => plane);
  }
  return { planes: current, width: w, height: h };
}

function median(values) {
  if (!values.length) return null;
  const sorted = Float64Array.from(values).sort();
  return sorted[sorted.length >> 1];
}

/** Binary max (dilate, `max`) or min (erode) filter over a square of radius r. */
function morph(plane, width, height, r, max) {
  const blurred = boxBlur(plane, width, height, r);
  const out = new Float32Array(plane.length);
  for (let i = 0; i < plane.length; i += 1) out[i] = max ? (blurred[i] > 1e-6 ? 1 : 0) : (blurred[i] > 1 - 1e-6 ? 1 : 0);
  return out;
}

/** Intensity mapping from one frame's luminance to the reference's by histogram matching (256 bins). */
function intensityMapping(source, target) {
  const bins = 256;
  const cdf = (plane) => {
    const histogram = new Float64Array(bins);
    for (let i = 0; i < plane.length; i += 1) histogram[Math.min(bins - 1, Math.max(0, Math.floor(plane[i] * bins)))] += 1;
    for (let i = 1; i < bins; i += 1) histogram[i] += histogram[i - 1];
    return histogram.map((v) => v / plane.length);
  };
  const a = cdf(source);
  const b = cdf(target);
  const map = new Float32Array(bins);
  let j = 0;
  for (let i = 0; i < bins; i += 1) {
    while (j < bins - 1 && b[j] < a[i]) j += 1;
    map[i] = (j + 0.5) / bins;
  }
  return (v) => map[Math.min(bins - 1, Math.max(0, Math.floor(v * bins)))];
}

/**
 * Soft motion mask for one frame against the reference (analysis size), from where the
 * normalised frames disagree beyond the threshold: opened to drop isolated noise,
 * dilated by GHOST_RADIUS of the width and feathered.
 */
function ghostMask(ref, frame, width, height, { mode, ratio, strength }) {
  const n = width * height;
  const raw = new Float32Array(n);
  const refLuma = boxBlur(ref.luma, width, height, 1);
  const frameLuma = boxBlur(frame.luma, width, height, 1);
  if (mode === 'radiance') {
    const threshold = 1 - 0.0075 * strength;
    const floor = 0.004;
    for (let i = 0; i < n; i += 1) {
      if (ref.saturation[i] > 0.9 || frame.saturation[i] > 0.9 || refLuma[i] < floor || frameLuma[i] < floor) continue;
      if (Math.abs(Math.log2((frameLuma[i] / ratio + 1e-4) / (refLuma[i] + 1e-4))) > threshold) raw[i] = 1;
    }
  } else {
    const map = intensityMapping(frameLuma, refLuma);
    const threshold = 0.25 - 0.0019 * strength;
    for (let i = 0; i < n; i += 1) {
      const a = refLuma[i];
      const b = frameLuma[i];
      if (a < 0.03 || a > 0.97 || b < 0.03 || b > 0.97) continue;
      if (Math.abs(map(b) - a) > threshold) raw[i] = 1;
    }
  }
  const radius = Math.max(2, Math.round(MERGE.ghostRadius * width));
  const opened = morph(morph(raw, width, height, 1, false), width, height, 1, true);
  const grown = morph(opened, width, height, radius, true);
  return boxBlur(grown, width, height, Math.ceil(radius / 2));
}

const log2Ratio = (stopsA, stopsB) => (stopsA === null || stopsB === null ? null : stopsA - stopsB);

/**
 * Analyses three preview-size frames: alignment, crop, exposure ratios and ghost masks.
 * :param frames: [{ image, asShot? (RAW), stops (recorded exposure in stops or null) }]
 * :param options: { mode: 'radiance' | 'fusion', reference: index of the normal exposure,
 *   settings: { align, deghost, deghostStrength }, onProgress }
 * :returns: analysis (plain data, resolution-independent) or throws HdrError
 */
export function analyzeBracket(frames, { mode, reference, settings = DEFAULT_MERGE_SETTINGS, onProgress = () => {}, cancelled = () => false }) {
  const { width, height } = frames[reference].image;
  if (frames.some(({ image }) => image.width !== width || image.height !== height)) {
    throw new HdrError('size', 'The decoded photos have different sizes.');
  }
  const ref = frames[reference];
  const balance = frames.map((frame) => (mode === 'radiance' ? whiteBalanceToReference(frame.asShot, ref.asShot) : undefined));
  const planes = frames.map((frame, index) => framePlanes(frame.image, balance[index]));
  const warnings = [];

  onProgress({ stage: 'aligning', fraction: 0 });
  const alignments = planes.map((plane, index) => {
    if (index === reference || !settings.align) return { transform: IDENTITY, before: null, after: null, status: index === reference ? 'reference' : 'off' };
    if (cancelled()) throw new HdrError('cancelled', 'Cancelled.');
    const measured = estimateTransform({ plane: planes[reference].luma, width, height }, { plane: plane.luma, width, height });
    const status = alignmentStatus(measured, width);
    onProgress({ stage: 'aligning', fraction: (index + 1) / frames.length });
    return { ...measured, status };
  });
  if (alignments.some(({ status }) => status === 'unrelated')) {
    throw new HdrError('unrelated', 'These photos do not appear to show the same scene: even the best alignment leaves most edges mismatched. Choose three exposures of one scene.');
  }
  const failed = alignments.filter(({ status }) => status === 'failed');
  if (failed.length) warnings.push('Automatic alignment failed for at least one photo (large movement, rotation or perspective change). It was merged without alignment; expect doubled edges.');
  else if (alignments.some(({ status }) => status === 'uncertain')) warnings.push('Alignment is uncertain for at least one photo; check edges at 100%.');
  if (alignments.some(({ status }) => status === 'flat')) warnings.push('The photos have too little detail to align automatically; they were merged as shot.');
  const transforms = alignments.map(({ transform, status }) => (status === 'failed' ? IDENTITY : transform));
  const crop = commonCrop(transforms, width, height);
  if (!crop || crop.width < 0.7 || crop.height < 0.7) {
    throw new HdrError('alignment', 'The photos moved too much between exposures: aligning them would crop away more than 30% of the frame.');
  }

  // Analysis size: planes shrunk, then aligned there (the transform scales with the width).
  const small = shrink(planes.flatMap(({ luma, saturation }) => [luma, saturation]), width, height, MERGE.analysisEdge);
  const analysisFrames = frames.map((_, index) => {
    const t = transformAt(normalizeTransform(transforms[index], width), small.width);
    return { luma: warpPlane(small.planes[index * 2], small.width, small.height, t), saturation: warpPlane(small.planes[index * 2 + 1], small.width, small.height, t) };
  });

  // Exposure relative to the reference: measured on mutually well-exposed pixels (RAW
  // values are linear), checked against what the files record.
  let exposures = frames.map(() => 1);
  const measured = frames.map(() => null);
  if (mode === 'radiance') {
    const r = analysisFrames[reference];
    exposures = analysisFrames.map((frame, index) => {
      if (index === reference) return 1;
      const ratios = [];
      for (let i = 0; i < r.luma.length; i += 1) {
        const a = r.saturation[i];
        const b = frame.saturation[i];
        if (a > MERGE.ratioLow && a < MERGE.ratioHigh && b > MERGE.ratioLow && b < MERGE.ratioHigh && r.luma[i] > 0) ratios.push(frame.luma[i] / r.luma[i]);
      }
      const recorded = log2Ratio(frames[index].stops, ref.stops);
      const value = ratios.length >= MERGE.minRatioSamples ? median(ratios) : null;
      measured[index] = value === null ? null : Math.log2(value);
      if (value === null && recorded === null) {
        throw new HdrError('exposure', 'The exposure difference could not be measured (too few well-exposed tones in common) and the files do not record it.');
      }
      if (value !== null && recorded !== null && Math.abs(Math.log2(value) - recorded) > MERGE.metadataTolerance) {
        warnings.push(`The recorded exposure difference (${recorded.toFixed(2)} EV) does not match the images (${Math.log2(value).toFixed(2)} EV); the measured value is used.`);
      }
      return value ?? 2 ** recorded;
    });
    const spread = Math.max(...exposures.map((e) => Math.abs(Math.log2(e))));
    if (spread < MERGE.sameExposure) {
      throw new HdrError('same-exposure', 'The three photos contain the same exposure (the measured brightness differs by less than 0.1 EV), so merging adds no highlight or shadow detail. This happens with Sony DRO bracketing, which saves one exposure several times.');
    }
    exposures.forEach((e, index) => {
      if (index === reference) return;
      const role = frames[index].role;
      if ((role === 'under' && e >= 1) || (role === 'over' && e <= 1)) {
        throw new HdrError('roles', `The photo marked ${role === 'under' ? 'underexposed' : 'overexposed'} is ${e >= 1 ? 'brighter' : 'darker'} than the normal exposure. Check the exposure roles.`);
      }
    });
  }

  onProgress({ stage: 'deghosting', fraction: 0 });
  const masks = frames.map((_, index) => (index === reference || !settings.deghost ? null
    : ghostMask(analysisFrames[reference], analysisFrames[index], small.width, small.height, { mode, ratio: exposures[index], strength: settings.deghostStrength })));
  let ghosted = 0;
  for (let i = 0; i < small.width * small.height; i += 1) if (masks.some((mask) => mask && mask[i] > 0.5)) ghosted += 1;

  return {
    mode,
    reference,
    width,
    height,
    exposures,
    measuredStops: measured,
    white: mode === 'radiance' ? 1 / Math.min(...exposures) : 1,
    transforms: transforms.map((t) => normalizeTransform(t, width)),
    alignment: alignments.map(({ status, before, after }) => ({ status, before, after })),
    crop,
    ghost: { width: small.width, height: small.height, masks, fraction: ghosted / (small.width * small.height) },
    warnings,
  };
}

/** Output and per-frame geometry of a merge at one frame size. */
export function mergeGeometry(analysis, frameWidth, frameHeight) {
  const crop = cropAt(analysis.crop, frameWidth, frameHeight);
  return { crop, transforms: analysis.transforms.map((t) => transformAt(t, frameWidth)) };
}

/** Ghost mask value for reference pixel (x, y) of a frame of this size. */
const maskAt = (ghost, mask, x, y, frameWidth, frameHeight) => sample(mask, ghost.width, ghost.height, ((x + 0.5) / frameWidth) * ghost.width - 0.5, ((y + 0.5) / frameHeight) * ghost.height - 0.5);

/**
 * Streaming radiance merge at one size.
 * :param analysis: analyzeBracket() result
 * :param frames: [{ asShot }] colour info per frame, in input order
 * :param size: { width, height } of each decoded frame (all equal)
 * :returns: { width, height, add(index, image), finish() -> { kind: 'hdr', width, height, data } }
 */
export function createRadianceMerge(analysis, frames, size) {
  const { crop, transforms } = mergeGeometry(analysis, size.width, size.height);
  const n = crop.width * crop.height;
  const sum = new Float32Array(n * 3);
  const weights = new Float32Array(n);
  const ref = frames[analysis.reference];
  const darkest = analysis.exposures.indexOf(Math.min(...analysis.exposures));
  const added = new Set();
  return {
    width: crop.width,
    height: crop.height,
    add(index, image) {
      if (image.width !== size.width || image.height !== size.height) throw new HdrError('size', 'A decoded photo has an unexpected size.');
      const { scale, clip } = whiteBalanceToReference(frames[index].asShot, ref.asShot);
      const k = scale.map((s) => s / 65535);
      const ic = clip.map((c) => 1 / c);
      const exposure = analysis.exposures[index];
      const inverse = 1 / exposure;
      const { cos, sin } = { cos: Math.cos((transforms[index].angle * Math.PI) / 180), sin: Math.sin((transforms[index].angle * Math.PI) / 180) };
      const { tx, ty } = transforms[index];
      const identity = tx === 0 && ty === 0 && transforms[index].angle === 0;
      const mask = analysis.ghost.masks[index];
      const cx = (size.width - 1) / 2;
      const cy = (size.height - 1) / 2;
      const { data } = image;
      const w = size.width;
      const h = size.height;
      const rgb = [0, 0, 0];
      for (let oy = 0; oy < crop.height; oy += 1) {
        const y = oy + crop.y;
        for (let ox = 0; ox < crop.width; ox += 1) {
          const x = ox + crop.x;
          if (identity) {
            const j = (y * w + x) * 3;
            rgb[0] = data[j]; rgb[1] = data[j + 1]; rgb[2] = data[j + 2];
          } else {
            const qx = Math.min(w - 1, Math.max(0, cos * (x - cx) - sin * (y - cy) + cx + tx));
            const qy = Math.min(h - 1, Math.max(0, sin * (x - cx) + cos * (y - cy) + cy + ty));
            const x0 = Math.floor(qx);
            const y0 = Math.floor(qy);
            const x1 = Math.min(w - 1, x0 + 1);
            const y1 = Math.min(h - 1, y0 + 1);
            const ax = qx - x0;
            const ay = qy - y0;
            const a = (y0 * w + x0) * 3;
            const b = (y0 * w + x1) * 3;
            const c = (y1 * w + x0) * 3;
            const d = (y1 * w + x1) * 3;
            for (let ch = 0; ch < 3; ch += 1) {
              rgb[ch] = (data[a + ch] * (1 - ax) + data[b + ch] * ax) * (1 - ay) + (data[c + ch] * (1 - ax) + data[d + ch] * ax) * ay;
            }
          }
          const r = rgb[0] * k[0];
          const g = rgb[1] * k[1];
          const bl = rgb[2] * k[2];
          const saturation = Math.max(r * ic[0], g * ic[1], bl * ic[2]);
          let weight = exposure * (1 - smoothstep(MERGE.saturationLow, MERGE.saturationHigh, saturation));
          if (mask) weight *= 1 - maskAt(analysis.ghost, mask, x, y, w, h);
          // The darkest frame always counts a little, so fully clipped areas keep its values.
          if (index === darkest) weight = Math.max(weight, exposure * 1e-4);
          if (weight <= 0) continue;
          const o = oy * crop.width + ox;
          sum[o * 3] += weight * r * inverse;
          sum[o * 3 + 1] += weight * g * inverse;
          sum[o * 3 + 2] += weight * bl * inverse;
          weights[o] += weight;
        }
      }
      added.add(index);
    },
    finish() {
      if (added.size !== frames.length) throw new HdrError('incomplete', 'Not every exposure was added to the merge.');
      for (let o = 0; o < n; o += 1) {
        const inverse = weights[o] > 0 ? 1 / weights[o] : 0;
        sum[o * 3] *= inverse; sum[o * 3 + 1] *= inverse; sum[o * 3 + 2] *= inverse;
      }
      return { kind: 'hdr', width: crop.width, height: crop.height, data: sum };
    },
  };
}

// --- Exposure fusion -----------------------------------------------------------------

const KERNEL = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];

function blurDown(src, w, h) {
  const nw = Math.ceil(w / 2);
  const nh = Math.ceil(h / 2);
  const tmp = new Float32Array(nw * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < nw; x += 1) {
      let v = 0;
      for (let k = -2; k <= 2; k += 1) v += KERNEL[k + 2] * src[y * w + Math.min(w - 1, Math.max(0, x * 2 + k))];
      tmp[y * nw + x] = v;
    }
  }
  const out = new Float32Array(nw * nh);
  for (let y = 0; y < nh; y += 1) {
    for (let x = 0; x < nw; x += 1) {
      let v = 0;
      for (let k = -2; k <= 2; k += 1) v += KERNEL[k + 2] * tmp[Math.min(h - 1, Math.max(0, y * 2 + k)) * nw + x];
      out[y * nw + x] = v;
    }
  }
  return out;
}

// Upsampling by linear interpolation at the pixel centres of the coarser level.
function expand(src, w, h, tw, th) {
  const out = new Float32Array(tw * th);
  for (let y = 0; y < th; y += 1) {
    const sy = Math.min(h - 1, Math.max(0, (y - 0.5) / 2));
    const y0 = Math.floor(sy);
    const y1 = Math.min(h - 1, y0 + 1);
    const ay = sy - y0;
    for (let x = 0; x < tw; x += 1) {
      const sx = Math.min(w - 1, Math.max(0, (x - 0.5) / 2));
      const x0 = Math.floor(sx);
      const x1 = Math.min(w - 1, x0 + 1);
      const ax = sx - x0;
      out[y * tw + x] = (src[y0 * w + x0] * (1 - ax) + src[y0 * w + x1] * ax) * (1 - ay) + (src[y1 * w + x0] * (1 - ax) + src[y1 * w + x1] * ax) * ay;
    }
  }
  return out;
}

/** Pyramid depth for a size: the coarsest level is about 8–16 px, so blending scales with the image. */
export const fusionLevels = (width, height) => Math.max(1, Math.floor(Math.log2(Math.min(width, height) / 8)));

/** Mertens weight of one RGBA8 frame: contrast × saturation × well-exposedness. */
function fusionWeight(frame, width, height) {
  const n = width * height;
  const grey = new Float32Array(n);
  const weight = new Float32Array(n);
  const { data } = frame;
  for (let i = 0; i < n; i += 1) grey[i] = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 765;
  const sigma2 = 2 * 0.2 * 0.2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const at = (dx, dy) => grey[Math.min(height - 1, Math.max(0, y + dy)) * width + Math.min(width - 1, Math.max(0, x + dx))];
      const contrast = Math.abs(at(-1, 0) + at(1, 0) + at(0, -1) + at(0, 1) - 4 * grey[i]);
      const r = data[i * 4] / 255;
      const g = data[i * 4 + 1] / 255;
      const b = data[i * 4 + 2] / 255;
      const mean = (r + g + b) / 3;
      const saturation = Math.sqrt(((r - mean) ** 2 + (g - mean) ** 2 + (b - mean) ** 2) / 3);
      const exposedness = Math.exp(-((r - 0.5) ** 2) / sigma2) * Math.exp(-((g - 0.5) ** 2) / sigma2) * Math.exp(-((b - 0.5) ** 2) / sigma2);
      weight[i] = (contrast + 1e-3) * (saturation + 1e-3) * exposedness + 1e-12;
    }
  }
  return weight;
}

/** One RGBA8 frame warped and cropped to the merge geometry (bilinear, opaque). */
function warpRgba(image, transform, crop) {
  const { width: w, height: h, data } = image;
  const out = new Uint8ClampedArray(crop.width * crop.height * 4);
  const cos = Math.cos((transform.angle * Math.PI) / 180);
  const sin = Math.sin((transform.angle * Math.PI) / 180);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const identity = transform.tx === 0 && transform.ty === 0 && transform.angle === 0;
  for (let oy = 0; oy < crop.height; oy += 1) {
    const y = oy + crop.y;
    for (let ox = 0; ox < crop.width; ox += 1) {
      const x = ox + crop.x;
      const o = (oy * crop.width + ox) * 4;
      if (identity) {
        const j = (y * w + x) * 4;
        out[o] = data[j]; out[o + 1] = data[j + 1]; out[o + 2] = data[j + 2];
      } else {
        const qx = Math.min(w - 1, Math.max(0, cos * (x - cx) - sin * (y - cy) + cx + transform.tx));
        const qy = Math.min(h - 1, Math.max(0, sin * (x - cx) + cos * (y - cy) + cy + transform.ty));
        const x0 = Math.floor(qx);
        const y0 = Math.floor(qy);
        const x1 = Math.min(w - 1, x0 + 1);
        const y1 = Math.min(h - 1, y0 + 1);
        const ax = qx - x0;
        const ay = qy - y0;
        for (let c = 0; c < 3; c += 1) {
          out[o + c] = (data[(y0 * w + x0) * 4 + c] * (1 - ax) + data[(y0 * w + x1) * 4 + c] * ax) * (1 - ay)
            + (data[(y1 * w + x0) * 4 + c] * (1 - ax) + data[(y1 * w + x1) * 4 + c] * ax) * ay;
        }
      }
      out[o + 3] = 255;
    }
  }
  return out;
}

/**
 * Streaming exposure fusion at one size: frames are warped and cropped as they arrive
 * (the decoded originals can then be released), and fused in `finish`.
 * :returns: { width, height, add(index, image), finish() -> { width, height, data: RGBA8 } }
 */
export function createFusionMerge(analysis, size) {
  const { crop, transforms } = mergeGeometry(analysis, size.width, size.height);
  const warped = [];
  return {
    width: crop.width,
    height: crop.height,
    add(index, image) {
      if (image.width !== size.width || image.height !== size.height) throw new HdrError('size', 'A decoded photo has an unexpected size.');
      warped[index] = warpRgba(image, transforms[index], crop);
    },
    finish() {
      if (warped.filter(Boolean).length !== analysis.exposures.length) throw new HdrError('incomplete', 'Not every exposure was added to the merge.');
      return fuse(warped, crop, analysis, size);
    },
  };
}

function fuse(frames, crop, analysis, size) {
  const { width, height } = crop;
  const n = width * height;
  const weights = frames.map((frame) => fusionWeight({ data: frame }, width, height));
  frames.forEach((_, index) => {
    const mask = analysis.ghost.masks[index];
    if (!mask) return;
    const weight = weights[index];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) weight[y * width + x] *= 1 - maskAt(analysis.ghost, mask, x + crop.x, y + crop.y, size.width, size.height);
    }
  });
  const total = new Float32Array(n);
  weights.forEach((weight) => { for (let i = 0; i < n; i += 1) total[i] += weight[i]; });
  weights.forEach((weight) => { for (let i = 0; i < n; i += 1) weight[i] /= total[i]; });

  const levels = fusionLevels(width, height);
  const sizes = [{ w: width, h: height }];
  for (let l = 1; l <= levels; l += 1) sizes.push({ w: Math.ceil(sizes[l - 1].w / 2), h: Math.ceil(sizes[l - 1].h / 2) });
  const out = new Uint8ClampedArray(n * 4);
  // Weight pyramids are shared by the three channels.
  const weightPyramids = weights.map((weight) => {
    const pyramid = [weight];
    for (let l = 1; l <= levels; l += 1) pyramid.push(blurDown(pyramid[l - 1], sizes[l - 1].w, sizes[l - 1].h));
    return pyramid;
  });
  for (let c = 0; c < 3; c += 1) {
    const result = sizes.map(({ w, h }) => new Float32Array(w * h));
    frames.forEach((frame, index) => {
      let current = new Float32Array(n);
      for (let i = 0; i < n; i += 1) current[i] = frame[i * 4 + c] / 255;
      for (let l = 0; l <= levels; l += 1) {
        const { w, h } = sizes[l];
        const weight = weightPyramids[index][l];
        const target = result[l];
        if (l === levels) {
          for (let i = 0; i < w * h; i += 1) target[i] += weight[i] * current[i];
          break;
        }
        const next = blurDown(current, w, h);
        const up = expand(next, sizes[l + 1].w, sizes[l + 1].h, w, h);
        for (let i = 0; i < w * h; i += 1) target[i] += weight[i] * (current[i] - up[i]);
        current = next;
      }
    });
    let image = result[levels];
    for (let l = levels - 1; l >= 0; l -= 1) {
      const up = expand(image, sizes[l + 1].w, sizes[l + 1].h, sizes[l].w, sizes[l].h);
      for (let i = 0; i < up.length; i += 1) up[i] += result[l][i];
      image = up;
    }
    for (let i = 0; i < n; i += 1) out[i * 4 + c] = Math.round(Math.min(1, Math.max(0, image[i])) * 255);
  }
  for (let i = 0; i < n; i += 1) out[i * 4 + 3] = 255;
  return { width, height, data: out };
}

/** Median brightness of a frame (linear luminance), for role suggestions without metadata. */
export function medianBrightness(image) {
  const n = image.width * image.height;
  const step = Math.max(1, Math.floor(n / 20000));
  const values = [];
  for (let i = 0; i < n; i += step) {
    if (image.kind === 'raw') values.push((image.data[i * 3] + 2 * image.data[i * 3 + 1] + image.data[i * 3 + 2]) / 4);
    else values.push(LUMA[0] * SRGB_TO_LINEAR_8BIT[image.data[i * 4]] + LUMA[1] * SRGB_TO_LINEAR_8BIT[image.data[i * 4 + 1]] + LUMA[2] * SRGB_TO_LINEAR_8BIT[image.data[i * 4 + 2]]);
  }
  return median(values);
}

export { ALIGN };
