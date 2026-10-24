import React, { useMemo, useState } from 'react';
import { batchFileNames } from '../batch/batchNames.mjs';
import { formatBytes } from '../io/files.mjs';
import { ExportSettingsFields } from './ExportPanel';
import Dialog from './Dialog';

const STAGES = { queued: 'Waiting', decoding: 'Decoding original', merging: 'Merging exposures', encoding: 'Encoding' };
// Canvas size above which iOS Safari cannot create the canvas (about 16.7 MP).
const PHONE_CANVAS_PIXELS = 16_777_216;
const megabytes = (bytes) => `${Math.round(bytes / (1024 * 1024)).toLocaleString('en-US')} MB`;

function itemStatus(status, photo) {
  switch (status.state) {
    case 'queued': return STAGES.queued;
    case 'running': {
      if (status.stage === 'rendering') return `Rendering ${Math.round((status.fraction ?? 0) * 100)}%`;
      if (status.stage === 'compositing') return 'Compositing layers…';
      if (status.stage === 'decoding' && photo.raw && !photo.hdr) return 'Decoding RAW sensor data';
      if (status.stage === 'decoding' && Number.isInteger(status.index)) return `Decoding photo ${status.index + 1} of 3`;
      return STAGES[status.stage] ?? 'Exporting';
    }
    case 'done': return status.fileName ? `Saved ${status.width}×${status.height}, ${formatBytes(status.bytes)}` : 'Done';
    case 'cancelled': return 'Cancelled';
    case 'error': return status.message;
    default: return '';
  }
}

/**
 * Export selected: one output format, quality and size for every photo; each photo is
 * rendered from its original file with its own settings, one at a time, and saved as an
 * individual download or into a ZIP. Per-photo progress, errors, cancel and retry.
 * :param props: photos (selected, ready), settings, dispatch, unsupportedFormats,
 *   blockerFor(photo) -> message | null, outputOf(photo) -> { width, height },
 *   run ({ running, mode, parts, outcome } | null), constrained (phone or low memory),
 *   onStart({ mode, customNames }), onCancel, onCancelItem(id), onRetry(ids, { mode, customNames }), onClose
 */
