// RAW worker: LibRaw in WebAssembly, isolated from the page. One job per worker; the
// page terminates it afterwards (or to cancel), which frees the whole wasm heap.
// Same message protocol as the image worker; progress messages may carry a pixel band,
// which is transferred rather than copied.

import factory from 'libraw-wasm/dist/libraw.js';
import wasmUrl from 'libraw-wasm/dist/libraw.wasm?url';
import { createRawHandlers } from './rawTasks.mjs';

let modulePromise;
const loadModule = () => {
  // LibRaw's stdout/stderr stay out of the console; the last line explains failures.
  const options = { locateFile: () => wasmUrl, print: () => {}, printErr: (line) => { if (options.module) options.module.lastMessage = String(line); } };
  modulePromise ??= factory(options).then((module) => { options.module = module; return module; });
  return modulePromise;
};
const handlers = createRawHandlers(loadModule);

self.addEventListener('message', async ({ data: { id, type, payload } }) => {
  const progress = (value) => self.postMessage({ id, progress: value }, value.band ? [value.band.data.buffer] : []);
  try {
    const handler = handlers[type];
    if (!handler) throw new Error(`Unknown RAW task: ${type}`);
    const { result, transfer = [] } = await handler(payload, progress);
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (error) {
    self.postMessage({ id, ok: false, error: { code: error.code ?? 'failed', message: error.message || 'RAW processing failed.' } });
  }
});
