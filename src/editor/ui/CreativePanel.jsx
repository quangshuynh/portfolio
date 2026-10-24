import React, { useEffect, useRef, useState } from 'react';
import { ADJUSTMENTS, GRADE_RANGES, adjustmentSpec } from '../model/adjustments.mjs';
import { AdjustmentRow, ResetIcon } from './AdjustmentRow';
import FilterLibrary from './FilterLibrary';
import { layerSettingKeys } from '../model/layers.mjs';

const SECTIONS = [
  { id: 'bleach', title: 'Bleach Bypass', note: 'An approximation of the bleach-bypass look: a black-and-white copy laid over the colour, with denser shadows and muted colour. Not a simulation of the chemical process.' },
  { id: 'film', title: 'Film' },
  { id: 'glow', title: 'Glow' },
  { id: 'vignette', title: 'Vignette', note: 'Centred on the photo as exported (after crop and rotation).' },
  { id: 'grading', title: 'Color Grading' },
  { id: 'camera', title: 'Digital Camera', note: 'Early-camera rendering by eye, not measured from any camera: sensor colour crosstalk (cool CCD-like or warm), a contrasty response curve, per-channel highlight clipping and sensor noise. Noise is drawn on a virtual sensor of about 2 MP, so it reads the same in the preview and the export.' },
  { id: 'capture', title: 'Low Resolution & JPEG', note: 'The photo is captured on a small grid (at most 768 px on the long edge, smaller with Low resolution), JPEG-compressed in 8 × 8 blocks and scaled back up, so blocks cover the same part of the frame in the preview and in a full-size export. Dither applies only to such a capture.' },
  { id: 'lens', title: 'Lens & Diffusion', note: 'Chromatic aberration scales red out and blue in toward the corners; channel shift moves them apart in one direction. Soft focus spreads light into the shadows like a diffusion filter.' },
];
const keysIn = (section) => ADJUSTMENTS.filter((spec) => spec.section === section && !spec.hidden);
// Controls that do nothing until another one is set.
const DEPENDS = {
  noiseColor: (a) => a.noiseAmount,
  pixelEdges: (a) => a.captureResolution,
  quantizeDither: (a) => a.quantizeAmount && (a.captureResolution || a.jpegAmount),
  channelShiftAngle: (a) => a.channelShift,
  diffusionRadius: (a) => a.diffusionAmount,
};
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

/**
 * The Creative section: the Filter Library, then bleach bypass, film (fade, tints, grain), glow
 * (bloom, halation), vignette, colour grading, digital camera, low resolution and JPEG, and lens
 * effects. Each part resets on its own. For an image or adjustment layer (`layer`) only the
 * per-pixel colour controls a layer can hold are shown, without the Filter Library.
 */
export default function CreativePanel({ adjustments, disabled, dispatch, onPreview, presets = null, thumbnails = null, layer = false }) {
  const allowed = layer ? new Set(layerSettingKeys()) : null;
  const keysOf = (section) => keysIn(section).filter((spec) => !allowed || allowed.has(spec.key));
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
          {grain.length > 0 && <h5 className="pe-creative__sub">Grain</h5>}
          {grain.map((spec) => row(spec))}
          {grain.length > 0 && (
          <button
            type="button"
            className="pe-text-button"
            disabled={disabled || !adjustments.grainAmount}
            onClick={() => dispatch({ type: 'setAdjustment', key: 'grainSeed', value: (adjustments.grainSeed + 1 + Math.floor(Math.random() * 65535)) % 65536 })}
          >
            New grain pattern
          </button>
          )}
          {grain.length > 0 && <p className="pe-note">The pattern is saved with the photo, so previews and exports always show the same grain. Fine grain is seen best at 100% or in 1:1 Detail.</p>}
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
    return keysOf(id).map((spec) => row(spec, DEPENDS[spec.key] ? { disabled: disabled || !DEPENDS[spec.key](adjustments) } : {}));
  };
  return (
    <div className="pe-creative">
      {!layer && <h4 className="pe-creative__head">Filters</h4>}
      {!layer && <FilterLibrary adjustments={adjustments} disabled={disabled} dispatch={dispatch} onPreview={onPreview} presets={presets} thumbnails={thumbnails} />}
      {SECTIONS.filter(({ id }) => keysOf(id).length > 0).map(({ id, title, note }) => {
        const neutral = isSectionNeutral(adjustments, id) && (id !== 'film' || isSectionNeutral(adjustments, 'grain'));
        return (
          <div key={id} className="pe-creative__part" data-part={id}>
            <h4 className="pe-creative__head">
              <span>{title}</span>
              <button
                type="button"
                className="pe-icon-button"
                disabled={disabled || neutral}
                onClick={() => dispatch({ type: 'applySettings', patch: { ...sectionPatch(id), ...(id === 'film' && !layer ? sectionPatch('grain') : {}) } })}
                aria-label={`Reset ${title}`}
                title={`Reset ${title}`}
              >
                <ResetIcon />
              </button>
            </h4>
            {body(id)}
            {note && !layer && <p className="pe-note">{note}</p>}
          </div>
        );
      })}
    </div>
  );
}
