// Masks check of /photography/editor: GPU/CPU parity of masked passes (dev server,
// src/editor/dev/layerParity.html), then on a production build in Chromium, Firefox and WebKit
// (Playwright builds; WebKit is not Safari on iOS), iPhone 13 and Pixel 7 emulation and a forced
// CPU preview: local adjustments made from the Masks panel (a linear gradient dragged on the photo
// while zoomed and panned, a brush stroke, a radial with Clarity, so the CPU Detail preview), undo
// and redo, PNG exports equal to the Node reference (composite.mjs with the same masks), saving the
// edits and reopening them after a reload, a document with geometry, a masked adjustment layer
// (multiply) and a masked image layer, phone layout and touch painting, timings. Desktop runs
// export a 24 MP photo with a Detail local adjustment (Chromium: PNG compared with the reference,
// so no band seams; memory sampled on Windows). With MASK_FIXTURE_DIR (genuine Sony .ARW and .JPG
// files) Chromium exports a RAW with a sky gradient, radial and brush and checks that every pixel
// outside the mask is unchanged, adds a masked text layer, and merges a RAW HDR with a local
// adjustment; Firefox exports a RAW with geometry and masks.
// Usage: npm run check:editor:masks (MASK_RUNS=chromium,…; MASK_SKIP_PARITY=1; MASK_PARITY_ONLY=1)
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { build, createServer, preview } from 'vite';
import { chromium, devices, firefox, webkit } from 'playwright';
import { renderAnyImage } from '../src/editor/pipeline/detailRenderer.mjs';
import { deriveParams } from '../src/editor/pipeline/spec.mjs';
import { finishRows, warpImage, warpSpec } from '../src/editor/pipeline/warp.mjs';
import { exportGeometry } from '../src/editor/io/files.mjs';
import { normalizeAdjustments } from '../src/editor/model/adjustments.mjs';
import { createAdjustmentLayer, visibleLayers } from '../src/editor/model/layers.mjs';
import { createBrush, createLinear, createLocalAdjustment, createRadial, maskActive, splitLocalSettings, visibleLocals } from '../src/editor/model/masks.mjs';
import { adjustmentPass, compositeImageSync, localPasses, rasterPass } from '../src/editor/pipeline/composite.mjs';
import { layerMatrix, rasterSize } from '../src/editor/pipeline/layerTransform.mjs';
import { canvasMaskMap, imageMaskMap, layerMaskMap, maskRows } from '../src/editor/pipeline/mask.mjs';
import { DOCUMENT_TYPE, DOCUMENT_VERSION } from '../src/editor/model/editDocument.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'editor-masks-'));
const fixtures = path.join(work, 'fixtures');
mkdirSync(fixtures, { recursive: true });
const PORT = 4194;
const DEV_PORT = 5194;
const URL_EDITOR = `http://localhost:${PORT}/photography/editor/`;
const ONLY_RUNS = process.env.MASK_RUNS?.split(',');
const GENUINE_DIR = process.env.MASK_FIXTURE_DIR ?? '';
const GENUINE = GENUINE_DIR && existsSync(GENUINE_DIR) ? readdirSync(GENUINE_DIR).sort().map((name) => path.join(GENUINE_DIR, name)) : [];
const RAW_FILES = GENUINE.filter((file) => /\.arw$/i.test(file));
const AUTOSAVE_KEY = 'photo-editor:edits:v1';
const PASS_PARITY_MAX = 1;
const AMPLIFIED_PARITY_MAX = 4;

