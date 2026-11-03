// The page's side of intelligent selections: one worker (selectionWorker.mjs), one selection at a
// time. Cancelling ends the worker (a model run cannot be interrupted from outside); so does
// being idle for IDLE_MS, which returns the models' memory (hundreds of megabytes) to the device.
// The next selection starts a fresh worker; models then come from the browser's HTTP cache.
import { SELECTION_KINDS } from './models.mjs';

export const IDLE_MS = 90_000;

export class SelectionCancelled extends Error {
  constructor() {
    super('Selection cancelled.');
    this.code = 'cancelled';
  }
}

/**
 * :param spawn: worker factory (tests pass a fake)
 * :param base: URL the model directory is relative to (the site's base)
 */
export function createSelectionRunner({ spawn = () => new Worker(new URL('./selectionWorker.mjs', import.meta.url), { type: 'module' }), base, idleMs = IDLE_MS } = {}) {
  let worker = null;
  let pending = null;
  let nextId = 1;
  let idle = 0;
  // Models the current worker has loaded (what a new selection still downloads or reads from cache).
  let loaded = new Set();
  const stop = () => { clearTimeout(idle); worker?.terminate(); worker = null; loaded = new Set(); };
  const rest = () => { clearTimeout(idle); idle = setTimeout(stop, idleMs); };
  return {
    /**
     * :param request: { kind, image (RGBA at analysis size), imageKey, points?, candidate? }
     * :returns: a promise of the worker's result; `onProgress({ stage, model?, fraction? })` meanwhile
     */
    run(request, onProgress = () => {}) {
      if (pending) { pending.reject(new SelectionCancelled()); pending = null; stop(); }
      clearTimeout(idle);
      worker ??= spawn();
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        pending = { id, resolve, reject };
        worker.onmessage = ({ data }) => {
          if (data.id !== id) return;
          if (data.type === 'progress') {
            if (data.progress.stage === 'prepare') loaded.add(data.progress.model);
            onProgress(data.progress);
            return;
          }
          pending = null;
          rest();
          if (data.type === 'done') {
            SELECTION_KINDS[request.kind].models.forEach((name) => loaded.add(name));
            resolve(data.result);
          } else {
            const error = new Error(data.message);
            error.code = data.code;
            // A worker that ran out of memory is not reused.
            if (data.code === 'out-of-memory') stop();
            reject(error);
          }
        };
        worker.onerror = (event) => {
          if (pending?.id !== id) return;
          pending = null;
          stop();
          const error = new Error(event.message || 'The selection stopped unexpectedly. Try again.');
          error.code = 'worker-failed';
          reject(error);
        };
        worker.postMessage({ id, type: 'select', base, request });
      });
    },
    cancel() {
      if (pending) { pending.reject(new SelectionCancelled()); pending = null; }
      stop();
    },
    /** Models already in this worker's memory. */
    loaded: () => new Set(loaded),
    busy: () => Boolean(pending),
    dispose() { this.cancel(); },
  };
}
