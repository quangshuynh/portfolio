// Creative and text check of /photography/editor on a production build in Chromium,
// Firefox and WebKit (Playwright builds; WebKit is not Safari on iOS), iPhone 13 and Pixel 7
// emulation (touch) and a forced CPU preview. Each run: a look and the effects set in the
// Creative section, preview timings (GPU frame, glow map), a PNG export compared with the
// Node reference (same renderer), geometry + vignette, text objects added, typed, coloured,
// dragged and rotated, their placement in the preview against two export sizes, Original
// and Split, paste to a second photo (creative copied, text not) and a ZIP whose entry equals
// the single export (deterministic grain). Desktop runs time a 24 MP JPEG with every effect
// (browser memory sampled on Windows). With CREATIVE_FIXTURE_DIR (a folder with three Sony
// .ARW of one scene) Chromium and Firefox also export a genuine RAW with bleach bypass and
// grain, Chromium a merged RAW HDR with bloom and halation, and repeat exports with cancels.
// Usage: npm run check:editor:creative (CHECK_GPU=1: Chromium on the real GPU)
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
import { readZip } from '../src/editor/dev/zipVerify.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'editor-creative-'));
const fixtures = path.join(work, 'fixtures');
mkdirSync(fixtures, { recursive: true });
const PORT = 4189;
const URL_EDITOR = `http://localhost:${PORT}/photography/editor/`;
const ONLY = process.env.EDITOR_ENGINES?.split(',');
const ONLY_RUNS = process.env.CREATIVE_RUNS?.split(',');
const RAW_DIR = process.env.CREATIVE_FIXTURE_DIR ?? '';
const RAW_FILES = RAW_DIR && existsSync(RAW_DIR) ? readdirSync(RAW_DIR).filter((name) => /\.arw$/i.test(name)).sort().map((name) => path.join(RAW_DIR, name)) : [];
const AUTOSAVE_KEY = 'photo-editor:edits:v1';
const MAGENTA = '#ff00ff';

const RUNS = [
  { id: 'chromium', name: 'Chromium, desktop', type: chromium, large: true, raw: true, hdr: true, cycles: true },
  { id: 'firefox', name: 'Firefox, desktop', type: firefox, large: true, raw: true },
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

/** A deterministic photo-like RGBA image: gradients, edges, skin and foliage tones, highlights, a transparent corner. */
function pattern(width, height, { alpha = false } = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const t = x / width;
      const v = 40 + 150 * t + 30 * Math.sin(y / 17) + (rand() - 0.5) * 16;
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
  const small = pattern(600, 400, { alpha: true });
  const smallFile = path.join(fixtures, 'creative-small.png');
  await sharp(Buffer.from(small.data.buffer), { raw: { width: 600, height: 400, channels: 4 } }).png().toFile(smallFile);
  const second = pattern(480, 320);
  const secondFile = path.join(fixtures, 'creative-second.png');
  await sharp(Buffer.from(second.data.buffer), { raw: { width: 480, height: 320, channels: 4 } }).png().toFile(secondFile);
  const large = pattern(6000, 4000);
  const largeFile = path.join(fixtures, 'creative-24mp.jpg');
  await sharp(Buffer.from(large.data.buffer), { raw: { width: 6000, height: 4000, channels: 4 } }).jpeg({ quality: 90 }).toFile(largeFile);
  return { small, smallFile, second, secondFile, largeFile };
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

/** The Node reference of an export: warp, the renderer the settings need (spatial for positional creative effects), coverage. */
function reference(image, adjustments, resize = { mode: 'original' }) {
  const values = normalizeAdjustments(adjustments);
  const sizes = exportGeometry(values.geometry, image, resize);
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

/** Bounding box (normalised to the image) of strongly magenta pixels. */
function magentaBox({ data, width, height }) {
  let [x0, y0, x1, y1, n] = [Infinity, Infinity, -Infinity, -Infinity, 0];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const i = (y * width + x) * 4;
    if (data[i] > 190 && data[i + 1] < 90 && data[i + 2] > 190 && data[i + 3] > 128) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); n += 1;
    }
  }
  if (!n) return null;
  return { cx: (x0 + x1) / 2 / width, cy: (y0 + y1) / 2 / height, w: (x1 - x0) / width, h: (y1 - y0) / height, pixels: n };
}

