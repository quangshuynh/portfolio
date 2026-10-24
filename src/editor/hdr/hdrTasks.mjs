// HDR tasks, run in a dedicated worker (hdrWorker.mjs) per job: analyse and merge the
// preview-size frames, or, for an export, merge full-size frames that arrive one at a
// time and stream 8-bit bands back to the page. The worker is terminated afterwards
// (or to cancel), so its buffers never outlive the job. No network access.

import { prepareRender, renderRawRgba8, renderRgba8 } from '../pipeline/cpuRenderer.mjs';
import { guideSource, prepareDetailRender, renderDetailRows, rowsHaveAlpha } from '../pipeline/detailRenderer.mjs';
import { deriveParams } from '../pipeline/spec.mjs';
import { proxyDimensions } from '../io/files.mjs';
import { finishRows, warpImage } from '../pipeline/warp.mjs';
import { HdrError, analyzeBracket, createFusionMerge, createRadianceMerge } from './hdrMerge.mjs';

export const HDR_BAND_ROWS = 256;

/** Area-averaging downscale of an RGB float ('hdr') or RGBA8 image (never upscales). */
export function downscale(image, width, height) {
  if (width >= image.width && height >= image.height) return image;
  const channels = image.kind === 'hdr' ? 3 : 4;
  const { width: sw, height: sh, data: src } = image;
  const out = image.kind === 'hdr' ? new Float32Array(width * height * 3) : new Uint8ClampedArray(width * height * 4);
  const sums = new Float64Array(width * channels);
  const counts = new Float64Array(width);
  let sy = 0;
  for (let y = 0; y < height; y += 1) {
    const end = Math.max(sy + 1, Math.min(sh, Math.round(((y + 1) * sh) / height)));
    sums.fill(0);
    counts.fill(0);
    for (; sy < end; sy += 1) {
      for (let x = 0; x < sw; x += 1) {
        const tx = Math.min(width - 1, Math.floor((x * width) / sw));
        const i = (sy * sw + x) * channels;
        for (let c = 0; c < channels; c += 1) sums[tx * channels + c] += src[i + c];
        counts[tx] += 1;
      }
    }
    for (let x = 0; x < width; x += 1) {
      for (let c = 0; c < channels; c += 1) out[(y * width + x) * channels + c] = sums[x * channels + c] / counts[x];
    }
  }
  return image.kind === 'hdr' ? { kind: 'hdr', width, height, data: out } : { width, height, data: out };
}

const transfers = (analysis) => analysis.ghost.masks.filter(Boolean).map((mask) => mask.buffer);

let session = null;

export const handlers = {
  /**
   * Analyses and merges preview-size frames.
   * :param payload: { mode, reference, settings, frames: [{ image, asShot, stops, role }], thumbnailEdge }
   * :returns: { analysis, image (preview), thumbnail }
   */
  async merge({ mode, reference, settings, frames, thumbnailEdge = 320 }, progress) {
    const started = performance.now();
    const analysis = analyzeBracket(frames, { mode, reference, settings, onProgress: progress });
    const analysedAt = performance.now();
    progress({ stage: 'merging', fraction: 0 });
    const size = { width: frames[0].image.width, height: frames[0].image.height };
    const merge = mode === 'radiance' ? createRadianceMerge(analysis, frames, size) : createFusionMerge(analysis, size);
    frames.forEach((frame, index) => {
      merge.add(index, frame.image);
      frame.image = null;
    });
    const image = merge.finish();
    const thumbSize = proxyDimensions(image, thumbnailEdge);
    const scaled = downscale(image, thumbSize.width, thumbSize.height);
    // A merge no larger than a thumbnail is its own thumbnail; copied, since both buffers are transferred.
    const thumbnail = scaled === image ? { ...image, data: image.data.slice() } : scaled;
    return {
      result: { analysis, image, thumbnail, timings: { analyse: analysedAt - started, merge: performance.now() - analysedAt } },
      transfer: [image.data.buffer, thumbnail.data.buffer, ...transfers(analysis)],
    };
  },

  /** Starts an export merge: { analysis, frames: [{ asShot }], size } (frame size). */
  async begin({ analysis, frames, size }) {
    session = {
      analysis,
      merge: analysis.mode === 'radiance' ? createRadianceMerge(analysis, frames, size) : createFusionMerge(analysis, size),
      started: performance.now(),
    };
    return { result: { width: session.merge.width, height: session.merge.height } };
  },

  /** Adds one full-size frame; the page decodes them one at a time. */
  async add({ index, image }) {
    if (!session) throw new HdrError('state', 'No HDR export is in progress.');
    session.merge.add(index, image);
    return { result: { index } };
  },

  /**
   * Finishes the merge and renders it with the photo's settings in 8-bit bands
   * (progress messages carry the bands; the page writes them into its canvas).
   * :param payload: { adjustments, raw (radiance: reference RAW info with hdrWhite), lut,
   *   flattenAlpha, native } where `native` is the merged photo's full size (Detail scale)
   */
  async render({ adjustments, raw = null, lut = null, flattenAlpha = false, native = null, warp = null }, progress) {
    if (!session) throw new HdrError('state', 'No HDR export is in progress.');
    const mergedAt = performance.now();
    let image = session.merge.finish();
    session.merge = null;
    // Geometry: the merge (the three sources and their analysis untouched) is warped to the output.
    if (warp) image = warpImage(image, warp.matrix, warp);
    const merged = performance.now();
    const params = deriveParams(adjustments, { lut, raw: session.analysis.mode === 'radiance' ? raw : null });
    const prepared = prepareRender(params);
    const { width, height } = image;
    const detail = params.detailActive
      ? prepareDetailRender(prepared, { width, height, nativeWidth: native?.width ?? width, nativeHeight: native?.height ?? height, transparent: image.kind !== 'hdr' && rowsHaveAlpha(image, 0, height), guideImage: guideSource(image) })
      : null;
    for (let row = 0; row < height; row += HDR_BAND_ROWS) {
      const rows = Math.min(HDR_BAND_ROWS, height - row);
      let data;
      if (detail) {
        data = new Uint8ClampedArray(width * rows * 4);
        renderDetailRows(image, detail, row, row + rows, data, { flattenAlpha });
      } else if (image.kind === 'hdr') {
        data = new Uint8ClampedArray(width * rows * 4);
        renderRawRgba8(image.data.subarray(row * width * 3, (row + rows) * width * 3), prepared, { target: data });
      } else {
        data = image.data.slice(row * width * 4, (row + rows) * width * 4);
        renderRgba8(data, prepared, { target: data, flattenAlpha });
      }
      finishRows(warp, data, row, rows, flattenAlpha);
      progress({ stage: 'rendering', fraction: (row + rows) / height, band: { row, rows, data } });
    }
    session = null;
    return { result: { width, height, timings: { merge: merged - mergedAt, render: performance.now() - merged } } };
  },
};

export async function runHdrTask(type, payload, progress) {
  const handler = handlers[type];
  if (!handler) throw new Error(`Unknown HDR task: ${type}`);
  return handler(payload, progress);
}
