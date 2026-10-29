// The CMS host for QuangEdit (EditorApp's `host` prop): loads a photograph's editing
// source and saved treatment from the private workspace, and saves and renders back to it.
// Saving a treatment, approving it and publishing the photograph stay separate steps:
// approval happens in the CMS review, publication through a pull request.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, treatments } from './api.js';

const SOURCE_KINDS = {
  attached: 'attached editing source',
  original: 'uploaded original',
  library: 'camera library original (read in place)',
  derivative: 'public 2200 px image only',
};
const STATUS_LABELS = { none: 'No treatment saved', draft: 'Draft treatment (not approved)', approved: 'Approved treatment', rejected: 'Rejected treatment' };

// What the treatment does, ignoring when it was saved.
const comparable = (text) => {
  const { savedAt, ...rest } = JSON.parse(text);
  return JSON.stringify(rest);
};

export function createCmsHost(photoId) {
  const shared = { info: null, listeners: new Set() };
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
      return { files, document };
    },
    Panel: (props) => <TreatmentPanel {...props} photoId={photoId} shared={shared} publish={publish} />,
  };
}

function TreatmentPanel({ photoId, shared, publish, status, photo, documentFor, render, cancelRender, openHdrMerge, setNotice }) {
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

  const renderForPortfolio = useCallback(async () => {
    if (!photo) return;
    const saved = dirty || !shared.info.treatment.document ? await save() : shared.info;
    if (!saved) return;
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
    } catch (caught) {
      if (caught.code !== 'cancelled') report(caught);
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

  useEffect(() => {
    const warn = (event) => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy]);

  const source = info?.sources?.[0];
  const isHdrTreatment = Boolean(treatment?.document?.photos[0]?.source.hdr);
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
          title="Attach the original (JPEG, PNG, WebP, ARW or DNG), or three bracketed exposures for HDR">
          Attach source…
        </button>
        <input ref={attachRef} type="file" hidden multiple accept=".jpg,.jpeg,.png,.webp,.arw,.dng,image/jpeg,image/png,image/webp"
          onChange={(event) => { const files = [...event.target.files]; event.target.value = ''; if (files.length) attach(files); }} />
      </div>
      {status?.state === 'error' && <p className="cms-host__note cms-host__note--error" role="alert">{status.message}</p>}
      {source?.limited && <p className="cms-host__note" role="note">{source.problem}</p>}
      {info?.staleSource && <p className="cms-host__note cms-host__note--error" role="alert">The saved treatment was made from a different file than this photograph's current source (moved, replaced or re-exported). It is kept; attach the original file it was made from to apply it.</p>}
      {isHdrTreatment && !photo?.hdr && status?.state === 'ready' && (
        <p className="cms-host__note" role="note">This treatment is a merged HDR. <button type="button" className="pe-text-button" onClick={openHdrMerge}>Merge HDR</button> with the three exposures; the saved merge settings and edits are restored.</p>
      )}
      {error && <p className="cms-host__note cms-host__note--error" role="alert">{error}</p>}
    </section>
  );
}
