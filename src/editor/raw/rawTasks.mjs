// RAW tasks, run in a dedicated module worker (rawWorker.mjs) that is started for one
// job and terminated after it: the wasm heap of a full-size decode (several hundred MB)
// cannot shrink, so ending the worker is what actually returns the memory. Nothing
// here performs network requests; the file never leaves this browser.

import { prepareRender, renderRawRgba8 } from '../pipeline/cpuRenderer.mjs';
import { guideSource, prepareDetailRender, renderDetailRows } from '../pipeline/detailRenderer.mjs';
import { extractRect, warpedRegionSource } from '../pipeline/detailRegion.mjs';
import { geometryPlan, normalizeGeometry } from '../pipeline/geometry.mjs';
import { deriveParams } from '../pipeline/spec.mjs';
import { exportGeometry, LIMITS, proxyDimensions } from '../io/files.mjs';
import { finishRows, warpImage, warpSpec } from '../pipeline/warp.mjs';
import { contentHash } from '../io/hash.mjs';
import { RawDecodeError, decodeRaw, downsampleRaw } from './rawDecoder.mjs';
import { RAW_SNIFF_BYTES, sniffRaw } from './rawFormat.mjs';

export const RAW_BAND_ROWS = 256;

/** LibRaw could not be instantiated: usually too little memory for its heap on a phone. */
function decoderFailure(error) {
  const detail = String(error?.message ?? error ?? 'unknown error').slice(0, 160);
  if (/out of memory|cannot allocate|allocation failed|Cannot enlarge memory/i.test(detail)) {
    return new RawDecodeError('memory', 'There is not enough free memory to start the RAW decoder. Close other tabs or apps and try again. JPEG, PNG and WebP still work.');
  }
  return new RawDecodeError('decoder', `The RAW decoder could not start in this browser (${detail}). Reload the page to try again; JPEG, PNG and WebP still work.`);
}

/**
 * Opens a RAW file: size checks, then its header to identify it, then LibRaw, and only then
 * the whole file. The order matters: creating LibRaw's shared wasm memory after a large
 * ArrayBuffer had been allocated in the worker crashed Playwright's Windows WebKit once an
 * earlier RAW worker had ended (docs/photography-editor.md, Known issues). Same files and
 * the same memory either way.
 * :returns: { Module, bytes, format }
 */
