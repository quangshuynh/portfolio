// RAW worker: LibRaw in WebAssembly, isolated from the page. One job per worker; the
// page terminates it afterwards (or to cancel), which frees the whole wasm heap.
// Same message protocol as the image worker; progress messages may carry a pixel band,
// which is transferred rather than copied. It also says when it has started ({ ready }) and
// sends a heartbeat every second while its thread is free, and each job reports checkpoints
// ({ checkpoint, ms, wasmBytes }): the page's watchdog (rawClient.mjs) uses them to tell a
// slow decode from a decoder that has stopped.

import factory from 'libraw-wasm/dist/libraw.js';
import wasmUrl from 'libraw-wasm/dist/libraw.wasm?url';
import { createRawHandlers } from './rawTasks.mjs';
import { RAW_WATCHDOG } from './rawTrace.mjs';

// libraw-wasm 1.6.0's own defaults (256 MB initial, 2 GB maximum, shared), created here so the
// worker can report the heap's size in its checkpoints; the module would create the same.
const WASM_PAGE = 65536;
const MEMORY = { initial: (256 * 1024 * 1024) / WASM_PAGE, maximum: 32768, shared: true };
let memory = null;
let modulePromise;
const loadModule = () => {
  modulePromise ??= Promise.resolve().then(() => {
    memory = new WebAssembly.Memory(MEMORY);
    // LibRaw's stdout/stderr stay out of the console; the last line explains failures.
    const options = { wasmMemory: memory, locateFile: () => wasmUrl, print: () => {}, printErr: (line) => { if (options.module) options.module.lastMessage = String(line); } };
    return factory(options).then((module) => { options.module = module; return module; });
  });
  return modulePromise;
};
const handlers = createRawHandlers(loadModule);
const wasmBytes = () => {
  try { return memory?.buffer.byteLength ?? null; } catch { return null; }
};

self.addEventListener('message', async ({ data: { id, type, payload } }) => {
  const started = performance.now();
  const progress = (value) => {
    const message = value.checkpoint ? { ...value, ms: Math.round(performance.now() - started), wasmBytes: wasmBytes() } : value;
    self.postMessage({ id, progress: message }, value.band ? [value.band.data.buffer] : []);
  };
  try {
    const handler = handlers[type];
    if (!handler) throw new Error(`Unknown RAW task: ${type}`);
    const { result, transfer = [] } = await handler(payload, progress);
    progress({ checkpoint: 'transferring' });
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (error) {
    self.postMessage({ id, ok: false, error: { code: error.code ?? 'failed', message: error.message || 'RAW processing failed.' } });
  }
});

self.postMessage({ ready: true });
setInterval(() => self.postMessage({ heartbeat: true }), RAW_WATCHDOG.tickMs);
