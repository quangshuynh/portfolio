// Watermark: the CMS global preference and "Apply HUYNH Watermark to Portfolio". Previews are
// drawn by the editor's own watermark renderer over each public gallery image; the placement
// check is a detail-and-contrast heuristic (watermark.mjs placementReport), not subject
// detection. Staging opens QuangEdit once per chosen photograph (editorHost.jsx queue), which
// renders from the original and saves a draft treatment; approving is a separate, explicit step
// here, and publication goes through the Publish view's pull request as for any approved edit.
// Three separate actions: Stage previews (drafts only) → Approve the batch → Publish (pull request).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DESIGN, WATERMARK_COLORS, WATERMARK_LIMITS, WATERMARK_POSITIONS, layoutWatermark, normalizeWatermark, placementReport, regionLuminance, resolveWatermarkColor, sampleBox, watermarksEqual,
} from '../../../src/editor/watermark/watermark.mjs';
import { loadWatermarkFonts, markBounds, renderMarkSprite } from '../../../src/editor/watermark/watermarkRender.mjs';
import { ApiError, imageUrl, treatmentImageUrl, treatments, watermark as watermarkApi } from '../api.js';
import { clearWatermarkQueue, queueEditorHref, readWatermarkQueue, writeWatermarkQueue } from '../editorHost.jsx';

const FLAG_LABELS = { busy: 'Busy corner: detail or contrast behind the mark', 'low-contrast': 'Mid-tone backdrop: low contrast in either colour' };
const positionLabel = (id) => WATERMARK_POSITIONS.find((position) => position.id === id)?.label ?? id;
/** The full-size frame the mark is laid out for: the photo's proportions at a 6000 px long edge (originals are not read here). */
const nominalFrame = (width, height) => {
  const k = 6000 / Math.max(width, height);
  return { width: Math.round(width * k), height: Math.round(height * k) };
};

function loadPixels(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = Object.assign(document.createElement('canvas'), { width: image.naturalWidth, height: image.naturalHeight });
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      resolve(context.getImageData(0, 0, canvas.width, canvas.height));
    };
    image.onerror = () => reject(new Error('The gallery image could not be read.'));
    image.src = url;
  });
}

/** The gallery image with the mark drawn on it by the shared renderer (layout for the full-size frame). */
function Preview({ id, settings, show, alt, onVariant }) {
  const ref = useRef(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const pixels = await loadPixels(imageUrl(id, 'gallery'));
        await loadWatermarkFonts();
        if (!alive || !ref.current) return;
        const canvas = ref.current;
        Object.assign(canvas, { width: pixels.width, height: pixels.height });
        const context = canvas.getContext('2d');
        context.putImageData(pixels, 0, 0);
        if (!show || !settings) return;
        const frame = nominalFrame(pixels.width, pixels.height);
        const layout = layoutWatermark(settings, frame.width, frame.height, { scale: pixels.width / frame.width });
        const variant = resolveWatermarkColor(settings, regionLuminance(pixels, sampleBox(layout)).mean);
        onVariant?.(variant);
        const sprite = renderMarkSprite(layout, DESIGN.colors[variant]);
        const bounds = markBounds(layout);
        context.globalAlpha = settings.opacity;
        context.drawImage(sprite, bounds.x, bounds.y);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; };
  }, [id, settings, show]); // eslint-disable-line react-hooks/exhaustive-deps
  return failed ? <span className="cms-watermark-missing">No gallery image</span> : <canvas ref={ref} className="cms-watermark-preview" role="img" aria-label={`${alt}${show ? ' (watermark preview)' : ''}`} />;
}

