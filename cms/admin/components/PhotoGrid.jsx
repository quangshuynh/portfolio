import { useState } from 'react';
import { imageUrl } from '../api.js';

const TREATMENT_BADGES = { draft: 'Edit: draft', approved: 'Edit: approved', rejected: 'Edit: rejected' };

function Badges({ record, isHero, needsWork, treatment }) {
  return (
    <span className="cms-badges">
      <span className={`cms-badge cms-badge--${record.status}`}>{record.status === 'published' ? 'Published' : 'Draft'}</span>
      {isHero && <span className="cms-badge cms-badge--hero">Hero</span>}
      {record.featured && <span className="cms-badge cms-badge--featured">Featured {record.featured}</span>}
      {needsWork && <span className="cms-badge cms-badge--warn">Needs details</span>}
      {TREATMENT_BADGES[treatment?.status] && <span className="cms-badge cms-badge--edit">{TREATMENT_BADGES[treatment.status]}</span>}
    </span>
  );
}

/**
 * Photographs in curated order. Drag a card onto another to move it there; the arrow
 * buttons do the same one step at a time, for keyboards and touch screens.
 */
export default function PhotoGrid({
  items, layout, catalog, selection, activeId, problems, reorderable, onToggle, onOpen, onMove, treatments = {},
}) {
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const position = new Map(catalog.photographs.map(({ id }, index) => [id, index]));
  // The number the public gallery shows ("No. 05"): position among published photographs only.
  const publicNumber = new Map(catalog.photographs.filter(({ status }) => status === 'published').map(({ id }, i) => [id, i + 1]));

  if (!items.length) return <p className="cms-empty">No photographs match these filters.</p>;

  return (
    <ol className={`cms-photos cms-photos--${layout}`} aria-label="Photographs in curated order">
      {items.map((record) => {
        const index = position.get(record.id);
        const selected = selection.has(record.id);
        return (
          <li
            key={record.id}
            className={`cms-photo ${selected ? 'is-selected' : ''} ${activeId === record.id ? 'is-active' : ''} ${overId === record.id && dragId !== record.id ? 'is-drop-target' : ''} ${dragId === record.id ? 'is-dragging' : ''}`}
            draggable={reorderable}
            onDragStart={(event) => {
              setDragId(record.id);
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', record.id);
            }}
            onDragOver={(event) => {
              if (!dragId) return;
              event.preventDefault();
              setOverId(record.id);
            }}
            onDragLeave={() => setOverId((current) => (current === record.id ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              if (dragId && dragId !== record.id) onMove(dragId, index);
              setDragId(null);
              setOverId(null);
            }}
            onDragEnd={() => { setDragId(null); setOverId(null); }}
          >
            <button type="button" className="cms-photo-open" onClick={() => onOpen(record.id)} aria-label={`Edit ${record.caption || record.id}`}>
              <span className="cms-photo-frame" data-shape={record.shape}>
                <img src={imageUrl(record.id)} alt="" loading="lazy" decoding="async" />
              </span>
              <span className="cms-photo-text">
                <span className="cms-photo-caption">{record.caption || <em>Untitled</em>}</span>
                <span className="cms-photo-meta mono">
                  {publicNumber.has(record.id) ? `No. ${String(publicNumber.get(record.id)).padStart(2, '0')}` : 'Not numbered'} · {record.category} · {record.id}
                </span>
                <Badges record={record} isHero={catalog.hero === record.id} needsWork={Boolean(problems.drafts[record.id])} treatment={treatments[record.id]} />
              </span>
            </button>
            <label className="cms-photo-select">
              <input type="checkbox" checked={selected} onChange={() => onToggle(record.id)} />
              <span className="visually-hidden">Select {record.caption || record.id}</span>
            </label>
            {reorderable && (
              <span className="cms-photo-order" role="group" aria-label={`Move ${record.caption || record.id}`}>
                <button type="button" onClick={() => onMove(record.id, index - 1)} disabled={index === 0} aria-label="Move earlier">↑</button>
                <button type="button" onClick={() => onMove(record.id, index + 1)} disabled={index === catalog.photographs.length - 1} aria-label="Move later">↓</button>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
