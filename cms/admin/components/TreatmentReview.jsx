import { useCallback, useEffect, useId, useRef, useState } from 'react';
import useFullscreen from '../../../src/components/utilities/useFullscreen';
import { ApiError, editorUrl, treatmentImageUrl, treatments } from '../api.js';
import { matchedOriginalUrl } from '../matchedOriginal.js';

const STATUS = {
  none: ['No treatment', 'Not edited in QuangEdit yet.'],
  draft: ['Draft treatment', 'Saved, not approved. Publication ignores it.'],
  approved: ['Approved treatment', 'Its render replaces the public image at the next publication.'],
  rejected: ['Rejected treatment', 'Kept for reference; publication ignores it.'],
};

// Neutral values the editor always writes; anything else in the document is an edit.
const ALWAYS_WRITTEN = new Set(['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'temperature', 'tint', 'vibrance', 'saturation']);

/** A short, human summary of a treatment's settings. */
export function treatmentSettings(document) {
  const adjustments = document?.photos?.[0]?.adjustments ?? {};
  const lines = [];
  const values = Object.entries(adjustments).filter(([key, value]) => typeof value === 'number' && !(ALWAYS_WRITTEN.has(key) && value === 0));
  if (values.length) lines.push(values.slice(0, 12).map(([key, value]) => `${key} ${value > 0 ? '+' : ''}${value}`).join(', ') + (values.length > 12 ? `, and ${values.length - 12} more` : ''));
  if (adjustments.curves) lines.push(`Tone curve: ${Object.keys(adjustments.curves).join(', ')}`);
  if (adjustments.filter) lines.push(`Filter: ${adjustments.filter.id} at ${adjustments.filter.strength}%`);
  if (adjustments.lut) lines.push(`LUT: ${adjustments.lut.name} (SHA-256 ${adjustments.lut.sha256.slice(0, 12)}…)`);
  if (adjustments.geometry) lines.push(`Crop & Transform: ${Object.keys(adjustments.geometry).join(', ')}`);
  if (adjustments.layers?.length) lines.push(`Layers: ${adjustments.layers.length}`);
  if (adjustments.local?.length) lines.push(`Local adjustments (masks): ${adjustments.local.length}`);
  if (adjustments.raw) lines.push(`RAW white balance: ${adjustments.raw.whiteBalance}`);
  const source = document?.photos?.[0]?.source;
  if (source?.hdr) lines.push(`Merged HDR (${source.hdr.mode}) of ${source.hdr.inputs.map(({ name }) => name).join(', ')}`);
  return lines.length ? lines : ['No changes from the original.'];
}

const VIEWS = [['split', 'Split'], ['side', 'Side by side'], ['full', 'Original, full frame']];

/**
 * Original against the staged render. Split and side by side show the original matched to the
 * edit (its pixels in the edit's crop, rotation and perspective, so both show the same scene
 * region at the same aspect); "Original, full frame" shows what the camera captured. The
 * figure can be enlarged (fullscreen, or a viewport-filling view where that is unavailable).
 */
export function Compare({ id, version, geometry, originalKind = 'public' }) {
  const [split, setSplit] = useState(50);
  const [view, setView] = useState('split');
  const [matched, setMatched] = useState({ url: null, error: null, ready: false });
  const sliderId = useId();
  const figureRef = useRef(null);
  const fullscreen = useFullscreen(figureRef);
  const originalUrl = treatmentImageUrl(id, 'original');
  const editedUrl = treatmentImageUrl(id, 'current-viewer', version);
  const geometryKey = JSON.stringify(geometry ?? null);

  useEffect(() => {
    let cancelled = false;
    let url = null;
    setMatched({ url: null, error: null, ready: false });
    const image = new Image();
    image.onload = async () => {
      try {
        url = await matchedOriginalUrl(image, geometry);
        if (!cancelled) setMatched({ url, error: null, ready: true });
      } catch (caught) {
        if (!cancelled) setMatched({ url: null, error: caught.message, ready: true });
      }
    };
    image.onerror = () => { if (!cancelled) setMatched({ url: null, error: 'The original could not be loaded.', ready: true }); };
    image.src = originalUrl;
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [originalUrl, geometryKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Without a geometry the original already has the edit's framing.
  const matchedSrc = matched.url ?? (matched.ready && !matched.error ? originalUrl : null);
  const enlarge = (
    <button type="button" className="cms-button cms-compare__enlarge" onClick={fullscreen.toggle} aria-pressed={fullscreen.active}>
      {fullscreen.active ? 'Exit fullscreen' : 'Enter fullscreen'}
    </button>
  );
  return (
    <figure ref={figureRef} className={`cms-compare${fullscreen.mode ? ` is-fullscreen is-fullscreen--${fullscreen.mode}` : ''}`} data-view={view}>
      <div className="cms-compare__toolbar">
        <div className="cms-segmented" role="group" aria-label="Comparison view">
          {VIEWS.map(([value, label]) => <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)}>{label}</button>)}
        </div>
        {enlarge}
      </div>
      {view === 'split' && (
        <>
          <div className="cms-compare__frame" style={{ '--split': `${split}%` }}>
            {matchedSrc ? <img src={matchedSrc} alt="Original photograph, framed like the edit" /> : <span className="cms-compare__pending" role="status">{matched.error ?? 'Framing the original like the edit…'}</span>}
            <img className="cms-compare__edited" src={editedUrl} alt="Edited photograph (staged render)" />
            <span className="cms-compare__line" aria-hidden="true" />
          </div>
          <label className="cms-compare__control" htmlFor={sliderId}>
            <span>Original</span>
            <input id={sliderId} type="range" min="0" max="100" value={split} onChange={(event) => setSplit(Number(event.target.value))} aria-label="Split position: original left, edited right" />
            <span>Edited</span>
          </label>
        </>
      )}
      {view === 'side' && (
        <div className="cms-compare__pair">
          <figure>
            {matchedSrc ? <img src={matchedSrc} alt="Original photograph, framed like the edit" /> : <span className="cms-compare__pending" role="status">{matched.error ?? 'Framing the original like the edit…'}</span>}
            <figcaption>Original, matched to the edit</figcaption>
          </figure>
          <figure>
            <img src={editedUrl} alt="Edited photograph (staged render)" />
            <figcaption>Edited</figcaption>
          </figure>
        </div>
      )}
      {view === 'full' && (
        <figure className="cms-compare__single">
          <img src={originalUrl} alt="Original photograph, full frame" />
          <figcaption>What the camera captured, uncropped</figcaption>
        </figure>
      )}
      <figcaption className="cms-field-hint">
        {matched.error ? `${matched.error} ` : ''}
        {originalKind === 'source' ? 'Original: the camera original.' : 'Original: the current public image (the camera original is not available as a JPEG here), which may already include an earlier approved edit.'}
      </figcaption>
    </figure>
  );
}

/**
 * Treatment review in the details panel. Three separate decisions: saving a treatment
 * (in QuangEdit), approving it (here), publishing the photograph (Publish view).
 */
export default function TreatmentReview({ record, beforeLeave, onNotice, onChanged }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const load = useCallback(async () => {
    try {
      setInfo(await treatments.describe(record.id));
      setError(null);
    } catch (caught) {
      setError(caught.message);
    }
  }, [record.id]);
  useEffect(() => { setInfo(null); load(); }, [load]);

  const act = async (name, label) => {
    setBusy(name);
    try {
      const next = await treatments[name](record.id, info.treatment.revision);
      setInfo(next);
      onNotice({ tone: 'info', text: label });
      onChanged?.();
    } catch (caught) {
      onNotice({ tone: 'error', text: caught instanceof ApiError && caught.code === 'stale-revision' ? `${caught.message}` : caught.message });
      load();
    } finally {
      setBusy(null);
    }
  };
  const openEditor = async () => {
    await beforeLeave?.();
    window.location.assign(editorUrl(record.id));
  };

  const treatment = info?.treatment;
  const [label, hint] = STATUS[treatment?.status ?? 'none'];
  const source = info?.sources?.[0];
  return (
    <section className="cms-fieldset cms-treatment" aria-labelledby={`treatment-${record.id}`}>
      <h3 id={`treatment-${record.id}`} className="cms-treatment__title">QuangEdit</h3>
      <div className="cms-details-actions">
        <button type="button" className="cms-button cms-button--primary" onClick={openEditor}>
          {treatment?.document ? 'Keep editing in QuangEdit' : 'Edit in QuangEdit'}
        </button>
      </div>
      {error && <p className="cms-field-hint cms-text-error" role="alert">{error}</p>}
      {info && (
        <>
          <dl className="cms-treatment__states">
            <div><dt>Treatment</dt><dd>{label}<span className="cms-field-hint"> — {hint}</span></dd></div>
            <div><dt>Render</dt><dd>{!treatment.document ? '—' : info.renderFresh ? `Up to date (${treatment.render.width}×${treatment.render.height})` : treatment.render ? 'Out of date: render again in QuangEdit' : 'Not rendered yet'}</dd></div>
            <div><dt>Photograph</dt><dd>{record.status === 'published' ? 'Published' : 'Draft'}{treatment.approved ? (info.approvedLive ? ' · approved image is live' : record.status === 'published' ? ' · approved image waits for the next publication' : ' · approved image is used when it is published') : treatment.restore ? (info.originalLive ? ' · original image is live' : ' · approved treatment removed: the original image returns at the next publication') : ''}</dd></div>
            <div><dt>Source</dt><dd>{source ? `${source.name} (${source.kind}${source.limited ? ', limited' : ''})` : 'None'}</dd></div>
          </dl>
          {source?.problem && <p className="cms-field-hint" role="note">{source.problem}</p>}
          {info.staleSource && <p className="cms-field-hint cms-text-error" role="alert">The treatment was made from a different file than the current source.</p>}
          {treatment.render && <Compare id={record.id} version={treatment.render.sha256} geometry={treatment.document?.photos[0]?.adjustments.geometry} originalKind={info.original} />}
          {treatment.document && (
            <details className="cms-treatment__settings">
              <summary>Treatment settings</summary>
              <ul>{treatmentSettings(treatment.document).map((line) => <li key={line}>{line}</li>)}</ul>
            </details>
          )}
          <div className="cms-details-actions">
            <button type="button" className="cms-button" disabled={!info.renderFresh || treatment.status === 'approved' || Boolean(busy)}
              onClick={() => act('approve', 'Treatment approved. It is published only through the next publication pull request.')}>
              Approve for publication
            </button>
            <button type="button" className="cms-button cms-button--danger" disabled={!treatment.document || treatment.status === 'rejected' || treatment.status === 'approved' || Boolean(busy)}
              onClick={() => act('reject', 'Treatment rejected; publication ignores it.')}>
              Reject
            </button>
            <button type="button" className="cms-button" disabled={!treatment.document || (treatment.approved && treatment.status === 'approved') || Boolean(busy)}
              onClick={() => act('discard', treatment.approved ? 'Back to the approved treatment.' : 'Treatment discarded.')}>
              {treatment.approved ? 'Revert to approved' : 'Discard treatment'}
            </button>
          </div>
          {treatment.approved && !confirmRemove && (
            <div className="cms-details-actions">
              <button type="button" className="cms-button cms-button--danger" disabled={Boolean(busy)} onClick={() => setConfirmRemove(true)}>Remove approved treatment…</button>
            </div>
          )}
          {treatment.approved && confirmRemove && (
            <div className="cms-treatment__remove" role="group" aria-label="Confirm removing the approved treatment">
              <p className="cms-field-hint">The photograph returns to its original appearance at the next publication (same address and id). The original images are generated now from the original file; the edit is kept as a draft and recorded in the treatment history. Nothing changes on the live site until a publication pull request is merged.</p>
              <div className="cms-details-actions">
                <button type="button" className="cms-button cms-button--danger" disabled={Boolean(busy)}
                  onClick={async () => { await act('removeApproved', 'Approved treatment removed. The original image is staged for the next publication pull request.'); setConfirmRemove(false); }}>
                  {busy === 'removeApproved' ? 'Removing…' : 'Remove approved treatment'}
                </button>
                <button type="button" className="cms-button" disabled={Boolean(busy)} onClick={() => setConfirmRemove(false)}>Cancel</button>
              </div>
            </div>
          )}
          <details className="cms-treatment__help">
            <summary>Which action do I need?</summary>
            <dl>
              <dt>Discard treatment</dt><dd>Drops the working edit when nothing is approved: no treatment is left.</dd>
              <dt>Revert to approved</dt><dd>Drops a newer working edit and goes back to the approved one.</dd>
              <dt>Reject</dt><dd>Marks the working edit as not wanted; it is kept for reference, and an earlier approved treatment still stands.</dd>
              <dt>Remove approved treatment</dt><dd>Withdraws the approved edit itself: the published photograph goes back to the original image at the next publication.</dd>
            </dl>
          </details>
          <p className="cms-field-hint">Saving a treatment ≠ approving it ≠ publishing the photograph. Nothing changes on the live site until a publication pull request is merged.</p>
        </>
      )}
    </section>
  );
}
