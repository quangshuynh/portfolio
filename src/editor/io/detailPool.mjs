// Exports rendered on several workers (desktops). Detail is the slow part of an export (about
// 1 s per megapixel per thread with every control on), and its bands are independent once
// the guide is known: each band needs only its rows plus the halo. Without Detail, bands
// need no halo at all (the per-pixel stages take 1.5–4.5 s per 24 MP on one thread). The page holds the
// decoded image, computes the guide (yielding between bands), and hands bands to a small
// pool of render workers; each band comes back as RGBA8 and is written into the output
// canvas. Every band is rendered by the same code from the same rows as in the one-thread
// export, so the result is bit for bit the same (tested). Phones and devices with little
// memory or few cores keep the one-thread export.

import { createWorkerClient, WorkerCancelled } from './workerClient.mjs';
import { prepareRender } from '../pipeline/cpuRenderer.mjs';
import { computeImageCapture, computeImageGlow, computeImageGuide, createAreaAccumulator, guideSize, prepareDetailRender, rowsHaveAlpha } from '../pipeline/detailRenderer.mjs';
import { deriveParams } from '../pipeline/spec.mjs';
import { assertCanvasWorks, createCanvas, encodeCanvas } from './decode.mjs';
import { exportGeometry } from './files.mjs';
import { FORMATS } from './imageHeader.mjs';
import { finishRows, hasAlpha, sourceRows, warpSpec } from '../pipeline/warp.mjs';
import { compositeSprites } from '../text/sprites.mjs';

export const DETAIL_POOL_BAND_ROWS = 256;
const MAX_DETAIL_WORKERS = 4;

/**
 * Render workers for a Detail export on this device: 0 means the one-thread export.
 * Each holds one band and its scratch planes (about 20 MB at 6000 px wide).
 */
export function detailWorkerCount(win = globalThis) {
  const memory = win.navigator?.deviceMemory;
  const cores = win.navigator?.hardwareConcurrency ?? 2;
  let phone = false;
  try {
    phone = Boolean(win.matchMedia?.('(pointer: coarse)').matches) && Math.max(win.screen?.width ?? 0, win.screen?.height ?? 0) <= 1024;
  } catch { /* treat as a desktop */ }
  if (phone || (typeof memory === 'number' && memory <= 4) || typeof win.Worker !== 'function') return 0;
  const count = Math.min(MAX_DETAIL_WORKERS, cores - 2);
  return count >= 2 ? count : 0;
}

const spawnRenderWorker = () => new Worker(new URL('./imageWorker.mjs', import.meta.url), { type: 'module' });
const channelsOf = (image) => (image.kind === 'raw' || image.kind === 'hdr' ? 3 : 4);
const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Guide, glow map, capture map and transparency of a whole image, read in bands so the page keeps painting. */
async function analyse(image, prepared, signal, native) {
  const small = guideSize(image);
  const accumulator = createAreaAccumulator(image.kind, image.width, image.height, small.width, small.height);
  const channels = channelsOf(image);
  let transparent = false;
  for (let row = 0; row < image.height; row += DETAIL_POOL_BAND_ROWS) {
    if (signal.cancelled) throw new WorkerCancelled();
    const rows = Math.min(DETAIL_POOL_BAND_ROWS, image.height - row);
    const data = image.data.subarray(row * image.width * channels, (row + rows) * image.width * channels);
    accumulator.add(data, row, rows);
    if (channels === 4) transparent ||= rowsHaveAlpha({ width: image.width, data }, 0, rows);
    await nextTick();
  }
  const source = accumulator.finish();
  const guideImage = small.width === image.width && small.height === image.height && !transparent ? image : source;
  const guide = computeImageGuide(prepared, guideImage);
  const glow = computeImageGlow(prepared, guideImage);
  return { guide, glow, capture: computeImageCapture(prepared, guideImage, { ...native, guide, glow }), transparent };
}

/**
 * Renders the bands of `image` on `workers` helpers: each is prepared with `begin`
 * ([task, payload]), then renders bands with `rowsTask` from the band's rows plus `halo`
 * rows above and below. Bands are delivered as they finish.
 */
