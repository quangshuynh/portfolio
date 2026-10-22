const VIEWS = [
  ['library', 'Library'],
  ['collections', 'Collections'],
  ['publish', 'Publish'],
];

const SAVE_LABELS = {
  saved: 'All changes saved',
  saving: 'Saving…',
  unsaved: 'Unsaved changes',
  error: 'Not saved',
  conflict: 'Changed elsewhere',
};

export function SaveStatus({ save, onRetry, onReload }) {
  return (
    <div className={`cms-save cms-save--${save.status}`} role="status" aria-live="polite">
      <span className="cms-save-dot" aria-hidden="true" />
      <span>{SAVE_LABELS[save.status]}</span>
      {save.status === 'error' && <button type="button" className="cms-link" onClick={onRetry}>Retry</button>}
      {save.status === 'conflict' && <button type="button" className="cms-link" onClick={onReload}>Reload</button>}
    </div>
  );
}

export default function Sidebar({ view, onView, pending, problems, save, onRetry, onReload, theme, onTheme, onSignOut }) {
  return (
    <aside className="cms-sidebar" aria-label="CMS">
      <div className="cms-brand">
        <span className="mono">quanghuynh.com</span>
        <strong>Photography</strong>
        <span className="cms-local-badge" title="This dashboard runs only on this computer">Local CMS</span>
      </div>
      <nav className="cms-nav">
        {VIEWS.map(([id, label]) => (
          <button key={id} type="button" className="cms-nav-item" aria-current={view === id ? 'page' : undefined} onClick={() => onView(id)}>
            <span>{label}</span>
            {id === 'publish' && (pending > 0 || problems > 0) && (
              <span className={`cms-count ${problems ? 'cms-count--warn' : ''}`}>{problems || pending}</span>
            )}
          </button>
        ))}
        <a className="cms-nav-item" href="/photography/" target="_blank" rel="noreferrer">
          <span>Preview gallery</span><span aria-hidden="true">↗</span>
        </a>
      </nav>
      <div className="cms-sidebar-foot">
        <SaveStatus save={save} onRetry={onRetry} onReload={onReload} />
        <div className="cms-sidebar-actions">
          <button type="button" className="cms-link" onClick={onTheme} aria-pressed={theme === 'light'}>
            {theme === 'light' ? 'Dark theme' : 'Light theme'}
          </button>
          <button type="button" className="cms-link" onClick={onSignOut}>Sign out</button>
        </div>
      </div>
    </aside>
  );
}
