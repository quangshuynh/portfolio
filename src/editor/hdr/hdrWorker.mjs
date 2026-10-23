// HDR worker: merges brackets off the page. One job per worker; the page terminates it
// afterwards or to cancel. Same message protocol as the image and RAW workers;
// progress messages may carry a pixel band, which is transferred rather than copied.

import { runHdrTask } from './hdrTasks.mjs';

self.addEventListener('message', async ({ data: { id, type, payload } }) => {
  const progress = (value) => self.postMessage({ id, progress: value }, value.band ? [value.band.data.buffer] : []);
  try {
    const { result, transfer = [] } = await runHdrTask(type, payload, progress);
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (error) {
    self.postMessage({ id, ok: false, error: { code: error.code ?? 'failed', message: error.message || 'HDR merging failed.' } });
  }
});