async function renderBands(image, { begin: [beginTask, beginPayload], rowsTask, halo, flattenAlpha }, { workers, onBand, onProgress = () => {}, signal = { cancelled: false }, spawn = spawnRenderWorker }) {
  const channels = channelsOf(image);
  const job = `${Date.now()}-${Math.random()}`;
  const clients = [];
  const stop = () => clients.forEach((client) => client.terminate());
  const bands = [];
  for (let row = 0; row < image.height; row += DETAIL_POOL_BAND_ROWS) bands.push(row);
  let done = 0;
  try {
    // Spawned inside the try: if a later spawn throws, the earlier workers are still ended.
    for (let i = 0; i < Math.max(1, workers); i += 1) clients.push(createWorkerClient(spawn()));
    await Promise.all(clients.map((client) => client.call(beginTask, { job, ...beginPayload })));
    const lane = async (client) => {
      while (bands.length) {
        if (signal.cancelled) throw new WorkerCancelled();
        const row = bands.shift();
        const rows = Math.min(DETAIL_POOL_BAND_ROWS, image.height - row);
        const top = Math.max(0, row - halo);
        const bottom = Math.min(image.height, row + rows + halo);
        // A copy of just these rows: posting a view would clone its whole buffer.
        const data = image.data.slice(top * image.width * channels, bottom * image.width * channels);
        const source = { kind: image.kind, width: image.width, height: bottom - top, y0: top, data };
        const band = await client.call(rowsTask, { job, source, y0: row, y1: row + rows, flattenAlpha }, { transfer: [data.buffer] });
        if (signal.cancelled) throw new WorkerCancelled();
        onBand({ row, rows, data: band });
        done += rows;
        onProgress(done / image.height);
      }
    };
    await Promise.all(clients.map(lane));
  } finally {
    stop();
  }
}

/**
 * Geometry on several workers: each output band is warped by a render worker from a copy
 * of just the source rows it maps to (for a straightened photo, a little more than the
 * band). Every band uses the same arithmetic as a whole warpImage(), so the result is bit
 * for bit the same (tested). :returns: the warped image ({ kind?, width, height, data })
 */
export async function warpParallel(source, spec, { workers, signal = { cancelled: false }, spawn = spawnRenderWorker, onProgress = () => {} }) {
  const channels = channelsOf(source);
  const { width, height } = spec;
  const data = new source.data.constructor(width * height * channels);
  const opaque = !hasAlpha(source);
  const bands = [];
  for (let row = 0; row < height; row += DETAIL_POOL_BAND_ROWS) bands.push(row);
  const clients = [];
  let done = 0;
  try {
    for (let i = 0; i < Math.max(1, workers); i += 1) clients.push(createWorkerClient(spawn()));
    const lane = async (client) => {
      while (bands.length) {
        if (signal.cancelled) throw new WorkerCancelled();
        const row = bands.shift();
        const rows = Math.min(DETAIL_POOL_BAND_ROWS, height - row);
        const [top, bottom] = sourceRows(spec.matrix, width, row, row + rows, source.height);
        const slice = source.data.slice(top * source.width * channels, bottom * source.width * channels);
        const band = await client.call('warpRows', {
          source: { ...(source.kind ? { kind: source.kind } : {}), width: source.width, height: source.height, top, data: slice },
          matrix: spec.matrix, width, y0: row, y1: row + rows, opaque,
        }, { transfer: [slice.buffer] });
        data.set(band, row * width * channels);
        done += rows;
        onProgress(done / height);
      }
    };
    await Promise.all(clients.map(lane));
  } finally {
    clients.forEach((client) => client.terminate());
  }
  return { ...(source.kind ? { kind: source.kind } : {}), width, height, data };
}

/**
 * Renders an in-memory image with Detail settings on `workers` helpers.
 * :param image: { kind?, width, height, data } (RGBA8, or RAW/HDR linear RGB)
 * :param settings: { adjustments, lut, raw, nativeWidth, nativeHeight, flattenAlpha }
 * :param options: { workers, onBand({ row, rows, data }), onProgress(fraction), signal: { cancelled }, spawn }
 * :returns: when every band has been delivered
 */
