import { ADJUSTMENTS, clampAdjustment, formatAdjustment, neutralAdjustments, normalizeAdjustments } from './adjustments.mjs';
import * as history from './history.mjs';
import { editorReducer, initialEditorState } from './editorState.mjs';
import {
  DOCUMENT_TYPE,
  DOCUMENT_VERSION,
  EditDocumentError,
  createEditDocument,
  normalizeExportSettings,
  parseEditDocument,
  serializeEditDocument,
} from './editDocument.mjs';

const neutral = neutralAdjustments();
const withValue = (key, value) => ({ ...neutral, [key]: value });

describe('adjustment registry', () => {
  test('every relative control has a range around a neutral zero default', () => {
    ADJUSTMENTS.filter(({ signed }) => signed).forEach(({ min, max, step, default: value }) => {
      expect(min).toBeLessThan(0);
      expect(max).toBeGreaterThan(0);
      expect(step).toBeGreaterThan(0);
      expect(value).toBe(0);
    });
  });

  test('the unsigned controls are the Detail amounts, RAW temperature in kelvin, the HDR tone amounts and LUT intensity, a 0–100% amount that defaults to full', () => {
    // Creative controls are checked in creative.test.js: amounts, hues, radii and the like.
    expect(ADJUSTMENTS.filter(({ signed, group }) => !signed && group !== 'creative')).toEqual([
      expect.objectContaining({ key: 'sharpening', group: 'detail', min: 0, max: 100, default: 0 }),
      expect.objectContaining({ key: 'luminanceNoise', group: 'detail', min: 0, max: 100, default: 0 }),
      expect.objectContaining({ key: 'colorNoise', group: 'detail', min: 0, max: 100, default: 0 }),
      expect.objectContaining({ key: 'rawTemperature', unit: 'K', default: 5500 }),
      expect.objectContaining({ key: 'hdrHighlights', group: 'hdr', min: 0, max: 100, default: 50 }),
      expect.objectContaining({ key: 'hdrShadows', group: 'hdr', min: 0, max: 100, default: 0 }),
      expect.objectContaining({ key: 'lutIntensity', min: 0, max: 100, default: 100 }),
    ]);
  });

  test('clamps to range and step, rejecting non-numbers', () => {
    expect(clampAdjustment('exposure', 9)).toBe(5);
    expect(clampAdjustment('exposure', -0.123)).toBe(-0.1);
    expect(clampAdjustment('exposure', 0.15)).toBe(0.15);
    expect(clampAdjustment('contrast', '42.4')).toBe(42);
    expect(clampAdjustment('contrast', 'abc')).toBe(0);
    expect(Object.is(clampAdjustment('contrast', -0.2), 0)).toBe(true);
    expect(() => clampAdjustment('sharpen', 1)).toThrow();
  });

  test('normalises partial input and drops unknown keys', () => {
    expect(normalizeAdjustments({ contrast: 500, sharpen: 3 })).toEqual({ ...neutral, contrast: 100 });
  });

  test('formats signed values with units', () => {
    expect(formatAdjustment('exposure', 0.5)).toBe('+0.50 EV');
    expect(formatAdjustment('contrast', -12)).toBe('-12');
    expect(formatAdjustment('contrast', 0)).toBe('0');
  });
});

describe('history', () => {
  test('a slider drag records one entry however many previews it makes', () => {
    let h = history.createHistory(neutral);
    for (let value = 1; value <= 300; value += 1) h = history.preview(h, withValue('contrast', (value % 99) + 1));
    h = history.commit(h);
    expect(h.past).toEqual([neutral]);
    expect(history.undo(h).present).toEqual(neutral);
  });

  test('a drag that returns to its start records nothing', () => {
    let h = history.preview(history.createHistory(neutral), withValue('contrast', 5));
    h = history.commit(history.preview(h, neutral));
    expect(h.past).toHaveLength(0);
  });

  test('keyboard steps on one control coalesce within the window', () => {
    let h = history.createHistory(neutral);
    h = history.apply(h, withValue('shadows', 1), { coalesceKey: 'shadows', now: 0 });
    h = history.apply(h, withValue('shadows', 2), { coalesceKey: 'shadows', now: 500 });
    h = history.apply(h, withValue('shadows', 3), { coalesceKey: 'shadows', now: 900 });
    expect(h.past).toHaveLength(1);
    h = history.apply(h, withValue('shadows', 4), { coalesceKey: 'shadows', now: 5000 });
    expect(h.past).toHaveLength(2);
    h = history.apply(h, { ...h.present, blacks: 1 }, { coalesceKey: 'blacks', now: 5100 });
    expect(h.past).toHaveLength(3);
  });

  test('undo and redo walk the snapshots; a new change clears redo', () => {
    let h = history.createHistory(neutral);
    h = history.apply(h, withValue('exposure', 1));
    h = history.apply(h, withValue('exposure', 2));
    h = history.undo(history.undo(h));
    expect(h.present).toEqual(neutral);
    expect(history.canUndo(h)).toBe(false);
    h = history.redo(h);
    expect(h.present.exposure).toBe(1);
    h = history.apply(h, withValue('tint', 3));
    expect(history.canRedo(h)).toBe(false);
  });

  test('is bounded', () => {
    let h = history.createHistory(neutral);
    for (let i = 1; i <= history.HISTORY_LIMIT + 50; i += 1) h = history.apply(h, withValue('contrast', (i % 200) - 100 || 1));
    expect(h.past).toHaveLength(history.HISTORY_LIMIT);
  });
});

