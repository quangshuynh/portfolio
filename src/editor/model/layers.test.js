import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  LAYER_LIMITS, canAddLayer, compactLayers, createAdjustmentLayer, createImageLayer, duplicateLayer, insertLayer, layerAdjustments,
  layerSettingKeys, moveLayer, normalizeLayer, normalizeLayers, removeLayer, updateLayer, visibleLayers,
} from './layers.mjs';
import { compactAdjustments, normalizeAdjustments } from './adjustments.mjs';
import { DOCUMENT_VERSION, createEditDocument, parseEditDocument, serializeEditDocument } from './editDocument.mjs';
import { editorReducer, initialEditorState } from './editorState.mjs';
import { planSync, DEFAULT_SYNC_GROUPS } from './sync.mjs';
import { presetPatch, createPreset } from './presets.mjs';
import { deriveParams } from '../pipeline/spec.mjs';

const fixture = (name) => readFileSync(join(process.cwd(), 'src/editor/model/fixtures', name), 'utf8');
// How the version 8 editor (Interval 11.5, commit b1b204e) parsed each fixture's photos.
const parsedByV8 = JSON.parse(fixture('parsed-by-v8-editor.json'));
const source = { sha256: 'a'.repeat(64), name: 'over.jpg', size: 10, format: 'jpeg', width: 400, height: 300 };
const canvas = { width: 1200, height: 800 };

describe('migration of earlier documents', () => {
  test.each([6, 7, 8])('version %i documents open with every setting kept and text objects as text layers', (version) => {
    const document = parseEditDocument(fixture(`edits-v${version}.json`));
    expect(document.version).toBe(version);
    document.photos.forEach((photo, i) => {
      const before = parsedByV8[version][i];
      const { layers, local, watermark, retouch, ...rest } = photo.adjustments;
      const { overlays, ...expected } = before;
      expect(local).toEqual([]);
      expect(watermark).toBeNull();
      expect(retouch).toEqual([]);
      // Everything else (base photo settings, RAW, HDR tone, geometry, creative, filter, LUT) is unchanged;
      // RAW settings read with the legacy profile (document version 14).
      expect(rest).toEqual({ ...expected, raw: { ...expected.raw, profile: 'legacy' } });
      // Text objects become text layers: same ids, order (z-order), content and appearance.
      expect(layers.map(({ id }) => id)).toEqual(overlays.map(({ id }) => id));
      layers.forEach((layer, j) => {
        expect(layer).toMatchObject({ ...overlays[j], type: 'text', name: '', visible: true, locked: false, blend: 'normal', flipH: false, flipV: false });
      });
    });
  });

  test('sources are kept: names, hashes, the HDR inputs and their merge settings', () => {
    const document = parseEditDocument(fixture('edits-v8.json'));
    expect(document.photos.map(({ source: s }) => s.name)).toEqual(['IMG_0001.jpg', 'DSC09015.ARW', 'DSC09641-HDR', 'plain.png']);
    expect(document.photos[2].source.hdr.inputs.map(({ role }) => role)).toEqual(['under', 'normal', 'over']);
    expect(document.photos[1].adjustments.raw).toEqual({ whiteBalance: 'custom', profile: 'legacy' });
    expect(document.photos[0].adjustments.layers[0].text).toBe('Café Été\nLine two');
  });

  test('migration is deterministic and a resave is version 9 with the same stack', () => {
    const first = parseEditDocument(fixture('edits-v8.json'));
    const again = parseEditDocument(fixture('edits-v8.json'));
    expect(first).toEqual(again);
    const saved = JSON.parse(serializeEditDocument(createEditDocument(first.photos.map((p) => ({ ...p.source, adjustments: p.adjustments })), first.exportSettings)));
    expect(saved.version).toBe(DOCUMENT_VERSION);
    expect(saved.photos[0].adjustments.overlays).toBeUndefined();
    const reread = parseEditDocument(JSON.stringify(saved));
    expect(reread.photos.map((p) => p.adjustments)).toEqual(first.photos.map((p) => p.adjustments));
  });

  test('newer documents are refused rather than read without their layers', () => {
    const doc = JSON.parse(fixture('edits-v8.json'));
    doc.version = DOCUMENT_VERSION + 1;
    expect(() => parseEditDocument(JSON.stringify(doc))).toThrow(/version/);
  });
});