export async function renderDetailParallel(image, settings, options) {
  const { adjustments, lut = null, raw = null, nativeWidth = image.width, nativeHeight = image.height, flattenAlpha = false } = settings;
  const signal = options.signal ?? { cancelled: false };
  const prepared = prepareRender(deriveParams(adjustments, { lut, raw }));
  const { guide, glow, capture, transparent } = await analyse(image, prepared, signal, { nativeWidth, nativeHeight });
  const renderOptions = { width: image.width, height: image.height, nativeWidth, nativeHeight, guide, glow, capture, transparent };
  const { halo } = prepareDetailRender(prepared, renderOptions);
  const begin = { adjustments, lut, raw, options: renderOptions };
  return renderBands(image, { begin: ['detailBegin', begin], rowsTask: 'detailRows', halo, flattenAlpha }, { ...options, signal });
}

/**
 * Renders an in-memory image without Detail on `workers` helpers, with the per-pixel
 * renderer of the one-thread export. Pixels do not depend on their neighbours, so the
 * bands need no halo and the result is the same bit for bit (tested).
 * :param image: { kind?, width, height, data } (RGBA8, or RAW linear RGB)
 * :param settings: { adjustments, lut, raw, flattenAlpha }
 */
export function renderPixelsParallel(image, { adjustments, lut = null, raw = null, flattenAlpha = false }, options) {
  return renderBands(image, { begin: ['pixelBegin', { adjustments, lut, raw }], rowsTask: 'pixelRows', halo: 0, flattenAlpha }, options);
}

/**
 * A JPEG, PNG or WebP export on several workers: `decoder` (an image worker client)
 * decodes the original at the export size, the bands are rendered in parallel (with or
 * without Detail) into a page canvas, which is encoded. The one-thread export renders in
 * place in the decode canvas instead; this holds the decoded pixels and the canvas
 * (8 bytes per pixel).
 * :returns: { blob, width, height, timings }
 */
export async function exportImageInBands(decoder, { file, header, adjustments, lut = null, settings, sprites = null }, { workers, onProgress = () => {}, signal, spawn }) {
  const started = performance.now();
  const format = FORMATS[settings.format];
  const native = { width: header.displayWidth, height: header.displayHeight };
  const geometry = exportGeometry(adjustments.geometry, native, settings.resize);
  const size = geometry.output;
  const flatten = settings.format === 'jpeg';
  const canvas = createCanvas(size.width, size.height);
  const context = canvas.getContext('2d', { colorSpace: 'srgb' });
  assertCanvasWorks(context, size.width, size.height);
  onProgress({ stage: 'decoding', fraction: 0 });
  // With geometry the decoded original is warped on the band workers too.
  const spec = geometry.identity ? null : warpSpec(geometry.plan, size, geometry.decode);
  let image = await decoder.call('decode', { file, header, ...geometry.decode });
  if (spec) image = await warpParallel(image, spec, { workers, signal, spawn, onProgress: (fraction) => onProgress({ stage: 'decoding', fraction }) });
  const decodedAt = performance.now();
  const render = deriveParams(adjustments, { lut }).spatialActive ? renderDetailParallel : renderPixelsParallel;
  const nativeSize = geometry.identity ? native : geometry.plan.native;
  await render(image, { adjustments, lut, nativeWidth: nativeSize.width, nativeHeight: nativeSize.height, flattenAlpha: flatten }, {
    workers,
    signal,
    spawn,
    onBand: ({ row, rows, data }) => context.putImageData(new ImageData(finishRows(spec, data, row, rows, flatten), size.width, rows), 0, row),
    onProgress: (fraction) => onProgress({ stage: 'rendering', fraction }),
  });
  compositeSprites(context, sprites);
  onProgress({ stage: 'encoding', fraction: 1 });
  const renderedAt = performance.now();
  const blob = await encodeCanvas(canvas, format.mime, settings.format === 'png' ? undefined : settings.quality);
  if (signal.cancelled) throw new WorkerCancelled();
  if (blob.type !== format.mime) throw Object.assign(new Error(`This browser cannot encode ${format.label}. Choose another format.`), { code: 'encoder' });
  return { blob, width: size.width, height: size.height, timings: { decode: decodedAt - started, render: renderedAt - decodedAt, encode: performance.now() - renderedAt, bandWorkers: workers } };
}
