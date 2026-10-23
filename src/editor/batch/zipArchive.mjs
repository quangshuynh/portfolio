// Client-side ZIP of exported photos with client-zip (MIT, store only: JPEG, PNG and WebP
// are compressed already). Entries are streamed into the archive as each export finishes,
// so an encoded photo is held only until it has been copied into the archive, never a
// decoded one. The archive itself is collected as Blob chunks (browsers can keep large
// Blobs on disk). To bound memory, a batch is split into parts of at most `partBytes`;
// a part is handed over only after client-zip has written its central directory, so a
// cancelled or failed part is discarded instead of delivered half written.

import { makeZip } from 'client-zip';

/** Archive parts are consolidated into one Blob every this many bytes. */
const CHUNK_BYTES = 32 * 1024 * 1024;
// Local header, data descriptor and central directory record (ZIP64 included), plus the name twice.
const entryOverhead = (name) => 30 + 24 + 46 + 28 + new TextEncoder().encode(name).length * 2;

/** Largest archive part for this device: Blobs of archives count against page memory. */
export function zipPartBytes(win = globalThis) {
  const memory = win.navigator?.deviceMemory;
  let phone = false;
  try {
    phone = Boolean(win.matchMedia?.('(pointer: coarse)').matches) && Math.max(win.screen?.width ?? 0, win.screen?.height ?? 0) <= 1024;
  } catch { /* treat as a desktop */ }
  if (phone || (typeof memory === 'number' && memory <= 4)) return 256 * 1024 * 1024;
  return 1024 * 1024 * 1024;
}

/** An async iterable fed by push(): what client-zip reads its entries from. */
function channel() {
  const items = [];
  let wake = null;
  let ended = false;
  let failure = null;
  const notify = () => { wake?.(); wake = null; };
  return {
    push(item) { items.push(item); notify(); },
    end() { ended = true; notify(); },
    fail(error) { failure = error; notify(); },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (failure) throw failure;
        if (items.length) yield items.shift();
        else if (ended) return;
        else await new Promise((resolve) => { wake = resolve; });
      }
    },
  };
}

function startPart() {
  const entries = channel();
  const reader = makeZip(entries).getReader();
  const blobs = [];
  let chunks = [];
  let held = 0;
  const done = (async () => {
    for (;;) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      chunks.push(value);
      held += value.byteLength;
      if (held >= CHUNK_BYTES) { blobs.push(new Blob(chunks)); chunks = []; held = 0; }
    }
    blobs.push(new Blob(chunks));
    chunks = [];
    return new Blob(blobs, { type: 'application/zip' });
  })();
  done.catch(() => {});
  return { entries, done, names: [], bytes: 22 + 56 + 20 };
}

/**
 * :param options: { partBytes, onPart(blob, { part, names }) awaited before the next part,
 *   date } where `date` is every entry's modification time
 * :returns: { add(name, blob), finish(), abort(error) }
 */
export function createZipArchive({ partBytes = zipPartBytes(), onPart, date = new Date() }) {
  let part = null;
  let number = 0;
  let aborted = null;
  const close = async (split) => {
    const current = part;
    part = null;
    current.entries.end();
    const blob = await current.done;
    if (aborted) throw aborted;
    await onPart(blob, { part: number, names: current.names, split });
  };
  return {
    /** Adds one file; starts a new part first when this one would grow past `partBytes`. */
    async add(name, blob) {
      if (aborted) throw aborted;
      const size = blob.size + entryOverhead(name);
      if (part && part.names.length && part.bytes + size > partBytes) await close(true);
      if (!part) { part = startPart(); number += 1; }
      part.names.push(name);
      part.bytes += size;
      part.entries.push({ name, input: blob, lastModified: date, size: blob.size });
    },
    /** Writes the last part. :returns: number of parts delivered */
    async finish() {
      if (aborted) throw aborted;
      if (part) await close(number > 1);
      return number;
    },
    /** Discards the part being written; parts already delivered stay complete. */
    abort(error = Object.assign(new Error('Cancelled.'), { code: 'cancelled' })) {
      aborted = error;
      part?.entries.fail(error);
      part = null;
    },
    get parts() { return number; },
  };
}
