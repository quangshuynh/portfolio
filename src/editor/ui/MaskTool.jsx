import React, { useEffect, useMemo, useRef, useState } from 'react';
import { invert3, project } from '../pipeline/geometry.mjs';
import { addComponent, appendStroke, componentLabel, createBrush, createLinear, createRadial, updateComponent } from '../model/masks.mjs';

const MOVE_STEP = 0.002;
const MOVE_STEP_LARGE = 0.02;
// A new point is recorded once the pointer has moved this far (canvas px, or a share of the radius).
const POINT_SPACING_PX = 1.5;
const POINT_SPACING_RADIUS = 0.15;
const MIN_GRADIENT_PX = 4;

/**
 * Direct manipulation of the selected mask on the preview: paint brush strokes, drag out a new
 * linear or radial gradient, and move a gradient's handles. Positions go through `map` (canvas
 * pixels at full resolution → the mask's space), never through screen coordinates, so a mask
 * keeps its place at any zoom, pan and export size. While a tool is on, one pointer paints or
 * drags (the photo does not pan and the page does not scroll); a second touch cancels the stroke.
 * Handles are focusable: arrow keys move the gradient (Shift: larger steps), Delete removes it.
 * :param mask: the mask being edited; `map`: maskMap at `output` (the canvas at full resolution)
 * :param box: the photo's displayed rectangle in stage pixels
 * :param tool: 'brush' | 'linear' | 'radial' | null (handles only)
 * :param brush: { radius, hardness, opacity, mode: 'add' | 'erase', pressure }
 */
