// Page side of HDR merging. Inputs are decoded one at a time (RAW through the bounded
// RAW queue, JPEG/PNG/WebP in an image worker) and handed to a fresh HDR worker, so at
// most one decoded input exists outside the merge at any moment. Every job can be
// cancelled, which ends its workers; a cancelled or superseded job never commits.

import { WorkerCancelled, createImageWorker, createWorkerClient } from '../io/workerClient.mjs';
import { assertCanvasWorks, createCanvas, encodeCanvas } from '../io/decode.mjs';
import { compositeSprites } from '../text/sprites.mjs';
import { exportGeometry, proxyDimensions } from '../io/files.mjs';
import { warpSpec } from '../pipeline/warp.mjs';
import { FORMATS } from '../io/imageHeader.mjs';
import { cropAt } from './hdrAlign.mjs';
import { exposureStops } from './hdrMetadata.mjs';

const spawnHdrWorker = () => new Worker(new URL('./hdrWorker.mjs', import.meta.url), { type: 'module' });

/** JPEG/PNG/WebP previews are merged at most this large (fusion is spatial and slower). */
export const FUSION_PREVIEW_EDGE = 3072;

/** Full size the inputs are merged at: the RAW size, or the smallest raster input. */
export function bracketSize(inputs) {
  if (inputs[0].raw) return { width: inputs[0].raw.width, height: inputs[0].raw.height };
  const smallest = inputs.reduce((a, b) => (b.width * b.height < a.width * a.height ? b : a));
  return { width: smallest.width, height: smallest.height };
}

/** A cancellable job made of several worker calls. */
export function createHdrJob() {
  const parts = new Set();
  const job = {
    cancelled: false,
    track(part) { parts.add(part); return part; },
    release(part) { parts.delete(part); },
    cancel() {
      job.cancelled = true;
      parts.forEach((part) => part.cancel?.() ?? part.terminate?.());
      parts.clear();
    },
    check() { if (job.cancelled) throw new WorkerCancelled(); },
  };
  return job;
}

async function decodeInput(input, size, { rawQueue, job, type }) {
  job.check();
  if (input.raw) {
    const run = type === 'preview'
      ? rawQueue.run('decode', { file: input.file, maxEdge: Math.max(size.width, size.height) })
      : rawQueue.run('develop', { file: input.file, raw: input.raw, width: size.width, height: size.height });
    job.track(run);
    try { return await run.promise; } finally { job.release(run); }
  }
  const worker = job.track(createImageWorker());
  try {
    return await worker.call('decode', { file: input.file, header: input.header, width: size.width, height: size.height });
  } finally {
    worker.terminate();
    job.release(worker);
  }
}

const frameInfo = (input) => ({ asShot: input.raw?.asShot ?? null, stops: exposureStops(input.exposure), role: input.role });

/**
 * Decodes and merges the bracket at preview size.
 * :param inputs: [{ file, raw | header, width, height, exposure, role }] in input order
 * :param options: { mode, reference, settings, maxEdge, thumbnailEdge }
 * :returns: { analysis, image, thumbnail, timings }
 */
export async function mergePreview(inputs, { mode, reference, settings, maxEdge, thumbnailEdge }, { rawQueue, job, spawn = spawnHdrWorker, onProgress = () => {} }) {
  const full = bracketSize(inputs);
  // A RAW preview is the half-size sensor data (scaled down if the device needs less).
  const edge = mode === 'radiance' ? maxEdge : Math.min(maxEdge, FUSION_PREVIEW_EDGE);
  const size = proxyDimensions(full, edge);
  const frames = [];
  const started = performance.now();
  for (const [index, input] of inputs.entries()) {
    onProgress({ stage: 'decoding', index, fraction: index / inputs.length });
    const image = await decodeInput(input, size, { rawQueue, job, type: 'preview' });
    frames.push({ image, ...frameInfo(input) });
  }
  job.check();
  if (frames.some(({ image }) => image.width !== frames[0].image.width || image.height !== frames[0].image.height)) {
    throw Object.assign(new Error('The photos decoded to different sizes, so they cannot be merged.'), { code: 'size' });
  }
  const decoded = performance.now();
  const client = job.track(createWorkerClient(spawn()));
  try {
    const result = await client.call('merge', { mode, reference, settings, frames, thumbnailEdge }, {
      transfer: frames.map(({ image }) => image.data.buffer),
      onProgress,
    });
    job.check();
    return { ...result, timings: { decode: decoded - started, ...result.timings } };
  } finally {
    client.terminate();
    job.release(client);
  }
}

/**
 * Export sizes: decoded frame size, merged (alignment-cropped) size, output size, the
 * photo's geometry plan, and whether RAW needs a full demosaic. Without geometry the
 * output is the merged image itself; with geometry the merge is made at the size the warp
 * needs and warped to the output.
 */
export function hdrExportGeometry(inputs, analysis, resize, geometry = null) {
  const full = bracketSize(inputs);
  const cropFull = cropAt(analysis.crop, full.width, full.height);
  const sizes = exportGeometry(geometry, cropFull, resize);
  const scale = sizes.decode.width === cropFull.width && sizes.decode.height === cropFull.height ? 1 : sizes.decode.width / cropFull.width;
  const frame = scale === 1 ? full : { width: Math.round(full.width * scale), height: Math.round(full.height * scale) };
  const crop = cropAt(analysis.crop, frame.width, frame.height);
  const fullDecode = Boolean(inputs[0].raw) && (frame.width > Math.floor(full.width / 2) || frame.height > Math.floor(full.height / 2));
  const merged = { width: crop.width, height: crop.height };
  return {
    full,
    frame,
    merged,
    output: sizes.identity ? merged : sizes.output,
    native: sizes.identity ? { width: cropFull.width, height: cropFull.height } : sizes.plan.native,
    plan: sizes.identity ? null : sizes.plan,
    fullDecode,
  };
}

