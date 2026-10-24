import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { deriveParams } from '../pipeline/spec.mjs';
import { neutralAdjustments, neutralGroup } from '../model/adjustments.mjs';
import { GeometryError, cropRatio, frameGeometry, geometryPlan, neutralGeometry } from '../pipeline/geometry.mjs';
import { warpSpec } from '../pipeline/warp.mjs';
import CropOverlay from './CropOverlay';
import { GlRenderer, probeEditorContext } from '../pipeline/glRenderer.mjs';
import { debugFlag, recordDiagnostic } from '../io/diagnostics.mjs';
import { previewEdgeLimit } from '../io/files.mjs';
import InspectView from './InspectView';

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 8;
const STAGE_PADDING = 24;
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

const clampZoom = (value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
const NEUTRAL_GEOMETRY = neutralGeometry();
const specKey = (spec) => (spec ? JSON.stringify([spec.matrix, spec.width, spec.height, spec.coverage, spec.background]) : '');

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

/**
 * Centre workspace: the processed preview with zoom, pan and before/after.
 * Zoom is expressed in output pixels per CSS pixel (1 = 100%): pixels of the photo after
 * its geometry (crop, rotation, resize), so 100% is the export's pixel grid at original size.
 * :param transform: Crop & Transform mode ({ mode: 'crop' | 'corners', guide, onPreview,
 *   onCommit, onSet, onApply, onCancel }) or null
 */
export default function Viewer({ photo, adjustments, lut = null, previewing = null, compare, split, onSplitChange, loadProxy, renderInWorker, onEngine, zoomCommand, inspect = null, transform = null }) {
  const stageRef = useRef(null);
  const canvasHostRef = useRef(null);
  const engineRef = useRef(null);
  const proxyRef = useRef(null);
  const frameRef = useRef(0);
  const cpuJobRef = useRef({ latest: 0, busy: false, queued: null });
  // CPU preview of a RAW photo: its neutral development, for Original and Split.
  const cpuBeforeRef = useRef({ image: null, key: '', data: null });
  // Detail preview: the request waiting to run, and the last frame shown with its settings key.
  const detailJobRef = useRef({ busy: false, pending: null, frame: null, key: null, image: null, generation: 0 });
  const splitRef = useRef(0);
  const [detailQuality, setDetailQuality] = useState(null);
  const [canvas, setCanvas] = useState(null);
  const [engineKind, setEngineKind] = useState(null);
  const [proxy, setProxy] = useState(null);
  const [status, setStatus] = useState({ state: 'idle' });
  // A preview engine that could not start at all; unlike `status`, never reset by photo changes.
  const [engineError, setEngineError] = useState(null);
  const [view, setView] = useState({ fit: true, zoom: 1, x: 0, y: 0 });
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const dragRef = useRef(null);

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
      if (proxyRef.current) engine.renderer.setSource(proxyRef.current);
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
    };
  }, [onEngine]);

  // Load the active photo's proxy; stale loads are ignored.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !photo || photo.status !== 'ready') {
      setProxy(null);
      proxyRef.current = null;
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
      setProxy({ id: photo.id, width: image.width, height: image.height });
      setView({ fit: true, zoom: 1, x: 0, y: 0 });
      setStatus({ state: 'ready' });
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
    if (detailJobRef.current.image !== proxyRef.current) Object.assign(detailJobRef.current, { frame: null, image: null, key: null });
  }, [proxy]);

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

  /** Shows a Detail frame (any size; scaled to the canvas) with the current split. */
  const paintDetail = useCallback(async (frame, request) => {
    const engine = engineRef.current;
    const image = proxyRef.current;
    if (!engine || image !== request.image) return;
    const split = splitRef.current;
    if (engine.kind === 'webgl2') {
      const before = request.raw ? deriveParams(neutralAdjustments(), { raw: request.raw }) : null;
      if (!engine.renderer.lost) engine.renderer.render(request.params, { split, before, rendered: frame });
      return;
    }
    const out = request.warp ?? image;
    const sourceWidth = Math.round(out.width * split);
    const before = sourceWidth > 0 ? await cpuBefore(image, request.raw, request.warp) : null;
    if (proxyRef.current !== image) return;
    const { context } = engine;
    if (context.canvas.width !== out.width || context.canvas.height !== out.height) Object.assign(context.canvas, { width: out.width, height: out.height });
    if (frame.width === out.width && frame.height === out.height) {
      context.putImageData(new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height), 0, 0);
    } else {
      const scratch = document.createElement('canvas');
      scratch.width = frame.width;
      scratch.height = frame.height;
      scratch.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height), 0, 0);
      context.clearRect(0, 0, out.width, out.height);
      context.drawImage(scratch, 0, 0, out.width, out.height);
    }
    if (before) context.putImageData(new ImageData(new Uint8ClampedArray(before.data), out.width, out.height), 0, 0, 0, 0, sourceWidth, out.height);
  }, [cpuBefore]);

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
        Object.assign(job, { frame, key: current.key, image });
        const quality = final || !needsFinal(current) ? 'final' : 'draft';
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
      const rendered = params.neutral && !params.warp ? image : await renderInWorker(image, params.adjustments, params.lutData, params.raw, null, params.warp);
      const sourceWidth = Math.round(out.width * params.split);
      const before = sourceWidth > 0 ? await cpuBefore(image, params.raw, params.warp) : image;
      if (id === job.latest && proxyRef.current === image) {
        const { canvas: target } = engine.context;
        if (target.width !== out.width || target.height !== out.height) Object.assign(target, { width: out.width, height: out.height });
        engine.context.putImageData(new ImageData(new Uint8ClampedArray(rendered.data), out.width, out.height), 0, 0);
        if (sourceWidth > 0) engine.context.putImageData(new ImageData(new Uint8ClampedArray(before.data), out.width, out.height), 0, 0, 0, 0, sourceWidth, out.height);
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
  const renderAdjustments = useMemo(() => (transformMode ? { ...adjustments, ...neutralGroup('detail') } : adjustments), [adjustments, transformMode]);

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
      if (params.detailActive) {
        // Spatial Detail: the CPU renders the frame (draft, then final); a split or
        // compare change alone repaints the last frame.
        const key = `${photo.id}|${JSON.stringify(values)}|${params.lutActive ? lut.sha256 : ''}|${specKey(previewSpec)}`;
        const job = detailJobRef.current;
        const nativeSize = plan.identity ? native : plan.native;
        const request = { key, image: proxyRef.current, adjustments: values, params, lut: params.lutActive ? lut : null, raw, warp: previewSpec, nativeWidth: nativeSize.width, nativeHeight: nativeSize.height, generation: job.generation };
        if (job.key === key && job.frame && job.image === proxyRef.current && !job.pending && !job.busy) paintDetail(job.frame, request);
        else runDetail(request);
        return;
      }
      Object.assign(detailJobRef.current, { key: null, pending: null, generation: detailJobRef.current.generation + 1 });
      setDetailQuality(null);
      if (engine.kind === 'webgl2') {
        // "Before" of a RAW photo is its neutral development, not undeveloped sensor data.
        const before = raw ? deriveParams(neutralAdjustments(), { raw }) : null;
        if (!engine.renderer.lost) engine.renderer.render(params, { split: splitFraction, before });
      } else {
        drawCpu({ ...params, neutral: params.neutral, adjustments: values, lutData: params.lutActive ? lut : null, split: splitFraction, raw, warp: previewSpec });
      }
    });
    return () => cancelAnimationFrame(frameRef.current);
  }, [renderAdjustments, lut, raw, splitFraction, proxy, photo?.id, drawCpu, runDetail, paintDetail, previewSpec]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const pointersRef = useRef(new Map());
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
      dragRef.current = { pinch: false, start: points[0], ...view };
    } else {
      dragRef.current = null;
    }
  };
  const onPointerDown = (event) => {
    if (!proxy || event.button !== 0 || event.target.closest('.pe-split')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
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

  return (
    <div className="pe-viewer">
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
        {transform && deriveParams(adjustments).detailActive && <span className="pe-readout-note">Detail is not previewed while cropping</span>}
        {engineKind === 'cpu' && <span className="pe-readout-note">CPU preview (WebGL2 unavailable)</span>}
        {proxy && detailQuality && (
          <span
            className="pe-readout-note"
            data-detail-preview={typeof detailQuality === 'string' ? detailQuality : 'final'}
            aria-live="polite"
            title={typeof detailQuality === 'object' ? 'Detail is rendered on the CPU; the export renders it at full resolution.' : undefined}
          >
            {detailQuality === 'rendering' ? 'Rendering Detail…' : detailQuality === 'draft' ? 'Detail: draft preview' : `Detail preview at ${detailQuality.width}×${detailQuality.height}; export renders it at full resolution`}
          </span>
        )}
      </div>
    </div>
  );
}