const close = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

async function runOne(run, files) {
  const profile = mkdtempSync(path.join(work, 'profile-'));
  // CHECK_GPU=1 uses the machine's GPU in Chromium (headless Chromium renders WebGL2 with SwiftShader otherwise).
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
  const setValue = async (label, value) => {
    const field = page.getByRole('textbox', { name: `${label} value`, exact: true });
    await field.scrollIntoViewIfNeeded();
    await field.click();
    await field.fill(String(value));
    await field.press('Enter');
  };
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
    await poll(() => page.evaluate(() => !document.querySelector('.pe-stage-message') && !document.querySelector('.pe-canvas-host').hidden), Boolean, 'preview', 180_000);
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
  // Milliseconds from a slider input until the second animation frame after it.
  const frameAfter = (key, value) => page.evaluate(async ([name, next]) => {
    const input = document.getElementById(`pe-adjust-${name}`);
    const started = performance.now();
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return Math.round(performance.now() - started);
  }, [key, value]);
  // A drag: mouse, or touch pointer events on the phones.
  const drag = async (locator, dx, dy) => {
    const box = await locator.boundingBox();
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
    if (!touch) {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx / 2, y + dy / 2);
      await page.mouse.move(x + dx, y + dy);
      await page.mouse.up();
      return;
    }
    const base = { pointerId: 9, pointerType: 'touch', isPrimary: true, button: 0, bubbles: true };
    await locator.dispatchEvent('pointerdown', { ...base, clientX: x, clientY: y });
    await locator.dispatchEvent('pointermove', { ...base, clientX: x + dx / 2, clientY: y + dy / 2 });
    await locator.dispatchEvent('pointermove', { ...base, clientX: x + dx, clientY: y + dy });
    await locator.dispatchEvent('pointerup', { ...base, clientX: x + dx, clientY: y + dy });
  };
  // Magenta text in the preview (the composited frame), normalised to the output frame.
  const previewTextBox = () => page.evaluate(() => {
    const frame = window.__photoEditorPreview?.read();
    if (!frame) return null;
    const { data, width, height } = frame;
    let [x0, y0, x1, y1, n] = [Infinity, Infinity, -Infinity, -Infinity, 0];
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (data[i] > 190 && data[i + 1] < 90 && data[i + 2] > 190 && data[i + 3] > 128) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); n += 1; }
    }
    if (!n) return null;
    return { cx: (x0 + x1) / 2 / width, cy: (y0 + y1) / 2 / height, w: (x1 - x0) / width, h: (y1 - y0) / height };
  });
  try {
    await step('load', async () => {
      await page.goto(URL_EDITOR, { waitUntil: 'load' });
      await page.waitForSelector('.pe[data-engine]', { timeout: 15_000 });
      result.engine = await page.$eval('.pe', (e) => e.dataset.engine);
      if (run.expectEngine) assert.equal(result.engine, run.expectEngine);
      await importFiles([files.smallFile], 1);
      await select('creative-small.png');
    });
    await step('a look, then every effect; PNG equals the Node reference', async () => {
      await openSection('creative');
      await page.getByRole('button', { name: 'Warm Analog', exact: true }).click();
      await page.waitForSelector('#pe-filter-strength');
      await setValue('Bleach bypass amount', 35);
      await setValue('Bloom amount', 45);
      await setValue('Bloom threshold', 40);
      await setValue('Vignette amount', -45);
      await setValue('Grain amount', 40);
      await setValue('Shadows saturation', 30);
      const settings = await savedWhen('creative-small.png', (a) => a.grainAmount === 40 && a.gradeShadowsSat === 30 && a.bloomAmount === 45, 'creative settings saved');
      result.creative = Object.fromEntries(Object.entries(settings).filter(([key, value]) => value && /bleach|fade|grain|bloom|halation|vignette|grade/.test(key)));
      if (!touch) {
        const marks = () => page.evaluate(() => performance.getEntriesByName('pe-glow-map').length);
        const before = await marks();
        const started = Date.now();
        await setValue('Bloom radius', 60);
        if (result.engine === 'webgl2') await poll(marks, (n) => n > before, 'glow map', 30_000);
        result.timings = {
          grainFrameMs: await frameAfter('grainAmount', 55),
          vignetteFrameMs: await frameAfter('vignetteMidpoint', 40),
          gradingFrameMs: await frameAfter('gradeBalance', 20),
          glowMapMs: result.engine === 'webgl2' ? Date.now() - started : null,
        };
      }
      const final = await savedWhen('creative-small.png', (a) => touch || a.bloomRadius === 60, 'final settings');
      const expected = reference(files.small, final);
      const png = await readPng(await exportFile('png'));
      result.png = { size: `${png.width}×${png.height}`, ...compare(expected, png.data) };
      assert.ok(result.png.max <= 1 && result.png.alphaMismatches === 0, `PNG differs from the reference: ${JSON.stringify(result.png)}`);
    });
    await step('geometry + vignette: centred on the cropped output', async () => {
      await openSection('geometry');
      await setValue('Straighten', 5);
      await page.selectOption('.pe-geometry__ratio select', '1:1');
      const settings = await savedWhen('creative-small.png', (a) => a.geometry?.angle === 5 && a.geometry?.aspect === '1:1', 'geometry saved');
      const expected = reference(files.small, settings);
      const png = await readPng(await exportFile('png'));
      result.geometryPng = { size: `${png.width}×${png.height}`, ...compare(expected, png.data) };
      assert.ok(result.geometryPng.max <= 1, `geometry + creative PNG differs by ${result.geometryPng.max}`);
      // Back to the whole frame for the text placement checks.
      await openSection('geometry');
      await page.getByRole('button', { name: 'Reset Crop & Transform' }).click();
      await savedWhen('creative-small.png', (a) => !a.geometry, 'geometry reset');
    });
    await step('text: add, type, colour, drag and rotate; placement in preview and two export sizes', async () => {
      await openSection('text');
      await page.getByRole('button', { name: 'Add text', exact: true }).click();
      const textarea = page.getByRole('textbox', { name: 'Text', exact: true });
      await textarea.fill('Night market\nĐà Lạt');
      await page.locator('.pe-textpanel input[type=color]').first().fill(MAGENTA);
      await page.getByRole('checkbox', { name: 'Bold' }).uncheck();
      await savedWhen('creative-small.png', (a) => a.layers?.[0]?.color === MAGENTA && a.layers[0].text.startsWith('Night'), 'text saved');
      if (run.device) await tab(2);
      const box = page.locator('.pe-textbox').first();
      await box.waitFor();
      if (run.device) {
        const layout = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          handle: Math.round(document.querySelector('.pe-textbox__handle--scale').getBoundingClientRect().width),
        }));
        result.mobile = layout;
        assert.ok(layout.overflow <= 0, `page scrolls sideways by ${layout.overflow}px`);
        assert.ok(layout.handle >= 44, `text handles are ${layout.handle}px`);
      }
      const hostBefore = await page.evaluate(() => document.querySelector('.pe-canvas-host').style.transform);
      await drag(box, -60, -40);
      const moved = await savedWhen('creative-small.png', (a) => a.layers?.[0] && (a.layers[0].x !== 0.5 || a.layers[0].y !== 0.5), 'text moved');
      // The photo did not pan while the text was dragged.
      assert.equal(await page.evaluate(() => document.querySelector('.pe-canvas-host').style.transform), hostBefore);
      await drag(page.locator('.pe-textbox__handle--rotate'), 40, 0);
      const rotated = await savedWhen('creative-small.png', (a) => a.layers?.[0]?.rotation !== 0, 'text rotated');
      result.text = { x: rotated.layers[0].x, y: rotated.layers[0].y, rotation: rotated.layers[0].rotation, size: rotated.layers[0].size };
      assert.ok(moved.layers[0].x < 0.5 && moved.layers[0].y < 0.5);
      // Second object, behind the first, and keyboard nudges.
      await openSection('text');
      await page.getByRole('button', { name: 'Add text', exact: true }).click();
      await page.getByRole('textbox', { name: 'Text', exact: true }).fill('2026');
      await page.getByRole('checkbox', { name: 'Shadow' }).check();
      await page.getByRole('checkbox', { name: 'Outline' }).check();
      const textBox = page.locator('.pe-textbox[data-selected]');
      await textBox.focus();
      await page.keyboard.press('Shift+ArrowDown');
      await page.keyboard.press('Shift+ArrowDown');
      const two = await savedWhen('creative-small.png', (a) => a.layers?.length === 2 && a.layers[1].y > 0.53, 'second text');
      await page.waitForTimeout(400);
      const previewBox = await poll(previewTextBox, Boolean, 'magenta text in the preview');
      const full = await readPng(await exportFile('png'));
      const exportBox = magentaBox(full);
      await tab(3);
      await page.selectOption('[data-section=export] select', 'long-edge');
      await page.getByRole('spinbutton', { name: 'Long edge' }).fill('300');
      const smallPng = await readPng(await exportFile('png'));
      await page.selectOption('[data-section=export] select', 'original');
      const smallBox = magentaBox(smallPng);
      result.placement = { preview: previewBox, full: exportBox, small: smallBox, smallSize: `${smallPng.width}×${smallPng.height}` };
      assert.ok(exportBox && smallBox, 'text missing from an export');
      for (const other of [previewBox, smallBox]) {
        assert.ok(close(other.cx, exportBox.cx, 0.012) && close(other.cy, exportBox.cy, 0.012), `text centre differs: ${JSON.stringify(result.placement)}`);
        assert.ok(close(other.w, exportBox.w, 0.02) && close(other.h, exportBox.h, 0.02), `text size differs: ${JSON.stringify(result.placement)}`);
      }
      // Pixels away from the text are the photo's own (text never changes the rest).
      const expected = reference(files.small, two);
      let away = 0;
      for (let y = 0; y < 40; y += 1) for (let x = 500; x < 600; x += 1) {
        const i = (y * 600 + x) * 4;
        for (let c = 0; c < 3; c += 1) away = Math.max(away, Math.abs(expected.data[i + c] - full.data[i + c]));
      }
      result.placement.awayMax = away;
      assert.ok(away <= 1, `text export changed pixels away from the text by ${away}`);
    });
    // Regression: WebKit drew the variable Schibsted face at its default weight on a canvas, so
    // bold text was regular at bold spacing. The static faces draw each weight, with the same
    // advances in every engine (Chromium values, 64 px).
    await step('text faces: bold and italic draw at their weight, same advances in every engine', async () => {
      const faces = await page.evaluate(async () => {
        await document.fonts.ready;
        const canvas = Object.assign(document.createElement('canvas'), { width: 900, height: 120 });
        const context = canvas.getContext('2d', { willReadFrequently: true });
        const sample = (font) => {
          context.clearRect(0, 0, 900, 120);
          context.font = `${font} 64px "PE Schibsted Grotesk", sans-serif`;
          context.fillText('Bold Harbour 2026', 10, 90);
          const { data } = context.getImageData(0, 0, 900, 120);
          let ink = 0;
          for (let i = 3; i < data.length; i += 4) ink += data[i];
          return { ink: ink / 255, advance: context.measureText('Bold Harbour 2026').width };
        };
        return Object.fromEntries(['400', '700', 'italic 400', 'italic 700'].map((font) => [font, sample(font)]));
      });
      const advances = { 400: 564.53, 700: 589.97, 'italic 400': 553.85, 'italic 700': 575.47 };
      for (const [font, expected] of Object.entries(advances)) assert.ok(close(faces[font].advance, expected, 0.3), `${font} advance ${faces[font].advance}, expected ${expected}`);
      assert.ok(faces['700'].ink > faces['400'].ink * 1.35, `bold ink ${faces['700'].ink} vs regular ${faces['400'].ink}`);
      assert.ok(faces['italic 700'].ink > faces['italic 400'].ink * 1.35, `bold italic ink ${faces['italic 700'].ink} vs ${faces['italic 400'].ink}`);
      result.textFaces = Object.fromEntries(Object.entries(faces).map(([font, { ink, advance }]) => [font, { ink: Math.round(ink), advance: Number(advance.toFixed(2)) }]));
    });
    await step('Original hides the text, Split keeps it on the edited side; undo restores', async () => {
      if (run.device) return;
      await page.click('.pe-compare button:has-text("Original")');
      await page.waitForTimeout(300);
      assert.equal(await previewTextBox(), null, 'text shown in Original');
      await page.click('.pe-compare button:has-text("Edited")');
      await poll(previewTextBox, Boolean, 'text back in Edited');
      await page.locator('.pe-textbox[data-selected]').focus();
      await page.keyboard.press('Delete');
      await savedWhen('creative-small.png', (a) => a.layers?.length === 1, 'deleted');
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
      await savedWhen('creative-small.png', (a) => a.layers?.length === 2, 'undone');
    });
    await step('paste to a second photo (creative, no text); ZIP entry equals the single export', async () => {
      if (run.device) return;
      await tab(1);
      await page.getByRole('button', { name: 'Copy edits' }).click();
      await importFiles([files.secondFile], 2);
      await select('creative-second.png');
      await page.getByRole('button', { name: /^Paste edits/ }).click();
      const second = await savedWhen('creative-second.png', (a) => a.grainAmount > 0, 'pasted');
      assert.ok(!second.layers?.length, 'text was pasted');
      const single = await readPng(await exportFile('png'));
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
      await tab(1);
      await page.click('.pe-batch__actions button:has-text("Export")');
      const dialog = page.locator('.pe-dialog[role=dialog]');
      await dialog.waitFor();
      await dialog.locator('input[name=pe-batch-output][value=zip]').check();
      await dialog.locator('input[name=pe-batch-format][value=png]').check();
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 300_000 }), dialog.locator('.pe-dialog__foot button.pe-button--primary').click()]);
      const entries = readZip(readFileSync(await download.path()));
      result.zip = entries.map(({ name }) => name);
      const entry = entries.find(({ name }) => name === 'creative-second-quangedit.png');
      const { data } = await sharp(entry.data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.ok(Buffer.compare(Buffer.from(data), Buffer.from(single.data)) === 0, 'ZIP entry differs from the single export');
      const expected = reference(files.second, second);
      result.pastedPng = compare(expected, single.data);
      assert.ok(result.pastedPng.max <= 1, `pasted photo differs from the reference by ${result.pastedPng.max}`);
      await page.locator('.pe-dialog__foot button:has-text("Close")').click();
    });
    if (run.large) {
      await step('24 MP JPEG with every effect and text: preview and full-size export', async () => {
        const measures = { baselineMb: await memoryMb(profile) };
        result.large = measures;
        const count = await page.$$eval('.pe-photo--list', (items) => items.length);
        await importFiles([files.largeFile], count + 1);
        await select('creative-24mp.jpg');
        await openSection('creative');
        await page.getByRole('button', { name: 'Warm Analog', exact: true }).click();
        await setValue('Bloom amount', 50);
        await setValue('Bleach bypass amount', 30);
        measures.grainFrameMs = await frameAfter('grainAmount', 45);
        await openSection('text');
        await page.getByRole('button', { name: 'Add text', exact: true }).click();
        await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Large export');
        await savedWhen('creative-24mp.jpg', (a) => a.layers?.[0]?.text === 'Large export' && a.bloomAmount === 50, 'large settings');
        const stop = sampler(profile);
        const started = Date.now();
        const download = await exportFile('jpeg');
        measures.exportMs = Date.now() - started;
        measures.exportPeakMb = stop();
        const meta = await sharp(await download.path()).metadata();
        measures.exportSize = `${meta.width}×${meta.height}`;
        assert.equal(measures.exportSize, '6000×4000');
        await page.waitForTimeout(1500);
        measures.afterMb = await memoryMb(profile);
      });
    }
    if (run.raw && RAW_FILES.length) {
      await step('genuine RAW: bleach bypass and grain, preview and export', async () => {
        const measures = { file: path.basename(RAW_FILES[0]) };
        result.raw = measures;
        const count = await page.$$eval('.pe-photo--list', (items) => items.length);
        await importFiles([RAW_FILES[0]], count + 1);
        await select(path.basename(RAW_FILES[0]));
        await openSection('creative');
        await setValue('Bleach bypass amount', 70);
        await setValue('Grain amount', 35);
        measures.grainFrameMs = await frameAfter('grainAmount', 40);
        await savedWhen(path.basename(RAW_FILES[0]), (a) => a.bleachAmount === 70, 'RAW settings');
        const stop = sampler(profile);
        const started = Date.now();
        const download = await exportFile('jpeg');
        measures.exportMs = Date.now() - started;
        measures.exportPeakMb = stop();
        const meta = await sharp(await download.path()).metadata();
        measures.exportSize = `${meta.width}×${meta.height}`;
        assert.equal(download.suggestedFilename(), `${path.basename(RAW_FILES[0]).replace(/\.arw$/i, '')}-quangedit.jpg`);
      });
    }
    if (run.hdr && RAW_FILES.length >= 3) {
      await step('merged RAW HDR with bloom and halation: export', async () => {
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
        await openSection('creative');
        const marks = () => page.evaluate(() => performance.getEntriesByName('pe-glow-map').length);
        const before = await marks();
        const started = Date.now();
        await setValue('Bloom amount', 40);
        await setValue('Halation amount', 50);
        await poll(marks, (n) => n > before, 'HDR glow map', 60_000);
        measures.glowMapMs = Date.now() - started;
        const stop = sampler(profile);
        const exportStarted = Date.now();
        const download = await exportFile('jpeg');
        measures.exportMs = Date.now() - exportStarted;
        measures.exportPeakMb = stop();
        const meta = await sharp(await download.path()).metadata();
        measures.exportSize = `${meta.width}×${meta.height}`;
        assert.match(download.suggestedFilename(), /-HDR-quangedit\.jpg$/);
      });
    }
    if (run.cycles && RAW_FILES.length) {
      await step('repeated creative exports with cancels: memory returns, workers end', async () => {
        const measures = { cycles: [] };
        result.cycles = measures;
        await select(path.basename(RAW_FILES[0]));
        for (let cycle = 0; cycle < 3; cycle += 1) {
          await tab(3);
          await page.check('input[name=pe-format][value=jpeg]');
          await page.click('.pe-export-button');
          await page.waitForTimeout(1500);
          await page.locator('.pe-export-progress button:has-text("Cancel")').click().catch(() => {});
          await poll(() => page.evaluate(() => !document.querySelector('.pe-export-progress')), Boolean, 'cancelled', 60_000);
          await page.waitForTimeout(1500);
          measures.cycles.push(await memoryMb(profile));
        }
        const download = await exportFile('jpeg');
        assert.ok(download.suggestedFilename().endsWith('.jpg'));
        await page.waitForTimeout(2000);
        measures.afterMb = await memoryMb(profile);
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
    for (const run of RUNS.filter(({ type, id }) => (!ONLY || ONLY.includes(type.name())) && (!ONLY_RUNS || ONLY_RUNS.includes(id)))) {
      const result = await runOne(run, files);
      results.push(result);
      console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${result.environment} ${JSON.stringify({ ...result, environment: undefined, ok: undefined })}`);
    }
  } finally {
    server.httpServer.close();
    rmSync(work, { recursive: true, force: true });
  }
  if (!RAW_FILES.length) console.log('Genuine RAW and HDR not checked: set CREATIVE_FIXTURE_DIR to a folder with three .ARW files of one scene.');
  if (results.some(({ ok }) => !ok)) process.exitCode = 1;
}

await main();
