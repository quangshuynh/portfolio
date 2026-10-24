// Geometry check of /photography/editor on a production build in Chromium, Firefox and
// WebKit (Playwright builds; WebKit is not Safari on iOS), iPhone 13 emulation (touch) and
// a forced CPU preview. Each run: the crop tool by pointer (touch on the phone) and
// keyboard, Cancel and Apply, straighten with crop to fill, ratio, flip and perspective,
// zoom at 100% on the output grid, before/after, a PNG export compared with the Node
// reference (same warp and renderer), Detail + geometry, a batch ZIP with resize, and a
// 24 MP JPEG straightened and cropped (timed, browser memory sampled on Windows).
// With GEOMETRY_FIXTURE_DIR (a folder with three Sony .ARW of one scene) it also times a
// genuine RAW with geometry and Detail (preview, 1:1, export) and, in Chromium, a merged
// RAW HDR exported with geometry. Usage: npm run check:editor:geometry
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
import { renderRgba8 } from '../src/editor/pipeline/cpuRenderer.mjs';
import { renderDetailImage } from '../src/editor/pipeline/detailRenderer.mjs';
import { deriveParams } from '../src/editor/pipeline/spec.mjs';
import { finishRows, warpImage, warpSpec } from '../src/editor/pipeline/warp.mjs';
import { exportGeometry } from '../src/editor/io/files.mjs';
import { normalizeAdjustments } from '../src/editor/model/adjustments.mjs';
import { readZip } from '../src/editor/dev/zipVerify.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'editor-geometry-'));
const fixtures = path.join(work, 'fixtures');
mkdirSync(fixtures, { recursive: true });
const PORT = 4187;
const URL_EDITOR = `http://localhost:${PORT}/photography/editor/`;
const ONLY = process.env.EDITOR_ENGINES?.split(',');
const RAW_DIR = process.env.GEOMETRY_FIXTURE_DIR ?? '';
const RAW_FILES = RAW_DIR && existsSync(RAW_DIR) ? readdirSync(RAW_DIR).filter((name) => /\.arw$/i.test(name)).sort().map((name) => path.join(RAW_DIR, name)) : [];
const AUTOSAVE_KEY = 'photo-editor:edits:v1';

const RUNS = [
  { name: 'Chromium, desktop', type: chromium, large: true, raw: true, hdr: true },
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

/** A deterministic textured RGBA image with edges, lines and a transparent corner. */
function pattern(width, height, { alpha = false } = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 11;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const v = 100 + 60 * Math.sin(x / 9) * Math.cos(y / 13) + (x % 50 < 3 ? 80 : 0) + (rand() - 0.5) * 20;
      data[i] = v + 25; data[i + 1] = v; data[i + 2] = v - 25;
      data[i + 3] = 255;
      if (alpha && x < width / 6 && y > height * 0.8) { data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 0; }
    }
  }
  return { width, height, data };
}

