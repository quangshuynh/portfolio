// Node entry point for LibRaw-Wasm. The package's default export spawns a browser Web
// Worker; Node has no Web Worker global, so tests load the Emscripten factory directly
// and hand it the wasm binary (its own fetch() cannot read file: URLs).
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import factory from 'libraw-wasm/dist/libraw.js';

const wasmPath = fileURLToPath(import.meta.resolve('libraw-wasm/dist/libraw.wasm'));
let modulePromise;

export function loadLibRaw() {
  modulePromise ??= readFile(wasmPath).then((wasmBinary) => factory({ wasmBinary }));
  return modulePromise;
}

// Scene-linear, camera white balance, no auto-brightening, 16 bits per channel: the
// working data an editor needs. LibRaw's defaults (BT.709 gamma, auto-bright, 8-bit)
// are a finished rendering instead. libraw-wasm 1.6.0 silently ignores a two-element
// `gamm` (ybouane/LibRaw-Wasm#8), so all six are passed; LibRaw recomputes the last four.
export const LINEAR_SETTINGS = Object.freeze({
  outputBps: 16,
  outputColor: 1,
  gamm: [1, 1, 0, 0, 0, 0],
  noAutoBright: true,
  useCameraWb: true,
  userQual: 3,
});

/**
 * Opens a RAW file in a fresh LibRaw instance, runs `use` on it, then frees it.
 * Embind instances are not garbage collected: each one left alive keeps about 256 MB
 * of the module's heap, and the eighth undeleted full-size decode hits the 2 GB limit.
 * :param bytes: Uint8Array of the whole file (copied; LibRaw keeps its own buffer)
 * :param settings: LibRaw-Wasm settings object
 * :param use: receives the instance (metadata(), rawImageData(), imageData(), thumbnailData())
 * :returns: whatever `use` returns
 */
export async function withRaw(bytes, settings, use) {
  const Module = await loadLibRaw();
  const raw = new Module.LibRaw();
  try {
    raw.open(new Uint8Array(bytes), { ...settings });
    return await use(raw);
  } finally {
    raw.delete();
  }
}

/**
 * Mean value of each 2x2 CFA position, after subtracting the black level.
 * Demosaiced or JPEG-derived data has no such per-position structure.
 * :returns: [topLeft, topRight, bottomLeft, bottomRight]
 */
export function cfaPositionMeans(mosaic, width, height, black = 0) {
  const sums = [0, 0, 0, 0];
  const counts = [0, 0, 0, 0];
  for (let y = 0; y < height - 1; y += 1) {
    const row = y * width;
    const position = (y & 1) << 1;
    for (let x = 0; x < width - 1; x += 1) {
      const index = position | (x & 1);
      sums[index] += Math.max(0, mosaic[row + x] - black);
      counts[index] += 1;
    }
  }
  return sums.map((sum, index) => sum / counts[index]);
}

/** Counts differing samples in each row of two equally sized mosaics. */
export function changedSamplesPerRow(first, second, width, height) {
  const changed = new Uint32Array(height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0, at = y * width; x < width; x += 1, at += 1) {
      if (first[at] !== second[at]) changed[y] += 1;
    }
  }
  return changed;
}
