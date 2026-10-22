import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { activePhoto, editorReducer, initialEditorState } from '../model/editorState.mjs';
import { canRedo, canUndo } from '../model/history.mjs';
import { createEditDocument, parseEditDocument, serializeEditDocument } from '../model/editDocument.mjs';
import { neutralAdjustments } from '../model/adjustments.mjs';
import { LIMITS, exportFileName, formatBytes, proxyDimensions } from '../io/files.mjs';
import { FORMATS } from '../io/imageHeader.mjs';
import { createImageWorker } from '../io/workerClient.mjs';
import { appHref } from '../../util/navigation';
import AdjustPanel from './AdjustPanel';
import ExportPanel from './ExportPanel';
import PhotoThumb from './PhotoThumb';
import Viewer from './Viewer';
import './editor.css';

export const AUTOSAVE_KEY = 'photo-editor:edits:v1';
const THUMBNAIL_EDGE = 320;
const PROXY_CACHE_SIZE = 2;
const ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
const EDITOR_THEME_COLOR = '#151515';

const newId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `photo-${Date.now()}-${Math.random().toString(36).slice(2)}`);

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke after the browser has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function readAutosave() {
  try {
    const text = localStorage.getItem(AUTOSAVE_KEY);
    return text ? parseEditDocument(text) : null;
  } catch {
    return null;
  }
}

function unsupportedEncoders() {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    return Object.entries(FORMATS).filter(([, format]) => !canvas.toDataURL(format.mime).startsWith(`data:${format.mime}`)).map(([key]) => key);
  } catch {
    return [];
  }
}

const isTextField = (element) => element?.matches?.('input:not([type=range]):not([type=radio]):not([type=checkbox]), textarea, select, [contenteditable="true"]');
const isControl = (element) => element?.matches?.('input, textarea, select, [role="slider"], [contenteditable="true"]');

