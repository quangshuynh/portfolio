// Edge refinement in the editor (Interval 24.2): which selections of an edit are refined, the
// owner image each describes, refinement jobs in a worker of their own (one owner at a time, so
// at most one full-size guide is held), and render copies of an edit whose refined selections
// carry the key of their registered map (segment/selectionMask.mjs). Nothing here is saved.
import { REFINE_VERSION, refineSize } from './refine.mjs';
import { refinedMap, refinedState, refinementKey, registerRefined } from './selectionMask.mjs';

/** The refinement settings a new selection gets (refined by default; Refine edge turns it off). */
export const newRefine = () => ({ version: REFINE_VERSION, radius: 0 });

/** Owner of the photo's own selections: its file (a merged HDR has none, so it is not refined). */
export const photoOwnerKey = (resource) => (resource?.sha256 && resource.file && !resource.hdr ? `photo|${resource.sha256}` : null);
/** Owner of an image layer's own selections. */
export const layerOwnerKey = (layer) => (layer?.type === 'image' && layer.source?.sha256 ? `layer|${layer.source.sha256}` : null);

// Select Object's draft (shown while taps are added) is not refined until it is accepted.
const refinable = (c) => c?.type === 'selection' && c.refine?.version === REFINE_VERSION && c.id !== 'object-draft';

/** The owner key of a mask's selections: an image layer's own source ('layer' space), else the photo. */
export const maskOwner = (mask, layer, photoKey) => (mask?.space === 'layer' ? layerOwnerKey(layer) : photoKey);

/**
 * Refinements an edit needs: [{ key, ownerKey, layer (the owner layer, or null for the photo), component }].
 */
export function refinementsOf(values, photoKey) {
  const out = new Map();
  const add = (mask, layer) => {
    const ownerKey = maskOwner(mask, layer, photoKey);
    if (!ownerKey) return;
    for (const c of mask?.components ?? []) {
      if (!refinable(c)) continue; // eslint-disable-line no-continue
      const key = refinementKey(ownerKey, c);
      if (!out.has(key)) out.set(key, { key, ownerKey, layer: mask.space === 'layer' ? layer : null, component: c });
    }
  };
  for (const local of values?.local ?? []) add(local.mask, null);
  for (const layer of values?.layers ?? []) if (layer.mask) add(layer.mask, layer);
  return [...out.values()];
}

const annotatedMasks = new WeakMap();
/** A render copy of `mask` whose refined selections carry their registered map's key (the same object while nothing changed). */
export function refinedMask(mask, ownerKey) {
  if (!ownerKey || !mask?.components?.some(refinable)) return mask;
  const state = refinedState();
  const hit = annotatedMasks.get(mask);
  if (hit && hit.state === state && hit.ownerKey === ownerKey) return hit.out;
  let changed = false;
  const components = mask.components.map((c) => {
    const key = refinable(c) ? refinementKey(ownerKey, c) : null;
    if (!key || !refinedMap(key)) return c;
    changed = true;
    return { ...c, refinedKey: key };
  });
  const out = changed ? { ...mask, components } : mask;
  annotatedMasks.set(mask, { state, ownerKey, out });
  return out;
}

const annotatedValues = new WeakMap();
/** A render copy of an edit (`values`) with refinedMask on every mask (the same object while nothing changed). */
export function refinedValues(values, photoKey) {
  if (!values) return values;
  const state = refinedState();
  const hit = annotatedValues.get(values);
  if (hit && hit.state === state && hit.photoKey === photoKey) return hit.out;
  let changed = false;
  const local = (values.local ?? []).map((item) => {
    const mask = refinedMask(item.mask, photoKey);
    if (mask === item.mask) return item;
    changed = true;
    return { ...item, mask };
  });
  const layers = (values.layers ?? []).map((layer) => {
    if (!layer.mask) return layer;
    const mask = refinedMask(layer.mask, maskOwner(layer.mask, layer, photoKey));
    if (mask === layer.mask) return layer;
    changed = true;
    return { ...layer, mask };
  });
  const out = changed ? { ...values, local, layers } : values;
  annotatedValues.set(values, { state, photoKey, out });
  return out;
}

