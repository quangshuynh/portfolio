import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { LAYER_LIMITS, createAdjustmentLayer, createGroupLayer, normalizeLayers, repairLayerTree, visibleLayers } from './layers.mjs';
import {
  adjustmentScope, ancestors, canClip, canClipAbove, canMoveUnit, clipBase, clippedTo, descendantIds, drawnLayers, dropUnit, duplicateUnit, groupTargets, groupUnits, layerProgram,
  insertAbove, moveIntoGroup, moveUnit, programDepth, removeBlocked, removeUnit, setClip, ungroup,
} from './layerTree.mjs';
import { compactAdjustments, normalizeAdjustments } from './adjustments.mjs';
import { DOCUMENT_VERSION, createEditDocument, parseEditDocument, serializeEditDocument } from './editDocument.mjs';
import { editorReducer, initialEditorState } from './editorState.mjs';
import { createLinear, createMask, createSelection } from './masks.mjs';

const fixture = (name) => readFileSync(join(process.cwd(), 'src/editor/model/fixtures', name), 'utf8');
const source = { sha256: 'a'.repeat(64), name: 'over.jpg', size: 10, format: 'jpeg', width: 400, height: 300 };
const image = (id, patch = {}) => ({ id, type: 'image', source, ...patch });
const adjust = (id, patch = {}) => ({ id, type: 'adjustment', settings: { exposure: 0.5 }, ...patch });
const group = (id, patch = {}) => ({ id, type: 'group', ...patch });
const ids = (layers) => layers.map(({ id }) => id);
const norm = (list) => normalizeLayers(list);

describe('version 16 documents', () => {
  // Written by the version 16 editor (main at 298d719, Interval 23.5): see the fixture's generator in docs/photography-editor.md.
  const parsedByV16 = JSON.parse(fixture('parsed-by-v16-editor.json'));

  test('open with every layer, mask, selection and setting exactly as the version 16 editor read them', () => {
    const document = parseEditDocument(fixture('edits-v16.json'));
    expect(document.version).toBe(16);
    expect(document.photos.map((p) => p.adjustments)).toEqual(parsedByV16);
    // No layer gains a tree key: they render through the same passes in the same order.
    document.photos[0].adjustments.layers.forEach((layer) => { expect(layer).not.toHaveProperty('parent'); expect(layer).not.toHaveProperty('clip'); });
    const { layers } = document.photos[0].adjustments;
    expect(drawnLayers(layers)).toEqual(visibleLayers(layers));
    expect(layerProgram(layers).every(({ op, clip }) => op === 'layer' && clip === false)).toBe(true);
  });

  test('a resave is the current version and reads back the same', () => {
    const first = parseEditDocument(fixture('edits-v16.json'));
    const saved = JSON.parse(serializeEditDocument(createEditDocument(first.photos.map((p) => ({ ...p.source, adjustments: p.adjustments })), first.exportSettings)));
    expect(saved.version).toBe(DOCUMENT_VERSION);
    expect(DOCUMENT_VERSION).toBe(19);
    expect(parseEditDocument(JSON.stringify(saved)).photos.map((p) => p.adjustments)).toEqual(first.photos.map((p) => p.adjustments));
  });
});

