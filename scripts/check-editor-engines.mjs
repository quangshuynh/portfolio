// Cross-engine check of /photography/editor on a production build: WebKit (iPhone
// emulation and desktop), mobile Chromium and Firefox through Playwright, plus forced
// fallbacks (no WebGL2, no module workers). Each run loads the page directly, imports,
// adjusts, compares and exports, and fails on page errors or CSP violations.
// WebKit here is Playwright's build, not Safari on iOS: passing it is evidence, not proof.
// Usage: npm run check:editor:engines  (first: npx playwright install webkit firefox chromium)
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { build, preview } from 'vite';
import { renderRgba8 } from '../src/editor/pipeline/cpuRenderer.mjs';
import { deriveParams } from '../src/editor/pipeline/spec.mjs';

// EDITOR_PLAYWRIGHT points at another Playwright build (e.g. an older WebKit) to test it too.
const { chromium, devices, firefox, webkit } = await import(process.env.EDITOR_PLAYWRIGHT || 'playwright');
const ONLY = process.env.EDITOR_ENGINES?.split(',');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'editor-engines-'));
const fixtures = path.join(work, 'fixtures');
mkdirSync(fixtures, { recursive: true });
const PORT = 4181;
const URL_EDITOR = `http://localhost:${PORT}/photography/editor`;

const RUNS = [
  { name: 'WebKit, iPhone 13 emulation', type: webkit, device: 'iPhone 13' },
  { name: 'WebKit, desktop', type: webkit },
  { name: 'Chromium, Pixel 7 emulation', type: chromium, device: 'Pixel 7' },
  { name: 'Firefox, desktop', type: firefox },
  { name: 'WebKit, iPhone 13, no WebGL2', type: webkit, device: 'iPhone 13', init: 'noWebgl2', expectEngine: 'cpu' },
  { name: 'Chromium, Pixel 7, no module workers', type: chromium, device: 'Pixel 7', init: 'noWorker', expectMainThread: true },
];

// Page scripts that remove an API before the app starts, as an unsupported browser would.
const INIT = {
  noWebgl2: () => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) { return type === 'webgl2' ? null : original.call(this, type, ...rest); };
  },
  noWorker: () => { window.Worker = function Worker() { throw new TypeError('Module workers are disabled for this test.'); }; },
};

async function makeFixtures() {
  const write = async (name, pipeline) => { const file = path.join(fixtures, name); await pipeline.toFile(file); return file; };
  const width = 4000;
  const height = 3000;
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) data.set([(x / width) * 255, (y / height) * 255, 128 + 100 * Math.sin((x + y) / 300)], (y * width + x) * 3);
  const chart = Buffer.alloc(64 * 64 * 4);
  let i = 0;
  for (let r = 0; r < 16; r += 1) for (let g = 0; g < 16; g += 1) for (let b = 0; b < 16; b += 1) { chart.set([r * 17, g * 17, b * 17, 255], i); i += 4; }
  return {
    large: await write('photo-12mp.jpg', sharp(data, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 })),
    chart: await write('chart.png', sharp(chart, { raw: { width: 64, height: 64, channels: 4 } }).png()),
  };
}