function PreferenceForm({ preference, onSaved, onError }) {
  const [draft, setDraft] = useState(preference.settings);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(preference.settings), [preference]);
  const set = (patch) => setDraft((current) => normalizeWatermark({ ...current, ...patch, enabled: true }));
  const percent = (key, label, [min, max], step) => (
    <label className="cms-field">
      <span>{label} (%)</span>
      <input type="number" min={min * 100} max={max * 100} step={step} value={Math.round(draft[key] * 1000) / 10} onChange={(event) => set({ [key]: Number(event.target.value) / 100 })} />
    </label>
  );
  return (
    <section className="cms-card cms-watermark-pref" aria-labelledby="cms-watermark-pref">
      <h2 id="cms-watermark-pref">Global preference</h2>
      <p>The starting point when you add the watermark to a photograph (here or in QuangEdit). Each treatment keeps its own copy, so changing this never changes saved, approved or published photographs.{preference.saved ? '' : ' Currently the approved defaults.'}</p>
      <div className="cms-watermark-fields">
        <label className="cms-field"><span>Position</span>
          <select value={draft.position} onChange={(event) => set({ position: event.target.value })}>{WATERMARK_POSITIONS.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}</select>
        </label>
        <label className="cms-field"><span>Colour</span>
          <select value={draft.color} onChange={(event) => set({ color: event.target.value })}>{WATERMARK_COLORS.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}</select>
        </label>
        {percent('size', 'Size', WATERMARK_LIMITS.size, 0.5)}
        {percent('opacity', 'Opacity', WATERMARK_LIMITS.opacity, 1)}
        {percent('margin', 'Margin', WATERMARK_LIMITS.margin, 0.5)}
        <label className="cms-check"><input type="checkbox" checked={draft.border} onChange={(event) => set({ border: event.target.checked })} /> Border</label>
        <label className="cms-check"><input type="checkbox" checked={draft.outline} onChange={(event) => set({ outline: event.target.checked })} /> Outline</label>
        <label className="cms-check"><input type="checkbox" checked={draft.rules} onChange={(event) => set({ rules: event.target.checked })} /> Accent lines</label>
      </div>
      <div className="cms-toolbar">
        <button type="button" className="cms-button cms-button--primary" disabled={busy} onClick={async () => {
          setBusy(true);
          try { onSaved(await watermarkApi.savePreference(draft)); } catch (error) { onError(error); } finally { setBusy(false); }
        }}>Save preference</button>
      </div>
    </section>
  );
}