describe('tree normalisation', () => {
  test('groups, parents and clips round-trip through a document', () => {
    const layers = norm([image('a'), image('b', { parent: 'g', clip: false }), adjust('c', { parent: 'g', clip: true }), group('g', { blend: 'multiply', opacity: 0.6 }), image('d')]);
    expect(ids(layers)).toEqual(['a', 'b', 'c', 'g', 'd']);
    expect(layers[2]).toMatchObject({ parent: 'g', clip: true });
    expect(layers[3]).toMatchObject({ type: 'group', blend: 'multiply', opacity: 0.6, visible: true, locked: false });
    const adjustments = normalizeAdjustments({ layers });
    const doc = createEditDocument([{ name: 'x.jpg', size: 1, sha256: 'f'.repeat(64), format: 'jpeg', width: 10, height: 10, adjustments }], {});
    expect(parseEditDocument(serializeEditDocument(doc)).photos[0].adjustments.layers).toEqual(layers);
    expect(compactAdjustments(adjustments).layers[1]).not.toHaveProperty('clip');
  });

  test('a new group is pass-through; unknown modes fall back to it', () => {
    expect(createGroupLayer('g').blend).toBe('pass-through');
    expect(norm([group('g', { blend: 'nonsense' })])[0].blend).toBe('pass-through');
    // Only groups may pass through.
    expect(norm([image('a', { blend: 'pass-through' })])[0].blend).toBe('normal');
  });

  test('missing, non-group, self and circular parents are removed without dropping layers', () => {
    const layers = norm([image('a', { parent: 'nope' }), image('b', { parent: 'a' }), group('g1', { parent: 'g2' }), group('g2', { parent: 'g1' }), image('c', { parent: 'c' })]);
    expect(ids(layers).sort()).toEqual(['a', 'b', 'c', 'g1', 'g2']);
    expect(layers.find(({ id }) => id === 'a')).not.toHaveProperty('parent');
    expect(layers.find(({ id }) => id === 'b')).not.toHaveProperty('parent');
    expect(layers.find(({ id }) => id === 'c')).not.toHaveProperty('parent');
    // Circular groups lose the parents that close the loop; the walk always ends.
    expect(layers.filter(({ id, parent }) => id.startsWith('g') && parent).length).toBeLessThanOrEqual(1);
    expect(repairLayerTree(layers)).toBe(layers);
  });

  test('children are gathered directly below their group, which stays where its entry was', () => {
    const layers = norm([image('x', { parent: 'g' }), image('top'), group('g'), image('y', { parent: 'g' })]);
    expect(ids(layers)).toEqual(['top', 'x', 'y', 'g']);
    expect(repairLayerTree(layers)).toBe(layers);
  });

  test('groups nest at most LAYER_LIMITS.depth deep', () => {
    const deep = norm([image('leaf', { parent: 'g4' }), group('g4', { parent: 'g3' }), group('g3', { parent: 'g2' }), group('g2', { parent: 'g1' }), group('g1')]);
    const depthOf = (id) => ancestors(deep, id).length;
    expect(Math.max(...deep.filter(({ type }) => type === 'group').map(({ id }) => depthOf(id)))).toBe(LAYER_LIMITS.depth - 1);
    expect(deep).toHaveLength(5);
  });

  test('clips need an unclipped image, text or group sibling below; adjustment bases and groups are refused', () => {
    const layers = norm([image('first', { clip: true }), adjust('adj'), image('onAdj', { clip: true }), image('base'), image('c1', { clip: true }), adjust('c2', { clip: true }), group('g', { clip: true }), image('in', { parent: 'g', clip: true })]);
    const byId = Object.fromEntries(layers.map((l) => [l.id, l]));
    expect(byId.first.clip).toBeUndefined();
    expect(byId.onAdj.clip).toBeUndefined();
    expect(byId.c1.clip).toBe(true);
    expect(byId.c2.clip).toBe(true);
    expect(byId.g.clip).toBeUndefined();
    // The first child of a group has nothing below it in the group.
    expect(byId.in.clip).toBeUndefined();
    expect(clipBase(layers, 'c2').id).toBe('base');
    expect(ids(clippedTo(layers, 'base'))).toEqual(['c1', 'c2']);
  });

  test('group limits', () => {
    const many = Array.from({ length: LAYER_LIMITS.group + 3 }, (_, i) => group(`g${i}`));
    expect(norm(many)).toHaveLength(LAYER_LIMITS.group);
  });
});

