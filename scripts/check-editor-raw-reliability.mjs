// RAW import reliability check of /photography/editor on a production build (Interval 22.8).
// Each run: a decoder that never starts while the page is hidden and then visible (the watchdog
// waits while hidden, then stops it with a message and Retry); Cancel during an import, then Retry;
// a preview whose decoder goes silent (Try again restores it); five import/remove cycles with
// every RAW worker terminated and the queue idle; the checkpoints recorded for each job. The
// stalled decoders are simulated by replacing the RAW worker script from an init script, so no
// test hook ships in the editor. With RAW_RELIABILITY_DIR (a folder of genuine RAW files) it
// also imports each file there, records per-stage timings and wasm heap sizes, and repeats one.
// Runs: Chromium desktop, Chromium with iPhone 13 and Pixel 7 emulation, Playwright WebKit with
// iPhone 13 emulation and Firefox. Engines whose Playwright browser is not installed are reported
// as not run, never skipped silently. Playwright WebKit is not Safari on iOS.
// Usage: npm run check:editor:raw-reliability (RAW_RELIABILITY_RUNS=chromium,iphone-chromium,
// pixel,iphone-webkit,firefox; RAW_RELIABILITY_STEPS=never,cancel,preview,five,sustained,genuine
// runs only the steps naming one of those words; RAW_RELIABILITY_SKIP_BUILD=1 reuses dist/;
// RAW_RELIABILITY_OUT writes the JSON results to a file). The sustained step reports, per cycle,
// measured post-GC JS heap (Chromium), browser memory by process type (Linux, Windows), the RAW
// worker's wasm heap from its checkpoints, and estimated GPU texture memory (WebGL allocations).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import { chromium, devices, firefox, webkit } from 'playwright';
import { createSyntheticDng } from '../src/editor/dev/dngFixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'editor-raw-reliability-'));
const PORT = 4197;
const URL_EDITOR = `http://localhost:${PORT}/photography/editor/`;
const ONLY = process.env.RAW_RELIABILITY_RUNS?.split(',');
// Steps whose names start with one of these words (e.g. never,cancel,preview,five,sustained,genuine).
const ONLY_STEPS = process.env.RAW_RELIABILITY_STEPS?.split(',');
const GENUINE_DIR = process.env.RAW_RELIABILITY_DIR ?? '';
const GENUINE = GENUINE_DIR && existsSync(GENUINE_DIR)
  ? readdirSync(GENUINE_DIR).filter((name) => /\.(arw|nef|nrw|cr2|cr3|raf|rw2|orf|dng|pef)$/i.test(name)).sort().map((name) => path.join(GENUINE_DIR, name))
  : [];

const RUNS = [
  { id: 'chromium', name: 'Chromium, desktop', type: chromium },
  { id: 'iphone-chromium', name: 'Chromium, iPhone 13 emulation', type: chromium, device: 'iPhone 13' },
  { id: 'pixel', name: 'Chromium, Pixel 7 emulation', type: chromium, device: 'Pixel 7' },
  { id: 'iphone-webkit', name: 'WebKit, iPhone 13 emulation', type: webkit, device: 'iPhone 13' },
  { id: 'firefox', name: 'Firefox, desktop', type: firefox },
];

