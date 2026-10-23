// @vitest-environment node
// RAW development: colour math, format sniffing, the genuine LibRaw decoder on
// synthetic DNGs with known sensor values, precision, worker tasks and the job queue.
// Genuine camera files are tested in rawFixtures.test.js when provided.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import factory from 'libraw-wasm/dist/libraw.js';
import { createSyntheticDng } from '../dev/dngFixture.mjs';
import {
  channelGains, kelvinTintToXy, multipliersForXy, multipliersToKelvinTint, planckianXy,
  rawDevelopParams, validColorMatrix, xyForMultipliers, xyToKelvinTint,
} from './rawColor.mjs';
import { decodeRaw, downsampleRaw } from './rawDecoder.mjs';
import { isTiff, sniffRaw } from './rawFormat.mjs';
import { createRawHandlers, needsFullDecode } from './rawTasks.mjs';
import { createRawQueue } from './rawClient.mjs';
import { ROLLOFF_KNEE, deriveParams, developRaw, highlightRolloff } from '../pipeline/spec.mjs';
import { encodeSrgb8, renderRawRgba8, renderRgba8 } from '../pipeline/cpuRenderer.mjs';
import { neutralAdjustments, normalizeAdjustments } from '../model/adjustments.mjs';

// LibRaw's ILCE-7M3 matrices (XYZ -> camera, and its camera -> linear sRGB).
const A7III_CAM_XYZ = [0.7374, -0.2389, -0.0551, -0.5435, 1.3162, 0.2519, -0.1006, 0.1795, 0.6552];
const A7III_PRE_MUL = [2.48767352, 0.93118888, 1.25425792];

let Module;
beforeAll(async () => {
  const wasmBinary = await readFile(fileURLToPath(import.meta.resolve('libraw-wasm/dist/libraw.wasm')));
  Module = await factory({ wasmBinary });
});

const pixel = (image, x, y) => Array.from(image.data.subarray((y * image.width + x) * 3, (y * image.width + x) * 3 + 3));
const dngFile = (bytes, name = 'synthetic.dng') => new File([bytes], name);

