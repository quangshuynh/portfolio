// Memory probe of /photography/editor on a production build (Chromium, Windows): runs the
// heavy workflows with genuine files and records, after each one and a forced collection,
// the whole browser's working set (page, GPU and worker processes), the page's JS heap and
// the live dedicated workers. Repeated runs of the same workflow must not keep growing, and
// workers must not outlive their jobs. Files come from MEMORY_FIXTURE_DIR (Sony .ARW and
// their camera .JPG, read only); results go to MEMORY_OUT (JSON), never into the repository.
// Usage: MEMORY_FIXTURE_DIR=… [MEMORY_REPEATS=3] [MEMORY_CYCLES=2] [CHECK_GPU=1] [MEMORY_SKIP_BUILD=1] npm run check:editor:memory
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = process.env.MEMORY_FIXTURE_DIR ?? '';
const list = (pattern) => (DIR && existsSync(DIR) ? readdirSync(DIR).filter((name) => pattern.test(name)).sort().slice(0, 3).map((name) => path.join(DIR, name)) : []);
const RAWS = list(/\.arw$/i);
const JPEGS = list(/\.jpe?g$/i);
const REPEATS = Number(process.env.MEMORY_REPEATS ?? 3);
const OUT = process.env.MEMORY_OUT ?? '';
const PORT = 4189;
const URL_EDITOR = `http://localhost:${PORT}/photography/editor/`;
// A workflow repeated on the same files may settle higher once, but not keep climbing.
const GROWTH_LIMIT_MB = Number(process.env.MEMORY_GROWTH_LIMIT_MB ?? 200);
// More than two cycles tell a leak (growing every cycle) from memory kept once.
const CYCLES = Math.max(2, Number(process.env.MEMORY_CYCLES ?? 2));

