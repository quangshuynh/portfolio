import { describe, expect, test } from 'vitest';
import {
  ANGLE_LIMIT, GeometryError, MIN_CROP, constrainGeometry, cropAllowed, cropRatio, decodeSize, dragCrop, fitCrop, flipGeometry,
  frameGeometry, geometryEqual, geometryNeutral, geometryPlan, homography, invert3, keystoneQuad, largestCrop, multiply3,
  neutralGeometry, normalizeGeometry, project, rectInsideQuad, setAspect, swapAspect, turnGeometry,
} from './geometry.mjs';
import { applyCoverage, coverageAt, cubicWeights, exactMapping, warpImage, warpRows, warpSpec } from './warp.mjs';
import { exportDimensions, exportGeometry } from '../io/files.mjs';
import { renderDetailImage } from './detailRenderer.mjs';
import { renderRegion, warpedRegionSource } from './detailRegion.mjs';
import { deriveParams } from './spec.mjs';
import { normalizeAdjustments } from '../model/adjustments.mjs';

const g = (patch = {}) => normalizeGeometry({ ...neutralGeometry(), ...patch });
const SIZE = { width: 600, height: 400 };

/** RGBA8 test image whose pixel (x, y) encodes its coordinates. */
function coordinateImage(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set([x, y, (x * 7 + y * 13) % 256, 255], (y * width + x) * 4);
  }
  return { width, height, data };
}

const pixel = (image, x, y) => Array.from(image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));

describe('geometry model', () => {
  test('neutral geometry is the identity and keeps exports exactly as before', () => {
    const plan = geometryPlan(g(), SIZE);
    expect(plan.identity).toBe(true);
    expect(plan.native).toEqual(SIZE);
    const resize = { mode: 'long-edge', longEdge: 300 };
    const sizes = exportGeometry(undefined, SIZE, resize);
    const { width, height } = exportDimensions(SIZE, resize);
    expect(sizes).toMatchObject({ identity: true, output: { width, height }, decode: { width, height } });
    expect(geometryNeutral(normalizeGeometry({ aspect: '3:2', constrain: false, background: 'black' }))).toBe(true);
  });

  test('imported values are validated: clamped, malformed parts neutral, unknown keys dropped', () => {
    const value = normalizeGeometry({
      quarterTurns: 7, flipH: 'yes', angle: 90.123, perspective: { vertical: 400, horizontal: 'x' }, stretch: { x: 1, y: 9999 },
      crop: { x: -1, y: 0.5, width: 0, height: 2 }, aspect: '<script>', background: 'red', resize: { width: -5, height: 10 }, extra: 1,
      quad: [[0, 0], [1, 0], [1, 1]],
    });
    expect(value).toEqual({
      ...neutralGeometry(),
      quarterTurns: 3,
      angle: ANGLE_LIMIT,
      perspective: { vertical: 100, horizontal: 0 },
      stretch: { x: 50, y: 200 },
      crop: { x: 0, y: 0.5, width: MIN_CROP, height: 0.5 },
    });
    expect(normalizeGeometry({ crop: { x: NaN, y: 0, width: 1, height: 1 } }).crop).toBeNull();
    expect(normalizeGeometry({ resize: { width: 0, height: 0 } }).resize).toBeNull();
    expect(normalizeGeometry({ aspect: '16:9' }).aspect).toBe('16:9');
    expect(normalizeGeometry({ aspect: '1.91:1' }).aspect).toBe('1.91:1');
    expect(normalizeGeometry({ aspect: '0:1' }).aspect).toBe('free');
  });

  test('degenerate, folded or collinear perspective quads are rejected', () => {
    expect(normalizeGeometry({ quad: [[0, 0], [1, 0], [0.5, 0], [0, 1]] }).quad).toBeNull();
    expect(normalizeGeometry({ quad: [[1, 0], [0, 0], [1, 1], [0, 1]] }).quad).toBeNull();
    expect(normalizeGeometry({ quad: [[0.45, 0.45], [0.55, 0.45], [0.55, 0.55], [0.45, 0.55]] }).quad).toBeNull();
    expect(normalizeGeometry({ quad: [[0.1, 0], [0.9, 0.05], [1, 1], [0, 1]] }).quad).toEqual([[0.1, 0], [0.9, 0.05], [1, 1], [0, 1]]);
    expect(homography([[0, 0], [1, 0], [2, 0], [3, 0]], [[0, 0], [1, 0], [1, 1], [0, 1]])).toBeNull();
    expect(invert3([1, 2, 3, 2, 4, 6, 0, 0, 1])).toBeNull();
  });

  test('equality covers every part', () => {
    expect(geometryEqual(g(), g())).toBe(true);
    for (const patch of [{ angle: 1 }, { flipV: true }, { crop: { x: 0.1, y: 0, width: 0.5, height: 1 } }, { aspect: '1:1' }, { resize: { width: 10, height: 10 } }, { quad: keystoneQuad(50, 0) }]) {
      expect(geometryEqual(g(), g(patch))).toBe(false);
    }
  });
});