const RUNS = [
  { id: 'chromium', name: 'Chromium, desktop', type: chromium, large: 'png', genuine: 'full' },
  { id: 'firefox', name: 'Firefox, desktop', type: firefox, large: 'jpeg', genuine: 'geometry' },
  { id: 'webkit', name: 'WebKit, desktop', type: webkit, large: 'jpeg' },
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

function pattern(width, height, { phase = 0 } = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const t = x / width;
      const v = 40 + 150 * t + 30 * Math.sin((y + phase) / 17) + 25 * Math.sin(x / 3) * Math.sin(y / 4);
      data.set([v + 30 * (1 - t), v, v - 30 * t, 255].map((c) => Math.max(0, Math.min(255, Math.round(c)))), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}
// A layer with a hard-alpha hole (browser decodes go through a premultiplied canvas).
function overlay(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const hole = (x - width * 0.6) ** 2 + (y - height * 0.4) ** 2 < (height * 0.15) ** 2;
      data.set([220 - (x % 64) * 2, 60 + (y % 50) * 3, 140 + Math.round(60 * Math.sin(x / 9)), hole ? 0 : 255], (y * width + x) * 4);
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
  const base = pattern(600, 400);
  const over = overlay(300, 200);
  const files = { base, over, baseFile: await write(base, 'masks-base.png'), overFile: await write(over, 'masks-over.png') };
  // The 24 MP fixture is read back so the reference uses exactly the decoded pixels.
  files.largeFile = await write(pattern(6000, 4000, { phase: 11 }), 'masks-24mp.png');
  const large = await sharp(files.largeFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  files.large = { width: large.info.width, height: large.info.height, data: new Uint8ClampedArray(large.data) };
  return files;
}
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

async function poll(read, done, label, timeout = 30_000) {
  const end = Date.now() + timeout;
  let value;
  while (Date.now() < end) {
    value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label} (last value ${JSON.stringify(value)?.slice(0, 300)})`);
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

/**
 * The Node reference of a masked PNG export: the photo's reference render, its local adjustments
 * through their masks, then the visible adjustment and image layers with theirs (as composeLayers).
 */
function reference(base, adjustments, rasters = {}) {
  const values = normalizeAdjustments(adjustments);
  const sizes = exportGeometry(values.geometry, base, { mode: 'original' });
  const spec = warpSpec(sizes.plan, sizes.output, base);
  const warped = warpImage(base, spec.matrix, spec);
  const data = renderAnyImage(warped, deriveParams(values), { nativeWidth: sizes.plan.native.width, nativeHeight: sizes.plan.native.height });
  finishRows(spec, data, 0, spec.height, false);
  const out = { width: spec.width, height: spec.height, data };
  const imageMap = imageMaskMap(sizes.plan, out, base);
  const passes = visibleLocals(values.local).flatMap((local) => localPasses(local, { def: local.mask, map: imageMap }, sizes.output, splitLocalSettings(local.settings)));
  for (const layer of visibleLayers(values.layers)) {
    const mask = maskActive(layer.mask) ? layer.mask : null;
    if (layer.type === 'adjustment') { passes.push(adjustmentPass(layer, null, mask && { def: mask, map: canvasMaskMap(out) })); continue; } // eslint-disable-line no-continue
    assert.equal(layer.type, 'image', 'reference exports need text hidden');
    const raster = rasters[layer.source.sha256];
    assert.deepEqual(rasterSize(layer, out), { width: raster.width, height: raster.height }, 'the layer would be resampled by the browser');
    const matrix = layerMatrix(layer, out, raster);
    passes.push(rasterPass(layer, raster, matrix, out, mask && { def: mask, map: layerMaskMap(matrix, raster) }));
  }
  return compositeImageSync(out, passes);
}

function compare(expected, actual) {
  let max = 0;
  let count = 0;
  const samples = [];
  for (let i = 0; i < expected.data.length; i += 4) {
    if (expected.data[i + 3] === 0 && actual[i + 3] === 0) continue; // eslint-disable-line no-continue
    for (let c = 0; c < 4; c += 1) {
      const d = Math.abs(expected.data[i + c] - actual[i + c]);
      if (d) { count += 1; max = Math.max(max, d); if (samples.length < 6) samples.push([i / 4, c, expected.data[i + c], actual[i + c]]); }
    }
  }
  return { max, count, samples, ok: max === 0 };
}
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

function editDocument(entries) {
  return {
    type: DOCUMENT_TYPE,
    version: DOCUMENT_VERSION,
    savedAt: new Date(0).toISOString(),
    photos: entries.map(({ file, adjustments }) => ({ source: { name: path.basename(file), size: readFileSync(file).length, sha256: sha(file) }, adjustments })),
  };
}

async function parity() {
  const server = await createServer({ root, configFile: path.join(root, 'vite.config.mjs'), server: { port: DEV_PORT, strictPort: true }, logLevel: 'error' });
  await server.listen();
  const results = [];
  try {
    for (const type of [chromium, firefox, webkit]) {
      if (ONLY_RUNS && !ONLY_RUNS.includes(type.name())) continue; // eslint-disable-line no-continue
      const browser = await type.launch();
      try {
        const page = await browser.newPage();
        await page.goto(`http://localhost:${DEV_PORT}/src/editor/dev/layerParity.html`);
        await page.waitForFunction(() => window.layerParityResult, null, { timeout: 180_000 });
        const r = await page.evaluate(() => window.layerParityResult);
        assert.ok(!r.error, r.error);
        const masked = r.results.filter(({ name }) => /masked|local/.test(name));
        const raster = masked.filter(({ name }) => !/^adjust /.test(name));
        const adjust = masked.filter(({ name }) => /^adjust /.test(name));
        const rasterMax = Math.max(...raster.map(({ max }) => max));
        const adjustMax = Math.max(...adjust.map(({ max }) => max));
        results.push({ browser: `${type.name()} ${browser.version()}`, ok: rasterMax <= PASS_PARITY_MAX && adjustMax <= AMPLIFIED_PARITY_MAX, cases: masked.map(({ name, max, mean }) => `${name}: max ${max}, mean ${mean.toFixed(3)}`), rasterPassMax: rasterMax, adjustmentPassMax: adjustMax });
      } finally {
        await browser.close();
      }
    }
  } finally {
    await server.close();
  }
  return results;
}

