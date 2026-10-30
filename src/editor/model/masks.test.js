import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  MASK_LIMITS, addComponent, appendStroke, createBrush, createLinear, createLocalAdjustment, createMask, createRadial, duplicateComponent,
  gradientLocals, linearCentre, linearFromCentre, maskActive, maskPoints, normalizeLocalAdjustments, normalizeMask, removeComponent, updateComponent, visibleLocals,
} from './masks.mjs';
import { compactAdjustments, groupIsNeutral, isNeutral, neutralGroup, normalizeAdjustments } from './adjustments.mjs';
import { DOCUMENT_VERSION, createEditDocument, parseEditDocument, serializeEditDocument } from './editDocument.mjs';
import { createAdjustmentLayer, duplicateLayer, normalizeLayer, updateLayer } from './layers.mjs';
import { createPreset, presetPatch } from './presets.mjs';
import { DEFAULT_SYNC_GROUPS, planSync } from './sync.mjs';
import { editorReducer, initialEditorState } from './editorState.mjs';

const fixture = (name) => readFileSync(join(process.cwd(), 'src/editor/model/fixtures', name), 'utf8');
const stroke = (points, patch = {}) => ({ mode: 'add', radius: 0.05, hardness: 0.5, opacity: 1, points, ...patch });
const brushLocal = (id = 'L1') => createLocalAdjustment(id, {
  name: 'Subject',
  settings: { exposure: 0.5, clarity: 20 },
  mask: { components: [createBrush('b1', { strokes: [stroke([[0.1, 0.2], [0.3, 0.4, 0.5]])] }), createRadial('r1', { op: 'subtract' })] },
});
const skyLocal = () => createLocalAdjustment('L2', { settings: { exposure: -1, saturation: 10 }, mask: { components: [createLinear('g1')] } });

describe('mask definitions', () => {
  test('masks take their owner\'s space and keep only valid, unique components', () => {
    const m = normalizeMask({
      space: 'canvas',
      base: 'all',
      invert: 1,
      opacity: 7,
      components: [createLinear('a'), { id: 'a', type: 'radial' }, { id: 'bad id', type: 'linear' }, { id: 'x', type: 'lasso' }, null, { id: 'r', type: 'radial', rx: -4, feather: 3, rotation: 270 }],
    }, 'image');
    expect(m.space).toBe('image');
    expect(m.base).toBe('all');
    expect(m.invert).toBe(false);
    expect(m.opacity).toBe(1);
    expect(m.components.map(({ id }) => id)).toEqual(['a', 'r']);
    expect(m.components[1]).toMatchObject({ rx: MASK_LIMITS.radius[0], feather: 1, rotation: -90 });
  });

  test('imported coordinates are clamped and non-numbers fall back', () => {
    const c = normalizeMask({ components: [{ id: 'g', type: 'linear', x0: 'x', y0: 1e9, x1: -1e9, y1: Number.NaN }] }, 'canvas').components[0];
    expect(c).toMatchObject({ x0: 0.5, y0: MASK_LIMITS.position[1], x1: MASK_LIMITS.position[0], y1: 0.6 });
    const s = normalizeMask({ components: [{ id: 'b', type: 'brush', strokes: [{ points: [[0.1, 0.1, 9], ['a', 1], [0.2]], radius: 99, hardness: -1, mode: 'paint' }, { points: [] }, 'x'] }] }, 'canvas').components[0];
    expect(s.strokes).toEqual([{ mode: 'add', radius: MASK_LIMITS.radius[1], hardness: 0, opacity: 1, points: [[0.1, 0.1, 1]] }]);
  });

  test('component, stroke and point limits hold; the point budget is shared by the whole photo', () => {
    const many = Array.from({ length: 40 }, (_, i) => createLinear(`c${i}`));
    expect(normalizeMask({ components: many }, 'canvas').components).toHaveLength(MASK_LIMITS.components);
    const long = stroke(Array.from({ length: MASK_LIMITS.strokePoints + 50 }, (_, i) => [i / 1e4, 0.5]));
    expect(normalizeMask({ components: [{ id: 'b', type: 'brush', strokes: [long] }] }, 'canvas').components[0].strokes[0].points).toHaveLength(MASK_LIMITS.strokePoints);
    const pointsEach = 1500;
    const big = (id) => ({ id, type: 'brush', strokes: Array.from({ length: 10 }, () => stroke(Array.from({ length: pointsEach }, (_, i) => [i / pointsEach, 0.5]))) });
    const locals = Array.from({ length: 3 }, (_, i) => createLocalAdjustment(`L${i}`, { settings: { exposure: 1 }, mask: { components: [big(`b${i}`)] } }));
    const layer = { ...createAdjustmentLayer('A', { exposure: 1 }), mask: { components: [big('lb')] } };
    const a = normalizeAdjustments({ local: locals, layers: [layer] });
    const total = a.local.reduce((sum, l) => sum + maskPoints(l.mask), 0) + maskPoints(a.layers[0].mask);
    expect(total).toBe(MASK_LIMITS.photoPoints);
    // Local adjustments come first: the third is cut short and the layer mask gets no points.
    expect(maskPoints(a.local[2].mask)).toBe(MASK_LIMITS.photoPoints - 2 * 10 * pointsEach);
    expect(maskPoints(a.layers[0].mask)).toBe(0);
  });

  test('normalising again shares stroke data (undo steps do not copy strokes)', () => {
    const a = normalizeAdjustments({ local: [brushLocal()] });
    const b = normalizeAdjustments({ ...a });
    expect(b.local[0].mask.components[0].strokes[0]).toBe(a.local[0].mask.components[0].strokes[0]);
    expect(Object.isFrozen(a.local[0].mask.components[0].strokes[0])).toBe(true);
  });

  test('editing helpers: add, update, duplicate, remove, append and clear', () => {
    let m = createMask('image');
    m = addComponent(m, createBrush('b'));
    m = appendStroke(m, 'b', stroke([[0.5, 0.5]]));
    m = addComponent(m, createRadial('r', { x: 0.3 }));
    m = updateComponent(m, 'r', { invert: true, type: 'linear', id: 'zzz' });
    expect(m.components[1]).toMatchObject({ id: 'r', type: 'radial', invert: true });
    m = duplicateComponent(m, 'r', 'r2');
    expect(m.components.map(({ id }) => id)).toEqual(['b', 'r', 'r2']);
    expect(m.components[2].x).toBeCloseTo(0.33);
    m = removeComponent(m, 'r');
    expect(m.components.map(({ id }) => id)).toEqual(['b', 'r2']);
    expect(maskPoints(m)).toBe(1);
  });

  test('linear centre/angle conversion round-trips', () => {
    const space = { width: 600, height: 400 };
    const g = createLinear('g', linearFromCentre({ cx: 300, cy: 120, angle: 30, length: 200 }, space));
    const back = linearCentre(g, space);
    expect(back.cx).toBeCloseTo(300, 2);
    expect(back.cy).toBeCloseTo(120, 2);
    expect(back.angle).toBeCloseTo(30, 1);
    expect(back.length).toBeCloseTo(200, 1);
  });

  test('which masks and local adjustments act', () => {
    expect(maskActive(createMask('canvas'))).toBe(false);
    expect(maskActive({ ...createMask('canvas'), invert: true })).toBe(true);
    expect(maskActive(addComponent(createMask('canvas'), createRadial('r')))).toBe(true);
    expect(maskActive({ ...addComponent(createMask('canvas'), createRadial('r')), enabled: false })).toBe(false);
    const locals = [skyLocal(), createLocalAdjustment('L3', { settings: { exposure: 1 } }), { ...skyLocal(), id: 'L4', enabled: false }, createLocalAdjustment('L5', { mask: { components: [createRadial('r')] } })];
    expect(visibleLocals(locals).map(({ id }) => id)).toEqual(['L2']);
  });
});

