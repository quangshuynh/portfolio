// Runs one content-aware fill (pipeline/inpaint.mjs) off the page, reporting progress.
import { inpaint } from './inpaint.mjs';

self.onmessage = ({ data }) => {
  try {
    const filled = inpaint(data.payload, { onProgress: (fraction) => self.postMessage({ type: 'progress', id: data.id, fraction }) });
    self.postMessage({ type: 'done', id: data.id, filled }, [filled.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', id: data.id, message: String(error?.message ?? error) });
  }
};
