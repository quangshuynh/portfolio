import React, { useEffect, useRef, useState } from 'react';
import { ADJUSTMENTS, GRADE_RANGES, adjustmentSpec } from '../model/adjustments.mjs';
import { BUILT_IN_LOOKS, lookMatches, lookPatch } from '../model/looks.mjs';
import { AdjustmentRow, ResetIcon } from './AdjustmentRow';

const SECTIONS = [
  { id: 'bleach', title: 'Bleach Bypass', note: 'An approximation of the bleach-bypass look: a black-and-white copy laid over the colour, with denser shadows and muted colour. Not a simulation of the chemical process.' },
  { id: 'film', title: 'Film' },
  { id: 'glow', title: 'Glow' },
  { id: 'vignette', title: 'Vignette', note: 'Centred on the photo as exported (after crop and rotation).' },
  { id: 'grading', title: 'Color Grading' },
];
const keysOf = (section) => ADJUSTMENTS.filter((spec) => spec.section === section && !spec.hidden);
const isSectionNeutral = (adjustments, section) => ADJUSTMENTS.filter((spec) => spec.section === section).every((spec) => adjustments[spec.key] === spec.default);
const sectionPatch = (section) => Object.fromEntries(ADJUSTMENTS.filter((spec) => spec.section === section).map((spec) => [spec.key, spec.default]));

/**
 * Hue and saturation wheel for one grading range. Pointer input only (it previews while
 * dragging and records one undo step on release); the Hue and Saturation sliders below it
 * are the keyboard and screen reader controls, so the wheel itself is hidden from them.
 */
function ColorWheel({ hueKey, satKey, hue, saturation, disabled, dispatch }) {
  const ref = useRef(null);
  const dragging = useRef(false);
  const fromPointer = (event, commit) => {
    const rect = ref.current.getBoundingClientRect();
    const radius = rect.width / 2;
    const dx = event.clientX - rect.left - radius;
    const dy = rect.top + radius - event.clientY;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const patch = { [hueKey]: Math.round((angle + 360) % 360) % 360, [satKey]: Math.round(Math.min(1, Math.hypot(dx, dy) / radius) * 100) };
    dispatch({ type: commit ? 'applySettings' : 'previewSettings', patch });
  };
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
  const radians = (hue * Math.PI) / 180;
  const r = saturation / 100;
  return (
    <div
      ref={ref}
      className="pe-wheel"
      aria-hidden="true"
      data-disabled={disabled || undefined}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return;
        try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* a synthetic or already released pointer */ }
        dragging.current = true;
        fromPointer(event, false);
      }}
      onPointerMove={(event) => dragging.current && fromPointer(event, false)}
      onPointerUp={(event) => dragging.current && fromPointer(event, false)}
      onDoubleClick={() => !disabled && dispatch({ type: 'applySettings', patch: { [satKey]: 0 } })}
    >
      <span className="pe-wheel__marker" style={{ left: `${50 + 50 * r * Math.cos(radians)}%`, top: `${50 - 50 * r * Math.sin(radians)}%` }} />
    </div>
  );
}

