import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findCfaStrip, PHOTOMETRIC_CFA, TAGS } from '../src/tiff.mjs';
import { cfaPositionMeans, changedSamplesPerRow } from '../src/decode.mjs';

// Builds a little-endian TIFF: IFD0 (make, model, SubIFD pointer) -> SubIFD (CFA strip).
function syntheticRaw({ width = 8, height = 4, compression = 32767 } = {}) {
  const bytes = new Uint8Array(512);
  const view = new DataView(bytes.buffer);
  bytes.set([0x49, 0x49]);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  const writeIfd = (offset, entries, next = 0) => {
    view.setUint16(offset, entries.length, true);
    entries.forEach(([tag, type, count, value], i) => {
      const at = offset + 2 + i * 12;
      view.setUint16(at, tag, true);
      view.setUint16(at + 2, type, true);
      view.setUint32(at + 4, count, true);
      if (type === 3 && count === 1) view.setUint16(at + 8, value, true);
      else view.setUint32(at + 8, value, true);
    });
    view.setUint32(offset + 2 + entries.length * 12, next, true);
  };
  bytes.set(new TextEncoder().encode('SONY\0'), 200);
  bytes.set(new TextEncoder().encode('TEST\0'), 210);
  writeIfd(8, [
    [TAGS.make, 2, 5, 200],
    [TAGS.model, 2, 5, 210],
    [TAGS.subIfds, 4, 1, 100],
  ]);
  writeIfd(100, [
    [TAGS.width, 3, 1, width],
    [TAGS.height, 3, 1, height],
    [TAGS.bitsPerSample, 3, 1, 12],
    [TAGS.compression, 3, 1, compression],
    [TAGS.photometric, 3, 1, PHOTOMETRIC_CFA],
    [TAGS.stripOffsets, 4, 1, 300],
    [TAGS.stripByteCounts, 4, 1, width * height],
  ]);
  return bytes;
}

test('finds the CFA strip through the SubIFD pointer', () => {
  assert.deepEqual(findCfaStrip(syntheticRaw()), {
    width: 8, height: 4, bitsPerSample: 12, compression: 32767, offset: 300, byteCount: 32, make: 'SONY', model: 'TEST',
  });
});

test('rejects files that are not TIFF-based', () => {
  assert.throws(() => findCfaStrip(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])), /Not a TIFF/);
});

test('cfaPositionMeans separates the four 2x2 positions', () => {
  // RGGB-like mosaic: positions hold 100, 50, 50, 20 above a black level of 10.
  const width = 6;
  const height = 4;
  const mosaic = new Uint16Array(width * height).map((_, i) => {
    const x = i % width;
    const y = Math.floor(i / width);
    return [110, 60, 60, 30][((y & 1) << 1) | (x & 1)];
  });
  assert.deepEqual(cfaPositionMeans(mosaic, width, height, 10), [100, 50, 50, 20]);
});

test('changedSamplesPerRow localises differences', () => {
  const first = new Uint16Array(12);
  const second = first.slice();
  second[5] = 1;
  second[8] = 1;
  assert.deepEqual([...changedSamplesPerRow(first, second, 4, 3)], [0, 1, 1]);
});
