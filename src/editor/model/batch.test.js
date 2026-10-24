import { ADJUSTMENTS, adjustmentsEqual, neutralAdjustments, normalizeAdjustments } from './adjustments.mjs';
import { BATCH_HISTORY_LIMIT, activePhoto, editorReducer, initialEditorState, selectedPhotos } from './editorState.mjs';
import { BUILT_IN_PRESETS, applyPreset } from './presets.mjs';
import { DEFAULT_SYNC_GROUPS, SYNC_GROUPS, changedGroups, planLut, planPreset, planReset, planSync, sourceKind, syncGroupOf } from './sync.mjs';

const LUT = { sha256: 'a'.repeat(64), name: 'look.cube', title: 'Look', size: 33 };
const RAW_INFO = { width: 6024, height: 4024, asShot: [2.1, 1, 1.6], model: 'ILCE-7M3' };

/** A workspace of ready photos: ids a…, JPEG unless `kinds` says 'raw' or 'hdr'. */
function workspace(kinds = ['jpeg', 'jpeg', 'jpeg', 'jpeg']) {
  const ids = kinds.map((_, index) => String.fromCharCode(97 + index));
  let state = editorReducer(initialEditorState(), { type: 'photosAdded', photos: ids.map((id) => ({ id, name: `${id}.jpg`, size: 1, lastModified: 0 })) });
  kinds.forEach((kind, index) => {
    const info = { format: kind === 'raw' ? 'arw' : kind, width: 10, height: 10, orientation: 1, sha256: null };
    if (kind === 'raw') info.raw = RAW_INFO;
    if (kind === 'hdr') Object.assign(info, { raw: { ...RAW_INFO, hdrWhite: 4 }, hdr: { mode: 'radiance', inputs: [], settings: {} } });
    if (kind === 'fusion') Object.assign(info, { format: 'hdr', hdr: { mode: 'fusion', inputs: [], settings: {} } });
    state = editorReducer(state, { type: 'importSucceeded', id: ids[index], info });
  });
  return state;
}
const run = (state, ...actions) => actions.reduce(editorReducer, state);
const present = (state, id) => state.photos.find((photo) => photo.id === id).history.present;
const edit = (state, id, patch) => run(state, { type: 'select', id }, { type: 'applySettings', patch });

describe('selection', () => {
  test('the first import is active and selected; a plain click selects one photo', () => {
    let state = workspace();
    expect(state.activeId).toBe('a');
    expect(state.selectedIds).toEqual(['a']);
    state = run(state, { type: 'select', id: 'c' });
    expect([state.activeId, state.selectedIds]).toEqual(['c', ['c']]);
  });

  test('Ctrl/Cmd-click adds and removes without changing the active photo', () => {
    let state = run(workspace(), { type: 'toggleSelection', id: 'c' }, { type: 'toggleSelection', id: 'b' });
    expect([state.activeId, state.selectedIds]).toEqual(['a', ['a', 'b', 'c']]);
    state = run(state, { type: 'toggleSelection', id: 'b' });
    expect(state.selectedIds).toEqual(['a', 'c']);
    // Removing the active photo makes the nearest selected one active.
    state = run(state, { type: 'toggleSelection', id: 'a' });
    expect([state.activeId, state.selectedIds]).toEqual(['c', ['c']]);
    // The last selected photo stays selected.
    expect(run(state, { type: 'toggleSelection', id: 'c' }).selectedIds).toEqual(['c']);
  });

  test('Shift-click selects the range from the anchor, in either direction; with Ctrl it adds', () => {
    let state = run(workspace(), { type: 'select', id: 'b' }, { type: 'selectRange', id: 'd' });
    expect([state.activeId, state.selectedIds]).toEqual(['b', ['b', 'c', 'd']]);
    state = run(state, { type: 'selectRange', id: 'a' });
    expect(state.selectedIds).toEqual(['a', 'b']);
    state = run(workspace(), { type: 'select', id: 'a' }, { type: 'toggleSelection', id: 'd' }, { type: 'selectRange', id: 'c', add: true });
    expect(state.selectedIds).toEqual(['a', 'c', 'd']);
  });

  test('select all takes ready photos only; clear keeps the active one; arrows select one', () => {
    let state = run(workspace(), { type: 'photosAdded', photos: [{ id: 'z', name: 'z.jpg', size: 1, lastModified: 0 }] });
    state = run(state, { type: 'selectAll' });
    expect(state.selectedIds).toEqual(['a', 'b', 'c', 'd']);
    expect(run(state, { type: 'clearSelection' }).selectedIds).toEqual(['a']);
    state = run(state, { type: 'selectOffset', offset: 1 });
    expect([state.activeId, state.selectedIds]).toEqual(['b', ['b']]);
  });

  test('removing photos drops them from the selection', () => {
    let state = run(workspace(), { type: 'selectAll' }, { type: 'remove', id: 'a' });
    expect([state.activeId, state.selectedIds]).toEqual(['b', ['b', 'c', 'd']]);
    state = run(state, { type: 'remove', id: 'c' });
    expect(selectedPhotos(state).map(({ id }) => id)).toEqual(['b', 'd']);
  });

  test('edits change the active photo only, whatever is selected', () => {
    const state = run(workspace(), { type: 'selectAll' }, { type: 'setAdjustment', key: 'exposure', value: 1 });
    expect(state.photos.map(({ history }) => history.present.exposure)).toEqual([1, 0, 0, 0]);
  });
});

