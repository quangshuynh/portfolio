// CPU renderer for photos with Detail settings: the one engine for both the Detail
// preview and the full-resolution export, so the two cannot disagree. It runs the base
// stage per pixel, the detail stage (detail.mjs) per tile with a halo, then the display
// stages and 8-bit quantisation. Photos without Detail settings never come here, so their
// output stays bit for bit what cpuRenderer.mjs produced before.
//
// Memory: one tile of float planes (DETAIL_TILE × band rows plus the halo on each side,
// about 15 planes) is reused across tiles; nothing is allocated per full image except the
// caller's output. The guide grid is at most DETAIL.guideEdge px.

import { SRGB_TO_LINEAR_8BIT } from './colorMath.mjs';
import { developRaw, processDisplay, processLinear } from './spec.mjs';
import { encodeSrgb8, fastTransfer, prepareRender } from './cpuRenderer.mjs';
import { DETAIL, applyDetail, computeGuide, detailHalo } from './detail.mjs';

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
 * :param image: { kind, width, data, y0 } where `data` starts at image row `y0` (default 0)
 */
function fillBase(image, prepared, x0, y0, w, h, planes) {
  const { params: p, tone } = prepared;
  const channels = channelsOf(image);
  const firstRow = image.y0 ?? 0;
  const rgb = [0, 0, 0];
  const raw = image.kind === 'raw' || image.kind === 'hdr';
  const scale = image.data instanceof Float32Array ? 1 : 1 / 65535;
  const { r, g, b, alpha } = planes;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = ((y0 + y - firstRow) * image.width + x0 + x) * channels;
      const o = y * w + x;
      const s = image.data;
      if (raw) {
        developRaw(s[i] * scale, s[i + 1] * scale, s[i + 2] * scale, p.raw, rgb);
        processLinear(rgb, p, tone);
        r[o] = fastTransfer.toSrgb(rgb[0]); g[o] = fastTransfer.toSrgb(rgb[1]); b[o] = fastTransfer.toSrgb(rgb[2]);
      } else {
        if (p.baseNeutral) {
          r[o] = s[i] / 255; g[o] = s[i + 1] / 255; b[o] = s[i + 2] / 255;
        } else {
          rgb[0] = SRGB_TO_LINEAR_8BIT[s[i]]; rgb[1] = SRGB_TO_LINEAR_8BIT[s[i + 1]]; rgb[2] = SRGB_TO_LINEAR_8BIT[s[i + 2]];
          processLinear(rgb, p, tone);
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
 * Per-render state: settings, scale, halo and the guide.
 * :param params: deriveParams() result with an active detail stage, or prepareRender() result
 * :param options: { width, height } the render size; { nativeWidth, nativeHeight } the
 *   photo's full size; `guide` from computeImageGuide (or `guideImage` to compute it)
 */
export function prepareDetailRender(params, { width, height, nativeWidth = width, nativeHeight = height, guide, guideImage }) {
  const prepared = params.tone && params.params ? params : prepareRender(params);
  const { detail } = prepared.params;
  const scale = Math.min(1, Math.max(width, height) / Math.max(nativeWidth, nativeHeight));
  return {
    prepared,
    detail,
    scale,
    width,
    height,
    halo: detailHalo(detail, scale),
    guide: guide !== undefined ? guide : computeImageGuide(prepared, guideImage),
    pool: createPool(),
  };
}

/**
 * Renders rows [y0, y1) of an image with Detail settings into RGBA8 `target` (which
 * holds exactly those rows). The image data must cover rows [y0 − halo, y1 + halo]
 * clamped to the image (see `image.y0`).
 */
export function renderDetailRows(image, context, y0, y1, target, { flattenAlpha = false, tileWidth = DETAIL_TILE } = {}) {
  const { prepared, detail, scale, guide, halo, pool, width, height } = context;
  const p = prepared.params;
  const channels = channelsOf(image);
  const firstRow = image.y0 ?? 0;
  const rowsHeld = image.data.length / (image.width * channels);
  const top = Math.max(0, y0 - halo);
  const bottom = Math.min(height, y1 + halo);
  if (image.width !== width || top < firstRow || bottom > firstRow + rowsHeld) throw new Error('The image rows do not cover the band and its halo.');
  const hasAlpha = channels === 4 && rowsHaveAlpha(image, top - firstRow, bottom - firstRow);
  const rgb = [0, 0, 0];
  for (let x0 = 0; x0 < width; x0 += tileWidth) {
    const x1 = Math.min(width, x0 + tileWidth);
    const left = Math.max(0, x0 - halo);
    const right = Math.min(width, x1 + halo);
    const w = right - left;
    const h = bottom - top;
    const n = w * h;
    const planes = { r: pool('R', n), g: pool('G', n), b: pool('B', n), alpha: hasAlpha ? pool('A', n) : null };
    fillBase(image, prepared, left, top, w, h, planes);
    applyDetail({ ...planes, w, h, x: left, y: top }, { detail, scale, guide, imageWidth: width, imageHeight: height, transfer: fastTransfer, pool });
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const o = (y - top) * w + (x - left);
        const t = ((y - y0) * width + x) * 4;
        rgb[0] = planes.r[o]; rgb[1] = planes.g[o]; rgb[2] = planes.b[o];
        if (p.postActive) processDisplay(rgb, p, fastTransfer);
        target[t] = Math.round(rgb[0] * 255);
        target[t + 1] = Math.round(rgb[1] * 255);
        target[t + 2] = Math.round(rgb[2] * 255);
        const alpha = channels === 4 ? image.data[((y - firstRow) * width + x) * 4 + 3] : 255;
        if (flattenAlpha && alpha < 255) {
          const coverage = alpha / 255;
          for (let c = 0; c < 3; c += 1) target[t + c] = encodeSrgb8(SRGB_TO_LINEAR_8BIT[target[t + c]] * coverage + (1 - coverage));
          target[t + 3] = 255;
        } else {
          target[t + 3] = alpha;
        }
      }
    }
  }
  return target;
}

function rowsHaveAlpha(image, startRow, endRow) {
  const { data, width } = image;
  for (let i = startRow * width * 4 + 3; i < endRow * width * 4; i += 4) if (data[i] !== 255) return true;
  return false;
}

/**
 * Renders a whole in-memory image with Detail settings, band by band.
 * :param options: { nativeWidth, nativeHeight, guide, guideImage, target, flattenAlpha,
 *   bandRows, onBand(fraction), cancelled() }
 */
export function renderDetailImage(image, params, {
  nativeWidth = image.width,
  nativeHeight = image.height,
  guide,
  guideImage,
  target = new Uint8ClampedArray(image.width * image.height * 4),
  flattenAlpha = false,
  bandRows = DETAIL_BAND_ROWS,
  tileWidth,
  onBand,
  cancelled,
} = {}) {
  const context = prepareDetailRender(params, {
    width: image.width,
    height: image.height,
    nativeWidth,
    nativeHeight,
    guide,
    guideImage: guide === undefined ? (guideImage ?? guideSource(image)) : undefined,
  });
  for (let row = 0; row < image.height; row += bandRows) {
    if (cancelled?.()) throw Object.assign(new Error('Cancelled.'), { code: 'cancelled' });
    const last = Math.min(image.height, row + bandRows);
    renderDetailRows(image, context, row, last, target.subarray(row * image.width * 4, last * image.width * 4), { flattenAlpha, tileWidth });
    onBand?.(last / image.height);
  }
  return target;
}
