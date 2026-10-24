// @vitest-environment node
import { detailWorkerCount, renderDetailParallel, renderPixelsParallel } from './detailPool.mjs';
import { renderRawRgba8, renderRgba8 } from '../pipeline/cpuRenderer.mjs';
import { normalizeAdjustments } from '../model/adjustments.mjs';
import { lookLut } from '../dev/lutFixtures.mjs';
import { runTask } from './imageTasks.mjs';
import { renderDetailImage } from '../pipeline/detailRenderer.mjs';
import { deriveParams } from '../pipeline/spec.mjs';
import { SYNTHETIC_RAW_INFO } from '../dev/hdrFixtures.mjs';

/** A Worker stand-in running image tasks in this process, with the worker message protocol. */
function fakeWorker(log) {
  const listeners = [];
  return {
    addEventListener: (type, listener) => type === 'message' && listeners.push(listener),
    postMessage({ id, type, payload }) {
      log.push(type);
      setTimeout(async () => {
        try {
          const { result } = await runTask(type, structuredClone(payload), () => {});
          listeners.forEach((listener) => listener({ data: { id, ok: true, result } }));
        } catch (error) {
          listeners.forEach((listener) => listener({ data: { id, ok: false, error: { code: error.code, message: error.message } } }));
        }
      }, 0);
    },
    terminate() { log.push('terminate'); },
  };
}

function rgbaImage(width, height, { alpha = false } = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 3;
  for (let i = 0; i < data.length; i += 4) {
    seed = (seed * 16807) % 2147483647;
    const x = (i / 4) % width;
    const v = 100 + 70 * Math.sin(x / 5) + (seed / 2147483647 - 0.5) * 40;
    data[i] = v + 25; data[i + 1] = v; data[i + 2] = v - 25;
    data[i + 3] = alpha && x < width / 3 ? 0 : 255;
  }
  return { width, height, data };
}

function rawImage(width, height) {
  const data = new Uint16Array(width * height * 3);
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.sin(i * 0.37) * 0.4 + 0.45) * 65535;
  return { kind: 'raw', width, height, data };
}

const RAW_INFO = SYNTHETIC_RAW_INFO;
const SETTINGS = { texture: 60, clarity: 40, dehaze: 25, sharpening: 70, luminanceNoise: 35, colorNoise: 50, exposure: 0.3 };

async function parallel(image, settings, workers) {
  const out = new Uint8ClampedArray(image.width * image.height * 4);
  const log = [];
  const progress = [];
  await renderDetailParallel(image, settings, {
    workers,
    spawn: () => fakeWorker(log),
    onBand: ({ row, rows, data }) => out.set(data, row * image.width * 4),
    onProgress: (fraction) => progress.push(fraction),
  });
  return { out, log, progress };
}

describe('parallel rendering without Detail', () => {
  const look = lookLut(9);
  const EDIT = normalizeAdjustments({
    exposure: 0.4, contrast: 25, highlights: -30, shadows: 20, temperature: 15, vibrance: 20, saturation: -10,
    curves: { master: [[0, 8], [128, 140], [255, 250]], red: [[0, 0], [255, 240]] },
    hsl: { blue: { hue: 10, saturation: -20, luminance: 15 } },
    lut: { sha256: look.sha256 ?? 'f'.repeat(64), name: 'look.cube', title: 'Look', size: 9 }, lutIntensity: 70,
  });
  const run = async (image, settings, workers) => {
    const out = new Uint8ClampedArray(image.width * image.height * 4);
    const log = [];
    await renderPixelsParallel(image, settings, { workers, spawn: () => fakeWorker(log), onBand: ({ row, data }) => out.set(data, row * image.width * 4) });
    return { out, log };
  };

  test('equals the one-thread export renderer bit for bit (RGBA with transparency, JPEG flattening)', async () => {
    const image = rgbaImage(301, 700, { alpha: true });
    const params = deriveParams(EDIT, { lut: look });
    expect(params).toMatchObject({ lutActive: true, detailActive: false, neutral: false });
    expect(params.postActive).toBe(true);
    const { out, log } = await run(image, { adjustments: EDIT, lut: look }, 3);
    expect(Buffer.compare(Buffer.from(out), Buffer.from(renderRgba8(image.data, params)))).toBe(0);
    expect(log.filter((type) => type === 'pixelBegin')).toHaveLength(3);
    expect(log.filter((type) => type === 'terminate')).toHaveLength(3);
    const flat = (await run(image, { adjustments: EDIT, lut: look, flattenAlpha: true }, 2)).out;
    expect(Buffer.compare(Buffer.from(flat), Buffer.from(renderRgba8(image.data, params, { flattenAlpha: true })))).toBe(0);
  });

  test('equals it for RAW data', async () => {
    const image = rawImage(240, 600);
    const { out } = await run(image, { adjustments: EDIT, raw: RAW_INFO, lut: look }, 4);
    expect(Buffer.compare(Buffer.from(out), Buffer.from(renderRawRgba8(image.data, deriveParams(EDIT, { raw: RAW_INFO, lut: look }))))).toBe(0);
    expect(new Set(out.filter((_, i) => i % 4 === 1)).size).toBeGreaterThan(50);
  });
});

