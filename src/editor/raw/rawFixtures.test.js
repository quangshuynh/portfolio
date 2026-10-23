// @vitest-environment node
// Genuine camera files. Private photographs are never committed: set RAW_FIXTURE_DIR to
// a folder with the Interval 0 fixtures (Sony ILCE-7M3 DSC09420.ARW, uncompressed
// 14-bit, and DSC09546.ARW, uncompressed 12-bit). Without them these tests are
// reported as skipped, which is not evidence of compatibility.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, test } from 'vitest';
import sharp from 'sharp';
import factory from 'libraw-wasm/dist/libraw.js';
import { decodeRaw, downsampleRaw } from './rawDecoder.mjs';
import { rawDevelopParams } from './rawColor.mjs';
import { sniffRaw } from './rawFormat.mjs';
import { deriveParams } from '../pipeline/spec.mjs';
import { renderRawRgba8 } from '../pipeline/cpuRenderer.mjs';
import { SRGB_TO_LINEAR_8BIT } from '../pipeline/colorMath.mjs';
import { neutralAdjustments } from '../model/adjustments.mjs';

const dir = process.env.RAW_FIXTURE_DIR ?? '';
const FIXTURES = [
  { name: 'DSC09420.ARW', bits: 14, width: 4024, height: 6024, flip: 5, iso: 100 },
  { name: 'DSC09546.ARW', bits: 12, width: 6024, height: 4024, flip: 0, iso: 640 },
].map((fixture) => ({ ...fixture, file: path.join(dir, fixture.name) }));
const available = FIXTURES.filter(({ file }) => dir && existsSync(file));

let Module;
beforeAll(async () => {
  if (!available.length) return;
  Module = await factory({ wasmBinary: await readFile(fileURLToPath(import.meta.resolve('libraw-wasm/dist/libraw.wasm'))) });
}, 60_000);

const lstar = (y) => (y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y);

describe.skipIf(!available.length)('genuine Sony A7 III ARW files', () => {
  test.each(available)('$name ($bits-bit uncompressed): sensor decode, metadata and orientation', async ({ file, width, height, flip, iso }) => {
    const bytes = new Uint8Array(await readFile(file));
    expect(sniffRaw(bytes.subarray(0, 256 * 1024))).toBe('arw');
    const { info, image } = decodeRaw(Module, bytes, { format: 'arw', halfSize: true });
    expect(info).toMatchObject({ make: 'Sony', model: 'ILCE-7M3', width, height, flip, iso, blackLevel: 512, asShotAvailable: true });
    expect(info.lens).toMatch(/FE 28-70mm/);
    // Half of the full sensor size and oriented like the full image: not the 1616×1080 preview.
    expect([image.width, image.height]).toEqual([width / 2, height / 2]);
    expect(image.width * image.height).toBeGreaterThan(1616 * 1080 * 3);
  }, 60_000);

  test.each(available)('$name: re-applied white balance equals LibRaw decoding with it', async ({ file }) => {
    const bytes = new Uint8Array(await readFile(file));
    const { info, image } = decodeRaw(Module, bytes, { format: 'arw', halfSize: true });
    for (const settings of [{ whiteBalance: 'daylight' }, { whiteBalance: 'custom', temperature: 3200, tint: 15 }]) {
      const { gain, multipliers } = rawDevelopParams(info, settings);
      const raw = new Module.LibRaw();
      let reference;
      try {
        raw.open(bytes.slice(), { outputBps: 16, outputColor: 0, gamm: [1, 1, 0, 0, 0, 0], noAutoBright: true, halfSize: true, highlight: 0, userMul: [...multipliers, multipliers[1]] });
        reference = raw.imageData();
      } finally {
        raw.delete();
      }
      let worst = 0;
      for (let i = 0; i < image.data.length; i += 3 * 5) {
        for (let c = 0; c < 3; c += 1) worst = Math.max(worst, Math.abs(Math.min(65535, image.data[i + c] * gain[c]) - reference.data[i + c]));
      }
      expect(worst).toBeLessThanOrEqual(6);
    }
  }, 120_000);

  test.each(available)('$name: neutral development matches the camera JPEG brightness', async ({ file }) => {
    const bytes = new Uint8Array(await readFile(file));
    const { info, image } = decodeRaw(Module, bytes, { format: 'arw', halfSize: true });
    const raw = new Module.LibRaw();
    let preview;
    try {
      raw.open(bytes.slice(), {});
      preview = raw.thumbnailData();
    } finally {
      raw.delete();
    }
    // Compare medians of L* on a small grid: robust to the slight framing difference.
    const small = downsampleRaw(image, Math.round(image.width / 8), Math.round(image.height / 8));
    const ours = renderRawRgba8(small.data, deriveParams(neutralAdjustments(), { raw: info }));
    const camera = await sharp(Buffer.from(preview.data)).rotate().resize(small.width, small.height, { fit: 'fill' }).removeAlpha().raw().toBuffer();
    const median = (values) => values.sort((a, b) => a - b)[values.length >> 1];
    const luminance = (data, stride, i) => 0.2126 * SRGB_TO_LINEAR_8BIT[data[i * stride]] + 0.7152 * SRGB_TO_LINEAR_8BIT[data[i * stride + 1]] + 0.0722 * SRGB_TO_LINEAR_8BIT[data[i * stride + 2]];
    const count = small.width * small.height;
    const ourL = median(Array.from({ length: count }, (_, i) => lstar(luminance(ours, 4, i))));
    const cameraL = median(Array.from({ length: count }, (_, i) => lstar(luminance(camera, 3, i))));
    expect(Math.abs(ourL - cameraL)).toBeLessThan(4);
  }, 120_000);
});
