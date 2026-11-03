// Page side of RAW processing. Every job gets a fresh RAW worker that is terminated when
// the job ends or is cancelled, so the decoder's wasm heap is always returned. Jobs wait
// in one queue that runs one decoder at a time (each needs 300–800 MB while it runs, so
// the peak is one LibRaw heap): previews first, then exports, then imports.
//
// A watchdog ends a worker that stops responding (rawTrace.mjs has the limits): a worker that
// never starts, falls silent during an asynchronous stage (they heartbeat every second), or
// overruns a synchronous stage's size-based budget. Without it one stalled decoder left its
// photo "importing" forever and held the queue's only slot, so every later RAW job waited too.
// Time only counts while the page is visible, because a backgrounded page's workers may be
// suspended. Every job's checkpoints are kept in window.__peRawTrace.

import { WorkerCancelled, createWorkerClient } from '../io/workerClient.mjs';
import { assertCanvasWorks, createCanvas, encodeCanvas } from '../io/decode.mjs';
import { exportGeometry } from '../io/files.mjs';
import { finishRows, warpSpec } from '../pipeline/warp.mjs';
import { FORMATS } from '../io/imageHeader.mjs';
import { recordDiagnostic } from '../io/diagnostics.mjs';
import { renderDetailParallel, renderPixelsParallel, warpParallel } from '../io/detailPool.mjs';
import { applyRetouchAsync } from '../pipeline/retouch.mjs';
import { createInpaintRunner } from '../pipeline/inpaintClient.mjs';
import { deriveParams } from '../pipeline/spec.mjs';
import { RAW_STAGES, RAW_WATCHDOG, createTraceLog, syncBudgetSeconds, toMb } from './rawTrace.mjs';

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

