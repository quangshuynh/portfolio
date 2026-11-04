// The page's side of intelligent selections: one worker (selectionWorker.mjs), one selection at a
// time. Cancelling ends the worker (a model run cannot be interrupted from outside); so does
// being idle for IDLE_MS, which returns the models' memory (hundreds of megabytes) to the device.
// The next selection starts a fresh worker; models then come from the browser's HTTP cache.
import { SELECTION_KINDS } from './models.mjs';

export const IDLE_MS = 90_000;
// A selection that sends nothing for this long is stopped: the worker may have been suspended in
// the background or have died without an error event (mobile browsers do both). The longest
// single step measured is Firefox's first Subject, about a minute (docs/photography-editor.md).
export const STALL_MS = 180_000;
// Errors after which the worker is not reused: its memory or models may be in a bad state.
const FRESH_WORKER = new Set(['out-of-memory', 'model-corrupt', 'worker-failed', 'timeout']);

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
export function createSelectionRunner({ spawn = () => new Worker(new URL('./selectionWorker.mjs', import.meta.url), { type: 'module' }), base, idleMs = IDLE_MS, stallMs = STALL_MS } = {}) {
  let worker = null;
  let pending = null;
  let nextId = 1;
  let idle = 0;
  let stall = 0;
  // Models the current worker has loaded (what a new selection still downloads or reads from cache).
  let loaded = new Set();
  const stop = () => { clearTimeout(idle); clearTimeout(stall); worker?.terminate(); worker = null; loaded = new Set(); };
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
        const watch = () => {
          clearTimeout(stall);
          stall = setTimeout(() => {
            if (pending?.id !== id) return;
            pending = null;
            stop();
            const error = new Error('The selection stopped responding and was ended. Try again; on a phone, keep the page open while it works.');
            error.code = 'timeout';
            reject(error);
          }, stallMs);
        };
        watch();
        worker.onmessage = ({ data }) => {
          if (data.id !== id) return;
          watch();
          if (data.type === 'progress') {
            if (data.progress.stage === 'prepare') loaded.add(data.progress.model);
            onProgress(data.progress);
            return;
          }
          pending = null;
          clearTimeout(stall);
          rest();
          if (data.type === 'done') {
            SELECTION_KINDS[request.kind].models.forEach((name) => loaded.add(name));
            resolve(data.result);
          } else {
            const error = new Error(data.message);
            error.code = data.code;
            if (FRESH_WORKER.has(data.code)) stop();
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
    /**
     * Ends an idle worker at once (the page was hidden): WebAssembly memory only returns to the
     * device when the worker ends, and a backgrounded tab is the first a phone reclaims.
     */
    trim() {
      if (!pending) stop();
    },
    /** Models already in this worker's memory. */
    loaded: () => new Set(loaded),
    busy: () => Boolean(pending),
    dispose() { this.cancel(); },
  };
}