describe('transform matrices', () => {
  test('quarter turns and flips map pixel centres exactly, and compose as expected', () => {
    const image = coordinateImage(5, 3);
    const warp = (geometry) => {
      const plan = geometryPlan(g(geometry), image);
      return warpImage(image, plan.toSource(plan.native, image), plan.native);
    };
    const cw = warp({ quarterTurns: 1 });
    expect([cw.width, cw.height]).toEqual([3, 5]);
    // Clockwise: the output's top-left is the source's bottom-left.
    expect(pixel(cw, 0, 0).slice(0, 2)).toEqual([0, 2]);
    expect(pixel(cw, 2, 0).slice(0, 2)).toEqual([0, 0]);
    expect(pixel(cw, 0, 4).slice(0, 2)).toEqual([4, 2]);
    const half = warp({ quarterTurns: 2 });
    expect(pixel(half, 0, 0).slice(0, 2)).toEqual([4, 2]);
    const ccw = warp({ quarterTurns: 3 });
    expect(pixel(ccw, 0, 0).slice(0, 2)).toEqual([4, 0]);
    const flipH = warp({ flipH: true });
    expect(pixel(flipH, 0, 1).slice(0, 2)).toEqual([4, 1]);
    const flipV = warp({ flipV: true });
    expect(pixel(flipV, 1, 0).slice(0, 2)).toEqual([1, 2]);
    // Flips act in the turned frame: turn then flip horizontally is a transpose.
    const transposed = warp({ quarterTurns: 1, flipH: true });
    for (let y = 0; y < 5; y += 1) for (let x = 0; x < 3; x += 1) expect(pixel(transposed, x, y).slice(0, 2)).toEqual([y, x]);
    expect(Array.from(warp({ flipH: true, flipV: true, quarterTurns: 2 }).data)).toEqual(Array.from(image.data));
  });

  test('an axis-aligned crop at full size copies pixels exactly (no resampling)', () => {
    const image = coordinateImage(40, 30);
    const plan = geometryPlan(g({ crop: { x: 0.25, y: 0.1, width: 0.5, height: 0.5 } }), image);
    expect(plan.crop).toEqual({ x: 10, y: 3, width: 20, height: 15 });
    const matrix = plan.toSource(plan.native, image);
    expect(exactMapping(matrix)).not.toBeNull();
    const out = warpImage(image, matrix, plan.native);
    expect(pixel(out, 0, 0)).toEqual(pixel(image, 10, 3));
    expect(pixel(out, 19, 14)).toEqual(pixel(image, 29, 17));
  });

  test('every step maps output centres back consistently with the forward transform', () => {
    const geometry = g({ quarterTurns: 1, flipV: true, angle: 7.5, perspective: { vertical: 40, horizontal: -25 }, stretch: { x: 130, y: 100 }, crop: { x: 0.2, y: 0.15, width: 0.5, height: 0.6 }, constrain: false });
    const plan = geometryPlan(geometry, SIZE);
    const matrix = plan.toSource(plan.native, SIZE);
    const inverse = invert3(matrix);
    for (const [x, y] of [[0.5, 0.5], [plan.native.width - 0.5, 3.5], [100.25, 77.75]]) {
      const [sx, sy] = project(matrix, x, y);
      const [bx, by] = project(inverse, sx, sy);
      expect(bx).toBeCloseTo(x, 6);
      expect(by).toBeCloseTo(y, 6);
    }
    // The same transform at another scale (a proxy) maps to the same normalised positions.
    const proxy = { width: 300, height: 200 };
    const small = { width: plan.native.width / 2, height: plan.native.height / 2 };
    const [nx, ny] = project(plan.toSource(small, proxy), 20, 30);
    const [fx, fy] = project(matrix, 40, 60);
    expect(nx / proxy.width).toBeCloseTo(fx / SIZE.width, 9);
    expect(ny / proxy.height).toBeCloseTo(fy / SIZE.height, 9);
  });

  test('rotation turns about the frame centre, clockwise for positive angles', () => {
    const plan = geometryPlan(g({ angle: 30 }), { width: 200, height: 200 });
    const matrix = plan.toSource(plan.native, { width: 200, height: 200 });
    const [cx, cy] = project(matrix, 100, 100);
    expect([cx, cy].map((v) => Number(v.toFixed(9)))).toEqual([100, 100]);
    // The output point straight above the centre comes from a point up and to the left in
    // the source (the image turned clockwise under a fixed frame).
    const [sx, sy] = project(matrix, 100, 50);
    expect(sx).toBeLessThan(100);
    expect(sy).toBeGreaterThan(50);
  });

  test('keystone: the quad maps onto the frame, positive vertical widens the top', () => {
    const quad = keystoneQuad(100, 0);
    expect(quad[0][0]).toBeCloseTo(0.2);
    expect(quad[1][0]).toBeCloseTo(0.8);
    const plan = geometryPlan(g({ perspective: { vertical: 100, horizontal: 0 } }), { width: 100, height: 100 });
    const matrix = plan.toSource(plan.native, { width: 100, height: 100 });
    const [x0] = project(matrix, 0, 0);
    expect(x0).toBeCloseTo(20, 6);
    const [x1] = project(matrix, 0, 100);
    expect(x1).toBeCloseTo(0, 6);
    expect(plan.covered).toBe(true);
    // Keystone keeps the frame filled: every output pixel samples inside the source.
    expect(rectInsideQuad({ x: 0, y: 0, width: 1, height: 1 }, plan.content)).toBe(true);
  });

  test('a perspective that would send part of the photo to infinity is refused', () => {
    expect(() => geometryPlan(g({ angle: 45, quad: [[0.3, 0], [0.7, 0], [1, 1], [0, 1]] }), { width: 4000, height: 100 })).toThrow(GeometryError);
  });

  test('stretch changes proportions without adding pixels; resize fits, never upscales', () => {
    const stretched = geometryPlan(g({ stretch: { x: 150, y: 100 } }), SIZE);
    expect(stretched.frame).toEqual({ width: 600, height: 267 });
    const locked = geometryPlan(g({ resize: { width: 300, height: 1000, locked: true } }), SIZE);
    expect(locked.native).toEqual({ width: 300, height: 200 });
    const large = geometryPlan(g({ resize: { width: 5000, height: 5000, locked: true } }), SIZE);
    expect(large.native).toEqual(SIZE);
    const free = geometryPlan(g({ resize: { width: 300, height: 390, locked: false } }), SIZE);
    expect(free.native).toEqual({ width: 300, height: 390 });
  });

  test('export sizes: geometry output, then the export resize; decode only as large as needed', () => {
    const cropped = exportGeometry({ crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } }, { width: 6000, height: 4000 }, { mode: 'original' });
    expect(cropped.output).toEqual({ width: 3000, height: 2000 });
    expect(cropped.decode).toEqual({ width: 6000, height: 4000 });
    const small = exportGeometry({ crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } }, { width: 6000, height: 4000 }, { mode: 'long-edge', longEdge: 1500 });
    expect(small.output).toEqual({ width: 1500, height: 1000 });
    expect(small.decode).toEqual({ width: 3000, height: 2000 });
    const turned = exportGeometry({ quarterTurns: 1, resize: { width: 1000, height: 1000, locked: true } }, { width: 6000, height: 4000 }, { mode: 'original' });
    expect(turned.output).toEqual({ width: 667, height: 1000 });
    expect(turned.decode).toEqual({ width: 1001, height: 667 });
    // Stretch keeps full resolution on the stretched axis.
    const stretched = exportGeometry({ stretch: { x: 100, y: 200 } }, { width: 600, height: 400 }, { mode: 'original' });
    expect(stretched.output).toEqual({ width: 300, height: 400 });
    expect(stretched.decode).toEqual({ width: 600, height: 400 });
    const plan = geometryPlan(g({ angle: 10 }), SIZE);
    expect(decodeSize(plan, plan.native, SIZE)).toEqual(SIZE);
  });

  test('the crop tool view is the same transform without crop and resize', () => {
    expect(frameGeometry(g({ crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 }, resize: { width: 10, height: 10, locked: true }, angle: 3 }))).toMatchObject({ crop: null, resize: null, angle: 3 });
  });
});

