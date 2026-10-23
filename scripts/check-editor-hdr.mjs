// HDR check of /photography/editor on a production build in Chromium, Firefox and
// WebKit (Playwright builds; WebKit is not Safari on iOS), phone emulation and a forced
// CPU preview. Each run: GPU/CPU parity of the HDR shader path (dev server); Merge HDR
// with a same-exposure set (refused), a synthetic DNG bracket given out of order (roles
// from EXIF), merge, HDR tone controls, undo/redo, compare, PNG export against the Node
// reference (same LibRaw build), cancellation, exposure fusion of PNGs, saved edits.
// With HDR_FIXTURE_DIR (genuine A7 III _DSC9015–9017, a Sony DRO set) it also checks that
// set is refused, and times full-size (6024×4024) merges and exports on DNGs made from
// genuine sensor data with simulated exposure and motion, sampling browser memory
// (Windows). Usage: npm run check:editor:hdr
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { build, createServer, preview } from 'vite';
import factory from 'libraw-wasm/dist/libraw.js';
import { chromium, devices, firefox, webkit } from 'playwright';
import { createSyntheticDng } from '../src/editor/dev/dngFixture.mjs';
import { pixelRadiance, syntheticRasterFrame } from '../src/editor/dev/hdrFixtures.mjs';
import { decodeRaw, downsampleRaw } from '../src/editor/raw/rawDecoder.mjs';
import { analyzeBracket, createRadianceMerge } from '../src/editor/hdr/hdrMerge.mjs';
import { renderRawRgba8 } from '../src/editor/pipeline/cpuRenderer.mjs';
import { deriveParams } from '../src/editor/pipeline/spec.mjs';
import { normalizeAdjustments } from '../src/editor/model/adjustments.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'editor-hdr-'));
const fixtures = path.join(work, 'fixtures');
mkdirSync(fixtures, { recursive: true });
const PORT = 4184;
const DEV_PORT = 5184;
const URL_EDITOR = `http://localhost:${PORT}/photography/editor/`;
const GENUINE_DIR = process.env.HDR_FIXTURE_DIR ?? '';
const GENUINE_NAMES = ['_DSC9015.ARW', '_DSC9016.ARW', '_DSC9017.ARW'];
const GENUINE = GENUINE_DIR && GENUINE_NAMES.every((name) => existsSync(path.join(GENUINE_DIR, name)));
const ONLY = process.env.EDITOR_ENGINES?.split(',');
// A genuine three-exposure RAW bracket (any three .ARW/.DNG files in HDR_BRACKET_DIR, e.g.
// A7 III DSC09640–09642, 0.8/3.2/13 s): merged and exported at full size, timed.
const BRACKET_DIR = process.env.HDR_BRACKET_DIR ?? '';
const BRACKET_FILES = BRACKET_DIR && existsSync(BRACKET_DIR)
  ? readdirSync(BRACKET_DIR).filter((name) => /\.(arw|dng)$/i.test(name)).sort().map((name) => path.join(BRACKET_DIR, name))
  : [];

const RUNS = [
  { name: 'Chromium, desktop', type: chromium, genuine: true },
  { name: 'Firefox, desktop', type: firefox, genuine: true },
  // Playwright's Windows WebKit intermittently crashes the page when a fresh LibRaw
  // worker starts decoding after earlier RAW jobs (Interval 5); an HDR export runs nine
  // such jobs, so about half of the runs crash there (none in Chromium or Firefox).
  // HDR_WEBKIT_EXPORT=1 runs the RAW exports anyway; the fusion export always runs.
  { name: 'WebKit, desktop', type: webkit, rawExport: process.env.HDR_WEBKIT_EXPORT === '1', genuine: process.env.HDR_WEBKIT_EXPORT === '1' },
  { name: 'WebKit, iPhone 13 emulation', type: webkit, device: 'iPhone 13', rawExport: process.env.HDR_WEBKIT_EXPORT === '1' },
  { name: 'Chromium, desktop, no WebGL2', type: chromium, init: 'noWebgl2', expectEngine: 'cpu' },
];
const INIT = {
  noWebgl2: () => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) { return type === 'webgl2' ? null : original.call(this, type, ...rest); };
  },
};

