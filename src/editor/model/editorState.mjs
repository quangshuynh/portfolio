// Editor state as a pure reducer: the photo list, per-photo adjustments and history,
// export settings, and saved edits waiting for their source files to be reimported.

import { clampAdjustment, neutralAdjustments, normalizeAdjustments } from './adjustments.mjs';
import * as history from './history.mjs';
import { DEFAULT_EXPORT_SETTINGS, normalizeExportSettings } from './editDocument.mjs';

export const initialEditorState = () => ({
  photos: [],
  activeId: null,
  exportSettings: normalizeExportSettings(DEFAULT_EXPORT_SETTINGS),
  pendingEdits: [],
});

/** True when a saved entry describes this photo: by content hash when both have one, else name and size. */
export function matchesSource(source, photo) {
  if (source.sha256 && photo.sha256) return source.sha256 === photo.sha256;
  return source.name === photo.name && source.size === photo.size;
}

export const activePhoto = (state) => state.photos.find(({ id }) => id === state.activeId) ?? null;

const updatePhoto = (state, id, update) => ({
  ...state,
  photos: state.photos.map((photo) => (photo.id === id ? { ...photo, ...update(photo) } : photo)),
});

const updateHistory = (state, change) => {
  if (!state.activeId) return state;
  return updatePhoto(state, state.activeId, (photo) => (photo.status === 'ready' ? { history: change(photo.history) } : {}));
};

export function editorReducer(state, action) {
  switch (action.type) {
    case 'photosAdded': {
      const added = action.photos.map((photo) => ({
        status: 'importing',
        error: null,
        exportStatus: { state: 'idle' },
        history: history.createHistory(neutralAdjustments()),
        ...photo,
      }));
      return { ...state, photos: [...state.photos, ...added], activeId: state.activeId ?? added[0]?.id ?? null };
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
    case 'importFailed':
      return updatePhoto(state, action.id, () => ({ status: 'error', error: action.error }));
    case 'remove': {
      const index = state.photos.findIndex(({ id }) => id === action.id);
      if (index === -1) return state;
      const photos = state.photos.filter(({ id }) => id !== action.id);
      const activeId = state.activeId === action.id ? (photos[Math.min(index, photos.length - 1)]?.id ?? null) : state.activeId;
      return { ...state, photos, activeId };
    }
    case 'select':
      return state.photos.some(({ id }) => id === action.id) ? { ...state, activeId: action.id } : state;
    case 'selectOffset': {
      const index = state.photos.findIndex(({ id }) => id === state.activeId);
      const next = state.photos[index + action.offset];
      return next ? { ...state, activeId: next.id } : state;
    }
    case 'previewAdjustment':
      return updateHistory(state, (h) => history.preview(h, { ...h.present, [action.key]: clampAdjustment(action.key, action.value) }));
    case 'commitAdjustment':
      return updateHistory(state, history.commit);
    case 'setAdjustment':
      return updateHistory(state, (h) => history.apply(
        h,
        { ...h.present, [action.key]: clampAdjustment(action.key, action.value) },
        { coalesceKey: action.coalesce ? action.key : null, now: action.now },
      ));
    case 'resetAdjustment':
      return updateHistory(state, (h) => history.apply(h, { ...h.present, [action.key]: neutralAdjustments()[action.key] }));
    case 'resetAll':
      return updateHistory(state, (h) => history.apply(h, neutralAdjustments()));
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
