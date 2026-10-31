// Automatic watermark drafts. While the CMS is open, photographs whose watermark is missing or
// out of date (cms/lib/watermark-rules.mjs watermarkStatus) get a draft from the canonical
// renderer: QuangEdit runs the editorHost.jsx queue in 'auto' mode inside an off-screen frame,
// one photograph at a time, so the CMS stays usable. It never approves anything and never
// replaces an approved version; review and approval stay in the Watermark view. The queue lives
// in localStorage, so a reload or a CMS restart resumes where it stopped. A merged HDR is
// drafted too once its three exposures are attached: the frame merges them again (in workers,
// one photograph at a time) before it adds the watermark, so it is given longer.
import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeWatermark, placementReport } from '../../../src/editor/watermark/watermark.mjs';
import { AUTO_STATUSES, autoDraftPlan } from '../../lib/watermark-rules.mjs';
import { imageUrl, watermark as watermarkApi } from '../api.js';
import { QUEUE_DONE_MESSAGE, openInEditor, queueEditorHref, readWatermarkQueue, writeWatermarkQueue } from '../editorHost.jsx';
import { loadPixels, nominalFrame } from '../watermarkImages.js';

export const AUTO_KEY = 'cms-watermark-auto';
const IDLE_MS = 30_000;
// One photograph that takes longer than this (a lost worker, a stuck page) is given up on.
const STALL_MS = 5 * 60_000;
const HDR_STALL_MS = 15 * 60_000;

export const autoDraftsEnabled = () => { try { return localStorage.getItem(AUTO_KEY) !== 'off'; } catch { return true; } };
export const setAutoDrafts = (on) => { try { localStorage.setItem(AUTO_KEY, on ? 'on' : 'off'); } catch { /* per session */ } window.dispatchEvent(new Event(AUTO_KEY)); };
const running = (queue) => Boolean(queue && queue.index < queue.ids.length && !queue.stopped);

