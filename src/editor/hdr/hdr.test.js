// @vitest-environment node
// HDR merging on synthetic brackets with known scene radiance (dev/hdrFixtures.mjs):
// metadata and validation, exposure measurement, the radiance merge, alignment,
// ghosting, fusion, tone mapping and determinism. Genuine camera files: hdrFixtures.test.js.

import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { SYNTHETIC_RAW_INFO, pixelRadiance as sceneRadiance, syntheticRasterFrame, syntheticRawFrame } from '../dev/hdrFixtures.mjs';
import {
  BRACKET_SIZE, exposureStops, parseExifDate, readRasterExposure, rolesComplete, suggestRolesFromBrightness, suggestRolesFromMetadata, validateBracket,
} from './hdrMetadata.mjs';
import { ALIGN, alignmentStatus, commonCrop, cropAt, estimateTransform } from './hdrAlign.mjs';
import { HdrError, analyzeBracket, createFusionMerge, createRadianceMerge, framePlanes, medianBrightness, whiteBalanceToReference } from './hdrMerge.mjs';
import { describeHdrSource, hdrIdentity, hdrPhotoName, hdrSourceMatches, parseHdrSource } from './hdrSource.mjs';
import { checkHdrExport, hdrExportGeometry } from './hdrClient.mjs';
import { downscale, handlers } from './hdrTasks.mjs';
import { deriveParams, hdrKnee, highlightRolloff, processLinear, shadowLift } from '../pipeline/spec.mjs';
import { renderImage } from '../pipeline/cpuRenderer.mjs';
import { neutralAdjustments } from '../model/adjustments.mjs';
import { exportFileName } from '../io/files.mjs';

const W = 300;
const H = 200;
const D = Math.max(...SYNTHETIC_RAW_INFO.asShot);
// Decoded green is scaled by a_g / a_max; this converts scene radiance to merged units.
const decodedGreen = (radiance) => radiance[1] / D;
const MOTION = [{ tx: 2 + 1 / 3, ty: -1 - 2 / 3, angle: 0.5 }, null, { tx: -1 - 1 / 3, ty: 2 + 1 / 3, angle: -0.5 }];
const maxOf = (values) => values.reduce((a, b) => (b > a ? b : a), -Infinity);
const OBJECT = { x: 100, y: 75, size: 10 };

function rawBracket({ motion = [null, null, null], object = null, exposures = [0.25, 1, 4] } = {}) {
  return exposures.map((exposure, index) => ({
    image: syntheticRawFrame(W, H, { exposure, seed: index + 1, transform: motion[index] ?? undefined, object: index === 2 ? object : null }),
    asShot: SYNTHETIC_RAW_INFO.asShot,
    stops: Math.log2(exposure),
    role: ['under', 'normal', 'over'][index],
  }));
}

function merge(frames, options = {}) {
  const analysis = analyzeBracket(frames, { mode: 'radiance', reference: 1, ...options });
  const run = createRadianceMerge(analysis, frames, { width: W, height: H });
  frames.forEach((frame, index) => run.add(index, frame.image));
  return { analysis, image: run.finish() };
}

/** Mean relative error of merged green against the scene in a region (reference pixel coordinates). */
function regionError({ analysis, image }, inside, { truth = sceneRadiance } = {}) {
  const crop = cropAt(analysis.crop, W, H);
  let sum = 0;
  let count = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const px = x + crop.x;
      const py = y + crop.y;
      if (!inside(px / W, py / H, px, py)) continue;
      const expected = decodedGreen(truth(px, py, W, H));
      sum += Math.abs(image.data[(y * image.width + x) * 3 + 1] / expected - 1);
      count += 1;
    }
  }
  return sum / count;
}
const inWindow = (u, v) => u > 0.62 && u < 0.88 && v > 0.14 && v < 0.43;
const inShadow = (u, v) => u > 0.02 && u < 0.33 && v > 0.62 && v < 0.98;
const inMidtones = (u, v) => u > 0.4 && !inWindow(u, v) && !(u > 0.58 && u < 0.92 && v > 0.1 && v < 0.47);