async function makeFixtures() {
  const small = pattern(600, 400, { alpha: true });
  const smallFile = path.join(fixtures, 'geometry-small.png');
  await sharp(Buffer.from(small.data.buffer), { raw: { width: 600, height: 400, channels: 4 } }).png().toFile(smallFile);
  const large = pattern(6000, 4000);
  const largeFile = path.join(fixtures, 'geometry-24mp.jpg');
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

/** The Node reference of an export: warp, render (Detail when set), coverage. */
function reference(image, adjustments, resize = { mode: 'original' }) {
  const values = normalizeAdjustments(adjustments);
  const sizes = exportGeometry(values.geometry, image, resize);
  const spec = warpSpec(sizes.plan, sizes.output, image);
  const warped = warpImage(image, spec.matrix, spec);
  const params = deriveParams(values);
  const data = params.detailActive
    ? renderDetailImage(warped, params, { nativeWidth: sizes.plan.native.width, nativeHeight: sizes.plan.native.height })
    : renderRgba8(warped.data, params);
  finishRows(spec, data, 0, spec.height, false);
  return { width: spec.width, height: spec.height, data };
}

/** Largest difference where both are opaque (canvases keep partial alpha imprecisely), and alpha mismatches. */
function compare(expected, actual) {
  let max = 0;
  let alpha = 0;
  for (let i = 0; i < expected.data.length; i += 4) {
    if (Math.abs(expected.data[i + 3] - actual[i + 3]) > 1) alpha += 1;
    if (expected.data[i + 3] < 255 || actual[i + 3] < 255) continue;
    for (let c = 0; c < 3; c += 1) max = Math.max(max, Math.abs(expected.data[i + c] - actual[i + c]));
  }
  return { max, alphaMismatches: alpha };
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
  const touch = Boolean(run.device);
  const tab = async (index) => { if (run.device) await page.click(`.pe-tabs button:nth-child(${index})`); };
  const step = async (name, fn) => { result.step = name; return fn(); };
  const setValue = async (label, value) => {
    const field = page.getByRole('textbox', { name: `${label} value` });
    await field.scrollIntoViewIfNeeded();
    await field.click();
    await field.fill(String(value));
    await field.press('Enter');
  };
  const importFiles = async (paths, count) => {
    await tab(1);
    await page.setInputFiles('input[type=file][multiple]', paths);
    await poll(() => page.$$eval('.pe-photo--list', (items) => items.filter((li) => li.dataset.status === 'ready').length), (n) => n >= count, 'imports', 300_000);
  };
  const select = async (name) => {
    await tab(1);
    await page.click(`.pe-photo--list button.pe-photo__select[aria-label^="${name}"]`);
    await poll(() => page.evaluate(() => !document.querySelector('.pe-stage-message') && !document.querySelector('.pe-canvas-host').hidden), Boolean, 'preview', 180_000);
  };
  const openGeometry = async () => {
    await tab(2);
    const toggle = page.locator('.pe-section[data-section-id=geometry] .pe-section__toggle');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  };
  // Settings of the active photo, from the autosave (settings only, written shortly after a change).
  const saved = async (name) => poll(() => page.evaluate(([key, file]) => JSON.parse(localStorage.getItem(key) ?? 'null')?.photos.find((p) => p.source.name === file)?.adjustments ?? null, [AUTOSAVE_KEY, name]), Boolean, 'autosave', 10_000);
  const savedAfterChange = async (name, before) => poll(async () => JSON.stringify(await saved(name)), (text) => text !== before, 'autosaved change', 10_000).then(JSON.parse);
  const outputSize = () => page.evaluate(() => document.querySelector('[data-output-size]')?.textContent ?? null);
  // A drag of a crop handle: mouse, or touch pointer events on the phone.
  const drag = async (selector, dx, dy) => {
    const box = await page.locator(selector).boundingBox();
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
    if (!touch) {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx / 2, y + dy / 2);
      await page.mouse.move(x + dx, y + dy);
      await page.mouse.up();
      return;
    }
    const handle = page.locator(selector);
    const base = { pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, bubbles: true };
    await handle.dispatchEvent('pointerdown', { ...base, clientX: x, clientY: y });
    await handle.dispatchEvent('pointermove', { ...base, clientX: x + dx / 2, clientY: y + dy / 2 });
    await handle.dispatchEvent('pointermove', { ...base, clientX: x + dx, clientY: y + dy });
    await handle.dispatchEvent('pointerup', { ...base, clientX: x + dx, clientY: y + dy });
  };
  const exportFile = async (format) => {
    await tab(3);
    await page.check(`input[name=pe-format][value=${format}]`);
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 900_000 }), page.click('.pe-export-button')]);
    return download;
  };
  const readPng = async (download) => {
    const { data, info } = await sharp(await download.path()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  };
  // Milliseconds from a change until the second animation frame after it (the frame painted).
  const frameAfter = (action) => page.evaluate(async (name) => {
    const started = performance.now();
    const range = (suffix) => document.getElementById(document.querySelector(`label[for$="-${suffix}"]`).htmlFor);
    if (name === 'crop') document.querySelector('.pe-crop__box').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    else {
      const input = range(name === 'straighten' ? 'angle' : 'vertical');
      input.value = name === 'straighten' ? '9' : '50';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return Math.round(performance.now() - started);
  }, action);
  try {
    await step('load', async () => {
      await page.goto(URL_EDITOR, { waitUntil: 'load' });
      await page.waitForSelector('.pe[data-engine]', { timeout: 15_000 });
      result.engine = await page.$eval('.pe', (e) => e.dataset.engine);
      if (run.expectEngine) assert.equal(result.engine, run.expectEngine);
      await importFiles([files.smallFile], 1);
      await select('geometry-small.png');
    });
    await step('crop tool: drag, keyboard, Cancel and Apply', async () => {
      await page.click('.pe-zoom__crop');
      await page.waitForSelector('.pe-crop__box');
      const before = await page.getAttribute('.pe-crop__box', 'aria-valuetext');
      await drag('.pe-crop__handle[data-handle=se]', -60, -40);
      const dragged = await page.getAttribute('.pe-crop__box', 'aria-valuetext');
      assert.notEqual(dragged, before);
      // Escape cancels: the frame is whole again.
      await page.keyboard.press('Escape');
      await page.waitForSelector('.pe-crop__box', { state: 'detached' });
      assert.equal(await outputSize(), null);
      await page.click('.pe-zoom__crop');
      await drag('.pe-crop__handle[data-handle=nw]', 40, 30);
      await page.focus('.pe-crop__handle[data-handle=e]');
      await page.keyboard.press('Shift+ArrowLeft');
      await page.focus('.pe-crop__box');
      await page.keyboard.press('ArrowDown');
      const cropped = await page.getAttribute('.pe-crop__box', 'aria-valuetext');
      result.crop = cropped;
      if (run.device) {
        const layout = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          handle: Math.round(document.querySelector('.pe-crop__handle').getBoundingClientRect().width),
          toolbar: [...document.querySelectorAll('.pe-croptools button')].map((b) => b.textContent).filter(Boolean),
        }));
        result.mobile = layout;
        assert.ok(layout.overflow <= 0, `page scrolls sideways by ${layout.overflow}px`);
        assert.ok(layout.handle >= 44, `crop handles are ${layout.handle}px`);
        assert.deepEqual(layout.toolbar, ['Cancel', 'Apply']);
      }
      await page.keyboard.press('Enter');
      await page.waitForSelector('.pe-crop__box', { state: 'detached' });
      assert.match(await outputSize(), new RegExp(`^${cropped.split(' px')[0].replace(' × ', '×')} px`));
    });
    await step('straighten, ratio, flip, perspective; PNG equals the Node reference', async () => {
      await openGeometry();
      const before = JSON.stringify(await saved('geometry-small.png'));
      await setValue('Straighten', 6.5);
      await page.selectOption('.pe-geometry__ratio select', '3:2');
      await page.getByRole('button', { name: 'Flip horizontal' }).click();
      await setValue('Vertical perspective', 35);
      await setValue('Exposure', 0.4);
      const adjustments = await savedAfterChange('geometry-small.png', before);
      await poll(() => saved('geometry-small.png').then((a) => a.exposure === 0.4 && a.geometry?.perspective?.vertical === 35), Boolean, 'settings saved');
      const settings = await saved('geometry-small.png');
      result.geometry = settings.geometry;
      assert.ok(adjustments.geometry && settings.geometry.angle === -6.5, JSON.stringify(settings.geometry));
      const expected = reference(files.small, settings);
      const png = await readPng(await exportFile('png'));
      assert.equal(`${png.width}×${png.height}`, `${expected.width}×${expected.height}`);
      result.png = { size: `${png.width}×${png.height}`, ...compare(expected, png.data) };
      assert.ok(result.png.max <= 1, `PNG differs from the reference by ${result.png.max}`);
    });
    await step('zoom 100% is the output grid; before/after stay aligned', async () => {
      if (run.device) return;
      await page.keyboard.press('1');
      const zoom = await page.evaluate(() => ({ readout: document.querySelector('.pe-readout').textContent, host: document.querySelector('.pe-canvas-host').style.width, output: document.querySelector('[data-output-size]').textContent }));
      assert.equal(zoom.readout, '100%');
      assert.equal(`${parseFloat(zoom.host)}`, zoom.output.split('×')[0]);
      const canvas = await page.evaluate(() => [document.querySelector('.pe-canvas').width, document.querySelector('.pe-canvas').height]);
      for (const label of ['Split', 'Original', 'Edited']) {
        await page.click(`.pe-compare button:has-text("${label}")`);
        assert.deepEqual(await page.evaluate(() => [document.querySelector('.pe-canvas').width, document.querySelector('.pe-canvas').height]), canvas);
      }
      await page.keyboard.press('0');
    });
    await step('interaction timings', async () => {
      if (run.device) return;
      await page.click('.pe-zoom__crop');
      result.timings = { cropMoveMs: await frameAfter('crop'), straightenMs: await frameAfter('straighten'), perspectiveMs: await frameAfter('perspective') };
      await page.keyboard.press('Escape');
    });
    await step('Detail with geometry: PNG equals the Node reference', async () => {
      const before = JSON.stringify(await saved('geometry-small.png'));
      await tab(2);
      const toggle = page.locator('.pe-section[data-section-id=detail] .pe-section__toggle');
      if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
      await setValue('Texture', 50);
      await setValue('Sharpening', 60);
      await savedAfterChange('geometry-small.png', before);
      await poll(() => saved('geometry-small.png').then((a) => a.sharpening === 60), Boolean, 'Detail saved');
      const settings = await saved('geometry-small.png');
      const expected = reference(files.small, settings);
      const png = await readPng(await exportFile('png'));
      result.detailPng = { size: `${png.width}×${png.height}`, ...compare(expected, png.data) };
      assert.ok(result.detailPng.max <= 1, `Detail PNG differs from the reference by ${result.detailPng.max}`);
    });
    await step('batch ZIP with export resize', async () => {
      if (run.device) return;
      await tab(1);
      await page.click('.pe-batch__actions button:has-text("Export")');
      const dialog = page.locator('.pe-dialog[role=dialog]');
      await dialog.waitFor();
      await dialog.locator('input[name=pe-batch-output][value=zip]').check();
      await dialog.locator('input[name=pe-batch-format][value=png]').check();
      await dialog.locator('select').selectOption('long-edge');
      await dialog.getByRole('spinbutton', { name: 'Long edge' }).fill('300');
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 300_000 }), dialog.locator('.pe-dialog__foot button.pe-button--primary').click()]);
      const entries = readZip(readFileSync(await download.path()));
      const settings = await saved('geometry-small.png');
      const expected = exportGeometry(normalizeAdjustments(settings).geometry, files.small, { mode: 'long-edge', longEdge: 300 }).output;
      const meta = await sharp(entries[0].data).metadata();
      result.batch = { entries: entries.map(({ name }) => name), size: `${meta.width}×${meta.height}` };
      assert.deepEqual(result.batch.entries, ['geometry-small-quangedit.png']);
      assert.equal(result.batch.size, `${expected.width}×${expected.height}`);
      await page.locator('.pe-dialog__foot button:has-text("Close")').click();
      // Export settings are shared: back to the original size.
      await tab(3);
      await page.selectOption('[data-section=export] select', 'original');
    });
    if (run.large) {
      await step('24 MP JPEG straightened and cropped: full-size export', async () => {
        const measures = { baselineMb: await memoryMb(profile) };
        result.large = measures;
        await importFiles([files.largeFile], 2);
        await select('geometry-24mp.jpg');
        await openGeometry();
        await setValue('Straighten', -4);
        const output = await poll(outputSize, Boolean, 'output size');
        measures.output = output;
        const stop = sampler(profile);
        const started = Date.now();
        const download = await exportFile('jpeg');
        measures.exportMs = Date.now() - started;
        measures.exportPeakMb = stop();
        const meta = await sharp(await download.path()).metadata();
        measures.exportSize = `${meta.width}×${meta.height}`;
        assert.equal(`${measures.exportSize} px`, output);
        measures.fileName = download.suggestedFilename();
      });
    }
    if (run.raw && RAW_FILES.length) {
      await step('genuine RAW with geometry and Detail: preview, 1:1 and export', async () => {
        const measures = { file: path.basename(RAW_FILES[0]) };
        result.raw = measures;
        const count = await page.$$eval('.pe-photo--list', (items) => items.length);
        await importFiles([RAW_FILES[0]], count + 1);
        await select(path.basename(RAW_FILES[0]));
        await openGeometry();
        let started = Date.now();
        await setValue('Straighten', 2.5);
        await page.selectOption('.pe-geometry__ratio select', '4:5');
        measures.output = await poll(outputSize, (t) => Boolean(t), 'RAW output size');
        measures.geometryPreviewMs = Date.now() - started;
        await tab(2);
        const toggle = page.locator('.pe-section[data-section-id=detail] .pe-section__toggle');
        if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
        await setValue('Texture', 40);
        if (!run.device) {
          const stopInspect = sampler(profile);
          started = await page.evaluate(() => performance.now());
          await page.click('.pe-zoom__inspect');
          await poll(() => page.evaluate((t) => performance.getEntriesByName('pe-inspect-frame').some((m) => m.startTime > t), started), Boolean, '1:1 frame', 300_000);
          measures.inspect = { firstFrameMs: Math.round(await page.evaluate((t) => performance.getEntriesByName('pe-inspect-frame').find((m) => m.startTime > t).startTime - t, started)), peakMb: stopInspect() };
          await page.click('.pe-zoom__inspect');
        }
        const stop = sampler(profile);
        started = Date.now();
        const download = await exportFile('jpeg');
        measures.exportMs = Date.now() - started;
        measures.exportPeakMb = stop();
        const meta = await sharp(await download.path()).metadata();
        measures.exportSize = `${meta.width}×${meta.height}`;
        assert.equal(`${measures.exportSize} px`, measures.output);
        assert.equal(download.suggestedFilename(), `${path.basename(RAW_FILES[0]).replace(/\.arw$/i, '')}-quangedit.jpg`);
      });
    }
    if (run.hdr && RAW_FILES.length >= 3) {
      await step('merged RAW HDR with geometry: export', async () => {
        const measures = {};
        result.hdr = measures;
        await tab(1);
        await page.click('.pe-library__actions button:has-text("Merge HDR")');
        await page.waitForSelector('.pe-dialog[role=dialog]');
        await page.setInputFiles('.pe-dialog input[type=file][multiple]', RAW_FILES.slice(0, 3));
        await poll(() => page.$$eval('.pe-bracket__item', (items) => items.map((li) => li.dataset.status)), (s) => s.length === 3 && s.every((v) => v !== 'reading'), 'bracket inputs', 300_000);
        await page.click('.pe-dialog__foot button:has-text("Merge")');
        await page.waitForSelector('.pe-dialog', { state: 'detached', timeout: 600_000 });
        await poll(() => page.evaluate(() => !document.querySelector('.pe-stage-message')), Boolean, 'merged preview', 300_000);
        await openGeometry();
        await setValue('Straighten', -3);
        await page.getByRole('button', { name: 'Rotate 90° clockwise' }).click();
        measures.output = await poll(outputSize, Boolean, 'HDR output size');
        const stop = sampler(profile);
        const started = Date.now();
        const download = await exportFile('jpeg');
        measures.exportMs = Date.now() - started;
        measures.exportPeakMb = stop();
        const meta = await sharp(await download.path()).metadata();
        measures.exportSize = `${meta.width}×${meta.height}`;
        measures.fileName = download.suggestedFilename();
        assert.equal(`${measures.exportSize} px`, measures.output);
        assert.match(measures.fileName, /-HDR-quangedit\.jpg$/);
      });
    }
    assert.deepEqual(problems, [], problems.join('\n'));
    result.ok = true;
    delete result.step;
  } catch (error) {
    result.ok = false;
    result.error = error.message.replace(/\s+/g, ' ').slice(0, 500);
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
  if (!RAW_FILES.length) console.log('Genuine RAW and HDR not checked: set GEOMETRY_FIXTURE_DIR to a folder with three .ARW files of one scene.');
  if (results.some(({ ok }) => !ok)) process.exitCode = 1;
}

await main();