async function runOne(run, files) {
  const profile = mkdtempSync(path.join(work, 'profile-'));
  const context = await run.type.launchPersistentContext(profile, { ...(run.device ? devices[run.device] : { viewport: { width: 1440, height: 900 } }), acceptDownloads: true });
  if (run.init) await context.addInitScript(INIT[run.init]);
  const page = context.pages()[0] ?? await context.newPage();
  const problems = [];
  const requests = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('crash', () => problems.push('page crashed'));
  page.on('console', (message) => message.type() === 'error' && !/\[photo editor\] (webgl2|image-worker)/.test(message.text()) && problems.push(`console: ${message.text()}`));
  page.on('request', (request) => { if (!request.url().startsWith(`http://localhost:${PORT}/`) && !request.url().startsWith('blob:') && !request.url().startsWith('data:')) requests.push(request.url()); });
  const result = { environment: run.name, browser: `${run.type.name()} ${context.browser()?.version() ?? ''}`.trim() };
  const pointerType = run.device ? 'touch' : 'mouse';
  const tab = async (index) => { if (run.device) await page.click(`.pe-tabs button:nth-child(${index})`); };
  const step = async (name, fn) => { result.step = name; return fn(); };
  const importFiles = async (paths, count) => {
    await tab(1);
    await page.setInputFiles('input[type=file][multiple]', paths);
    await poll(() => page.$$eval('.pe-photo--list', (items) => items.filter((li) => li.dataset.status === 'ready').length), (n) => n >= count, 'imports', 600_000);
  };
  const select = async (name) => {
    await tab(1);
    await page.click(`.pe-photo--list button.pe-photo__select[aria-label^="${name}"]`);
    await poll(() => page.evaluate(() => !document.querySelector('.pe-stage-message') && !document.querySelector('.pe-canvas-host').hidden), Boolean, 'preview', 600_000);
  };
  const saved = async (name) => poll(() => page.evaluate(([key, file]) => JSON.parse(localStorage.getItem(key) ?? 'null')?.photos.find((p) => p.source.name === file)?.adjustments ?? null, [AUTOSAVE_KEY, name]), Boolean, 'autosave', 10_000);
  const savedWhen = async (name, test, label, timeout = 15_000) => poll(() => saved(name), test, label, timeout);
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
  const setValue = async (label, value) => {
    await tab(2);
    const field = page.getByRole('textbox', { name: `${label} value` });
    await field.fill(value);
    await field.press('Enter');
  };
  const newLocal = async (type) => {
    await tab(2);
    await page.locator('.pe-masks__add[aria-label="New local adjustment"] button', { hasText: new RegExp(`^${type}$`) }).click();
    await page.locator('.pe-masktool').waitFor();
  };
  const loadDocument = async (document, name) => {
    const file = path.join(work, `doc-${Date.now()}.json`);
    writeFileSync(file, JSON.stringify(document));
    await page.setInputFiles('input[type=file][accept="application/json,.json"]:not([aria-label])', file);
    return savedWhen(name, (v) => JSON.stringify(v.local ?? []) === JSON.stringify(normalizeAdjustments(document.photos[0].adjustments).local), 'document applied');
  };
  const openDetail = async () => {
    const toggle = page.locator('.pe-panel--adjust .pe-section__toggle', { hasText: /^Detail/ });
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  };
  const twoFrames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  // Stage coordinates of a point of the photo (fractions of the shown output frame).
  const photoPoint = async (u, v) => {
    const host = await page.locator('.pe-canvas-host').boundingBox();
    return { x: host.x + u * host.width, y: host.y + v * host.height };
  };
  const drag = async (from, to, steps = 10, options = {}) => {
    const tool = page.locator('.pe-masktool');
    const moves = [];
    await tool.dispatchEvent('pointerdown', { button: 0, pointerId: 5, clientX: from.x, clientY: from.y, pointerType, ...options });
    for (let k = 1; k <= steps; k += 1) {
      const started = Date.now();
      await tool.dispatchEvent('pointermove', { pointerId: 5, clientX: from.x + ((to.x - from.x) * k) / steps, clientY: from.y + ((to.y - from.y) * k) / steps, pointerType, buttons: 1 });
      await twoFrames();
      moves.push(Date.now() - started);
    }
    await tool.dispatchEvent('pointerup', { pointerId: 5, clientX: to.x, clientY: to.y, pointerType });
    return median(moves);
  };
  const timings = {};
  const rasters = { [files.overSha]: files.over };
  try {
    await step('load and import', async () => {
      await page.goto(URL_EDITOR, { waitUntil: 'load' });
      await page.waitForSelector('.pe[data-engine]', { timeout: 15_000 });
      result.engine = await page.$eval('.pe', (e) => e.dataset.engine);
      if (run.expectEngine) assert.equal(result.engine, run.expectEngine);
      await importFiles([files.baseFile], 1);
      await select('masks-base.png');
    });
    await step('linear gradient dragged on the photo while zoomed and panned lands on the photo, not the screen', async () => {
      await page.keyboard.press('1');
      await page.locator('.pe-zoom button', { hasText: '+' }).click();
      await newLocal('Linear');
      const from = await photoPoint(0.5, 0.1);
      const to = await photoPoint(0.5, 0.55);
      timings.gradientDragFrameMs = await drag(from, to);
      const a = await savedWhen('masks-base.png', (v) => v.local?.[0]?.mask.components.length === 1, 'linear gradient');
      const g = a.local[0].mask.components[0];
      assert.equal(g.type, 'linear');
      assert.ok(Math.abs(g.x0 - 0.5) < 0.01 && Math.abs(g.y0 - 0.1) < 0.01 && Math.abs(g.y1 - 0.55) < 0.01, `gradient at ${JSON.stringify(g)}`);
      await page.keyboard.press('0');
      timings.localSliderMs = Date.now();
      await setValue('Exposure', '-1.2');
      await setValue('Saturation', '35');
      await savedWhen('masks-base.png', (v) => v.local?.[0]?.settings.exposure === -1.2 && v.local[0].settings.saturation === 35, 'local settings');
      timings.localSliderMs = Date.now() - timings.localSliderMs;
      assert.equal((await saved('masks-base.png')).exposure, 0, 'the photo kept its own exposure');
    });
    await step('brush local adjustment: one stroke, compact path data; erase with a second stroke', async () => {
      await newLocal('Brush');
      timings.brushFrameMs = await drag(await photoPoint(0.15, 0.75), await photoPoint(0.85, 0.7), 16);
      await setValue('Temperature', '40');
      await setValue('Shadows', '50');
      await drag(await photoPoint(0.5, 0.72), await photoPoint(0.55, 0.72), 3, { altKey: true });
      const a = await savedWhen('masks-base.png', (v) => v.local?.[1]?.mask.components[0]?.strokes?.length === 2 && v.local[1].settings.shadows === 50, 'brush strokes');
      const [paint, erase] = a.local[1].mask.components[0].strokes;
      result.brush = { points: paint.points.length, bytes: JSON.stringify(a.local[1].mask).length };
      assert.equal(paint.mode, 'add');
      assert.equal(erase.mode, 'erase');
      assert.ok(paint.points.length >= 3 && paint.points.length <= 40, `${paint.points.length} points`);
    });
    await step('radial with Clarity previews on the CPU (draft, then final)', async () => {
      await newLocal('Radial');
      await drag(await photoPoint(0.7, 0.4), await photoPoint(0.85, 0.4), 4);
      await openDetail();
      await setValue('Clarity', '60');
      const started = Date.now();
      await poll(() => page.evaluate(() => document.querySelector('[data-detail-preview]')?.dataset.detailPreview), (q) => q === 'final', 'Detail preview', 120_000);
      timings.localDetailPreviewMs = Date.now() - started;
      await savedWhen('masks-base.png', (v) => v.local?.length === 3 && v.local[2].settings.clarity === 60, 'radial clarity');
    });
    await step('undo and redo of mask edits', async () => {
      await page.locator('.pe-bar__actions button[aria-label=Undo]').click();
      await savedWhen('masks-base.png', (v) => !v.local[2].settings.clarity, 'undo clarity');
      await page.locator('.pe-bar__actions button[aria-label=Undo]').click();
      await savedWhen('masks-base.png', (v) => !v.local[2].mask.components.length, 'undo radial');
      await page.locator('.pe-bar__actions button[aria-label=Redo]').click();
      await page.locator('.pe-bar__actions button[aria-label=Redo]').click();
      await savedWhen('masks-base.png', (v) => v.local[2].settings.clarity === 60 && v.local[2].mask.components.length === 1, 'redo');
    });
    let firstExport;
    await step('PNG export equals the Node reference (gradient, brush, radial with Clarity)', async () => {
      const started = Date.now();
      const download = await exportFile('png');
      timings.exportMs = Date.now() - started;
      firstExport = await readPng(download);
      const expected = reference(files.base, await saved('masks-base.png'));
      const diff = compare(expected, firstExport.data);
      if (!diff.ok && process.env.MASK_DEBUG_DIR) {
        const raw = (image) => sharp(Buffer.from(image.data.buffer ?? image.data), { raw: { width: image.width, height: image.height, channels: 4 } });
        await raw(expected).png().toFile(path.join(process.env.MASK_DEBUG_DIR, `${run.id}-expected.png`));
        await raw(firstExport).png().toFile(path.join(process.env.MASK_DEBUG_DIR, `${run.id}-actual.png`));
        writeFileSync(path.join(process.env.MASK_DEBUG_DIR, `${run.id}-values.json`), JSON.stringify(await saved('masks-base.png')));
      }
      result.exportVsReference = diff;
      assert.ok(diff.ok, `export differs from the reference: ${JSON.stringify(diff)}`);
    });
    await step('save edits, reload, reopen: same masks and the same export', async () => {
      const before = await saved('masks-base.png');
      await tab(3);
      const [edits] = await Promise.all([page.waitForEvent('download'), page.locator('button:visible', { hasText: 'Save edits' }).first().click()]);
      const text = readFileSync(await edits.path(), 'utf8');
      const document = JSON.parse(text);
      assert.equal(document.version, DOCUMENT_VERSION);
      assert.doesNotMatch(text, /base64|data:/);
      result.savedBytes = text.length;
      await page.evaluate(() => localStorage.clear());
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('.pe[data-engine]');
      await importFiles([files.baseFile], 1);
      await select('masks-base.png');
      const after = await loadDocument(document, 'masks-base.png');
      assert.deepEqual(after.local, before.local);
      const diff = compare({ ...firstExport, data: firstExport.data }, (await readPng(await exportFile('png'))).data);
      assert.ok(diff.ok, `reopened export differs: ${JSON.stringify(diff)}`);
    });
    await step('geometry, a masked multiply adjustment layer and a masked image layer: export equals the reference', async () => {
      await tab(2);
      await page.setInputFiles('[data-layer-input]', files.overFile);
      await page.locator('.pe-layer[data-type=image]').waitFor();
      const current = await savedWhen('masks-base.png', (v) => v.layers?.length === 1, 'image layer');
      // A box larger than the source on the cropped canvas, so its raster is the source itself.
      const image = { ...current.layers[0], width: 1, height: 2 / 3, rotation: 12, mask: { base: 'all', components: [createBrush('lb', { strokes: [{ mode: 'add', radius: 0.15, hardness: 0.3, opacity: 1, points: [[0.2, 0.3], [0.8, 0.7]] }], op: 'subtract' })] } };
      const adjustments = {
        ...current,
        geometry: { angle: 4, crop: { x: 0.08, y: 0.1, width: 0.84, height: 0.8 }, stretch: { x: 100, y: 100 } },
        layers: [{ ...createAdjustmentLayer('adj', { contrast: 30, saturation: -50 }), blend: 'multiply', opacity: 0.9, mask: { base: 'none', invert: true, components: [createRadial('ar', { x: 0.4, rx: 0.25, ry: 0.15, rotation: 20 })] } }, image],
        local: [...current.local, createLocalAdjustment('geo', { settings: { exposure: 0.8, highlights: -40 }, mask: { components: [createLinear('gl', { x0: 0.9, y0: 0.5, x1: 0.5, y1: 0.5, feather: 0.3 })] } })],
      };
      await loadDocument(editDocument([{ file: files.baseFile, adjustments }]), 'masks-base.png');
      await poll(() => page.evaluate(() => !document.querySelector('[data-layers-loading]')), Boolean, 'layers', 120_000);
      const values = await saved('masks-base.png');
      assert.equal(values.layers[1].mask.space, 'layer');
      const diff = compare(reference(files.base, values, rasters), (await readPng(await exportFile('png'))).data);
      result.geometryExportVsReference = diff;
      assert.ok(diff.ok, `export differs from the reference: ${JSON.stringify(diff)}`);
    });
    await step('overlay and greyscale mask view; Masks panel keyboard: M toggles the tool, O the overlay', async () => {
      await tab(2);
      await page.locator('.pe-mask-row__name').first().click();
      await poll(() => page.evaluate(() => !document.querySelector('.pe-mask-overlay').hidden), Boolean, 'overlay shown');
      await page.locator('.pe-masks select').filter({ hasText: 'Mask in greyscale' }).selectOption('mask');
      await poll(() => page.evaluate(() => document.querySelector('.pe-mask-overlay').dataset.view), (v) => v === 'mask', 'greyscale view');
      if (!run.device) {
        await page.locator('.pe-stage-area').click({ position: { x: 5, y: 5 } }).catch(() => {});
        await page.keyboard.press('o');
        await poll(() => page.evaluate(() => document.querySelector('.pe-mask-overlay').hidden), Boolean, 'overlay hidden with O');
        const tool = await page.locator('.pe-masktool').getAttribute('data-tool');
        await page.keyboard.press('m');
        assert.notEqual(await page.locator('.pe-masktool').getAttribute('data-tool'), tool);
      }
    });
    if (run.device) {
      await step('phone: touch painting does not pan; no sideways scroll; touch-size handles', async () => {
        await newLocal('Brush');
        const view = await page.locator('.pe-canvas-host').boundingBox();
        await drag(await photoPoint(0.2, 0.5), await photoPoint(0.6, 0.5), 8);
        const after = await page.locator('.pe-canvas-host').boundingBox();
        assert.deepEqual([after.x, after.y], [view.x, view.y], 'the photo panned while painting');
        await savedWhen('masks-base.png', (v) => v.local.at(-1).mask.components[0]?.strokes?.length === 1, 'touch stroke');
        const layout = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          clipped: ['html', 'body'].filter((tag) => getComputedStyle(document.querySelector(tag)).overflow === 'hidden'),
          row: Math.round(document.querySelector('.pe-mask-row__name').getBoundingClientRect().height),
        }));
        await page.locator('.pe-mask-row__name').first().click();
        await page.locator('.pe-mask-handle--move').first().waitFor();
        layout.handle = Math.round((await page.locator('.pe-mask-handle--move').first().boundingBox()).width);
        result.mobile = layout;
        assert.ok(layout.overflow <= 0, `page scrolls sideways by ${layout.overflow}px`);
        assert.deepEqual(layout.clipped, [], 'global overflow: hidden');
        assert.ok(layout.row >= 44 && layout.handle >= 44, `targets ${layout.row}/${layout.handle}px`);
      });
    }
    if (run.large) {
      await step('24 MP photo: gradient and a Clarity radial; full-resolution export', async () => {
        await importFiles([files.largeFile], 2);
        await select('masks-24mp.png');
        const adjustments = { local: [
          createLocalAdjustment('sky', { settings: { exposure: -0.8, dehaze: 20 }, mask: { components: [createLinear('s', { x0: 0.5, y0: 0.05, x1: 0.5, y1: 0.5 })] } }),
          createLocalAdjustment('sub', { settings: { clarity: 40, sharpening: 50, exposure: 0.3 }, mask: { components: [createRadial('r', { x: 0.55, y: 0.6, rx: 0.3, ry: 0.2, rotation: 15 })] } }),
        ] };
        await loadDocument(editDocument([{ file: files.largeFile, adjustments }]), 'masks-24mp.png');
        const stop = sampler(profile);
        const started = Date.now();
        const download = await exportFile(run.large);
        const exportMs = Date.now() - started;
        result.large = { exportMs, peakMb: stop(), format: run.large };
        if (run.large === 'png') {
          const diff = compare(reference(files.large, await saved('masks-24mp.png')), (await readPng(download)).data);
          result.large.vsReference = { max: diff.max, count: diff.count };
          assert.ok(diff.ok, `24 MP export differs (band seams?): ${JSON.stringify(diff)}`);
        } else {
          const meta = await sharp(await download.path()).metadata();
          assert.equal(`${meta.width}×${meta.height}`, '6000×4000');
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
        result.large.afterMb = await memoryMb(profile);
      });
    }
    if (run.genuine && RAW_FILES.length >= 1) {
      const raw = RAW_FILES[0];
      const name = path.basename(raw);
      await step('genuine RAW: sky gradient, radial and brush; pixels outside the masks unchanged', async () => {
        await importFiles([raw], run.large ? 3 : 2);
        await select(name);
        await setValue('Exposure', '0.05');
        const { width, height } = await poll(() => page.evaluate(([key, file]) => JSON.parse(localStorage.getItem(key) ?? 'null')?.photos.find((p) => p.source.name === file)?.source ?? null, [AUTOSAVE_KEY, name]), (s) => s?.width > 1000, 'source size');
        const geometry = run.genuine === 'geometry' ? { angle: -3, crop: { x: 0.05, y: 0.05, width: 0.9, height: 0.85 } } : undefined;
        const local = [
          createLocalAdjustment('sky', { settings: { exposure: -0.7, highlights: -40, temperature: -15 }, mask: { components: [createLinear('s', { x0: 0.5, y0: 0, x1: 0.5, y1: 0.45 })] } }),
          createLocalAdjustment('rad', { settings: { exposure: 0.5, clarity: 25 }, mask: { components: [createRadial('r', { x: 0.5, y: 0.6, rx: 0.2, ry: 0.15 })] } }),
          createLocalAdjustment('br', { settings: { saturation: 40 }, mask: { components: [createBrush('b', { strokes: [{ mode: 'add', radius: 0.04, hardness: 0.6, opacity: 1, points: [[0.1, 0.8], [0.3, 0.85], [0.45, 0.8]] }] })] } }),
        ];
        await loadDocument(editDocument([{ file: raw, adjustments: { geometry, local: local.map((l) => ({ ...l, enabled: false })) } }]), name);
        const plain = await readPng(await exportFile('png'));
        await loadDocument(editDocument([{ file: raw, adjustments: { geometry, local } }]), name);
        const stop = sampler(profile);
        const started = Date.now();
        const masked = await readPng(await exportFile('png'));
        result.genuine = { exportMs: Date.now() - started, peakMb: stop(), size: `${masked.width}×${masked.height}` };
        // Coverage of all three masks at the export's size, in Node: zero coverage means unchanged.
        const values = normalizeAdjustments({ geometry, local });
        const sizes = exportGeometry(values.geometry, { width, height }, { mode: 'original' });
        assert.deepEqual([masked.width, masked.height], [sizes.output.width, sizes.output.height]);
        const map = imageMaskMap(sizes.plan, sizes.output, { width, height });
        const coverage = values.local.map((l) => maskRows(l.mask, map, masked.width, 0, masked.height));
        // Clarity reads neighbours: pixels within its halo of covered ones may differ too.
        let outsideChanged = 0; let insideChanged = 0; let outside = 0;
        const halo = 24;
        const near = new Uint8Array(masked.width * masked.height);
        coverage.forEach((c, k) => { for (let p = 0; p < c.length; p += 1) if (c[p]) near[p] = k === 1 ? 2 : 1; });
        for (let y = 0; y < masked.height; y += 4) {
          for (let x = 0; x < masked.width; x += 4) {
            const p = y * masked.width + x;
            const same = [0, 1, 2].every((c) => plain.data[p * 4 + c] === masked.data[p * 4 + c]);
            if (near[p]) { if (!same) insideChanged += 1; continue; } // eslint-disable-line no-continue
            outside += 1;
            if (!same) outsideChanged += 1;
          }
        }
        Object.assign(result.genuine, { sampledOutside: outside, outsideChanged, insideChanged, halo });
        assert.equal(outsideChanged, 0, 'pixels outside every mask changed');
        assert.ok(insideChanged > 1000, 'the masks changed nothing');
      });
      if (run.genuine === 'full') {
        await step('genuine: masked text layer over the RAW (erase stroke through the text)', async () => {
          await tab(2);
          await page.locator('.pe-layers__add button', { hasText: /^Text$/ }).click();
          await page.getByRole('textbox', { name: 'Text' }).fill('MASKED TEXT');
          await tab(2);
          await page.locator('.pe-masks__layer button', { hasText: /Add mask/ }).click();
          await page.locator('.pe-masks__tools button', { hasText: /^Brush$/ }).click();
          await page.locator('.pe-masks__brush button', { hasText: 'Erase' }).click();
          await drag(await photoPoint(0.3, 0.5), await photoPoint(0.7, 0.5), 6);
          const values = await savedWhen(name, (v) => v.layers?.find((l) => l.type === 'text')?.mask?.components[0]?.strokes?.[0]?.mode === 'erase', 'masked text');
          assert.equal(values.layers.find((l) => l.type === 'text').mask.space, 'canvas');
          const download = await exportFile('jpeg');
          assert.match(download.suggestedFilename(), /-quangedit\.jpg$/);
        });
        if (RAW_FILES.length >= 3) {
          await step('genuine merged RAW HDR with a local sky gradient: export', async () => {
            await tab(1);
            await page.click('.pe-library__actions button:has-text("Merge HDR")');
            await page.waitForSelector('.pe-dialog[role=dialog]');
            await page.setInputFiles('.pe-dialog input[type=file][multiple]', RAW_FILES.slice(0, 3));
            await poll(() => page.$$eval('.pe-bracket__item', (items) => items.map((li) => li.dataset.status)), (s) => s.length === 3 && s.every((v) => v !== 'reading'), 'bracket inputs', 300_000);
            await page.click('.pe-dialog__foot button:has-text("Merge")');
            await page.waitForSelector('.pe-dialog', { state: 'detached', timeout: 600_000 });
            await poll(() => page.evaluate(() => !document.querySelector('.pe-stage-message')), Boolean, 'merged preview', 300_000);
            await newLocal('Linear');
            await drag(await photoPoint(0.5, 0.02), await photoPoint(0.5, 0.4), 4);
            await setValue('Exposure', '-0.6');
            await openDetail();
            await setValue('Dehaze', '15');
            const stop = sampler(profile);
            const started = Date.now();
            const download = await exportFile('jpeg');
            const meta = await sharp(await download.path()).metadata();
            result.hdr = { exportMs: Date.now() - started, peakMb: stop(), size: `${meta.width}×${meta.height}` };
            assert.match(download.suggestedFilename(), /-HDR-quangedit\.jpg$/);
          });
        }
      }
    }
    result.timings = timings;
    assert.deepEqual(requests, [], `unexpected network requests: ${requests.join(', ')}`);
    assert.deepEqual(problems, [], problems.join('\n'));
    result.ok = true;
    delete result.step;
  } catch (error) {
    result.ok = false;
    result.error = error.message.replace(/\s+/g, ' ').slice(0, 700);
    result.problems = problems.slice(0, 5);
    result.timings = timings;
  } finally {
    await context.close();
  }
  return result;
}

