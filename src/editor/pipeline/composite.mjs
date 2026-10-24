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
// Every pass is per pixel (resampling reads the layer's own raster, never the canvas), so bands
// and export tiles never need overlap and the result does not depend on where a band starts.

import { prepareRender, renderRgba8 } from './cpuRenderer.mjs';
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
export function rasterPass(layer, raster, matrix, canvas) {
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
  };
}

/** An adjustment pass: the layer's settings (and its LUT, when it has one) and how its result is mixed back. */
export function adjustmentPass(layer, lut = null) {
  return {
    kind: 'adjust',
    id: layer.id,
    adjustments: layerAdjustments(layer.settings),
    lut,
    opacity: layer.opacity,
    mode: BLEND_CODES[layer.blend] ?? 0,
  };
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
  for (let y = top; y < bottom; y += 1) {
    for (let x = bounds.x; x < bounds.x + width; x += 1) {
      const coverage = rasterCoverage(m, rw, rh, scale, x, y);
      if (coverage <= 0) continue; // eslint-disable-line no-continue
      const i = ((y - top) * width + x - bounds.x) * 4;
      compositePixel(mode, rows, ((y - y0) * canvasWidth + x) * 4, sampled, i, (sampled[i + 3] / 255) * coverage * opacity);
    }
  }
  return rows;
}

/**
 * Applies an adjustment pass to `rows` (straight RGBA8, any number of whole rows).
 * :param prepared: prepareRender(adjustmentParams(pass)), built once per pass
 */
export function adjustRows(rows, pass, prepared) {
  const adjusted = renderRgba8(rows, prepared);
  const pixels = rows.length / 4;
  for (let p = 0; p < pixels; p += 1) adjustPixel(pass.mode, rows, p * 4, adjusted, p * 4, pass.opacity);
  return rows;
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
    const prepared = pass.kind === 'adjust' ? prepareRender(adjustmentParams(pass)) : null;
    for (let row = 0; row < height; row += bandRows) {
      if (cancelled?.()) throw Object.assign(new Error('Cancelled.'), { code: 'cancelled' });
      const last = Math.min(height, row + bandRows);
      const rows = data.subarray(row * width * 4, last * width * 4);
      if (pass.kind === 'adjust') adjustRows(rows, pass, prepared);
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
    if (pass.kind === 'adjust') adjustRows(data, pass, prepareRender(adjustmentParams(pass)));
    else compositeRasterRows(data, width, 0, height, pass);
  }
  return image;
}
