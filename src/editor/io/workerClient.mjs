// Promise wrapper around the image worker. `terminate()` is the cancellation path for
// work that cannot be interrupted mid-loop (decode, export): pending calls reject.

export class WorkerCancelled extends Error {
  constructor() {
    super('Cancelled.');
    this.code = 'cancelled';
  }
}

export function createImageWorker() {
  const worker = new Worker(new URL('./imageWorker.mjs', import.meta.url), { type: 'module' });
  return createWorkerClient(worker);
}

export function createWorkerClient(worker) {
  let nextId = 0;
  const pending = new Map();

  worker.addEventListener('message', ({ data }) => {
    const call = pending.get(data.id);
    if (!call) return;
    if (data.progress) { call.onProgress?.(data.progress); return; }
    pending.delete(data.id);
    if (data.ok) call.resolve(data.result);
    else call.reject(Object.assign(new Error(data.error.message), { code: data.error.code }));
  });
  worker.addEventListener('error', (event) => {
    pending.forEach((call) => call.reject(new Error(event.message || 'The image worker stopped unexpectedly.')));
    pending.clear();
  });

  return {
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