/** The registered maps a render copy samples: [{ key, map }] (for an export's render workers). */
export function refinedMapsOf(values) {
  const out = new Map();
  const visit = (mask) => { for (const c of mask?.components ?? []) if (c.refinedKey && refinedMap(c.refinedKey)) out.set(c.refinedKey, refinedMap(c.refinedKey)); };
  for (const local of values?.local ?? []) visit(local.mask);
  for (const layer of values?.layers ?? []) visit(layer.mask);
  return [...out].map(([key, map]) => ({ key, map }));
}

export class RefineError extends Error {}

/**
 * :param createClient: () => worker client running image tasks (io/workerClient.mjs; terminate())
 * :param developRaw: async (source, size) => a RAW development at `size` (linear, for 'refineSelections')
 * :param onChange: () => called when maps are registered or a job fails
 */
export function createRefiner({ createClient, developRaw, onChange = () => {} }) {
  const jobs = new Map(); // ownerKey|keys → promise
  const failed = new Map(); // key → message
  let queue = Promise.resolve();
  const running = new Set(); // { client, keys, cancelled }

  /** Refines `requests` of one owner. `source`: { file, header, raw, width, height } of the owner image. */
  function runOwner(source, requests) {
    const id = `${requests[0].ownerKey}|${requests.map((r) => r.key).join(',')}`;
    if (jobs.has(id)) return jobs.get(id);
    const job = { client: null, keys: requests.map((r) => r.key), cancelled: false };
    const promise = (queue = queue.catch(() => {}).then(async () => {
      const todo = requests.filter((r) => !refinedMap(r.key));
      if (!todo.length || job.cancelled) return;
      running.add(job);
      const size = refineSize(source.width, source.height);
      const items = todo.map(({ key, component: c }) => ({ key, width: c.width, height: c.height, data: c.data, options: { radius: c.refine.radius, shift: c.shift, feather: c.feather } }));
      try {
        job.client = createClient();
        let payload = { file: source.file, header: source.header, size, items };
        let transfer = [];
        if (source.raw) {
          const developed = await developRaw(source, size);
          if (job.cancelled) throw new RefineError('Cancelled.');
          payload = { source: developed, raw: source.raw, size, items };
          transfer = [developed.data.buffer];
        }
        const maps = await job.client.call('refineSelections', payload, { transfer });
        if (job.cancelled) return;
        for (const { key, map } of maps) { registerRefined(key, map); failed.delete(key); }
      } catch (error) {
        if (!job.cancelled) for (const { key } of todo) failed.set(key, error?.message || 'The edge could not be refined.');
        throw error;
      } finally {
        job.client?.terminate();
        running.delete(job);
        jobs.delete(id);
        onChange();
      }
    }));
    jobs.set(id, promise);
    promise.catch(() => {});
    return promise;
  }

  return {
    /**
     * Makes sure every request is refined.
     * :param sourceOf: (request) => the owner's source ({ file, header, raw, width, height }) or null
     * :returns: a promise that rejects when one cannot be refined
     */
    async ensure(requests, sourceOf) {
      const groups = new Map();
      for (const r of requests) {
        if (refinedMap(r.key)) continue; // eslint-disable-line no-continue
        if (!groups.has(r.ownerKey)) groups.set(r.ownerKey, []);
        groups.get(r.ownerKey).push(r);
      }
      await Promise.all([...groups.values()].map((group) => {
        const source = sourceOf(group[0]);
        if (!source) return Promise.reject(new RefineError('The file this selection describes is not loaded.'));
        return runOwner(source, group);
      }));
    },
    /** Ends jobs none of whose keys are still wanted. */
    cancelExcept(keys) {
      for (const job of running) {
        if (job.keys.some((k) => keys.has(k))) continue; // eslint-disable-line no-continue
        job.cancelled = true;
        job.client?.terminate();
      }
    },
    failure: (key) => failed.get(key) ?? null,
    busy: () => running.size > 0 || jobs.size > 0,
    dispose() { for (const job of running) { job.cancelled = true; job.client?.terminate(); } },
  };
}
