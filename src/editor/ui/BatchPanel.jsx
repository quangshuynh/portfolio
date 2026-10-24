import React from 'react';

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const BATCH_VERBS = { apply: 'Applied', undo: 'Undid', redo: 'Redid' };

/**
 * Selection and batch actions: selected count, select all/clear, the touch selection
 * mode, copy and paste of edits, sync, presets, filters, LUT and reset on the selection, batch
 * undo and Export selected. Nothing changes photos that are not selected.
 * :param props: selectedCount, readyCount, selecting, clipboard ({ name } | null),
 *   batches (state.batches), canEdit, busy, and the callbacks
 */
export default function BatchPanel({
  selectedCount, readyCount, selecting, onToggleSelecting, onSelectAll, onClear,
  clipboard, onCopy, onPaste, onOpen, onExport, batches, dispatch, canEdit, busy,
}) {
  const many = selectedCount > 1;
  const undoEntry = batches.past.at(-1);
  const redoEntry = batches.future[0];
  const { last } = batches;
  return (
    <section className="pe-batch" aria-label="Selection and batch actions">
      <div className="pe-batch__row">
        <p className="pe-batch__count" role="status" aria-live="polite">
          <strong>{plural(selectedCount, 'photo')}</strong> selected
        </p>
        <button type="button" className="pe-text-button" onClick={onSelectAll} disabled={!readyCount || selectedCount === readyCount} aria-keyshortcuts="Control+A Meta+A">Select all</button>
        <button type="button" className="pe-text-button" onClick={onClear} disabled={!many}>Clear</button>
        <button type="button" className="pe-text-button pe-batch__mode" aria-pressed={selecting} onClick={onToggleSelecting} title="Tap photos to add or remove them">
          {selecting ? 'Done selecting' : 'Select…'}
        </button>
      </div>
      <div className="pe-batch__row pe-batch__actions">
        <button type="button" className="pe-button" onClick={onCopy} disabled={!canEdit} title="Copy this photo's settings (Ctrl+Shift+C)" aria-keyshortcuts="Control+Shift+C Meta+Shift+C">Copy edits</button>
        <button type="button" className="pe-button" onClick={onPaste} disabled={!clipboard || !selectedCount || busy} title={clipboard ? `Paste the settings of ${clipboard.name} (Ctrl+Shift+V)` : 'Copy edits first'} aria-keyshortcuts="Control+Shift+V Meta+Shift+V">
          {many ? `Paste to ${selectedCount}` : 'Paste edits'}
        </button>
        <button type="button" className="pe-button" onClick={() => onOpen('sync')} disabled={!canEdit || !many || busy} title="Copy chosen groups of the active photo's settings to the other selected photos">Sync…</button>
        <button type="button" className="pe-button" onClick={() => onOpen('preset')} disabled={!selectedCount || busy}>Preset…</button>
        <button type="button" className="pe-button" onClick={() => onOpen('filter')} disabled={!selectedCount || busy}>Filter…</button>
        <button type="button" className="pe-button" onClick={() => onOpen('lut')} disabled={!selectedCount || busy}>LUT…</button>
        <button type="button" className="pe-button" onClick={() => onOpen('reset')} disabled={!selectedCount || busy}>Reset…</button>
        <button type="button" className="pe-button pe-button--primary" onClick={onExport} disabled={!selectedCount}>Export {plural(selectedCount, 'photo')}…</button>
      </div>
      {clipboard && <p className="pe-note">Copied: {clipboard.name}{clipboard.raw ? ' (RAW)' : ''}. Paste replaces Light, Color, HSL, Detail, Tone curve, LUT and Creative; text stays with each photo.</p>}
      {(undoEntry || redoEntry || last) && (
        <div className="pe-batch__row pe-batch__history">
          {last && (
            <span className="pe-note" role="status">
              {BATCH_VERBS[last.kind]} {last.label}: {plural(last.applied, 'photo')}{last.skipped ? `; ${plural(last.skipped, 'photo')} edited since or removed, left as they are` : ''}.
            </span>
          )}
          <button type="button" className="pe-text-button" disabled={!undoEntry || busy} onClick={() => dispatch({ type: 'undoBatch' })}>{undoEntry ? `Undo ${undoEntry.label}` : 'Undo batch'}</button>
          <button type="button" className="pe-text-button" disabled={!redoEntry || busy} onClick={() => dispatch({ type: 'redoBatch' })}>{redoEntry ? `Redo ${redoEntry.label}` : 'Redo batch'}</button>
        </div>
      )}
    </section>
  );
}
