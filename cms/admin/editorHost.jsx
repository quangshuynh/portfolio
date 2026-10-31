// The CMS host for QuangEdit (EditorApp's `host` prop): loads a photograph's editing
// source and saved treatment from the private workspace, and saves and renders back to it.
// Saving a treatment, approving it and publishing the photograph stay separate steps:
// approval happens in the CMS review, publication through a pull request.
//
// Bulk watermarking (the CMS's Watermark view) runs this same editor once per photograph: the
// queue in localStorage (so a closed tab can resume) lists the photos and the watermark settings
// of each; for each, the page loads the photo and its treatment as usual, adds the watermark,
// saves the treatment and renders it from the original (a draft, never approved here), then opens
// the next photo. Photos with unapproved edits, or already staged with the same settings, are
// left as they are (cms/lib/watermark-rules.mjs). Nothing is published.
// Automatic drafts (WatermarkAutopilot.jsx) run the same queue with `mode: 'auto'` in an
// off-screen frame of the CMS: there the watermark joins the photo's own edits (review covers
// both), and the frame tells the CMS when the run ends instead of navigating back to it.
// A merged HDR is merged again first, from its three exposures (matched by content hash) with
// the saved roles and settings, so the saved edits and the watermark land on the same merge.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { normalizeWatermark, watermarksEqual } from '../../src/editor/watermark/watermark.mjs';
import { RAW_ACCEPT, RAW_SUPPORT } from '../../src/editor/raw/rawFormat.mjs';
import { ApiError, treatments, watermark as watermarkApi } from './api.js';
import { watermarkTreatmentState } from '../lib/watermark-rules.mjs';

export const WATERMARK_QUEUE_KEY = 'cms-watermark-queue';
/** The bulk watermark queue: { ids, settings: { id: settings }, index, results: [{ id, outcome, message }], stopped }, or null. */
export function readWatermarkQueue() {
  try {
    const queue = JSON.parse(localStorage.getItem(WATERMARK_QUEUE_KEY) ?? 'null');
    return queue && Array.isArray(queue.ids) && Number.isInteger(queue.index) ? queue : null;
  } catch {
    return null;
  }
}
export const writeWatermarkQueue = (queue) => { try { localStorage.setItem(WATERMARK_QUEUE_KEY, JSON.stringify(queue)); } catch { /* the queue stops */ } };
export const clearWatermarkQueue = () => { try { localStorage.removeItem(WATERMARK_QUEUE_KEY); } catch { /* nothing kept */ } };
export const queueEditorHref = (id) => `/admin/photography/editor/?photo=${encodeURIComponent(id)}&queue=watermark`;
/** Posted by an automatic run's frame to the CMS when the queue has ended. */
export const QUEUE_DONE_MESSAGE = 'cms-watermark-queue-done';
// Photographs open in QuangEdit (another tab): automatic drafts leave them alone.
const OPEN_KEY = 'cms-editor-open';
export function openInEditor(now = Date.now()) {
  try {
    const open = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}');
    return new Set(Object.entries(open).filter(([, at]) => now - at < 30_000).map(([id]) => id));
  } catch {
    return new Set();
  }
}
function markOpen(photoId) {
  try {
    const open = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}');
    localStorage.setItem(OPEN_KEY, JSON.stringify({ ...Object.fromEntries(Object.entries(open).filter(([, at]) => Date.now() - at < 30_000)), [photoId]: Date.now() }));
  } catch { /* best effort */ }
}

const SOURCE_KINDS = {
  attached: 'attached editing source',
  original: 'uploaded original',
  library: 'camera library original (read in place)',
  derivative: 'public 2200 px image only',
};
const STATUS_LABELS = { none: 'No treatment saved', draft: 'Draft treatment (not approved)', approved: 'Approved treatment', rejected: 'Rejected treatment' };

const isHdrTreatment = (info) => Boolean(info?.treatment?.document?.photos[0]?.source.hdr);

// What the treatment does, ignoring when it was saved.
const comparable = (text) => {
  const { savedAt, ...rest } = JSON.parse(text);
  return JSON.stringify(rest);
};