/**
 * Peak memory of an HDR export in MB: the merge accumulators or fusion pyramids, one
 * decoded frame in flight, the output canvas, and the RAW decoder's heap. Calibrated on
 * Chromium: a 6024×4024 RAW merge exported at full size peaked about 1.6 GB above the
 * page's baseline (docs/photography-editor.md).
 */
export function hdrExportMegabytes(mode, { frame, merged = null, output, fullDecode, plan = null }) {
  const framePixels = frame.width * frame.height;
  const mergedPixels = merged ? merged.width * merged.height : output.width * output.height;
  const outPixels = output.width * output.height;
  const mb = (bytes) => bytes / (1024 * 1024);
  // Geometry warps the finished merge into a second image of the output size.
  const warped = plan ? outPixels * (mode === 'radiance' ? 12 : 4) : 0;
  if (mode === 'radiance') return Math.round(mb(mergedPixels * 16 + outPixels * 4 + warped + framePixels * 6 * 2) + (fullDecode ? 850 : 200));
  return Math.round(mb(mergedPixels * 46 + outPixels * 4 + warped + framePixels * 4 * 2));
}

/** Memory an HDR export may use on this device, in MB. */
export function hdrMemoryBudget(win = globalThis) {
  const memory = win.navigator?.deviceMemory;
  if (typeof memory === 'number') return Math.round(memory * 1024 * 0.4);
  let phone = false;
  try {
    phone = Boolean(win.matchMedia?.('(pointer: coarse)').matches) && Math.max(win.screen?.width ?? 0, win.screen?.height ?? 0) <= 1024;
  } catch { /* treat as a desktop */ }
  return phone ? 900 : 3000;
}

/**
 * Whether an export fits this device, and otherwise the largest long edge that does.
 * :returns: { megabytes, fits, suggestion: long edge in px or null }
 */
export function checkHdrExport(mode, inputs, analysis, resize, budget = hdrMemoryBudget(), geometry = null) {
  const megabytes = hdrExportMegabytes(mode, hdrExportGeometry(inputs, analysis, resize, geometry));
  if (megabytes <= budget) return { megabytes, fits: true, suggestion: null };
  const suggestion = [6000, 5000, 4096, 3600, 3072, 2560, 2048, 1600, 1200]
    .find((longEdge) => hdrExportMegabytes(mode, hdrExportGeometry(inputs, analysis, { mode: 'long-edge', longEdge }, geometry)) <= budget) ?? null;
  return { megabytes, fits: false, suggestion };
}

/**
 * Exports a merged photo from its source files: each input is decoded again at the
 * export size and merged with the stored analysis, then rendered with the photo's
 * settings in bands written into one canvas, and encoded.
 * :param photo: { mode, raw (radiance), adjustments, lut }
 * :returns: { blob, width, height, timings }
 */
export async function exportHdr(inputs, analysis, { adjustments, raw, lut, settings, sprites = null }, { rawQueue, job, spawn = spawnHdrWorker, onProgress = () => {} }) {
  const format = FORMATS[settings.format];
  const geometry = hdrExportGeometry(inputs, analysis, settings.resize, adjustments.geometry);
  const { frame, output, merged: mergedSize } = geometry;
  const canvas = createCanvas(output.width, output.height);
  const context = canvas.getContext('2d', { colorSpace: 'srgb' });
  assertCanvasWorks(context, output.width, output.height);
  const started = performance.now();
  const client = job.track(createWorkerClient(spawn()));
  try {
    const begun = await client.call('begin', { analysis, frames: inputs.map(frameInfo), size: frame });
    if (begun.width !== mergedSize.width || begun.height !== mergedSize.height) throw new Error('The merge size does not match the export size.');
    // Geometry: the worker warps the finished merge to the output before rendering.
    const warp = geometry.plan ? warpSpec(geometry.plan, output, begun) : null;
    for (const [index, input] of inputs.entries()) {
      onProgress({ stage: 'decoding', index, fraction: index / inputs.length });
      const image = await decodeInput(input, frame, { rawQueue, job, type: 'export' });
      job.check();
      onProgress({ stage: 'merging', index, fraction: (index + 0.5) / inputs.length });
      await client.call('add', { index, image }, { transfer: [image.data.buffer] });
    }
    const merged = performance.now();
    const result = await client.call('render', { adjustments, raw, lut, flattenAlpha: settings.format === 'jpeg', native: geometry.native, warp }, {
      onProgress: ({ band, ...progress }) => {
        if (band) context.putImageData(new ImageData(band.data, output.width, band.rows), 0, band.row);
        onProgress(progress);
      },
    });
    job.check();
    compositeSprites(context, sprites);
    onProgress({ stage: 'encoding', fraction: 1 });
    const encodeStarted = performance.now();
    const blob = await encodeCanvas(canvas, format.mime, settings.format === 'png' ? undefined : settings.quality);
    job.check();
    if (blob.type !== format.mime) {
      throw Object.assign(new Error(`This browser cannot encode ${format.label}. Choose another format.`), { code: 'encoder' });
    }
    return {
      blob,
      width: result.width,
      height: result.height,
      timings: { decodeAndMerge: merged - started, ...result.timings, encode: performance.now() - encodeStarted },
    };
  } finally {
    client.terminate();
    job.release(client);
  }
}
