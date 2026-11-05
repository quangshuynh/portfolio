// Intelligent selections in the editor (Interval 23): Select Sky, Subject, Background and Object
// make selection components (model/masks.mjs) from the photo's development, uncropped, at analysis
// size. The models run in a worker (segment/selectionClient.mjs); the photo never leaves the page.
// With an image layer selected (Interval 24.1), they analyse that layer's own source instead
// (segment/layerSource.mjs) and go into its mask, in the layer's own space.
import { useCallback, useEffect, useRef, useState } from 'react';
import { analysisSize, resampleRgba } from '../segment/analysis.mjs';
import { createSelectionRunner } from '../segment/selectionClient.mjs';
import { constrainedDevice } from '../raw/rawClient.mjs';
import { downloadBytes } from '../segment/models.mjs';
import { addSelection, createLocalAdjustment, createMask, createSelection, MASK_LIMITS, replaceWithSelection, updateComponent } from '../model/masks.mjs';
import { neutralGeometry } from '../pipeline/geometry.mjs';
import { flattenForAnalysis, layerAnalysisKey, limitToSourceAlpha } from '../segment/layerSource.mjs';

const LABELS = { sky: 'sky', subject: 'subject', background: 'background', object: 'object' };
const DRAFT_ID = 'object-draft';
const SLOW_AFTER_S = 20;
const STAGES = { download: 'Downloading the model', prepare: 'Preparing the model', analyse: 'Analysing the photo', outline: 'Outlining' };

/** RGBA at analysis size from a rendered frame; the browser's own scaler when it has one. */
async function toAnalysis(frame) {
  const size = analysisSize(frame.width, frame.height);
  if (size.width === frame.width && size.height === frame.height) return frame;
  try {
    const bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength), frame.width, frame.height), { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'high' });
    const canvas = Object.assign(document.createElement('canvas'), size);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const { data } = context.getImageData(0, 0, size.width, size.height);
    canvas.width = 0;
    return { ...size, data };
  } catch {
    return resampleRgba(frame, size.width, size.height);
  }
}

/** The mask Select Object adds to: a local adjustment's or an image layer's (taps in its own space), else null. */
const objectTarget = (target) => (target?.kind === 'local' ? target.local.mask : target?.kind === 'layer' && target.layer.type === 'image' ? target.layer.mask ?? null : null);

/** The image a mask's selections describe: an image layer's own source, else the photo. */
export const ownerOf = (target) => (target?.kind === 'layer' && target.layer.type === 'image' ? { kind: 'layer', layer: target.layer } : { kind: 'photo' });

/**
 * :param photo, ready, viewProxy: the active photo and its loaded proxy ({ photoId, image })
 * :param adjustments: the photo's settings; `lut` its LUT data
 * :param renderInWorker: the CPU renderer (EditorApp)
 * :param layerSource: async (layer, { width, height }) → RGBA8 of an image layer's source as it is
 *   shown (decoded, developed, its settings), about that size
 * :param locals, onApplyLocals, onSelectLocal, target, onApplyMask, onPreviewMask, onSelectComponent, newId
 * :param onApplyLayerMask: (layerId, mask) sets an image layer's mask (one without a mask yet);
 *   `onLayerMask(layerId)` then opens it for editing
 */
