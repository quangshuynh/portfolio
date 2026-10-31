// @vitest-environment node
// RAW rendering profiles: the Camera Natural tone, profile parameters, both renderers' CPU
// path, the settings model (defaults, migration, reset, undo, save and reopen, sync,
// recipes) and that saved edits without a profile render exactly as before.

import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { DEFAULT_RAW_PROFILE, LEGACY_RAW_PROFILE, NATURAL_CURVE, RAW_PROFILE_IDS, dngBaselineEv, naturalTone, rawProfileParams } from './rawProfiles.mjs';
import { deriveParams, developRaw, processLinear } from '../pipeline/spec.mjs';
import { encodeSrgb8, renderRawRgba8 } from '../pipeline/cpuRenderer.mjs';
import { compactAdjustments, developmentBase, groupIsNeutral, neutralAdjustments, neutralGroup, normalizeAdjustments } from '../model/adjustments.mjs';
import { DOCUMENT_TYPE, DOCUMENT_VERSION, createEditDocument, parseEditDocument, serializeEditDocument } from '../model/editDocument.mjs';
import { editorReducer, importedAdjustments, initialEditorState } from '../model/editorState.mjs';
import { planReset, planSync } from '../model/sync.mjs';
import { RECIPE_GROUPS, recipeFromAdjustments } from '../model/recipes.mjs';

const RAW = {
  asShot: [2.33984375, 1, 1.53515625],
  rgbCam: [1.635386, -0.421962, -0.213424, -0.131072, 1.542707, -0.411635, 0.01143, -0.419593, 1.408163],
  camXyz: [0.7374, -0.2389, -0.0551, -0.5435, 1.3162, 0.2519, -0.1006, 0.1795, 0.6552],
};
const NATURAL = { raw: { profile: 'camera-natural' } };
const LINEAR = { raw: { profile: 'linear' } };

/**
 * Decoder values (0–65535) of a neutral grey of linear luminance `y` (1 = sensor white) under
 * as-shot balance: the decoder normalises by the largest multiplier, development restores it.
 */
function greyPixel(y) {
  const value = Math.round(y * (Math.min(...RAW.asShot) / Math.max(...RAW.asShot)) * 65535);
  return [value, value, value];
}
function render(adjustments, pixels, raw = RAW) {
  return renderRawRgba8(Uint16Array.from(pixels.flat()), deriveParams(normalizeAdjustments(adjustments), { raw }));
}
const greys = (count) => Array.from({ length: count }, (_, i) => greyPixel((i + 1) / count));

describe('Camera Natural tone', () => {
  const curve = { contrast: NATURAL_CURVE.contrast, pivot: NATURAL_CURVE.pivot, shoulder: NATURAL_CURVE.shoulder };
  const white = 2 ** NATURAL_CURVE.baselineEv;

  test('maps black to black and the sensor white to display white, monotonic and smooth between', () => {
    expect(naturalTone(0, curve, white)).toBe(0);
    expect(naturalTone(white, curve, white)).toBeCloseTo(1, 12);
    let previous = 0;
    let previousSlope = Infinity;
    for (let i = 1; i <= 2000; i += 1) {
      const y = (white * i) / 2000;
      const value = naturalTone(y, curve, white);
      expect(value).toBeGreaterThan(previous);
      // Past middle grey the slope only falls: a shoulder, no kink or hard clip.
      const slope = (value - previous) * 2000 / white;
      if (y > 0.5) expect(slope).toBeLessThanOrEqual(previousSlope + 1e-9);
      previous = value;
      previousSlope = slope;
    }
  });

  test('raises midtones like a camera rendering but leaves the deepest shadows near linear', () => {
    // 2.5 stops below the sensor white, where the measured cameras rendered 0.25–0.55 luminance.
    const mid = naturalTone(2 ** -2.5 * white, curve, white);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.45);
    // Toe contrast 1.25: 8 stops below the sensor white is not crushed to black.
    expect(naturalTone(white / 256, curve, white)).toBeGreaterThan(0.002);
  });

  test('profile parameters add the baseline and DNG BaselineExposure, never to the slider', () => {
    expect(rawProfileParams('legacy', { baselineExposure: 0.4 })).toEqual({ id: 'legacy', exposureEv: 0, curve: null });
    expect(rawProfileParams('linear', { baselineExposure: 0.4 })).toEqual({ id: 'linear', exposureEv: 0.4, curve: null });
    expect(rawProfileParams('camera-natural', { baselineExposure: -0.5 }).exposureEv).toBeCloseTo(NATURAL_CURVE.baselineEv - 0.5, 12);
    expect(rawProfileParams('camera-natural', {}).exposureEv).toBe(NATURAL_CURVE.baselineEv);
    // Missing or implausible metadata counts as none.
    expect([null, undefined, NaN, -999, 9].map((value) => dngBaselineEv({ baselineExposure: value }))).toEqual([0, 0, 0, 0, 0]);
    const params = deriveParams(normalizeAdjustments({ ...NATURAL, exposure: 0.5 }), { raw: RAW });
    expect(params.exposureGain).toBeCloseTo(2 ** (0.5 + NATURAL_CURVE.baselineEv), 12);
    expect(normalizeAdjustments({ ...NATURAL, exposure: 0.5 }).exposure).toBe(0.5);
  });
});

