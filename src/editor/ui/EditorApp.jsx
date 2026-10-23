import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { activePhoto, editorReducer, initialEditorState } from '../model/editorState.mjs';
import { canRedo, canUndo } from '../model/history.mjs';
import { createEditDocument, parseEditDocument, serializeEditDocument } from '../model/editDocument.mjs';
import { neutralAdjustments } from '../model/adjustments.mjs';
import { PRESETS_STORAGE_KEY, applyPreset, parsePresetFile, serializePresets } from '../model/presets.mjs';
import { LIMITS, exportFileName, formatBytes, previewEdgeLimit, proxyDimensions } from '../io/files.mjs';
import { FORMATS } from '../io/imageHeader.mjs';
import { createImageWorker, usingMainThread } from '../io/workerClient.mjs';
import { RAW_FORMATS, RAW_SNIFF_BYTES, isTiff } from '../raw/rawFormat.mjs';
import { createRawQueue, exportRaw } from '../raw/rawClient.mjs';
import { browserCapabilities, diagnosticReport } from '../io/diagnostics.mjs';
import { readRasterExposure } from '../hdr/hdrMetadata.mjs';
import { cropAt } from '../hdr/hdrAlign.mjs';
import { bracketSize, checkHdrExport, createHdrJob, exportHdr, mergePreview } from '../hdr/hdrClient.mjs';
import { hdrIdentity, hdrPhotoName } from '../hdr/hdrSource.mjs';
import { appHref } from '../../util/navigation';
import AdjustPanel from './AdjustPanel';
import ExportPanel from './ExportPanel';
import HdrMergeDialog from './HdrMergeDialog';
import PhotoThumb from './PhotoThumb';
import Viewer from './Viewer';
import './editor.css';

export const AUTOSAVE_KEY = 'photo-editor:edits:v1';
const THUMBNAIL_EDGE = 320;
const PROXY_CACHE_SIZE = 2;
const ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp,.arw,.dng,image/x-sony-arw,image/x-adobe-dng';
const formatLabel = (format) => (format === 'hdr' ? 'HDR merge' : FORMATS[format]?.label ?? RAW_FORMATS[format]?.label ?? format);
const IMPORT_PROGRESS = { waiting: 'Waiting for the RAW decoder…', decoding: 'Decoding RAW sensor data…' };
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