describe('settings, documents and history', () => {
  test('local adjustments are part of the settings: neutral, compact form, equality', () => {
    const a = normalizeAdjustments({ local: [skyLocal()] });
    expect(groupIsNeutral(a, 'masks')).toBe(false);
    expect(isNeutral(a)).toBe(false);
    expect(normalizeAdjustments({ ...a, ...neutralGroup('masks') }).local).toEqual([]);
    expect(compactAdjustments(a).local).toEqual(a.local);
    expect(compactAdjustments(normalizeAdjustments({})).local).toBeUndefined();
    expect(a.local[0].settings).toEqual({ exposure: -1, saturation: 10 });
    expect(normalizeLocalAdjustments([{ id: 'x', settings: { exposure: 0, geometry: 1, sharpening: 30, rawTemperature: 4000, lutIntensity: 50 } }])[0].settings).toEqual({ sharpening: 30 });
  });

  test('version 9 documents open unchanged, with no masks', () => {
    const document = parseEditDocument(fixture('edits-v9.json'));
    const before = JSON.parse(fixture('parsed-by-v9-editor.json'));
    expect(document.version).toBe(9);
    document.photos.forEach((photo, i) => {
      const { local, watermark, retouch, ...rest } = photo.adjustments;
      expect(local).toEqual([]);
      expect(watermark).toBeNull();
      expect(retouch).toEqual([]);
      expect(rest).toEqual(before[i]);
      photo.adjustments.layers.forEach((layer) => expect(layer).not.toHaveProperty('mask'));
    });
  });

  test('masks, strokes, gradients, local settings and layer masks survive saving and reopening', () => {
    const imageLayer = normalizeLayer({
      id: 'img',
      type: 'image',
      source: { sha256: 'e'.repeat(64), name: 'o.png', size: 1, format: 'png', width: 10, height: 10 },
      mask: { space: 'canvas', base: 'all', components: [createBrush('lb', { op: 'subtract', strokes: [stroke([[0.5, 0.5]], { mode: 'erase' })] })] },
    });
    expect(imageLayer.mask.space).toBe('layer');
    const adjustments = normalizeAdjustments({ local: [brushLocal(), skyLocal()], layers: [imageLayer, { ...createAdjustmentLayer('adj', { contrast: 30 }), mask: { invert: true, components: [createRadial('r')] } }] });
    const photo = { name: 'a.jpg', size: 10, lastModified: 1, sha256: null, format: 'jpeg', width: 300, height: 200, orientation: 1, adjustments };
    const text = serializeEditDocument(createEditDocument([photo], {}, new Date(0)));
    const parsed = parseEditDocument(text);
    expect(parsed.version).toBe(DOCUMENT_VERSION);
    expect(DOCUMENT_VERSION).toBeGreaterThanOrEqual(10);
    expect(parsed.photos[0].adjustments).toEqual(adjustments);
    // Masks are geometry and paths, never pixels.
    expect(text).not.toMatch(/data:|base64/);
  });

  test('invalid imported masks are dropped or repaired, never trusted', () => {
    const doc = JSON.stringify({ type: 'quanghuynh.photo-editor.edits', version: 10, photos: [{ source: { name: 'x.jpg', size: 3 }, adjustments: { local: [{ id: 'ok', mask: { space: 'layer', components: [{ id: 'g', type: 'linear', x0: 'NaN' }, { id: 'h', type: '__proto__' }] }, settings: { exposure: 99 } }, { id: '../../x' }, 'junk'], layers: [{ ...createAdjustmentLayer('A'), mask: 'not a mask' }] } }] });
    const { adjustments } = parseEditDocument(doc).photos[0];
    expect(adjustments.local).toHaveLength(1);
    expect(adjustments.local[0].mask.space).toBe('image');
    expect(adjustments.local[0].mask.components.map(({ id }) => id)).toEqual(['g']);
    expect(adjustments.local[0].settings.exposure).toBe(5);
    expect(adjustments.layers[0]).not.toHaveProperty('mask');
  });

  test('layer masks: locked layers keep theirs, removing sets none, duplicates copy them', () => {
    const layer = { ...createAdjustmentLayer('A', { exposure: 1 }), mask: createMask('canvas') };
    let layers = [normalizeLayer(layer)];
    expect(layers[0].mask.space).toBe('canvas');
    layers = updateLayer(layers, 'A', { mask: null });
    expect(layers[0]).not.toHaveProperty('mask');
    layers = updateLayer(layers, 'A', { mask: createMask('canvas'), locked: true });
    expect(updateLayer(layers, 'A', { mask: null })[0].mask).toBeTruthy();
    expect(duplicateLayer(updateLayer(layers, 'A', { locked: false }), 'A', 'B')[1].mask).toEqual(layers[0].mask);
  });

  test('undo and redo restore local adjustments; panel edits retarget a local adjustment', () => {
    let state = editorReducer(initialEditorState(), { type: 'photosAdded', photos: [{ id: 'p', name: 'p.jpg' }] });
    state = editorReducer(state, { type: 'importSucceeded', id: 'p', photo: { width: 100, height: 100 } });
    const present = () => state.photos[0].history.present;
    state = editorReducer(state, { type: 'applySettings', patch: { local: [skyLocal()] } });
    state = editorReducer(state, { type: 'setAdjustment', key: 'exposure', value: -2, localId: 'L2' });
    expect(present().exposure).toBe(0);
    expect(present().local[0].settings.exposure).toBe(-2);
    state = editorReducer(state, { type: 'resetGroup', group: 'light', localId: 'L2' });
    expect(present().local[0].settings).toEqual({ saturation: 10 });
    state = editorReducer(state, { type: 'undo' });
    expect(present().local[0].settings.exposure).toBe(-2);
    state = editorReducer(state, { type: 'undo' });
    state = editorReducer(state, { type: 'undo' });
    expect(present().local).toEqual([]);
    state = editorReducer(state, { type: 'redo' });
    expect(present().local).toHaveLength(1);
  });
});

