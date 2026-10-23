// Image tasks: file inspection and hashing, proxy and thumbnail decoding, CPU
// rendering for the no-WebGL2 preview, and full-resolution export. They run in the
// image worker, or on the main thread where workers cannot decode images. Everything
// stays in this browser; nothing here performs network requests.

import { prepareRender, renderImage, renderRgba8 } from '../pipeline/cpuRenderer.mjs';
import { computeImageGuide, createAreaAccumulator, guideSize, guideSource, prepareDetailRender, renderDetailImage, renderDetailRows } from '../pipeline/detailRenderer.mjs';
import { deriveParams } from '../pipeline/spec.mjs';
import { groupKeys, normalizeAdjustments } from '../model/adjustments.mjs';
import { decodeToCanvas, decodeToRgba, encodeCanvas, inspectFile } from './decode.mjs';
import { exportDimensions, proxyDimensions } from './files.mjs';
import { FORMATS } from './imageHeader.mjs';
import { LutError, MAX_CUBE_BYTES, parseCube } from '../pipeline/lut.mjs';
import { contentHash } from './hash.mjs';

export const EXPORT_BAND_ROWS = 256;

// CPU preview cache: the current proxy and the last few LUTs, so each render sends
// only settings instead of copying the proxy (about 45 MB at 4096 px) every time.
const renderCache = { key: null, source: null, luts: new Map(), detail: null };
const MAX_CACHED_LUTS = 2;
const stale = (what) => Object.assign(new Error(`The preview ${what} is not loaded here.`), { code: `stale-${what}` });

const cancelled = () => Object.assign(new Error('Cancelled.'), { code: 'cancelled' });

// What the Detail guide depends on: the base stage (light, colour, RAW, HDR) and the two
// guide-based controls. Fine filters and display stages (curves, HSL, LUT) do not matter.
const GUIDE_KEYS = [...['light', 'color', 'raw', 'hdr'].flatMap(groupKeys), 'clarity', 'dehaze'];

/** The proxy area-averaged to a long edge (cached per edge), or the proxy itself. */
function previewSource(image, edge, cache) {
  const scale = Math.min(1, edge / Math.max(image.width, image.height));
  if (scale === 1) return image;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const key = `${width}x${height}`;
  if (!cache.sizes.has(key)) {
    const accumulator = createAreaAccumulator(image.kind, image.width, image.height, width, height);
    accumulator.add(image.data, 0, image.height);
    cache.sizes.set(key, accumulator.finish());
    while (cache.sizes.size > 2) cache.sizes.delete(cache.sizes.keys().next().value);
  }
  return cache.sizes.get(key);
}

/**
 * Detail preview: the export's renderer on the proxy, downscaled to `detail.edge` (a
 * quick draft while values change, then the final size). The guide comes from the proxy
 * and is reused while only the fine filters change.
 * :param detail: { edge, nativeWidth, nativeHeight }
 */
function renderDetailPreview(image, params, adjustments, { edge, nativeWidth, nativeHeight }) {
  renderCache.detail ??= { sizes: new Map(), guideSource: null, guideKey: null, guide: null };
  const cache = renderCache.detail;
  cache.guideSource ??= guideSource(image);
  const values = normalizeAdjustments(adjustments);
  const guideKey = JSON.stringify([GUIDE_KEYS.map((name) => values[name]), values.raw]);
  if (cache.guideKey !== guideKey) Object.assign(cache, { guideKey, guide: computeImageGuide(prepareRender(params), cache.guideSource) });
  const source = previewSource(image, edge, cache);
  const data = renderDetailImage(source, params, { nativeWidth, nativeHeight, guide: cache.guide });
  return { width: source.width, height: source.height, data };
}

/**
 * Detail export, in place in the decode canvas: the guide from a streamed pass over the
 * canvas, then bands rendered with their halo. Rows above a band were already
 * overwritten, so each band keeps a copy of its last `halo` source rows for the next.
 * Holds one band plus two halos of pixels besides the canvas.
 */
export async function exportDetailBands(context, size, prepared, native, settings, progress, signal) {
  const { width, height } = size;
  const small = guideSize(size);
  const accumulator = createAreaAccumulator(undefined, width, height, small.width, small.height);
  for (let row = 0; row < height; row += EXPORT_BAND_ROWS) {
    const rows = Math.min(EXPORT_BAND_ROWS, height - row);
    accumulator.add(context.getImageData(0, row, width, rows, { colorSpace: 'srgb' }).data, row, rows);
  }
  const detail = prepareDetailRender(prepared, { width, height, nativeWidth: native.width, nativeHeight: native.height, guideImage: guideSource(accumulator.finish()) });
  const { halo } = detail;
  let above = null;
  for (let row = 0; row < height; row += EXPORT_BAND_ROWS) {
    if (signal.cancelled) throw cancelled();
    const rows = Math.min(EXPORT_BAND_ROWS, height - row);
    const top = Math.max(0, row - halo);
    const bottom = Math.min(height, row + rows + halo);
    const source = new Uint8ClampedArray((bottom - top) * width * 4);
    if (above) source.set(above.subarray((above.length / (width * 4) - (row - top)) * width * 4));
    source.set(context.getImageData(0, row, width, bottom - row, { colorSpace: 'srgb' }).data, (row - top) * width * 4);
    const band = new ImageData(width, rows);
    renderDetailRows({ width, height: bottom - top, data: source, y0: top }, detail, row, row + rows, band.data, { flattenAlpha: settings.format === 'jpeg' });
    above = source.subarray(Math.max(0, row + rows - top - halo) * width * 4, (row + rows - top) * width * 4).slice();
    context.putImageData(band, 0, row);
    progress({ stage: 'rendering', fraction: (row + rows) / height });
    if (signal.yield) await signal.yield();
  }
}

