// 1:1 inspection: a region of the photo rendered at its native resolution, exactly as the
// full-size export renders those pixels. The worker decodes the original once at full size
// and keeps only a crop around the visible region (with room to pan and the largest Detail
// halo) plus the guide source (the whole image area-averaged to at most 768 px, which does
// not depend on the settings). Each render then needs only that crop: the guide is
// recomputed from the guide source for the current settings, and the fine filters read the
// halo pixels around the region, so the crop's edges are those of the export.

import { prepareRender, renderRawRgba8, renderRgba8 } from './cpuRenderer.mjs';
import { createAreaAccumulator, guideSize, guideSource, prepareDetailRender, renderDetailRows, rowsHaveAlpha } from './detailRenderer.mjs';
import { finishRows, warpRows, warpSpec } from './warp.mjs';
import { detailHalo, detailParams } from './detail.mjs';
import { DIGITAL, shiftHalo } from './digital.mjs';
import { deriveParams } from './spec.mjs';
import { developmentBase } from '../model/adjustments.mjs';

/** Largest halo any Detail settings need at native size. */
export const MAX_DETAIL_HALO = detailHalo(detailParams({ texture: 100, clarity: 100, dehaze: 100, sharpening: 100, luminanceNoise: 100, colorNoise: 100 }), 1);
/** Largest halo of any settings for an image: Detail plus the strongest channel shift (digital.mjs). */
export const regionHalo = (image) => MAX_DETAIL_HALO + shiftHalo({ radial: DIGITAL.aberration, dx: DIGITAL.displacement, dy: 0 }, image.width, image.height);
/** Largest 1:1 region rendered at once, in source pixels. */
export const MAX_REGION = Object.freeze({ width: 2048, height: 1536 });

const channelsOf = (image) => (image.kind === 'raw' || image.kind === 'hdr' ? 3 : 4);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/**
 * The region of `size` (source px, capped by MAX_REGION and the image) centred on
 * `center`, kept inside the image. :returns: { x, y, width, height } integers
 */
export function regionAt(center, size, image) {
  const width = Math.min(image.width, MAX_REGION.width, Math.max(1, Math.round(size.width)));
  const height = Math.min(image.height, MAX_REGION.height, Math.max(1, Math.round(size.height)));
  return {
    x: clamp(Math.round(center.x - width / 2), 0, image.width - width),
    y: clamp(Math.round(center.y - height / 2), 0, image.height - height),
    width,
    height,
  };
}

/** The crop a worker keeps for a region: `margin` (fraction) of room to pan on each side plus the halo. */
export function sourceRect(region, image, margin = 0.5) {
  const padX = Math.round(region.width * margin) + regionHalo(image);
  const padY = Math.round(region.height * margin) + regionHalo(image);
  const x = Math.max(0, region.x - padX);
  const y = Math.max(0, region.y - padY);
  return { x, y, width: Math.min(image.width, region.x + region.width + padX) - x, height: Math.min(image.height, region.y + region.height + padY) - y };
}

/** True when a region and its halo lie inside a kept crop (so no new decode is needed). */
export function covers(source, region, image) {
  const halo = regionHalo(image);
  const left = Math.max(0, region.x - halo);
  const top = Math.max(0, region.y - halo);
  const right = Math.min(image.width, region.x + region.width + halo);
  const bottom = Math.min(image.height, region.y + region.height + halo);
  return left >= source.x0 && top >= source.y0 && right <= source.x0 + source.width && bottom <= source.y0 + source.height;
}

/** Copies a rectangle out of a whole in-memory image: { kind, width, height, x0, y0, data }. */
export function extractRect(image, rect) {
  const channels = channelsOf(image);
  const data = new image.data.constructor(rect.width * rect.height * channels);
  for (let y = 0; y < rect.height; y += 1) {
    const from = ((rect.y + y) * image.width + rect.x) * channels;
    data.set(image.data.subarray(from, from + rect.width * channels), y * rect.width * channels);
  }
  return { ...(image.kind ? { kind: image.kind } : {}), width: rect.width, height: rect.height, x0: rect.x, y0: rect.y, data };
}

const WARP_BAND_ROWS = 256;

/**
 * 1:1 source with geometry: the output at native size is warped from the decoded original
 * band by band into the guide accumulator (never held whole), and only `rect` of it kept,
 * warped with the same arithmetic as a whole warp, so the region equals the export's pixels.
 * :param source: the decoded original (RGBA8 or RAW RGB) at the size decodeSize() gives
 * :param plan: geometryPlan() of the photo; `rect` is in its output (native) pixels
 * :returns: the kept crop as regionSource returns it, plus the warp spec for coverage
 */
export function warpedRegionSource(source, plan, rect) {
  const out = plan.native;
  const spec = warpSpec(plan, out, source);
  const channels = channelsOf(source);
  const small = guideSize(out);
  const accumulator = createAreaAccumulator(source.kind, out.width, out.height, small.width, small.height);
  const band = new source.data.constructor(Math.min(WARP_BAND_ROWS, out.height) * out.width * channels);
  let transparent = false;
  for (let row = 0; row < out.height; row += WARP_BAND_ROWS) {
    const rows = Math.min(WARP_BAND_ROWS, out.height - row);
    const view = band.subarray(0, rows * out.width * channels);
    warpRows(source, spec.matrix, out.width, row, row + rows, view);
    accumulator.add(view, row, rows);
    if (channels === 4) transparent ||= rowsHaveAlpha({ width: out.width, data: view }, 0, rows);
  }
  const data = new source.data.constructor(rect.width * rect.height * channels);
  warpRows(source, spec.matrix, rect.width, rect.y, rect.y + rect.height, data, { x0: rect.x });
  return {
    source: { ...(source.kind ? { kind: source.kind } : {}), width: rect.width, height: rect.height, x0: rect.x, y0: rect.y, data },
    guideImage: guideSource(accumulator.finish()),
    transparent,
    native: { width: out.width, height: out.height },
    warp: spec,
  };
}

/**
 * Renders a region from a kept crop: the edited pixels and the "before" (the source, or a
 * RAW's neutral development), both RGBA8 of region.width × region.height.
 * :param kept: { source (extractRect result), guideImage, transparent, native: { width, height } }
 * :param settings: { adjustments, lut, raw }
 */
export function renderRegion(kept, region, { adjustments, lut = null, raw = null }) {
  const { source, guideImage, transparent = false, native, warp = null } = kept;
  const crop = extractRect({ ...source, height: source.height }, { x: region.x - source.x0, y: region.y - source.y0, width: region.width, height: region.height });
  const isRaw = channelsOf(source) === 3;
  const render = (values) => {
    const params = deriveParams(values, { lut, raw });
    if (!params.spatialActive) return isRaw ? renderRawRgba8(crop.data, params) : renderRgba8(crop.data, params);
    const prepared = prepareRender(params);
    const context = prepareDetailRender(prepared, { width: native.width, height: native.height, guideImage, transparent });
    const out = new Uint8ClampedArray(region.width * region.height * 4);
    renderDetailRows(source, context, region.y, region.y + region.height, out, { columns: [region.x, region.x + region.width] });
    return out;
  };
  // Outside the photo (geometry without crop to fill): faded as in the export.
  const finish = (rgba) => finishRows(warp, rgba, region.y, region.height, false, region);
  return {
    region,
    after: finish(render(adjustments)),
    before: finish(isRaw ? render(developmentBase(adjustments)) : new Uint8ClampedArray(crop.data)),
  };
}
