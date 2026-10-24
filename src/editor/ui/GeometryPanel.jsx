import React, { useEffect, useId, useRef, useState } from 'react';
import {
  ANGLE_LIMIT, ASPECT_PRESETS, GeometryError, STRETCH_LIMITS, constrainGeometry, flipGeometry, geometryPlan, neutralGeometry,
  parseAspect, setAspect, swapAspect, turnGeometry,
} from '../pipeline/geometry.mjs';
import { ResetIcon } from './AdjustmentRow';

/** Long-edge sizes offered for Resize (never above the crop). */
const RESIZE_PRESETS = [4096, 3840, 2560, 2048, 1600, 1080];

const formatNumber = (value, digits) => {
  const fixed = value.toFixed(digits);
  return value > 0 ? `+${fixed}` : fixed;
};

/**
 * A slider with an editable value: drags preview and record one undo step on release,
 * keyboard steps coalesce, typed values apply once (like AdjustmentRow).
 */
function ValueRow({ id, label, value, min, max, step, defaultValue = 0, digits = 0, unit = '', disabled, onPreview, onSet, onCommit, onActive, note }) {
  const dragging = useRef(false);
  const [draft, setDraft] = useState(null);
  useEffect(() => {
    const end = () => {
      if (!dragging.current) return;
      dragging.current = false;
      onActive?.(false);
      onCommit();
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [onCommit, onActive]);
  const text = `${formatNumber(value, digits)}${unit}`;
  const commitDraft = () => {
    if (draft === null) return;
    const parsed = Number.parseFloat(draft.replace(/[^\d.+-]/g, ''));
    if (Number.isFinite(parsed)) onSet(Math.min(max, Math.max(min, parsed)), false);
    setDraft(null);
  };
  return (
    <div className="pe-adjust" data-changed={value !== defaultValue || undefined}>
      <div className="pe-adjust__head">
        <label htmlFor={id} onDoubleClick={() => !disabled && onSet(defaultValue, false)}>{label}</label>
        <input
          className="pe-adjust__value mono"
          type="text"
          inputMode="decimal"
          aria-label={`${label} value`}
          disabled={disabled}
          value={draft ?? text}
          onFocus={(event) => event.target.select()}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { commitDraft(); event.currentTarget.blur(); }
            if (event.key === 'Escape') { setDraft(null); event.currentTarget.blur(); }
          }}
        />
        <button type="button" className="pe-icon-button pe-adjust__reset" onClick={() => onSet(defaultValue, false)} disabled={disabled || value === defaultValue} aria-label={`Reset ${label}`} title={`Reset ${label}`}>
          <ResetIcon />
        </button>
      </div>
      <input
        id={id}
        className="pe-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={text}
        style={{ '--fill-from': `${((Math.min(max, Math.max(min, defaultValue)) - min) / (max - min)) * 100}%`, '--fill-to': `${((value - min) / (max - min)) * 100}%` }}
        onPointerDown={() => { dragging.current = true; onActive?.(true); }}
        onFocus={() => onActive?.(true)}
        onBlur={() => onActive?.(false)}
        onInput={(event) => {
          const next = Number(event.target.value);
          if (dragging.current) onPreview(next); else onSet(next, true);
        }}
        onChange={() => {}}
      />
      {note && <p className="pe-note">{note}</p>}
    </div>
  );
}

const Icon = ({ d }) => <svg viewBox="0 0 16 16" aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
export const TURN_LEFT = 'M6 2.5L3.5 5 6 7.5M3.5 5H9a3.5 3.5 0 0 1 0 7H7';
export const TURN_RIGHT = 'M10 2.5L12.5 5 10 7.5M12.5 5H7a3.5 3.5 0 0 0 0 7h2';

/** Ratio choices: presets, plus the current custom ratio when it is not one of them. */
export function aspectChoices(aspect) {
  const known = ASPECT_PRESETS.some(({ id }) => id === aspect || id === swapAspect(aspect));
  return known ? ASPECT_PRESETS : [...ASPECT_PRESETS, { id: aspect, label: aspect }];
}

/** The aspect select's value: a turned preset ('2:3') shows as its preset ('3:2') with the turn button pressed. */
export function aspectBase(aspect) {
  if (ASPECT_PRESETS.some(({ id }) => id === aspect)) return aspect;
  const swapped = swapAspect(aspect);
  return ASPECT_PRESETS.some(({ id }) => id === swapped) ? swapped : aspect;
}

const isPortrait = (aspect) => {
  const parsed = parseAspect(aspect);
  return Boolean(parsed) && parsed.h > parsed.w;
};