describe('render program', () => {
  test('a stack without groups or clips is one step per visible layer, in order', () => {
    const layers = norm([image('a'), adjust('b', { visible: false }), image('c', { opacity: 0.5 })]);
    expect(layerProgram(layers)).toEqual([{ op: 'layer', layer: layers[0], clip: false }, { op: 'layer', layer: layers[2], clip: false }]);
  });

  test('a clip run is isolated: the base at full opacity in Normal, clipped layers atop, then the base mode and opacity', () => {
    const layers = norm([image('base', { opacity: 0.6, blend: 'screen' }), image('c', { clip: true }), adjust('a', { clip: true })]);
    const steps = layerProgram(layers);
    expect(steps.map(({ op, clip }) => `${op}${clip ? '*' : ''}`)).toEqual(['begin', 'layer', 'layer*', 'layer*', 'end']);
    expect(steps[1].layer).toMatchObject({ id: 'base', opacity: 1, blend: 'normal' });
    expect(steps[4]).toMatchObject({ isolate: true, blend: 'screen', opacity: 0.6, owner: null });
    expect(programDepth(steps)).toBe(1);
  });

  test('a hidden or empty base hides what is clipped to it; hidden clipped layers leave the base alone', () => {
    expect(layerProgram(norm([image('base', { visible: false }), image('c', { clip: true })]))).toEqual([]);
    const solo = norm([image('base'), image('c', { clip: true, visible: false })]);
    expect(layerProgram(solo)).toEqual([{ op: 'layer', layer: solo[0], clip: false }]);
  });

  test('pass-through groups add nothing at full opacity without a mask; other modes isolate', () => {
    const plain = norm([image('a', { parent: 'g' }), group('g')]);
    expect(layerProgram(plain).map(({ op }) => op)).toEqual(['layer']);
    const faded = norm([image('a', { parent: 'g' }), group('g', { opacity: 0.5 })]);
    expect(layerProgram(faded)).toMatchObject([{ op: 'begin', isolate: false }, { op: 'layer' }, { op: 'end', isolate: false, opacity: 0.5 }]);
    const masked = norm([image('a', { parent: 'g' }), { ...group('g'), mask: { ...createMask('canvas'), components: [createLinear('l')] } }]);
    expect(layerProgram(masked).at(-1).owner?.id).toBe('g');
    const isolated = norm([image('a', { parent: 'g' }), group('g', { blend: 'normal' })]);
    expect(layerProgram(isolated)).toMatchObject([{ op: 'begin', isolate: true }, { op: 'layer' }, { op: 'end', isolate: true, blend: 'normal', opacity: 1 }]);
  });

  test('a group as clipping base is isolated in Normal inside the run; hidden groups draw nothing', () => {
    const layers = norm([image('a', { parent: 'g' }), group('g', { opacity: 0.7 }), adjust('c', { clip: true })]);
    expect(layerProgram(layers)).toMatchObject([
      { op: 'begin', id: 'clip:g' }, { op: 'begin', id: 'g', isolate: true }, { op: 'layer' }, { op: 'end', id: 'g', blend: 'normal', opacity: 1 },
      { op: 'layer', clip: true }, { op: 'end', id: 'clip:g', blend: 'normal', opacity: 0.7 },
    ]);
    expect(layerProgram(norm([image('a', { parent: 'g' }), group('g', { visible: false })]))).toEqual([]);
    expect(layerProgram(norm([group('g')]))).toEqual([]);
  });

  test('nested groups nest their steps', () => {
    const layers = norm([image('a', { parent: 'inner' }), group('inner', { parent: 'outer', blend: 'multiply' }), group('outer', { opacity: 0.5 })]);
    expect(layerProgram(layers).map(({ op, id }) => (id ? `${op}:${id}` : op))).toEqual(['begin:outer', 'begin:inner', 'layer', 'end:inner', 'end:outer']);
    expect(programDepth(layerProgram(layers))).toBe(2);
  });
});

