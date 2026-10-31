// RAW check of /photography/editor on a production build, in Chromium, Firefox and
// WebKit (Playwright builds; WebKit is not Safari on iOS) plus phone emulation and a
// forced CPU preview. Each run: GPU/CPU parity of the RAW shader (dev server), import of
// a synthetic DNG and unsupported or damaged RAW files, RAW panel and white balance,
// undo, comparison, and PNG/JPEG exports checked against the Node reference (same
// LibRaw build). With RAW_FIXTURE_DIR set (DSC09420.ARW, a genuine A7 III 14-bit file)
// it also imports that file and exports it at full resolution, with timings and,
// on Windows, browser memory. NEF_FIXTURE_DIR (a folder with _DSC0051.NEF, a genuine Nikon
// D3100 file) adds a NEF developed with exposure, a square crop and the watermark, exported
// at full resolution. Usage: npm run check:editor:raw
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { build, createServer, preview } from 'vite';
import factory from 'libraw-wasm/dist/libraw.js';
import { chromium, devices, firefox, webkit } from 'playwright';
import { createSyntheticDng } from '../src/editor/dev/dngFixture.mjs';
import { decodeRaw } from '../src/editor/raw/rawDecoder.mjs';
import { renderRawRgba8 } from '../src/editor/pipeline/cpuRenderer.mjs';
import { deriveParams } from '../src/editor/pipeline/spec.mjs';
import { normalizeAdjustments } from '../src/editor/model/adjustments.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'editor-raw-'));
const fixtures = path.join(work, 'fixtures');
mkdirSync(fixtures, { recursive: true });
const PORT = 4183;
const DEV_PORT = 5183;
const URL_EDITOR = `http://localhost:${PORT}/photography/editor/`;
const GENUINE = process.env.RAW_FIXTURE_DIR ? path.join(process.env.RAW_FIXTURE_DIR, 'DSC09420.ARW') : null;
const GENUINE_NEF = process.env.NEF_FIXTURE_DIR ? path.join(process.env.NEF_FIXTURE_DIR, '_DSC0051.NEF') : null;
const ONLY = process.env.EDITOR_ENGINES?.split(',');

const RUNS = [
  { name: 'Chromium, desktop', type: chromium, genuine: true },
  { name: 'Firefox, desktop', type: firefox, genuine: true },
  // Playwright's Windows WebKit intermittently crashes the page growing the decoder's
  // shared wasm heap for a 49 MB ARW ("mprotect failed: 487"), not seen in Chromium or
  // Firefox; RAW_WEBKIT_GENUINE=1 runs it anyway. Safari on macOS/iOS is unverified.
  { name: 'WebKit, desktop', type: webkit, genuine: process.env.RAW_WEBKIT_GENUINE === '1' },
  { name: 'WebKit, iPhone 13 emulation', type: webkit, device: 'iPhone 13' },
  { name: 'Chromium, desktop, no WebGL2', type: chromium, init: 'noWebgl2', expectEngine: 'cpu' },
];
const INIT = {
  noWebgl2: () => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) { return type === 'webgl2' ? null : original.call(this, type, ...rest); };
  },
};

// 600×400 sensor: a smooth colour field, a grey ramp and a clipped band; orientation 6.
const SCENE = (x, y) => (y < 20 ? [1.2, 1.2, 1.2] : y > 340 ? [x / 600, x / 600, x / 600] : [0.15 + 0.6 * (x / 600), 0.1 + 0.5 * (y / 400), 0.4 - 0.3 * (x / 600)]);