describe('editor state', () => {
  const file = (id, extra = {}) => ({ id, name: `${id}.jpg`, size: 100, lastModified: 1, ...extra });
  const ready = (state, id, sha256 = id.padEnd(64, '0')) => editorReducer(state, {
    type: 'importSucceeded', id, info: { format: 'jpeg', width: 40, height: 30, orientation: 1, sha256 },
  });

  function twoPhotos() {
    let state = editorReducer(initialEditorState(), { type: 'photosAdded', photos: [file('a'), file('b')] });
    state = ready(ready(state, 'a'), 'b');
    return state;
  }

  test('each photo keeps independent adjustments and history across switching', () => {
    let state = twoPhotos();
    expect(state.activeId).toBe('a');
    state = editorReducer(state, { type: 'setAdjustment', key: 'exposure', value: 1 });
    state = editorReducer(state, { type: 'select', id: 'b' });
    state = editorReducer(state, { type: 'setAdjustment', key: 'contrast', value: 40 });
    state = editorReducer(state, { type: 'selectOffset', offset: -1 });
    const [a, b] = state.photos;
    expect(a.history.present).toEqual(withValue('exposure', 1));
    expect(b.history.present).toEqual(withValue('contrast', 40));
    state = editorReducer(state, { type: 'undo' });
    expect(state.photos[0].history.present).toEqual(neutral);
    expect(state.photos[1].history.present).toEqual(withValue('contrast', 40));
  });

  test('preview then commit records a single undo step', () => {
    let state = twoPhotos();
    [10, 20, 30].forEach((value) => { state = editorReducer(state, { type: 'previewAdjustment', key: 'shadows', value }); });
    state = editorReducer(state, { type: 'commitAdjustment' });
    expect(state.photos[0].history.past).toHaveLength(1);
  });

  test('reset one and reset all are undoable', () => {
    let state = twoPhotos();
    state = editorReducer(state, { type: 'setAdjustment', key: 'tint', value: 20 });
    state = editorReducer(state, { type: 'setAdjustment', key: 'vibrance', value: 30 });
    state = editorReducer(state, { type: 'resetAdjustment', key: 'tint' });
    expect(state.photos[0].history.present).toEqual(withValue('vibrance', 30));
    state = editorReducer(state, { type: 'resetAll' });
    expect(state.photos[0].history.present).toEqual(neutral);
    state = editorReducer(state, { type: 'undo' });
    expect(state.photos[0].history.present.vibrance).toBe(30);
  });

  test('removing the active photo selects a neighbour', () => {
    let state = twoPhotos();
    state = editorReducer(state, { type: 'remove', id: 'a' });
    expect(state.activeId).toBe('b');
    state = editorReducer(state, { type: 'remove', id: 'b' });
    expect(state.activeId).toBeNull();
  });

  test('ignores edits to photos that failed or are still importing', () => {
    let state = editorReducer(initialEditorState(), { type: 'photosAdded', photos: [file('a')] });
    state = editorReducer(state, { type: 'setAdjustment', key: 'exposure', value: 1 });
    expect(state.photos[0].history.present).toEqual(neutral);
    state = editorReducer(state, { type: 'importFailed', id: 'a', error: 'Damaged' });
    expect(state.photos[0]).toMatchObject({ status: 'error', error: 'Damaged' });
  });

  test('a loaded document applies to matching photos and waits for the rest', () => {
    let state = twoPhotos();
    const document = parseEditDocument(serializeEditDocument(createEditDocument([
      { ...state.photos[1], adjustments: withValue('saturation', -20) },
      { name: 'c.jpg', size: 5, sha256: 'c'.repeat(64), format: 'png', width: 1, height: 1, adjustments: withValue('blacks', 9) },
    ], { format: 'webp' })));
    state = editorReducer(state, { type: 'loadDocument', document });
    expect(state.photos[1].history.present).toEqual(withValue('saturation', -20));
    expect(state.exportSettings.format).toBe('webp');
    expect(state.pendingEdits).toHaveLength(1);
    // Reimporting the missing file picks up its saved edits.
    state = editorReducer(state, { type: 'photosAdded', photos: [file('c', { size: 5 })] });
    state = ready(state, 'c', 'c'.repeat(64));
    expect(state.photos[2]).toMatchObject({ restored: true });
    expect(state.photos[2].history.present).toEqual(withValue('blacks', 9));
    expect(state.pendingEdits).toHaveLength(0);
  });
});