// Stalled decoders: while `stall.mode` is set, the RAW worker script is served as 'never-start'
// (evaluates and posts nothing) or 'silent' (says it is ready, reports loading the decoder, then
// falls silent with no heartbeats, as a worker the browser stopped without an error event would).
// `stall.at` limits it to the Nth RAW worker. Routing disables the HTTP cache, so every worker
// fetches its script. The init script counts RAW workers created and terminated, and lets the
// check hide the page.
const STALLED = {
  'never-start': '',
  silent: "postMessage({ ready: true }); addEventListener('message', ({ data }) => postMessage({ id: data.id, progress: { checkpoint: 'module-loading', ms: 1, wasmBytes: null } }));",
};
const INIT = () => {
  const Native = window.Worker;
  window.__rawWorkers = { created: 0, terminated: 0 };
  window.Worker = class extends Native {
    constructor(url, options) {
      super(url, options);
      if (/rawWorker/.test(String(url))) {
        window.__rawWorkers.created += 1;
        const terminate = this.terminate.bind(this);
        this.terminate = () => { if (!this.ended) { this.ended = true; window.__rawWorkers.terminated += 1; } terminate(); };
      }
    }
  };
  // Estimated GPU texture memory: bytes of every live texture's level 0, from its allocations.
  const proto = window.WebGL2RenderingContext?.prototype;
  if (proto) {
    const BYTES = { 0x8229: 1, 0x8058: 4, 0x8d7c: 6, 0x8815: 12, 0x8814: 16, 0x881a: 8, 0x822e: 4, 0x8230: 8 };
    const live = new Map();
    const bound = new WeakMap();
    window.__gpuTextureBytes = () => [...live.values()].reduce((sum, bytes) => sum + bytes, 0);
    const wrap = (name, fn) => { const original = proto[name]; proto[name] = function wrapped(...args) { const out = original.apply(this, args); fn.call(this, args, out); return out; }; };
    wrap('bindTexture', function bindTexture([target, texture]) { if (target === this.TEXTURE_2D) bound.set(this, texture); });
    wrap('deleteTexture', ([texture]) => live.delete(texture));
    wrap('texImage2D', function texImage2D(args) { const texture = bound.get(this); if (texture && args[1] === 0 && typeof args[3] === 'number' && typeof args[4] === 'number') live.set(texture, args[3] * args[4] * (BYTES[args[2]] ?? 4)); });
    wrap('texStorage2D', function texStorage2D(args) { const texture = bound.get(this); if (texture) live.set(texture, args[3] * args[4] * (BYTES[args[2]] ?? 4)); });
  }
  window.__hidden = false;
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (window.__hidden ? 'hidden' : 'visible') });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hidden });
};

// Resident memory of the browser started with this profile, by Chromium process type (Linux:
// /proc via ps, MB) or the whole browser's working set (Windows). Null where not measurable.
function browserMemory(profile) {
  try {
    if (process.platform === 'linux') {
      const rows = execFileSync('ps', ['-eo', 'pid=,ppid=,rss=,args='], { maxBuffer: 1 << 24 }).toString().trim().split('\n').map((line) => {
        const [, pid, ppid, rss, args] = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/) ?? [];
        return { pid: Number(pid), ppid: Number(ppid), rss: Number(rss), args: args ?? '' };
      });
      const ids = new Set(rows.filter((r) => r.args.includes(profile)).map((r) => r.pid));
      let size;
      do { size = ids.size; rows.forEach((r) => { if (ids.has(r.ppid)) ids.add(r.pid); }); } while (ids.size > size);
      const byType = {};
      rows.filter((r) => ids.has(r.pid)).forEach((r) => { const type = r.args.match(/--type=([\w-]+)/)?.[1] ?? 'browser'; byType[type] = (byType[type] ?? 0) + r.rss / 1024; });
      return Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, Math.round(v)]));
    }
    if (process.platform === 'win32') {
      const command = ['$all = Get-CimInstance Win32_Process', `$ids = @($all | Where-Object { $_.CommandLine -like '*${path.basename(profile)}*' } | ForEach-Object { $_.ProcessId })`, 'do { $before = $ids.Count; $ids = @($ids + ($all | Where-Object { $ids -contains $_.ParentProcessId } | ForEach-Object { $_.ProcessId }) | Sort-Object -Unique) } while ($ids.Count -gt $before)', '($all | Where-Object { $ids -contains $_.ProcessId } | Measure-Object -Property WorkingSetSize -Sum).Sum'].join('; ');
      return { total: Math.round(Number(execFileSync('powershell', ['-NoProfile', '-Command', command]).toString().trim()) / 1048576) };
    }
  } catch { /* not measurable here */ }
  return null;
}

