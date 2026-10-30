// Watermark check of /photography/editor on a production build in Chromium, Firefox and WebKit
// (Playwright builds; WebKit is not Safari on iOS), iPhone 13 and Pixel 7 emulation and a forced
// CPU preview. Each run enables HUYNH Photography on generated bright, dark and portrait photos
// and checks: the preview overlay's box against the export's (same layout, other resolution);
// a PNG export against one without the mark (every pixel outside the box unchanged, the border
// exactly the source-over blend of charcoal or white at the chosen opacity, no fringe outside it);
// auto colour (charcoal on bright, white on dark) in the preview and the export; undo/redo; a
// square crop (the mark follows the output frame); JPEG and WebP; Sync to the other photos and a
// ZIP with and without watermarks; no request leaves the site. Text ink positions are compared
// across engines (glyph anti-aliasing differs; positions come from a fixed advance table).
// Desktop runs time a 24 MP JPEG export with and without the mark; with WATERMARK_FIXTURE_DIR (a
// folder with Sony .ARW files) Chromium also times a genuine RAW export. WATERMARK_OUT keeps the
// exports and results.json.
// Usage: npm run check:editor:watermark (CHECK_GPU=1: Chromium on the real GPU)
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { build, preview } from 'vite';
import { chromium, devices, firefox, webkit } from 'playwright';
import { DESIGN, WATERMARK_DEFAULTS, layoutWatermark, normalizeWatermark } from '../src/editor/watermark/watermark.mjs';
import { readZip } from '../src/editor/dev/zipVerify.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'editor-watermark-'));
const fixtures = path.join(work, 'fixtures');
mkdirSync(fixtures, { recursive: true });
const OUT = process.env.WATERMARK_OUT ?? '';
if (OUT) mkdirSync(OUT, { recursive: true });
const PORT = 4193;
const URL_EDITOR = `http://localhost:${PORT}/photography/editor/`;
const ONLY = process.env.EDITOR_ENGINES?.split(',');
const RAW_DIR = process.env.WATERMARK_FIXTURE_DIR ?? '';
const RAW_FILE = RAW_DIR && existsSync(RAW_DIR) ? readdirSync(RAW_DIR).filter((name) => /\.arw$/i.test(name)).sort().map((name) => path.join(RAW_DIR, name))[0] : null;
const AUTOSAVE_KEY = 'photo-editor:edits:v1';
// Canvas compositing is 8-bit and premultiplied, with the opacity quantised to 1/255: a border
// pixel may differ from the exact float blend by up to 2 levels.
const BLEND_ALLOWANCE = 2;

const RUNS = [
  { id: 'chromium', name: 'Chromium, desktop', type: chromium, large: true, raw: true },
  { id: 'firefox', name: 'Firefox, desktop', type: firefox, large: true },
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

/** A smooth photo-like image of one brightness, with gentle gradients (no noise: exact comparisons). */
function photo(width, height, level) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const v = level + 18 * Math.sin(x / 300) + 10 * Math.cos(y / 220);
      data[i] = Math.max(0, Math.min(255, Math.round(v + 6)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(v)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(v - 8)));
      data[i + 3] = 255;
    }
  }
  return data;
}

async function makeFixtures() {
  const file = (name) => path.join(fixtures, name);
  await sharp(photo(3000, 2000, 225), { raw: { width: 3000, height: 2000, channels: 4 } }).png().toFile(file('bright.png'));
  await sharp(photo(3000, 2000, 28), { raw: { width: 3000, height: 2000, channels: 4 } }).png().toFile(file('dark.png'));
  await sharp(photo(2000, 3000, 70), { raw: { width: 2000, height: 3000, channels: 4 } }).png().toFile(file('portrait.png'));
  await sharp(photo(6000, 4000, 120), { raw: { width: 6000, height: 4000, channels: 4 } }).jpeg({ quality: 90 }).toFile(file('large-24mp.jpg'));
  return { bright: file('bright.png'), dark: file('dark.png'), portrait: file('portrait.png'), large: file('large-24mp.jpg') };
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

const decode = async (input) => {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
};

/** Bounding box of pixels that differ by more than `threshold` between two images of one size. */
function changedBox(a, b, threshold = 2) {
  let [x0, y0, x1, y1, n] = [Infinity, Infinity, -Infinity, -Infinity, 0];
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      const i = (y * a.width + x) * 4;
      if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > threshold) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); n += 1;
      }
    }
  }
  return n ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0, pixels: n } : null;
}

