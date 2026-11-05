// Intelligent selections on an image layer (Interval 24.1): the models see the layer's own source
// as the layer shows it (decoded with its orientation, RAW developed, the layer's colour settings
// applied), never the composite under it and never the canvas after the layer's transform. The
// result is a grid over the whole source, which is exactly the layer's box ('layer' mask space),
// so moving, scaling, rotating or flipping the layer never needs another analysis.
//
// Transparent sources (PNG, WebP cut-outs): the models are given the visible pixels over mid
// grey, and the coverage they return is multiplied by the source's alpha, so empty pixels are
// never selected and an outline never extends into them.
import { decodeCodes, encodeCodes, quantize, resizeMap } from './analysis.mjs';

const GREY = 128;

/** What an image layer's analysis depends on: its source and the settings it is developed with. */
export const layerAnalysisKey = (layer) => `layer|${layer.source.sha256}|${JSON.stringify(layer.settings ?? {})}|${JSON.stringify(layer.rawProfile ?? null)}`;

/**
 * An RGBA8 image ready for the models: opaque, partly transparent pixels composited over mid grey.
 * :returns: { image, alpha } with `alpha` (Float32, 0–1, the image's size) or null when opaque
 */
export function flattenForAnalysis(image) {
  const { width, height, data } = image;
  let opaque = true;
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) { opaque = false; break; }
  if (opaque) return { image, alpha: null };
  const out = new Uint8ClampedArray(data.length);
  const alpha = new Float32Array(width * height);
  for (let p = 0, i = 0; p < alpha.length; p += 1, i += 4) {
    const a = data[i + 3] / 255;
    alpha[p] = a;
    for (let c = 0; c < 3; c += 1) out[i + c] = Math.round(data[i + c] * a + GREY * (1 - a));
    out[i + 3] = 255;
  }
  return { image: { width, height, data: out }, alpha };
}

/**
 * A selection result with its coverage limited to the visible source: each grid cell × the
 * source's alpha there (`alpha` at `width` × `height`, resampled to the grid). A result that
 * covers nothing visible is returned as not found.
 */
export function limitToSourceAlpha(result, alpha, width, height) {
  if (!alpha || !result?.found || !result.data) return result;
  const n = result.width * result.height;
  const codes = decodeCodes(result.data, n);
  if (!codes) return result;
  const a = result.width === width && result.height === height ? alpha : resizeMap(alpha, width, height, result.width, result.height);
  const coverage = new Float32Array(n);
  let any = false;
  for (let i = 0; i < n; i += 1) {
    coverage[i] = (codes[i] / 255) * Math.min(1, Math.max(0, a[i]));
    if (coverage[i] >= 0.5 / 255) any = true;
  }
  if (!any) return { ...result, found: false, data: null, note: 'Nothing visible was selected on this layer.' };
  return { ...result, data: encodeCodes(quantize(coverage)) };
}
