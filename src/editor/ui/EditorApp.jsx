import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { activePhoto, editorReducer, initialEditorState, selectedPhotos } from '../model/editorState.mjs';
import { canRedo, canUndo } from '../model/history.mjs';
import { createEditDocument, parseEditDocument, readEditDocumentFile, serializeEditDocument } from '../model/editDocument.mjs';
import { adjustmentsEqual, isNeutral, neutralAdjustments, normalizeAdjustments } from '../model/adjustments.mjs';
import { ASPECT_PRESETS, GeometryError, constrainGeometry, geometryEqual, parseAspect, setAspect, swapAspect, turnGeometry } from '../pipeline/geometry.mjs';
import { TURN_LEFT, TURN_RIGHT, aspectBase, aspectChoices } from './GeometryPanel';
import { DEFAULT_SYNC_GROUPS, planSync, sourceKind } from '../model/sync.mjs';
import { PRESETS_STORAGE_KEY, applyPreset, parsePresetFile, serializePresets, uniquePresetName } from '../model/presets.mjs';
import { MAX_RECIPES, RECIPES_STORAGE_KEY, parseRecipeLibrary, serializeRecipeLibrary } from '../model/recipes.mjs';
import { LIMITS, exportDimensions, exportFileName, exportGeometry, formatBytes, previewEdgeLimit, proxyDimensions } from '../io/files.mjs';
import { FORMATS } from '../io/imageHeader.mjs';
import { createImageWorker, usingMainThread } from '../io/workerClient.mjs';
import { detailWorkerCount, exportImageInBands } from '../io/detailPool.mjs';
import { deriveParams } from '../pipeline/spec.mjs';
import { renderRawRgba8 } from '../pipeline/cpuRenderer.mjs';
import { RAW_FORMATS, RAW_SNIFF_BYTES, isTiff } from '../raw/rawFormat.mjs';
import { constrainedDevice, createRawQueue, exportRaw } from '../raw/rawClient.mjs';
import { browserCapabilities, diagnosticReport } from '../io/diagnostics.mjs';
import { readRasterExposure } from '../hdr/hdrMetadata.mjs';
import { cropAt } from '../hdr/hdrAlign.mjs';
import { bracketSize, checkHdrExport, createHdrJob, exportHdr, hdrExportGeometry, mergePreview } from '../hdr/hdrClient.mjs';
import { batchFileNames, zipFileName } from '../batch/batchNames.mjs';
import { createExportBatch } from '../batch/exportBatch.mjs';
import { createZipArchive } from '../batch/zipArchive.mjs';
import { hdrIdentity, hdrPhotoName } from '../hdr/hdrSource.mjs';
import { appHref } from '../../util/navigation';
import { createTextOverlay } from '../model/overlays.mjs';
import { loadTextFonts } from '../text/fonts.mjs';
import { rasterizeTextLayer } from '../text/textRender.mjs';
import { WATERMARK_DEFAULTS, normalizeWatermark, watermarkActive } from '../watermark/watermark.mjs';
import { applyWatermark, loadWatermarkFonts } from '../watermark/watermarkRender.mjs';
import { createImageLayer, createAdjustmentLayer, insertLayer, layerAdjustments, layerLabel, settingsNeutral, updateLayer, visibleLayers } from '../model/layers.mjs';
import { rasterSize } from '../pipeline/layerTransform.mjs';
import { composeLayers } from '../io/composeLayers.mjs';
import { visibleLocals } from '../model/masks.mjs';
import { imageMaskMap } from '../pipeline/mask.mjs';
import { createRasterCache } from './layerRasters.mjs';
import LayersPanel, { newLayerId } from './LayersPanel';
import MaskPanel, { DEFAULT_BRUSH, DEFAULT_OVERLAY } from './MaskPanel';
import RetouchPanel from './RetouchPanel';
import { RETOUCH_DEFAULTS, RETOUCH_LIMITS, removeRetouchOperation, updateRetouchOperation } from '../model/retouch.mjs';
import { thumbnailSource } from './filterThumbs.mjs';
import AdjustPanel from './AdjustPanel';
import BatchDialog from './BatchDialog';
import BatchExportDialog from './BatchExportDialog';
import BatchPanel from './BatchPanel';
import ExportPanel from './ExportPanel';
import HdrMergeDialog from './HdrMergeDialog';
import PhotoThumb from './PhotoThumb';
import RecipeDialog from './RecipeDialog';
import Viewer from './Viewer';
import useFullscreen from '../../components/utilities/useFullscreen';
import './editor.css';

export const AUTOSAVE_KEY = 'photo-editor:edits:v1';
const THUMBNAIL_EDGE = 320;
const PROXY_CACHE_SIZE = 2;
const ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp,.arw,.nef,.dng,image/x-sony-arw,image/x-nikon-nef,image/x-adobe-dng';
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

// Saved QuangEdit Recipes: this browser only, validated again on every read.
function readRecipes() {
  try {
    const text = localStorage.getItem(RECIPES_STORAGE_KEY);
    return text ? parseRecipeLibrary(text).map((recipe) => ({ ...recipe, id: newId() })) : [];
  } catch {
    return [];
  }
}

