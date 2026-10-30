// Memory probe of /photography/editor on a production build (Chromium, Windows): runs the
// heavy workflows with genuine files and records, after each one and a forced collection,
// the whole browser's working set (page, GPU and worker processes), the page's JS heap and
// the live dedicated workers. Repeated runs of the same workflow must not keep growing, and
// workers must not outlive their jobs. Files come from MEMORY_FIXTURE_DIR (Sony .ARW and
// their camera .JPG, read only); results go to MEMORY_OUT (JSON), never into the repository.
// Usage: MEMORY_FIXTURE_DIR=… [MEMORY_REPEATS=3] npm run check:editor:memory
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

async function workingSetMb(profile) {
  if (process.platform !== 'win32') return null;
  const command = [
    '$all = Get-CimInstance Win32_Process',
    `$ids = @($all | Where-Object { $_.CommandLine -like '*${path.basename(profile)}*' } | ForEach-Object { $_.ProcessId })`,
    'do { $before = $ids.Count; $ids = @($ids + ($all | Where-Object { $ids -contains $_.ParentProcessId } | ForEach-Object { $_.ProcessId }) | Sort-Object -Unique) } while ($ids.Count -gt $before)',
    '($all | Where-Object { $ids -contains $_.ProcessId } | Measure-Object -Property WorkingSetSize -Sum).Sum',
  ].join('; ');
  try {
    const { stdout } = await promisify(execFile)('powershell', ['-NoProfile', '-Command', command]);
    return Math.round(Number(stdout.trim()) / 1048576) || null;
  } catch { return null; }
}

function sampler(profile) {
  const peaks = [];
  let running = true;
  const loop = (async () => {
    while (running) {
      const mb = await workingSetMb(profile);
      if (mb) peaks.push(mb);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  })();
  return async () => { running = false; await loop; return peaks.length ? Math.max(...peaks) : null; };
}

async function main() {
  if (RAWS.length < 3 || JPEGS.length < 1) throw new Error('Set MEMORY_FIXTURE_DIR to a folder with three Sony .ARW files (a bracket) and their .JPG.');
  if (OUT) mkdirSync(OUT, { recursive: true });
  await build({ root, logLevel: 'silent', configFile: path.join(root, 'vite.config.mjs') });
  const server = await preview({ root, configFile: path.join(root, 'vite.config.mjs'), preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
  const work = mkdtempSync(path.join(tmpdir(), 'editor-memory-'));
  const profile = path.join(work, 'profile');
  const context = await chromium.launchPersistentContext(profile, { acceptDownloads: true, viewport: { width: 1440, height: 900 } });
  const page = context.pages()[0] ?? await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('crash', () => problems.push('page crashed'));
  const results = { browser: `chromium ${context.browser()?.version() ?? ''}`.trim(), files: [...RAWS, ...JPEGS].map((file) => path.basename(file)), steps: [] };

  const names = (files) => files.map((file) => path.basename(file));
  const photoButton = (name) => page.locator(`.pe-photo--list button.pe-photo__select[aria-label^="${name},"]`);
  const readyCount = () => page.$$eval('.pe-photo--list', (items) => items.filter((li) => li.dataset.status === 'ready').length);
  const previewShown = () => poll(() => page.evaluate(() => !document.querySelector('.pe-stage-message') && !document.querySelector('.pe-canvas-host').hidden), Boolean, 'preview', 180_000);
  /** Settles, collects garbage and measures. */
  const measure = async (label, extra = {}) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 500));
    const { metrics } = await cdp.send('Performance.getMetrics');
    const heap = metrics.find(({ name }) => name === 'JSHeapUsedSize')?.value ?? 0;
    const entry = { label, workingSetMb: await workingSetMb(profile), pageHeapMb: Math.round(heap / 1048576), workers: page.workers().length, ...extra };
    results.steps.push(entry);
    console.log(JSON.stringify(entry));
    return entry;
  };
  const timed = async (label, fn) => {
    const stop = sampler(profile);
    const started = Date.now();
    await fn();
    const ms = Date.now() - started;
    return measure(label, { ms, peakMb: await stop() });
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

    for (let cycle = 1; cycle <= 2; cycle += 1) {
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
    const firstEmpty = results.steps.find(({ label }) => label === 'cycle 1: remove every photo');
    results.summary = {
      baselineMb: baseline.workingSetMb,
      afterCycle1Mb: firstEmpty.workingSetMb,
      afterCycle2Mb: end.workingSetMb,
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
