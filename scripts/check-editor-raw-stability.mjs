// Controlled reproduction of the Playwright WebKit (Windows) crash during LibRaw decoding,
// fixed in Interval 9 by instantiating LibRaw before the file is read (rawTasks.mjs); it now
// fails when any trial does not finish. Drives the production RAW worker bundle directly, without the editor
// UI, so one factor changes at a time: fresh worker per job (the editor) or one reused
// worker, one or two decoders at once, half-size or full decodes, desktop or iPhone
// emulation. Each trial is a new browser; every failure is classified:
//   page-crash    the web content process died (workers run inside it on Windows WebKit)
//   worker-error  a worker 'error' event (worker died, the page survived)
//   job-error     the worker answered with an error (exception inside LibRaw/JS)
//   page-error    an uncaught exception on the page
//   timeout       no answer in time (harness or hang)
// Files are read from RAW_STABILITY_DIR (Sony .ARW, never modified) and served to the page
// by Playwright request routing on localhost only. Results: OUT/raw-stability.json.
// Usage: RAW_STABILITY_DIR=… [TRIALS=10] [JOBS=9] [SCENARIOS=a,b] [ENGINES=webkit,chromium] node scripts/check-editor-raw-stability.mjs
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import { chromium, devices, firefox, webkit } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = process.env.RAW_STABILITY_DIR ?? '';
const FILES = DIR && existsSync(DIR) ? readdirSync(DIR).filter((name) => /\.arw$/i.test(name)).sort().map((name) => path.join(DIR, name)) : [];
const TRIALS = Number(process.env.TRIALS ?? 10);
const JOBS = Number(process.env.JOBS ?? 9);
const OUT = process.env.OUT ?? path.join(root, 'node_modules', '.cache', 'raw-stability');
const ENGINES = (process.env.ENGINES ?? 'webkit').split(',');
const PORT = 4187;
const ORIGIN = `http://localhost:${PORT}`;

// job: half = 'decode' (preview proxy), full = 'develop' (full demosaic, as exports at full size).
const SCENARIOS = {
  'fresh-1-half': { fresh: true, concurrency: 1, job: 'half' },
  'fresh-2-half': { fresh: true, concurrency: 2, job: 'half' },
  'reused-1-half': { fresh: false, concurrency: 1, job: 'half' },
  'fresh-1-full': { fresh: true, concurrency: 1, job: 'full' },
  'fresh-1-half-iphone': { fresh: true, concurrency: 1, job: 'half', device: 'iPhone 13' },
  'fresh-2-full': { fresh: true, concurrency: 2, job: 'full' },
  // Termination and the next start one second apart.
  'fresh-1-half-gap': { fresh: true, concurrency: 1, job: 'half', gapMs: 1000 },
  'reused-1-full': { fresh: false, concurrency: 1, job: 'full' },
  'fresh-1-half-gap5': { fresh: true, concurrency: 1, job: 'half', gapMs: 5000, jobs: 3 },
  // The first worker stays alive (idle); later jobs use fresh workers as the editor does.
  'keep-first-half': { fresh: true, concurrency: 1, job: 'half', keepFirst: true },
  // One job per browser: crashes here cannot come from ending a worker or starting another.
  'single-half': { fresh: true, concurrency: 1, job: 'half', jobs: 1 },
};
const ONLY = process.env.SCENARIOS?.split(',') ?? Object.keys(SCENARIOS);

/** Runs `jobs` decodes in the page and reports each one. Runs in the browser. */
async function pageRun({ workerUrl, files, jobs, fresh, concurrency, job, timeoutMs, gapMs = 0, keepFirst = false }) {
  // Steps go to the console, which the harness reads outside the page, so they survive a crash.
  const step = (text) => console.log(`[raw-stability] ${text}`);
  const blobs = await Promise.all(files.map(async ({ url, width, height }) => ({ blob: await (await fetch(url)).blob(), width, height })));
  const results = [];
  let spawned = 0;
  const spawn = () => { spawned += 1; step(`spawn ${spawned}`); return new Worker(workerUrl, { type: 'module' }); };
  let shared = null;
  let next = 0;

  const one = (worker, index) => new Promise((resolve) => {
    const { blob, width, height } = blobs[index % blobs.length];
    const started = performance.now();
    const timer = setTimeout(() => resolve({ index, kind: 'timeout', ms: performance.now() - started }), timeoutMs);
    const done = (result) => { clearTimeout(timer); worker.removeEventListener('message', onMessage); worker.removeEventListener('error', onError); resolve({ index, ms: Math.round(performance.now() - started), ...result }); };
    const onMessage = ({ data }) => {
      if (data.progress) return;
      done(data.ok ? { kind: 'ok' } : { kind: 'job-error', message: data.error?.message });
    };
    const onError = (event) => { event.preventDefault?.(); done({ kind: 'worker-error', message: event.message || 'worker error event' }); };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    const payload = job === 'full'
      ? { file: blob, raw: { width, height }, width, height }
      : { file: blob, maxEdge: 4096 };
    worker.postMessage({ id: index + 1, type: job === 'full' ? 'develop' : 'decode', payload });
  });
  const lane = async () => {
    while (next < jobs) {
      const index = next;
      next += 1;
      const worker = fresh ? spawn() : (shared ??= spawn());
      const result = await one(worker, index);
      step(`job ${index} ${result.kind}`);
      results.push(result);
      if (keepFirst && index === 0 && result.kind === 'ok') {
        window.__keptWorker = worker;
      } else if (fresh || result.kind !== 'ok') {
        step('terminate');
        worker.terminate();
        step('terminated');
        if (!fresh) shared = null;
        if (gapMs) await new Promise((resolve) => setTimeout(resolve, gapMs));
      }
      window.__rawStability = results;
    }
  };
  await Promise.all(Array.from({ length: concurrency }, lane));
  shared?.terminate();
  return results;
}