const tiffExif = ({ shutter = [1, 125], aperture = [56, 10], iso = 200, date = '2026:10:05 18:48:01' } = {}) => {
  // Little-endian TIFF: IFD0 with an ExifIFD pointer; Exif IFD with exposure, aperture, ISO, date.
  const buffer = new ArrayBuffer(200);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  bytes.set([0x49, 0x49, 42, 0]);
  view.setUint32(4, 8, true);
  view.setUint16(8, 1, true);
  view.setUint16(10, 0x8769, true); view.setUint16(12, 4, true); view.setUint32(14, 1, true); view.setUint32(18, 26, true);
  view.setUint32(22, 0, true);
  view.setUint16(26, 4, true);
  const entry = (i, tag, type, count, value) => { const at = 28 + i * 12; view.setUint16(at, tag, true); view.setUint16(at + 2, type, true); view.setUint32(at + 4, count, true); view.setUint32(at + 8, value, true); };
  entry(0, 0x829a, 5, 1, 100);
  entry(1, 0x829d, 5, 1, 108);
  entry(2, 0x8827, 3, 1, iso);
  entry(3, 0x9003, 2, 20, 116);
  view.setUint32(100, shutter[0], true); view.setUint32(104, shutter[1], true);
  view.setUint32(108, aperture[0], true); view.setUint32(112, aperture[1], true);
  bytes.set(new TextEncoder().encode(`${date}\0`), 116);
  return bytes.subarray(0, 140);
};
const jpegWithExif = (options) => {
  const tiff = tiffExif(options);
  const app1 = new Uint8Array(4 + 6 + tiff.length);
  app1.set([0xff, 0xe1, (app1.length - 2) >> 8, (app1.length - 2) & 255]);
  app1.set(new TextEncoder().encode('Exif\0\0'), 4);
  app1.set(tiff, 10);
  return Uint8Array.from([0xff, 0xd8, ...app1, 0xff, 0xda, 0, 2]);
};
const input = (overrides = {}) => ({
  name: 'a.jpg', size: 100, sha256: null, kind: 'raster', format: 'jpeg', width: 600, height: 400, orientation: 1, exposure: null, ...overrides,
});
const exposure = (shutter, overrides = {}) => ({ shutter, aperture: 8, iso: 100, captured: 0, model: 'ILCE-7M3', ...overrides });

