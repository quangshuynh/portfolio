import React, { useEffect, useMemo, useRef } from 'react';
import { invert3, project } from '../pipeline/geometry.mjs';
import { createRetouchOperation } from '../model/retouch.mjs';
import { maskMapKey } from '../pipeline/mask.mjs';


// A new point is recorded once the pointer has moved this far (canvas px, or a share of the radius).
const POINT_SPACING_PX = 1.5;
const POINT_SPACING_RADIUS = 0.15;

/**
 * Clone Stamp and Spot Healing on the preview. Positions go through `map` (canvas pixels at full
 * resolution → the photo's normalised space before Crop & Transform), never screen coordinates,
 * so an operation keeps its place at any zoom, pan, crop or export size.
 * - Heal: click or paint; when the stroke ends a matching source nearby is found
 *   (`findSource`), and the operation is committed.
 * - Remove: paint over an object; when the stroke ends it is filled content-aware (the page shows
 *   progress). With `areaFor` set, a drag draws the area that removal may copy from (`onArea`).
 * - Clone: Alt/Option-click (or "Set source" on touch, `picking`) sets the source; painting
 *   copies from it with the offset fixed at the stroke's first point. Aligned keeps that offset
 *   for later strokes until a new source is set; otherwise each stroke starts at the source.
 * One pointer paints (a second touch cancels the stroke and the fingers pinch-zoom); pressure is
 * not used. No stroke starts while another finger is down, so a finger landing again during a
 * pinch never paints. On touch, Set source follows the finger with a marker and takes the point
 * where it lifts. A stroke in progress is dropped when the tool or photo changes. The selected
 * operation shows its target and source; dragging the source handle (or the arrow keys on it)
 * moves the source. The brush outline and source marker follow the pointer outside React.
 * :param tool: 'heal' | 'clone' | 'remove' | null (handles only)
 * :param brush: { radius, hardness, opacity, spacing }
 * :param clone: { source: { x, y } | null, aligned, offset: { x, y } | null } (the clone sampling state)
 */