describe('turning and flipping the result', () => {
  const PHOTO = { width: 6000, height: 4000 };
  const edited = g({ angle: 6.5, perspective: { vertical: 35, horizontal: -20 }, stretch: { x: 120, y: 100 }, crop: { x: 0.2, y: 0.15, width: 0.5, height: 0.6 }, aspect: '3:2', constrain: false, flipV: true });
  // Where an output pixel of `geometry` samples the photo, as a fraction of its size.
  const sample = (geometry, x, y) => {
    const plan = geometryPlan(geometry, PHOTO);
    const [sx, sy] = project(plan.toSource(plan.native, PHOTO), x, y);
    return { at: [sx / PHOTO.width, sy / PHOTO.height], plan };
  };

  test('a quarter turn rotates the shown result: the same pixels, turned clockwise', () => {
    const before = geometryPlan(edited, PHOTO);
    const turned = turnGeometry(edited, 1);
    expect(turned.aspect).toBe('2:3');
    const { plan } = sample(turned, 0, 0);
    expect(Math.abs(plan.native.width - before.native.height)).toBeLessThanOrEqual(1);
    for (const [x, y] of [[10.5, 20.5], [500.5, 100.5], [plan.native.width - 3.5, plan.native.height - 7.5]]) {
      const a = sample(turned, x, y).at;
      const b = sample(edited, y, before.native.height - x).at;
      expect(Math.abs(a[0] - b[0])).toBeLessThan(5e-4);
      expect(Math.abs(a[1] - b[1])).toBeLessThan(5e-4);
    }
    expect(turnGeometry(edited, 4)).toEqual(edited);
    expect(turnGeometry(turnGeometry(edited, 1), -1)).toEqual(edited);
  });

  test('flips mirror the shown result, crop, angle and perspective included', () => {
    for (const axis of ['horizontal', 'vertical']) {
      const flipped = flipGeometry(edited, axis);
      const before = geometryPlan(edited, PHOTO);
      for (const [x, y] of [[10.5, 20.5], [700.5, 300.5]]) {
        const a = sample(flipped, x, y).at;
        const b = axis === 'horizontal' ? sample(edited, before.native.width - x, y).at : sample(edited, x, before.native.height - y).at;
        expect(Math.abs(a[0] - b[0])).toBeLessThan(5e-4);
        expect(Math.abs(a[1] - b[1])).toBeLessThan(5e-4);
      }
      expect(flipGeometry(flipped, axis)).toEqual(edited);
    }
  });

  test('crop to fill shrinks a crop that left the rotated photo, and creates one with the photo proportions', () => {
    const rotated = constrainGeometry(g({ angle: 10 }), PHOTO);
    const plan = geometryPlan(rotated, PHOTO);
    expect(plan.covered).toBe(true);
    expect(plan.crop.width / plan.crop.height).toBeCloseTo(1.5, 2);
    expect(constrainGeometry(g({ angle: 10, constrain: false }), PHOTO).crop).toBeNull();
    const kept = g({ crop: { x: 0.3, y: 0.3, width: 0.2, height: 0.2 }, angle: 2 });
    expect(constrainGeometry(kept, PHOTO).crop).toEqual(kept.crop);
  });

  test('choosing a ratio makes the largest crop with it around the current centre', () => {
    const square = setAspect(g(), '1:1', PHOTO);
    const plan = geometryPlan(square, PHOTO);
    expect(plan.crop.width).toBe(plan.crop.height);
    expect(plan.crop.height).toBe(4000);
    const portrait = setAspect(g({ angle: 8 }), '4:5', PHOTO);
    const rotated = geometryPlan(portrait, PHOTO);
    expect(rotated.covered).toBe(true);
    expect(rotated.crop.width / rotated.crop.height).toBeCloseTo(0.8, 2);
    expect(setAspect(g({ crop: { x: 0.1, y: 0.1, width: 0.3, height: 0.3 } }), 'free', PHOTO).crop).toEqual({ x: 0.1, y: 0.1, width: 0.3, height: 0.3 });
  });
});