describe('sync groups', () => {
  test('every adjustment belongs to exactly one group', () => {
    ADJUSTMENTS.forEach(({ key }) => expect(SYNC_GROUPS.filter(({ keys }) => keys.includes(key))).toHaveLength(1));
    expect(syncGroupOf('exposure')).toBe('light');
    expect(syncGroupOf('rawTemperature')).toBe('raw');
  });

  test('the default copies everything except RAW white balance, HDR tone mapping, geometry and text', () => {
    expect(DEFAULT_SYNC_GROUPS).toEqual(['light', 'color', 'hsl', 'detail', 'curves', 'lut', 'creative']);
  });

  test('changedGroups names the groups that differ', () => {
    const after = normalizeAdjustments({ exposure: 1, sharpening: 30, curves: { master: [[0, 10], [255, 255]] } });
    expect(changedGroups(neutralAdjustments(), after)).toEqual(['light', 'detail', 'curves']);
  });
});

describe('planSync', () => {
  const source = normalizeAdjustments({ exposure: 0.5, contrast: 20, vibrance: 10, orangeHue: -10, texture: 25, curves: { master: [[0, 8], [255, 255]] }, lut: LUT, lutIntensity: 60, rawTemperature: 4200, raw: { whiteBalance: 'custom' }, hdrHighlights: 80 });

  test('replaces the chosen groups exactly and keeps every other group of the target', () => {
    let state = edit(workspace(), 'b', { saturation: 40, clarity: 10, contrast: -50 });
    state = run(state, { type: 'select', id: 'a' });
    const target = state.photos.find(({ id }) => id === 'b');
    const { items, errors } = planSync(source, [target], { groups: ['light', 'hsl'] });
    expect(errors).toEqual([]);
    const [item] = items;
    expect(item.after).toMatchObject({ exposure: 0.5, contrast: 20, orangeHue: -10, saturation: 40, clarity: 10, texture: 0, lut: null });
    expect(item.changed).toEqual(['light', 'hsl']);
  });

  test('replace means replace: a neutral source group resets that group on the target', () => {
    const state = edit(workspace(), 'b', { exposure: 2, contrast: 30 });
    const { items } = planSync(neutralAdjustments(), [state.photos[1]], { groups: ['light'] });
    expect(items[0].after.exposure).toBe(0);
    expect(items[0].after.contrast).toBe(0);
  });

  test('blocks a LUT that is not loaded, unless LUT is left out', () => {
    const targets = workspace().photos.slice(1);
    expect(planSync(source, targets, { hasLut: () => false }).errors[0]).toMatch(/Look.*not loaded/);
    expect(planSync(source, targets, { hasLut: () => false, groups: ['light'] }).errors).toEqual([]);
    expect(planSync(source, targets, { groups: [] }).errors[0]).toMatch(/at least one group/);
  });

  test('RAW white balance copies only from a RAW photo to RAW photos, never their camera data', () => {
    const state = workspace(['raw', 'raw', 'jpeg']);
    const [rawSource, rawTarget, jpeg] = state.photos;
    const { items } = planSync(source, [rawTarget, jpeg], { groups: ['raw', 'light'], kind: sourceKind(rawSource) });
    expect(items[0].after).toMatchObject({ rawTemperature: 4200, raw: { whiteBalance: 'custom' }, exposure: 0.5 });
    expect(items[1].after.rawTemperature).toBe(5500);
    expect(items[1].skipped).toEqual([{ group: 'raw', reason: 'only for RAW photos' }]);
    // Camera data is not a setting, so it cannot travel with one.
    expect(Object.keys(items[0].after)).not.toContain('asShot');
    expect(state.photos[1].raw).toBe(RAW_INFO);
    // From a JPEG, RAW white balance is skipped everywhere.
    expect(planSync(source, [rawTarget], { groups: ['raw'], kind: sourceKind(jpeg) }).items[0].skipped[0].reason).toMatch(/source is not one of the RAW photos/);
  });

  test('HDR tone mapping copies only between merged RAW HDR photos; merge data stays', () => {
    const state = workspace(['hdr', 'hdr', 'raw', 'fusion']);
    const [hdrSource, hdrTarget, raw, fusion] = state.photos;
    const { items } = planSync(source, [hdrTarget, raw, fusion], { groups: ['hdr', 'light'], kind: sourceKind(hdrSource) });
    expect(items.map(({ after }) => after.hdrHighlights)).toEqual([80, 50, 50]);
    expect(items.map(({ skipped }) => skipped.length)).toEqual([0, 1, 1]);
    expect(hdrTarget.hdr).toEqual({ mode: 'radiance', inputs: [], settings: {} });
  });

  test('compatible groups transfer between raster, RAW and HDR photos', () => {
    const state = workspace(['jpeg', 'raw', 'hdr', 'fusion']);
    const { items } = planSync(source, state.photos.slice(1), { kind: sourceKind(state.photos[0]) });
    items.forEach(({ after }) => expect(after).toMatchObject({ exposure: 0.5, texture: 25, lutIntensity: 60, lut: LUT, rawTemperature: 5500, hdrHighlights: 50 }));
  });

  test('photos that are not ready are left out', () => {
    const state = run(workspace(), { type: 'photosAdded', photos: [{ id: 'z', name: 'z.jpg', size: 1, lastModified: 0 }] });
    expect(planSync(source, state.photos).items).toHaveLength(4);
  });
});

