import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { deriveParams } from '../pipeline/spec.mjs';
import { glowDependencies } from '../pipeline/detailRenderer.mjs';
import { adjustmentsEqual, neutralAdjustments, neutralGroup } from '../model/adjustments.mjs';
import { GeometryError, cropRatio, frameGeometry, geometryPlan, neutralGeometry } from '../pipeline/geometry.mjs';
import { warpSpec } from '../pipeline/warp.mjs';
import CropOverlay from './CropOverlay';
import { GlRenderer, probeEditorContext } from '../pipeline/glRenderer.mjs';
import { debugFlag, recordDiagnostic } from '../io/diagnostics.mjs';
import { previewEdgeLimit } from '../io/files.mjs';
import InspectView from './InspectView';
import LayerHandles from './LayerHandles';
import { visibleLayers } from '../model/layers.mjs';
import { adjustmentParams, adjustmentPass, compositeImageSync, localPasses, rasterPass } from '../pipeline/composite.mjs';
import { layerMatrix, offsetMatrix } from '../pipeline/layerTransform.mjs';
import { maskActive, maskHasComponents, splitLocalSettings, visibleLocals } from '../model/masks.mjs';
import { canvasMaskMap, imageMaskMap, layerMaskMap, maskMapKey, rasterizeMask } from '../pipeline/mask.mjs';
import { createLocalPreview, renderDetailFrame } from '../pipeline/localPreview.mjs';
import MaskTool from './MaskTool';
import { rasterizeTextLayer } from '../text/textRender.mjs';
import { loadTextFonts } from '../text/fonts.mjs';
import { DESIGN, layoutWatermark, regionLuminance, resolveWatermarkColor, sampleBox, watermarkActive } from '../watermark/watermark.mjs';
import { drawMark, loadWatermarkFonts, markBounds } from '../watermark/watermarkRender.mjs';
import { applyRetouch, applyRetouchAsync, applyRetouchOperation, findHealSource } from '../pipeline/retouch.mjs';
import { createInpaintRunner } from '../pipeline/inpaintClient.mjs';
import { retouchEqual } from '../model/retouch.mjs';
import RetouchTool from './RetouchTool';

const NO_RETOUCH = Object.freeze([]);
const unionBox = (a, b) => (!a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
/** The proxy's pixels as { width, height, data } (an ImageBitmap proxy is read once through a canvas). */
function proxyPixels(source) {
  if (source.data) return source;
  const canvas = Object.assign(document.createElement('canvas'), { width: source.width, height: source.height });
  const context = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
  context.drawImage(source, 0, 0);
  const { data } = context.getImageData(0, 0, source.width, source.height, { colorSpace: 'srgb' });
  canvas.width = 0;
  return { width: source.width, height: source.height, data };
}
/** Copies a pixel box from `from` (a typed array of the same layout) back into `image`. */
function restoreBox(from, image, box) {
  const channels = Math.round(image.data.length / (image.width * image.height));
  for (let y = box.y0; y < box.y1; y += 1) {
    const start = (y * image.width + box.x0) * channels;
    image.data.set(from.subarray(start, (y * image.width + box.x1) * channels), start);
  }
}

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 8;
const STAGE_PADDING = 24;
const CPU_ONLY_OFF = Object.freeze({ captureResolution: 0, jpegAmount: 0, chromaticAberration: 0, channelShift: 0 });
// Detail preview (rendered on the CPU by the export's renderer): a quick draft while
// values change, then the final frame. Long edges in pixels, capped by the proxy.
export const DETAIL_DRAFT_EDGE = 1024;
export const DETAIL_FINAL_EDGE = 2048;

/**
 * Creates the preview engine for a canvas: WebGL2 when it works, otherwise null with
 * the reason, and the caller draws with the CPU renderer on a fresh canvas (a canvas
 * that has returned a WebGL context can never return a 2D one).
 */
function createEngine(canvas, maxPreviewEdge) {
  if (debugFlag('cpu-preview')) return { engine: null, reason: 'WebGL2 turned off by #cpu-preview.' };
  const { gl, reason } = probeEditorContext(canvas);
  if (!gl) return { engine: null, reason };
  try {
    return { engine: { kind: 'webgl2', renderer: new GlRenderer(canvas, gl), maxEdge: Math.min(maxPreviewEdge, gl.getParameter(gl.MAX_TEXTURE_SIZE)) } };
  } catch (error) {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { engine: null, reason: error.message };
  }
}

function createCpuEngine(host, maxPreviewEdge) {
  const element = document.createElement('canvas');
  element.className = 'pe-canvas';
  element.setAttribute('aria-hidden', 'true');
  host.appendChild(element);
  const context = element.getContext('2d');
  if (!context) throw new Error('This browser cannot draw a 2D canvas, so the preview cannot be shown.');
  return { element, engine: { kind: 'cpu', context, maxEdge: Math.min(2048, maxPreviewEdge) } };
}

const whenIdle = (task) => (typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(task, { timeout: 1000 }) : setTimeout(task, 200));
const clampZoom = (value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
const NEUTRAL_GEOMETRY = neutralGeometry();
const specKey = (spec) => (spec ? JSON.stringify([spec.matrix, spec.width, spec.height, spec.coverage, spec.background]) : '');
// What a text sprite depends on (not opacity, blend mode, lock or name: the compositor applies those).
const spriteKey = ({ opacity, blend, locked, name, visible, ...drawn }, out) => `${out.width}x${out.height}|${JSON.stringify(drawn)}`;

/** A frame at `out` size (Detail frames are rendered at most DETAIL_FINAL_EDGE px). */
function scaleFrame(frame, out) {
  if (frame.width === out.width && frame.height === out.height) return frame;
  const scratch = document.createElement('canvas');
  scratch.width = frame.width;
  scratch.height = frame.height;
  scratch.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height), 0, 0);
  const target = document.createElement('canvas');
  target.width = out.width;
  target.height = out.height;
  const context = target.getContext('2d', { willReadFrequently: true });
  context.drawImage(scratch, 0, 0, out.width, out.height);
  return { width: out.width, height: out.height, data: context.getImageData(0, 0, out.width, out.height).data };
}

const hasDetailPass = (passes) => Boolean(passes?.some(({ kind }) => kind === 'detail'));
// The Detail pass of a local adjustment that is shown but has no mask yet, or null.
function warmPass(local, native) {
  if (!local?.enabled || !(local.amount > 0) || maskHasComponents(local.mask)) return null;
  return localPasses(local, null, native, splitLocalSettings(local.settings)).find(({ kind }) => kind === 'detail') ?? null;
}

/**
 * The map of a mask's owner at a canvas of `out` size: a local adjustment's mask is in the
 * photo's own space (through its geometry `plan`), an image layer's in its box, others on the canvas.
 */
export function ownerMaskMap(owner, out, plan, native) {
  if (owner.kind === 'local') return imageMaskMap(plan, out, native);
  if (owner.layer.type === 'image') {
    const box = { width: owner.layer.source.width, height: owner.layer.source.height };
    return layerMaskMap(layerMatrix(owner.layer, out, box), box);
  }
  return canvasMaskMap(out);
}

/** The CPU rendering of a base frame with the layer passes composited over it (no-WebGL2 preview). */
function withLayers(frame, passes) {
  if (!passes?.length) return frame;
  const copy = { width: frame.width, height: frame.height, data: new Uint8ClampedArray(frame.data) };
  return compositeImageSync(copy, passes);
}

/**
 * What the viewer shows: the photo's geometry, or in Crop & Transform the whole
 * transformed frame (no crop or resize; in corners mode also no perspective) under the
 * overlay. A transform that cannot be built falls back to none, with the reason.
 */
export function viewGeometry(geometry, mode, native) {
  const base = geometry ?? NEUTRAL_GEOMETRY;
  const shown = mode === 'corners' ? { ...frameGeometry(base), quad: null, perspective: { vertical: 0, horizontal: 0 } } : mode ? frameGeometry(base) : base;
  try {
    return { plan: geometryPlan(shown, native), error: null };
  } catch (error) {
    if (!(error instanceof GeometryError)) throw error;
    return { plan: geometryPlan(NEUTRAL_GEOMETRY, native), error: error.message };
  }
}