describe('import and metadata', () => {
  test('reads shutter, aperture, ISO and capture time from JPEG EXIF', () => {
    expect(readRasterExposure(jpegWithExif())).toMatchObject({ shutter: 1 / 125, aperture: 5.6, iso: 200, captured: Date.UTC(2026, 9, 5, 18, 48, 1) });
    expect(parseExifDate('not a date')).toBeNull();
  });

  test('missing or malformed EXIF gives nulls, never invented values', () => {
    expect(readRasterExposure(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toMatchObject({ shutter: null, aperture: null, iso: null });
    const broken = jpegWithExif({ shutter: [1, 0] });
    expect(readRasterExposure(broken).shutter).toBeNull();
    expect(readRasterExposure(new Uint8Array(16)).iso).toBeNull();
  });

  test('requires exactly three photos', () => {
    expect(BRACKET_SIZE).toBe(3);
    expect(validateBracket([input(), input({ name: 'b.jpg' })]).errors[0]).toMatch(/exactly three/);
    expect(validateBracket([input(), input(), input(), input()]).errors[0]).toMatch(/exactly three/);
  });

  test('rejects mixed RAW and raster brackets, duplicates, other cameras and different sizes', () => {
    const raw = (name, overrides = {}) => input({ name, kind: 'raw', format: 'arw', width: 6024, height: 4024, exposure: exposure(1 / 125), ...overrides });
    expect(validateBracket([raw('1.ARW'), raw('2.ARW', { exposure: exposure(1 / 30) }), input()]).errors.join(' ')).toMatch(/RAW and processed images/);
    expect(validateBracket([raw('1.ARW', { sha256: 'a'.repeat(64) }), raw('2.ARW', { sha256: 'a'.repeat(64), exposure: exposure(1 / 30) }), raw('3.ARW', { exposure: exposure(1 / 500) })]).errors.join(' ')).toMatch(/same file/);
    expect(validateBracket([raw('1.ARW'), raw('2.ARW', { exposure: exposure(1 / 30, { model: 'ILCE-6400' }) }), raw('3.ARW', { exposure: exposure(1 / 500) })]).errors.join(' ')).toMatch(/different cameras/);
    expect(validateBracket([raw('1.ARW'), raw('2.ARW', { width: 4024, height: 6024, exposure: exposure(1 / 30) }), raw('3.ARW', { exposure: exposure(1 / 500) })]).errors.join(' ')).toMatch(/different sizes/);
  });

  test('raster orientation and framing: rotated or differently cropped photos are refused, scaled ones allowed', () => {
    const shots = (sizes) => sizes.map(([width, height], i) => input({ name: `${i}.jpg`, width, height }));
    expect(validateBracket(shots([[600, 400], [400, 600], [600, 400]])).errors.join(' ')).toMatch(/orientations/);
    expect(validateBracket(shots([[600, 400], [600, 450], [600, 400]])).errors.join(' ')).toMatch(/aspect ratios/);
    const scaled = validateBracket(shots([[600, 400], [300, 200], [600, 400]]));
    expect(scaled.errors).toEqual([]);
    expect(scaled.warnings.join(' ')).toMatch(/smallest size/);
  });

  test('identical exposure settings are not a bracket (Sony DRO bracketing)', () => {
    const same = [1, 2, 3].map((i) => input({ name: `${i}.ARW`, kind: 'raw', format: 'arw', exposure: exposure(1 / 30, { aperture: 3.5 }) }));
    expect(validateBracket(same).errors.join(' ')).toMatch(/same exposure \(1\/30 s, f\/3.5, ISO 100\).*not an exposure bracket/);
  });

  test('suggests roles from exposure metadata in any input order, never from file names', () => {
    const inputs = [
      input({ name: 'DSC0001.jpg', exposure: exposure(1 / 30) }),
      input({ name: 'DSC0002.jpg', exposure: exposure(1 / 500) }),
      input({ name: 'DSC0003.jpg', exposure: exposure(1 / 125) }),
    ];
    expect(suggestRolesFromMetadata(inputs).roles).toEqual(['over', 'under', 'normal']);
    // Same files, names swapped: the roles follow the exposures.
    const renamed = inputs.map((item, i) => ({ ...item, name: inputs[2 - i].name }));
    expect(suggestRolesFromMetadata(renamed).roles).toEqual(['over', 'under', 'normal']);
    expect(exposureStops(exposure(1 / 30)) - exposureStops(exposure(1 / 125))).toBeCloseTo(2.06, 2);
  });

  test('without usable metadata no metadata suggestion is made; brightness suggests instead', () => {
    expect(suggestRolesFromMetadata([input(), input(), input()])).toBeNull();
    expect(suggestRolesFromMetadata([input({ exposure: exposure(1 / 125) }), input({ exposure: exposure(1 / 125 * 1.1) }), input({ exposure: exposure(1 / 30) })])).toBeNull();
    expect(suggestRolesFromBrightness([0.5, 0.05, 0.2])).toEqual(['over', 'under', 'normal']);
    const result = validateBracket([input(), input({ name: 'b.jpg' }), input({ name: 'c.jpg' })]);
    expect(result.warnings.join(' ')).toMatch(/suggested from brightness/);
    expect(result.mode).toBe('fusion');
  });

  test('roles must be one of each', () => {
    expect(rolesComplete(['under', 'normal', 'over'])).toBe(true);
    expect(rolesComplete(['under', 'under', 'over'])).toBe(false);
    expect(rolesComplete(['under', 'normal'])).toBe(false);
  });

  test('a manual role that contradicts the measured exposure is refused with the reason', () => {
    const frames = rawBracket();
    frames[0].role = 'over';
    frames[2].role = 'under';
    expect(() => analyzeBracket(frames, { mode: 'radiance', reference: 1 })).toThrow(/marked overexposed is darker/);
  });
});

describe('radiance merge', () => {
  test('measures the exposure ratios from the linear data', () => {
    const { analysis } = merge(rawBracket());
    expect(analysis.exposures[0]).toBeCloseTo(0.25, 2);
    expect(analysis.exposures[2] / 4).toBeCloseTo(1, 2);
    expect(analysis.white).toBeCloseTo(4, 1);
  });

  test('uses the measured ratio and reports metadata that disagrees', () => {
    const frames = rawBracket();
    frames[0].stops = -1;
    const { analysis } = merge(frames);
    expect(analysis.exposures[0]).toBeCloseTo(0.25, 2);
    expect(analysis.warnings.join(' ')).toMatch(/recorded exposure difference \(-1.00 EV\) does not match the images \(-2.00 EV\)/);
  });

  test('recovers highlights the reference clips (scene up to 4x its white) from the darker exposure', () => {
    const result = merge(rawBracket());
    const highlights = (u, v, x, y) => inWindow(u, v) && sceneRadiance(x, y, W, H)[1] < 3.6 && sceneRadiance(x, y, W, H)[1] > 1.2;
    expect(regionError(result, highlights)).toBeLessThan(0.02);
    // Beyond the darkest frame's white the merge holds that white, not invented values.
    const brightest = maxOf(result.image.data);
    expect(brightest).toBeLessThanOrEqual(result.analysis.white * (1 + 1e-3));
  });

  test('shadows are cleaner than the reference alone', () => {
    const result = merge(rawBracket());
    const reference = rawBracket()[1].image;
    let refError = 0;
    let count = 0;
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
      if (!inShadow(x / W, y / H)) continue;
      refError += Math.abs(reference.data[(y * W + x) * 3 + 1] / 65535 / decodedGreen(sceneRadiance(x, y, W, H)) - 1);
      count += 1;
    }
    expect(regionError(result, inShadow)).toBeLessThan((refError / count) / 1.6);
  });

  test('keeps colour: mean channel ratios match the scene in mid-tones and recovered highlights', () => {
    const { analysis, image } = merge(rawBracket());
    const crop = cropAt(analysis.crop, W, H);
    expect(whiteBalanceToReference(SYNTHETIC_RAW_INFO.asShot, SYNTHETIC_RAW_INFO.asShot).scale).toEqual([1, 1, 1]);
    const asShot = SYNTHETIC_RAW_INFO.asShot.map((a) => a / D);
    for (const region of [(u, v, x, y) => inWindow(u, v) && sceneRadiance(x, y, W, H)[1] < 3.6, inMidtones]) {
      const measured = [0, 0];
      const truth = [0, 0];
      let n = 0;
      for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
        const px = x + crop.x;
        const py = y + crop.y;
        if (!region(px / W, py / H, px, py)) continue;
        const o = (y * image.width + x) * 3;
        const [r, g, b] = [0, 1, 2].map((c) => image.data[o + c] / asShot[c]);
        const t = sceneRadiance(px, py, W, H);
        measured[0] += r / g; measured[1] += b / g;
        truth[0] += t[0] / t[1]; truth[1] += t[2] / t[1];
        n += 1;
      }
      expect(Math.abs(measured[0] - truth[0]) / n).toBeLessThan(0.01);
      expect(Math.abs(measured[1] - truth[1]) / n).toBeLessThan(0.01);
    }
  });

  test('merged values are not clipped at 1', () => {
    const { image } = merge(rawBracket());
    expect(image.data instanceof Float32Array).toBe(true);
    expect(maxOf(image.data)).toBeGreaterThan(1.5 / D);
  });

  test('identical exposures are refused with the reason', () => {
    const frames = rawBracket({ exposures: [1, 1, 1] });
    frames.forEach((frame) => { frame.image = frames[1].image; frame.stops = 0; });
    expect(() => analyzeBracket(frames, { mode: 'radiance', reference: 1 })).toThrow(/contain the same exposure.*Sony DRO bracketing/);
  });

  test('is deterministic', () => {
    const digest = () => createHash('sha256').update(merge(rawBracket({ motion: MOTION, object: OBJECT })).image.data).digest('hex');
    expect(digest()).toBe(digest());
  });

  test('streams frames in any order with the same result', () => {
    const frames = rawBracket();
    const analysis = analyzeBracket(frames, { mode: 'radiance', reference: 1 });
    const runs = [[0, 1, 2], [2, 0, 1]].map((order) => {
      const run = createRadianceMerge(analysis, frames, { width: W, height: H });
      order.forEach((index) => run.add(index, frames[index].image));
      return run.finish().data;
    });
    let worst = 0;
    for (let i = 0; i < runs[0].length; i += 1) worst = Math.max(worst, Math.abs(runs[0][i] - runs[1][i]) / Math.max(1e-6, runs[0][i]));
    expect(worst).toBeLessThan(1e-5);
    const incomplete = createRadianceMerge(analysis, frames, { width: W, height: H });
    incomplete.add(0, frames[0].image);
    expect(() => incomplete.finish()).toThrow(HdrError);
  });
});

