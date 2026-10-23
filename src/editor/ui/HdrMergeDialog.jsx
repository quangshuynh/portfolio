import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { BRACKET_SIZE, ROLES, ROLE_LABELS, exposureLabel, exposureStops, rolesComplete, suggestRolesFromBrightness, suggestRolesFromMetadata, validateBracket } from '../hdr/hdrMetadata.mjs';
import { DEFAULT_MERGE_SETTINGS, medianBrightness } from '../hdr/hdrMerge.mjs';
import { hdrSourceMatches } from '../hdr/hdrSource.mjs';
import { neutralAdjustments } from '../model/adjustments.mjs';
import { formatBytes } from '../io/files.mjs';
import PhotoThumb from './PhotoThumb';

const STEPS = ['Select three photos', 'Review exposures', 'Align and merge', 'Edit', 'Export'];
const STAGES = { decoding: 'Decoding', aligning: 'Aligning', deghosting: 'Finding moving areas', merging: 'Merging' };
const NEUTRAL = neutralAdjustments();
const signedStops = (value) => `${value > 0 ? '+' : ''}${value.toFixed(1)} EV`;

/**
 * Merge HDR: choose three exposures (new files or photos already in the workspace),
 * review and correct their roles, then align and merge. Edit and Export continue in
 * the editor with the merged photo.
 * :param props: inspect(file) -> Promise<input>; describe(photoId) -> Promise<input>;
 *   merge(inputs, settings, onProgress) -> { promise, cancel }; onMerged(result, inputs, settings);
 *   workspace: ready photos that can be inputs; pending: saved HDR sources waiting for their files
 */