export function createCmsHost(photoId) {
  const shared = { info: null, listeners: new Set() };
  const queue = new URLSearchParams(window.location.search).get('queue') === 'watermark' ? readWatermarkQueue() : null;
  const queued = queue && queue.ids[queue.index] === photoId ? queue : null;
  const publish = (info) => {
    shared.info = info;
    shared.listeners.forEach((listener) => listener(info));
  };
  return {
    title: 'QuangEdit',
    backHref: `/admin/photography/#photo=${encodeURIComponent(photoId)}`,
    backLabel: 'CMS',
    privacyNote: 'Local CMS session. Treatments save to your private workspace; nothing is published.',
    async load() {
      const info = await treatments.describe(photoId);
      publish(info);
      const usable = info.sources.filter(({ available }) => available);
      if (!usable.length) throw new Error(info.sources[0]?.problem ?? 'This photograph has no source file to edit. Attach one below.');
      const files = [];
      for (const source of usable) {
        const blob = await treatments.source(photoId, source.index);
        files.push(new File([blob], source.name, { lastModified: 0 }));
      }
      const document = info.treatment.document ? JSON.stringify({ ...info.treatment.document, savedAt: info.treatment.updatedAt }) : null;
      const preference = await watermarkApi.preference().catch(() => null);
      return { files, document, watermark: preference?.settings ?? null };
    },
    // "Save as CMS global preference" in the Watermark section: used for photos watermarked from now on.
    saveWatermarkDefault: async (settings) => (await watermarkApi.savePreference(settings)).settings,
    Panel: (props) => <TreatmentPanel {...props} photoId={photoId} shared={shared} publish={publish} queue={queued} />,
  };
}

