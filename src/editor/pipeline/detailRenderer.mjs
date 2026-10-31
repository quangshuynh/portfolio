// CPU renderer for photos with Detail settings or positional creative effects (glow,
// vignette, grain): the one engine for both the Detail preview and the full-resolution
// export, so the two cannot disagree. It runs the base stage per pixel, the detail stage
// (detail.mjs) per tile with a halo, then the display stages, the creative stage with the
// pixel's position (creative.mjs) and 8-bit quantisation. Other photos never come here, so
// their output stays bit for bit what cpuRenderer.mjs produced before.
//
// Memory: one tile of float planes (DETAIL_TILE × band rows plus the halo on each side,
// about 15 planes) is reused across tiles; nothing is allocated per full image except the
// caller's output. The guide grid is at most DETAIL.guideEdge px.
//
// Two creative effects change where a pixel's colour comes from (digital.mjs): channel shift
// samples red and blue at displaced positions of the tile's base planes (the halo grows by the
// largest displacement), and a capture renders the whole photo once at the capture grid's size
// (from the guide source, with everything before the capture), JPEG-compresses that map, and
// then every output pixel is resampled from it; only grain is added at full resolution.

import { SRGB_TO_LINEAR_8BIT } from './colorMath.mjs';
import { developRaw, processDisplay, processLinear } from './spec.mjs';
import { encodeSrgb8, fastTransfer, prepareRender, renderImage } from './cpuRenderer.mjs';
import { DETAIL, applyDetail, computeGuide, detailHalo } from './detail.mjs';
import { applyCreative, applyGrain, computeGlow, glowKey } from './creative.mjs';
import { captureSize, jpegCompress, sampleCapture, shiftHalo, shiftPositions } from './digital.mjs';
import { groupKeys, normalizeAdjustments } from '../model/adjustments.mjs';

export const DETAIL_TILE = 512;
export const DETAIL_BAND_ROWS = 256;

const channelsOf = (image) => (image.kind === 'raw' || image.kind === 'hdr' ? 3 : 4);

/**
 * Area-averaging accumulator for any image kind (RGBA8, RAW Uint16 RGB, HDR float RGB):
 * rows can be added in bands, so a canvas never has to be read whole. RGBA colours are
 * averaged weighted by alpha, so colours under transparent pixels never count.
 */
export function createAreaAccumulator(kind, width, height, targetWidth, targetHeight) {
  const channels = kind === 'raw' || kind === 'hdr' ? 3 : 4;
  const sums = new Float64Array(targetWidth * targetHeight * channels);
  const counts = new Float64Array(targetWidth * targetHeight);
  const columnOf = new Uint32Array(width);
  for (let x = 0; x < width; x += 1) columnOf[x] = Math.min(targetWidth - 1, Math.floor((x * targetWidth) / width));
  return {
    /** :param data: rows [row, row + rows) of the full-width image */
    add(data, row, rows) {
      for (let y = 0; y < rows; y += 1) {
        const ty = Math.min(targetHeight - 1, Math.floor(((row + y) * targetHeight) / height));
        for (let x = 0; x < width; x += 1) {
          const t = ty * targetWidth + columnOf[x];
          const i = (y * width + x) * channels;
          if (channels === 4) {
            const alpha = data[i + 3];
            sums[t * 4] += data[i] * alpha; sums[t * 4 + 1] += data[i + 1] * alpha; sums[t * 4 + 2] += data[i + 2] * alpha;
            sums[t * 4 + 3] += alpha;
          } else {
            for (let c = 0; c < channels; c += 1) sums[t * channels + c] += data[i + c];
          }
          counts[t] += 1;
        }
      }
    },
    finish() {
      const Type = kind === 'raw' ? Uint16Array : kind === 'hdr' ? Float32Array : Uint8ClampedArray;
      const out = new Type(targetWidth * targetHeight * channels);
      const round = Type !== Float32Array;
      for (let t = 0; t < counts.length; t += 1) {
        for (let c = 0; c < channels; c += 1) {
          let value = counts[t] ? sums[t * channels + c] / counts[t] : 0;
          if (channels === 4 && c < 3) value = sums[t * 4 + 3] ? sums[t * 4 + c] / sums[t * 4 + 3] : 0;
          out[t * channels + c] = round ? Math.round(value) : value;
        }
      }
      return { ...(kind === 'raw' || kind === 'hdr' ? { kind } : {}), width: targetWidth, height: targetHeight, data: out };
    },
  };
}

