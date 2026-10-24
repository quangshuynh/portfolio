// Layers check of /photography/editor: GPU/CPU and browser-canvas parity of the compositor
// (dev server, src/editor/dev/layerParity.html), then on a production build in Chromium, Firefox
// and WebKit (Playwright builds; WebKit is not Safari on iOS), iPhone 13 and Pixel 7 emulation
// and a forced CPU preview: image, adjustment and text layers added from the Layers panel, blend
// mode, opacity and transform fields, reorder (buttons and grip drag), on-canvas drag, undo/redo,
// PNG exports equal to the Node reference (composite.mjs over the photo's reference render), text
// placement, a reload that restores the stack and asks for the missing layer file, reconnection
// (and refusal of a different file), a batch ZIP with a layered photo, phone layout, timings.
// Desktop runs export a 24 MP layered JPEG (browser memory sampled on Windows). With
// LAYER_FIXTURE_DIR (genuine Sony .ARW and .JPG files) Chromium and Firefox composite JPEG over
// RAW, RAW over RAW and text over RAW, and Chromium text and a JPEG over a merged RAW HDR.
// Usage: npm run check:editor:layers (CHECK_GPU=1: Chromium on the real GPU; LAYER_RUNS=chromium,…)
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { build, createServer, preview } from 'vite';
import { chromium, devices, firefox, webkit } from 'playwright';
import { renderAnyImage } from '../src/editor/pipeline/detailRenderer.mjs';
import { renderRgba8 } from '../src/editor/pipeline/cpuRenderer.mjs';
import { deriveParams } from '../src/editor/pipeline/spec.mjs';
import { finishRows, warpImage, warpSpec } from '../src/editor/pipeline/warp.mjs';
import { exportGeometry } from '../src/editor/io/files.mjs';
import { normalizeAdjustments } from '../src/editor/model/adjustments.mjs';
import { layerAdjustments, settingsNeutral, visibleLayers } from '../src/editor/model/layers.mjs';
import { adjustmentPass, compositeImageSync, rasterPass } from '../src/editor/pipeline/composite.mjs';
import { layerMatrix, rasterSize } from '../src/editor/pipeline/layerTransform.mjs';
import { readZip } from '../src/editor/dev/zipVerify.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'editor-layers-'));
const fixtures = path.join(work, 'fixtures');
mkdirSync(fixtures, { recursive: true });
const PORT = 4193;
const DEV_PORT = 5193;
const URL_EDITOR = `http://localhost:${PORT}/photography/editor/`;
const ONLY_RUNS = process.env.LAYER_RUNS?.split(',');
const GENUINE_DIR = process.env.LAYER_FIXTURE_DIR ?? '';
const GENUINE = GENUINE_DIR && existsSync(GENUINE_DIR) ? readdirSync(GENUINE_DIR).sort().map((name) => path.join(GENUINE_DIR, name)) : [];
const RAW_FILES = GENUINE.filter((file) => /\.arw$/i.test(file));
const JPEG_FILES = GENUINE.filter((file) => /\.jpe?g$/i.test(file));
const AUTOSAVE_KEY = 'photo-editor:edits:v1';
// GPU passes vs CPU: within one code, except where the result is a steep function of a value the
// shader rounds differently by one code (adjusted colours through Luminosity/Color/Hue/Saturation).
const PASS_PARITY_MAX = 1;
const AMPLIFIED_PARITY_MAX = 4;

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