export default function MaskTool({ mask, map, box, output, tool, brush, selectedId, newId, onSelect, onPreview, onCommit, onRemove }) {
  const dragRef = useRef(null);
  const frameRef = useRef(0);
  const [cursor, setCursor] = useState(null);
  const inverse = useMemo(() => invert3(map.matrix), [map]);
  const k = box.width / output.width;
  const short = Math.min(map.width, map.height);

  // Space (normalised) ↔ stage pixels.
  const toStage = (u, v) => {
    if (!inverse) return { x: NaN, y: NaN };
    const [x, y] = project(inverse, u * map.width, v * map.height);
    return { x: box.x + x * k, y: box.y + y * k };
  };
  const toSpace = (sx, sy) => {
    const [x, y] = project(map.matrix, (sx - box.x) / k, (sy - box.y) / k);
    return { u: x / map.width, v: y / map.height };
  };
  // Space pixels per stage pixel, for radii.
  const spacePerStage = map.scale / k;
  const local = (event) => {
    const rect = event.currentTarget.closest('.pe-stage-area').getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);
  const preview = (next) => {
    dragRef.current.latest = next;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => onPreview(next));
  };

  const selected = mask.components.find((c) => c.id === selectedId) ?? null;

  const startPaint = (event, point) => {
    let base = mask;
    let id = selected?.type === 'brush' ? selected.id : null;
    if (!id) {
      id = newId('brush');
      base = addComponent(mask, createBrush(id));
      if (base === mask) return false;
      onSelect(id);
    }
    const p = brush.pressure && event.pointerType === 'pen' && event.pressure > 0 ? event.pressure : 1;
    const { u, v } = toSpace(point.x, point.y);
    const stroke = { mode: event.altKey ? (brush.mode === 'erase' ? 'add' : 'erase') : brush.mode, radius: brush.radius, hardness: brush.hardness, opacity: brush.opacity, points: [[u, v, p]] };
    dragRef.current = { kind: 'paint', pointer: event.pointerId, base, id, stroke, last: point, latest: null };
    preview(appendStroke(base, id, stroke));
    return true;
  };
  const extendPaint = (event, drag) => {
    const events = event.nativeEvent?.getCoalescedEvents?.() ?? [];
    const points = (events.length ? events : [event]).map((e) => ({ point: local({ currentTarget: event.currentTarget, clientX: e.clientX, clientY: e.clientY }), pressure: e.pressure, type: e.pointerType }));
    const radiusStage = (brush.radius * short) / spacePerStage;
    const spacing = Math.max(POINT_SPACING_PX * k, radiusStage * POINT_SPACING_RADIUS);
    let added = false;
    for (const { point, pressure, type } of points) {
      if (Math.hypot(point.x - drag.last.x, point.y - drag.last.y) < spacing) continue; // eslint-disable-line no-continue
      const { u, v } = toSpace(point.x, point.y);
      const p = brush.pressure && type === 'pen' && pressure > 0 ? pressure : 1;
      drag.stroke = { ...drag.stroke, points: [...drag.stroke.points, [u, v, p]] };
      drag.last = point;
      added = true;
    }
    if (added) preview(appendStroke(drag.base, drag.id, drag.stroke));
  };

  const startCreate = (event, point) => {
    const { u, v } = toSpace(point.x, point.y);
    const id = newId(tool);
    const component = tool === 'linear' ? createLinear(id, { x0: u, y0: v, x1: u, y1: v }) : createRadial(id, { x: u, y: v, rx: 0.001, ry: 0.001 });
    const base = addComponent(mask, component);
    if (base === mask) return false;
    dragRef.current = { kind: `create-${tool}`, pointer: event.pointerId, base, id, start: point, latest: null };
    onSelect(id);
    return true;
  };

  const startHandle = (event, component, handle) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* a synthetic pointer */ }
    onSelect(component.id);
    dragRef.current = { kind: 'handle', handle, pointer: event.pointerId, component, start: local(event), latest: null };
  };

  const moveHandle = (drag, point) => {
    const c = drag.component;
    const at = toSpace(point.x, point.y);
    const from = toSpace(drag.start.x, drag.start.y);
    const du = at.u - from.u;
    const dv = at.v - from.v;
    let patch;
    if (c.type === 'linear') {
      if (drag.handle === 'start') patch = { x0: at.u, y0: at.v };
      else if (drag.handle === 'end') patch = { x1: at.u, y1: at.v };
      else patch = { x0: c.x0 + du, y0: c.y0 + dv, x1: c.x1 + du, y1: c.y1 + dv };
    } else if (drag.handle === 'move') {
      patch = { x: c.x + du, y: c.y + dv };
    } else {
      // Radii and rotation from the pointer in the ellipse's own axes (space pixels).
      const dx = (at.u - c.x) * map.width;
      const dy = (at.v - c.y) * map.height;
      if (drag.handle === 'rotate') {
        patch = { rotation: (Math.atan2(dy, dx) * 180) / Math.PI };
      } else {
        const a = (c.rotation * Math.PI) / 180;
        const along = drag.handle === 'rx' ? dx * Math.cos(a) + dy * Math.sin(a) : -dx * Math.sin(a) + dy * Math.cos(a);
        patch = { [drag.handle]: Math.abs(along) / short };
      }
    }
    preview(updateComponent(mask, c.id, patch));
  };

  const onPointerDown = (event) => {
    if (event.button !== 0 || !tool) return;
    event.stopPropagation();
    event.preventDefault();
    const drag = dragRef.current;
    if (drag) {
      // A second touch: abandon the stroke or the new gradient (pinch to zoom with the tool off).
      cancelAnimationFrame(frameRef.current);
      dragRef.current = null;
      onPreview(mask);
      return;
    }
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* a synthetic pointer */ }
    const point = local(event);
    if (tool === 'brush') startPaint(event, point);
    else startCreate(event, point);
  };
  const onPointerMove = (event) => {
    const point = local(event);
    if (tool === 'brush' && event.pointerType !== 'touch') setCursor(point);
    const drag = dragRef.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    event.stopPropagation();
    if (drag.kind === 'paint') extendPaint(event, drag);
    else if (drag.kind === 'handle') moveHandle(drag, point);
    else {
      const a = toSpace(drag.start.x, drag.start.y);
      const b = toSpace(point.x, point.y);
      const patch = drag.kind === 'create-linear'
        ? { x1: b.u, y1: b.v }
        : (() => { const r = Math.hypot((b.u - a.u) * map.width, (b.v - a.v) * map.height) / short; return { rx: r, ry: r }; })();
      preview(updateComponent(drag.base, drag.id, patch));
    }
  };
  const onPointerUp = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    event.stopPropagation();
    if (event.type === 'pointerup' && drag.kind !== 'paint') onPointerMove(event);
    else if (event.type === 'pointerup') extendPaint(event, drag);
    dragRef.current = null;
    cancelAnimationFrame(frameRef.current);
    const point = local(event);
    const tooSmall = drag.kind.startsWith('create') && Math.hypot(point.x - drag.start.x, point.y - drag.start.y) < MIN_GRADIENT_PX;
    if (event.type === 'pointercancel' || tooSmall) {
      onPreview(mask);
      if (tooSmall) onSelect(selectedId === drag.id ? null : selectedId);
      return;
    }
    if (drag.latest) onCommit(drag.latest);
  };

  const onKey = (event, component) => {
    const step = event.shiftKey ? MOVE_STEP_LARGE : MOVE_STEP;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[event.key]) {
      event.preventDefault();
      event.stopPropagation();
      const [du, dv] = moves[event.key];
      const patch = component.type === 'linear'
        ? { x0: component.x0 + du, y0: component.y0 + dv, x1: component.x1 + du, y1: component.y1 + dv }
        : { x: component.x + du, y: component.y + dv };
      onCommit(updateComponent(mask, component.id, patch), `mask:${component.id}:move`);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      event.stopPropagation();
      onRemove(component.id);
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      onSelect(null);
    }
  };

  const handle = (component, name, point, label) => (
    <span
      key={name}
      className={`pe-mask-handle pe-mask-handle--${name}`}
      style={{ left: point.x, top: point.y }}
      aria-hidden="true"
      data-handle={name}
      onPointerDown={(event) => startHandle(event, component, name)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      title={label}
    />
  );

  const shapes = [];
  const handles = [];
  mask.components.forEach((component, index) => {
    if (component.type === 'brush' || !component.enabled) return;
    const isSelected = component.id === selectedId;
    const label = componentLabel(component, index);
    if (component.type === 'linear') {
      const a = toStage(component.x0, component.y0);
      const b = toStage(component.x1, component.y1);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy) || 1;
      const nx = (-dy / length) * 4000;
      const ny = (dx / length) * 4000;
      const line = (name, p, dashed) => <line key={`${component.id}-${name}`} x1={p.x - nx} y1={p.y - ny} x2={p.x + nx} y2={p.y + ny} data-selected={isSelected || undefined} strokeDasharray={dashed ? '6 4' : undefined} />;
      shapes.push(line('start', a, false), line('centre', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, true), line('end', b, false));
      if (isSelected) handles.push(handle(component, 'start', a, 'Start (full effect)'), handle(component, 'end', b, 'End (no effect)'));
      handles.push(focusable(component, label, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }));
    } else {
      const ring = (scale) => Array.from({ length: 65 }, (_, i) => {
        const t = (i / 64) * 2 * Math.PI;
        const r = (component.rotation * Math.PI) / 180;
        const ex = Math.cos(t) * component.rx * short * scale;
        const ey = Math.sin(t) * component.ry * short * scale;
        const p = toStage(component.x + (ex * Math.cos(r) - ey * Math.sin(r)) / map.width, component.y + (ex * Math.sin(r) + ey * Math.cos(r)) / map.height);
        return `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      }).join(' ');
      shapes.push(<path key={`${component.id}-outer`} d={ring(1)} data-selected={isSelected || undefined} />);
      if (component.feather > 0.02) shapes.push(<path key={`${component.id}-inner`} d={ring(1 - component.feather)} strokeDasharray="6 4" data-selected={isSelected || undefined} />);
      const r = (component.rotation * Math.PI) / 180;
      const axis = (scale, angle) => toStage(component.x + (Math.cos(r + angle) * scale) / map.width, component.y + (Math.sin(r + angle) * scale) / map.height);
      if (isSelected) {
        handles.push(
          handle(component, 'rx', axis(component.rx * short, 0), 'Horizontal radius'),
          handle(component, 'ry', axis(component.ry * short, Math.PI / 2), 'Vertical radius'),
          handle(component, 'rotate', axis(component.rx * short * 1.25 + 12 * spacePerStage, 0), 'Rotate'),
        );
      }
      handles.push(focusable(component, label, toStage(component.x, component.y)));
    }
  });

  function focusable(component, label, point) {
    const isSelected = component.id === selectedId;
    return (
      <span
        key={`${component.id}-move`}
        className="pe-mask-handle pe-mask-handle--move"
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        aria-label={`${label}${component.op === 'subtract' ? ' (subtracts)' : ''}. Drag to move; arrow keys move it, Delete removes it.`}
        data-selected={isSelected || undefined}
        style={{ left: point.x, top: point.y }}
        onPointerDown={(event) => startHandle(event, component, 'move')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(event) => onKey(event, component)}
        onFocus={() => onSelect(component.id)}
      />
    );
  }

  const cursorRadius = (brush.radius * short) / spacePerStage;
  return (
    <div
      className="pe-masktool"
      data-tool={tool ?? 'handles'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setCursor(null)}
    >
      <svg className="pe-masktool__shapes" aria-hidden="true">
        {shapes}
        {tool === 'brush' && cursor && (
          <>
            <circle cx={cursor.x} cy={cursor.y} r={cursorRadius} className="pe-masktool__cursor" />
            {brush.hardness < 1 && <circle cx={cursor.x} cy={cursor.y} r={cursorRadius * brush.hardness} className="pe-masktool__cursor pe-masktool__cursor--inner" />}
          </>
        )}
      </svg>
      {handles}
    </div>
  );
}
