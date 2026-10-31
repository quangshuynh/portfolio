// RAW rendering profiles: how a RAW photo's linear development becomes a display image
// before any edit. Pure math, shared by spec.mjs (both renderers mirror it) and the UI.
//
//   legacy          Interval 5–21 rendering: linear sensor values straight to sRGB. Saved
//                   edits without a profile keep it, so they look exactly as they did.
//   linear          The same neutral rendering, plus the DNG BaselineExposure the file
//                   records (0 for other formats). No tone curve.
//   camera-natural  Default for new imports: BaselineExposure, a fixed rendering baseline,
//                   then a tone curve on luminance with a gentle toe and a highlight
//                   shoulder that maps the sensor white to display white. Version 2 (Interval
//                   22.1, new imports) adds a measured calibration for the few camera models
//                   with enough evidence; version 1 (Interval 22) has none and stays as it was.
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

/** Camera Natural version of new imports; edits saved without a version have version 1. */
export const NATURAL_VERSION = 2;

/**
 * Camera Natural version 2 calibration: exposure offsets for camera models whose rendering was
 * measured on enough genuine photographs to separate the camera from the scene (the offset that
 * best aligns this curve with the camera's tone response; median and median absolute deviation).
 * Nikon D3100: 62 NEF+JPEG pairs, −0.30 EV (MAD 0.10). Sony ILCE-7M3: 27 ARW embedded previews,
 * +0.25 EV (MAD 0.30). Models with one sample (Interval 21) are not calibrated: Auto Exposure
 * covers them per photo.
 */
export const CAMERA_CALIBRATION = Object.freeze([
  Object.freeze({ make: /^nikon/i, model: /^(nikon )?d3100$/i, ev: -0.3 }),
  Object.freeze({ make: /^sony/i, model: /^ilce-7m3$/i, ev: 0.25 }),
]);

/** Calibration offset in stops for a photo's camera (0 when the model is not calibrated). */
export function cameraCalibrationEv(raw) {
  const make = String(raw?.make ?? '').trim();
  const model = String(raw?.model ?? '').trim();
  return CAMERA_CALIBRATION.find((entry) => entry.make.test(make) && entry.model.test(model))?.ev ?? 0;
}

export const NATURAL_CURVE = Object.freeze({
  baselineEv: 1.35,
  // Toe: luminance is raised to this power about the pivot (18% grey) before the shoulder.
  contrast: 1.25,
  pivot: 0.18,
  // Shoulder: an extended Reinhard curve on luminance / shoulder, pinned at the white.
  shoulder: 1.1,
});

/**
 * Menu choices: a profile and, for Camera Natural, its version. Superseded choices (Legacy,
 * Camera Natural version 1) are listed only for edits that already use them.
 */
export const RAW_PROFILE_CHOICES = Object.freeze([
  Object.freeze({ value: 'camera-natural', profile: 'camera-natural', version: NATURAL_VERSION, label: 'Camera Natural' }),
  Object.freeze({ value: 'linear', profile: 'linear', version: 1, label: 'Linear / Neutral' }),
  Object.freeze({ value: 'camera-natural@1', profile: 'camera-natural', version: 1, label: 'Camera Natural (Interval 22)', superseded: true }),
  Object.freeze({ value: 'legacy', profile: 'legacy', version: 1, label: 'Legacy (before profiles)', superseded: true }),
]);

/** Version of a profile: 2 only for Camera Natural saved as version 2; everything else 1. */
export const profileVersionOf = (profile, version) => (profile === 'camera-natural' && version === NATURAL_VERSION ? NATURAL_VERSION : 1);

/** The menu choice of a profile and version. */
export const profileChoiceOf = (profile, version) => RAW_PROFILE_CHOICES.find((choice) => choice.profile === profile && choice.version === profileVersionOf(profile, version)) ?? RAW_PROFILE_CHOICES[3];

/** DNG BaselineExposure in stops, when the file records a plausible one. */
export const dngBaselineEv = (raw) => (Number.isFinite(raw?.baselineExposure) && Math.abs(raw.baselineExposure) <= 4 ? raw.baselineExposure : 0);

/**
 * Renderer parameters for a profile.
 * :param profile: one of RAW_PROFILE_IDS
 * :param raw: the photo's decoder info (BaselineExposure, make and model)
 * :param version: Camera Natural version (1 or 2)
 * :returns: { id, exposureEv: added to the exposure gain (never the slider), curve: null or
 *   { contrast, pivot, shoulder } }
 */
export function rawProfileParams(profile, raw, version = 1) {
  if (profile === 'camera-natural') {
    const { baselineEv, contrast, pivot, shoulder } = NATURAL_CURVE;
    const calibration = version >= 2 ? cameraCalibrationEv(raw) : 0;
    return { id: profile, exposureEv: baselineEv + dngBaselineEv(raw) + calibration, curve: { contrast, pivot, shoulder } };
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