function makeFixtures() {
  const files = {
    dng: path.join(fixtures, 'synthetic.dng'),
    damaged: path.join(fixtures, 'damaged.dng'),
    samsung: path.join(fixtures, 'SAM_0001.SRW'),
    chart: path.join(fixtures, 'chart.png'),
  };
  const dng = createSyntheticDng({ width: 600, height: 400, orientation: 6, scene: SCENE });
  writeFileSync(files.dng, dng);
  writeFileSync(files.damaged, dng.slice(0, 2000));
  // TIFF-based, maker Samsung (no genuine file validated): identified and refused by content, whatever its name.
  const samsung = Buffer.from(createSyntheticDng({ width: 8, height: 8, make: 'SAMSUNG' }));
  // Remove the DNGVersion tag (0xC612) so only the maker identifies it.
  for (let i = 0; i + 1 < 600; i += 1) if (samsung[i] === 0x12 && samsung[i + 1] === 0xc6) { samsung[i] = 0x13; samsung[i + 1] = 0xc6; }
  writeFileSync(files.samsung, samsung);
  return files;
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

// Windows only: working set of the browser started with this profile and all its
// child processes (renderer, GPU, workers), in MB.
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

async function runOne(run, files, reference) {
  const profile = mkdtempSync(path.join(work, 'profile-'));
  const context = await run.type.launchPersistentContext(profile, { ...(run.device ? devices[run.device] : {}), acceptDownloads: true });
  if (run.init) await context.addInitScript(INIT[run.init]);
  await context.addInitScript(() => { window.__csp = []; addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
  const page = context.pages()[0] ?? await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('crash', () => problems.push('page crashed'));
  context.on('close', () => problems.push('context closed'));
  page.on('console', (message) => message.type() === 'error' && !/\[photo editor\] (webgl2|image-worker)/.test(message.text()) && problems.push(`console: ${message.text()}`));
  const result = { environment: run.name, browser: `${run.type.name()} ${context.browser()?.version() ?? ''}`.trim() };
  const tab = async (index) => { if (run.device) await page.click(`.pe-tabs button:nth-child(${index})`); };
  const step = async (name, fn) => { result.step = name; return fn(); };
  try {
    await step('RAW GPU/CPU parity', async () => {
      await page.goto(`http://localhost:${DEV_PORT}/src/editor/dev/parity.html`);
      const parity = await page.waitForFunction(() => window.parityResult, null, { timeout: 60_000 }).then((h) => h.jsonValue());
      if (!parity.available) { result.parity = 'no WebGL2'; return; }
      const worst = Math.max(...parity.rawResults.map(({ max }) => max));
      result.parity = { rawCases: parity.rawResults.length, rawWorstMax: worst, rawSplitMax: parity.rawSplitMax, rasterWorstMax: Math.max(...parity.results.map(({ max }) => max)) };
      assert.ok(worst <= 1 && parity.rawSplitMax <= 1, JSON.stringify(result.parity));
    });
    await step('load', async () => {
      await page.goto(URL_EDITOR, { waitUntil: 'load' });
      await page.waitForSelector('.pe[data-engine]', { timeout: 15_000 });
      result.engine = await page.$eval('.pe', (e) => e.dataset.engine);
      if (run.expectEngine) assert.equal(result.engine, run.expectEngine);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.editor), 'ready');
      assert.deepEqual(await page.evaluate(() => [document.documentElement, document.body].map((node) => getComputedStyle(node).overflowY)), ['visible', 'visible']);
    });
    await step('import RAW, unsupported and damaged files', async () => {
      const started = Date.now();
      await page.setInputFiles('input[type=file][multiple]', [files.dng, files.samsung, files.damaged]);
      const rows = await poll(() => page.$$eval('.pe-photo--list', (items) => items.map((li) => `${li.dataset.status}: ${li.querySelector('.pe-photo__detail').textContent}`)), (r) => r.length === 3 && !r.some((row) => row.startsWith('importing')), 'imports', 60_000);
      result.importMs = Date.now() - started;
      assert.match(rows[0], /^ready: 400×600 · DNG/);
      assert.match(rows[1], /^error: .*Samsung SRW files are not supported: no genuine/);
      assert.match(rows[2], /^error: .*(could not read|damaged)/i);
      await poll(() => page.evaluate(() => !document.querySelector('.pe-stage-message') && !document.querySelector('.pe-canvas-host').hidden), Boolean, 'RAW preview', 60_000);
    });
    await step('RAW panel, white balance and undo', async () => {
      await tab(2);
      const panel = page.locator('.pe-section[data-section-id=raw]');
      assert.match(await panel.textContent(), /Synthetic Test DNG.*1\/125 s · f\/5\.6/);
      // A new import starts with Camera Natural; switching re-renders the cached proxy (time to the next frames).
      const profile = panel.getByRole('combobox', { name: 'Profile' });
      assert.equal(await profile.inputValue(), 'camera-natural');
      const switchMs = [];
      for (const value of ['linear', 'camera-natural', 'linear', 'camera-natural']) {
        const started = Date.now();
        await profile.selectOption(value);
        await page.evaluate(() => new Promise((resolve) => { requestAnimationFrame(() => requestAnimationFrame(resolve)); }));
        switchMs.push(Date.now() - started);
      }
      result.profileSwitchMs = switchMs;
      await page.click('button[aria-label=Undo]');
      assert.equal(await profile.inputValue(), 'linear');
      await page.click('button[aria-label=Redo]');
      assert.equal(await profile.inputValue(), 'camera-natural');
      const select = panel.getByRole('combobox', { name: 'White balance' });
      assert.match(await select.locator('option[value=as-shot]').textContent(), /As shot \(\d+ K/);
      await select.selectOption('custom');
      const temperature = page.locator('input[aria-label="RAW temperature value"]');
      await temperature.fill('4000');
      await temperature.press('Enter');
      await poll(() => temperature.inputValue(), (value) => value === '4000 K', 'temperature 4000 K');
      await page.click('button[aria-label=Undo]');
      assert.notEqual(await temperature.inputValue(), '4000 K');
      await page.click('button[aria-label=Redo]');
      await poll(() => temperature.inputValue(), (value) => value === '4000 K', 'redo');
      const exposure = page.locator('input[aria-label="Exposure value"]');
      await exposure.fill('0.5');
      await exposure.press('Enter');
      await poll(() => exposure.inputValue(), (value) => value === '+0.50 EV', 'exposure');
      await page.click('.pe-compare button:nth-child(3)');
      assert.equal(await page.locator('.pe-split__handle').count(), 1);
      await page.click('.pe-compare button:nth-child(1)');
    });
    await step('RAW export equals the Node reference, named -quangedit', async () => {
      await tab(3);
      await page.check('input[name=pe-format][value=png]');
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.click('.pe-export-button')]);
      assert.equal(download.suggestedFilename(), 'synthetic-quangedit.png');
      const pixels = await sharp(await download.path()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.deepEqual([pixels.info.width, pixels.info.height], [400, 600]);
      const expected = renderRawRgba8(reference.image.data, deriveParams(normalizeAdjustments({ exposure: 0.5, raw: { whiteBalance: 'custom', profile: 'camera-natural', profileVersion: 2 }, rawTemperature: 4000, rawTint: reference.asShotTint }), { raw: reference.info }));
      result.pngMaxDifference = maxDifference(expected, pixels.data);
      assert.ok(result.pngMaxDifference <= 1, `PNG differs from the reference by ${result.pngMaxDifference}`);
      if (await page.isEnabled('input[name=pe-format][value=jpeg]')) {
        await page.check('input[name=pe-format][value=jpeg]');
        await page.selectOption('[data-section=export] select', 'long-edge');
        await page.fill('[data-section=export] input[type=number]', '300');
        const [jpeg] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.click('.pe-export-button')]);
        assert.equal(jpeg.suggestedFilename(), 'synthetic-quangedit.jpg');
        const meta = await sharp(await jpeg.path()).metadata();
        assert.deepEqual([meta.format, meta.width, meta.height], ['jpeg', 200, 300]);
        await page.selectOption('[data-section=export] select', 'original');
      } else {
        result.jpeg = 'not supported by this browser (reported to the user)';
      }
    });
    if (run.genuine && GENUINE && existsSync(GENUINE)) {
      await step('genuine A7 III ARW: import, preview, full-resolution export', async () => {
        const genuine = {};
        genuine.baselineMb = memoryMb(profile);
        await tab(1);
        let started = Date.now();
        await page.setInputFiles('input[type=file][multiple]', GENUINE);
        await poll(() => page.$$eval('.pe-photo--list', (items) => items.at(-1).dataset.status), (status) => status !== 'importing', 'ARW import', 120_000);
        genuine.importMs = Date.now() - started;
        const row = await page.$$eval('.pe-photo--list', (items) => items.at(-1).querySelector('.pe-photo__detail').textContent);
        assert.match(row, /^4024×6024 · Sony ARW/);
        started = Date.now();
        await page.click('.pe-photo--list:last-child button.pe-photo__select');
        // The preview is developed from half-size sensor data: 2012×3012 for this file.
        await poll(() => page.evaluate(() => [document.querySelector('.pe-canvas')?.width, document.querySelector('.pe-canvas')?.height, Boolean(document.querySelector('.pe-stage-message'))]), ([w, h, busy]) => w === 2012 && h === 3012 && !busy, 'ARW preview', 120_000);
        genuine.previewMs = Date.now() - started;
        genuine.afterPreviewMb = memoryMb(profile);
        await tab(3);
        const format = await page.isEnabled('input[name=pe-format][value=jpeg]') ? 'jpeg' : 'png';
        await page.check(`input[name=pe-format][value=${format}]`);
        const peaks = [];
        const sampler = setInterval(() => { const m = memoryMb(profile); if (m) peaks.push(m); }, 500);
        started = Date.now();
        const [download] = await Promise.all([page.waitForEvent('download', { timeout: 240_000 }), page.click('.pe-export-button')]);
        clearInterval(sampler);
        genuine.exportMs = Date.now() - started;
        assert.equal(download.suggestedFilename(), `DSC09420-quangedit.${format === 'jpeg' ? 'jpg' : 'png'}`);
        const meta = await sharp(await download.path()).metadata();
        assert.deepEqual([meta.width, meta.height], [4024, 6024]);
        genuine.peakDuringExportMb = peaks.length ? Math.max(...peaks) : null;
        genuine.format = format;
        result.genuine = genuine;
      });
    }
    if (run.genuine && GENUINE_NEF && existsSync(GENUINE_NEF)) {
      await step('genuine D3100 NEF: import, preview, exposure, square crop, watermark, full-resolution export', async () => {
        const nef = {};
        nef.baselineMb = memoryMb(profile);
        await tab(1);
        let started = Date.now();
        await page.setInputFiles('input[type=file][multiple]', GENUINE_NEF);
        await poll(() => page.$$eval('.pe-photo--list', (items) => items.at(-1).dataset.status), (status) => status !== 'importing', 'NEF import', 120_000);
        nef.importMs = Date.now() - started;
        const row = await page.$$eval('.pe-photo--list', (items) => items.at(-1).querySelector('.pe-photo__detail').textContent);
        assert.match(row, /^3084×4644 · Nikon NEF/);
        started = Date.now();
        await page.click('.pe-photo--list:last-child button.pe-photo__select');
        await poll(() => page.evaluate(() => [document.querySelector('.pe-canvas')?.width, document.querySelector('.pe-canvas')?.height, Boolean(document.querySelector('.pe-stage-message'))]), ([w, h, busy]) => w === 1542 && h === 2322 && !busy, 'NEF preview', 120_000);
        nef.previewMs = Date.now() - started;
        await tab(2);
        const exposure = page.getByRole('textbox', { name: 'Exposure value' });
        await exposure.scrollIntoViewIfNeeded();
        await exposure.fill('0.5');
        await exposure.press('Enter');
        await poll(() => exposure.inputValue(), (text) => text === '+0.50 EV', 'exposure applied');
        const section = async (id) => {
          const toggle = page.locator(`.pe-section[data-section-id=${id}] .pe-section__toggle`);
          await toggle.scrollIntoViewIfNeeded();
          if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
        };
        await section('geometry');
        await page.selectOption('.pe-geometry__ratio select', '1:1');
        await section('watermark');
        await page.getByRole('checkbox', { name: /Add the HUYNH Photography watermark/ }).check();
        await tab(3);
        const format = await page.isEnabled('input[name=pe-format][value=jpeg]') ? 'jpeg' : 'png';
        await page.check(`input[name=pe-format][value=${format}]`);
        const peaks = [];
        const sampler = setInterval(() => { const m = memoryMb(profile); if (m) peaks.push(m); }, 500);
        started = Date.now();
        const [download] = await Promise.all([page.waitForEvent('download', { timeout: 240_000 }), page.click('.pe-export-button')]);
        clearInterval(sampler);
        nef.exportMs = Date.now() - started;
        assert.equal(download.suggestedFilename(), `_DSC0051-quangedit.${format === 'jpeg' ? 'jpg' : 'png'}`);
        const { data, info } = await sharp(await download.path()).raw().toBuffer({ resolveWithObject: true });
        assert.deepEqual([info.width, info.height], [3084, 3084]);
        // The mark (bottom right, 65% white with a charcoal outline over saturated grass) leaves light, near-neutral pixels there.
        let bright = 0;
        for (let y = Math.round(info.height * 0.85); y < info.height; y += 2) for (let x = Math.round(info.width * 0.75); x < info.width; x += 2) {
          const i = (y * info.width + x) * info.channels;
          if (Math.min(data[i], data[i + 1], data[i + 2]) > 150 && Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) < 30) bright += 1;
        }
        assert.ok(bright > 200, `watermark not found in the NEF export (${bright} light neutral pixels)`);
        nef.markPixels = bright;
        nef.peakDuringExportMb = peaks.length ? Math.max(...peaks) : null;
        nef.format = format;
        result.nef = nef;
      });
    }
    const csp = await page.evaluate(() => window.__csp);
    assert.deepEqual(csp, [], `CSP violations: ${csp.join(', ')}`);
    assert.deepEqual(problems, [], problems.join('\n'));
    result.ok = true;
    delete result.step;
  } catch (error) {
    result.ok = false;
    result.error = error.message.split('\n').slice(0, 3).join(' ');
    result.problems = problems.slice(0, 5);
    result.screen = await page.evaluate(() => [...document.querySelectorAll('[role=alert]')].map((node) => node.textContent).join(' | ') || null).catch(() => null);
  } finally {
    await context.close();
  }
  return result;
}

