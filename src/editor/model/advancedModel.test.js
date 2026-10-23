// @vitest-environment node
import { adjustmentsEqual, compactAdjustments, groupIsNeutral, isNeutral, neutralAdjustments, normalizeAdjustments } from './adjustments.mjs';
import { DOCUMENT_TYPE, createEditDocument, parseEditDocument, serializeEditDocument } from './editDocument.mjs';
import { editorReducer, initialEditorState } from './editorState.mjs';
import { canUndo } from './history.mjs';
import {
  BUILT_IN_PRESETS, PRESET_PACK_TYPE, PresetError, applyPreset, changedPresetGroups, createPreset,
  parsePresetFile, presetPatch, serializePresets, uniquePresetName,
} from './presets.mjs';

const LUT = { sha256: 'f'.repeat(64), name: 'teal-orange.cube', title: 'Teal & Orange', size: 33 };
const ADVANCED = {
  exposure: 0.5, contrast: 20, orangeHue: -15, blueLuminance: -30, lutIntensity: 60, lut: LUT,
  curves: { master: [[0, 12], [128, 140], [255, 250]], red: [[0, 0], [100, 120], [255, 255]] },
};

function readyState() {
  let state = editorReducer(initialEditorState(), { type: 'photosAdded', photos: [{ id: 'a', name: 'a.jpg', size: 1, lastModified: 0 }] });
  state = editorReducer(state, { type: 'importSucceeded', id: 'a', info: { format: 'jpeg', width: 10, height: 10, orientation: 1, sha256: null } });
  return state;
}
const present = (state) => state.photos[0].history.present;

