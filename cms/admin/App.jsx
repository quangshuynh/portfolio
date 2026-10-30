import { useCallback, useEffect, useMemo, useState } from 'react';
import { movePhotograph } from '../lib/catalog-ops.mjs';
import { api } from './api.js';
import BulkBar from './components/BulkBar.jsx';
import CollectionsView from './components/CollectionsView.jsx';
import DetailsPanel from './components/DetailsPanel.jsx';
import PhotoGrid from './components/PhotoGrid.jsx';
import PublishView from './components/PublishView.jsx';
import Sidebar from './components/Sidebar.jsx';
import StatsBar from './components/StatsBar.jsx';
import Toolbar from './components/Toolbar.jsx';
import UploadPanel from './components/UploadPanel.jsx';
import WatermarkView from './components/WatermarkView.jsx';
import { useWorkspace } from './useWorkspace.js';

const THEME_KEY = 'portfolio-theme';

function matches(record, { query, status, category }, problems) {
  if (category !== 'all' && record.category !== category) return false;
  if (status === 'featured' && !record.featured) return false;
  if (status === 'problems' && !problems.drafts[record.id] && !problems.publication.some((error) => error.includes(`("${record.id}")`))) return false;
  if (['published', 'draft'].includes(status) && record.status !== status) return false;
  const text = query.trim().toLowerCase();
  if (!text) return true;
  return [record.id, record.caption, record.alt, record.category, ...(record.tags ?? [])].some((value) => String(value).toLowerCase().includes(text));
}

export default function App() {
  const [expired, setExpired] = useState(false);
  const onSessionExpired = useCallback(() => setExpired(true), []);
  const ws = useWorkspace({ onSessionExpired });
  // #watermark (the end of a bulk watermark run) opens the Watermark view.
  const [view, setView] = useState(() => (window.location.hash === '#watermark' ? 'watermark' : 'library'));
  const [filters, setFilters] = useState({ query: '', status: 'all', category: 'all' });
  const [layout, setLayout] = useState('grid');
  const [selection, setSelection] = useState(() => new Set());
  // #photo=<id> or #review=<id> (links back from QuangEdit) opens that photograph's details.
  const hashId = () => window.location.hash.match(/^#(?:photo|review)=([A-Za-z0-9_-]+)$/)?.[1] ?? null;
  const [activeId, setActiveId] = useState(hashId);
  useEffect(() => {
    const onHash = () => { const id = hashId(); if (id) { setActiveId(id); setView('library'); } else if (window.location.hash === '#watermark') setView('watermark'); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [notice, setNotice] = useState(null);
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'dark');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* storage unavailable */ }
  }, [theme]);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), notice.tone === 'error' ? 8000 : 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const run = useCallback((operation) => {
    try {
      ws.apply(operation);
    } catch (error) {
      setNotice({ tone: 'error', text: error.message });
    }
  }, [ws]);

  const items = useMemo(() => (ws.catalog && ws.derived
    ? ws.catalog.photographs.filter((record) => matches(record, filters, ws.derived.problems)) : []), [ws.catalog, ws.derived, filters]);

  if (expired) {
    return (
      <main className="cms-message">
        <h1>Session ended</h1>
        <p>Open the sign-in link printed by <code>npm run cms</code> again. Unsaved edits were kept in this browser and will be offered back after you sign in.</p>
      </main>
    );
  }
  if (ws.loadError) {
    return (
      <main className="cms-message">
        <h1>The workspace could not be loaded</h1>
        <p>{ws.loadError.message}</p>
        <button type="button" className="cms-button" onClick={ws.reload}>Try again</button>
      </main>
    );
  }
  if (!ws.catalog || !ws.derived) return <main className="cms-message" aria-busy="true"><p>Loading the workspace…</p></main>;

  const { catalog, server, derived } = ws;
  const active = catalog.photographs.find(({ id }) => id === activeId) ?? null;
  // Reordering acts on the whole curated sequence; while filtered, moves still land at the
  // dropped photograph's place in that sequence.
  const toggle = (id) => setSelection((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <div className={`cms-shell ${active && view === 'library' ? 'has-details' : ''}`}>
      <Sidebar
        view={view}
        onView={setView}
        pending={derived.summary.count}
        problems={derived.problems.publication.length}
        save={ws.save}
        onRetry={ws.flush}
        onReload={ws.reload}
        theme={theme}
        onTheme={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))}
        onSignOut={async () => { await api.signOut(); setExpired(true); }}
      />
      <main className="cms-main" id="main-content">
        {ws.recovered && (
          <div className="cms-banner" role="alert">
            Edits from an earlier session were not saved.
            <button type="button" className="cms-button" onClick={ws.restoreBackup}>Restore them</button>
            <button type="button" className="cms-link" onClick={ws.dismissBackup}>Discard</button>
          </div>
        )}
        <StatsBar catalog={catalog} derived={derived} onShowChanges={() => setView('publish')}
          onShowProblems={() => { setView('library'); setFilters({ ...filters, status: 'problems' }); }} />

        {view === 'library' && (
          <>
            <header className="cms-library-head">
              <h1 className="cms-title">Library</h1>
              <p className="cms-lede">Curated order, as on /photography. Drag to reorder, or use the arrows. Changes stay in this workspace until you publish.</p>
            </header>
            <Toolbar filters={filters} onFilters={setFilters} categories={catalog.categories} layout={layout} onLayout={setLayout} onUpload={() => setUploadOpen(true)} />
            <BulkBar selection={selection} catalog={catalog} run={run} onClear={() => setSelection(new Set())}
              onSelectAll={() => setSelection(new Set(items.map(({ id }) => id)))} />
            <PhotoGrid
              items={items}
              layout={layout}
              catalog={catalog}
              selection={selection}
              activeId={activeId}
              problems={derived.problems}
              reorderable
              onToggle={toggle}
              onOpen={setActiveId}
              onMove={(id, index) => run((current) => movePhotograph(current, id, index))}
              treatments={server.treatments}
            />
          </>
        )}
        {view === 'collections' && (
          <CollectionsView catalog={catalog} run={run} onFilter={(category) => { setFilters({ query: '', status: 'all', category }); setView('library'); }} />
        )}
        {view === 'publish' && <PublishView ws={ws} onNotice={setNotice} />}
        {view === 'watermark' && <WatermarkView onNotice={setNotice} onChanged={() => ws.refresh().catch(() => {})} />}
      </main>

      {view === 'library' && active && (
        <DetailsPanel record={active} catalog={catalog} base={server.base} generated={server.generated}
          problems={derived.problems} run={run} onClose={() => setActiveId(null)}
          beforeLeave={ws.flush} onNotice={setNotice} onTreatmentChanged={() => ws.refresh().catch(() => {})} />
      )}
      <UploadPanel
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        beforeUpload={ws.flush}
        onSessionExpired={onSessionExpired}
        onUploaded={(data) => { ws.replace(data); if (!data.duplicate) setActiveId(data.id); }}
      />
      {notice && <div className={`cms-toast cms-toast--${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</div>}
    </div>
  );
}