async function trial(type, scenario, files, workerUrl) {
  const browser = await type.launch();
  const context = await browser.newContext(scenario.device ? devices[scenario.device] : {});
  const page = await context.newPage();
  const events = [];
  page.on('crash', () => events.push({ kind: 'page-crash' }));
  page.on('pageerror', (error) => events.push({ kind: 'page-error', message: error.message }));
  const steps = [];
  page.on('console', (message) => {
    const text = message.text();
    if (text.startsWith('[raw-stability] ')) steps.push(text.slice(16));
    else if (/mprotect|out of memory|abort/i.test(text)) events.push({ kind: 'console', message: text.slice(0, 200) });
  });
  await page.route(`${ORIGIN}/__raw/*`, (route) => {
    const index = Number(new URL(route.request().url()).pathname.split('/').pop());
    route.fulfill({ status: 200, body: readFileSync(files[index].path), contentType: 'application/octet-stream' });
  });
  const started = Date.now();
  let results = [];
  let outcome = 'ok';
  try {
    await page.goto(`${ORIGIN}/photography/`, { waitUntil: 'load' });
    const run = page.evaluate(pageRun, {
      workerUrl,
      files: files.map((file, index) => ({ url: `${ORIGIN}/__raw/${index}`, width: file.width, height: file.height })),
      jobs: scenario.jobs ?? JOBS,
      gapMs: scenario.gapMs,
      keepFirst: scenario.keepFirst,
      fresh: scenario.fresh,
      concurrency: scenario.concurrency,
      job: scenario.job,
      timeoutMs: 120_000,
    });
    results = await Promise.race([run, new Promise((_, reject) => page.once('crash', () => reject(new Error('page crashed'))))]);
  } catch (error) {
    outcome = events.some(({ kind }) => kind === 'page-crash') ? 'page-crash' : `harness: ${error.message.split('\n')[0].slice(0, 160)}`;
    results = await page.evaluate(() => window.__rawStability ?? []).catch(() => []);
  }
  const failures = results.filter(({ kind }) => kind !== 'ok');
  if (outcome === 'ok' && failures.length) outcome = failures[0].kind;
  await browser.close().catch(() => {});
  const completed = Math.max(results.filter(({ kind }) => kind === 'ok').length, steps.filter((text) => / ok$/.test(text)).length);
  return { outcome, completed, lastSteps: outcome === 'ok' ? [] : steps.slice(-3), failures, events: events.slice(0, 5), seconds: Math.round((Date.now() - started) / 100) / 10, msPerJob: results.length ? Math.round(results.reduce((sum, { ms }) => sum + (ms ?? 0), 0) / results.length) : null };
}

async function main() {
  if (!FILES.length) throw new Error('Set RAW_STABILITY_DIR to a folder with Sony .ARW files.');
  mkdirSync(OUT, { recursive: true });
  await build({ root, logLevel: 'silent', configFile: path.join(root, 'vite.config.mjs') });
  const workerFile = readdirSync(path.join(root, 'dist', 'assets')).find((name) => /^rawWorker-.*\.js$/.test(name));
  const server = await preview({ root, configFile: path.join(root, 'vite.config.mjs'), preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
  // A7 III ARW sizes from the file is enough for 'develop' checks: read from LibRaw in Node would
  // add a dependency here, so the expected size is the A7 III's.
  const files = FILES.slice(0, 3).map((file) => ({ path: file, width: 6024, height: 4024 }));
  const summary = [];
  try {
    for (const engine of ENGINES) {
      const type = { webkit, chromium, firefox }[engine];
      for (const name of ONLY) {
        const scenario = SCENARIOS[name];
        const trials = [];
        for (let i = 0; i < TRIALS; i += 1) {
          const result = await trial(type, scenario, files, `${ORIGIN}/assets/${workerFile}`);
          trials.push(result);
          console.log(`${engine} ${name} #${i + 1}: ${result.outcome} (${result.completed}/${scenario.jobs ?? JOBS} jobs, ${result.seconds}s)${result.lastSteps.length ? ` after: ${result.lastSteps.join(' > ')}` : ''}`);
        }
        const counts = trials.reduce((all, { outcome }) => ({ ...all, [outcome]: (all[outcome] ?? 0) + 1 }), {});
        summary.push({ engine, scenario: name, ...scenario, trials: TRIALS, jobsPerTrial: scenario.jobs ?? JOBS, counts, decodes: trials.reduce((sum, { completed }) => sum + completed, 0), details: trials });
        console.log(`== ${engine} ${name}: ${JSON.stringify(counts)}`);
      }
    }
  } finally {
    server.httpServer.close();
    writeFileSync(path.join(OUT, 'raw-stability.json'), `${JSON.stringify(summary, null, 2)}\n`);
  }
  // Since Interval 9 (LibRaw instantiated before the file is read) any failure is a regression.
  if (summary.some(({ counts }) => Object.keys(counts).some((outcome) => outcome !== 'ok'))) process.exitCode = 1;
}

await main();
