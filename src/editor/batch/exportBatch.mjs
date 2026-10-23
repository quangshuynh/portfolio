// A batch export: a bounded queue over the editor's single-photo export. Each item runs
// from its original file with its own settings; at most `concurrency` run at once (one by
// default: RAW and HDR exports need several hundred MB each, and with one export at a
// time the peak is that of the largest photo, not the sum). A failure or cancellation
// ends that item only; finished items are delivered as they finish (downloaded, or added
// to the ZIP) and never undone by a later failure. Retrying starts a new batch with the
// failed items.

const SETTLED = new Set(['done', 'error', 'cancelled', 'removed']);

/**
 * :param items: [{ id, fileName, ... }] in export order; ids must be unique
 * :param exportOne: (item, { onProgress, onCancel(fn) }) => Promise<{ blob, width, height }>
 * :param deliver: (item, result) => Promise, called in completion order
 * :param onUpdate: (id, status) => void for every status change
 */
export function createExportBatch({ items, exportOne, deliver, concurrency = 1, onUpdate = () => {} }) {
  const ids = new Set();
  const queue = items.filter(({ id }) => (ids.has(id) ? false : ids.add(id)));
  const status = new Map(queue.map(({ id }) => [id, { state: 'queued' }]));
  const cancels = new Map();
  let stopped = false;
  let delivering = Promise.resolve();

  const set = (id, next) => {
    const current = status.get(id);
    // A removed or settled item never changes again (stale progress, late results).
    if (!current || current.state === 'removed' || (SETTLED.has(current.state) && next.state !== 'removed')) return;
    status.set(id, next);
    onUpdate(id, next);
  };

  async function runItem(item) {
    if (status.get(item.id).state !== 'queued') return;
    set(item.id, { state: 'running', stage: 'decoding', fraction: 0 });
    try {
      const result = await exportOne(item, {
        onProgress: (progress) => status.get(item.id).state === 'running' && set(item.id, { state: 'running', ...progress }),
        onCancel: (cancel) => cancels.set(item.id, cancel),
      });
      if (status.get(item.id).state !== 'running') return;
      // Deliveries run one at a time, in the order exports finish.
      const delivered = delivering.then(() => deliver(item, result));
      delivering = delivered.catch(() => {});
      await delivered;
      set(item.id, { state: 'done', width: result.width, height: result.height, bytes: result.blob.size });
    } catch (error) {
      const cancelled = error.code === 'cancelled' || stopped;
      set(item.id, cancelled ? { state: 'cancelled' } : { state: 'error', message: error.message || 'The export failed.' });
    } finally {
      cancels.delete(item.id);
    }
  }

  return {
    /** Runs every queued item. :returns: { done, failed, cancelled } ids */
    async start() {
      const pending = [...queue];
      const lane = async () => {
        while (pending.length && !stopped) await runItem(pending.shift());
      };
      await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, lane));
      queue.forEach(({ id }) => status.get(id).state === 'queued' && set(id, { state: 'cancelled' }));
      await delivering;
      const by = (state) => queue.filter(({ id }) => status.get(id).state === state).map(({ id }) => id);
      return { done: by('done'), failed: by('error'), cancelled: by('cancelled') };
    },
    /** Cancels the running items and everything still queued. */
    cancel() {
      stopped = true;
      cancels.forEach((cancel) => cancel());
      queue.forEach(({ id }) => status.get(id).state === 'queued' && set(id, { state: 'cancelled' }));
    },
    /** Cancels one item (running or queued). */
    cancelItem(id) {
      if (status.get(id)?.state === 'queued') set(id, { state: 'cancelled' });
      else cancels.get(id)?.();
    },
    /** A photo left the workspace: never export it, and stop it if it is running. */
    remove(id) {
      if (!status.has(id)) return;
      cancels.get(id)?.();
      set(id, { state: 'removed' });
    },
    status: (id) => status.get(id) ?? null,
    get items() { return queue; },
  };
}