describe('presets, LUTs and reset on several photos', () => {
  test('a preset applies to each target as it would to one photo', () => {
    const preset = BUILT_IN_PRESETS.find(({ name }) => name === 'Soft Film');
    const state = edit(workspace(), 'b', { exposure: 1.5, texture: 20 });
    const { items, errors } = planPreset(preset, state.photos);
    expect(errors).toEqual([]);
    state.photos.forEach((photo, index) => expect(adjustmentsEqual(items[index].after, applyPreset(photo.history.present, preset))).toBe(true));
    expect(items[1].after).toMatchObject({ exposure: 1.5, texture: 20 });
  });

  test('a preset with a LUT that is not loaded is refused before anything changes', () => {
    const preset = { name: 'With LUT', groups: ['lut'], settings: { lut: LUT, lutIntensity: 50 } };
    expect(planPreset(preset, workspace().photos, { hasLut: () => false }).errors[0]).toMatch(/not loaded/);
  });

  test('LUT and intensity are set, or removed, on every target', () => {
    const photos = workspace().photos;
    expect(planLut(LUT, 40, photos).items.every(({ after }) => after.lut.sha256 === LUT.sha256 && after.lutIntensity === 40)).toBe(true);
    expect(planLut(LUT, 40, photos, { hasLut: () => false }).errors).toHaveLength(1);
    expect(planLut(null, 100, photos).changedCount).toBe(0);
  });

  test('reset makes every target neutral', () => {
    const state = edit(workspace(), 'c', { contrast: 40 });
    const plan = planReset(state.photos);
    expect(plan.changedCount).toBe(1);
    expect(plan.items.every(({ after }) => adjustmentsEqual(after, neutralAdjustments()))).toBe(true);
  });
});