function TreatmentPanel({ photoId, shared, publish, status, photo, documentFor, render, cancelRender, openHdrMerge, restoreHdr, setNotice, applySettings, queue }) {
  const [info, setInfo] = useState(shared.info);
  const [busy, setBusy] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [savedText, setSavedText] = useState(null);
  const attachRef = useRef(null);
  useEffect(() => {
    const listener = (next) => setInfo(next);
    shared.listeners.add(listener);
    return () => shared.listeners.delete(listener);
  }, [shared]);

  const current = photo ? documentFor(photo) : null;
  // The first ready state after loading is the saved treatment (or the untouched photo).
  useEffect(() => {
    if (current && savedText === null) setSavedText(comparable(current));
  }, [current, savedText]);
  const dirty = Boolean(current && savedText !== null && comparable(current) !== savedText);
  const treatment = info?.treatment;

  const report = useCallback((caught) => {
    setError(caught instanceof ApiError && caught.status === 401
      ? 'The CMS session ended. Open the sign-in link printed by `npm run cms`, then save again; your edits are still here.'
      : caught.message);
  }, []);

  const save = useCallback(async () => {
    if (!photo) return null;
    setError(null);
    setBusy('save');
    try {
      const text = documentFor(photo);
      const next = await treatments.save(photoId, text, shared.info.treatment.revision);
      publish(next);
      setSavedText(comparable(text));
      setNotice({ tone: 'info', text: 'Treatment saved to the CMS workspace (not approved, not published).' });
      return next;
    } catch (caught) {
      report(caught);
      return null;
    } finally {
      setBusy(null);
    }
  }, [photo, documentFor, photoId, shared, publish, setNotice, report]);

  // `forceSave`: bulk watermarking saves the treatment it is about to render in every case.
  const renderForPortfolio = useCallback(async ({ forceSave = false } = {}) => {
    if (!photo) return false;
    const saved = forceSave === true || dirty || !shared.info.treatment.document ? await save() : shared.info;
    if (!saved) return false;
    setError(null);
    setBusy('render');
    setProgress({ stage: 'rendering', fraction: 0 });
    try {
      const result = await render(photo, { onProgress: (next) => setProgress(next) });
      setProgress({ stage: 'uploading', fraction: 1 });
      const { treatment: latest } = shared.info;
      const next = await treatments.render(photoId, result.blob, { name: result.fileName, documentHash: latest.documentHash, revision: latest.revision });
      publish(next);
      setNotice({ tone: 'info', text: `Rendered ${result.width}×${result.height} from the original and staged the portfolio images. Review and approve it in the CMS.` });
      return true;
    } catch (caught) {
      if (caught.code !== 'cancelled') report(caught);
      return false;
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }, [photo, dirty, save, shared, render, photoId, publish, setNotice, report]);

  const attach = useCallback(async (files) => {
    setError(null);
    setBusy('attach');
    try {
      let next = shared.info;
      for (const file of files) next = await treatments.attach(photoId, file, next.treatment.revision);
      publish(next);
      setNotice({ tone: 'info', text: 'Attached. Reloading the editor with the new source…' });
      window.location.reload();
    } catch (caught) {
      report(caught);
    } finally {
      setBusy(null);
    }
  }, [shared, photoId, publish, setNotice, report]);

  // Bulk watermarking: add the queued settings, then save and render once the photo has them.
  const [queueStage, setQueueStage] = useState(queue ? 'waiting' : null);
  const target = useMemo(() => (queue ? normalizeWatermark(queue.settings?.[photoId] ?? null) : null), [queue, photoId]);
  const leaving = useRef(false);
  const merging = useRef(null);
  const finishQueued = useCallback((outcome, message = '') => {
    const latest = readWatermarkQueue() ?? queue;
    const next = { ...latest, index: latest.index + 1, results: [...(latest.results ?? []).filter(({ id }) => id !== photoId), { id: photoId, outcome, message }] };
    writeWatermarkQueue(next);
    setQueueStage('done');
    // The treatment is saved; leave without the unsaved-changes prompt.
    leaving.current = true;
    const nextHref = next.index < next.ids.length && !next.stopped ? queueEditorHref(next.ids[next.index]) : null;
    if (latest.mode === 'auto' && window.parent !== window) {
      if (nextHref) window.location.assign(nextHref);
      else window.parent.postMessage({ type: QUEUE_DONE_MESSAGE }, window.location.origin);
      return;
    }
    window.location.assign(nextHref ?? '/admin/photography/#watermark');
  }, [queue, photoId]);
  useEffect(() => {
    if (queueStage !== 'waiting') return;
    if (status?.state === 'error') { finishQueued('failed', status.message); return; }
    if (status?.state !== 'ready' || !photo || !info) return;
    if (!target) { finishQueued('failed', 'No watermark settings were queued for this photograph.'); return; }
    if (info.sources?.[0]?.limited) { finishQueued('skipped', 'Only the 2200 px public image is available; attach the original first.'); return; }
    if (isHdrTreatment(info) && !photo.hdr) {
      if (!restoreHdr) { finishQueued('skipped', 'HDR treatment: open it, Merge HDR, then add the watermark.'); return; }
      setQueueStage('merging');
      setProgress({ stage: 'decoding', fraction: 0 });
      const job = restoreHdr((next) => setProgress(next));
      merging.current = job;
      job.promise.then(() => setQueueStage('waiting'), (failure) => {
        if (failure.code !== 'cancelled') finishQueued('failed', `Merge HDR: ${failure.message}`);
      }).finally(() => { merging.current = null; setProgress(null); });
      return;
    }
    // The merge must be the saved one (same exposures and settings), or the saved edits would not apply.
    if (isHdrTreatment(info) && !photo.restored) { finishQueued('failed', 'The merged HDR does not match the saved treatment; open it in QuangEdit and Merge HDR by hand.'); return; }
    const state = watermarkTreatmentState(info.treatment, target);

    if (state.unapprovedEdits && queue.mode !== 'auto') { finishQueued('skipped', 'Its treatment has edits that are not approved; approve or discard them first.'); return; }
    if (state.upToDate) { finishQueued('unchanged', 'Already staged with these watermark settings.'); return; }
    applySettings({ watermark: target });
    setQueueStage('applied');
  }, [queueStage, status, photo, info, target, applySettings, finishQueued, restoreHdr]);
  // Leaving the page (a cancelled automatic run unloads this frame) stops a merge in progress.
  useEffect(() => () => merging.current?.cancel(), []);
  useEffect(() => {
    if (queueStage !== 'applied' || !photo || !watermarksEqual(photo.history.present.watermark ?? null, target)) return;
    setQueueStage('rendering');
    renderForPortfolio({ forceSave: true }).then((ok) => finishQueued(ok ? 'staged' : 'failed', ok ? '' : 'Saving or rendering failed; open the photograph to see why.'));
  }, [queueStage, photo, target, renderForPortfolio, finishQueued]);
  // Stops after this photograph; the rest stay queued and can be resumed from the Watermark view.
  const stopQueue = useCallback(() => {
    const latest = readWatermarkQueue();
    if (latest) writeWatermarkQueue({ ...latest, stopped: true });
  }, []);

  // Tell automatic drafts (in the CMS tab) that this photograph is being edited here.
  useEffect(() => {
    if (queue) return undefined;
    markOpen(photoId);
    const timer = setInterval(() => markOpen(photoId), 10_000);
    return () => clearInterval(timer);
  }, [queue, photoId]);

  useEffect(() => {
    const warn = (event) => { if ((dirty || busy) && !leaving.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy]);

  const source = info?.sources?.[0];
  const hdrTreatment = isHdrTreatment(info);
  const percent = progress?.fraction != null ? Math.round(progress.fraction * 100) : null;
  const statusLine = useMemo(() => {
    if (!treatment) return '';
    const parts = [STATUS_LABELS[treatment.status]];
    if (treatment.document) parts.push(info.renderFresh ? 'render up to date' : treatment.render ? 'render out of date' : 'not rendered');
    if (treatment.approved && treatment.status !== 'approved') parts.push('an earlier approved treatment stands');
    return parts.join(' · ');
  }, [treatment, info]);

  return (
    <section className="cms-host" aria-label="CMS treatment">
      <div className="cms-host__info">
        <strong className="cms-host__title">{info ? (info.photo.caption || info.photo.id) : 'Loading…'}</strong>
        {info && (
          <span className="cms-host__meta mono">
            {info.photo.status === 'published' ? 'Published photograph' : 'Draft photograph'}
            {source && ` · ${info.sources.length > 1 ? `${info.sources.length} sources` : source.name} (${SOURCE_KINDS[source.kind]})`}
          </span>
        )}
        {treatment && <span className="cms-host__status" role="status">{statusLine}{dirty ? ' · unsaved changes' : ''}</span>}
      </div>
      {queue && queueStage && (
        <p className="cms-host__note" role="status" data-watermark-queue={queueStage}>
          Bulk watermarking: photograph {queue.index + 1} of {queue.ids.length}. {queueStage === 'rendering' ? 'Saving and rendering the draft…' : queueStage === 'merging' ? `Merging the HDR exposures${percent != null ? ` ${percent}%` : '…'}` : queueStage === 'done' ? 'Opening the next photograph…' : 'Loading…'}

          {' '}<button type="button" className="pe-text-button" onClick={stopQueue}>Stop after this photograph</button> (the rest can be resumed)
        </p>
      )}
      <div className="cms-host__actions">
        <button type="button" className="pe-button pe-button--primary" onClick={save} disabled={!photo || Boolean(busy) || status?.state !== 'ready'}>
          {busy === 'save' ? 'Saving…' : 'Save treatment'}
        </button>
        <button type="button" className="pe-button" onClick={renderForPortfolio} disabled={!photo || Boolean(busy) || status?.state !== 'ready'}>
          {busy === 'render' ? `Rendering${percent != null ? ` ${percent}%` : '…'}` : 'Render for portfolio'}
        </button>
        {busy === 'render' && progress?.stage !== 'uploading' && <button type="button" className="pe-button" onClick={cancelRender}>Cancel</button>}
        <a className="pe-button" href={`/admin/photography/#review=${encodeURIComponent(photoId)}`}>Review in CMS</a>
        <button type="button" className="pe-button" onClick={() => attachRef.current?.click()} disabled={Boolean(busy)}
          title={`Attach the original (JPEG, PNG, WebP or RAW: ${RAW_SUPPORT}), or three bracketed exposures for HDR`}>
          Attach source…
        </button>
        <input ref={attachRef} type="file" hidden multiple accept={[".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp", ...RAW_ACCEPT].join(",")}
          onChange={(event) => { const files = [...event.target.files]; event.target.value = ''; if (files.length) attach(files); }} />
      </div>
      {status?.state === 'error' && <p className="cms-host__note cms-host__note--error" role="alert">{status.message}</p>}
      {source?.limited && <p className="cms-host__note" role="note">{source.problem}</p>}
      {info?.staleSource && <p className="cms-host__note cms-host__note--error" role="alert">The saved treatment was made from a different file than this photograph's current source (moved, replaced or re-exported). It is kept; attach the original file it was made from to apply it.</p>}
      {hdrTreatment && !photo?.hdr && status?.state === 'ready' && (
        <p className="cms-host__note" role="note">This treatment is a merged HDR. <button type="button" className="pe-text-button" onClick={openHdrMerge}>Merge HDR</button> with the three exposures; the saved merge settings and edits are restored.</p>
      )}
      {error && <p className="cms-host__note cms-host__note--error" role="alert">{error}</p>}
    </section>
  );
}
