// Editor state as a pure reducer: the photo list, per-photo adjustments and history,
// the selection, batch changes and their undo, export settings, and saved edits waiting
// for their source files to be reimported.
//
// Selection: the active photo is the one shown and edited (and the source of a sync); it
// is always selected. A plain click selects one photo; Ctrl/Cmd-click adds or removes one
// without changing the active photo; Shift-click selects the range from the anchor.
// A batch change records one history entry per photo it changes and one batch entry
// (settings before and after per photo, never pixels), so it can be undone per photo or
// as a whole; undoing a batch skips photos edited since.

import { adjustmentsEqual, clampAdjustment, neutralAdjustments, neutralGroup, normalizeAdjustments } from './adjustments.mjs';
import { presetPatch } from './presets.mjs';
import { layerAdjustments, normalizeLayerSettings, updateLayer } from './layers.mjs';
import * as history from './history.mjs';
import { DEFAULT_EXPORT_SETTINGS, normalizeExportSettings } from './editDocument.mjs';

export const initialEditorState = () => ({
  photos: [],
  activeId: null,
  exportSettings: normalizeExportSettings(DEFAULT_EXPORT_SETTINGS),
  pendingEdits: [],
  selectedIds: [],
  anchorId: null,
  batches: { past: [], future: [], last: null },
});

/** Batch entries kept for undo (each holds two settings objects per changed photo). */
export const BATCH_HISTORY_LIMIT = 20;

/** True when a saved entry describes this photo: by content hash when both have one, else name and size. */
export function matchesSource(source, photo) {
  if (source.sha256 && photo.sha256) return source.sha256 === photo.sha256;
  return source.name === photo.name && source.size === photo.size;
}

export const activePhoto = (state) => state.photos.find(({ id }) => id === state.activeId) ?? null;

/** Selected photos that can be edited and exported, in workspace order. */
export const selectedPhotos = (state) => state.photos.filter(({ id, status }) => status === 'ready' && state.selectedIds.includes(id));

// Keeps the selection in workspace order, the active photo in it, and drops removed photos.
function withSelection(state, ids, { active = state.activeId, anchor = state.anchorId } = {}) {
  const wanted = new Set(ids);
  if (active) wanted.add(active);
  const selectedIds = state.photos.map(({ id }) => id).filter((id) => wanted.has(id));
  return { ...state, selectedIds, activeId: active, anchorId: anchor && selectedIds.includes(anchor) ? anchor : active };
}

const updatePhoto = (state, id, update) => ({
  ...state,
  photos: state.photos.map((photo) => (photo.id === id ? { ...photo, ...update(photo) } : photo)),
});

// Moves photos from `from` to `to` settings; photos edited since (or removed) are skipped.
function applyBatch(state, changes, direction) {
  let next = state;
  const applied = [];
  let skipped = 0;
  changes.forEach((change) => {
    const photo = next.photos.find(({ id }) => id === change.id);
    const [from, to] = direction === 'undo' ? [change.after, change.before] : [change.before, change.after];
    if (!photo || photo.status !== 'ready' || !adjustmentsEqual(history.commit(photo.history).present, from)) { skipped += 1; return; }
    next = updatePhoto(next, photo.id, (current) => ({ history: history.apply(current.history, to) }));
    applied.push(change);
  });
  return { state: next, applied, skipped };
}

const updateHistory = (state, change) => {
  if (!state.activeId) return state;
  return updatePhoto(state, state.activeId, (photo) => (photo.status === 'ready' ? { history: change(photo.history) } : {}));
};

// An edit of the active photo's settings or, with `layerId`, of that image or adjustment
// layer's colour settings: the panels edit a layer exactly as they edit the photo. Keys a
// layer cannot hold are dropped; a locked layer is left as it is.
function retarget(present, layerId, change) {
  if (!layerId) return change(present);
  const layer = present.layers.find(({ id }) => id === layerId);
  if (!layer?.settings || layer.locked) return present;
  return { ...present, layers: updateLayer(present.layers, layerId, { settings: normalizeLayerSettings(change(layerAdjustments(layer.settings))) }) };
}