/**
 * Crop & Transform: crop ratio and tool, rotation and straightening, flips, perspective,
 * stretch and resize. Every change goes through `onChange(next, { preview, coalesceKey })`
 * as one geometry value; nothing changes pixels.
 * :param props: geometry, native ({ width, height } of the photo), disabled, mode (null,
 *   'crop' or 'corners'), onMode(mode), onChange, onCommit, onStraightening(active)
 */
export default function GeometryPanel({ geometry, native, disabled, mode, onMode, onChange, onCommit, onStraightening }) {
  const baseId = useId();
  const [error, setError] = useState(null);
  const [custom, setCustom] = useState({ w: '', h: '' });
  let plan = null;
  try {
    plan = geometryPlan(geometry, native);
  } catch { /* shown through `error` when it was caused by a change here */ }

  // A change that keeps the crop inside the photo (crop to fill) when that is on.
  const change = (next, options = {}) => {
    try {
      onChange(constrainGeometry(next, native), options);
      setError(null);
    } catch (problem) {
      if (!(problem instanceof GeometryError)) throw problem;
      setError(`${problem.message} Reduce the perspective or the straighten angle.`);
    }
  };
  const valueSetter = (patchOf, coalesceKey) => (value, coalesce) => change(patchOf(value), coalesce ? { coalesceKey } : {});
  const valuePreview = (patchOf) => (value) => change(patchOf(value), { preview: true });
  const turned = isPortrait(geometry.aspect);
  const crop = plan?.crop;
  const resize = geometry.resize;
  const longEdge = crop ? Math.max(crop.width, crop.height) : 0;

  const setResize = (width, height, locked = resize?.locked ?? true) => {
    if (!crop) return;
    const w = Math.round(Number(width));
    const h = Math.round(Number(height));
    if (!(w >= 1 && h >= 1)) return;
    // The crop's own size with proportions kept means no resize (unlocked is remembered).
    if (w >= crop.width && h >= crop.height && locked) { change({ ...geometry, resize: null }); return; }
    change({ ...geometry, resize: { width: Math.min(w, crop.width), height: Math.min(h, crop.height), locked } });
  };
  const resizeTo = (field, value) => {
    if (!crop) return;
    const number = Math.round(Number(value));
    if (!(number >= 1)) return;
    if (resize?.locked === false) {
      setResize(field === 'width' ? number : (resize?.width ?? crop.width), field === 'height' ? number : (resize?.height ?? crop.height), false);
      return;
    }
    const scale = Math.min(1, field === 'width' ? number / crop.width : number / crop.height);
    setResize(Math.max(1, Math.round(crop.width * scale)), Math.max(1, Math.round(crop.height * scale)), true);
  };
  const applyCustom = () => {
    const aspect = `${custom.w}:${custom.h}`;
    if (!parseAspect(aspect)) { setError('Enter a ratio of two numbers from 0.01 to 1000, such as 1.91 and 1.'); return; }
    try {
      onChange(setAspect(geometry, aspect, native));
      setError(null);
    } catch (problem) {
      if (problem instanceof GeometryError) setError(problem.message); else throw problem;
    }
  };

  return (
    <div className="pe-geometry">
      <div className="pe-geometry__tools" role="group" aria-label="Crop tools">
        <button type="button" className="pe-button" aria-pressed={mode === 'crop'} disabled={disabled} onClick={() => onMode(mode === 'crop' ? null : 'crop')}>
          {mode === 'crop' ? 'Done cropping' : 'Crop & straighten'}
        </button>
        <button type="button" className="pe-button" aria-pressed={mode === 'corners'} disabled={disabled} onClick={() => onMode(mode === 'corners' ? null : 'corners')}>
          {mode === 'corners' ? 'Done with corners' : 'Perspective corners'}
        </button>
      </div>

      <fieldset className="pe-group">
        <legend>Crop</legend>
        <div className="pe-field-row pe-geometry__ratio">
          <label className="pe-field">
            <span>Ratio</span>
            <select
              value={aspectBase(geometry.aspect)}
              disabled={disabled}
              onChange={(event) => {
                const base = event.target.value;
                const aspect = turned && parseAspect(base) ? swapAspect(base) : base;
                try { onChange(setAspect(geometry, aspect, native)); setError(null); } catch (problem) { if (problem instanceof GeometryError) setError(problem.message); else throw problem; }
              }}
            >
              {aspectChoices(aspectBase(geometry.aspect)).map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <button
            type="button"
            className="pe-button pe-geometry__orient"
            aria-pressed={turned}
            disabled={disabled || !parseAspect(geometry.aspect) || parseAspect(geometry.aspect).w === parseAspect(geometry.aspect).h}
            onClick={() => onChange(setAspect(geometry, swapAspect(geometry.aspect), native))}
            title="Swap the ratio between landscape and portrait"
          >
            {turned ? 'Portrait' : 'Landscape'}
          </button>
        </div>
        <div className="pe-field-row pe-geometry__custom">
          <label className="pe-field"><span>Custom W</span><input type="number" min="0.01" max="1000" step="0.01" inputMode="decimal" value={custom.w} disabled={disabled} onChange={(event) => setCustom((c) => ({ ...c, w: event.target.value }))} /></label>
          <label className="pe-field"><span>H</span><input type="number" min="0.01" max="1000" step="0.01" inputMode="decimal" value={custom.h} disabled={disabled} onChange={(event) => setCustom((c) => ({ ...c, h: event.target.value }))} /></label>
          <button type="button" className="pe-button" disabled={disabled || !custom.w || !custom.h} onClick={applyCustom}>Use ratio</button>
        </div>
        <label className="pe-check">
          <input type="checkbox" checked={geometry.constrain} disabled={disabled} onChange={(event) => change({ ...geometry, constrain: event.target.checked })} />
          <span>Crop to fill (keep the crop inside the photo)</span>
        </label>
        {!geometry.constrain && (
          <label className="pe-field">
            <span>Outside the photo</span>
            <select value={geometry.background} disabled={disabled} onChange={(event) => change({ ...geometry, background: event.target.value })}>
              <option value="transparent">Transparent (PNG, WebP; white in JPEG)</option>
              <option value="white">White</option>
              <option value="black">Black</option>
            </select>
          </label>
        )}
        <div className="pe-geometry__buttons">
          <button type="button" className="pe-text-button" disabled={disabled || !geometry.crop} onClick={() => change({ ...geometry, crop: null })}>Reset crop</button>
        </div>
      </fieldset>

      <fieldset className="pe-group">
        <legend>Rotate &amp; straighten</legend>
        <div className="pe-geometry__buttons" role="group" aria-label="Rotate by 90 degrees">
          <button type="button" className="pe-button pe-geometry__icon" disabled={disabled} onClick={() => change(turnGeometry(geometry, -1))} aria-label="Rotate 90° counterclockwise" title="Rotate 90° counterclockwise"><Icon d={TURN_LEFT} /></button>
          <button type="button" className="pe-button pe-geometry__icon" disabled={disabled} onClick={() => change(turnGeometry(geometry, 1))} aria-label="Rotate 90° clockwise" title="Rotate 90° clockwise"><Icon d={TURN_RIGHT} /></button>
          <button type="button" className="pe-button" disabled={disabled} onClick={() => change(turnGeometry(geometry, 2))}>180°</button>
        </div>
        <ValueRow
          id={`${baseId}-angle`}
          label="Straighten"
          value={geometry.angle}
          min={-ANGLE_LIMIT}
          max={ANGLE_LIMIT}
          step={0.1}
          digits={2}
          unit="°"
          disabled={disabled}
          onPreview={valuePreview((angle) => ({ ...geometry, angle }))}
          onSet={valueSetter((angle) => ({ ...geometry, angle }), 'angle')}
          onCommit={onCommit}
          onActive={onStraightening}
        />
      </fieldset>

      <fieldset className="pe-group">
        <legend>Flip</legend>
        <div className="pe-geometry__buttons">
          <button type="button" className="pe-button" aria-pressed={geometry.flipH} disabled={disabled} onClick={() => change(flipGeometry(geometry, 'horizontal'))}>Flip horizontal</button>
          <button type="button" className="pe-button" aria-pressed={geometry.flipV} disabled={disabled} onClick={() => change(flipGeometry(geometry, 'vertical'))}>Flip vertical</button>
        </div>
      </fieldset>

      <fieldset className="pe-group">
        <legend>Perspective</legend>
        <ValueRow
          id={`${baseId}-vertical`}
          label="Vertical perspective"
          value={geometry.perspective.vertical}
          min={-100}
          max={100}
          step={1}
          disabled={disabled || Boolean(geometry.quad)}
          onPreview={valuePreview((vertical) => ({ ...geometry, perspective: { ...geometry.perspective, vertical } }))}
          onSet={valueSetter((vertical) => ({ ...geometry, perspective: { ...geometry.perspective, vertical } }), 'vertical')}
          onCommit={onCommit}
        />
        <ValueRow
          id={`${baseId}-horizontal`}
          label="Horizontal perspective"
          value={geometry.perspective.horizontal}
          min={-100}
          max={100}
          step={1}
          disabled={disabled || Boolean(geometry.quad)}
          onPreview={valuePreview((horizontal) => ({ ...geometry, perspective: { ...geometry.perspective, horizontal } }))}
          onSet={valueSetter((horizontal) => ({ ...geometry, perspective: { ...geometry.perspective, horizontal } }), 'horizontal')}
          onCommit={onCommit}
          note={geometry.quad ? 'Corners are set; reset them to use the sliders.' : 'Vertical + widens the top (lines converging upwards become parallel); Horizontal + widens the left. Applied after straightening.'}
        />
        <div className="pe-geometry__buttons">
          <button type="button" className="pe-text-button" disabled={disabled || !geometry.quad} onClick={() => change({ ...geometry, quad: null })}>Reset corners</button>
        </div>
      </fieldset>

      <fieldset className="pe-group">
        <legend>Stretch (changes proportions)</legend>
        <ValueRow
          id={`${baseId}-stretch-x`}
          label="Stretch horizontally"
          value={geometry.stretch.x}
          min={STRETCH_LIMITS.min}
          max={STRETCH_LIMITS.max}
          step={1}
          defaultValue={100}
          unit="%"
          disabled={disabled}
          onPreview={valuePreview((x) => ({ ...geometry, stretch: { ...geometry.stretch, x } }))}
          onSet={valueSetter((x) => ({ ...geometry, stretch: { ...geometry.stretch, x } }), 'stretchX')}
          onCommit={onCommit}
        />
        <ValueRow
          id={`${baseId}-stretch-y`}
          label="Stretch vertically"
          value={geometry.stretch.y}
          min={STRETCH_LIMITS.min}
          max={STRETCH_LIMITS.max}
          step={1}
          defaultValue={100}
          unit="%"
          disabled={disabled}
          onPreview={valuePreview((y) => ({ ...geometry, stretch: { ...geometry.stretch, y } }))}
          onSet={valueSetter((y) => ({ ...geometry, stretch: { ...geometry.stretch, y } }), 'stretchY')}
          onCommit={onCommit}
          note="Distorts the photo on purpose. The output never gains pixels: the less stretched side is reduced instead."
        />
      </fieldset>

      <fieldset className="pe-group">
        <legend>Resize</legend>
        <div className="pe-field-row pe-geometry__size">
          <label className="pe-field"><span>Width</span><input type="number" min="1" max={crop?.width} inputMode="numeric" disabled={disabled || !crop} value={plan?.native.width ?? ''} onChange={(event) => resizeTo('width', event.target.value)} /></label>
          <label className="pe-field"><span>Height</span><input type="number" min="1" max={crop?.height} inputMode="numeric" disabled={disabled || !crop} value={plan?.native.height ?? ''} onChange={(event) => resizeTo('height', event.target.value)} /></label>
        </div>
        <label className="pe-check">
          <input type="checkbox" checked={resize?.locked !== false} disabled={disabled || !crop} onChange={(event) => setResize(plan.native.width, plan.native.height, event.target.checked)} />
          <span>Keep proportions</span>
        </label>
        {resize?.locked === false && <p className="pe-note">Unlocked: width and height scale separately, which distorts the photo. Use Stretch for intentional distortion.</p>}
        <label className="pe-field">
          <span>Size</span>
          <select
            disabled={disabled || !crop}
            value={!resize ? 'original' : 'custom'}
            onChange={(event) => {
              if (event.target.value === 'original') change({ ...geometry, resize: null });
              else if (event.target.value !== 'custom') {
                const edge = Number(event.target.value);
                const scale = Math.min(1, edge / longEdge);
                setResize(Math.round(crop.width * scale), Math.round(crop.height * scale), true);
              }
            }}
          >
            <option value="original">Original resolution</option>
            {resize && <option value="custom">Custom</option>}
            {RESIZE_PRESETS.filter((edge) => edge < longEdge).map((edge) => <option key={edge} value={edge}>Long edge {edge} px</option>)}
          </select>
        </label>
        <p className="pe-note" aria-live="polite">
          {plan ? `Output ${plan.native.width} × ${plan.native.height} px${resize ? ` (crop ${crop.width} × ${crop.height})` : ''}. Never upscaled; the Export size applies after this.` : ''}
        </p>
      </fieldset>

      {error && <p className="pe-note pe-note--error" role="alert">{error}</p>}
      <button type="button" className="pe-text-button" disabled={disabled} onClick={() => onChange({ ...neutralGeometry() })}>Reset geometry</button>
    </div>
  );
}
