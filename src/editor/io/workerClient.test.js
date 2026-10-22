import { createImageWorker, createMainThreadClient, resetWorkerFallback, usingMainThread } from './workerClient.mjs';
import { browserCapabilities, clearDiagnostics, diagnosticEntries, diagnosticReport } from './diagnostics.mjs';
import { previewEdgeLimit } from './files.mjs';

/** Minimal Worker stand-in: `reply(message, post, fail)` decides what each request does. */
class FakeWorker extends EventTarget {
  constructor(reply) {
    super();
    this.reply = reply;
    this.terminated = false;
  }
  postMessage(message) {
    queueMicrotask(() => this.reply(message, (data) => this.dispatchEvent(Object.assign(new Event('message'), { data })), (text) => this.dispatchEvent(Object.assign(new Event('error'), { message: text }))));
  }
  terminate() { this.terminated = true; }
}

const source = { width: 1, height: 1, data: new Uint8ClampedArray([10, 20, 30, 255]) };

beforeEach(() => {
  resetWorkerFallback();
  clearDiagnostics();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('image worker client', () => {
  test('uses the worker when it works', async () => {
    const worker = new FakeWorker(({ id }, post) => post({ id, ok: true, result: 'from worker' }));
    const client = createImageWorker(() => worker);
    await expect(client.call('render', {})).resolves.toBe('from worker');
    expect(usingMainThread()).toBe(false);
  });

  test('falls back to the main thread when the worker script cannot start', async () => {
    const worker = new FakeWorker((message, post, fail) => fail('Refused to load the script'));
    const client = createImageWorker(() => worker);
    const result = await client.call('render', { source, adjustments: {} });
    expect(Array.from(result.data)).toEqual([10, 20, 30, 255]);
    expect(usingMainThread()).toBe(true);
    expect(worker.terminated).toBe(true);
    expect(diagnosticEntries()[0]).toMatchObject({ area: 'image-worker', level: 'warning' });
  });

  test('falls back when workers cannot decode images (no OffscreenCanvas)', async () => {
    const client = createImageWorker(() => new FakeWorker(({ id }, post) => post({ id, ok: false, error: { code: 'worker-canvas', message: 'no OffscreenCanvas' } })));
    await expect(client.call('render', { source, adjustments: { exposure: 1 } })).resolves.toMatchObject({ width: 1, height: 1 });
    expect(usingMainThread()).toBe(true);
  });

  test('falls back when module workers are not supported at all', async () => {
    const client = createImageWorker(() => { throw new TypeError('Module scripts are not supported'); });
    await expect(client.call('render', { source, adjustments: {} })).resolves.toMatchObject({ width: 1 });
    expect(diagnosticEntries()[0].message).toMatch(/Module workers are unavailable/);
  });

  test('a file error is reported, not treated as a worker problem', async () => {
    const client = createImageWorker(() => new FakeWorker(({ id }, post) => post({ id, ok: false, error: { code: 'corrupt', message: 'The file is empty.' } })));
    await expect(client.call('inspect', {})).rejects.toMatchObject({ code: 'corrupt', message: 'The file is empty.' });
    expect(usingMainThread()).toBe(false);
  });

  test('a crash after the worker has answered explains the likely memory cause', async () => {
    const client = createImageWorker(() => new FakeWorker(({ id }, post, fail) => { post({ id, progress: { stage: 'decoding' } }); fail(''); }));
    await expect(client.call('export', {})).rejects.toMatchObject({ code: 'worker-crashed', message: expect.stringMatching(/ran out of memory/) });
    expect(usingMainThread()).toBe(false);
  });

  test('main-thread tasks can be cancelled', async () => {
    let release;
    const client = createMainThreadClient(() => new Promise((resolve) => { release = () => resolve({ runTask: async () => ({ result: 'late' }) }); }));
    const pending = client.call('export', {});
    client.terminate();
    release();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  });
});

describe('diagnostics', () => {
  const browser = (overrides = {}) => ({
    createImageBitmap: () => {},
    document: { createElement: () => ({ getContext: () => ({}) }) },
    Blob: Object.assign(function Blob() {}, { prototype: { arrayBuffer() {} } }),
    File: function File() {},
    Worker: function Worker() {},
    navigator: { userAgent: 'test' },
    location: { pathname: '/photography/editor' },
    ...overrides,
  });

  test('lists only the APIs the editor cannot work without', () => {
    expect(browserCapabilities(browser()).missing).toEqual([]);
    expect(browserCapabilities(browser({ createImageBitmap: undefined })).missing).toEqual(['image decoding (createImageBitmap)']);
    // Workers, OffscreenCanvas, WebGL2 and crypto have fallbacks.
    const minimal = browserCapabilities(browser({ Worker: undefined }));
    expect(minimal).toMatchObject({ workers: false, offscreenCanvas: false, webgl2: false, cryptoSubtle: false, missing: [] });
  });

  test('the report holds capabilities and events, never photo data', () => {
    const report = JSON.parse(diagnosticReport({ previewEngine: 'cpu' }, browser()));
    expect(report).toMatchObject({ page: '/photography/editor', previewEngine: 'cpu', capabilities: { workers: true } });
    expect(Object.keys(report)).toEqual(['page', 'userAgent', 'capabilities', 'previewEngine', 'events']);
  });
});

describe('preview size limit', () => {
  const env = ({ coarse = false, screen = [1920, 1080], memory } = {}) => ({
    matchMedia: () => ({ matches: coarse }),
    screen: { width: screen[0], height: screen[1] },
    navigator: memory === undefined ? {} : { deviceMemory: memory },
  });

  test('desktops keep 4096 px; phones and low-memory devices get smaller proxies', () => {
    expect(previewEdgeLimit(env())).toBe(4096);
    expect(previewEdgeLimit(env({ coarse: true, screen: [390, 844] }))).toBe(3072);
    expect(previewEdgeLimit(env({ coarse: true, screen: [1366, 1024] }))).toBe(4096);
    expect(previewEdgeLimit(env({ memory: 4 }))).toBe(3072);
    expect(previewEdgeLimit(env({ memory: 2 }))).toBe(2048);
  });
});
