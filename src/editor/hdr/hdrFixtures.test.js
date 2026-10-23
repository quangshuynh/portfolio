// @vitest-environment node
// Genuine Sony A7 III files. Private photographs are never committed: set HDR_FIXTURE_DIR
// to a folder holding _DSC9015.ARW, _DSC9016.ARW and _DSC9017.ARW (2026-10-05). Without
// them these tests are reported as skipped, which is not evidence of anything.
//
// Those three files are a Sony DRO bracket, not an exposure bracket: one exposure
// (1/30 s, f/3.5, ISO 100) saved three times with identical sensor data and differently
// processed embedded JPEGs. They check that such a set is refused for the right reason,
// and (with motion and exposure applied to the genuine sensor data, so labelled
// simulated) that alignment and exposure measurement work on real texture and noise.
// No genuine exposure bracket was available, so real-world merge quality is not tested here.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, test } from 'vitest';
import exifr from 'exifr';
import factory from 'libraw-wasm/dist/libraw.js';
import { decodeRaw } from '../raw/rawDecoder.mjs';
import { validateBracket } from './hdrMetadata.mjs';
import { analyzeBracket, createRadianceMerge } from './hdrMerge.mjs';

const dir = process.env.HDR_FIXTURE_DIR ?? '';
const NAMES = ['_DSC9015.ARW', '_DSC9016.ARW', '_DSC9017.ARW'];
const available = Boolean(dir) && NAMES.every((name) => existsSync(path.join(dir, name)));

let Module;
let decoded;
beforeAll(async () => {
  if (!available) return;
  Module = await factory({ wasmBinary: await readFile(fileURLToPath(import.meta.resolve('libraw-wasm/dist/libraw.wasm'))) });
  decoded = [];
  for (const name of NAMES) {
    const bytes = new Uint8Array(await readFile(path.join(dir, name)));
    const exif = await exifr.parse(Buffer.from(bytes), { pick: ['ExposureTime', 'FNumber', 'ISO', 'DateTimeOriginal', 'Model'] });
    decoded.push({ name, exif, ...decodeRaw(Module, bytes, { format: 'arw', halfSize: true }) });
  }
}, 120_000);

/** Genuine half-size sensor data with a simulated exposure and hand-held motion (bilinear). */
function simulate({ image }, { exposure, tx = 0, ty = 0, angle = 0 }, clipLevels) {
  const { width, height, data } = image;
  const out = new Uint16Array(data.length);
  const cos = Math.cos((angle * Math.PI) / 180);
  const sin = Math.sin((angle * Math.PI) / 180);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Frame pixel q shows reference point p with q = R(p - c) + c + t.
      const dx = x - cx - tx;
      const dy = y - cy - ty;
      const px = Math.min(width - 1.001, Math.max(0, cos * dx + sin * dy + cx));
      const py = Math.min(height - 1.001, Math.max(0, -sin * dx + cos * dy + cy));
      const x0 = Math.floor(px);
      const y0 = Math.floor(py);
      const ax = px - x0;
      const ay = py - y0;
      for (let c = 0; c < 3; c += 1) {
        const at = (xx, yy) => data[(yy * width + xx) * 3 + c];
        const v = (at(x0, y0) * (1 - ax) + at(x0 + 1, y0) * ax) * (1 - ay) + (at(x0, y0 + 1) * (1 - ax) + at(x0 + 1, y0 + 1) * ax) * ay;
        out[(y * width + x) * 3 + c] = Math.round(Math.min(clipLevels[c], v * exposure));
      }
    }
  }
  return { kind: 'raw', width, height, data: out };
}

