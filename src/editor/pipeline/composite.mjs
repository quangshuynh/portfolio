// Layer compositing on the CPU: the reference the GPU preview (compositeShader.mjs) is tested
// against, the export engine and the no-WebGL2 preview. The canvas is straight RGBA8; each
// visible layer, bottom to top, is one pass over it that leaves 8-bit codes again, so every
// pass, every band and both renderers start from the same numbers.
//
// - Raster pass (image layers, text sprites): each canvas pixel centre is mapped to the raster
//   (layerTransform.mjs) and sampled with warp.mjs's Catmull-Rom kernel (premultiplied, edges
//   clamped, rounded to codes), faded to transparent over one canvas pixel outside the raster
//   as the geometry's edge coverage is, then composited with the layer's opacity and blend mode
//   (blend.mjs). Only pixels in the raster's bounds are visited; the rest keep the backdrop.
// - Adjustment pass: the backdrop rendered with the layer's colour settings by the CPU renderer
//   (8-bit result), then mixed back by the blend mode and opacity; alpha is unchanged. Layers
//   above are not affected, because they are composited afterwards.
//
// - Detail pass (a local adjustment's Texture, Clarity, Dehaze, Sharpening, noise reduction):
//   the backdrop rendered by the Detail renderer (detailRenderer.mjs) with only those settings,
//   its guide computed from the whole backdrop, then mixed back like an adjustment pass. CPU only.
//
// Masks (pipeline/mask.mjs): a pass may carry `mask` ({ def, map } and, in previews, `raster`,
// the whole canvas's coverage codes); its coverage scales the pass's alpha (raster) or opacity
// (adjustment, Detail) per pixel. A mask is evaluated per pixel too.
//
// Raster and adjustment passes are per pixel (resampling reads the layer's own raster, never the
// canvas), so bands and export tiles never need overlap and the result does not depend on where
// a band starts. A Detail pass reads neighbours: it runs over the whole canvas, band by band,
// each band reading `halo` rows around it from the unchanged backdrop (its results are written
// back only once no later band reads those rows), so it is seam-free too.

import { prepareRender, renderRgba8 } from './cpuRenderer.mjs';
import { normalizeAdjustments } from '../model/adjustments.mjs';
import { maskRows } from './mask.mjs';
import { guideSource, prepareDetailRender, renderDetailRows, rowsHaveAlpha } from './detailRenderer.mjs';
import { deriveParams } from './spec.mjs';
import { warpRows, hasAlpha } from './warp.mjs';
import { BLEND_CODES, adjustPixel, compositePixel } from './blend.mjs';
import { matrixScale, rasterBounds } from './layerTransform.mjs';
import { layerAdjustments } from '../model/layers.mjs';

export const COMPOSITE_BAND_ROWS = 256;

/** Edge coverage of canvas pixel (x, y) by a raster of `width` × `height` (warp.coverageAt for an affine matrix). */
export function rasterCoverage(m, width, height, scale, x, y) {
  const cx = x + 0.5;
  const cy = y + 0.5;
  const sx = m[0] * cx + m[1] * cy + m[2];
  const sy = m[3] * cx + m[4] * cy + m[5];
  const d = Math.min(sx, width - sx, sy, height - sy);
  return Math.min(1, Math.max(0, d / scale + 0.5));
}

/**
 * A raster pass for a layer: plain data (posted to band workers as is, minus the raster).
 * :param raster: { width, height, data } straight RGBA8 in its own pixels
 * :param matrix: canvas px → raster px (layerTransform.layerMatrix / offsetMatrix)
 */
export function rasterPass(layer, raster, matrix, canvas, mask = null) {
  return {
    kind: 'raster',
    id: layer.id,
    raster,
    matrix,
    scale: matrixScale(matrix),
    opaque: !hasAlpha(raster),
    opacity: layer.opacity,
    mode: BLEND_CODES[layer.blend] ?? 0,
    bounds: rasterBounds(matrix, raster, canvas),
    mask,
  };
}

/** An adjustment pass: the layer's settings (and its LUT, when it has one) and how its result is mixed back. */
export function adjustmentPass(layer, lut = null, mask = null) {
  return {
    kind: 'adjust',
    id: layer.id,
    adjustments: layerAdjustments(layer.settings),
    lut,
    opacity: layer.opacity,
    mode: BLEND_CODES[layer.blend] ?? 0,
    mask,
  };
}

