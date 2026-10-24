// Filter Library check of /photography/editor on a production build in Chromium, Firefox and
// WebKit (Playwright builds; WebKit is not Safari on iOS), iPhone 13 and Pixel 7 emulation and a
// forced CPU preview. Each run: the library opens and fills with thumbnails (timed), search,
// categories, favourites and recent; filter-switch latency (GPU and CPU-only filters) and rapid
// switching; strength, Compare and undo/redo; PNG exports of digital filters (with geometry and
// transparency) equal to the Node reference; a batch filter on two photos and a ZIP whose entries
// equal the reference. Desktop runs export a 24 MP JPEG with the costliest filters (browser memory
// sampled on Windows). With FILTER_FIXTURE_DIR (a folder with genuine Sony .ARW and .JPG files)
// Chromium and Firefox also filter a genuine JPEG and RAW, and Chromium a merged RAW HDR.
// Usage: npm run check:editor:filters (CHECK_GPU=1: Chromium on the real GPU)
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
import { renderAnyImage } from '../src/editor/pipeline/detailRenderer.mjs';
import { deriveParams } from '../src/editor/pipeline/spec.mjs';
import { finishRows, warpImage, warpSpec } from '../src/editor/pipeline/warp.mjs';
import { exportGeometry } from '../src/editor/io/files.mjs';
import { normalizeAdjustments } from '../src/editor/model/adjustments.mjs';
import { BUILT_IN_FILTERS } from '../src/editor/model/filters.mjs';
import { readZip } from '../src/editor/dev/zipVerify.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'editor-filters-'));
const fixtures = path.join(work, 'fixtures');
mkdirSync(fixtures, { recursive: true });
const PORT = 4191;
const URL_EDITOR = `http://localhost:${PORT}/photography/editor/`;
const ONLY_RUNS = process.env.FILTER_RUNS?.split(',');
const GENUINE_DIR = process.env.FILTER_FIXTURE_DIR ?? '';
const GENUINE = GENUINE_DIR && existsSync(GENUINE_DIR) ? readdirSync(GENUINE_DIR).sort().map((name) => path.join(GENUINE_DIR, name)) : [];
const RAW_FILES = GENUINE.filter((file) => /\.arw$/i.test(file));
const JPEG_FILES = GENUINE.filter((file) => /\.jpe?g$/i.test(file));
const AUTOSAVE_KEY = 'photo-editor:edits:v1';
const byName = (name) => BUILT_IN_FILTERS.find((filter) => filter.name === name);

const RUNS = [
  { id: 'chromium', name: 'Chromium, desktop', type: chromium, large: true, genuine: true, hdr: true },
  { id: 'firefox', name: 'Firefox, desktop', type: firefox, large: true, genuine: true },
  { id: 'webkit', name: 'WebKit, desktop', type: webkit, large: true },
  { id: 'iphone', name: 'WebKit, iPhone 13 emulation', type: webkit, device: 'iPhone 13' },
  { id: 'pixel', name: 'Chromium, Pixel 7 emulation', type: chromium, device: 'Pixel 7' },
  { id: 'cpu', name: 'Chromium, desktop, no WebGL2', type: chromium, init: 'noWebgl2', expectEngine: 'cpu' },
];
const INIT = {
  noWebgl2: () => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) { return type === 'webgl2' ? null : original.call(this, type, ...rest); };
  },
};
// Exported and compared with the Node reference: every new operation, alone or combined.
const EXPORTS = ['Classic CCD', 'Pixelated', 'Color Quantization', 'Chromatic Fringing', 'Soft Focus', 'Sensor Noise', 'Early Smartphone', 'Night Vision-inspired', 'JPEG Damage'];

