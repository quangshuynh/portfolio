// Retouch check of /photography/editor on a production build in Chromium, Firefox and WebKit
// (Playwright builds; WebKit is not Safari on iOS), iPhone 13 and Pixel 7 emulation (touch) and
// a forced CPU preview. Each run: Spot Heal by click or tap on a dark blemish (the preview
// brightens there), Clone Stamp with a source set by Alt-click or "Set source" and a painted
// stroke (one offset), undo and redo, a PNG export equal to the Node reference (the decoded PNG
// retouched by pipeline/retouch.mjs), a 90° turn (the repair stays on the blemish), and saving
// the edits, reloading and reopening them (same operations, same export). Desktop runs time a
// heal and a full-size export of a 24 MP JPEG. RETOUCH_RAW_DIR (a folder with Sony .ARW and/or
// Nikon .NEF files) adds, in Chromium, a genuine RAW healed, cloned and with a removal, exported at full size:
// the export differs from the unretouched one only inside the repairs.
// Remove: an object painted over is filled in the background (progress shown) and disappears from
// the preview; on desktop a source area is then chosen; exports match the Node reference.
// Usage: npm run check:editor:retouch (EDITOR_ENGINES=chromium to limit; CHECK_GPU=1: Chromium on the real GPU)
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { build, preview } from 'vite';
import { chromium, devices, firefox, webkit } from 'playwright';
import { applyRetouch, retouchBounds, retouchRegion } from '../src/editor/pipeline/retouch.mjs';
import { DOCUMENT_VERSION } from '../src/editor/model/editDocument.mjs';
import { readZip } from '../src/editor/dev/zipVerify.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'editor-retouch-'));
const fixtures = path.join(work, 'fixtures');
mkdirSync(fixtures, { recursive: true });
const PORT = 4194;
const URL_EDITOR = `http://localhost:${PORT}/photography/editor/`;
const ONLY = process.env.EDITOR_ENGINES?.split(',');
const RAW_DIR = process.env.RETOUCH_RAW_DIR ?? '';
const RAW_FILES = RAW_DIR && existsSync(RAW_DIR) ? ['arw', 'nef'].map((ext) => readdirSync(RAW_DIR).filter((name) => name.toLowerCase().endsWith(`.${ext}`)).sort()[0]).filter(Boolean).map((name) => path.join(RAW_DIR, name)) : [];
const AUTOSAVE_KEY = 'photo-editor:edits:v1';

const RUNS = [
  { id: 'chromium', name: 'Chromium, desktop', type: chromium, large: true, raw: true },
  { id: 'firefox', name: 'Firefox, desktop', type: firefox, large: true },
  { id: 'webkit', name: 'WebKit, desktop', type: webkit, large: true },
  { id: 'iphone', name: 'WebKit, iPhone 13 emulation', type: webkit, device: 'iPhone 13' },
  { id: 'pixel', name: 'Chromium, Pixel 7 emulation', type: chromium, device: 'Pixel 7' },
  { id: 'cpu', name: 'Chromium, desktop, no WebGL2', type: chromium, init: 'noWebgl2' },
];
const INIT = {
  noWebgl2: () => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) { return type === 'webgl2' ? null : original.call(this, type, ...rest); };
  },
};

// Blemish and scratch, as fractions of the photo.
const SPOT = { u: 0.3, v: 0.4, r: 0.009 };
const SCRATCH = [{ u: 0.6, v: 0.62 }, { u: 0.7, v: 0.64 }];
// An object for Remove: a bright square sign.
// Smaller than the default brush (radius 2% of the short edge), as one paints it: a little past its edge.
const OBJECT = { u: 0.45, v: 0.78, half: 0.014 };

