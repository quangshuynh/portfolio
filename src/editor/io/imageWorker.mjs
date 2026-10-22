// Image worker: file inspection and hashing, proxy and thumbnail decoding, CPU
// rendering for the no-WebGL2 preview, and full-resolution export. Everything
// stays in this browser; nothing here performs network requests.

import { renderRgba8, renderRgba8InBands } from '../pipeline/cpuRenderer.mjs';
import { deriveParams } from '../pipeline/spec.mjs';
import { decodeToRgba, inspectFile } from './decode.mjs';
import { exportDimensions, proxyDimensions } from './files.mjs';
import { FORMATS } from './imageHeader.mjs';

const handlers = {
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

  async export({ file, header, adjustments, settings }, progress) {
    const started = performance.now();
    const format = FORMATS[settings.format];
    const size = exportDimensions({ width: header.displayWidth, height: header.displayHeight }, settings.resize);
    progress({ stage: 'decoding', fraction: 0 });
    const image = await decodeToRgba(file, header, size);
    const decodedAt = performance.now();
    progress({ stage: 'rendering', fraction: 0 });
    // JPEG has no alpha: composite onto white here rather than leave it to the encoder.
    renderRgba8InBands(image.data, deriveParams(adjustments), {
      width: image.width,
      height: image.height,
      target: image.data,
      flattenAlpha: settings.format === 'jpeg',
      onBand: (fraction) => progress({ stage: 'rendering', fraction }),
    });
    const renderedAt = performance.now();
    progress({ stage: 'encoding', fraction: 1 });
    const canvas = new OffscreenCanvas(image.width, image.height);
    canvas.getContext('2d', { colorSpace: 'srgb' }).putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
    const blob = await canvas.convertToBlob({ type: format.mime, ...(settings.format === 'png' ? {} : { quality: settings.quality }) });
    // Encoders fall back to PNG for types they do not support (Safari and WebP).
    if (blob.type !== format.mime) {
      throw Object.assign(new Error(`This browser cannot encode ${format.label}. Choose another format.`), { code: 'encoder' });
    }
    return {
      result: {
        blob,
        width: image.width,
        height: image.height,
        timings: { decode: decodedAt - started, render: renderedAt - decodedAt, encode: performance.now() - renderedAt },
      },
    };
  },
};

self.addEventListener('message', async ({ data: { id, type, payload } }) => {
  const progress = (value) => self.postMessage({ id, progress: value });
  try {
    const handler = handlers[type];
    if (!handler) throw new Error(`Unknown worker request: ${type}`);
    const { result, transfer = [] } = await handler(payload, progress);
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (error) {
    self.postMessage({ id, ok: false, error: { code: error.code ?? 'failed', message: error.message || 'Processing failed.' } });
  }
});