/** Size of the guide for an image: its long edge capped at DETAIL.guideEdge. */
export function guideSize({ width, height }) {
  const scale = Math.min(1, DETAIL.guideEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The guide source of a whole in-memory image. */
export function guideSource(image) {
  const size = guideSize(image);
  const transparent = channelsOf(image) === 4 && rowsHaveAlpha(image, 0, image.height);
  if (size.width === image.width && size.height === image.height && !transparent) return image;
  const accumulator = createAreaAccumulator(image.kind, image.width, image.height, size.width, size.height);
  accumulator.add(image.data, 0, image.height);
  return accumulator.finish();
}

/**
 * Writes the base stage (encoded, 0–1 nominal) of a rectangle into float planes.
 * :param image: { kind, width, data, y0, x0 } where `data` starts at image row `y0` and
 *   column `x0` (default 0), `width` columns per row
 */
function fillBase(image, prepared, x0, y0, w, h, planes) {
  const { params: p, tone, profile } = prepared;
  const channels = channelsOf(image);
  const firstRow = image.y0 ?? 0;
  const firstColumn = image.x0 ?? 0;
  const rgb = [0, 0, 0];
  const raw = image.kind === 'raw' || image.kind === 'hdr';
  const scale = image.data instanceof Float32Array ? 1 : 1 / 65535;
  const { r, g, b, alpha } = planes;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = ((y0 + y - firstRow) * image.width + x0 - firstColumn + x) * channels;
      const o = y * w + x;
      const s = image.data;
      if (raw) {
        developRaw(s[i] * scale, s[i + 1] * scale, s[i + 2] * scale, p.raw, rgb);
        processLinear(rgb, p, tone, profile);
        r[o] = fastTransfer.toSrgb(rgb[0]); g[o] = fastTransfer.toSrgb(rgb[1]); b[o] = fastTransfer.toSrgb(rgb[2]);
      } else {
        if (p.baseNeutral) {
          r[o] = s[i] / 255; g[o] = s[i + 1] / 255; b[o] = s[i + 2] / 255;
        } else {
          rgb[0] = SRGB_TO_LINEAR_8BIT[s[i]]; rgb[1] = SRGB_TO_LINEAR_8BIT[s[i + 1]]; rgb[2] = SRGB_TO_LINEAR_8BIT[s[i + 2]];
          processLinear(rgb, p, tone, profile);
          r[o] = fastTransfer.toSrgb(rgb[0]); g[o] = fastTransfer.toSrgb(rgb[1]); b[o] = fastTransfer.toSrgb(rgb[2]);
        }
        if (alpha) alpha[o] = s[i + 3] / 255;
      }
    }
  }
}

/** Named scratch planes, grown on demand and reused across tiles. `bytes()` reports their size. */
const createPool = () => {
  const planes = new Map();
  const pool = (name, size, Type = Float32Array) => {
    let plane = planes.get(name);
    if (!plane || plane.length < size) {
      plane = new Type(size);
      planes.set(name, plane);
    }
    return plane;
  };
  pool.bytes = () => [...planes.values()].reduce((sum, plane) => sum + plane.byteLength, 0);
  return pool;
};

/** Guide for an image's settings, computed from its guide source (see guideSource). */
export function computeImageGuide(prepared, source) {
  const { detail } = prepared.params;
  if (!detail.dehaze && !detail.clarity) return null;
  const n = source.width * source.height;
  const planes = { r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n), alpha: null };
  fillBase({ ...source, y0: 0 }, prepared, 0, 0, source.width, source.height, planes);
  return computeGuide(planes, source.width, source.height, detail, fastTransfer);
}

/**
 * Bloom and halation map for an image's settings from its guide source (see guideSource):
 * the base and display stages of the small image, then creative.computeGlow. Null without glow.
 */
