// Batch editing check of /photography/editor on a production build: multi-selection
// (click, Ctrl/Cmd, Shift, select all, touch selection mode), copy/paste edits and their
// batch undo/redo, Sync with chosen groups, a preset on the selection, Export selected
// as a ZIP (verified entry by entry: names, CRC, pixel size) and as separate files,
// cancel and retry, and repeated batches with memory sampled (Windows). Phones: the
// selection mode and the export dialog without sideways scrolling.
// With BATCH_FIXTURE_DIR (a folder with Sony .ARW files, read only) Chromium also runs the
// genuine flow: import three ARWs, edit one, paste to two, a preset, three full-size
// exports separately and as a ZIP, and, with three frames of a bracket, a merged HDR
// exported alongside them. BATCH_OUT keeps the results (JSON) and the downloads.
// Usage: npm run check:editor:batch
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { build, preview } from 'vite';
import { chromium, devices, firefox, webkit } from 'playwright';
import { readZip } from '../src/editor/dev/zipVerify.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'editor-batch-'));
const fixtures = path.join(work, 'fixtures');
mkdirSync(fixtures, { recursive: true });
const OUT = process.env.BATCH_OUT ?? '';
if (OUT) mkdirSync(OUT, { recursive: true });
const PORT = 4186;
const URL_EDITOR = `http://localhost:${PORT}/photography/editor/`;
const ONLY = process.env.EDITOR_ENGINES?.split(',');
const RAW_DIR = process.env.BATCH_FIXTURE_DIR ?? '';
const RAW_FILES = RAW_DIR && existsSync(RAW_DIR) ? readdirSync(RAW_DIR).filter((name) => /\.arw$/i.test(name)).sort().slice(0, 3).map((name) => path.join(RAW_DIR, name)) : [];
const REPEATS = Number(process.env.BATCH_REPEATS ?? 3);

const RUNS = [
  { name: 'Chromium, desktop', type: chromium, genuine: true, repeat: true },
  { name: 'Firefox, desktop', type: firefox },
  { name: 'WebKit, desktop', type: webkit },
  { name: 'WebKit, iPhone 13 emulation', type: webkit, device: 'iPhone 13' },
  { name: 'Chromium, Pixel 7 emulation', type: chromium, device: 'Pixel 7' },
];

/** Four photos, two of them with the same base name (DSC0001.jpg and DSC0001.png). */
async function makeFixtures() {
  const specs = [['beach.jpg', [200, 150, 90], 1200, 800], ['forest.jpg', [60, 120, 70], 900, 1200], ['DSC0001.jpg', [180, 80, 80], 1600, 1000], ['DSC0001.png', [90, 100, 140], 800, 800]];
  const files = [];
  for (const [name, colour, width, height] of specs) {
    const data = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 3;
        const v = Math.sin(x / 40) * 40 + Math.cos(y / 30) * 30;
        data[i] = colour[0] + v; data[i + 1] = colour[1] + v; data[i + 2] = colour[2] + v * (x / width);
      }
    }
    const file = path.join(fixtures, name);
    await sharp(data, { raw: { width, height, channels: 3 } }).toFile(file);
    files.push({ file, name, width, height });
  }
  return files;
}