export const handlers = {
  async inspect({ file, thumbnailEdge }) {
    const { header, sha256 } = await inspectFile(file);
    const size = proxyDimensions({ width: header.displayWidth, height: header.displayHeight }, thumbnailEdge);
    const thumbnail = await decodeToRgba(file, header, size);
    return { result: { header, sha256, thumbnail }, transfer: [thumbnail.data.buffer] };
  },

  async decode({ file, header, width, height }) {
    const image = await decodeToRgba(file, header, { width, height });
    return { result: image, transfer: [image.data.buffer] };
  },

  /**
   * CPU preview render. `source` and `lut.data` are sent only when not cached here.
   * `raw` is the photo's RAW colour info when the source is a RAW proxy.
   */
  async render({ key, source, adjustments, lut, raw = null, detail = null }) {
    if (source) Object.assign(renderCache, { key, source, detail: null });
    else if (!key || renderCache.key !== key) throw stale('source');
    if (lut?.data) {
      renderCache.luts.set(lut.sha256, lut);
      while (renderCache.luts.size > MAX_CACHED_LUTS) renderCache.luts.delete(renderCache.luts.keys().next().value);
    }
    const lutData = lut ? renderCache.luts.get(lut.sha256) : null;
    if (lut && !lutData) throw stale('lut');
    const image = renderCache.source;
    const params = deriveParams(adjustments, { lut: lutData, raw });
    if (detail && params.detailActive) {
      const rendered = renderDetailPreview(image, params, adjustments, detail);
      return { result: rendered, transfer: [rendered.data.buffer] };
    }
    const data = renderImage(image, params);
    return { result: { width: image.width, height: image.height, data }, transfer: [data.buffer] };
  },

  /** Reads, validates and hashes a .cube file. */
  async parseCube({ file }) {
    if (file.size > MAX_CUBE_BYTES) throw Object.assign(new Error(`The LUT file is larger than ${MAX_CUBE_BYTES / 1024 / 1024} MB.`), { code: 'lut' });
    const bytes = new Uint8Array(await file.arrayBuffer());
    let lut;
    try {
      lut = parseCube(new TextDecoder().decode(bytes));
    } catch (error) {
      if (error instanceof LutError) throw Object.assign(new Error(error.message), { code: 'lut' });
      throw error;
    }
    const sha256 = await contentHash(bytes);
    return { result: { ...lut, sha256, name: String(file.name).slice(0, 255) }, transfer: [lut.data.buffer] };
  },

  /**
   * Renders in place, one band of rows at a time: read back, process, write back into
   * the decode canvas, then encode that canvas. Only one band of pixels is held besides
   * the canvas, instead of a full-resolution copy and a second canvas.
   */
  async export({ file, header, adjustments, lut = null, settings }, progress, signal = {}) {
    const started = performance.now();
    const format = FORMATS[settings.format];
    const size = exportDimensions({ width: header.displayWidth, height: header.displayHeight }, settings.resize);
    progress({ stage: 'decoding', fraction: 0 });
    const { canvas, context } = await decodeToCanvas(file, header, size);
    const decodedAt = performance.now();
    progress({ stage: 'rendering', fraction: 0 });
    const params = deriveParams(adjustments, { lut });
    const prepared = prepareRender(params);
    if (params.detailActive) {
      await exportDetailBands(context, size, prepared, { width: header.displayWidth, height: header.displayHeight }, settings, progress, signal);
    } else for (let row = 0; row < size.height; row += EXPORT_BAND_ROWS) {
      if (signal.cancelled) throw cancelled();
      const rows = Math.min(EXPORT_BAND_ROWS, size.height - row);
      const band = context.getImageData(0, row, size.width, rows, { colorSpace: 'srgb' });
      // JPEG has no alpha: composite onto white here rather than leave it to the encoder.
      renderRgba8(band.data, prepared, { target: band.data, flattenAlpha: settings.format === 'jpeg' });
      context.putImageData(band, 0, row);
      progress({ stage: 'rendering', fraction: (row + rows) / size.height });
      // Lets a main-thread run paint progress and see a cancel between bands.
      if (signal.yield) await signal.yield();
    }
    const renderedAt = performance.now();
    progress({ stage: 'encoding', fraction: 1 });
    const blob = await encodeCanvas(canvas, format.mime, settings.format === 'png' ? undefined : settings.quality);
    if (signal.cancelled) throw cancelled();
    // Encoders fall back to PNG for types they do not support (Safari and WebP).
    if (blob.type !== format.mime) {
      throw Object.assign(new Error(`This browser cannot encode ${format.label}. Choose another format.`), { code: 'encoder' });
    }
    return {
      result: {
        blob,
        width: size.width,
        height: size.height,
        timings: { decode: decodedAt - started, render: renderedAt - decodedAt, encode: performance.now() - renderedAt },
      },
    };
  },
};

/** Runs one task by name. `signal` is { cancelled, yield } on the main thread. */
export async function runTask(type, payload, progress, signal) {
  const handler = handlers[type];
  if (!handler) throw new Error(`Unknown image task: ${type}`);
  return handler(payload, progress, signal);
}