describe('editing the tree', () => {
  const stack = () => norm([image('a'), image('b', { parent: 'g' }), image('c', { parent: 'g' }), image('cc', { parent: 'g', clip: true }), group('g'), image('d'), adjust('e', { clip: true })]);

  test('clip toggles only where valid', () => {
    const layers = stack();
    expect(canClip(layers, 'b')).toBe(false);
    expect(canClip(layers, 'c')).toBe(true);
    expect(canClip(layers, 'g')).toBe(false);
    const clipped = setClip(layers, 'c', true);
    expect(clipped.find(({ id }) => id === 'c').clip).toBe(true);
    expect(setClip(layers, 'b', true)).toBe(layers);
    expect(setClip(layers, 'cc', false).find(({ id }) => id === 'cc')).not.toHaveProperty('clip');
    // An adjustment layer below makes no base.
    const overAdjust = norm([adjust('x'), image('y')]);
    expect(canClip(overAdjust, 'y')).toBe(false);
  });

  test('moving keeps relationships: a base moves with its clipped layers, a group with its contents', () => {
    let layers = stack();
    layers = norm(moveUnit(layers, 'c', -1));
    expect(ids(layers)).toEqual(['a', 'c', 'cc', 'b', 'g', 'd', 'e']);
    expect(layers.find(({ id }) => id === 'cc').clip).toBe(true);
    // Up past the top of the group leaves it, above the group.
    layers = norm(moveUnit(norm(moveUnit(layers, 'c', 1)), 'c', 1));
    expect(ids(layers)).toEqual(['a', 'b', 'g', 'c', 'cc', 'd', 'e']);
    expect(layers.find(({ id }) => id === 'c')).not.toHaveProperty('parent');
    // A group moves with everything inside it.
    layers = norm(moveUnit(stack(), 'g', -1));
    expect(ids(layers)).toEqual(['b', 'c', 'cc', 'g', 'a', 'd', 'e']);
    expect(canMoveUnit(layers, 'b', -1)).toBe(true);
    expect(canMoveUnit(norm([image('only')]), 'only', 1)).toBe(false);
  });

  test('a clipped layer moves within its run only', () => {
    const layers = norm([image('base'), image('c1', { clip: true }), image('c2', { clip: true })]);
    expect(ids(moveUnit(layers, 'c1', 1))).toEqual(['base', 'c2', 'c1']);
    expect(moveUnit(layers, 'c1', -1)).toBe(layers);
    expect(moveUnit(layers, 'c2', 1)).toBe(layers);
  });

  test('dropping places whole units as siblings; a dragged clipped layer is released; groups never enter themselves', () => {
    let layers = dropUnit(stack(), 'd', 'b', 'below');
    layers = norm(layers);
    expect(ids(layers)).toEqual(['a', 'd', 'e', 'b', 'c', 'cc', 'g']);
    expect(layers.find(({ id }) => id === 'd').parent).toBe('g');
    expect(layers.find(({ id }) => id === 'e').clip).toBe(true);
    const released = norm(dropUnit(stack(), 'cc', 'a', 'above'));
    expect(released.find(({ id }) => id === 'cc')).not.toHaveProperty('clip');
    expect(released.find(({ id }) => id === 'cc')).not.toHaveProperty('parent');
    const self = stack();
    expect(dropUnit(self, 'g', 'b', 'above')).toBe(self);
  });

  test('moving into and out of groups', () => {
    const layers = stack();
    expect(ids(groupTargets(layers, 'a'))).toEqual(['g']);
    expect(groupTargets(layers, 'cc')).toEqual([]);
    const inside = norm(moveIntoGroup(layers, 'd', 'g'));
    expect(ids(inside)).toEqual(['a', 'b', 'c', 'cc', 'd', 'e', 'g']);
    expect(inside.find(({ id }) => id === 'e').clip).toBe(true);
    const out = norm(moveIntoGroup(inside, 'd', null));
    expect(ids(out)).toEqual(['a', 'b', 'c', 'cc', 'g', 'd', 'e']);
  });

  test('grouping keeps clip runs together, respects the depth limit; ungrouping keeps the order', () => {
    const grouped = norm(groupUnits(stack(), ['e'], 'g2'));
    expect(ids(grouped)).toEqual(['a', 'b', 'c', 'cc', 'g', 'd', 'e', 'g2']);
    expect(grouped.find(({ id }) => id === 'd').parent).toBe('g2');
    expect(grouped.find(({ id }) => id === 'e').clip).toBe(true);
    expect(norm(ungroup(grouped, 'g2'))).toEqual(stack());
    // A group at the deepest level cannot hold another.
    let deep = norm([image('x', { parent: 'g3' }), group('g3', { parent: 'g2' }), group('g2', { parent: 'g1' }), group('g1')]);
    expect(groupUnits(deep, ['x'], 'g4')).toBe(deep);
    deep = norm([image('x'), image('y')]);
    expect(ids(norm(groupUnits(deep, ['x', 'y'], 'gg')))).toEqual(['x', 'y', 'gg']);
  });

  test('deleting a group removes its contents; deleting a base releases its clipped layers; locks protect', () => {
    expect(ids(removeUnit(stack(), 'g'))).toEqual(['a', 'd', 'e']);
    const released = norm(removeUnit(stack(), 'd'));
    expect(ids(released)).toEqual(['a', 'b', 'c', 'cc', 'g', 'e']);
    expect(released.at(-1)).not.toHaveProperty('clip');
    const locked = norm([image('x', { parent: 'g', locked: true }), group('g')]);
    expect(removeBlocked(locked, 'g')).toBe('locked-inside');
    expect(removeUnit(locked, 'g')).toBe(locked);
  });

  test('duplicating a group copies its contents with new ids and keeps relationships', () => {
    let n = 0;
    const { layers, id } = duplicateUnit(stack(), 'g', (type) => `${type}-copy-${(n += 1)}`);
    const normalized = norm(layers);
    expect(id).toBe('group-copy-4');
    const copy = normalized.filter(({ id: i }) => i.includes('copy'));
    expect(copy.map(({ type }) => type)).toEqual(['image', 'image', 'image', 'group']);
    expect(copy.slice(0, 3).every(({ parent }) => parent === 'group-copy-4')).toBe(true);
    expect(copy[2].clip).toBe(true);
    expect(descendantIds(normalized, 'g').size).toBe(3);
    // A clipped layer's copy stays clipped, directly above it.
    const one = duplicateUnit(stack(), 'e', () => 'e2');
    expect(ids(norm(one.layers)).slice(-2)).toEqual(['e', 'e2']);
    expect(norm(one.layers).at(-1).clip).toBe(true);
  });

  test('every tree edit is one undo step through the reducer, and undo restores the stack', () => {
    let state = initialEditorState();
    state = editorReducer(state, { type: 'photosAdded', photos: [{ id: 'p', name: 'p.jpg' }] });
    state = editorReducer(state, { type: 'importSucceeded', id: 'p', info: { width: 100, height: 80, format: 'jpeg' } });
    state = editorReducer(state, { type: 'applySettings', patch: { layers: stack() } });
    const before = state.photos[0].history.present.layers;
    state = editorReducer(state, { type: 'applySettings', patch: { layers: groupUnits(before, ['a'], 'g9') } });
    expect(state.photos[0].history.present.layers.find(({ id }) => id === 'a').parent).toBe('g9');
    state = editorReducer(state, { type: 'undo' });
    expect(state.photos[0].history.present.layers).toEqual(before);
    state = editorReducer(state, { type: 'redo' });
    expect(state.photos[0].history.present.layers.some(({ id }) => id === 'g9')).toBe(true);
  });
});