// Overlay pixels per mask code: tinted at 55% of the coverage, or the coverage as grey.
const overlayTables = new Map();
function overlayTable(view, hex) {
  const key = `${view}${hex}`;
  if (!overlayTables.has(key)) {
    const table = new Uint32Array(256);
    const bytes = new Uint8Array(table.buffer);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (let v = 0; v < 256; v += 1) bytes.set(view === 'mask' ? [v, v, v, 255] : [r, g, b, Math.round(v * 0.55)], v * 4);
    overlayTables.set(key, table);
  }
  return overlayTables.get(key);
}

/**
 * Centre workspace: the processed preview with zoom, pan and before/after.
 * Zoom is expressed in output pixels per CSS pixel (1 = 100%): pixels of the photo after
 * its geometry (crop, rotation, resize), so 100% is the export's pixel grid at original size.
 * :param transform: Crop & Transform mode ({ mode: 'crop' | 'corners', guide, onPreview,
 *   onCommit, onSet, onApply, onCancel }) or null
 * :param layerTool: the layer handles' props (LayerHandles), with `interactive`, or null
 * :param layerRasters: { get(layer, canvasSize) → raster or null while it loads (then `version`
 *   changes), version } for image layers; `lutFor(settings)` finds a layer's LUT
 * Layers are composited over the photo (GPU passes, or on the CPU without WebGL2); they are
 * not shown in Original, on the "before" side of Split, while cropping or in 1:1 Detail. Local
 * adjustments are applied below the layers in the same way; their Detail settings switch the
 * preview to the CPU renderer (draft, then final).
 * :param maskTool: the mask being edited ({ owner: { kind: 'local' } | { kind: 'layer', layer },
 *   mask, interactive, overlay: { show, color, view: 'overlay' | 'mask' }, and MaskTool's props }) or null
 * :param exportSize: { width, height } of the export with the current settings; the watermark is
 *   laid out for it (watermark/watermark.mjs) and drawn at screen resolution on its own small
 *   canvas over the photo, so moving or resizing it never renders the photo again
 * :param onWatermarkAuto: receives { variant, mean } of the preview's backdrop when the colour is Auto
 */
