// RAW compatibility matrix: every file in RAW_COMPAT_DIR through the editor's own RAW pipeline
// in Node (the same LibRaw build and worker handlers the browser runs). Per file: content
// identification, LibRaw metadata (camera, sensor, CFA, bit depth, preview), half and full
// decodes with timings and the wasm heap they needed, white balance re-applied against LibRaw's
// own decode, colour sanity against the camera's embedded JPEG (brightness within reach of an
// exposure change, neutral balance, no magenta highlights), the three RAW rendering profiles
// against that reference (lightness, clipping, saturation, neutral balance, render time; a
// camera JPEG beside the RAW with the same name is used instead of the embedded preview) and a
// full-resolution export through the worker's export handler with the Camera Natural profile,
// exposure, tone, colour, Detail, white balance, a heal, crop and straighten. The browser part (masks, watermark, layers, Remove, batch ZIP, save/reopen) is
// check:editor:raw-formats. Files never leave this machine; the report names only file names.
// Usage: RAW_COMPAT_DIR=C:/path npm run check:raw:compat (RAW_COMPAT_OUT=report.json to save it)
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import factory from 'libraw-wasm/dist/libraw.js';
import { identifyRaw, sniffRaw, RAW_SNIFF_BYTES } from '../src/editor/raw/rawFormat.mjs';
import { decodeRaw, downsampleRaw } from '../src/editor/raw/rawDecoder.mjs';
import { rawDevelopParams } from '../src/editor/raw/rawColor.mjs';
import { createRawHandlers } from '../src/editor/raw/rawTasks.mjs';
import { deriveParams } from '../src/editor/pipeline/spec.mjs';
import { renderRawRgba8 } from '../src/editor/pipeline/cpuRenderer.mjs';
import { SRGB_TO_LINEAR_8BIT } from '../src/editor/pipeline/colorMath.mjs';
import { neutralAdjustments, normalizeAdjustments } from '../src/editor/model/adjustments.mjs';
import { exportGeometry } from '../src/editor/io/files.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = process.env.RAW_COMPAT_DIR ?? '';
if (!DIR) {
  console.log('RAW compatibility not checked: set RAW_COMPAT_DIR to a folder of genuine RAW files.');
  process.exit(0);
}
const ONLY = process.env.RAW_COMPAT_ONLY ? new RegExp(process.env.RAW_COMPAT_ONLY, 'i') : null;
const wasmBinary = readFileSync(path.join(root, 'node_modules/libraw-wasm/dist/libraw.wasm'));

// A fresh module per file, so its heap size after the full decode is that file's peak.
async function loadModule() {
  // LibRaw's own default memory (256 MB, growable, shared), passed in so its size can be read.
  const wasmMemory = new WebAssembly.Memory({ initial: 4096, maximum: 32768, shared: true });
  const Module = await factory({ wasmBinary, wasmMemory, printErr: (message) => { Module.lastMessage = message; } });
  Module.heapBytes = () => wasmMemory.buffer.byteLength;
  return Module;
}

const lstar = (y) => (y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y);
const median = (values) => values.sort((a, b) => a - b)[values.length >> 1];
const ms = (start) => Math.round(performance.now() - start);
const mb = (bytes) => Math.round(bytes / (1024 * 1024));

function cfaOf(meta) {
  if (!meta.filters) return 'linear (demosaiced in camera)';
  if (meta.filters === 9) return 'X-Trans 6×6';
  const fc = (row, col) => (meta.filters >>> ((((row << 1) & 14) | (col & 1)) << 1)) & 3;
  return `Bayer ${[fc(0, 0), fc(0, 1), fc(1, 0), fc(1, 1)].map((c) => meta.cdesc?.[c] ?? '?').join('')}`;
}

// LibRaw's metadata with the decoder's settings, or its failure.
function libraw(Module, bytes) {
  const raw = new Module.LibRaw();
  try {
    raw.open(bytes.slice(), { halfSize: true });
    const meta = raw.metadata(true);
    let preview = null;
    try { preview = raw.thumbnailData(); } catch { /* no preview */ }
    return { meta, preview };
  } finally {
    raw.delete();
  }
}

