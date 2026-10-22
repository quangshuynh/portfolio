import { removeDrafts, setCollection, setStatus } from '../../lib/catalog-ops.mjs';

export default function BulkBar({ selection, catalog, run, onClear, onSelectAll }) {
  if (!selection.size) return null;
  const ids = [...selection];
  const records = catalog.photographs.filter(({ id }) => selection.has(id));
  const allDrafts = records.every(({ status }) => status === 'draft');
  return (
    <div className="cms-bulk" role="region" aria-label="Selected photographs">
      <strong>{selection.size} selected</strong>
      <button type="button" className="cms-button" onClick={() => run((c) => setStatus(c, ids, 'published'))}>Publish</button>
      <button type="button" className="cms-button" onClick={() => run((c) => setStatus(c, ids, 'draft'))}>Unpublish</button>
      <label className="cms-select">
        <span className="visually-hidden">Move to collection</span>
        <select value="" onChange={(event) => event.target.value && run((c) => setCollection(c, ids, event.target.value))}>
          <option value="">Move to collection…</option>
          {catalog.categories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
      </label>
      {allDrafts && (
        <button
          type="button"
          className="cms-button cms-button--danger"
          onClick={() => window.confirm(`Remove ${ids.length} draft${ids.length === 1 ? '' : 's'} from the workspace? Uploaded originals are kept.`)
            && (run((c) => removeDrafts(c, ids)), onClear())}
        >
          Remove drafts
        </button>
      )}
      <button type="button" className="cms-link" onClick={onSelectAll}>Select all shown</button>
      <button type="button" className="cms-link" onClick={onClear}>Clear</button>
    </div>
  );
}
