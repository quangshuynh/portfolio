import React from 'react';
import { FORMATS } from '../io/imageHeader.mjs';
import { exportDimensions, exportFileName } from '../io/files.mjs';

const RESIZE_MODES = [
  { value: 'original', label: 'Original size' },
  { value: 'long-edge', label: 'Long edge' },
  { value: 'fit', label: 'Fit within' },
];

function NumberField({ label, value, onChange }) {
  return (
    <label className="pe-field pe-field--inline">
      <span>{label}</span>
      <input
        type="number"
        min="1"
        max="16384"
        step="1"
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(Number.parseInt(event.target.value, 10))}
      />
      <span className="pe-field__unit">px</span>
    </label>
  );
}

export default function ExportPanel({ settings, photo, dispatch, onExport, onCancel, unsupportedFormats, busy }) {
  const set = (changes) => dispatch({ type: 'setExportSettings', settings: changes });
  const setResize = (changes) => set({ resize: { ...settings.resize, ...changes } });
  const ready = photo?.status === 'ready';
  const output = ready ? exportDimensions({ width: photo.width, height: photo.height }, settings.resize) : null;
  const status = photo?.exportStatus ?? { state: 'idle' };
  const running = status.state === 'running';

  return (
    <section className="pe-panel" aria-labelledby="pe-export-title">
      <div className="pe-panel__head"><h2 id="pe-export-title">Export</h2></div>
      <fieldset className="pe-group pe-segmented-field">
        <legend>Format</legend>
        <div className="pe-segmented" role="radiogroup" aria-label="Output format">
          {Object.entries(FORMATS).map(([key, format]) => (
            <label key={key} className="pe-segmented__option">
              <input
                type="radio"
                name="pe-format"
                value={key}
                checked={settings.format === key}
                disabled={unsupportedFormats.includes(key)}
                onChange={() => set({ format: key })}
              />
              <span>{format.label}</span>
            </label>
          ))}
        </div>
        {unsupportedFormats.length > 0 && <p className="pe-note">This browser cannot encode {unsupportedFormats.map((key) => FORMATS[key].label).join(', ')}.</p>}
      </fieldset>

      {settings.format !== 'png' && (
        <div className="pe-field">
          <div className="pe-adjust__head">
            <label htmlFor="pe-quality">Quality</label>
            <output htmlFor="pe-quality" className="pe-adjust__value mono">{Math.round(settings.quality * 100)}</output>
          </div>
          <input
            id="pe-quality"
            className="pe-range"
            type="range"
            min="50"
            max="100"
            step="1"
            value={Math.round(settings.quality * 100)}
            style={{ '--fill-from': '0%', '--fill-to': `${((settings.quality * 100 - 50) / 50) * 100}%` }}
            onChange={(event) => set({ quality: Number(event.target.value) / 100 })}
          />
        </div>
      )}

      <label className="pe-field">
        <span>Size</span>
        <select value={settings.resize.mode} onChange={(event) => setResize({ mode: event.target.value })}>
          {RESIZE_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
        </select>
      </label>
      {settings.resize.mode === 'long-edge' && <NumberField label="Long edge" value={settings.resize.longEdge} onChange={(longEdge) => setResize({ longEdge })} />}
      {settings.resize.mode === 'fit' && (
        <div className="pe-field-row">
          <NumberField label="Width" value={settings.resize.maxWidth} onChange={(maxWidth) => setResize({ maxWidth })} />
          <NumberField label="Height" value={settings.resize.maxHeight} onChange={(maxHeight) => setResize({ maxHeight })} />
        </div>
      )}

      <label className="pe-field">
        <span>Filename suffix</span>
        <input type="text" value={settings.suffix} maxLength={40} spellCheck="false" onChange={(event) => set({ suffix: event.target.value })} />
      </label>

      {ready && (
        <dl className="pe-export-summary">
          <div><dt>File</dt><dd className="mono">{exportFileName(photo.name, settings.format, settings.suffix)}</dd></div>
          <div><dt>Pixels</dt><dd className="mono">{output.width} × {output.height}{output.scaled ? '' : ' (original)'}</dd></div>
        </dl>
      )}

      {running ? (
        <div className="pe-export-progress">
          <progress max="1" value={status.fraction ?? 0} aria-label="Export progress" />
          <span role="status">{status.stage === 'decoding' ? 'Decoding original…' : status.stage === 'encoding' ? 'Encoding…' : `Rendering ${Math.round((status.fraction ?? 0) * 100)}%`}</span>
          <button type="button" className="pe-text-button" onClick={onCancel}>Cancel</button>
        </div>
      ) : (
        <button type="button" className="pe-button pe-button--primary pe-export-button" disabled={!ready || busy} onClick={onExport}>
          Export photo
        </button>
      )}
      {status.state === 'done' && <p className="pe-note" role="status">Saved {status.fileName} ({status.width} × {status.height}).</p>}
      {status.state === 'error' && <p className="pe-note pe-note--error" role="alert">{status.message}</p>}
      {status.state === 'cancelled' && <p className="pe-note" role="status">Export cancelled.</p>}
      <p className="pe-note">8-bit sRGB. The original file is never changed. EXIF, GPS and other metadata are not copied into exports.</p>
    </section>
  );
}