describe.skipIf(!available)('genuine Sony A7 III DRO bracket (_DSC9015–9017)', () => {
  test('metadata: same camera, size, time and exposure; validation refuses it as not an exposure bracket', () => {
    for (const { exif, info } of decoded) {
      expect(exif).toMatchObject({ Model: 'ILCE-7M3', ExposureTime: 1 / 30, FNumber: 3.5, ISO: 100 });
      expect(info).toMatchObject({ width: 6024, height: 4024, iso: 100, aperture: 3.5 });
    }
    expect(new Set(decoded.map(({ exif }) => +exif.DateTimeOriginal)).size).toBe(1);
    const inputs = decoded.map(({ name, info }) => ({
      name, size: 1, sha256: null, kind: 'raw', format: 'arw', width: info.width, height: info.height, orientation: 1,
      exposure: { shutter: info.shutter, aperture: info.aperture, iso: info.iso, model: info.model, captured: null },
    }));
    expect(validateBracket(inputs).errors.join(' ')).toMatch(/same exposure \(1\/30 s, f\/3.5, ISO 100\).*Sony DRO bracketing/);
  });

  test('sensor data: identical in all three; the merge refuses it from the measured brightness too', () => {
    const [a, b, c] = decoded.map(({ image }) => image.data);
    expect(a.every((value, i) => value === b[i] && value === c[i])).toBe(true);
    const frames = decoded.map(({ image, info }, index) => ({ image, asShot: info.asShot, stops: null, role: ['under', 'normal', 'over'][index] }));
    expect(() => analyzeBracket(frames, { mode: 'radiance', reference: 1 })).toThrow(/same exposure.*Sony DRO/);
  }, 120_000);

  test('simulated bracket on genuine sensor data: alignment and exposure measurement', () => {
    const [, { image, info }] = decoded;
    const aMax = Math.max(...info.asShot);
    const clipLevels = info.asShot.map((v) => Math.round((v / aMax) * 65535));
    const motion = [{ exposure: 0.25, tx: 3.6, ty: -2.3, angle: 0.4 }, { exposure: 1 }, { exposure: 4, tx: -5.2, ty: 1.7, angle: -0.3 }];
    const frames = motion.map((m, index) => ({ image: simulate({ image }, m, clipLevels), asShot: info.asShot, stops: Math.log2(m.exposure), role: ['under', 'normal', 'over'][index] }));
    const started = performance.now();
    const analysis = analyzeBracket(frames, { mode: 'radiance', reference: 1 });
    const analysed = performance.now();
    const run = createRadianceMerge(analysis, frames, { width: image.width, height: image.height });
    frames.forEach((frame, index) => run.add(index, frame.image));
    const merged = run.finish();
    console.info(`genuine ${image.width}×${image.height}: analyse ${(analysed - started).toFixed(0)} ms, merge ${(performance.now() - analysed).toFixed(0)} ms, alignment`, analysis.alignment, 'ghost', analysis.ghost.fraction);
    [0, 2].forEach((index) => {
      const t = analysis.transforms[index];
      expect(Math.abs(t.tx * image.width - motion[index].tx)).toBeLessThan(0.3);
      expect(Math.abs(t.ty * image.width - motion[index].ty)).toBeLessThan(0.3);
      expect(Math.abs(t.angle - motion[index].angle)).toBeLessThanOrEqual(0.15);
      expect(analysis.alignment[index].status).toBe('aligned');
    });
    expect(analysis.exposures[0]).toBeCloseTo(0.25, 2);
    expect(analysis.exposures[2] / 4).toBeCloseTo(1, 2);
    // Simulated from one exposure, nothing moves: the ghost detector should find (almost) nothing.
    expect(analysis.ghost.fraction).toBeLessThan(0.01);
    expect(merged.width).toBeGreaterThan(image.width * 0.99);
  }, 300_000);
});

// Genuine A7 III compensation bracket (−2/0/+2) shot in M mode with Auto ISO, 2026-10-23:
// set HDR_AUTO_ISO_DIR to a folder holding DSC09636.ARW, DSC09637.ARW and DSC09638.ARW.
// ISO reached its 6400 limit, so the 0 and +2 frames hold the same exposure.
const autoIsoDir = process.env.HDR_AUTO_ISO_DIR ?? '';
const AUTO_ISO_NAMES = ['DSC09636.ARW', 'DSC09637.ARW', 'DSC09638.ARW'];
const autoIsoAvailable = Boolean(autoIsoDir) && AUTO_ISO_NAMES.every((name) => existsSync(path.join(autoIsoDir, name)));

describe.skipIf(!autoIsoAvailable)('genuine Sony A7 III Auto ISO bracket (DSC09636–09638)', () => {
  let frames;
  let inputs;
  beforeAll(async () => {
    const module = Module ?? await factory({ wasmBinary: await readFile(fileURLToPath(import.meta.resolve('libraw-wasm/dist/libraw.wasm'))) });
    frames = [];
    inputs = [];
    for (const name of AUTO_ISO_NAMES) {
      const { info, image } = decodeRaw(module, new Uint8Array(await readFile(path.join(autoIsoDir, name))), { format: 'arw', halfSize: true });
      const exposure = { shutter: info.shutter, aperture: info.aperture, iso: info.iso, model: info.model, captured: info.captured };
      inputs.push({ name, size: 1, sha256: null, kind: 'raw', format: 'arw', width: info.width, height: info.height, orientation: 1, exposure });
      frames.push({ image, asShot: info.asShot, stops: null });
    }
  }, 120_000);

  test('metadata: 1/160 s, f/6.3 at ISO 4000, 6400, 6400; refused as two equal exposures', () => {
    expect(inputs.map(({ exposure }) => exposure.iso)).toEqual([4000, 6400, 6400]);
    expect(validateBracket(inputs).errors.join(' ')).toMatch(/DSC09637\.ARW and DSC09638\.ARW were taken with the same exposure \(1\/160 s, f\/6\.3, ISO 6400\)/);
  });

  test('sensor data: the duplicate exposure is refused in either role order', () => {
    for (const [reference, roles] of [[1, ['under', 'normal', 'over']], [2, ['under', 'over', 'normal']]]) {
      frames.forEach((frame, index) => { frame.role = roles[index]; });
      expect(() => analyzeBracket(frames, { mode: 'radiance', reference })).toThrow(/same exposure as the normal one/);
    }
  }, 120_000);
});