export default function useSelections({ photo, ready, viewProxy, adjustments, lut, renderInWorker, layerSource = null, locals, onApplyLocals, onSelectLocal, target, onApplyMask, onPreviewMask, onSelectComponent, newId, onApplyLayerMask = null, onLayerMask = null }) {
  const runnerRef = useRef(null);
  // The last two analysis images (the photo's and a layer's, say), by what they depend on.
  const analysisRef = useRef(new Map());
  const jobRef = useRef(0);
  // Subject and Background: which of the models' answers each selection shows (Next candidate).
  const candidatesRef = useRef(new Map());
  const [status, setStatus] = useState(null);
  // Seconds shown while a selection runs, so a slow one never looks stuck.
  const [, setTick] = useState(0);
  const [draft, setDraft] = useState(null);
  // Select Object: taps exclude instead of include (Alt reverses either way).
  const [exclude, setExclude] = useState(false);
  const runner = () => {
    runnerRef.current ??= createSelectionRunner({ base: new URL(import.meta.env.BASE_URL ?? '/', window.location.href).href });
    return runnerRef.current;
  };
  useEffect(() => {
    const hidden = () => { if (document.visibilityState === 'hidden') runnerRef.current?.trim(); };
    document.addEventListener('visibilitychange', hidden);
    return () => { document.removeEventListener('visibilitychange', hidden); runnerRef.current?.dispose(); };
  }, []);

  // The development a selection sees: every global setting, no crop or rotation (masks are in the
  // photo's own space), no local adjustments, layers, retouch or watermark.
  const development = { ...adjustments, geometry: neutralGeometry(), local: [], layers: [], retouch: [], watermark: null };
  const developmentKey = ready ? `${photo.id}|${JSON.stringify(development)}|${lut?.sha256 ?? ''}` : null;
  const remember = (entry) => {
    const held = analysisRef.current;
    held.delete(entry.key);
    held.set(entry.key, entry);
    while (held.size > 2) held.delete(held.keys().next().value);
    return entry;
  };
  /** The analysis image of `owner` (ownerOf): { key, image, alpha } (alpha: a layer's transparency, or null). */
  const analysisImage = useCallback(async (owner = { kind: 'photo' }) => {
    if (owner.kind === 'layer') {
      const { layer } = owner;
      const key = `${photo.id}|${layerAnalysisKey(layer)}`;
      if (analysisRef.current.has(key)) return remember(analysisRef.current.get(key));
      if (!layerSource) throw new Error('This layer cannot be analysed here.');
      const decoded = await layerSource(layer, analysisSize(layer.source.width, layer.source.height));
      const { image, alpha } = flattenForAnalysis(await toAnalysis(decoded));
      return remember({ key, image, alpha });
    }
    if (analysisRef.current.has(developmentKey)) return remember(analysisRef.current.get(developmentKey));
    if (!viewProxy || viewProxy.photoId !== photo.id) throw new Error('The photo is still loading.');
    const frame = await renderInWorker(viewProxy.image, development, lut, photo.raw ?? null);
    return remember({ key: developmentKey, image: await toAnalysis(frame), alpha: null });
  }, [developmentKey, viewProxy, photo?.id, layerSource]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new photo or a changed development: nothing pending applies to it any more.
  useEffect(() => { runnerRef.current?.cancel(); setStatus(null); setDraft(null); jobRef.current += 1; analysisRef.current.clear(); }, [photo?.id]);

  const run = useCallback(async (kind, request = {}, owner = { kind: 'photo' }) => {
    const job = (jobRef.current += 1);
    const already = runner().loaded();
    setStatus({ kind, stage: 'render', download: downloadBytes(kind, already), started: Date.now() });
    try {
      const { image, key, alpha } = await analysisImage(owner);
      if (job !== jobRef.current) return null;
      const raw = await runner().run({ kind, image, imageKey: key, lowMemory: constrainedDevice(), ...request }, (progress) => {
        if (job === jobRef.current) setStatus((s) => ({ ...s, kind, ...progress }));
      });
      if (job !== jobRef.current) return null;
      // On a layer with transparency, only what is visible can be selected.
      const result = limitToSourceAlpha(raw, alpha, image.width, image.height);
      setStatus(result.found ? (result.note ? { kind, note: result.note, confidence: result.confidence } : null) : { kind, error: result.note ?? `No ${LABELS[kind]} was found.` });
      return { result, image };
    } catch (error) {
      if (job === jobRef.current) setStatus(error.code === 'cancelled' ? null : { kind, error: error.message });
      return null;
    }
  }, [analysisImage]);

  const cancel = useCallback(() => { jobRef.current += 1; runnerRef.current?.cancel(); setStatus(null); }, []);

  // The mask selections are added to: a local adjustment's, a canvas-space layer mask (Interval 24:
  // evaluated in the photo's own space, as a local's), or an image layer's mask (Interval 24.1: a
  // selection of the layer's own source). Select Object taps arrive in the target mask's space,
  // which is the space of the image analysed in either case.
  const targetMask = target?.kind === 'local' ? target.local.mask : target?.kind === 'layer' ? target.layer.mask ?? null : null;
  const owner = ownerOf(target);
  // The target when a result arrives: a selection made for one layer never lands on another.
  const targetRef = useRef(target);
  targetRef.current = target;
  const sameOwner = (expected) => {
    const now = ownerOf(targetRef.current);
    return expected.kind === now.kind && (expected.kind !== 'layer' || expected.layer.id === now.layer.id);
  };
  const component = (id, kind, result, patch = {}) => createSelection(id, { kind, version: result.version, width: result.width, height: result.height, data: result.data, confidence: result.confidence }, { ...(kind === 'background' ? { invert: true } : {}), ...patch });

  /**
   * Sky, Subject or Background: `mode` 'new' makes a local adjustment holding the selection;
   * 'add' adds it to the mask being edited (`op` 'add' or 'subtract').
   */
  const select = useCallback(async (kind, { mode = 'new', op = 'add', layer = null, replace = false } = {}) => {
    // `layer`: an image layer (selected, maybe without a mask yet) whose own source is analysed.
    const from = layer ? { kind: 'layer', layer } : mode === 'new' ? { kind: 'photo' } : owner;
    const done = await run(kind, {}, from);
    if (!done?.result.found) return;
    const id = newId(kind);
    if (done.result.candidates !== undefined) candidatesRef.current.set(id, { candidate: done.result.candidate ?? 0, candidates: done.result.candidates });
    const selection = component(id, kind, done.result, { op });
    if (!selection) { setStatus({ kind, error: 'The selection is too large to keep with this photo. Remove another selection first.' }); return; }
    if (layer) {
      // The layer chosen when this started, whichever layer is selected now.
      const mask = layer.mask && !replace ? addSelection(layer.mask, selection) : replaceWithSelection(layer.mask ?? createMask('layer'), selection);
      if (mask === layer.mask) return;
      onApplyLayerMask?.(layer.id, mask);
      onLayerMask?.(layer.id);
      onSelectComponent(id);
      return;
    }
    if (mode !== 'new' && !sameOwner(from)) { setStatus({ kind, note: 'The selected layer changed while this ran; select again.' }); return; }
    if (mode === 'new') {
      if (locals.length >= MASK_LIMITS.local) return;
      const localId = newId('local');
      onApplyLocals([...locals, createLocalAdjustment(localId, { name: kind[0].toUpperCase() + kind.slice(1), mask: { ...createMask('image'), components: [selection] } })]);
      onSelectLocal(localId, id);
    } else if (targetMask) {
      const next = addSelection(targetMask, selection);
      if (next === targetMask) return;
      onApplyMask(next);
      onSelectComponent(id);
    }
  }, [run, newId, locals, onApplyLocals, onSelectLocal, targetMask, onApplyMask, onSelectComponent, owner, onApplyLayerMask, onLayerMask]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Subject or Background: the next of the other distinct answers the models found (wrapping to
   * the automatic one), replacing the grid and keeping the edge settings. Which answer is shown is
   * remembered for this session only; the saved selection is just its grid.
   */
  const nextCandidate = useCallback(async (c) => {
    if (!targetMask) return;
    const known = candidatesRef.current.get(c.id) ?? { candidate: 0, candidates: Infinity };
    const wanted = known.candidate + 1 < known.candidates ? known.candidate + 1 : 0;
    const from = owner;
    const done = await run(c.kind, { candidate: wanted }, from);
    if (!done?.result.found || !sameOwner(from)) return;
    const { result } = done;
    candidatesRef.current.set(c.id, { candidate: result.candidate ?? 0, candidates: result.candidates ?? 1 });
    if ((result.candidates ?? 1) <= 1) {
      setStatus({ kind: c.kind, note: 'The models found no other candidate. Use Select Object, or refine this one with Add and Subtract.' });
      return;
    }
    onApplyMask(updateComponent(targetMask, c.id, { version: result.version, width: result.width, height: result.height, data: result.data, confidence: result.confidence }));
    if (!result.note) setStatus({ kind: c.kind, note: `Candidate ${(result.candidate ?? 0) + 1} of ${result.candidates}.` });
  }, [targetMask, run, onApplyMask, owner]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Select again with the same kind (and an object's points), keeping its edge settings. */
  const regenerate = useCallback(async (c) => {
    if (!targetMask) return;
    const from = owner;
    const { image } = await analysisImage(from).catch(() => ({ image: null }));
    if (!image) return;
    const points = c.points?.map(([u, v, label]) => [u * image.width, v * image.height, label]);
    const done = await run(c.kind, c.kind === 'object' ? { points } : {}, from);
    if (!done?.result.found || !sameOwner(from)) return;
    if (done.result.candidates !== undefined) candidatesRef.current.set(c.id, { candidate: 0, candidates: done.result.candidates });
    const next = updateComponent(targetMask, c.id, { version: done.result.version, width: done.result.width, height: done.result.height, data: done.result.data, confidence: done.result.confidence });
    onApplyMask(next);
  }, [targetMask, analysisImage, run, onApplyMask, owner]); // eslint-disable-line react-hooks/exhaustive-deps

  // Select Object: taps (in the mask's space, 0–1: the photo's for a local adjustment, the
  // layer's source for an image layer) add points; each shows the candidate at once.
  const objectRun = useCallback(async (points, candidate = null) => {
    if (!objectTarget(target)) return;
    const from = owner;
    const { image } = await analysisImage(from).catch((error) => { setStatus({ kind: 'object', error: error.message }); return {}; });
    if (!image) return;
    const done = await run('object', { points: points.map(([u, v, label]) => [u * image.width, v * image.height, label]), candidate }, from);
    if (!done || !sameOwner(from)) return;
    const { result } = done;
    // The mask before this object: previews put the candidate into the mask shown, so a later
    // tap or Smaller/Larger must start again from the first draft's base, not from a preview.
    const shown = objectTarget(target);
    const base = draft?.base ?? { ...shown, components: shown.components.filter((c) => c.id !== DRAFT_ID) };
    const preview = result.found ? addSelection(base, component(DRAFT_ID, 'object', result, { points })) : base;
    setDraft({ points, candidate: result.candidate ?? null, candidates: result.candidates ?? [], result: result.found ? result : null, base });
    onPreviewMask(preview);
  }, [target, analysisImage, run, onPreviewMask, draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const object = {
    draft,
    exclude,
    setExclude,
    tap: (u, v, alt = false) => {
      const label = exclude !== alt ? 0 : 1;
      // The first point must be on the object.
      if (label === 0 && !(draft?.points ?? []).some(([, , l]) => l === 1)) { setStatus({ kind: 'object', error: 'Tap the object first, then tap areas to exclude.' }); return; }
      objectRun([...(draft?.points ?? []), [u, v, label]], null);
    },
    undoPoint: () => { const points = (draft?.points ?? []).slice(0, -1); if (points.some(([, , l]) => l === 1)) objectRun(points, null); else { setDraft(null); if (draft) onPreviewMask(draft.base); } },
    // SAM's answers run from a part to the whole.
    resize: (step) => { if (draft?.result) objectRun(draft.points, Math.min(draft.candidates.length - 1, Math.max(0, (draft.candidate ?? 0) + step))); },
    accept: (op = 'add') => {
      if (!draft?.result || !objectTarget(target)) return;
      const id = newId('object');
      const c = component(id, 'object', draft.result, { points: draft.points, op });
      const next = c ? addSelection(draft.base, c) : draft.base;
      setDraft(null);
      onApplyMask(next);
      onSelectComponent(id);
    },
    discard: () => { if (draft) onPreviewMask(draft.base); setDraft(null); cancel(); },
  };

  const running = Boolean(status && !status.error && !status.note);
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const seconds = running && status.started ? Math.floor((Date.now() - status.started) / 1000) : 0;
  const working = status && (status.stage === 'render' ? 'Preparing the photo' : `${STAGES[status.stage] ?? 'Working'}${status.stage === 'download' && status.fraction !== undefined ? ` ${Math.round(status.fraction * 100)}%` : ''}`);
  // Measured first runs take 5–15 s in Chromium and WebKit, up to about a minute in Firefox.
  const slow = seconds >= SLOW_AFTER_S ? '. Some browsers and phones run these models slowly; Cancel stops it' : '';
  const statusText = status && (status.error ?? status.note ?? `${working}${seconds >= 3 ? ` · ${seconds} s` : ''}${slow}`);
  return {
    status: status && { ...status, text: statusText, busy: !status.error && !status.note },
    select,
    regenerate,
    nextCandidate,
    candidateOf: (id) => candidatesRef.current.get(id) ?? null,
    cancel,
    object,
    downloadBytes: (kind) => downloadBytes(kind, runnerRef.current?.loaded() ?? new Set()),
  };
}
