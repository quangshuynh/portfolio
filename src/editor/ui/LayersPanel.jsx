import React, { useEffect, useId, useRef, useState } from 'react';
import { RAW_FORMATS } from '../raw/rawFormat.mjs';
import { RAW_PROFILE_CHOICES, profileChoiceOf } from '../raw/rawProfiles.mjs';
import {
  BLEND_MODES, LAYER_LIMITS, canAddLayer, cleanName, duplicateLayer, layerLabel, moveLayer, removeLayer, resetImageTransform,
  TEXT_RESET, updateLayer,
} from '../model/layers.mjs';

let sequence = 0;
/** A new layer id: unique in this session and valid in documents. */
export const newLayerId = (prefix = 'layer') => `${prefix}-${Date.now().toString(36)}-${(sequence += 1).toString(36)}`;

const TYPE_LABEL = { image: 'Image', text: 'Text', adjustment: 'Adjustment' };

function LayerIcon({ layer, thumbnail }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !thumbnail) return;
    canvas.width = thumbnail.width;
    canvas.height = thumbnail.height;
    canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(thumbnail.data), thumbnail.width, thumbnail.height), 0, 0);
  }, [thumbnail]);
  if (layer.type === 'image' && thumbnail) return <canvas ref={ref} className="pe-layer__thumb" aria-hidden="true" />;
  return (
    <span className="pe-layer__thumb pe-layer__thumb--icon" data-type={layer.type} aria-hidden="true">
      {layer.type === 'text' ? 'T' : layer.type === 'adjustment'
        ? <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" /></svg>
        : <svg viewBox="0 0 16 16"><rect x="2.5" y="3.5" width="11" height="9" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M3 11l3.5-3.5 2.5 2.5 2-2 2 2" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>}
    </span>
  );
}

/** A labelled number field that applies on change (one undo step per edit, coalesced per field). */
export function NumberField({ label, value, min, max, step, unit, disabled, onApply, digits = 1 }) {
  const id = useId();
  return (
    <label className="pe-field pe-field--number" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="number"
        className="mono"
        min={min}
        max={max}
        step={step}
        value={Number(value.toFixed(digits))}
        disabled={disabled}
        aria-label={`${label}${unit ? ` (${unit})` : ''}`}
        onChange={(event) => {
          const number = Number.parseFloat(event.target.value);
          if (Number.isFinite(number)) onApply(Math.min(max, Math.max(min, number)));
        }}
      />
    </label>
  );
}

/**
 * The Layers panel: the stack (top first) above the Background (the photo with its own edits),
 * add, select, rename, reorder (drag the grip, or Move up/down; Alt+↑/↓ on a focused row), hide,
 * lock, opacity, blend mode, duplicate, delete (confirmed) and the selected layer's transform.
 * Every change is an ordinary undo step; deleting a layer never touches its source file.
 * :param layers: the active photo's layer stack (bottom first)
 * :param sources: { missing(layer) → message or null, thumbnail(layer) → RGBA image or null,
 *   workspace: [{ id, name }] photos that can be added as layers, onAddPhoto(id), onImport(),
 *   onReconnect(layer), busy }
 */
