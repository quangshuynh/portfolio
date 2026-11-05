import React, { useEffect, useId, useState } from 'react';
import {
  MASK_LIMITS, addComponent, cleanMaskName, clearStrokes, componentLabel, createBrush, createLinear, createLocalAdjustment, createMask, createRadial,
  duplicateComponent, linearCentre, linearFromCentre, removeComponent, removeRecoverStrokes, updateComponent,
} from '../model/masks.mjs';
import { layerLabel } from '../model/layers.mjs';
import { NumberField, OpacityRange } from './LayersPanel';
import { WARN_BELOW } from '../segment/models.mjs';
import { newRefine } from '../segment/refineClient.mjs';

const TOOLS = [['brush', 'Brush'], ['linear', 'Linear'], ['radial', 'Radial']];
const TYPE_LABEL = { brush: 'Brush', linear: 'Linear', radial: 'Radial' };
// Intelligent selections (Interval 23): made by models on this device (useSelections).
const SELECTS = [['sky', 'Sky'], ['subject', 'Subject'], ['background', 'Background']];
const megabytes = (bytes) => `${Math.max(1, Math.round(bytes / 1e6))} MB`;
const OVERLAY_COLORS = [['#ff3b30', 'Red'], ['#34c759', 'Green'], ['#0a84ff', 'Blue'], ['#ffd60a', 'Yellow']];
export const DEFAULT_BRUSH = Object.freeze({ radius: 0.06, hardness: 0.5, opacity: 1, mode: 'add', pressure: true });
export const DEFAULT_OVERLAY = Object.freeze({ show: true, color: '#ff3b30', view: 'overlay' });

const newComponent = (type, id) => (type === 'brush' ? createBrush(id) : type === 'linear' ? createLinear(id) : createRadial(id));

/**
 * The Masks panel: local adjustments (each a mask with its own Light, Color, HSL and Detail
 * settings, edited in the Adjust panel while it is selected) and the selected layer's mask.
 * For the selected mask: its components (brush, linear, radial; add or subtract, invert,
 * opacity, duplicate, delete), invert, density, overlay, the canvas tool and its brush, and
 * numeric fields for the selected gradient. Every change is an ordinary undo step.
 * :param target: { kind: 'local', local } | { kind: 'layer', layer } | null, the mask being edited
 * :param space: { width, height } of the target mask's space in pixels (gradient fields)
 * :param selection: useSelections() (Select Sky, Subject, Background, Object), or null
 * :param savedSelections: [{ id, label, mask }] selections this photo already holds, which can be
 *   copied into the mask being edited (no model runs again)
 */
