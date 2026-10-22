import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { workspaceProblems } from '../lib/catalog-ops.mjs';
import { summarizeChanges } from '../lib/changes.mjs';
import { api } from './api.js';

const BACKUP_KEY = 'photography-cms-unsaved';
const SAVE_DELAY_MS = 400;

function readBackup() {
  try { return JSON.parse(localStorage.getItem(BACKUP_KEY)); } catch { return null; }
}
function writeBackup(value) {
  try {
    if (value) localStorage.setItem(BACKUP_KEY, JSON.stringify(value));
    else localStorage.removeItem(BACKUP_KEY);
  } catch { /* storage unavailable: the server copy is still the source of truth */ }
}

/**
 * Workspace state with optimistic local edits. Every edit applies the shared catalog
 * operations immediately, then saves after a short pause. A failed save keeps the edit
 * (and a local backup) and offers a retry; it never silently drops changes.
 */
export function useWorkspace({ onSessionExpired }) {
  const [server, setServer] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [save, setSave] = useState({ status: 'saved' });
  const [loadError, setLoadError] = useState(null);
  const [recovered, setRecovered] = useState(null);
  const revision = useRef(null);
  const latest = useRef(null);
  const timer = useRef(null);
  const saving = useRef(false);
  const serverRef = useRef(null);

  const accept = useCallback((data) => {
    setServer(data);
    serverRef.current = data;
    revision.current = data.revision;
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await api.workspace();
      accept(data);
      setCatalog(data.catalog);
      latest.current = data.catalog;
      const backup = readBackup();
      if (backup && backup.revision === data.revision && JSON.stringify(backup.catalog) !== JSON.stringify(data.catalog)) setRecovered(backup);
      else writeBackup(null);
      setLoadError(null);
    } catch (error) {
      if (error.status === 401) onSessionExpired();
      setLoadError(error);
    }
  }, [accept, onSessionExpired]);

  useEffect(() => { load(); }, [load]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (saving.current || !latest.current) return;
    const sent = latest.current;
    if (serverRef.current && JSON.stringify(sent) === JSON.stringify(serverRef.current.catalog)) {
      setSave({ status: 'saved' });
      writeBackup(null);
      return;
    }
    saving.current = true;
    setSave({ status: 'saving' });
    try {
      const data = await api.saveCatalog(sent, revision.current);
      accept(data);
      if (latest.current === sent) {
        setSave({ status: 'saved', at: new Date() });
        writeBackup(null);
      } else {
        timer.current = setTimeout(() => flush(), 0);
      }
    } catch (error) {
      if (error.status === 401) onSessionExpired();
      if (error.code === 'identity') {
        // The server refused an edit that would break a published URL: go back to its copy.
        setCatalog(serverRef.current.catalog);
        latest.current = serverRef.current.catalog;
        writeBackup(null);
      }
      setSave({ status: error.code === 'stale-revision' ? 'conflict' : 'error', error });
    } finally {
      saving.current = false;
    }
  }, [accept, onSessionExpired]);

  /** Applies one shared catalog operation; throws its CatalogEditError to the caller. */
  const apply = useCallback((operation) => {
    const next = operation(latest.current);
    if (next === latest.current) return;
    latest.current = next;
    setCatalog(next);
    setSave({ status: 'unsaved' });
    writeBackup({ revision: revision.current, catalog: next });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(), SAVE_DELAY_MS);
  }, [flush]);

  /** Replaces local state with a server response (uploads, publication, discard). */
  const replace = useCallback((data) => {
    accept(data);
    setCatalog(data.catalog);
    latest.current = data.catalog;
    setSave({ status: 'saved', at: new Date() });
    writeBackup(null);
  }, [accept]);

  const restoreBackup = useCallback(() => {
    if (!recovered) return;
    apply(() => recovered.catalog);
    setRecovered(null);
  }, [apply, recovered]);

  const dismissBackup = useCallback(() => {
    writeBackup(null);
    setRecovered(null);
  }, []);

  const derived = useMemo(() => (catalog && server ? {
    problems: workspaceProblems(catalog, { base: server.base }),
    summary: summarizeChanges(server.base, catalog),
  } : null), [catalog, server]);

  return { server, catalog, save, loadError, derived, recovered, apply, flush, replace, reload: load, restoreBackup, dismissBackup };
}