describe('RAW colour math', () => {
  test('D65 through the camera matrix reproduces LibRaw daylight multipliers', () => {
    const mul = multipliersForXy([0.3127, 0.329], A7III_CAM_XYZ);
    const expected = A7III_PRE_MUL.map((value) => value / A7III_PRE_MUL[1]);
    mul.forEach((value, c) => expect(value).toBeCloseTo(expected[c], 3));
  });

  test('temperature and tint round-trip through chromaticity and camera multipliers', () => {
    for (const [kelvin, tint] of [[2800, 0], [4300, 20], [5500, -30], [9000, 60]]) {
      const back = xyToKelvinTint(kelvinTintToXy(kelvin, tint));
      expect(back.kelvin).toBeCloseTo(kelvin, -1);
      expect(back.tint).toBeCloseTo(tint, 1);
      const mul = multipliersForXy(kelvinTintToXy(kelvin, tint), A7III_CAM_XYZ);
      expect(multipliersToKelvinTint(mul, A7III_CAM_XYZ)).toEqual({ temperature: Math.round(kelvin / 50) * 50, tint });
      const xy = xyForMultipliers(mul, A7III_CAM_XYZ);
      expect(xy[0]).toBeCloseTo(kelvinTintToXy(kelvin, tint)[0], 6);
    }
    // Warmer light needs more blue gain and less red; positive tint (greener light) less green.
    const warm = multipliersForXy(planckianXy(3000), A7III_CAM_XYZ);
    const cool = multipliersForXy(planckianXy(7500), A7III_CAM_XYZ);
    expect(warm[2]).toBeGreaterThan(cool[2]);
    expect(warm[0]).toBeLessThan(cool[0]);
  });

  test('as shot is the decoded data itself: only the sensor-white normalisation', () => {
    expect(channelGains([2, 1, 1.25], [2, 1, 1.25])).toEqual([2, 2, 2]);
    // A different white balance scales channels relative to the as-shot decode.
    expect(channelGains([2, 1, 1.25], [1, 1, 2.5])).toEqual([1, 2, 4]);
  });

  test('colour matrices must be real camera data', () => {
    expect(validColorMatrix([1, 0, 0, 0, 1, 0, 0, 0, 1])).toBe(true);
    expect(validColorMatrix([1.635, -0.422, -0.213, -0.131, 1.543, -0.412, 0.011, -0.42, 1.408])).toBe(true);
    expect(validColorMatrix([0, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(false);
    expect(validColorMatrix([2, 0, 0, 0, 1, 0, 0, 0, 1])).toBe(false);
    expect(validColorMatrix([1, 0, 0])).toBe(false);
  });
});

describe('RAW format sniffing (content, not file names)', () => {
  const tiff = ({ make = '', dng = false } = {}) => {
    const makeBytes = new TextEncoder().encode(`${make}\0`);
    const count = (make ? 1 : 0) + (dng ? 1 : 0) + 1;
    const bytes = new Uint8Array(64 + makeBytes.length);
    const view = new DataView(bytes.buffer);
    bytes.set([0x49, 0x49, 42, 0]);
    view.setUint32(4, 8, true);
    view.setUint16(8, count, true);
    let at = 10;
    const entry = (tag, type, n, value) => { view.setUint16(at, tag, true); view.setUint16(at + 2, type, true); view.setUint32(at + 4, n, true); view.setUint32(at + 8, value, true); at += 12; };
    entry(256, 4, 1, 100);
    if (make) entry(0x010f, 2, makeBytes.length, 56);
    if (dng) entry(0xc612, 1, 4, 0x00000401);
    bytes.set(makeBytes, 56);
    return bytes;
  };

  test('identifies Sony ARW and DNG, and rejects other TIFF-based files with a reason', () => {
    expect(sniffRaw(tiff({ make: 'SONY' }))).toBe('arw');
    expect(sniffRaw(tiff({ make: 'Canon', dng: true }))).toBe('dng');
    expect(sniffRaw(createSyntheticDng())).toBe('dng');
    expect(() => sniffRaw(tiff({ make: 'Canon' }))).toThrow(/Canon are not supported/);
    expect(() => sniffRaw(tiff())).toThrow(expect.objectContaining({ code: 'unsupported' }));
    expect(sniffRaw(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
    expect(isTiff(new Uint8Array([0x4d, 0x4d, 0, 42, 0, 0, 0, 8]))).toBe(true);
  });

  test('a damaged header is reported, never read out of bounds', () => {
    const broken = tiff({ make: 'SONY' }).slice(0, 20);
    expect(() => sniffRaw(broken)).toThrow(expect.objectContaining({ code: 'corrupt' }));
    const badOffset = tiff({ make: 'SONY' });
    new DataView(badOffset.buffer).setUint32(4, 1e9, true);
    expect(() => sniffRaw(badOffset)).toThrow(expect.objectContaining({ code: 'corrupt' }));
  });
});

describe('LibRaw decoding of DNG sensor data', () => {
  const grey = 0.18;
  const scene = (x, y) => (y < 4 ? [1, 1, 1] : x < 32 ? [grey, grey, grey] : [0.5, 0.3, 0.1]);

  test('reads sensor values, black and white levels, white balance and exposure metadata', () => {
    const { info, image } = decodeRaw(Module, createSyntheticDng({ scene }), { format: 'dng' });
    expect(info).toMatchObject({ format: 'dng', make: 'Synthetic', model: 'Test DNG', width: 64, height: 48, blackLevel: 512, whiteLevel: 16383, asShotAvailable: true, aperture: expect.closeTo(5.6, 3), shutter: expect.closeTo(1 / 125, 6) });
    expect(info.asShot).toEqual([2, 1, 1.25]);
    expect(image).toMatchObject({ kind: 'raw', width: 64, height: 48 });
    expect(image.data).toBeInstanceOf(Uint16Array);
    // Unclipped decode, white balanced and normalised by the largest multiplier (2).
    pixel(image, 12, 24).forEach((value) => expect(value / 65535).toBeCloseTo(grey / 2, 3));
    expect(pixel(image, 50, 24).map((value) => value / 65535)).toEqual([expect.closeTo(0.25, 3), expect.closeTo(0.15, 3), expect.closeTo(0.05, 3)]);
  });

  test('development gives neutral grey and clips the sensor white to display white', () => {
    const { info, image } = decodeRaw(Module, createSyntheticDng({ scene }), { format: 'dng' });
    const params = deriveParams(neutralAdjustments(), { raw: info });
    const out = renderRawRgba8(image.data, params);
    const at = (x, y) => Array.from(out.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4));
    const code = encodeSrgb8(grey);
    at(12, 24).slice(0, 3).forEach((value) => expect(Math.abs(value - code)).toBeLessThanOrEqual(1));
    expect(at(12, 1)).toEqual([255, 255, 255, 255]);
    // Colour patch: camera = linear sRGB in this file, so the patch keeps its ratios.
    expect(at(50, 24).slice(0, 3)).toEqual([0.5, 0.3, 0.1].map((v) => expect.closeTo(encodeSrgb8(v), -0.5)));
  });

  test('custom white balance equals decoding with those multipliers (LibRaw)', () => {
    const bytes = createSyntheticDng({ scene });
    const { info, image } = decodeRaw(Module, bytes, { format: 'dng' });
    const settings = { whiteBalance: 'custom', temperature: 4000, tint: 10 };
    const { gain, multipliers } = rawDevelopParams(info, settings);
    const raw = new Module.LibRaw();
    let reference;
    try {
      raw.open(bytes.slice(), { outputBps: 16, outputColor: 0, gamm: [1, 1, 0, 0, 0, 0], noAutoBright: true, highlight: 0, userMul: [...multipliers, multipliers[1]], userQual: 3 });
      reference = raw.imageData();
    } finally {
      raw.delete();
    }
    // Exact away from edges. AHD demosaicing depends on the balance it runs with, so
    // within a few pixels of the hard synthetic edges (rows 3–4, column 31–32) it differs.
    let worst = 0;
    for (let y = 0; y < 48; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        if (Math.abs(y - 3.5) < 4 || Math.abs(x - 31.5) < 4 || x < 2 || y > 45 || x > 61) continue;
        const i = (y * 64 + x) * 3;
        for (let c = 0; c < 3; c += 1) worst = Math.max(worst, Math.abs(Math.min(65535, image.data[i + c] * gain[c]) - reference.data[i + c]));
      }
    }
    expect(worst).toBeLessThanOrEqual(4);
  });

  test('applies orientation and decodes half size from 2×2 sensor blocks', () => {
    const rotated = decodeRaw(Module, createSyntheticDng({ orientation: 6, scene }), { format: 'dng' });
    expect(rotated.info).toMatchObject({ width: 48, height: 64, flip: 6 });
    expect([rotated.image.width, rotated.image.height]).toEqual([48, 64]);
    // Rotated 90° clockwise: the clipped top rows are now the right-hand columns.
    expect(pixel(rotated.image, 47, 30)).toEqual(pixel(rotated.image, 46, 30));
    expect(pixel(rotated.image, 47, 30)[1]).toBeGreaterThan(pixel(rotated.image, 10, 30)[1]);
    const half = decodeRaw(Module, createSyntheticDng({ scene }), { format: 'dng', halfSize: true });
    expect([half.image.width, half.image.height]).toEqual([32, 24]);
    pixel(half.image, 6, 12).forEach((value) => expect(value / 65535).toBeCloseTo(grey / 2, 3));
  });

  test('rejects files without colour data, damaged files and non-RAW data, and always frees LibRaw', () => {
    const deleted = vi.spyOn(Module.LibRaw.prototype, 'delete');
    expect(() => decodeRaw(Module, createSyntheticDng({ colorMatrix: [0, 0, 0, 0, 0, 0, 0, 0, 0] }), { format: 'dng' })).toThrow(/no colour data/);
    expect(() => decodeRaw(Module, createSyntheticDng().slice(0, 300), { format: 'dng' })).toThrow(expect.objectContaining({ code: 'corrupt' }));
    expect(() => decodeRaw(Module, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]), { format: 'dng' })).toThrow(expect.objectContaining({ code: 'corrupt' }));
    expect(deleted).toHaveBeenCalledTimes(3);
    deleted.mockRestore();
  });
});

describe('RAW pipeline', () => {
  const info = { asShot: [2, 1, 1.25], rgbCam: [1, 0, 0, 0, 1, 0, 0, 0, 1], camXyz: [3.24, -1.54, -0.5, -0.97, 1.88, 0.04, 0.06, -0.2, 1.06], width: 4, height: 1 };

  test('highlight rolloff is identity below the knee, smooth, monotonic, and maps the sensor white to 1', () => {
    for (const white of [1.5, 2, 8, 32]) {
      expect(highlightRolloff(0.3, white)).toBe(0.3);
      expect(highlightRolloff(white, white)).toBeCloseTo(1, 12);
      let last = 0;
      for (let y = 0; y <= white; y += white / 500) {
        const value = highlightRolloff(y, white);
        expect(value).toBeGreaterThanOrEqual(last);
        last = value;
      }
      const slope = (highlightRolloff(ROLLOFF_KNEE + 1e-6, white) - ROLLOFF_KNEE) / 1e-6;
      expect(slope).toBeCloseTo(1, 4);
    }
    expect(deriveParams(normalizeAdjustments({ exposure: -1 }), { raw: info }).rolloffWhite).toBe(0);
    expect(deriveParams(normalizeAdjustments({ exposure: 1 }), { raw: info }).rolloffWhite).toBe(2);
    expect(deriveParams(normalizeAdjustments({ exposure: 1 })).rolloffWhite).toBe(0);
  });

  test('RAW sources are always developed; raster parameters are unchanged', () => {
    const raw = deriveParams(neutralAdjustments(), { raw: info });
    expect(raw).toMatchObject({ neutral: false, baseNeutral: false, raw: { gain: [2, 2, 2] } });
    expect(deriveParams(neutralAdjustments())).toMatchObject({ neutral: true, raw: null });
    const out = [0, 0, 0];
    expect(developRaw(0.5, 0.6, 0.9, raw.raw, out)).toEqual([1, 1, 1]);
    expect(developRaw(0.05, 0.1, 0.2, raw.raw, out)).toEqual([0.1, 0.2, 0.4]);
  });

  test('keeps sensor precision: a pushed shadow gradient keeps far more levels than an 8-bit source', () => {
    // 1024 steps across the darkest 1/64 of the range, pushed +5 EV.
    const steps = 1024;
    const source = new Uint16Array(steps * 3);
    for (let i = 0; i < steps; i += 1) source.fill(Math.round((i / steps) * (65535 / 64) / 2), i * 3, i * 3 + 3);
    const params = deriveParams(normalizeAdjustments({ exposure: 5 }), { raw: info });
    const rawOut = renderRawRgba8(source, params);
    // The same scene quantised to an 8-bit sRGB file first, then pushed by the raster path.
    const eight = new Uint8ClampedArray(steps * 4);
    for (let i = 0; i < steps; i += 1) {
      const code = encodeSrgb8(((source[i * 3] / 65535) * 2));
      eight.set([code, code, code, 255], i * 4);
    }
    const rasterOut = renderRgba8(eight, deriveParams(normalizeAdjustments({ exposure: 5 })));
    const levels = (data) => new Set(Array.from({ length: steps }, (_, i) => data[i * 4])).size;
    expect(levels(rawOut)).toBeGreaterThan(150);
    expect(levels(rawOut)).toBeGreaterThan(levels(rasterOut) * 3);
  });

  test('downsampling averages in linear light and never upscales', () => {
    const image = { kind: 'raw', width: 4, height: 2, data: Uint16Array.from([0, 0, 0, 100, 100, 100, 10, 20, 30, 30, 40, 50, 0, 0, 0, 100, 100, 100, 10, 20, 30, 30, 40, 50]) };
    expect(downsampleRaw(image, 2, 1).data).toEqual(Uint16Array.from([50, 50, 50, 20, 30, 40]));
    expect(downsampleRaw(image, 8, 4)).toBe(image);
  });
});

describe('RAW worker tasks', () => {
  const handlers = createRawHandlers(async () => Module);
  const scene = (x, y) => [((x + y) % 16) / 20, 0.2, 0.1];

  test('inspect validates, hashes, and makes a thumbnail from sensor data', async () => {
    const progress = vi.fn();
    const { result, transfer } = await handlers.inspect({ file: dngFile(createSyntheticDng({ scene })), thumbnailEdge: 16 }, progress);
    expect(result.header).toMatchObject({ format: 'dng', displayWidth: 64, displayHeight: 48 });
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.thumbnail).toMatchObject({ kind: 'raw', width: 16, height: 12 });
    expect(transfer).toEqual([result.thumbnail.data.buffer]);
    expect(progress).toHaveBeenCalledWith({ stage: 'decoding' });
    await expect(handlers.inspect({ file: dngFile(new TextEncoder().encode('not a raw')), thumbnailEdge: 16 }, vi.fn())).rejects.toMatchObject({ code: 'unsupported' });
    await expect(handlers.inspect({ file: dngFile(new Uint8Array()), thumbnailEdge: 16 }, vi.fn())).rejects.toMatchObject({ code: 'corrupt' });
  });

  test('export renders bands from the RAW data at the requested size, matching the preview renderer', async () => {
    const bytes = createSyntheticDng({ scene });
    const { info, image } = decodeRaw(Module, bytes, { format: 'dng' });
    const adjustments = normalizeAdjustments({ exposure: 0.5, contrast: 30, raw: { whiteBalance: 'daylight' }, curves: { master: [[0, 10], [255, 245]] } });
    const bands = [];
    const run = (resize) => handlers.export({ file: dngFile(bytes), raw: info, adjustments, settings: { format: 'png', resize } }, ({ band }) => band && bands.push(band));
    const full = await run({ mode: 'original' });
    expect(full).toMatchObject({ result: { width: 64, height: 48, source: 'full' } });
    const assembled = new Uint8ClampedArray(64 * 48 * 4);
    bands.forEach(({ row, data }) => assembled.set(data, row * 64 * 4));
    expect(assembled).toEqual(renderRawRgba8(image.data, deriveParams(adjustments, { raw: info })));
    bands.length = 0;
    const small = await run({ mode: 'long-edge', longEdge: 32 });
    expect(small.result).toMatchObject({ width: 32, height: 24, source: 'half' });
    expect(bands.reduce((sum, band) => sum + band.rows, 0)).toBe(24);
    expect(needsFullDecode(info, { width: 33, height: 25 })).toBe(true);
  });

  // Creating LibRaw's shared wasm memory after the whole file had been read crashed
  // Playwright's Windows WebKit (docs/photography-editor.md, Known issues).
  test('every task instantiates LibRaw after reading only the header, before the whole file', async () => {
    const bytes = createSyntheticDng({ scene });
    const { info } = decodeRaw(Module, bytes, { format: 'dng' });
    const order = [];
    const file = {
      size: bytes.length,
      slice: (start, end) => ({ arrayBuffer: async () => { order.push('header'); return bytes.slice(start, end).buffer; } }),
      arrayBuffer: async () => { order.push('file'); return bytes.slice().buffer; },
    };
    const tracked = createRawHandlers(async () => { order.push('libraw'); return Module; });
    const settings = { format: 'png', resize: { mode: 'original' } };
    const runs = {
      inspect: () => tracked.inspect({ file, thumbnailEdge: 16 }, () => {}),
      decode: () => tracked.decode({ file, maxEdge: 64 }),
      develop: () => tracked.develop({ file, raw: info, width: 64, height: 48 }),
      region: () => tracked.region({ file, raw: info, rect: { x: 0, y: 0, width: 16, height: 16 } }),
      export: () => tracked.export({ file, raw: info, adjustments: neutralAdjustments(), settings }, () => {}),
    };
    for (const [name, run] of Object.entries(runs)) {
      order.length = 0;
      await run();
      expect(order, name).toEqual(['header', 'libraw', 'file']);
    }
    order.length = 0;
    await expect(tracked.decode({ file: { ...file, size: 0 }, maxEdge: 64 })).rejects.toMatchObject({ code: 'corrupt' });
    expect(order).toEqual([]);
  });

  test('export refuses a file that no longer matches the imported one', async () => {
    const { info } = decodeRaw(Module, createSyntheticDng(), { format: 'dng' });
    await expect(handlers.export({ file: dngFile(createSyntheticDng({ width: 32, height: 32 })), raw: info, adjustments: neutralAdjustments(), settings: { format: 'png', resize: { mode: 'original' } } }, vi.fn()))
      .rejects.toThrow(/changed since it was imported/);
  });
});