/** The public photo editor. Everything runs in this browser tab; nothing is uploaded. */
export default function EditorApp() {
  const [state, dispatch] = useReducer(editorReducer, undefined, initialEditorState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const resources = useRef(new Map());
  const proxyCache = useRef(new Map());
  const workers = useRef({});
  const proxyJob = useRef({ busy: false, generation: 0 });
  const exportJob = useRef(null);
  const fileInputRef = useRef(null);
  const editsInputRef = useRef(null);
  const [compare, setCompare] = useState('edited');
  const [split, setSplit] = useState(0.5);
  const [notice, setNotice] = useState(null);
  const [dragDepth, setDragDepth] = useState(0);
  const [mobilePanel, setMobilePanel] = useState('adjust');
  const [zoomCommand, setZoomCommand] = useState(null);
  const [engine, setEngine] = useState(null);
  const [restoredCount, setRestoredCount] = useState(0);
  const unsupportedFormats = useMemo(unsupportedEncoders, []);

  const photo = activePhoto(state);
  const adjustments = photo?.history.present ?? neutralAdjustments();
  const ready = photo?.status === 'ready';
  const importing = state.photos.filter(({ status }) => status === 'importing').length;
  const exporting = state.photos.some(({ exportStatus }) => exportStatus.state === 'running');

  const worker = useCallback((name) => {
    workers.current[name] ??= createImageWorker();
    return workers.current[name];
  }, []);

  // Dark workspace chrome and worker cleanup for the lifetime of the page.
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const previous = meta?.getAttribute('content');
    meta?.setAttribute('content', EDITOR_THEME_COLOR);
    document.documentElement.classList.add('pe-document');
    const pool = workers.current;
    return () => {
      if (previous) meta?.setAttribute('content', previous);
      document.documentElement.classList.remove('pe-document');
      Object.values(pool).forEach((client) => client.terminate());
      exportJob.current?.client.terminate();
    };
  }, []);

  // Saved edits from an earlier visit wait for their originals to be reimported.
  useEffect(() => {
    const saved = readAutosave();
    if (saved?.photos.length) {
      dispatch({ type: 'loadDocument', document: saved });
      setRestoredCount(saved.photos.length);
    }
  }, []);

  // Autosave adjustment values (never pixels) so a reload keeps them.
  useEffect(() => {
    const timer = setTimeout(() => {
      const photos = state.photos.filter(({ status }) => status === 'ready').map((item) => ({ ...item, adjustments: item.history.present }));
      const waiting = state.pendingEdits.map(({ source, adjustments: values }) => ({ ...source, adjustments: values }));
      try {
        if (!photos.length && !waiting.length) localStorage.removeItem(AUTOSAVE_KEY);
        else localStorage.setItem(AUTOSAVE_KEY, serializeEditDocument(createEditDocument([...photos, ...waiting], state.exportSettings)));
      } catch { /* storage unavailable: editing still works without restore */ }
    }, 400);
    return () => clearTimeout(timer);
  }, [state.photos, state.pendingEdits, state.exportSettings]);

  const importFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;
    const room = LIMITS.maxPhotos - stateRef.current.photos.length;
    const accepted = files.slice(0, Math.max(0, room));
    if (accepted.length < files.length) setNotice({ tone: 'warning', text: `The workspace holds up to ${LIMITS.maxPhotos} photographs; ${files.length - accepted.length} were not added.` });
    const entries = accepted.map((file) => ({ id: newId(), name: file.name, size: file.size, lastModified: file.lastModified }));
    entries.forEach((entry, index) => resources.current.set(entry.id, { file: accepted[index] }));
    dispatch({ type: 'photosAdded', photos: entries });

    for (const entry of entries) {
      const resource = resources.current.get(entry.id);
      if (!resource) continue;
      try {
        const { header, sha256, thumbnail } = await worker('import').call('inspect', { file: resource.file, thumbnailEdge: THUMBNAIL_EDGE });
        if (!resources.current.has(entry.id)) continue;
        const duplicate = sha256 && [...resources.current.entries()].find(([id, other]) => id !== entry.id && other.sha256 === sha256);
        if (duplicate) {
          const original = stateRef.current.photos.find(({ id }) => id === duplicate[0]);
          resources.current.delete(entry.id);
          dispatch({ type: 'importFailed', id: entry.id, error: `Already in the workspace${original ? ` as ${original.name}` : ''}.`, code: 'duplicate' });
          continue;
        }
        Object.assign(resource, { header, sha256, thumbnail });
        dispatch({
          type: 'importSucceeded',
          id: entry.id,
          info: { format: header.format, width: header.displayWidth, height: header.displayHeight, orientation: header.orientation, sha256 },
        });
      } catch (error) {
        resources.current.delete(entry.id);
        dispatch({ type: 'importFailed', id: entry.id, error: error.message || 'This file could not be read.' });
      }
    }
  }, [worker]);

  const loadProxy = useCallback(async (target, maxEdge) => {
    const key = `${target.id}:${maxEdge}`;
    const cache = proxyCache.current;
    if (cache.has(key)) {
      const image = cache.get(key);
      cache.delete(key);
      cache.set(key, image);
      return image;
    }
    const resource = resources.current.get(target.id);
    if (!resource?.header) throw new Error('The original file is no longer available.');
    // One decode at a time: a newer request terminates the older one.
    const job = proxyJob.current;
    if (workers.current.proxy && job.busy) {
      workers.current.proxy.terminate();
      workers.current.proxy = null;
    }
    const generation = (job.generation += 1);
    job.busy = true;
    const size = proxyDimensions({ width: resource.header.displayWidth, height: resource.header.displayHeight }, maxEdge);
    try {
      const image = await worker('proxy').call('decode', { file: resource.file, header: resource.header, width: size.width, height: size.height });
      if (resources.current.has(target.id)) {
        cache.set(key, image);
        while (cache.size > PROXY_CACHE_SIZE) cache.delete(cache.keys().next().value);
      }
      return image;
    } finally {
      if (generation === job.generation) job.busy = false;
    }
  }, [worker]);

  const renderInWorker = useCallback((image, values) => worker('render').call('render', { source: image, adjustments: values }), [worker]);
  const onEngine = useCallback((info) => setEngine(info), []);

  const removePhoto = useCallback((id) => {
    resources.current.delete(id);
    [...proxyCache.current.keys()].filter((key) => key.startsWith(`${id}:`)).forEach((key) => proxyCache.current.delete(key));
    if (exportJob.current?.id === id) exportJob.current.client.terminate();
    dispatch({ type: 'remove', id });
  }, []);

  const exportActive = useCallback(async () => {
    const target = activePhoto(stateRef.current);
    const resource = target && resources.current.get(target.id);
    if (!resource?.header || exportJob.current) return;
    const settings = stateRef.current.exportSettings;
    const client = createImageWorker();
    exportJob.current = { id: target.id, client };
    dispatch({ type: 'exportStatus', id: target.id, status: { state: 'running', stage: 'decoding', fraction: 0 } });
    performance.mark('pe-export-start');
    try {
      const result = await client.call('export', {
        file: resource.file,
        header: resource.header,
        adjustments: target.history.present,
        settings,
      }, { onProgress: (progress) => dispatch({ type: 'exportStatus', id: target.id, status: { state: 'running', ...progress } }) });
      performance.measure('pe-export', 'pe-export-start');
      const fileName = exportFileName(target.name, settings.format, settings.suffix);
      downloadBlob(result.blob, fileName);
      dispatch({ type: 'exportStatus', id: target.id, status: { state: 'done', fileName, width: result.width, height: result.height, bytes: result.blob.size, timings: result.timings } });
    } catch (error) {
      dispatch({ type: 'exportStatus', id: target.id, status: error.code === 'cancelled' ? { state: 'cancelled' } : { state: 'error', message: error.message } });
    } finally {
      client.terminate();
      exportJob.current = null;
    }
  }, []);

  const cancelExport = useCallback(() => exportJob.current?.client.terminate(), []);

  const saveEdits = () => {
    const photos = state.photos.filter(({ status }) => status === 'ready').map((item) => ({ ...item, adjustments: item.history.present }));
    const text = serializeEditDocument(createEditDocument(photos, state.exportSettings));
    const date = new Date().toISOString().slice(0, 10);
    downloadBlob(new Blob([text], { type: 'application/json' }), `photo-edits-${date}.json`);
    setNotice({ tone: 'info', text: `Saved edit settings for ${photos.length} photograph${photos.length === 1 ? '' : 's'}. The file contains settings only, not images.` });
  };

  const openEdits = async (file) => {
    if (!file) return;
    try {
      const document = parseEditDocument(await file.text());
      dispatch({ type: 'loadDocument', document });
      const matched = document.photos.filter((entry) => stateRef.current.photos.some((item) => item.status === 'ready'
        && (entry.source.sha256 && item.sha256 ? entry.source.sha256 === item.sha256 : entry.source.name === item.name && entry.source.size === item.size))).length;
      const waiting = document.photos.length - matched;
      setNotice({
        tone: 'info',
        text: `Applied saved edits to ${matched} of ${document.photos.length} photograph${document.photos.length === 1 ? '' : 's'}.${waiting ? ` Import the original file${waiting === 1 ? '' : 's'} for the other ${waiting}; the edits apply when the same file is added.` : ''}`,
      });
      setRestoredCount(0);
    } catch (error) {
      setNotice({ tone: 'error', text: error.message });
    }
  };

  const discardSaved = () => {
    dispatch({ type: 'dismissPendingEdits' });
    setRestoredCount(0);
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* ignore */ }
  };

  // Keyboard shortcuts. Text fields keep their own undo and arrow keys.
  useEffect(() => {
    const onKey = (event) => {
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && (key === 'z' || key === 'y')) {
        if (isTextField(event.target)) return;
        event.preventDefault();
        dispatch({ type: (key === 'y' || event.shiftKey) ? 'redo' : 'undo' });
        return;
      }
      if (mod || event.altKey || isControl(event.target)) return;
      if (event.key === '\\') setCompare((value) => (value === 'original' ? 'edited' : 'original'));
      else if (key === 'y') setCompare((value) => (value === 'split' ? 'edited' : 'split'));
      else if (event.key === 'ArrowLeft') dispatch({ type: 'selectOffset', offset: -1 });
      else if (event.key === 'ArrowRight') dispatch({ type: 'selectOffset', offset: 1 });
      else if (event.key === '+' || event.key === '=') setZoomCommand({ type: 'in', at: Date.now() });
      else if (event.key === '-') setZoomCommand({ type: 'out', at: Date.now() });
      else if (event.key === '0') setZoomCommand({ type: 'fit', at: Date.now() });
      else if (event.key === '1') setZoomCommand({ type: 'actual', at: Date.now() });
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const dragHandlers = {
    onDragEnter: (event) => { if ([...event.dataTransfer.types].includes('Files')) { event.preventDefault(); setDragDepth((depth) => depth + 1); } },
    onDragOver: (event) => { if ([...event.dataTransfer.types].includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } },
    onDragLeave: () => setDragDepth((depth) => Math.max(0, depth - 1)),
    onDrop: (event) => { event.preventDefault(); setDragDepth(0); importFiles(event.dataTransfer.files); },
  };

  const openPicker = () => fileInputRef.current?.click();
  // Rendered in the top bar on wide screens and in the Export panel on phones.
  const sessionButtons = (className) => (
    <div className={className}>
      <button type="button" className="pe-button" onClick={saveEdits} disabled={!readyCount}>Save edits</button>
      <button type="button" className="pe-button" onClick={() => editsInputRef.current?.click()}>Open edits</button>
    </div>
  );
  const history = photo?.history;
  const readyCount = state.photos.filter(({ status }) => status === 'ready').length;

  const photoList = (variant) => state.photos.map((item, index) => {
    const resource = resources.current.get(item.id);
    const active = item.id === state.activeId;
    return (
      <li key={item.id} className={`pe-photo pe-photo--${variant}`} data-active={active || undefined} data-status={item.status}>
        <button
          type="button"
          className="pe-photo__select"
          aria-pressed={active}
          aria-label={`${item.name}${item.status === 'error' ? ' (failed)' : item.status === 'importing' ? ' (importing)' : ''}, photo ${index + 1} of ${state.photos.length}`}
          onClick={() => dispatch({ type: 'select', id: item.id })}
        >
          <span className="pe-photo__frame">
            {resource?.thumbnail ? <PhotoThumb thumbnail={resource.thumbnail} adjustments={item.history.present} /> : <span className="pe-photo__placeholder" aria-hidden="true">{item.status === 'error' ? '!' : <span className="pe-spinner" />}</span>}
          </span>
          {variant === 'list' && (
            <span className="pe-photo__meta">
              <span className="pe-photo__name">{item.name}</span>
              <span className="pe-photo__detail mono">
                {item.status === 'ready' && `${item.width}×${item.height} · ${FORMATS[item.format].label} · ${formatBytes(item.size)}`}
                {item.status === 'importing' && 'Reading…'}
                {item.status === 'error' && item.error}
              </span>
              {item.restored && <span className="pe-photo__badge">Saved edits applied</span>}
            </span>
          )}
        </button>
        {variant === 'list' && (
          <button type="button" className="pe-icon-button pe-photo__remove" onClick={() => removePhoto(item.id)} aria-label={`Remove ${item.name} from the workspace`} title="Remove from workspace">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        )}
      </li>
    );
  });

  return (
    <div className="pe" data-engine={engine?.kind} data-mobile-panel={mobilePanel} data-dragging={dragDepth > 0 || undefined} {...dragHandlers}>
      <a className="skip-link" href="#pe-workspace">Skip to workspace</a>
      <header className="pe-bar">
        <a className="pe-back" href={appHref('/photography/')}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>Photography</span>
        </a>
        <h1 className="pe-title">Photo editor</h1>
        <p className="pe-privacy"><span className="pe-privacy__dot" aria-hidden="true" />Processed on this device. Nothing is uploaded.</p>
        <div className="pe-bar__actions">
          <button type="button" className="pe-icon-button" onClick={() => dispatch({ type: 'undo' })} disabled={!history || !canUndo(history)} aria-label="Undo" title="Undo (Ctrl+Z)" aria-keyshortcuts="Control+Z Meta+Z">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.5L2.5 6.5l3 3M3 6.5h6.5a4 4 0 0 1 0 8H7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button type="button" className="pe-icon-button" onClick={() => dispatch({ type: 'redo' })} disabled={!history || !canRedo(history)} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 3.5l3 3-3 3M13 6.5H6.5a4 4 0 0 0 0 8H9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div className="pe-compare" role="group" aria-label="Compare">
            {[['edited', 'Edited'], ['original', 'Original'], ['split', 'Split']].map(([value, label]) => (
              <button key={value} type="button" aria-pressed={compare === value} disabled={!ready} onClick={() => setCompare(value)}>{label}</button>
            ))}
          </div>
          {sessionButtons('pe-session')}
          <input ref={editsInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => { openEdits(event.target.files[0]); event.target.value = ''; }} />
        </div>
      </header>

      {(notice || state.pendingEdits.length > 0) && (
        <div className="pe-notices">
          {notice && (
            <p className={`pe-notice pe-notice--${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
              <span>{notice.text}</span>
              <button type="button" className="pe-text-button" onClick={() => setNotice(null)}>Dismiss</button>
            </p>
          )}
          {state.pendingEdits.length > 0 && (
            <div className="pe-notice pe-notice--info" role="status">
              <span>
                {restoredCount ? 'Edits from your last visit are kept in this browser (settings only, not images). ' : ''}
                Reimport the original file{state.pendingEdits.length === 1 ? '' : 's'} to continue: {state.pendingEdits.slice(0, 4).map(({ source }) => source.name).join(', ')}
                {state.pendingEdits.length > 4 ? ` and ${state.pendingEdits.length - 4} more` : ''}.
              </span>
              <span className="pe-notice__actions">
                <button type="button" className="pe-text-button" onClick={openPicker}>Import</button>
                <button type="button" className="pe-text-button" onClick={discardSaved}>Discard saved edits</button>
              </span>
            </div>
          )}
        </div>
      )}

      <aside className="pe-library" aria-labelledby="pe-library-title">
        <div className="pe-panel__head">
          <h2 id="pe-library-title">Photos <span className="pe-count mono">{readyCount}</span></h2>
          <button type="button" className="pe-button pe-button--primary" onClick={openPicker}>Import</button>
        </div>
        <input ref={fileInputRef} type="file" accept={ACCEPT} multiple hidden onChange={(event) => { importFiles(event.target.files); event.target.value = ''; }} />
        {state.photos.length ? (
          <ul className="pe-photo-list">{photoList('list')}</ul>
        ) : (
          <p className="pe-note">JPEG, PNG or WebP, up to {LIMITS.maxPixels / 1e6} MP and {LIMITS.maxFileBytes / (1024 * 1024)} MB each. Drag files anywhere onto the editor.</p>
        )}
      </aside>

      <main className="pe-stage" id="pe-workspace" tabIndex={-1}>
        <h2 className="visually-hidden">Preview</h2>
        <Viewer
          photo={photo}
          adjustments={adjustments}
          compare={compare}
          split={split}
          onSplitChange={setSplit}
          loadProxy={loadProxy}
          renderInWorker={renderInWorker}
          onEngine={onEngine}
          zoomCommand={zoomCommand}
        />
        {!state.photos.length && (
          <div className="pe-empty">
            <p className="pe-empty__title">Edit photographs in your browser</p>
            <p>Drop JPEG, PNG or WebP files here, or</p>
            <button type="button" className="pe-button pe-button--primary pe-button--large" onClick={openPicker}>Choose photos</button>
            <p className="pe-note">Your photographs are decoded, edited and exported on this device. They are never uploaded, and no account is needed.</p>
          </div>
        )}
        <div className="pe-zoom" role="group" aria-label="Zoom">
          <button type="button" className="pe-icon-button" disabled={!ready} onClick={() => setZoomCommand({ type: 'out', at: Date.now() })} aria-label="Zoom out" title="Zoom out (−)">−</button>
          <button type="button" className="pe-text-button" disabled={!ready} onClick={() => setZoomCommand({ type: 'fit', at: Date.now() })} title="Fit to screen (0)">Fit</button>
          <button type="button" className="pe-text-button" disabled={!ready} onClick={() => setZoomCommand({ type: 'actual', at: Date.now() })} title="Actual pixels (1)">100%</button>
          <button type="button" className="pe-icon-button" disabled={!ready} onClick={() => setZoomCommand({ type: 'in', at: Date.now() })} aria-label="Zoom in" title="Zoom in (+)">+</button>
        </div>
      </main>

      <aside className="pe-inspector" aria-label="Adjustments and export">
        <div className="pe-inspector__section" data-section="adjust">
          <AdjustPanel adjustments={adjustments} disabled={!ready} dispatch={dispatch} />
        </div>
        <div className="pe-inspector__section" data-section="export">
          <ExportPanel
            settings={state.exportSettings}
            photo={photo}
            dispatch={dispatch}
            onExport={exportActive}
            onCancel={cancelExport}
            unsupportedFormats={unsupportedFormats}
            busy={exporting}
          />
          {sessionButtons('pe-session pe-session--panel')}
        </div>
        <details className="pe-shortcuts">
          <summary>Keyboard shortcuts</summary>
          <dl>
            <div><dt>Ctrl/⌘ Z, Ctrl/⌘ Shift Z</dt><dd>Undo, redo</dd></div>
            <div><dt>\</dt><dd>Show original</dd></div>
            <div><dt>Y</dt><dd>Split before/after</dd></div>
            <div><dt>← →</dt><dd>Previous, next photo</dd></div>
            <div><dt>+ − 0 1</dt><dd>Zoom in, out, fit, 100%</dd></div>
            <div><dt>Double-click a label</dt><dd>Reset that adjustment</dd></div>
          </dl>
          {engine && <p className="pe-note">Preview: {engine.kind === 'webgl2' ? 'WebGL2' : 'CPU'}, up to {engine.maxEdge} px. Exports are rendered on the CPU at full resolution.</p>}
        </details>
      </aside>

      <nav className="pe-filmstrip" aria-label="Filmstrip">
        <ul className="pe-filmstrip__list">{photoList('strip')}</ul>
        <p className="pe-filmstrip__status mono" role="status">
          {importing ? `Importing ${importing} file${importing === 1 ? '' : 's'}…` : readyCount ? `${state.photos.findIndex(({ id }) => id === state.activeId) + 1} / ${state.photos.length}` : ''}
        </p>
        <button type="button" className="pe-icon-button pe-filmstrip__add" onClick={openPicker} aria-label="Import photos">+</button>
      </nav>

      <nav className="pe-tabs" aria-label="Editor panels">
        {[['library', 'Photos'], ['adjust', 'Adjust'], ['export', 'Export']].map(([value, label]) => (
          <button key={value} type="button" aria-pressed={mobilePanel === value} onClick={() => setMobilePanel(value)}>{label}</button>
        ))}
      </nav>

      {dragDepth > 0 && <div className="pe-drop" aria-hidden="true"><p>Drop to import. Files stay on this device.</p></div>}
    </div>
  );
}