/** A deterministic photo-like RGBA image: gradients, fine texture, skin and foliage tones, highlights, a transparent corner. */
function pattern(width, height, { alpha = false } = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 11;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const t = x / width;
      const v = 40 + 150 * t + 30 * Math.sin(y / 17) + 25 * Math.sin(x / 3) * Math.sin(y / 4) + (rand() - 0.5) * 16;
      let rgb = [v + 30 * (1 - t), v, v - 30 * t];
      if (y > height * 0.55 && y < height * 0.75 && x < width * 0.3) rgb = [214, 168, 140];
      if (y > height * 0.55 && y < height * 0.75 && x > width * 0.35 && x < width * 0.6) rgb = [50, 150, 70];
      if ((x - width * 0.8) ** 2 + (y - height * 0.3) ** 2 < (height * 0.06) ** 2) rgb = [255, 252, 245];
      data.set([...rgb.map((c) => Math.max(0, Math.min(255, Math.round(c)))), 255], i);
      if (alpha && x < width / 6 && y > height * 0.85) data.set([0, 0, 0, 0], i);
    }
  }
  return { width, height, data };
}

async function makeFixtures() {
  const write = async (image, name, jpeg = false) => {
    const file = path.join(fixtures, name);
    const pipeline = sharp(Buffer.from(image.data.buffer), { raw: { width: image.width, height: image.height, channels: 4 } });
    await (jpeg ? pipeline.jpeg({ quality: 90 }) : pipeline.png()).toFile(file);
    return file;
  };
  const small = pattern(600, 400, { alpha: true });
  const second = pattern(480, 320);
  const large = pattern(6000, 4000);
  return { small, second, smallFile: await write(small, 'filters-small.png'), secondFile: await write(second, 'filters-second.png'), largeFile: await write(large, 'filters-24mp.jpg', true) };
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

/** The Node reference of an export: warp, the renderer the settings need, coverage. */
function reference(image, adjustments) {
  const values = normalizeAdjustments(adjustments);
  const sizes = exportGeometry(values.geometry, image, { mode: 'original' });
  const spec = warpSpec(sizes.plan, sizes.output, image);
  const warped = warpImage(image, spec.matrix, spec);
  const data = renderAnyImage(warped, deriveParams(values), { nativeWidth: sizes.plan.native.width, nativeHeight: sizes.plan.native.height });
  finishRows(spec, data, 0, spec.height, false);
  return { width: spec.width, height: spec.height, data };
}

/** Largest difference where both are opaque, and alpha mismatches. */
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
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function runOne(run, files) {
  const profile = mkdtempSync(path.join(work, 'profile-'));
  const args = process.env.CHECK_GPU && run.type === chromium ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : [];
  const context = await run.type.launchPersistentContext(profile, { ...(run.device ? devices[run.device] : { viewport: { width: 1440, height: 900 } }), acceptDownloads: true, args });
  if (run.init) await context.addInitScript(INIT[run.init]);
  const page = context.pages()[0] ?? await context.newPage();
  const problems = [];
  const requests = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('crash', () => problems.push('page crashed'));
  page.on('console', (message) => message.type() === 'error' && !/\[photo editor\] (webgl2|image-worker)/.test(message.text()) && problems.push(`console: ${message.text()}`));
  page.on('request', (request) => { if (!request.url().startsWith(`http://localhost:${PORT}/`) && !request.url().startsWith('blob:') && !request.url().startsWith('data:')) requests.push(request.url()); });
  const result = { environment: run.name, browser: `${run.type.name()} ${context.browser()?.version() ?? ''}`.trim() };
  const touch = Boolean(run.device);
  const tab = async (index) => { if (run.device) await page.click(`.pe-tabs button:nth-child(${index})`); };
  const step = async (name, fn) => { result.step = name; return fn(); };
  const openSection = async (id) => {
    await tab(2);
    const toggle = page.locator(`.pe-section[data-section-id=${id}] .pe-section__toggle`);
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  };
  const importFiles = async (paths, count) => {
    await tab(1);
    await page.setInputFiles('input[type=file][multiple]', paths);
    await poll(() => page.$$eval('.pe-photo--list', (items) => items.filter((li) => li.dataset.status === 'ready').length), (n) => n >= count, 'imports', 300_000);
  };
  const select = async (name) => {
    await tab(1);
    await page.click(`.pe-photo--list button.pe-photo__select[aria-label^="${name}"]`);
    await poll(() => page.evaluate(() => !document.querySelector('.pe-stage-message') && !document.querySelector('.pe-canvas-host').hidden), Boolean, 'preview', 300_000);
  };
  const saved = async (name) => poll(() => page.evaluate(([key, file]) => JSON.parse(localStorage.getItem(key) ?? 'null')?.photos.find((p) => p.source.name === file)?.adjustments ?? null, [AUTOSAVE_KEY, name]), Boolean, 'autosave', 10_000);
  const savedWhen = async (name, test, label) => poll(() => saved(name), test, label, 15_000);
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
  const card = (name) => page.locator('.pe-filters__grid .pe-filter__apply', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) });
  const showAll = async () => {
    await openSection('creative');
    await page.getByRole('searchbox', { name: 'Search filters' }).fill('');
    await page.locator('.pe-filters__tabs button', { hasText: /^All$/ }).click();
  };
  // Milliseconds from a click on a filter until its frame: two animation frames on the GPU, the
  // final CPU frame for filters the shader does not draw.
  const applyTimed = (name) => page.evaluate(async ([label, onCpu]) => {
    const button = [...document.querySelectorAll('.pe-filter__apply')].find((node) => node.textContent === label);
    button.scrollIntoView({ block: 'nearest' });
    // A CPU-only filter paints a final Detail-path frame; on the CPU engine others paint a CPU frame.
    const mark = onCpu ? 'pe-detail-final' : 'pe-cpu-frame';
    const before = performance.getEntriesByName(mark).length;
    const started = performance.now();
    button.click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise((resolve) => setTimeout(resolve, 80));
    if (onCpu || document.querySelector('.pe')?.dataset.engine === 'cpu') {
      while (performance.getEntriesByName(mark).length === before && performance.now() - started < 30_000) await new Promise((resolve) => setTimeout(resolve, 10));
      return { ms: Math.round(performance.now() - started), cpu: true };
    }
    return { ms: Math.round(performance.now() - started - 80), cpu: false };
  }, [name, deriveParams(byName(name).settings).cpuOnly]);
  // Waits for every thumbnail of the shown photo (marks of an earlier photo are cleared first).
  const thumbnailsDone = async (label) => {
    const started = Date.now();
    await poll(() => page.evaluate(() => performance.getEntriesByName('pe-filter-thumbs').at(-1)?.detail?.count ?? 0), (n) => n >= BUILT_IN_FILTERS.length, label, 180_000);
    return Date.now() - started;
  };
  const clearThumbMarks = () => page.evaluate(() => performance.clearMarks('pe-filter-thumbs'));
  const timedExport = async (format) => {
    const stop = sampler(profile);
    const started = Date.now();
    const download = await exportFile(format);
    const meta = await sharp(await download.path()).metadata();
    return { download, exportMs: Date.now() - started, peakMb: stop(), size: `${meta.width}×${meta.height}` };
  };
  try {
    await step('load', async () => {
      await page.goto(URL_EDITOR, { waitUntil: 'load' });
      await page.waitForSelector('.pe[data-engine]', { timeout: 15_000 });
      result.engine = await page.$eval('.pe', (e) => e.dataset.engine);
      if (run.expectEngine) assert.equal(result.engine, run.expectEngine);
      await importFiles([files.smallFile], 1);
      await select('filters-small.png');
    });
    await step('the library opens at once and fills with thumbnails of the photo', async () => {
      await tab(2);
      const started = Date.now();
      await page.click('.pe-section[data-section-id=creative] .pe-section__toggle');
      await page.locator('.pe-filters__grid .pe-filter').first().waitFor();
      const openMs = Date.now() - started;
      const cards = await page.locator('.pe-filters__grid .pe-filter').count();
      await poll(() => page.locator('canvas.pe-filter__thumb').count(), (n) => n >= cards, 'thumbnails', 120_000);
      result.library = { cards, openMs, thumbnailsMs: Date.now() - started };
      assert.equal(cards, BUILT_IN_FILTERS.length);
      // Thumbnails differ from each other (they show the filters, not one placeholder).
      const distinct = await page.$$eval('canvas.pe-filter__thumb', (canvases) => new Set(canvases.slice(0, 12).map((c) => c.toDataURL())).size);
      assert.ok(distinct >= 10, `only ${distinct} distinct thumbnails`);
      if (run.device) {
        const layout = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          card: Math.round(document.querySelector('.pe-filter__apply').getBoundingClientRect().height),
          star: Math.round(document.querySelector('.pe-filter__star').getBoundingClientRect().width),
        }));
        result.mobile = layout;
        assert.ok(layout.overflow <= 0, `page scrolls sideways by ${layout.overflow}px`);
        assert.ok(layout.card >= 44, `filter cards are ${layout.card}px tall`);
        assert.ok(layout.star >= 44, `favourite stars are ${layout.star}px wide`);
      }
    });
    await step('search, categories, favourites and recent', async () => {
      await page.getByRole('searchbox', { name: 'Search filters' }).fill('flash');
      const found = await page.locator('.pe-filters__grid .pe-filter__name').allTextContents();
      assert.ok(['Y2K Flash', 'Harsh Direct Flash', 'Overexposed Flash'].every((name) => found.includes(name)), `search found ${found}`);
      await page.getByRole('searchbox', { name: 'Search filters' }).fill('');
      await page.locator('.pe-filters__tabs button', { hasText: /^Experimental$/ }).click();
      const experimental = await page.locator('.pe-filters__grid .pe-filter').count();
      assert.equal(experimental, BUILT_IN_FILTERS.filter(({ category }) => category === 'experimental').length);
      await page.getByRole('button', { name: 'Favorite Sensor Noise' }).click();
      await page.locator('.pe-filters__tabs button', { hasText: /^Favorites$/ }).click();
      assert.deepEqual(await page.locator('.pe-filters__grid .pe-filter__name').allTextContents(), ['Sensor Noise']);
      await showAll();
    });
    await step('filter switching: latency, rapid clicks, strength, compare, undo', async () => {
      const gpu = [];
      const cpu = [];
      for (const name of ['Sepia', 'Neon Night', 'Soft Focus', 'Sensor Noise', 'Pixelated', 'JPEG Damage', 'Chromatic Fringing', 'Classic CCD']) {
        const { ms, cpu: onCpu } = await applyTimed(name);
        (onCpu ? cpu : gpu).push(ms);
      }
      result.switching = { gpuMedianMs: gpu.length ? median(gpu) : null, cpuMedianMs: cpu.length ? median(cpu) : null, gpu, cpu };
      // Rapid switching: ten clicks without waiting end on the last filter, with no errors.
      await page.evaluate(() => {
        const names = ['Warm Cinema', 'Flip Phone', 'Heavy Grain', 'Pastel Memory', 'Posterized Color', 'Dark Grunge', 'Cold Cinema', 'Low-Fi Digital', 'Moody Blue', 'Early 2000s'];
        names.forEach((label) => [...document.querySelectorAll('.pe-filter__apply')].find((node) => node.textContent === label).click());
      });
      await savedWhen('filters-small.png', (a) => a.filter?.id === 'filter:early-2000s', 'last of rapid filters');
      await page.locator('#pe-filter-strength').evaluate((input) => { input.value = '60'; input.dispatchEvent(new Event('input', { bubbles: true })); });
      const half = await savedWhen('filters-small.png', (a) => a.filter?.strength === 60, 'strength 60');
      assert.equal(half.jpegAmount, Math.round(byName('Early 2000s').settings.jpegAmount * 0.6));
      await page.getByRole('button', { name: 'Compare', exact: true }).click();
      await poll(() => page.evaluate(() => document.body.textContent.includes('Without filter')), Boolean, 'compare label');
      await page.getByRole('button', { name: 'Compare', exact: true }).click();
      if (!touch) {
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
        await savedWhen('filters-small.png', (a) => a.filter?.id === 'filter:early-2000s' && a.filter.strength === 100, 'undo strength');
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z');
        await savedWhen('filters-small.png', (a) => a.filter?.strength === 60, 'redo strength');
      }
    });
    await step('PNG exports of digital filters equal the Node reference (alpha, geometry)', async () => {
      result.exports = {};
      const names = touch ? EXPORTS.slice(0, 3) : EXPORTS;
      for (const name of names) {
        await openSection('creative');
        await card(name).click();
        const settings = await savedWhen('filters-small.png', (a) => a.filter?.id === byName(name).id && a.filter.strength === 100, `${name} saved`);
        const png = await readPng(await exportFile('png'));
        const diff = compare(reference(files.small, settings), png.data);
        result.exports[name] = diff.max;
        assert.ok(diff.max <= 1 && diff.alphaMismatches === 0, `${name} PNG differs from the reference: ${JSON.stringify(diff)}`);
      }
      // Geometry: straightened and cropped, then a capture filter, centred on the output.
      await openSection('geometry');
      const field = page.getByRole('textbox', { name: 'Straighten value', exact: true });
      await field.scrollIntoViewIfNeeded();
      await field.fill('5');
      await field.press('Enter');
      await page.selectOption('.pe-geometry__ratio select', '1:1');
      const settings = await savedWhen('filters-small.png', (a) => a.geometry?.angle === 5 && a.geometry?.aspect === '1:1', 'geometry saved');
      const png = await readPng(await exportFile('png'));
      const diff = compare(reference(files.small, settings), png.data);
      result.exports.geometry = { size: `${png.width}×${png.height}`, max: diff.max };
      assert.ok(diff.max <= 1, `geometry + filter PNG differs by ${diff.max}`);
      await openSection('geometry');
      await page.getByRole('button', { name: 'Reset Crop & Transform' }).click();
      await savedWhen('filters-small.png', (a) => !a.geometry, 'geometry reset');
    });
    await step('batch: a filter on two photos (each keeps its grain pattern); ZIP entries equal the reference', async () => {
      if (touch) return;
      await importFiles([files.secondFile], 2);
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
      await page.click('.pe-batch__actions button:has-text("Filter")');
      const dialog = page.locator('.pe-dialog[role=dialog]');
      await dialog.waitFor();
      await dialog.locator('select').selectOption('filter:y2k-flash');
      await dialog.locator('input[type=range]').evaluate((input) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, '50');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await dialog.locator('.pe-dialog__foot button.pe-button--primary').click();
      const first = await savedWhen('filters-small.png', (a) => a.filter?.id === 'filter:y2k-flash', 'batch first');
      const second = await savedWhen('filters-second.png', (a) => a.filter?.id === 'filter:y2k-flash', 'batch second');
      assert.equal(first.filter.strength, 50);
      assert.equal(second.jpegAmount, Math.round(byName('Y2K Flash').settings.jpegAmount / 2));
      await page.click('.pe-batch__actions button:has-text("Export")');
      await dialog.waitFor();
      await dialog.locator('input[name=pe-batch-output][value=zip]').check();
      await dialog.locator('input[name=pe-batch-format][value=png]').check();
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 300_000 }), dialog.locator('.pe-dialog__foot button.pe-button--primary').click()]);
      const entries = readZip(readFileSync(await download.path()));
      result.zip = entries.map(({ name }) => name);
      for (const [entryName, image, settings] of [['filters-small-quangedit.png', files.small, first], ['filters-second-quangedit.png', files.second, second]]) {
        const entry = entries.find(({ name }) => name === entryName);
        assert.ok(entry, `${entryName} missing from the ZIP`);
        const { data } = await sharp(entry.data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const diff = compare(reference(image, settings), data);
        assert.ok(diff.max <= 1, `${entryName} differs from the reference by ${diff.max}`);
      }
      await page.locator('.pe-dialog__foot button:has-text("Close")').click();
    });
    if (run.large) {
      await step('24 MP JPEG: thumbnails, preview and full-size exports of the costliest filters', async () => {
        const measures = { baselineMb: await memoryMb(profile) };
        result.large = measures;
        const count = await page.$$eval('.pe-photo--list', (items) => items.length);
        await importFiles([files.largeFile], count + 1);
        await clearThumbMarks();
        await select('filters-24mp.jpg');
        await showAll();
        measures.thumbnailsMs = await thumbnailsDone('24 MP thumbnails');
        const { exportMs } = await timedExport('jpeg');
        measures.noFilterExportMs = exportMs;
        await openSection('creative');
        measures.switch = {};
        for (const name of ['Soft Focus', 'Chromatic Fringing', 'Early Smartphone']) measures.switch[name] = (await applyTimed(name)).ms;
        for (const name of ['Chromatic Fringing', 'Early Smartphone', 'Soft Focus']) {
          await openSection('creative');
          await card(name).click();
          await savedWhen('filters-24mp.jpg', (a) => a.filter?.id === byName(name).id, `${name} on 24 MP`);
          const { exportMs, peakMb, size } = await timedExport('jpeg');
          measures[name] = { exportMs, peakMb };
          assert.equal(size, '6000×4000');
        }
        await page.waitForTimeout(1500);
        measures.afterMb = await memoryMb(profile);
      });
    }
    if (run.genuine && (JPEG_FILES.length || RAW_FILES.length)) {
      await step('genuine JPEG and Sony RAW: filters, thumbnails and full-size exports', async () => {
        const measures = {};
        result.genuine = measures;
        for (const [file, filterName] of [[JPEG_FILES[0], 'Classic CCD'], [RAW_FILES[0], 'Early Smartphone']].filter(([file]) => file)) {
          const name = path.basename(file);
          const count = await page.$$eval('.pe-photo--list', (items) => items.length);
          await importFiles([file], count + 1);
          await clearThumbMarks();
          await select(name);
          await showAll();
          const thumbnailsMs = await thumbnailsDone(`${name} thumbnails`);
          const baseline = await timedExport('jpeg');
          await openSection('creative');
          const first = (await applyTimed(filterName)).ms;
          await applyTimed('Sepia');
          const again = (await applyTimed(filterName)).ms;
          await savedWhen(name, (a) => a.filter?.id === byName(filterName).id, `${name} filter`);
          const { download, exportMs, peakMb, size } = await timedExport('jpeg');
          measures[name] = { filter: filterName, thumbnailsMs, firstSwitchMs: first, switchMs: again, noFilterExportMs: baseline.exportMs, exportMs, peakMb, size };
          assert.equal(download.suggestedFilename(), `${name.replace(/\.[^.]+$/, '')}-quangedit.jpg`);
        }
      });
    }
    if (run.hdr && RAW_FILES.length >= 3) {
      await step('merged RAW HDR with a filter: export', async () => {
        await tab(1);
        await page.click('.pe-library__actions button:has-text("Merge HDR")');
        await page.waitForSelector('.pe-dialog[role=dialog]');
        await page.setInputFiles('.pe-dialog input[type=file][multiple]', RAW_FILES.slice(0, 3));
        await poll(() => page.$$eval('.pe-bracket__item', (items) => items.map((li) => li.dataset.status)), (s) => s.length === 3 && s.every((v) => v !== 'reading'), 'bracket inputs', 300_000);
        await page.click('.pe-dialog__foot button:has-text("Merge")');
        await page.waitForSelector('.pe-dialog', { state: 'detached', timeout: 600_000 });
        await poll(() => page.evaluate(() => !document.querySelector('.pe-stage-message')), Boolean, 'merged preview', 300_000);
        await showAll();
        await card('Soft CCD Glow').click();
        const stop = sampler(profile);
        const started = Date.now();
        const download = await exportFile('jpeg');
        const meta = await sharp(await download.path()).metadata();
        result.hdr = { exportMs: Date.now() - started, peakMb: stop(), size: `${meta.width}×${meta.height}` };
        assert.match(download.suggestedFilename(), /-HDR-quangedit\.jpg$/);
      });
    }
    assert.deepEqual(requests, [], `unexpected network requests: ${requests.join(', ')}`);
    assert.deepEqual(problems, [], problems.join('\n'));
    result.ok = true;
    delete result.step;
  } catch (error) {
    result.ok = false;
    result.error = error.message.replace(/\s+/g, ' ').slice(0, 600);
    result.problems = problems.slice(0, 5);
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
    for (const run of RUNS.filter(({ id }) => !ONLY_RUNS || ONLY_RUNS.includes(id))) {
      const result = await runOne(run, files);
      results.push(result);
      console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${result.environment} ${JSON.stringify({ ...result, environment: undefined, ok: undefined })}`);
    }
  } finally {
    server.httpServer.close();
    rmSync(work, { recursive: true, force: true });
  }
  if (!GENUINE.length) console.log('Genuine photos not checked: set FILTER_FIXTURE_DIR to a folder with Sony .ARW and .JPG files.');
  if (results.some(({ ok }) => !ok)) process.exitCode = 1;
}

await main();
