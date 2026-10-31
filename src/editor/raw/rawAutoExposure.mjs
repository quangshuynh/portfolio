// Auto Exposure for RAW photos: a suggested Exposure correction from the photo's own luminance,
// never applied by itself. Pure and deterministic: the same proxy and metadata always give the
// same suggestion. Used by the RAW panel (ui/RawPanel.jsx); constants and their measurements are
// in docs/photography-editor.md (Auto Exposure).
//
// The proxy is developed linearly with as-shot white balance; `baseEv` is what the rendering
// profile adds (baseline, DNG BaselineExposure, camera calibration).
//
// With the camera's embedded preview (its own rendering of this photo, which already holds the
// exposure the photographer chose, dark or bright), the suggestion is the exposure at which the
// profile's median lightness matches the preview's: on 40 Nikon D3100 files the preview's median
// lightness equals the camera JPEG's within 0.05 L*. Only colour-independent brightness is used,
// never the preview's pixels or colour.
//
// Without a preview it falls back to the photo's own luminance. Cameras do not normalise a
// scene's brightness (a dark scene stays dark in the camera's JPEG), so this is corrective, not
// normalising: it compares a centre-weighted log-average luminance with a key that is lower for
// dark scenes (EV100 from the recorded shutter, aperture and ISO) and corrects only how far the
// photo lies outside a normal range around it. Darkening needs evidence in the highlights (a
// bright key alone is high-key, not overexposure); brightening never pushes more unclipped
// highlights into white and is limited at high ISO. Ambiguous photos get no suggestion: no exposure
// metadata and a very dark frame, mostly sensor-clipped, or within the normal range.

import { naturalTone } from './rawProfiles.mjs';

export const AUTO_EXPOSURE = Object.freeze({
  // Target scene key (linear luminance after the profile baseline) for a bright scene: the median
  // key at which Camera Natural matched the camera's rendering (120 photographs).
  key: 0.18,
  // Normal range: keys within this many stops of the target are left alone; beyond it only the
  // excess is corrected.
  tolerance: 1,
  // Darker scenes aim lower: by up to `nightStops` stops between EV100 `dayEv` and `nightEv`.
  dayEv: 10,
  nightEv: 3,
  nightStops: 2,
  min: -1.5,
  max: 1.5,
  // Below this EV100 (dim interiors, dusk, night) nothing is brightened.
  lowLightEv: 7,
  // High ISO: brightening also lifts noise.
  highIso: 3200,
  highIsoMax: 0.7,
  // Smaller corrections are not offered.
  threshold: 0.2,
  step: 0.05,
  // Highlight guard: share of unclipped pixels newly pushed to near white.
  nearWhite: 0.97,
  highlightBudget: 0.01,
  // Darkening is offered only when at least this share of the frame is near white or clipped.
  darkenEvidence: 0.05,
  // More of the frame clipped at the sensor than this: no reliable key.
  maxClipped: 0.35,
  sampleEdge: 192,
  // Camera match: smaller differences than this are not offered (about 4 L* at middle grey).
  matchThreshold: 0.3,
  // Previews smaller than this long edge are not trusted.
  previewMinEdge: 320,
});

const lightness = (y) => (y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y);
const medianOf = (values) => Float64Array.from(values).sort()[values.length >> 1];

/**
 * Median CIE L* of a decoded preview (RGBA8 sRGB), rounded to 0.5 so browsers' JPEG decoders
 * agree. Returns null for previews smaller than `previewMinEdge`.
 * :param preview: { width, height, data } at most a few hundred pixels across
 * :param sourceEdge: the preview's own long edge before any downscale
 */