export default function BatchExportDialog({ photos, settings, dispatch, unsupportedFormats, blockerFor, outputOf, run, constrained, onStart, onCancel, onCancelItem, onRetry, onClose }) {
  const [mode, setMode] = useState(run?.mode ?? 'zip');
  const [customNames, setCustomNames] = useState({});
  const [renaming, setRenaming] = useState(null);
  const running = Boolean(run?.running);
  const names = useMemo(() => batchFileNames(photos.map(({ id, name }) => ({ id, name, customName: customNames[id] })), settings), [photos, customNames, settings]);
  const rows = photos.map((photo) => ({ photo, blocker: blockerFor(photo), output: outputOf(photo), status: photo.exportStatus ?? { state: 'idle' } }));
  const exportable = rows.filter(({ blocker }) => !blocker);
  const largest = exportable.reduce((best, row) => (row.output.width * row.output.height > (best?.output.width ?? 0) * (best?.output.height ?? 0) ? row : best), null);
  const failed = rows.filter(({ status }) => status.state === 'error' || status.state === 'cancelled').map(({ photo }) => photo.id);
  const heavyOnPhone = constrained && exportable.some(({ photo, output }) => (photo.raw || photo.hdr) && output.width * output.height > PHONE_CANVAS_PIXELS);
  const done = rows.filter(({ status }) => status.state === 'done').length;

  return (
    <Dialog
      title="Export selected"
      onClose={onClose}
      busy={running}
      className="pe-dialog--batch"
      footer={running ? (
        <>
          <progress max={rows.length} value={done} aria-label="Batch export progress" />
          <span className="pe-note" role="status">{done} of {exportable.length} saved</span>
          <button type="button" className="pe-button" onClick={onCancel}>Cancel</button>
        </>
      ) : (
        <>
          {failed.length > 0 && run?.outcome && <button type="button" className="pe-button" onClick={() => onRetry(failed, { mode: 'files', customNames })}>Retry {failed.length} failed</button>}
          <button type="button" className="pe-button" onClick={onClose}>Close</button>
          <button type="button" className="pe-button pe-button--primary" disabled={!exportable.length} onClick={() => onStart({ mode, customNames })}>
            Export {exportable.length} {mode === 'zip' ? 'as ZIP' : `file${exportable.length === 1 ? '' : 's'}`}
          </button>
        </>
      )}
    >
      <fieldset className="pe-group pe-segmented-field" disabled={running}>
        <legend>Save as</legend>
        <div className="pe-segmented pe-segmented--two" role="radiogroup" aria-label="Save as">
          {[['zip', 'One ZIP'], ['files', 'Separate files']].map(([value, label]) => (
            <label key={value} className="pe-segmented__option">
              <input type="radio" name="pe-batch-output" value={value} checked={mode === value} onChange={() => setMode(value)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <p className="pe-note">{mode === 'zip'
          ? 'The ZIP is made on this device (stored, not recompressed). Large batches are split into several ZIPs so the archive never needs more memory than one part.'
          : 'Each photo downloads as it finishes; the browser may ask once to allow several downloads.'}</p>
      </fieldset>
      <fieldset className="pe-batch-settings" disabled={running}>
        <ExportSettingsFields settings={settings} dispatch={dispatch} unsupportedFormats={unsupportedFormats} name="pe-batch-format" />
      </fieldset>
      <p className="pe-note">The aspect ratio is always kept and photos are never upscaled. Every photo is rendered again from its original file (RAW sensor data, the three files of a merge) with its own settings; the original files are never changed.</p>
      {largest && (
        <p className="pe-note" data-batch-memory>
          Photos are exported one at a time, so memory peaks with the largest: {largest.output.width}×{largest.output.height} needs a {megabytes(largest.output.width * largest.output.height * 4)} canvas
          {exportable.some(({ photo }) => photo.raw || photo.hdr) ? ', plus the RAW decoder (several hundred MB at full size)' : ''}. Output file sizes depend on the content and are shown as each photo finishes.
        </p>
      )}
      {heavyOnPhone && <p className="pe-note pe-note--error" role="alert">This device may not have enough memory for full-size RAW or HDR exports (phone browsers cap canvases at about 16.7 MP). Choose Long edge 4096 px or smaller, or export these photos on a computer.</p>}

      <ul className="pe-batch-plan" aria-label="Photos to export">
        {rows.map(({ photo, blocker, output, status }) => (
          <li key={photo.id} className="pe-batch-plan__item" data-export={status.state} data-blocked={blocker ? true : undefined}>
            <span className="pe-batch-plan__meta">
              {renaming === photo.id ? (
                <form className="pe-preset__rename" onSubmit={(event) => { event.preventDefault(); setRenaming(null); }}>
                  <input aria-label={`File name for ${photo.name}`} value={customNames[photo.id] ?? ''} placeholder={names.get(photo.id)} maxLength={100} autoFocus onChange={(event) => setCustomNames({ ...customNames, [photo.id]: event.target.value })} />
                  <button type="submit" className="pe-text-button">Done</button>
                </form>
              ) : (
                <span className="pe-photo__name mono">{names.get(photo.id)}</span>
              )}
              <span className="pe-photo__detail">
                {photo.name} · {output.width}×{output.height}
                {blocker ? <span className="pe-note--error"> · Not exported: {blocker}</span> : status.state !== 'idle' && <span role={status.state === 'error' ? 'alert' : undefined} className={status.state === 'error' ? 'pe-note--error' : undefined}> · {itemStatus(status, photo)}</span>}
              </span>
              {status.state === 'running' && <progress max="1" value={status.fraction ?? 0} aria-label={`Export progress of ${photo.name}`} />}
            </span>
            <span className="pe-batch-plan__actions">
              {!running && !blocker && renaming !== photo.id && <button type="button" className="pe-text-button" onClick={() => setRenaming(photo.id)} aria-label={`Rename the export of ${photo.name}`}>Rename</button>}
              {running && (status.state === 'queued' || status.state === 'running') && <button type="button" className="pe-text-button" onClick={() => onCancelItem(photo.id)} aria-label={`Cancel the export of ${photo.name}`}>Cancel</button>}
              {!running && run?.outcome && !blocker && (status.state === 'error' || status.state === 'cancelled') && <button type="button" className="pe-text-button" onClick={() => onRetry([photo.id], { mode: 'files', customNames })} aria-label={`Retry the export of ${photo.name}`}>Retry</button>}
            </span>
          </li>
        ))}
      </ul>
      {run?.outcome && (
        <p className="pe-note" role="status" data-batch-outcome>
          {run.outcome}
          {failed.length > 0 && run.mode === 'zip' ? ' Retried photos download as separate files with the same names.' : ''}
        </p>
      )}
    </Dialog>
  );
}