export function computeImageGlow(prepared, source) {
  const { params: p } = prepared;
  if (!p.creative.glowActive) return null;
  const n = source.width * source.height;
  const rgba = channelsOf(source) === 4;
  const planes = { r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n), alpha: rgba ? new Float32Array(n) : null };
  fillBase({ ...source, y0: 0 }, prepared, 0, 0, source.width, source.height, planes);
  const rgb = [0, 0, 0];
  for (let i = 0; i < n; i += 1) {
    rgb[0] = planes.r[i]; rgb[1] = planes.g[i]; rgb[2] = planes.b[i];
    processDisplay(rgb, p, fastTransfer);
    planes.r[i] = rgb[0]; planes.g[i] = rgb[1]; planes.b[i] = rgb[2];
  }
  return computeGlow(planes, source.width, source.height, p.creative, fastTransfer);
}

// What the glow map depends on: the base stage, the display stages (curves, HSL, LUT) and
// the glow radii and thresholds (not the amounts, applied when it is sampled).
const GLOW_KEYS = [...['light', 'color', 'raw', 'hdr', 'hsl'].flatMap(groupKeys), 'lutIntensity'];

/** A key that changes exactly when the glow map of the same image must be recomputed. */
export function glowDependencies(adjustments, params) {
  const values = normalizeAdjustments(adjustments);
  return JSON.stringify([GLOW_KEYS.map((name) => values[name]), values.raw, values.curves, values.lut?.sha256 ?? null, glowKey(params.creative)]);
}

/**
 * The capture map of an image's settings (null without a capture): the guide source
 * area-averaged to the capture grid, rendered with every stage before the capture (Detail at
 * the capture's scale, glow, colour, quantisation dithered per capture pixel, sensor noise
 * per capture pixel), then JPEG-compressed. RGBA8 { width, height, data }.
 * :param options: { nativeWidth, nativeHeight, guide, glow } as for prepareDetailRender
 */
export function computeImageCapture(params, source, { nativeWidth, nativeHeight, guide, glow }) {
  const prepared = params.tone && params.params ? params : prepareRender(params);
  const p = prepared.params;
  const { capture, noise } = p.creative;
  if (!capture) return null;
  const size = captureSize(source, capture);
  let small = source;
  if (size.width !== source.width || size.height !== source.height) {
    const accumulator = createAreaAccumulator(source.kind, source.width, source.height, size.width, size.height);
    accumulator.add(source.data, 0, source.height);
    small = accumulator.finish();
  }
  const cell = Math.max(nativeWidth, nativeHeight) / Math.max(size.width, size.height);
  const creative = { ...p.creative, capture: null, grain: null, noise: noise && { ...noise, cell } };
  const inner = { ...prepared, params: { ...p, creative } };
  const transparent = channelsOf(small) === 4 && rowsHaveAlpha(small, 0, small.height);
  const context = prepareDetailRender(inner, { width: size.width, height: size.height, nativeWidth, nativeHeight, guide, glow, transparent, captureGrid: true });
  const data = new Uint8ClampedArray(size.width * size.height * 4);
  renderDetailRows(small, context, 0, size.height, data);
  if (capture.quality) jpegCompress(data, size.width, size.height, capture.quality);
  return { width: size.width, height: size.height, data };
}

/**
 * Per-render state: settings, scale, halo, the guide, the glow map and the capture map.
 * :param params: deriveParams() result with an active detail stage, or prepareRender() result
 * :param options: { width, height } the render size; { nativeWidth, nativeHeight } the
 *   photo's full size; `guide` from computeImageGuide (or `guideImage` to compute it);
 *   `transparent`: whether any pixel of the image is not opaque. Blurs are weighted by
 *   alpha only then, decided for the whole image so the result never depends on tiling.
 *   `glow` from computeImageGlow and `capture` from computeImageCapture (or computed from
 *   `guideImage`); `captureGrid`: this render is a capture map (dither per pixel).
 */