/**
 * The passes of a local adjustment (model/masks.mjs): Detail first (when it has Detail
 * settings), then its Light, Color and HSL, both through its mask and scaled by its amount.
 * :param native: the canvas's size at full resolution (Detail radii are in its pixels)
 * :param parts: splitLocalSettings(local.settings)
 */
export function localPasses(local, mask, native, { detail, color }) {
  const passes = [];
  const common = { id: local.id, opacity: local.amount, mode: 0, mask };
  if (Object.keys(detail).length) passes.push({ ...common, kind: 'detail', adjustments: normalizeAdjustments(detail), native: { width: native.width, height: native.height } });
  if (Object.keys(color).length) passes.push({ ...common, kind: 'adjust', adjustments: normalizeAdjustments(color), lut: null });
  return passes;
}

/**
 * Coverage codes of a pass's mask over rows [y0, y1), columns [x0, x0 + width), or null when
 * it has none. A preview's whole-canvas `raster` is sliced; otherwise the mask is evaluated.
 */
export function passMask(pass, canvasWidth, y0, y1, x0 = 0, width = canvasWidth) {
  const { mask } = pass;
  if (!mask) return null;
  if (!mask.raster) return maskRows(mask.def, mask.map, width, y0, y1, { x0 });
  const out = new Uint8ClampedArray(width * (y1 - y0));
  for (let y = y0; y < y1; y += 1) out.set(mask.raster.data.subarray(y * canvasWidth + x0, y * canvasWidth + x0 + width), (y - y0) * width);
  return out;
}

/** deriveParams of an adjustment pass (no RAW: it acts on the 8-bit composite). */
export const adjustmentParams = (pass) => deriveParams(pass.adjustments, { lut: pass.lut });

/**
 * Applies a raster pass to canvas rows [y0, y1), held in `rows` (straight RGBA8, row y0 first).
 * `pass.raster.top` marks a raster that holds only rows from `top` (a band worker's slice).
 */
export function compositeRasterRows(rows, canvasWidth, y0, y1, pass) {
  const { bounds } = pass;
  if (!bounds) return rows;
  const top = Math.max(y0, bounds.y);
  const bottom = Math.min(y1, bounds.y + bounds.height);
  if (bottom <= top) return rows;
  const { matrix: m, scale, opacity, mode } = pass;
  const { width: rw, height: rh } = pass.raster;
  const width = bounds.width;
  const sampled = new Uint8ClampedArray(width * (bottom - top) * 4);
  warpRows(pass.raster, m, width, top, bottom, sampled, { opaque: pass.opaque, x0: bounds.x });
  const mask = passMask(pass, canvasWidth, top, bottom, bounds.x, width);
  for (let y = top; y < bottom; y += 1) {
    for (let x = bounds.x; x < bounds.x + width; x += 1) {
      const coverage = rasterCoverage(m, rw, rh, scale, x, y);
      if (coverage <= 0) continue; // eslint-disable-line no-continue
      const p = (y - top) * width + x - bounds.x;
      const i = p * 4;
      const masked = mask ? opacity * (mask[p] / 255) : opacity;
      compositePixel(mode, rows, ((y - y0) * canvasWidth + x) * 4, sampled, i, (sampled[i + 3] / 255) * coverage * masked);
    }
  }
  return rows;
}

/**
 * Applies an adjustment pass to `rows` (straight RGBA8, any number of whole rows).
 * :param prepared: prepareRender(adjustmentParams(pass)), built once per pass
 * :param at: { width, y0 } the canvas width and the first row's index (for the pass's mask)
 */
export function adjustRows(rows, pass, prepared, { width = 0, y0 = 0 } = {}) {
  const pixels = rows.length / 4;
  const mask = pass.mask ? passMask(pass, width, y0, y0 + pixels / width) : null;
  const adjusted = renderRgba8(rows, prepared);
  for (let p = 0; p < pixels; p += 1) adjustPixel(pass.mode, rows, p * 4, adjusted, p * 4, mask ? pass.opacity * (mask[p] / 255) : pass.opacity);
  return rows;
}