describe('selections in layer masks', () => {
  const result = { kind: 'sky', version: 't/1', width: 4, height: 2, data: 'AAA=', confidence: 0.9 };

  test('adjustment, text, group and (Interval 24.1) image layer masks keep selection components', () => {
    const selection = createSelection('s1', result);
    expect(selection).not.toBeNull();
    const mask = { ...createMask('canvas'), components: [selection] };
    const layers = norm([{ ...adjust('a'), mask }, { ...group('g'), mask }, { ...image('i'), mask: { ...createMask('layer'), components: [selection] } }]);
    expect(layers[0].mask.components[0]).toMatchObject({ type: 'selection', kind: 'sky' });
    expect(layers[1].mask.components).toHaveLength(1);
    expect(layers[2].mask.components).toHaveLength(1);
    expect(layers[2].mask.space).toBe('layer');
  });

  test('selection data counts toward the photo budget across local adjustments and layer masks', () => {
    const data = 'A'.repeat(300_000);
    const big = createSelection('s', { ...result, data });
    const mask = { ...createMask('canvas'), components: [big] };
    const adjustments = normalizeAdjustments({ layers: [{ ...adjust('a'), mask }, { ...adjust('b'), mask }, { ...adjust('c'), mask }, { ...adjust('d'), mask }] });
    const kept = adjustments.layers.filter((layer) => layer.mask.components.length).length;
    expect(kept).toBe(3);
    expect(createAdjustmentLayer('x').type).toBe('adjustment');
  });
});

describe('adding layers next to the selection', () => {
  const stack = () => norm([image('a'), image('b', { parent: 'g' }), image('bc', { parent: 'g', clip: true }), group('g', { name: 'Shapes' }), image('d')]);

  test('a new layer goes above the selected unit, in its group, never inside a clip run', () => {
    expect(ids(norm(insertAbove(stack(), adjust('n'), 'b')))).toEqual(['a', 'b', 'bc', 'n', 'g', 'd']);
    expect(norm(insertAbove(stack(), adjust('n'), 'b')).find(({ id }) => id === 'n').parent).toBe('g');
    expect(ids(norm(insertAbove(stack(), adjust('n'), 'g')))).toEqual(['a', 'b', 'bc', 'g', 'n', 'd']);
    expect(ids(norm(insertAbove(stack(), adjust('n'), null)))).toEqual(['a', 'b', 'bc', 'g', 'd', 'n']);
  });

  test('a clipped adjustment joins the selected layer\'s run; adjustment bases are not offered', () => {
    const clipped = norm(insertAbove(stack(), adjust('n'), 'b', { clip: true }));
    expect(ids(clipped)).toEqual(['a', 'b', 'bc', 'n', 'g', 'd']);
    expect(clipBase(clipped, 'n').id).toBe('b');
    expect(canClipAbove(stack(), 'bc')).toBe(true);
    expect(canClipAbove(norm([adjust('x')]), 'x')).toBe(false);
  });

  test('the Adjust panel names what a clipped or isolated adjustment changes', () => {
    const layers = norm([image('a', { name: 'Sky photo' }), adjust('c', { clip: true }), adjust('in', { parent: 'g' }), group('g', { name: 'Look', blend: 'normal' }), adjust('free')]);
    expect(adjustmentScope(layers, layers[1])).toBe('only “Sky photo” (clipped)');
    expect(adjustmentScope(layers, layers[2])).toBe('only the layers below it in the group “Look”');
    expect(adjustmentScope(layers, layers[4])).toBeNull();
  });
});