export default function WatermarkAutopilot({ onChanged }) {
  const [enabled, setEnabled] = useState(autoDraftsEnabled);
  const [queue, setQueue] = useState(() => { const current = readWatermarkQueue(); return current?.mode === 'auto' ? current : null; });
  const [src, setSrc] = useState(null);
  // Photographs that failed or were skipped in this session are not retried until a reload.
  const given = useRef(new Set());
  const planning = useRef(false);
  const paused = useRef(false);
  const progressAt = useRef(Date.now());
  // The CMS passes a new callback on every render; keep the timers independent of it.
  const changed = useRef(onChanged);
  changed.current = onChanged;

  useEffect(() => {
    const sync = () => setEnabled(autoDraftsEnabled());
    window.addEventListener(AUTO_KEY, sync);
    return () => window.removeEventListener(AUTO_KEY, sync);
  }, []);

  const start = useCallback((next) => {
    writeWatermarkQueue(next);
    setQueue(next);
    progressAt.current = Date.now();
    setSrc(queueEditorHref(next.ids[next.index]));
  }, []);

  const plan = useCallback(async () => {
    if (!enabled || src || planning.current || paused.current) return;

    const existing = readWatermarkQueue();
    if (running(existing)) {
      // Resume an automatic run after a reload or restart; a manual run owns the queue.
      if (existing.mode === 'auto') start(existing);
      return;
    }
    planning.current = true;
    try {
      const overview = await watermarkApi.portfolio();
      const policy = normalizeWatermark({ ...overview.preference.settings, enabled: true });
      const skip = new Set([...given.current, ...openInEditor()]);
      const candidates = overview.photographs.filter((photo) => AUTO_STATUSES.includes(photo.treatment.watermarkStatus) && !skip.has(photo.id));
      if (!candidates.length) return;
      const placements = {};
      for (const photo of candidates.filter(({ treatment }) => !treatment.watermarked)) {
        try {
          const pixels = await loadPixels(imageUrl(photo.id, 'gallery'));
          placements[photo.id] = placementReport(pixels, policy, { frame: nominalFrame(pixels.width, pixels.height) });
        } catch { /* placed at the policy's corner */ }
      }
      const { ids, settings, hdr } = autoDraftPlan(candidates, policy, placements, skip);
      if (ids.length) start({ mode: 'auto', ids, settings, hdr, index: 0, results: [], startedAt: new Date().toISOString() });
    } catch { /* the next attempt retries */ } finally {
      planning.current = false;
    }
  }, [enabled, src, start]);

  // Plan on load, then whenever idle; follow the frame's progress through the shared queue.
  useEffect(() => {
    plan();
    const timer = setInterval(() => {
      const current = src ? readWatermarkQueue() : null;
      const limit = current?.hdr?.includes(current.ids[current.index]) ? HDR_STALL_MS : STALL_MS;
      if (src && Date.now() - progressAt.current > limit) {
        if (current?.mode === 'auto') {
          const id = current.ids[current.index];
          given.current.add(id);
          const next = { ...current, index: current.index + 1, results: [...current.results, { id, outcome: 'failed', message: 'Took too long; open it in QuangEdit to see why.' }] };
          if (running(next)) start(next);
          else { writeWatermarkQueue(next); setQueue(next); setSrc(null); changed.current?.(); }
        }
      } else if (!src) plan();
    }, src ? 5_000 : IDLE_MS);
    return () => clearInterval(timer);
  }, [plan, src, start]);

  useEffect(() => {
    const onStorage = () => {
      const current = readWatermarkQueue();
      if (current?.mode !== 'auto') return;
      setQueue((previous) => {
        if (previous?.index !== current.index) progressAt.current = Date.now();
        return current;
      });
    };
    const onMessage = (event) => {
      if (event.origin !== window.location.origin || event.data?.type !== QUEUE_DONE_MESSAGE) return;
      const current = readWatermarkQueue();
      current?.results.filter(({ outcome }) => outcome === 'failed' || outcome === 'skipped').forEach(({ id }) => given.current.add(id));
      setQueue(current);
      setSrc(null);
      changed.current?.();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('message', onMessage);
    };
  }, []);

  const stop = () => {
    const current = readWatermarkQueue();
    if (current?.mode === 'auto') writeWatermarkQueue({ ...current, stopped: true });
    setQueue((previous) => previous && { ...previous, stopped: true });
  };
  // Cancel now: unloads the frame, which stops its merge or render at once; whatever it had
  // saved stays a draft (never approved). Automatic drafts pause until the CMS is reloaded,
  // which plans again from the treatments (so the cancelled photograph is resumed then).
  const cancel = () => {
    paused.current = true;
    const current = readWatermarkQueue();
    if (current?.mode === 'auto') {
      const id = current.ids[current.index];
      writeWatermarkQueue({ ...current, stopped: true, results: [...current.results, ...(id ? [{ id, outcome: 'cancelled', message: 'Cancelled; drafting resumes when the CMS is reloaded.' }] : [])] });
    }
    setQueue((previous) => previous && { ...previous, stopped: true });
    setSrc(null);
    changed.current?.();
  };

  const active = Boolean(src) && queue;
  return (
    <>
      {active && (
        <div className="cms-autopilot" role="status" data-watermark-autopilot={queue.stopped ? 'stopping' : 'running'}>
          <span>
            Watermark drafts: {Math.min(queue.index + 1, queue.ids.length)} of {queue.ids.length}
            {queue.ids[queue.index] ? ` · ${queue.ids[queue.index]}` : ''}
            {queue.stopped ? ' · stopping after this photograph' : ''}
          </span>
          {!queue.stopped && <button type="button" className="cms-link" onClick={stop}>Stop</button>}
          <button type="button" className="cms-link" onClick={cancel}>Cancel now</button>

        </div>
      )}
      {src && <iframe className="cms-autopilot-frame" src={src} title="Automatic watermark drafts (off screen)" aria-hidden="true" tabIndex={-1} />}
    </>
  );
}