/** Camera JPEG as RGB at a size, turned like our development when its own EXIF does not. */
async function cameraPreview(preview, { width, height }, flip, jpeg = null) {
  if (!jpeg && (!preview?.data || preview.format !== 'jpeg')) return null;
  let image = sharp(jpeg ?? Buffer.from(preview.data)).rotate();
  const meta = await sharp(await image.toBuffer()).metadata();
  const landscape = meta.width >= meta.height;
  if (landscape !== width >= height) image = sharp(await image.toBuffer()).rotate({ 5: 270, 6: 90, 3: 180 }[flip] ?? 90);
  return { size: `${meta.width}×${meta.height}`, data: await image.resize(width, height, { fit: 'fill' }).removeAlpha().raw().toBuffer() };
}

function colourSanity(small, info, camera) {
  const count = small.width * small.height;
  const linear = (data, stride, i, c) => SRGB_TO_LINEAR_8BIT[data[i * stride + c]];
  const luminance = (data, stride, i) => 0.2126 * linear(data, stride, i, 0) + 0.7152 * linear(data, stride, i, 1) + 0.0722 * linear(data, stride, i, 2);
  const ours = renderRawRgba8(small.data, deriveParams(neutralAdjustments(), { raw: info }));
  // Where the sensor's green clipped, red and blue must not turn the highlight magenta (bright
  // saturated colours such as a red sun or a blue sky are genuine and not counted).
  const { gain } = rawDevelopParams(info, { whiteBalance: 'as-shot' });
  let tinted = 0;
  for (let i = 0; i < count; i += 1) {
    if (small.data[i * 3 + 1] * gain[1] < 0.999 * 65535) continue; // eslint-disable-line no-continue
    const [r, g, b] = [ours[i * 4], ours[i * 4 + 1], ours[i * 4 + 2]];
    if (g < Math.min(r, b) - 30) tinted += 1;
  }
  const result = { tintedHighlights: +(tinted / count).toFixed(4) };
  if (!camera) return result;
  const cameraL = median(Array.from({ length: count }, (_, i) => lstar(luminance(camera.data, 3, i))));
  const gap = (exposure) => {
    const developed = exposure ? renderRawRgba8(small.data, deriveParams({ ...neutralAdjustments(), exposure }, { raw: info })) : ours;
    return median(Array.from({ length: count }, (_, i) => lstar(luminance(developed, 4, i)))) - cameraL;
  };
  const gaps = [-1, -0.5, 0, 0.5, 1, 1.5, 2].map((exposure) => ({ exposure, gap: gap(exposure) }));
  const best = gaps.reduce((a, b) => (Math.abs(b.gap) < Math.abs(a.gap) ? b : a));
  result.lightnessGap = +gaps.find(({ exposure }) => exposure === 0).gap.toFixed(1);
  result.closestExposure = best.exposure;
  result.closestGap = +best.gap.toFixed(1);
  // White balance on what the camera rendered as near-neutral.
  const neutral = Array.from({ length: count }, (_, i) => i).filter((i) => {
    const [r, g, b] = [0, 1, 2].map((c) => camera.data[i * 3 + c]);
    return Math.max(r, g, b) - Math.min(r, g, b) < 20 && g > 40 && g < 230;
  });
  result.neutralShare = +(neutral.length / count).toFixed(3);
  if (neutral.length > count * 0.01) {
    const balance = (data, stride) => [0, 2].map((c) => neutral.reduce((sum, i) => sum + linear(data, stride, i, c), 0) / neutral.reduce((sum, i) => sum + linear(data, stride, i, 1), 0));
    const [ourRed, ourBlue] = balance(ours, 4);
    const [cameraRed, cameraBlue] = balance(camera.data, 3);
    result.neutralRedLog = +Math.log(ourRed / cameraRed).toFixed(3);
    result.neutralBlueLog = +Math.log(ourBlue / cameraBlue).toFixed(3);
  }
  return result;
}

