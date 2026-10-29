import React, { useEffect, useId, useState } from 'react';
import { ADJUSTMENTS, groupIsNeutral, isNeutral } from '../model/adjustments.mjs';
import { AdjustmentRow, ResetIcon } from './AdjustmentRow';
import CreativePanel from './CreativePanel';
import CurveEditor from './CurveEditor';
import GeometryPanel from './GeometryPanel';
import HdrPanel from './HdrPanel';
import HslPanel from './HslPanel';
import LutPanel from './LutPanel';
import PresetPanel from './PresetPanel';
import RawPanel from './RawPanel';
import TextPanel from './TextPanel';

const SECTIONS_KEY = 'photo-editor:sections:v1';
const DEFAULT_OPEN = { hdr: true, raw: true, light: true, color: true };

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
 * The adjustment inspector: collapsible groups for RAW development (RAW photos only),
 * light, colour, HSL, detail, tone curve, LUT and presets. Only RAW, Light and Color start
 * open; the choice is remembered locally.
 * :param raw: the active photo's RAW info, or null for JPEG, PNG and WebP
 * :param hdr: the active photo's merge description when it is a merged HDR, else null
 * :param geometry: Crop & Transform handlers (GeometryPanel props), or null without a photo
 * :param layer: { label } when the panels edit an image or adjustment layer's colour settings
 *   (`adjustments` are then that layer's, and `dispatch` targets it): only Light, Color, HSL,
 *   Tone Curve, LUT, the colour parts of Creative and Presets are shown; with `local: true` (a
 *   local adjustment) only Light, Color, HSL and Detail
 */
export default function AdjustPanel({ adjustments, disabled, dispatch, lut, presets, raw = null, hdr = null, geometry = null, text = null, thumbnails = null, layer = null }) {
  const [open, setOpen] = useState(readOpenSections);
  // Editing a text's wording from the photo opens the Text section.
  useEffect(() => { if (text?.focusRequest) setOpen((current) => ({ ...current, text: true })); }, [text?.focusRequest]);
  const toggle = (id) => setOpen((current) => {
    const next = { ...current, [id]: !current[id] };
    try { localStorage.setItem(SECTIONS_KEY, JSON.stringify(next)); } catch { /* per-viewer convenience only */ }
    return next;
  });
  // `lazy` sections (many controls) render their body only while open.
  const section = (id, title, children, { reset = true, edited, lazy = false } = {}) => {
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
        {lazy && !open[id] ? null : children}
      </Section>
    );
  };
  const rows = (group) => ADJUSTMENTS.filter((spec) => spec.group === group).map((spec) => (
    <AdjustmentRow key={spec.key} spec={spec} value={adjustments[spec.key]} disabled={disabled} dispatch={dispatch} label={spec.shortLabel} />
  ));

  return (
    <section className="pe-panel pe-panel--adjust" aria-labelledby="pe-adjust-title">
      <div className="pe-panel__head">
        <h2 id="pe-adjust-title">{layer ? <>Adjust <span className="pe-adjust-target">{layer.local ? 'local' : 'layer'} “{layer.label}”</span></> : 'Adjust'}</h2>
        <button type="button" className="pe-text-button" disabled={disabled || isNeutral(adjustments)} onClick={() => dispatch({ type: 'resetAll' })}>
          Reset all
        </button>
      </div>
      {layer && !layer.local && <p className="pe-note pe-note--layer">These settings apply to the selected layer only{layer.adjustment ? ' and change everything below it' : ''}. Select Background in Layers to edit the photo.</p>}
      {layer?.local && <p className="pe-note pe-note--layer">These settings apply through the selected mask only, on top of the photo&apos;s own settings. Select it again in Masks to edit the photo.</p>}
      {!layer && section('geometry', 'Crop & Transform', geometry
        ? <GeometryPanel geometry={adjustments.geometry} disabled={disabled} {...geometry} />
        : <p className="pe-note">Open a photo to crop, rotate or transform it.</p>)}
      {!layer && hdr && section('hdr', 'HDR', <HdrPanel hdr={hdr} adjustments={adjustments} disabled={disabled} dispatch={dispatch} />, { reset: hdr.mode === 'radiance' })}
      {!layer && raw && section('raw', 'RAW', <RawPanel raw={raw} adjustments={adjustments} disabled={disabled} dispatch={dispatch} />)}
      {section('light', 'Light', rows('light'))}
      {section('color', 'Color', rows('color'))}
      {section('hsl', 'HSL', <HslPanel adjustments={adjustments} disabled={disabled} dispatch={dispatch} />)}
      {(!layer || layer.local) && section('detail', 'Detail', (
        <>
          {rows('detail')}
          <p className="pe-note">Rendered on the CPU, so the preview follows after a moment. Sharpening and noise reduction act on full-resolution pixels: the preview shows them as a downscaled export would.</p>
        </>
      ))}
      {!layer?.local && (
        <>
          {section('curves', 'Tone Curve', <CurveEditor curves={adjustments.curves} disabled={disabled} dispatch={dispatch} />)}
          {section('lut', 'LUT', <LutPanel adjustments={adjustments} disabled={disabled} dispatch={dispatch} {...lut} />, { edited: Boolean(adjustments.lut) })}
          {section('creative', 'Creative', <CreativePanel adjustments={adjustments} disabled={disabled} dispatch={dispatch} onPreview={presets?.onPreview} presets={presets} thumbnails={thumbnails} layer={Boolean(layer)} />, { lazy: true })}
          {!layer && text && section('text', 'Text', <TextPanel layers={adjustments.layers} disabled={disabled} dispatch={dispatch} {...text} />, { lazy: true })}
          {section('presets', 'Presets', <PresetPanel adjustments={adjustments} disabled={disabled} dispatch={dispatch} {...presets} />, { reset: false, edited: false })}
        </>
      )}
    </section>
  );
}