export default function RetouchTool({ map, box, output, tool, brush, operations, selectedId, clone, picking, newId, onPreview, onCommit, onSelect, onUpdate, onSource, findSource, onError, areaFor = null, onArea = () => {} }) {
  const dragRef = useRef(null);
  const frameRef = useRef(0);
  const cursorRef = useRef(null);
  const markerRef = useRef(null);
  const liveRef = useRef(null);
  const rectRef = useRef(null);
  // Touch pointers down on the tool now (a new primary touch starts a new set).
  const touchesRef = useRef(new Set());
  const previewRef = useRef(onPreview);
  previewRef.current = onPreview;
  const inverse = useMemo(() => invert3(map.matrix), [map]);
  const k = box.width / output.width;
  const short = Math.min(map.width, map.height);
  const spacePerStage = map.scale / k;

  const toStage = (u, v) => {
    if (!inverse) return { x: NaN, y: NaN };
    const [x, y] = project(inverse, u * map.width, v * map.height);
    return { x: box.x + x * k, y: box.y + y * k };
  };
  const toSpace = (sx, sy) => {
    const [x, y] = project(map.matrix, (sx - box.x) / k, (sy - box.y) / k);
    return { u: x / map.width, v: y / map.height };
  };
  const local = (event) => {
    let rect = rectRef.current;
    if (!rect) {
      rect = event.currentTarget.closest('.pe-stage-area').getBoundingClientRect();
      rectRef.current = rect;
      requestAnimationFrame(() => { rectRef.current = null; });
    }
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  // Drops a stroke, drag or source pick in progress (nothing is committed) and its preview.
  const abandon = () => {
    const drag = dragRef.current;
    cancelAnimationFrame(frameRef.current);
    dragRef.current = null;
    liveRef.current?.setAttribute('visibility', 'hidden');
    areaRef.current?.setAttribute('visibility', 'hidden');
    if (markerRef.current && drag?.kind === 'pick') markerRef.current.hidden = true;
    if (drag && drag.kind !== 'area') previewRef.current(null);
  };
  // Another tool or photo (or leaving the editor) mid-stroke: the stroke never lands on it.
  const mapKey = maskMapKey(map);
  useEffect(() => abandon, [tool, mapKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The offset a clone stroke starting at (u, v) uses.
  const cloneOffset = (u, v) => {
    if (!clone?.source) return null;
    if (clone.aligned && clone.offset) return clone.offset;
    return { x: clone.source.x - u, y: clone.source.y - v };
  };

  const moveCursor = (event, point) => {
    const cursor = cursorRef.current;
    if (!cursor) return;
    if (event.pointerType === 'touch') { cursor.hidden = true; if (markerRef.current) markerRef.current.hidden = true; return; }
    cursor.style.transform = `translate(${point.x}px, ${point.y}px)`;
    cursor.hidden = false;
    cursor.dataset.mode = event.altKey && tool === 'clone' ? 'source' : 'paint';
    // Clone: where the brush would sample from right now.
    const marker = markerRef.current;
    if (!marker) return;
    const at = toSpace(point.x, point.y);
    const drag = dragRef.current;
    const offset = drag?.kind === 'paint' ? drag.offset : cloneOffset(at.u, at.v);
    if (tool !== 'clone' || !offset || event.altKey) { marker.hidden = true; return; }
    const s = toStage(at.u + offset.x, at.v + offset.y);
    marker.style.transform = `translate(${s.x}px, ${s.y}px)`;
    marker.hidden = false;
  };
  const showPick = (point) => {
    const marker = markerRef.current;
    if (!marker) return;
    marker.style.transform = `translate(${point.x}px, ${point.y}px)`;
    marker.hidden = false;
  };
  const hideCursor = () => {

    if (cursorRef.current) cursorRef.current.hidden = true;
    if (markerRef.current) markerRef.current.hidden = true;
  };

  const operationFor = (drag) => createRetouchOperation(drag.id, tool, drag.points, brush, drag.offset ?? { x: 0, y: 0 });
  const preview = (drag) => {
    if (tool !== 'clone') return;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => onPreview(operationFor(drag)));
  };

  const areaRef = useRef(null);
  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    if (event.pointerType === 'touch') {
      if (event.isPrimary) touchesRef.current.clear();
      touchesRef.current.add(event.pointerId);
      if (touchesRef.current.size > 1) {
        // A second finger: abandon the stroke; the fingers pinch-zoom (the Viewer) instead.
        abandon();
        return;
      }
    }
    if (areaFor) {
      // Remove: drag a rectangle, the area the fill may copy from.
      event.preventDefault();
      if (event.pointerType !== 'touch') event.stopPropagation();
      try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* a synthetic pointer */ }
      const point = local(event);
      dragRef.current = { kind: 'area', pointer: event.pointerId, start: point, end: point };
      return;
    }
    if (!tool) return;
    if (event.pointerType !== 'touch') event.stopPropagation();
    event.preventDefault();
    if (dragRef.current) { abandon(); return; }
    const point = local(event);
    const { u, v } = toSpace(point.x, point.y);
    if (tool === 'clone' && picking && event.pointerType === 'touch') {
      // The finger hides the spot: the marker follows it and the source is where it lifts.
      try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* a synthetic pointer */ }
      dragRef.current = { kind: 'pick', pointer: event.pointerId, point };
      showPick(point);
      return;
    }
    if (tool === 'clone' && (event.altKey || picking)) {
      onSource({ x: u, y: v });
      return;
    }
    let offset = null;
    if (tool === 'clone') {
      offset = cloneOffset(u, v);
      if (!offset) { onError?.('Set a source first: Alt-click (Option-click) the area to copy from, or use Set source.'); return; }
    }
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* a synthetic pointer */ }
    dragRef.current = { kind: 'paint', pointer: event.pointerId, id: newId(tool), points: [[u, v]], offset, last: point, path: liveRef.current, d: pathOf([[u, v]]) };
    // Heal and Remove: the stroke's outline while painting (a heal source is chosen when it ends).
    if (liveRef.current) {
      liveRef.current.setAttribute('d', dragRef.current.d);
      liveRef.current.style.strokeWidth = `${Math.max(2, 2 * (brush.radius * short) / spacePerStage)}px`;
      liveRef.current.removeAttribute('visibility');
    }
    preview(dragRef.current);
  };
  const onPointerMove = (event) => {
    const point = local(event);
    moveCursor(event, point);
    const drag = dragRef.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    if (event.pointerType !== 'touch') event.stopPropagation();
    if (drag.kind === 'pick') {
      drag.point = point;
      showPick(point);
      return;
    }
    if (drag.kind === 'area') {
      drag.end = point;
      const rect = areaRef.current;
      if (rect) {
        rect.setAttribute('x', String(Math.min(drag.start.x, point.x)));
        rect.setAttribute('y', String(Math.min(drag.start.y, point.y)));
        rect.setAttribute('width', String(Math.abs(point.x - drag.start.x)));
        rect.setAttribute('height', String(Math.abs(point.y - drag.start.y)));
        rect.removeAttribute('visibility');
      }
      return;
    }
    if (drag.kind === 'source') {
      const at = toSpace(point.x, point.y);
      const op = operations.find(({ id }) => id === drag.id);
      if (op) {
        drag.offset = { x: drag.start.offset.x + at.u - drag.start.u, y: drag.start.offset.y + at.v - drag.start.v };
        cancelAnimationFrame(frameRef.current);
        frameRef.current = requestAnimationFrame(() => onPreview({ ...op, offset: drag.offset }));
      }
      return;
    }
    const events = event.nativeEvent?.getCoalescedEvents?.() ?? [];
    const radiusStage = (brush.radius * short) / spacePerStage;
    const spacing = Math.max(POINT_SPACING_PX * k, radiusStage * POINT_SPACING_RADIUS);
    let added = false;
    for (const e of events.length ? events : [event]) {
      const p = local({ currentTarget: event.currentTarget, clientX: e.clientX, clientY: e.clientY });
      if (Math.hypot(p.x - drag.last.x, p.y - drag.last.y) < spacing) continue; // eslint-disable-line no-continue
      const at = toSpace(p.x, p.y);
      drag.points.push([at.u, at.v]);
      drag.last = p;
      // The outline grows by a segment per point: a long stroke never rebuilds its whole path.
      const s = toStage(at.u, at.v);
      drag.d += ` L${s.x.toFixed(1)} ${s.y.toFixed(1)}`;
      added = true;
    }
    if (added) {
      preview(drag);
      if (drag.path) drag.path.setAttribute('d', drag.d);
    }
  };
  const onPointerUp = (event) => {
    if (event.pointerType === 'touch') touchesRef.current.delete(event.pointerId);
    const drag = dragRef.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    if (event.pointerType !== 'touch') event.stopPropagation();
    if (event.type === 'pointercancel') { abandon(); return; }
    dragRef.current = null;
    cancelAnimationFrame(frameRef.current);
    liveRef.current?.setAttribute('visibility', 'hidden');
    if (drag.kind === 'pick') {
      if (markerRef.current) markerRef.current.hidden = true;
      const at = toSpace(drag.point.x, drag.point.y);
      onSource({ x: at.u, y: at.v });
      return;
    }
    if (drag.kind === 'area') {
      areaRef.current?.setAttribute('visibility', 'hidden');
      // The rectangle's corners in the photo's space (its bounding box there when the photo is turned).
      const corners = [[drag.start.x, drag.start.y], [drag.end.x, drag.start.y], [drag.start.x, drag.end.y], [drag.end.x, drag.end.y]].map(([x, y]) => toSpace(x, y));
      const u0 = Math.min(...corners.map(({ u }) => u)); const u1 = Math.max(...corners.map(({ u }) => u));
      const v0 = Math.min(...corners.map(({ v }) => v)); const v1 = Math.max(...corners.map(({ v }) => v));
      onArea(areaFor, { x: u0, y: v0, width: u1 - u0, height: v1 - v0 });
      return;
    }
    if (drag.kind === 'source') {
      if (drag.offset) onUpdate(drag.id, { offset: drag.offset });
      else onPreview(null);
      return;
    }
    let op = operationFor(drag);
    if (tool === 'heal') {
      const offset = findSource(op);
      if (!offset) { onPreview(null); onError?.('No matching area was found nearby. Try a smaller brush, or use Clone with a source you choose.'); return; }
      op = { ...op, offset };
    }
    onCommit(op, drag.offset);
  };

  // The selected operation's source handle: drag (or arrow keys) to move the source.
  const startSource = (event, op) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* a synthetic pointer */ }
    const at = toSpace(...Object.values(local(event)));
    dragRef.current = { kind: 'source', pointer: event.pointerId, id: op.id, start: { u: at.u, v: at.v, offset: op.offset }, offset: null };
  };
  const onSourceKey = (event, op) => {
    const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!steps[event.key]) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.01 : 0.002;
    const [dx, dy] = steps[event.key];
    onUpdate(op.id, { offset: { x: op.offset.x + dx * step * (short / map.width), y: op.offset.y + dy * step * (short / map.height) } });
  };

  function pathOf(points, offset = { x: 0, y: 0 }) {
    return points.map(([u, v], i) => { const p = toStage(u + offset.x, v + offset.y); return `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`; }).join(' ');
  }
  const radiusOf = (op) => (op.radius * short) / spacePerStage;
  const selected = operations.find(({ id }) => id === selectedId) ?? null;
  const area = selected?.type === 'remove' && selected.source ? (() => {
    const a = toStage(selected.source.x, selected.source.y);
    const b = toStage(selected.source.x + selected.source.width, selected.source.y + selected.source.height);
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
  })() : null;
  const sourcePoint = selected && selected.type !== 'remove' ? toStage(selected.points[0][0] + selected.offset.x, selected.points[0][1] + selected.offset.y) : null;
  const pickedSource = tool === 'clone' && clone?.source ? toStage(clone.source.x, clone.source.y) : null;
  const cursorRadius = (brush.radius * short) / spacePerStage;

  return (
    <div
      className="pe-masktool pe-retouchtool"
      data-tool={areaFor ? 'area' : tool ?? 'handles'}
      data-picking={picking || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={hideCursor}
    >
      <svg className="pe-masktool__shapes" aria-hidden="true">
        {operations.map((op) => (
          <path key={op.id} d={pathOf(op.points)} className="pe-retouch-area" data-selected={op.id === selectedId || undefined} data-type={op.type} data-disabled={!op.enabled || undefined}
            style={{ strokeWidth: Math.max(2, 2 * radiusOf(op)) }} />
        ))}
        {selected && selected.type !== 'remove' && <path d={pathOf(selected.points, selected.offset)} className="pe-retouch-area pe-retouch-area--source" style={{ strokeWidth: Math.max(2, 2 * radiusOf(selected)) }} />}
        {area && <rect className="pe-retouch-sourcearea" x={area.x} y={area.y} width={area.width} height={area.height} />}
        <rect ref={areaRef} className="pe-retouch-sourcearea pe-retouch-sourcearea--live" visibility="hidden" />
        {(tool === 'heal' || tool === 'remove') && <path ref={liveRef} className="pe-retouch-area pe-retouch-area--live" visibility="hidden" />}
      </svg>
      {selected && sourcePoint && (
        <span
          className="pe-mask-handle pe-mask-handle--move pe-retouch-source"
          role="button"
          tabIndex={0}
          aria-label={`Source of ${selected.type === 'heal' ? 'heal' : 'clone'} ${selected.id}. Drag to move it; arrow keys move it.`}
          style={{ left: sourcePoint.x, top: sourcePoint.y }}
          onPointerDown={(event) => startSource(event, selected)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={(event) => onSourceKey(event, selected)}
        />
      )}
      {pickedSource && <span className="pe-retouch-picked" style={{ left: pickedSource.x, top: pickedSource.y }} aria-hidden="true" />}
      {tool && (
        <div ref={cursorRef} className="pe-masktool__cursor" aria-hidden="true" hidden data-mode="paint">
          <span className="pe-masktool__ring" style={{ width: 2 * cursorRadius, height: 2 * cursorRadius, left: -cursorRadius, top: -cursorRadius }} />
          {brush.hardness < 1 && <span className="pe-masktool__ring pe-masktool__ring--inner" style={{ width: 2 * cursorRadius * brush.hardness, height: 2 * cursorRadius * brush.hardness, left: -cursorRadius * brush.hardness, top: -cursorRadius * brush.hardness }} />}
        </div>
      )}
      {tool === 'clone' && (
        <div ref={markerRef} className="pe-masktool__cursor pe-retouch-marker" aria-hidden="true" hidden>
          <span className="pe-masktool__ring" style={{ width: 2 * cursorRadius, height: 2 * cursorRadius, left: -cursorRadius, top: -cursorRadius }} />
        </div>
      )}
    </div>
  );
}