describe('RAW job queue', () => {
  // A fake worker that answers each message when `finish` is called.
  function fakeWorkers() {
    const started = [];
    const spawn = () => {
      const listeners = {};
      const worker = {
        terminated: false,
        addEventListener: (type, fn) => { listeners[type] = fn; },
        postMessage: ({ id, type }) => { worker.message = { id, type }; started.push(worker); },
        terminate: () => { worker.terminated = true; },
        finish: (result = {}) => listeners.message({ data: { id: worker.message.id, ok: true, result } }),
        progress: (value) => listeners.message({ data: { id: worker.message.id, progress: value } }),
        crash: () => listeners.error({ preventDefault() {} }),
      };
      return worker;
    };
    return { spawn, started };
  }
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  test('runs at most `limit` decoders, previews first, and ends each worker after its job', async () => {
    const { spawn, started } = fakeWorkers();
    const queue = createRawQueue({ spawn, limit: 1 });
    const first = queue.run('inspect', {});
    const second = queue.run('inspect', {});
    const preview = queue.run('decode', {});
    expect(started.map((w) => w.message.type)).toEqual(['inspect']);
    expect(queue.waiting).toBe(2);
    started[0].finish({ n: 1 });
    await expect(first.promise).resolves.toEqual({ n: 1 });
    await flush();
    expect(started[0].terminated).toBe(true);
    expect(started.map((w) => w.message.type)).toEqual(['inspect', 'decode']);
    started[1].finish();
    await preview.promise;
    await flush();
    started[2].finish();
    await second.promise;
    await flush();
    expect(queue.running).toBe(0);
  });

  test('cancel removes a waiting job or ends a running worker', async () => {
    const { spawn, started } = fakeWorkers();
    const queue = createRawQueue({ spawn, limit: 1 });
    const running = queue.run('export', {});
    const waiting = queue.run('inspect', {});
    waiting.cancel();
    await expect(waiting.promise).rejects.toMatchObject({ code: 'cancelled' });
    running.cancel();
    expect(started[0].terminated).toBe(true);
    await expect(running.promise).rejects.toMatchObject({ code: 'cancelled' });
    await flush();
    expect(queue.running).toBe(0);
    expect(started).toHaveLength(1);
  });

  test('a decoder that cannot start or crashes is reported plainly', async () => {
    const queue = createRawQueue({ spawn: () => { throw new Error('blocked'); }, limit: 1 });
    await expect(queue.run('inspect', {}).promise).rejects.toMatchObject({ code: 'worker-failed', message: expect.stringMatching(/RAW decoder could not start/) });
    // A worker that has answered once and then dies was most likely stopped for memory.
    const { spawn, started } = fakeWorkers();
    const crashing = createRawQueue({ spawn, limit: 1 });
    const job = crashing.run('export', {}, { onProgress: () => {} });
    started[0].progress({ stage: 'decoding' });
    started[0].crash();
    await expect(job.promise).rejects.toMatchObject({ code: 'memory', message: expect.stringMatching(/ran out of memory/) });
  });
});