/** Largest channel difference outside a box (the mark's), and the count of such pixels over 0. */
function outside(a, b, box) {
  let max = 0;
  let count = 0;
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      if (x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height) continue; // eslint-disable-line no-continue
      const i = (y * a.width + x) * 4;
      const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
      if (d) count += 1;
      max = Math.max(max, d);
    }
  }
  return { max, count };
}

/**
 * Border pixels against the exact blend: every pixel of the left stroke's middle third. With
 * the outline, the pixels beside the stroke (outside and inside) are the outline colour's blend
 * at opacity × outline alpha (`outline` the largest difference from it).
 */
function borderCheck(marked, base, layout, hex, opacity) {
  const rgb = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const halo = layout.halo ?? 0;
  const outlineHex = hex === DESIGN.colors.white ? DESIGN.colors.dark : DESIGN.colors.white;
  const outlineRgb = [1, 3, 5].map((i) => Number.parseInt(outlineHex.slice(i, i + 2), 16));
  const outlineOpacity = opacity * DESIGN.outline.alpha;
  let max = 0;
  let fringe = 0;
  let outline = 0;
  const y0 = layout.y + Math.round(layout.height / 3);
  const y1 = layout.y + Math.round((layout.height * 2) / 3);
  for (let y = y0; y < y1; y += 1) {
    for (let x = layout.x; x < layout.x + layout.stroke; x += 1) {
      const i = (y * marked.width + x) * 4;
      for (let c = 0; c < 3; c += 1) max = Math.max(max, Math.abs(marked.data[i + c] - (base.data[i + c] * (1 - opacity) + rgb[c] * opacity)));
    }
    // The pixel just outside what the mark paints, and just inside the stroke when there is no
    // outline (before any text), are untouched.
    for (const x of halo ? [layout.x - halo - 1] : [layout.x - 1, layout.x + layout.stroke]) {
      const i = (y * marked.width + x) * 4;
      for (let c = 0; c < 3; c += 1) fringe = Math.max(fringe, Math.abs(marked.data[i + c] - base.data[i + c]));
    }
    if (halo) {
      for (const x of [layout.x - 1, layout.x + layout.stroke]) {
        const i = (y * marked.width + x) * 4;
        for (let c = 0; c < 3; c += 1) outline = Math.max(outline, Math.abs(marked.data[i + c] - (base.data[i + c] * (1 - outlineOpacity) + outlineRgb[c] * outlineOpacity)));
      }
    }
  }
  return { max: Math.round(max * 10) / 10, fringe, outline: Math.round(outline * 10) / 10 };
}