export default function Viewer({ photo, adjustments: settings, lut = null, previewing = null, compare, split, onSplitChange, loadProxy, renderInWorker, renderLocalDetail = null, deferWork = false, onEngine, onProxy = null, zoomCommand, inspect = null, transform = null, layerTool = null, maskTool = null, retouchTool = null, onCancelFill = null, layerRasters = null, lutFor = () => null, exportSize: exportSizeProp = null, onWatermarkAuto = null }) {
  // The photo's settings keep their identity while only the watermark changes, so a watermark
  // edit redraws only its own overlay, never the photo or its layers.
  const settingsRef = useRef(settings);
  if (settingsRef.current !== settings && !adjustmentsEqual({ ...settingsRef.current, watermark: null }, { ...settings, watermark: null })) settingsRef.current = settings;
  const adjustments = settingsRef.current;
  const watermarkSettings = settings.watermark;
  // Compared by value: the parent computes the export size afresh on every render.
  const exportKey = exportSizeProp ? `${exportSizeProp.width}x${exportSizeProp.height}` : null;
  const exportSize = useMemo(() => exportSizeProp, [exportKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const stageRef = useRef(null);
  const canvasHostRef = useRef(null);
  const engineRef = useRef(null);
  const proxyRef = useRef(null);
  // The loaded (untouched) proxy; proxyRef holds its retouched copy when the photo has retouch.
  const originalRef = useRef(null);
  const frameRef = useRef(0);
  const cpuJobRef = useRef({ latest: 0, busy: false, queued: null });
  // CPU preview of a RAW photo: its neutral development, for Original and Split.
  const cpuBeforeRef = useRef({ image: null, key: '', data: null });
  // Detail preview: the request waiting to run, and the last frame shown with its settings key.
  const detailJobRef = useRef({ busy: false, pending: null, frame: null, key: null, image: null, generation: 0 });
  // Bloom and halation map for the GPU preview (computed in the render worker), latest only.
  const glowRef = useRef({ key: null, map: null, image: null, busy: false, pending: null });
  const [glowVersion, setGlowVersion] = useState(0);
  const splitRef = useRef(0);
  const [detailQuality, setDetailQuality] = useState(null);
  // Local Detail over the Detail frame: each pass filtered once (local worker), mixed through its
  // mask on every brush move; `localVersion` repaints when a filtered frame arrives.
  const [localVersion, setLocalVersion] = useState(0);
  const renderLocalRef = useRef(renderLocalDetail);
  renderLocalRef.current = renderLocalDetail;
  // While an export runs, Detail passes not filtered yet wait (shown without them, labelled).
  const deferRef = useRef(deferWork);
  deferRef.current = deferWork;
  const localPreviewRef = useRef(null);
  localPreviewRef.current ??= createLocalPreview({
    renderDetail: (image, pass) => (renderLocalRef.current ? renderLocalRef.current(image, pass) : Promise.resolve().then(() => renderDetailFrame(image, pass))),
    onReady: (error) => { if (error) setStatus({ state: 'error', message: error.message }); else { performance.mark?.('pe-local-ready'); setLocalVersion((value) => value + 1); } },
  });
  // The Detail frame at the canvas's size, made once per frame; the GPU frame read back for
  // local Detail over GPU settings.
  const scaledRef = useRef({ frame: null, key: '', image: null });
  const gpuBaseRef = useRef({ key: '', image: null });
  const [canvas, setCanvas] = useState(null);
  const [engineKind, setEngineKind] = useState(null);
  const [proxy, setProxy] = useState(null);
  const [status, setStatus] = useState({ state: 'idle' });
  // A preview engine that could not start at all; unlike `status`, never reset by photo changes.
  const [engineError, setEngineError] = useState(null);
  const [view, setView] = useState({ fit: true, zoom: 1, x: 0, y: 0 });
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const dragRef = useRef(null);
  // Text layer sprites at the preview's size, by what they draw; fonts load once text is used.
  const spritesRef = useRef(new Map());
  // Mask coverage at the preview's size, by mask and map (only those the last frame used are kept).
  const masksRef = useRef(new Map());
  const overlayRef = useRef(null);
  const [fontsReady, setFontsReady] = useState(false);
  const [layersLoading, setLayersLoading] = useState(0);
  const [layersShown, setLayersShown] = useState(0);
  const hasText = adjustments.layers.some((layer) => layer.type === 'text');
  useEffect(() => {
    if (!hasText || fontsReady) return undefined;
    let alive = true;
    loadTextFonts().catch(() => {}).then(() => { if (alive) setFontsReady(true); });
    return () => { alive = false; };
  }, [hasText, fontsReady]);

  // A fresh canvas per engine: a canvas that tried WebGL2 cannot fall back to 2D.
  useLayoutEffect(() => {
    const host = canvasHostRef.current;
    const maxPreviewEdge = previewEdgeLimit();
    let element = document.createElement('canvas');
    element.className = 'pe-canvas';
    element.setAttribute('aria-hidden', 'true');
    host.appendChild(element);
    window.__editorStartup?.stage('preview engine starting');
    let { engine, reason } = createEngine(element, maxPreviewEdge);
    if (!engine) {
      element.remove();
      recordDiagnostic('webgl2', `${reason} Using the CPU preview.`, 'warning');
      try {
        ({ element, engine } = createCpuEngine(host, maxPreviewEdge));
      } catch (error) {
        recordDiagnostic('preview', error.message);
        onEngine?.({ kind: 'none', reason: error.message });
        setEngineError(error.message);
        return undefined;
      }
    }
    engineRef.current = engine;
    // The shown preview's pixels (output frame, top row first) for the local browser checks.
    window.__photoEditorPreview = {
      read: () => (engine.kind === 'webgl2' ? engine.renderer.snapshot() : (({ width, height }) => ({ width, height, data: engine.context.getImageData(0, 0, width, height).data }))(engine.context.canvas)),
    };
    setCanvas(element);
    setEngineKind(engine.kind);
    window.__editorStartup?.stage(`preview engine: ${engine.kind}${engine.kind === 'cpu' ? ` (${reason})` : ''}`);
    onEngine?.({ kind: engine.kind, maxEdge: engine.maxEdge, reason: engine.kind === 'cpu' ? reason : null });

    const onLost = (event) => { event.preventDefault(); recordDiagnostic('webgl2', 'Graphics context lost.', 'warning'); setStatus({ state: 'error', message: 'The graphics context was lost. Restoring the preview…' }); };
    const onRestored = () => {
      try {
        engine.renderer = new GlRenderer(element);
      } catch (error) {
        recordDiagnostic('webgl2', `Context restore failed: ${error.message}`);
        setStatus({ state: 'error', message: 'The graphics context could not be restored. Reload the page to continue.' });
        return;
      }
      if (originalRef.current) engine.renderer.setSource(originalRef.current);
      setStatus({ state: 'ready' });
      setProxy((current) => (current ? { ...current } : current));
    };
    element.addEventListener('webglcontextlost', onLost);
    element.addEventListener('webglcontextrestored', onRestored);
    return () => {
      element.removeEventListener('webglcontextlost', onLost);
      element.removeEventListener('webglcontextrestored', onRestored);
      engine.renderer?.dispose();
      element.remove();
      engineRef.current = null;
      delete window.__photoEditorPreview;
    };
  }, [onEngine]);

  // Load the active photo's proxy; stale loads are ignored.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !photo || photo.status !== 'ready') {
      setProxy(null);
      proxyRef.current = null;
      onProxy?.(null);
      setStatus({ state: photo?.status === 'error' ? 'error' : 'idle', message: photo?.error });
      return undefined;
    }
    let cancelled = false;
    setStatus({ state: 'loading' });
    loadProxy(photo, engine.maxEdge).then((image) => {
      if (cancelled) return;
      if (engine.kind === 'webgl2') engine.renderer.setSource(image);
      else { canvas.width = image.width; canvas.height = image.height; }
      proxyRef.current = image;
      originalRef.current = image;
      onProxy?.({ photoId: photo.id, image });
      setProxy({ id: photo.id, width: image.width, height: image.height });
      setView({ fit: true, zoom: 1, x: 0, y: 0 });
      setStatus({ state: 'ready' });
      // The layer and mask programs start compiling once the photo is shown, so the first brush
      // point or layer does not wait for the driver (the first brush point took ~0.5 s for this).
      if (engine.kind === 'webgl2') whenIdle(() => { if (engineRef.current === engine) engine.renderer.prepareCompositor(); });
    }).catch((error) => {
      if (!cancelled && error.code !== 'cancelled') setStatus({ state: 'error', message: error.message });
    });
    return () => { cancelled = true; };
  }, [photo?.id, photo?.status, loadProxy, canvas]); // eslint-disable-line react-hooks/exhaustive-deps

  // Release the GPU texture when no photo is shown, and frames cached for another proxy:
  // they would keep that photo's pixels (tens of MB for a RAW) alive after it left.
  useEffect(() => {
    if (!proxy) engineRef.current?.renderer?.clear();
    if (cpuBeforeRef.current.image !== proxyRef.current) Object.assign(cpuBeforeRef.current, { image: null, key: '', data: null });
    if (detailJobRef.current.image !== proxyRef.current) {
      Object.assign(detailJobRef.current, { frame: null, image: null, key: null });
      Object.assign(scaledRef.current, { frame: null, key: '', image: null });
      gpuBaseRef.current = { key: '', image: null };
      localPreviewRef.current.clear();
    }
    if (glowRef.current.image !== proxyRef.current) Object.assign(glowRef.current, { map: null, image: null, key: null });
  }, [proxy]);

  /** Computes the glow map of the shown proxy in the worker; the GPU keeps drawing meanwhile. */
  const requestGlow = useCallback(async (request) => {
    const job = glowRef.current;
    job.pending = request;
    if (job.busy) return;
    job.busy = true;
    try {
      while (job.pending) {
        const current = job.pending;
        job.pending = null;
        if (proxyRef.current !== current.image) continue; // eslint-disable-line no-continue
        const map = await renderInWorker(current.image, current.adjustments, current.lut, current.raw, null, current.warp, true);
        if (proxyRef.current !== current.image || job.pending) continue; // eslint-disable-line no-continue
        Object.assign(job, { key: current.key, map, image: current.image });
        setGlowVersion((value) => value + 1);
        performance.mark?.('pe-glow-map');
      }
    } catch (error) {
      if (error.code !== 'cancelled') setStatus({ state: 'error', message: error.message });
    } finally {
      job.busy = false;
    }
  }, [renderInWorker]);

  const splitFraction = compare === 'original' ? 1 : compare === 'split' ? split : 0;
  splitRef.current = splitFraction;

  // The "before" side of the CPU preview: the source itself, or for RAW and merged RAW
  // HDR its neutral development; with geometry, warped like the edited side.
  const cpuBefore = useCallback(async (image, raw, warp = null) => {
    if (image.kind !== 'raw' && image.kind !== 'hdr' && !warp) return image;
    const cache = cpuBeforeRef.current;
    const key = specKey(warp);
    if (cache.image !== image || cache.key !== key) Object.assign(cache, { image, key, data: (await renderInWorker(image, neutralAdjustments(), null, raw, null, warp)).data });
    return { data: cache.data };
  }, [renderInWorker]);

  /**
   * The Detail frame scaled to the canvas with its passes composited (pipeline/localPreview.mjs):
   * passes whose filtered frame is still rendering are left out, and labelled.
   */
  const composeLocal = useCallback((frame, request) => {
    const out = request.warp ?? request.image;
    const scaled = scaledRef.current;
    const key = `${out.width}x${out.height}`;
    if (scaled.frame !== frame || scaled.key !== key) Object.assign(scaled, { frame, key, image: scaleFrame(frame, out) });
    const result = localPreviewRef.current.compose(scaled.image, request.layers.cpu, { defer: deferRef.current });
    const job = detailJobRef.current;
    const quality = !result.complete ? 'rendering' : job.shown === 'final' ? { width: frame.width, height: frame.height } : job.shown ?? 'draft';
    setDetailQuality((shown) => (JSON.stringify(shown) === JSON.stringify(quality) ? shown : quality));
    // Local timing mark for the browser checks (never sent anywhere): local Detail fully shown.
    if (result.complete) performance.mark?.('pe-local-detail');
    return result;
  }, []);

  /** Shows a Detail frame (any size; scaled to the canvas) with the current split. */
  const paintDetail = useCallback(async (frame, request) => {
    const engine = engineRef.current;
    const image = proxyRef.current;
    if (!engine || image !== request.image) return;
    const split = splitRef.current;
    if (engine.kind === 'webgl2') {
      const before = request.raw ? deriveParams(neutralAdjustments(), { raw: request.raw }) : null;
      if (engine.renderer.lost) return;
      // Local Detail runs on the CPU: then every pass is composited there, at the canvas's size.
      if (hasDetailPass(request.layers?.cpu)) {
        const { image: composited, dirty } = composeLocal(frame, request);
        engine.renderer.render({ ...request.params, neutral: true }, { split, before, rendered: composited, renderedDirty: dirty });
        return;
      }
      engine.renderer.render(request.params, { split, before, rendered: frame, layers: request.layers?.gpu });
      return;
    }
    const out = request.warp ?? image;
    const sourceWidth = Math.round(out.width * split);
    const before = sourceWidth > 0 ? await cpuBefore(originalRef.current ?? image, request.raw, request.warp) : null;
    if (proxyRef.current !== image) return;
    const { context } = engine;
    if (context.canvas.width !== out.width || context.canvas.height !== out.height) Object.assign(context.canvas, { width: out.width, height: out.height });
    if (hasDetailPass(request.layers?.cpu)) {
      const { image: composited, dirty } = composeLocal(frame, request);
      // The box a brush move changed; anything else (a split move too) redraws the canvas.
      const box = dirty && dirty.x1 > dirty.x0 ? dirty : { x0: 0, y0: 0, x1: out.width, y1: out.height };
      if (box.y1 > box.y0) context.putImageData(new ImageData(composited.data, out.width, out.height), 0, 0, box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
    } else if (frame.width === out.width && frame.height === out.height) {
      context.putImageData(new ImageData(new Uint8ClampedArray(withLayers(frame, request.layers?.cpu).data), frame.width, frame.height), 0, 0);
    } else {
      const scratch = document.createElement('canvas');
      scratch.width = frame.width;
      scratch.height = frame.height;
      scratch.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height), 0, 0);
      context.clearRect(0, 0, out.width, out.height);
      context.drawImage(scratch, 0, 0, out.width, out.height);
      if (request.layers?.cpu?.length) {
        const scaled = context.getImageData(0, 0, out.width, out.height);
        context.putImageData(new ImageData(withLayers(scaled, request.layers.cpu).data, out.width, out.height), 0, 0);
      }
    }
    if (before) context.putImageData(new ImageData(new Uint8ClampedArray(before.data), out.width, out.height), 0, 0, 0, 0, sourceWidth, out.height);
  }, [cpuBefore, composeLocal]);

  /**
   * Runs Detail renders one at a time, keeping only the newest request: a draft at
   * DETAIL_DRAFT_EDGE first, then, if nothing newer arrived, the final frame.
   */
  const runDetail = useCallback(async (request) => {
    const job = detailJobRef.current;
    job.pending = request;
    if (job.busy) return;
    job.busy = true;
    const needsFinal = (current) => Math.max((current.warp ?? current.image).width, (current.warp ?? current.image).height) > DETAIL_DRAFT_EDGE;
    try {
      let current = null;
      let final = false;
      for (;;) {
        if (job.pending) {
          current = job.pending;
          job.pending = null;
          final = false;
        } else if (current && !final && needsFinal(current)) {
          final = true;
        } else {
          break;
        }
        const { image } = current;
        if (proxyRef.current !== image) {
          current = null;
          continue; // eslint-disable-line no-continue
        }
        if (job.key !== current.key) setDetailQuality('rendering');
        const frame = await renderInWorker(image, current.adjustments, current.lut, current.raw, {
          edge: final ? DETAIL_FINAL_EDGE : DETAIL_DRAFT_EDGE,
          nativeWidth: current.nativeWidth,
          nativeHeight: current.nativeHeight,
        }, current.warp);
        // Newer values, another photo, or Detail turned off meanwhile: this frame is stale.
        if (current.generation !== job.generation) current = null;
        if (!current || job.pending || proxyRef.current !== image) continue; // eslint-disable-line no-continue
        const quality = final || !needsFinal(current) ? 'final' : 'draft';
        Object.assign(job, { frame, key: current.key, image, shown: quality });
        setDetailQuality(quality === 'final' ? { width: frame.width, height: frame.height } : 'draft');
        await paintDetail(frame, current);
        // Local timing marks for the browser checks (never sent anywhere).
        performance.mark?.(`pe-detail-${quality}`, { detail: { width: frame.width, height: frame.height } });
      }
    } catch (error) {
      if (error.code !== 'cancelled') setStatus({ state: 'error', message: error.message });
    } finally {
      job.busy = false;
    }
  }, [renderInWorker, paintDetail]);

  const drawCpu = useCallback(async (params) => {
    const job = cpuJobRef.current;
    const image = proxyRef.current;
    const engine = engineRef.current;
    if (!image || !engine) return;
    if (job.busy) { job.queued = params; return; }
    job.busy = true;
    const id = (job.latest += 1);
    try {
      const out = params.warp ?? image;
      const rendered = params.neutral && !params.warp ? image : await renderInWorker(image, params.adjustments, params.lutData, params.raw, params.nativeSize, params.warp);
      const sourceWidth = Math.round(out.width * params.split);
      const before = sourceWidth > 0 ? await cpuBefore(originalRef.current ?? image, params.raw, params.warp) : image;
      if (id === job.latest && proxyRef.current === image) {
        const { canvas: target } = engine.context;
        if (target.width !== out.width || target.height !== out.height) Object.assign(target, { width: out.width, height: out.height });
        engine.context.putImageData(new ImageData(new Uint8ClampedArray(withLayers({ ...out, data: rendered.data }, params.layers?.cpu).data), out.width, out.height), 0, 0);
        if (sourceWidth > 0) engine.context.putImageData(new ImageData(new Uint8ClampedArray(before.data), out.width, out.height), 0, 0, 0, 0, sourceWidth, out.height);
        performance.mark?.('pe-cpu-frame');
      }
    } catch (error) {
      if (error.code !== 'cancelled') setStatus({ state: 'error', message: error.message });
    } finally {
      job.busy = false;
      if (job.queued) {
        const next = job.queued;
        job.queued = null;
        drawCpu(next);
      }
    }
  }, [renderInWorker, cpuBefore]);

  // Geometry: what is shown (the whole frame while cropping), its output size at native
  // resolution, and the preview's warp (proxy px) at the proxy's scale.
  const native = useMemo(() => ({ width: photo?.width ?? 1, height: photo?.height ?? 1 }), [photo?.width, photo?.height]);
  const transformMode = transform?.mode ?? null;
  const { plan, error: geometryError } = useMemo(() => viewGeometry(adjustments.geometry, transformMode, native), [adjustments.geometry, transformMode, native]);
  const previewSpec = useMemo(() => {
    if (!proxy || plan.identity) return null;
    const scale = proxy.width / native.width;
    const out = { width: Math.max(1, Math.round(plan.native.width * scale)), height: Math.max(1, Math.round(plan.native.height * scale)) };
    return warpSpec(plan, out, { width: proxy.width, height: proxy.height });
  }, [plan, proxy, native]);
  // While cropping, Detail (CPU frames) is not rendered, so handles follow the pointer.
  // So are the CPU-only digital effects (capture, channel shift).
  const renderAdjustments = useMemo(() => (transformMode ? { ...adjustments, ...neutralGroup('detail'), ...CPU_ONLY_OFF } : adjustments), [adjustments, transformMode]);

  // Layer passes at the preview canvas's size: text sprites drawn here, image rasters from
  // `layerRasters` (skipped until loaded), adjustment layers with their derived parameters.
  const showLayers = !transformMode && compare !== 'original';
  // While the brush paints, the mask being edited keeps its strokes' coverage (mask.mjs), so each
  // new point costs only its own segment; the buffers are released when the brush is put away.
  const painting = Boolean(maskTool?.interactive && maskTool.tool === 'brush');
  const paintCacheRef = useRef(new Map());
  useEffect(() => { if (!painting) paintCacheRef.current.clear(); }, [painting]);
  const maskCoverage = useCallback((def, map, out, keys) => {
    const key = `${out.width}x${out.height}|${maskMapKey(map)}|${JSON.stringify(def)}`;
    keys.add(key);
    if (!masksRef.current.has(key)) masksRef.current.set(key, rasterizeMask(def, map, out, painting && def === maskTool.mask ? paintCacheRef.current : null));
    return { def, map, key, raster: masksRef.current.get(key) };
  }, [painting, maskTool?.mask]); // eslint-disable-line react-hooks/exhaustive-deps
  const overlayMask = maskTool?.overlay?.show && showLayers ? maskTool : null;
  const buildLayers = useCallback((out) => {
    const maskKeys = new Set();
    const keepMasks = () => { for (const key of masksRef.current.keys()) if (!maskKeys.has(key)) masksRef.current.delete(key); };
    // The overlay's coverage, kept while it is shown.
    const overlay = overlayMask ? maskCoverage(overlayMask.mask, ownerMaskMap(overlayMask.owner, out, plan, native), out, maskKeys) : null;
    const shown = showLayers ? visibleLayers(adjustments.layers) : [];
    const locals = showLayers ? visibleLocals(adjustments.local) : [];
    if (!shown.length && !locals.length) { keepMasks(); return overlay ? { cpu: [], gpu: [], loading: 0, overlay } : null; }
    const cpu = [];
    const gpu = [];
    const keys = new Set();
    let loading = 0;
    if (locals.length) {
      const map = imageMaskMap(plan, out, native);
      for (const local of locals) {
        for (const pass of localPasses(local, maskCoverage(local.mask, map, out, maskKeys), plan.native, splitLocalSettings(local.settings))) {
          cpu.push(pass);
          gpu.push(pass.kind === 'adjust' ? { ...pass, params: adjustmentParams(pass) } : pass);
        }
      }
    }
    const layerMask = (layer, map) => (maskActive(layer.mask) ? maskCoverage(layer.mask, map, out, maskKeys) : null);
    for (const layer of shown) {
      if (layer.type === 'adjustment') {
        const pass = adjustmentPass(layer, lutFor(layer.settings), layerMask(layer, canvasMaskMap(out)));
        if (layer.settings.lut && !pass.lut) continue; // eslint-disable-line no-continue
        cpu.push(pass);
        gpu.push({ ...pass, params: adjustmentParams(pass) });
        continue; // eslint-disable-line no-continue
      }
      let raster;
      let matrix;
      if (layer.type === 'text') {
        if (!fontsReady) { loading += 1; continue; } // eslint-disable-line no-continue
        const key = spriteKey(layer, out);
        keys.add(key);
        if (!spritesRef.current.has(key)) spritesRef.current.set(key, rasterizeTextLayer(layer, out));
        raster = spritesRef.current.get(key);
        if (!raster) continue; // eslint-disable-line no-continue
        matrix = offsetMatrix(raster.x, raster.y);
      } else {
        raster = layerRasters?.get(layer, out) ?? null;
        if (!raster) { loading += 1; continue; } // eslint-disable-line no-continue
        matrix = layerMatrix(layer, out, raster);
      }
      const pass = rasterPass(layer, raster, matrix, out, layerMask(layer, layer.type === 'image' ? layerMaskMap(matrix, raster) : canvasMaskMap(out)));
      if (!pass.bounds) continue; // eslint-disable-line no-continue
      cpu.push(pass);
      gpu.push({ ...pass, key: `${layer.id}:${raster.width}x${raster.height}` });
    }
    // Sprites of text and masks no longer shown are dropped.
    for (const key of spritesRef.current.keys()) if (!keys.has(key)) spritesRef.current.delete(key);
    keepMasks();
    return { cpu, gpu, loading, overlay };
  }, [showLayers, adjustments.layers, adjustments.local, layerRasters, fontsReady, lutFor, overlayMask, plan, native, maskCoverage]);

  // The selected mask over the photo: its coverage tinted (or as greyscale) on a 2D canvas.
  // While painting, only the box the new segment changed is redrawn (the raster's `change`
  // says which version it follows); one ImageData is reused and codes map through a table.
  const overlayDrawnRef = useRef(null);
  const drawOverlay = useCallback((overlay) => {
    const element = overlayRef.current;
    if (!element) return;
    if (!overlay) { element.width = 0; overlayDrawnRef.current = null; return; }
    const { raster } = overlay;
    const { width, height, data, change } = raster;
    const view = overlayMask?.overlay.view ?? 'overlay';
    const hex = /^#[0-9a-f]{6}$/i.test(overlayMask?.overlay.color ?? '') ? overlayMask.overlay.color : '#ff3b30';
    const last = overlayDrawnRef.current;
    const sized = element.width === width && element.height === height;
    const sameLook = Boolean(last && sized && last.view === view && last.hex === hex && last.image.width === width && last.image.height === height);
    if (sameLook && last.raster === raster) return;
    if (!sized) Object.assign(element, { width, height });
    const context = element.getContext('2d');
    const image = sameLook ? last.image : context.createImageData(width, height);
    const follows = sameLook && change && last.change && change.from !== null && change.key === last.change.key && change.from === last.change.version;
    const box = follows ? change.dirty : { x0: 0, y0: 0, x1: width, y1: height };
    if (box) {
      const table = overlayTable(view, hex);
      const pixels = new Uint32Array(image.data.buffer);
      for (let y = box.y0; y < box.y1; y += 1) {
        for (let i = y * width + box.x0, end = y * width + box.x1; i < end; i += 1) pixels[i] = table[data[i]];
      }
      context.putImageData(image, 0, 0, box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
    }
    overlayDrawnRef.current = { raster, change, view, hex, image };
  }, [overlayMask?.overlay.view, overlayMask?.overlay.color]); // eslint-disable-line react-hooks/exhaustive-deps

  // Retouch (pipeline/retouch.mjs) changes the source itself: the shown proxy is a retouched copy of
  // the loaded one. Appended operations are applied to that copy in place and only their box is
  // uploaded; any other change starts again from the loaded proxy. A stroke in progress is drawn
  // into the copy and undone from a snapshot when it ends. The loaded proxy stays for "before".
  const retouchOps = renderAdjustments.retouch ?? NO_RETOUCH;
  const retouchRef = useRef({ original: null, ops: NO_RETOUCH, image: null, preview: null });
  const [retouchVersion, setRetouchVersion] = useState(0);
  // Remove fills run in a worker: the photo keeps showing its last state meanwhile, with progress.
  const [retouchBusy, setRetouchBusy] = useState(null);
  const removerRef = useRef(null);
  const retouchJobRef = useRef(0);
  useEffect(() => () => removerRef.current?.dispose(), []);
  // Restores what the stroke in progress changed; `end` also drops its snapshot (one per stroke).
  const undoPreview = (state, end = true) => {
    const box = state.preview?.box ?? null;
    if (box) restoreBox(state.preview.snapshot, state.image, box);
    if (end) state.preview = null;
    else if (state.preview) state.preview.box = null;
    return box;
  };
  useEffect(() => {
    const original = originalRef.current;
    const engine = engineRef.current;
    if (!original || !engine || !proxy || proxy.id !== photo?.id) return;
    const state = retouchRef.current;
    const started = performance.now();
    const restored = state.original === original ? undoPreview(state) : null;
    const active = retouchOps.some(({ enabled }) => enabled);
    let image = original;
    let dirty = null;
    const appended = active && state.original === original && state.image && state.image !== original
      && retouchOps.length > state.ops.length && retouchEqual(state.ops, retouchOps.slice(0, state.ops.length));
    const work = appended ? retouchOps.slice(state.ops.length) : retouchOps;
    const job = (retouchJobRef.current += 1);
    if (active && work.some((op) => op.enabled && op.type === 'remove')) {
      // A fill: work on a copy in the background; a newer change abandons this one.
      removerRef.current?.cancel();
      removerRef.current ??= createInpaintRunner();
      const runner = removerRef.current;
      const base = appended ? state.image : proxyPixels(original);
      const copy = { ...base, kind: original.kind, data: base.data.slice() };
      const pending = work.filter((op) => op.enabled && op.type === 'remove').map(({ id }) => id);
      setRetouchBusy({ fraction: 0, ids: pending });
      let finished = 0;
      applyRetouchAsync(copy, work, {
        runRemove: (payload) => runner.run(payload, (fraction) => { if (retouchJobRef.current === job) setRetouchBusy({ fraction: (finished + fraction) / pending.length, ids: pending }); }).then((filled) => { finished += 1; return filled; }),
      }).then((changed) => {
        if (retouchJobRef.current !== job) return;
        retouchRef.current = { original, ops: retouchOps, image: copy, preview: null };
        proxyRef.current = copy;
        if (engine.kind === 'webgl2' && !engine.renderer.lost) engine.renderer.setRetouched(copy, appended ? unionBox(restored, changed) : null);
        setRetouchBusy(null);
        performance.mark?.('pe-retouch-applied', { detail: { ms: performance.now() - started, operations: retouchOps.length, incremental: appended, fill: true } });
        setRetouchVersion((version) => version + 1);
      }).catch((error) => {
        if (retouchJobRef.current !== job) return;
        setRetouchBusy(error.code === 'cancelled' ? null : { error: error.message });
      });
      return;
    }
    setRetouchBusy(null);
    if (active) {
      if (appended) {
        dirty = unionBox(restored, applyRetouch(state.image, work));
        image = { ...state.image };
      } else {
        const pixels = proxyPixels(original);
        image = { ...pixels, kind: original.kind, data: pixels.data.slice() };
        applyRetouch(image, retouchOps);
      }
    }
    retouchRef.current = { original, ops: retouchOps, image, preview: null };
    proxyRef.current = image;
    if (engine.kind === 'webgl2' && !engine.renderer.lost) {
      if (image === original) engine.renderer.setRetouched(null);
      else engine.renderer.setRetouched(image, dirty);
    }
    performance.mark?.('pe-retouch-applied', { detail: { ms: performance.now() - started, operations: retouchOps.length, incremental: Boolean(dirty) } });
    setRetouchVersion((version) => version + 1);
  }, [retouchOps, proxy, photo?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Draws a stroke in progress (an operation), or removes it (null), until the committed one arrives. */
  const previewRetouch = useCallback((op) => {
    const engine = engineRef.current;
    const state = retouchRef.current;
    if (!engine || !state.original || state.original !== originalRef.current) return;
    const started = performance.now();
    let box = undoPreview(state, !op);
    if (op) {
      if (!state.image || state.image === state.original) {
        const pixels = proxyPixels(state.original);
        state.image = { ...pixels, kind: state.original.kind, data: pixels.data.slice() };
        proxyRef.current = state.image;
        state.preview = null;
        box = null;
      }
      // The stroke's snapshot is taken once, at its first preview.
      state.preview ??= { snapshot: state.image.data.slice(), box: null };
      state.preview.box = applyRetouchOperation(state.image, op);
      box = box && state.preview.box ? unionBox(box, state.preview.box) : box ?? state.preview.box;
    }
    if (engine.kind === 'webgl2' && !engine.renderer.lost) engine.renderer.setRetouched(state.image === state.original ? null : state.image, box);
    proxyRef.current = state.image ?? state.original;
    performance.mark?.('pe-retouch-preview', { detail: { ms: performance.now() - started } });
    setRetouchVersion((version) => version + 1);
  }, []);
  /** A source for a heal stroke from the pixels as they are now (earlier operations included). */
  const healSource = useCallback((op) => {
    const state = retouchRef.current;
    const image = state.image ?? (originalRef.current ? proxyPixels(originalRef.current) : null);
    return image ? findHealSource(image, op) : null;
  }, []);

  // Render on the next frame with the latest values; intermediate values are dropped.
  // Never with another photo's settings: wait until this photo's proxy is loaded.
  const raw = photo?.raw ?? null;
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !proxy || proxy.id !== photo?.id) return undefined;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      const values = renderAdjustments;
      const params = deriveParams(values, { lut, raw });
      if (engine.kind === 'webgl2' && !engine.renderer.lost) engine.renderer.setGeometry(previewSpec);
      const out = previewSpec ? { width: previewSpec.width, height: previewSpec.height } : { width: proxy.width, height: proxy.height };
      let layers = buildLayers(out);
      setLayersLoading(layers?.loading ?? 0);
      setLayersShown(layers?.cpu.length ?? 0);
      drawOverlay(layers?.overlay ?? null);
      if (layers && !layers.cpu.length) layers = null;
      // Local Detail with no global CPU stage: the GPU's own frame is the backdrop (canvas size).
      const gpuDetail = engine.kind === 'webgl2' && !engine.renderer.lost && !params.cpuOnly;
      const localOnGpu = gpuDetail && hasDetailPass(layers?.cpu);
      // The local adjustment being masked has Detail but no mask yet: its filtered frame is made
      // now, so the first stroke shows Detail at once (only while it would be the first pass).
      const warm = gpuDetail && !layers && maskTool?.owner.kind === 'local' ? warmPass(values.local?.find(({ id }) => id === maskTool.owner.id), plan.native) : null;
      if ((params.cpuOnly || hasDetailPass(layers?.cpu)) && !localOnGpu) {
        // Spatial Detail: the CPU renders the frame (draft, then final); a split or
        // compare change alone repaints the last frame.
        const key = `${photo.id}|${JSON.stringify({ ...values, layers: null, local: null })}|${params.lutActive ? lut.sha256 : ''}|${specKey(previewSpec)}`;
        const job = detailJobRef.current;
        const nativeSize = plan.identity ? native : plan.native;
        const request = { key, image: proxyRef.current, adjustments: values, params, lut: params.lutActive ? lut : null, raw, warp: previewSpec, nativeWidth: nativeSize.width, nativeHeight: nativeSize.height, generation: job.generation, layers };
        // The frame's key leaves out layers: a layer change alone repaints the last frame under the new layers.
        if (job.key === key && job.frame && job.image === proxyRef.current && !job.pending && !job.busy) paintDetail(job.frame, request);
        else runDetail(request);
        return;
      }
      Object.assign(detailJobRef.current, { key: null, pending: null, generation: detailJobRef.current.generation + 1 });
      if (!localOnGpu && !warm && (scaledRef.current.frame || gpuBaseRef.current.image)) {
        Object.assign(scaledRef.current, { frame: null, key: '', image: null });
        gpuBaseRef.current = { key: '', image: null };
        localPreviewRef.current.clear();
      }
      if (!localOnGpu) setDetailQuality(null);
      const nativeSize = plan.identity ? native : plan.native;
      if (engine.kind === 'webgl2') {
        // Bloom and halation: the last glow map of this proxy is drawn until the new one arrives.
        let glow = null;
        if (params.creative.glowActive) {
          const job = glowRef.current;
          const key = `${photo.id}|${glowDependencies(values, params)}|${specKey(previewSpec)}`;
          if (job.key !== key && job.pending?.key !== key) requestGlow({ key, image: proxyRef.current, adjustments: values, lut: params.lutActive ? lut : null, raw, warp: previewSpec });
          glow = job.image === proxyRef.current ? job.map : null;
        }
        // "Before" of a RAW photo is its neutral development, not undeveloped sensor data.
        const before = raw ? deriveParams(neutralAdjustments(), { raw }) : null;
        if (!engine.renderer.lost) {
          engine.renderer.setCreative({ nativeWidth: nativeSize.width, nativeHeight: nativeSize.height, glow });
          if (localOnGpu || warm) {
            // The frame without layers, read back once per change of the photo's own settings;
            // the passes are composited over it on the CPU (pipeline/localPreview.mjs).
            const key = `${photo.id}|${JSON.stringify({ ...values, layers: null, local: null })}|${params.lutActive ? lut.sha256 : ''}|${specKey(previewSpec)}|${glowVersion}`;
            const base = gpuBaseRef.current;
            if (base.key !== key) {
              const data = engine.renderer.readPixels(params, {});
              gpuBaseRef.current = { key, image: { width: out.width, height: out.height, data: new Uint8ClampedArray(data.buffer) } };
            }
          }
          if (warm) {
            if (!deferWork) localPreviewRef.current.warm(gpuBaseRef.current.image, warm);
            engine.renderer.render(params, { split: splitFraction, before });
          } else if (localOnGpu) {
            const { image, dirty, complete } = localPreviewRef.current.compose(gpuBaseRef.current.image, layers.cpu, { defer: deferWork });
            engine.renderer.render({ ...params, neutral: true }, { split: splitFraction, before, rendered: image, renderedDirty: dirty });
            const quality = complete ? { width: out.width, height: out.height } : 'rendering';
            setDetailQuality((shown) => (JSON.stringify(shown) === JSON.stringify(quality) ? shown : quality));
            if (complete) performance.mark?.('pe-local-detail');
          } else {
            engine.renderer.render(params, { split: splitFraction, before, layers: layers?.gpu });
          }
        }
      } else {
        drawCpu({ ...params, neutral: params.neutral && !layers?.cpu.length, adjustments: values, lutData: params.lutActive ? lut : null, split: splitFraction, raw, warp: previewSpec, nativeSize: { nativeWidth: nativeSize.width, nativeHeight: nativeSize.height }, layers });
      }
    });
    return () => cancelAnimationFrame(frameRef.current);
  }, [renderAdjustments, lut, raw, splitFraction, proxy, photo?.id, drawCpu, runDetail, paintDetail, previewSpec, glowVersion, buildLayers, drawOverlay, layerRasters?.version, localVersion, maskTool?.owner.id, deferWork, retouchVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const measure = () => setStageSize({ width: stage.clientWidth, height: stage.clientHeight });
    measure();
    if (typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // Entering or leaving Crop & Transform changes what is shown: start from the whole view.
  useEffect(() => { setView({ fit: true, zoom: 1, x: 0, y: 0 }); }, [transformMode]);

  const sourceWidth = plan.native.width;
  const sourceHeight = plan.native.height;
  const proxyScale = proxy ? (previewSpec?.width ?? proxy.width) / sourceWidth : 1;
  const fitZoom = proxy
    ? Math.min((stageSize.width - STAGE_PADDING * 2) / sourceWidth, (stageSize.height - STAGE_PADDING * 2) / sourceHeight, 1)
    : 1;
  const zoom = view.fit ? Math.max(MIN_ZOOM, fitZoom) : view.zoom;
  const displayWidth = sourceWidth * zoom;
  const displayHeight = sourceHeight * zoom;
  const offsetX = view.fit ? (stageSize.width - displayWidth) / 2 : view.x;
  const offsetY = view.fit ? (stageSize.height - displayHeight) / 2 : view.y;

  const zoomTo = useCallback((nextZoom, anchor) => {
    const target = clampZoom(nextZoom);
    const point = anchor ?? { x: stageSize.width / 2, y: stageSize.height / 2 };
    const ratio = target / zoom;
    setView({ fit: false, zoom: target, x: point.x - (point.x - offsetX) * ratio, y: point.y - (point.y - offsetY) * ratio });
  }, [zoom, offsetX, offsetY, stageSize]);

  useEffect(() => {
    if (!zoomCommand || !proxy) return;
    if (zoomCommand.type === 'fit') setView({ fit: true, zoom: 1, x: 0, y: 0 });
    if (zoomCommand.type === 'actual') zoomTo(1);
    if (zoomCommand.type === 'in') zoomTo(zoom * 1.25);
    if (zoomCommand.type === 'out') zoomTo(zoom / 1.25);
  }, [zoomCommand]); // eslint-disable-line react-hooks/exhaustive-deps

  const onWheel = useCallback((event) => {
    if (!proxy) return;
    event.preventDefault();
    const rect = stageRef.current.getBoundingClientRect();
    const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0015));
    zoomTo(zoom * factor, { x: event.clientX - rect.left, y: event.clientY - rect.top });
  }, [proxy, zoom, zoomTo]);

  useEffect(() => {
    const stage = stageRef.current;
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  // One pointer pans; two pointers (touch) pinch-zoom around their midpoint and pan with it.
  // Touches on the mask tool reach here too: one of them paints (no pan), two pinch.
  const pointersRef = useRef(new Map());
  const toolPointersRef = useRef(new Set());
  const stagePoint = (x, y) => {
    const rect = stageRef.current.getBoundingClientRect();
    return { x: x - rect.left, y: y - rect.top };
  };
  const startGesture = (view) => {
    const points = [...pointersRef.current.values()];
    if (points.length >= 2) {
      const [a, b] = points;
      dragRef.current = { pinch: true, distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: stagePoint((a.x + b.x) / 2, (a.y + b.y) / 2), ...view };
    } else if (points.length === 1) {
      // A finger on the mask tool paints, unless it is what is left of a pinch.
      const [id] = pointersRef.current.keys();
      dragRef.current = toolPointersRef.current.has(id) && !dragRef.current?.pinch ? null : { pinch: false, start: points[0], ...view };
    } else {
      dragRef.current = null;
    }
  };
  const onPointerDown = (event) => {
    if (!proxy || event.button !== 0 || event.target.closest('.pe-split')) return;
    // The mask tool keeps its own pointer capture (it paints with that finger).
    if ((maskTool?.tool || retouchTool?.tool) && event.target.closest('.pe-masktool')) toolPointersRef.current.add(event.pointerId);
    else event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    startGesture({ originX: offsetX, originY: offsetY, zoom });
  };
  const onPointerMove = (event) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.pinch) {
      const [a, b] = [...pointersRef.current.values()];
      const target = clampZoom(drag.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / drag.distance));
      const mid = stagePoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      // Keep the image point that was under the starting midpoint under the current one.
      const ratio = target / drag.zoom;
      setView({ fit: false, zoom: target, x: mid.x - (drag.mid.x - drag.originX) * ratio, y: mid.y - (drag.mid.y - drag.originY) * ratio });
    } else {
      setView({ fit: false, zoom: drag.zoom, x: drag.originX + event.clientX - drag.start.x, y: drag.originY + event.clientY - drag.start.y });
    }
  };
  const onPointerUp = (event) => {
    toolPointersRef.current.delete(event.pointerId);
    if (!pointersRef.current.delete(event.pointerId)) return;
    // Lifting one finger of a pinch continues as a pan from the current view.
    startGesture({ originX: offsetX, originY: offsetY, zoom });
  };

  // Split handle: pointer drag on the line, arrow keys when focused.
  const splitDragRef = useRef(false);
  const splitFromPointer = (event) => {
    const fraction = (event.clientX - stageRef.current.getBoundingClientRect().left - offsetX) / displayWidth;
    onSplitChange(Math.min(1, Math.max(0, fraction)));
  };
  const onSplitKey = (event) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    const moves = { ArrowLeft: -step, ArrowRight: step, Home: -1, End: 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    onSplitChange(Math.min(1, Math.max(0, split + moves[event.key])));
  };

  const beyondProxy = proxy && zoom > proxyScale * 1.01;
  const previewSize = previewSpec ?? proxy;
  const splitX = offsetX + displayWidth * split;

  // The watermark over the photo: laid out for the export's size, rasterised for the screen.
  const watermark = showLayers && proxy && proxy.id === photo?.id && !inspect && watermarkActive(watermarkSettings) && exportSize ? watermarkSettings : null;
  const watermarkRef = useRef(null);
  const [watermarkMean, setWatermarkMean] = useState(null);
  const watermarkBox = useMemo(() => {
    if (!watermark) return null;
    const ratio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    // Screen pixels per export pixel, capped so the sprite stays under 4096 px wide.
    let scale = (displayWidth / exportSize.width) * ratio;
    let layout = layoutWatermark(watermark, exportSize.width, exportSize.height, { scale });
    if (layout.width > 4096) layout = layoutWatermark(watermark, exportSize.width, exportSize.height, { scale: (scale *= 4096 / layout.width) });
    return { layout, cssPerPixel: displayWidth / (exportSize.width * scale) };
  }, [watermark, exportSize, displayWidth]);
  const watermarkVariant = watermark ? resolveWatermarkColor(watermark, watermarkMean ?? 0) : null;
  const [markFontsReady, setMarkFontsReady] = useState(false);
  useEffect(() => {
    if (!watermark || markFontsReady) return undefined;
    let alive = true;
    loadWatermarkFonts().catch(() => {}).then(() => { if (alive) setMarkFontsReady(true); });
    return () => { alive = false; };
  }, [watermark, markFontsReady]);
  useLayoutEffect(() => {
    const element = watermarkRef.current;
    if (!element) return;
    if (!watermarkBox || !markFontsReady) { element.width = 0; return; }
    const bounds = markBounds(watermarkBox.layout);
    Object.assign(element, { width: Math.ceil(bounds.width), height: Math.ceil(bounds.height) });
    drawMark(element.getContext('2d'), watermarkBox.layout, DESIGN.colors[watermarkVariant], { offsetX: -bounds.x, offsetY: -bounds.y });
  }, [watermarkBox, watermarkVariant, markFontsReady]);
  // Auto colour: the mean luminance behind the mark in the shown frame, read once the frame settles.
  const autoWatermark = watermark?.color === 'auto';
  useEffect(() => {
    if (!autoWatermark) { setWatermarkMean(null); return undefined; }
    const timer = setTimeout(() => {
      const engine = engineRef.current;
      if (!engine || !proxyRef.current) return;
      const frame = engine.kind === 'webgl2' ? engine.renderer.snapshot() : (({ width, height }) => ({ width, height, data: engine.context.getImageData(0, 0, width, height).data }))(engine.context.canvas);
      if (!frame) return;
      const layout = layoutWatermark(watermarkSettings, exportSize.width, exportSize.height, { scale: frame.width / exportSize.width, snap: false });
      const { mean } = regionLuminance(frame, sampleBox(layout));
      setWatermarkMean(mean);
    }, 250);
    return () => clearTimeout(timer);
  }, [autoWatermark, watermarkBox, renderAdjustments, proxy, previewSpec, exportSize, layerRasters?.version, glowVersion, localVersion, detailQuality]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    onWatermarkAuto?.(autoWatermark && watermarkMean !== null ? { variant: watermarkVariant, mean: watermarkMean } : null);
  }, [autoWatermark, watermarkMean, watermarkVariant, onWatermarkAuto]);
  const watermarkStyle = watermarkBox ? (() => {
    const { cssPerPixel } = watermarkBox;
    const bounds = markBounds(watermarkBox.layout);
    const left = offsetX + bounds.x * cssPerPixel;
    const clip = compare === 'split' ? Math.max(0, splitX - left) : 0;
    return {
      width: Math.ceil(bounds.width) * cssPerPixel,
      height: Math.ceil(bounds.height) * cssPerPixel,
      transform: `translate(${left}px, ${offsetY + bounds.y * cssPerPixel}px)`,
      opacity: watermark.opacity,
      clipPath: clip > 0 ? `inset(0 0 0 ${clip}px)` : undefined,
    };
  })() : null;

  return (
    <div className="pe-viewer" data-layers-shown={layersShown}>
      <div
        ref={stageRef}
        className="pe-stage-area"
        data-dragging={dragRef.current ? 'true' : undefined}
        data-zoomed={!view.fit || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => proxy && (view.fit ? zoomTo(1) : setView({ fit: true, zoom: 1, x: 0, y: 0 }))}
      >
        <div
          ref={canvasHostRef}
          className="pe-canvas-host"
          hidden={!proxy}
          style={{ width: displayWidth, height: displayHeight, transform: `translate(${offsetX}px, ${offsetY}px)` }}
        />
        <canvas
          ref={overlayRef}
          className="pe-mask-overlay"
          aria-hidden="true"
          data-view={overlayMask?.overlay.view}
          hidden={!overlayMask || !proxy}
          style={{ width: displayWidth, height: displayHeight, transform: `translate(${offsetX}px, ${offsetY}px)` }}
        />
        <canvas
          ref={watermarkRef}
          className="pe-watermark-overlay"
          aria-hidden="true"
          data-watermark={watermark ? watermarkVariant : undefined}
          hidden={!watermarkStyle || !markFontsReady}
          style={watermarkStyle ?? undefined}
        />
        {maskTool?.editable && proxy && proxy.id === photo?.id && !transform && !inspect && compare !== 'original' && (
          <MaskTool
            mask={maskTool.mask}
            map={ownerMaskMap(maskTool.owner, { width: sourceWidth, height: sourceHeight }, plan, native)}
            box={{ x: offsetX, y: offsetY, width: displayWidth, height: displayHeight }}
            output={{ width: sourceWidth, height: sourceHeight }}
            tool={maskTool.interactive ? maskTool.tool : null}
            brush={maskTool.brush}
            selectedId={maskTool.selectedId}
            newId={maskTool.newId}
            onSelect={maskTool.onSelect}
            onPreview={maskTool.onPreview}
            onCommit={maskTool.onCommit}
            onRemove={maskTool.onRemove}
          />
        )}
        {retouchTool && proxy && proxy.id === photo?.id && !transform && !inspect && compare !== 'original' && (
          <RetouchTool
            map={imageMaskMap(plan, { width: sourceWidth, height: sourceHeight }, native)}
            box={{ x: offsetX, y: offsetY, width: displayWidth, height: displayHeight }}
            output={{ width: sourceWidth, height: sourceHeight }}
            tool={retouchTool.tool}
            brush={retouchTool.brush}
            operations={adjustments.retouch ?? []}
            selectedId={retouchTool.selectedId}
            clone={retouchTool.clone}
            picking={retouchTool.picking}
            newId={retouchTool.newId}
            onPreview={previewRetouch}
            onCommit={retouchTool.onCommit}
            onSelect={retouchTool.onSelect}
            onUpdate={retouchTool.onUpdate}
            onSource={retouchTool.onSource}
            onError={retouchTool.onError}
            findSource={healSource}
            areaFor={retouchTool.areaFor}
            onArea={retouchTool.onArea}
          />
        )}
        {retouchBusy && proxy && (
          <div className="pe-retouch-progress" role={retouchBusy.error ? 'alert' : 'status'} data-retouch-busy={retouchBusy.error ? 'error' : 'filling'} onPointerDown={(event) => event.stopPropagation()}>
            {retouchBusy.error ? `Remove failed: ${retouchBusy.error}` : `Removing… ${Math.round((retouchBusy.fraction ?? 0) * 100)}%`}
            {!retouchBusy.error && onCancelFill && (
              <button type="button" className="pe-text-button" onClick={() => { removerRef.current?.cancel(); onCancelFill(retouchBusy.ids); setRetouchBusy(null); }}>Cancel</button>
            )}
          </div>
        )}
        {layerTool?.interactive && proxy && proxy.id === photo?.id && !transform && !inspect && compare !== 'original' && (
          <LayerHandles
            layers={adjustments.layers}
            box={{ x: offsetX, y: offsetY, width: displayWidth, height: displayHeight }}
            output={{ width: sourceWidth, height: sourceHeight }}
            selectedId={layerTool.selectedId}
            freeResize={layerTool.freeResize}
            onSelect={layerTool.onSelect}
            onPreview={layerTool.onPreview}
            onCommit={layerTool.onCommit}
            onApply={layerTool.onApply}
            onEdit={layerTool.onEdit}
          />
        )}
        {proxy && compare === 'split' && (
          <div className="pe-split" style={{ left: splitX, top: Math.max(0, offsetY), height: Math.min(displayHeight, stageSize.height) }}>
            <span className="pe-split__label pe-split__label--before" aria-hidden="true">Before</span>
            <span className="pe-split__label pe-split__label--after" aria-hidden="true">After</span>
            <div
              className="pe-split__handle"
              role="slider"
              tabIndex={0}
              aria-label="Before and after divider"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(split * 100)}
              aria-valuetext={`${Math.round(split * 100)}% original`}
              onKeyDown={onSplitKey}
              onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); splitDragRef.current = true; }}
              onPointerMove={(event) => splitDragRef.current && splitFromPointer(event)}
              onPointerUp={() => { splitDragRef.current = false; }}
            />
          </div>
        )}
        {status.state === 'loading' && <p className="pe-stage-message" role="status"><span className="pe-spinner" aria-hidden="true" />{raw ? 'Developing RAW preview from sensor data…' : 'Loading preview…'}</p>}
        {engineError && <p className="pe-stage-message pe-stage-message--error" role="alert">{engineError}</p>}
        {!engineError && status.state === 'error' && <p className="pe-stage-message pe-stage-message--error" role="alert">{status.message || 'This photograph could not be shown.'}</p>}
        {photo && photo.status === 'importing' && <p className="pe-stage-message" role="status"><span className="pe-spinner" aria-hidden="true" />{{ waiting: 'Waiting for the RAW decoder:', decoding: 'Decoding RAW sensor data:' }[photo.progress] ?? 'Reading'} {photo.name}…</p>}
        {transform && proxy && proxy.id === photo?.id && !geometryError && (
          <CropOverlay
            mode={transform.mode}
            geometry={adjustments.geometry}
            content={plan.content}
            ratio={cropRatio(adjustments.geometry.aspect, plan.frame)}
            output={viewGeometry(adjustments.geometry, null, native).plan.crop}
            box={{ x: offsetX, y: offsetY, width: displayWidth, height: displayHeight }}
            guide={transform.guide}
            onPreview={transform.onPreview}
            onCommit={transform.onCommit}
            onSet={transform.onSet}
            onApply={transform.onApply}
            onCancel={transform.onCancel}
          />
        )}
        {geometryError && proxy && <p className="pe-stage-message pe-stage-message--error" role="alert">{geometryError} Shown without geometry.</p>}
        {inspect && proxy && proxy.id === photo?.id && (
          <InspectView
            photo={photo}
            adjustments={adjustments}
            lut={lut}
            raw={raw}
            compare={compare}
            split={split}
            center={{ x: (stageSize.width / 2 - offsetX) / zoom, y: (stageSize.height / 2 - offsetY) / zoom }}
            size={plan.identity ? null : plan.native}
            loadSource={inspect.loadSource}
            render={inspect.render}
            onClose={inspect.onClose}
          />
        )}
        {compare === 'original' && proxy && <span className="pe-stage-badge" aria-live="polite">Original</span>}
        {previewing && compare !== 'original' && proxy && <span className="pe-stage-badge" aria-live="polite">Preview: {previewing}</span>}
      </div>
      <div className="pe-viewer-bar">
        <span className="pe-readout mono" aria-live="polite">{proxy ? `${Math.round(zoom * 100)}%` : '—'}</span>
        {beyondProxy && <span className="pe-readout-note">Preview at {previewSize.width}×{previewSize.height}; export uses full resolution</span>}
        {proxy && !plan.identity && !transform && <span className="pe-readout-note mono" data-output-size>{plan.native.width}×{plan.native.height} px</span>}
        {transform && deriveParams(adjustments).cpuOnly && <span className="pe-readout-note">Detail, low resolution, JPEG and channel shift are not previewed while cropping</span>}
        {engineKind === 'cpu' && <span className="pe-readout-note">CPU preview (WebGL2 unavailable)</span>}
        {proxy && showLayers && layersLoading > 0 && <span className="pe-readout-note" role="status" data-layers-loading>Loading {layersLoading} layer{layersLoading === 1 ? '' : 's'}…</span>}
        {proxy && detailQuality && (
          <span
            className="pe-readout-note"
            data-detail-preview={typeof detailQuality === 'string' ? detailQuality : 'final'}
            aria-live="polite"
            title={typeof detailQuality === 'object' ? 'Detail is rendered on the CPU; the export renders it at full resolution.' : undefined}
          >
            {detailQuality === 'rendering' ? 'Rendering on the CPU…' : detailQuality === 'draft' ? 'CPU preview: draft' : `CPU preview at ${detailQuality.width}×${detailQuality.height}; export renders at full resolution`}
          </span>
        )}
      </div>
    </div>
  );
}
