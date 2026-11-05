import React, { useEffect, useId, useRef, useState } from 'react';
import { RAW_FORMATS } from '../raw/rawFormat.mjs';
import { RAW_PROFILE_CHOICES, profileChoiceOf } from '../raw/rawProfiles.mjs';
import {
  BLEND_MODES, LAYER_LIMITS, PASS_THROUGH, canAddLayer, cleanName, createGroupLayer, layerLabel, resetImageTransform,
  TEXT_RESET, updateLayer,
} from '../model/layers.mjs';
import {
  ancestors, canClip, canClipAbove, canMoveUnit, clipBase, descendantIds, dropUnit, duplicateUnit, groupTargets, groupUnits, insertAbove,
  moveIntoGroup, moveUnit, removeBlocked, removeUnit, setClip, shownInTree, ungroup,
} from '../model/layerTree.mjs';

let sequence = 0;
/** A new layer id: unique in this session and valid in documents. */
export const newLayerId = (prefix = 'layer') => `${prefix}-${Date.now().toString(36)}-${(sequence += 1).toString(36)}`;

const TYPE_LABEL = { image: 'Image', text: 'Text', adjustment: 'Adjustment', group: 'Group' };
const GROUP_MODES = [{ id: PASS_THROUGH, label: 'Pass through' }, ...BLEND_MODES];
const modeLabel = (id) => GROUP_MODES.find((mode) => mode.id === id)?.label ?? id;
// Ctrl on Windows and Linux, Cmd on macOS and iOS keyboards.
const command = (event) => event.ctrlKey || event.metaKey;