export default function WatermarkView({ onNotice, onChanged }) {
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState(null);
  const [chosen, setChosen] = useState(() => new Set());
  const [positions, setPositions] = useState({});
  const [reports, setReports] = useState({});
  const [showMark, setShowMark] = useState(true);
  const [confirming, setConfirming] = useState(null);
  const [reviewed, setReviewed] = useState(false);
  const [approving, setApproving] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [variants, setVariants] = useState({});
  // The last or an interrupted bulk run (kept in this browser until dismissed).
  const [run, setRun] = useState(readWatermarkQueue);
  const remaining = run ? run.ids.length - run.index : 0;

  const report = useCallback((caught) => setError(caught instanceof ApiError && caught.status === 401 ? 'The CMS session ended. Open the sign-in link printed by `npm run cms`.' : caught.message), []);
  const load = useCallback(async () => {
    try { setOverview(await watermarkApi.portfolio()); } catch (caught) { report(caught); }
  }, [report]);
  useEffect(() => { load(); }, [load]);

  const preference = overview?.preference.settings ?? null;
  const settingsFor = useCallback((id) => (preference ? normalizeWatermark({ ...preference, position: positions[id] ?? preference.position, enabled: true }) : null), [preference, positions]);
  const photos = overview?.photographs ?? [];
  const blocked = (photo) => {
    if (!photo.source?.available) return 'No source file available';
    if (photo.treatment.unapprovedEdits) return 'Its treatment has unapproved edits: approve or discard them first';
    if (photo.source.limited) return 'Only the 2200 px public image: attach the original first';
    if (photo.treatment.hdr) return 'HDR treatment: open it in QuangEdit (Merge HDR) and add the watermark there';
    return null;
  };
  const stageable = photos.filter((photo) => !blocked(photo));
  // Already staged or approved with exactly these settings: re-running changes nothing.
  const upToDate = (photo) => Boolean(photo.treatment.watermarked && photo.treatment.renderFresh && watermarksEqual(photo.treatment.watermark, settingsFor(photo.id)));
  const staged = photos.filter((photo) => photo.treatment.watermarked && photo.treatment.renderFresh && photo.treatment.status === 'draft');

  // Placement check, one gallery image at a time.
  useEffect(() => {
    if (!preference || !photos.length) return undefined;
    let alive = true;
    (async () => {
      for (const photo of photos) {
        if (!alive) return;
        const settings = settingsFor(photo.id);
        try {
          const pixels = await loadPixels(imageUrl(photo.id, 'gallery'));
          const result = placementReport(pixels, settings, { frame: nominalFrame(pixels.width, pixels.height) });
          if (alive) setReports((current) => ({ ...current, [photo.id]: result }));
        } catch { /* shown as no preview */ }
      }
    })();
    return () => { alive = false; };
  }, [preference, photos, positions]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id) => setChosen((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const startStaging = () => {
    const ids = photos.filter((photo) => chosen.has(photo.id) && !blocked(photo)).map(({ id }) => id);
    if (!ids.length) return;
    writeWatermarkQueue({ ids, settings: Object.fromEntries(ids.map((id) => [id, settingsFor(id)])), index: 0, results: [], startedAt: new Date().toISOString() });
    window.location.assign(queueEditorHref(ids[0]));
  };
  const resume = () => {
    const next = { ...run, stopped: false };
    writeWatermarkQueue(next);
    window.location.assign(queueEditorHref(next.ids[next.index]));
  };
  const dismissRun = () => { clearWatermarkQueue(); setRun(null); if (window.location.hash === '#watermark') window.history.replaceState(null, '', window.location.pathname); };
  const approveSelected = async () => {
    setBusy(true);
    let done = 0;
    try {
      for (const photo of staged.filter(({ id }) => approving.has(id))) {
        await treatments.approve(photo.id, photo.treatment.revision);
        done += 1;
      }
      onNotice({ tone: 'info', text: `Approved ${done} watermarked treatment${done === 1 ? '' : 's'}. Publish them from the Publish view (a pull request); nothing is live yet.` });
    } catch (caught) {
      report(caught);
    } finally {
      setBusy(false);
      setConfirming(null);
      setReviewed(false);
      setApproving(new Set());
      onChanged();
      load();
    }
  };

  const flagged = useMemo(() => photos.filter((photo) => reports[photo.id]?.flags.length), [photos, reports]);
  if (!overview) return <section className="cms-watermark"><h1 className="cms-title">Watermark</h1>{error ? <p className="cms-banner" role="alert">{error}</p> : <p className="cms-lede">Loading…</p>}</section>;

  return (
    <section className="cms-watermark" aria-labelledby="cms-watermark-title">
      <header className="cms-library-head">
        <h1 className="cms-title" id="cms-watermark-title">Watermark</h1>
        <p className="cms-lede">HUYNH Photography over the final, approved renders only: originals stay untouched, and nothing here changes the live portfolio until you approve and publish.</p>
      </header>
      {error && <p className="cms-banner" role="alert">{error}</p>}
      {run && (
        <div className="cms-banner" role="status" data-watermark-run>
          <p>
            {remaining > 0 ? `Bulk run ${run.stopped ? 'stopped' : 'interrupted'}: ${run.index} of ${run.ids.length} done, ${remaining} remaining.` : `Last bulk run: ${run.ids.length} photographs.`}
            {' '}{['staged', 'unchanged', 'skipped', 'failed'].map((outcome) => `${run.results.filter((entry) => entry.outcome === outcome).length} ${outcome}`).join(', ')}.
          </p>
          {run.results.filter(({ outcome }) => outcome === 'skipped' || outcome === 'failed').map(({ id, outcome, message }) => <span key={id} className="cms-watermark-result">{id} ({outcome}): {message}</span>)}
          <div className="cms-toolbar">
            {remaining > 0 && <button type="button" className="cms-button cms-button--primary" onClick={resume}>Resume ({remaining})</button>}
            <button type="button" className="cms-link" onClick={dismissRun}>{remaining > 0 ? 'Cancel the rest' : 'Dismiss'}</button>
          </div>
        </div>
      )}
      <dl className="cms-watermark-stats" aria-label="Portfolio watermark status">
        <div><dt>Published</dt><dd>{overview.count}</dd></div>
        <div><dt>Eligible</dt><dd data-stat="eligible">{stageable.length}</dd></div>
        <div><dt>Flagged for review</dt><dd>{flagged.length}</dd></div>
        <div><dt>Not eligible</dt><dd>{photos.length - stageable.length}</dd></div>
        <div><dt>Staged (draft)</dt><dd>{staged.length}</dd></div>
        <div><dt>Approved with watermark</dt><dd>{photos.filter((photo) => photo.treatment.approvedWatermarked).length}</dd></div>
      </dl>
      <PreferenceForm preference={overview.preference} onSaved={(next) => { setOverview({ ...overview, preference: next }); onNotice({ tone: 'info', text: 'Saved the global watermark preference.' }); }} onError={report} />

      <section className="cms-card" aria-labelledby="cms-watermark-portfolio">
        <h2 id="cms-watermark-portfolio">Apply HUYNH Watermark to Portfolio</h2>
        <p>
          {overview.count} published photographs; {stageable.length} can be staged from their originals.
          {' '}{flagged.length ? `${flagged.length} flagged for review by the placement check (detail and contrast behind the mark; not subject detection).` : ''}
          {' '}Staging opens QuangEdit for each chosen photograph, adds the watermark to its treatment (keeping its other edits), renders it from the original and saves a draft. Keep this tab open until it returns here.
        </p>
        <div className="cms-toolbar">
          <button type="button" className="cms-button" onClick={() => setChosen(new Set(stageable.filter((photo) => !reports[photo.id]?.flags.length && !upToDate(photo)).map(({ id }) => id)))}>Choose unflagged</button>
          <button type="button" className="cms-button" onClick={() => setChosen(new Set(stageable.filter((photo) => !upToDate(photo)).map(({ id }) => id)))}>Choose all eligible</button>
          <button type="button" className="cms-button" onClick={() => setChosen(new Set())}>Clear</button>
          <label className="cms-check"><input type="checkbox" checked={showMark} onChange={(event) => setShowMark(event.target.checked)} /> Show watermark (after)</label>
          <button type="button" className="cms-button cms-button--primary" disabled={!chosen.size || remaining > 0} onClick={() => setConfirming('stage')}>Stage {chosen.size} photograph{chosen.size === 1 ? '' : 's'}…</button>
        </div>
        <ul className="cms-watermark-grid" aria-label="Published photographs">
          {photos.map((photo) => {
            const reason = blocked(photo);
            const result = reports[photo.id];
            const position = positions[photo.id] ?? preference.position;
            return (
              <li key={photo.id} className={`cms-photo cms-watermark-item${chosen.has(photo.id) ? ' is-selected' : ''}`} data-flags={result?.flags.join(' ') || undefined}>
                <Preview id={photo.id} settings={settingsFor(photo.id)} show={showMark} alt={photo.alt || photo.caption || photo.id} onVariant={(variant) => setVariants((current) => (current[photo.id] === variant ? current : { ...current, [photo.id]: variant }))} />
                <div className="cms-photo-text">
                  <label className="cms-check">
                    <input type="checkbox" checked={chosen.has(photo.id)} disabled={Boolean(reason)} onChange={() => toggle(photo.id)} aria-label={`Stage ${photo.caption || photo.id}`} />
                    <span className="cms-photo-caption">{photo.caption || photo.id}</span>
                  </label>
                  <span className="cms-photo-meta">{photo.id} · {photo.source ? `${photo.source.kind}${photo.source.format ? ` ${photo.source.format}` : ''}` : 'no source'} · {photo.treatment.status === 'none' ? 'no treatment' : `${photo.treatment.status} treatment`}{photo.treatment.approvedWatermarked ? ' · approved watermark' : ''}</span>
                  <span className="cms-photo-meta" data-watermark-placement>{positionLabel(position)} · {settingsFor(photo.id).color === 'auto' ? `auto → ${variants[photo.id] === 'dark' ? 'charcoal' : variants[photo.id] ? 'white' : '…'}` : settingsFor(photo.id).color === 'dark' ? 'charcoal' : 'white'} · {Math.round(settingsFor(photo.id).opacity * 100)}%</span>
                  {reason && <span className="cms-photo-meta">{reason}</span>}
                  {!reason && upToDate(photo) && <span className="cms-photo-meta">Already {photo.treatment.status === 'approved' ? 'approved' : 'staged'} with these settings</span>}
                  {!reason && photo.treatment.watermarked && !upToDate(photo) && <span className="cms-watermark-flag">Has a watermark with other settings; staging replaces it (never adds a second)</span>}
                  {result?.flags.map((flag) => <span key={flag} className="cms-watermark-flag">{FLAG_LABELS[flag]}{result.suggestion ? `; calmer: ${positionLabel(result.suggestion)}` : ''}</span>)}
                  <label className="cms-field cms-field--inline">
                    <span>Position</span>
                    <select value={position} disabled={Boolean(reason)} onChange={(event) => setPositions({ ...positions, [photo.id]: event.target.value })}>
                      {WATERMARK_POSITIONS.map(({ id, label }) => <option key={id} value={id}>{label}{id === preference.position ? ' (preference)' : ''}</option>)}
                    </select>
                  </label>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="cms-card" aria-labelledby="cms-watermark-staged">
        <h2 id="cms-watermark-staged">Staged for approval ({staged.length})</h2>
        <p>Draft treatments with a fresh watermarked render. Compare each before (the live image) and after (the staged render), then approve the ones you want; approved images are published only through the Publish view.</p>
        {staged.length > 0 && (
          <>
            <ul className="cms-watermark-compare" aria-label="Before and after">
              {staged.map((photo) => (
                <li key={photo.id}>
                  <label className="cms-check">
                    <input type="checkbox" checked={approving.has(photo.id)} onChange={() => setApproving((current) => { const next = new Set(current); if (next.has(photo.id)) next.delete(photo.id); else next.add(photo.id); return next; })} />
                    <span>{photo.caption || photo.id}</span>
                  </label>
                  <figure><img src={imageUrl(photo.id, 'gallery')} alt={`${photo.alt || photo.id}, live`} loading="lazy" /><figcaption>Before (live)</figcaption></figure>
                  <figure><img src={treatmentImageUrl(photo.id, 'current-gallery', String(photo.treatment.revision))} alt={`${photo.alt || photo.id}, staged with the watermark`} loading="lazy" /><figcaption>After (staged)</figcaption></figure>
                </li>
              ))}
            </ul>
            <div className="cms-toolbar">
              <button type="button" className="cms-button" onClick={() => setApproving(new Set(staged.map(({ id }) => id)))}>Choose all staged</button>
              <button type="button" className="cms-button" onClick={() => setApproving(new Set())}>Clear</button>
              <button type="button" className="cms-button cms-button--primary" disabled={!approving.size || busy} onClick={() => setConfirming('approve')}>Approve {approving.size}…</button>
            </div>
            <p data-watermark-estimate>Estimated publication change: {approving.size} photograph{approving.size === 1 ? '' : 's'}, {approving.size * 2} public images replaced in place (gallery and viewer, same file names and URLs); captions, collections, featured status and order unchanged.</p>
          </>
        )}
      </section>

      {confirming && (
        <div className="cms-watermark-confirm" role="dialog" aria-modal="true" aria-labelledby="cms-watermark-confirm-title">
          <div className="cms-card">
            <h2 id="cms-watermark-confirm-title">{confirming === 'stage' ? `Stage ${chosen.size} photographs?` : `Approve ${approving.size} watermarked treatments?`}</h2>
            {confirming === 'stage' ? (
              <p>QuangEdit opens each photograph in turn, adds the watermark with the settings shown, renders from the original and saves a draft treatment. Originals are not modified; nothing is approved or published. You can stop after any photograph.</p>
            ) : (
              <>
                <p>Approval makes these renders what the next publication uses for the chosen photographs: {approving.size * 2} public images replaced in place, same ids and URLs. They go live only when you prepare the pull request in Publish and merge it.</p>
                <label className="cms-check"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /> I compared each before and after.</label>
              </>
            )}
            <div className="cms-toolbar">
              <button type="button" className="cms-button" onClick={() => { setConfirming(null); setReviewed(false); }}>Cancel</button>
              <button type="button" className="cms-button cms-button--primary" autoFocus={confirming === 'stage'} disabled={busy || (confirming === 'approve' && !reviewed)} onClick={confirming === 'stage' ? startStaging : approveSelected}>
                {confirming === 'stage' ? 'Start staging' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