async function main() {
  const files = await makeFixtures();
  files.overSha = sha(files.overFile);
  const failures = [];
  if (!process.env.MASK_SKIP_PARITY) {
    for (const item of await parity()) {
      console.log(`${item.ok ? 'ok  ' : 'FAIL'} parity ${JSON.stringify(item)}`);
      if (!item.ok) failures.push(item.browser);
    }
  }
  if (process.env.MASK_PARITY_ONLY) { rmSync(work, { recursive: true, force: true }); if (failures.length) process.exitCode = 1; return; }
  await build({ root, logLevel: 'silent', configFile: path.join(root, 'vite.config.mjs') });
  const server = await preview({ root, configFile: path.join(root, 'vite.config.mjs'), preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
  try {
    for (const run of RUNS.filter(({ id }) => !ONLY_RUNS || ONLY_RUNS.includes(id))) {
      const result = await runOne(run, files);
      console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${result.environment} ${JSON.stringify({ ...result, environment: undefined, ok: undefined })}`);
      if (!result.ok) failures.push(run.id);
    }
  } finally {
    server.httpServer.close();
    rmSync(work, { recursive: true, force: true });
  }
  if (!GENUINE.length) console.log('Genuine photos not checked: set MASK_FIXTURE_DIR to a folder with Sony .ARW and .JPG files.');
  if (failures.length) process.exitCode = 1;
}

await main();
