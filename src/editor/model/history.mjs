// Bounded undo history of adjustment snapshots (a few hundred bytes each, never pixels).
// Slider drags preview freely and record one entry when they end; repeated keyboard
// steps on the same control within COALESCE_MS also share one entry.

import { adjustmentsEqual } from './adjustments.mjs';

export const HISTORY_LIMIT = 100;
export const COALESCE_MS = 1000;

export const createHistory = (present) => ({ past: [], present, future: [], pending: null, coalesce: null });

const pushPast = (past, entry) => [...past, entry].slice(-HISTORY_LIMIT);

/** Live change during a gesture; nothing is recorded until commit(). */
export function preview(history, next) {
  return { ...history, present: next, pending: history.pending ?? history.present, coalesce: null };
}

/** Ends a gesture: records its starting point if anything changed. */
export function commit(history) {
  if (!history.pending) return history;
  if (adjustmentsEqual(history.pending, history.present)) return { ...history, pending: null };
  return { ...history, past: pushPast(history.past, history.pending), future: [], pending: null };
}

/**
 * A discrete change (typed value, key press, reset).
 * :param options: { coalesceKey, now } — same key within COALESCE_MS replaces the last entry
 */
export function apply(history, next, { coalesceKey = null, now = Date.now() } = {}) {
  const settled = commit(history);
  if (adjustmentsEqual(settled.present, next)) return settled;
  const merge = coalesceKey && settled.coalesce?.key === coalesceKey && now - settled.coalesce.at < COALESCE_MS;
  return {
    past: merge ? settled.past : pushPast(settled.past, settled.present),
    present: next,
    future: [],
    pending: null,
    coalesce: coalesceKey ? { key: coalesceKey, at: now } : null,
  };
}

export function undo(history) {
  const settled = commit(history);
  if (!settled.past.length) return settled;
  return {
    past: settled.past.slice(0, -1),
    present: settled.past.at(-1),
    future: [settled.present, ...settled.future].slice(0, HISTORY_LIMIT),
    pending: null,
    coalesce: null,
  };
}

export function redo(history) {
  const settled = commit(history);
  if (!settled.future.length) return settled;
  return {
    past: pushPast(settled.past, settled.present),
    present: settled.future[0],
    future: settled.future.slice(1),
    pending: null,
    coalesce: null,
  };
}

export const canUndo = (history) => history.past.length > 0 || Boolean(history.pending && !adjustmentsEqual(history.pending, history.present));
export const canRedo = (history) => history.future.length > 0;
