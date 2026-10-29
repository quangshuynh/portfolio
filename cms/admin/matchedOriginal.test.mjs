// @vitest-environment node
// The treatment comparison frames the original like the edit: same aspect, same scene region.
import { exportGeometry } from '../../src/editor/io/files.mjs';
import { matchOriginalPixels, matchedFrame } from './matchedOriginal.js';

// Four flat quadrants (red, green, blue, white) so a framing error shows as the wrong colour.
function quadrants(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  const colours = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set([...colours[(y >= height / 2) * 2 + (x >= width / 2)], 255], (y * width + x) * 4);
  }
  return { width, height, data };
}
const at = (image, u, v) => [...image.data.subarray(((Math.floor(v * image.height) * image.width) + Math.floor(u * image.width)) * 4, ((Math.floor(v * image.height) * image.width) + Math.floor(u * image.width)) * 4 + 3)];

test('no geometry needs no matching', () => {
  expect(matchedFrame(undefined, { width: 400, height: 300 })).toBeNull();
  expect(matchOriginalPixels(quadrants(40, 30), { angle: 0 })).toBeNull();
});

test('a landscape crop shows the cropped region at the edit\'s aspect ratio', () => {
  // The top-left quarter of the photo: all red.
  const geometry = { crop: { x: 0, y: 0, width: 0.5, height: 0.5 } };
  const matched = matchOriginalPixels(quadrants(400, 300), geometry);
  expect([matched.width, matched.height]).toEqual([200, 150]);
  expect(at(matched, 0.1, 0.1)).toEqual([255, 0, 0]);
  expect(at(matched, 0.9, 0.9)).toEqual([255, 0, 0]);
  // The same aspect as the edit's own output for the native photo.
  const native = exportGeometry(geometry, { width: 6000, height: 4500 }).output;
  expect(matched.width / matched.height).toBeCloseTo(native.width / native.height, 2);
});

test('a portrait crop across the middle keeps both halves where the edit has them', () => {
  const geometry = { crop: { x: 0.25, y: 0, width: 0.5, height: 1 } };
  const matched = matchOriginalPixels(quadrants(300, 400), geometry);
  expect(matched.height).toBeGreaterThan(matched.width);
  expect(at(matched, 0.1, 0.1)).toEqual([255, 0, 0]);
  expect(at(matched, 0.9, 0.1)).toEqual([0, 255, 0]);
  expect(at(matched, 0.1, 0.9)).toEqual([0, 0, 255]);
  expect(at(matched, 0.9, 0.9)).toEqual([255, 255, 255]);
});

test('a quarter turn and straightening follow the edit; nothing is stretched', () => {
  const turned = matchOriginalPixels(quadrants(400, 300), { quarterTurns: 1 });
  expect([turned.width, turned.height]).toEqual([300, 400]);
  // Clockwise: the bottom-left (blue) quadrant comes to the top left.
  expect(at(turned, 0.1, 0.1)).toEqual([0, 0, 255]);
  const straightened = matchOriginalPixels(quadrants(400, 300), { angle: 3 });
  const native = exportGeometry({ angle: 3 }, { width: 400, height: 300 }).output;
  expect([straightened.width, straightened.height]).toEqual([native.width, native.height]);
});

test('large originals are reduced to the viewer size, never enlarged', () => {
  const frame = matchedFrame({ crop: { x: 0, y: 0, width: 0.5, height: 1 } }, { width: 8000, height: 4000 }, 2200);
  expect(Math.max(frame.out.width, frame.out.height)).toBe(2200);
  const small = matchedFrame({ crop: { x: 0, y: 0, width: 0.5, height: 1 } }, { width: 800, height: 400 }, 2200);
  expect(small.out).toEqual({ width: 400, height: 400 });
});