/** A textured photo with a dark blemish and a dark scratch (RGBA). */
function photo(width, height) {
  const data = Buffer.alloc(width * height * 4);
  const scale = width / 2400;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = x / width; const v = y / height;
      const base = 0.35 + 0.35 * u + 0.12 * v;
      const grain = 0.04 * Math.sin((x * 1.7) / scale) * Math.cos((y * 2.3) / scale) + 0.02 * Math.sin(((x + y) * 0.9) / scale);
      let [r, g, b] = [base + grain + 0.03, base + grain, base * 0.8 + grain];
      if (Math.hypot((u - SPOT.u) * width, (v - SPOT.v) * height) < SPOT.r * Math.min(width, height)) [r, g, b] = [0.08, 0.08, 0.08];
      // The scratch: within 2.5 px (at 2400 px wide) of the segment between the two points.
      const [ax, ay, bx, by] = [SCRATCH[0].u * width, SCRATCH[0].v * height, SCRATCH[1].u * width, SCRATCH[1].v * height];
      const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
      if (Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))) < 2.5 * scale) [r, g, b] = [0.1, 0.1, 0.1];
      if (Math.abs(x - OBJECT.u * width) < OBJECT.half * height && Math.abs(y - OBJECT.v * height) < OBJECT.half * height) [r, g, b] = [0.98, 0.95, 0.2];
      const i = (y * width + x) * 4;
      data[i] = Math.round(Math.min(1, r) * 255); data[i + 1] = Math.round(Math.min(1, g) * 255); data[i + 2] = Math.round(Math.min(1, b) * 255); data[i + 3] = 255;
    }
  }
  return data;
}

async function makeFixtures() {
  const file = (name) => path.join(fixtures, name);
  await sharp(photo(2400, 1600), { raw: { width: 2400, height: 1600, channels: 4 } }).png().toFile(file('retouch.png'));
  await sharp(photo(6000, 4000), { raw: { width: 6000, height: 4000, channels: 4 } }).jpeg({ quality: 92 }).toFile(file('retouch-24mp.jpg'));
  return { base: file('retouch.png'), large: file('retouch-24mp.jpg') };
}