/**
 * Each RAW rendering profile with no edits, against the camera's rendering: median L* gap,
 * highlight and shadow clipping, chroma relative to the camera's, neutral balance, render time.
 */
function profileComparison(small, info, camera) {
  const count = small.width * small.height;
  const linear = (data, stride, i, c) => SRGB_TO_LINEAR_8BIT[data[i * stride + c]];
  const luminance = (data, stride, i) => 0.2126 * linear(data, stride, i, 0) + 0.7152 * linear(data, stride, i, 1) + 0.0722 * linear(data, stride, i, 2);
  const chroma = (data, stride) => {
    let sum = 0;
    for (let i = 0; i < count; i += 1) sum += Math.max(data[i * stride], data[i * stride + 1], data[i * stride + 2]) - Math.min(data[i * stride], data[i * stride + 1], data[i * stride + 2]);
    return sum / count;
  };
  const cameraL = camera ? median(Array.from({ length: count }, (_, i) => lstar(luminance(camera.data, 3, i)))) : null;
  const cameraChroma = camera ? chroma(camera.data, 3) : null;
  const neutral = camera ? Array.from({ length: count }, (_, i) => i).filter((i) => {
    const [r, g, b] = [0, 1, 2].map((c) => camera.data[i * 3 + c]);
    return Math.max(r, g, b) - Math.min(r, g, b) < 20 && g > 40 && g < 230;
  }) : [];
  return Object.fromEntries(['legacy', 'linear', 'camera-natural'].map((profile) => {
    const start = performance.now();
    const out = renderRawRgba8(small.data, deriveParams({ ...neutralAdjustments(), raw: { whiteBalance: 'as-shot', profile } }, { raw: info }));
    const result = { ms: +(performance.now() - start).toFixed(1) };
    const lightness = median(Array.from({ length: count }, (_, i) => lstar(luminance(out, 4, i))));
    result.medianL = +lightness.toFixed(1);
    // Clipped: white in every channel (texture lost). A saturated colour at the gamut edge has
    // one channel at 255 with its hue kept by the range fit; counted apart as channelClipped.
    let clipped = 0;
    let channelClipped = 0;
    let crushed = 0;
    for (let i = 0; i < count; i += 1) {
      if (Math.min(out[i * 4], out[i * 4 + 1], out[i * 4 + 2]) >= 254) clipped += 1;
      if (Math.max(out[i * 4], out[i * 4 + 1], out[i * 4 + 2]) >= 254) channelClipped += 1;
      if (Math.max(out[i * 4], out[i * 4 + 1], out[i * 4 + 2]) <= 2) crushed += 1;
    }
    result.clipped = +(clipped / count).toFixed(4);
    result.channelClipped = +(channelClipped / count).toFixed(4);
    result.crushed = +(crushed / count).toFixed(4);
    if (camera) {
      let cameraClipped = 0;
      for (let i = 0; i < count; i += 1) if (Math.min(camera.data[i * 3], camera.data[i * 3 + 1], camera.data[i * 3 + 2]) >= 254) cameraClipped += 1;
      result.cameraClipped = +(cameraClipped / count).toFixed(4);
      result.gapL = +(lightness - cameraL).toFixed(1);
      result.chromaRatio = +(chroma(out, 4) / cameraChroma).toFixed(2);
      if (neutral.length > count * 0.01) {
        const balance = (data, stride) => [0, 2].map((c) => neutral.reduce((sum, i) => sum + linear(data, stride, i, c), 0) / neutral.reduce((sum, i) => sum + linear(data, stride, i, 1), 0));
        const [red, blue] = balance(out, 4);
        const [cameraRed, cameraBlue] = balance(camera.data, 3);
        result.neutralLog = +Math.max(Math.abs(Math.log(red / cameraRed)), Math.abs(Math.log(blue / cameraBlue))).toFixed(3);
      }
    }
    return [profile, result];
  }));
}

