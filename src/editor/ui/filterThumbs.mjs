// Filter Library thumbnails: one small source per photo (the shown proxy, area-averaged and
// warped to the photo's crop and transform), rendered in a worker with each filter's patch.
// A thumbnail is its own guide source, so a capture (low resolution, JPEG) is never finer than
// the thumbnail: JPEG blocks look coarser, and fine pixel grids softer, than in the photo.
// Thumbnails are a few kB each and kept only for the current photo and settings; work for
// filters that are no longer shown, or for older settings, is dropped between batches.

import { createAreaAccumulator } from '../pipeline/detailRenderer.mjs';
import { geometryPlan, normalizeGeometry } from '../pipeline/geometry.mjs';
import { warpImage, warpSpec } from '../pipeline/warp.mjs';
import { groupKeys } from '../model/adjustments.mjs';

/** Long edge of a thumbnail in px (cards are about 64–80 CSS px wide; room for 2× screens). */
export const THUMB_EDGE = 144;
/** Filters rendered per worker call. */
export const THUMB_BATCH = 4;

const fit = ({ width, height }, edge) => {
  const scale = Math.min(1, edge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
};

function areaAverage(image, size) {
  if (size.width === image.width && size.height === image.height) return image;
  const accumulator = createAreaAccumulator(image.kind, image.width, image.height, size.width, size.height);
  accumulator.add(image.data, 0, image.height);
  return accumulator.finish();
}

/**
 * The thumbnail source of a proxy: { image, spec } where `spec` fades pixels outside the photo
 * after rendering (warp.finishRows), or null without geometry.
 * :param native: the photo's size as imported ({ width, height })
 */
export function thumbnailSource(proxy, geometry, native, edge = THUMB_EDGE) {
  const plan = geometryPlan(normalizeGeometry(geometry), native);
  if (plan.identity) return { image: areaAverage(proxy, fit(proxy, edge)), spec: null, native };
  // Averaged to twice the thumbnail first, so the warp's cubic kernel does not alias.
  const small = areaAverage(proxy, fit(proxy, edge * 2));
  const out = fit(plan.native, edge);
  const spec = warpSpec(plan, out, { width: small.width, height: small.height });
  const image = { ...(small.kind ? { kind: small.kind } : {}), ...out, data: warpImage(small, spec.matrix, spec).data };
  return { image, spec, native: plan.native };
}

const CREATIVE = new Set([...groupKeys('creative'), 'filter', 'overlays']);

/** The settings a thumbnail depends on besides its filter: everything but Creative and text. */
export function thumbnailBase(adjustments) {
  return Object.fromEntries(Object.entries(adjustments).filter(([key]) => !CREATIVE.has(key) || key === 'grainSeed'));
}
