// Layers in an export: after the photo (the background) has been rendered into the export
// canvas, its pixels are read once and every visible layer is composited over them, bottom to
// top, then written back before encoding. Layers are prepared one at a time: an image layer's
// source is decoded (and developed) at the size it needs, used for its pass and released before
// the next, so at most one layer raster is held besides the canvas and its copy.
//
// On desktops each pass is split into 256-row bands on a small pool of render workers (a band
// carries its canvas rows and only the raster rows it reads); phones run the passes on the page,
// yielding between bands. Every band is computed by composite.mjs from the same numbers, so the
// result is the same bit for bit either way (tested).

import { createWorkerClient, WorkerCancelled } from './workerClient.mjs';
import { COMPOSITE_BAND_ROWS, adjustmentPass, compositeImage, rasterPass } from '../pipeline/composite.mjs';
import { layerMatrix, offsetMatrix } from '../pipeline/layerTransform.mjs';
import { sourceRows } from '../pipeline/warp.mjs';
import { visibleLayers } from '../model/layers.mjs';

const spawnRenderWorker = () => new Worker(new URL('./imageWorker.mjs', import.meta.url), { type: 'module' });
const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The pass of one layer at a canvas of `size`, or null when it draws nothing there.
 * :param loadRaster: async (layer, size) => RGBA8 raster of an image layer's source (developed
 *   with the layer's settings) at the size it needs
 * :param rasterizeText: (layer, size) => text sprite ({ x, y, width, height, data }) or null
 * :param lutFor: settings => LUT data or null
 */
export async function preparePass(layer, size, { loadRaster, rasterizeText, lutFor }) {
  if (layer.type === 'adjustment') return adjustmentPass(layer, lutFor(layer.settings));
  if (layer.type === 'text') {
    const sprite = rasterizeText(layer, size);
    return sprite ? rasterPass(layer, sprite, offsetMatrix(sprite.x, sprite.y), size) : null;
  }
  const raster = await loadRaster(layer, size);
  const pass = rasterPass(layer, raster, layerMatrix(layer, size, raster), size);
  return pass.bounds ? pass : null;
}

/** One pass on `clients` render workers, band by band. */
async function passInBands(image, pass, clients, signal) {
  const { width, height, data } = image;
  const bands = [];
  const first = pass.kind === 'raster' ? pass.bounds.y : 0;
  const last = pass.kind === 'raster' ? pass.bounds.y + pass.bounds.height : height;
  for (let row = Math.floor(first / COMPOSITE_BAND_ROWS) * COMPOSITE_BAND_ROWS; row < last; row += COMPOSITE_BAND_ROWS) bands.push(row);
  const { raster, ...plain } = pass;
  const lane = async (client) => {
    while (bands.length) {
      if (signal.cancelled) throw new WorkerCancelled();
      const row = bands.shift();
      const end = Math.min(height, row + COMPOSITE_BAND_ROWS);
      const rows = data.slice(row * width * 4, end * width * 4);
      let slice = null;
      if (raster) {
        const [top, bottom] = sourceRows(pass.matrix, width, row, end, raster.height);
        const copy = raster.data.slice(top * raster.width * 4, bottom * raster.width * 4);
        slice = { width: raster.width, height: raster.height, top, data: copy };
      }
      const transfer = [rows.buffer, ...(slice ? [slice.data.buffer] : [])];
      const band = await client.call('compositeRows', { pass: plain, raster: slice, rows, width, y0: row, y1: end }, { transfer });
      if (signal.cancelled) throw new WorkerCancelled();
      data.set(band, row * width * 4);
    }
  };
  await Promise.all(clients.map(lane));
}

/**
 * Composites `layers` over the rendered background in `context` (a 2D canvas context of the
 * export size), in place.
 * :param options: { size, loadRaster, rasterizeText, lutFor, workers, spawn, signal, onProgress }
 */
export async function composeLayers(context, layers, { size, loadRaster, rasterizeText, lutFor, workers = 0, spawn = spawnRenderWorker, signal = { cancelled: false }, onProgress = () => {} }) {
  const shown = visibleLayers(layers);
  if (!shown.length) return;
  const image = context.getImageData(0, 0, size.width, size.height);
  const clients = [];
  try {
    for (let i = 0; i < workers; i += 1) clients.push(createWorkerClient(spawn()));
    for (const [index, layer] of shown.entries()) {
      if (signal.cancelled) throw new WorkerCancelled();
      onProgress({ stage: 'compositing', fraction: index / shown.length, layer: index + 1, layers: shown.length });
      let pass = await preparePass(layer, size, { loadRaster, rasterizeText, lutFor });
      if (!pass) continue; // eslint-disable-line no-continue
      if (clients.length) {
        await passInBands(image, pass, clients, signal);
      } else {
        await compositeImage(image, [pass], { cancelled: () => signal.cancelled, onBand: nextTick });
      }
      pass = null;
    }
  } finally {
    clients.forEach((client) => client.terminate());
  }
  if (signal.cancelled) throw new WorkerCancelled();
  onProgress({ stage: 'compositing', fraction: 1 });
  context.putImageData(image, 0, 0);
}