describe('layer records', () => {
  test('image layers keep a source reference, never pixels, and are clamped', () => {
    const layer = normalizeLayer({ id: 'img1', type: 'image', source: { ...source, data: [1, 2, 3] }, x: 9, width: 1e9, rotation: 540, opacity: 3, blend: 'plus-darker', pixels: 'x' });
    expect(layer).toMatchObject({ x: 2, width: LAYER_LIMITS.size[1], rotation: 180, opacity: 1, blend: 'normal', visible: true, locked: false });
    expect(layer.source).toEqual(source);
    expect(JSON.stringify(layer)).not.toMatch(/pixels|data/);
  });

  test('invalid layers are dropped: bad ids, types, sources, duplicate ids; limits per type and in total', () => {
    const list = normalizeLayers([
      { id: '../x', type: 'adjustment' },
      { id: 'a', type: 'vector' },
      { id: 'b', type: 'image', source: { ...source, sha256: 'nothex' } },
      { id: 'c', type: 'image', source: { ...source, format: 'tiff' } },
      { id: 'd', type: 'image', source: { ...source, width: 0 } },
      { id: 'e', type: 'adjustment' },
      { id: 'e', type: 'adjustment' },
      ...Array.from({ length: 20 }, (_, i) => ({ id: `img${i}`, type: 'image', source })),
      ...Array.from({ length: 50 }, (_, i) => ({ id: `t${i}`, type: 'text', text: 'x' })),
    ]);
    expect(list[0].id).toBe('e');
    expect(list.filter(({ type }) => type === 'image')).toHaveLength(LAYER_LIMITS.image);
    expect(list).toHaveLength(1 + LAYER_LIMITS.image + LAYER_LIMITS.text);
    const many = normalizeLayers([...Array.from({ length: 12 }, (_, i) => ({ id: `a${i}`, type: 'adjustment' })), ...Array.from({ length: 8 }, (_, i) => ({ id: `i${i}`, type: 'image', source })), ...Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, type: 'text' }))]);
    expect(many).toHaveLength(LAYER_LIMITS.layers);
    expect(normalizeLayers('nope')).toEqual([]);
    expect(normalizeLayers(Array.from({ length: 1e5 }, (_, i) => ({ id: `t${i}`, type: 'text' })))).toHaveLength(30);
  });

  test('names are plain, short text', () => {
    expect(normalizeLayer({ id: 'a', type: 'adjustment', name: ' Warm\u0000  ‮up ' }).name).toBe('Warm up');
    expect(normalizeLayer({ id: 'a', type: 'adjustment', name: 'x'.repeat(200) }).name).toHaveLength(LAYER_LIMITS.name);
  });

  test('settings hold only per-pixel colour controls; spatial and source controls are dropped', () => {
    const layer = createAdjustmentLayer('A', { exposure: 1, texture: 50, grainAmount: 30, vignetteAmount: -20, rawTemperature: 3000, bleachAmount: 20, gradeShadowsSat: 40, geometry: { angle: 4 } });
    expect(layer.settings).toMatchObject({ exposure: 1, bleachAmount: 20, gradeShadowsSat: 40 });
    ['texture', 'grainAmount', 'vignetteAmount', 'rawTemperature', 'geometry', 'layers'].forEach((key) => expect(layer.settings).not.toHaveProperty(key));
    const params = deriveParams(layerAdjustments(layer.settings));
    expect(params.spatialActive).toBe(false);
    expect(params.cpuOnly).toBeFalsy();
    // Every allowed key alone stays per pixel.
    layerSettingKeys().forEach((key) => expect(deriveParams(normalizeAdjustments({ [key]: 50 })).spatialActive).toBe(false));
    expect(compactLayers([layer])[0].settings).toEqual({ exposure: 1, bleachAmount: 20, gradeShadowsSat: 40 });
  });
});

describe('stack operations', () => {
  const base = () => normalizeLayers([
    createImageLayer('img', source, canvas),
    { id: 'txt', type: 'text', text: 'Hi' },
    createAdjustmentLayer('adj', { exposure: 1 }),
  ]);

  test('stable ids; insert, duplicate, move and remove', () => {
    let layers = base();
    layers = insertLayer(layers, createAdjustmentLayer('adj2'), 0);
    expect(layers.map(({ id }) => id)).toEqual(['img', 'adj2', 'txt', 'adj']);
    layers = duplicateLayer(layers, 'img', 'img-copy');
    expect(layers.map(({ id }) => id)).toEqual(['img', 'img-copy', 'adj2', 'txt', 'adj']);
    expect(layers[1].x).toBeCloseTo(layers[0].x + 0.03, 6);
    expect(layers[1].source).toEqual(layers[0].source);
    layers = moveLayer(layers, 'adj', 0);
    expect(layers[0].id).toBe('adj');
    layers = moveLayer(layers, 'adj', 99);
    expect(layers.at(-1).id).toBe('adj');
    layers = removeLayer(layers, 'img-copy');
    expect(layers.map(({ id }) => id)).toEqual(['img', 'adj2', 'txt', 'adj']);
    expect(insertLayer(layers, { id: 'img', type: 'adjustment' })).toBe(layers);
  });

  test('locked layers keep content, transform, opacity and blend; only visibility, lock and name change; not deletable', () => {
    let layers = updateLayer(base(), 'img', { locked: true });
    const before = layers[0];
    layers = updateLayer(layers, 'img', { x: 0.1, width: 2, opacity: 0.2, blend: 'multiply', settings: { exposure: 2 }, visible: false, name: 'Sky' });
    expect(layers[0]).toEqual({ ...before, visible: false, name: 'Sky' });
    expect(removeLayer(layers, 'img')).toHaveLength(3);
    const copy = duplicateLayer(layers, 'img', 'copy');
    expect(copy[1].locked).toBe(false);
  });

  test('visible layers: hidden, transparent, empty text and neutral adjustments draw nothing', () => {
    const layers = normalizeLayers([
      createImageLayer('a', source, canvas),
      { ...createImageLayer('b', source, canvas), visible: false },
      { ...createImageLayer('c', source, canvas), opacity: 0 },
      { id: 'd', type: 'text', text: '   ' },
      createAdjustmentLayer('e'),
      createAdjustmentLayer('f', { saturation: -100 }),
    ]);
    expect(visibleLayers(layers).map(({ id }) => id)).toEqual(['a', 'f']);
    expect(canAddLayer(layers, 'image')).toBe(true);
  });
});