async function poll(read, done, label, timeout = 30_000) {
  const end = Date.now() + timeout;
  let value;
  while (Date.now() < end) {
    value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label} (last value ${JSON.stringify(value)})`);
}

async function memoryMb(profile) {
  if (process.platform !== 'win32') return null;
  try {
    const command = [
      '$all = Get-CimInstance Win32_Process',
      `$ids = @($all | Where-Object { $_.CommandLine -like '*${path.basename(profile)}*' } | ForEach-Object { $_.ProcessId })`,
      'do { $before = $ids.Count; $ids = @($ids + ($all | Where-Object { $ids -contains $_.ParentProcessId } | ForEach-Object { $_.ProcessId }) | Sort-Object -Unique) } while ($ids.Count -gt $before)',
      '($all | Where-Object { $ids -contains $_.ProcessId } | Measure-Object -Property WorkingSetSize -Sum).Sum',
    ].join('; ');
    const { stdout } = await promisify(execFile)('powershell', ['-NoProfile', '-Command', command]);
    return Math.round(Number(stdout.trim()) / 1048576) || null;
  } catch { return null; }
}

function sampler(profile) {
  const peaks = [];
  let running = true;
  const loop = (async () => {
    while (running) {
      const m = await memoryMb(profile);
      if (m) peaks.push(m);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  })();
  return () => { running = false; loop.catch(() => {}); return peaks.length ? Math.max(...peaks) : null; };
}

async function runOne(run, files) {
  const profile = mkdtempSync(path.join(work, 'profile-'));
  const context = await run.type.launchPersistentContext(profile, { ...(run.device ? devices[run.device] : {}), acceptDownloads: true });
  const page = context.pages()[0] ?? await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('crash', () => problems.push('page crashed'));
  page.on('console', (message) => message.type() === 'error' && !/\[photo editor\] (webgl2|image-worker)/.test(message.text()) && problems.push(`console: ${message.text()}`));
  const result = { environment: run.name, browser: `${run.type.name()} ${context.browser()?.version() ?? ''}`.trim() };
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  const tab = async (index) => { if (run.device) await page.click(`.pe-tabs button:nth-child(${index})`); };
  const step = async (name, fn) => { result.step = name; return fn(); };
  const photoButton = (name) => page.locator(`.pe-photo--list button.pe-photo__select[aria-label^="${name},"]`);
  const selectedNames = () => page.$$eval('.pe-photo--list[data-selected] .pe-photo__name', (nodes) => nodes.map((node) => node.textContent));
  const count = () => page.textContent('.pe-batch__count');
  const value = (label) => page.getByRole('textbox', { name: `${label} value` }).inputValue();
  const setValue = async (label, next) => {
    await tab(2);
    if (['Texture', 'Clarity', 'Dehaze', 'Sharpening'].includes(label)) {
      const toggle = page.locator('.pe-section[data-section-id=detail] .pe-section__toggle');
      if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    }
    const field = page.getByRole('textbox', { name: `${label} value` });
    await field.click();
    await field.fill(String(next));
    await field.press('Enter');
  };
  const open = async (name) => {
    await tab(1);
    await photoButton(name).click();
    await poll(() => page.evaluate(() => !document.querySelector('.pe-stage-message') && !document.querySelector('.pe-canvas-host').hidden), Boolean, 'preview', 180_000);
  };
  const exposureOf = async (name) => { await open(name); await tab(2); return value('Exposure'); };
  const importFiles = async (paths, total) => {
    await tab(1);
    await page.setInputFiles('.pe-library input[type=file][multiple]', paths);
    await poll(() => page.$$eval('.pe-photo--list', (items) => items.filter((li) => li.dataset.status === 'ready').length), (n) => n >= total, 'imports', 300_000);
  };
  const saveDownload = async (download) => {
    const target = OUT ? path.join(OUT, `${run.name.replace(/\W+/g, '-')}-${download.suggestedFilename()}`) : await download.path();
    if (OUT) await download.saveAs(target);
    return target;
  };
  /** Starts Export selected and collects `expected` downloads. */
  const batchExport = async ({ mode, format, resize = 'original', longEdge, expected, cancelAfter = null, rename = null }) => {
    await tab(1);
    await page.click('.pe-batch__actions button:has-text("Export")');
    const dialog = page.locator('.pe-dialog[role=dialog]');
    await dialog.waitFor();
    await dialog.locator(`input[name=pe-batch-output][value=${mode}]`).check();
    await dialog.locator(`input[name=pe-batch-format][value=${format}]`).check();
    await dialog.locator('select').selectOption(resize);
    if (longEdge) await dialog.getByRole('spinbutton', { name: 'Long edge' }).fill(String(longEdge));
    if (rename) {
      await dialog.getByRole('button', { name: `Rename the export of ${rename.photo}` }).click();
      await dialog.getByRole('textbox', { name: `File name for ${rename.photo}` }).fill(rename.to);
      await dialog.getByRole('button', { name: 'Done' }).click();
    }
    const downloads = [];
    const listener = (download) => downloads.push(download);
    page.on('download', listener);
    // Cancel from inside the page as soon as enough photos are done, so a fast browser
    // cannot finish the batch between the check and the click.
    if (cancelAfter !== null) {
      await page.evaluate((after) => {
        const observer = new MutationObserver(() => {
          if (document.querySelectorAll('.pe-batch-plan__item[data-export=done]').length < after) return;
          const cancel = [...document.querySelectorAll('.pe-dialog__foot button')].find((button) => button.textContent === 'Cancel');
          if (cancel) { cancel.click(); observer.disconnect(); }
        });
        observer.observe(document.querySelector('.pe-dialog'), { subtree: true, attributes: true, attributeFilter: ['data-export'] });
      }, cancelAfter);
    }
    const started = Date.now();
    await dialog.locator('.pe-dialog__foot button.pe-button--primary').click();
    const outcome = await poll(() => dialog.locator('[data-batch-outcome]').textContent().catch(() => null), Boolean, 'batch outcome', 900_000);
    await poll(() => downloads.length, (n) => n >= expected, `${expected} downloads`, 60_000);
    page.off('download', listener);
    return { dialog, downloads, outcome, ms: Date.now() - started };
  };
  const closeDialog = async () => page.locator('.pe-dialog__foot button:has-text("Close")').click();

  try {
    await step('load and import', async () => {
      await page.goto(URL_EDITOR, { waitUntil: 'load' });
      await page.waitForSelector('.pe[data-engine]', { timeout: 15_000 });
      await importFiles(files.map(({ file }) => file), files.length);
    });

    if (run.device) {
      await step('phone: selection mode, export dialog, no sideways scrolling', async () => {
        await tab(1);
        await page.click('.pe-batch__mode');
        await photoButton('forest.jpg').tap();
        await photoButton('DSC0001.png').tap();
        assert.match(await count(), /3 photos/);
        assert.equal((await page.$$('.pe-filmstrip [data-selected]')).length, 3);
        await page.click('.pe-batch__actions button:has-text("Export")');
        const dialog = page.locator('.pe-dialog[role=dialog]');
        await dialog.waitFor();
        result.mobile = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          dialogOverflow: (() => { const body = document.querySelector('.pe-dialog__body'); return body.scrollWidth - body.clientWidth; })(),
          startVisible: (() => { const r = document.querySelector('.pe-dialog__foot .pe-button--primary').getBoundingClientRect(); return r.bottom <= window.innerHeight && r.right <= window.innerWidth; })(),
        }));
        assert.ok(result.mobile.overflow <= 0 && result.mobile.dialogOverflow <= 0, `sideways scrolling: ${JSON.stringify(result.mobile)}`);
        assert.ok(result.mobile.startVisible, 'Export button off screen');
        await closeDialog();
        const { downloads, outcome } = await batchExport({ mode: 'zip', format: 'jpeg', resize: 'long-edge', longEdge: 800, expected: 1 });
        const entries = readZip(readFileSync(await downloads[0].path()));
        assert.equal(entries.length, 3, outcome);
        result.zip = entries.map(({ name }) => name);
      });
    } else {
      await step('selection: click, Ctrl/Cmd, Shift, select all, clear', async () => {
        await open('beach.jpg');
        await photoButton('DSC0001.jpg').click({ modifiers: [mod] });
        assert.deepEqual(await selectedNames(), ['beach.jpg', 'DSC0001.jpg']);
        assert.equal(await page.getAttribute('.pe-photo--list[data-active] button.pe-photo__select', 'aria-label').then((label) => label.split(',')[0]), 'beach.jpg');
        // As in file managers, Ctrl/Cmd-click moves the range anchor; a plain click resets it.
        await photoButton('beach.jpg').click();
        await photoButton('DSC0001.png').click({ modifiers: ['Shift'] });
        assert.deepEqual(await selectedNames(), ['beach.jpg', 'forest.jpg', 'DSC0001.jpg', 'DSC0001.png']);
        await photoButton('forest.jpg').click({ modifiers: [mod] });
        assert.deepEqual(await selectedNames(), ['beach.jpg', 'DSC0001.jpg', 'DSC0001.png']);
        await page.keyboard.press('Escape');
        assert.match(await count(), /^1 photo/);
        await page.locator('.pe-photo--list .pe-photo__check').nth(1).check();
        assert.deepEqual(await selectedNames(), ['beach.jpg', 'forest.jpg']);
        await page.click('.pe-batch button:has-text("Select all")');
        assert.match(await count(), /4 photos/);
      });

      await step('copy, paste to selected, batch undo and redo', async () => {
        await open('beach.jpg');
        await setValue('Exposure', 0.8);
        await setValue('Contrast', 25);
        await page.click('.pe-batch button:has-text("Copy edits")');
        await page.keyboard.press(`${mod}+A`);
        await page.click('.pe-batch button:has-text("Paste to 4")');
        assert.match(await page.textContent('.pe-batch__history'), /Applied paste from beach\.jpg: 3 photos/);
        assert.equal(await exposureOf('DSC0001.png'), '+0.80 EV');
        assert.equal(await exposureOf('beach.jpg'), '+0.80 EV');
        await page.click('.pe-batch button:has-text("Undo paste")');
        assert.equal(await exposureOf('forest.jpg'), '0.00 EV');
        assert.equal(await exposureOf('beach.jpg'), '+0.80 EV');
        await page.click('.pe-batch button:has-text("Redo paste")');
        assert.equal(await exposureOf('forest.jpg'), '+0.80 EV');
        result.pending = await page.$$eval('.pe-photo--list[data-pending]', (items) => items.length);
        assert.equal(result.pending, 4);
      });

      await step('Sync with chosen groups, then a preset on the selection', async () => {
        await open('beach.jpg');
        await setValue('Saturation', -40);
        await setValue('Texture', 30);
        await page.keyboard.press(`${mod}+A`);
        await page.click('.pe-batch button:has-text("Sync")');
        const dialog = page.locator('.pe-dialog[role=dialog]');
        await dialog.getByRole('checkbox', { name: 'Light' }).uncheck();
        assert.match(await dialog.textContent(), /Changes 3 of 3/);
        assert.equal(await dialog.locator('.pe-batch-plan__thumbs canvas').count(), 6);
        await dialog.locator('.pe-dialog__foot button:has-text("Apply")').click();
        await open('forest.jpg');
        await tab(2);
        assert.equal(await value('Saturation'), '-40');
        assert.equal(await value('Exposure'), '+0.80 EV');
        await page.keyboard.press(`${mod}+A`);
        await page.click('.pe-batch button:has-text("Preset")');
        await dialog.locator('select').selectOption({ label: 'Black & White' });
        await dialog.locator('.pe-dialog__foot button:has-text("Apply")').click();
        await page.waitForSelector('.pe-dialog', { state: 'detached' });
        assert.equal(await value('Contrast'), '+15');
      });

      await step('Export selected as a ZIP: names, integrity and sizes', async () => {
        const { downloads, outcome, ms } = await batchExport({ mode: 'zip', format: 'jpeg', resize: 'long-edge', longEdge: 1000, expected: 1 });
        const zipPath = await saveDownload(downloads[0]);
        const entries = readZip(readFileSync(zipPath));
        result.zip = { name: downloads[0].suggestedFilename(), entries: entries.map(({ name }) => name), ms, outcome };
        assert.match(downloads[0].suggestedFilename(), /^photos-quangedit-\d{4}-\d\d-\d\d\.zip$/);
        assert.deepEqual(entries.map(({ name }) => name), ['beach-quangedit.jpg', 'forest-quangedit.jpg', 'DSC0001-quangedit.jpg', 'DSC0001-quangedit-2.jpg']);
        const sizes = await Promise.all(entries.map(async ({ data }) => { const meta = await sharp(data).metadata(); return `${meta.format} ${meta.width}×${meta.height}`; }));
        assert.deepEqual(sizes, ['jpeg 1000×667', 'jpeg 750×1000', 'jpeg 1000×625', 'jpeg 800×800']);
        assert.match(outcome, /Saved 4 of 4 in one ZIP/);
        await closeDialog();
      });

      await step('Export selected as separate files with a custom name', async () => {
        await tab(3);
        const format = await page.isDisabled('input[name=pe-format][value=webp]') ? 'png' : 'webp';
        const { downloads, outcome } = await batchExport({ mode: 'files', format, resize: 'long-edge', longEdge: 400, expected: 4, rename: { photo: 'forest.jpg', to: 'Forest final' } });
        result.files = downloads.map((download) => download.suggestedFilename()).sort();
        assert.deepEqual(result.files, ['DSC0001-quangedit-2', 'DSC0001-quangedit', 'beach-quangedit', 'Forest final'].map((stem) => `${stem}.${format}`).sort(), outcome);
        if (!run.device) await page.screenshot({ path: path.join(OUT || work, `${run.name.replace(/\W+/g, '-')}-export-dialog.png`) });
        await closeDialog();
      });

      await step('cancel a batch, then retry the cancelled photos', async () => {
        const { downloads, outcome, dialog } = await batchExport({ mode: 'zip', format: 'png', expected: 1, cancelAfter: 1 });
        result.cancel = { outcome };
        const entries = readZip(readFileSync(await downloads[0].path()));
        assert.ok(entries.length >= 1 && entries.length < 4, `ZIP after cancel holds ${entries.length}`);
        const retry = dialog.locator('.pe-dialog__foot button:has-text("Retry")');
        const missing = 4 - entries.length;
        const retried = [];
        const listener = (download) => retried.push(download.suggestedFilename());
        page.on('download', listener);
        await retry.click();
        await poll(() => retried.length, (n) => n >= missing, 'retried downloads', 300_000);
        page.off('download', listener);
        result.cancel.retried = retried;
        assert.ok(retried.every((name) => /-quangedit(-2)?\.png$/.test(name)));
        await closeDialog();
      });

      if (run.repeat) {
        await step(`repeated batches (${REPEATS}× full-size PNG ZIP): memory`, async () => {
          const samples = [];
          for (let i = 0; i < REPEATS; i += 1) {
            const before = await memoryMb(profile);
            const stop = sampler(profile);
            const { ms } = await batchExport({ mode: 'zip', format: 'png', expected: 1 });
            samples.push({ beforeMb: before, peakMb: stop(), ms });
            await closeDialog();
          }
          result.repeats = samples;
        });
      }

      if (run.genuine && RAW_FILES.length === 3) {
        await step('genuine Sony ARWs: edit, paste, preset, three exports separately and as a ZIP', async () => {
          const names = RAW_FILES.map((file) => path.basename(file));
          const measures = { files: names, baselineMb: await memoryMb(profile) };
          result.genuine = measures;
          let started = Date.now();
          await importFiles(RAW_FILES, files.length + 3);
          measures.importMs = Date.now() - started;
          await open(names[1]);
          await setValue('Exposure', 0.5);
          await setValue('Shadows', 30);
          await setValue('Texture', 20);
          await page.click('.pe-batch button:has-text("Copy edits")');
          await photoButton(names[0]).click({ modifiers: [mod] });
          await photoButton(names[2]).click({ modifiers: [mod] });
          await page.click('.pe-batch button:has-text("Paste to 3")');
          assert.equal(await exposureOf(names[0]), '+0.50 EV');
          await tab(2);
          assert.equal(await value('Texture'), '20');
          await photoButton(names[1]).click({ modifiers: [mod] });
          await photoButton(names[2]).click({ modifiers: [mod] });
          await page.click('.pe-batch button:has-text("Preset")');
          await page.locator('.pe-dialog select').selectOption({ label: 'Natural' });
          await page.locator('.pe-dialog__foot button:has-text("Apply")').click();
          const stop = sampler(profile);
          const separate = await batchExport({ mode: 'files', format: 'jpeg', expected: 3 });
          measures.separate = { ms: separate.ms, peakMb: stop(), outcome: separate.outcome };
          measures.separate.files = await Promise.all(separate.downloads.map(async (download) => {
            const meta = await sharp(await saveDownload(download)).metadata();
            return `${download.suggestedFilename()} ${meta.width}×${meta.height}`;
          }));
          names.forEach((name) => assert.ok(measures.separate.files.includes(`${name.replace(/\.arw$/i, '')}-quangedit.jpg 6024×4024`), JSON.stringify(measures.separate.files)));
          await closeDialog();
          const stopZip = sampler(profile);
          const zipped = await batchExport({ mode: 'zip', format: 'jpeg', expected: 1 });
          measures.zip = { ms: zipped.ms, peakMb: stopZip(), afterMb: await memoryMb(profile) };
          const entries = readZip(readFileSync(await saveDownload(zipped.downloads[0])));
          measures.zip.entries = await Promise.all(entries.map(async ({ name, data }) => { const meta = await sharp(data).metadata(); return `${name} ${meta.width}×${meta.height}`; }));
          assert.deepEqual(measures.zip.entries.sort(), measures.separate.files.sort());
          // Same encoder, same pixels: the ZIP holds exactly what the separate download held.
          if (OUT) {
            const same = entries.every(({ name, data }) => Buffer.compare(data, readFileSync(path.join(OUT, `${run.name.replace(/\W+/g, '-')}-${name}`))) === 0);
            measures.zip.identicalToSeparate = same;
          }
          await closeDialog();
        });
        await step('genuine bracket: merged HDR exported with the three RAWs', async () => {
          const names = RAW_FILES.map((file) => path.basename(file));
          await tab(1);
          await page.click('.pe-library__actions button:has-text("Merge HDR")');
          await page.setInputFiles('.pe-dialog input[type=file][multiple]', RAW_FILES);
          await poll(() => page.$$eval('.pe-bracket__item select', (s) => s.map((e) => e.value)), (r) => r.length === 3 && r.every(Boolean), 'roles', 180_000);
          const merge = page.locator('.pe-dialog__foot button:has-text("Merge")');
          if (await merge.isDisabled()) { result.hdr = { refused: await page.textContent('.pe-dialog [role=alert]').catch(() => 'disabled') }; await page.click('.pe-dialog__foot button:has-text("Close")'); return; }
          await merge.click();
          await page.waitForSelector('.pe-dialog', { state: 'detached', timeout: 300_000 });
          const hdrName = await page.textContent('.pe-photo--list[data-active] .pe-photo__name');
          await page.keyboard.press(`${mod}+A`);
          for (const name of files.map((f) => f.name)) await photoButton(name).click({ modifiers: [mod] });
          const stop = sampler(profile);
          const { downloads, ms, outcome } = await batchExport({ mode: 'zip', format: 'jpeg', expected: 1 });
          const entries = readZip(readFileSync(await saveDownload(downloads[0])));
          result.hdr = { name: hdrName, ms, peakMb: stop(), outcome, entries: await Promise.all(entries.map(async ({ name, data }) => { const meta = await sharp(data).metadata(); return `${name} ${meta.width}×${meta.height}`; })) };
          assert.ok(result.hdr.entries.some((entry) => entry.startsWith(`${hdrName}-quangedit.jpg`)), JSON.stringify(result.hdr.entries));
          assert.equal(entries.length, 4);
          void names;
          await closeDialog();
        });
      }
    }
    assert.deepEqual(problems, [], problems.join('\n'));
    result.ok = true;
    delete result.step;
  } catch (error) {
    result.ok = false;
    result.error = error.message.replace(/\s+/g, ' ').slice(0, 500);
    result.problems = problems.slice(0, 5);
    result.screen = await page.evaluate(() => [...document.querySelectorAll('[role=alert]')].map((node) => node.textContent).join(' | ') || null).catch(() => null);
    if (OUT) await page.screenshot({ path: path.join(OUT, `${run.name.replace(/\W+/g, '-')}-failure.png`) }).catch(() => {});
  } finally {
    await context.close();
  }
  return result;
}

async function main() {
  const files = await makeFixtures();
  await build({ root, logLevel: 'silent', configFile: path.join(root, 'vite.config.mjs') });
  const server = await preview({ root, configFile: path.join(root, 'vite.config.mjs'), preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
  const results = [];
  try {
    for (const run of RUNS.filter(({ type }) => !ONLY || ONLY.includes(type.name()))) {
      const result = await runOne(run, files);
      results.push(result);
      console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${result.environment} ${JSON.stringify({ ...result, environment: undefined, ok: undefined })}`);
    }
  } finally {
    server.httpServer.close();
    rmSync(work, { recursive: true, force: true });
    if (OUT) writeFileSync(path.join(OUT, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  }
  if (!RAW_FILES.length) console.log('Genuine RAW not checked: set BATCH_FIXTURE_DIR to a folder with three Sony .ARW files.');
  if (results.some(({ ok }) => !ok)) process.exitCode = 1;
}

await main();