describe('batch changes and undo', () => {
  const sourceValues = normalizeAdjustments({ exposure: 1, saturation: 25 });
  const syncAll = (state) => {
    const plan = planSync(sourceValues, state.photos.slice(1));
    return run(state, { type: 'applyBatch', label: 'Sync edits', changes: plan.items.map(({ id, after }) => ({ id, after })) });
  };

  test('applies to the targets only, in one batch entry and one history entry per photo', () => {
    const state = syncAll(edit(workspace(), 'a', sourceValues));
    expect(state.photos.map((photo) => photo.history.present.exposure)).toEqual([1, 1, 1, 1]);
    expect(state.photos.slice(1).map(({ history }) => history.past.length)).toEqual([1, 1, 1]);
    expect(state.batches.past).toHaveLength(1);
    expect(state.batches.last).toEqual({ label: 'Sync edits', applied: 3, skipped: 0, kind: 'apply' });
  });

  test('undo and redo of the batch restore every photo; per-photo undo works too', () => {
    const before = edit(workspace(), 'b', { contrast: 30 });
    let state = syncAll(before);
    state = run(state, { type: 'undoBatch' });
    ['b', 'c', 'd'].forEach((id) => expect(present(state, id)).toEqual(present(before, id)));
    expect(state.batches.future).toHaveLength(1);
    state = run(state, { type: 'redoBatch' });
    expect(present(state, 'c').saturation).toBe(25);
    state = run(state, { type: 'select', id: 'c' }, { type: 'undo' });
    expect(present(state, 'c').saturation).toBe(0);
  });

  test('undoing a batch skips photos edited since and says how many', () => {
    let state = syncAll(workspace());
    state = edit(state, 'c', { contrast: 10 });
    state = run(state, { type: 'undoBatch' });
    expect(present(state, 'c')).toMatchObject({ exposure: 1, contrast: 10 });
    expect(present(state, 'b').exposure).toBe(0);
    expect(state.batches.last).toMatchObject({ applied: 2, skipped: 1, kind: 'undo' });
  });

  test('stores settings, not pixels, and keeps a bounded number of batches', () => {
    let state = workspace();
    for (let i = 1; i <= BATCH_HISTORY_LIMIT + 5; i += 1) {
      state = run(state, { type: 'applyBatch', label: `#${i}`, changes: [{ id: 'b', after: normalizeAdjustments({ contrast: i }) }] });
    }
    expect(state.batches.past).toHaveLength(BATCH_HISTORY_LIMIT);
    expect(state.batches.past[0].label).toBe('#6');
    expect(JSON.stringify(state.batches).length).toBeLessThan(200_000);
  });

  test('a batch that changes nothing records nothing; removed photos are skipped on undo', () => {
    let state = run(workspace(), { type: 'applyBatch', label: 'Noop', changes: [{ id: 'b', after: neutralAdjustments() }] });
    expect(state.batches.past).toHaveLength(0);
    state = run(syncAll(state), { type: 'remove', id: 'b' }, { type: 'undoBatch' });
    expect(state.batches.last).toMatchObject({ applied: 2, skipped: 1 });
    expect(activePhoto(state).id).toBe('a');
  });
});

describe('geometry in batches', () => {
  const crop = { x: 0.1, y: 0.2, width: 0.5, height: 0.5 };
  const geometry = { quarterTurns: 1, angle: 4, crop, perspective: { vertical: 30, horizontal: 0 }, resize: { width: 5, height: 5, locked: true } };

  test('paste and default sync never copy geometry', () => {
    let state = edit(workspace(), 'a', { exposure: 1, geometry });
    const source = state.photos[0];
    const plan = planSync(source.history.present, state.photos.slice(1), { kind: sourceKind(source) });
    plan.items.forEach(({ after }) => expect(after.geometry).toEqual(neutralAdjustments().geometry));
    expect(DEFAULT_SYNC_GROUPS).not.toContain('transform');
    expect(DEFAULT_SYNC_GROUPS).not.toContain('outputSize');
    state = run(state, { type: 'applyBatch', label: 'x', changes: plan.items.map(({ id, after }) => ({ id, after })) });
    expect(present(state, 'b').exposure).toBe(1);
  });

  test('Output size copies only the resize box; Crop & transform only to photos of the same proportions', () => {
    let state = workspace();
    state = run(state, { type: 'importSucceeded', id: 'c', info: { format: 'jpeg', width: 20, height: 10, orientation: 1, sha256: null } });
    state = edit(state, 'b', { geometry: { flipV: true } });
    state = edit(state, 'a', { geometry });
    const source = state.photos[0];
    const size = planSync(source.history.present, state.photos.slice(1), { groups: ['outputSize'], kind: sourceKind(source) });
    const b = size.items.find(({ id }) => id === 'b');
    expect(b.after.geometry).toMatchObject({ resize: geometry.resize, flipV: true, crop: null, quarterTurns: 0 });
    expect(b.changed).toEqual(['outputSize']);
    const transform = planSync(source.history.present, state.photos.slice(1), { groups: ['transform'], kind: sourceKind(source) });
    const same = transform.items.find(({ id }) => id === 'b');
    expect(same.after.geometry).toMatchObject({ quarterTurns: 1, angle: 4, crop, resize: null });
    const wide = transform.items.find(({ id }) => id === 'c');
    expect(wide.after.geometry).toEqual(neutralAdjustments().geometry);
    expect(wide.skipped).toEqual([{ group: 'transform', reason: 'only for photos with the same proportions' }]);
  });

  test('batch undo restores geometry', () => {
    let state = edit(workspace(), 'a', { geometry });
    const source = state.photos[0];
    const plan = planSync(source.history.present, state.photos.slice(1), { groups: ['transform'], kind: sourceKind(source) });
    state = run(state, { type: 'applyBatch', label: 'sync', changes: plan.items.map(({ id, after }) => ({ id, after })) });
    expect(present(state, 'b').geometry.angle).toBe(4);
    state = run(state, { type: 'undoBatch' });
    expect(present(state, 'b').geometry).toEqual(neutralAdjustments().geometry);
  });
});