// The watermark settings "Enable" starts from in the public editor: this browser's saved default
// (a per-viewer convenience), else the built-in HUYNH Photography preset.
const WATERMARK_DEFAULT_KEY = 'photo-editor:watermark-default:v1';
function readWatermarkDefault() {
  try {
    const text = localStorage.getItem(WATERMARK_DEFAULT_KEY);
    return (text && text.length < 4096 && normalizeWatermark({ ...JSON.parse(text), enabled: true })) || null;
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
/** Output size of an export of `target` with `settings` (its geometry and the resize). */
function outputSize(resource, target, settings) {
  const { geometry } = target.history.present;
  return resource.hdr
    ? hdrExportGeometry(resource.hdr.inputs, resource.hdr.analysis, settings.resize, geometry).output
    : exportGeometry(geometry, { width: target.width, height: target.height }, settings.resize).output;
}

// Actions the inspector panels send that edit the selected image or adjustment layer instead of the photo.
const LAYER_TARGETED = new Set(['previewAdjustment', 'setAdjustment', 'resetAdjustment', 'previewSettings', 'applySettings', 'applyPreset', 'resetGroup', 'resetAll']);

/**
 * :param props.host: optional embedding host (the local photography CMS); the public route
 *   passes none. { title, backHref, backLabel, privacyNote, load(): Promise<{ files, document }>,
 *   Panel: component given { photo, documentFor, render, openHdrMerge, restoreHdr, setNotice } }.

 *   With a host, the photo comes from host.load() and nothing is autosaved to this browser.
 */
export default function EditorApp({ host = null }) {
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
  return <EditorWorkspace host={host} />;
}

// Render settings for a host: full resolution, never resized, high-quality JPEG.
export const HOST_RENDER_SETTINGS = Object.freeze({ format: 'jpeg', quality: 0.95, resize: Object.freeze({ mode: 'original' }), suffix: '-quangedit' });

function EditorWorkspace({ host }) {
  const [state, dispatch] = useReducer(editorReducer, undefined, initialEditorState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const resources = useRef(new Map());
  const proxyCache = useRef(new Map());
  const workers = useRef({});
  const proxyJob = useRef({ busy: false, generation: 0 });
  // RAW work runs in short-lived workers through one queue, one decoder at a time.
  const rawQueue = useRef(null);
  const rawProxyJob = useRef(null);
  const raws = useCallback(() => {
    rawQueue.current ??= createRawQueue();
    return rawQueue.current;
  }, []);
  const exportJob = useRef(null);
  // The running batch export (exportBatch.mjs), if any; one export path runs at a time.
  const batchRef = useRef(null);
  const [batchRun, setBatchRun] = useState(null);
  const [batchDialog, setBatchDialog] = useState(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  // Copied settings (Copy edits): parameters only, with what kind of photo they came from.
  const [clipboard, setClipboard] = useState(null);
  // Touch selection mode: taps add or remove photos instead of opening them.
  const [selecting, setSelecting] = useState(false);
  // 1:1 inspection of the visible region (InspectView), and the crop decode in flight.
  const [inspecting, setInspecting] = useState(false);
  // Text tool: text objects can be moved, resized and rotated on the photo; one is selected.
  const [layerToolOn, setLayerToolOn] = useState(false);
  // The layer the panels edit (null: the Background, the photo itself).
  const [activeLayer, setActiveLayer] = useState(null);
  // Masks: the selected local adjustment, whether the selected layer's mask is edited, the
  // selected mask component, the tool on the photo, the brush and the overlay.
  const [activeLocal, setActiveLocal] = useState(null);
  const [layerMaskOn, setLayerMaskOn] = useState(false);
  const [maskComponent, setMaskComponent] = useState(null);
  const [maskTool, setMaskTool] = useState(null);
  const [brush, setBrush] = useState(DEFAULT_BRUSH);
  const [maskOverlay, setMaskOverlay] = useState(DEFAULT_OVERLAY);
  const [freeResize, setFreeResize] = useState(false);
  // Retouch: the tool on the photo, its brush, the clone source (one photo's, never carried to
  // another), whether the next tap sets that source, the selected operation and the last message.
  const [retouchTool, setRetouchTool] = useState(null);
  const [retouchBrush, setRetouchBrush] = useState(RETOUCH_DEFAULTS);
  const [retouchClone, setRetouchClone] = useState({ source: null, aligned: true, offset: null });
  const [retouchPicking, setRetouchPicking] = useState(false);
  const [retouchSelected, setRetouchSelected] = useState(null);
  const [retouchMessage, setRetouchMessage] = useState(null);
  // The removal whose source area is being drawn on the photo, or null.
  const [retouchArea, setRetouchArea] = useState(null);
  // Image layer sources imported as layers only (by SHA-256); workspace photos serve as sources too.
  const layerFiles = useRef(new Map());
  const layerInputRef = useRef(null);
  const layerReconnect = useRef(null);
  const [layerMessage, setLayerMessage] = useState(null);
  const [layerBusy, setLayerBusy] = useState(false);
  const [rasterVersion, setRasterVersion] = useState(0);
  const [textFocus, setTextFocus] = useState(0);
  const inspectJob = useRef(null);
  const regionSent = useRef(null);
  // A merged HDR's preview is re-merged from its sources when it left the proxy cache.
  const hdrProxyJob = useRef(null);
  const [hdrOpen, setHdrOpen] = useState(false);
  const hdrOpenRef = useRef(false);
  const bracketInspections = useRef(Promise.resolve());
  hdrOpenRef.current = hdrOpen;
  const fileInputRef = useRef(null);
  const editsInputRef = useRef(null);
  // Fullscreen (or, where the API is missing, a focus mode): the photo and its controls only.
  const rootRef = useRef(null);
  const fullscreen = useFullscreen(rootRef);
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
  const [recipes, setRecipes] = useState(readRecipes);
  const [watermarkDefault, setWatermarkDefault] = useState(readWatermarkDefault);
  // The preview's auto colour choice ({ variant, mean }), shown in the Watermark section.
  const [watermarkAuto, setWatermarkAuto] = useState(null);
  // The open recipe dialog: { mode: 'copy' | 'apply' | 'instructions', recipe? }.
  const [recipeDialog, setRecipeDialog] = useState(null);
  const imageKeys = useRef(new WeakMap());
  const renderState = useRef({ client: null, key: null, luts: new Set() });

  const photo = activePhoto(state);
  const adjustments = photo?.history.present ?? neutralAdjustments();
  const ready = photo?.status === 'ready';
  const lutFor = useCallback((settings) => (settings?.lut ? luts.get(settings.lut.sha256) ?? null : null), [luts]);
  // The shown photo's preview proxy, which the Filter Library's thumbnails are made from.
  const [viewProxy, setViewProxy] = useState(null);
  const thumbSource = useRef({ key: null, value: null });
  // While a preset is hovered or focused, the preview shows it applied (nothing is recorded).
  const viewAdjustments = useMemo(() => (presetPreview && ready ? applyPreset(adjustments, presetPreview) : adjustments), [presetPreview, ready, adjustments]);
  // Watermark defaults: the host's (CMS global preference) or this browser's saved default.
  const [hostWatermark, setHostWatermark] = useState(null);
  const watermarkDefaults = useMemo(() => (host ? {
    settings: hostWatermark ?? WATERMARK_DEFAULTS,
    label: 'CMS global preference',
    onSave: host.saveWatermarkDefault ? async (settings) => setHostWatermark(normalizeWatermark(await host.saveWatermarkDefault(settings))) : null,
    overrides: true,
  } : {
    settings: watermarkDefault ?? WATERMARK_DEFAULTS,
    label: watermarkDefault ? 'saved default' : 'HUYNH defaults',
    onSave: (settings) => {
      try { localStorage.setItem(WATERMARK_DEFAULT_KEY, JSON.stringify(settings)); } catch { throw new Error('This browser does not allow saving settings.'); }
      setWatermarkDefault(normalizeWatermark(settings));
    },
    overrides: false,
  }), [host, hostWatermark, watermarkDefault]);
  const missingLut = ready && adjustments.lut && !luts.has(adjustments.lut.sha256) ? adjustments.lut : null;
  const importing = state.photos.filter(({ status }) => status === 'importing').length;
  const exporting = state.photos.some(({ exportStatus }) => exportStatus.state === 'running');

  const worker = useCallback((name) => {
    // The render and local workers only compute (CPU and Detail previews), so they need no worker canvas.
    workers.current[name] ??= createImageWorker(undefined, { canvas: name !== 'render' && name !== 'local' });
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
      exportJob.current?.cancel();
      batchRef.current?.cancel();
    };
  }, []);

  // Saved edits from an earlier visit wait for their originals to be reimported.
  useEffect(() => {
    if (host) return;
    const saved = readAutosave();
    if (saved?.photos.length) {
      dispatch({ type: 'loadDocument', document: saved });
      setRestoredCount(saved.photos.length);
    }
  }, [host]);

  // Autosave adjustment values (never pixels) so a reload keeps them. A host saves its own.
  useEffect(() => {
    if (host) return undefined;
    const timer = setTimeout(() => {
      const photos = state.photos.filter(({ status }) => status === 'ready').map((item) => ({ ...item, adjustments: item.history.present }));
      const waiting = state.pendingEdits.map(({ source, adjustments: values }) => ({ ...source, adjustments: values }));
      try {
        if (!photos.length && !waiting.length) localStorage.removeItem(AUTOSAVE_KEY);
        else localStorage.setItem(AUTOSAVE_KEY, serializeEditDocument(createEditDocument([...photos, ...waiting], state.exportSettings)));
      } catch { /* storage unavailable: editing still works without restore */ }
    }, 400);
    return () => clearTimeout(timer);
  }, [host, state.photos, state.pendingEdits, state.exportSettings]);

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
        // accepts Sony ARW, Nikon NEF and DNG and explains anything else.
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
  // `detail` ({ edge, nativeWidth, nativeHeight }) renders Detail settings at that preview size;
  // `glow` returns the bloom and halation map of the image instead of a frame.
  const renderInWorker = useCallback(async (image, values, lut, raw = null, detail = null, warp = null, glow = false) => {
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
      warp,
      glow,
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
  // While an export runs, the preview's local Detail work stops (it would take cores from the
  // export's band workers); the preview asks again afterwards.
  useEffect(() => {
    if (!exporting || !workers.current.local) return;
    workers.current.local.terminate();
    workers.current.local = null;
  }, [exporting]);
  // A local Detail pass over a whole preview frame, in a worker of its own so brush moves never
  // wait behind it; only the settings travel (the mask is applied on the page).
  const renderLocalDetail = useCallback((image, { kind, adjustments: values, native }) => worker('local')
    .call('localDetailFrame', { image, pass: { kind, adjustments: values, native } }, { transfer: [image.data.buffer] }), [worker]);
  const onEngine = useCallback((info) => setEngine(info), []);


  // Filter Library thumbnails: a small source made once per photo, proxy and geometry (on
  // this thread, from the proxy already shown), rendered in a worker of their own so they
  // never queue behind preview frames.
  const thumbLut = ready ? lutFor(adjustments) : null;
  const thumbGeometry = JSON.stringify(adjustments.geometry);
  const filterThumbnails = useMemo(() => {
    if (!ready || !viewProxy || viewProxy.photoId !== photo.id) return null;
    const key = `${photo.id}|${thumbGeometry}|${thumbLut?.sha256 ?? ''}`;
    const native = { width: photo.width, height: photo.height };
    const { image } = viewProxy;
    const raw = photo.raw ?? null;
    return {
      key,
      async getSource() {
        if (thumbSource.current.key !== key || thumbSource.current.image !== image) {
          const made = thumbnailSource(image, JSON.parse(thumbGeometry), native);
          thumbSource.current = { key, image, value: { source: made.image, spec: made.spec, native: made.native } };
        }
        return thumbSource.current.value;
      },
      render: (payload) => worker('thumbs').call('filterThumbs', { ...payload, raw, lut: thumbLut }),
    };
  }, [ready, viewProxy, photo?.id, photo?.width, photo?.height, photo?.raw, thumbGeometry, thumbLut, worker]);

  // 1:1 inspection: a full-size decode keeps only a crop around the region (RAW in the RAW
  // queue, others in a fresh image worker that is ended afterwards); renders reuse it.
  const loadRegionSource = useCallback(async (target, rect, geometry = null, retouch = []) => {
    inspectJob.current?.cancel();
    const resource = resources.current.get(target.id);
    if (!resource?.header) throw new Error('The original file is no longer available.');
    if (resource.hdr) throw Object.assign(new Error('1:1 inspection is not available for merged HDR photos: it would decode and merge the three files at full size. Export to inspect them.'), { code: 'unsupported' });
    if (resource.raw) {
      if (constrainedDevice()) throw Object.assign(new Error('1:1 inspection of RAW files needs a full-size decode (several hundred MB), more than this device can safely use.'), { code: 'memory' });
      const job = raws().run('region', { file: resource.file, raw: resource.raw, rect, geometry, retouch });
      inspectJob.current = job;
      return job.promise;
    }
    const client = createImageWorker();
    inspectJob.current = { cancel: () => client.terminate() };
    try {
      return await client.call('regionSource', { file: resource.file, header: resource.header, rect, geometry, retouch });
    } finally {
      client.terminate();
    }
  }, [raws]);
  const renderRegion = useCallback(async (kept, region, settings) => {
    const client = worker('render');
    const call = (full) => client.call('renderRegion', { key: kept.key, ...(full ? { kept: kept.source } : {}), region, ...settings });
    let result;
    try {
      result = await call(regionSent.current !== kept.key);
    } catch (error) {
      if (error.code !== 'stale-region') throw error;
      result = await call(true);
    }
    regionSent.current = kept.key;
    return result;
  }, [worker]);
  const closeInspect = useCallback(() => { inspectJob.current?.cancel(); setInspecting(false); }, []);
  const inspect = useMemo(() => (inspecting ? { loadSource: loadRegionSource, render: renderRegion, onClose: closeInspect } : null), [inspecting, loadRegionSource, renderRegion, closeInspect]);
  const lutsRef = useRef(luts);
  lutsRef.current = luts;

  // Crop & Transform: the viewer shows the whole transformed frame with the crop box (or
  // the perspective corners). Every change is an ordinary undoable edit; Apply keeps them,
  // Cancel returns the geometry to what it was when the tool opened (one more undo step).
  const [transformMode, setTransformMode] = useState(null);
  const [straightening, setStraightening] = useState(false);
  const transformStart = useRef(null);
  const geometryRef = useRef(adjustments.geometry);
  geometryRef.current = adjustments.geometry;
  const nativeRef = useRef(null);
  nativeRef.current = ready ? { width: photo.width, height: photo.height } : null;
  const setGeometry = useCallback((next, { preview = false, coalesceKey = null } = {}) => {
    dispatch(preview
      ? { type: 'previewSettings', patch: { geometry: next } }
      : { type: 'applySettings', patch: { geometry: next }, coalesceKey, now: Date.now() });
  }, []);
  // Corner drags can make a crop reach outside the photo: crop to fill applies, and a
  // transform that cannot be built is ignored.
  const constrained = useCallback((next) => {
    try {
      return constrainGeometry(next, nativeRef.current);
    } catch (error) {
      if (error instanceof GeometryError) return null;
      throw error;
    }
  }, []);
  const commitGeometry = useCallback(() => dispatch({ type: 'commitAdjustment' }), []);
  const openTransform = useCallback((mode) => {
    if (mode && !transformStart.current) transformStart.current = geometryRef.current;
    if (!mode) { dispatch({ type: 'commitAdjustment' }); transformStart.current = null; }
    setTransformMode(mode);
    if (mode) { setInspecting(false); setLayerToolOn(false); setMaskTool(null); setRetouchTool(null); }
  }, []);
  const applyTransform = useCallback(() => openTransform(null), [openTransform]);
  const cancelTransform = useCallback(() => {
    dispatch({ type: 'commitAdjustment' });
    const start = transformStart.current;
    if (start && !geometryEqual(start, geometryRef.current)) setGeometry(start);
    transformStart.current = null;
    setTransformMode(null);
  }, [setGeometry]);
  const transformRef = useRef(null);
  transformRef.current = transformMode ? cancelTransform : null;
  // Another photo: the tool closes and keeps what was done.
  useEffect(() => { transformStart.current = null; setTransformMode(null); setActiveLayer(null); }, [state.activeId]);
  const transform = useMemo(() => (transformMode && ready ? {
    mode: transformMode,
    guide: straightening,
    onPreview: (next) => { const value = constrained(next); if (value) setGeometry(value, { preview: true }); },
    onCommit: commitGeometry,
    onSet: (next, coalesceKey) => { const value = constrained(next); if (value) setGeometry(value, { coalesceKey }); },
    onApply: applyTransform,
    onCancel: cancelTransform,
  } : null), [transformMode, ready, straightening, constrained, setGeometry, commitGeometry, applyTransform, cancelTransform]);
  const changeGeometry = useCallback((next, options = {}) => setGeometry(next, options), [setGeometry]);

  // ---------- Layers ----------
  // An image layer's source: a file imported as a layer, or a workspace photo with the same content.
  const sourceFor = useCallback((sha256) => {
    if (!sha256) return null;
    if (layerFiles.current.has(sha256)) return layerFiles.current.get(sha256);
    for (const resource of resources.current.values()) if (resource.sha256 === sha256 && resource.header && resource.file && !resource.hdr) return resource;
    return null;
  }, []);
  const lutOfLayer = (layer) => (layer.settings?.lut ? lutsRef.current.get(layer.settings.lut.sha256) ?? null : null);
  // Preview raster: the source decoded at the size bucket (RAW: half-size sensor data in the RAW
  // queue), developed with the layer's settings in a worker of its own.
  const loadLayerRaster = useCallback(async (layer, size) => {
    const source = sourceFor(layer.source.sha256);
    if (!source) throw new Error('The source file is not loaded.');
    const image = source.raw
      ? await raws().run('decode', { file: source.file, maxEdge: Math.max(size.width, size.height) }).promise
      : await worker('layers').call('decode', { file: source.file, header: source.header, width: size.width, height: size.height });
    if (!source.raw && settingsNeutral(layer.settings)) return image;
    return worker('layers').call('render', { key: newId(), source: image, adjustments: layerAdjustments(layer.settings), lut: lutOfLayer(layer), raw: source.raw ?? null });
  }, [sourceFor, raws, worker]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadLayerRasterRef = useRef(loadLayerRaster);
  loadLayerRasterRef.current = loadLayerRaster;
  const rasterCache = useMemo(() => createRasterCache({
    load: (layer, size) => loadLayerRasterRef.current(layer, size),
    onChange: () => setRasterVersion((value) => value + 1),
    maxEdge: engine?.maxEdge ?? 4096,
  }), [engine?.maxEdge]);
  const rasterCacheRef = useRef(rasterCache);
  rasterCacheRef.current = rasterCache;
  const layerRasters = useMemo(() => ({ get: rasterCache.get, version: rasterVersion }), [rasterCache, rasterVersion]);

  // Export raster: the original decoded (RAW: developed) at the size the layer needs on the
  // export canvas, never larger than the source, then its settings; the worker ends afterwards.
  const exportLayerRaster = useCallback(async (layer, canvas, signal) => {
    const source = sourceFor(layer.source.sha256);
    if (!source) throw Object.assign(new Error(`The file of the layer "${layerLabel(layer)}" is not loaded.`), { code: 'blocked' });
    const size = rasterSize(layer, canvas);
    const client = createImageWorker();
    try {
      let image;
      if (source.raw) {
        const job = raws().run('develop', { file: source.file, raw: source.raw, width: size.width, height: size.height });
        const watch = setInterval(() => { if (signal.cancelled) job.cancel(); }, 100);
        try { image = await job.promise; } finally { clearInterval(watch); }
      } else {
        image = await client.call('decode', { file: source.file, header: source.header, width: size.width, height: size.height });
      }
      if (signal.cancelled) throw Object.assign(new Error('Cancelled.'), { code: 'cancelled' });
      if (!source.raw && settingsNeutral(layer.settings)) return image;
      return await client.call('render', { key: 'layer', source: image, adjustments: layerAdjustments(layer.settings), lut: lutOfLayer(layer), raw: source.raw ?? null }, { transfer: [image.data.buffer] });
    } finally {
      client.terminate();
    }
  }, [sourceFor, raws]); // eslint-disable-line react-hooks/exhaustive-deps

  // The canvas: the photo's output frame at full size (its own Crop & Transform).
  const canvasSize = useMemo(() => {
    if (!ready) return null;
    try {
      return exportGeometry(adjustments.geometry, { width: photo.width, height: photo.height }, { mode: 'original' }).output;
    } catch (error) {
      if (error instanceof GeometryError) return { width: photo.width, height: photo.height };
      throw error;
    }
  }, [ready, adjustments.geometry, photo?.width, photo?.height]);
  const canvasSizeRef = useRef(canvasSize);
  canvasSizeRef.current = canvasSize;

  // The panels edit the selected image or adjustment layer's colour settings, else the photo.
  const targetLayer = ready && activeLayer ? adjustments.layers.find((layer) => layer.id === activeLayer && layer.settings) ?? null : null;
  const targetId = targetLayer?.id ?? null;
  const targetLocal = ready && activeLocal ? adjustments.local.find((local) => local.id === activeLocal) ?? null : null;
  const localId = targetLocal?.id ?? null;
  const panelAdjustments = useMemo(() => (targetLocal ? normalizeAdjustments(targetLocal.settings) : targetLayer ? layerAdjustments(targetLayer.settings) : adjustments), [targetLocal, targetLayer, adjustments]);
  const panelDispatch = useCallback((action) => {
    if (!LAYER_TARGETED.has(action.type) || action.patch?.layers || action.patch?.local) return dispatch(action);
    if (localId) return dispatch({ ...action, localId });
    return dispatch(targetId ? { ...action, layerId: targetId } : action);
  }, [targetId, localId]);
  const lutTarget = useRef(null);
  lutTarget.current = targetId;
  // A layer that no longer exists (undo, another photo) is no longer selected.
  useEffect(() => { if (activeLayer && ready && !adjustments.layers.some((layer) => layer.id === activeLayer)) setActiveLayer(null); }, [activeLayer, ready, adjustments.layers]);
  useEffect(() => { if (activeLocal && ready && !adjustments.local.some((local) => local.id === activeLocal)) { setActiveLocal(null); setMaskTool(null); } }, [activeLocal, ready, adjustments.local]);

  // The mask being edited: the selected local adjustment's, or the selected layer's.
  const maskLayer = ready && activeLayer ? adjustments.layers.find((layer) => layer.id === activeLayer) ?? null : null;
  const maskTarget = targetLocal ? { kind: 'local', local: targetLocal } : layerMaskOn && maskLayer?.mask ? { kind: 'layer', layer: maskLayer } : null;
  const maskTargetRef = useRef(maskTarget);
  maskTargetRef.current = maskTarget;
  useEffect(() => { if (!maskTarget) setMaskTool(null); }, [Boolean(maskTarget)]); // eslint-disable-line react-hooks/exhaustive-deps
  // `mask` (null removes a layer's mask) as a settings patch of the active photo.
  const maskPatch = useCallback((mask, localPatch = null) => {
    const present = activePhoto(stateRef.current)?.history.present;
    const target = maskTargetRef.current;
    if (!present) return null;
    if (target?.kind === 'local' || (localPatch && activeLocal)) {
      const id = target?.local.id ?? activeLocal;
      return { local: present.local.map((local) => (local.id === id ? { ...local, ...localPatch, ...(mask ? { mask } : {}) } : local)) };
    }
    const layerId = target?.layer.id ?? activeLayer;
    return layerId ? { layers: updateLayer(present.layers, layerId, { mask }) } : null;
  }, [activeLocal, activeLayer]);
  const applyMask = useCallback((mask, coalesceKey = null) => { const patch = maskPatch(mask); if (patch) dispatch({ type: 'applySettings', patch, coalesceKey }); }, [maskPatch]);
  const previewMask = useCallback((mask, localPatch = null) => { const patch = maskPatch(mask, localPatch); if (patch) dispatch({ type: 'previewSettings', patch }); }, [maskPatch]);
  const selectLocal = useCallback((id, componentId = null) => {
    setActiveLocal(id);
    setMaskComponent(componentId);
    if (id) { setActiveLayer(null); setLayerMaskOn(false); setLayerToolOn(false); } else setMaskTool(null);
  }, []);
  const chooseMaskTool = useCallback((value) => {
    if (transformMode) return;
    setMaskTool(value);
    if (value) { setLayerToolOn(false); setInspecting(false); setRetouchTool(null); }
  }, [transformMode]);
  const chooseRetouchTool = useCallback((value) => {
    if (transformMode) return;
    setRetouchTool(value);
    setRetouchPicking(false);
    setRetouchMessage(null);
    setRetouchArea(null);
    if (value) { setMaskTool(null); setLayerToolOn(false); setInspecting(false); }
  }, [transformMode]);
  const applyRetouch = useCallback((retouch, coalesceKey = null) => dispatch({ type: 'applySettings', patch: { retouch }, coalesceKey }), []);
  // A new photo: its own operations, no selection, no clone source from the last one.
  useEffect(() => { setRetouchSelected(null); setRetouchClone((clone) => ({ ...clone, source: null, offset: null })); setRetouchPicking(false); setRetouchMessage(null); setRetouchArea(null); }, [photo?.id]);
  useEffect(() => { if (retouchSelected && !adjustments.retouch.some(({ id }) => id === retouchSelected)) setRetouchSelected(null); }, [retouchSelected, adjustments.retouch]);
  const removeMaskComponent = useCallback((id) => {
    const target = maskTargetRef.current;
    if (!target) return;
    const mask = target.kind === 'local' ? target.local.mask : target.layer.mask;
    applyMask({ ...mask, components: mask.components.filter((c) => c.id !== id) });
    setMaskComponent(null);
  }, [applyMask]);
  const maskSpace = maskTarget?.kind === 'layer' && maskTarget.layer.type === 'image'
    ? { width: maskTarget.layer.source.width, height: maskTarget.layer.source.height }
    : maskTarget?.kind === 'local' ? { width: photo.width, height: photo.height } : canvasSize;

  const insertAboveActive = useCallback((layer, message) => {
    const target = activePhoto(stateRef.current);
    if (target?.status !== 'ready') return false;
    const { layers } = target.history.present;
    const at = layers.findIndex(({ id }) => id === activeLayer);
    const next = insertLayer(layers, layer, at === -1 ? layers.length - 1 : at);
    if (next === layers) { setLayerMessage(message); return false; }
    dispatch({ type: 'applySettings', patch: { layers: next } });
    setActiveLayer(layer.id);
    setLayerMessage(null);
    return true;
  }, [activeLayer]);
  const addImageLayer = useCallback((resource) => {
    const source = {
      sha256: resource.sha256,
      name: resource.file.name,
      size: resource.file.size,
      format: resource.header.format,
      width: resource.header.displayWidth,
      height: resource.header.displayHeight,
    };
    const layer = createImageLayer(newLayerId('image'), source, canvasSizeRef.current);
    if (layer && insertAboveActive(layer, 'A photo can hold up to 8 image layers and 40 layers in all.') && !transformMode) setLayerToolOn(true);
  }, [insertAboveActive, transformMode]);
  const onAddPhoto = useCallback((id) => {
    const resource = resources.current.get(id);
    if (resource?.header && resource.sha256 && !resource.hdr) addImageLayer(resource);
  }, [addImageLayer]);
  const addTextLayer = useCallback(() => {
    if (insertAboveActive(createTextOverlay(newLayerId('text')), 'A photo can hold up to 30 text layers and 40 layers in all.')) {
      if (!transformMode) setLayerToolOn(true);
      setTextFocus((count) => count + 1);
    }
  }, [insertAboveActive, transformMode]);
  const addAdjustmentLayer = useCallback(() => {
    insertAboveActive(createAdjustmentLayer(newLayerId('adjust')), 'A photo can hold up to 12 adjustment layers and 40 layers in all.');
  }, [insertAboveActive]);
  const selectLayer = useCallback((id) => {
    setActiveLayer(id);
    setActiveLocal(null);
    setLayerMaskOn(false);
    setMaskComponent(null);
    setMaskTool(null);
    const layer = id && activePhoto(stateRef.current)?.history.present.layers.find((item) => item.id === id);
    if (layer && (layer.type === 'image' || layer.type === 'text') && !transformMode) setLayerToolOn(true);
  }, [transformMode]);

  // A file chosen as a new image layer, or to reconnect a layer whose source is missing
  // (matched by content: the SHA-256 must be the one the layer names).
  const onLayerFile = useCallback(async (file) => {
    const reconnect = layerReconnect.current;
    layerReconnect.current = null;
    if (!file) return;
    setLayerBusy(true);
    setLayerMessage(null);
    try {
      const head = new Uint8Array(await file.slice(0, RAW_SNIFF_BYTES).arrayBuffer());
      const inspected = isTiff(head)
        ? await raws().run('inspect', { file, thumbnailEdge: THUMBNAIL_EDGE }).promise
        : await worker('import').call('inspect', { file, thumbnailEdge: THUMBNAIL_EDGE });
      const resource = { file, header: inspected.header, sha256: inspected.sha256, thumbnail: inspected.thumbnail, raw: inspected.raw ?? null };
      if (!resource.sha256) throw new Error('This file could not be identified.');
      if (reconnect && resource.sha256 !== reconnect.source.sha256) {
        throw new Error(`${file.name} is not the file this layer was made from (its content differs). Choose ${reconnect.source.name || 'the original file'}.`);
      }
      layerFiles.current.set(resource.sha256, resource);
      rasterCacheRef.current.retry(resource.sha256);
      if (reconnect) {
        setLayerMessage(`Reconnected ${file.name}.`);
        setRasterVersion((value) => value + 1);
      } else {
        addImageLayer(resource);
      }
    } catch (error) {
      if (error.code !== 'cancelled') setLayerMessage(error.message || 'This file could not be read.');
    } finally {
      setLayerBusy(false);
    }
  }, [raws, worker, addImageLayer]);

  const layerSourcesUi = {
    missing: (layer) => {
      if (layer.type !== 'image') return null;
      if (!sourceFor(layer.source.sha256)) return `Its file ${layer.source.name || ''} (${layer.source.width}×${layer.source.height}) is not loaded. Reconnect it (or import it as a photo) to show and export this layer.`;
      const failed = rasterCache.error(layer.source.sha256);
      return failed ? `Its file could not be read: ${failed}` : null;
    },
    thumbnail: (layer) => {
      const source = layer.type === 'image' ? sourceFor(layer.source.sha256) : null;
      if (!source?.thumbnail) return null;
      if (source.thumbnail.kind !== 'raw') return source.thumbnail;
      // A RAW thumbnail is half-size sensor data: developed once, neutral and as shot.
      source.layerThumbnail ??= { width: source.thumbnail.width, height: source.thumbnail.height, data: renderRawRgba8(source.thumbnail.data, deriveParams(neutralAdjustments(), { raw: source.raw })) };
      return source.layerThumbnail;
    },
    workspace: state.photos.filter((item) => item.status === 'ready' && item.format !== 'hdr' && item.sha256).map(({ id, name }) => ({ id, name })),
    onAddPhoto,
    onImport: () => { layerReconnect.current = null; layerInputRef.current?.click(); },
    onReconnect: (layer) => { layerReconnect.current = layer; layerInputRef.current?.click(); },
    busy: layerBusy,
    message: layerMessage,
  };

  const removePhoto = useCallback((id) => {
    resources.current.get(id)?.job?.cancel();
    if (resources.current.get(id)?.hdr) hdrProxyJob.current?.cancel();
    resources.current.delete(id);
    [...proxyCache.current.keys()].filter((key) => key.startsWith(`${id}:`)).forEach((key) => proxyCache.current.delete(key));
    if (exportJob.current?.id === id) exportJob.current.cancel();
    if (stateRef.current.activeId === id) inspectJob.current?.cancel();
    batchRef.current?.remove(id);
    dispatch({ type: 'remove', id });
    // With the workspace empty, end the idle workers so their heaps (decode buffers,
    // the cached CPU-preview proxy) are freed now rather than at the next collection.
    if (!resources.current.size) {
      rasterCacheRef.current.clear();
      ['proxy', 'render', 'import', 'thumbs', 'layers', 'local'].forEach((name) => {
        workers.current[name]?.terminate();
        workers.current[name] = null;
      });
      rawProxyJob.current?.cancel();
      proxyCache.current.clear();
    }
  }, []);

  /** Why a photo cannot be exported with these settings now, or null. */
  const exportBlocker = useCallback((target, settings) => {
    const values = target.history.present;
    if (unsupportedFormats.includes(settings.format)) return `This browser cannot encode ${FORMATS[settings.format].label}.`;
    if (values.lut && !lutsRef.current.has(values.lut.sha256)) return `Import the LUT "${values.lut.name}" again, or remove it, before exporting.`;
    for (const layer of visibleLayers(values.layers)) {
      if (layer.type === 'image' && !sourceFor(layer.source.sha256)) return `The layer "${layerLabel(layer)}" needs its file ${layer.source.name || ''} (Layers: Reconnect file), or hide or delete it, before exporting.`;
      if (layer.settings?.lut && !lutsRef.current.has(layer.settings.lut.sha256)) return `Import the LUT "${layer.settings.lut.name}" of the layer "${layerLabel(layer)}" again before exporting.`;
    }
    const resource = resources.current.get(target.id);
    if (!resource?.header) return 'The original file is no longer available.';
    try {
      exportGeometry(values.geometry, { width: target.width, height: target.height }, settings.resize);
    } catch (error) {
      if (error instanceof GeometryError) return `${error.message} Change the photo's Crop & Transform settings to export it.`;
      throw error;
    }
    if (resource.hdr) {
      const check = checkHdrExport(resource.hdr.mode, resource.hdr.inputs, resource.hdr.analysis, settings.resize, undefined, values.geometry);
      if (!check.fits) return hdrMemoryMessage(check);
    }
    return null;
  }, [unsupportedFormats, sourceFor]);

  /**
   * Exports one photo from its original file with its own settings: the single-photo
   * export and every batch item go through here.
   * :param hooks: { onProgress, onCancel(cancel) } receives the function that cancels it
   * :returns: { blob, width, height, timings, raw?, hdr? }
   */
  const exportPhoto = useCallback(async (target, settings, { onProgress, onCancel }) => {
    const blocker = exportBlocker(target, settings);
    if (blocker) throw Object.assign(new Error(blocker), { code: 'blocked' });
    const resource = resources.current.get(target.id);
    const values = target.history.present;
    const lut = values.lut ? lutsRef.current.get(values.lut.sha256) : null;
    // Local adjustments and layers: applied over the rendered photo before encoding (io/composeLayers.mjs);
    // then the watermark over the final output frame at the export's size (watermark/watermarkRender.mjs).
    const layerCancel = { cancelled: false };
    const native = { width: target.width, height: target.height };
    const watermark = settings.includeWatermark !== false && watermarkActive(values.watermark) ? values.watermark : null;
    let watermarked = null;
    const compose = visibleLayers(values.layers).length || visibleLocals(values.local).length || watermark ? async (context, { size, signal, onProgress: progress }) => {
      if (values.layers.some((layer) => layer.type === 'text' && layer.visible !== false)) await loadTextFonts();
      const merged = { get cancelled() { return layerCancel.cancelled || Boolean(signal?.cancelled); } };
      if (watermark) await loadWatermarkFonts();
      await composeLayers(context, values.layers, {
        size,
        loadRaster: (layer, canvasSize) => exportLayerRaster(layer, canvasSize, merged),
        rasterizeText: rasterizeTextLayer,
        lutFor: (layerSettings) => (layerSettings?.lut ? lutsRef.current.get(layerSettings.lut.sha256) ?? null : null),
        local: values.local,
        imageMap: (canvas) => imageMaskMap(exportGeometry(values.geometry, native, { mode: 'original' }).plan, canvas, native),
        native: exportGeometry(values.geometry, native, { mode: 'original' }).output,
        workers: detailWorkerCount(),
        signal: merged,
        onProgress: progress,
      });
      if (watermark) {
        if (merged.cancelled) throw Object.assign(new Error('Cancelled.'), { code: 'cancelled' });
        const started = performance.now();
        const { variant, luminance } = applyWatermark(context, watermark, size);
        watermarked = { variant, luminance, ms: performance.now() - started };
        performance.measure?.('pe-watermark', { start: started });
      }
    } : null;
    // What the watermark resolved to (auto colour), reported with the export.
    const marked = (result) => (watermarked ? { ...result, watermark: watermarked } : result);
    onCancel(() => { layerCancel.cancelled = true; });
    if (resource.hdr) {
      const { inputs, analysis } = resource.hdr;
      const job = createHdrJob();
      onCancel(() => job.cancel());
      try {
        return marked({ ...await exportHdr(inputs, analysis, { adjustments: values, raw: target.raw, lut, settings, compose }, { rawQueue: raws(), job, onProgress }), hdr: true });
      } finally {
        job.cancel();
      }
    }
    if (resource.raw) {
      // A RAW export runs in the RAW queue; cancelling ends its worker.
      const rawJob = { job: null, cancelled: false };
      onCancel(() => { rawJob.cancelled = true; rawJob.job?.cancel(); layerCancel.cancelled = true; });
      const result = await exportRaw(raws(), { file: resource.file, raw: resource.raw, adjustments: values, lut, settings, compose }, {
        onProgress,
        detailWorkers: detailWorkerCount(),
        onStart: (job) => {
          rawJob.job = job;
          if (rawJob.cancelled) job.cancel();
        },
      });
      if (rawJob.cancelled) throw Object.assign(new Error('Cancelled.'), { code: 'cancelled' });
      return marked({ ...result, raw: true });
    }
    const client = createImageWorker();
    const signal = { cancelled: false };
    onCancel(() => { signal.cancelled = true; layerCancel.cancelled = true; client.terminate(); });
    const workers = detailWorkerCount();
    try {
      // Band workers when there is something to render (a neutral export only re-encodes).
      // Layers are composited on the page, so a photo with layers always takes this path.
      if (compose || (workers > 0 && !deriveParams(values, { lut }).neutral)) {
        return marked(await exportImageInBands(client, { file: resource.file, header: resource.header, adjustments: values, lut, settings, compose }, { workers: Math.max(1, workers), onProgress, signal }));
      }
      return await client.call('export', { file: resource.file, header: resource.header, adjustments: values, lut, settings }, { onProgress });
    } finally {
      client.terminate();
    }
  }, [raws, exportBlocker, exportLayerRaster]);

  const exportActive = useCallback(async () => {
    const target = activePhoto(stateRef.current);
    if (!target || target.status !== 'ready' || exportJob.current || batchRef.current) return;
    const settings = stateRef.current.exportSettings;
    const blocker = exportBlocker(target, settings);
    if (blocker) {
      dispatch({ type: 'exportStatus', id: target.id, status: { state: 'error', message: blocker } });
      return;
    }
    const running = { id: target.id, cancel: () => {} };
    exportJob.current = running;
    dispatch({ type: 'exportStatus', id: target.id, status: { state: 'running', stage: 'decoding', fraction: 0, ...(target.hdr ? { index: 0 } : {}) } });
    performance.mark('pe-export-start');
    try {
      const result = await exportPhoto(target, settings, {
        onProgress: (progress) => dispatch({ type: 'exportStatus', id: target.id, status: { state: 'running', ...progress } }),
        onCancel: (cancel) => { running.cancel = cancel; },
      });
      performance.measure('pe-export', 'pe-export-start');
      const fileName = exportFileName(target.name, settings.format, settings.suffix);
      downloadBlob(result.blob, fileName);
      dispatch({ type: 'exportStatus', id: target.id, status: { state: 'done', fileName, width: result.width, height: result.height, bytes: result.blob.size, timings: result.timings, hdr: Boolean(result.hdr), raw: Boolean(result.raw), watermark: result.watermark ?? null, adjustments: target.history.present } });
    } catch (error) {
      dispatch({ type: 'exportStatus', id: target.id, status: error.code === 'cancelled' ? { state: 'cancelled' } : { state: 'error', message: error.message } });
    } finally {
      exportJob.current = null;
    }
  }, [exportPhoto, exportBlocker]);

  /**
   * Batch export of photos by id: names from batchFileNames (ZIP entries and downloads
   * alike), one export at a time from the originals, each delivered as it finishes.
   * :param options: { mode: 'zip' | 'files', customNames: { id: name } }
   */
  const startBatchExport = useCallback(async (ids, { mode, customNames = {} }) => {
    if (batchRef.current || exportJob.current) return;
    const current = stateRef.current;
    const settings = current.exportSettings;
    const photos = current.photos.filter((photo) => photo.status === 'ready' && ids.includes(photo.id));
    const names = batchFileNames(selectedPhotos(current).concat(photos.filter((photo) => !current.selectedIds.includes(photo.id)))
      .map(({ id, name }) => ({ id, name, customName: customNames[id] })), settings);
    const items = photos.filter((photo) => !exportBlocker(photo, settings)).map(({ id }) => ({ id, fileName: names.get(id) }));
    if (!items.length) return;
    const date = new Date();
    const inZip = new Set();
    let parts = 0;
    const zip = mode === 'zip' ? createZipArchive({
      date,
      onPart: async (blob, { part, names: entries, split }) => {
        downloadBlob(blob, zipFileName({ date, part, split, suffix: settings.suffix }));
        entries.forEach((name) => inZip.delete(name));
        parts = part;
      },
    }) : null;
    const exported = new Map();
    const batch = createExportBatch({
      items,
      exportOne: (item, hooks) => {
        const photo = stateRef.current.photos.find(({ id }) => id === item.id);
        if (!photo) throw Object.assign(new Error('Removed from the workspace.'), { code: 'cancelled' });
        exported.set(item.id, photo.history.present);
        return exportPhoto(photo, settings, hooks);
      },
      deliver: async (item, result) => {
        if (!zip) { downloadBlob(result.blob, item.fileName); return; }
        inZip.add(item.fileName);
        await zip.add(item.fileName, result.blob);
      },
      onUpdate: (id, status) => {
        if (status.state === 'removed') return;
        const item = items.find((entry) => entry.id === id);
        dispatch({ type: 'exportStatus', id, status: status.state === 'done' ? { ...status, fileName: item.fileName, batch: true, adjustments: exported.get(id) } : status });
      },
    });
    batchRef.current = batch;
    items.forEach(({ id }) => dispatch({ type: 'exportStatus', id, status: { state: 'queued' } }));
    setBatchRun({ running: true, mode, outcome: null });
    performance.mark('pe-batch-start');
    let outcome;
    try {
      const result = await batch.start();
      let zipError = null;
      if (zip) {
        try { parts = await zip.finish(); } catch (error) { zipError = error; }
      }
      // Photos whose ZIP part could not be written were not saved after all.
      if (zipError) {
        items.filter(({ fileName }) => inZip.has(fileName)).forEach(({ id }) => {
          dispatch({ type: 'exportStatus', id, status: { state: 'error', message: `The ZIP could not be written: ${zipError.message}` } });
        });
      }
      performance.measure('pe-batch', 'pe-batch-start');
      const saved = result.done.length - (zipError ? items.filter(({ fileName }) => inZip.has(fileName)).length : 0);
      const where = zip ? (parts > 1 ? ` in ${parts} ZIP files` : parts ? ' in one ZIP' : '') : ' as separate files';
      outcome = [
        `Saved ${saved} of ${items.length}${saved ? where : ''}.`,
        result.failed.length ? `${result.failed.length} failed.` : '',
        result.cancelled.length ? `${result.cancelled.length} cancelled${zip && saved ? '; the ZIP holds the photos finished before' : ''}.` : '',
      ].filter(Boolean).join(' ');
    } finally {
      batchRef.current = null;
      setBatchRun({ running: false, mode, outcome });
    }
  }, [exportPhoto, exportBlocker]);

  const cancelExport = useCallback(() => exportJob.current?.cancel(), []);

  // Host (CMS) integration: load the host's photo and saved edits once; the edits wait as
  // pending edits and apply when the same file (by SHA-256) finishes importing.
  const hostLoaded = useRef(false);
  const [hostStatus, setHostStatus] = useState(host ? { state: 'loading' } : null);
  useEffect(() => {
    if (!host || hostLoaded.current) return;
    hostLoaded.current = true;
    (async () => {
      try {
        const { files, document, watermark } = await host.load();
        if (watermark) setHostWatermark(normalizeWatermark({ ...watermark, enabled: true }));
        if (document) dispatch({ type: 'loadDocument', document: parseEditDocument(document) });
        await importFiles(files);
        setHostStatus({ state: 'ready' });
      } catch (error) {
        setHostStatus({ state: 'error', message: error.message });
      }
    })();
  }, [host, importFiles]);
  // The edit document of one photo, as the host stores it.
  const documentFor = useCallback((target) => serializeEditDocument(createEditDocument([{ ...target, adjustments: target.history.present }], stateRef.current.exportSettings)), []);
  // Full-resolution render for the host, through the same export path as downloads.
  const renderForHost = useCallback(async (target, { onProgress } = {}) => {
    if (exportJob.current || batchRef.current) throw new Error('Another export is running.');
    const running = { id: target.id, cancel: () => {} };
    exportJob.current = running;
    try {
      const result = await exportPhoto(target, HOST_RENDER_SETTINGS, {
        onProgress: (progress) => onProgress?.(progress),
        onCancel: (cancel) => { running.cancel = cancel; },
      });
      return { ...result, fileName: exportFileName(target.name, HOST_RENDER_SETTINGS.format, HOST_RENDER_SETTINGS.suffix) };
    } finally {
      exportJob.current = null;
    }
  }, [exportPhoto]);

  // Batch edits. Copy and paste carry parameters only; paste replaces the default groups.
  const copyEdits = useCallback(() => {
    const target = activePhoto(stateRef.current);
    if (target?.status !== 'ready') return;
    setClipboard({ adjustments: target.history.present, name: target.name, ...sourceKind(target) });
    setNotice({ tone: 'info', text: `Copied the settings of ${target.name}. Select photos and choose Paste.` });
  }, []);
  const pasteEdits = useCallback(() => {
    if (!clipboard) return;
    const targets = selectedPhotos(stateRef.current);
    const plan = planSync(clipboard.adjustments, targets, { groups: DEFAULT_SYNC_GROUPS, hasLut: (sha256) => lutsRef.current.has(sha256), kind: clipboard });
    if (plan.errors.length) { setNotice({ tone: 'error', text: plan.errors[0] }); return; }
    dispatch({ type: 'applyBatch', label: `paste from ${clipboard.name}`, changes: plan.items.map(({ id, after }) => ({ id, after })) });
  }, [clipboard]);
  const applyPlan = useCallback((plan, label) => {
    dispatch({ type: 'applyBatch', label, changes: plan.items.filter(({ changed }) => changed.length).map(({ id, after }) => ({ id, after })) });
    setBatchDialog(null);
  }, []);


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
  // A host's unattended merge of a saved HDR (the CMS's automatic watermark drafts): the three
  // exposures already in the workspace, matched by content hash, with the saved roles and merge
  // settings; the saved edits then restore onto the merged photo as after Merge HDR by hand.
  const restoreSavedHdr = useCallback((onProgress = () => {}) => {
    let cancelled = false;
    let job = null;
    const promise = (async () => {
      const saved = stateRef.current.pendingEdits.find(({ source }) => source.hdr)?.source;
      if (!saved) throw new Error('No saved HDR merge is waiting for its exposures.');
      const ready = stateRef.current.photos.filter((item) => item.status === 'ready' && item.format !== 'hdr');
      const inputs = [];
      for (const entry of saved.hdr.inputs) {
        const match = ready.find((item) => item.sha256 && item.sha256 === entry.sha256);
        if (!match) throw new Error(`The exposure ${entry.name} is missing or its file changed since the merge was saved; attach the original again.`);
        inputs.push({ ...(await describeWorkspacePhoto(match.id)), role: entry.role });
      }
      const mode = inputs[0].raw ? 'radiance' : 'fusion';
      if (mode !== saved.hdr.mode) throw new Error(`The saved merge used ${saved.hdr.mode}; these files would merge as ${mode}.`);
      if (cancelled) throw Object.assign(new Error('Cancelled.'), { code: 'cancelled' });
      job = mergeBracket(inputs, saved.hdr.settings, onProgress);
      const result = await job.promise;
      await addMergedPhoto(result, inputs, saved.hdr.settings);
    })();
    return { promise, cancel: () => { cancelled = true; job?.cancel(); } };
  }, [describeWorkspacePhoto, mergeBracket, addMergedPhoto]);

  // Parses a .cube off the main thread, adds it to this session's library and applies it
  // to the active photo. Photos waiting for this exact file (same hash) resolve too.
  const loadLut = useCallback(async (file) => {
    const lut = await worker('import').call('parseCube', { file });
    setLuts((current) => new Map(current).set(lut.sha256, lut));
    return lut;
  }, [worker]);
  const importLut = useCallback(async (file) => {
    setLutStatus({ busy: true, error: null });
    try {
      const lut = await loadLut(file);
      const target = activePhoto(stateRef.current);
      if (target?.status === 'ready') {
        // Applied to what the panels edit: the photo, or the selected image or adjustment layer.
        dispatch({ type: 'applySettings', patch: { lut: { sha256: lut.sha256, name: lut.name, title: lut.title, size: lut.size } }, ...(lutTarget.current ? { layerId: lutTarget.current } : {}) });
      }
      setLutStatus({ busy: false, error: null });
    } catch (error) {
      setLutStatus({ busy: false, error: error.code === 'lut' ? error.message : `The LUT could not be read: ${error.message}` });
    }
  }, [loadLut]);
  // A recipe's LUT imported again: loaded only (the recipe dialog checks its hash before use).
  const loadRecipeLut = useCallback(async (file) => {
    try {
      return await loadLut(file);
    } catch (error) {
      throw new Error(error.code === 'lut' ? error.message : 'The LUT could not be read.');
    }
  }, [loadLut]);

  const changePresets = useCallback((next) => {
    setUserPresets(next);
    try {
      if (next.length) localStorage.setItem(PRESETS_STORAGE_KEY, serializePresets(next));
      else localStorage.removeItem(PRESETS_STORAGE_KEY);
    } catch {
      setNotice({ tone: 'warning', text: 'This browser did not allow saving presets; they last until the page is closed. Export them to keep them.' });
    }
  }, []);

  const changeRecipes = useCallback((next) => {
    setRecipes(next);
    try {
      if (next.length) localStorage.setItem(RECIPES_STORAGE_KEY, serializeRecipeLibrary(next.map(({ id, ...recipe }) => recipe)));
      else localStorage.removeItem(RECIPES_STORAGE_KEY);
    } catch {
      setNotice({ tone: 'warning', text: 'This browser did not allow saving recipes; they last until the page is closed. Export them to keep them.' });
    }
  }, []);
  const saveRecipe = useCallback((recipe) => {
    if (recipes.length >= MAX_RECIPES) { setNotice({ tone: 'error', text: `You can keep up to ${MAX_RECIPES} recipes.` }); return; }
    changeRecipes([...recipes, { ...recipe, id: newId(), name: uniquePresetName(recipe.name, recipes) }]);
  }, [recipes, changeRecipes]);
  // One photo: one undo step of its own. Several: a batch, undone per photo or as a whole.
  const applyRecipePlan = useCallback((plan, recipe) => {
    const changes = plan.items.filter(({ changed }) => changed.length).map(({ id, after }) => ({ id, after }));
    if (plan.items.length === 1 && changes.length === 1 && changes[0].id === stateRef.current.activeId) {
      dispatch({ type: 'applySettings', patch: changes[0].after });
    } else {
      dispatch({ type: 'applyBatch', label: `recipe ${recipe.name}`, changes });
    }
    setRecipeDialog(null);
    setNotice({ tone: 'info', text: `Applied the recipe ${recipe.name} to ${changes.length} photo${changes.length === 1 ? '' : 's'}. Undo reverts it.` });
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
      const document = await readEditDocumentFile(file);
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

  const copyRef = useRef(copyEdits);
  copyRef.current = copyEdits;
  const pasteRef = useRef(pasteEdits);
  pasteRef.current = pasteEdits;
  const cropKeyRef = useRef(null);
  cropKeyRef.current = ready ? () => openTransform(transformMode === 'crop' ? null : 'crop') : null;
  const textKeyRef = useRef(null);
  textKeyRef.current = ready && !transformMode ? () => setLayerToolOn((on) => !on) : null;
  const layerToolRef = useRef(false);
  layerToolRef.current = layerToolOn;
  // Mask shortcuts: M tool, O overlay, X paint/erase, [ ] brush size.
  const maskKeyRef = useRef(null);
  maskKeyRef.current = ready && !transformMode && maskTarget ? (key) => {
    if (key === 'm') chooseMaskTool(maskTool ? null : 'brush');
    else if (key === 'o') setMaskOverlay((value) => ({ ...value, show: !value.show }));
    else if (key === 'x' && maskTool === 'brush') setBrush((value) => ({ ...value, mode: value.mode === 'erase' ? 'add' : 'erase' }));
    else if ((key === '[' || key === ']') && maskTool === 'brush') setBrush((value) => ({ ...value, radius: Math.min(0.5, Math.max(0.002, value.radius * (key === ']' ? 1.2 : 1 / 1.2))) }));
    else if (key === 'escape' && maskTool) chooseMaskTool(null);
    else return false;
    return true;
  } : null;
  // Retouch shortcuts: R Remove, J Spot Heal, S Clone Stamp, [ ] brush size, Delete the selected repair, Esc done.
  const retouchKeyRef = useRef(null);
  retouchKeyRef.current = ready && !transformMode ? (key) => {
    if (key === 'r') chooseRetouchTool(retouchTool === 'remove' ? null : 'remove');
    else if (key === 'j') chooseRetouchTool(retouchTool === 'heal' ? null : 'heal');
    else if (key === 's') chooseRetouchTool(retouchTool === 'clone' ? null : 'clone');
    else if ((key === '[' || key === ']') && retouchTool) setRetouchBrush((value) => ({ ...value, radius: Math.min(RETOUCH_LIMITS.radius[1], Math.max(RETOUCH_LIMITS.radius[0], value.radius * (key === ']' ? 1.2 : 1 / 1.2))) }));
    else if ((key === 'delete' || key === 'backspace') && retouchSelected) { applyRetouch(removeRetouchOperation(adjustments.retouch, retouchSelected)); setRetouchSelected(null); }
    else if (key === 'escape' && retouchArea) setRetouchArea(null);
    else if (key === 'escape' && retouchTool) chooseRetouchTool(null);
    else if (key === 'escape' && retouchSelected) setRetouchSelected(null);
    else return false;
    return true;
  } : null;
  const dialogOpenRef = useRef(false);
  dialogOpenRef.current = Boolean(batchDialog || exportDialogOpen || recipeDialog);
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
      if (mod && !event.altKey && !isTextField(event.target) && !hdrOpenRef.current && !dialogOpenRef.current) {
        if (key === 'a' && !event.shiftKey) { event.preventDefault(); dispatch({ type: 'selectAll' }); return; }
        if (key === 'c' && event.shiftKey) { event.preventDefault(); copyRef.current(); return; }
        if (key === 'v' && event.shiftKey) { event.preventDefault(); pasteRef.current(); return; }
      }
      if (mod || event.altKey || isControl(event.target) || hdrOpenRef.current) return;
      if (event.key === 'Escape' && transformRef.current) { event.preventDefault(); transformRef.current(); return; }
      if (maskKeyRef.current?.(key)) { event.preventDefault(); return; }
      if (retouchKeyRef.current?.(key)) { event.preventDefault(); return; }
      if (event.key === 'Escape' && layerToolRef.current) { event.preventDefault(); setLayerToolOn(false); return; }
      if (event.key === 'Escape' && !dialogOpenRef.current) { dispatch({ type: 'clearSelection' }); setSelecting(false); return; }
      if (event.key === '\\') setCompare((value) => (value === 'original' ? 'edited' : 'original'));
      else if (key === 'y') setCompare((value) => (value === 'split' ? 'edited' : 'split'));
      else if (event.key === 'ArrowLeft') dispatch({ type: 'selectOffset', offset: -1 });
      else if (event.key === 'ArrowRight') dispatch({ type: 'selectOffset', offset: 1 });
      else if (event.key === '+' || event.key === '=') setZoomCommand({ type: 'in', at: Date.now() });
      else if (event.key === '-') setZoomCommand({ type: 'out', at: Date.now() });
      else if (event.key === '0') setZoomCommand({ type: 'fit', at: Date.now() });
      else if (event.key === '1') setZoomCommand({ type: 'actual', at: Date.now() });
      else if (key === 'c' && cropKeyRef.current) cropKeyRef.current();
      else if (key === 't' && textKeyRef.current) textKeyRef.current();
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
  const selected = selectedPhotos(state);
  const thumbnailOf = (id) => resources.current.get(id)?.thumbnail ?? null;
  const outputOf = (item) => {
    const hdr = resources.current.get(item.id)?.hdr;
    const { geometry } = item.history.present;
    try {
      return hdr
        ? hdrExportGeometry(hdr.inputs, hdr.analysis, state.exportSettings.resize, geometry).output
        : exportGeometry(geometry, { width: item.width, height: item.height }, state.exportSettings.resize).output;
    } catch (error) {
      if (error instanceof GeometryError) return exportDimensions({ width: item.width, height: item.height }, state.exportSettings.resize);
      throw error;
    }
  };
  const pendingHdr = state.pendingEdits.filter(({ source }) => source.hdr);
  const activeResource = photo ? resources.current.get(photo.id) : null;
  const hdrExportCheck = useMemo(() => (ready && activeResource?.hdr
    ? checkHdrExport(activeResource.hdr.mode, activeResource.hdr.inputs, activeResource.hdr.analysis, state.exportSettings.resize, undefined, adjustments.geometry)
    : null), [ready, activeResource, state.exportSettings.resize, adjustments.geometry]);

  const multiple = state.selectedIds.length > 1;
  // Plain click opens one photo; Ctrl/Cmd-click (or a tap in selection mode) adds or removes
  // it; Shift-click selects a range, adding to the selection with Ctrl/Cmd.
  const onPhotoClick = (event, id) => {
    const mod = event.ctrlKey || event.metaKey;
    if (event.shiftKey) dispatch({ type: 'selectRange', id, add: mod });
    else if (mod || selecting) dispatch({ type: 'toggleSelection', id });
    else dispatch({ type: 'select', id });
  };
  const photoList = (variant) => state.photos.map((item, index) => {
    const resource = resources.current.get(item.id);
    const active = item.id === state.activeId;
    const selected = state.selectedIds.includes(item.id);
    const exportState = item.exportStatus?.state;
    // Edited and not exported since (with these settings).
    const pending = item.status === 'ready' && !isNeutral(item.history.present)
      && !(exportState === 'done' && item.exportStatus.adjustments && adjustmentsEqual(item.exportStatus.adjustments, item.history.present));
    const states = [
      selected && multiple ? 'selected' : '',
      pending ? 'edited, not exported' : '',
      exportState === 'running' ? 'exporting' : exportState === 'queued' ? 'waiting to export' : exportState === 'error' ? 'export failed' : '',
    ].filter(Boolean);
    return (
      <li
        key={item.id}
        className={`pe-photo pe-photo--${variant}`}
        data-active={active || undefined}
        data-selected={(selected && (multiple || selecting)) || undefined}
        data-pending={pending || undefined}
        data-export={['queued', 'running', 'error'].includes(exportState) ? exportState : undefined}
        data-status={item.status}
      >
        {variant === 'list' && item.status === 'ready' && (
          <input
            type="checkbox"
            className="pe-photo__check"
            checked={selected}
            onChange={() => dispatch({ type: 'toggleSelection', id: item.id })}
            aria-label={`Select ${item.name}`}
          />
        )}
        <button
          type="button"
          className="pe-photo__select"
          aria-pressed={active}
          aria-label={`${item.name}${item.status === 'error' ? ' (failed)' : item.status === 'importing' ? ' (importing)' : ''}, photo ${index + 1} of ${state.photos.length}${states.length ? `, ${states.join(', ')}` : ''}`}
          onClick={(event) => onPhotoClick(event, item.id)}
        >
          <span className="pe-photo__frame">
            {(pending || exportState === 'running' || exportState === 'queued' || exportState === 'error') && <span className="pe-photo__flag" data-flag={exportState === 'error' ? 'error' : exportState === 'running' || exportState === 'queued' ? 'export' : 'pending'} aria-hidden="true" />}
            {resource?.thumbnail ? <PhotoThumb thumbnail={resource.thumbnail} adjustments={item.history.present} lut={lutFor(item.history.present)} raw={item.raw} photoWidth={item.width} /> : <span className="pe-photo__placeholder" aria-hidden="true">{item.status === 'error' ? '!' : <span className="pe-spinner" />}</span>}
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
              {exportState === 'error' && <span className="pe-photo__badge pe-note--error">Export failed</span>}
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
    <div ref={rootRef} className="pe" data-fullscreen={fullscreen.mode ?? undefined} data-engine={engine?.kind} data-mobile-panel={mobilePanel} data-dragging={dragDepth > 0 || undefined} {...dragHandlers}>
      <a className="skip-link" href="#pe-workspace">Skip to workspace</a>
      <header className="pe-bar">
        <a className="pe-back" href={host ? host.backHref : appHref('/photography/')}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>{host ? host.backLabel : 'Photography'}</span>
        </a>
        <h1 className="pe-title">{host ? host.title : 'Photo editor'}</h1>
        <p className="pe-privacy"><span className="pe-privacy__dot" aria-hidden="true" />{host ? host.privacyNote : 'Processed on this device. Nothing is uploaded.'}</p>
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
          <button type="button" className="pe-icon-button pe-fullscreen" onClick={fullscreen.toggle} aria-pressed={fullscreen.active} aria-label={fullscreen.active ? 'Exit fullscreen' : 'Enter fullscreen'} title={fullscreen.active ? 'Exit fullscreen' : 'Fullscreen: photo and adjustments only'}>
            <svg viewBox="0 0 16 16" aria-hidden="true">{fullscreen.active
              ? <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              : <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}</svg>
          </button>
          {sessionButtons('pe-session')}
          <input ref={editsInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => { openEdits(event.target.files[0]); event.target.value = ''; }} />
        </div>
      </header>

      {(host || notice || state.pendingEdits.length > 0) && (
        <div className="pe-notices">
          {host && (
            <host.Panel
              status={hostStatus}
              photo={ready ? photo : null}
              documentFor={documentFor}
              render={renderForHost}
              cancelRender={cancelExport}
              openHdrMerge={() => setHdrOpen(true)}
              restoreHdr={restoreSavedHdr}
              setNotice={setNotice}
              applySettings={(patch) => dispatch({ type: 'applySettings', patch })}
            />
          )}
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
        {readyCount > 0 && (
          <BatchPanel
            selectedCount={selected.length}
            readyCount={readyCount}
            selecting={selecting}
            onToggleSelecting={() => setSelecting((value) => !value)}
            onSelectAll={() => dispatch({ type: 'selectAll' })}
            onClear={() => { dispatch({ type: 'clearSelection' }); setSelecting(false); }}
            clipboard={clipboard}
            onCopy={copyEdits}
            onPaste={pasteEdits}
            onOpen={setBatchDialog}
            onOpenRecipe={() => setRecipeDialog({ mode: 'apply' })}
            onExport={() => setExportDialogOpen(true)}
            batches={state.batches}
            dispatch={dispatch}
            canEdit={ready}
            busy={Boolean(batchRun?.running)}
          />
        )}
        {state.photos.length ? (
          <ul className="pe-photo-list">{photoList('list')}</ul>
        ) : (
          <p className="pe-note">JPEG, PNG, WebP, or RAW (Sony ARW, Nikon NEF, DNG), up to {LIMITS.maxPixels / 1e6} MP and {LIMITS.maxFileBytes / (1024 * 1024)} MB each. Drag files anywhere onto the editor.</p>
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
          renderLocalDetail={renderLocalDetail}
          deferWork={exporting}
          onEngine={onEngine}
          onProxy={setViewProxy}
          zoomCommand={zoomCommand}
          inspect={inspect}
          transform={transform}
          layerTool={ready ? {
            interactive: layerToolOn && !transformMode,
            selectedId: activeLayer,
            freeResize,
            onSelect: setActiveLayer,
            onPreview: (layers) => dispatch({ type: 'previewSettings', patch: { layers } }),
            onCommit: () => dispatch({ type: 'commitAdjustment' }),
            onApply: (layers, coalesceKey = null) => dispatch({ type: 'applySettings', patch: { layers }, coalesceKey }),
            onEdit: (id) => { setActiveLayer(id); setMobilePanel('adjust'); setTextFocus((count) => count + 1); },
          } : null}
          maskTool={maskTarget && !transformMode ? {
            owner: maskTarget.kind === 'local' ? { kind: 'local', id: maskTarget.local.id } : { kind: 'layer', layer: maskTarget.layer },
            mask: maskTarget.kind === 'local' ? maskTarget.local.mask : maskTarget.layer.mask,
            editable: !(maskTarget.kind === 'layer' && maskTarget.layer.locked),
            interactive: Boolean(maskTool),
            overlay: maskOverlay,
            tool: maskTool,
            brush,
            selectedId: maskComponent,
            newId: newLayerId,
            onSelect: setMaskComponent,
            onPreview: (mask) => previewMask(mask),
            onCommit: (mask, coalesceKey = null) => applyMask(mask, coalesceKey),
            onRemove: removeMaskComponent,
          } : null}
          onCancelFill={(ids) => applyRetouch(adjustments.retouch.filter((op) => !ids.includes(op.id)))}
          retouchTool={ready && !transformMode && (retouchTool || retouchSelected || retouchArea) ? {
            tool: retouchTool,
            brush: retouchBrush,
            clone: retouchClone,
            picking: retouchPicking,
            selectedId: retouchSelected,
            newId: newLayerId,
            onCommit: (op, offset) => {
              if (adjustments.retouch.length >= RETOUCH_LIMITS.operations) { setRetouchMessage(`A photo can hold up to ${RETOUCH_LIMITS.operations} retouch operations.`); return; }
              applyRetouch([...adjustments.retouch, op]);
              setRetouchSelected(op.id);
              setRetouchMessage(null);
              if (op.type === 'clone' && retouchClone.aligned && !retouchClone.offset) setRetouchClone((clone) => ({ ...clone, offset }));
            },
            onSelect: setRetouchSelected,
            onUpdate: (id, patch) => applyRetouch(updateRetouchOperation(adjustments.retouch, id, patch)),
            onSource: (source) => { setRetouchClone((clone) => ({ ...clone, source, offset: null })); setRetouchPicking(false); setRetouchMessage(null); },
            onError: setRetouchMessage,
            areaFor: retouchArea,
            onArea: (id, source) => { applyRetouch(updateRetouchOperation(adjustments.retouch, id, { source })); setRetouchArea(null); },
          } : null}
          layerRasters={layerRasters}
          lutFor={lutFor}
          exportSize={ready ? outputOf(photo) : null}
          onWatermarkAuto={setWatermarkAuto}
        />
        {!state.photos.length && (
          <div className="pe-empty">
            <p className="pe-empty__title">Edit photographs in your browser</p>
            <p>Drop JPEG, PNG, WebP or RAW (Sony ARW, Nikon NEF, DNG) files here, or</p>
            <button type="button" className="pe-button pe-button--primary pe-button--large" onClick={openPicker}>Choose photos</button>
            <p className="pe-note">Your photographs are decoded, edited and exported on this device. They are never uploaded, and no account is needed.</p>
          </div>
        )}
        {transform && (
          <div className="pe-croptools" role="toolbar" aria-label={transformMode === 'corners' ? 'Perspective corners' : 'Crop and straighten'}>
            {transformMode === 'crop' && (
              <>
                <label className="pe-croptools__ratio">
                  <span className="visually-hidden">Crop ratio</span>
                  <select
                    value={aspectBase(adjustments.geometry.aspect)}
                    onChange={(event) => {
                      const base = event.target.value;
                      const current = parseAspect(adjustments.geometry.aspect);
                      const aspect = current && current.h > current.w && parseAspect(base) ? swapAspect(base) : base;
                      try { setGeometry(setAspect(adjustments.geometry, aspect, { width: photo.width, height: photo.height })); } catch (error) { if (!(error instanceof GeometryError)) throw error; }
                    }}
                  >
                    {aspectChoices(aspectBase(adjustments.geometry.aspect)).map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
                  </select>
                </label>
                <button
                  type="button"
                  className="pe-icon-button"
                  disabled={!parseAspect(adjustments.geometry.aspect)}
                  onClick={() => setGeometry(setAspect(adjustments.geometry, swapAspect(adjustments.geometry.aspect), { width: photo.width, height: photo.height }))}
                  aria-label="Swap the crop ratio between landscape and portrait"
                  title="Swap landscape / portrait"
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="5" width="8" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" /><rect x="7" y="2.5" width="6" height="11" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2 1.5" /></svg>
                </button>
                <button type="button" className="pe-icon-button" onClick={() => { const value = constrained(turnGeometry(adjustments.geometry, -1)); if (value) setGeometry(value); }} aria-label="Rotate 90° counterclockwise" title="Rotate 90° counterclockwise">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d={TURN_LEFT} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              </>
            )}
            <span className="pe-croptools__spacer" />
            <button type="button" className="pe-button" onClick={cancelTransform}>Cancel</button>
            <button type="button" className="pe-button pe-button--primary" onClick={applyTransform}>Apply</button>
          </div>
        )}
        <div className="pe-zoom" role="group" aria-label="Zoom">
          <button type="button" className="pe-icon-button" disabled={!ready} onClick={() => setZoomCommand({ type: 'out', at: Date.now() })} aria-label="Zoom out" title="Zoom out (−)">−</button>
          <button type="button" className="pe-text-button" disabled={!ready} onClick={() => setZoomCommand({ type: 'fit', at: Date.now() })} title="Fit to screen (0)">Fit</button>
          <button type="button" className="pe-text-button" disabled={!ready} onClick={() => setZoomCommand({ type: 'actual', at: Date.now() })} title="Actual pixels (1)">100%</button>
          <button type="button" className="pe-icon-button" disabled={!ready} onClick={() => setZoomCommand({ type: 'in', at: Date.now() })} aria-label="Zoom in" title="Zoom in (+)">+</button>
          <button
            type="button"
            className="pe-text-button pe-zoom__crop"
            disabled={!ready}
            aria-pressed={transformMode === 'crop'}
            onClick={() => openTransform(transformMode === 'crop' ? null : 'crop')}
            title="Crop, straighten and rotate (C)"
          >
            Crop
          </button>
          <button
            type="button"
            className="pe-text-button pe-zoom__text"
            disabled={!ready || Boolean(transformMode)}
            aria-pressed={layerToolOn}
            onClick={() => setLayerToolOn((on) => !on)}
            title="Add, move, resize and rotate text on the photo (T)"
          >
            Text
          </button>
          <button
            type="button"
            className="pe-text-button pe-zoom__inspect"
            disabled={!ready || Boolean(photo?.hdr) || Boolean(transformMode)}
            aria-pressed={inspecting}
            onClick={() => (inspecting ? closeInspect() : setInspecting(true))}
            title={photo?.hdr ? '1:1 inspection is not available for merged HDR photos' : 'Render the visible area at full resolution, as the export does (Detail at 1:1)'}
          >
            1:1 Detail
          </button>
        </div>
      </main>

      <aside className="pe-inspector" aria-label="Adjustments and export">
        <div className="pe-inspector__section" data-section="adjust">
          <LayersPanel
            layers={adjustments.layers}
            activeId={activeLayer}
            disabled={!ready}
            canvas={ready ? canvasSize : null}
            sources={layerSourcesUi}
            onSelect={selectLayer}
            onApply={(layers, coalesceKey = null) => dispatch({ type: 'applySettings', patch: { layers }, coalesceKey })}
            onPreview={(layers) => dispatch({ type: 'previewSettings', patch: { layers } })}
            onCommit={() => dispatch({ type: 'commitAdjustment' })}
            onAddText={addTextLayer}
            onAddAdjustment={addAdjustmentLayer}
            onEditSettings={() => setMobilePanel('adjust')}
            tool={layerToolOn}
            onTool={(on) => { if (!transformMode) setLayerToolOn(on); }}
            freeResize={freeResize}
            onFreeResize={setFreeResize}
          />
          <input ref={layerInputRef} type="file" accept={ACCEPT} hidden data-layer-input onChange={(event) => { onLayerFile(event.target.files[0]); event.target.value = ''; }} />
          <RetouchPanel
            disabled={!ready}
            operations={ready ? adjustments.retouch : []}
            tool={retouchTool}
            onTool={chooseRetouchTool}
            brush={retouchBrush}
            onBrush={setRetouchBrush}
            clone={retouchClone}
            onClone={setRetouchClone}
            picking={retouchPicking}
            onPicking={setRetouchPicking}
            selectedId={retouchSelected}
            onSelect={setRetouchSelected}
            onApply={applyRetouch}
            message={retouchMessage}
            areaFor={retouchArea}
            onAreaFor={(id) => { setRetouchArea(id); if (id) { setRetouchTool(null); setRetouchSelected(id); } }}
          />
          <MaskPanel
            disabled={!ready}
            locals={ready ? adjustments.local : []}
            layer={maskLayer}
            target={maskTarget}
            space={ready ? maskSpace : null}
            selectedId={maskComponent}
            onSelect={setMaskComponent}
            onSelectLocal={selectLocal}
            onSelectLayerMask={(on) => { setLayerMaskOn(on); setMaskComponent(null); if (on) setLayerToolOn(false); else setMaskTool(null); }}
            tool={maskTool}
            onTool={chooseMaskTool}
            brush={brush}
            onBrush={setBrush}
            overlay={maskOverlay}
            onOverlay={setMaskOverlay}
            onApplyLocals={(local, coalesceKey = null) => dispatch({ type: 'applySettings', patch: { local }, coalesceKey })}
            onApplyMask={applyMask}
            onPreviewMask={previewMask}
            onCommit={() => dispatch({ type: 'commitAdjustment' })}
            newId={newLayerId}
            onEditSettings={() => setMobilePanel('adjust')}
          />
          <AdjustPanel
            adjustments={panelAdjustments}
            layer={targetLocal ? { label: targetLocal.name || 'Local adjustment', local: true } : targetLayer ? { label: layerLabel(targetLayer), adjustment: targetLayer.type === 'adjustment' } : null}
            disabled={!ready || (!targetLocal && Boolean(targetLayer?.locked))}
            dispatch={panelDispatch}
            lut={{ library: [...luts.values()], onImport: importLut, status: lutStatus }}
            presets={{ userPresets, onChange: changePresets, onPreview: targetLayer ? () => {} : setPresetPreview, onDownload: downloadBlob, newId }}
            recipes={{ recipes, onChange: changeRecipes, onOpen: (mode, recipe = null) => setRecipeDialog({ mode, recipe }), onDownload: downloadBlob, newId }}
            raw={ready ? photo.raw ?? null : null}
            hdr={ready ? photo.hdr ?? null : null}
            geometry={ready ? { native: { width: photo.width, height: photo.height }, mode: transformMode, onMode: openTransform, onChange: changeGeometry, onCommit: commitGeometry, onStraightening: setStraightening } : null}
            text={{ selectedId: activeLayer, onSelect: setActiveLayer, editing: layerToolOn, onTool: (on) => { if (!transformMode) setLayerToolOn(on); }, focusRequest: textFocus }}
            thumbnails={filterThumbnails}
            watermark={{ defaults: watermarkDefaults, auto: watermarkAuto, onDownload: downloadBlob }}
          />
        </div>
        <div className="pe-inspector__section" data-section="export">
          <ExportPanel
            blockedReason={missingLut ? `The LUT "${missingLut.name}" is not loaded. Import it again (LUT section) or remove it to export.` : hdrExportCheck && !hdrExportCheck.fits ? hdrMemoryMessage(hdrExportCheck) : null}
            settings={state.exportSettings}
            photo={photo}
            output={ready ? outputOf(photo) : null}
            dispatch={dispatch}
            onExport={exportActive}
            onCancel={cancelExport}
            unsupportedFormats={unsupportedFormats}
            busy={exporting || Boolean(batchRun?.running)}
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
            <div><dt>Ctrl/⌘ click, Shift click</dt><dd>Add to selection, select a range</dd></div>
            <div><dt>Ctrl/⌘ A, Esc</dt><dd>Select all, clear selection</dd></div>
            <div><dt>Ctrl/⌘ Shift C, V</dt><dd>Copy edits, paste to selected</dd></div>
            <div><dt>+ − 0 1</dt><dd>Zoom in, out, fit, 100%</dd></div>
            <div><dt>C, Enter, Esc</dt><dd>Crop tool, apply, cancel</dd></div>
            <div><dt>T, arrows, Delete</dt><dd>Move tool for image and text layers; move or remove the selected layer</dd></div>
            <div><dt>Alt ↑ ↓ on a layer</dt><dd>Move the layer up or down the stack</dd></div>
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
          {importing ? `Importing ${importing} file${importing === 1 ? '' : 's'}…` : readyCount ? `${state.photos.findIndex(({ id }) => id === state.activeId) + 1} / ${state.photos.length}${multiple ? ` · ${selected.length} selected` : ''}` : ''}
        </p>
        {readyCount > 1 && (
          <button type="button" className="pe-text-button pe-filmstrip__select" aria-pressed={selecting} onClick={() => setSelecting((value) => !value)} title="Tap photos to add or remove them">
            {selecting ? 'Done' : 'Select'}
          </button>
        )}
        <button type="button" className="pe-icon-button pe-filmstrip__add" onClick={openPicker} aria-label="Import photos">+</button>
      </nav>

      <nav className="pe-tabs" aria-label="Editor panels">
        {[['library', 'Photos'], ['adjust', 'Adjust'], ['export', 'Export']].map(([value, label]) => (
          <button key={value} type="button" aria-pressed={mobilePanel === value} onClick={() => setMobilePanel(value)}>{label}</button>
        ))}
      </nav>

      {dragDepth > 0 && <div className="pe-drop" aria-hidden="true"><p>Drop to import. Files stay on this device.</p></div>}
      {batchDialog && photo?.status === 'ready' && (
        <BatchDialog
          mode={batchDialog}
          source={photo}
          targets={batchDialog === 'sync' ? selected.filter(({ id }) => id !== photo.id) : selected}
          presets={userPresets}
          luts={[...luts.values()]}
          thumbnailOf={thumbnailOf}
          lutFor={lutFor}
          onApply={applyPlan}
          onClose={() => setBatchDialog(null)}
        />
      )}
      {recipeDialog && (recipeDialog.mode === 'instructions' || photo?.status === 'ready') && (
        <RecipeDialog
          mode={recipeDialog.mode}
          recipe={recipeDialog.recipe}
          adjustments={adjustments}
          targets={selected}
          luts={[...luts.values()]}
          thumbnailOf={thumbnailOf}
          lutFor={lutFor}
          onLoadLut={loadRecipeLut}
          onApply={applyRecipePlan}
          onSave={saveRecipe}
          onDownload={downloadBlob}
          onClose={() => setRecipeDialog(null)}
        />
      )}
      {exportDialogOpen && (
        <BatchExportDialog
          photos={selected}
          settings={state.exportSettings}
          dispatch={dispatch}
          unsupportedFormats={unsupportedFormats}
          blockerFor={(item) => exportBlocker(item, state.exportSettings)}
          outputOf={outputOf}
          run={batchRun}
          constrained={constrainedDevice()}
          onStart={(options) => startBatchExport(selected.map(({ id }) => id), options)}
          onCancel={() => batchRef.current?.cancel()}
          onCancelItem={(id) => batchRef.current?.cancelItem(id)}
          onRetry={(ids, options) => startBatchExport(ids, options)}
          onClose={() => { if (!batchRun?.running) { setExportDialogOpen(false); setBatchRun(null); } }}
        />
      )}
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