export default function MaskPanel({ compact = false, onClose,
  disabled, locals, layer, target, space, selectedId, onSelect, onSelectLocal, onSelectLayerMask, tool, onTool, brush, onBrush, overlay, onOverlay,
  onApplyLocals, onApplyMask, onPreviewMask, onCommit, newId, onEditSettings, selection = null, savedSelections = [], refinement = null, recoverBrush = null,
}) {
  const [open, setOpen] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const bodyId = useId();
  const mask = target?.kind === 'local' ? target.local.mask : target?.layer.mask ?? null;
  const locked = target?.kind === 'layer' && target.layer.locked;
  const edit = disabled || locked;
  const component = mask?.components.find((c) => c.id === selectedId) ?? null;
  useEffect(() => setRenaming(false), [target?.kind, target?.local?.id]);

  // A new local adjustment starts empty with the tool on: the first stroke or drag on the photo
  // makes its first component (+ Brush, + Linear, + Radial add one without a pointer).
  const addLocal = (type) => {
    const id = newId('local');
    onApplyLocals([...locals, createLocalAdjustment(id)]);
    onSelectLocal(id);
    onTool(type);
  };
  const patchLocal = (patch, coalesceKey = null) => onApplyLocals(locals.map((l) => (l.id === target.local.id ? { ...l, ...patch } : l)), coalesceKey);
  const setMask = (next, coalesceKey = null) => onApplyMask(next, coalesceKey);
  const add = (type) => {
    const id = newId(type);
    const next = addComponent(mask, newComponent(type, id));
    if (next === mask) return;
    setMask(next);
    onSelect(id);
    onTool(type);
  };
  const patchComponent = (patch, key) => setMask(updateComponent(mask, component.id, patch), key && `mask:${component.id}:${key}`);
  const short = Math.min(space?.width ?? 1, space?.height ?? 1);
  const busy = Boolean(selection?.status?.busy);
  const local = target?.kind === 'local';
  // Every mask can hold selections: of the photo (local adjustments and canvas-space layer masks),
  // or of an image layer's own source (its mask, Interval 24.1). Saved selections are of the photo,
  // so only masks over the photo can copy them; Select Object needs the analysed image's space.
  const selectable = local || target?.kind === 'layer';
  const imageLayerMask = target?.kind === 'layer' && mask?.space === 'layer';
  const photoSpace = local || mask?.space === 'canvas';
  const copySelection = (id) => {
    const chosen = savedSelections.find((entry) => entry.id === id);
    if (!chosen) return;
    const copy = { ...chosen.mask.components[0], id: newId('selection') };
    const next = addComponent(mask, copy);
    if (next === mask) return;
    setMask(next);
    onSelect(copy.id);
  };
  const selectTitle = (kind) => {
    const bytes = selection?.downloadBytes(kind) ?? 0;
    return `Select the ${kind} automatically, on this device${bytes ? ` (downloads ${megabytes(bytes)} the first time)` : ''}`;
  };
  const draft = selection?.object.draft ?? null;
  const linear = component?.type === 'linear' && space ? linearCentre(component, space) : null;
  const setLinear = (patch, key) => patchComponent(linearFromCentre({ ...linear, ...patch }, space), key);

  return (
    <section className="pe-panel pe-masks" aria-labelledby="pe-masks-title" data-open={open || compact || undefined}>
      <div className="pe-panel__head">
        <h2 id="pe-masks-title">
          <button type="button" className="pe-section__toggle" aria-expanded={open || compact} aria-controls={bodyId} onClick={() => compact ? onClose?.() : setOpen((value) => !value)}>
            <svg className="pe-section__chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span>Masks</span> <span className="pe-count mono">{locals.length}</span>
          </button>
        </h2>
        {target && (
          <button type="button" className="pe-text-button" aria-pressed={Boolean(tool)} disabled={edit} onClick={() => onTool(tool ? null : (component && component.type !== 'selection' ? component.type : 'brush'))} title="Paint or drag on the photo (M)">
            {tool ? 'Done' : 'Edit on photo'}
          </button>
        )}
      </div>
      <div id={bodyId} hidden={!open && !compact}>
        <div className="pe-masks__add" role="group" aria-label="New local adjustment">
          <span className="pe-masks__label">New local adjustment</span>
          {TOOLS.map(([type, label]) => (
            <button key={type} type="button" className="pe-button" disabled={disabled || locals.length >= MASK_LIMITS.local} onClick={() => addLocal(type)}>{label}</button>
          ))}
        </div>
        {selection && (
          <div className="pe-masks__add" role="group" aria-label="New local adjustment from a selection">
            <span className="pe-masks__label">Select</span>
            {SELECTS.map(([kind, label]) => (
              <button key={kind} type="button" className="pe-button" title={selectTitle(kind)} disabled={disabled || busy || locals.length >= MASK_LIMITS.local} onClick={() => selection.select(kind, { mode: 'new' })}>{label}</button>
            ))}
            <button type="button" className="pe-button" title={`${selectTitle('object')}: tap the object on the photo`} disabled={disabled || busy || locals.length >= MASK_LIMITS.local} onClick={() => addLocal('object')}>Object</button>
          </div>
        )}
        {selection?.status && (
          <div className="pe-masks__select-status" role="status" data-state={selection.status.error ? 'error' : selection.status.note ? 'note' : 'busy'}>
            <span>{selection.status.text}</span>
            {selection.status.busy && <progress max="1" value={selection.status.stage === 'download' ? selection.status.fraction ?? 0 : undefined} aria-label="Selection progress" />}
            {selection.status.busy && <button type="button" className="pe-text-button" onClick={selection.cancel}>Cancel</button>}
          </div>
        )}
        {locals.length > 0 && (
          <ul className="pe-masks__list" aria-label="Local adjustments">
            {locals.map((local, index) => {
              const selected = target?.kind === 'local' && target.local.id === local.id;
              const label = local.name || `Local adjustment ${index + 1}`;
              return (
                <li key={local.id} className="pe-mask-row" data-selected={selected || undefined}>
                  <button type="button" className="pe-mask-row__name" aria-pressed={selected} disabled={disabled} onClick={() => onSelectLocal(selected ? null : local.id)} onDoubleClick={() => setRenaming(true)}>
                    <span className="pe-layer__label">{label}</span>
                    <span className="pe-layer__meta">
                      {local.mask.components.map((c) => (c.type === 'selection' ? componentLabel(c) : TYPE_LABEL[c.type])).join(' + ') || 'Empty mask'}
                      {local.amount < 1 ? ` · ${Math.round(local.amount * 100)}%` : ''}
                      {!Object.keys(local.settings).length ? ' · no settings yet' : ''}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="pe-icon-button pe-layer__toggle"
                    aria-pressed={!local.enabled}
                    aria-label={`${local.enabled ? 'Turn off' : 'Turn on'} ${label}`}
                    title={local.enabled ? 'Turn off' : 'Turn on'}
                    disabled={disabled}
                    onClick={() => onApplyLocals(locals.map((l) => (l.id === local.id ? { ...l, enabled: !l.enabled } : l)))}
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill={local.enabled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" /></svg>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {layer && (
          <div className="pe-masks__layer" role="group" aria-label={`Mask of the layer “${layerLabel(layer)}”`}>
            {layer.mask ? (
              <>
                <button type="button" className="pe-text-button" aria-pressed={target?.kind === 'layer'} disabled={disabled} onClick={() => onSelectLayerMask(target?.kind !== 'layer')}>
                  {target?.kind === 'layer' ? 'Editing layer mask' : `Edit mask of “${layerLabel(layer)}”`}
                </button>
                <button type="button" className="pe-text-button" disabled={disabled || layer.locked} onClick={() => onApplyMask(null)}>Remove layer mask</button>
              </>
            ) : (
              <button type="button" className="pe-button" disabled={disabled || layer.locked} onClick={() => { onApplyMask(createMask(layer.type === 'image' ? 'layer' : 'canvas')); onSelectLayerMask(true); }}>
                Add mask to “{layerLabel(layer)}”
              </button>
            )}
            {layer.type === 'image' && selection && (
              <div className="pe-masks__add" role="group" aria-label={layer.mask ? `Replace the mask of “${layerLabel(layer)}” with a selection` : `Mask “${layerLabel(layer)}” with a selection`}>
                <span className="pe-masks__label">{layer.mask ? 'Replace mask with' : 'Mask from'}</span>
                {SELECTS.map(([kind, label]) => (
                  <button key={kind} type="button" className="pe-text-button" title={`${selectTitle(kind)}, from this layer's own image`} disabled={disabled || layer.locked || busy} onClick={() => selection.select(kind, { layer, replace: true })}>{label}</button>
                ))}
              </div>
            )}
          </div>
        )}
        {!target && !locals.length && <p className="pe-note">Add a local adjustment, then paint or drag on the photo where it should apply.</p>}
        {mask && !mask.components.length && tool && tool !== 'object' && <p className="pe-note" role="status">{tool === 'brush' ? 'Paint on the photo.' : `Drag on the photo to place the ${tool} gradient.`}</p>}
        {target && mask && (
          <div className="pe-masks__props" role="group" aria-label={target.kind === 'local' ? 'Local adjustment' : 'Layer mask'}>
            {locked && <p className="pe-note" role="status">The layer is locked: unlock it to edit its mask.</p>}
            {target.kind === 'local' && (
              <>
                {renaming ? (
                  <label className="pe-field">
                    <span>Name</span>
                    <input
                      autoFocus // eslint-disable-line jsx-a11y/no-autofocus
                      defaultValue={target.local.name}
                      maxLength={MASK_LIMITS.name}
                      onBlur={(event) => { patchLocal({ name: cleanMaskName(event.target.value) }); setRenaming(false); }}
                      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') setRenaming(false); }}
                    />
                  </label>
                ) : null}
                <OpacityRange
                  label="Amount"
                  value={target.local.amount}
                  disabled={disabled}
                  onPreview={(value) => onPreviewMask(null, { amount: value })}
                  onApply={(value) => patchLocal({ amount: value }, `local:${target.local.id}:amount`)}
                  onCommit={onCommit}
                />
                <div className="pe-layers__actions">
                  <button type="button" className="pe-text-button" disabled={disabled} onClick={onEditSettings}>Edit Light, Color, HSL, Detail</button>
                  <button type="button" className="pe-text-button" disabled={disabled} onClick={() => setRenaming(true)}>Rename</button>
                  <button
                    type="button"
                    className="pe-text-button"
                    disabled={disabled || locals.length >= MASK_LIMITS.local}
                    onClick={() => {
                      const id = newId('local');
                      const at = locals.findIndex((l) => l.id === target.local.id);
                      onApplyLocals([...locals.slice(0, at + 1), { ...target.local, id, name: target.local.name ? cleanMaskName(`${target.local.name} copy`) : '' }, ...locals.slice(at + 1)]);
                      onSelectLocal(id);
                    }}
                  >
                    Duplicate
                  </button>
                  <button type="button" className="pe-text-button pe-text-button--danger" disabled={disabled} onClick={() => { onApplyLocals(locals.filter((l) => l.id !== target.local.id)); onSelectLocal(null); }}>Delete</button>
                </div>
              </>
            )}
            <div className="pe-masks__row">
              {target.kind === 'layer' && (
                <label className="pe-field pe-field--check">
                  <input type="checkbox" checked={mask.enabled} disabled={edit} onChange={(event) => setMask({ ...mask, enabled: event.target.checked })} />
                  <span>Mask on</span>
                </label>
              )}
              <label className="pe-field pe-field--check">
                <input type="checkbox" checked={mask.invert} disabled={edit} onChange={(event) => setMask({ ...mask, invert: event.target.checked })} />
                <span>Invert mask</span>
              </label>
              <label className="pe-field">
                <span>Start with</span>
                <select value={mask.base} disabled={edit} onChange={(event) => setMask({ ...mask, base: event.target.value })}>
                  <option value="none">Nothing selected</option>
                  <option value="all">Everything selected</option>
                </select>
              </label>
            </div>
            <OpacityRange label="Density" value={mask.opacity} disabled={edit} onPreview={(value) => onPreviewMask({ ...mask, opacity: value })} onApply={(value) => setMask({ ...mask, opacity: value }, 'mask:density')} onCommit={onCommit} />
            <div className="pe-masks__row" role="group" aria-label="Overlay">
              <label className="pe-field pe-field--check">
                <input type="checkbox" checked={overlay.show} onChange={(event) => onOverlay({ ...overlay, show: event.target.checked })} />
                <span>Show overlay (O)</span>
              </label>
              <label className="pe-field">
                <span>Overlay</span>
                <select value={overlay.view === 'mask' ? 'mask' : overlay.color} onChange={(event) => onOverlay(event.target.value === 'mask' ? { ...overlay, show: true, view: 'mask' } : { ...overlay, show: true, view: 'overlay', color: event.target.value })}>
                  {OVERLAY_COLORS.map(([value, label]) => <option key={value} value={value}>{label} tint</option>)}
                  <option value="mask">Mask in greyscale</option>
                </select>
              </label>
            </div>

            <h3 className="pe-masks__heading">Components <span className="pe-count mono">{mask.components.length}</span></h3>
            <ul className="pe-masks__list" aria-label="Mask components">
              {mask.components.map((c, index) => {
                const selected = c.id === selectedId;
                const label = componentLabel(c, index);
                return (
                  <li key={c.id} className="pe-mask-row" data-selected={selected || undefined}>
                    <button type="button" className="pe-mask-row__name" aria-pressed={selected} disabled={disabled} onClick={() => { onSelect(selected ? null : c.id); if (!selected && tool) onTool(c.type === 'selection' ? null : c.type); }}>
                      <span className="pe-layer__label">{label}</span>
                      <span className="pe-layer__meta">
                        {c.op === 'subtract' ? 'Subtract' : 'Add'}{c.invert ? ' · inverted' : ''}{c.opacity < 1 ? ` · ${Math.round(c.opacity * 100)}%` : ''}
                        {c.type === 'brush' ? ` · ${c.strokes.length} stroke${c.strokes.length === 1 ? '' : 's'}` : ''}
                      </span>
                    </button>
                    <button type="button" className="pe-icon-button pe-layer__toggle" aria-pressed={!c.enabled} aria-label={`${c.enabled ? 'Hide' : 'Show'} ${label}`} title={c.enabled ? 'Turn off' : 'Turn on'} disabled={edit} onClick={() => setMask(updateComponent(mask, c.id, { enabled: !c.enabled }))}>
                      <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill={c.enabled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" /></svg>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="pe-masks__add" role="group" aria-label="Add to the mask">
              {TOOLS.map(([type, label]) => (
                <button key={type} type="button" className="pe-text-button" disabled={edit || mask.components.length >= MASK_LIMITS.components} onClick={() => add(type)}>+ {label}</button>
              ))}
              {selection && selectable && SELECTS.map(([kind, label]) => (
                <button key={kind} type="button" className="pe-text-button" title={selectTitle(kind)} disabled={edit || busy || mask.components.length >= MASK_LIMITS.components} onClick={() => selection.select(kind, { mode: 'add' })}>+ {label}</button>
              ))}
              {photoSpace && savedSelections.length > 0 && (
                <label className="pe-layers__photo">
                  <span className="visually-hidden">Copy a saved selection into this mask</span>
                  <select value="" disabled={edit || mask.components.length >= MASK_LIMITS.components} onChange={(event) => copySelection(event.target.value)}>
                    <option value="">+ Saved selection…</option>
                    {savedSelections.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
                  </select>
                </label>
              )}
            </div>
            {imageLayerMask && selection && <p className="pe-note">Sky, Subject, Background and Object analyse this layer&apos;s own image, and the mask follows the layer when it is moved, scaled, rotated or flipped.</p>}

            <div className="pe-masks__tools" role="group" aria-label="Tool on the photo">
              {TOOLS.map(([type, label]) => (
                <button key={type} type="button" className="pe-button" aria-pressed={tool === type} disabled={edit} onClick={() => onTool(tool === type ? null : type)}>{label}</button>
              ))}
              {selection && (local || imageLayerMask) && <button type="button" className="pe-button" aria-pressed={tool === 'object'} title={selectTitle('object')} disabled={edit} onClick={() => onTool(tool === 'object' ? null : 'object')}>Object</button>}
            </div>
            {tool === 'object' && selection && (
              <div className="pe-masks__brush" role="group" aria-label="Select Object">
                <p className="pe-note">{draft?.points.length ? 'Tap more of the object to include it, or switch to Exclude and tap what should not be selected.' : imageLayerMask ? 'Tap the object on this layer.' : 'Tap the object to select on the photo.'}</p>
                <div className="pe-masks__tools">
                  <button type="button" className="pe-button" aria-pressed={!selection.object.exclude} onClick={() => selection.object.setExclude(false)}>Include</button>
                  <button type="button" className="pe-button" aria-pressed={selection.object.exclude} onClick={() => selection.object.setExclude(true)} title="Exclude (or hold Alt while tapping)">Exclude</button>
                </div>
                {draft && (
                  <div className="pe-layers__actions">
                    <button type="button" className="pe-text-button" disabled={busy || !draft.result || draft.candidate === 0} onClick={() => selection.object.resize(-1)}>Smaller part</button>
                    <button type="button" className="pe-text-button" disabled={busy || !draft.result || draft.candidate >= draft.candidates.length - 1} onClick={() => selection.object.resize(1)}>Larger part</button>
                    <button type="button" className="pe-text-button" disabled={busy || !draft.points.length} onClick={selection.object.undoPoint}>Undo point</button>
                    <button type="button" className="pe-button" disabled={busy || !draft.result || mask.components.length >= MASK_LIMITS.components} onClick={() => { selection.object.accept('add'); onTool(null); }}>Add selection</button>
                    <button type="button" className="pe-text-button" disabled={busy || !draft.result || mask.components.length >= MASK_LIMITS.components} onClick={() => { selection.object.accept('subtract'); onTool(null); }}>Subtract it</button>
                    <button type="button" className="pe-text-button" onClick={() => { selection.object.discard(); onTool(null); }}>Discard</button>
                  </div>
                )}
              </div>
            )}
            {tool === 'brush' && (
              <div className="pe-masks__brush" role="group" aria-label="Brush">
                <div className="pe-masks__tools">
                  <button type="button" className="pe-button" aria-pressed={brush.mode === 'add'} onClick={() => onBrush({ ...brush, mode: 'add' })}>Paint</button>
                  <button type="button" className="pe-button" aria-pressed={brush.mode === 'erase'} onClick={() => onBrush({ ...brush, mode: 'erase' })} title="Erase (X; hold Alt to switch while painting)">Erase</button>
                </div>
                <OpacityRange label="Size" value={brush.radius / 0.5} disabled={false} onPreview={(v) => onBrush({ ...brush, radius: Math.max(0.002, v * 0.5) })} onApply={(v) => onBrush({ ...brush, radius: Math.max(0.002, v * 0.5) })} onCommit={() => {}} />
                <OpacityRange label="Hardness" value={brush.hardness} disabled={false} onPreview={(v) => onBrush({ ...brush, hardness: v })} onApply={(v) => onBrush({ ...brush, hardness: v })} onCommit={() => {}} />
                <OpacityRange label="Stroke opacity" value={brush.opacity} disabled={false} onPreview={(v) => onBrush({ ...brush, opacity: v })} onApply={(v) => onBrush({ ...brush, opacity: v })} onCommit={() => {}} />
                <label className="pe-field pe-field--check">
                  <input type="checkbox" checked={brush.pressure} onChange={(event) => onBrush({ ...brush, pressure: event.target.checked })} />
                  <span>Pen pressure narrows strokes</span>
                </label>
                <p className="pe-note">Size is the radius as a share of the photo&apos;s short edge ([ and ] change it). Strokes keep their size when you zoom.</p>
              </div>
            )}

            {component && (
              <div className="pe-masks__component" role="group" aria-label={componentLabel(component, mask.components.indexOf(component))}>
                <div className="pe-masks__row">
                  <label className="pe-field">
                    <span>Combine</span>
                    <select value={component.op} disabled={edit} onChange={(event) => patchComponent({ op: event.target.value })}>
                      <option value="add">Add to mask</option>
                      <option value="subtract">Subtract from mask</option>
                    </select>
                  </label>
                  <label className="pe-field pe-field--check">
                    <input type="checkbox" checked={component.invert} disabled={edit} onChange={(event) => patchComponent({ invert: event.target.checked })} />
                    <span>{component.type === 'radial' ? 'Outside' : 'Invert'}</span>
                  </label>
                </div>
                <label className="pe-field">
                  <span>Name</span>
                  <input
                    key={component.id}
                    defaultValue={component.name}
                    placeholder={componentLabel({ ...component, name: '' }, mask.components.indexOf(component))}
                    maxLength={MASK_LIMITS.name}
                    disabled={edit}
                    onBlur={(event) => { const name = cleanMaskName(event.target.value); if (name !== component.name) patchComponent({ name }); }}
                    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                  />
                </label>
                <OpacityRange value={component.opacity} disabled={edit} onPreview={(v) => onPreviewMask(updateComponent(mask, component.id, { opacity: v }))} onApply={(v) => patchComponent({ opacity: v }, 'opacity')} onCommit={onCommit} />
                {component.type === 'selection' && (
                  <>
                    <p className="pe-note" data-confidence={component.confidence < (WARN_BELOW[component.kind] ?? 0.6) ? 'low' : undefined}>
                      Selected automatically on this device · confidence {Math.round(component.confidence * 100)}% (an estimate, not a probability)
                      {component.confidence < (WARN_BELOW[component.kind] ?? 0.6) ? '. The outline may miss parts or include others: check it with the overlay and correct it with a brush or Subtract.' : ''}
                    </p>
                    <NumberField label="Edge" unit="−100 contracts, +100 expands" value={Math.round(component.shift * 100)} min={-100} max={100} step={5} disabled={edit} onApply={(v) => patchComponent({ shift: v / 100 }, 'shift')} />
                    <RefineControls component={component} status={refinement?.(component) ?? { state: 'off' }} disabled={edit} onPatch={patchComponent}
                      recover={{
                        active: tool === 'recover',
                        onToggle: () => onTool(tool === 'recover' ? null : 'recover'),
                        radius: recoverBrush?.radius ?? brush.radius,
                        onRadius: (radius) => (recoverBrush ? recoverBrush.onRadius(radius) : onBrush({ ...brush, radius })),
                        onUndo: () => setMask(removeRecoverStrokes(mask, component.id)),
                        onClear: () => setMask(removeRecoverStrokes(mask, component.id, true)),
                      }}
                    />
                  </>
                )}
                {component.type !== 'brush' && (
                  <OpacityRange label="Feather" value={component.feather} disabled={edit} onPreview={(v) => onPreviewMask(updateComponent(mask, component.id, { feather: v }))} onApply={(v) => patchComponent({ feather: v }, 'feather')} onCommit={onCommit} />
                )}
                {linear && (
                  <div className="pe-layers__transform" role="group" aria-label="Linear gradient">
                    <NumberField label="X" unit="% of width" value={(linear.cx / space.width) * 100} min={-100} max={200} step={0.5} disabled={edit} onApply={(v) => setLinear({ cx: (v / 100) * space.width }, 'cx')} />
                    <NumberField label="Y" unit="% of height" value={(linear.cy / space.height) * 100} min={-100} max={200} step={0.5} disabled={edit} onApply={(v) => setLinear({ cy: (v / 100) * space.height }, 'cy')} />
                    <NumberField label="Angle" unit="degrees" value={linear.angle} min={-180} max={180} step={0.5} disabled={edit} onApply={(v) => setLinear({ angle: v }, 'angle')} />
                    <NumberField label="Transition" unit="% of short edge" value={(linear.length / short) * 100} min={0.1} max={300} step={0.5} disabled={edit} onApply={(v) => setLinear({ length: (v / 100) * short }, 'length')} />
                  </div>
                )}
                {component.type === 'radial' && (
                  <div className="pe-layers__transform" role="group" aria-label="Radial gradient">
                    <NumberField label="X" unit="% of width" value={component.x * 100} min={-100} max={200} step={0.5} disabled={edit} onApply={(v) => patchComponent({ x: v / 100 }, 'x')} />
                    <NumberField label="Y" unit="% of height" value={component.y * 100} min={-100} max={200} step={0.5} disabled={edit} onApply={(v) => patchComponent({ y: v / 100 }, 'y')} />
                    <NumberField label="Width" unit="radius, % of short edge" value={component.rx * 100} min={0.1} max={200} step={0.5} disabled={edit} onApply={(v) => patchComponent({ rx: v / 100 }, 'rx')} />
                    <NumberField label="Height" unit="radius, % of short edge" value={component.ry * 100} min={0.1} max={200} step={0.5} disabled={edit} onApply={(v) => patchComponent({ ry: v / 100 }, 'ry')} />
                    <NumberField label="Angle" unit="degrees" value={component.rotation} min={-180} max={180} step={0.5} disabled={edit} onApply={(v) => patchComponent({ rotation: v }, 'rotation')} />
                  </div>
                )}
                <div className="pe-layers__actions">
                  {component.type === 'brush' && <button type="button" className="pe-text-button" disabled={edit || !component.strokes.length} onClick={() => setMask(clearStrokes(mask, component.id))}>Clear strokes</button>}
                  {component.type === 'selection' && selection && <button type="button" className="pe-text-button" disabled={edit || busy} onClick={() => selection.regenerate(component)} title={selectTitle(component.kind)}>Select again</button>}
                  {component.type === 'selection' && selection && (component.kind === 'subject' || component.kind === 'background') && (() => {
                    const known = selection.candidateOf(component.id);
                    return <button type="button" className="pe-text-button" disabled={edit || busy || known?.candidates === 1} onClick={() => selection.nextCandidate(component)} title="Show the next of the other answers the models found">Next candidate{known?.candidates > 1 ? ` (${known.candidate + 1} of ${known.candidates})` : ''}</button>;
                  })()}
                  <button type="button" className="pe-text-button" disabled={edit || mask.components.length >= MASK_LIMITS.components} onClick={() => { const id = newId(component.type); setMask(duplicateComponent(mask, component.id, id)); onSelect(id); }}>Duplicate</button>
                  <button type="button" className="pe-text-button pe-text-button--danger" disabled={edit} onClick={() => { setMask(removeComponent(mask, component.id)); onSelect(null); }}>Delete</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

const REFINE_STATUS = {
  pending: 'Refining the edge against the full-resolution image… (the preview shows the unrefined edge meanwhile)',
  done: 'Edge refined against the full-resolution image.',
};

/**
 * Refine edge (Interval 24.2): on or off, which is also the before/after comparison. A wider band
 * (refine.radius) measured no consistent gain (docs/photography-editor.md), so it is not offered.
 */
function RefineControls({ component, status, disabled, onPatch, recover }) {
  const on = Boolean(component.refine);
  const text = status.message ?? REFINE_STATUS[status.state] ?? null;
  const strokes = component.recover?.strokes.length ?? 0;
  const empty = status.state === 'done' ? (status.recovered ?? []).filter((r) => !r.added).length : 0;
  return (
    <div className="pe-masks__refine" role="group" aria-label="Edge refinement">
      <label className="pe-field pe-field--check" title="Refines the outline against the image's own pixels at full resolution. Turn it off to compare.">
        <input type="checkbox" checked={on} disabled={disabled} onChange={(event) => onPatch({ refine: event.target.checked ? newRefine() : null }, 'refine')} />
        <span>Refine edge</span>
      </label>
      {on && text && <p className="pe-note" role="status" data-refine={status.state}>{text}</p>}
      {/* Recover Detail (Interval 24.3): paint over a thin part the selection missed. */}
      <div className="pe-masks__tools">
        <button type="button" className="pe-button" aria-pressed={recover.active} disabled={disabled || !on} onClick={recover.onToggle} title={on ? 'Paint over a thin part the selection missed (an antenna, a strut, a stalk); it is found in the original pixels under the stroke' : 'Turn on Refine edge to recover detail'}>Recover detail</button>
        {strokes > 0 && <button type="button" className="pe-text-button" disabled={disabled} onClick={recover.onUndo}>Undo last stroke</button>}
        {strokes > 0 && <button type="button" className="pe-text-button" disabled={disabled} onClick={recover.onClear}>Clear recovered detail</button>}
      </div>
      {recover.active && (
        <OpacityRange label="Recover brush size" value={Math.min(1, recover.radius / MASK_LIMITS.recoverRadius)} disabled={false} onPreview={(v) => recover.onRadius(Math.max(0.002, v * MASK_LIMITS.recoverRadius))} onApply={(v) => recover.onRadius(Math.max(0.002, v * MASK_LIMITS.recoverRadius))} onCommit={() => {}} />
      )}
      {recover.active && <p className="pe-note">Paint over all of the part with a brush a few times wider than it ([ and ] change the size). Only what stands out from the stroke&apos;s surroundings and joins the selection is added; for a whole part (a wing, a mirror) use Object.</p>}
      {strokes > 0 && empty > 0 && <p className="pe-note" role="status" data-recover="empty">{empty === 1 ? 'One stroke' : `${empty} strokes`} found nothing distinct from the surroundings: use the Add brush there.</p>}
    </div>
  );
}