describe('alignment', () => {
  test('recovers hand-held shifts and small rotations to a fraction of a pixel', () => {
    const { analysis } = merge(rawBracket({ motion: MOTION }));
    [0, 2].forEach((index) => {
      const t = analysis.transforms[index];
      expect(t.tx * W).toBeCloseTo(MOTION[index].tx, 0);
      expect(Math.abs(t.tx * W - MOTION[index].tx)).toBeLessThan(0.2);
      expect(Math.abs(t.ty * W - MOTION[index].ty)).toBeLessThan(0.2);
      expect(Math.abs(t.angle - MOTION[index].angle)).toBeLessThan(0.1);
      expect(analysis.alignment[index].status).toBe('aligned');
      expect(analysis.alignment[index].after).toBeLessThan(analysis.alignment[index].before);
    });
  });

  test('aligned merges match the scene; unaligned ones do not', () => {
    const frames = rawBracket({ motion: MOTION });
    const aligned = merge(frames);
    const unaligned = merge(rawBracket({ motion: MOTION }), { settings: { align: false, deghost: false, deghostStrength: 50 } });
    expect(regionError(aligned, inMidtones)).toBeLessThan(0.05);
    expect(regionError(unaligned, inMidtones)).toBeGreaterThan(regionError(aligned, inMidtones) * 1.5);
  });

  test('crops to the area every frame covers, so there are no empty borders', () => {
    const { analysis, image } = merge(rawBracket({ motion: MOTION }));
    expect(analysis.crop.x).toBeGreaterThan(0);
    expect(analysis.crop.width).toBeLessThan(1);
    for (let i = 0; i < image.width * image.height; i += 1) expect(image.data[i * 3 + 1]).toBeGreaterThan(0);
    expect(commonCrop([{ tx: 0, ty: 0, angle: 0 }], W, H)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(cropAt({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, 6024, 4024)).toEqual({ x: 603, y: 403, width: 4818, height: 3218 });
  });

  test('an unrelated scene fails with an explanation instead of a merge', () => {
    const frames = rawBracket();
    const other = syntheticRawFrame(W, H, { seed: 9 });
    // Mirror the scene: same statistics, different content.
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) for (let c = 0; c < 3; c += 1) other.data[(y * W + x) * 3 + c] = frames[2].image.data[((H - 1 - y) * W + (W - 1 - x)) * 3 + c];
    frames[2].image = other;
    expect(() => analyzeBracket(frames, { mode: 'radiance', reference: 1 })).toThrow(/do not appear to show the same scene/);
  });

  test('large motion is reported as failed, not passed off as aligned', () => {
    expect(alignmentStatus({ before: 0.3, after: 0.05, transform: { tx: 40, ty: 0, angle: 0 } }, 300)).toBe('failed');
    expect(alignmentStatus({ before: 0.2, after: 0.15, transform: { tx: 1, ty: 0, angle: 0 } }, 300)).toBe('uncertain');
    expect(alignmentStatus({ before: 0.2, after: ALIGN.usable + 0.01, transform: { tx: 1, ty: 0, angle: 0 } }, 300)).toBe('failed');
  });

  test('works on 8-bit frames of different exposure', () => {
    const ref = framePlanes(syntheticRasterFrame(W, H, { seed: 2 }));
    const frame = framePlanes(syntheticRasterFrame(W, H, { exposure: 0.25, seed: 1, transform: { tx: 1 + 2 / 3, ty: -2, angle: 0 } }));
    const { transform } = estimateTransform({ plane: ref.luma, width: W, height: H }, { plane: frame.luma, width: W, height: H });
    expect(Math.abs(transform.tx - (1 + 2 / 3))).toBeLessThan(0.25);
    expect(Math.abs(transform.ty + 2)).toBeLessThan(0.25);
  });
});

describe('ghosting', () => {
  test('finds the moving object and takes that area from the reference only', () => {
    const withGhost = merge(rawBracket({ object: OBJECT }));
    const naive = merge(rawBracket({ object: OBJECT }), { settings: { align: true, deghost: false, deghostStrength: 50 } });
    const atObject = (u, v, x, y) => Math.abs(x - OBJECT.x) < OBJECT.size - 2 && Math.abs(y - OBJECT.y) < OBJECT.size - 2;
    expect(withGhost.analysis.ghost.fraction).toBeGreaterThan(0.002);
    expect(withGhost.analysis.ghost.fraction).toBeLessThan(0.05);
    expect(regionError(withGhost, atObject)).toBeLessThan(0.06);
    expect(regionError(naive, atObject)).toBeGreaterThan(0.3);
  });

  test('a static scene has almost no moving area', () => {
    expect(merge(rawBracket()).analysis.ghost.fraction).toBeLessThan(0.002);
  });
});

describe('exposure fusion (JPEG, PNG, WebP)', () => {
  const rasterFrames = (motion = [null, null, null]) => [0.25, 1, 4].map((e, index) => ({ image: syntheticRasterFrame(W, H, { exposure: e, seed: index + 1, transform: motion[index] ?? undefined }), role: ['under', 'normal', 'over'][index], stops: null }));

  test('blends detail from every exposure into an 8-bit image', () => {
    const frames = rasterFrames(MOTION);
    const analysis = analyzeBracket(frames, { mode: 'fusion', reference: 1 });
    expect(analysis.mode).toBe('fusion');
    expect(analysis.white).toBe(1);
    const run = createFusionMerge(analysis, { width: W, height: H });
    frames.forEach((frame, index) => run.add(index, frame.image));
    const fused = run.finish();
    expect(fused.data).toBeInstanceOf(Uint8ClampedArray);
    const crop = cropAt(analysis.crop, W, H);
    const mean = (image, inside, offset = { x: 0, y: 0 }) => {
      let sum = 0;
      let n = 0;
      for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
        if (!inside((x + offset.x) / W, (y + offset.y) / H)) continue;
        sum += image.data[(y * image.width + x) * 4 + 1];
        n += 1;
      }
      return sum / n;
    };
    // Window: darker than the clipped reference; shadows: brighter than the reference.
    expect(mean(fused, inWindow, crop)).toBeLessThan(mean(frames[1].image, inWindow) - 10);
    expect(mean(fused, inShadow, crop)).toBeGreaterThan(mean(frames[1].image, inShadow) + 5);
    for (let i = 3; i < fused.data.length; i += 4) expect(fused.data[i]).toBe(255);
  });
});

