import { useEffect, useId, useState } from 'react';
import {
  movePhotographBy, publishedIds, setFeatured, setHero, setStatus, updatePhotograph,
} from '../../lib/catalog-ops.mjs';
import { imageUrl } from '../api.js';

const METADATA_FIELDS = [
  ['camera', 'Camera', 'text'],
  ['lens', 'Lens', 'text'],
  ['focalLength', 'Focal length (mm)', 'number'],
  ['aperture', 'Aperture (f/)', 'number'],
  ['shutterSpeed', 'Shutter (seconds)', 'number'],
  ['iso', 'ISO', 'number'],
  ['capturedAt', 'Captured (ISO time)', 'text'],
  ['location', 'Location', 'text'],
];

/** A text field that commits on blur or Enter, so typing does not save on every key. */
function Field({ label, value, onCommit, multiline, readOnly, hint, type = 'text', invalid }) {
  const [draft, setDraft] = useState(value ?? '');
  const id = useId();
  useEffect(() => setDraft(value ?? ''), [value]);
  const Element = multiline ? 'textarea' : 'input';
  const commit = () => { if (draft !== (value ?? '')) onCommit(draft); };
  return (
    <div className={`cms-field ${invalid ? 'is-invalid' : ''}`}>
      <label className="cms-field-label" htmlFor={id}>{label}</label>
      <Element
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        type={multiline ? undefined : type}
        value={draft}
        readOnly={readOnly}
        rows={multiline ? 3 : undefined}
        aria-invalid={invalid || undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter' && !multiline) event.currentTarget.blur(); }}
      />
      {hint && <span className="cms-field-hint" id={`${id}-hint`}>{hint}</span>}
    </div>
  );
}

function MetadataEditor({ record, extracted, run }) {
  const metadata = record.metadata ?? {};
  const update = (key, value) => run((catalog) => {
    const next = { ...metadata };
    if (value === undefined) delete next[key];
    else next[key] = value;
    return updatePhotograph(catalog, record.id, { metadata: next });
  });
  return (
    <fieldset className="cms-fieldset">
      <legend>Metadata corrections</legend>
      <p className="cms-field-hint">Blank uses the value read from the photograph. “Hide” removes it from the public page.</p>
      {METADATA_FIELDS.map(([key, label, type]) => {
        const hidden = metadata[key] === null;
        return (
          <div key={key} className="cms-meta-row">
            <Field
              label={label}
              type={type}
              value={hidden ? '' : metadata[key]?.toString()}
              readOnly={hidden}
              hint={extracted?.[key] !== undefined ? `Extracted: ${extracted[key]}` : 'Not in the file'}
              onCommit={(text) => update(key, text.trim() === '' ? undefined : type === 'number' ? Number(text) : text.trim())}
            />
            <label className="cms-check">
              <input type="checkbox" checked={hidden} onChange={(event) => update(key, event.target.checked ? null : undefined)} />
              Hide
            </label>
          </div>
        );
      })}
    </fieldset>
  );
}

export default function DetailsPanel({ record, catalog, base, generated, problems, run, onClose }) {
  if (!record) return null;
  const wasPublished = publishedIds(base).has(record.id);
  const index = catalog.photographs.findIndex(({ id }) => id === record.id);
  const patch = (fields) => run((current) => updatePhotograph(current, record.id, fields, { base }));
  const errors = problems.drafts[record.id] ?? problems.publication.filter((error) => error.includes(`("${record.id}")`));
  const publishedCount = catalog.photographs.filter(({ featured }) => featured).length;

  return (
    <aside className="cms-details" aria-label={`Edit ${record.caption || record.id}`}>
      <header className="cms-details-head">
        <h2>{record.caption || 'Untitled'}</h2>
        <button type="button" className="cms-icon-button" onClick={onClose} aria-label="Close details">×</button>
      </header>
      <a className="cms-details-image" href={imageUrl(record.id, 'viewer')} target="_blank" rel="noreferrer">
        <img src={imageUrl(record.id)} alt={record.alt || ''} />
      </a>

      {errors.length > 0 && (
        <ul className="cms-errors" aria-label="Problems with this photograph">
          {errors.map((error) => <li key={error}>{error.replace(/^photographs\[\d+\] \("[^"]+"\): /, '')}</li>)}
        </ul>
      )}

      <div className="cms-details-actions">
        <button
          type="button"
          className={`cms-button ${record.status === 'draft' ? 'cms-button--primary' : ''}`}
          onClick={() => run((current) => setStatus(current, [record.id], record.status === 'draft' ? 'published' : 'draft'))}
        >
          {record.status === 'draft' ? 'Publish' : 'Unpublish'}
        </button>
        <button type="button" className="cms-button" disabled={record.status !== 'published' || catalog.hero === record.id}
          onClick={() => run((current) => setHero(current, record.id))}>
          {catalog.hero === record.id ? 'Gallery hero' : 'Make hero'}
        </button>
        <span className="cms-order-controls" role="group" aria-label="Curated order">
          <button type="button" className="cms-button" disabled={index === 0} onClick={() => run((c) => movePhotographBy(c, record.id, -1))}>↑ Earlier</button>
          <button type="button" className="cms-button" disabled={index === catalog.photographs.length - 1} onClick={() => run((c) => movePhotographBy(c, record.id, 1))}>Later ↓</button>
        </span>
      </div>

      <Field label="Caption" value={record.caption} invalid={!record.caption} onCommit={(caption) => patch({ caption: caption.trim() })}
        hint="One or two factual words, as on the live gallery." />
      <Field label="Alt text" value={record.alt} invalid={!record.alt} multiline onCommit={(alt) => patch({ alt: alt.trim() })}
        hint="What the photograph shows, for screen readers." />
      <div className="cms-field-row">
        <label className="cms-field">
          <span className="cms-field-label">Collection</span>
          <select value={record.category} onChange={(event) => patch({ category: event.target.value })}>
            {catalog.categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
        </label>
        <label className="cms-field">
          <span className="cms-field-label">Shape</span>
          <select value={record.shape} onChange={(event) => patch({ shape: event.target.value })}>
            <option value="landscape">Landscape</option>
            <option value="portrait">Portrait</option>
          </select>
        </label>
        <label className="cms-field">
          <span className="cms-field-label">Featured</span>
          <select value={record.featured ?? ''} disabled={record.status !== 'published'}
            onChange={(event) => run((current) => setFeatured(current, record.id, event.target.value ? Number(event.target.value) : null))}>
            <option value="">Not featured</option>
            {Array.from({ length: publishedCount + (record.featured ? 0 : 1) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>Position {n}</option>)}
          </select>
        </label>
      </div>
      <Field label="Tags" value={(record.tags ?? []).join(', ')} hint="Comma-separated, for example Night, Water."
        onCommit={(text) => patch({ tags: [...new Set(text.split(',').map((tag) => tag.trim()).filter(Boolean))] })} />

      <fieldset className="cms-fieldset">
        <legend>Identity</legend>
        <Field label="ID" value={record.id} readOnly hint="Fixed: names the image files." />
        <Field label="Slug" value={record.slug} readOnly={wasPublished}
          hint={wasPublished ? 'Published: the link /photography/#slug must keep working.' : 'Deep link: /photography/#slug'}
          onCommit={(slug) => patch({ slug: slug.trim() })} />
        <Field label="Source file" value={record.sourceFilename} readOnly hint="The original kept privately in the CMS workspace or camera archive." />
      </fieldset>

      <MetadataEditor record={record} extracted={generated[record.id]} run={run} />
    </aside>
  );
}
