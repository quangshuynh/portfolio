import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { covers, regionAt, sourceRect } from '../pipeline/detailRegion.mjs';

const RENDER_DELAY_MS = 120;

/**
 * 1:1 inspection: the visible part of the photo rendered from the full-resolution
 * original at one source pixel per device pixel, by the export's renderer (so Texture,
 * Clarity, Dehaze, Sharpening and noise reduction look exactly as in a full-size export).
 * Not a zoomed preview: the original is decoded once at full size and a crop around the
 * region is kept; panning inside it only re-renders. Drag to pan; Original and Split
 * compare with the unedited pixels.
 * With geometry, positions are output pixels (after crop, rotation and resize) and the
 * kept crop is cut from the warped output; a geometry change decodes again.
 * :param props: photo, adjustments, lut, raw, compare, split, center ({ x, y } output px),
 *   size ({ width, height } of the output), loadSource(photo, rect, geometry) -> kept,
 *   render(kept, keyed, region, settings) -> { after, before }
 */
export default function InspectView({ photo, adjustments, lut, raw, compare, split, center, size = null, loadSource, render, onClose }) {
  const hostRef = useRef(null);
  const canvasRef = useRef(null);
  const keptRef = useRef(null);
  const frameRef = useRef(null);
  const jobRef = useRef({ busy: false, next: null, generation: 0 });
  const [region, setRegion] = useState(null);
  const [status, setStatus] = useState({ state: 'idle' });
  const [drag, setDrag] = useState(null);
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const image = size ?? { width: photo.width, height: photo.height };
  const geometryKey = JSON.stringify(adjustments.geometry ?? null);

  // The region: as many source pixels as the stage has device pixels, around the centre.
  useLayoutEffect(() => {
    const host = hostRef.current;
    setRegion(regionAt(center, { width: host.clientWidth * dpr, height: host.clientHeight * dpr }, image));
  }, [photo.id, image.width, image.height]); // eslint-disable-line react-hooks/exhaustive-deps

  const paint = useCallback(() => {
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    if (!frame || !canvas) return;
    const { width, height } = frame.region;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context?.putImageData) return;
    const fraction = compare === 'original' ? 1 : compare === 'split' ? split : 0;
    context.putImageData(new ImageData(new Uint8ClampedArray(frame.after), width, height), 0, 0);
    const beforeWidth = Math.round(width * fraction);
    if (beforeWidth > 0) context.putImageData(new ImageData(new Uint8ClampedArray(frame.before), width, height), 0, 0, 0, 0, beforeWidth, height);
  }, [compare, split]);
  useEffect(paint, [paint]);

  // One render at a time, keeping only the newest request; a new crop is decoded only
  // when the region (with its halo) leaves the one kept.
  const run = useCallback(async (request) => {
    const job = jobRef.current;
    job.next = request;
    if (job.busy) return;
    job.busy = true;
    try {
      while (job.next) {
        const current = job.next;
        job.next = null;
        let kept = keptRef.current;
        if (!kept || kept.photoId !== photo.id || kept.geometryKey !== current.geometryKey || !covers(kept.rect, current.region, image)) {
          setStatus({ state: 'decoding' });
          const rect = sourceRect(current.region, image);
          const source = await loadSource(photo, rect, current.geometry);
          kept = { photoId: photo.id, geometryKey: current.geometryKey, key: `${photo.id}:${rect.x},${rect.y},${rect.width},${rect.height}:${current.geometryKey}`, rect: { x0: rect.x, y0: rect.y, width: rect.width, height: rect.height }, source };
          keptRef.current = kept;
        }
        setStatus({ state: 'rendering' });
        const started = performance.now();
        const frame = await render(kept, current.region, { adjustments: current.adjustments, lut: current.lut, raw: current.raw });
        if (job.next) continue; // eslint-disable-line no-continue
        frameRef.current = { ...frame, region: current.region };
        paint();
        setStatus({ state: 'ready', ms: Math.round(performance.now() - started) });
        performance.mark?.('pe-inspect-frame', { detail: { ...current.region } });
      }
    } catch (error) {
      if (error.code !== 'cancelled') setStatus({ state: 'error', message: error.message });
    } finally {
      job.busy = false;
    }
  }, [photo, loadSource, render, paint]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!region) return undefined;
    const timer = setTimeout(() => run({ region, adjustments, lut, raw, geometry: adjustments.geometry ?? null, geometryKey }), RENDER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [region, adjustments, lut, raw, run, geometryKey]);

  // Drag pans the region (the current frame moves with the pointer until it is re-rendered).
  const onPointerDown = (event) => {
    event.stopPropagation();
    if (event.button !== 0 || !region) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ x: event.clientX, y: event.clientY, dx: 0, dy: 0 });
  };
  const onPointerMove = (event) => drag && setDrag({ ...drag, dx: event.clientX - drag.x, dy: event.clientY - drag.y });
  const onPointerUp = () => {
    if (!drag) return;
    if (drag.dx || drag.dy) {
      setRegion((current) => regionAt({ x: current.x + current.width / 2 - drag.dx * dpr, y: current.y + current.height / 2 - drag.dy * dpr }, current, image));
    }
    setDrag(null);
  };
  const onKeyDown = (event) => {
    const step = (event.shiftKey ? 200 : 50) * dpr;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); return; }
    if (!(event.key in moves) || !region) return;
    event.preventDefault();
    event.stopPropagation();
    const [dx, dy] = moves[event.key];
    setRegion((current) => regionAt({ x: current.x + current.width / 2 + dx, y: current.y + current.height / 2 + dy }, current, image));
  };

  const shown = frameRef.current?.region ?? region;
  return (
    <div
      ref={hostRef}
      className="pe-inspect"
      role="region"
      aria-label="1:1 inspection: arrow keys pan, Escape closes"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      data-state={status.state}
    >
      {shown && (
        <canvas
          ref={canvasRef}
          className="pe-inspect__canvas"
          aria-hidden="true"
          style={{ width: shown.width / dpr, height: shown.height / dpr, transform: drag ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined }}
        />
      )}
      <p className="pe-inspect__label mono" aria-live="polite">
        <span>1:1 · {shown ? `${shown.width}×${shown.height} px from (${shown.x}, ${shown.y})` : ''}</span>
        <span>
          {status.state === 'decoding' && (raw ? 'Developing the full-size RAW…' : 'Decoding the full-size original…')}
          {status.state === 'rendering' && 'Rendering at full resolution…'}
          {status.state === 'ready' && `Rendered as in the export (${status.ms} ms)`}
        </span>
      </p>
      {status.state === 'error' && <p className="pe-stage-message pe-stage-message--error" role="alert">{status.message}</p>}
    </div>
  );
}