// User presets live in this browser only, as a preset pack.
function readPresets() {
  try {
    const text = localStorage.getItem(PRESETS_STORAGE_KEY);
    return text ? parsePresetFile(text).map((preset) => ({ ...preset, id: newId() })) : [];
  } catch {
    return [];
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

function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return Promise.reject(new Error('Clipboard unavailable'));
}

/** Local diagnostics: browser support, preview engine and recorded failures. Never uploaded. */
export function DiagnosticsPanel({ engine }) {
  const [report, setReport] = useState(null);
  const [copied, setCopied] = useState(null);
  const extra = { previewEngine: engine?.kind ?? null, previewMaxEdge: engine?.maxEdge ?? null, previewFallbackReason: engine?.reason ?? null, imageTasks: usingMainThread() ? 'main thread' : 'worker' };
  return (
    <details className="pe-shortcuts pe-diagnostics" onToggle={(event) => event.currentTarget.open && setReport(diagnosticReport(extra))}>
      <summary>Diagnostics</summary>
      <p className="pe-note">Browser support and startup problems, kept on this device. Contains no photos or file names.</p>
      {report && <textarea className="pe-diagnostics__report mono" readOnly value={report} aria-label="Diagnostics report" rows={8} onFocus={(event) => event.target.select()} />}
      <button
        type="button"
        className="pe-text-button"
        onClick={() => {
          const text = diagnosticReport(extra);
          setReport(text);
          copyText(text).then(() => setCopied('Copied.'), () => setCopied('Select the text above and copy it.'));
        }}
      >
        Copy diagnostics
      </button>
      {copied && <span className="pe-note" role="status"> {copied}</span>}
    </details>
  );
}

/** Shown instead of the workspace when a browser lacks an API the editor cannot work without. */
function Unsupported({ missing }) {
  return (
    <div className="pe pe--unsupported">
      <header className="pe-bar">
        <a className="pe-back" href={appHref('/photography/')}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>Photography</span>
        </a>
        <h1 className="pe-title">Photo editor</h1>
      </header>
      <main className="pe-unsupported" role="alert">
        <p className="pe-empty__title">This browser cannot run the photo editor</p>
        <p>It is missing: {missing.join(', ')}.</p>
        <p className="pe-note">Update the browser or the device's operating system (iOS 15.4 or later, or a current Chrome, Edge, Firefox or Safari), then reload this page.</p>
        <DiagnosticsPanel engine={null} />
      </main>
    </div>
  );
}

/** Why an HDR export does not fit this device, with the largest size that does. */
const hdrMemoryMessage = ({ megabytes, suggestion }) => `An HDR export at this size needs about ${megabytes.toLocaleString('en-US')} MB of memory, more than this device can safely use. ${suggestion ? `Choose Long edge ${suggestion} px or smaller.` : 'Choose a smaller size.'}`;

/** The public photo editor. Everything runs in this browser tab; nothing is uploaded. */
export default function EditorApp() {
  const [capabilities] = useState(() => browserCapabilities());
  const unsupported = capabilities.missing.length > 0;
  // Tells the HTML-shell startup watchdog (public/photography/editor-startup.js) that a
  // visible editor or unsupported-browser page is on screen. Runs after the children mount.
  useEffect(() => {
    window.__editorStartup?.stage(unsupported ? `unsupported: ${capabilities.missing.join(', ')}` : 'editor mounted');
    document.documentElement.dataset.editor = unsupported ? 'unsupported' : 'ready';
    return () => { delete document.documentElement.dataset.editor; };
  }, [capabilities, unsupported]);
  if (unsupported) return <Unsupported missing={capabilities.missing} />;
  return <EditorWorkspace />;
}

function EditorWorkspace() {
  const [state, dispatch] = useReducer(editorReducer, undefined, initialEditorState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const resources = useRef(new Map());
  const proxyCache = useRef(new Map());
  const workers = useRef({});
  const proxyJob = useRef({ busy: false, generation: 0 });
  // RAW work runs in short-lived workers through one bounded queue.
  const rawQueue = useRef(null);
  const rawProxyJob = useRef(null);
  const raws = useCallback(() => {
    rawQueue.current ??= createRawQueue();
    return rawQueue.current;
  }, []);
  const exportJob = useRef(null);
  // A merged HDR's preview is re-merged from its sources when it left the proxy cache.
  const hdrProxyJob = useRef(null);
  const [hdrOpen, setHdrOpen] = useState(false);
  const hdrOpenRef = useRef(false);
  const bracketInspections = useRef(Promise.resolve());
  hdrOpenRef.current = hdrOpen;
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
  // .cube LUTs imported this session, by SHA-256. Never stored or uploaded.
  const [luts, setLuts] = useState(() => new Map());
  const [lutStatus, setLutStatus] = useState({ busy: false, error: null });
  const [userPresets, setUserPresets] = useState(readPresets);
  const [presetPreview, setPresetPreview] = useState(null);
  const imageKeys = useRef(new WeakMap());
  const renderState = useRef({ client: null, key: null, luts: new Set() });

  const photo = activePhoto(state);
  const adjustments = photo?.history.present ?? neutralAdjustments();
  const ready = photo?.status === 'ready';
  const lutFor = useCallback((settings) => (settings?.lut ? luts.get(settings.lut.sha256) ?? null : null), [luts]);
  // While a preset is hovered or focused, the preview shows it applied (nothing is recorded).
  const viewAdjustments = useMemo(() => (presetPreview && ready ? applyPreset(adjustments, presetPreview) : adjustments), [presetPreview, ready, adjustments]);
  const missingLut = ready && adjustments.lut && !luts.has(adjustments.lut.sha256) ? adjustments.lut : null;
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
      Object.values(pool).forEach((client) => client?.terminate());
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
        // Identified by content: TIFF-structured files go to the RAW decoder, which
        // accepts Sony ARW and DNG and explains anything else.
        const head = new Uint8Array(await resource.file.slice(0, RAW_SNIFF_BYTES).arrayBuffer());
        let inspected;
        if (isTiff(head)) {
          const job = raws().run('inspect', { file: resource.file, thumbnailEdge: THUMBNAIL_EDGE }, {
            onProgress: ({ stage }) => stage === 'decoding' && dispatch({ type: 'importProgress', id: entry.id, progress: 'decoding' }),
          });
          resource.job = job;
          dispatch({ type: 'importProgress', id: entry.id, progress: 'waiting' });
          inspected = await job.promise.finally(() => { resource.job = null; });
        } else {
          inspected = await worker('import').call('inspect', { file: resource.file, thumbnailEdge: THUMBNAIL_EDGE });
        }
        const { header, sha256, thumbnail, raw = null } = inspected;
        if (!resources.current.has(entry.id)) continue;
        const duplicate = sha256 && [...resources.current.entries()].find(([id, other]) => id !== entry.id && other.sha256 === sha256);
        if (duplicate) {
          const original = stateRef.current.photos.find(({ id }) => id === duplicate[0]);
          resources.current.delete(entry.id);
          dispatch({ type: 'importFailed', id: entry.id, error: `Already in the workspace${original ? ` as ${original.name}` : ''}.`, code: 'duplicate' });
          continue;
        }
        Object.assign(resource, { header, sha256, thumbnail, raw });
        dispatch({
          type: 'importSucceeded',
          id: entry.id,
          info: { format: header.format, width: header.displayWidth, height: header.displayHeight, orientation: header.orientation, sha256, raw },
        });
      } catch (error) {
        // Cancelled: the photo was removed while it was being read.
        if (error.code === 'cancelled' || !resources.current.has(entry.id)) continue;
        resources.current.delete(entry.id);
        dispatch({ type: 'importFailed', id: entry.id, error: error.message || 'This file could not be read.' });
      }
    }
  }, [worker, raws]);

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
    if (resource.hdr) {
      hdrProxyJob.current?.cancel();
      const job = createHdrJob();
      hdrProxyJob.current = job;
      const { inputs, mode, reference, settings } = resource.hdr;
      try {
        const { image } = await mergePreview(inputs, { mode, reference, settings, maxEdge, thumbnailEdge: THUMBNAIL_EDGE }, { rawQueue: raws(), job });
        if (resources.current.has(target.id)) {
          cache.set(key, image);
          while (cache.size > PROXY_CACHE_SIZE) cache.delete(cache.keys().next().value);
        }
        return image;
      } finally {
        if (hdrProxyJob.current === job) hdrProxyJob.current = null;
      }
    }
    if (resource.raw) {
      // Half-size sensor data (never the embedded JPEG); a newer request cancels this one.
      rawProxyJob.current?.cancel();
      const job = raws().run('decode', { file: resource.file, maxEdge });
      rawProxyJob.current = job;
      try {
        const image = await job.promise;
        if (resources.current.has(target.id)) {
          cache.set(key, image);
          while (cache.size > PROXY_CACHE_SIZE) cache.delete(cache.keys().next().value);
        }
        return image;
      } finally {
        if (rawProxyJob.current === job) rawProxyJob.current = null;
      }
    }
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
  }, [worker, raws]);

  // CPU preview: the worker keeps the proxy and LUT, so they are sent only when they
  // change (or the worker lost them), not on every render.
  // `detail` ({ edge, nativeWidth, nativeHeight }) renders Detail settings at that preview size.
  const renderInWorker = useCallback(async (image, values, lut, raw = null, detail = null) => {
    const client = worker('render');
    const sent = renderState.current;
    if (sent.client !== client) Object.assign(sent, { client, key: null, luts: new Set() });
    if (!imageKeys.current.has(image)) imageKeys.current.set(image, newId());
    const key = imageKeys.current.get(image);
    const call = (full) => client.call('render', {
      key,
      adjustments: values,
      raw,
      detail,
      ...(full || sent.key !== key ? { source: image } : {}),
      ...(lut ? { lut: full || !sent.luts.has(lut.sha256) ? lut : { sha256: lut.sha256 } } : {}),
    });
    let result;
    try {
      result = await call(false);
    } catch (error) {
      if (!/^stale-/.test(error.code)) throw error;
      result = await call(true);
    }
    sent.key = key;
    if (lut) sent.luts.add(lut.sha256);
    return result;
  }, [worker]);
  const onEngine = useCallback((info) => setEngine(info), []);
  const lutsRef = useRef(luts);
  lutsRef.current = luts;

  const removePhoto = useCallback((id) => {
    resources.current.get(id)?.job?.cancel();
    if (resources.current.get(id)?.hdr) hdrProxyJob.current?.cancel();
    resources.current.delete(id);
    [...proxyCache.current.keys()].filter((key) => key.startsWith(`${id}:`)).forEach((key) => proxyCache.current.delete(key));
    if (exportJob.current?.id === id) exportJob.current.client.terminate();
    dispatch({ type: 'remove', id });
    // With the workspace empty, end the idle workers so their heaps (decode buffers,
    // the cached CPU-preview proxy) are freed now rather than at the next collection.
    if (!resources.current.size) {
      ['proxy', 'render', 'import'].forEach((name) => {
        workers.current[name]?.terminate();
        workers.current[name] = null;
      });
      rawProxyJob.current?.cancel();
      proxyCache.current.clear();
    }
  }, []);

  const exportActive = useCallback(async () => {
    const target = activePhoto(stateRef.current);
    const resource = target && resources.current.get(target.id);
    if (!resource?.header || exportJob.current) return;
    const values = target.history.present;
    const lut = values.lut ? lutsRef.current.get(values.lut.sha256) : null;
    if (values.lut && !lut) {
      dispatch({ type: 'exportStatus', id: target.id, status: { state: 'error', message: `Import the LUT "${values.lut.name}" again, or remove it, before exporting.` } });
      return;
    }
    const settings = stateRef.current.exportSettings;
    const onProgress = (progress) => dispatch({ type: 'exportStatus', id: target.id, status: { state: 'running', ...progress } });
    if (resource.hdr) {
      const { inputs, analysis, mode } = resource.hdr;
      const check = checkHdrExport(mode, inputs, analysis, settings.resize);
      if (!check.fits) {
        dispatch({ type: 'exportStatus', id: target.id, status: { state: 'error', message: hdrMemoryMessage(check) } });
        return;
      }
      const job = createHdrJob();
      exportJob.current = { id: target.id, client: { terminate: () => job.cancel() } };
      dispatch({ type: 'exportStatus', id: target.id, status: { state: 'running', stage: 'decoding', index: 0, fraction: 0 } });
      performance.mark('pe-export-start');
      try {
        const result = await exportHdr(inputs, analysis, { adjustments: values, raw: target.raw, lut, settings }, { rawQueue: raws(), job, onProgress });
        performance.measure('pe-export', 'pe-export-start');
        const fileName = exportFileName(target.name, settings.format, settings.suffix);
        downloadBlob(result.blob, fileName);
        dispatch({ type: 'exportStatus', id: target.id, status: { state: 'done', fileName, width: result.width, height: result.height, bytes: result.blob.size, timings: result.timings, hdr: true } });
      } catch (error) {
        dispatch({ type: 'exportStatus', id: target.id, status: error.code === 'cancelled' ? { state: 'cancelled' } : { state: 'error', message: error.message } });
      } finally {
        job.cancel();
        exportJob.current = null;
      }
      return;
    }
    // A RAW export runs in the RAW queue; cancelling ends its worker.
    const rawJob = { job: null, cancelled: false };
    const client = resource.raw
      ? { terminate: () => { rawJob.cancelled = true; rawJob.job?.cancel(); } }
      : createImageWorker();
    exportJob.current = { id: target.id, client };
    dispatch({ type: 'exportStatus', id: target.id, status: { state: 'running', stage: 'decoding', fraction: 0 } });
    performance.mark('pe-export-start');
    try {
      const result = resource.raw
        ? await exportRaw(raws(), { file: resource.file, raw: resource.raw, adjustments: values, lut, settings }, {
          onProgress,
          onStart: (job) => {
            rawJob.job = job;
            if (rawJob.cancelled) job.cancel();
          },
        })
        : await client.call('export', { file: resource.file, header: resource.header, adjustments: values, lut, settings }, { onProgress });
      if (rawJob.cancelled) throw Object.assign(new Error('Cancelled.'), { code: 'cancelled' });
      performance.measure('pe-export', 'pe-export-start');
      const fileName = exportFileName(target.name, settings.format, settings.suffix);
      downloadBlob(result.blob, fileName);
      dispatch({ type: 'exportStatus', id: target.id, status: { state: 'done', fileName, width: result.width, height: result.height, bytes: result.blob.size, timings: result.timings, raw: Boolean(resource.raw) } });
    } catch (error) {
      dispatch({ type: 'exportStatus', id: target.id, status: error.code === 'cancelled' ? { state: 'cancelled' } : { state: 'error', message: error.message } });
    } finally {
      client.terminate();
      exportJob.current = null;
    }
  }, [raws]);

  const cancelExport = useCallback(() => exportJob.current?.client.terminate(), []);

  // Merge HDR inputs: new files are inspected like imports (hash, header, thumbnail,
  // exposure) without joining the workspace; workspace photos reuse what is known.
  const bracketInput = ({ file, header, sha256, thumbnail, raw = null, exposure = null, photoId = null }) => ({
    file,
    photoId,
    name: file.name,
    size: file.size,
    sha256: sha256 ?? null,
    header,
    raw,
    thumbnail,
    kind: raw ? 'raw' : 'raster',
    format: header.format,
    width: header.displayWidth,
    height: header.displayHeight,
    orientation: header.orientation,
    exposure: raw ? { shutter: raw.shutter, aperture: raw.aperture, iso: raw.iso, captured: raw.captured, model: raw.model } : exposure,
  });
  const rasterExposure = async (file) => readRasterExposure(new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer()));
  const inspectBracketFile = useCallback(async (file) => {
    const head = new Uint8Array(await file.slice(0, RAW_SNIFF_BYTES).arrayBuffer());
    if (isTiff(head)) {
      const { header, sha256, thumbnail, raw } = await raws().run('inspect', { file, thumbnailEdge: THUMBNAIL_EDGE }).promise;
      return bracketInput({ file, header, sha256, thumbnail, raw });
    }
    // One at a time, as imports do: where workers cannot decode, the first call switches
    // the client to the main thread, which would cancel calls already in flight.
    const run = bracketInspections.current.then(() => worker('import').call('inspect', { file, thumbnailEdge: THUMBNAIL_EDGE }));
    bracketInspections.current = run.catch(() => {});
    const { header, sha256, thumbnail } = await run;
    return bracketInput({ file, header, sha256, thumbnail, exposure: await rasterExposure(file) });
  }, [raws, worker]);
  const describeWorkspacePhoto = useCallback(async (id) => {
    const resource = resources.current.get(id);
    if (!resource?.header || resource.hdr) throw new Error('This photo is no longer available.');
    return bracketInput({ ...resource, photoId: id, exposure: resource.raw ? null : await rasterExposure(resource.file) });
  }, []);
  const mergeBracket = useCallback((inputs, settings, onProgress) => {
    const job = createHdrJob();
    const mode = inputs[0].raw ? 'radiance' : 'fusion';
    const reference = inputs.findIndex(({ role }) => role === 'normal');
    const maxEdge = engine?.maxEdge ?? previewEdgeLimit();
    const promise = mergePreview(inputs, { mode, reference, settings, maxEdge, thumbnailEdge: THUMBNAIL_EDGE }, { rawQueue: raws(), job, onProgress })
      .then((result) => {
        // Stage timings for the browser checks (local performance entries only).
        Object.entries(result.timings).forEach(([stage, duration]) => performance.measure?.(`pe-hdr-${stage}`, { start: 0, duration }));
        return { ...result, mode, reference, maxEdge };
      });
    return { promise, cancel: () => job.cancel() };
  }, [engine, raws]);
  // A finished merge becomes a photo of its own; the three inputs stay untouched.
  const addMergedPhoto = useCallback(async (result, inputs, settings) => {
    const { analysis, image, thumbnail, mode, reference, maxEdge } = result;
    const full = bracketSize(inputs);
    const crop = cropAt(analysis.crop, full.width, full.height);
    const id = newId();
    const name = hdrPhotoName(inputs[reference].name, stateRef.current.photos.map((item) => item.name));
    const sha256 = await hdrIdentity(mode, inputs);
    const raw = mode === 'radiance' ? { ...inputs[reference].raw, hdrWhite: analysis.white, width: crop.width, height: crop.height } : null;
    const hdr = {
      mode,
      inputs: inputs.map(({ name: inputName, size, sha256: hash, format, role }) => ({ name: inputName, size, sha256: hash, format, role })),
      settings,
      summary: { measuredStops: analysis.measuredStops, alignment: analysis.alignment, ghostFraction: analysis.ghost.fraction, warnings: analysis.warnings },
    };
    resources.current.set(id, { header: { format: 'hdr' }, sha256, thumbnail, hdr: { inputs, analysis, mode, reference, settings } });
    proxyCache.current.set(`${id}:${maxEdge}`, image);
    while (proxyCache.current.size > PROXY_CACHE_SIZE) proxyCache.current.delete(proxyCache.current.keys().next().value);
    const size = inputs.reduce((total, input) => total + input.size, 0);
    dispatch({ type: 'photosAdded', photos: [{ id, name, size, lastModified: 0 }] });
    dispatch({ type: 'importSucceeded', id, info: { format: 'hdr', width: crop.width, height: crop.height, orientation: 1, sha256, raw, hdr } });
    dispatch({ type: 'select', id });
    setHdrOpen(false);
    setNotice({ tone: 'info', text: `Merged ${name} (${crop.width}×${crop.height}${mode === 'fusion' ? ', exposure fusion' : ''}). The three originals are unchanged.` });
  }, []);

  // Parses a .cube off the main thread, adds it to this session's library and applies it
  // to the active photo. Photos waiting for this exact file (same hash) resolve too.
  const importLut = useCallback(async (file) => {
    setLutStatus({ busy: true, error: null });
    try {
      const lut = await worker('import').call('parseCube', { file });
      setLuts((current) => new Map(current).set(lut.sha256, lut));
      const target = activePhoto(stateRef.current);
      if (target?.status === 'ready') {
        dispatch({ type: 'applySettings', patch: { lut: { sha256: lut.sha256, name: lut.name, title: lut.title, size: lut.size } } });
      }
      setLutStatus({ busy: false, error: null });
    } catch (error) {
      setLutStatus({ busy: false, error: error.code === 'lut' ? error.message : `The LUT could not be read: ${error.message}` });
    }
  }, [worker]);

  const changePresets = useCallback((next) => {
    setUserPresets(next);
    try {
      if (next.length) localStorage.setItem(PRESETS_STORAGE_KEY, serializePresets(next));
      else localStorage.removeItem(PRESETS_STORAGE_KEY);
    } catch {
      setNotice({ tone: 'warning', text: 'This browser did not allow saving presets; they last until the page is closed. Export them to keep them.' });
    }
  }, []);

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
        if (hdrOpenRef.current) return;
        dispatch({ type: (key === 'y' || event.shiftKey) ? 'redo' : 'undo' });
        return;
      }
      if (mod || event.altKey || isControl(event.target) || hdrOpenRef.current) return;
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
  const pendingHdr = state.pendingEdits.filter(({ source }) => source.hdr);
  const activeResource = photo ? resources.current.get(photo.id) : null;
  const hdrExportCheck = useMemo(() => (ready && activeResource?.hdr
    ? checkHdrExport(activeResource.hdr.mode, activeResource.hdr.inputs, activeResource.hdr.analysis, state.exportSettings.resize)
    : null), [ready, activeResource, state.exportSettings.resize]);

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
            {resource?.thumbnail ? <PhotoThumb thumbnail={resource.thumbnail} adjustments={item.history.present} lut={lutFor(item.history.present)} raw={item.raw} /> : <span className="pe-photo__placeholder" aria-hidden="true">{item.status === 'error' ? '!' : <span className="pe-spinner" />}</span>}
          </span>
          {variant === 'list' && (
            <span className="pe-photo__meta">
              <span className="pe-photo__name">{item.name}</span>
              <span className="pe-photo__detail mono">
                {item.status === 'ready' && `${item.width}×${item.height} · ${formatLabel(item.format)} · ${formatBytes(item.size)}`}
                {item.status === 'importing' && (IMPORT_PROGRESS[item.progress] ?? 'Reading…')}
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
                Reimport the original file{state.pendingEdits.length === 1 ? '' : 's'} to continue: {state.pendingEdits.slice(0, 4).map(({ source }) => (source.hdr ? `${source.name} (Merge HDR again with ${source.hdr.inputs.map(({ name }) => name).join(', ')})` : source.name)).join(', ')}
                {state.pendingEdits.length > 4 ? ` and ${state.pendingEdits.length - 4} more` : ''}.
              </span>
              <span className="pe-notice__actions">
                <button type="button" className="pe-text-button" onClick={openPicker}>Import</button>
                {pendingHdr.length > 0 && <button type="button" className="pe-text-button" onClick={() => setHdrOpen(true)}>Merge HDR</button>}
                <button type="button" className="pe-text-button" onClick={discardSaved}>Discard saved edits</button>
              </span>
            </div>
          )}
        </div>
      )}

      <aside className="pe-library" aria-labelledby="pe-library-title">
        <div className="pe-panel__head">
          <h2 id="pe-library-title">Photos <span className="pe-count mono">{readyCount}</span></h2>
          <span className="pe-library__actions">
            <button type="button" className="pe-button" onClick={() => setHdrOpen(true)} title="Merge three exposures into one photo">Merge HDR</button>
            <button type="button" className="pe-button pe-button--primary" onClick={openPicker}>Import</button>
          </span>
        </div>
        <input ref={fileInputRef} type="file" accept={ACCEPT} multiple hidden onChange={(event) => { importFiles(event.target.files); event.target.value = ''; }} />
        {state.photos.length ? (
          <ul className="pe-photo-list">{photoList('list')}</ul>
        ) : (
          <p className="pe-note">JPEG, PNG, WebP, or RAW (Sony ARW, DNG), up to {LIMITS.maxPixels / 1e6} MP and {LIMITS.maxFileBytes / (1024 * 1024)} MB each. Drag files anywhere onto the editor.</p>
        )}
      </aside>

      <main className="pe-stage" id="pe-workspace" tabIndex={-1}>
        <h2 className="visually-hidden">Preview</h2>
        <Viewer
          photo={photo}
          adjustments={viewAdjustments}
          lut={lutFor(viewAdjustments)}
          previewing={presetPreview && ready ? presetPreview.name : null}
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
            <p>Drop JPEG, PNG, WebP or RAW (Sony ARW, DNG) files here, or</p>
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
          <AdjustPanel
            adjustments={adjustments}
            disabled={!ready}
            dispatch={dispatch}
            lut={{ library: [...luts.values()], onImport: importLut, status: lutStatus }}
            presets={{ userPresets, onChange: changePresets, onPreview: setPresetPreview, onDownload: downloadBlob, newId }}
            raw={ready ? photo.raw ?? null : null}
            hdr={ready ? photo.hdr ?? null : null}
          />
        </div>
        <div className="pe-inspector__section" data-section="export">
          <ExportPanel
            blockedReason={missingLut ? `The LUT "${missingLut.name}" is not loaded. Import it again (LUT section) or remove it to export.` : hdrExportCheck && !hdrExportCheck.fits ? hdrMemoryMessage(hdrExportCheck) : null}
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
        <DiagnosticsPanel engine={engine} />
        <p className="pe-note pe-notices-link">
          RAW decoding uses LibRaw (CDDL-1.0) and other open-source code. <a href={appHref('/photography/third-party-notices.txt')} target="_blank" rel="noopener">Open-source notices</a>
        </p>
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
      {hdrOpen && (
        <HdrMergeDialog
          accept={ACCEPT}
          onClose={() => setHdrOpen(false)}
          inspect={inspectBracketFile}
          describe={describeWorkspacePhoto}
          merge={mergeBracket}
          onMerged={addMergedPhoto}
          pending={pendingHdr}
          workspace={state.photos.filter((item) => item.status === 'ready' && item.format !== 'hdr')}
        />
      )}
    </div>
  );
}