async function poll(read, done, label, timeout = 10_000) {
  const end = Date.now() + timeout;
  let value;
  while (Date.now() < end) {
    value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label} (last value ${JSON.stringify(value)})`);
}

/** Encodes RGBA pixels as PNG in the page (64×64) and decodes the result in Node. */
async function encodeInPage(page, rgba) {
  const base64 = await page.evaluate(async (pixels) => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 64, height: 64 });
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels), 64, 64), 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let text = '';
    bytes.forEach((byte) => { text += String.fromCharCode(byte); });
    return btoa(text);
  }, Array.from(rgba));
  return sharp(Buffer.from(base64, 'base64')).ensureAlpha().raw().toBuffer();
}

async function exportRgba(page) {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.click('.pe-export-button')]);
  return sharp(await download.path()).ensureAlpha().raw().toBuffer();
}

function maxDifference(expected, actual) {
  let max = 0;
  const worst = [];
  for (let i = 0; i < expected.length; i += 1) {
    const diff = Math.abs(expected[i] - actual[i]);
    if (diff && worst.length < 4) worst.push({ pixel: i >> 2, channel: i % 4, expected: expected[i], actual: actual[i] });
    max = Math.max(max, diff);
  }
  return { max, worst };
}

async function runOne(run, files) {
  const browser = await run.type.launch();
  const context = await browser.newContext({ ...(run.device ? devices[run.device] : {}), acceptDownloads: true });
  if (run.init) await context.addInitScript(INIT[run.init]);
  await context.addInitScript(() => { window.__csp = []; addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => message.type() === 'error' && !/\[photo editor\] (webgl2|image-worker)/.test(message.text()) && problems.push(`console: ${message.text()}`));
  page.on('requestfailed', (request) => problems.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`));
  const result = { environment: run.name, browser: `${run.type.name()} ${browser.version()}` };
  const step = async (name, fn) => { result.step = name; return fn(); };
  try {
    await step('load', async () => {
      await page.goto(URL_EDITOR, { waitUntil: 'load' });
      await page.waitForSelector('.pe[data-engine]', { timeout: 15_000 });
      result.engine = await page.$eval('.pe', (e) => e.dataset.engine);
      if (run.expectEngine) assert.equal(result.engine, run.expectEngine);
    });
    await step('import', async () => {
      await page.setInputFiles('input[type=file][multiple]', [files.large, files.chart]);
      await poll(() => page.$$eval('.pe-photo--list', (items) => items.map((li) => li.dataset.status)), (statuses) => !statuses.includes('importing'), 'imports', 90_000);
      const rows = await page.$$eval('.pe-photo--list', (items) => items.map((li) => `${li.dataset.status}: ${li.querySelector('.pe-photo__detail').textContent}`));
      assert.deepEqual(rows.map((row) => row.split(':')[0]), ['ready', 'ready'], rows.join(' | '));
      await poll(() => page.evaluate(() => !document.querySelector('.pe-stage-message') && !document.querySelector('.pe-canvas-host').hidden), Boolean, 'preview', 90_000);
      // The thumbnail is the whole photo scaled down (red rises left to right), not a crop.
      const thumb = await page.evaluate(() => { const c = document.querySelector('.pe-photo--list canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const at = (x) => d[((c.height >> 1) * c.width + x) * 4]; return { size: [c.width, c.height], left: at(2), right: at(c.width - 3) }; });
      assert.deepEqual(thumb.size, [320, 240]);
      assert.ok(thumb.left < 10 && thumb.right > 240, JSON.stringify(thumb));
    });
    await step('adjust', async () => {
      if (run.device) await page.click('.pe-tabs button:nth-child(2)');
      const field = page.locator('input[aria-label="Exposure value"]');
      await field.fill('0.5');
      await field.press('Enter');
      await poll(() => field.inputValue(), (value) => value === '+0.50 EV', 'exposure shows +0.50 EV');
    });
    await step('compare', async () => {
      await page.click('.pe-compare button:nth-child(3)');
      assert.equal(await page.locator('.pe-split__handle').count(), 1);
      await page.click('.pe-compare button:nth-child(1)');
    });
    await step('export at full resolution', async () => {
      if (run.device) await page.click('.pe-tabs button:nth-child(3)');
      // Some engine builds cannot encode JPEG (Playwright's older Windows WebKit): the
      // editor must say so and disable it; the full-size export is then tested as PNG.
      const format = await page.isEnabled('input[name=pe-format][value=jpeg]') ? 'jpeg' : 'png';
      if (format === 'png') {
        assert.match(await page.locator('[data-section=export] .pe-note').first().textContent(), /cannot encode JPEG/);
        result.jpeg = 'not supported by this browser (reported to the user)';
      }
      await page.check(`input[name=pe-format][value=${format}]`);
      const started = Date.now();
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 180_000 }), page.click('.pe-export-button')]);
      const meta = await sharp(await download.path()).metadata();
      assert.deepEqual([meta.format, meta.width, meta.height], [format, 4000, 3000]);
      result.export12mp = `${format} ${Date.now() - started} ms`;
    });
    await step('export PNG equals the CPU reference', async () => {
      // Pixels must equal the CPU reference up to this browser's own PNG encoder error,
      // measured on an unedited canvas (0 in Chromium and Firefox; Playwright's WebKit
      // on Windows changes some values by 1 when encoding).
      const source = await sharp(files.chart).ensureAlpha().raw().toBuffer();
      result.pngEncoderMaxDifference = maxDifference(source, await encodeInPage(page, source)).max;
      if (run.device) await page.click('.pe-tabs button:nth-child(1)');
      await page.click('.pe-photo--list button.pe-photo__select[aria-label^="chart.png"]');
      await poll(() => page.locator('.pe-stage-message').count(), (count) => count === 0, 'chart preview');
      if (run.device) await page.click('.pe-tabs button:nth-child(2)');
      const field = page.locator('input[aria-label="Saturation value"]');
      await field.fill('30');
      await field.press('Enter');
      await poll(() => field.inputValue(), (value) => value === '+30', 'saturation shows +30');
      if (run.device) await page.click('.pe-tabs button:nth-child(3)');
      await page.check('input[name=pe-format][value=png]');
      const { max, worst } = maxDifference(renderRgba8(new Uint8ClampedArray(source), deriveParams({ saturation: 30 })), await exportRgba(page));
      result.pngMaxDifference = max;
      assert.ok(max <= result.pngEncoderMaxDifference, `max difference ${max}, encoder alone ${result.pngEncoderMaxDifference} ${JSON.stringify(worst)}`);
    });
    result.imageTasks = await page.evaluate(() => JSON.parse(window.__photoEditorDiagnostics).events.some((e) => e.area === 'image-worker') ? 'main thread' : 'worker');
    if (run.expectMainThread) assert.equal(result.imageTasks, 'main thread');
    const csp = await page.evaluate(() => window.__csp);
    assert.deepEqual(csp, [], `CSP violations: ${csp.join(', ')}`);
    assert.deepEqual(problems, [], problems.join('\n'));
    result.ok = true;
    delete result.step;
  } catch (error) {
    result.ok = false;
    result.error = error.message.split('\n').slice(0, 3).join(' ');
    result.problems = problems.slice(0, 5);
    result.screen = await page.evaluate(() => document.querySelector('[role=alert]')?.textContent ?? null).catch(() => null);
  } finally {
    await browser.close();
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
      let result;
      try {
        result = await runOne(run, files);
      } catch (error) {
        // Browser not installed: report it rather than pretend the engine was tested.
        result = { environment: run.name, ok: null, skipped: error.message.split('\n')[0] };
      }
      results.push(result);
      console.log(`${result.ok === true ? 'ok  ' : result.ok === null ? 'skip' : 'FAIL'} ${run.name}${result.browser ? ` (${result.browser})` : ''} ${JSON.stringify(result.ok ? { engine: result.engine, imageTasks: result.imageTasks, export12mp: result.export12mp, jpeg: result.jpeg, pngMaxDifference: result.pngMaxDifference, pngEncoderMaxDifference: result.pngEncoderMaxDifference } : result.skipped ?? { step: result.step, error: result.error, screen: result.screen, problems: result.problems })}`);
    }
  } finally {
    await server.close();
    writeFileSync(path.join(work, 'report.json'), JSON.stringify(results, null, 2));
    rmSync(fixtures, { recursive: true, force: true });
  }
  console.log(`report: ${path.join(work, 'report.json')}`);
  if (results.some((result) => result.ok === false)) process.exitCode = 1;
}

await main();