describe('tone mapping', () => {
  const raw = { ...SYNTHETIC_RAW_INFO, hdrWhite: 4 };

  test('the default maps the merged white to display white, keeps mid-tones and is monotonic', () => {
    const params = deriveParams(neutralAdjustments(), { raw });
    expect(params.hdr).toBe(true);
    expect(params.rolloffWhite).toBe(4);
    expect(params.rolloffKnee).toBe(0.5);
    expect(highlightRolloff(4, 4, hdrKnee(50))).toBeCloseTo(1, 12);
    let last = -1;
    for (let y = 0; y <= 4; y += 0.01) {
      const out = processLinear([y, y, y], params)[1];
      expect(out).toBeGreaterThanOrEqual(last - 1e-12);
      last = out;
    }
    expect(processLinear([0.18, 0.18, 0.18], params)[1]).toBeCloseTo(0.18, 12);
    expect(processLinear([4, 4, 4], params)[1]).toBeCloseTo(1, 9);
  });

  test('every compression and lift setting stays monotonic and within white', () => {
    for (const hdrHighlights of [0, 25, 50, 75, 100]) {
      for (const hdrShadows of [0, 50, 100]) {
        const params = deriveParams({ ...neutralAdjustments(), hdrHighlights, hdrShadows }, { raw });
        let last = -1;
        for (let y = 0; y <= 4; y += 0.005) {
          const out = processLinear([y, y, y], params)[1];
          expect(out).toBeGreaterThanOrEqual(last - 1e-12);
          expect(out).toBeLessThanOrEqual(1);
          last = out;
        }
      }
    }
    expect(shadowLift(0.001, 1) / 0.001).toBeGreaterThan(1.9);
    expect(shadowLift(1, 1)).toBeLessThan(1.05);
  });

  test('the HDR controls do nothing to ordinary RAW and raster photos', () => {
    const edited = { ...neutralAdjustments(), hdrHighlights: 90, hdrShadows: 80 };
    expect(deriveParams(edited, { raw: SYNTHETIC_RAW_INFO })).toMatchObject({ hdr: false, shadowLift: 0, rolloffKnee: 0.5 });
    expect(deriveParams(edited).neutral).toBe(true);
  });

  test('renders the float merge on the CPU; small slider changes give small output changes', () => {
    const { image } = merge(rawBracket());
    const a = renderImage(image, deriveParams(neutralAdjustments(), { raw: { ...raw, hdrWhite: 4 } }));
    const b = renderImage(image, deriveParams({ ...neutralAdjustments(), hdrHighlights: 51 }, { raw: { ...raw, hdrWhite: 4 } }));
    let worst = 0;
    for (let i = 0; i < a.length; i += 1) worst = Math.max(worst, Math.abs(a[i] - b[i]));
    expect(worst).toBeLessThanOrEqual(3);
    expect(maxOf(a.filter((_, i) => i % 4 !== 3))).toBe(255);
  });
});