async function main() {
  const files = makeFixtures();
  const Module = await factory({ wasmBinary: readFileSync(fileURLToPath(import.meta.resolve('libraw-wasm/dist/libraw.wasm'))) });
  const decoded = decodeRaw(Module, new Uint8Array(readFileSync(files.dng)), { format: 'dng' });
  const { multipliersToKelvinTint } = await import('../src/editor/raw/rawColor.mjs');
  const reference = { ...decoded, asShotTint: multipliersToKelvinTint(decoded.info.asShot, decoded.info.camXyz).tint };
  await build({ root, logLevel: 'silent', configFile: path.join(root, 'vite.config.mjs') });
  const server = await preview({ root, configFile: path.join(root, 'vite.config.mjs'), preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
  const dev = await createServer({ root, configFile: path.join(root, 'vite.config.mjs'), server: { port: DEV_PORT, strictPort: true }, logLevel: 'silent' });
  await dev.listen();
  const results = [];
  try {
    for (const run of RUNS.filter(({ type }) => !ONLY || ONLY.includes(type.name()))) {
      const result = await runOne(run, files, reference);
      results.push(result);
      console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${result.environment} ${JSON.stringify({ ...result, environment: undefined, ok: undefined })}`);
    }
  } finally {
    await dev.close();
    server.httpServer.close();
    rmSync(work, { recursive: true, force: true });
  }
  if (!GENUINE) console.log('Genuine ARW not checked: set RAW_FIXTURE_DIR to a folder with DSC09420.ARW.');
  if (!GENUINE_NEF) console.log('Genuine NEF not checked: set NEF_FIXTURE_DIR to a folder with _DSC0051.NEF.');
  if (results.some(({ ok }) => !ok)) process.exitCode = 1;
}

await main();