function whiteBalanceParity(Module, bytes, info, image) {
  const { gain, multipliers } = rawDevelopParams(info, { whiteBalance: 'custom', temperature: 3800, tint: -10 });
  const raw = new Module.LibRaw();
  let reference;
  try {
    raw.open(bytes.slice(), { outputBps: 16, outputColor: 0, gamm: [1, 1, 0, 0, 0, 0], noAutoBright: true, halfSize: true, highlight: 0, userMul: [...multipliers, multipliers[1]] });
    reference = raw.imageData();
  } finally {
    raw.delete();
  }
  if (reference.data.length !== image.data.length) return null;
  // Bayer half size bins 2×2 blocks, so the gains are exact; X-Trans half size and CRW
  // interpolate, so a clipped neighbour shifts a few pixels next to highlights: the 99.9th
  // percentile is the check, the maximum is reported.
  const differences = [];
  for (let i = 0; i < image.data.length; i += 3 * 7) {
    for (let c = 0; c < 3; c += 1) differences.push(Math.abs(Math.min(65535, image.data[i + c] * gain[c]) - reference.data[i + c]));
  }
  differences.sort((a, b) => a - b);
  return { p999: Math.round(differences[Math.floor(differences.length * 0.999)]), max: Math.round(differences.at(-1)) };
}

// The representative edit: tone, colour, Detail, custom white balance, a heal, crop and straighten.
const EDIT = normalizeAdjustments({
  exposure: 0.3, contrast: 15, highlights: -30, shadows: 25, vibrance: 15, saturation: 5, sharpening: 30, luminanceNoise: 20, grainAmount: 10,
  rawTemperature: 5200, rawTint: 5, raw: { whiteBalance: 'custom', profile: 'camera-natural' },
  geometry: { angle: 2, crop: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 } },
  retouch: [{ id: 'heal-1', type: 'heal', enabled: true, points: [[0.4, 0.5]], radius: 0.02, offset: { x: 0.05, y: 0 } }],
});

async function exportFull(Module, file, inspect) {
  const handlers = createRawHandlers(async () => Module);
  const settings = { format: 'jpeg', resize: { mode: 'original' } };
  const expected = exportGeometry(EDIT.geometry, { width: inspect.raw.width, height: inspect.raw.height }, settings.resize).output;
  let rows = 0;
  let sum = 0;
  const started = performance.now();
  const { result } = await handlers.export({ file, raw: inspect.raw, adjustments: EDIT, settings }, ({ band }) => {
    if (!band) return;
    rows += band.rows;
    for (let i = 0; i < band.data.length; i += 4 * 97) sum += band.data[i + 1];
  });
  const mean = sum / Math.ceil((expected.width * expected.height) / 97);
  return { size: `${result.width}×${result.height}`, expected: `${expected.width}×${expected.height}`, complete: rows === result.height, source: result.source, meanGreen: Math.round(mean), ms: ms(started) };
}

