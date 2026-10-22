// Image worker: runs imageTasks.mjs off the main thread. Before any task it checks
// that this worker can decode images (OffscreenCanvas 2D); if not, the client
// switches to running the tasks on the main thread.

import { runTask } from './imageTasks.mjs';

const workerCanvas = () => {
  try {
    return typeof OffscreenCanvas === 'function' && Boolean(new OffscreenCanvas(1, 1).getContext('2d'));
  } catch {
    return false;
  }
};
const canDecode = workerCanvas() && typeof createImageBitmap === 'function';

self.addEventListener('message', async ({ data: { id, type, payload } }) => {
  const progress = (value) => self.postMessage({ id, progress: value });
  try {
    if (type !== 'render' && !canDecode) {
      throw Object.assign(new Error('This browser cannot decode images in a background worker.'), { code: 'worker-canvas' });
    }
    const { result, transfer = [] } = await runTask(type, payload, progress);
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (error) {
    self.postMessage({ id, ok: false, error: { code: error.code ?? 'failed', message: error.message || 'Processing failed.' } });
  }
});