describe('edit document', () => {
  const photo = { name: 'DSC0001.jpg', size: 1234, lastModified: 99, sha256: 'ab'.repeat(32), format: 'jpeg', width: 6000, height: 4000, orientation: 6, adjustments: withValue('exposure', 0.5) };

  test('round-trips adjustments and export settings', () => {
    const text = serializeEditDocument(createEditDocument([photo], { format: 'png', suffix: '-v2' }, new Date(0)));
    const parsed = parseEditDocument(text);
    expect(JSON.parse(text)).toMatchObject({ type: DOCUMENT_TYPE, version: DOCUMENT_VERSION, savedAt: '1970-01-01T00:00:00.000Z' });
    expect(parsed.photos[0].adjustments).toEqual(normalizeAdjustments(photo.adjustments));
    expect(parsed.photos[0].source).toMatchObject({ name: 'DSC0001.jpg', size: 1234, sha256: photo.sha256 });
    expect(parsed.exportSettings).toMatchObject({ format: 'png', suffix: '-v2' });
  });

  test('export settings default to the -quangedit suffix; the old default is migrated, custom ones kept', () => {
    expect(normalizeExportSettings({}).suffix).toBe('-quangedit');
    expect(normalizeExportSettings({ suffix: '-edited' }).suffix).toBe('-quangedit');
    expect(normalizeExportSettings({ suffix: '-print' }).suffix).toBe('-print');
    expect(normalizeExportSettings({ suffix: '' }).suffix).toBe('');
  });

  test('never stores pixels or object URLs', () => {
    const text = serializeEditDocument(createEditDocument([{ ...photo, file: {}, thumbnailUrl: 'blob:x' }]));
    expect(text).not.toMatch(/blob:|data:|thumbnail|file"/);
  });

  test('rejects malformed, foreign, future and oversized files', () => {
    const bad = (text) => expect(() => parseEditDocument(text)).toThrow(EditDocumentError);
    bad('{');
    bad('[]');
    bad(JSON.stringify({ type: 'other', version: 1, photos: [] }));
    bad(JSON.stringify({ type: DOCUMENT_TYPE, version: DOCUMENT_VERSION + 1, photos: [] }));
    bad(JSON.stringify({ type: DOCUMENT_TYPE, version: 1 }));
    bad(JSON.stringify({ type: DOCUMENT_TYPE, version: 1, photos: [{ source: {} }] }));
    bad(' '.repeat(4 * 1024 * 1024 + 1));
  });

  test('clamps values, ignores unknown fields and treats code-like strings as data', () => {
    const parsed = parseEditDocument(JSON.stringify({
      type: DOCUMENT_TYPE,
      version: 1,
      exportSettings: { format: 'gif', quality: 7, suffix: '../../<script>', resize: { mode: 'huge', longEdge: -1 } },
      photos: [{
        source: { name: 'x.png', size: 3, sha256: 'not-a-hash' },
        adjustments: { exposure: 99, contrast: '() => alert(1)', __proto__: { polluted: true }, unknown: 1 },
      }],
    }));
    expect(parsed.photos[0].adjustments).toEqual(withValue('exposure', 5));
    expect(parsed.photos[0].source.sha256).toBeNull();
    expect(parsed.exportSettings).toMatchObject({ format: 'jpeg', quality: 1, suffix: 'script', resize: { mode: 'original', longEdge: 3840 } });
    expect({}.polluted).toBeUndefined();
  });
});
