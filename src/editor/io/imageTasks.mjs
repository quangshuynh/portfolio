// Image tasks: file inspection and hashing, proxy and thumbnail decoding, CPU
// rendering for the no-WebGL2 preview, and full-resolution export. They run in the
// image worker, or on the main thread where workers cannot decode images. Everything
// stays in this browser; nothing here performs network requests.

import { prepareRender, renderRgba8 } from '../pipeline/cpuRenderer.mjs';
import { deriveParams } from '../pipeline/spec.mjs';
import { decodeToCanvas, decodeToRgba, encodeCanvas, inspectFile } from './decode.mjs';
import { exportDimensions, proxyDimensions } from './files.mjs';
import { FORMATS } from './imageHeader.mjs';

export const EXPORT_BAND_ROWS = 256;

const cancelled = () => Object.assign(new Error('Cancelled.'), { code: 'cancelled' });

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

  async render({ source, adjustments }) {
    const data = renderRgba8(source.data, deriveParams(adjustments));
    return { result: { width: source.width, height: source.height, data }, transfer: [data.buffer] };
  },

  /**
   * Renders in place, one band of rows at a time: read back, process, write back into
   * the decode canvas, then encode that canvas. Only one band of pixels is held besides
   * the canvas, instead of a full-resolution copy and a second canvas.
   */
  async export({ file, header, adjustments, settings }, progress, signal = {}) {
    const started = performance.now();
    const format = FORMATS[settings.format];
    const size = exportDimensions({ width: header.displayWidth, height: header.displayHeight }, settings.resize);
    progress({ stage: 'decoding', fraction: 0 });
    const { canvas, context } = await decodeToCanvas(file, header, size);
    const decodedAt = performance.now();
    progress({ stage: 'rendering', fraction: 0 });
    const prepared = prepareRender(deriveParams(adjustments));
    for (let row = 0; row < size.height; row += EXPORT_BAND_ROWS) {
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