describe('rendering with profiles', () => {
  test('saved edits without a profile render byte for byte as before profiles existed', () => {
    // Hashes of the same renders from main at 55178ea (Interval 21), before profiles.
    const data = new Uint16Array(32 * 32 * 3);
    for (let i = 0; i < 32 * 32; i += 1) data.set([(i * 2039) % 65536, (i * 4093) % 65536, (i * 977 + 31) % 65536], i * 3);
    const cases = [{}, { exposure: 1.5 }, { exposure: -1, contrast: 30, highlights: -50, shadows: 40 }, { raw: { whiteBalance: 'daylight' }, saturation: 20 }];
    const hashes = cases.map((a) => createHash('sha256').update(renderRawRgba8(data, deriveParams(normalizeAdjustments(a), { raw: RAW }))).digest('hex').slice(0, 16));
    expect(hashes).toEqual(['48ffc412a531a6ca', 'cfc837622c6b574a', '4c9ff9d7577014a3', '9d46d7d8ad164dda']);
    expect(normalizeAdjustments(cases[1]).raw.profile).toBe(LEGACY_RAW_PROFILE);
  });

  test('Linear without BaselineExposure is the legacy rendering; with it, a pure exposure offset', () => {
    const pixels = greys(16);
    expect(render(LINEAR, pixels)).toEqual(render({}, pixels));
    const dng = { ...RAW, baselineExposure: -1 };
    expect(render(LINEAR, pixels, dng)).toEqual(render({ exposure: -1 }, pixels));
  });

  test('Camera Natural is brighter in the midtones, keeps the sensor white at 255, and greys neutral', () => {
    const pixels = greys(32);
    const legacy = render({}, pixels);
    const natural = render(NATURAL, pixels);
    const mid = 4 * 7; // about 25% of the sensor white
    expect(natural[mid + 1]).toBeGreaterThan(legacy[mid + 1] + 25);
    expect(natural.at(-3)).toBe(255);
    for (let i = 0; i < 32; i += 1) {
      const [r, g, b] = natural.subarray(i * 4, i * 4 + 3);
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(1);
      if (i) expect(g).toBeGreaterThanOrEqual(natural[(i - 1) * 4 + 1]);
    }
  });

  test('Exposure still acts: up rolls highlights into white without clipping below it, down darkens white', () => {
    const pixels = greys(64);
    const plus2 = render({ ...NATURAL, exposure: 2 }, pixels);
    const minus1 = render({ ...NATURAL, exposure: -1 }, pixels);
    const natural = render(NATURAL, pixels);
    expect(plus2.at(-3)).toBe(255);
    // Only the brightest few steps reach 255: the shoulder compresses instead of clipping.
    const clipped = Array.from({ length: 64 }, (_, i) => plus2[i * 4 + 1]).filter((g) => g === 255).length;
    expect(clipped).toBeLessThanOrEqual(3);
    expect(minus1.at(-3)).toBeLessThan(240);
    for (let i = 0; i < 64; i += 1) {
      expect(plus2[i * 4 + 1]).toBeGreaterThanOrEqual(natural[i * 4 + 1]);
      expect(minus1[i * 4 + 1]).toBeLessThanOrEqual(natural[i * 4 + 1]);
    }
  });

  test('tone sliders and curves apply after the profile', () => {
    const pixels = greys(16);
    const flat = render(NATURAL, pixels);
    const darker = render({ ...NATURAL, curves: { master: [[0, 0], [128, 90], [255, 255]] } }, pixels);
    const contrast = render({ ...NATURAL, contrast: 50 }, pixels);
    expect(darker[4 * 6 + 1]).toBeLessThan(flat[4 * 6 + 1]);
    expect(contrast).not.toEqual(flat);
    expect(darker.at(-3)).toBe(255);
  });

  test('colour hue survives the tone curve; out-of-range colours are fitted toward luminance', () => {
    const params = deriveParams(normalizeAdjustments(NATURAL), { raw: RAW });
    const out = [0, 0, 0];
    developRaw(0.08, 0.05, 0.03, params.raw, out);
    const ratio = out[0] / out[1];
    processLinear(out, params);
    expect(out[0] / out[1]).toBeCloseTo(ratio, 6);
    developRaw(0.9, 0.2, 0.1, params.raw, out);
    processLinear(out, params);
    expect(Math.max(...out)).toBeLessThanOrEqual(1);
  });

  test('the tabulated CPU tone matches the exact function within one 8-bit code', () => {
    const params = deriveParams(normalizeAdjustments({ ...NATURAL, exposure: 0.7 }), { raw: RAW });
    const pixels = Array.from({ length: 4096 }, (_, i) => [(i * 37) % 65536, (i * 16) % 65536, (i * 23) % 65536]);
    const fast = renderRawRgba8(Uint16Array.from(pixels.flat()), params);
    let worst = 0;
    pixels.forEach(([r, g, b], i) => {
      const rgb = [0, 0, 0];
      developRaw(r / 65535, g / 65535, b / 65535, params.raw, rgb);
      processLinear(rgb, params);
      rgb.forEach((value, c) => { worst = Math.max(worst, Math.abs(encodeSrgb8(value) - fast[i * 4 + c])); });
    });
    expect(worst).toBeLessThanOrEqual(1);
  });

  test('merged HDR photos keep their own tone stage whatever the profile says', () => {
    const hdr = { ...RAW, hdrWhite: 4 };
    const params = deriveParams(normalizeAdjustments(NATURAL), { raw: hdr });
    expect(params.profile).toBe(LEGACY_RAW_PROFILE);
    expect(params.profileCurve).toBeNull();
    expect(params.exposureGain).toBe(1);
  });

  test('JPEG, PNG and WebP sources ignore the profile', () => {
    const params = deriveParams(normalizeAdjustments({ ...NATURAL, exposure: 1 }));
    expect(params.profile).toBeNull();
    expect(params.exposureGain).toBe(2);
  });
});