describe('settings model', () => {
  test('curves and LUT references are validated; junk becomes neutral', () => {
    const a = normalizeAdjustments({ curves: { master: 'x', blue: [[0, 0], [300, -5]] }, lut: { sha256: 'not-a-hash' } });
    expect(a.curves.blue).toEqual([[0, 0], [255, 0]]);
    expect(groupIsNeutral(a, 'curves')).toBe(false);
    expect(a.lut).toBeNull();
    expect(normalizeAdjustments({ lut: { ...LUT, size: 999, extra: '<script>' } }).lut).toEqual({ ...LUT, size: null });
  });

  test('neutral detection covers every group; LUT intensity alone is not an edit', () => {
    expect(isNeutral(neutralAdjustments())).toBe(true);
    expect(isNeutral(normalizeAdjustments({ redSaturation: 1 }))).toBe(false);
    expect(groupIsNeutral(normalizeAdjustments({ lutIntensity: 20 }), 'lut')).toBe(true);
    expect(isNeutral(normalizeAdjustments({ lut: LUT }))).toBe(false);
  });

  test('equality compares structured values', () => {
    const a = normalizeAdjustments(ADVANCED);
    expect(adjustmentsEqual(a, normalizeAdjustments(ADVANCED))).toBe(true);
    expect(adjustmentsEqual(a, normalizeAdjustments({ ...ADVANCED, curves: { master: [[0, 12], [128, 141], [255, 250]] } }))).toBe(false);
    expect(adjustmentsEqual(a, normalizeAdjustments({ ...ADVANCED, lut: { ...LUT, sha256: 'e'.repeat(64) } }))).toBe(false);
  });

  test('the compact form keeps the original ten controls and only non-neutral extras', () => {
    const compact = compactAdjustments(ADVANCED);
    expect(Object.keys(compact)).toEqual(['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'temperature', 'tint', 'vibrance', 'saturation', 'orangeHue', 'blueLuminance', 'lutIntensity', 'curves', 'lut']);
    expect(Object.keys(compact.curves)).toEqual(['master', 'red']);
    expect(Object.keys(compactAdjustments({}))).toHaveLength(10);
  });
});

describe('edit documents with advanced settings', () => {
  const photo = { name: 'DSC0002.jpg', size: 99, lastModified: 0, sha256: 'a'.repeat(64), format: 'jpeg', width: 6000, height: 4000, adjustments: ADVANCED };

  test('round-trip curves, HSL and the LUT reference, never the LUT data', () => {
    const text = serializeEditDocument(createEditDocument([photo], {}));
    expect(text).not.toMatch(/data"|Float32Array/);
    const parsed = parseEditDocument(text);
    expect(adjustmentsEqual(parsed.photos[0].adjustments, normalizeAdjustments(ADVANCED))).toBe(true);
    expect(parsed.photos[0].adjustments.lut).toEqual(LUT);
  });

  test('version 1 documents still open, with every new control neutral', () => {
    const v1 = JSON.stringify({ type: DOCUMENT_TYPE, version: 1, photos: [{ source: { name: 'x.jpg', size: 1 }, adjustments: { exposure: 1, saturation: -20 } }] });
    const { photos: [entry] } = parseEditDocument(v1);
    expect(entry.adjustments).toEqual(normalizeAdjustments({ exposure: 1, saturation: -20 }));
    expect(entry.adjustments.lut).toBeNull();
  });

  test('500 photos with every control changed still fit the 4 MB limit', () => {
    const busy = { ...ADVANCED, ...Object.fromEntries(Object.keys(neutralAdjustments()).filter((k) => /Hue$|Saturation$|Luminance$/.test(k)).map((k) => [k, 37])) };
    busy.curves = { master: Array.from({ length: 16 }, (_, i) => [i * 17, 255 - i * 17]), red: [[0, 0], [255, 200]], green: [[0, 0], [255, 200]], blue: [[0, 0], [255, 200]] };
    const photos = Array.from({ length: 500 }, (_, i) => ({ ...photo, sha256: i.toString(16).padStart(64, '0'), adjustments: busy }));
    const text = serializeEditDocument(createEditDocument(photos, {}));
    expect(text.length).toBeLessThan(1.5 * 1024 * 1024);
    expect(text).toContain('[0, 255]');
    expect(parseEditDocument(text).photos).toHaveLength(500);
  });
});

describe('editor actions for advanced settings', () => {
  test('curve drags preview freely and record one undo step', () => {
    let state = readyState();
    [[128, 140], [128, 150], [128, 160]].forEach((point) => {
      state = editorReducer(state, { type: 'previewSettings', patch: { curves: { ...present(state).curves, master: [[0, 0], point, [255, 255]] } } });
    });
    state = editorReducer(state, { type: 'commitAdjustment' });
    expect(state.photos[0].history.past).toHaveLength(1);
    state = editorReducer(state, { type: 'undo' });
    expect(groupIsNeutral(present(state), 'curves')).toBe(true);
  });

  test('choosing and removing a LUT are undoable', () => {
    let state = readyState();
    state = editorReducer(state, { type: 'applySettings', patch: { lut: LUT } });
    state = editorReducer(state, { type: 'applySettings', patch: { lut: null } });
    expect(present(state).lut).toBeNull();
    state = editorReducer(state, { type: 'undo' });
    expect(present(state).lut).toEqual(LUT);
  });

  test('resetting a group touches only that group', () => {
    let state = readyState();
    state = editorReducer(state, { type: 'applySettings', patch: { exposure: 1, redHue: 40, blueSaturation: -20 } });
    state = editorReducer(state, { type: 'resetGroup', group: 'hsl' });
    expect(present(state)).toMatchObject({ exposure: 1, redHue: 0, blueSaturation: 0 });
    expect(canUndo(state.photos[0].history)).toBe(true);
  });
});

describe('presets', () => {
  test('a preset replaces the groups it contains and leaves the others alone', () => {
    const photo = normalizeAdjustments({ exposure: 1.2, temperature: 30, contrast: 40, shadows: 50, redHue: 20 });
    const preset = createPreset('Mine', { contrast: 10, highlights: -30, blueLuminance: -40 }, ['tone', 'hsl']);
    const result = applyPreset(photo, preset);
    expect(result).toMatchObject({ exposure: 1.2, temperature: 30, contrast: 10, highlights: -30, shadows: 0, redHue: 0, blueLuminance: -40 });
  });

  test('applying is one undo step', () => {
    let state = readyState();
    state = editorReducer(state, { type: 'applyPreset', preset: BUILT_IN_PRESETS[0] });
    expect(state.photos[0].history.past).toHaveLength(1);
    state = editorReducer(state, { type: 'undo' });
    expect(isNeutral(present(state))).toBe(true);
  });

  test('the default groups when saving are the ones that changed', () => {
    expect(changedPresetGroups(normalizeAdjustments({ exposure: 1, curves: { blue: [[0, 0], [255, 230]] } }))).toEqual(['exposure', 'curves']);
    expect(changedPresetGroups(normalizeAdjustments({ lut: LUT }))).toEqual(['lut']);
  });

  test('presets export and import as a versioned pack', () => {
    const presets = [createPreset('One', ADVANCED, ['curves', 'lut']), createPreset('Two', { saturation: -30 }, ['presence'])];
    const text = serializePresets(presets);
    expect(JSON.parse(text)).toMatchObject({ type: PRESET_PACK_TYPE, version: 1 });
    expect(parsePresetFile(text)).toEqual(presets);
    const single = JSON.stringify({ type: 'quanghuynh.photo-editor.preset', version: 1, name: 'Solo', groups: ['tone'], settings: { contrast: 500 } });
    expect(parsePresetFile(single)[0].settings.contrast).toBe(100);
  });

  test.each([
    ['nope', 'not valid JSON'],
    [JSON.stringify({ type: 'other', version: 1 }), 'not a photo editor preset'],
    [JSON.stringify({ type: PRESET_PACK_TYPE, version: 9, presets: [] }), 'version 9'],
    [JSON.stringify({ type: PRESET_PACK_TYPE, version: 1, presets: [{ name: '', groups: ['tone'] }] }), 'no name'],
    [JSON.stringify({ type: PRESET_PACK_TYPE, version: 1, presets: [{ name: 'x', groups: [] }] }), 'no groups'],
    [JSON.stringify({ type: PRESET_PACK_TYPE, version: 1, presets: [{ name: 'x', groups: ['script'] }] }), 'unknown groups'],
    [JSON.stringify({ type: PRESET_PACK_TYPE, version: 1, presets: Array(201).fill({ name: 'x', groups: ['tone'] }) }), 'more than 200'],
    [' '.repeat(1024 * 1024 + 1), 'larger than 1 MB'],
  ])('rejects bad preset files with a message (%#)', (text, message) => {
    expect(() => parsePresetFile(text)).toThrow(PresetError);
    expect(() => parsePresetFile(text)).toThrow(message);
  });

  test('names are cleaned, required and made unique', () => {
    expect(() => createPreset('   ', {}, ['tone'])).toThrow('name');
    expect(() => createPreset('x', {}, [])).toThrow('at least one');
    expect(createPreset('  a\u0000b  ', {}, ['tone']).name).toBe('a b');
    expect(uniquePresetName('Natural', [{ name: 'natural' }, { name: 'Natural (2)' }])).toBe('Natural (3)');
  });

  test('built-in presets are restrained, valid, and never touch exposure or white balance', () => {
    expect(BUILT_IN_PRESETS.map(({ name }) => name)).toEqual(['Natural', 'Warm Portrait', 'Cool Landscape', 'Soft Film', 'High Contrast', 'Black & White']);
    BUILT_IN_PRESETS.forEach((preset) => {
      expect(preset.groups).not.toContain('exposure');
      expect(preset.groups).not.toContain('whiteBalance');
      const patch = presetPatch(preset);
      expect(patch.exposure).toBeUndefined();
      // Restrained: no global slider beyond ±40 (Black & White's HSL saturation is the exception by design).
      Object.entries(patch).filter(([key, value]) => typeof value === 'number' && !/Saturation$/.test(key) && key !== 'lutIntensity').forEach(([, value]) => expect(Math.abs(value)).toBeLessThanOrEqual(40));
    });
  });
});

describe('Detail settings', () => {
  const DETAIL = { texture: 30, clarity: -20, dehaze: 15, sharpening: 40, luminanceNoise: 25, colorNoise: 50 };

  test('the Detail group: neutral detection, reset and undo/redo', () => {
    expect(groupIsNeutral(neutralAdjustments(), 'detail')).toBe(true);
    expect(groupIsNeutral(normalizeAdjustments({ sharpening: 1 }), 'detail')).toBe(false);
    let state = readyState();
    state = editorReducer(state, { type: 'setAdjustment', key: 'clarity', value: 35 });
    state = editorReducer(state, { type: 'setAdjustment', key: 'contrast', value: 10 });
    expect(present(state)).toMatchObject({ clarity: 35, contrast: 10 });
    state = editorReducer(state, { type: 'resetGroup', group: 'detail' });
    expect(present(state)).toMatchObject({ clarity: 0, contrast: 10 });
    state = editorReducer(state, { type: 'undo' });
    expect(present(state).clarity).toBe(35);
    state = editorReducer(state, { type: 'redo' });
    expect(present(state).clarity).toBe(0);
  });

  test('documents save Detail values (version 5) and read them back; older documents get neutral Detail', () => {
    const text = serializeEditDocument(createEditDocument([{ name: 'a.jpg', size: 1, lastModified: 0, sha256: null, format: 'jpeg', width: 10, height: 10, adjustments: normalizeAdjustments(DETAIL) }], {}, new Date(0)));
    const saved = JSON.parse(text);
    expect(saved.version).toBe(5);
    expect(saved.photos[0].adjustments).toMatchObject(DETAIL);
    expect(parseEditDocument(text).photos[0].adjustments).toMatchObject(DETAIL);
    // Neutral Detail values are left out of the compact form.
    expect(Object.keys(compactAdjustments(normalizeAdjustments({ contrast: 5 })))).not.toContain('sharpening');
    const v4 = JSON.stringify({ type: DOCUMENT_TYPE, version: 4, photos: [{ source: { name: 'x.jpg', size: 1 }, adjustments: { contrast: 12 } }] });
    expect(parseEditDocument(v4).photos[0].adjustments).toMatchObject({ contrast: 12, texture: 0, clarity: 0, dehaze: 0, sharpening: 0, luminanceNoise: 0, colorNoise: 0 });
    const junk = JSON.stringify({ type: DOCUMENT_TYPE, version: 5, photos: [{ source: { name: 'x.jpg', size: 1 }, adjustments: { sharpening: 900, texture: '50', dehaze: -400 } }] });
    expect(parseEditDocument(junk).photos[0].adjustments).toMatchObject({ sharpening: 100, texture: 0, dehaze: -100 });
  });

  test('presets carry Detail as their own group; presets without it leave Detail alone', () => {
    expect(changedPresetGroups(normalizeAdjustments({ sharpening: 30 }))).toEqual(['detail']);
    const preset = createPreset('Crisp', { ...DETAIL, contrast: 10 }, ['detail']);
    expect(preset.settings).toEqual(DETAIL);
    const applied = applyPreset(normalizeAdjustments({ contrast: 20, sharpening: 90, texture: -50 }), createPreset('Only sharpening', { sharpening: 25 }, ['detail']));
    expect(applied).toMatchObject({ contrast: 20, sharpening: 25, texture: 0, clarity: 0 });
    const toneOnly = applyPreset(normalizeAdjustments({ sharpening: 60 }), BUILT_IN_PRESETS[0]);
    expect(toneOnly.sharpening).toBe(60);
    const [imported] = parsePresetFile(serializePresets([{ ...preset, settings: { ...preset.settings, colorNoise: 250, clarity: 'x' } }]));
    expect(imported.settings).toMatchObject({ colorNoise: 100, texture: 30 });
    expect(imported.settings.clarity).toBeUndefined();
  });
});