export function previewLightness(preview, sourceEdge, constants = AUTO_EXPOSURE) {
  if (!preview || sourceEdge < constants.previewMinEdge) return null;
  const count = preview.width * preview.height;
  const values = new Float64Array(count);
  const linear = (code) => { const v = code / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  for (let i = 0; i < count; i += 1) {
    const o = i * 4;
    values[i] = lightness(0.2126 * linear(preview.data[o]) + 0.7152 * linear(preview.data[o + 1]) + 0.0722 * linear(preview.data[o + 2]));
  }
  return Math.round(medianOf(values) * 2) / 2;
}

const LUMA = [0.2126, 0.7152, 0.0722];

/**
 * Linear luminance samples of a developed RAW proxy, box-averaged to at most `sampleEdge`.
 * :param image: { width, height, data: Uint16Array RGB } decoder output (as-shot, max-normalised)
 * :param develop: rawDevelopParams() for as-shot white balance
 * :returns: { width, height, y: Float32Array (1 = sensor white), clipped: Uint8Array }
 */
export function luminanceSamples(image, develop, sampleEdge = AUTO_EXPOSURE.sampleEdge) {
  const scale = Math.min(1, sampleEdge / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const y = new Float32Array(width * height);
  const clipped = new Uint8Array(width * height);
  const counts = new Uint32Array(width * height);
  const { gain, matrix: m } = develop;
  const lr = LUMA[0] * m[0] + LUMA[1] * m[3] + LUMA[2] * m[6];
  const lg = LUMA[0] * m[1] + LUMA[1] * m[4] + LUMA[2] * m[7];
  const lb = LUMA[0] * m[2] + LUMA[1] * m[5] + LUMA[2] * m[8];
  for (let sy = 0; sy < image.height; sy += 1) {
    const ty = Math.min(height - 1, Math.floor((sy * height) / image.height));
    for (let sx = 0; sx < image.width; sx += 1) {
      const tx = Math.min(width - 1, Math.floor((sx * width) / image.width));
      const i = (sy * image.width + sx) * 3;
      const r = Math.min(1, (image.data[i] / 65535) * gain[0]);
      const g = Math.min(1, (image.data[i + 1] / 65535) * gain[1]);
      const b = Math.min(1, (image.data[i + 2] / 65535) * gain[2]);
      const t = ty * width + tx;
      y[t] += Math.max(0, lr * r + lg * g + lb * b);
      counts[t] += 1;
      if (g >= 0.995) clipped[t] = 1;
    }
  }
  for (let t = 0; t < y.length; t += 1) y[t] /= counts[t];
  return { width, height, y, clipped };
}

/** EV100 of the recorded exposure, or null when shutter, aperture or ISO is missing. */
export function exposureValue100({ shutter, aperture, iso } = {}) {
  if (!(shutter > 0 && aperture > 0 && iso > 0)) return null;
  return Math.log2((aperture * aperture) / shutter) - Math.log2(iso / 100);
}

/** Target key for a scene of brightness EV100 (null: unknown, the day key). */
export function targetKey(ev100, constants = AUTO_EXPOSURE) {
  const { key, dayEv, nightEv, nightStops } = constants;
  if (ev100 === null || ev100 >= dayEv) return key;
  const depth = Math.min(1, (dayEv - ev100) / (dayEv - nightEv));
  return key * 2 ** (-nightStops * depth);
}

/**
 * The suggestion for a photo.
 * :param samples: luminanceSamples() result, with `previewLightness` (median L* of the camera's
 *   embedded preview, or null) when the import read one
 * :param options: { baseEv, curve (Camera Natural curve, or null for a linear profile), raw }
 * :returns: { ev } a correction in EV (rounded to `step`), or { ev: null, reason } when none is
 *   offered; `source` is 'camera' (matched to the camera's preview) or 'scene', with the
 *   measurements: key, target, ev100, limitedBy
 */
export function suggestExposure(samples, { baseEv = 0, curve = null, raw = {} } = {}, constants = AUTO_EXPOSURE) {
  const { width, height, y, clipped } = samples;
  const ev100 = exposureValue100(raw);
  const count = width * height;
  let clippedCount = 0;
  for (let i = 0; i < count; i += 1) clippedCount += clipped[i];
  const info = { ev100: ev100 === null ? null : +ev100.toFixed(2) };
  if (clippedCount / count > constants.maxClipped) return { ev: null, reason: 'Too much of the photo is clipped at the sensor to judge its exposure.', ...info };
  const base = 2 ** baseEv;
  const display = (value, stops) => {
    const gain = base * 2 ** stops;
    if (!curve) return Math.min(1, value * gain);
    return Math.min(1, naturalTone(value * gain, curve, Math.max(base, gain)));
  };
  const nearWhite = (stops) => {
    let n = 0;
    for (let i = 0; i < count; i += 1) if (!clipped[i] && display(y[i], stops) >= constants.nearWhite) n += 1;
    return n / count;
  };
  if (Number.isFinite(samples.previewLightness)) return matchCamera(samples.previewLightness, { y, count, display, nearWhite, info }, constants);

  // Centre-weighted log average of the unclipped scene, after the profile's baseline.
  let weightSum = 0;
  let logSum = 0;
  for (let row = 0; row < height; row += 1) {
    const dy = (row + 0.5) / height - 0.5;
    for (let column = 0; column < width; column += 1) {
      const i = row * width + column;
      if (clipped[i]) continue; // eslint-disable-line no-continue
      const dx = (column + 0.5) / width - 0.5;
      const weight = 1 + 1.5 * Math.exp(-(dx * dx + dy * dy) / 0.08);
      logSum += weight * Math.log(Math.max(1e-5, y[i] * base));
      weightSum += weight;
    }
  }
  const key = Math.exp(logSum / weightSum);
  const target = targetKey(ev100, constants);
  info.key = +key.toPrecision(3);
  info.target = +target.toPrecision(3);
  if (ev100 === null && key < 0.005) return { ev: null, reason: 'The photo is very dark and records no exposure details; it may be meant to be dark.', ...info };

  const distance = Math.log2(target / key);
  info.distance = +distance.toFixed(2);
  if (Math.abs(distance) <= constants.tolerance) return { ev: null, reason: 'The exposure is within the normal range.', ...info };
  let ev = distance - Math.sign(distance) * constants.tolerance;
  let limitedBy = null;
  const cap = (value, limit, why) => { if (value > limit) { limitedBy = why; return limit; } return value; };
  ev = cap(ev, constants.max, 'range');
  if (ev < constants.min) { ev = constants.min; limitedBy = 'range'; }
  if ((raw.iso ?? 0) >= constants.highIso) ev = cap(ev, constants.highIsoMax, 'high ISO');
  // Highlights: unclipped pixels pushed to near white must stay within the budget.
  if (ev > 0 && ev100 !== null && ev100 < constants.lowLightEv) return { ev: null, reason: 'The recorded exposure says this is a low-light scene; it is left dark.', ...info };
  const brightShare = nearWhite(0);
  // Evidence for darkening: highlights near white, or clipped at the sensor.
  if (ev < 0 && brightShare + clippedCount / count < constants.darkenEvidence) return { ev: null, reason: 'The photo is bright but its highlights hold detail; it may be meant to be high-key.', ...info };
  if (ev > 0) {
    const allowed = brightShare + constants.highlightBudget;
    while (ev > 0 && nearWhite(ev) > allowed) { ev = Math.max(0, ev - constants.step); limitedBy = 'highlights'; }
  }
  ev = Math.round(ev / constants.step) * constants.step + 0;
  info.limitedBy = limitedBy;
  if (Math.abs(ev) < constants.threshold) return { ev: null, reason: 'The exposure is within the normal range.', source: 'scene', ...info };
  return { ev: +ev.toFixed(2), source: 'scene', ...info };
}

/**
 * The exposure at which the profile's median lightness meets the camera preview's, searched on
 * the 0.05 EV grid within the range (the median rises monotonically with exposure), then held
 * back by the highlight guard like any brightening.
 */
function matchCamera(target, { y, count, display, nearWhite, info }, constants) {
  const medianAt = (stops) => {
    const values = new Float64Array(count);
    for (let i = 0; i < count; i += 1) values[i] = lightness(display(y[i], stops));
    return medianOf(values);
  };
  info.previewLightness = target;
  info.lightness = +medianAt(0).toFixed(1);
  let lo = Math.round(constants.min / constants.step);
  let hi = Math.round(constants.max / constants.step);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (medianAt(mid * constants.step) < target) lo = mid + 1; else hi = mid;
  }
  // The closer of the two grid points around the crossing.
  let steps = lo;
  if (lo > Math.round(constants.min / constants.step) && Math.abs(medianAt((lo - 1) * constants.step) - target) <= Math.abs(medianAt(lo * constants.step) - target)) steps = lo - 1;
  let ev = steps * constants.step;
  let limitedBy = ev >= constants.max - 1e-9 || ev <= constants.min + 1e-9 ? 'range' : null;
  if (ev > 0) {
    const allowed = nearWhite(0) + constants.highlightBudget;
    while (ev > 0 && nearWhite(ev) > allowed) { ev = Math.max(0, ev - constants.step); limitedBy = 'highlights'; }
  }
  ev = Math.round(ev / constants.step) * constants.step + 0;
  info.limitedBy = limitedBy;
  if (Math.abs(ev) < constants.matchThreshold) return { ev: null, reason: 'The brightness already matches the camera\'s own rendering.', source: 'camera', ...info };
  return { ev: +ev.toFixed(2), source: 'camera', ...info };
}