describe('crop constraints', () => {
  test('aspect ratios are in pixels of the frame and can be turned', () => {
    expect(cropRatio('free', SIZE)).toBeNull();
    expect(cropRatio('original', SIZE)).toBe(1);
    expect(cropRatio('1:1', SIZE)).toBeCloseTo(400 / 600);
    expect(swapAspect('3:2')).toBe('2:3');
    expect(swapAspect('free')).toBe('free');
  });

  test('after rotation the largest crop with a ratio stays inside the rotated photo', () => {
    const plan = geometryPlan(g({ angle: 12 }), SIZE);
    const ratio = cropRatio('3:2', plan.frame);
    const crop = largestCrop(ratio, plan.content);
    expect(rectInsideQuad(crop, plan.content, 1e-9)).toBe(true);
    expect((crop.width * plan.frame.width) / (crop.height * plan.frame.height)).toBeCloseTo(1.5, 6);
    expect(crop.width).toBeGreaterThan(0.6);
    const cropped = geometryPlan(g({ angle: 12, crop }), SIZE);
    expect(cropped.covered).toBe(true);
  });

  test('dragging a corner with a ratio keeps the ratio and the opposite corner', () => {
    const start = { x: 0.2, y: 0.2, width: 0.4, height: 0.4 };
    const rect = dragCrop(start, 'se', 0.2, 0.05, { ratio: 1 });
    expect(rect.x).toBeCloseTo(0.2);
    expect(rect.y).toBeCloseTo(0.2);
    expect(rect.width).toBeCloseTo(0.6);
    expect(rect.height).toBeCloseTo(0.6);
    const edge = dragCrop(start, 'e', 0.1, 0, { ratio: 2 });
    expect(edge.width / edge.height).toBeCloseTo(2);
    expect(edge.y + edge.height / 2).toBeCloseTo(0.4);
  });

  test('drags stop at the frame and, when constrained, at the rotated photo', () => {
    const start = { x: 0.5, y: 0.5, width: 0.3, height: 0.3 };
    const free = dragCrop(start, 'se', 1, 1);
    expect(free.x + free.width).toBeCloseTo(1);
    expect(free.y + free.height).toBeCloseTo(1);
    const moved = dragCrop(start, 'move', 1, -0.1);
    expect(moved.x + moved.width).toBeCloseTo(1);
    expect(moved.y).toBeCloseTo(0.4);
    const plan = geometryPlan(g({ angle: 20 }), SIZE);
    const constrained = dragCrop({ x: 0.3, y: 0.3, width: 0.3, height: 0.3 }, 'se', 1, 1, { content: plan.content });
    expect(cropAllowed(constrained, plan.content)).toBe(true);
    expect(constrained.width).toBeGreaterThan(0.3);
    const shrinks = dragCrop({ x: 0.3, y: 0.3, width: 0.3, height: 0.3 }, 'nw', -1, -1, { ratio: 1, content: plan.content });
    expect(cropAllowed(shrinks, plan.content)).toBe(true);
    expect(shrinks.width / shrinks.height).toBeCloseTo(1, 6);
  });

  test('fitCrop pulls a crop whose centre left the photo back inside', () => {
    const plan = geometryPlan(g({ angle: 40 }), SIZE);
    const fitted = fitCrop({ x: 0, y: 0, width: 0.2, height: 0.2 }, null, plan.content);
    expect(cropAllowed(fitted, plan.content)).toBe(true);
  });
});