async function openRaw(file, loadModule) {
  if (file.size > LIMITS.maxFileBytes) throw new RawDecodeError('too-large', `The file is larger than ${LIMITS.maxFileBytes / (1024 * 1024)} MB.`);
  if (file.size === 0) throw new RawDecodeError('corrupt', 'The file is empty.');
  let format;
  try {
    format = sniffRaw(new Uint8Array(await file.slice(0, RAW_SNIFF_BYTES).arrayBuffer()));
  } catch (error) {
    throw new RawDecodeError(error.code ?? 'unsupported', error.message);
  }
  if (!format) throw new RawDecodeError('unsupported', 'This is not a Sony ARW or DNG file.');
  let Module;
  try {
    Module = await loadModule();
  } catch (error) {
    throw decoderFailure(error);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { Module, bytes, format };
}

/**
 * Size to decode for a target: half size (each 2×2 sensor block as one pixel) when
 * it is enough, else the full AHD demosaic. Never upscales.
 */
export const needsFullDecode = (info, { width, height }) => width > Math.floor(info.width / 2) || height > Math.floor(info.height / 2);

/** :param loadModule: () => Promise of the libraw-wasm Emscripten module */
export function createRawHandlers(loadModule) {
  return {
    /** Validates, hashes and develops a thumbnail from half-size sensor data. */
    async inspect({ file, thumbnailEdge }, progress) {
      const { Module, bytes, format } = await openRaw(file, loadModule);
      const sha256 = await contentHash(bytes);
      progress({ stage: 'decoding' });
      const { info, image } = decodeRaw(Module, bytes, { format, halfSize: true });
      const size = proxyDimensions(image, thumbnailEdge);
      const thumbnail = downsampleRaw(image, size.width, size.height);
      const header = { format, width: info.width, height: info.height, displayWidth: info.width, displayHeight: info.height, orientation: 1 };
      return { result: { header, sha256, raw: info, thumbnail }, transfer: [thumbnail.data.buffer] };
    },

    /**
     * 1:1 inspection source: the full demosaic (as an export at original size), its guide
     * source, and only `rect` of the pixels.
     */
    async region({ file, raw, rect, geometry = null }) {
      const { Module, bytes, format } = await openRaw(file, loadModule);
      const decoded = decodeRaw(Module, bytes, { format, halfSize: false });
      if (decoded.info.width !== raw.width || decoded.info.height !== raw.height) {
        throw new RawDecodeError('corrupt', 'The file changed since it was imported. Import it again.');
      }
      const image = downsampleRaw(decoded.image, raw.width, raw.height);
      decoded.image = null;
      const plan = geometryPlan(normalizeGeometry(geometry), { width: raw.width, height: raw.height });
      if (!plan.identity) {
        const kept = warpedRegionSource(image, plan, rect);
        return { result: kept, transfer: [kept.source.data.buffer] };
      }
      const guideImage = guideSource(image);
      const source = extractRect(image, rect);
      return { result: { source, guideImage, transparent: false, native: { width: raw.width, height: raw.height } }, transfer: [source.data.buffer] };
    },

    /** Preview proxy: half-size sensor data, downscaled to `maxEdge` if larger. */
    async decode({ file, maxEdge }) {
      const { Module, bytes, format } = await openRaw(file, loadModule);
      const { image } = decodeRaw(Module, bytes, { format, halfSize: true });
      const size = proxyDimensions(image, maxEdge);
      const proxy = downsampleRaw(image, size.width, size.height);
      return { result: proxy, transfer: [proxy.data.buffer] };
    },

    /**
     * Linear camera RGB at a given size for an HDR export (no rendering): half-size
     * sensor data when it is enough, else the full demosaic, area-averaged to the size.
     */
    async develop({ file, raw, width, height }) {
      const { Module, bytes, format } = await openRaw(file, loadModule);
      const decoded = decodeRaw(Module, bytes, { format, halfSize: !needsFullDecode(raw, { width, height }) });
      if (decoded.info.width !== raw.width || decoded.info.height !== raw.height) {
        throw new RawDecodeError('corrupt', 'The file changed since it was imported. Import it again.');
      }
      const image = downsampleRaw(decoded.image, width, height);
      decoded.image = null;
      if (image.width !== width || image.height !== height) {
        throw new RawDecodeError('corrupt', `LibRaw returned ${image.width}×${image.height} instead of ${width}×${height}.`);
      }
      return { result: image, transfer: [image.data.buffer] };
    },

    /**
     * Develops the RAW at the export size and sends 8-bit RGBA bands to the page,
     * which writes them into its canvas and encodes it. Only the decoded image and one
     * band are held here.
     */
    async export({ file, raw, adjustments, lut = null, settings }, progress) {
      const started = performance.now();
      const geometry = exportGeometry(adjustments.geometry, { width: raw.width, height: raw.height }, settings.resize);
      const size = geometry.output;
      const developSize = geometry.decode;
      progress({ stage: 'decoding', fraction: 0 });
      const { Module, bytes, format } = await openRaw(file, loadModule);
      const decoded = decodeRaw(Module, bytes, { format, halfSize: !needsFullDecode(raw, developSize) });
      if (decoded.info.width !== raw.width || decoded.info.height !== raw.height) {
        throw new RawDecodeError('corrupt', 'The file changed since it was imported. Import it again.');
      }
      const source = decoded.image.width === raw.width ? 'full' : 'half';
      let image = downsampleRaw(decoded.image, developSize.width, developSize.height);
      decoded.image = null;
      if (image.width !== developSize.width || image.height !== developSize.height) {
        throw new RawDecodeError('corrupt', `LibRaw returned ${image.width}×${image.height} instead of ${developSize.width}×${developSize.height}.`);
      }
      const spec = geometry.identity ? null : warpSpec(geometry.plan, size, developSize);
      if (spec) image = warpImage(image, spec.matrix, spec);
      const nativeSize = geometry.identity ? raw : geometry.plan.native;
      const decodedAt = performance.now();
      const params = deriveParams(adjustments, { lut, raw });
      const prepared = prepareRender(params);
      // Detail reads neighbouring rows, which the decoded image holds in full.
      const detail = params.spatialActive
        ? prepareDetailRender(prepared, { width: size.width, height: size.height, nativeWidth: nativeSize.width, nativeHeight: nativeSize.height, guideImage: guideSource(image) })
        : null;
      for (let row = 0; row < size.height; row += RAW_BAND_ROWS) {
        const rows = Math.min(RAW_BAND_ROWS, size.height - row);
        const data = new Uint8ClampedArray(size.width * rows * 4);
        if (detail) renderDetailRows(image, detail, row, row + rows, data);
        else renderRawRgba8(image.data.subarray(row * size.width * 3, (row + rows) * size.width * 3), prepared, { target: data });
        finishRows(spec, data, row, rows, settings.format === 'jpeg');
        progress({ stage: 'rendering', fraction: (row + rows) / size.height, band: { row, rows, data } });
      }
      return {
        result: {
          width: size.width,
          height: size.height,
          source,
          timings: { decode: decodedAt - started, render: performance.now() - decodedAt },
        },
      };
    },
  };
}
