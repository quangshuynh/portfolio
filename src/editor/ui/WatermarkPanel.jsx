import React, { useRef, useState } from 'react';
import {
  WATERMARK_COLORS, WATERMARK_DEFAULTS, WATERMARK_LIMITS, WATERMARK_POSITIONS, WATERMARK_PRESET_LABEL,
  WatermarkConfigError, parseWatermarkConfig, serializeWatermarkConfig, watermarkOverrides,
} from '../watermark/watermark.mjs';
import { TextRange } from './TextPanel';

const OVERRIDE_LABELS = { position: 'position', size: 'size', opacity: 'opacity', color: 'colour', margin: 'margin', border: 'border', rules: 'accent lines', outline: 'outline' };

/**
 * The Watermark section: the HUYNH Photography mark over this photo's final output. Settings are
 * part of the photo's edits (undo, saved documents, CMS treatments); the mark itself is fixed.
 * :param defaults: { settings, label, onSave(settings) | null, overrides } the settings "Enable"
 *   and "Reset" use: the built-in preset, this browser's saved default, or the CMS global
 *   preference (`overrides`: list the fields this photo sets differently)
 * :param auto: { variant, mean } of the preview's backdrop when the colour is Auto, or null
 */
export default function WatermarkPanel({ watermark, disabled, dispatch, defaults, auto = null, onDownload }) {
  const fileRef = useRef(null);
  const [message, setMessage] = useState(null);
  const base = defaults?.settings ?? WATERMARK_DEFAULTS;
  const on = Boolean(watermark?.enabled);
  const apply = (patch, coalesceKey = null) => dispatch({ type: 'applySettings', patch: { watermark: { ...(watermark ?? base), ...patch } }, coalesceKey });
  const preview = (patch) => dispatch({ type: 'previewSettings', patch: { watermark: { ...(watermark ?? base), ...patch } } });
  const commit = () => dispatch({ type: 'commitAdjustment' });
  const editing = disabled || !on;
  const overrides = defaults?.overrides && watermark ? watermarkOverrides(watermark, base) : [];

  const range = (key, label, [min, max], step, unit) => (
    <TextRange
      label={label}
      value={watermark?.[key] ?? base[key]}
      min={min * 100}
      max={max * 100}
      step={step}
      unit={unit}
      disabled={editing}
      toShown={(v) => v * 100}
      fromShown={(v) => v / 100}
      onPreview={(value) => preview({ [key]: value })}
      onApply={(value) => apply({ [key]: value }, `watermark:${key}`)}
      onCommit={commit}
    />
  );

  const importConfig = async (file) => {
    setMessage(null);
    try {
      if (file.size > 16 * 1024) throw new WatermarkConfigError('A watermark file is plain JSON of at most 16 KB.');
      const { settings } = parseWatermarkConfig(await file.text());
      apply({ ...settings, enabled: true });
      setMessage({ tone: 'info', text: `Applied the watermark settings from ${file.name}.` });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof WatermarkConfigError ? error.message : 'The file could not be read.' });
    }
  };

  return (
    <div className="pe-watermark">
      <label className="pe-check pe-watermark__enable">
        <input type="checkbox" checked={on} disabled={disabled} onChange={(event) => apply({ enabled: event.target.checked })} />
        <span>Add the {WATERMARK_PRESET_LABEL} watermark</span>
      </label>
      <label className="pe-field">
        <span>Preset</span>
        <select value="huynh" disabled={editing} onChange={() => {}}>
          <option value="huynh">{WATERMARK_PRESET_LABEL}{defaults?.label ? ` (${defaults.label})` : ''}</option>
        </select>
      </label>
      <svg className="pe-watermark__sample" viewBox="0 0 110 50" role="img" aria-label="HUYNH Photography mark: HUYNH, PHOTOGRAPHY between two rules, quanghuynh.com, in a thin frame">
        <rect x="1" y="1" width="108" height="48" fill="none" stroke="currentColor" strokeWidth="1.2" opacity={watermark?.border === false ? 0.15 : 1} />
        <text x="55" y="22" textAnchor="middle" fontSize="17" fontWeight="800" letterSpacing="2.6" fill="currentColor">HUYNH</text>
        <text x="55" y="33" textAnchor="middle" fontSize="4.7" fontWeight="500" letterSpacing="1.5" fill="currentColor">PHOTOGRAPHY</text>
        <g opacity={watermark?.rules === false ? 0.15 : 1}><rect x="14" y="30.6" width="12" height="0.8" fill="currentColor" /><rect x="84" y="30.6" width="12" height="0.8" fill="currentColor" /></g>
        <text x="55" y="42" textAnchor="middle" fontSize="3.8" fontWeight="500" letterSpacing="0.4" fill="currentColor">quanghuynh.com</text>
      </svg>

      <fieldset className="pe-group" disabled={editing}>
        <legend>Position</legend>
        <div className="pe-watermark__positions" role="group" aria-label="Watermark position">
          {WATERMARK_POSITIONS.map(({ id, label }) => (
            <button key={id} type="button" className="pe-button" data-position={id} aria-pressed={(watermark?.position ?? base.position) === id} onClick={() => apply({ position: id })}>{label}</button>
          ))}
        </div>
      </fieldset>
      {range('size', 'Size', WATERMARK_LIMITS.size, 0.5, '%')}
      {range('opacity', 'Opacity', WATERMARK_LIMITS.opacity, 1, '%')}
      {range('margin', 'Margin', WATERMARK_LIMITS.margin, 0.5, '%')}
      <fieldset className="pe-group pe-segmented-field" disabled={editing}>
        <legend>Colour</legend>
        <div className="pe-segmented" role="radiogroup" aria-label="Watermark colour">
          {WATERMARK_COLORS.map(({ id, label }) => (
            <label key={id} className="pe-segmented__option">
              <input type="radio" name="pe-watermark-color" value={id} checked={(watermark?.color ?? base.color) === id} onChange={() => apply({ color: id })} />
              <span>{label}</span>
            </label>
          ))}
        </div>
        {on && watermark.color === 'auto' && auto && (
          <p className="pe-note" role="status" data-watermark-auto={auto.variant}>
            Auto: {auto.variant === 'dark' ? 'charcoal' : 'white'} over a backdrop at {Math.round(auto.mean * 100)}% luminance. The export decides again from its own pixels.
          </p>
        )}
      </fieldset>
      <label className="pe-check">
        <input type="checkbox" checked={watermark?.border ?? base.border} disabled={editing} onChange={(event) => apply({ border: event.target.checked })} />
        <span>Border</span>
      </label>
      <label className="pe-check">
        <input type="checkbox" checked={watermark?.rules ?? base.rules} disabled={editing} onChange={(event) => apply({ rules: event.target.checked })} />
        <span>Accent lines</span>
      </label>
      <label className="pe-check">
        <input type="checkbox" checked={watermark?.outline ?? base.outline} disabled={editing} onChange={(event) => apply({ outline: event.target.checked })} />
        <span>Outline (charcoal around white, white around charcoal)</span>
      </label>
      {overrides.length > 0 && <p className="pe-note" data-watermark-overrides>This photo overrides the {defaults.label}: {overrides.map((key) => OVERRIDE_LABELS[key]).join(', ')}.</p>}

      <div className="pe-watermark__actions">
        <button type="button" className="pe-button" disabled={disabled || !watermark} onClick={() => apply({ ...base, enabled: watermark.enabled })}>
          Reset to {defaults?.label ?? 'default'}
        </button>
        {defaults?.onSave && (
          <button type="button" className="pe-button" disabled={disabled || !watermark} onClick={async () => {
            setMessage(null);
            try {
              await defaults.onSave({ ...watermark, enabled: true });
              setMessage({ tone: 'info', text: `Saved as the ${defaults.label}.` });
            } catch (error) {
              setMessage({ tone: 'error', text: error.message });
            }
          }}>
            Save as {defaults.label}
          </button>
        )}
        <button type="button" className="pe-button" disabled={!watermark} onClick={() => onDownload(new Blob([serializeWatermarkConfig(watermark)], { type: 'application/json' }), 'huynh-watermark.json')}>
          Download settings
        </button>
        <button type="button" className="pe-button" disabled={disabled} onClick={() => fileRef.current?.click()}>Open settings…</button>
        <input ref={fileRef} type="file" hidden accept="application/json,.json" onChange={(event) => { const file = event.target.files[0]; event.target.value = ''; if (file) importConfig(file); }} />
      </div>
      {message && <p className={`pe-note${message.tone === 'error' ? ' pe-note--error' : ''}`} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</p>}
      <p className="pe-note">Drawn over the final photo (after crop, layers and masks) at the export&apos;s own resolution; it never changes the original. A visible mark deters casual reuse but can be cropped or retouched out.</p>
    </div>
  );
}