describe('parallel Detail rendering', () => {
  test('equals the one-thread render bit for bit (RGBA with transparency, JPEG flattening)', async () => {
    const image = rgbaImage(301, 700, { alpha: true });
    const expected = renderDetailImage(image, deriveParams(SETTINGS));
    const { out, log, progress } = await parallel(image, { adjustments: SETTINGS }, 3);
    expect(Buffer.compare(Buffer.from(out), Buffer.from(expected))).toBe(0);
    expect(log.filter((type) => type === 'detailBegin')).toHaveLength(3);
    expect(log.filter((type) => type === 'terminate')).toHaveLength(3);
    expect(progress.at(-1)).toBe(1);
    const flattened = renderDetailImage(image, deriveParams(SETTINGS), { flattenAlpha: true });
    expect(Buffer.compare(Buffer.from((await parallel(image, { adjustments: SETTINGS, flattenAlpha: true }, 2)).out), Buffer.from(flattened))).toBe(0);
  });

  test('equals it for RAW data rendered below native size', async () => {
    const image = rawImage(240, 600);
    const params = deriveParams(SETTINGS, { raw: RAW_INFO });
    const expected = renderDetailImage(image, params, { nativeWidth: 480, nativeHeight: 1200 });
    const { out } = await parallel(image, { adjustments: SETTINGS, raw: RAW_INFO, nativeWidth: 480, nativeHeight: 1200 }, 4);
    expect(Buffer.compare(Buffer.from(out), Buffer.from(expected))).toBe(0);
    expect(new Set(out.filter((_, i) => i % 4 === 1)).size).toBeGreaterThan(50);
  });

  test('cancelling stops before the remaining bands and ends the workers', async () => {
    const image = rgbaImage(64, 2000);
    const signal = { cancelled: false };
    const log = [];
    const bands = [];
    const run = renderDetailParallel(image, { adjustments: SETTINGS }, {
      workers: 2,
      signal,
      spawn: () => fakeWorker(log),
      onBand: (band) => { bands.push(band.row); signal.cancelled = true; },
    });
    await expect(run).rejects.toMatchObject({ code: 'cancelled' });
    expect(bands.length).toBeLessThan(8);
    expect(log.filter((type) => type === 'terminate')).toHaveLength(2);
  });

  test('ends the workers already started when a later one cannot start', async () => {
    const log = [];
    let spawned = 0;
    const spawn = () => {
      spawned += 1;
      if (spawned === 3) throw new Error('Worker blocked');
      return fakeWorker(log);
    };
    await expect(renderDetailParallel(rgbaImage(16, 8), { adjustments: { ...SETTINGS } }, { workers: 3, onBand: () => {}, spawn })).rejects.toThrow('Worker blocked');
    expect(log.filter((entry) => entry === 'terminate')).toHaveLength(2);
  });

  test('phones, low-memory devices and few cores keep the one-thread export', () => {
    const desktop = { navigator: { hardwareConcurrency: 8, deviceMemory: 8 }, Worker: function Worker() {}, matchMedia: () => ({ matches: false }), screen: { width: 1920, height: 1080 } };
    expect(detailWorkerCount(desktop)).toBe(4);
    expect(detailWorkerCount({ ...desktop, navigator: { hardwareConcurrency: 4 } })).toBe(2);
    expect(detailWorkerCount({ ...desktop, navigator: { hardwareConcurrency: 3 } })).toBe(0);
    expect(detailWorkerCount({ ...desktop, navigator: { hardwareConcurrency: 8, deviceMemory: 4 } })).toBe(0);
    expect(detailWorkerCount({ ...desktop, matchMedia: () => ({ matches: true }), screen: { width: 390, height: 844 } })).toBe(0);
    expect(detailWorkerCount({ ...desktop, Worker: undefined })).toBe(0);
  });
});
