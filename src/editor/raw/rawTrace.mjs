// RAW job stages, shared by the RAW worker (which reports them) and the page (which shows them
// and watches for a decoder that stopped responding). Each checkpoint carries the job's
// elapsed time and the decoder's wasm heap size, and the page keeps the last jobs' traces in
// window.__peRawTrace for debugging and the browser checks. No file names or pixels.

/**
 * `sync` stages run inside one synchronous LibRaw or pixel loop: the worker cannot answer or
 * send heartbeats until the stage ends, so they are judged against a size-based budget rather
 * than by silence. `label` is what the import row and preview say while the stage runs.
 */
export const RAW_STAGES = Object.freeze({
  queued: { label: 'Waiting for the RAW decoder', sync: false },
  starting: { label: 'Starting the RAW decoder', sync: false },
  'module-loading': { label: 'Loading the RAW decoder', sync: false },
  reading: { label: 'Reading the RAW file', sync: false },
  opening: { label: 'Reading the RAW header', sync: true },
  decoding: { label: 'Decoding RAW sensor data', sync: true },
  processing: { label: 'Developing from sensor data', sync: true },
  hashing: { label: 'Checking for duplicates', sync: false },
  rendering: { label: 'Rendering', sync: false },
  transferring: { label: 'Handing the image to the editor', sync: false },
});

// Watchdog limits, in seconds of visible time (a hidden page's workers may be suspended).
// Async stages heartbeat every second, so silence means the worker is gone; synchronous
// stages get a budget per megapixel of the work with a generous floor, so a large file on a
// slow phone is never cut short. Measured: 24 MP half-size decode 2.5 s (desktop WebKit),
// full AHD demosaic about 4x that; phones are assumed up to 20x slower than a desktop.
export const RAW_WATCHDOG = Object.freeze({
  startupSeconds: 30,
  silenceSeconds: 20,
  syncFloorSeconds: 120,
  syncSecondsPerMegapixel: { half: 1.5, full: 4 },
  tickMs: 1000,
  // A tick longer than this (a frozen tab, a suspended page) counts as this much.
  maxTickSeconds: 2,
});

/** Seconds a synchronous stage may run before the decoder is treated as unresponsive. */
export function syncBudgetSeconds({ megapixels = 0, full = false } = {}, limits = RAW_WATCHDOG) {
  const perMp = full ? limits.syncSecondsPerMegapixel.full : limits.syncSecondsPerMegapixel.half;
  return Math.max(limits.syncFloorSeconds, Math.ceil(perMp * megapixels));
}

const TRACE_JOBS = 12;

/** Keeps the last few jobs' checkpoints on `win.__peRawTrace` (newest last). */
export function createTraceLog(win = globalThis) {
  return {
    start(job) {
      const entry = { type: job.type, started: Date.now(), checkpoints: [], outcome: null };
      try {
        const log = (win.__peRawTrace ??= []);
        log.push(entry);
        while (log.length > TRACE_JOBS) log.shift();
      } catch { /* a frozen global: tracing is optional */ }
      return entry;
    },
  };
}

/** Megabytes, one decimal, or null. */
export const toMb = (bytes) => (Number.isFinite(bytes) ? Math.round(bytes / 1e5) / 10 : null);
