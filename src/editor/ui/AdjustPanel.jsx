import React, { useId, useState } from 'react';
import { ADJUSTMENTS, groupIsNeutral, isNeutral } from '../model/adjustments.mjs';
import { AdjustmentRow, ResetIcon } from './AdjustmentRow';
import CurveEditor from './CurveEditor';
import HslPanel from './HslPanel';
import LutPanel from './LutPanel';
import PresetPanel from './PresetPanel';

const SECTIONS_KEY = 'photo-editor:sections:v1';
const DEFAULT_OPEN = { light: true, color: true };

function readOpenSections() {
  try {
    const saved = JSON.parse(localStorage.getItem(SECTIONS_KEY));
    return saved && typeof saved === 'object' ? { ...DEFAULT_OPEN, ...saved } : DEFAULT_OPEN;
  } catch {
    return DEFAULT_OPEN;
  }
}

/** A collapsible group: the header toggles, shows whether the group is edited, and resets it. */
function Section({ id, title, open, onToggle, edited, onReset, resetDisabled, children }) {
  const bodyId = useId();
  return (
    <section className="pe-section" data-open={open || undefined} data-section-id={id}>
      <h3 className="pe-section__head">
        <button type="button" className="pe-section__toggle" aria-label={edited ? `${title} (edited)` : title} aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
          <svg className="pe-section__chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>{title}</span>
          {edited && <span className="pe-section__dot" title="Edited" aria-hidden="true" />}
        </button>
        {onReset && (
          <button type="button" className="pe-icon-button pe-section__reset" onClick={onReset} disabled={resetDisabled} aria-label={`Reset ${title}`} title={`Reset ${title}`}>
            <ResetIcon />
          </button>
        )}
      </h3>
      <div id={bodyId} className="pe-section__body" hidden={!open}>{children}</div>
    </section>
  );
}

/**
 * The adjustment inspector: collapsible groups for light, colour, HSL, tone curve,
 * LUT and presets. Only Light and Color start open; the choice is remembered locally.
 */
export default function AdjustPanel({ adjustments, disabled, dispatch, lut, presets }) {
  const [open, setOpen] = useState(readOpenSections);
  const toggle = (id) => setOpen((current) => {
    const next = { ...current, [id]: !current[id] };
    try { localStorage.setItem(SECTIONS_KEY, JSON.stringify(next)); } catch { /* per-viewer convenience only */ }
    return next;
  });
  const section = (id, title, children, { reset = true, edited } = {}) => {
    const neutral = groupIsNeutral(adjustments, id);
    return (
      <Section
        key={id}
        id={id}
        title={title}
        open={Boolean(open[id])}
        onToggle={() => toggle(id)}
        edited={edited ?? !neutral}
        onReset={reset ? () => dispatch({ type: 'resetGroup', group: id }) : null}
        resetDisabled={disabled || neutral}
      >
        {children}
      </Section>
    );
  };
  const rows = (group) => ADJUSTMENTS.filter((spec) => spec.group === group).map((spec) => (
    <AdjustmentRow key={spec.key} spec={spec} value={adjustments[spec.key]} disabled={disabled} dispatch={dispatch} />
  ));

  return (
    <section className="pe-panel pe-panel--adjust" aria-labelledby="pe-adjust-title">
      <div className="pe-panel__head">
        <h2 id="pe-adjust-title">Adjust</h2>
        <button type="button" className="pe-text-button" disabled={disabled || isNeutral(adjustments)} onClick={() => dispatch({ type: 'resetAll' })}>
          Reset all
        </button>
      </div>
      {section('light', 'Light', rows('light'))}
      {section('color', 'Color', rows('color'))}
      {section('hsl', 'HSL', <HslPanel adjustments={adjustments} disabled={disabled} dispatch={dispatch} />)}
      {section('curves', 'Tone Curve', <CurveEditor curves={adjustments.curves} disabled={disabled} dispatch={dispatch} />)}
      {section('lut', 'LUT', <LutPanel adjustments={adjustments} disabled={disabled} dispatch={dispatch} {...lut} />, { edited: Boolean(adjustments.lut) })}
      {section('presets', 'Presets', <PresetPanel adjustments={adjustments} disabled={disabled} dispatch={dispatch} {...presets} />, { reset: false, edited: false })}
    </section>
  );
}