function rawError(error) {
  if (error instanceof WorkerCancelled || error.code === 'cancelled' || error.code === 'stalled') return error;
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

const pageVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

function stalledError(stage, seconds) {
  const what = (RAW_STAGES[stage]?.label ?? 'Working').toLowerCase();
  return Object.assign(new Error(`The RAW decoder stopped responding (${what}, ${Math.round(seconds)} s without progress) and was stopped so the editor stays usable. Try again; if it happens again, this browser cannot decode this file here. JPEG, PNG and WebP still work.`), { code: 'stalled', stage });
}

/**
 * Creates a RAW job queue.
 * :param options: { spawn, limit, timers, visible, limits } worker factory, concurrency, a
 *   setInterval/clearInterval/now source, page visibility and watchdog limits (tests pass fakes)
 */
export function createRawQueue({ spawn = spawnRawWorker, limit = 1, timers = globalThis, visible = pageVisible, limits = RAW_WATCHDOG, traces = createTraceLog() } = {}) {
  const waiting = [];
  let running = 0;
  const now = () => (timers.performance ?? globalThis.performance ?? Date).now();

  const watch = (job, worker, client) => {
    const state = { stage: 'starting', ready: false, silent: 0, inStage: 0, budget: null, last: now() };
    const trace = job.trace;
    const checkpoint = (stage, detail = {}) => {
      Object.assign(state, { stage, inStage: 0, silent: 0 });
      state.budget = RAW_STAGES[stage]?.sync ? syncBudgetSeconds({ megapixels: detail.megapixels ?? state.megapixels ?? 0, full: detail.full ?? state.full }, limits) : null;
      if (detail.megapixels) state.megapixels = detail.megapixels;
      if (detail.full !== undefined) state.full = detail.full;
      trace.checkpoints.push({ stage, at: Math.round(now() - job.startedAt), worker: detail.ms ?? null, wasmMb: toMb(detail.wasmBytes) });
      job.onStage?.(stage);
    };
    worker.addEventListener('message', ({ data }) => {
      state.silent = 0;
      if (data?.ready) { state.ready = true; return; }
      const progress = data?.progress;
      if (progress?.checkpoint) checkpoint(progress.checkpoint, progress);
    });
    checkpoint('starting');
    const timer = timers.setInterval(() => {
      const t = now();
      const dt = Math.min(limits.maxTickSeconds, (t - state.last) / 1000);
      state.last = t;
      if (!visible()) return;
      state.silent += dt;
      state.inStage += dt;
      let over = null;
      if (!state.ready) { if (state.silent > limits.startupSeconds) over = state.silent; }
      else if (state.budget !== null) { if (state.inStage > state.budget) over = state.inStage; }
      else if (state.silent > limits.silenceSeconds) over = state.silent;
      if (over === null) return;
      job.stalled = stalledError(state.stage, over);
      recordDiagnostic('raw-worker', `RAW ${job.type} stopped responding at "${state.stage}" after ${Math.round(over)} s; stopped. Checkpoints: ${trace.checkpoints.map((c) => `${c.stage}@${c.at}ms${c.wasmMb !== null ? `/${c.wasmMb}MB` : ''}`).join(' ')}`);
      client.terminate();
    }, limits.tickMs);
    return () => timers.clearInterval(timer);
  };

  const pump = () => {
    while (running < limit && waiting.length) {
      waiting.sort((a, b) => PRIORITY[a.type] - PRIORITY[b.type] || a.order - b.order);
      const job = waiting.shift();
      running += 1;
      job.startedAt = now();
      job.trace = traces.start(job);
      let client;
      let stop = () => {};
      try {
        const worker = spawn();
        client = createWorkerClient(worker);
        stop = watch(job, worker, client);
      } catch (error) {
        running -= 1;
        stop();
        job.trace.outcome = 'worker-failed';
        job.reject(rawError(Object.assign(new Error(`The RAW worker could not start: ${error.message}`), { code: 'worker-failed' })));
        continue;
      }
      job.client = client;
      client.call(job.type, job.payload, { onProgress: job.onProgress && ((value) => !value.checkpoint && job.onProgress(value)) })
        .then((result) => { job.trace.outcome = 'ok'; job.resolve(result); }, (error) => {
          const final = job.stalled ?? rawError(error);
          job.trace.outcome = final.code ?? 'failed';
          job.reject(final);
        })
        .finally(() => {
          stop();
          client.terminate();
          job.trace.ms = Math.round(now() - job.startedAt);
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
     * and ends its worker if it has started. `onStage` receives each RAW_STAGES key.
     */
    run(type, payload, { onProgress, onStage } = {}) {
      let job;
      const promise = new Promise((resolve, reject) => {
        job = { type, payload, onProgress, onStage, resolve, reject, client: null, order: (order += 1) };
      });
      waiting.push(job);
      onStage?.('queued');
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
 * `compose` composites the photo's layers over the rendered canvas (io/composeLayers.mjs).
 * :returns: { blob, width, height, source: 'full' | 'half', timings }
 */
export async function exportRaw(queue, { file, raw, adjustments, lut, settings, compose = null }, { onProgress = () => {}, onStart = () => {}, detailWorkers = 0, spawnRender } = {}) {
  const format = FORMATS[settings.format];
  const geometry = exportGeometry(adjustments.geometry, { width: raw.width, height: raw.height }, settings.resize);
  const size = geometry.output;
  // Fail before the decode if this browser cannot hold a canvas of this size.
  const canvas = createCanvas(size.width, size.height);
  const context = canvas.getContext('2d', { colorSpace: 'srgb' });
  assertCanvasWorks(context, size.width, size.height);
  if (detailWorkers > 0) {
    const render = deriveParams(adjustments, { lut, raw }).spatialActive ? renderDetailParallel : renderPixelsParallel;
    const started = performance.now();
    const signal = { cancelled: false };
    const develop = queue.run('develop', { file, raw, width: geometry.decode.width, height: geometry.decode.height });
    onStart({ cancel: () => { signal.cancelled = true; develop.cancel(); } });
    onProgress({ stage: 'decoding', fraction: 0 });
    let image = await develop.promise;
    const developed = image.width === raw.width ? 'full' : 'half';
    // Retouch (stage 0) on the developed sensor data, before geometry and every adjustment; Remove
    // fills run in their own worker.
    const remover = createInpaintRunner();
    try {
      await applyRetouchAsync(image, adjustments.retouch, { runRemove: (payload) => remover.run(payload), signal });
    } finally {
      remover.dispose();
    }
    if (signal.cancelled) throw new WorkerCancelled();
    const spec = geometry.identity ? null : warpSpec(geometry.plan, size, image);
    if (spec) {
      // The development (LibRaw's worker has ended) is warped on the band workers.
      image = await warpParallel(image, spec, { workers: detailWorkers, signal, spawn: spawnRender });
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
    if (compose) await compose(context, { size, signal, onProgress });
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
  if (compose) await compose(context, { size, signal: { cancelled: false }, onProgress });
  onProgress({ stage: 'encoding', fraction: 1 });
  const encodeStarted = performance.now();
  const blob = await encodeCanvas(canvas, format.mime, settings.format === 'png' ? undefined : settings.quality);
  if (blob.type !== format.mime) {
    throw Object.assign(new Error(`This browser cannot encode ${format.label}. Choose another format.`), { code: 'encoder' });
  }
  return { ...result, blob, timings: { ...result.timings, encode: performance.now() - encodeStarted } };
}
