import React, { useEffect, useRef, useState } from 'react';
import { ADJUSTMENTS, ADJUSTMENT_GROUPS, formatAdjustment, isNeutral } from '../model/adjustments.mjs';

/**
 * One adjustment: a native range input (pointer drags preview and record one undo
 * step on release; keyboard steps coalesce), an editable numeric value and a reset.
 */
function AdjustmentRow({ spec, value, disabled, dispatch }) {
  const id = `pe-adjust-${spec.key}`;
  const dragging = useRef(false);
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    const end = () => {
      if (!dragging.current) return;
      dragging.current = false;
      dispatch({ type: 'commitAdjustment' });
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [dispatch]);

  const onInput = (event) => {
    const next = Number(event.target.value);
    if (dragging.current) dispatch({ type: 'previewAdjustment', key: spec.key, value: next });
    else dispatch({ type: 'setAdjustment', key: spec.key, value: next, coalesce: true });
  };

  const commitDraft = () => {
    if (draft === null) return;
    const parsed = Number.parseFloat(draft.replace(/[^\d.+-]/g, ''));
    if (Number.isFinite(parsed)) dispatch({ type: 'setAdjustment', key: spec.key, value: parsed });
    setDraft(null);
  };

  const changed = value !== spec.default;
  return (
    <div className="pe-adjust" data-changed={changed || undefined}>
      <div className="pe-adjust__head">
        <label htmlFor={id} onDoubleClick={() => !disabled && dispatch({ type: 'resetAdjustment', key: spec.key })}>{spec.label}</label>
        <input
          className="pe-adjust__value mono"
          type="text"
          inputMode="decimal"
          aria-label={`${spec.label} value`}
          disabled={disabled}
          value={draft ?? formatAdjustment(spec.key, value)}
          onFocus={(event) => { setDraft(String(value)); requestAnimationFrame(() => event.target.select()); }}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { commitDraft(); event.currentTarget.blur(); }
            if (event.key === 'Escape') { setDraft(null); event.currentTarget.blur(); }
          }}
        />
        <button
          type="button"
          className="pe-icon-button pe-adjust__reset"
          onClick={() => dispatch({ type: 'resetAdjustment', key: spec.key })}
          disabled={disabled || !changed}
          aria-label={`Reset ${spec.label}`}
          title={`Reset ${spec.label}`}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8a4.5 4.5 0 1 0 1.4-3.3M3.5 2.5v2.6h2.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      <input
        id={id}
        className="pe-range"
        data-track={spec.track}
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        disabled={disabled}
        aria-valuetext={formatAdjustment(spec.key, value)}
        style={{ '--fill-from': `${((0 - spec.min) / (spec.max - spec.min)) * 100}%`, '--fill-to': `${((value - spec.min) / (spec.max - spec.min)) * 100}%` }}
        onPointerDown={() => { dragging.current = true; }}
        onInput={onInput}
        onChange={() => {}}
      />
    </div>
  );
}

export default function AdjustPanel({ adjustments, disabled, dispatch }) {
  return (
    <section className="pe-panel" aria-labelledby="pe-adjust-title">
      <div className="pe-panel__head">
        <h2 id="pe-adjust-title">Adjust</h2>
        <button type="button" className="pe-text-button" disabled={disabled || isNeutral(adjustments)} onClick={() => dispatch({ type: 'resetAll' })}>
          Reset all
        </button>
      </div>
      {ADJUSTMENT_GROUPS.map((group) => (
        <fieldset key={group.id} className="pe-group">
          <legend>{group.label}</legend>
          {ADJUSTMENTS.filter((spec) => spec.group === group.id).map((spec) => (
            <AdjustmentRow key={spec.key} spec={spec} value={adjustments[spec.key]} disabled={disabled} dispatch={dispatch} />
          ))}
        </fieldset>
      ))}
    </section>
  );
}