const W = 600;
const H = 400;
const SHUTTERS = { under: [1, 500], normal: [1, 125], over: [1, 30] };
const EXPOSURE = { under: 0.25, normal: 1, over: 4 };
const MOTION = { under: { tx: 2, ty: -1 }, normal: { tx: 0, ty: 0 }, over: { tx: -1, ty: 2 } };

function makeFixtures() {
  const files = {};
  // RAW bracket as DNGs: scene radiance × exposure, the "over" frame shifted.
  for (const role of ['under', 'normal', 'over']) {
    const { tx, ty } = MOTION[role];
    const scene = (x, y) => pixelRadiance(x - tx, y - ty, W, H).map((v) => v * EXPOSURE[role]);
    files[role] = path.join(fixtures, `bracket-${role === 'normal' ? 0 : role === 'under' ? 1 : 2}.dng`);
    writeFileSync(files[role], createSyntheticDng({ width: W, height: H, scene, exposureTime: SHUTTERS[role], fNumber: 8, iso: 100 }));
  }
  // Same exposure three times (like Sony DRO bracketing): refused by its metadata.
  files.same = [1, 2, 3].map((n) => {
    const file = path.join(fixtures, `same-${n}.dng`);
    writeFileSync(file, createSyntheticDng({ width: 64, height: 48, scene: (x, y) => pixelRadiance(x, y, 64, 48).map((v) => v * (1 + n * 0.002)), exposureTime: [1, 30] }));
    return file;
  });
  return files;
}

async function makeRasterFixtures() {
  return Promise.all(['under', 'normal', 'over'].map(async (role, index) => {
    const frame = syntheticRasterFrame(W, H, { exposure: EXPOSURE[role], seed: index + 1, transform: { ...MOTION[role], angle: 0 } });
    const file = path.join(fixtures, `fusion-${index}.png`);
    await sharp(Buffer.from(frame.data.buffer), { raw: { width: W, height: H, channels: 4 } }).png().toFile(file);
    return file;
  }));
}

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

function maxDifference(expected, actual) {
  let max = 0;
  for (let i = 0; i < expected.length; i += 1) max = Math.max(max, Math.abs(expected[i] - actual[i]));
  return max;
}

function memoryMb(profile) {
  if (process.platform !== 'win32') return null;
  try {
    const command = [
      '$all = Get-CimInstance Win32_Process',
      `$ids = @($all | Where-Object { $_.CommandLine -like '*${path.basename(profile)}*' } | ForEach-Object { $_.ProcessId })`,
      'do { $before = $ids.Count; $ids = @($ids + ($all | Where-Object { $ids -contains $_.ParentProcessId } | ForEach-Object { $_.ProcessId }) | Sort-Object -Unique) } while ($ids.Count -gt $before)',
      '($all | Where-Object { $ids -contains $_.ProcessId } | Measure-Object -Property WorkingSetSize -Sum).Sum',
    ].join('; ');
    return Math.round(Number(execFileSync('powershell', ['-NoProfile', '-Command', command]).toString().trim()) / 1048576) || null;
  } catch { return null; }
}