export function prepareDetailRender(params, { width, height, nativeWidth = width, nativeHeight = height, guide, glow, capture, guideImage, transparent = false, captureGrid = false }) {
  const prepared = params.tone && params.params ? params : prepareRender(params);
  const { detail, creative } = prepared.params;
  const scale = Math.min(1, Math.max(width, height) / Math.max(nativeWidth, nativeHeight));
  const glowMap = glow !== undefined ? glow : guideImage ? computeImageGlow(prepared, guideImage) : null;
  if (creative.glowActive && !glowMap) throw new Error('Bloom, halation and soft focus need the glow map of the image.');
  const guideMap = guide !== undefined ? guide : computeImageGuide(prepared, guideImage);
  let captureMap = null;
  if (creative.capture) {
    captureMap = capture ?? (guideImage ? computeImageCapture(prepared, guideImage, { nativeWidth, nativeHeight, guide: guideMap, glow: glowMap }) : null);
    if (!captureMap) throw new Error('Low resolution and JPEG compression need the capture map of the image.');
  }
  return {
    prepared,
    detail,
    scale,
    width,
    height,
    // A capture resamples a finished map: no neighbours of the full-resolution image are read.
    halo: captureMap ? 0 : detailHalo(detail, scale) + shiftHalo(creative.shift, width, height),
    transparent,
    guide: guideMap,
    capture: captureMap,
    // The creative stage's view of the pixel being rendered (x, y set per pixel).
    at: { x: 0, y: 0, width, height, scale, glow: glowMap, captureGrid },
    pool: createPool(),
  };
}

/** Bilinear sample of one plane of a tile (`w` × `h` from image column `left`, row `top`), clamped to the image. */
function samplePlane(plane, x, y, left, top, w, h, width, height) {
  const cx = Math.min(width - 1, Math.max(0, x)) - left;
  const cy = Math.min(height - 1, Math.max(0, y)) - top;
  const x0 = Math.min(w - 1, Math.max(0, Math.floor(cx)));
  const y0 = Math.min(h - 1, Math.max(0, Math.floor(cy)));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = Math.min(1, Math.max(0, cx - x0));
  const ty = Math.min(1, Math.max(0, cy - y0));
  return (plane[y0 * w + x0] * (1 - tx) + plane[y0 * w + x1] * tx) * (1 - ty) + (plane[y1 * w + x0] * (1 - tx) + plane[y1 * w + x1] * tx) * ty;
}

const shifted = [0, 0, 0, 0];

/**
 * Renders rows [y0, y1) of an image with Detail settings into RGBA8 `target` (which
 * holds exactly those rows). The image data must cover rows [y0 − halo, y1 + halo]
 * clamped to the image (see `image.y0`), and the columns likewise.
 * :param options: { columns: [x0, x1] } renders only those columns (a 1:1 crop); `target`
 *   then holds x1 − x0 pixels per row and `image` may be a crop (see `image.x0`)
 */
