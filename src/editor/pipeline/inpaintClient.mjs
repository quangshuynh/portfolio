// Content-aware fills in a dedicated worker, one at a time. Cancelling ends the worker (a fill
// cannot be interrupted mid-iteration from outside); the next fill starts a fresh one.
import { InpaintCancelled } from './inpaint.mjs';

export function createInpaintRunner(spawn = () => new Worker(new URL('./inpaintWorker.mjs', import.meta.url), { type: 'module' })) {
  let worker = null;
  let pending = null;
  let nextId = 1;
  const stop = () => { worker?.terminate(); worker = null; };
  return {
    /** :returns: a promise of the filled colour; `onProgress(fraction)` while it runs */
    run(payload, onProgress = () => {}) {
      if (pending) pending.reject(new InpaintCancelled());
      worker ??= spawn();
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        pending = { id, resolve, reject };
        worker.onmessage = ({ data }) => {
          if (data.id !== id) return;
          if (data.type === 'progress') { onProgress(data.fraction); return; }
          pending = null;
          if (data.type === 'done') resolve(data.filled);
          else reject(new Error(data.message));
        };
        worker.onerror = (event) => { pending = null; stop(); reject(new Error(event.message || 'The fill worker failed.')); };
        worker.postMessage({ id, payload }, [payload.color.buffer, payload.hole.buffer, payload.allowed.buffer]);
      });
    },
    cancel() {
      if (pending) { pending.reject(new InpaintCancelled()); pending = null; }
      stop();
    },
    dispose() { this.cancel(); },
  };
}
