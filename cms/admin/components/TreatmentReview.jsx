import { useCallback, useEffect, useId, useState } from 'react';
import { ApiError, editorUrl, treatmentImageUrl, treatments } from '../api.js';

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

/** Original against the staged render, side by side under one split handle. */
function Compare({ id, version }) {
  const [split, setSplit] = useState(50);
  const sliderId = useId();
  return (
    <figure className="cms-compare">
      <div className="cms-compare__frame" style={{ '--split': `${split}%` }}>
        <img src={treatmentImageUrl(id, 'original')} alt="Original photograph" />
        <img className="cms-compare__edited" src={treatmentImageUrl(id, 'current-viewer', version)} alt="Edited photograph (staged render)" />
        <span className="cms-compare__line" aria-hidden="true" />
      </div>
      <label className="cms-compare__control" htmlFor={sliderId}>
        <span>Original</span>
        <input id={sliderId} type="range" min="0" max="100" value={split} onChange={(event) => setSplit(Number(event.target.value))} aria-label="Split position: original left, edited right" />
        <span>Edited</span>
      </label>
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
            <div><dt>Photograph</dt><dd>{record.status === 'published' ? 'Published' : 'Draft'}{treatment.approved ? (info.approvedLive ? ' · approved image is live' : record.status === 'published' ? ' · approved image waits for the next publication' : ' · approved image is used when it is published') : ''}</dd></div>
            <div><dt>Source</dt><dd>{source ? `${source.name} (${source.kind}${source.limited ? ', limited' : ''})` : 'None'}</dd></div>
          </dl>
          {source?.problem && <p className="cms-field-hint" role="note">{source.problem}</p>}
          {info.staleSource && <p className="cms-field-hint cms-text-error" role="alert">The treatment was made from a different file than the current source.</p>}
          {treatment.render && <Compare id={record.id} version={treatment.render.sha256} />}
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
          <p className="cms-field-hint">Saving a treatment ≠ approving it ≠ publishing the photograph. Nothing changes on the live site until a publication pull request is merged.</p>
        </>
      )}
    </section>
  );
}
