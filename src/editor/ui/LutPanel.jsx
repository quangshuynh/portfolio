import React, { useRef } from 'react';
import { adjustmentSpec } from '../model/adjustments.mjs';
import { AdjustmentRow } from './AdjustmentRow';

/**
 * 3D LUT: choose one of the .cube files imported in this session (or none), set its
 * intensity, or import another. LUT files stay in this browser tab; saved edits keep
 * only a reference, so a LUT has to be imported again after a reload.
 * :param library: [{ sha256, name, title, size }] imported this session
 * :param onImport: (file) => Promise, parses the file and applies it to the photo
 */
export default function LutPanel({ adjustments, disabled, dispatch, library = [], onImport, status = {} }) {
  const inputRef = useRef(null);
  const ref = adjustments.lut;
  const loaded = ref ? library.find(({ sha256 }) => sha256 === ref.sha256) : null;
  const choose = (sha256) => {
    const entry = library.find((item) => item.sha256 === sha256);
    dispatch({ type: 'applySettings', patch: { lut: entry ? { sha256: entry.sha256, name: entry.name, title: entry.title, size: entry.size } : null } });
  };

  return (
    <div className="pe-lut">
      {ref && !loaded && (
        <div className="pe-lut__missing" role="alert">
          <p><strong>LUT not loaded:</strong> {ref.name}{ref.size ? ` (${ref.size}³)` : ''}. Import the same .cube file to apply it again. The preview leaves it out, and export is blocked until it is imported or removed.</p>
        </div>
      )}
      <label className="pe-field">
        <span>LUT</span>
        <select value={loaded ? loaded.sha256 : ''} disabled={disabled} onChange={(event) => choose(event.target.value)}>
          <option value="">{ref && !loaded ? `Missing: ${ref.name}` : 'None'}</option>
          {library.map(({ sha256, name, title, size }) => <option key={sha256} value={sha256}>{title || name} ({size}³)</option>)}
        </select>
      </label>
      <AdjustmentRow spec={adjustmentSpec('lutIntensity')} value={adjustments.lutIntensity} disabled={disabled || !loaded} dispatch={dispatch} />
      <div className="pe-lut__actions">
        <button type="button" className="pe-button" disabled={disabled || status.busy} onClick={() => inputRef.current?.click()}>
          {status.busy ? 'Reading LUT…' : 'Import .cube'}
        </button>
        <button type="button" className="pe-text-button" disabled={disabled || !ref} onClick={() => dispatch({ type: 'applySettings', patch: { lut: null } })}>Remove LUT</button>
        <input
          ref={inputRef}
          type="file"
          accept=".cube,text/plain"
          hidden
          aria-label="Import a .cube LUT"
          onChange={(event) => { const [file] = event.target.files; event.target.value = ''; if (file) onImport?.(file); }}
        />
      </div>
      {loaded && <p className="pe-note mono">{loaded.name} · {loaded.size}³{loaded.title && loaded.title !== loaded.name ? ` · ${loaded.title}` : ''}</p>}
      {status.error && <p className="pe-note pe-note--error" role="alert">{status.error}</p>}
      <p className="pe-note">Applied last, to the edited sRGB display values. LUTs made for log or wide-gamut footage will not look as intended. 3D .cube, 2–65 points per side, up to 16 MB; files never leave this device.</p>
    </div>
  );
}