/** A layer mask's coverage as a small greyscale thumbnail (white shows the layer). */
function MaskThumb({ thumbnail }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !thumbnail) return;
    canvas.width = thumbnail.width;
    canvas.height = thumbnail.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    const image = context.createImageData(thumbnail.width, thumbnail.height);
    thumbnail.data.forEach((v, i) => image.data.set([v, v, v, 255], i * 4));
    context.putImageData(image, 0, 0);
  }, [thumbnail]);
  return thumbnail ? <canvas ref={ref} className="pe-layer__mask" aria-hidden="true" /> : <span className="pe-layer__mask" aria-hidden="true" />;
}

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
      {layer.type === 'group' ? <svg viewBox="0 0 16 16"><path d="M1.8 4.2h4.4l1.4 1.5h6.6v6.6H1.8z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg> : layer.type === 'text' ? 'T' : layer.type === 'adjustment'
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
 * The Layers panel: the stack (top first, groups as an indented tree) above the Background (the
 * photo with its own edits): add, select, rename, reorder (drag the grip onto a row, Move up/down,
 * or Alt+↑/↓ on a focused row: whole units move, a group with its contents and a base with the
 * layers clipped to it), group (Ctrl/Cmd+G), ungroup (Ctrl/Cmd+Shift+G), clip to the layer below
 * (Ctrl/Cmd+Alt+G), collapse and expand groups (←/→ on a group row), hide, lock, opacity, blend
 * mode, duplicate, delete (confirmed) and the selected layer's transform. Every change is an
 * ordinary undo step; deleting a layer never touches its source file.
 * :param layers: the active photo's layer stack (bottom first)
 * :param sources: { missing(layer) → message or null, thumbnail(layer) → RGBA image or null,
 *   maskThumbnail(layer) → { width, height, data (one code per pixel) } or null,
 *   selections: [{ id, label, component }] saved selections that can start an adjustment's mask,
 *   workspace: [{ id, name }] photos that can be added as layers, onAddPhoto(id), onImport(),
 *   onReconnect(layer), busy }
 * :param onAddAdjustment: ({ clip, mask, name }) adds an adjustment layer above the selected one
 * :param onEditMask: (layer) opens its mask for editing (Masks panel)
 * :param selection: useSelections() or null; `onMaskFromSelection(layer, kind)` masks an image
 *   layer with Select Subject, Sky, Background (replacing its mask) or starts Select Object on it
 */
export default function LayersPanel({ compact = false, onClose, layers, activeId, disabled, canvas, sources, onSelect, onApply, onPreview, onCommit, onAddText, onAddAdjustment, onEditSettings, onEditMask = () => {}, maskEditing = null, tool, onTool, freeResize, onFreeResize, selection = null, onMaskFromSelection = null }) {
  const [open, setOpen] = useState(true);
  const [confirming, setConfirming] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [drag, setDrag] = useState(null);
  // Collapsed groups: a view setting of this session, not an edit (no undo step).
  const [collapsed, setCollapsed] = useState(() => new Set());
  const listRef = useRef(null);
  const bodyId = useId();
  const active = layers.find(({ id }) => id === activeId) ?? null;
  const locked = Boolean(active?.locked);
  // Rows top first: a group's row, then its children (the list keeps them directly below it).
  const top = [...layers].reverse().filter((layer) => !ancestors(layers, layer.id).some((group) => collapsed.has(group.id)));

  useEffect(() => { setConfirming(null); setRenaming(null); }, [activeId]);
  // A selected layer inside a collapsed group opens it.
  useEffect(() => {
    if (!activeId) return;
    const closed = ancestors(layers, activeId).filter((group) => collapsed.has(group.id));
    if (closed.length) setCollapsed((set) => new Set([...set].filter((id) => !closed.some((group) => group.id === id))));
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (id, values, coalesceKey = null) => onApply(updateLayer(layers, id, values), coalesceKey);
  const apply = (next) => { if (next !== layers) onApply(next); };
  const toggleCollapsed = (id, value = !collapsed.has(id)) => setCollapsed((set) => { const next = new Set(set); if (value) next.add(id); else next.delete(id); return next; });
  const group = (id) => {
    const groupId = newLayerId('group');
    const next = groupUnits(layers, [id], groupId);
    if (next !== layers) { onApply(next); onSelect(groupId); }
  };
  const toggleClip = (layer) => apply(setClip(layers, layer.id, !layer.clip));

  // Pointer reorder on the grip (mouse, pen and touch alike): the row under the pointer is the
  // target; its upper half drops above it, its lower half below (as siblings, layerTree.dropUnit).
  const rowAt = (clientY) => {
    const rows = [...(listRef.current?.querySelectorAll('[data-layer-row]') ?? [])];
    if (!rows.length) return null;
    const hit = rows.findIndex((row) => clientY < row.getBoundingClientRect().bottom);
    const row = rows[hit === -1 ? rows.length - 1 : hit];
    const box = row.getBoundingClientRect();
    return { target: row.dataset.layerRow, where: hit === -1 || clientY >= box.top + box.height / 2 ? 'below' : 'above' };
  };
  const gripDown = (event, layer) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* synthetic pointer */ }
    setDrag({ id: layer.id, pointer: event.pointerId, target: null, where: null });
  };
  const gripMove = (event) => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const at = rowAt(event.clientY);
    if (at && (at.target !== drag.target || at.where !== drag.where)) setDrag({ ...drag, ...at });
  };
  const gripUp = (event) => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const at = event.type === 'pointerup' ? rowAt(event.clientY) : null;
    setDrag(null);
    if (at && at.target !== drag.id) apply(dropUnit(layers, drag.id, at.target, at.where));
  };
  const rowKey = (event, layer) => {
    const key = event.key.toLowerCase();
    if (event.altKey && !command(event) && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      apply(moveUnit(layers, layer.id, event.key === 'ArrowUp' ? 1 : -1));
    } else if (command(event) && key === 'g') {
      event.preventDefault();
      event.stopPropagation();
      if (event.altKey) { if (!layer.locked) toggleClip(layer); } else if (event.shiftKey) { if (layer.type === 'group') apply(ungroup(layers, layer.id)); } else group(layer.id);
    } else if (layer.type === 'group' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      // Tree convention: ← collapses, → expands (instead of switching photos).
      event.preventDefault();
      event.stopPropagation();
      toggleCollapsed(layer.id, event.key === 'ArrowLeft');
    }
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
          <button type="button" className="pe-button" disabled={disabled || !canAddLayer(layers, 'adjustment')} onClick={() => onAddAdjustment({})}>Adjustment</button>
          <button
            type="button"
            className="pe-button"
            title="Group the selected layer (Ctrl/Cmd+G), or add an empty group"
            disabled={disabled || !canAddLayer(layers, 'group')}
            onClick={() => {
              if (active) { group(active.id); return; }
              const id = newLayerId('group');
              apply(insertAbove(layers, createGroupLayer(id), null));
              onSelect(id);
            }}
          >
            Group
          </button>
          {sources.selections?.length > 0 && (
            <label className="pe-layers__photo">
              <span className="visually-hidden">Add an adjustment layer masked by a saved selection</span>
              <select
                value=""
                disabled={disabled || !canAddLayer(layers, 'adjustment')}
                onChange={(event) => {
                  const chosen = sources.selections.find(({ id }) => id === event.target.value);
                  if (chosen) onAddAdjustment({ mask: chosen.mask, name: chosen.name, clip: false });
                }}
              >
                <option value="">From selection…</option>
                {sources.selections.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
          )}
        </div>
        {sources.message && <p className="pe-note" role="status">{sources.message}</p>}
        <ol className="pe-layers__list" ref={listRef} aria-label="Layers, top first">
          {top.map((layer) => {
            const selected = layer.id === activeId;
            const label = layerLabel(layer);
            const target = drag && drag.target === layer.id && drag.id !== layer.id;
            const depth = ancestors(layers, layer.id).length;
            const base = layer.clip ? clipBase(layers, layer.id) : null;
            const isGroup = layer.type === 'group';
            const expanded = isGroup && !collapsed.has(layer.id);
            const shown = shownInTree(layers, layer.id) && (!base || base.visible);
            const inside = isGroup ? descendantIds(layers, layer.id).size : 0;
            return (
              <li
                key={layer.id}
                className="pe-layer"
                data-layer-row={layer.id}
                data-type={layer.type}
                data-selected={selected || undefined}
                data-hidden={!shown || undefined}
                data-clip={layer.clip || undefined}
                data-drop={target ? drag.where : undefined}
                data-dragging={drag?.id === layer.id || undefined}
                style={depth ? { '--pe-depth': depth } : undefined}
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
                <span className="pe-layer__icons">
                  {layer.clip && <svg className="pe-layer__clip" viewBox="0 0 12 16" aria-hidden="true"><path d="M3 2v8.5h6M6.5 8l2.5 2.5L6.5 13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                  {isGroup ? (
                    <button
                      type="button"
                      className="pe-layer__expand"
                      aria-expanded={expanded}
                      aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
                      title={expanded ? 'Collapse group (←)' : 'Expand group (→)'}
                      onClick={() => toggleCollapsed(layer.id)}
                    >
                      <svg className="pe-section__chevron" viewBox="0 0 16 16" aria-hidden="true" style={expanded ? { transform: 'rotate(90deg)' } : undefined}><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      <LayerIcon layer={layer} thumbnail={null} />
                    </button>
                  ) : <LayerIcon layer={layer} thumbnail={sources.thumbnail(layer)} />}
                  {layer.mask && (
                    <button
                      type="button"
                      className="pe-layer__mask-button"
                      aria-pressed={maskEditing === layer.id}
                      aria-label={`Edit the mask of ${label}${layer.mask.enabled ? '' : ' (disabled)'}`}
                      title="Edit layer mask"
                      disabled={disabled}
                      data-disabled-mask={!layer.mask.enabled || undefined}
                      onClick={() => onEditMask(layer)}
                    >
                      <MaskThumb thumbnail={sources.maskThumbnail?.(layer) ?? null} />
                    </button>
                  )}
                </span>
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
                    aria-label={`${label}, ${TYPE_LABEL[layer.type]} layer${base ? `, clipped to ${layerLabel(base)}` : ''}${isGroup ? `, ${inside} inside${expanded ? '' : ', collapsed'}` : ''}${layer.visible ? '' : ', hidden'}${layer.locked ? ', locked' : ''}${sources.missing(layer) ? ', source missing' : ''}`}
                    disabled={disabled}
                    onClick={() => onSelect(layer.id)}
                    onDoubleClick={() => setRenaming(layer.id)}
                    onKeyDown={(event) => { rowKey(event, layer); if (event.key === 'F2') setRenaming(layer.id); }}
                  >
                    <span className="pe-layer__label">{label}</span>
                    <span className="pe-layer__meta">
                      {base ? `Clipped to ${layerLabel(base)}` : TYPE_LABEL[layer.type]}
                      {isGroup ? ` · ${inside}` : ''}
                      {layer.blend !== 'normal' && layer.blend !== PASS_THROUGH ? ` · ${modeLabel(layer.blend)}` : ''}
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
                {(active.type === 'group' ? GROUP_MODES : BLEND_MODES).map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            {active.type === 'group' && (
              <p className="pe-note">
                {active.blend === PASS_THROUGH
                  ? 'Pass through: the layers inside act on everything below, as if not grouped; opacity and mask fade the result.'
                  : 'Isolated: the layers inside are combined first (adjustments inside change only them), then blended as one.'}
              </p>
            )}
            {active.type !== 'group' && (
              <label className="pe-field pe-field--check" title="Clip to the layer below (Ctrl/Cmd+Alt+G): show only where it shows">
                <input type="checkbox" checked={Boolean(active.clip)} disabled={disabled || locked || (!active.clip && !canClip(layers, active.id))} onChange={() => toggleClip(active)} />
                <span>Clip to layer below{active.clip ? ` (${layerLabel(clipBase(layers, active.id))})` : ''}</span>
              </label>
            )}
            {!active.clip && (groupTargets(layers, active.id).length > 0 || active.parent) && (
              <label className="pe-field">
                <span>In group</span>
                <select
                  value={active.parent ?? ''}
                  disabled={disabled}
                  onChange={(event) => apply(moveIntoGroup(layers, active.id, event.target.value || null))}
                >
                  <option value="">Top level</option>
                  {active.parent && !groupTargets(layers, active.id).some(({ id }) => id === active.parent) && <option value={active.parent}>{layerLabel(layers.find(({ id }) => id === active.parent))}</option>}
                  {groupTargets(layers, active.id).map((entry) => <option key={entry.id} value={entry.id}>{layerLabel(entry)}</option>)}
                </select>
              </label>
            )}
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
            {active.type === 'image' && selection && onMaskFromSelection && (
              <div className="pe-layers__actions" role="group" aria-label={`Mask “${layerLabel(active)}” from a selection of its own image`}>
                <span className="pe-masks__label">Mask from</span>
                {[['subject', 'Subject'], ['sky', 'Sky'], ['background', 'Background'], ['object', 'Object']].map(([kind, label]) => (
                  <button
                    key={kind}
                    type="button"
                    className="pe-text-button"
                    disabled={disabled || locked || Boolean(selection.status?.busy)}
                    title={kind === 'object' ? 'Tap the object on this layer' : `Select the ${kind} of this layer automatically, on this device${active.mask ? ' (replaces its mask)' : ''}`}
                    onClick={() => onMaskFromSelection(active, kind)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {active.type === 'image' && selection?.status && (
              <p className="pe-note" role="status">{selection.status.text}</p>
            )}
            {active.type !== 'group' && (
              <button type="button" className="pe-text-button" disabled={disabled} onClick={() => onEditSettings(active)}>
                {{ adjustment: 'Edit adjustment settings', image: 'Edit layer colour', text: 'Edit text' }[active.type]}
              </button>
            )}
            {canClipAbove(layers, active.id) && (
              <button type="button" className="pe-text-button" disabled={disabled || !canAddLayer(layers, 'adjustment')} onClick={() => onAddAdjustment({ clip: true })}>
                Add clipped adjustment
              </button>
            )}
            <div className="pe-layers__actions">
              <button type="button" className="pe-text-button" disabled={disabled || !canMoveUnit(layers, active.id, 1)} onClick={() => apply(moveUnit(layers, active.id, 1))}>Move up</button>
              <button type="button" className="pe-text-button" disabled={disabled || !canMoveUnit(layers, active.id, -1)} onClick={() => apply(moveUnit(layers, active.id, -1))}>Move down</button>
              <button type="button" className="pe-text-button" disabled={disabled} onClick={() => setRenaming(active.id)}>Rename</button>
              <button type="button" className="pe-text-button" disabled={disabled || !canAddLayer(layers, 'group')} onClick={() => group(active.id)}>Group</button>
              {active.type === 'group' && <button type="button" className="pe-text-button" disabled={disabled || locked} onClick={() => apply(ungroup(layers, active.id))}>Ungroup</button>}
              <button
                type="button"
                className="pe-text-button"
                disabled={disabled || !canAddLayer(layers, active.type)}
                onClick={() => {
                  const copy = duplicateUnit(layers, active.id, (type) => newLayerId(type));
                  if (!copy.id) return;
                  onApply(copy.layers);
                  onSelect(copy.id);
                }}
              >
                Duplicate
              </button>
              {confirming === active.id ? (
                <span className="pe-layers__confirm" role="group" aria-label="Confirm delete">
                  <button
                    type="button"
                    className="pe-text-button pe-text-button--danger"
                    onClick={() => { onApply(removeUnit(layers, active.id)); onSelect(null); setConfirming(null); }}
                  >
                    {active.type === 'group' ? 'Delete group and contents' : 'Delete layer'}
                  </button>
                  <button type="button" className="pe-text-button" onClick={() => setConfirming(null)}>Keep</button>
                </span>
              ) : (
                <button type="button" className="pe-text-button pe-text-button--danger" disabled={disabled || Boolean(removeBlocked(layers, active.id))} onClick={() => setConfirming(active.id)}>Delete…</button>
              )}
            </div>
            {removeBlocked(layers, active.id) === 'locked-inside' && <p className="pe-note">A locked layer inside this group keeps it from being deleted.</p>}
            {active.type === 'image' && <p className="pe-note">Deleting a layer removes it from this photo only; its file is never changed.</p>}
            {active.type === 'group' && <p className="pe-note">Deleting a group deletes the layers inside it (Ungroup keeps them). Layers clipped to a deleted layer stay, unclipped.</p>}
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
