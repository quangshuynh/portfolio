// RAW rendering profiles: how a RAW photo's linear development becomes a display image
// before any edit. Pure math, shared by spec.mjs (both renderers mirror it) and the UI.
//
//   legacy          Interval 5–21 rendering: linear sensor values straight to sRGB. Saved
//                   edits without a profile keep it, so they look exactly as they did.
//   linear          The same neutral rendering, plus the DNG BaselineExposure the file
//                   records (0 for other formats). No tone curve.
//   camera-natural  Default for new imports: BaselineExposure, a fixed rendering baseline,
//                   then a tone curve on luminance with a gentle toe and a highlight
//                   shoulder that maps the sensor white to display white.
//
// The Camera Natural constants were fitted (docs/photography-editor.md, RAW rendering
// profiles) to the tone response of 19 camera models: camera JPEGs from a Nikon D3100 and
// embedded previews from the rest. It is one curve for every camera, never per model;
// cameras differ from it by about ±0.8 EV, which the Exposure slider covers. The toe
// contrast is kept below the fitted 1.37 so shadows are not crushed.

export const RAW_PROFILES = Object.freeze([
  Object.freeze({ id: 'camera-natural', label: 'Camera Natural' }),
  Object.freeze({ id: 'linear', label: 'Linear / Neutral' }),
  Object.freeze({ id: 'legacy', label: 'Legacy (before profiles)' }),
]);
export const RAW_PROFILE_IDS = Object.freeze(RAW_PROFILES.map(({ id }) => id));
/** Saved edits without a profile. */
export const LEGACY_RAW_PROFILE = 'legacy';
/** New RAW imports. */
export const DEFAULT_RAW_PROFILE = 'camera-natural';

export const NATURAL_CURVE = Object.freeze({
  baselineEv: 1.35,
  // Toe: luminance is raised to this power about the pivot (18% grey) before the shoulder.
  contrast: 1.25,
  pivot: 0.18,
  // Shoulder: an extended Reinhard curve on luminance / shoulder, pinned at the white.
  shoulder: 1.1,
});

/** DNG BaselineExposure in stops, when the file records a plausible one. */
export const dngBaselineEv = (raw) => (Number.isFinite(raw?.baselineExposure) && Math.abs(raw.baselineExposure) <= 4 ? raw.baselineExposure : 0);

/**
 * Renderer parameters for a profile.
 * :param profile: one of RAW_PROFILE_IDS
 * :param raw: the photo's decoder info (for BaselineExposure)
 * :returns: { id, exposureEv: added to the exposure gain (never the slider), curve: null or
 *   { contrast, pivot, shoulder } }
 */
export function rawProfileParams(profile, raw) {
  if (profile === 'camera-natural') {
    const { baselineEv, contrast, pivot, shoulder } = NATURAL_CURVE;
    return { id: profile, exposureEv: baselineEv + dngBaselineEv(raw), curve: { contrast, pivot, shoulder } };
  }
  if (profile === 'linear') return { id: profile, exposureEv: dngBaselineEv(raw), curve: null };
  return { id: LEGACY_RAW_PROFILE, exposureEv: 0, curve: null };
}

/**
 * Camera Natural tone of linear luminance `y` (after exposure), where `white` is the sensor
 * white's luminance at this exposure, never below the profile's own (positive Exposure
 * moves the white up and the shoulder with it, so highlights still reach white smoothly).
 * Monotonic, maps 0 to 0 and `white` to 1.
 */
export function naturalTone(y, curve, white) {
  const { contrast, pivot, shoulder } = curve;
  const q = (pivot * (y / pivot) ** contrast) / shoulder;
  const w = (pivot * (white / pivot) ** contrast) / shoulder;
  return (q * (1 + q / (w * w))) / (1 + q);
}
