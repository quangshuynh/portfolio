import React, { useMemo, useRef, useState } from 'react';
import { MAX_CURVE_POINTS, NEUTRAL_CURVE, curveEvaluator, isNeutralCurve } from '../pipeline/curves.mjs';

const CHANNELS = [
  { id: 'master', label: 'RGB', color: 'var(--pe-text)' },
  { id: 'red', label: 'Red', color: '#e0605a' },
  { id: 'green', label: 'Green', color: '#62b862' },
  { id: 'blue', label: 'Blue', color: '#6a8ee8' },
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Keeps a moved point between its neighbours, so points stay ordered and distinct. */
function placePoint(points, index, x, y) {
  const min = index === 0 ? 0 : points[index - 1][0] + 1;
  const max = index === points.length - 1 ? 255 : points[index + 1][0] - 1;
  const next = points.map((point) => [...point]);
  next[index] = [clamp(Math.round(x), min, max), clamp(Math.round(y), 0, 255)];
  return next;
}

function PointField({ label, value, min, max, disabled, onCommit }) {
  const [draft, setDraft] = useState(null);
  const commit = () => {
    if (draft === null) return;
    const number = Number.parseInt(draft, 10);
    if (Number.isFinite(number)) onCommit(number);
    setDraft(null);
  };
  return (
    <label className="pe-curve__field">
      <span>{label}</span>
      <input
        className="mono"
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step="1"
        disabled={disabled}
        value={draft ?? value}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') { commit(); event.currentTarget.blur(); } }}
      />
    </label>
  );
}

/**
 * Tone curve editor for the master RGB curve and each channel. Points are dragged on
 * the graph (one undo step per drag), added by clicking the curve, removed by
 * double-click; each point is also a focusable slider (arrows move it, Shift for 10,
 * Delete removes it) with numeric input and output fields.
 */
export default function CurveEditor({ curves, disabled, dispatch }) {
  const [channelId, setChannelId] = useState('master');
  const [selected, setSelected] = useState(null);
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const pointRefs = useRef([]);
  const channel = CHANNELS.find(({ id }) => id === channelId);
  const points = curves[channelId];
  const active = selected !== null && selected < points.length ? selected : null;
  const evaluate = useMemo(() => curveEvaluator(points), [points]);
  const path = useMemo(() => {
    const parts = [];
    for (let x = 0; x <= 255; x += 1) parts.push(`${x === 0 ? 'M' : 'L'}${x} ${(255 - evaluate(x)).toFixed(2)}`);
    return parts.join(' ');
  }, [evaluate]);

  const patch = (next) => ({ curves: { ...curves, [channelId]: next } });
  const apply = (next, coalesce = true) => dispatch({ type: 'applySettings', patch: patch(next), coalesceKey: coalesce ? `curve:${channelId}` : null });
  const graphPoint = (event) => {
    const rect = svgRef.current.getBoundingClientRect();
    return [((event.clientX - rect.left) / rect.width) * 255, 255 - ((event.clientY - rect.top) / rect.height) * 255];
  };
  const focusPoint = (index) => requestAnimationFrame(() => pointRefs.current[index]?.focus());

  const onPointerDown = (event) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    const [x] = graphPoint(event);
    let index = Number(event.target.dataset?.index);
    let current = points;
    if (!Number.isInteger(index)) {
      // Clicking the graph adds a point on the curve there (if there is room).
      const rx = clamp(Math.round(x), 0, 255);
      if (points.length >= MAX_CURVE_POINTS || points.some(([px]) => px === rx)) return;
      current = [...points, [rx, Math.round(evaluate(rx))]].sort((a, b) => a[0] - b[0]);
      index = current.findIndex(([px]) => px === rx);
      dispatch({ type: 'previewSettings', patch: patch(current) });
    }
    setSelected(index);
    svgRef.current.setPointerCapture(event.pointerId);
    dragRef.current = { index, points: current };
    focusPoint(index);
  };
  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const [x, y] = graphPoint(event);
    drag.points = placePoint(drag.points, drag.index, x, y);
    dispatch({ type: 'previewSettings', patch: patch(drag.points) });
  };
  const endDrag = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    dispatch({ type: 'commitAdjustment' });
  };

  const removePoint = (index) => {
    if (points.length <= 2) return;
    apply(points.filter((_, i) => i !== index), false);
    const next = Math.max(0, index - 1);
    setSelected(next);
    focusPoint(next);
  };

  const onPointKeyDown = (event, index) => {
    const step = event.shiftKey ? 10 : 1;
    const [x, y] = points[index];
    const moves = { ArrowUp: [0, step], ArrowDown: [0, -step], ArrowRight: [step, 0], ArrowLeft: [-step, 0] };
    if (moves[event.key]) {
      event.preventDefault();
      apply(placePoint(points, index, x + moves[event.key][0], y + moves[event.key][1]));
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      removePoint(index);
    }
  };

  const addPoint = () => {
    if (points.length >= MAX_CURVE_POINTS) return;
    let gap = 0;
    for (let i = 1; i < points.length; i += 1) if (points[i][0] - points[i - 1][0] > points[gap + 1][0] - points[gap][0]) gap = i - 1;
    const x = Math.round((points[gap][0] + points[gap + 1][0]) / 2);
    if (points.some(([px]) => px === x)) return;
    apply([...points.slice(0, gap + 1), [x, Math.round(evaluate(x))], ...points.slice(gap + 1)], false);
    setSelected(gap + 1);
  };

  return (
    <div className="pe-curve">
      <div className="pe-curve__channels" role="group" aria-label="Curve channel">
        {CHANNELS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={id === channelId}
            aria-label={isNeutralCurve(curves[id]) ? label : `${label} (edited)`}
            data-edited={!isNeutralCurve(curves[id]) || undefined}
            onClick={() => { setChannelId(id); setSelected(null); }}
          >
            {label}
          </button>
        ))}
      </div>
      <svg
        ref={svgRef}
        className="pe-curve__graph"
        viewBox="-6 -6 268 268"
        role="group"
        aria-label={`${channel.label} tone curve. Click to add a point; use the points' arrow keys to move them and Delete to remove them.`}
        data-disabled={disabled || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={(event) => { const index = Number(event.target.dataset?.index); if (!disabled && Number.isInteger(index)) removePoint(index); }}
      >
        <rect x="0" y="0" width="255" height="255" className="pe-curve__frame" />
        {[64, 128, 191].map((v) => <path key={v} d={`M${v} 0V255M0 ${v}H255`} className="pe-curve__grid" />)}
        <path d="M0 255L255 0" className="pe-curve__identity" />
        <path d={path} className="pe-curve__line" style={{ stroke: channel.color }} />
        {points.map(([x, y], index) => (
          // Keyed by position in the list, so moving a point keeps its element (and focus).
          <g key={index}>
            <circle cx={x} cy={255 - y} r="14" className="pe-curve__hit" data-index={index} />
            <circle
              ref={(element) => { pointRefs.current[index] = element; }}
              cx={x}
              cy={255 - y}
              r="4.5"
              className="pe-curve__point"
              data-index={index}
              data-selected={index === active || undefined}
              tabIndex={disabled ? -1 : 0}
              role="slider"
              aria-label={`Point ${index + 1} of ${points.length}`}
              aria-valuemin={0}
              aria-valuemax={255}
              aria-valuenow={y}
              aria-valuetext={`Input ${x}, output ${y}`}
              aria-disabled={disabled || undefined}
              onFocus={() => setSelected(index)}
              onKeyDown={(event) => !disabled && onPointKeyDown(event, index)}
            />
          </g>
        ))}
      </svg>
      <div className="pe-curve__controls">
        {active !== null ? (
          <>
            <PointField label="Input" value={points[active][0]} min={0} max={255} disabled={disabled} onCommit={(x) => apply(placePoint(points, active, x, points[active][1]), false)} />
            <PointField label="Output" value={points[active][1]} min={0} max={255} disabled={disabled} onCommit={(y) => apply(placePoint(points, active, points[active][0], y), false)} />
            <button type="button" className="pe-text-button" disabled={disabled || points.length <= 2} onClick={() => removePoint(active)}>Remove point</button>
          </>
        ) : <p className="pe-note pe-curve__hint">Select a point to edit it by number.</p>}
      </div>
      <div className="pe-curve__actions">
        <button type="button" className="pe-text-button" disabled={disabled || points.length >= MAX_CURVE_POINTS} onClick={addPoint}>Add point</button>
        <button
          type="button"
          className="pe-text-button"
          disabled={disabled || (isNeutralCurve(points) && points.length === 2)}
          onClick={() => { apply(NEUTRAL_CURVE, false); setSelected(null); }}
        >
          Reset {channel.label}
        </button>
      </div>
    </div>
  );
}
