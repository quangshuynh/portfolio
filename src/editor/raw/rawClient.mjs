// Page side of RAW processing. Every job gets a fresh RAW worker that is terminated when
// the job ends or is cancelled, so the decoder's wasm heap is always returned. Jobs wait
// in one queue that runs one decoder at a time (each needs 300–800 MB while it runs, so
// the peak is one LibRaw heap): previews first, then exports, then imports.

import { WorkerCancelled, createWorkerClient } from '../io/workerClient.mjs';
import { assertCanvasWorks, createCanvas, encodeCanvas } from '../io/decode.mjs';
import { exportGeometry } from '../io/files.mjs';
import { finishRows, warpSpec } from '../pipeline/warp.mjs';
import { FORMATS } from '../io/imageHeader.mjs';
import { recordDiagnostic } from '../io/diagnostics.mjs';
import { renderDetailParallel, renderPixelsParallel } from '../io/detailPool.mjs';
import { deriveParams } from '../pipeline/spec.mjs';

const PRIORITY = { decode: 0, region: 0, export: 1, develop: 1, inspect: 2 };

/** Phones and devices reporting ≤ 4 GB: no full-size RAW decode for 1:1, smaller ZIP parts. */
export function constrainedDevice(win = globalThis) {
  const memory = win.navigator?.deviceMemory;
  let phone = false;
  try {
    phone = Boolean(win.matchMedia?.('(pointer: coarse)').matches) && Math.max(win.screen?.width ?? 0, win.screen?.height ?? 0) <= 1024;
  } catch { /* treat as a desktop */ }
  return phone || (typeof memory === 'number' && memory <= 4);
}

const spawnRawWorker = () => new Worker(new URL('./rawWorker.mjs', import.meta.url), { type: 'module' });
const createRenderClient = (spawn) => createWorkerClient(spawn ? spawn() : new Worker(new URL('../io/imageWorker.mjs', import.meta.url), { type: 'module' }));

function rawError(error) {
  if (error instanceof WorkerCancelled || error.code === 'cancelled') return error;
  if (error.code === 'worker-failed') {
    recordDiagnostic('raw-worker', error.message);
    return Object.assign(new Error('The RAW decoder could not start in this browser, so RAW files cannot be opened here. JPEG, PNG and WebP still work.'), { code: 'worker-failed' });
  }
  if (error.code === 'worker-crashed') {
    recordDiagnostic('raw-worker', 'RAW worker stopped (likely out of memory).', 'warning');
    return Object.assign(new Error('The RAW decoder stopped, most likely because this device ran out of memory. Close other tabs or photos and try again; full-size RAW exports need the most memory.'), { code: 'memory' });
  }
  return error;
}

/**
 * Creates a RAW job queue.
 * :param options: { spawn, limit } worker factory and concurrency (tests pass fakes)
 */
export function createRawQueue({ spawn = spawnRawWorker, limit = 1 } = {}) {
  const waiting = [];
  let running = 0;

  const pump = () => {
    while (running < limit && waiting.length) {
      waiting.sort((a, b) => PRIORITY[a.type] - PRIORITY[b.type] || a.order - b.order);
      const job = waiting.shift();
      running += 1;
      let client;
      try {
        client = createWorkerClient(spawn());
      } catch (error) {
        running -= 1;
        job.reject(rawError(Object.assign(new Error(`The RAW worker could not start: ${error.message}`), { code: 'worker-failed' })));
        continue;
      }
      job.client = client;
      client.call(job.type, job.payload, { onProgress: job.onProgress })
        .then(job.resolve, (error) => job.reject(rawError(error)))
        .finally(() => {
          client.terminate();
          job.client = null;
          running -= 1;
          pump();
        });
    }
  };

  let order = 0;
  return {
    /**
     * Queues a job. :returns: { promise, cancel } — cancel() rejects with WorkerCancelled
     * and ends its worker if it has started.
     */
    run(type, payload, { onProgress } = {}) {
      let job;
      const promise = new Promise((resolve, reject) => {
        job = { type, payload, onProgress, resolve, reject, client: null, order: (order += 1) };
      });
      waiting.push(job);
      pump();
      return {
        promise,
        cancel() {
          const index = waiting.indexOf(job);
          if (index !== -1) {
            waiting.splice(index, 1);
            job.reject(new WorkerCancelled());
          } else {
            job.client?.terminate();
          }
        },
      };
    },
    get running() { return running; },
    get waiting() { return waiting.length; },
  };
}

