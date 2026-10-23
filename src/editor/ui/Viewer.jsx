import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { deriveParams } from '../pipeline/spec.mjs';
import { neutralAdjustments } from '../model/adjustments.mjs';
import { GlRenderer, probeEditorContext } from '../pipeline/glRenderer.mjs';
import { debugFlag, recordDiagnostic } from '../io/diagnostics.mjs';
import { previewEdgeLimit } from '../io/files.mjs';

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

/**
 * Centre workspace: the processed preview with zoom, pan and before/after.
 * Zoom is expressed in source pixels per CSS pixel (1 = 100%).
 */
export default function Viewer({ photo, adjustments, lut = null, previewing = null, compare, split, onSplitChange, loadProxy, renderInWorker, onEngine, zoomCommand }) {
  const stageRef = useRef(null);
  const canvasHostRef = useRef(null);
  const engineRef = useRef(null);
  const proxyRef = useRef(null);
  const frameRef = useRef(0);
  const cpuJobRef = useRef({ latest: 0, busy: false, queued: null });
  // CPU preview of a RAW photo: its neutral development, for Original and Split.
  const cpuBeforeRef = useRef({ image: null, data: null });
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

  // Release the GPU texture when no photo is shown.
  useEffect(() => {
    if (!proxy) engineRef.current?.renderer?.clear();
  }, [proxy]);

  const splitFraction = compare === 'original' ? 1 : compare === 'split' ? split : 0;
  splitRef.current = splitFraction;

  // The "before" side of the CPU preview: the source itself, or for RAW and merged RAW
  // HDR its neutral development.
  const cpuBefore = useCallback(async (image, raw) => {
    if (image.kind !== 'raw' && image.kind !== 'hdr') return image;
    const cache = cpuBeforeRef.current;
    if (cache.image !== image) Object.assign(cache, { image, data: (await renderInWorker(image, neutralAdjustments(), null, raw)).data });
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
    const sourceWidth = Math.round(image.width * split);
    const before = sourceWidth > 0 ? await cpuBefore(image, request.raw) : null;
    if (proxyRef.current !== image) return;
    const { context } = engine;
    if (frame.width === image.width && frame.height === image.height) {
      context.putImageData(new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height), 0, 0);
    } else {
      const scratch = document.createElement('canvas');
      scratch.width = frame.width;
      scratch.height = frame.height;
      scratch.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height), 0, 0);
      context.drawImage(scratch, 0, 0, image.width, image.height);
    }
    if (before) context.putImageData(new ImageData(new Uint8ClampedArray(before.data), image.width, image.height), 0, 0, 0, 0, sourceWidth, image.height);
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
    const needsFinal = (current) => Math.max(current.image.width, current.image.height) > DETAIL_DRAFT_EDGE;
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
        });
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
      const rendered = params.neutral ? image : await renderInWorker(image, params.adjustments, params.lutData, params.raw);
      const sourceWidth = Math.round(image.width * params.split);
      const before = sourceWidth > 0 ? await cpuBefore(image, params.raw) : image;
      if (id === job.latest && proxyRef.current === image) {
        engine.context.putImageData(new ImageData(new Uint8ClampedArray(rendered.data), image.width, image.height), 0, 0);
        if (sourceWidth > 0) engine.context.putImageData(new ImageData(new Uint8ClampedArray(before.data), image.width, image.height), 0, 0, 0, 0, sourceWidth, image.height);
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

  // Render on the next frame with the latest values; intermediate values are dropped.
  // Never with another photo's settings: wait until this photo's proxy is loaded.
  const raw = photo?.raw ?? null;
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !proxy || proxy.id !== photo?.id) return undefined;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      const params = deriveParams(adjustments, { lut, raw });
      if (params.detailActive) {
        // Spatial Detail: the CPU renders the frame (draft, then final); a split or
        // compare change alone repaints the last frame.
        const key = `${photo.id}|${JSON.stringify(adjustments)}|${params.lutActive ? lut.sha256 : ''}`;
        const job = detailJobRef.current;
        const request = { key, image: proxyRef.current, adjustments, params, lut: params.lutActive ? lut : null, raw, nativeWidth: photo.width, nativeHeight: photo.height, generation: job.generation };
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
        drawCpu({ ...params, neutral: params.neutral, adjustments, lutData: params.lutActive ? lut : null, split: splitFraction, raw });
      }
    });
    return () => cancelAnimationFrame(frameRef.current);
  }, [adjustments, lut, raw, splitFraction, proxy, photo?.id, drawCpu, runDetail, paintDetail]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const measure = () => setStageSize({ width: stage.clientWidth, height: stage.clientHeight });
    measure();
    if (typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const sourceWidth = photo?.width ?? 1;
  const sourceHeight = photo?.height ?? 1;
  const proxyScale = proxy ? proxy.width / sourceWidth : 1;
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
        {compare === 'original' && proxy && <span className="pe-stage-badge" aria-live="polite">Original</span>}
        {previewing && compare !== 'original' && proxy && <span className="pe-stage-badge" aria-live="polite">Preview: {previewing}</span>}
      </div>
      <div className="pe-viewer-bar">
        <span className="pe-readout mono" aria-live="polite">{proxy ? `${Math.round(zoom * 100)}%` : '—'}</span>
        {beyondProxy && <span className="pe-readout-note">Preview at {proxy.width}×{proxy.height}; export uses full resolution</span>}
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