async function poll(read, done, label, timeout = 30_000) {
  const end = Date.now() + timeout;
  let value;
  while (Date.now() < end) {
    value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label} (last value ${JSON.stringify(value)})`);
}

// The browser's processes (found by the profile folder on their command line, then their
// children), with working set and private commit in MB, summed per Chromium process type.
async function processMemory(profile) {
  if (process.platform !== 'win32') return null;
  const command = [
    '$all = Get-CimInstance Win32_Process',
    // Roots: browser executables started with this run's own temporary folder (unique), never
    // just "profile", which also matched this PowerShell (-NoProfile), other browsers
    // (--profile-directory) and concurrent Playwright runs (playwright_chromiumdev_profile-*).
    `$ids = @($all | Where-Object { $_.Name -match '^(chrome|headless_shell|chromium)\.exe$' -and $_.CommandLine -like '*${path.basename(path.dirname(profile))}*' } | ForEach-Object { $_.ProcessId })`,
    'do { $before = $ids.Count; $ids = @($ids + ($all | Where-Object { $ids -contains $_.ParentProcessId } | ForEach-Object { $_.ProcessId }) | Sort-Object -Unique) } while ($ids.Count -gt $before)',
    '$all | Where-Object { $ids -contains $_.ProcessId } | ForEach-Object { $t = if ($_.CommandLine -match "--type=([a-z-]+)") { $matches[1] } else { "browser" }; if ($_.CommandLine -match "--utility-sub-type=([A-Za-z.]+)") { $t = "utility:" + $matches[1].Split(".")[-1] }; "$t $($_.WorkingSetSize) $($_.PrivatePageCount)" }',
  ].join('; ');
  try {
    const { stdout } = await promisify(execFile)('powershell', ['-NoProfile', '-Command', command]);
    const byType = {};
    let total = 0;
    let privateTotal = 0;
    for (const line of stdout.trim().split(/\r?\n/)) {
      const [type, ws, priv] = line.trim().split(' ');
      if (!type || !Number(ws)) continue; // eslint-disable-line no-continue
      const mb = Math.round(Number(ws) / 1048576);
      const privateMb = Math.round(Number(priv) / 1048576);
      byType[type] = byType[type] ?? { workingSetMb: 0, privateMb: 0, count: 0 };
      byType[type].workingSetMb += mb;
      byType[type].privateMb += privateMb;
      byType[type].count += 1;
      total += mb;
      privateTotal += privateMb;
    }
    return total ? { workingSetMb: total, privateMb: privateTotal, byType } : null;
  } catch { return null; }
}
const workingSetMb = async (profile) => (await processMemory(profile))?.workingSetMb ?? null;

// Samples every 250 ms; keeps the timeline and the breakdown at the peak.
function sampler(profile, label, timeline) {
  const samples = [];
  let running = true;
  const started = Date.now();
  const loop = (async () => {
    while (running) {
      const memory = await processMemory(profile);
      if (memory) samples.push({ t: Date.now() - started, ...memory });
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  })();
  return async () => {
    running = false;
    await loop;
    timeline.push({ label, samples: samples.map(({ t, workingSetMb: ws, privateMb, byType }) => ({ t, ws, privateMb, gpu: byType['gpu-process']?.workingSetMb ?? 0, renderer: byType.renderer?.workingSetMb ?? 0 })) });
    if (!samples.length) return { peakMb: null };
    const peak = samples.reduce((a, b) => (b.workingSetMb > a.workingSetMb ? b : a));
    return { peakMb: peak.workingSetMb, peakAtMs: peak.t, peakPrivateMb: peak.privateMb, peakByType: Object.fromEntries(Object.entries(peak.byType).map(([type, v]) => [type, v.workingSetMb])) };
  };
}

async function main() {
  if (RAWS.length < 3 || JPEGS.length < 1) throw new Error('Set MEMORY_FIXTURE_DIR to a folder with three Sony .ARW files (a bracket) and their .JPG.');
  if (OUT) mkdirSync(OUT, { recursive: true });
  if (!process.env.MEMORY_SKIP_BUILD) await build({ root, logLevel: 'silent', configFile: path.join(root, 'vite.config.mjs') });
  const server = await preview({ root, configFile: path.join(root, 'vite.config.mjs'), preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
  const work = mkdtempSync(path.join(tmpdir(), 'editor-memory-'));
  const profile = path.join(work, 'profile');
  // CHECK_GPU=1: the real GPU (its memory is mostly on the card, outside the working set);
  // otherwise headless SwiftShader, whose textures and framebuffers live in the GPU process.
  const args = process.env.CHECK_GPU ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : [];
  const context = await chromium.launchPersistentContext(profile, { acceptDownloads: true, viewport: { width: 1440, height: 900 }, args });
  const page = context.pages()[0] ?? await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('crash', () => problems.push('page crashed'));
  const results = { browser: `chromium ${context.browser()?.version() ?? ''}`.trim(), files: [...RAWS, ...JPEGS].map((file) => path.basename(file)), gpu: Boolean(process.env.CHECK_GPU), steps: [], timeline: [] };

  const names = (files) => files.map((file) => path.basename(file));
  const photoButton = (name) => page.locator(`.pe-photo--list button.pe-photo__select[aria-label^="${name},"]`);
  const readyCount = () => page.$$eval('.pe-photo--list', (items) => items.filter((li) => li.dataset.status === 'ready').length);
  const previewShown = () => poll(() => page.evaluate(() => !document.querySelector('.pe-stage-message') && !document.querySelector('.pe-canvas-host').hidden), Boolean, 'preview', 180_000);
  /** Settles, collects garbage and measures. */
  // What the page still holds outside its JS heap: live ArrayBuffers (typed arrays' memory),
  // canvases (their pixels live in the renderer or the GPU process) and ImageBitmaps.
  const live = async (constructor, reduce) => {
    try {
      // Held in a group of its own and released: otherwise the result array keeps every
      // object it found alive (and the check would measure its own leak).
      const { result: proto } = await cdp.send('Runtime.evaluate', { expression: `${constructor}.prototype`, objectGroup: 'memory-check' });
      const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.objectId, objectGroup: 'memory-check' });
      const { result } = await cdp.send('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: reduce, returnByValue: true });
      return result.value;
    } catch { return null; } finally {
      await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'memory-check' }).catch(() => {});
    }
  };
  const pageObjects = async () => ({
    pageBuffersMb: await live('ArrayBuffer', 'function () { return Math.round(this.reduce((sum, b) => sum + b.byteLength, 0) / 1048576); }'),
    canvases: await live('HTMLCanvasElement', 'function () { return { count: this.length, attached: this.filter((c) => c.isConnected).length, megapixels: Math.round(this.reduce((sum, c) => sum + c.width * c.height, 0) / 1e5) / 10 }; }'),
    bitmaps: await live('ImageBitmap', 'function () { return this.filter((b) => b.width > 0).length; }'),
  });
  const measure = async (label, extra = {}) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 500));
    const { metrics } = await cdp.send('Performance.getMetrics');
    const heap = metrics.find(({ name }) => name === 'JSHeapUsedSize')?.value ?? 0;
    const memory = await processMemory(profile);
    const entry = { label, workingSetMb: memory?.workingSetMb ?? null, privateMb: memory?.privateMb ?? null, gpuMb: memory?.byType['gpu-process']?.workingSetMb ?? null, pageHeapMb: Math.round(heap / 1048576), ...(await pageObjects()), workers: page.workers().length, ...extra };
    results.steps.push(entry);
    console.log(JSON.stringify(entry));
    return entry;
  };
  const timed = async (label, fn) => {
    const stop = sampler(profile, label, results.timeline);
    const started = Date.now();
    await fn();
    const ms = Date.now() - started;
    return measure(label, { ms, ...(await stop()) });
  };
  const importFiles = async (files) => {
    const total = (await readyCount()) + files.length;
    await page.setInputFiles('.pe-library input[type=file][multiple]', files);
    await poll(readyCount, (n) => n >= total, 'imports', 300_000);
  };
  const removeAll = async () => {
    for (const name of await page.$$eval('.pe-photo--list .pe-photo__name', (nodes) => nodes.map((node) => node.textContent))) {
      await page.getByRole('button', { name: `Remove ${name} from the workspace` }).click();
    }
    await poll(() => page.$$eval('.pe-photo--list', (items) => items.length), (n) => n === 0, 'empty workspace');
  };
  const setValue = async (label, next) => {
    const field = page.getByRole('textbox', { name: `${label} value` });
    if (!await field.isVisible()) {
      const toggle = page.locator('.pe-section[data-section-id=detail] .pe-section__toggle');
      if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    }
    await field.fill(String(next));
    await field.press('Enter');
  };
  const exportOne = () => Promise.all([page.waitForEvent('download', { timeout: 600_000 }), page.click('.pe-export-button')]);
  const openMerge = async (files) => {
    await page.click('.pe-library__actions button:has-text("Merge HDR")');
    await page.setInputFiles('.pe-dialog input[type=file][multiple]', files);
    await poll(() => page.$$eval('.pe-bracket__item select', (s) => s.map((e) => e.value)), (r) => r.length === 3 && r.every(Boolean), 'bracket roles', 180_000);
  };
  const batchZip = async (cancelAfter = null) => {
    await page.keyboard.press('Control+A');
    await page.click('.pe-batch__actions button:has-text("Export")');
    const dialog = page.locator('.pe-dialog[role=dialog]');
    await dialog.locator('input[name=pe-batch-output][value=zip]').check();
    await dialog.locator('input[name=pe-batch-format][value=jpeg]').check();
    await dialog.locator('select').selectOption('original');
    if (cancelAfter !== null) {
      await page.evaluate((after) => {
        const observer = new MutationObserver(() => {
          if (document.querySelectorAll('.pe-batch-plan__item[data-export=done]').length < after) return;
          [...document.querySelectorAll('.pe-dialog__foot button')].find((button) => button.textContent === 'Cancel')?.click();
          observer.disconnect();
        });
        observer.observe(document.querySelector('.pe-dialog'), { subtree: true, attributes: true, attributeFilter: ['data-export'] });
      }, cancelAfter);
    }
    const downloads = [];
    const listener = (download) => downloads.push(download);
    page.on('download', listener);
    await dialog.locator('.pe-dialog__foot button.pe-button--primary').click();
    const outcome = await poll(() => dialog.locator('[data-batch-outcome]').textContent().catch(() => null), Boolean, 'batch outcome', 900_000);
    await new Promise((resolve) => setTimeout(resolve, 500));
    page.off('download', listener);
    await page.click('.pe-dialog__foot button:has-text("Close")');
    return { outcome, downloads: downloads.map((download) => download.suggestedFilename()) };
  };

  try {
    await page.goto(URL_EDITOR, { waitUntil: 'load' });
    await page.waitForSelector('.pe[data-engine]', { timeout: 30_000 });
    const baseline = await measure('editor loaded');

    for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
      await timed(`cycle ${cycle}: import 3 ARW + ${JPEGS.length} JPEG`, () => importFiles([...RAWS, ...JPEGS]));
      await timed(`cycle ${cycle}: switch between photos ${REPEATS * 3}×`, async () => {
        for (let i = 0; i < REPEATS * 3; i += 1) {
          await photoButton(names([...RAWS, ...JPEGS])[i % (RAWS.length + JPEGS.length)]).click();
          await previewShown();
        }
      });
      await photoButton(names(RAWS)[1]).click();
      await previewShown();
      await setValue('Texture', 20);
      await setValue('Clarity', 15);
      await setValue('Sharpening', 40);
      const exported = [];
      for (let i = 0; i < REPEATS; i += 1) {
        const step = await timed(`cycle ${cycle}: full-size RAW JPEG export with Detail #${i + 1}`, async () => {
          const [download] = await exportOne();
          exported.push(download.suggestedFilename());
        });
        step.file = exported.at(-1);
      }
      await timed(`cycle ${cycle}: Merge HDR cancelled`, async () => {
        await openMerge(RAWS);
        await page.click('.pe-dialog__foot button:has-text("Merge")');
        await poll(() => page.textContent('.pe-dialog'), (t) => /Decoding|Aligning|Merging/.test(t), 'merge running', 60_000);
        await page.click('.pe-dialog button:has-text("Cancel")');
        await poll(() => page.textContent('.pe-dialog'), (t) => /Merge cancelled/.test(t), 'merge cancelled', 60_000);
        await page.click('.pe-dialog__foot button:has-text("Close")');
      });
      await timed(`cycle ${cycle}: Merge HDR`, async () => {
        await openMerge(RAWS);
        await page.click('.pe-dialog__foot button:has-text("Merge")');
        await page.waitForSelector('.pe-dialog', { state: 'detached', timeout: 300_000 });
        await previewShown();
      });
      await timed(`cycle ${cycle}: HDR Detail adjustments`, async () => {
        await setValue('Clarity', 30);
        await setValue('Dehaze', 10);
        await previewShown();
      });
      await timed(`cycle ${cycle}: local Clarity brush, ${REPEATS} strokes, tool put away`, async () => {
        await photoButton(names(JPEGS)[0]).click();
        await previewShown();
        await page.locator('.pe-masks__add[aria-label="New local adjustment"] button', { hasText: /^Brush$/ }).click();
        await setValue('Clarity', 40);
        const host = await page.locator('.pe-canvas-host').boundingBox();
        for (let i = 0; i < REPEATS; i += 1) {
          const y = host.y + host.height * (0.3 + 0.2 * i);
          await page.mouse.move(host.x + host.width * 0.2, y);
          await page.mouse.down();
          for (let k = 1; k <= 20; k += 1) await page.mouse.move(host.x + host.width * (0.2 + 0.03 * k), y + 10 * Math.sin(k)); // eslint-disable-line no-await-in-loop
          await page.mouse.up();
        }
        await poll(() => page.evaluate(() => document.querySelector('[data-detail-preview]')?.dataset.detailPreview ?? null), (q) => q === 'final', 'local Detail preview', 120_000);
        await page.keyboard.press('Escape');
        await previewShown();
      });
      await timed(`cycle ${cycle}: ZIP of all photos cancelled after 1, then complete`, async () => {
        const cancelled = await batchZip(1);
        assert.match(cancelled.outcome, /cancelled/);
        const full = await batchZip();
        assert.match(full.outcome, /Saved \d+ of \d+ in one ZIP/);
      });
      await timed(`cycle ${cycle}: remove every photo`, removeAll);
    }
    // Download URLs are revoked 30 s after each download starts; then only caches remain.
    await new Promise((resolve) => setTimeout(resolve, 35_000));
    const idle = await measure('empty workspace, 35 s later');
    const end = results.steps.at(-2);
    // Growth between the last two cycles (the first may settle higher once).
    const empties = results.steps.filter(({ label }) => / remove every photo$/.test(label));
    const firstEmpty = empties.at(-2);
    results.summary = {
      baselineMb: baseline.workingSetMb,
      afterEachCycleMb: empties.map(({ workingSetMb: mb }) => mb),
      afterEachCyclePrivateMb: empties.map(({ privateMb }) => privateMb),
      afterEachCycleGpuMb: empties.map(({ gpuMb }) => gpuMb),
      idleMb: idle.workingSetMb,
      growthMb: end.workingSetMb && firstEmpty.workingSetMb ? end.workingSetMb - firstEmpty.workingSetMb : null,
      workersAtEnd: end.workers,
      workersAtStart: baseline.workers,
    };
    console.log(JSON.stringify(results.summary));
    assert.deepEqual(problems, [], problems.join('\n'));
    // An empty workspace keeps no RAW, export, HDR or band workers.
    assert.ok(end.workers <= baseline.workers + 1, `workers left: ${end.workers}`);
    if (results.summary.growthMb !== null) assert.ok(results.summary.growthMb < GROWTH_LIMIT_MB, `grew ${results.summary.growthMb} MB between identical cycles`);
    results.ok = true;
  } catch (error) {
    results.ok = false;
    results.error = error.message.replace(/\s+/g, ' ').slice(0, 500);
    results.problems = problems;
    process.exitCode = 1;
    console.error(results.error);
  } finally {
    await context.close();
    server.httpServer.close();
    rmSync(work, { recursive: true, force: true });
    if (OUT) writeFileSync(path.join(OUT, 'memory.json'), `${JSON.stringify(results, null, 2)}\n`);
  }
}

await main();