function GradingPanel({ adjustments, disabled, dispatch }) {
  const [rangeId, setRangeId] = useState('Shadows');
  const range = GRADE_RANGES.find(({ id }) => id === rangeId);
  const key = (property) => `grade${rangeId}${property}`;
  const edited = (id) => adjustments[`grade${id}Sat`] !== 0 || adjustments[`grade${id}Lum`] !== 0;
  const row = (name, label) => <AdjustmentRow key={name} spec={adjustmentSpec(name)} label={label ?? adjustmentSpec(name).shortLabel} value={adjustments[name]} disabled={disabled} dispatch={dispatch} />;
  return (
    <div className="pe-grading">
      <div className="pe-grading__ranges" role="group" aria-label="Tonal range">
        {GRADE_RANGES.map(({ id, label }) => (
          <button key={id} type="button" className="pe-text-button" aria-pressed={id === rangeId} aria-label={edited(id) ? `${label} (edited)` : label} data-edited={edited(id) || undefined} onClick={() => setRangeId(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="pe-grading__body">
        <ColorWheel hueKey={key('Hue')} satKey={key('Sat')} hue={adjustments[key('Hue')]} saturation={adjustments[key('Sat')]} disabled={disabled} dispatch={dispatch} />
        <div className="pe-grading__rows">
          {row(key('Hue'), `${range.label} hue`)}
          {row(key('Sat'), `${range.label} saturation`)}
          {row(key('Lum'), `${range.label} luminance`)}
        </div>
      </div>
      {row('gradeBalance')}
      {row('gradeBlending')}
    </div>
  );
}

/** Looks: pick one (hover or focus previews it), then set its intensity. */
function LookPicker({ adjustments, disabled, dispatch, onPreview }) {
  const [chosen, setChosen] = useState(null);
  const active = chosen && lookMatches(adjustments, chosen.look, chosen.intensity) ? chosen : null;
  const dragging = useRef(false);
  const preview = (look) => onPreview?.(look ? { name: look.name, groups: ['creative'], settings: { ...lookPatch(look, 100), grainSeed: adjustments.grainSeed } } : null);
  useEffect(() => {
    const end = () => {
      if (!dragging.current) return;
      dragging.current = false;
      dispatch({ type: 'commitAdjustment' });
    };
    window.addEventListener('pointerup', end);
    return () => window.removeEventListener('pointerup', end);
  }, [dispatch]);
  const apply = (look) => {
    preview(null);
    dispatch({ type: 'applySettings', patch: lookPatch(look, 100) });
    setChosen({ look, intensity: 100 });
  };
  const setIntensity = (value) => {
    const patch = lookPatch(active.look, value);
    if (dragging.current) dispatch({ type: 'previewSettings', patch });
    else dispatch({ type: 'applySettings', patch, coalesceKey: `look:${active.look.id}` });
    setChosen({ look: active.look, intensity: value });
  };
  return (
    <div className="pe-looks">
      <ul className="pe-looks__list">
        {BUILT_IN_LOOKS.map((look) => (
          <li key={look.id}>
            <button
              type="button"
              className="pe-looks__look"
              disabled={disabled}
              aria-pressed={active?.look.id === look.id}
              title={look.description}
              onClick={() => apply(look)}
              {...(disabled ? {} : { onPointerEnter: () => preview(look), onPointerLeave: () => preview(null), onFocus: () => preview(look), onBlur: () => preview(null) })}
            >
              {look.name}
            </button>
          </li>
        ))}
      </ul>
      {active && (
        <div className="pe-adjust">
          <div className="pe-adjust__head">
            <label htmlFor="pe-look-intensity">{active.look.name} intensity</label>
            <output className="pe-adjust__value mono" htmlFor="pe-look-intensity">{active.intensity}%</output>
          </div>
          <input
            id="pe-look-intensity"
            className="pe-range"
            type="range"
            min={0}
            max={100}
            step={1}
            value={active.intensity}
            disabled={disabled}
            aria-valuetext={`${active.intensity}%`}
            style={{ '--fill-from': '0%', '--fill-to': `${active.intensity}%` }}
            onPointerDown={() => { dragging.current = true; }}
            onInput={(event) => setIntensity(Number(event.target.value))}
            onChange={() => {}}
          />
        </div>
      )}
      <p className="pe-note">A look replaces every Creative setting below and keeps the rest of the photo's edits. Adjust it, then save it as a preset (Presets, with Creative ticked).</p>
    </div>
  );
}

/**
 * The Creative section: looks, then bleach bypass, film (fade, tints, grain), glow (bloom,
 * halation), vignette and colour grading. Each part resets on its own.
 */
export default function CreativePanel({ adjustments, disabled, dispatch, onPreview }) {
  const row = (spec, extra = {}) => <AdjustmentRow key={spec.key} spec={spec} label={spec.shortLabel} value={adjustments[spec.key]} disabled={disabled} dispatch={dispatch} {...extra} />;
  const body = (id) => {
    if (id === 'grading') return <GradingPanel adjustments={adjustments} disabled={disabled} dispatch={dispatch} />;
    if (id === 'film') {
      const film = keysOf('film');
      const grain = keysOf('grain');
      return (
        <>
          {film.map((spec) => row(spec, { disabled: disabled || (spec.key.startsWith('fadeShadow') && !adjustments.fade) || (spec.key.startsWith('fadeHighlight') && !adjustments.fadeHighlights) }))}
          <p className="pe-note">The tints colour the lifted blacks and the rolled-off whites.</p>
          <h5 className="pe-creative__sub">Grain</h5>
          {grain.map((spec) => row(spec))}
          <button
            type="button"
            className="pe-text-button"
            disabled={disabled || !adjustments.grainAmount}
            onClick={() => dispatch({ type: 'setAdjustment', key: 'grainSeed', value: (adjustments.grainSeed + 1 + Math.floor(Math.random() * 65535)) % 65536 })}
          >
            New grain pattern
          </button>
          <p className="pe-note">The pattern is saved with the photo, so previews and exports always show the same grain. Fine grain is seen best at 100% or in 1:1 Detail.</p>
        </>
      );
    }
    if (id === 'glow') {
      const [bloom, halation] = [keysOf('glow').filter((spec) => spec.key.startsWith('bloom')), keysOf('glow').filter((spec) => spec.key.startsWith('halation'))];
      return (
        <>
          {bloom.map((spec) => row(spec))}
          <h5 className="pe-creative__sub">Halation</h5>
          {halation.map((spec) => row(spec, spec.key === 'halationAmount' ? { label: 'Amount' } : {}))}
          <p className="pe-note">Bloom is a soft glow in the colour of bright areas; halation a tighter red-orange bleed around highlights, as light scattered in film.</p>
        </>
      );
    }
    return keysOf(id).map((spec) => row(spec));
  };
  return (
    <div className="pe-creative">
      <h4 className="pe-creative__head">Looks</h4>
      <LookPicker adjustments={adjustments} disabled={disabled} dispatch={dispatch} onPreview={onPreview} />
      {SECTIONS.map(({ id, title, note }) => {
        const neutral = isSectionNeutral(adjustments, id) && (id !== 'film' || isSectionNeutral(adjustments, 'grain'));
        return (
          <div key={id} className="pe-creative__part" data-part={id}>
            <h4 className="pe-creative__head">
              <span>{title}</span>
              <button
                type="button"
                className="pe-icon-button"
                disabled={disabled || neutral}
                onClick={() => dispatch({ type: 'applySettings', patch: { ...sectionPatch(id), ...(id === 'film' ? sectionPatch('grain') : {}) } })}
                aria-label={`Reset ${title}`}
                title={`Reset ${title}`}
              >
                <ResetIcon />
              </button>
            </h4>
            {body(id)}
            {note && <p className="pe-note">{note}</p>}
          </div>
        );
      })}
    </div>
  );
}