describe('undo, presets and sync', () => {
  const ready = () => {
    let state = editorReducer(initialEditorState(), { type: 'photosAdded', photos: [{ id: 'p1', name: 'a.jpg', size: 1 }, { id: 'p2', name: 'b.jpg', size: 2 }] });
    state = editorReducer(state, { type: 'importSucceeded', id: 'p1', info: { format: 'jpeg', width: 1200, height: 800 } });
    return editorReducer(state, { type: 'importSucceeded', id: 'p2', info: { format: 'jpeg', width: 1200, height: 800 } });
  };
  const present = (state, id = 'p1') => state.photos.find((p) => p.id === id).history.present;

  test('every layer change is one bounded undo step of settings, never pixels', () => {
    let state = ready();
    const layers = normalizeLayers([createImageLayer('img', source, canvas), createAdjustmentLayer('adj', { exposure: 1 })]);
    state = editorReducer(state, { type: 'applySettings', patch: { layers } });
    state = editorReducer(state, { type: 'applySettings', patch: { layers: moveLayer(layers, 'adj', 0) } });
    state = editorReducer(state, { type: 'previewSettings', patch: { layers: updateLayer(present(state).layers, 'img', { opacity: 0.4 }) } });
    state = editorReducer(state, { type: 'previewSettings', patch: { layers: updateLayer(present(state).layers, 'img', { opacity: 0.3 }) } });
    state = editorReducer(state, { type: 'commitAdjustment' });
    expect(present(state).layers[1].opacity).toBe(0.3);
    state = editorReducer(state, { type: 'undo' });
    expect(present(state).layers[1].opacity).toBe(1);
    state = editorReducer(state, { type: 'undo' });
    expect(present(state).layers.map(({ id }) => id)).toEqual(['img', 'adj']);
    state = editorReducer(state, { type: 'redo' });
    expect(present(state).layers[0].id).toBe('adj');
    expect(JSON.stringify(state.photos[0].history).length).toBeLessThan(20_000);
  });

  test('with a layer id, the panels edit that layer\'s settings (and nothing else); locked layers refuse', () => {
    let state = ready();
    state = editorReducer(state, { type: 'applySettings', patch: { exposure: 0.5, layers: normalizeLayers([createAdjustmentLayer('adj')]) } });
    state = editorReducer(state, { type: 'setAdjustment', key: 'contrast', value: 40, layerId: 'adj' });
    state = editorReducer(state, { type: 'applySettings', patch: { curves: { master: [[0, 10], [255, 245]] }, texture: 80 }, layerId: 'adj' });
    expect(present(state)).toMatchObject({ exposure: 0.5, contrast: 0, texture: 0 });
    expect(present(state).layers[0].settings).toMatchObject({ contrast: 40, curves: { master: [[0, 10], [255, 245]] } });
    expect(present(state).layers[0].settings).not.toHaveProperty('texture');
    state = editorReducer(state, { type: 'resetAll', layerId: 'adj' });
    expect(present(state).layers[0].settings.contrast).toBe(0);
    expect(present(state).exposure).toBe(0.5);
    state = editorReducer(state, { type: 'applySettings', patch: { layers: updateLayer(present(state).layers, 'adj', { locked: true }) } });
    const locked = present(state);
    state = editorReducer(state, { type: 'setAdjustment', key: 'exposure', value: 2, layerId: 'adj' });
    expect(present(state)).toBe(locked);
  });

  test('presets never carry layers; Sync copies the stack only when Layers is ticked; paste never', () => {
    const values = normalizeAdjustments({ exposure: 1, layers: [createImageLayer('img', source, canvas)] });
    const preset = createPreset('p', values, ['light', 'color', 'creative']);
    expect(preset.settings.layers).toBeUndefined();
    expect(presetPatch(preset).layers).toBeUndefined();
    const target = { id: 't', name: 't.jpg', status: 'ready', width: 10, height: 10, history: { present: normalizeAdjustments({}) } };
    expect(planSync(values, [target], { groups: DEFAULT_SYNC_GROUPS }).items[0].after.layers).toEqual([]);
    expect(planSync(values, [target], { groups: [...DEFAULT_SYNC_GROUPS, 'layers'] }).items[0].after.layers[0].id).toBe('img');
    expect(compactAdjustments(values).layers[0].source).toEqual(source);
  });
});