export default function HdrMergeDialog({ onClose, inspect, describe, merge, onMerged, workspace, pending = [], accept }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const fileRef = useRef(null);
  const replaceRef = useRef(null);
  const [inputs, setInputs] = useState([]);
  const [settings, setSettings] = useState({ ...DEFAULT_MERGE_SETTINGS });
  const [suggestion, setSuggestion] = useState(null);
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);
  const [restored, setRestored] = useState(null);
  const jobRef = useRef(null);
  const nextKey = useRef(0);

  // Focus moves into the dialog and returns to the opener on close; Escape closes.
  useEffect(() => {
    const opener = document.activeElement;
    dialogRef.current?.querySelector('button, input, select')?.focus();
    return () => { jobRef.current?.cancel(); opener?.focus?.(); };
  }, []);
  const close = () => { jobRef.current?.cancel(); onClose(); };
  const onKeyDown = (event) => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [href]')];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const ready = inputs.filter(({ status }) => status === 'ready');
  const complete = ready.length === BRACKET_SIZE && inputs.length === BRACKET_SIZE;
  const validation = useMemo(() => (complete ? validateBracket(inputs) : null), [complete, inputs]);
  const step = run?.state === 'running' ? 2 : complete ? 1 : 0;

  // Roles: a saved merge of these files, else exposure metadata, else measured brightness.
  useEffect(() => {
    if (!complete || inputs.every(({ role }) => role)) return;
    const saved = pending.find(({ source }) => hdrSourceMatches(source.hdr, inputs));
    let roles;
    if (saved) {
      roles = inputs.map((input) => saved.source.hdr.inputs.find((entry) => (entry.sha256 && input.sha256 ? entry.sha256 === input.sha256 : entry.name === input.name && entry.size === input.size))?.role);
      setSettings(saved.source.hdr.settings);
      setRestored(saved.source.name);
      setSuggestion('saved');
    } else {
      const fromMetadata = suggestRolesFromMetadata(inputs);
      roles = fromMetadata?.roles ?? suggestRolesFromBrightness(inputs.map(({ thumbnail }) => medianBrightness(thumbnail)));
      setSuggestion(fromMetadata ? 'metadata' : 'brightness');
    }
    if (rolesComplete(roles)) setInputs((current) => current.map((input, index) => ({ ...input, role: roles[index] })));
  }, [complete, inputs, pending]);

  const add = (promises) => {
    const entries = promises.map(() => ({ key: (nextKey.current += 1), status: 'reading' }));
    setInputs((current) => [...current.map((input) => ({ ...input, role: null })), ...entries].slice(0, BRACKET_SIZE));
    setSuggestion(null);
    setError(null);
    setRun(null);
    entries.forEach((entry, index) => {
      promises[index].then(
        (input) => setInputs((current) => current.map((item) => (item.key === entry.key ? { ...input, key: entry.key, status: 'ready', role: null } : item))),
        (failure) => setInputs((current) => current.map((item) => (item.key === entry.key ? { ...item, status: 'error', error: failure.message, name: failure.fileName ?? item.name } : item))),
      );
    });
  };
  const addFiles = (files) => {
    const list = Array.from(files ?? []);
    const room = BRACKET_SIZE - inputs.length;
    add(list.slice(0, Math.max(0, room)).map((file) => inspect(file).catch((failure) => { throw Object.assign(failure, { fileName: file.name }); })));
    if (list.length > room) setError(`A bracket has exactly three photos; ${list.length - room} extra file${list.length - room === 1 ? ' was' : 's were'} not added.`);
  };
  const remove = (key) => {
    setInputs((current) => current.filter((input) => input.key !== key).map((input) => ({ ...input, role: null })));
    setSuggestion(null);
    setRun(null);
  };
  const replaceKey = useRef(null);
  const replace = (file) => {
    if (!file) return;
    const key = replaceKey.current;
    setInputs((current) => current.map((input) => (input.key === key ? { key, status: 'reading', name: file.name } : { ...input, role: null })));
    setSuggestion(null);
    setRun(null);
    inspect(file).then(
      (input) => setInputs((current) => current.map((item) => (item.key === key ? { ...input, key, status: 'ready', role: null } : item))),
      (failure) => setInputs((current) => current.map((item) => (item.key === key ? { key, status: 'error', error: failure.message, name: file.name } : item))),
    );
  };
  // Choosing a role another photo has swaps the two, so the roles stay one of each.
  const setRole = (key, role) => setInputs((current) => {
    const previous = current.find((input) => input.key === key).role;
    return current.map((input) => (input.key === key ? { ...input, role } : input.role === role ? { ...input, role: previous } : input));
  });

  const reference = inputs.find(({ role }) => role === 'normal');
  const startMerge = () => {
    setError(null);
    const job = merge(inputs, settings, (progress) => setRun({ state: 'running', ...progress }));
    jobRef.current = job;
    setRun({ state: 'running', stage: 'decoding', fraction: 0 });
    job.promise.then((result) => {
      jobRef.current = null;
      onMerged(result, inputs, settings);
    }, (failure) => {
      jobRef.current = null;
      if (failure.code === 'cancelled') { setRun({ state: 'cancelled' }); return; }
      setRun(null);
      setError(failure.message);
    });
  };
  const running = run?.state === 'running';
  const inWorkspace = new Set(inputs.map(({ photoId }) => photoId).filter(Boolean));
  const mode = validation?.mode;
  const refStops = reference ? exposureStops(reference.exposure) : null;

  return (
    <div className="pe-dialog-backdrop">
      <div ref={dialogRef} className="pe-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        <header className="pe-dialog__head">
          <h2 id={titleId}>Merge HDR</h2>
          <button type="button" className="pe-icon-button" onClick={close} aria-label="Close Merge HDR">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </header>
        <ol className="pe-steps" aria-label="Steps">
          {STEPS.map((label, index) => <li key={label} aria-current={index === step ? 'step' : undefined} data-done={index < step || undefined}>{label}</li>)}
        </ol>

        <div className="pe-dialog__body">
          <p className="pe-note">Three photos of the same scene taken at different exposures, for example −2, 0 and +2 EV, ideally from a tripod. RAW files are merged into a high-dynamic-range image; JPEG, PNG and WebP are blended by exposure fusion.</p>
          {restored && <p className="pe-note" role="status">These are the source files of {restored}: its saved merge settings and edits are restored.</p>}

          <ul className="pe-bracket">
            {inputs.map((input) => (
              <li key={input.key} className="pe-bracket__item" data-status={input.status}>
                <span className="pe-bracket__frame">
                  {input.thumbnail ? <PhotoThumb thumbnail={input.thumbnail} adjustments={NEUTRAL} raw={input.raw} /> : <span className="pe-photo__placeholder" aria-hidden="true">{input.status === 'error' ? '!' : <span className="pe-spinner" />}</span>}
                </span>
                <span className="pe-bracket__meta">
                  <span className="pe-photo__name">{input.name ?? 'Reading…'}</span>
                  {input.status === 'ready' && (
                    <span className="pe-photo__detail mono">
                      {input.width}×{input.height} · {formatBytes(input.size)}
                      {exposureLabel(input.exposure) ? ` · ${exposureLabel(input.exposure)}` : ' · exposure not recorded'}
                      {refStops !== null && exposureStops(input.exposure) !== null && input !== reference ? ` (${signedStops(exposureStops(input.exposure) - refStops)})` : ''}
                    </span>
                  )}
                  {input.status === 'reading' && <span className="pe-photo__detail">Reading…</span>}
                  {input.status === 'error' && <span className="pe-photo__detail pe-note--error">{input.error}</span>}
                  {input.status === 'ready' && complete && (
                    <label className="pe-field pe-field--inline pe-bracket__role">
                      <span>Exposure</span>
                      <select value={input.role ?? ''} disabled={running} onChange={(event) => setRole(input.key, event.target.value)}>
                        {!input.role && <option value="">Choose…</option>}
                        {ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
                      </select>
                    </label>
                  )}
                </span>
                <span className="pe-bracket__actions">
                  <button type="button" className="pe-text-button" disabled={running} onClick={() => { replaceKey.current = input.key; replaceRef.current?.click(); }} aria-label={`Replace ${input.name ?? 'photo'}`}>Replace</button>
                  <button type="button" className="pe-text-button" disabled={running} onClick={() => remove(input.key)} aria-label={`Remove ${input.name ?? 'photo'} from the bracket`}>Remove</button>
                </span>
              </li>
            ))}
          </ul>

          {inputs.length < BRACKET_SIZE && (
            <div className="pe-bracket__add">
              <button type="button" className="pe-button pe-button--primary" onClick={() => fileRef.current?.click()}>Choose {BRACKET_SIZE - inputs.length === BRACKET_SIZE ? 'three photos' : `${BRACKET_SIZE - inputs.length} more`}…</button>
              {workspace.length > 0 && (
                <fieldset className="pe-group pe-bracket__workspace">
                  <legend>Or use photos already imported</legend>
                  {workspace.map((photo) => (
                    <button key={photo.id} type="button" className="pe-text-button" disabled={inWorkspace.has(photo.id)} onClick={() => add([describe(photo.id)])}>{photo.name}</button>
                  ))}
                </fieldset>
              )}
            </div>
          )}
          <input ref={fileRef} type="file" accept={accept} multiple hidden onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }} />
          <input ref={replaceRef} type="file" accept={accept} hidden onChange={(event) => { replace(event.target.files[0]); event.target.value = ''; }} />

          {complete && (
            <>
              {suggestion && <p className="pe-note">{suggestion === 'metadata' ? 'Roles suggested from the recorded exposure (shutter, aperture, ISO).' : suggestion === 'brightness' ? 'No usable exposure data: roles were suggested from brightness. Check them.' : 'Roles restored from the saved merge.'} Change them if needed.</p>}
              {mode && <p className="pe-note"><strong>{mode === 'radiance' ? 'RAW HDR merge' : 'Exposure fusion'}:</strong> {mode === 'radiance' ? 'the sensor data of the three exposures is combined into one high-dynamic-range image, then tone mapped.' : 'these files are already processed, so the editor blends their best-exposed parts instead of reconstructing scene brightness.'}</p>}
              {validation.errors.map((text) => <p key={text} className="pe-note pe-note--error" role="alert">{text}</p>)}
              {validation.warnings.map((text) => <p key={text} className="pe-note pe-note--warning">{text}</p>)}

              <fieldset className="pe-group" disabled={running}>
                <legend>Align and merge</legend>
                <label className="pe-check"><input type="checkbox" checked={settings.align} onChange={(event) => setSettings({ ...settings, align: event.target.checked })} /> Align photos automatically (hand-held shots)</label>
                <label className="pe-check"><input type="checkbox" checked={settings.deghost} onChange={(event) => setSettings({ ...settings, deghost: event.target.checked })} /> Reduce ghosting from moving subjects</label>
                {settings.deghost && (
                  <label className="pe-field">
                    <span>Ghost reduction strength <output className="mono">{settings.deghostStrength}</output></span>
                    <input className="pe-range" type="range" min="0" max="100" step="1" value={settings.deghostStrength} onChange={(event) => setSettings({ ...settings, deghostStrength: Number(event.target.value) })} />
                  </label>
                )}
              </fieldset>
            </>
          )}
          {error && <p className="pe-note pe-note--error" role="alert">{error}</p>}
          {run?.state === 'cancelled' && <p className="pe-note" role="status">Merge cancelled.</p>}
        </div>

        <footer className="pe-dialog__foot">
          {running ? (
            <>
              <progress max="1" value={run.fraction ?? 0} aria-label="Merge progress" />
              <span role="status">{STAGES[run.stage] ?? 'Working'}{run.stage === 'decoding' && Number.isInteger(run.index) ? ` photo ${run.index + 1} of 3` : ''}…</span>
              <button type="button" className="pe-button" onClick={() => jobRef.current?.cancel()}>Cancel</button>
            </>
          ) : (
            <>
              <button type="button" className="pe-button" onClick={close}>Close</button>
              <button type="button" className="pe-button pe-button--primary" disabled={!complete || !validation || validation.errors.length > 0 || !rolesComplete(inputs.map(({ role }) => role))} onClick={startMerge}>Merge</button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