describe('presets and batch edits', () => {
  test('presets never carry masks or local adjustments', () => {
    const a = normalizeAdjustments({ exposure: 1, local: [skyLocal()] });
    const preset = createPreset('Look', a, ['exposure', 'tone', 'hsl', 'detail', 'creative']);
    expect(JSON.stringify(preset)).not.toContain('local');
    expect(presetPatch(preset)).not.toHaveProperty('local');
  });

  test('sync copies local gradients only when chosen, and never brush strokes', () => {
    const source = normalizeAdjustments({ local: [brushLocal(), skyLocal(), createLocalAdjustment('L9', { settings: { exposure: 1 }, mask: { components: [createBrush('only', { strokes: [stroke([[0.5, 0.5]])] })] } })] });
    const target = { id: 't', name: 't', status: 'ready', history: { present: normalizeAdjustments({}) } };
    expect(DEFAULT_SYNC_GROUPS).not.toContain('localGradients');
    expect(planSync(source, [target]).items[0].after.local).toEqual([]);
    const { after, changed } = planSync(source, [target], { groups: ['localGradients'] }).items[0];
    expect(changed).toEqual(['localGradients']);
    expect(after.local.map(({ id }) => id)).toEqual(['L1', 'L2']);
    expect(after.local.flatMap(({ mask }) => mask.components.map(({ type }) => type))).toEqual(['radial', 'linear']);
    expect(gradientLocals(source.local)).toEqual(after.local);
  });
});
