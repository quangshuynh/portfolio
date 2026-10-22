// Promise wrapper around the image worker. `terminate()` is the cancellation path for
// work that cannot be interrupted mid-loop (decode, export): pending calls reject.
//
// Where module workers cannot start, or cannot decode images (no OffscreenCanvas in
// workers: Safari before 16.4), the same tasks run on the main thread instead. The
// switch is made once, recorded in the diagnostics, and the failed call is retried.

import { recordDiagnostic } from './diagnostics.mjs';

export class WorkerCancelled extends Error {
  constructor() {
    super('Cancelled.');
    this.code = 'cancelled';
  }
}

// Errors that mean "this browser's workers cannot do the job", not "this file is bad".
const FALLBACK_CODES = new Set(['worker-canvas', 'worker-failed']);
let mainThreadOnly = false;

/** True once the editor has switched to main-thread image processing. */
export const usingMainThread = () => mainThreadOnly;

export function switchToMainThread(reason) {
  if (!mainThreadOnly) recordDiagnostic('image-worker', reason, 'warning');
  mainThreadOnly = true;
}

/** Test hook: forget an earlier switch to the main thread. */
export function resetWorkerFallback() {
  mainThreadOnly = false;
}

function spawnWorker() {
  return new Worker(new URL('./imageWorker.mjs', import.meta.url), { type: 'module' });
}

/**
 * A client for image tasks: a module worker when possible, else the main thread.
 * :param spawn: worker factory (tests pass a fake)
 */
export function createImageWorker(spawn = spawnWorker) {
  let delegate = null;
  const choose = () => {
    if (delegate && !(mainThreadOnly && delegate.kind === 'worker')) return delegate;
    delegate?.terminate();
    if (!mainThreadOnly) {
      try {
        delegate = createWorkerClient(spawn());
        return delegate;
      } catch (error) {
        switchToMainThread(`Module workers are unavailable: ${error.message}`);
      }
    }
    delegate = createMainThreadClient();
    return delegate;
  };
  return {
    async call(type, payload, options = {}) {
      const client = choose();
      try {
        return await client.call(type, payload, options);
      } catch (error) {
        if (client.kind !== 'worker' || !FALLBACK_CODES.has(error.code)) throw error;
        switchToMainThread(error.message);
        return choose().call(type, payload, { ...options, transfer: [] });
      }
    },
    terminate() {
      delegate?.terminate();
      delegate = null;
    },
  };
}

export function createWorkerClient(worker) {
  let nextId = 0;
  const pending = new Map();
  let answered = false;

  worker.addEventListener('message', ({ data }) => {
    answered = true;
    const call = pending.get(data.id);
    if (!call) return;
    if (data.progress) { call.onProgress?.(data.progress); return; }
    pending.delete(data.id);
    if (data.ok) call.resolve(data.result);
    else call.reject(Object.assign(new Error(data.error.message), { code: data.error.code }));
  });
  worker.addEventListener('error', (event) => {
    event.preventDefault?.();
    // An error before any reply means the worker script itself did not start
    // (blocked, failed to load, or unsupported syntax): fall back. Later errors are
    // crashes, usually the browser stopping a worker that ran out of memory.
    const error = answered
      ? Object.assign(new Error('The image worker stopped unexpectedly, possibly because the device ran out of memory. Try a smaller export size.'), { code: 'worker-crashed' })
      : Object.assign(new Error(`The image worker could not start${event.message ? `: ${event.message}` : ''}.`), { code: 'worker-failed' });
    pending.forEach((call) => call.reject(error));
    pending.clear();
  });

  return {
    kind: 'worker',
    call(type, payload, { transfer = [], onProgress } = {}) {
      const id = (nextId += 1);
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, onProgress });
        worker.postMessage({ id, type, payload }, transfer);
      });
    },
    terminate() {
      worker.terminate();
      pending.forEach((call) => call.reject(new WorkerCancelled()));
      pending.clear();
    },
  };
}

/**
 * Runs image tasks on the main thread. Long tasks yield between bands so the page
 * stays responsive; terminate() cancels at the next band and rejects pending calls.
 */
export function createMainThreadClient(loadTasks = () => import('./imageTasks.mjs')) {
  const signal = { cancelled: false, yield: () => new Promise((resolve) => setTimeout(resolve, 0)) };
  const pending = new Set();
  return {
    kind: 'main-thread',
    call(type, payload, { onProgress } = {}) {
      return new Promise((resolve, reject) => {
        const call = { reject };
        pending.add(call);
        loadTasks()
          .then(({ runTask }) => runTask(type, payload, (value) => !signal.cancelled && onProgress?.(value), signal))
          .then(({ result }) => (signal.cancelled ? reject(new WorkerCancelled()) : resolve(result)))
          .catch((error) => reject(signal.cancelled ? new WorkerCancelled() : error))
          .finally(() => pending.delete(call));
      });
    },
    terminate() {
      signal.cancelled = true;
      pending.forEach((call) => call.reject(new WorkerCancelled()));
      pending.clear();
    },
  };
}
