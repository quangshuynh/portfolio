import React, { useId, useState } from 'react';
import { RETOUCH_LABELS, RETOUCH_LIMITS, removeRetouchOperation, updateRetouchOperation } from '../model/retouch.mjs';
import { OpacityRange } from './LayersPanel';

const TOOLS = [['remove', 'Remove', 'R'], ['heal', 'Spot Heal', 'J'], ['clone', 'Clone Stamp', 'S']];
const MAX_RADIUS = RETOUCH_LIMITS.radius[1];

/**
 * Retouch: Remove, Spot Heal and Clone Stamp tools, their brush, the clone source, and the list of
 * operations (select to show its target and source on the photo, turn off, remove). A selected
 * removal can be given an area to copy from (`onAreaFor`).
 * :param operations: adjustments.retouch of the photo
 * :param clone: { source, aligned, offset }
 */
export default function RetouchPanel({ compact = false, onClose, disabled, operations, tool, onTool, brush, onBrush, clone, onClone, picking, onPicking, selectedId, onSelect, onApply, message, areaFor = null, onAreaFor = () => {} }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const selected = operations.find(({ id }) => id === selectedId) ?? null;
  const set = (patch) => onBrush({ ...brush, ...patch });
  return (
    <section className="pe-panel pe-masks pe-retouch" aria-labelledby="pe-retouch-title" data-open={open || compact || undefined}>
      <div className="pe-panel__head">
        <h2 id="pe-retouch-title">
          <button type="button" className="pe-section__toggle" aria-expanded={open || compact} aria-controls={bodyId} onClick={() => compact ? onClose?.() : setOpen((value) => !value)}>
            <svg className="pe-section__chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span>Retouch</span> <span className="pe-count mono">{operations.length}</span>
          </button>
        </h2>
        {tool && <button type="button" className="pe-text-button" onClick={() => onTool(null)} title="Stop retouching (Esc)">Done</button>}
      </div>
      <div id={bodyId} hidden={!open && !tool && !compact}>
        <div className="pe-masks__tools" role="group" aria-label="Retouch tool">
          {TOOLS.map(([id, label, key]) => (
            <button key={id} type="button" className="pe-button" aria-pressed={tool === id} disabled={disabled || (!tool && operations.length >= RETOUCH_LIMITS.operations)} onClick={() => onTool(tool === id ? null : id)} title={`${label} (${key})`}>{label}</button>
          ))}
        </div>
        {tool && (
          <div className="pe-masks__brush">
            <OpacityRange label="Size" value={brush.radius / MAX_RADIUS} disabled={false} onPreview={(v) => set({ radius: Math.max(RETOUCH_LIMITS.radius[0], v * MAX_RADIUS) })} onApply={(v) => set({ radius: Math.max(RETOUCH_LIMITS.radius[0], v * MAX_RADIUS) })} onCommit={() => {}} />
            <OpacityRange label="Hardness" value={brush.hardness} disabled={false} onPreview={(v) => set({ hardness: v })} onApply={(v) => set({ hardness: v })} onCommit={() => {}} />
            <OpacityRange label="Opacity" value={brush.opacity} disabled={false} onPreview={(v) => set({ opacity: Math.max(RETOUCH_LIMITS.opacity[0], v) })} onApply={(v) => set({ opacity: Math.max(RETOUCH_LIMITS.opacity[0], v) })} onCommit={() => {}} />
            {tool === 'clone' && (
              <>
                <OpacityRange label="Spacing" value={brush.spacing} disabled={false} onPreview={(v) => set({ spacing: Math.max(RETOUCH_LIMITS.spacing[0], v) })} onApply={(v) => set({ spacing: Math.max(RETOUCH_LIMITS.spacing[0], v) })} onCommit={() => {}} />
                <div className="pe-masks__tools" role="group" aria-label="Clone source">
                  <button type="button" className="pe-button" aria-pressed={picking} onClick={() => onPicking(!picking)} title="Then tap the area to copy from (Alt/Option-click also sets it)">Set source</button>
                  <label className="pe-check"><input type="checkbox" checked={clone.aligned} onChange={(event) => onClone({ ...clone, aligned: event.target.checked, offset: null })} /> <span>Aligned</span></label>
                </div>
                <p className="pe-note" role="status" data-clone-source={clone.source ? 'set' : 'none'}>
                  {picking ? 'Tap or click the area to copy from.' : clone.source ? 'Paint where the copy should go. Aligned keeps the same distance for every stroke.' : 'Set a source: Alt-click (Option-click) the area to copy from, or use Set source.'}
                </p>
              </>
            )}
            {tool === 'heal' && <p className="pe-note">Click a spot, or paint over a scratch: a matching area nearby is copied and blended in. Drag a repair&apos;s source handle to pick another.</p>}
            {tool === 'remove' && <p className="pe-note">Paint over the whole object, a little past its edge: it is filled from the photo around it. Small and medium objects on skies, walls, grass and pavement work best; if a fill looks wrong, select it and choose a source area.</p>}
            <p className="pe-note">Size is a share of the photo&apos;s short edge ([ and ] change it).</p>
          </div>
        )}
        {message && <p className="pe-note pe-note--warning" role="alert">{message}</p>}
        {operations.length > 0 && (
          <ul className="pe-masks__list" aria-label="Retouch operations">
            {operations.map((op, index) => {
              const isSelected = op.id === selectedId;
              const label = `${RETOUCH_LABELS[op.type]} ${index + 1}`;
              return (
                <li key={op.id} className="pe-mask-row" data-selected={isSelected || undefined} data-retouch-id={op.id}>
                  <button type="button" className="pe-mask-row__name" aria-pressed={isSelected} disabled={disabled} onClick={() => onSelect(isSelected ? null : op.id)}>
                    <span className="pe-layer__label">{label}</span>
                    <span className="pe-layer__meta">{op.points.length > 1 ? 'Stroke' : 'Spot'} · {(op.radius * 100).toFixed(1)}%{op.opacity < 1 ? ` · ${Math.round(op.opacity * 100)}%` : ''}{op.source ? ' · source area' : ''}</span>
                  </button>
                  <button type="button" className="pe-icon-button pe-layer__toggle" aria-pressed={!op.enabled} aria-label={`${op.enabled ? 'Turn off' : 'Turn on'} ${label}`} title={op.enabled ? 'Turn off' : 'Turn on'} disabled={disabled} onClick={() => onApply(updateRetouchOperation(operations, op.id, { enabled: !op.enabled }))}>
                    <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill={op.enabled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" /></svg>
                  </button>
                  <button type="button" className="pe-icon-button" aria-label={`Remove ${label}`} title="Remove" disabled={disabled} onClick={() => { onApply(removeRetouchOperation(operations, op.id)); if (isSelected) onSelect(null); }}>
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {selected && (
          <div className="pe-masks__brush">
            <OpacityRange label="Repair opacity" value={selected.opacity} disabled={disabled} onPreview={(v) => onApply(updateRetouchOperation(operations, selected.id, { opacity: Math.max(RETOUCH_LIMITS.opacity[0], v) }), `retouch:${selected.id}:opacity`)} onApply={(v) => onApply(updateRetouchOperation(operations, selected.id, { opacity: Math.max(RETOUCH_LIMITS.opacity[0], v) }), `retouch:${selected.id}:opacity`)} onCommit={() => {}} />
            <OpacityRange label="Repair hardness" value={selected.hardness} disabled={disabled} onPreview={(v) => onApply(updateRetouchOperation(operations, selected.id, { hardness: v }), `retouch:${selected.id}:hardness`)} onApply={(v) => onApply(updateRetouchOperation(operations, selected.id, { hardness: v }), `retouch:${selected.id}:hardness`)} onCommit={() => {}} />
            {selected.type === 'remove' && (
              <div className="pe-masks__tools" role="group" aria-label="Source area">
                <button type="button" className="pe-button" aria-pressed={areaFor === selected.id} disabled={disabled} onClick={() => onAreaFor(areaFor === selected.id ? null : selected.id)} title="Drag a rectangle on the photo: the fill copies only from there">Choose source area</button>
                {selected.source && <button type="button" className="pe-text-button" disabled={disabled} onClick={() => onApply(updateRetouchOperation(operations, selected.id, { source: null }))}>Clear area</button>}
              </div>
            )}
            {areaFor === selected.id && <p className="pe-note" role="status">Drag a rectangle over a clean area like the one to fill.</p>}
            <p className="pe-note">Delete or Backspace removes the selected repair.</p>
          </div>
        )}
      </div>
    </section>
  );
}