export default function LayersPanel({ compact = false, onClose, layers, activeId, disabled, canvas, sources, onSelect, onApply, onPreview, onCommit, onAddText, onAddAdjustment, onEditSettings, tool, onTool, freeResize, onFreeResize }) {
  const [open, setOpen] = useState(true);
  const [confirming, setConfirming] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [drag, setDrag] = useState(null);
  const listRef = useRef(null);
  const bodyId = useId();
  const active = layers.find(({ id }) => id === activeId) ?? null;
  const index = active ? layers.indexOf(active) : -1;
  const locked = Boolean(active?.locked);
  const top = [...layers].reverse();

  useEffect(() => { setConfirming(null); setRenaming(null); }, [activeId]);

  const patch = (id, values, coalesceKey = null) => onApply(updateLayer(layers, id, values), coalesceKey);
  const move = (id, to) => onApply(moveLayer(layers, id, to));

  // Pointer reorder on the grip (mouse, pen and touch alike): the row under the pointer is the drop target.
  const rowAt = (clientY) => {
    const rows = [...(listRef.current?.querySelectorAll('[data-layer-row]') ?? [])];
    const hit = rows.findIndex((row) => clientY < row.getBoundingClientRect().bottom);
    const position = hit === -1 ? rows.length - 1 : hit;
    return layers.length - 1 - position;
  };
  const gripDown = (event, layer) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* synthetic pointer */ }
    setDrag({ id: layer.id, pointer: event.pointerId, to: layers.indexOf(layer) });
  };
  const gripMove = (event) => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const to = rowAt(event.clientY);
    if (to !== drag.to) setDrag({ ...drag, to });
  };
  const gripUp = (event) => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const to = event.type === 'pointerup' ? rowAt(event.clientY) : drag.to;
    setDrag(null);
    if (event.type === 'pointerup' && to !== layers.findIndex(({ id }) => id === drag.id)) move(drag.id, to);
  };
  const rowKey = (event, layer) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const at = layers.indexOf(layer);
    move(layer.id, at + (event.key === 'ArrowUp' ? 1 : -1));
  };

  const missing = active?.type === 'image' ? sources.missing(active) : null;
  const short = canvas ? Math.min(canvas.width, canvas.height) : 1;

  return (
    <section className="pe-panel pe-layers" aria-labelledby="pe-layers-title" data-open={open || compact || undefined}>
      <div className="pe-panel__head">
        <h2 id="pe-layers-title">
          <button type="button" className="pe-section__toggle" aria-expanded={open || compact} aria-controls={bodyId} onClick={() => compact ? onClose?.() : setOpen((value) => !value)}>
            <svg className="pe-section__chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span>Layers</span> <span className="pe-count mono">{layers.length}</span>
          </button>
        </h2>
        <button type="button" className="pe-text-button" aria-pressed={tool} disabled={disabled} onClick={() => onTool(!tool)} title="Move, resize and rotate image and text layers on the photo (T)">
          {tool ? 'Done' : 'Move'}
        </button>
      </div>
      <div id={bodyId} hidden={!open && !compact}>
        <div className="pe-layers__add" role="group" aria-label="Add layer">
          <button type="button" className="pe-button" disabled={disabled || sources.busy || !canAddLayer(layers, 'image')} onClick={sources.onImport}>Image file…</button>
          <label className="pe-layers__photo">
            <span className="visually-hidden">Add a workspace photo as a layer</span>
            <select
              value=""
              disabled={disabled || !sources.workspace.length || !canAddLayer(layers, 'image')}
              onChange={(event) => { if (event.target.value) sources.onAddPhoto(event.target.value); }}
            >
              <option value="">Photo…</option>
              {sources.workspace.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <button type="button" className="pe-button" disabled={disabled || !canAddLayer(layers, 'text')} onClick={onAddText}>Text</button>
          <button type="button" className="pe-button" disabled={disabled || !canAddLayer(layers, 'adjustment')} onClick={onAddAdjustment}>Adjustment</button>
        </div>
        {sources.message && <p className="pe-note" role="status">{sources.message}</p>}
        <ol className="pe-layers__list" ref={listRef} aria-label="Layers, top first">
          {top.map((layer) => {
            const selected = layer.id === activeId;
            const label = layerLabel(layer);
            const at = layers.indexOf(layer);
            const target = drag && drag.to === at && drag.id !== layer.id;
            return (
              <li
                key={layer.id}
                className="pe-layer"
                data-layer-row
                data-type={layer.type}
                data-selected={selected || undefined}
                data-hidden={!layer.visible || undefined}
                data-drop={target ? (drag.to > layers.findIndex(({ id }) => id === drag.id) ? 'above' : 'below') : undefined}
                data-dragging={drag?.id === layer.id || undefined}
              >
                <button
                  type="button"
                  className="pe-layer__grip"
                  aria-label={`Reorder ${label}: drag, or use Move up and Move down`}
                  title="Drag to reorder"
                  disabled={disabled}
                  onPointerDown={(event) => gripDown(event, layer)}
                  onPointerMove={gripMove}
                  onPointerUp={gripUp}
                  onPointerCancel={gripUp}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
                </button>
                <LayerIcon layer={layer} thumbnail={sources.thumbnail(layer)} />
                {renaming === layer.id ? (
                  <input
                    className="pe-layer__rename"
                    aria-label={`Name of ${label}`}
                    defaultValue={layer.name || label}
                    maxLength={LAYER_LIMITS.name}
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                    onBlur={(event) => { patch(layer.id, { name: cleanName(event.target.value) }); setRenaming(null); }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                      if (event.key === 'Escape') { event.stopPropagation(); setRenaming(null); }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="pe-layer__name"
                    aria-pressed={selected}
                    aria-label={`${label}, ${TYPE_LABEL[layer.type]} layer${layer.visible ? '' : ', hidden'}${layer.locked ? ', locked' : ''}${sources.missing(layer) ? ', source missing' : ''}`}
                    disabled={disabled}
                    onClick={() => onSelect(layer.id)}
                    onDoubleClick={() => setRenaming(layer.id)}
                    onKeyDown={(event) => { rowKey(event, layer); if (event.key === 'F2') setRenaming(layer.id); }}
                  >
                    <span className="pe-layer__label">{label}</span>
                    <span className="pe-layer__meta">
                      {TYPE_LABEL[layer.type]}
                      {layer.blend !== 'normal' ? ` · ${BLEND_MODES.find(({ id }) => id === layer.blend).label}` : ''}
                      {layer.opacity < 1 ? ` · ${Math.round(layer.opacity * 100)}%` : ''}
                      {sources.missing(layer) ? ' · missing' : ''}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  className="pe-icon-button pe-layer__toggle"
                  aria-pressed={!layer.visible}
                  aria-label={`${layer.visible ? 'Hide' : 'Show'} ${label}`}
                  title={layer.visible ? 'Hide layer' : 'Show layer'}
                  disabled={disabled}
                  onClick={() => patch(layer.id, { visible: !layer.visible })}
                >
                  {layer.visible
                    ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" fill="none" stroke="currentColor" strokeWidth="1.3" /><circle cx="8" cy="8" r="2" fill="currentColor" /></svg>
                    : <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2l12 12M6.2 4c.6-.3 1.2-.5 1.8-.5 4 0 6.5 4.5 6.5 4.5s-.7 1.3-2 2.5M4 5.5C2.4 6.7 1.5 8 1.5 8S4 12.5 8 12.5c1 0 1.9-.3 2.7-.7" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>}
                </button>
                <button
                  type="button"
                  className="pe-icon-button pe-layer__toggle"
                  aria-pressed={layer.locked}
                  aria-label={`${layer.locked ? 'Unlock' : 'Lock'} ${label}`}
                  title={layer.locked ? 'Unlock layer' : 'Lock layer (keeps its content, position, opacity and blend mode)'}
                  disabled={disabled}
                  onClick={() => patch(layer.id, { locked: !layer.locked })}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <rect x="3.5" y="7" width="9" height="6.5" rx="1" fill={layer.locked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" />
                    <path d={layer.locked ? 'M5.5 7V5a2.5 2.5 0 0 1 5 0v2' : 'M5.5 7V5a2.5 2.5 0 0 1 5 0'} fill="none" stroke="currentColor" strokeWidth="1.3" />
                  </svg>
                </button>
              </li>
            );
          })}
          <li className="pe-layer pe-layer--background" data-selected={!active || undefined}>
            <span className="pe-layer__grip" aria-hidden="true" />
            <span className="pe-layer__thumb pe-layer__thumb--icon" data-type="background" aria-hidden="true">
              <svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1" fill="currentColor" opacity="0.5" /></svg>
            </span>
            <button type="button" className="pe-layer__name" aria-pressed={!active} disabled={disabled} onClick={() => onSelect(null)} aria-label="Background: the photo with its own edits">
              <span className="pe-layer__label">Background</span>
              <span className="pe-layer__meta">Photo · defines the canvas</span>
            </button>
          </li>
        </ol>
        {active && (
          <div className="pe-layers__props" role="group" aria-label={`Layer “${layerLabel(active)}”`}>
            {locked && <p className="pe-note" role="status">Locked: unlock it to change its content, position, opacity or blend mode.</p>}
            {missing && (
              <div className="pe-note pe-note--warning" role="alert">
                <span>{missing}</span>{' '}
                <button type="button" className="pe-text-button" disabled={disabled} onClick={() => sources.onReconnect(active)}>Reconnect file…</button>
              </div>
            )}
            <label className="pe-field">
              <span>Blend mode</span>
              <select value={active.blend} disabled={disabled || locked} onChange={(event) => patch(active.id, { blend: event.target.value })}>
                {BLEND_MODES.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <OpacityRange
              value={active.opacity}
              disabled={disabled || locked}
              onPreview={(value) => onPreview(updateLayer(layers, active.id, { opacity: value }))}
              onApply={(value) => patch(active.id, { opacity: value }, `layer:${active.id}:opacity`)}
              onCommit={onCommit}
            />
            {active.type === 'image' && Object.hasOwn(RAW_FORMATS, active.source.format) && (
              <label className="pe-field">
                <span>RAW profile</span>
                <select
                  value={profileChoiceOf(active.rawProfile?.profile ?? 'legacy', active.rawProfile?.profileVersion).value}
                  disabled={disabled || locked}
                  onChange={(event) => {
                    const next = RAW_PROFILE_CHOICES.find((entry) => entry.value === event.target.value);
                    patch(active.id, { rawProfile: next.profile === 'legacy' ? null : { profile: next.profile, profileVersion: next.version } });
                  }}
                >
                  {RAW_PROFILE_CHOICES.filter((entry) => !entry.superseded || entry === profileChoiceOf(active.rawProfile?.profile ?? 'legacy', active.rawProfile?.profileVersion)).map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            )}
            {active.type === 'image' && (
              <div className="pe-layers__transform" role="group" aria-label="Transform">
                <NumberField label="X" unit="% of width" value={active.x * 100} min={-100} max={200} step={0.5} disabled={disabled || locked} onApply={(v) => patch(active.id, { x: v / 100 }, `layer:${active.id}:x`)} />
                <NumberField label="Y" unit="% of height" value={active.y * 100} min={-100} max={200} step={0.5} disabled={disabled || locked} onApply={(v) => patch(active.id, { y: v / 100 }, `layer:${active.id}:y`)} />
                <NumberField
                  label="W"
                  unit="px"
                  digits={0}
                  value={active.width * short}
                  min={1}
                  max={LAYER_LIMITS.size[1] * short}
                  step={1}
                  disabled={disabled || locked}
                  onApply={(v) => patch(active.id, freeResize ? { width: v / short } : { width: v / short, height: (active.height * v) / (active.width * short) }, `layer:${active.id}:w`)}
                />
                <NumberField
                  label="H"
                  unit="px"
                  digits={0}
                  value={active.height * short}
                  min={1}
                  max={LAYER_LIMITS.size[1] * short}
                  step={1}
                  disabled={disabled || locked}
                  onApply={(v) => patch(active.id, freeResize ? { height: v / short } : { height: v / short, width: (active.width * v) / (active.height * short) }, `layer:${active.id}:h`)}
                />
                <NumberField label="Angle" unit="degrees" value={active.rotation} min={-180} max={180} step={0.5} disabled={disabled || locked} onApply={(v) => patch(active.id, { rotation: v }, `layer:${active.id}:rotation`)} />
                <label className="pe-field pe-field--check">
                  <input type="checkbox" checked={freeResize} disabled={disabled} onChange={(event) => onFreeResize(event.target.checked)} />
                  <span>Free resize</span>
                </label>
              </div>
            )}
            {(active.type === 'image' || active.type === 'text') && (
              <div className="pe-layers__actions">
                <button type="button" className="pe-text-button" aria-pressed={active.flipH} disabled={disabled || locked} onClick={() => patch(active.id, { flipH: !active.flipH })}>Flip horizontal</button>
                <button type="button" className="pe-text-button" aria-pressed={active.flipV} disabled={disabled || locked} onClick={() => patch(active.id, { flipV: !active.flipV })}>Flip vertical</button>
                <button
                  type="button"
                  className="pe-text-button"
                  disabled={disabled || locked}
                  onClick={() => patch(active.id, active.type === 'image' ? resetImageTransform(active, canvas) : TEXT_RESET)}
                >
                  Reset transform
                </button>
              </div>
            )}
            {active.type !== 'text' && (
              <button type="button" className="pe-text-button" disabled={disabled} onClick={onEditSettings}>
                {active.type === 'adjustment' ? 'Edit adjustment settings' : 'Edit layer colour'}
              </button>
            )}
            <div className="pe-layers__actions">
              <button type="button" className="pe-text-button" disabled={disabled || index === layers.length - 1} onClick={() => move(active.id, index + 1)}>Move up</button>
              <button type="button" className="pe-text-button" disabled={disabled || index === 0} onClick={() => move(active.id, index - 1)}>Move down</button>
              <button
                type="button"
                className="pe-text-button"
                disabled={disabled || !canAddLayer(layers, active.type)}
                onClick={() => {
                  const id = newLayerId(active.type);
                  onApply(duplicateLayer(layers, active.id, id));
                  onSelect(id);
                }}
              >
                Duplicate
              </button>
              {confirming === active.id ? (
                <span className="pe-layers__confirm" role="group" aria-label="Confirm delete">
                  <button
                    type="button"
                    className="pe-text-button pe-text-button--danger"
                    onClick={() => { onApply(removeLayer(layers, active.id)); onSelect(null); setConfirming(null); }}
                  >
                    Delete layer
                  </button>
                  <button type="button" className="pe-text-button" onClick={() => setConfirming(null)}>Keep</button>
                </span>
              ) : (
                <button type="button" className="pe-text-button pe-text-button--danger" disabled={disabled || locked} onClick={() => setConfirming(active.id)}>Delete…</button>
              )}
            </div>
            {active.type === 'image' && <p className="pe-note">Deleting a layer removes it from this photo only; its file is never changed.</p>}
          </div>
        )}
        {tool && <p className="pe-note">Drag an image or text layer on the photo to move it; the corner handle resizes (Shift or Free resize: unconstrained), the round handle rotates. Arrow keys move the selected layer.</p>}
      </div>
    </section>
  );
}

export function OpacityRange({ value, disabled, onPreview, onApply, onCommit, label = 'Opacity' }) {
  const id = useId();
  const dragging = useRef(false);
  const shown = Math.round(value * 100);
  useEffect(() => {
    const end = () => { if (dragging.current) { dragging.current = false; onCommit(); } };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => { window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); };
  }, [onCommit]);
  return (
    <div className="pe-adjust">
      <div className="pe-adjust__head">
        <label htmlFor={id}>{label}</label>
        <input
          className="pe-adjust__value mono"
          type="number"
          aria-label={`${label} value (%)`}
          min={0}
          max={100}
          step={1}
          value={shown}
          disabled={disabled}
          onChange={(event) => {
            const number = Number.parseFloat(event.target.value);
            if (Number.isFinite(number)) onApply(Math.min(100, Math.max(0, number)) / 100);
          }}
        />
      </div>
      <input
        id={id}
        className="pe-range"
        type="range"
        min={0}
        max={100}
        step={1}
        value={shown}
        disabled={disabled}
        aria-valuetext={`${shown}%`}
        style={{ '--fill-from': '0%', '--fill-to': `${shown}%` }}
        onPointerDown={() => { dragging.current = true; }}
        onInput={(event) => {
          const next = Number(event.target.value) / 100;
          if (dragging.current) onPreview(next);
          else onApply(next);
        }}
        onChange={() => {}}
      />
    </div>
  );
}