/** Mixes Detail-rendered rows into `rows` (backdrop rows from y0) through the pass's mask and opacity. */
function mixRows(rows, rendered, pass, width, y0) {
  const pixels = rows.length / 4;
  const mask = passMask(pass, width, y0, y0 + pixels / width);
  for (let p = 0; p < pixels; p += 1) adjustPixel(0, rows, p * 4, rendered, p * 4, mask ? pass.opacity * (mask[p] / 255) : pass.opacity);
  return rows;
}

function* detailBands(image, pass, bandRows) {
  const { width, height, data } = image;
  const context = prepareDetailRender(deriveParams(pass.adjustments), {
    width,
    height,
    nativeWidth: pass.native.width,
    nativeHeight: pass.native.height,
    guideImage: guideSource(image),
    transparent: rowsHaveAlpha(image, 0, height),
  });
  const pending = [];
  const flush = (before) => {
    while (pending.length && pending[0].last <= before) {
      const band = pending.shift();
      data.set(band.rows, band.row * width * 4);
    }
  };
  for (let row = 0; row < height; row += bandRows) {
    const last = Math.min(height, row + bandRows);
    const rendered = new Uint8ClampedArray((last - row) * width * 4);
    renderDetailRows(image, context, row, last, rendered);
    pending.push({ row, last, rows: mixRows(data.slice(row * width * 4, last * width * 4), rendered, pass, width, row) });
    // The next band reads the backdrop from `last − halo`: rows above that are final.
    flush(last - context.halo);
    yield last / height;
  }
  flush(Infinity);
}

/**
 * Applies a Detail pass over a whole canvas image in place, band by band. Each band reads the
 * unchanged backdrop around it; a band's result is held until no later band reads its rows.
 * :param options: { bandRows, onBand(fraction), cancelled() } onBand may return a promise
 */
export async function detailImage(image, pass, { bandRows = COMPOSITE_BAND_ROWS, onBand, cancelled } = {}) {
  for (const fraction of detailBands(image, pass, bandRows)) {
    await onBand?.(fraction);
    if (cancelled?.() && fraction < 1) throw Object.assign(new Error('Cancelled.'), { code: 'cancelled' });
  }
  return image;
}

/**
 * Composites every pass over a whole canvas image ({ width, height, data } straight RGBA8),
 * in place and in bands (tests, the no-WebGL2 preview and exports without band workers).
 * :param options: { bandRows, onBand(fraction) } onBand may return a promise (to yield)
 */
export async function compositeImage(image, passes, { bandRows = COMPOSITE_BAND_ROWS, onBand, cancelled } = {}) {
  const { width, height, data } = image;
  let done = 0;
  const total = passes.length * height;
  for (const pass of passes) {
    if (pass.kind === 'detail') {
      const start = done;
      await detailImage(image, pass, { bandRows, cancelled, onBand: (fraction) => onBand?.((start + fraction * height) / total) });
      done += height;
      continue; // eslint-disable-line no-continue
    }
    const prepared = pass.kind === 'adjust' ? prepareRender(adjustmentParams(pass)) : null;
    for (let row = 0; row < height; row += bandRows) {
      if (cancelled?.()) throw Object.assign(new Error('Cancelled.'), { code: 'cancelled' });
      const last = Math.min(height, row + bandRows);
      const rows = data.subarray(row * width * 4, last * width * 4);
      if (pass.kind === 'adjust') adjustRows(rows, pass, prepared, { width, y0: row });
      else compositeRasterRows(rows, width, row, last, pass);
      done += last - row;
      await onBand?.(done / total);
    }
  }
  return image;
}

/** Synchronous whole-image composite (Node tests and parity references). */
export function compositeImageSync(image, passes) {
  const { width, height, data } = image;
  for (const pass of passes) {
    if (pass.kind === 'detail') {
      const bands = detailBands(image, pass, COMPOSITE_BAND_ROWS);
      while (!bands.next().done);
    } else if (pass.kind === 'adjust') adjustRows(data, pass, prepareRender(adjustmentParams(pass)), { width, y0: 0 });
    else compositeRasterRows(data, width, 0, height, pass);
  }
  return image;
}
