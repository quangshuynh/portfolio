// Genuine-decoding checks against a real camera file. The fixture is not committed:
// set RAW_FIXTURE to an .ARW or .DNG path (see README.md). Without it these tests are
// reported as skipped, which is not evidence of compatibility.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import { changedSamplesPerRow, cfaPositionMeans, LINEAR_SETTINGS, withRaw } from '../src/decode.mjs';
import { findCfaStrip } from '../src/tiff.mjs';

const fixturePath = process.env.RAW_FIXTURE;
const skip = fixturePath ? false : 'RAW_FIXTURE is not set; no camera file to decode';
const SONY_ARW_COMPRESSED = 32767;

describe('RAW fixture', { skip }, async () => {
  const bytes = fixturePath ? new Uint8Array(await readFile(fixturePath)) : null;

  test('LibRaw reads the sensor geometry the file declares', async () => {
    const strip = findCfaStrip(bytes);
    const meta = await withRaw(bytes, LINEAR_SETTINGS, (raw) => raw.metadata(true));
    assert.equal(meta.raw_width, strip.width);
    assert.equal(meta.raw_height, strip.height);
    assert.ok(meta.colors === 3 && meta.filters !== 0, 'expected a Bayer sensor');
  });

  test('raw mosaic is undemosaiced 16-bit sensor data with per-site CFA structure', async () => {
    const { meta, mosaic } = await withRaw(bytes, LINEAR_SETTINGS, (raw) => ({ meta: raw.metadata(true), mosaic: raw.rawImageData() }));
    assert.ok(mosaic.data instanceof Uint16Array);
    assert.equal(mosaic.data.length, mosaic.raw_width * mosaic.raw_height);
    const black = meta.color_data.black;
    const [p0, p1, p2, p3] = cfaPositionMeans(mosaic.data, mosaic.raw_width, mosaic.raw_height, black);
    // Two of the four sites are green and track each other; the other two (red, blue)
    // differ from green because nothing has white-balanced or interpolated them yet.
    const means = [p0, p1, p2, p3];
    const pairs = [[0, 3], [1, 2]];
    const greenPair = pairs.find(([a, b]) => Math.abs(means[a] - means[b]) / Math.max(means[a], means[b]) < 0.05);
    assert.ok(greenPair, `no matching green pair in ${means.map((m) => m.toFixed(1))}`);
    const others = pairs.find((pair) => pair !== greenPair).map((i) => means[i]);
    const green = (means[greenPair[0]] + means[greenPair[1]]) / 2;
    assert.ok(others.every((value) => Math.abs(value - green) / green > 0.1), 'red/blue sites look demosaiced');
  });

  test('full-resolution 16-bit render is far larger than the embedded preview', async () => {
    const { meta, image } = await withRaw(bytes, LINEAR_SETTINGS, (raw) => ({ meta: raw.metadata(false), image: raw.imageData() }));
    assert.equal(image.bits, 16);
    assert.equal(image.colors, 3);
    assert.equal(image.data.length, image.width * image.height * 3);
    assert.ok(image.width * image.height >= 3 * meta.thumb_width * meta.thumb_height);
  });

  test('LINEAR_SETTINGS output is scene-linear: +1 EV doubles unclipped values', async () => {
    const half = { ...LINEAR_SETTINGS, halfSize: true };
    const base = await withRaw(bytes, half, (raw) => raw.imageData().data);
    const brighter = await withRaw(bytes, { ...half, expCorrec: true, expShift: 2, expPreser: 0 }, (raw) => raw.imageData().data);
    const ratios = [];
    for (let i = 0; i < base.length; i += 97) {
      if (base[i] > 655 && base[i] < 26000) ratios.push(brighter[i] / base[i]);
    }
    ratios.sort((a, b) => a - b);
    const median = ratios[Math.floor(ratios.length / 2)];
    // A gamma-encoded render (LibRaw's default BT.709 curve) would give about 2^0.45 = 1.37.
    assert.ok(Math.abs(median - 2) < 0.05, `median ratio ${median.toFixed(3)} over ${ratios.length} samples`);
  });

  test('corrupting one stored sensor row changes that row only; the preview is untouched', async (t) => {
    const strip = findCfaStrip(bytes);
    const bytesPerRow = strip.byteCount / strip.height;
    if (strip.compression !== SONY_ARW_COMPRESSED && strip.compression !== 1) {
      t.skip(`row-local corruption check needs uncompressed or Sony ARW2 data (compression ${strip.compression})`);
      return;
    }
    const row = Math.floor(strip.height / 2);
    const corrupted = bytes.slice();
    const rowStart = strip.offset + row * bytesPerRow;
    for (let i = 0; i < bytesPerRow; i += 1) corrupted[rowStart + i] = (corrupted[rowStart + i] * 37 + 101) & 0xff;

    const read = (raw) => ({ mosaic: raw.rawImageData(), preview: raw.thumbnailData().data });
    const { mosaic: before, preview: previewBefore } = await withRaw(bytes, LINEAR_SETTINGS, read);
    const { mosaic: after, preview: previewAfter } = await withRaw(corrupted, LINEAR_SETTINGS, read);
    const changed = changedSamplesPerRow(before.data, after.data, before.raw_width, before.raw_height);
    const elsewhere = changed.reduce((sum, count, y) => (Math.abs(y - row) > 0 ? sum + count : sum), 0);
    assert.ok(changed[row] > before.raw_width / 2, `only ${changed[row]} samples changed in the corrupted row`);
    assert.equal(elsewhere, 0, 'samples outside the corrupted row changed');
    assert.deepEqual(Buffer.from(previewAfter), Buffer.from(previewBefore));
  });

  test('a JPEG is rejected instead of being passed off as a decoded RAW', async () => {
    const preview = await withRaw(bytes, LINEAR_SETTINGS, (raw) => raw.thumbnailData());
    assert.equal(preview.format, 'jpeg');
    await assert.rejects(withRaw(preview.data, LINEAR_SETTINGS, (raw) => raw.imageData()));
  });
});
