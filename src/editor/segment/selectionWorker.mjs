// Intelligent selections off the page (Interval 23): onnxruntime-web on WebAssembly, one thread
// (the site is not cross-origin isolated, and the editor's other workers need the cores), with the
// models fetched from this site and checked against their SHA-256 before use. Messages:
//   { id, type: 'select', base, request } → progress { stage, model?, fraction? }, then done or error
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { MODEL_DIR, MODELS } from './models.mjs';
import { SelectionError, createSegmenter } from './segmenter.mjs';

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = { wasm: new URL(wasmUrl, self.location.href).href };

let base = '';
let report = () => {};

const hex = (buffer) => Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');

async function loadModel(name, onProgress) {
  const model = MODELS[name];
  let response;
  try {
    response = await fetch(new URL(`${MODEL_DIR}${model.file}`, base).href, { credentials: 'same-origin' });
  } catch {
    throw new SelectionError('The selection model could not be downloaded. Check the connection and try again.', 'model-download');
  }
  if (!response.ok) throw new SelectionError(`The selection model could not be downloaded (HTTP ${response.status}).`, 'model-download');
  const bytes = new Uint8Array(model.bytes);
  let offset = 0;
  const reader = response.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read(); // eslint-disable-line no-await-in-loop
      if (done) break;
      if (offset + value.length > bytes.length) throw new SelectionError('The selection model is not the expected file.', 'model-corrupt');
      bytes.set(value, offset);
      offset += value.length;
      onProgress(offset / bytes.length);
    }
  } else {
    const all = new Uint8Array(await response.arrayBuffer());
    if (all.length > bytes.length) throw new SelectionError('The selection model is not the expected file.', 'model-corrupt');
    bytes.set(all);
    offset = all.length;
  }
  if (offset !== bytes.length) throw new SelectionError('The selection model download was incomplete. Try again.', 'model-download');
  // Without a secure context (a plain-HTTP preview) there is no digest: the size check stands alone.
  if (globalThis.crypto?.subtle) {
    const digest = hex(await crypto.subtle.digest('SHA-256', bytes));
    if (digest !== model.sha256) throw new SelectionError('The selection model is not the expected file.', 'model-corrupt');
  }
  return bytes;
}

const segmenter = createSegmenter({ ort, loadModel, sessionOptions: { executionProviders: ['wasm'], graphOptimizationLevel: 'all' } });

self.onmessage = async ({ data }) => {
  const { id } = data;
  if (data.type !== 'select') return;
  base = data.base;
  report = (progress) => self.postMessage({ type: 'progress', id, progress });
  try {
    const result = await segmenter.select(data.request, report);
    self.postMessage({ type: 'done', id, result });
  } catch (error) {
    const memory = error instanceof RangeError || /memory|allocation|bad_alloc/i.test(String(error?.message));
    self.postMessage({
      type: 'error',
      id,
      code: error.code ?? (memory ? 'out-of-memory' : 'failed'),
      message: memory ? 'This device ran out of memory for the selection. Close other tabs or select on a smaller photo.' : String(error?.message ?? error),
    });
  }
};
