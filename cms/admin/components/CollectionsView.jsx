import { useState } from 'react';
import {
  addCollection, moveCollection, removeCollection, renameCollection,
} from '../../lib/catalog-ops.mjs';
import { imageUrl } from '../api.js';

// Mirrors the public page: a collection's cover is its first published, non-featured
// photograph in curated order (photographyPage.jsx), so order decides the cover.
function coverOf(catalog, category) {
  const published = catalog.photographs.filter((record) => record.status === 'published' && record.category === category);
  return published.find((record) => !record.featured) ?? published[0] ?? null;
}

function Rename({ name, onRename }) {
  const [value, setValue] = useState(name);
  return (
    <form className="cms-rename" onSubmit={(event) => { event.preventDefault(); if (value.trim() !== name) onRename(value); }}>
      <label className="visually-hidden" htmlFor={`rename-${name}`}>Rename {name}</label>
      <input id={`rename-${name}`} value={value} onChange={(event) => setValue(event.target.value)} />
      <button type="submit" className="cms-link" disabled={value.trim() === name}>Rename</button>
    </form>
  );
}

export default function CollectionsView({ catalog, run, onFilter }) {
  const [name, setName] = useState('');
  return (
    <section className="cms-collections" aria-labelledby="collections-title">
      <h1 id="collections-title" className="cms-title">Collections</h1>
      <p className="cms-lede">Each photograph belongs to one collection. Order here is the order of the collection cards and filters on the public page; a collection’s cover is its first published, non-featured photograph.</p>
      <ol className="cms-collection-list">
        {catalog.categories.map((category, index) => {
          const members = catalog.photographs.filter((record) => record.category === category);
          const cover = coverOf(catalog, category);
          return (
            <li key={category} className="cms-collection">
              <span className="cms-collection-cover">{cover ? <img src={imageUrl(cover.id)} alt="" /> : <span>No published cover</span>}</span>
              <div className="cms-collection-body">
                <h2>{category}</h2>
                <p className="mono">{members.length} photographs · {members.filter(({ status }) => status === 'published').length} published{cover ? ` · cover ${cover.id}` : ''}</p>
                <Rename key={category} name={category} onRename={(value) => run((c) => renameCollection(c, category, value))} />
              </div>
              <div className="cms-collection-actions">
                <button type="button" className="cms-button" onClick={() => onFilter(category)}>Show photographs</button>
                <span role="group" aria-label={`Move ${category}`}>
                  <button type="button" className="cms-button" disabled={index === 0} onClick={() => run((c) => moveCollection(c, category, index - 1))} aria-label={`Move ${category} earlier`}>↑</button>
                  <button type="button" className="cms-button" disabled={index === catalog.categories.length - 1} onClick={() => run((c) => moveCollection(c, category, index + 1))} aria-label={`Move ${category} later`}>↓</button>
                </span>
                <button type="button" className="cms-button cms-button--danger" disabled={members.length > 0} title={members.length ? 'Move its photographs elsewhere first' : undefined}
                  onClick={() => run((c) => removeCollection(c, category))}>Remove</button>
              </div>
            </li>
          );
        })}
      </ol>
      <form className="cms-add-collection" onSubmit={(event) => { event.preventDefault(); run((c) => addCollection(c, name)); setName(''); }}>
        <label className="cms-field">
          <span className="cms-field-label">New collection</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" />
        </label>
        <button type="submit" className="cms-button" disabled={!name.trim()}>Add</button>
      </form>
    </section>
  );
}
