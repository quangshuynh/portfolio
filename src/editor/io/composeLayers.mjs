// Layers in an export: after the photo (the background) has been rendered into the export
// canvas, its pixels are read once, the photo's local adjustments are applied through their
// masks, and every visible layer is composited over them, bottom to top, then written back
// before encoding. Masks are evaluated band by band at the export's size (pipeline/mask.mjs). Layers are prepared one at a time: an image layer's
// source is decoded (and developed) at the size it needs, used for its pass and released before
// the next, so at most one layer raster is held besides the canvas and its copy.
//
// On desktops each pass is split into 256-row bands on a small pool of render workers (a band
// carries its canvas rows and only the raster rows it reads); phones run the passes on the page,
// yielding between bands. Every band is computed by composite.mjs from the same numbers, so the
// result is the same bit for bit either way (tested). Detail passes of local adjustments read
// neighbouring rows: the page computes the guide once, then the bands (each with its halo of
// unchanged backdrop rows) run on the same workers, and a band's result is written back only
// once no band still to be sent reads its rows. Phones run them on the page, band by band.

import { createWorkerClient, WorkerCancelled } from './workerClient.mjs';
import {
  COMPOSITE_BAND_ROWS, adjustmentPass, compositeImage, detailPassOptions, detailWriter, localPasses, prepareDetailPass, rasterPass,
} from '../pipeline/composite.mjs';
import { layerMatrix, offsetMatrix } from '../pipeline/layerTransform.mjs';
import { sourceRows } from '../pipeline/warp.mjs';
import { visibleLayers } from '../model/layers.mjs';
import { maskActive, splitLocalSettings, visibleLocals } from '../model/masks.mjs';
import { canvasMaskMap, layerMaskMap } from '../pipeline/mask.mjs';

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
  const mask = maskActive(layer.mask) ? layer.mask : null;
  if (layer.type === 'adjustment') return adjustmentPass(layer, lutFor(layer.settings), mask && { def: mask, map: canvasMaskMap(size) });
  if (layer.type === 'text') {
    const sprite = rasterizeText(layer, size);
    return sprite ? rasterPass(layer, sprite, offsetMatrix(sprite.x, sprite.y), size, mask && { def: mask, map: canvasMaskMap(size) }) : null;
  }
  const raster = await loadRaster(layer, size);
  const matrix = layerMatrix(layer, size, raster);
  const pass = rasterPass(layer, raster, matrix, size, mask && { def: mask, map: layerMaskMap(matrix, raster) });
  return pass.bounds ? pass : null;
}

/**
 * The passes of a photo's local adjustments at an export of `size`.
 * :param imageMap: size => maskMap of the photo's own space at that canvas size (mask.imageMaskMap)
 * :param native: the canvas at full resolution (Detail radii)
 */
export const prepareLocalPasses = (locals, size, { imageMap, native }) => visibleLocals(locals)
  .flatMap((local) => localPasses(local, { def: local.mask, map: imageMap(size) }, native, splitLocalSettings(local.settings)));

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

/** A local adjustment's Detail pass on `clients` render workers (see the comment at the top). */
async function detailInBands(image, pass, clients, signal) {
  const { width, height, data } = image;
  const options = detailPassOptions(image, pass);
  const { halo } = prepareDetailPass(pass, options);
  const job = `${Date.now()}-${Math.random()}`;
  await Promise.all(clients.map((client) => client.call('localDetailBegin', { job, pass, options })));
  const writer = detailWriter(data, width, halo);
  const bands = [];
  for (let row = 0; row < height; row += COMPOSITE_BAND_ROWS) bands.push(row);
  let next = 0;
  // The first backdrop row a band not yet sent will read.
  const readFrom = () => (next < bands.length ? bands[next] - halo : Infinity);
  const lane = async (client) => {
    while (next < bands.length) {
      if (signal.cancelled) throw new WorkerCancelled();
      const row = bands[next];
      next += 1;
      const last = Math.min(height, row + COMPOSITE_BAND_ROWS);
      const top = Math.max(0, row - halo);
      const bottom = Math.min(height, last + halo);
      const slice = data.slice(top * width * 4, bottom * width * 4);
      const rows = await client.call('localDetailRows', { job, source: { width, height: bottom - top, y0: top, data: slice }, row, last }, { transfer: [slice.buffer] });
      if (signal.cancelled) throw new WorkerCancelled();
      writer.add(row, last, rows);
      writer.flush(readFrom());
    }
  };
  await Promise.all(clients.map(lane));
  writer.flush(Infinity);
}

/**
 * Applies the photo's local adjustments and composites `layers` over the rendered background in
 * `context` (a 2D canvas context of the export size), in place.
 * :param options: { size, loadRaster, rasterizeText, lutFor, workers, spawn, signal, onProgress }
 *   and for local adjustments { local, imageMap, native } (see prepareLocalPasses)
 */
export async function composeLayers(context, layers, { size, loadRaster, rasterizeText, lutFor, local = [], imageMap = null, native = size, workers = 0, spawn = spawnRenderWorker, signal = { cancelled: false }, onProgress = () => {} }) {
  const locals = imageMap ? prepareLocalPasses(local, size, { imageMap, native }) : [];
  const shown = [...locals.map((pass) => ({ pass })), ...visibleLayers(layers).map((layer) => ({ layer }))];
  if (!shown.length) return;
  const image = context.getImageData(0, 0, size.width, size.height);
  const clients = [];
  try {
    for (let i = 0; i < workers; i += 1) clients.push(createWorkerClient(spawn()));
    for (const [index, entry] of shown.entries()) {
      if (signal.cancelled) throw new WorkerCancelled();
      onProgress({ stage: 'compositing', fraction: index / shown.length, layer: index + 1, layers: shown.length });
      let pass = entry.pass ?? await preparePass(entry.layer, size, { loadRaster, rasterizeText, lutFor });
      if (!pass) continue; // eslint-disable-line no-continue
      if (clients.length && pass.kind === 'detail') {
        await detailInBands(image, pass, clients, signal);
      } else if (clients.length) {
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