/** Ink (changed pixels) of each text line inside the mark, as boxes relative to the mark box. */
function inkLines(marked, base, layout) {
  return layout.lines.map((line) => {
    const top = Math.floor(line.baseline - line.px * 1.0);
    const bottom = Math.ceil(line.baseline + line.px * DESIGN.descender + 1);
    const region = { x: layout.x + layout.stroke + 1, y: top, width: layout.width - 2 * layout.stroke - 2, height: bottom - top };
    let [x0, y0, x1, y1, n] = [Infinity, Infinity, -Infinity, -Infinity, 0];
    for (let y = region.y; y < region.y + region.height; y += 1) {
      for (let x = region.x; x < region.x + region.width; x += 1) {
        const i = (y * marked.width + x) * 4;
        if (Math.abs(marked.data[i] - base.data[i]) > 6) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); n += 1; }
      }
    }
    return n ? { id: line.id, left: x0 - layout.x, top: y0 - layout.y, right: x1 - layout.x, bottom: y1 - layout.y, ink: n } : null;
  });
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
  page.on('request', (request) => { if (!/^(http:\/\/localhost:\d+\/|blob:|data:)/.test(request.url())) requests.push(request.url()); });
  const result = { environment: run.name, browser: `${run.type.name()} ${context.browser()?.version() ?? ''}`.trim() };
  const tab = async (index) => { if (run.device) await page.click(`.pe-tabs button:nth-child(${index})`); };
  const step = async (name, fn) => { result.step = name; return fn(); };
  const setValue = async (label, value) => {
    const field = page.getByRole('spinbutton', { name: new RegExp(`^${label} value`) });
    await field.scrollIntoViewIfNeeded();
    await field.fill(String(value));
    await field.press('Enter');
  };
  const openSection = async (id) => {
    await tab(2);
    const toggle = page.locator(`.pe-section[data-section-id=${id}] .pe-section__toggle`);
    await toggle.scrollIntoViewIfNeeded();
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
  const saved = async (name) => page.evaluate(([key, file]) => JSON.parse(localStorage.getItem(key) ?? 'null')?.photos.find((p) => p.source.name === file)?.adjustments ?? null, [AUTOSAVE_KEY, name]);
  const savedWhen = (name, test, label) => poll(() => saved(name), (value) => Boolean(value) && test(value), label, 15_000);
  const setExport = async ({ format, include = true }) => {
    await tab(3);
    await page.check(`input[name=pe-format][value=${format}]`);
    const box = page.getByRole('checkbox', { name: /Include watermark/ }).first();
    if (include) await box.check(); else await box.uncheck();
  };
  const exportFile = async (format, { include = true, keep = null } = {}) => {
    await setExport({ format, include });
    const started = Date.now();
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 900_000 }), page.click('.pe-export-button')]);
    const file = await download.path();
    const ms = Date.now() - started;
    if (OUT && keep) await download.saveAs(path.join(OUT, `${run.id}-${keep}`));
    return { file, ms, name: download.suggestedFilename() };
  };
  // The overlay's box relative to the photo's box on screen, in export pixels.
  const overlayBox = (exportWidth) => page.evaluate((width) => {
    const overlay = document.querySelector('.pe-watermark-overlay');
    if (!overlay || overlay.hidden) return null;
    const host = document.querySelector('.pe-canvas-host').getBoundingClientRect();
    const box = overlay.getBoundingClientRect();
    const k = width / host.width;
    return { x: (box.left - host.left) * k, y: (box.top - host.top) * k, width: box.width * k, height: box.height * k, variant: overlay.dataset.watermark, opacity: Number(getComputedStyle(overlay).opacity) };
  }, exportWidth);

  try {
    await step('load and import', async () => {
      await page.goto(URL_EDITOR, { waitUntil: 'load' });
      await page.waitForSelector('.pe[data-engine]', { timeout: 15_000 });
      result.engine = await page.$eval('.pe', (e) => e.dataset.engine);
      if (run.expectEngine) assert.equal(result.engine, run.expectEngine);
      await importFiles([files.bright, files.dark, files.portrait], 3);
      await select('bright.png');
    });

    let base;
    await step('PNG without a watermark (the reference)', async () => {
      base = await decode((await exportFile('png', { include: false })).file);
      assert.equal(`${base.width}×${base.height}`, '3000×2000');
    });

    await step('enable HUYNH Photography; preview box equals the export layout', async () => {
      await openSection('watermark');
      await page.getByRole('checkbox', { name: /Add the HUYNH Photography watermark/ }).check();
      const adjustments = await savedWhen('bright.png', (a) => a.watermark?.enabled, 'watermark saved');
      assert.deepEqual(adjustments.watermark, { ...WATERMARK_DEFAULTS });
      if (run.device) await tab(1);
      const shown = await poll(() => overlayBox(3000), (box) => box && box.width > 0, 'watermark overlay');
      const layout = layoutWatermark(normalizeWatermark(adjustments.watermark), 3000, 2000);
      // One screen pixel is several export pixels: compare in screen pixels (within 1.5).
      const screenScale = await page.evaluate(() => 3000 / document.querySelector('.pe-canvas-host').getBoundingClientRect().width);
      const offBy = Math.max(...['x', 'y', 'width', 'height'].map((key) => Math.abs(shown[key] - layout.bounds[key]) / screenScale));
      result.preview = { offByScreenPx: Math.round(offBy * 100) / 100, variant: shown.variant, opacity: shown.opacity };
      assert.ok(offBy <= 1.5, `preview box differs from the export layout by ${offBy} screen px`);
      assert.equal(shown.variant, 'white');
      assert.equal(shown.opacity, 0.65);
    });

    await step('PNG with the mark: untouched outside it, exact blend on the border, no fringe', async () => {
      const exported = await exportFile('png', { keep: 'bright-white.png' });
      const marked = await decode(exported.file);
      const layout = layoutWatermark(normalizeWatermark(WATERMARK_DEFAULTS), 3000, 2000);
      const changed = changedBox(marked, base);
      const rest = outside(marked, base, layout.bounds);
      const border = borderCheck(marked, base, layout, DESIGN.colors.white, 0.65);
      result.png = { file: exported.name, changed, layout: { ...layout.bounds, stroke: layout.stroke, halo: layout.halo }, outside: rest, border };
      assert.ok(exported.name.endsWith('-quangedit.png') && !exported.name.includes('-quangedit-quangedit'), exported.name);
      assert.deepEqual([changed.x, changed.y, changed.width, changed.height], [layout.bounds.x, layout.bounds.y, layout.bounds.width, layout.bounds.height]);
      assert.equal(rest.max, 0, 'pixels outside the mark and its outline changed');
      assert.ok(border.max <= BLEND_ALLOWANCE, `border differs from the exact blend by ${border.max}`);
      assert.equal(border.fringe, 0, 'pixels beside the outline changed');
      assert.ok(layout.halo >= 1 && border.outline <= BLEND_ALLOWANCE, `outline beside the border differs from the charcoal blend by ${border.outline}`);
      result.ink = inkLines(marked, base, layout);
      result.ink.forEach((line, i) => {
        const spec = layout.lines[i];
        // The title's band also holds the rules, which start further left.
        const expectLeft = (spec.id === 'title' && layout.rules.length ? layout.rules[0].x : spec.x) - layout.x;
        assert.ok(line && Math.abs(line.left - expectLeft) <= Math.max(2, spec.px * 0.08), `${spec.id} starts at ${line?.left}, expected about ${expectLeft}`);
        assert.ok(Math.abs(line.bottom - (spec.baseline - layout.y)) <= spec.px * DESIGN.descender + 2, `${spec.id} baseline`);
      });
    });

    await step('auto colour: charcoal on a bright photo, white on a dark one; undo and redo', async () => {
      await openSection('watermark');
      await page.locator('input[name=pe-watermark-color][value=auto]').check();
      await savedWhen('bright.png', (a) => a.watermark?.color === 'auto', 'auto saved');
      if (run.device) await tab(1);
      await poll(() => overlayBox(3000), (box) => box?.variant === 'dark', 'auto: charcoal in the preview');
      const marked = await decode((await exportFile('png', { keep: 'bright-auto.png' })).file);
      const layout = layoutWatermark(normalizeWatermark({ ...WATERMARK_DEFAULTS, color: 'auto' }), 3000, 2000);
      result.auto = { bright: borderCheck(marked, base, layout, DESIGN.colors.dark, 0.65) };
      assert.ok(result.auto.bright.max <= BLEND_ALLOWANCE, `auto export is not charcoal (${result.auto.bright.max})`);
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
      await savedWhen('bright.png', (a) => a.watermark?.color === 'white', 'undo to white');
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z');
      await savedWhen('bright.png', (a) => a.watermark?.color === 'auto', 'redo to auto');
    });

    await step('square crop: the mark follows the output frame', async () => {
      await openSection('geometry');
      await page.selectOption('.pe-geometry__ratio select', '1:1');
      const settings = await savedWhen('bright.png', (a) => a.geometry?.aspect === '1:1', 'crop saved');
      const marked = await decode((await exportFile('png', { keep: 'bright-square.png' })).file);
      assert.equal(marked.width, marked.height);
      const layout = layoutWatermark(normalizeWatermark(settings.watermark), marked.width, marked.height);
      // The cropped base: the plain photo has no watermark at the same crop.
      const plain = await decode((await exportFile('png', { include: false })).file);
      const changed = changedBox(marked, plain);
      result.crop = { size: `${marked.width}×${marked.height}`, changed, layout: layout.bounds };
      assert.deepEqual([changed.x, changed.y, changed.width, changed.height], [layout.bounds.x, layout.bounds.y, layout.bounds.width, layout.bounds.height]);
      await openSection('geometry');
      await page.getByRole('button', { name: 'Reset Crop & Transform' }).click();
      await savedWhen('bright.png', (a) => !a.geometry, 'crop reset');
    });

    await step('JPEG and WebP carry the mark in the same box', async () => {
      result.formats = {};
      for (const format of ['jpeg', 'webp']) {
        if (await page.locator(`input[name=pe-format][value=${format}]`).isDisabled()) { result.formats[format] = 'encoder unavailable'; continue; } // eslint-disable-line no-continue
        const marked = await decode((await exportFile(format, { keep: `bright.${format === 'jpeg' ? 'jpg' : 'webp'}` })).file);
        const layout = layoutWatermark(normalizeWatermark({ ...WATERMARK_DEFAULTS, color: 'auto' }), 3000, 2000);
        const border = borderCheck(marked, base, layout, DESIGN.colors.dark, 0.65);
        result.formats[format] = { border: border.max };
        assert.ok(border.max <= 12, `${format}: border off by ${border.max} (compression allowance 12)`);
      }
    });

    await step('Sync the watermark to the dark and portrait photos; ZIP with and without', async () => {
      await tab(1);
      await page.click('.pe-batch button:has-text("Select all")');
      await page.click('.pe-batch button:has-text("Sync")');
      const dialog = page.locator('.pe-dialog[role=dialog]');
      await dialog.waitFor();
      for (const name of ['Light', 'Color', 'HSL', 'Detail', 'Tone curve', 'LUT', 'Creative']) await dialog.getByRole('checkbox', { name, exact: true }).uncheck();
      await dialog.getByRole('checkbox', { name: /^Watermark/ }).check();
      await dialog.locator('.pe-dialog__foot button.pe-button--primary').click();
      await savedWhen('dark.png', (a) => a.watermark?.color === 'auto', 'synced to dark');
      await savedWhen('portrait.png', (a) => a.watermark?.enabled, 'synced to portrait');
      const zip = async (include) => {
        await page.click('.pe-batch__actions button:has-text("Export")');
        await dialog.waitFor();
        await dialog.locator('input[name=pe-batch-output][value=zip]').check();
        await dialog.locator('input[name=pe-batch-format][value=png]').check();
        const box = dialog.getByRole('checkbox', { name: /Include watermark/ });
        if (include) await box.check(); else await box.uncheck();
        const [download] = await Promise.all([page.waitForEvent('download', { timeout: 900_000 }), dialog.locator('.pe-dialog__foot button.pe-button--primary').click()]);
        await poll(() => dialog.locator('[data-batch-outcome]').textContent().catch(() => null), Boolean, 'batch outcome', 900_000);
        const entries = readZip(readFileSync(await download.path()));
        await dialog.locator('.pe-dialog__foot button:has-text("Close")').click();
        return entries;
      };
      const marked = await zip(true);
      const plain = await zip(false);
      const names = marked.map(({ name }) => name).sort();
      assert.deepEqual(names, ['bright-quangedit.png', 'dark-quangedit.png', 'portrait-quangedit.png']);
      result.zip = {};
      for (const { name, data } of marked) {
        const image = await decode(data);
        const other = await decode(plain.find((entry) => entry.name === name).data);
        const layout = layoutWatermark(normalizeWatermark({ ...WATERMARK_DEFAULTS, color: 'auto' }), image.width, image.height);
        const changed = changedBox(image, other);
        const variant = name.startsWith('bright') ? 'dark' : 'white';
        const border = borderCheck(image, other, layout, DESIGN.colors[variant], 0.65);
        result.zip[name] = { size: `${image.width}×${image.height}`, variant, border: border.max, box: changed && [changed.x, changed.y, changed.width, changed.height].join(',') };
        assert.deepEqual([changed.x, changed.y, changed.width, changed.height], [layout.bounds.x, layout.bounds.y, layout.bounds.width, layout.bounds.height], name);
        assert.ok(border.max <= BLEND_ALLOWANCE, `${name}: ${variant} border off by ${border.max}`);
      }
    });

    if (run.large && !run.device) {
      await step('24 MP JPEG: export time with and without the mark', async () => {
        await importFiles([files.large], 4);
        await select('large-24mp.jpg');
        await openSection('watermark');
        await page.getByRole('checkbox', { name: /Add the HUYNH Photography watermark/ }).check();
        await savedWhen('large-24mp.jpg', (a) => a.watermark?.enabled, 'watermark on the large photo');
        const times = { without: [], with: [] };
        for (let i = 0; i < 2; i += 1) {
          times.without.push((await exportFile('jpeg', { include: false })).ms);
          times.with.push((await exportFile('jpeg')).ms);
        }
        const best = (list) => Math.min(...list);
        // The watermark step itself (layout, sprite, composite at 6000 × 4000), measured in the page.
        const steps = await page.evaluate(() => performance.getEntriesByName('pe-watermark').map(({ duration }) => Math.round(duration * 10) / 10));
        result.large = { withoutMs: best(times.without), withMs: best(times.with), watermarkStepMs: steps.slice(-2), runs: times };
      });
    }

    if (run.raw && RAW_FILE) {
      await step('genuine Sony RAW: export time with and without the mark', async () => {
        const name = path.basename(RAW_FILE);
        await importFiles([RAW_FILE], 5);
        await select(name);
        await openSection('watermark');
        await page.getByRole('checkbox', { name: /Add the HUYNH Photography watermark/ }).check();
        await savedWhen(name, (a) => a.watermark?.enabled, 'watermark on the RAW');
        const without = await exportFile('jpeg', { include: false });
        const marked = await exportFile('jpeg', { keep: 'raw.jpg' });
        const step = await page.evaluate(() => performance.getEntriesByName('pe-watermark').at(-1)?.duration);
        result.raw = { file: name, withoutMs: without.ms, withMs: marked.ms, watermarkStepMs: Math.round(step * 10) / 10 };
      });
    }

    result.externalRequests = requests;
    assert.deepEqual(requests, [], 'requests left the site');
    assert.deepEqual(problems, []);
    result.step = 'done';
    result.ok = true;
  } catch (error) {
    result.ok = false;
    result.error = error.message.split('\n')[0];
    result.problems = problems;
    if (OUT) await page.screenshot({ path: path.join(OUT, `${run.id}-failure.png`) }).catch(() => {});
  } finally {
    await context.close();
  }
  return result;
}

