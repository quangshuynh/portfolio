import React, { useEffect, useId, useRef, useState } from 'react';
import {
  DEFAULT_OUTLINE, DEFAULT_SHADOW, TEXT_ALIGNS, TEXT_FONTS, TEXT_LIMITS, cleanText, createTextOverlay, duplicateOverlay,
  fontOf, normalizeTextOverlay, reorderOverlays,
} from '../model/overlays.mjs';
import { uncoveredCharacters } from '../text/fonts.mjs';

let sequence = 0;
/** A new overlay id: unique in this session and valid in documents. */
export const newTextId = () => `text-${Date.now().toString(36)}-${(sequence += 1).toString(36)}`;

/**
 * A numeric control for one overlay field: a range (drags preview and record one undo step
 * on release) and a number field. `toValue`/`fromValue` convert between the stored value and
 * the displayed one (percent, degrees).
 */
function TextRange({ label, value, min, max, step, unit = '', disabled, onPreview, onApply, onCommit, toShown = (v) => v, fromShown = (v) => v }) {
  const id = useId();
  const dragging = useRef(false);
  const shown = Number(toShown(value).toFixed(step < 1 ? 1 : 0));
  useEffect(() => {
    const end = () => {
      if (!dragging.current) return;
      dragging.current = false;
      onCommit();
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [onCommit]);
  return (
    <div className="pe-adjust">
      <div className="pe-adjust__head">
        <label htmlFor={id}>{label}</label>
        <input
          className="pe-adjust__value mono"
          type="number"
          aria-label={`${label} value${unit ? ` (${unit})` : ''}`}
          min={min}
          max={max}
          step={step}
          value={shown}
          disabled={disabled}
          onChange={(event) => {
            const number = Number.parseFloat(event.target.value);
            if (Number.isFinite(number)) onApply(fromShown(Math.min(max, Math.max(min, number))));
          }}
        />
      </div>
      <input
        id={id}
        className="pe-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        disabled={disabled}
        aria-valuetext={`${shown}${unit}`}
        style={{ '--fill-from': '0%', '--fill-to': `${((shown - min) / (max - min)) * 100}%` }}
        onPointerDown={() => { dragging.current = true; }}
        onInput={(event) => {
          const next = fromShown(Number(event.target.value));
          if (dragging.current) onPreview(next);
          else onApply(next);
        }}
        onChange={() => {}}
      />
    </div>
  );
}

const firstLine = (text) => (text.split('\n')[0] || 'Empty text').slice(0, 40);

/**
 * The Text section: the photo's text objects (front first) and the selected one's content,
 * font, size, colour, opacity, alignment, outline, shadow and transform.
 * :param text: { overlays, selectedId, onSelect(id), editing (Text tool on), onTool(on), focusRequest }
 */
export default function TextPanel({ overlays, disabled, dispatch, selectedId, onSelect, editing, onTool, focusRequest }) {
  const selected = overlays.find(({ id }) => id === selectedId) ?? null;
  const textareaRef = useRef(null);
  const [message, setMessage] = useState(null);
  useEffect(() => {
    if (focusRequest && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [focusRequest]);

  const apply = (next, coalesceKey = null) => dispatch({ type: 'applySettings', patch: { overlays: next }, coalesceKey });
  const preview = (next) => dispatch({ type: 'previewSettings', patch: { overlays: next } });
  const commit = () => dispatch({ type: 'commitAdjustment' });
  const withSelected = (patch) => overlays.map((overlay) => (overlay.id === selectedId ? normalizeTextOverlay({ ...overlay, ...patch }) : overlay));
  const field = (name, extra = {}) => ({
    disabled,
    onPreview: (value) => preview(withSelected({ [name]: value })),
    onApply: (value) => apply(withSelected({ [name]: value }), `text:${selectedId}:${name}`),
    onCommit: commit,
    ...extra,
  });
  const nested = (group, name, extra = {}) => ({
    disabled,
    onPreview: (value) => preview(withSelected({ [group]: { ...selected[group], [name]: value } })),
    onApply: (value) => apply(withSelected({ [group]: { ...selected[group], [name]: value } }), `text:${selectedId}:${group}.${name}`),
    onCommit: commit,
    ...extra,
  });

  const add = () => {
    if (overlays.length >= TEXT_LIMITS.objects) { setMessage(`A photo can hold up to ${TEXT_LIMITS.objects} text objects.`); return; }
    const offset = (overlays.length % 5) * 0.04;
    const overlay = createTextOverlay(newTextId(), { y: 0.5 + offset, x: 0.5 + offset });
    apply([...overlays, overlay]);
    onSelect(overlay.id);
    onTool(true);
    setMessage(null);
    requestAnimationFrame(() => { textareaRef.current?.focus(); textareaRef.current?.select(); });
  };
  const index = selected ? overlays.indexOf(selected) : -1;
  const remove = (id) => {
    const next = overlays.filter((overlay) => overlay.id !== id);
    apply(next);
    if (id === selectedId) onSelect(next.at(-1)?.id ?? null);
  };
  const missing = selected ? uncoveredCharacters(selected) : [];
  const font = selected ? fontOf(selected) : null;

  return (
    <div className="pe-textpanel">
      <div className="pe-textpanel__actions">
        <button type="button" className="pe-button" disabled={disabled} onClick={add}>Add text</button>
        <button type="button" className="pe-text-button" disabled={disabled} aria-pressed={editing} onClick={() => onTool(!editing)} title="Move, resize and rotate text on the photo (T)">
          {editing ? 'Done placing' : 'Place on photo'}
        </button>
      </div>
      {message && <p className="pe-note" role="status">{message}</p>}
      {overlays.length > 0 && (
        <ol className="pe-textpanel__list" aria-label="Text objects, front first">
          {[...overlays].reverse().map((overlay) => (
            <li key={overlay.id}>
              <button type="button" className="pe-textpanel__item" aria-pressed={overlay.id === selectedId} disabled={disabled} onClick={() => onSelect(overlay.id)}>
                {firstLine(overlay.text)}
              </button>
            </li>
          ))}
        </ol>
      )}
      {selected && (
        <div className="pe-textpanel__props" role="group" aria-label={`Text “${firstLine(selected.text)}”`}>
          <div className="pe-textpanel__order">
            <button type="button" className="pe-text-button" disabled={disabled || index === overlays.length - 1} onClick={() => apply(reorderOverlays(overlays, index, 1))}>Bring forward</button>
            <button type="button" className="pe-text-button" disabled={disabled || index === 0} onClick={() => apply(reorderOverlays(overlays, index, -1))}>Send backward</button>
            <button
              type="button"
              className="pe-text-button"
              disabled={disabled || overlays.length >= TEXT_LIMITS.objects}
              onClick={() => {
                const copy = duplicateOverlay(selected, newTextId());
                apply([...overlays, copy]);
                onSelect(copy.id);
              }}
            >
              Duplicate
            </button>
            <button type="button" className="pe-text-button pe-text-button--danger" disabled={disabled} onClick={() => remove(selected.id)}>Delete</button>
          </div>
          <label className="pe-field">
            <span>Text</span>
            <textarea
              ref={textareaRef}
              rows={3}
              value={selected.text}
              disabled={disabled}
              spellCheck={false}
              onChange={(event) => apply(withSelected({ text: cleanText(event.target.value) }), `text:${selectedId}:text`)}
            />
          </label>
          {missing.length > 0 && (
            <p className="pe-note pe-note--warning">
              {font.label} has no glyphs for {missing.slice(0, 8).join(' ')}{missing.length > 8 ? ' …' : ''}: they are drawn with a system font, which can differ between devices.
            </p>
          )}
          <div className="pe-textpanel__row">
            <label className="pe-field">
              <span>Font</span>
              <select value={selected.font} disabled={disabled} onChange={(event) => apply(withSelected({ font: event.target.value }))}>
                {TEXT_FONTS.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <label className="pe-field pe-field--check">
              <input type="checkbox" checked={selected.weight >= 700} disabled={disabled} onChange={(event) => apply(withSelected({ weight: event.target.checked ? 700 : 400 }))} />
              <span>Bold</span>
            </label>
            <label className="pe-field pe-field--check">
              <input type="checkbox" checked={selected.italic} disabled={disabled || !font.italic} onChange={(event) => apply(withSelected({ italic: event.target.checked }))} />
              <span>Italic</span>
            </label>
          </div>
          <fieldset className="pe-segmented" disabled={disabled}>
            <legend className="visually-hidden">Alignment</legend>
            {TEXT_ALIGNS.map((align) => (
              <label key={align} className="pe-segmented__option">
                <input type="radio" name={`pe-align-${selected.id}`} value={align} checked={selected.align === align} onChange={() => apply(withSelected({ align }))} />
                <span>{align[0].toUpperCase() + align.slice(1)}</span>
              </label>
            ))}
          </fieldset>
          <TextRange label="Size" unit="% of short edge" value={selected.size} min={TEXT_LIMITS.size[0] * 100} max={TEXT_LIMITS.size[1] * 100} step={0.1} toShown={(v) => v * 100} fromShown={(v) => v / 100} {...field('size')} />
          <div className="pe-textpanel__row">
            <label className="pe-field">
              <span>Color</span>
              <input type="color" value={selected.color} disabled={disabled} onChange={(event) => apply(withSelected({ color: event.target.value }), `text:${selectedId}:color`)} />
            </label>
          </div>
          <TextRange label="Opacity" unit="%" value={selected.opacity} min={0} max={100} step={1} toShown={(v) => v * 100} fromShown={(v) => v / 100} {...field('opacity')} />
          <TextRange label="Horizontal position" unit="%" value={selected.x} min={0} max={100} step={0.1} toShown={(v) => v * 100} fromShown={(v) => v / 100} {...field('x')} />
          <TextRange label="Vertical position" unit="%" value={selected.y} min={0} max={100} step={0.1} toShown={(v) => v * 100} fromShown={(v) => v / 100} {...field('y')} />
          <TextRange label="Rotation" unit="°" value={selected.rotation} min={-180} max={180} step={1} {...field('rotation')} />
          <TextRange label="Scale" unit="%" value={selected.scale} min={TEXT_LIMITS.scale[0] * 100} max={TEXT_LIMITS.scale[1] * 100} step={1} toShown={(v) => v * 100} fromShown={(v) => v / 100} {...field('scale')} />
          <label className="pe-field pe-field--check">
            <input type="checkbox" checked={Boolean(selected.outline)} disabled={disabled} onChange={(event) => apply(withSelected({ outline: event.target.checked ? DEFAULT_OUTLINE : null }))} />
            <span>Outline</span>
          </label>
          {selected.outline && (
            <>
              <TextRange label="Outline width" unit="% of font size" value={selected.outline.width} min={TEXT_LIMITS.outline[0] * 100} max={TEXT_LIMITS.outline[1] * 100} step={1} toShown={(v) => v * 100} fromShown={(v) => v / 100} {...nested('outline', 'width')} />
              <label className="pe-field">
                <span>Outline color</span>
                <input type="color" value={selected.outline.color} disabled={disabled} onChange={(event) => apply(withSelected({ outline: { ...selected.outline, color: event.target.value } }), `text:${selectedId}:outline.color`)} />
              </label>
            </>
          )}
          <label className="pe-field pe-field--check">
            <input type="checkbox" checked={Boolean(selected.shadow)} disabled={disabled} onChange={(event) => apply(withSelected({ shadow: event.target.checked ? DEFAULT_SHADOW : null }))} />
            <span>Shadow</span>
          </label>
          {selected.shadow && (
            <>
              <label className="pe-field">
                <span>Shadow color</span>
                <input type="color" value={selected.shadow.color} disabled={disabled} onChange={(event) => apply(withSelected({ shadow: { ...selected.shadow, color: event.target.value } }), `text:${selectedId}:shadow.color`)} />
              </label>
              <TextRange label="Shadow opacity" unit="%" value={selected.shadow.opacity} min={0} max={100} step={1} toShown={(v) => v * 100} fromShown={(v) => v / 100} {...nested('shadow', 'opacity')} />
              <TextRange label="Shadow blur" unit="% of font size" value={selected.shadow.blur} min={0} max={100} step={1} toShown={(v) => v * 100} fromShown={(v) => v / 100} {...nested('shadow', 'blur')} />
              <TextRange label="Shadow distance" unit="% of font size" value={selected.shadow.distance} min={0} max={100} step={1} toShown={(v) => v * 100} fromShown={(v) => v / 100} {...nested('shadow', 'distance')} />
              <TextRange label="Shadow angle" unit="°" value={selected.shadow.angle} min={-180} max={180} step={1} {...nested('shadow', 'angle')} />
            </>
          )}
        </div>
      )}
      <p className="pe-note">
        Text is drawn over the finished photo and stays editable; positions and sizes follow the cropped frame, so text keeps its place at any export size. Fonts: Schibsted Grotesk and Martian Mono (SIL Open Font License), bundled with the editor.
        {editing ? ' Drag text to move it; use the corner handle to resize and the round handle to rotate. Arrow keys move the selected text, Delete removes it.' : ''}
      </p>
    </div>
  );
}