describe('worker tasks, export geometry and naming', () => {
  test('the merge task returns the analysis, the preview and a thumbnail', async () => {
    const { result } = await handlers.merge({ mode: 'radiance', reference: 1, settings: { align: true, deghost: true, deghostStrength: 50 }, frames: rawBracket({ motion: MOTION }), thumbnailEdge: 64 }, () => {});
    expect(result.image.kind).toBe('hdr');
    expect(Math.max(result.thumbnail.width, result.thumbnail.height)).toBe(64);
    expect(result.analysis.transforms).toHaveLength(3);
  });

  test('an export merges frames streamed one at a time and renders bands', async () => {
    const frames = rawBracket({ motion: MOTION });
    const analysis = analyzeBracket(frames, { mode: 'radiance', reference: 1 });
    const { result: size } = await handlers.begin({ analysis, frames: frames.map(({ asShot }) => ({ asShot })), size: { width: W, height: H } });
    for (const [index, frame] of frames.entries()) await handlers.add({ index, image: frame.image });
    const bands = [];
    const { result } = await handlers.render({ adjustments: neutralAdjustments(), raw: { ...SYNTHETIC_RAW_INFO, hdrWhite: analysis.white } }, ({ band }) => band && bands.push(band));
    expect(result).toMatchObject(size);
    expect(bands.reduce((rows, band) => rows + band.rows, 0)).toBe(size.height);
    await expect(handlers.add({ index: 0, image: frames[0].image })).rejects.toThrow(/No HDR export/);
  });

  test('export geometry scales from the source size and never upscales the preview', () => {
    const analysis = { crop: { x: 0.01, y: 0.01, width: 0.98, height: 0.98 } };
    const inputs = [{ raw: { width: 6024, height: 4024 } }];
    const original = hdrExportGeometry(inputs, analysis, { mode: 'original' });
    expect(original.frame).toEqual({ width: 6024, height: 4024 });
    // ceil(0.01 · 6024) = 61 to floor(0.99 · 6024) = 5963.
    expect(original.output).toEqual({ width: 5902, height: 3942 });
    expect(original.fullDecode).toBe(true);
    const small = hdrExportGeometry(inputs, analysis, { mode: 'long-edge', longEdge: 2000 });
    expect(Math.abs(small.output.width - 2000)).toBeLessThanOrEqual(1);
    expect(small.fullDecode).toBe(false);
    const huge = hdrExportGeometry(inputs, analysis, { mode: 'long-edge', longEdge: 20000 });
    expect(huge.output).toEqual(original.output);
  });

  test('a device without the memory for full size gets an explicit smaller size, never a silent downscale', () => {
    const analysis = { crop: { x: 0, y: 0, width: 1, height: 1 } };
    const inputs = [{ raw: { width: 6024, height: 4024 } }];
    const tight = checkHdrExport('radiance', inputs, analysis, { mode: 'original' }, 900);
    expect(tight.fits).toBe(false);
    expect(tight.suggestion).toBeGreaterThan(1000);
    expect(checkHdrExport('radiance', inputs, analysis, { mode: 'long-edge', longEdge: tight.suggestion }, 900).fits).toBe(true);
    expect(checkHdrExport('radiance', inputs, analysis, { mode: 'original' }, 3000).fits).toBe(true);
  });

  test('downscales float and 8-bit images by area', () => {
    const image = { kind: 'hdr', width: 4, height: 2, data: Float32Array.from({ length: 24 }, (_, i) => (i % 3 === 0 ? 2 : 0)) };
    expect(downscale(image, 2, 1).data[0]).toBe(2);
    expect(downscale(image, 8, 8)).toBe(image);
  });

  test('names exports after the reference exposure with -HDR-quangedit, once', () => {
    const name = hdrPhotoName('DSC09501.ARW');
    expect(name).toBe('DSC09501-HDR');
    expect(exportFileName(name, 'jpeg')).toBe('DSC09501-HDR-quangedit.jpg');
    expect(exportFileName(name, 'webp')).toBe('DSC09501-HDR-quangedit.webp');
    expect(hdrPhotoName('DSC09501-HDR.jpg')).toBe('DSC09501-HDR');
    expect(hdrPhotoName('DSC09501.ARW', ['DSC09501-HDR', 'dsc09501-hdr-2'])).toBe('DSC09501-HDR-3');
    expect(exportFileName('DSC09501-HDR-quangedit', 'png')).toBe('DSC09501-HDR-quangedit.png');
  });

  test('the saved source lists the inputs by role and validates on read', async () => {
    const inputs = [
      { name: 'DSC09502.ARW', size: 3, sha256: 'c'.repeat(64), format: 'arw', role: 'over', file: {} },
      { name: 'DSC09500.ARW', size: 1, sha256: 'a'.repeat(64), format: 'arw', role: 'under', file: {} },
      { name: 'DSC09501.ARW', size: 2, sha256: 'b'.repeat(64), format: 'arw', role: 'normal', file: {} },
    ];
    const described = describeHdrSource({ mode: 'radiance', inputs, settings: { align: false } });
    expect(described.inputs.map(({ role }) => role)).toEqual(['under', 'normal', 'over']);
    expect(described.settings).toEqual({ align: false, deghost: true, deghostStrength: 50 });
    expect(JSON.stringify(described)).not.toMatch(/file/);
    expect(parseHdrSource(JSON.parse(JSON.stringify(described)))).toEqual(described);
    expect(parseHdrSource({ ...described, inputs: described.inputs.slice(0, 2) })).toBeNull();
    expect(parseHdrSource({ ...described, mode: 'magic' })).toBeNull();
    expect(hdrSourceMatches(described, inputs)).toBe(true);
    expect(hdrSourceMatches(described, inputs.slice(1))).toBe(false);
    const id = await hdrIdentity('radiance', inputs);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(await hdrIdentity('radiance', [...inputs].reverse())).toBe(id);
    expect(await hdrIdentity('fusion', inputs)).not.toBe(id);
  });

  test('median brightness orders a bracket', () => {
    const frames = rawBracket();
    const values = frames.map(({ image }) => medianBrightness(image));
    expect(suggestRolesFromBrightness(values)).toEqual(['under', 'normal', 'over']);
    expect(() => analyzeBracket(frames.map((frame, index) => ({ ...frame, image: index ? frame.image : { ...frame.image, width: 10 } })), { mode: 'radiance', reference: 1 })).toThrow(HdrError);
  });
});