const results = [];
let server;
try {
  const files = await makeFixtures();
  await build({ root, logLevel: 'error' });
  server = await preview({ root, preview: { port: PORT, strictPort: true }, logLevel: 'error' });
  for (const run of RUNS.filter(({ id }) => !ONLY || ONLY.includes(id))) {
    const result = await runOne(run, files);
    results.push(result);
    console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${run.name}${result.ok ? '' : `: ${result.step}: ${result.error}`}`);
  }
  // Text: ink of each line across engines (positions are fixed; glyph rasterisation is not).
  const desktop = results.filter((r) => r.ok && r.ink);
  if (desktop.length > 1) {
    const spread = desktop[0].ink.map((line, i) => {
      const values = desktop.map((r) => r.ink[i]);
      const range = (key) => Math.max(...values.map((v) => v[key])) - Math.min(...values.map((v) => v[key]));
      return { id: line.id, left: range('left'), right: range('right'), top: range('top'), bottom: range('bottom'), inkPercent: Math.round((range('ink') / Math.max(...values.map((v) => v.ink))) * 1000) / 10 };
    });
    console.log('text ink spread across environments (export px):', JSON.stringify(spread));
    results.push({ textSpread: spread });
    // Same letters in the same places everywhere; anti-aliasing changes the ink: up to 10% for HUYNH,
    // 15% for the two small lines (about 7–9 px tall here, a few pixels per glyph stroke).
    const off = spread.filter((line) => Math.max(line.left, line.right, line.top, line.bottom) > 1 || line.inkPercent > (line.id === 'name' ? 10 : 15));
    if (off.length) { console.log(`FAIL text differs across environments: ${JSON.stringify(off)}`); process.exitCode = 1; }
  }
  console.log(JSON.stringify(results, null, 2));
  if (OUT) writeFileSync(path.join(OUT, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  if (!results.every((r) => r.ok !== false)) process.exitCode = 1;
} finally {
  await server?.close();
  rmSync(work, { recursive: true, force: true });
}