export function renderDetailRows(image, context, y0, y1, target, { flattenAlpha = false, tileWidth = DETAIL_TILE, columns = null } = {}) {
  const { prepared, detail, scale, guide, halo, pool, width, height, transparent, at } = context;
  const p = prepared.params;
  const channels = channelsOf(image);
  const firstRow = image.y0 ?? 0;
  const firstColumn = image.x0 ?? 0;
  const rowsHeld = image.data.length / (image.width * channels);
  const [xStart, xEnd] = columns ?? [0, width];
  const outWidth = xEnd - xStart;
  const top = Math.max(0, y0 - halo);
  const bottom = Math.min(height, y1 + halo);
  const coveredLeft = Math.max(0, xStart - halo) >= firstColumn;
  const coveredRight = Math.min(width, xEnd + halo) <= firstColumn + image.width;
  if (!coveredLeft || !coveredRight || top < firstRow || bottom > firstRow + rowsHeld) throw new Error('The image rows do not cover the band and its halo.');
  const hasAlpha = channels === 4 && transparent;
  const rgb = [0, 0, 0];
  const alphaAt = (x, y) => (channels === 4 ? image.data[((y - firstRow) * image.width + x - firstColumn) * 4 + 3] : 255);
  const write = (t, alpha) => {
    target[t] = Math.round(rgb[0] * 255);
    target[t + 1] = Math.round(rgb[1] * 255);
    target[t + 2] = Math.round(rgb[2] * 255);
    if (flattenAlpha && alpha < 255) {
      const coverage = alpha / 255;
      for (let c = 0; c < 3; c += 1) target[t + c] = encodeSrgb8(SRGB_TO_LINEAR_8BIT[target[t + c]] * coverage + (1 - coverage));
      target[t + 3] = 255;
    } else {
      target[t + 3] = alpha;
    }
  };
  if (context.capture) {
    const { grain } = p.creative;
    const { hardness } = p.creative.capture;
    for (let y = y0; y < y1; y += 1) {
      for (let x = xStart; x < xEnd; x += 1) {
        sampleCapture(context.capture, x, y, width, height, hardness, rgb);
        if (grain) {
          at.x = x; at.y = y;
          applyGrain(rgb, grain, at);
        }
        write(((y - y0) * outWidth + x - xStart) * 4, alphaAt(x, y));
      }
    }
    return target;
  }
  const { shift } = p.creative;
  for (let x0 = xStart; x0 < xEnd; x0 += tileWidth) {
    const x1 = Math.min(xEnd, x0 + tileWidth);
    const left = Math.max(0, x0 - halo);
    const right = Math.min(width, x1 + halo);
    const w = right - left;
    const h = bottom - top;
    const n = w * h;
    const planes = { r: pool('R', n), g: pool('G', n), b: pool('B', n), alpha: hasAlpha ? pool('A', n) : null };
    fillBase(image, prepared, left, top, w, h, planes);
    if (detail.active) applyDetail({ ...planes, w, h, x: left, y: top }, { detail, scale, guide, imageWidth: width, imageHeight: height, transfer: fastTransfer, pool });
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const o = (y - top) * w + (x - left);
        const t = ((y - y0) * outWidth + x - xStart) * 4;
        if (shift) {
          shiftPositions(x, y, width, height, shift, shifted);
          rgb[0] = samplePlane(planes.r, shifted[0], shifted[1], left, top, w, h, width, height);
          rgb[1] = planes.g[o];
          rgb[2] = samplePlane(planes.b, shifted[2], shifted[3], left, top, w, h, width, height);
        } else {
          rgb[0] = planes.r[o]; rgb[1] = planes.g[o]; rgb[2] = planes.b[o];
        }
        if (p.postActive) processDisplay(rgb, p, fastTransfer);
        if (p.creativeActive) {
          at.x = x; at.y = y;
          applyCreative(rgb, p.creative, at, fastTransfer);
        }
        write(t, alphaAt(x, y));
      }
    }
  }
  return target;
}

/** True when any pixel in rows [startRow, endRow) of an RGBA image is not opaque. */
export function rowsHaveAlpha(image, startRow, endRow) {
  const { data, width } = image;
  for (let i = startRow * width * 4 + 3; i < endRow * width * 4; i += 4) if (data[i] !== 255) return true;
  return false;
}

/**
 * Renders a whole in-memory image with Detail settings, band by band.
 * :param options: { nativeWidth, nativeHeight, guide, glow, guideImage, target, flattenAlpha,
 *   bandRows, onBand(fraction), cancelled() }
 */
export function renderDetailImage(image, params, {
  nativeWidth = image.width,
  nativeHeight = image.height,
  guide,
  glow,
  capture,
  guideImage,
  target = new Uint8ClampedArray(image.width * image.height * 4),
  flattenAlpha = false,
  bandRows = DETAIL_BAND_ROWS,
  tileWidth,
  onBand,
  cancelled,
} = {}) {
  const needsCapture = Boolean((params.params ?? params).creative.capture) && capture === undefined;
  const context = prepareDetailRender(params, {
    width: image.width,
    height: image.height,
    nativeWidth,
    nativeHeight,
    transparent: channelsOf(image) === 4 && rowsHaveAlpha(image, 0, image.height),
    guide,
    glow,
    capture,
    guideImage: guide === undefined || glow === undefined || needsCapture ? (guideImage ?? guideSource(image)) : undefined,
  });
  for (let row = 0; row < image.height; row += bandRows) {
    if (cancelled?.()) throw Object.assign(new Error('Cancelled.'), { code: 'cancelled' });
    const last = Math.min(image.height, row + bandRows);
    renderDetailRows(image, context, row, last, target.subarray(row * image.width * 4, last * image.width * 4), { flattenAlpha, tileWidth });
    onBand?.(last / image.height);
  }
  return target;
}

/**
 * Renders a whole in-memory image of any kind with the renderer its settings need: this
 * one for Detail or positional creative effects, else the per-pixel renderer.
 * :param options: { nativeWidth, nativeHeight } the photo's output size at full resolution
 */
export function renderAnyImage(image, params, options = {}) {
  return params.spatialActive ? renderDetailImage(image, params, options) : renderImage(image, params);
}