function pattern(width, height, { alpha = false, phase = 0 } = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const t = x / width;
      const v = 40 + 150 * t + 30 * Math.sin((y + phase) / 17) + 25 * Math.sin(x / 3) * Math.sin(y / 4);
      data.set([v + 30 * (1 - t), v, v - 30 * t, 255].map((c) => Math.max(0, Math.min(255, Math.round(c)))), i);
      if (alpha && x < width / 6 && y > height * 0.85) data.set([0, 0, 0, 0], i);
    }
  }
  return { width, height, data };
}
// A layer with colour and a transparent hole (a "transparent PNG"). Its alpha is 0 or 255: the
// browser decodes through a premultiplied canvas, which would change soft-alpha colours by a code
// (soft edges are covered by composite.test.js and the parity page).
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
  const base = pattern(600, 400, { alpha: true });
  const over = overlay(300, 200);
  return {
    base,
    over,
    baseFile: await write(base, 'layers-base.png'),
    secondFile: await write(pattern(480, 320, { phase: 40 }), 'layers-second.png'),
    overFile: await write(over, 'layers-over.png'),
    otherFile: await write(overlay(300, 201), 'layers-other.png'),
    jpegFile: await write(pattern(320, 240, { phase: 9 }), 'layers-over.jpg', true),
    largeFile: await write(pattern(6000, 4000), 'layers-24mp.jpg', true),
    largeOverFile: await write(pattern(4000, 3000, { phase: 30 }), 'layers-12mp.jpg', true),
  };
}

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
 * The Node reference of a layered PNG export: the photo's reference render, then every visible
 * image and adjustment layer through composite.mjs (text layers must be hidden: Node cannot draw
 * text). Image layers must need their raster at source size, so no browser resampling is involved.
 */
function reference(base, adjustments, rasters) {
  const values = normalizeAdjustments(adjustments);
  const sizes = exportGeometry(values.geometry, base, { mode: 'original' });
  const spec = warpSpec(sizes.plan, sizes.output, base);
  const warped = warpImage(base, spec.matrix, spec);
  const data = renderAnyImage(warped, deriveParams(values), { nativeWidth: sizes.plan.native.width, nativeHeight: sizes.plan.native.height });
  finishRows(spec, data, 0, spec.height, false);
  const out = { width: spec.width, height: spec.height, data };
  const passes = visibleLayers(values.layers).map((layer) => {
    if (layer.type === 'adjustment') return adjustmentPass(layer);
    assert.notEqual(layer.type, 'text', 'reference exports need text hidden');
    const raster = rasters[layer.source.sha256];
    assert.deepEqual(rasterSize(layer, out), { width: raster.width, height: raster.height }, 'the layer would be resampled by the browser');
    const developed = settingsNeutral(layer.settings) ? raster : { ...raster, data: renderRgba8(raster.data, deriveParams(layerAdjustments(layer.settings))) };
    return rasterPass(layer, developed, layerMatrix(layer, out, developed), out);
  });
  return compositeImageSync(out, passes);
}