// Samples memory without blocking this script's event loop (PowerShell takes about a
// second), so page timings are not delayed by the measurement itself.
function sampler(profile) {
  const peaks = [];
  let running = true;
  const loop = (async () => {
    while (running) {
      const m = await memoryMbAsync(profile);
      if (m) peaks.push(m);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  })();
  return () => { running = false; loop.catch(() => {}); return peaks.length ? Math.max(...peaks) : null; };
}

async function memoryMbAsync(profile) {
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

/** The editor's merge, reproduced in Node: analysis on half-size decodes, export merge on full ones. */
function referenceExport(Module, files, adjustments) {
  const roles = ['under', 'normal', 'over'];
  const decode = (role, halfSize) => decodeRaw(Module, new Uint8Array(readFileSync(files[role])), { format: 'dng', halfSize });
  const half = roles.map((role) => decode(role, true));
  const stops = roles.map((role) => Math.log2(SHUTTERS[role][0] / SHUTTERS[role][1]));
  const analysis = analyzeBracket(half.map(({ image, info }, i) => ({ image, asShot: info.asShot, stops: stops[i], role: roles[i] })), { mode: 'radiance', reference: 1 });
  const full = roles.map((role) => decode(role, false));
  const run = createRadianceMerge(analysis, full.map(({ info }) => ({ asShot: info.asShot })), { width: W, height: H });
  full.forEach(({ image }, i) => run.add(i, downsampleRaw(image, W, H)));
  const merged = run.finish();
  const raw = { ...full[1].info, hdrWhite: analysis.white };
  return { analysis, width: merged.width, height: merged.height, data: renderRawRgba8(merged.data, deriveParams(normalizeAdjustments(adjustments), { raw })) };
}

async function openDialog(page, tab) {
  await tab(1);
  await page.click('.pe-library__actions button:has-text("Merge HDR")');
  await page.waitForSelector('.pe-dialog[role=dialog]');
}

async function closeDialog(page) {
  if (await page.locator('.pe-dialog').count()) await page.click('.pe-dialog__foot button:has-text("Close")');
}

const dialogInput = '.pe-dialog input[type=file][multiple]';
const readyRows = (page, count) => poll(() => page.$$eval('.pe-bracket__item', (items) => items.map((li) => li.dataset.status)), (s) => s.length === count && s.every((v) => v !== 'reading'), 'bracket inputs', 120_000);

async function runOne(run, files, reference, genuine) {
  const profile = mkdtempSync(path.join(work, 'profile-'));
  const context = await run.type.launchPersistentContext(profile, { ...(run.device ? devices[run.device] : {}), acceptDownloads: true });
  if (run.init) await context.addInitScript(INIT[run.init]);
  await context.addInitScript(() => { window.__csp = []; addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
  const page = context.pages()[0] ?? await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('crash', () => problems.push('page crashed'));
  page.on('console', (message) => message.type() === 'error' && !/\[photo editor\] (webgl2|image-worker)/.test(message.text()) && problems.push(`console: ${message.text()}`));
  const result = { environment: run.name, browser: `${run.type.name()} ${context.browser()?.version() ?? ''}`.trim() };
  const tab = async (index) => { if (run.device) await page.click(`.pe-tabs button:nth-child(${index})`); };
  const step = async (name, fn) => { result.step = name; return fn(); };
  try {
    await step('HDR GPU/CPU parity', async () => {
      await page.goto(`http://localhost:${DEV_PORT}/src/editor/dev/parity.html`);
      const parity = await page.waitForFunction(() => window.parityResult, null, { timeout: 60_000 }).then((h) => h.jsonValue());
      if (!parity.available) { result.parity = 'no WebGL2'; return; }
      const worst = (list) => Math.max(...list.map(({ max }) => max));
      result.parity = { hdrCases: parity.hdrResults.length, hdrWorstMax: worst(parity.hdrResults), hdrMeanMax: Math.max(...parity.hdrResults.map(({ mean }) => mean)).toFixed(3), hdrSplitMax: parity.hdrSplitMax, rawWorstMax: worst(parity.rawResults), rasterWorstMax: worst(parity.results) };
      assert.ok(result.parity.hdrWorstMax <= 1 && parity.hdrSplitMax <= 1 && result.parity.rawWorstMax <= 1 && result.parity.rasterWorstMax <= 1, JSON.stringify(result.parity));
    });
    await step('load', async () => {
      await page.goto(URL_EDITOR, { waitUntil: 'load' });
      await page.waitForSelector('.pe[data-engine]', { timeout: 15_000 });
      result.engine = await page.$eval('.pe', (e) => e.dataset.engine);
      if (run.expectEngine) assert.equal(result.engine, run.expectEngine);
    });
    await step('same-exposure set is refused with the reason', async () => {
      await openDialog(page, tab);
      await page.setInputFiles(dialogInput, files.same);
      await readyRows(page, 3);
      const alert = await poll(() => page.locator('.pe-dialog [role=alert]').allTextContents(), (texts) => texts.length > 0, 'refusal');
      assert.match(alert.join(' '), /same exposure \(1\/30 s, f\/5.6, ISO 200\).*not an exposure bracket/);
      assert.equal(await page.isDisabled('.pe-dialog__foot button:has-text("Merge")'), true);
      for (let i = 0; i < 3; i += 1) await page.click('.pe-bracket__item:first-child button:has-text("Remove")');
    });
    await step('RAW bracket out of order: roles from EXIF, merge', async () => {
      // Over, under, normal: the file order says nothing; the exposures decide.
      await page.setInputFiles(dialogInput, [files.over, files.under, files.normal]);
      await readyRows(page, 3);
      const roles = await poll(() => page.$$eval('.pe-bracket__item select', (s) => s.map((e) => e.value)), (r) => r.length === 3 && r.every(Boolean), 'roles');
      assert.deepEqual(roles, ['over', 'under', 'normal']);
      assert.match(await page.textContent('.pe-dialog'), /RAW HDR merge/);
      assert.match(await page.textContent('.pe-dialog'), /suggested from the recorded exposure/);
      const started = Date.now();
      await page.click('.pe-dialog__foot button:has-text("Merge")');
      await page.waitForSelector('.pe-dialog', { state: 'detached', timeout: 120_000 });
      result.mergeMs = Date.now() - started;
      await tab(1);
      const row = await poll(() => page.$$eval('.pe-photo--list', (items) => items.map((li) => li.textContent)), (r) => r.some((t) => /bracket-0-HDR/.test(t)), 'merged photo');
      assert.match(row.find((t) => /bracket-0-HDR/.test(t)), new RegExp(`bracket-0-HDR${reference.width}×${reference.height} · HDR merge`));
      await poll(() => page.evaluate(() => !document.querySelector('.pe-stage-message') && !document.querySelector('.pe-canvas-host').hidden), Boolean, 'HDR preview', 60_000);
      await tab(2);
      const panel = await page.textContent('.pe-section[data-section-id=hdr]');
      assert.match(panel, /RAW HDR merge/);
      assert.match(panel, /Overexposed: aligned/);
      assert.match(panel, /−?[+-]?2\.00 EV/);
    });
    await step('tone controls, undo/redo, compare', async () => {
      const compression = page.locator('input[aria-label="Highlight compression value"]');
      await compression.fill('80');
      await compression.press('Enter');
      await poll(() => compression.inputValue(), (v) => v === '80', 'compression 80');
      await page.click('button[aria-label=Undo]');
      await poll(() => compression.inputValue(), (v) => v === '50', 'undo');
      await page.click('button[aria-label=Redo]');
      await poll(() => compression.inputValue(), (v) => v === '80', 'redo');
      await page.click('.pe-hdr__looks button:has-text("Natural")');
      await poll(() => compression.inputValue(), (v) => v === '50', 'Natural look');
      const exposure = page.locator('input[aria-label="Exposure value"]');
      await exposure.fill('0.5');
      await exposure.press('Enter');
      await poll(() => exposure.inputValue(), (v) => v === '+0.50 EV', 'exposure');
      await page.click('.pe-compare button:nth-child(3)');
      assert.equal(await page.locator('.pe-split__handle').count(), 1);
      await page.click('.pe-compare button:nth-child(1)');
    });
    await step('PNG export from the sources equals the Node reference, named -HDR-quangedit', async () => {
      await tab(3);
      if (run.rawExport === false) { result.rawExport = 'skipped (Windows WebKit LibRaw crash)'; return; }
      await page.check('input[name=pe-format][value=png]');
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.click('.pe-export-button')]);
      assert.equal(download.suggestedFilename(), 'bracket-0-HDR-quangedit.png');
      const pixels = await sharp(await download.path()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.deepEqual([pixels.info.width, pixels.info.height], [reference.width, reference.height]);
      result.pngMaxDifference = maxDifference(reference.data, pixels.data);
      assert.ok(result.pngMaxDifference <= 1, `PNG differs from the reference by ${result.pngMaxDifference}`);
      assert.match(await page.textContent('[data-section=export]'), /merged again from the three source files/);
    });
    await step('cancelling a merge commits nothing', async () => {
      const count = await page.locator('.pe-photo--list').count();
      await openDialog(page, tab);
      await page.setInputFiles(dialogInput, [files.under, files.normal, files.over]);
      await readyRows(page, 3);
      await page.click('.pe-dialog__foot button:has-text("Merge")');
      await page.click('.pe-dialog__foot button:has-text("Cancel")');
      await poll(() => page.textContent('.pe-dialog'), (t) => /Merge cancelled/.test(t), 'cancelled');
      await closeDialog(page);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      assert.equal(await page.locator('.pe-photo--list').count(), count);
    });
    await step('exposure fusion of PNGs, labelled as such', async () => {
      await openDialog(page, tab);
      await page.setInputFiles(dialogInput, files.raster);
      await readyRows(page, 3);
      const roles = await poll(() => page.$$eval('.pe-bracket__item select', (s) => s.map((e) => e.value)), (r) => r.length === 3 && r.every(Boolean), 'raster roles');
      assert.deepEqual(roles, ['under', 'normal', 'over']);
      assert.match(await page.textContent('.pe-dialog'), /Exposure fusion.*blends their best-exposed parts/);
      assert.match(await page.textContent('.pe-dialog'), /suggested from brightness/);
      await page.click('.pe-dialog__foot button:has-text("Merge")');
      await page.waitForSelector('.pe-dialog', { state: 'detached', timeout: 120_000 });
      await tab(2);
      assert.match(await page.textContent('.pe-section[data-section-id=hdr]'), /Exposure fusion of processed images/);
      await tab(3);
      if (await page.isEnabled('input[name=pe-format][value=jpeg]')) {
        await page.check('input[name=pe-format][value=jpeg]');
        const [jpeg] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.click('.pe-export-button')]);
        assert.equal(jpeg.suggestedFilename(), 'fusion-1-HDR-quangedit.jpg');
        const meta = await sharp(await jpeg.path()).metadata();
        assert.ok(meta.width > W * 0.95 && meta.width <= W);
      } else {
        result.jpeg = 'not supported by this browser (reported to the user)';
      }
    });
    await step('saved edits describe the HDR sources', async () => {
      const [download] = await Promise.all([page.waitForEvent('download'), page.locator('button:has-text("Save edits"):visible').first().click()]);
      const document = JSON.parse(readFileSync(await download.path(), 'utf8'));
      const hdr = document.photos.find(({ source }) => source.format === 'hdr' && source.hdr.mode === 'radiance');
      assert.equal(document.version, 4);
      assert.deepEqual(hdr.source.hdr.inputs.map(({ name, role }) => [name, role]), [['bracket-1.dng', 'under'], ['bracket-0.dng', 'normal'], ['bracket-2.dng', 'over']]);
      assert.equal(hdr.adjustments.exposure, 0.5);
    });
    if (run.genuine && genuine) {
      await step('genuine A7 III DRO set is refused', async () => {
        await openDialog(page, tab);
        await page.setInputFiles(dialogInput, GENUINE_NAMES.map((name) => path.join(GENUINE_DIR, name)));
        await readyRows(page, 3);
        const alert = await poll(() => page.locator('.pe-dialog [role=alert]').allTextContents(), (texts) => texts.length > 0, 'genuine refusal', 60_000);
        assert.match(alert.join(' '), /same exposure \(1\/30 s, f\/3.5, ISO 100\).*Sony DRO bracketing/);
        await closeDialog(page);
      });
      await step('full-size merge and export (genuine sensor data, simulated bracket)', async () => {
        const measures = { baselineMb: memoryMb(profile) };
        result.genuine = measures;
        const merges = [];
        for (let attempt = 0; attempt < 2; attempt += 1) {
          await openDialog(page, tab);
          await page.setInputFiles(dialogInput, genuine.files);
          await readyRows(page, 3);
          const stop = sampler(profile);
          const started = Date.now();
          await page.click('.pe-dialog__foot button:has-text("Merge")');
          await page.waitForSelector('.pe-dialog', { state: 'detached', timeout: 300_000 });
          const mergedMs = Date.now() - started;
          await poll(() => page.evaluate(() => !document.querySelector('.pe-stage-message')), Boolean, 'genuine preview', 120_000);
          const stages = await page.evaluate(() => Object.fromEntries(['decode', 'analyse', 'merge'].map((stage) => [stage, Math.round(performance.getEntriesByName(`pe-hdr-${stage}`).at(-1)?.duration ?? -1)])));
          merges.push({ ms: Date.now() - started, mergedMs, stages, peakMb: stop(), afterMb: memoryMb(profile) });
        }
        measures.previewMerges = merges;
        await tab(2);
        measures.panel = (await page.textContent('.pe-section[data-section-id=hdr] .pe-raw__meta')).replace(/\s+/g, ' ').slice(0, 300);
        await tab(3);
        const format = await page.isEnabled('input[name=pe-format][value=jpeg]') ? 'jpeg' : 'png';
        await page.check(`input[name=pe-format][value=${format}]`);
        // Cancel one full-size export part way, then run it to the end.
        await page.click('.pe-export-button');
        await poll(() => page.textContent('[data-section=export]'), (t) => /Merging|Decoding photo 2/.test(t), 'export running', 120_000);
        await page.click('.pe-export-progress button:has-text("Cancel")');
        await poll(() => page.textContent('[data-section=export]'), (t) => /Export cancelled/.test(t), 'export cancelled');
        const stop = sampler(profile);
        const started = Date.now();
        const [download] = await Promise.all([page.waitForEvent('download', { timeout: 600_000 }), page.click('.pe-export-button')]);
        measures.exportMs = Date.now() - started;
        measures.exportPeakMb = stop();
        measures.afterExportMb = memoryMb(profile);
        measures.fileName = download.suggestedFilename();
        // Merged twice from the same files, so the second photo is numbered.
        assert.equal(download.suggestedFilename(), `_DSC9016-sim-HDR-2-quangedit.${format === 'jpeg' ? 'jpg' : 'png'}`);
        const meta = await sharp(await download.path()).metadata();
        measures.exportSize = `${meta.width}×${meta.height}`;
        assert.ok(meta.width > 5900 && meta.height > 3900, measures.exportSize);
        measures.format = format;
        result.genuine = measures;
      });
    }
    if (run.genuine && BRACKET_FILES.length === 3) {
      await step('genuine exposure bracket: merge and full-size export', async () => {
        const measures = { baselineMb: memoryMb(profile) };
        result.bracket = measures;
        await openDialog(page, tab);
        await page.setInputFiles(dialogInput, BRACKET_FILES);
        await readyRows(page, 3);
        measures.dialog = (await page.textContent('.pe-dialog')).replace(/\s+/g, ' ').slice(0, 400);
        const stopMerge = sampler(profile);
        const started = Date.now();
        await page.click('.pe-dialog__foot button:has-text("Merge")');
        await page.waitForSelector('.pe-dialog', { state: 'detached', timeout: 300_000 });
        await poll(() => page.evaluate(() => !document.querySelector('.pe-stage-message')), Boolean, 'bracket preview', 120_000);
        measures.mergeMs = Date.now() - started;
        measures.stages = await page.evaluate(() => Object.fromEntries(['decode', 'analyse', 'merge'].map((stage) => [stage, Math.round(performance.getEntriesByName(`pe-hdr-${stage}`).at(-1)?.duration ?? -1)])));
        measures.mergePeakMb = stopMerge();
        await tab(2);
        measures.panel = (await page.textContent('.pe-section[data-section-id=hdr] .pe-raw__meta')).replace(/\s+/g, ' ').slice(0, 400);
        await tab(3);
        const format = await page.isEnabled('input[name=pe-format][value=jpeg]') ? 'jpeg' : 'png';
        await page.check(`input[name=pe-format][value=${format}]`);
        const stop = sampler(profile);
        const exportStarted = Date.now();
        const [download] = await Promise.all([page.waitForEvent('download', { timeout: 600_000 }), page.click('.pe-export-button')]);
        measures.exportMs = Date.now() - exportStarted;
        measures.exportPeakMb = stop();
        measures.afterExportMb = memoryMb(profile);
        measures.fileName = download.suggestedFilename();
        assert.match(measures.fileName, new RegExp(`-HDR-quangedit\.${format === 'jpeg' ? 'jpg' : 'png'}$`));
        const meta = await sharp(await download.path()).metadata();
        measures.exportSize = `${meta.width}×${meta.height}`;
        if (process.env.HDR_BRACKET_OUT) {
          mkdirSync(process.env.HDR_BRACKET_OUT, { recursive: true });
          await download.saveAs(path.join(process.env.HDR_BRACKET_OUT, `${run.name.replace(/\W+/g, '-')}-${measures.fileName}`));
        }
        assert.ok(meta.width > 5900 && meta.height > 3900, measures.exportSize);
      });
    }
    const csp = await page.evaluate(() => window.__csp);
    assert.deepEqual(csp, [], `CSP violations: ${csp.join(', ')}`);
    assert.deepEqual(problems, [], problems.join('\n'));
    result.ok = true;
    delete result.step;
  } catch (error) {
    result.ok = false;
    result.error = error.message.replace(/\s+/g, ' ').slice(0, 400);
    result.problems = problems.slice(0, 5);
    result.screen = await page.evaluate(() => [...document.querySelectorAll('[role=alert]')].map((node) => node.textContent).join(' | ') || null).catch(() => null);
    result.dialog = await page.evaluate(() => document.querySelector('.pe-dialog')?.textContent.slice(0, 600) ?? null).catch(() => null);
  } finally {
    await context.close();
  }
  return result;
}

/**
 * Full-size DNG bracket from a genuine A7 III frame: its decoded sensor data (as-shot
 * balance removed), scaled to -2/0/+2 EV with the brighter frame shifted by a few
 * pixels. Real texture and noise at real size; the exposures and motion are simulated.
 */
function genuineBracket(Module) {
  const { info, image } = decodeRaw(Module, new Uint8Array(readFileSync(path.join(GENUINE_DIR, '_DSC9016.ARW'))), { format: 'arw' });
  const aMax = Math.max(...info.asShot);
  // AsShotNeutral (green 1): the DNG writer multiplies white-balanced values by it.
  const neutral = info.asShot.map((a) => 1 / a);
  const files = ['under', 'normal', 'over'].map((role) => {
    const { tx, ty } = { under: { tx: 3, ty: -2 }, normal: { tx: 0, ty: 0 }, over: { tx: -4, ty: 3 } }[role];
    const scene = (x, y) => {
      const sx = Math.min(image.width - 1, Math.max(0, x - tx));
      const sy = Math.min(image.height - 1, Math.max(0, y - ty));
      const i = (sy * image.width + sx) * 3;
      // Decoded value / (a_c / a_max) = white-balanced scene value, times the exposure.
      return [0, 1, 2].map((c) => (image.data[i + c] / 65535) * (aMax / info.asShot[c]) * EXPOSURE[role]);
    };
    const file = path.join(fixtures, `_DSC9016-sim${role === 'normal' ? '' : `-${role}`}.dng`);
    writeFileSync(file, createSyntheticDng({ width: image.width, height: image.height, scene, neutral, exposureTime: SHUTTERS[role], fNumber: 3.5, iso: 100, make: 'Simulated', model: 'from ILCE-7M3 data' }));
    return file;
  });
  return { files };
}

async function main() {
  const files = makeFixtures();
  files.raster = await makeRasterFixtures();
  const Module = await factory({ wasmBinary: readFileSync(fileURLToPath(import.meta.resolve('libraw-wasm/dist/libraw.wasm'))) });
  const reference = referenceExport(Module, files, { exposure: 0.5, hdrHighlights: 50 });
  const genuine = GENUINE ? genuineBracket(Module) : null;
  await build({ root, logLevel: 'silent', configFile: path.join(root, 'vite.config.mjs') });
  const server = await preview({ root, configFile: path.join(root, 'vite.config.mjs'), preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
  const dev = await createServer({ root, configFile: path.join(root, 'vite.config.mjs'), server: { port: DEV_PORT, strictPort: true }, logLevel: 'silent' });
  await dev.listen();
  const results = [];
  try {
    for (const run of RUNS.filter(({ type }) => !ONLY || ONLY.includes(type.name()))) {
      const result = await runOne(run, files, reference, genuine);
      results.push(result);
      console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${result.environment} ${JSON.stringify({ ...result, environment: undefined, ok: undefined })}`);
    }
  } finally {
    await dev.close();
    server.httpServer.close();
    rmSync(work, { recursive: true, force: true });
  }
  if (!GENUINE) console.log('Genuine files not checked: set HDR_FIXTURE_DIR to a folder with _DSC9015–9017.ARW.');
  if (results.some(({ ok }) => !ok)) process.exitCode = 1;
}

await main();