describe('profiles in the settings model', () => {
  test('profiles normalise; settings without one are legacy', () => {
    expect(RAW_PROFILE_IDS).toEqual(['camera-natural', 'linear', 'legacy']);
    expect(normalizeAdjustments({}).raw).toEqual({ whiteBalance: 'as-shot', profile: 'legacy' });
    expect(normalizeAdjustments({ raw: { whiteBalance: 'daylight', profile: 'filmic' } }).raw).toEqual({ whiteBalance: 'daylight', profile: 'legacy' });
    expect(compactAdjustments(normalizeAdjustments({})).raw).toBeUndefined();
    // Legacy is never written: older documents keep their exact saved form (and CMS hashes).
    expect(compactAdjustments(normalizeAdjustments({ raw: { whiteBalance: 'daylight' } })).raw).toEqual({ whiteBalance: 'daylight' });
    expect(compactAdjustments(normalizeAdjustments(NATURAL)).raw).toEqual({ whiteBalance: 'as-shot', profile: 'camera-natural' });
  });

  test('new RAW imports start with Camera Natural; JPEGs and merged HDR do not', () => {
    expect(importedAdjustments({ format: 'arw', raw: RAW }).raw.profile).toBe(DEFAULT_RAW_PROFILE);
    expect(importedAdjustments({ format: 'jpeg' }).raw.profile).toBe(LEGACY_RAW_PROFILE);
    expect(importedAdjustments({ format: 'hdr', raw: { ...RAW, hdrWhite: 4 }, hdr: {} }).raw.profile).toBe(LEGACY_RAW_PROFILE);
  });

  const imported = (pendingEdits = []) => {
    let state = { ...initialEditorState(), pendingEdits };
    state = editorReducer(state, { type: 'photosAdded', photos: [{ id: 'p', name: 'DSC0001.ARW', size: 10, lastModified: 0 }] });
    return editorReducer(state, { type: 'importSucceeded', id: 'p', info: { format: 'arw', width: 6000, height: 4000, orientation: 1, sha256: 'a'.repeat(64), raw: RAW } });
  };
  const present = (state) => state.photos[0].history.present;

  test('switching profiles is one undoable step; reset keeps the profile and the slider values are untouched', () => {
    let state = imported();
    expect(present(state).raw.profile).toBe('camera-natural');
    state = editorReducer(state, { type: 'setAdjustment', key: 'exposure', value: 0.3 });
    state = editorReducer(state, { type: 'applySettings', patch: { raw: { ...present(state).raw, profile: 'linear' } } });
    expect(present(state)).toMatchObject({ exposure: 0.3, raw: { profile: 'linear' } });
    state = editorReducer(state, { type: 'undo' });
    expect(present(state)).toMatchObject({ exposure: 0.3, raw: { profile: 'camera-natural' } });
    state = editorReducer(state, { type: 'redo' });
    expect(present(state).raw.profile).toBe('linear');
    state = editorReducer(state, { type: 'resetAll' });
    expect(present(state)).toMatchObject({ exposure: 0, raw: { whiteBalance: 'as-shot', profile: 'linear' } });
    expect(groupIsNeutral(present(state), 'raw')).toBe(true);
    expect(neutralGroup('raw', present(state)).raw).toEqual({ whiteBalance: 'as-shot', profile: 'linear' });
    expect(developmentBase(present(state))).toEqual({ ...neutralAdjustments(), raw: { whiteBalance: 'as-shot', profile: 'linear' } });
  });

  test('profiles save and reopen; a version 13 file reopens with the legacy rendering', () => {
    const state = imported();
    const photo = { ...state.photos[0], adjustments: present(state) };
    const text = serializeEditDocument(createEditDocument([photo], state.exportSettings));
    expect(JSON.parse(text)).toMatchObject({ version: DOCUMENT_VERSION, photos: [{ adjustments: { raw: { profile: 'camera-natural' } } }] });
    expect(DOCUMENT_VERSION).toBe(14);
    const reopened = imported(parseEditDocument(text).photos);
    expect(present(reopened).raw.profile).toBe('camera-natural');
    const v13 = JSON.stringify({ type: DOCUMENT_TYPE, version: 13, photos: [{ source: { name: 'DSC0001.ARW', size: 10, sha256: 'a'.repeat(64), format: 'arw', width: 6000, height: 4000 }, adjustments: { exposure: 0.4, raw: { whiteBalance: 'daylight' } } }] });
    const legacy = imported(parseEditDocument(v13).photos);
    expect(legacy.photos[0].restored).toBe(true);
    expect(present(legacy)).toMatchObject({ exposure: 0.4, raw: { whiteBalance: 'daylight', profile: 'legacy' } });
  });

  test('recipes leave the profile out; RAW sync copies it; batch reset keeps each photo\'s own', () => {
    const settings = normalizeAdjustments({ ...NATURAL, exposure: 0.5, contrast: 10 });
    expect(JSON.stringify(recipeFromAdjustments(settings, { groups: RECIPE_GROUPS.map(({ id }) => id) }))).not.toContain('profile');
    const target = { id: 'b', name: 'b.arw', status: 'ready', raw: RAW, history: { present: normalizeAdjustments({}) } };
    expect(planSync(settings, [target], { groups: ['light'] }).items[0].after.raw.profile).toBe('legacy');
    expect(planSync(settings, [target], { groups: ['raw'], kind: { raw: true } }).items[0].after.raw.profile).toBe('camera-natural');
    const own = { ...target, history: { present: settings } };
    expect(planReset([own]).items[0].after).toMatchObject({ exposure: 0, contrast: 0, raw: { profile: 'camera-natural' } });
  });
});