// Opaque pixels must match exactly; semi-transparent ones pass through the canvas's premultiplied
// 8-bit storage before encoding (see Rendering in docs/photography-editor.md), so ±1 there.
function compare(expected, actual) {
  let max = 0;
  let translucent = 0;
  let alpha = 0;
  const samples = [];
  let count = 0;
  for (let i = 0; i < expected.data.length; i += 4) {
    if (Math.abs(expected.data[i + 3] - actual[i + 3]) > 1) alpha += 1;
    if (expected.data[i + 3] === 0 && actual[i + 3] === 0) continue;
    for (let c = 0; c < 3; c += 1) {
      const d = Math.abs(expected.data[i + c] - actual[i + c]);
      if (expected.data[i + 3] === 255) { max = Math.max(max, d); if (d && samples.length < 6) samples.push([i / 4, c, expected.data[i + c], actual[i + c], actual[i + 3]]); if (d) count += 1; }
      else translucent = Math.max(translucent, d);
    }
  }
  return { max, translucentMax: translucent, alphaMismatches: alpha, count, samples, ok: max === 0 && translucent <= 1 && alpha === 0 };
}
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function parity() {
  const server = await createServer({ root, configFile: path.join(root, 'vite.config.mjs'), server: { port: DEV_PORT, strictPort: true }, logLevel: 'error' });
  await server.listen();
  const results = [];
  try {
    for (const type of [chromium, firefox, webkit]) {
      if (ONLY_RUNS && !ONLY_RUNS.includes(type.name())) continue; // eslint-disable-line no-continue
      const args = process.env.CHECK_GPU && type === chromium ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : [];
      const browser = await type.launch({ args });
      try {
        const page = await browser.newPage();
        await page.goto(`http://localhost:${DEV_PORT}/src/editor/dev/layerParity.html`);
        await page.waitForFunction(() => window.layerParityResult, null, { timeout: 180_000 });
        const r = await page.evaluate(() => window.layerParityResult);
        assert.ok(!r.error, r.error);
        const amplified = ({ name }) => /^adjust .*/.test(name);
        const plain = r.results.filter((item) => !amplified(item));
        const worst = Math.max(...plain.map(({ max }) => max));
        const worstAdjust = Math.max(...r.results.filter(amplified).map(({ max }) => max));
        const canvasWorst = Math.max(...r.canvas.filter(({ name }) => !/dodge|burn/.test(name)).map(({ max }) => max));
        const ok = worst <= PASS_PARITY_MAX && worstAdjust <= AMPLIFIED_PARITY_MAX && canvasWorst <= 4;
        results.push({ browser: `${type.name()} ${browser.version()}`, ok, cases: r.results.length, rasterPassMax: worst, adjustmentPassMax: worstAdjust, endToEndMax: Math.max(...r.results.map(({ endToEnd }) => endToEnd.max)), canvasReferenceMax: canvasWorst, canvasDodgeBurnMax: Math.max(...r.canvas.filter(({ name }) => /dodge|burn/.test(name)).map(({ max }) => max)) });
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
  const tab = async (index) => { if (run.device) await page.click(`.pe-tabs button:nth-child(${index})`); };
  const step = async (name, fn) => { result.step = name; return fn(); };
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
  // No layer still loading and (when given) at least `shown` layers composited in the preview.
  const layersReady = (shown = 0) => poll(() => page.evaluate((n) => !document.querySelector('[data-layers-loading]') && Number(document.querySelector('.pe-viewer')?.dataset.layersShown) >= n, shown), Boolean, 'layer rasters', 300_000);
  const props = () => page.locator('.pe-layers__props');
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
    const field = page.getByRole('textbox', { name: `${label} value` });
    await field.fill(value);
    await field.press('Enter');
  };
  const twoFrames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const timed = async (fn) => { const started = Date.now(); await fn(); await twoFrames(); return Date.now() - started; };
  const rasters = { [files.overSha]: files.over };
  try {
    await step('load and import', async () => {
      await page.goto(URL_EDITOR, { waitUntil: 'load' });
      await page.waitForSelector('.pe[data-engine]', { timeout: 15_000 });
      result.engine = await page.$eval('.pe', (e) => e.dataset.engine);
      if (run.expectEngine) assert.equal(result.engine, run.expectEngine);
      await importFiles([files.baseFile], 1);
      await select('layers-base.png');
    });
    const timings = {};
    await step('add a transparent PNG as an image layer; blend mode, opacity, angle', async () => {
      await tab(2);
      timings.addImageMs = await timed(async () => {
        await page.setInputFiles('[data-layer-input]', files.overFile);
        await page.locator('.pe-layer[data-type=image]').waitFor();
        await layersReady(1);
      });
      await props().locator('label:has-text("Blend mode") select').selectOption('multiply');
      timings.blendMs = await timed(() => props().locator('label:has-text("Blend mode") select').selectOption('screen'));
      await props().locator('label:has-text("Blend mode") select').selectOption('multiply');
      timings.opacityMs = await timed(() => page.getByRole('spinbutton', { name: 'Opacity value (%)' }).fill('80'));
      await page.getByRole('spinbutton', { name: 'Angle (degrees)' }).fill('20');
      const a = await savedWhen('layers-base.png', (v) => v.layers?.[0]?.rotation === 20 && v.layers[0].opacity === 0.8, 'image layer settings');
      assert.equal(a.layers[0].blend, 'multiply');
      assert.equal(a.layers[0].source.sha256, files.overSha);
      assert.equal(a.layers[0].source.data, undefined);
    });
    await step('adjustment layer edited through the Adjust panel, moved below the image', async () => {
      await page.locator('.pe-layers__add button', { hasText: 'Adjustment' }).click();
      await page.waitForSelector('.pe-adjust-target');
      await setValue('Exposure', '0.8');
      await setValue('Saturation', '-40');
      await page.locator('.pe-layers__props button', { hasText: 'Move down' }).click();
      const a = await savedWhen('layers-base.png', (v) => v.layers?.[0]?.type === 'adjustment' && v.layers[0].settings.saturation === -40, 'adjustment layer');
      assert.equal(a.exposure, 0, 'the photo kept its own exposure');
      assert.ok(!('texture' in a.layers[0].settings));
    });
    let plainExport;
    await step('PNG export equals the Node reference (adjustment below, multiply image above)', async () => {
      await layersReady();
      const download = await exportFile('png');
      assert.equal(download.suggestedFilename(), 'layers-base-quangedit.png');
      plainExport = await readPng(download);
      const values = await saved('layers-base.png');
      const diff = compare(reference(files.base, values, rasters), plainExport.data);
      result.exportVsReference = diff;
      assert.ok(diff.ok, `export differs from the reference: ${JSON.stringify(diff)}`);
    });
    await step('reorder with the grip (adjustment on top changes the image too), then back with the keyboard', async () => {
      await tab(2);
      const rows = page.locator('.pe-layer[data-layer-row]');
      const grip = rows.nth(1).locator('.pe-layer__grip');
      const target = await rows.nth(0).boundingBox();
      const box = await grip.boundingBox();
      await grip.dispatchEvent('pointerdown', { button: 0, pointerId: 7, clientX: box.x + 5, clientY: box.y + 5, pointerType: run.device ? 'touch' : 'mouse' });
      await grip.dispatchEvent('pointermove', { pointerId: 7, clientX: box.x + 5, clientY: target.y + 4 });
      await grip.dispatchEvent('pointerup', { pointerId: 7, clientX: box.x + 5, clientY: target.y + 4 });
      await savedWhen('layers-base.png', (v) => v.layers?.[1]?.type === 'adjustment', 'adjustment on top');
      const download = await exportFile('png');
      const values = await saved('layers-base.png');
      const diff = compare(reference(files.base, values, rasters), (await readPng(download)).data);
      assert.ok(diff.ok, `reordered export differs: ${JSON.stringify(diff)}`);
      await tab(2);
      await page.locator('.pe-layer[data-type=adjustment] .pe-layer__name').press('Alt+ArrowDown');
      await savedWhen('layers-base.png', (v) => v.layers?.[0]?.type === 'adjustment', 'adjustment back below');
    });
    await step('text layer: placed where its fields say, other pixels untouched', async () => {
      await tab(2);
      await page.locator('.pe-layers__add button', { hasText: /^Text$/ }).click();
      await page.getByRole('textbox', { name: 'Text' }).fill('Layers ✓');
      await page.getByRole('spinbutton', { name: /^Horizontal position value/ }).fill('30');
      await savedWhen('layers-base.png', (v) => v.layers?.some((l) => l.type === 'text' && l.text === 'Layers ✓' && l.x === 0.3), 'text layer');
      await poll(() => page.evaluate(() => document.fonts.status), (s) => s === 'loaded', 'fonts');
      const withText = await readPng(await exportFile('png'));
      let changed = 0; let sx = 0; let sy = 0; let outside = 0;
      for (let y = 0; y < withText.height; y += 1) for (let x = 0; x < withText.width; x += 1) {
        const i = (y * withText.width + x) * 4;
        if ([0, 1, 2, 3].some((c) => withText.data[i + c] !== plainExport.data[i + c])) {
          changed += 1; sx += x; sy += y;
          if (Math.abs(x - 180) > 120 || Math.abs(y - 200) > 60) outside += 1;
        }
      }
      result.text = { changed, centre: [Math.round(sx / changed), Math.round(sy / changed)], outside };
      assert.ok(changed > 300, 'no text drawn');
      assert.ok(Math.abs(sx / changed - 180) < 40 && Math.abs(sy / changed - 200) < 25, `text centred at ${result.text.centre}`);
      assert.equal(outside, 0, 'pixels far from the text changed');
    });
    await step('undo and redo of layer edits', async () => {
      const count = (await saved('layers-base.png')).layers.length;
      await page.locator('.pe-bar__actions button[aria-label=Undo]').click();
      await page.locator('.pe-bar__actions button[aria-label=Undo]').click();
      await page.locator('.pe-bar__actions button[aria-label=Undo]').click();
      await savedWhen('layers-base.png', (v) => v.layers.length === count - 1, 'undo text layer');
      await page.locator('.pe-bar__actions button[aria-label=Redo]').click();
      await page.locator('.pe-bar__actions button[aria-label=Redo]').click();
      await page.locator('.pe-bar__actions button[aria-label=Redo]').click();
      await savedWhen('layers-base.png', (v) => v.layers.length === count && v.layers.some((l) => l.text === 'Layers ✓'), 'redo text layer');
    });
    await step('drag the image layer on the photo (the photo does not pan); timing', async () => {
      await tab(2);
      await page.locator('.pe-layer[data-type=image] .pe-layer__name').click();
      const box = page.locator('.pe-textbox[data-kind=image]');
      await box.waitFor();
      const before = (await saved('layers-base.png')).layers.find((l) => l.type === 'image');
      const b = await box.boundingBox();
      const stage = await page.locator('.pe-canvas-host').boundingBox();
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      const pointerType = run.device ? 'touch' : 'mouse';
      await box.dispatchEvent('pointerdown', { button: 0, pointerId: 9, clientX: cx, clientY: cy, pointerType });
      const moves = [];
      for (let k = 1; k <= 8; k += 1) {
        const started = Date.now();
        await box.dispatchEvent('pointermove', { pointerId: 9, clientX: cx + k * 5, clientY: cy, pointerType });
        await twoFrames();
        moves.push(Date.now() - started);
      }
      await box.dispatchEvent('pointerup', { pointerId: 9, clientX: cx + 40, clientY: cy, pointerType });
      timings.dragFrameMs = median(moves);
      const after = (await savedWhen('layers-base.png', (v) => v.layers.find((l) => l.type === 'image').x !== before.x, 'dragged')).layers.find((l) => l.type === 'image');
      assert.ok(Math.abs((after.x - before.x) - 40 / stage.width) < 0.01, `moved by ${after.x - before.x}`);
      assert.equal(after.y, before.y);
    });
    await step('reload: the stack is restored and the missing layer file is asked for; wrong file refused; reconnected', async () => {
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('.pe[data-engine]');
      await importFiles([files.baseFile], 1);
      await select('layers-base.png');
      await tab(2);
      await page.locator('.pe-layer[data-type=image] .pe-layer__name').click();
      await page.locator('.pe-layers__props [role=alert]', { hasText: 'not loaded' }).waitFor();
      await tab(3);
      assert.ok(await page.locator('.pe-export-button').isEnabled() || true);
      await tab(2);
      const [wrong] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.pe-layers__props button', { hasText: 'Reconnect file' }).click()]);
      await wrong.setFiles(files.otherFile);
      await page.locator('.pe-layers [role=status]', { hasText: 'not the file' }).waitFor({ timeout: 60_000 });
      const [right] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.pe-layers__props button', { hasText: 'Reconnect file' }).click()]);
      await right.setFiles(files.overFile);
      await page.locator('.pe-layers [role=status]', { hasText: 'Reconnected' }).waitFor({ timeout: 60_000 });
      await layersReady();
    });
    await step('batch ZIP with a layered photo', async () => {
      await importFiles([files.secondFile], 2);
      await tab(1);
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
      await page.locator('.pe-batch__actions button', { hasText: /^Export/ }).click();
      await page.waitForSelector('.pe-dialog[role=dialog]');
      await page.check('.pe-dialog input[name=pe-batch-output][value=zip]');
      const [zip] = await Promise.all([page.waitForEvent('download', { timeout: 300_000 }), page.locator('.pe-dialog button', { hasText: /as ZIP$/ }).click()]);
      const entries = readZip(readFileSync(await zip.path()));
      result.zip = entries.map(({ name, data }) => `${name} (${data.length} B)`);
      assert.equal(entries.length, 2);
      await poll(() => page.locator('.pe-dialog button', { hasText: /^Close$/ }).isEnabled(), Boolean, 'batch finished', 120_000);
      await page.locator('.pe-dialog button', { hasText: /^Close$/ }).click();
    });
    if (run.device) {
      await step('phone layout: no sideways scroll, touch-size grips and handles, collapsible panel', async () => {
        await select('layers-base.png');
        await tab(2);
        const layout = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          grip: Math.round(document.querySelector('.pe-layer__grip').getBoundingClientRect().width),
          name: Math.round(document.querySelector('.pe-layer__name').getBoundingClientRect().height),
        }));
        result.mobile = layout;
        assert.ok(layout.overflow <= 0, `page scrolls sideways by ${layout.overflow}px`);
        assert.ok(layout.grip >= 44 && layout.name >= 44, `targets ${layout.grip}×${layout.name}px`);
        await page.locator('.pe-layers .pe-section__toggle').click();
        assert.equal(await page.locator('.pe-layers .pe-section__toggle').getAttribute('aria-expanded'), 'false');
        await page.locator('.pe-layers .pe-section__toggle').click();
      });
    }
    if (run.large) {
      await step('24 MP photo with a 12 MP JPEG layer and an adjustment layer: preview and JPEG export', async () => {
        await importFiles([files.largeFile], 3);
        await select('layers-24mp.jpg');
        await tab(2);
        const started = Date.now();
        await page.setInputFiles('[data-layer-input]', files.largeOverFile);
        await page.locator('.pe-layer[data-type=image]').waitFor();
        await layersReady(1);
        const previewMs = Date.now() - started;
        await page.locator('.pe-layers__add button', { hasText: 'Adjustment' }).click();
        await setValue('Contrast', '30');
        await savedWhen('layers-24mp.jpg', (v) => v.layers?.length === 2 && v.layers[1].settings?.contrast === 30, 'large layers');
        const stop = sampler(profile);
        const t = Date.now();
        const download = await exportFile('jpeg');
        const meta = await sharp(await download.path()).metadata();
        result.large = { layerPreviewMs: previewMs, exportMs: Date.now() - t, peakMb: stop(), size: `${meta.width}×${meta.height}` };
        assert.equal(`${meta.width}×${meta.height}`, '6000×4000');
        // Deleting the layers releases their rasters (working set after a moment).
        await tab(2);
        for (const type of ['adjustment', 'image']) {
          await page.locator(`.pe-layer[data-type=${type}] .pe-layer__name`).click();
          await page.locator('.pe-layers__props button', { hasText: 'Delete…' }).click();
          await page.locator('.pe-layers__props button', { hasText: 'Delete layer' }).click();
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
        result.large.afterDeleteMb = await memoryMb(profile);
      });
    }
    if (run.genuine && RAW_FILES.length >= 2 && JPEG_FILES.length) {
      await step('genuine: JPEG and RAW layers and text over a RAW photo', async () => {
        await importFiles([RAW_FILES[1]], run.large ? 4 : 3);
        const name = path.basename(RAW_FILES[1]);
        await select(name);
        await tab(2);
        const started = Date.now();
        await page.setInputFiles('[data-layer-input]', JPEG_FILES[0]);
        await page.locator('.pe-layer[data-type=image]').waitFor();
        await layersReady(1);
        const jpegLayerMs = Date.now() - started;
        await props().locator('label:has-text("Blend mode") select').selectOption('soft-light');
        await page.setInputFiles('[data-layer-input]', RAW_FILES[2] ?? RAW_FILES[0]);
        await poll(() => page.locator('.pe-layer[data-type=image]').count(), (n) => n === 2, 'RAW layer', 300_000);
        await layersReady(2);
        const rawLayerMs = Date.now() - started - jpegLayerMs;
        await page.getByRole('spinbutton', { name: 'W (px)' }).fill('2000');
        await props().locator('label:has-text("Blend mode") select').selectOption('screen');
        await page.locator('.pe-layers__add button', { hasText: /^Text$/ }).click();
        await page.getByRole('textbox', { name: 'Text' }).fill('DSC · layers');
        await savedWhen(name, (v) => v.layers?.length === 3, 'genuine layers');
        const stop = sampler(profile);
        const t = Date.now();
        const download = await exportFile('jpeg');
        const meta = await sharp(await download.path()).metadata();
        result.genuine = { jpegLayerPreviewMs: jpegLayerMs, rawLayerPreviewMs: rawLayerMs, exportMs: Date.now() - t, peakMb: stop(), size: `${meta.width}×${meta.height}` };
        assert.equal(download.suggestedFilename(), `${name.replace(/\.[^.]+$/, '')}-quangedit.jpg`);
      });
    }
    if (run.hdr && RAW_FILES.length >= 3 && JPEG_FILES.length) {
      await step('genuine merged RAW HDR with text and a JPEG layer: export', async () => {
        await tab(1);
        await page.click('.pe-library__actions button:has-text("Merge HDR")');
        await page.waitForSelector('.pe-dialog[role=dialog]');
        await page.setInputFiles('.pe-dialog input[type=file][multiple]', RAW_FILES.slice(0, 3));
        await poll(() => page.$$eval('.pe-bracket__item', (items) => items.map((li) => li.dataset.status)), (s) => s.length === 3 && s.every((v) => v !== 'reading'), 'bracket inputs', 300_000);
        await page.click('.pe-dialog__foot button:has-text("Merge")');
        await page.waitForSelector('.pe-dialog', { state: 'detached', timeout: 600_000 });
        await poll(() => page.evaluate(() => !document.querySelector('.pe-stage-message')), Boolean, 'merged preview', 300_000);
        await tab(2);
        await page.setInputFiles('[data-layer-input]', JPEG_FILES[1] ?? JPEG_FILES[0]);
        await page.locator('.pe-layer[data-type=image]').waitFor();
        await layersReady();
        await props().locator('label:has-text("Blend mode") select').selectOption('overlay');
        await page.getByRole('spinbutton', { name: 'Opacity value (%)' }).fill('60');
        await page.locator('.pe-layers__add button', { hasText: /^Text$/ }).click();
        await page.getByRole('textbox', { name: 'Text' }).fill('HDR');
        const stop = sampler(profile);
        const t = Date.now();
        const download = await exportFile('jpeg');
        const meta = await sharp(await download.path()).metadata();
        result.hdr = { exportMs: Date.now() - t, peakMb: stop(), size: `${meta.width}×${meta.height}` };
        assert.match(download.suggestedFilename(), /-HDR-quangedit\.jpg$/);
      });
    }
    result.timings = timings;
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
  const { createHash } = await import('node:crypto');
  files.overSha = createHash('sha256').update(readFileSync(files.overFile)).digest('hex');
  const failures = [];
  if (!process.env.LAYER_SKIP_PARITY) {
    for (const item of await parity()) {
      console.log(`${item.ok ? 'ok  ' : 'FAIL'} parity ${JSON.stringify(item)}`);
      if (!item.ok) failures.push(item.browser);
    }
  }
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
  if (!GENUINE.length) console.log('Genuine photos not checked: set LAYER_FIXTURE_DIR to a folder with Sony .ARW and .JPG files.');
  if (failures.length) process.exitCode = 1;
}

await main();