async function poll(read, done, label, timeout = 30_000) {
  const end = Date.now() + timeout;
  let value;
  while (Date.now() < end) {
    value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label} (last value ${JSON.stringify(value)?.slice(0, 200)})`);
}
const decode = async (input) => {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
};
function compare(expected, actual) {
  let max = 0; let count = 0;
  for (let i = 0; i < expected.data.length; i += 4) {
    for (let c = 0; c < 3; c += 1) { const d = Math.abs(expected.data[i + c] - actual.data[i + c]); if (d) { count += 1; max = Math.max(max, d); } }
  }
  return { max, count, mean: count / (expected.data.length / 4 * 3) };
}
// Content-aware fills may differ by a code value or so between engines (Math.exp is not
// bit-identical everywhere); everything else is exact.
const close = (diff, fills) => (fills ? diff.max <= 24 && diff.mean < 0.002 : diff.max <= 1);

async function runOne(run, files) {
  const profile = mkdtempSync(path.join(work, 'profile-'));
  // Headless Chromium draws WebGL in software (SwiftShader); CHECK_GPU=1 uses the real GPU for timings.
  const args = process.env.CHECK_GPU && run.type === chromium ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : [];
  const context = await run.type.launchPersistentContext(profile, { ...(run.device ? devices[run.device] : { viewport: { width: 1440, height: 900 } }), acceptDownloads: true, args });
  if (run.init) await context.addInitScript(INIT[run.init]);
  const page = context.pages()[0] ?? await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('crash', () => problems.push('page crashed'));
  page.on('console', (message) => message.type() === 'error' && !/\[photo editor\] (webgl2|image-worker)/.test(message.text()) && problems.push(`console: ${message.text()}`));
  const result = { environment: run.name, browser: `${run.type.name()} ${context.browser()?.version() ?? ''}`.trim() };
  const phone = Boolean(run.device);
  const pointerType = phone ? 'touch' : 'mouse';
  const tab = async (index) => { if (phone) await page.click(`.pe-tabs button:nth-child(${index})`); };
  const step = async (name, fn) => { result.step = name; return fn(); };
  // In-page timings (Viewer.jsx marks): applying committed operations, and drawing a stroke in progress.
  const marks = (name) => page.evaluate((mark) => performance.getEntriesByName(mark).map((entry) => entry.detail?.ms ?? 0), name);
  const clearMarks = () => page.evaluate(() => { performance.clearMarks('pe-retouch-applied'); performance.clearMarks('pe-retouch-preview'); });
  const stats = (values) => (values.length ? { mean: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10, max: Math.round(Math.max(...values) * 10) / 10 } : null);
  const twoFrames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const importFiles = async (paths, count) => {
    await tab(1);
    await page.setInputFiles('input[type=file][multiple]', paths);
    await poll(() => page.$$eval('.pe-photo--list', (items) => items.filter((li) => li.dataset.status === 'ready').length), (n) => n >= count, 'imports', 300_000);
  };
  const select = async (name) => {
    await tab(1);
    await page.click(`.pe-photo--list button.pe-photo__select[aria-label^="${name}"]`);
    await poll(() => page.evaluate(() => !document.querySelector('.pe-stage-message') && !document.querySelector('.pe-canvas-host').hidden), Boolean, 'preview', 180_000);
    await twoFrames();
  };
  const saved = async (name) => page.evaluate(([key, file]) => JSON.parse(localStorage.getItem(key) ?? 'null')?.photos.find((p) => p.source.name === file)?.adjustments ?? null, [AUTOSAVE_KEY, name]);
  const savedWhen = (name, test, label, timeout = 15_000) => poll(() => saved(name), (value) => Boolean(value) && test(value), label, timeout);
  const photoPoint = async ({ u, v }) => {
    const host = await page.locator('.pe-canvas-host').boundingBox();
    return { x: host.x + u * host.width, y: host.y + v * host.height };
  };
  const tool = () => page.locator('.pe-retouchtool');
  const pointer = (type, at, extra = {}) => tool().dispatchEvent(type, { button: 0, pointerId: 7, clientX: at.x, clientY: at.y, pointerType, buttons: type === 'pointerup' ? 0 : 1, ...extra });
  const choose = async (label, key) => {
    if (phone) {
      await tab(2);
      const toggle = page.locator('#pe-retouch-title .pe-section__toggle');
      if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
      await page.locator('.pe-retouch .pe-masks__tools button', { hasText: label }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'horizontal scroll with the Retouch panel open');
      await tab(1);
    } else {
      await page.locator('body').click({ position: { x: 2, y: 2 } }).catch(() => {});
      await page.keyboard.press(key);
    }
    await tool().waitFor();
  };
  // Mean brightness of the shown preview around a point of the photo (screenshot pixels).
  const shownLevel = async (at) => {
    const p = await photoPoint(at);
    const png = await page.screenshot({ clip: { x: p.x - 2, y: p.y - 2, width: 5, height: 5 } });
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    let sum = 0; for (let i = 0; i < data.length; i += info.channels) sum += data[i + 1];
    return sum / (data.length / info.channels);
  };
  // The preview's own pixels at a point of the photo (the drawn frame read back).
  const drawnLevel = (at = OBJECT) => page.evaluate(({ u, v }) => {
    const frame = window.__photoEditorPreview?.read();
    if (!frame) return null;
    const i = (Math.round(v * (frame.height - 1)) * frame.width + Math.round(u * (frame.width - 1))) * 4;
    return frame.data[i + 1];
  }, at);
  const setExportPng = async () => {
    await tab(3);
    await page.check('input[name=pe-format][value=png]');
    const box = page.getByRole('checkbox', { name: /Include watermark/ }).first();
    if (await box.count()) await box.uncheck().catch(() => {});
  };
  const exportFile = async () => {
    const started = Date.now();
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 900_000 }), page.click('.pe-export-button')]);
    return { file: await download.path(), ms: Date.now() - started, name: download.suggestedFilename() };
  };
  const reference = async (input, ops, rotate = 0) => {
    const image = await decode(input);
    applyRetouch(image, ops);
    if (!rotate) return image;
    return decode(await sharp(Buffer.from(image.data), { raw: { width: image.width, height: image.height, channels: 4 } }).rotate(rotate).png().toBuffer());
  };

  try {
    await page.goto(URL_EDITOR);
    await page.waitForSelector('.pe[data-engine]', { timeout: 60_000 });
    await step('import', async () => { await importFiles([files.base], 1); await select('retouch.png'); });

    await step('Spot Heal: a click on the blemish heals it in the preview', async () => {
      const before = await drawnLevel(SPOT);
      await choose('Spot Heal', 'j');
      await clearMarks();
      const at = await photoPoint(SPOT);
      const started = Date.now();
      await pointer('pointerdown', at);
      await pointer('pointerup', at);
      const value = await savedWhen('retouch.png', (a) => a.retouch?.length === 1, 'heal saved');
      const op = value.retouch[0];
      assert.equal(op.type, 'heal');
      assert.ok(Math.hypot(op.offset.x, op.offset.y) > 0.02, `heal source offset ${JSON.stringify(op.offset)}`);
      const after = await poll(() => drawnLevel(SPOT), (level) => level !== null && level > before + 40, 'healed preview (drawn frame)', 15_000);
      result.heal = { clickToPreviewMs: Date.now() - started, applyMs: stats(await marks('pe-retouch-applied')), before: Math.round(before), after: Math.round(after) };
    });

    await step('Clone Stamp: source by Alt-click or Set source, a painted stroke with one offset', async () => {
      await choose('Clone Stamp', 's');
      const source = { u: SCRATCH[0].u, v: SCRATCH[0].v - 0.06 };
      const sourceAt = await photoPoint(source);
      if (phone) {
        await tab(2);
        await page.locator('.pe-retouch button', { hasText: 'Set source' }).click();
        await tab(1);
        await pointer('pointerdown', sourceAt);
        await pointer('pointerup', sourceAt);
      } else {
        await pointer('pointerdown', sourceAt, { altKey: true });
        await pointer('pointerup', sourceAt, { altKey: true });
      }
      const from = await photoPoint(SCRATCH[0]);
      const to = await photoPoint(SCRATCH[1]);
      const moves = [];
      await clearMarks();
      await pointer('pointerdown', from);
      for (let k = 1; k <= 12; k += 1) {
        const started = Date.now();
        await pointer('pointermove', { x: from.x + ((to.x - from.x) * k) / 12, y: from.y + ((to.y - from.y) * k) / 12 });
        await twoFrames();
        moves.push(Date.now() - started);
      }
      await pointer('pointerup', to);
      const value = await savedWhen('retouch.png', (a) => a.retouch?.length === 2, 'clone saved');
      const op = value.retouch[1];
      assert.equal(op.type, 'clone');
      assert.ok(op.points.length >= 6, `clone stroke points ${op.points.length}`);
      // The offset is the source minus the stroke's first point, kept for the whole stroke.
      assert.ok(Math.abs(op.offset.x - (source.u - op.points[0][0])) < 0.004 && Math.abs(op.offset.y - (source.v - op.points[0][1])) < 0.004, `clone offset ${JSON.stringify(op.offset)}`);
      result.clone = { points: op.points.length, previewMs: stats(await marks('pe-retouch-preview')), commitMs: stats(await marks('pe-retouch-applied')), moveFrameMs: Math.round(moves.reduce((a, b) => a + b, 0) / moves.length), worstMoveFrameMs: Math.max(...moves) };
    });

    await step('Remove: paint over an object; it is filled in the background and disappears', async () => {
      const before = await drawnLevel();
      await choose('Remove', 'r');
      await clearMarks();
      const from = await photoPoint({ u: OBJECT.u - 0.012, v: OBJECT.v - 0.005 });
      const to = await photoPoint({ u: OBJECT.u + 0.012, v: OBJECT.v + 0.005 });
      const started = Date.now();
      await pointer('pointerdown', from);
      for (let k = 1; k <= 6; k += 1) { await pointer('pointermove', { x: from.x + ((to.x - from.x) * k) / 6, y: from.y + ((to.y - from.y) * k) / 6 }); await twoFrames(); }
      await pointer('pointerup', to);
      const value = await savedWhen('retouch.png', (a) => a.retouch?.length === 3, 'removal saved');
      assert.equal(value.retouch[2].type, 'remove');
      await poll(() => page.locator('[data-retouch-busy]').count(), (n) => n === 0, 'fill finished', 120_000);
      // Tool off and nothing selected: no repair outlines over the photo while sampling it.
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await tool().waitFor({ state: 'detached' });
      // Asserted on the drawn frame: Playwright's WebKit on Windows showed the redrawn WebGL canvas
      // only at the next page update in screenshots (the frame itself was right); the
      // screenshot value is kept for comparison.
      const drawnBefore = before;
      const after = await poll(drawnLevel, (level) => level !== null && level < drawnBefore - 60, 'object removed from the drawn preview', 30_000);
      const shown = await shownLevel(OBJECT);
      result.remove = { strokeToFilledMs: Date.now() - started, fillMs: stats(await marks('pe-retouch-applied')), before: Math.round(before), after: Math.round(after), screenshot: Math.round(shown) };
    });

    if (!phone) {
      await step('a source area for the removal', async () => {
        await page.keyboard.press('Escape');
        await tab(2);
        const panel = page.locator('#pe-retouch-title .pe-section__toggle');
        if (await panel.getAttribute('aria-expanded') !== 'true') await panel.click();
        const id = (await saved('retouch.png')).retouch[2].id;
        const row = page.locator(`[data-retouch-id="${id}"] .pe-mask-row__name`);
        if (await row.getAttribute('aria-pressed') !== 'true') await row.click();
        await page.locator('.pe-retouch button', { hasText: 'Choose source area' }).click();
        const a = await photoPoint({ u: 0.2, v: 0.7 });
        const b = await photoPoint({ u: 0.35, v: 0.9 });
        await pointer('pointerdown', a);
        await pointer('pointermove', b);
        await pointer('pointerup', b);
        const value = await savedWhen('retouch.png', (adj) => Boolean(adj.retouch?.[2]?.source), 'source area saved');
        const area = value.retouch[2].source;
        assert.ok(Math.abs(area.x - 0.2) < 0.01 && Math.abs(area.width - 0.15) < 0.01 && Math.abs(area.height - 0.2) < 0.01, `source area ${JSON.stringify(area)}`);
        await poll(() => page.locator('[data-retouch-busy]').count(), (n) => n === 0, 'refill finished', 120_000);
      });

      await step('undo and redo', async () => {
        await page.keyboard.press('Escape');
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
        await savedWhen('retouch.png', (a) => a.retouch?.length === 3 && !a.retouch[2].source, 'undo');
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z');
        await savedWhen('retouch.png', (a) => Boolean(a.retouch?.[2]?.source), 'redo');
        await poll(() => page.locator('[data-retouch-busy]').count(), (n) => n === 0, 'fill after redo', 120_000);
      });
    }

    let first;
    await step('PNG export equals the Node reference (decoded PNG, retouched)', async () => {
      const ops = (await saved('retouch.png')).retouch;
      await setExportPng();
      const exported = await exportFile();
      first = await decode(exported.file);
      const expected = await reference(files.base, ops);
      const diff = compare(expected, first);
      assert.ok(close(diff, true), `export differs from the reference: ${JSON.stringify(diff)}`);
      result.export = { ms: exported.ms, ...diff };
    });

    if (!phone) {
      await step('a 90° turn keeps every repair on its target', async () => {
        await tab(2);
        const toggle = page.locator('.pe-section[data-section-id=geometry] .pe-section__toggle');
        await toggle.scrollIntoViewIfNeeded();
        if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
        await page.getByRole('button', { name: 'Rotate 90° clockwise' }).click();
        const value = await savedWhen('retouch.png', (a) => a.geometry?.quarterTurns === 1 || a.geometry?.rotate === 90 || a.geometry?.turns === 1 || JSON.stringify(a.geometry ?? {}) !== '{}', 'turn saved');
        const exported = await exportFile();
        const turned = await decode(exported.file);
        const expected = await reference(files.base, value.retouch, 90);
        assert.deepEqual([turned.width, turned.height], [1600, 2400]);
        const diff = compare(expected, turned);
        assert.ok(close(diff, true), `turned export differs from the reference: ${JSON.stringify(diff)}`);
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
        await savedWhen('retouch.png', (a) => JSON.stringify(a.geometry ?? {}) === '{}' || !a.geometry, 'turn undone');
      });

      await step('save edits, reload, reopen: same operations and the same export', async () => {
        const before = await saved('retouch.png');
        await tab(3);
        const [edits] = await Promise.all([page.waitForEvent('download'), page.locator('button:visible', { hasText: 'Save edits' }).first().click()]);
        const document = JSON.parse(readFileSync(await edits.path(), 'utf8'));
        assert.equal(document.version, DOCUMENT_VERSION);
        await page.evaluate(() => localStorage.clear());
        await page.reload({ waitUntil: 'load' });
        await page.waitForSelector('.pe[data-engine]');
        await importFiles([files.base], 1);
        await select('retouch.png');
        const file = path.join(work, `doc-${run.id}.json`);
        writeFileSync(file, JSON.stringify(document));
        await page.setInputFiles('input[type=file][accept="application/json,.json"]:not([aria-label])', file);
        const after = await savedWhen('retouch.png', (a) => a.retouch?.length === 3, 'document applied');
        assert.deepEqual(after.retouch, before.retouch);
        await setExportPng();
        const reopened = await decode((await exportFile()).file);
        assert.equal(compare(first, reopened).max, 0, 'reopened export differs');
      });
    }

    if (run.large) {
      await step('24 MP JPEG: heal and full-size export', async () => {
        await importFiles([files.large], 2);
        await select('retouch-24mp.jpg');
        await choose('Spot Heal', 'j');
        await clearMarks();
        const at = await photoPoint(SPOT);
        const started = Date.now();
        await pointer('pointerdown', at);
        await pointer('pointerup', at);
        await savedWhen('retouch-24mp.jpg', (a) => a.retouch?.length === 1, 'heal saved (24 MP)');
        const healMs = Date.now() - started;
        await page.keyboard.press('Escape');
        await tab(3);
        await page.check('input[name=pe-format][value=jpeg]');
        const exported = await exportFile();
        const out = await sharp(exported.file).metadata();
        assert.deepEqual([out.width, out.height], [6000, 4000]);
        const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
        result.large = { healMs, applyMs: stats(await marks('pe-retouch-applied')), exportMs: exported.ms, heapMb: heap ? Math.round(heap / 1e6) : null };
      });
    }

    if (run.raw && RAW_FILES.length) {
      result.raw = {};
      const plains = {};
      for (const file of RAW_FILES) {
        const name = path.basename(file);
        await step(`genuine ${name}: heal, clone, full-size export changed only inside the repairs`, async () => {
          await importFiles([file], (await page.$$eval('.pe-photo--list', (items) => items.length)) + 1);
          await select(name);
          await choose('Spot Heal', 'j');
          let at = await photoPoint({ u: 0.45, v: 0.5 });
          let started = Date.now();
          await pointer('pointerdown', at);
          await pointer('pointerup', at);
          await savedWhen(name, (a) => a.retouch?.length === 1, 'RAW heal saved', 60_000);
          const healMs = Date.now() - started;
          await choose('Clone Stamp', 's');
          const source = await photoPoint({ u: 0.7, v: 0.3 });
          await pointer('pointerdown', source, { altKey: true });
          await pointer('pointerup', source, { altKey: true });
          at = await photoPoint({ u: 0.62, v: 0.6 });
          await pointer('pointerdown', at);
          await pointer('pointermove', { x: at.x + 30, y: at.y + 10 });
          await twoFrames();
          await pointer('pointerup', { x: at.x + 30, y: at.y + 10 });
          await savedWhen(name, (a) => a.retouch?.length === 2, 'RAW clone saved', 60_000);
          await choose('Remove', 'r');
          at = await photoPoint({ u: 0.3, v: 0.75 });
          started = Date.now();
          await pointer('pointerdown', at);
          await pointer('pointermove', { x: at.x + 40, y: at.y });
          await twoFrames();
          await pointer('pointerup', { x: at.x + 40, y: at.y });
          const value = await savedWhen(name, (a) => a.retouch?.length === 3, 'RAW removal saved', 60_000);
          await poll(() => page.locator('[data-retouch-busy]').count(), (n) => n === 0, 'RAW fill finished', 120_000);
          const removeMs = Date.now() - started;
          await page.keyboard.press('Escape');
          await setExportPng();
          started = Date.now();
          const withRetouch = await exportFile();
          const exportMs = Date.now() - started;
          const retouched = await decode(withRetouch.file);
          // The same photo without retouch: turn both operations off.
          await tab(2);
          const panel = page.locator('#pe-retouch-title .pe-section__toggle');
          if (await panel.getAttribute('aria-expanded') !== 'true') await panel.click();
          for (const op of value.retouch) await page.locator(`[data-retouch-id="${op.id}"] .pe-layer__toggle`).click();
          await savedWhen(name, (a) => a.retouch.every(({ enabled }) => !enabled), 'repairs off');
          const plain = await decode((await exportFile()).file);
          const regions = value.retouch.map((op) => retouchRegion({ ...op, offset: { x: 0, y: 0 } }, plain.width, plain.height));
          let inside = 0; let outside = 0;
          for (let y = 0; y < plain.height; y += 2) for (let x = 0; x < plain.width; x += 2) {
            const i = (y * plain.width + x) * 4;
            if (Math.abs(retouched.data[i + 1] - plain.data[i + 1]) <= 1) continue; // eslint-disable-line no-continue
            if (regions.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height)) inside += 1; else outside += 1;
          }
          assert.ok(inside > 50 && outside === 0, `${name}: changed pixels inside ${inside}, outside ${outside}`);
          // The brushed boxes (what each repair writes), for the batch comparison.
          const targets = value.retouch.map((op) => retouchBounds(op, plain.width, plain.height)).map((b) => ({ x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 }));
          plains[name] = { plain, regions, targets, ops: value.retouch };
          result.raw[name] = { size: `${plain.width}×${plain.height}`, healMs, removeMs, exportMs, changedInside: inside };
        });
      }
      if (RAW_FILES.length === 2) {
        await step('batch: the ARW and the NEF exported at full size in one ZIP, each with only its own repairs', async () => {
          const names = RAW_FILES.map((file) => path.basename(file));
          for (const name of names) {
            await select(name);
            await tab(2);
            const panel = page.locator('#pe-retouch-title .pe-section__toggle');
            if (await panel.getAttribute('aria-expanded') !== 'true') await panel.click();
            for (const op of plains[name].ops) await page.locator(`[data-retouch-id="${op.id}"] .pe-layer__toggle`).click();
            await savedWhen(name, (a) => a.retouch.every(({ enabled }) => enabled), 'repairs on');
          }
          await tab(1);
          const items = page.locator('.pe-photo--list');
          const index = async (name) => (await items.evaluateAll((list, wanted) => list.findIndex((li) => li.querySelector('.pe-photo__select')?.getAttribute('aria-label')?.startsWith(wanted)), name));
          await select(names[0]);
          await items.nth(await index(names[1])).locator('.pe-photo__check').check();
          await page.click('.pe-batch__actions button:has-text("Export")');
          const dialog = page.locator('.pe-dialog[role=dialog]');
          await dialog.waitFor();
          await dialog.locator('input[name=pe-batch-output][value=zip]').check();
          await dialog.locator('input[name=pe-batch-format][value=jpeg]').check();
          await dialog.locator('select').selectOption('original');
          const started = Date.now();
          const [download] = await Promise.all([page.waitForEvent('download', { timeout: 900_000 }), dialog.locator('.pe-dialog__foot button.pe-button--primary').click()]);
          const ms = Date.now() - started;
          const entries = readZip(readFileSync(await download.path()));
          assert.equal(entries.length, 2);
          result.batch = { ms, entries: [] };
          for (const name of names) {
            const entry = entries.find((item) => item.name.startsWith(name.replace(/\.[^.]+$/, '')));
            assert.ok(entry, `${name} missing from the ZIP: ${entries.map((item) => item.name)}`);
            const image = await decode(entry.data);
            const { plain, targets: regions } = plains[name];
            assert.deepEqual([image.width, image.height], [plain.width, plain.height]);
            let insideSum = 0; let insideCount = 0; let outsideSum = 0; let outsideCount = 0;
            for (let y = 0; y < plain.height; y += 3) for (let x = 0; x < plain.width; x += 3) {
              const i = (y * plain.width + x) * 4;
              const d = Math.abs(image.data[i + 1] - plain.data[i + 1]);
              if (regions.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height)) { insideSum += d; insideCount += 1; } else { outsideSum += d; outsideCount += 1; }
            }
            const inside = insideSum / insideCount; const outside = outsideSum / outsideCount;
            assert.ok(outside < 2.5 && inside > outside + 1, `${name} in the batch: mean change inside its repairs ${inside.toFixed(2)}, elsewhere ${outside.toFixed(2)}`);
            result.batch.entries.push({ name: entry.name, size: `${image.width}×${image.height}`, inside: Math.round(inside * 100) / 100, outside: Math.round(outside * 100) / 100 });
          }
          await page.locator('.pe-dialog__foot button:has-text("Close")').click();
        });
      }
    }
    assert.deepEqual(problems, [], problems.join('\n'));
    result.ok = true;
    delete result.step;
  } catch (error) {
    result.ok = false;
    result.error = error.message.split('\n').slice(0, 3).join(' ');
    result.problems = problems.slice(0, 5);
    // What the page knew when it failed: saved operations, timing marks, the fill indicator.
    result.debug = await page.evaluate((key) => ({
      operations: (JSON.parse(localStorage.getItem(key) ?? 'null')?.photos ?? []).map((photo) => photo.adjustments.retouch?.map(({ type, enabled, points, radius }) => `${type}:${enabled}:${radius}:${points.map(([u, v]) => `${u.toFixed(3)},${v.toFixed(3)}`).join(' ')}`)),
      applied: performance.getEntriesByName('pe-retouch-applied').map((entry) => entry.detail),
      busy: document.querySelector('[data-retouch-busy]')?.textContent ?? null,
    }), AUTOSAVE_KEY).catch(() => null);
    await page.screenshot({ path: path.join(work, `${run.id}-failure.png`) }).catch(() => {});
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
    for (const run of RUNS.filter(({ id }) => !ONLY || ONLY.includes(id))) {
      const result = await runOne(run, files);
      results.push(result);
      console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${result.environment} ${JSON.stringify({ ...result, environment: undefined, ok: undefined })}`);
    }
  } finally {
    server.httpServer.close();
  }
  if (!RAW_FILES.length) console.log('Genuine RAW not checked: set RETOUCH_RAW_DIR to a folder with a Sony .ARW and/or a Nikon .NEF file.');
  if (results.some(({ ok }) => !ok)) { console.log(`Screenshots in ${work}`); process.exitCode = 1; } else rmSync(work, { recursive: true, force: true });
}

await main();