export function editorReducer(state, action) {
  const target = (h, change) => retarget(h.present, action.layerId, change);
  switch (action.type) {
    case 'photosAdded': {
      const added = action.photos.map((photo) => ({
        status: 'importing',
        progress: null,
        error: null,
        exportStatus: { state: 'idle' },
        history: history.createHistory(neutralAdjustments()),
        ...photo,
      }));
      const activeId = state.activeId ?? added[0]?.id ?? null;
      const next = { ...state, photos: [...state.photos, ...added] };
      return state.activeId ? next : withSelection(next, [], { active: activeId, anchor: activeId });
    }
    case 'importSucceeded': {
      const photo = state.photos.find(({ id }) => id === action.id);
      if (!photo) return state;
      const probe = { ...photo, ...action.info };
      const match = state.pendingEdits.find(({ source }) => matchesSource(source, probe));
      const next = updatePhoto(state, action.id, () => ({
        ...action.info,
        status: 'ready',
        restored: Boolean(match),
        history: history.createHistory(match ? match.adjustments : neutralAdjustments()),
      }));
      return match ? { ...next, pendingEdits: next.pendingEdits.filter((entry) => entry !== match) } : next;
    }
    case 'importProgress':
      return updatePhoto(state, action.id, (photo) => (photo.status === 'importing' ? { progress: action.progress } : {}));
    case 'importFailed':
      return updatePhoto(state, action.id, () => ({ status: 'error', error: action.error }));
    case 'remove': {
      const index = state.photos.findIndex(({ id }) => id === action.id);
      if (index === -1) return state;
      const photos = state.photos.filter(({ id }) => id !== action.id);
      const activeId = state.activeId === action.id ? (photos[Math.min(index, photos.length - 1)]?.id ?? null) : state.activeId;
      return withSelection({ ...state, photos }, state.selectedIds.filter((id) => id !== action.id), { active: activeId });
    }
    case 'select':
      return state.photos.some(({ id }) => id === action.id) ? withSelection(state, [], { active: action.id, anchor: action.id }) : state;
    case 'toggleSelection': {
      if (!state.photos.some(({ id }) => id === action.id)) return state;
      if (!state.selectedIds.includes(action.id)) return withSelection(state, [...state.selectedIds, action.id], { anchor: action.id });
      const rest = state.selectedIds.filter((id) => id !== action.id);
      // The active photo leaves the selection only when another selected photo takes its place.
      if (!rest.length) return state;
      const order = state.photos.map(({ id }) => id);
      const distance = (id) => Math.abs(order.indexOf(id) - order.indexOf(action.id));
      const active = action.id === state.activeId ? rest.reduce((best, id) => (distance(id) < distance(best) ? id : best)) : state.activeId;
      return withSelection(state, rest, { active, anchor: action.id === state.anchorId ? active : state.anchorId });
    }
    case 'selectRange': {
      const order = state.photos.map(({ id }) => id);
      const to = order.indexOf(action.id);
      if (to === -1) return state;
      const from = order.indexOf(state.anchorId ?? state.activeId);
      const [start, end] = from === -1 ? [to, to] : [Math.min(from, to), Math.max(from, to)];
      const range = order.slice(start, end + 1);
      const ids = action.add ? [...state.selectedIds, ...range] : range;
      // The active photo stays when the range includes it; otherwise the clicked one is shown.
      const active = ids.includes(state.activeId) ? state.activeId : action.id;
      return withSelection(state, ids, { active, anchor: state.anchorId ?? action.id });
    }
    case 'selectAll':
      return withSelection(state, state.photos.filter(({ status }) => status === 'ready').map(({ id }) => id));
    case 'clearSelection':
      return withSelection(state, [], { anchor: state.activeId });
    case 'selectOffset': {
      const index = state.photos.findIndex(({ id }) => id === state.activeId);
      const next = state.photos[index + action.offset];
      return next ? withSelection(state, [], { active: next.id, anchor: next.id }) : state;
    }
    // A batch change from a plan (model/sync.mjs): `changes` = [{ id, after }].
    case 'applyBatch': {
      const changes = action.changes.map(({ id, after }) => {
        const photo = state.photos.find((item) => item.id === id && item.status === 'ready');
        return photo && { id, before: history.commit(photo.history).present, after: normalizeAdjustments(after) };
      }).filter((change) => change && !adjustmentsEqual(change.before, change.after));
      const last = { label: action.label, applied: changes.length, skipped: 0, kind: 'apply' };
      if (!changes.length) return { ...state, batches: { ...state.batches, last } };
      const result = applyBatch(state, changes, 'redo');
      return { ...result.state, batches: { past: [...state.batches.past, { label: action.label, changes }].slice(-BATCH_HISTORY_LIMIT), future: [], last } };
    }
    case 'undoBatch':
    case 'redoBatch': {
      const undoing = action.type === 'undoBatch';
      const entry = undoing ? state.batches.past.at(-1) : state.batches.future[0];
      if (!entry) return state;
      const result = applyBatch(state, entry.changes, undoing ? 'undo' : 'redo');
      const kept = result.applied.length ? [{ label: entry.label, changes: result.applied }] : [];
      const last = { label: entry.label, applied: result.applied.length, skipped: result.skipped, kind: undoing ? 'undo' : 'redo' };
      return {
        ...result.state,
        batches: undoing
          ? { past: state.batches.past.slice(0, -1), future: [...kept, ...state.batches.future], last }
          : { past: [...state.batches.past, ...kept], future: state.batches.future.slice(1), last },
      };
    }
    case 'previewAdjustment':
      return updateHistory(state, (h) => history.preview(h, target(h, (a) => ({ ...a, [action.key]: clampAdjustment(action.key, action.value) }))));
    case 'commitAdjustment':
      return updateHistory(state, history.commit);
    case 'setAdjustment':
      return updateHistory(state, (h) => history.apply(
        h,
        target(h, (a) => ({ ...a, [action.key]: clampAdjustment(action.key, action.value) })),
        { coalesceKey: action.coalesce ? `${action.layerId ?? ''}:${action.key}` : null, now: action.now },
      ));
    case 'resetAdjustment':
      return updateHistory(state, (h) => history.apply(h, target(h, (a) => ({ ...a, [action.key]: neutralAdjustments()[action.key] }))));
    // Structured or multi-key changes (curves, LUT, presets): `patch` is merged over the
    // current settings and normalised. Preview/commit work as for sliders.
    case 'previewSettings':
      return updateHistory(state, (h) => history.preview(h, target(h, (a) => normalizeAdjustments({ ...a, ...action.patch }))));
    case 'applySettings':
      return updateHistory(state, (h) => history.apply(
        h,
        target(h, (a) => normalizeAdjustments({ ...a, ...action.patch })),
        { coalesceKey: action.coalesceKey ?? null, now: action.now },
      ));
    case 'applyPreset':
      return updateHistory(state, (h) => history.apply(h, target(h, (a) => normalizeAdjustments({ ...a, ...presetPatch(action.preset) }))));
    case 'resetGroup':
      return updateHistory(state, (h) => history.apply(h, target(h, (a) => normalizeAdjustments({ ...a, ...neutralGroup(action.group, a) }))));
    case 'resetAll':
      return updateHistory(state, (h) => history.apply(h, target(h, () => neutralAdjustments())));
    case 'undo':
      return updateHistory(state, history.undo);
    case 'redo':
      return updateHistory(state, history.redo);
    case 'setExportSettings':
      return { ...state, exportSettings: normalizeExportSettings({ ...state.exportSettings, ...action.settings }) };
    case 'exportStatus':
      return updatePhoto(state, action.id, () => ({ exportStatus: action.status }));
    case 'loadDocument': {
      const unmatched = [];
      let next = { ...state, exportSettings: action.document.exportSettings };
      action.document.photos.forEach((entry) => {
        const photo = next.photos.find((candidate) => candidate.status === 'ready' && matchesSource(entry.source, candidate));
        if (!photo) { unmatched.push(entry); return; }
        next = updatePhoto(next, photo.id, (current) => ({
          restored: true,
          history: history.apply(current.history, normalizeAdjustments(entry.adjustments)),
        }));
      });
      return { ...next, pendingEdits: unmatched };
    }
    case 'dismissPendingEdits':
      return { ...state, pendingEdits: [] };
    default:
      throw new Error(`Unknown editor action: ${action.type}`);
  }
}