const names = readdirSync(DIR).filter((name) => statSync(path.join(DIR, name)).isFile() && (!ONLY || ONLY.test(name))).sort();
const report = [];
for (const name of names) {
  const bytes = new Uint8Array(readFileSync(path.join(DIR, name)));
  const row = { file: name, mb: +(bytes.length / 1e6).toFixed(1) };
  report.push(row);
  const head = bytes.subarray(0, RAW_SNIFF_BYTES);
  try {
    row.identified = identifyRaw(head)?.format ?? null;
  } catch (error) {
    row.identified = `error: ${error.message}`;
  }
  try {
    row.accepted = sniffRaw(head);
  } catch (error) {
    row.accepted = null;
    row.refusal = error.message;
  }
  const Module = await loadModule();
  try {
    const { meta, preview } = libraw(Module, bytes);
    const color = meta.color_data ?? {};
    Object.assign(row, {
      camera: `${meta.camera_make} ${meta.camera_model}`.trim(),
      sensor: `${meta.raw_width}×${meta.raw_height}`,
      image: `${meta.width}×${meta.height}`,
      flip: meta.flip,
      cfa: cfaOf(meta),
      colors: meta.colors,
      bits: color.maximum > 0 ? Math.ceil(Math.log2(color.maximum + 1)) : null,
      dng: meta.dng_version ? [24, 16, 8, 0].map((shift) => (meta.dng_version >>> shift) & 255).join('.') : null,
      nefCompression: meta.nikon?.NEFCompression ?? undefined,
      preview: preview ? `${preview.format} ${meta.thumb_width}×${meta.thumb_height}` : 'none',
      asShotWb: Array.from(color.cam_mul ?? []).slice(0, 3).every((value) => value > 0),
    });
    if (!row.accepted) {
      // Refused by content: still note whether LibRaw could have decoded it, for the matrix.
      try { decodeRaw(Module, bytes, { format: row.identified, halfSize: true }); row.decoderWouldDecode = true; } catch (error) { row.decoderWouldDecode = false; row.decodeError = error.message; }
      continue; // eslint-disable-line no-continue
    }
    let start = performance.now();
    const half = decodeRaw(Module, bytes, { format: row.accepted, halfSize: true });
    row.halfDecodeMs = ms(start);
    row.halfSize = `${half.image.width}×${half.image.height}`;
    row.wbParity = whiteBalanceParity(Module, bytes, half.info, half.image);
    // A few cameras record two different green multipliers (the EOS D60: 758 and 756). The
    // decode keeps both, a re-applied balance has one green, so greens may differ by that ratio.
    const camMul = Array.from(meta.color_data?.cam_mul ?? []);
    row.wbTolerance = Math.max(8, camMul[3] > 0 && camMul[1] > 0 ? Math.ceil(Math.abs(1 - camMul[3] / camMul[1]) * 65535) : 0);
    const small = downsampleRaw(half.image, Math.max(64, Math.round(half.image.width / 8)), Math.max(64, Math.round(half.image.height / 8)));
    const base = path.join(DIR, name.replace(/\.[^.]+$/, ''));
    const jpegPath = ['.JPG', '.jpg', '.jpeg'].map((extension) => base + extension).find(existsSync);
    const camera = await cameraPreview(preview, small, half.info.flip, jpegPath ? readFileSync(jpegPath) : null);
    row.reference = camera ? (jpegPath ? 'camera JPEG' : 'embedded preview') : 'none';
    Object.assign(row, colourSanity(small, half.info, camera));
    row.profiles = profileComparison(small, half.info, camera);
    half.image = null;
    start = performance.now();
    const full = decodeRaw(Module, bytes, { format: row.accepted });
    row.fullDecodeMs = ms(start);
    row.fullSize = `${full.image.width}×${full.image.height}`;
    row.oriented = full.image.width === full.info.width && full.image.height === full.info.height;
    start = performance.now();
    renderRawRgba8(full.image.data, deriveParams(neutralAdjustments(), { raw: full.info }));
    row.fullRenderMs = ms(start);
    full.image = null;
    row.wasmHeapMb = mb(Module.heapBytes());
    const file = new Blob([bytes]);
    const handlers = createRawHandlers(async () => Module);
    const { result: inspect } = await handlers.inspect({ file, thumbnailEdge: 256 }, () => {});
    row.lens = inspect.raw.lens || '';
    row.export = await exportFull(Module, file, inspect);
    row.wasmHeapMb = mb(Module.heapBytes());
  } catch (error) {
    row.error = `${error.code ?? 'error'}: ${error.message}`;
  } finally {
    row.rssMb = mb(process.memoryUsage().rss);
  }
}

