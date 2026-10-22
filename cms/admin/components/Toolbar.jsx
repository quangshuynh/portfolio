export default function Toolbar({ filters, onFilters, categories, layout, onLayout, onUpload }) {
  const set = (key) => (event) => onFilters({ ...filters, [key]: event.target.value });
  return (
    <div className="cms-toolbar" role="search">
      <label className="cms-search">
        <span className="visually-hidden">Search photographs</span>
        <input type="search" placeholder="Search caption, alt text, id, tag" value={filters.query} onChange={set('query')} />
      </label>
      <label className="cms-select">
        <span className="visually-hidden">Status</span>
        <select value={filters.status} onChange={set('status')}>
          <option value="all">All statuses</option>
          <option value="published">Published</option>
          <option value="draft">Drafts</option>
          <option value="featured">Featured</option>
          <option value="problems">Needs attention</option>
        </select>
      </label>
      <label className="cms-select">
        <span className="visually-hidden">Collection</span>
        <select value={filters.category} onChange={set('category')}>
          <option value="all">All collections</option>
          {categories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
      </label>
      <div className="cms-segmented" role="group" aria-label="Layout">
        <button type="button" aria-pressed={layout === 'grid'} onClick={() => onLayout('grid')}>Grid</button>
        <button type="button" aria-pressed={layout === 'list'} onClick={() => onLayout('list')}>List</button>
      </div>
      <button type="button" className="cms-button cms-button--primary" onClick={onUpload}>Upload</button>
    </div>
  );
}
