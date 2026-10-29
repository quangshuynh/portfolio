// "Original matched to edit" for the treatment comparison: the original's pixels in the edited
// composition's framing (crop, orientation, rotation, straightening, perspective, stretch),
// computed with the editor's own geometry and warp code, so a split compares the same scene
// region. Nothing is stretched: the output has the edit's aspect ratio.
import { geometryPlan, normalizeGeometry } from '../../src/editor/pipeline/geometry.mjs';
import { finishRows, warpImage, warpSpec } from '../../src/editor/pipeline/warp.mjs';

export const MATCHED_MAX_EDGE = 2200;

/**
 * The edit's framing of an original of `size` (the oriented original, at any resolution of the
 * same aspect): null when the geometry changes nothing, else the plan and an output size of the
 * edit's aspect, at most `maxEdge` and never larger than the framed original.
 */
export function matchedFrame(geometry, size, maxEdge = MATCHED_MAX_EDGE) {
  const plan = geometryPlan(normalizeGeometry(geometry ?? {}), size);
  if (plan.identity) return null;
  const { width, height } = plan.native;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { plan, out: { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) } };
}

/**
 * Warps RGBA8 `source` ({ width, height, data }) into the edit's framing; areas outside the
 * photo are filled as the JPEG render fills them (the geometry's background, else white).
 */
export function matchOriginalPixels(source, geometry, maxEdge = MATCHED_MAX_EDGE) {
  const frame = matchedFrame(geometry, source, maxEdge);
  if (!frame) return null;
  const spec = warpSpec(frame.plan, frame.out, source);
  const image = warpImage(source, spec.matrix, frame.out);
  finishRows(spec, image.data, 0, frame.out.height, true);
  return image;
}

/** The matched original of a loaded <img> as an object URL (PNG), or null when nothing changes. */
export async function matchedOriginalUrl(img, geometry, maxEdge = MATCHED_MAX_EDGE) {
  const { naturalWidth: width, naturalHeight: height } = img;
  if (!matchedFrame(geometry, { width, height }, maxEdge)) return null;
  const canvas = document.createElement('canvas');
  Object.assign(canvas, { width, height });
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser has no 2D canvas.');
  context.drawImage(img, 0, 0);
  const matched = matchOriginalPixels({ width, height, data: context.getImageData(0, 0, width, height).data }, geometry, maxEdge);
  Object.assign(canvas, { width: matched.width, height: matched.height });
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(matched.data.buffer), matched.width, matched.height), 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The matched original could not be encoded.');
  return URL.createObjectURL(blob);
}