// Validated here means the Node pipeline passed; the browser check adds the editor flow.
const COLOUR = { gap: 6, neutral: 0.15, tinted: 0.002, clip: 0.005 };
for (const row of report) {
  const failures = [];
  if (!row.accepted) { row.node = 'refused'; continue; } // eslint-disable-line no-continue
  // Identified, then refused by the decoder with its reason (Nikon High Efficiency NEF).
  if (row.error?.startsWith('unsupported:')) { row.node = 'unsupported'; continue; } // eslint-disable-line no-continue
  if (row.error) failures.push(row.error);
  if (row.oriented === false) failures.push('full decode size differs from the oriented size');
  if (!row.wbParity || row.wbParity.p999 > row.wbTolerance) failures.push(`white balance re-application differs by ${JSON.stringify(row.wbParity)}`);
  if (row.closestGap !== undefined && Math.abs(row.closestGap) > COLOUR.gap) failures.push(`lightness ${row.closestGap} L* from the camera JPEG at best`);
  if (Math.abs(row.neutralRedLog ?? 0) > COLOUR.neutral || Math.abs(row.neutralBlueLog ?? 0) > COLOUR.neutral) failures.push('neutral balance differs from the camera JPEG');
  if (row.tintedHighlights > COLOUR.tinted) failures.push(`tinted highlights ${row.tintedHighlights}`);
  // Camera Natural: brighter than legacy, no clipping beyond what the sensor clipped (legacy shows
  // exactly that), neutral balance unchanged.
  const { legacy, 'camera-natural': natural } = row.profiles ?? {};
  if (natural && natural.medianL < legacy.medianL) failures.push('Camera Natural is darker than legacy');
  if (natural && natural.clipped > legacy.clipped + COLOUR.clip) failures.push(`Camera Natural clips ${natural.clipped} vs legacy ${legacy.clipped}`);
  if (natural?.neutralLog > COLOUR.neutral) failures.push(`Camera Natural neutral balance differs by ${natural.neutralLog}`);
  if (row.export && (row.export.size !== row.export.expected || !row.export.complete || row.export.meanGreen < 8 || row.export.meanGreen > 250)) failures.push(`export ${JSON.stringify(row.export)}`);
  row.node = failures.length ? 'fail' : 'pass';
  if (failures.length) row.failures = failures;
}

if (process.env.RAW_COMPAT_OUT) writeFileSync(process.env.RAW_COMPAT_OUT, `${JSON.stringify(report, null, 2)}\n`);
console.table(report.map((row) => ({
  file: row.file, camera: row.camera, as: row.accepted ?? row.identified, cfa: row.cfa, bits: row.bits, image: row.fullSize ?? row.image,
  half: row.halfDecodeMs, full: row.fullDecodeMs, export: row.export?.ms, heap: row.wasmHeapMb, wb: row.wbParity?.p999, gap: row.closestGap, nR: row.neutralRedLog, nB: row.neutralBlueLog, node: row.node,
})));
console.table(report.filter(({ profiles }) => profiles).map(({ file, reference, profiles: p }) => ({
  file,
  ref: reference,
  'legacy gap L*': p.legacy.gapL,
  'linear gap L*': p.linear.gapL,
  'natural gap L*': p['camera-natural'].gapL,
  'white clip legacy/natural/camera %': `${(p.legacy.clipped * 100).toFixed(2)} / ${(p['camera-natural'].clipped * 100).toFixed(2)} / ${((p.legacy.cameraClipped ?? 0) * 100).toFixed(2)}`,
  'channel at 255 legacy/natural %': `${(p.legacy.channelClipped * 100).toFixed(2)} / ${(p['camera-natural'].channelClipped * 100).toFixed(2)}`,
  'crushed natural %': +(p['camera-natural'].crushed * 100).toFixed(2),
  'chroma vs camera legacy/natural': `${p.legacy.chromaRatio} / ${p['camera-natural'].chromaRatio}`,
  'neutral natural': p['camera-natural'].neutralLog,
})));
for (const row of report.filter(({ failures, refusal }) => failures || refusal)) console.log(`${row.file}: ${row.failures?.join('; ') ?? row.refusal}${row.decodeError ? ` (decoder: ${row.decodeError})` : ''}`);
assert.ok(report.every(({ node }) => node !== 'fail'), 'RAW compatibility failures (see above)');