describe('resampling', () => {
  test('Catmull-Rom weights sum to one and are exact at whole pixels', () => {
    const w = new Float64Array(4);
    for (const t of [0, 0.25, 0.5, 0.9]) expect(cubicWeights(t, w).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(Array.from(cubicWeights(0, w))).toEqual([0, 1, 0, 0]);
  });

  test('a flat image stays flat under rotation and perspective (no ringing, edges clamped)', () => {
    const image = { width: 32, height: 24, data: new Uint8ClampedArray(32 * 24 * 4).fill(173) };
    const plan = geometryPlan(g({ angle: 17, perspective: { vertical: 60, horizontal: 30 }, constrain: false }), image);
    const out = warpImage(image, plan.toSource(plan.native, image), plan.native);
    expect(new Set(out.data)).toEqual(new Set([173]));
  });

  test('transparent neighbours never bleed their colour (premultiplied interpolation)', () => {
    const image = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4) };
    for (let i = 0; i < 64; i += 1) image.data.set(i % 8 < 4 ? [255, 0, 0, 0] : [0, 0, 255, 255], i * 4);
    const plan = geometryPlan(g({ angle: 5 }), image);
    const out = warpImage(image, plan.toSource(plan.native, image), plan.native);
    for (let i = 0; i < out.data.length; i += 4) if (out.data[i + 3] > 0) expect(out.data[i]).toBe(0);
  });

  test('RAW (16-bit) and merged HDR (float) sources keep their type and range', () => {
    const raw = { kind: 'raw', width: 10, height: 10, data: new Uint16Array(300).map((_, i) => (i % 3 === 0 ? 65535 : 1000)) };
    const plan = geometryPlan(g({ angle: 9 }), raw);
    const warped = warpImage(raw, plan.toSource(plan.native, raw), plan.native);
    expect(warped.kind).toBe('raw');
    expect(warped.data).toBeInstanceOf(Uint16Array);
    expect(Math.max(...warped.data)).toBeLessThanOrEqual(65535);
    const hdr = { kind: 'hdr', width: 10, height: 10, data: new Float32Array(300).fill(3.5) };
    const out = warpImage(hdr, plan.toSource(plan.native, hdr), plan.native);
    expect(out.data).toBeInstanceOf(Float32Array);
    out.data.forEach((v) => expect(v).toBeCloseTo(3.5, 5));
  });

  test('bands of any height reproduce the whole warp (no seams or duplicated rows)', () => {
    const image = coordinateImage(60, 40);
    const plan = geometryPlan(g({ angle: -11, perspective: { vertical: 20, horizontal: 0 }, crop: { x: 0.1, y: 0.1, width: 0.7, height: 0.8 } }), image);
    const matrix = plan.toSource(plan.native, image);
    const whole = warpImage(image, matrix, plan.native);
    const banded = new Uint8ClampedArray(whole.data.length);
    for (let row = 0; row < plan.native.height; row += 7) {
      const last = Math.min(plan.native.height, row + 7);
      warpRows(image, matrix, plan.native.width, row, last, banded.subarray(row * plan.native.width * 4, last * plan.native.width * 4));
    }
    expect(Array.from(banded)).toEqual(Array.from(whole.data));
  });

  test('outside the photo: transparent, or the chosen background composited', () => {
    const image = { width: 20, height: 20, data: new Uint8ClampedArray(1600).fill(128) };
    const plan = geometryPlan(g({ angle: 30, constrain: false }), image);
    expect(plan.covered).toBe(false);
    const spec = warpSpec(plan, plan.native, image);
    const corner = coverageAt(spec.matrix, spec.src, spec.scale, 0, 0);
    expect(corner).toBe(0);
    expect(coverageAt(spec.matrix, spec.src, spec.scale, 10, 10)).toBe(1);
    const rgba = new Uint8ClampedArray(20 * 20 * 4).fill(128);
    applyCoverage(rgba, 20, 0, 20, { ...spec, background: 'transparent' });
    expect(rgba[3]).toBe(0);
    const black = new Uint8ClampedArray(20 * 20 * 4).fill(128);
    applyCoverage(black, 20, 0, 20, { ...spec, background: 'black' });
    expect(pixel({ width: 20, data: black }, 0, 0)).toEqual([0, 0, 0, 255]);
    const jpeg = new Uint8ClampedArray(20 * 20 * 4).fill(128);
    applyCoverage(jpeg, 20, 0, 20, { ...spec, background: 'transparent', flatten: true });
    expect(pixel({ width: 20, data: jpeg }, 0, 0)).toEqual([255, 255, 255, 255]);
  });

  test('Detail after geometry: banded rendering of the warped image equals a whole render', () => {
    const image = coordinateImage(90, 70);
    const plan = geometryPlan(g({ angle: 6, crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } }), image);
    const warped = warpImage(image, plan.toSource(plan.native, image), plan.native);
    const params = deriveParams(normalizeAdjustments({ texture: 60, clarity: 40, sharpening: 50, luminanceNoise: 20 }));
    const whole = renderDetailImage(warped, params, { bandRows: 1000 });
    const bands = renderDetailImage(warped, params, { bandRows: 9, tileWidth: 13 });
    expect(Array.from(bands)).toEqual(Array.from(whole));
  });

  test('1:1 inspection with geometry renders exactly the export pixels of the region', () => {
    const image = coordinateImage(120, 90);
    const plan = geometryPlan(g({ angle: -8, constrain: false, background: 'black', crop: { x: 0, y: 0, width: 0.9, height: 1 } }), image);
    const adjustments = normalizeAdjustments({ texture: 50, clarity: 30, sharpening: 40, contrast: 20 });
    const spec = warpSpec(plan, plan.native, image);
    const warped = warpImage(image, spec.matrix, spec);
    const full = renderDetailImage(warped, deriveParams(adjustments), { nativeWidth: plan.native.width, nativeHeight: plan.native.height });
    applyCoverage(full, spec.width, 0, spec.height, spec);
    const region = { x: 3, y: 5, width: 40, height: 30 };
    const kept = warpedRegionSource(image, plan, { x: 0, y: 0, width: 70, height: 60 });
    const { after } = renderRegion(kept, region, { adjustments });
    for (let y = 0; y < region.height; y += 1) {
      for (let x = 0; x < region.width; x += 1) {
        expect(pixel({ width: region.width, data: after }, x, y)).toEqual(pixel({ width: plan.native.width, data: full }, region.x + x, region.y + y));
      }
    }
  });

  test('a long chain of transforms stays numerically stable', () => {
    let m = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const plan = geometryPlan(g({ angle: 0.05, perspective: { vertical: 1, horizontal: -1 } }), { width: 16384, height: 16384 });
    const step = plan.toSource(plan.native, { width: 16384, height: 16384 });
    const back = invert3(step);
    for (let i = 0; i < 50; i += 1) m = multiply3(back, multiply3(step, m));
    m.forEach((v, i) => expect(v).toBeCloseTo([1, 0, 0, 0, 1, 0, 0, 0, 1][i], 6));
  });
});
