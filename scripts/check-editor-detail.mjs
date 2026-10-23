// Detail check of /photography/editor on a production build in Chromium, Firefox and
// WebKit (Playwright builds; WebKit is not Safari on iOS), iPhone emulation and a forced
// CPU preview. Each run: Detail controls through their value fields, the Detail preview
// (draft and final labels), compare and photo switching with Detail on, reset, a PNG
// export compared with the Node reference (same renderer), a full-size 24 MP JPEG export
// with Detail (timed, browser memory sampled on Windows), and on phones that the Detail
// section is reachable and the page does not scroll sideways.
// 1:1 Detail inspection is compared pixel by pixel with the Node reference of the same region.
// With DETAIL_FIXTURE_DIR (a folder with one .ARW) it also times a genuine RAW: Detail
// preview, 1:1 inspection and full-size export. Usage: npm run check:editor:detail
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { build, preview } from 'vite';
import { chromium, devices, firefox, webkit } from 'playwright';
import { renderDetailImage } from '../src/editor/pipeline/detailRenderer.mjs';
import { deriveParams } from '../src/editor/pipeline/spec.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'editor-detail-'));
const fixtures = path.join(work, 'fixtures');
mkdirSync(fixtures, { recursive: true });
const PORT = 4185;
const URL_EDITOR = `http://localhost:${PORT}/photography/editor/`;
const ONLY = process.env.EDITOR_ENGINES?.split(',');
const RAW_DIR = process.env.DETAIL_FIXTURE_DIR ?? '';
const RAW_FILE = RAW_DIR && existsSync(RAW_DIR) ? readdirSync(RAW_DIR).filter((name) => /\.arw$/i.test(name)).map((name) => path.join(RAW_DIR, name))[0] : null;

const RUNS = [
  { name: 'Chromium, desktop', type: chromium, large: true, raw: true },
  { name: 'Firefox, desktop', type: firefox, large: true, raw: true },
  { name: 'WebKit, desktop', type: webkit, large: true },
  { name: 'WebKit, iPhone 13 emulation', type: webkit, device: 'iPhone 13' },
  { name: 'Chromium, desktop, no WebGL2', type: chromium, init: 'noWebgl2', expectEngine: 'cpu' },
];
const INIT = {
  noWebgl2: () => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) { return type === 'webgl2' ? null : original.call(this, type, ...rest); };
  },
};

const SETTINGS = { texture: 60, clarity: 40, dehaze: 25, sharpening: 70, luminanceNoise: 35, colorNoise: 50 };
const LABELS = { texture: 'Texture', clarity: 'Clarity', dehaze: 'Dehaze', sharpening: 'Sharpening', luminanceNoise: 'Luminance noise reduction', colorNoise: 'Color noise reduction' };

/** A deterministic textured RGBA image with noise, edges and a transparent corner. */
function pattern(width, height, { alpha = false } = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const v = 90 + 60 * Math.sin(x / 7) * Math.cos(y / 11) + (x > width / 2 ? 50 : 0) + (rand() - 0.5) * 30;
      data[i] = v + 20; data[i + 1] = v; data[i + 2] = v - 20 + (rand() - 0.5) * 30;
      data[i + 3] = 255;
      // Fully transparent only: canvases store premultiplied colour, so partial alpha is lossy.
      if (alpha && x < width / 5 && y < height / 4) { data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 0; }
    }
  }
  return { width, height, data };
}