/**
 * Exports a RAW photo: the worker develops it at the export size and sends 8-bit
 * bands, which are written into one canvas here and encoded. With `detailWorkers` (band
 * workers, desktops), the worker returns the developed linear image instead (its LibRaw
 * heap is freed at once) and the bands, with or without Detail, are rendered by that many
 * render workers.
 * :param queue: createRawQueue() result
 * :param onStart: receives the job, so the caller can cancel it
 * :returns: { blob, width, height, source: 'full' | 'half', timings }
 */
export async function exportRaw(queue, { file, raw, adjustments, lut, settings }, { onProgress = () => {}, onStart = () => {}, detailWorkers = 0, spawnRender, warper = null } = {}) {
  const format = FORMATS[settings.format];
  const geometry = exportGeometry(adjustments.geometry, { width: raw.width, height: raw.height }, settings.resize);
  const size = geometry.output;
  // Fail before the decode if this browser cannot hold a canvas of this size.
  const canvas = createCanvas(size.width, size.height);
  const context = canvas.getContext('2d', { colorSpace: 'srgb' });
  assertCanvasWorks(context, size.width, size.height);
  if (detailWorkers > 0) {
    const render = deriveParams(adjustments, { lut, raw }).detailActive ? renderDetailParallel : renderPixelsParallel;
    const started = performance.now();
    const signal = { cancelled: false };
    const develop = queue.run('develop', { file, raw, width: geometry.decode.width, height: geometry.decode.height });
    let warping = null;
    onStart({ cancel: () => { signal.cancelled = true; develop.cancel(); warping?.terminate(); } });
    onProgress({ stage: 'decoding', fraction: 0 });
    let image = await develop.promise;
    const developed = image.width === raw.width ? 'full' : 'half';
    const spec = geometry.identity ? null : warpSpec(geometry.plan, size, image);
    if (spec) {
      // The development is warped in a render worker (moved there, not copied), after
      // LibRaw's worker has ended.
      warping = (warper ?? createRenderClient)(spawnRender);
      try {
        image = await warping.call('warp', { image, warp: spec }, { transfer: [image.data.buffer] });
      } finally {
        warping.terminate();
      }
      if (signal.cancelled) throw new WorkerCancelled();
    }
    const decodedAt = performance.now();
    const nativeSize = geometry.identity ? raw : geometry.plan.native;
    await render(image, { adjustments, lut, raw, nativeWidth: nativeSize.width, nativeHeight: nativeSize.height }, {
      workers: detailWorkers,
      signal,
      spawn: spawnRender,
      onBand: ({ row, rows, data }) => context.putImageData(new ImageData(finishRows(spec, data, row, rows, settings.format === 'jpeg'), size.width, rows), 0, row),
      onProgress: (fraction) => onProgress({ stage: 'rendering', fraction }),
    });
    onProgress({ stage: 'encoding', fraction: 1 });
    const renderedAt = performance.now();
    const blob = await encodeCanvas(canvas, format.mime, settings.format === 'png' ? undefined : settings.quality);
    if (blob.type !== format.mime) throw Object.assign(new Error(`This browser cannot encode ${format.label}. Choose another format.`), { code: 'encoder' });
    return {
      blob,
      width: size.width,
      height: size.height,
      source: developed,
      timings: { decode: decodedAt - started, render: renderedAt - decodedAt, encode: performance.now() - renderedAt, bandWorkers: detailWorkers },
    };
  }
  const job = queue.run('export', { file, raw, adjustments, lut, settings }, {
    onProgress: ({ band, ...progress }) => {
      if (band) context.putImageData(new ImageData(band.data, size.width, band.rows), 0, band.row);
      onProgress(progress);
    },
  });
  onStart(job);
  const result = await job.promise;
  onProgress({ stage: 'encoding', fraction: 1 });
  const encodeStarted = performance.now();
  const blob = await encodeCanvas(canvas, format.mime, settings.format === 'png' ? undefined : settings.quality);
  if (blob.type !== format.mime) {
    throw Object.assign(new Error(`This browser cannot encode ${format.label}. Choose another format.`), { code: 'encoder' });
  }
  return { ...result, blob, timings: { ...result.timings, encode: performance.now() - encodeStarted } };
}