async function poll(read, done, label, timeout = 30_000) {
  const end = Date.now() + timeout;
  let value;
  while (Date.now() < end) {
    value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${label} (last value ${JSON.stringify(value)})`);
}

const rowOf = (page, name) => page.locator('.pe-photo--list').filter({ hasText: name });
const rowState = (page, name) => rowOf(page, name).evaluate((li) => ({ status: li.dataset.status, detail: li.querySelector('.pe-photo__detail')?.textContent ?? '' })).catch(() => null);
const traces = (page) => page.evaluate(() => (window.__peRawTrace ?? []).map((t) => ({ type: t.type, outcome: t.outcome, ms: t.ms ?? null, checkpoints: t.checkpoints })));
const previewShown = (page) => page.evaluate(() => !document.querySelector('.pe-stage-message') && !document.querySelector('.pe-canvas-host').hidden);

async function runOne(run, fixtures) {
  const profile = mkdtempSync(path.join(work, 'profile-'));
  const context = await run.type.launchPersistentContext(profile, { ...(run.device ? devices[run.device] : {}), acceptDownloads: true });
  await context.addInitScript(INIT);
  const stall = { mode: null, at: 0, served: 0 };
  await context.route(/\/assets\/rawWorker-[^/]+\.js$/, (route) => {
    stall.served += 1;
    const mode = stall.mode && (!stall.at || stall.at === stall.served) ? stall.mode : null;
    return mode ? route.fulfill({ contentType: 'text/javascript', body: STALLED[mode] }) : route.continue();
  });
  const page = context.pages()[0] ?? await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('crash', () => problems.push('page crashed'));
  const tab = async (index) => { if (run.device) await page.click(`.pe-tabs button:nth-child(${index})`); };
  const result = { environment: run.name, browser: `${run.type.name()} ${context.browser()?.version() ?? ''}`.trim(), steps: {} };
  const step = async (name, fn) => {
    if (ONLY_STEPS && !ONLY_STEPS.some((word) => name.toLowerCase().includes(word))) return;
    result.step = name;
    const started = Date.now();
    const value = await fn();
    result.steps[name] = { ms: Date.now() - started, ...(value ?? {}) };
  };
  const importFile = (file) => page.setInputFiles('input[type=file][multiple]', file);
  const remove = async (name) => { await tab(1); await page.getByRole('button', { name: `Remove ${name} from the workspace` }).click(); };
  try {
    await page.goto(URL_EDITOR, { waitUntil: 'load' });
    await page.waitForSelector('.pe[data-engine]', { timeout: 30_000 });
    result.engine = await page.$eval('.pe', (el) => el.dataset.engine);

    await step('decoder that never starts: waits while hidden, then stops with Retry', async () => {
      stall.mode = 'never-start';
      await page.evaluate(() => { window.__hidden = true; });
      await importFile(fixtures.dng);
      await tab(1);
      // 40 s hidden is past the 30 s startup limit: nothing may fail while the page is hidden.
      await page.waitForTimeout(40_000);
      const whileHidden = await rowState(page, 'synthetic.dng');
      assert.equal(whileHidden?.status, 'importing', `a hidden page must not fail the import: ${JSON.stringify(whileHidden)}`);
      const hiddenFor = 40;
      await page.evaluate(() => { window.__hidden = false; });
      const shown = Date.now();
      const failed = await poll(() => rowState(page, 'synthetic.dng'), (s) => s?.status === 'error', 'stalled import', 60_000);
      const stoppedAfter = Math.round((Date.now() - shown) / 1000);
      assert.match(failed.detail, /RAW decoder stopped responding \(starting the raw decoder, 3\d s/i);
      assert.ok(stoppedAfter >= 28 && stoppedAfter <= 40, `stopped ${stoppedAfter} s after the page was shown`);
      const workers = await page.evaluate(() => ({ ...window.__rawWorkers }));
      assert.equal(workers.terminated, workers.created, 'the stalled worker was terminated');
      stall.mode = null;
      await page.getByRole('button', { name: 'Try importing synthetic.dng again' }).click();
      await poll(() => rowState(page, 'synthetic.dng'), (s) => s?.status === 'ready', 'retried import', 60_000);
      await poll(() => previewShown(page), Boolean, 'preview after retry', 60_000);
      await remove('synthetic.dng');
      return { hiddenSeconds: hiddenFor, stoppedAfterVisibleSeconds: stoppedAfter };
    });

    await step('cancel an import, then retry it', async () => {
      stall.mode = 'silent';
      await importFile(fixtures.dng);
      await tab(1);
      await poll(() => rowState(page, 'synthetic.dng'), (s) => /Loading the RAW decoder/.test(s?.detail ?? ''), 'loading stage shown', 20_000);
      await page.getByRole('button', { name: 'Cancel importing synthetic.dng' }).click();
      const cancelled = await poll(() => rowState(page, 'synthetic.dng'), (s) => s?.status === 'error', 'cancelled', 10_000);
      assert.equal(cancelled.detail, 'Import cancelled.');
      stall.mode = null;
      await page.getByRole('button', { name: 'Try importing synthetic.dng again' }).click();
      await poll(() => rowState(page, 'synthetic.dng'), (s) => s?.status === 'ready', 'retried import', 60_000);
      await poll(() => previewShown(page), Boolean, 'preview', 60_000);
      await remove('synthetic.dng');
    });

    await step('a preview decoder that goes silent: message, then Try again', async () => {
      // The import is RAW worker N + 1; the preview decode is N + 2.
      Object.assign(stall, { mode: 'silent', at: stall.served + 2 });
      await importFile(fixtures.dng);
      await tab(1);
      await poll(() => rowState(page, 'synthetic.dng'), (s) => s?.status === 'ready', 'import', 60_000);
      await tab(1);
      const message = await poll(() => page.locator('.pe-stage-message--error').textContent().catch(() => ''), (t) => /stopped responding/.test(t), 'preview stalled', 60_000);
      assert.match(message, /Loading the RAW decoder/i);
      Object.assign(stall, { mode: null, at: 0 });
      await page.getByRole('button', { name: 'Try again' }).click();
      await poll(() => previewShown(page), Boolean, 'preview after Try again', 60_000);
      await remove('synthetic.dng');
    });

    await step('five import/remove cycles leave no RAW worker and an idle queue', async () => {
      const before = await page.evaluate(() => ({ ...window.__rawWorkers }));
      const times = [];
      for (let i = 0; i < 5; i += 1) {
        const started = Date.now();
        await importFile(fixtures.dng);
        await tab(1);
        await poll(() => rowState(page, 'synthetic.dng'), (s) => s?.status === 'ready', 'import', 60_000);
        await poll(() => previewShown(page), Boolean, 'preview', 60_000);
        times.push(Date.now() - started);
        await remove('synthetic.dng');
      }
      const after = await poll(() => page.evaluate(() => ({ ...window.__rawWorkers })), (w) => w.created === w.terminated, 'all RAW workers terminated', 10_000);
      assert.equal(after.created - before.created, 10, 'one import and one preview worker per cycle');
      assert.equal(await page.locator('.pe-photo--list').count(), 0);
      return { cycleMs: times };
    });

    if (fixtures.genuine.length) {
      await step('sustained session: import, develop, full-size export, remove (3 cycles × 2 RAW)', async () => {
        const cdp = run.type === chromium ? await context.newCDPSession(page) : null;
        const jsHeapMb = async () => {
          if (!cdp) return null;
          await cdp.send('HeapProfiler.collectGarbage');
          const { usedSize } = await cdp.send('Runtime.getHeapUsage');
          return Math.round(usedSize / 1e5) / 10;
        };
        const sample = async (label) => ({ label, jsHeapMb: await jsHeapMb(), gpuTexturesMbEstimated: await page.evaluate(() => Math.round((window.__gpuTextureBytes?.() ?? 0) / 1e5) / 10), browserMb: browserMemory(profile), rawWorkersAlive: await page.evaluate(() => window.__rawWorkers.created - window.__rawWorkers.terminated) });
        const samples = [await sample('empty')];
        const files = fixtures.genuine.slice(0, 2);
        const exports = [];
        for (let cycle = 1; cycle <= 3; cycle += 1) {
          for (const file of files) {
            const name = path.basename(file);
            await importFile(file);
            await tab(1);
            await poll(() => rowState(page, name), (st) => st?.status === 'ready', `import of ${name}`, 300_000);
            await rowOf(page, name).locator('button.pe-photo__select').click();
            await poll(() => previewShown(page), Boolean, `preview of ${name}`, 300_000);
            if (cycle === 1) samples.push(await sample(`${name} shown`));
            await tab(3);
            const format = await page.isEnabled('input[name=pe-format][value=jpeg]') ? 'jpeg' : 'png';
            await page.check(`input[name=pe-format][value=${format}]`);
            const started = Date.now();
            let peak = 0;
            const sampler = setInterval(() => { const m = browserMemory(profile); if (m) peak = Math.max(peak, Object.values(m).reduce((a, b) => a + b, 0)); }, 500);
            const [download] = await Promise.all([page.waitForEvent('download', { timeout: 600_000 }), page.click('.pe-export-button')]);
            clearInterval(sampler);
            exports.push({ cycle, name, ms: Date.now() - started, file: download.suggestedFilename(), browserPeakMb: peak || null, wasmPeakMb: Math.max(0, ...(await traces(page)).filter((t) => t.type === 'export').at(-1)?.checkpoints.map((c) => c.wasmMb ?? 0) ?? [0]) });
            await download.delete();
            await remove(name);
          }
          await poll(() => page.evaluate(() => window.__rawWorkers.created - window.__rawWorkers.terminated), (n) => n === 0, 'RAW workers ended', 20_000);
          samples.push(await sample(`after cycle ${cycle}`));
        }
        const heap = samples.filter((x) => /after cycle/.test(x.label)).map((x) => x.jsHeapMb);
        if (heap[0] !== null) assert.ok(heap[2] - heap[0] < 20, `JS heap grew ${heap[2] - heap[0]} MB from cycle 1 to 3`);
        if (cdp) await cdp.detach();
        return { samples, exports };
      });

      await step('genuine RAW files: per-stage timings and wasm heap', async () => {
        const files = [];
        for (const file of fixtures.genuine) {
          const name = path.basename(file);
          const started = Date.now();
          await importFile(file);
          await tab(1);
          const state = await poll(() => rowState(page, name), (s) => s && s.status !== 'importing', `import of ${name}`, 300_000);
          const importMs = Date.now() - started;
          let previewMs = null;
          if (state.status === 'ready') {
            await rowOf(page, name).locator('button.pe-photo__select').click();
            previewMs = await poll(() => previewShown(page), Boolean, `preview of ${name}`, 300_000).then(() => Date.now() - started);
          }
          const jobs = (await traces(page)).slice(-2);
          files.push({ name, status: state.status, detail: state.status === 'ready' ? state.detail : state.detail.slice(0, 160), importMs, previewMs, jobs: jobs.map((job) => ({ type: job.type, ms: job.ms, outcome: job.outcome, stages: job.checkpoints.map((c) => `${c.stage}@${c.at}${c.wasmMb !== null ? `/${c.wasmMb}MB` : ''}`).join(' ') })) });
          await remove(name);
        }
        const failed = files.filter((f) => f.status !== 'ready' && !/not supported|Nikon High Efficiency/.test(f.detail));
        assert.deepEqual(failed, [], 'every validated format imports');
        const workers = await poll(() => page.evaluate(() => ({ ...window.__rawWorkers })), (w) => w.created === w.terminated, 'workers ended', 10_000);
        return { files, workers };
      });
    }
    result.traceSample = (await traces(page)).slice(-2);
    assert.deepEqual(problems, []);
    result.ok = true;
  } catch (error) {
    result.ok = false;
    result.error = `${result.step}: ${error.message.split('\n')[0]}`;
    result.problems = problems;
  } finally {
    await context.close();
  }
  return result;
}

async function main() {
  const fixtures = { dng: path.join(work, 'synthetic.dng'), genuine: GENUINE };
  writeFileSync(fixtures.dng, createSyntheticDng({ width: 600, height: 400, scene: (x, y) => [0.2 + 0.5 * (x / 600), 0.3, 0.1 + 0.4 * (y / 400)] }));
  if (!process.env.RAW_RELIABILITY_SKIP_BUILD) await build({ root, logLevel: 'warn' });
  const server = await preview({ root, preview: { port: PORT, strictPort: true }, logLevel: 'warn' });
  const results = [];
  try {
    for (const run of RUNS.filter(({ id }) => !ONLY || ONLY.includes(id))) {
      if (!existsSync(run.type.executablePath())) { results.push({ environment: run.name, ok: null, error: `not run: Playwright ${run.type.name()} is not installed (npx playwright install ${run.type.name()})` }); continue; }
      results.push(await runOne(run, fixtures));
      console.log(JSON.stringify(results.at(-1)));
    }
  } finally {
    await server.close();
    rmSync(work, { recursive: true, force: true });
  }
  if (process.env.RAW_RELIABILITY_OUT) writeFileSync(process.env.RAW_RELIABILITY_OUT, JSON.stringify(results, null, 2));
  console.log('\nRAW reliability:');
  for (const r of results) console.log(`  ${r.ok === null ? 'NOT RUN' : r.ok ? 'ok     ' : 'FAILED '} ${r.environment}${r.error ? ` — ${r.error}` : ''}`);
  if (results.some((r) => r.ok === false)) process.exit(1);
}

await main();