async function makeFixtures() {
  const small = pattern(600, 400, { alpha: true });
  const smallFile = path.join(fixtures, 'detail-small.png');
  await sharp(Buffer.from(small.data.buffer), { raw: { width: 600, height: 400, channels: 4 } }).png().toFile(smallFile);
  const large = pattern(6000, 4000);
  const largeFile = path.join(fixtures, 'detail-24mp.jpg');
  await sharp(Buffer.from(large.data.buffer), { raw: { width: 6000, height: 4000, channels: 4 } }).jpeg({ quality: 90 }).toFile(largeFile);
  return { small, smallFile, largeFile };
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
  if (run.init) await context.addInitScript(INIT[run.init]);
  const page = context.pages()[0] ?? await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('crash', () => problems.push('page crashed'));
  page.on('console', (message) => message.type() === 'error' && !/\[photo editor\] (webgl2|image-worker)/.test(message.text()) && problems.push(`console: ${message.text()}`));
  const result = { environment: run.name, browser: `${run.type.name()} ${context.browser()?.version() ?? ''}`.trim() };
  const tab = async (index) => { if (run.device) await page.click(`.pe-tabs button:nth-child(${index})`); };
  const step = async (name, fn) => { result.step = name; return fn(); };
  const detailState = () => page.evaluate(() => document.querySelector('[data-detail-preview]')?.dataset.detailPreview ?? null);
  const setValue = async (label, value) => {
    const field = page.getByRole('textbox', { name: `${label} value` });
    await field.click();
    await field.fill(String(value));
    await field.press('Enter');
  };
  const importFiles = async (paths, count) => {
    await page.setInputFiles('input[type=file][multiple]', paths);
    await poll(() => page.$$eval('.pe-photo--list', (items) => items.filter((li) => li.dataset.status === 'ready').length), (n) => n >= count, 'imports', 180_000);
  };
  const select = async (name) => {
    await tab(1);
    await page.click(`.pe-photo--list button.pe-photo__select[aria-label^="${name}"]`);
    await poll(() => page.evaluate(() => !document.querySelector('.pe-stage-message') && !document.querySelector('.pe-canvas-host').hidden), Boolean, 'preview', 120_000);
  };
  const openDetail = async () => {
    await tab(2);
    const toggle = page.locator('.pe-section[data-section-id=detail] .pe-section__toggle');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  };
  // Time until the Detail preview paints a draft or final frame after `change` (marks set by the Viewer).
  const timeFrames = async (change, timeout = 120_000) => {
    const since = await page.evaluate(() => performance.now());
    await change();
    const marks = () => page.evaluate((t) => Object.fromEntries(['draft', 'final'].map((q) => [q, performance.getEntriesByName(`pe-detail-${q}`).find((m) => m.startTime > t)?.startTime ?? null])), since);
    const found = await poll(marks, (m) => m.final !== null, 'final Detail frame', timeout);
    return { draftMs: found.draft === null ? null : Math.round(found.draft - since), finalMs: Math.round(found.final - since) };
  };
  // Opens 1:1 Detail and waits for its frame; returns its region and pixels.
  const inspectFrame = async (timeout = 120_000) => {
    const since = await page.evaluate(() => performance.now());
    await page.click('.pe-zoom__inspect');
    await poll(() => page.evaluate((t) => performance.getEntriesByName('pe-inspect-frame').some((m) => m.startTime > t), since), Boolean, '1:1 frame', timeout);
    const frame = await page.evaluate((t) => {
      const mark = performance.getEntriesByName('pe-inspect-frame').find((m) => m.startTime > t);
      const canvas = document.querySelector('.pe-inspect__canvas');
      const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      return { region: mark.detail, ms: Math.round(mark.startTime - t), data: Array.from(data) };
    }, since);
    await page.click('.pe-zoom__inspect');
    return frame;
  };
  const exportFile = async (format) => {
    await tab(3);
    await page.check(`input[name=pe-format][value=${format}]`);
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 600_000 }), page.click('.pe-export-button')]);
    return download;
  };
  try {
    await step('load', async () => {
      await page.goto(URL_EDITOR, { waitUntil: 'load' });
      await page.waitForSelector('.pe[data-engine]', { timeout: 15_000 });
      result.engine = await page.$eval('.pe', (e) => e.dataset.engine);
      if (run.expectEngine) assert.equal(result.engine, run.expectEngine);
    });
    await step('Detail controls and preview', async () => {
      await importFiles([files.smallFile], 1);
      await select('detail-small.png');
      await openDetail();
      for (const [key, value] of Object.entries(SETTINGS)) await setValue(LABELS[key], value);
      await poll(detailState, (s) => s === 'final', 'Detail preview');
      result.detailLabel = await page.textContent('[data-detail-preview]');
      assert.match(result.detailLabel, /Detail preview at 600×400/);
      if (run.device) {
        const layout = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          rangeHeight: document.querySelector('.pe-section[data-section-id=detail] .pe-range').getBoundingClientRect().height,
        }));
        result.mobile = layout;
        assert.ok(layout.overflow <= 0, `page scrolls sideways by ${layout.overflow}px`);
      }
    });
    await step('compare and switching with Detail on', async () => {
      if (!run.device) {
        for (const label of ['Original', 'Split', 'Edited']) await page.click(`.pe-compare button:has-text("${label}")`);
        assert.equal(await detailState(), 'final');
      }
    });
    await step('PNG export equals the Node reference', async () => {
      const download = await exportFile('png');
      if (process.env.DETAIL_DEBUG_OUT) await download.saveAs(path.join(process.env.DETAIL_DEBUG_OUT, `${run.name.replace(/\W+/g, '-')}.png`));
      const { data, info } = await sharp(await download.path()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const reference = renderDetailImage(files.small, deriveParams(SETTINGS));
      let max = 0;
      // Colours of fully transparent pixels are not kept by canvases (premultiplied storage).
      for (let i = 0; i < reference.length; i += 1) if (reference[i - (i % 4) + 3] > 0) max = Math.max(max, Math.abs(reference[i] - data[i]));
      result.pngMaxDifference = max;
      assert.equal(info.width, 600);
      assert.ok(max <= 1, `PNG differs from the reference by ${max}`);
    });
    await step('1:1 Detail equals the Node reference of the region', async () => {
      if (run.device) return;
      const { region, data } = await inspectFrame();
      const reference = renderDetailImage(files.small, deriveParams(SETTINGS));
      let max = 0;
      for (let y = 0; y < region.height; y += 1) {
        for (let x = 0; x < region.width; x += 1) {
          const r = ((region.y + y) * files.small.width + region.x + x) * 4;
          const o = (y * region.width + x) * 4;
          if (reference[r + 3] === 0) continue;
          for (let c = 0; c < 4; c += 1) max = Math.max(max, Math.abs(reference[r + c] - data[o + c]));
        }
      }
      result.inspect = { region: `${region.width}×${region.height}+${region.x}+${region.y}`, maxDifference: max };
      assert.ok(max === 0, `1:1 frame differs from the reference by ${max}`);
    });
    await step('reset Detail returns the GPU preview', async () => {
      await openDetail();
      await page.click('.pe-section[data-section-id=detail] .pe-section__reset');
      await poll(detailState, (s) => s === null, 'Detail label gone');
    });
    if (run.large) {
      await step('24 MP JPEG with Detail: preview and full-size export', async () => {
        const measures = { baselineMb: await memoryMb(profile) };
        result.large = measures;
        await importFiles([files.largeFile], 2);
        await select('detail-24mp.jpg');
        await openDetail();
        // First Detail value: the worker receives the proxy, builds the guide and both frames.
        measures.first = await timeFrames(() => setValue('Clarity', 40));
        // A fine-filter change reuses the guide.
        measures.sharpening = await timeFrames(() => setValue('Sharpening', 50));
        measures.base = await timeFrames(() => setValue('Exposure', 0.3));
        measures.all = await timeFrames(async () => {
          await setValue('Luminance noise reduction', 30);
          await setValue('Texture', 30);
          await setValue('Dehaze', 20);
          await setValue('Color noise reduction', 40);
        });
        const stop = sampler(profile);
        const started = Date.now();
        const download = await exportFile('jpeg');
        measures.exportMs = Date.now() - started;
        measures.exportPeakMb = stop();
        measures.afterMb = await memoryMb(profile);
        const meta = await sharp(await download.path()).metadata();
        measures.exportSize = `${meta.width}×${meta.height}`;
        assert.equal(measures.exportSize, '6000×4000');
        measures.fileName = download.suggestedFilename();
      });
    }
    if (run.raw && RAW_FILE) {
      await step('genuine RAW with Detail: preview and full-size export', async () => {
        const measures = { file: path.basename(RAW_FILE) };
        result.raw = measures;
        await importFiles([RAW_FILE], run.large ? 3 : 2);
        await select(path.basename(RAW_FILE));
        await openDetail();
        measures.first = await timeFrames(async () => {
          await setValue('Texture', 40);
          await setValue('Luminance noise reduction', 30);
        });
        measures.sharpening = await timeFrames(() => setValue('Sharpening', 40));
        const stopInspect = sampler(profile);
        const inspected = await inspectFrame(300_000);
        measures.inspect = { region: `${inspected.region.width}×${inspected.region.height}`, firstFrameMs: inspected.ms, peakMb: stopInspect() };
        const stop = sampler(profile);
        const exportStarted = Date.now();
        const download = await exportFile('jpeg');
        measures.exportMs = Date.now() - exportStarted;
        measures.exportPeakMb = stop();
        const meta = await sharp(await download.path()).metadata();
        measures.exportSize = `${meta.width}×${meta.height}`;
      });
    }
    assert.deepEqual(problems, [], problems.join('\n'));
    result.ok = true;
    delete result.step;
  } catch (error) {
    result.ok = false;
    result.error = error.message.replace(/\s+/g, ' ').slice(0, 400);
    result.problems = problems.slice(0, 5);
    result.screen = await page.evaluate(() => [...document.querySelectorAll('[role=alert]')].map((node) => node.textContent).join(' | ') || null).catch(() => null);
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
  }
  if (!RAW_FILE) console.log('Genuine RAW not checked: set DETAIL_FIXTURE_DIR to a folder with an .ARW file.');
  if (results.some(({ ok }) => !ok)) process.exitCode = 1;
}

await main();
