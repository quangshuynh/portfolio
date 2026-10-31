// Multi-camera RAW check of /photography/editor on a production build: every file in
// RAW_COMPAT_DIR imported at once (one decoder at a time), each validated format developed,
// edited and exported at full size, unsupported files refused with a readable message while the
// rest keep loading. Per photo, a v13 edit document applies tone, HSL, a curve, colour grading,
// sharpening, noise reduction, a custom white balance, grain, crop and straighten, a radial local
// adjustment, a Spot Heal and the HUYNH watermark; exports are checked for their size, against
// the preview, and with and without the watermark (the difference sits in its corner). Then a
// mixed-format batch ZIP (names, sizes, each photo's own edits), a cancelled batch and its retry,
// and saving the edits, reloading and reopening them. Chromium and Firefox by default; WebKit
// (Playwright's Windows build crashes in LibRaw, see docs/photography-editor.md) with
// RAW_WEBKIT_GENUINE=1; iPhone 13 emulation imports and previews the smaller files only.
// Usage: RAW_COMPAT_DIR=C:/path npm run check:editor:raw-formats (EDITOR_ENGINES=chromium,firefox,webkit,iphone; RAW_FORMATS_ONLY=regex)
// RAW_FORMATS_OUT=report.json saves the results. Files never leave this machine.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { build, preview } from 'vite';
import { chromium, devices, firefox, webkit } from 'playwright';
import { readZip } from '../src/editor/dev/zipVerify.mjs';
import { DOCUMENT_VERSION } from '../src/editor/model/editDocument.mjs';
import { WATERMARK_DEFAULTS } from '../src/editor/watermark/watermark.mjs';
import { RAW_SNIFF_BYTES, sniffRaw } from '../src/editor/raw/rawFormat.mjs';
import { exportGeometry } from '../src/editor/io/files.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = process.env.RAW_COMPAT_DIR ?? '';
if (!DIR) {
  console.log('Multi-camera RAW not checked: set RAW_COMPAT_DIR to a folder of genuine RAW files.');
  process.exit(0);
}
const work = mkdtempSync(path.join(tmpdir(), 'editor-raw-formats-'));
const PORT = 4196;
const URL_EDITOR = `http://localhost:${PORT}/photography/editor/`;
const ONLY = process.env.EDITOR_ENGINES?.split(',');
const AUTOSAVE_KEY = 'photo-editor:edits:v1';

const FILTER = process.env.RAW_FORMATS_ONLY ? new RegExp(process.env.RAW_FORMATS_ONLY, 'i') : null;
const FILES = readdirSync(DIR).filter((name) => statSync(path.join(DIR, name)).isFile() && (!FILTER || FILTER.test(name))).sort().map((name) => {
  const head = new Uint8Array(readFileSync(path.join(DIR, name)).subarray(0, RAW_SNIFF_BYTES));
  let format = null;
  try { format = sniffRaw(head); } catch { /* refused by content */ }
  return { name, file: path.join(DIR, name), format, mb: statSync(path.join(DIR, name)).size / 1e6 };
});

const RUNS = [
  { id: 'chromium', name: 'Chromium, desktop', type: chromium, full: true },
  { id: 'firefox', name: 'Firefox, desktop', type: firefox, full: true },
  { id: 'webkit', name: 'WebKit, desktop', type: webkit, full: process.env.RAW_WEBKIT_GENUINE === '1', skip: process.env.RAW_WEBKIT_GENUINE !== '1' },
  { id: 'iphone', name: 'WebKit, iPhone 13 emulation', type: webkit, device: 'iPhone 13', small: true, skip: process.env.RAW_WEBKIT_GENUINE !== '1' },
];

// The representative edit (fractions of the photo for points; heal 5% to the right).
const EDIT = {
  exposure: 0.3, contrast: 15, highlights: -30, shadows: 25, vibrance: 15, saturation: 5,
  orangeSaturation: -10, blueHue: 8, blueLuminance: -10,
  curves: { master: [[0, 0], [64, 56], [192, 200], [255, 255]] },
  gradeShadowsSat: 30, gradeHighlightsSat: 20, sharpening: 30, luminanceNoise: 20, colorNoise: 25, grainAmount: 10,
  rawTemperature: 5200, rawTint: 5, raw: { whiteBalance: 'custom' },
  geometry: { quarterTurns: 0, angle: 2, perspective: { vertical: 0, horizontal: 0 }, crop: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 } },
  local: [{ id: 'fmt-radial', name: 'Radial', enabled: true, amount: 1, mask: { base: 'none', components: [{ id: 'fmt-radial-c', type: 'radial', x: 0.5, y: 0.45, rx: 0.3, ry: 0.25, feather: 0.6 }] }, settings: { exposure: 0.4 } }],
  retouch: [{ id: 'fmt-heal', type: 'heal', enabled: true, points: [[0.4, 0.5]], radius: 0.02, hardness: 0.5, opacity: 1, spacing: 0.25, offset: { x: 0.05, y: 0 } }],
  watermark: { ...WATERMARK_DEFAULTS },
};

async function poll(read, done, label, timeout = 30_000) {
  const end = Date.now() + timeout;
  let value;
  while (Date.now() < end) {
    value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label} (last value ${JSON.stringify(value)?.slice(0, 200)})`);
}
const decode = async (input) => {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
};

async function runOne(run) {
  const profile = mkdtempSync(path.join(work, 'profile-'));
  const context = await run.type.launchPersistentContext(profile, { ...(run.device ? devices[run.device] : { viewport: { width: 1440, height: 900 } }), acceptDownloads: true });
  const page = context.pages()[0] ?? await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('crash', () => problems.push('page crashed'));
  page.on('console', (message) => message.type() === 'error' && !/\[photo editor\] (webgl2|image-worker)|Failed to load resource/.test(message.text()) && problems.push(`console: ${message.text()}`));
  const result = { environment: run.name, browser: `${run.type.name()} ${context.browser()?.version() ?? ''}`.trim(), photos: {} };
  const phone = Boolean(run.device);
  const tab = async (index) => { if (phone) await page.click(`.pe-tabs button:nth-child(${index})`); };
  const step = async (name, fn) => { result.step = name; return fn(); };
  const twoFrames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const items = () => page.$$eval('.pe-photo--list', (list) => list.map((li) => ({ status: li.dataset.status, label: li.querySelector('.pe-photo__select')?.getAttribute('aria-label') ?? '', text: li.textContent })));
  const select = async (name) => {
    await tab(1);
    const started = Date.now();
    await page.click(`.pe-photo--list button.pe-photo__select[aria-label^="${name}"]`);
    await poll(() => page.evaluate(() => !document.querySelector('.pe-stage-message') && !document.querySelector('.pe-canvas-host').hidden), Boolean, `preview of ${name}`, 300_000);
    await twoFrames();
    return Date.now() - started;
  };
  const saved = (name) => page.evaluate(([key, file]) => JSON.parse(localStorage.getItem(key) ?? 'null')?.photos.find((p) => p.source.name === file)?.adjustments ?? null, [AUTOSAVE_KEY, name]);
  const savedWhen = (name, test, label, timeout = 30_000) => poll(() => saved(name), (value) => Boolean(value) && test(value), label, timeout);
  const exportSettings = async ({ longEdge = false, watermark = true }) => {
    await tab(3);
    await page.check('input[name=pe-format][value=jpeg]');
    await page.locator('label.pe-field select:has(option[value=fit])').selectOption(longEdge ? 'long-edge' : 'original');
    const box = page.getByRole('checkbox', { name: /Include watermark/ }).first();
    if (watermark) await box.check(); else await box.uncheck();
  };
  // Full-size exports are only measured (size and mean), never decoded whole: 20 photos of up to
  // 51 MP would exhaust Node's heap.
  const exportFile = async ({ measure = false } = {}) => {
    const started = Date.now();
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 900_000 }), page.click('.pe-export-button')]);
    const file = await download.path();
    const ms = Date.now() - started;
    if (!measure) return { image: await decode(file), ms, name: download.suggestedFilename() };
    const { width, height } = await sharp(file).metadata();
    const { channels } = await sharp(file).stats();
    return { image: { width, height, mean: channels[1].mean }, ms, name: download.suggestedFilename() };
  };
  const loadDocument = async (document, label) => {
    const file = path.join(work, `${label}-${Date.now()}.json`);
    writeFileSync(file, JSON.stringify(document));
    await tab(3);
    await page.setInputFiles('input[type=file][accept="application/json,.json"]:not([aria-label])', file);
  };
  const saveDocument = async () => {
    await tab(3);
    const [edits] = await Promise.all([page.waitForEvent('download'), page.locator('button:visible', { hasText: 'Save edits' }).first().click()]);
    return JSON.parse(readFileSync(await edits.path(), 'utf8'));
  };
  const files = run.small ? FILES.filter(({ mb }) => mb < 25) : FILES;
  const valid = files.filter(({ format }) => format);
  const importAll = async () => {
    await tab(1);
    const started = Date.now();
    await page.setInputFiles('input[type=file][multiple]', files.map(({ file }) => file));
    const done = await poll(items, (list) => list.length === files.length && list.every(({ status }) => status !== 'importing'), 'imports', 1_800_000);
    return { ms: Date.now() - started, list: done };
  };

  try {
    await page.goto(URL_EDITOR);
    await page.waitForSelector('.pe[data-engine]', { timeout: 60_000 });
    result.engine = await page.locator('.pe[data-engine]').getAttribute('data-engine');

    await step('import every file at once: validated formats load, the others fail with a reason and do not stop the rest', async () => {
      const { ms, list } = await importAll();
      result.importMs = ms;
      for (const { name, format } of files) {
        const item = list.find(({ label }) => label.startsWith(name));
        assert.ok(item, `${name} missing from the list`);
        result.photos[name] = { format, imported: item.status };
        if (!format) {
          result.photos[name].message = item.text.replace(name, '').trim().slice(0, 200);
          assert.equal(item.status, 'error', `${name} (refused by content) imported`);
          assert.match(item.text, /not supported|cannot|could not/i, `${name}: no readable reason (${item.text})`);
        }
      }
      // A Nikon High Efficiency NEF passes identification and fails in LibRaw with its own message.
      const failedValid = valid.filter(({ name }) => list.find(({ label }) => label.startsWith(name)).status !== 'ready');
      for (const { name } of failedValid) {
        const text = list.find(({ label }) => label.startsWith(name)).text;
        result.photos[name].message = text.replace(name, '').trim().slice(0, 200);
        assert.match(text, /not supported|cannot|could not/i, `${name} failed without a readable reason: ${text}`);
      }
      result.decodeFailures = failedValid.map(({ name }) => name);
    });
    const ready = valid.filter(({ name }) => result.photos[name].imported === 'ready');
    for (const { name } of ready) result.photos[name].previewMs = await select(name);

    if (!run.full) {
      assert.deepEqual(problems, [], problems.join('\n'));
      result.ok = true;
      delete result.step;
      return result;
    }

    let document;
    await step('a v13 document with tone, colour, Detail, geometry, a mask, a heal and the watermark on every RAW photo', async () => {
      document = await saveDocument();
      assert.equal(document.version, DOCUMENT_VERSION);
      for (const entry of document.photos) Object.assign(entry.adjustments, structuredClone(EDIT));
      await loadDocument(document, 'formats');
      for (const { name } of ready) await savedWhen(name, (a) => a.exposure === 0.3 && a.local?.length === 1 && a.retouch?.length === 1 && a.watermark?.enabled, `${name}: document applied`);
    });

    for (const { name, format } of ready) {
      await step(`${name}: full-size export, preview agreement and the watermark`, async () => {
        const photo = result.photos[name];
        await select(name);
        const entry = document.photos.find((p) => p.source.name === name);
        await exportSettings({ longEdge: true, watermark: false });
        const small = (await exportFile()).image;
        await exportSettings({ longEdge: true, watermark: true });
        const marked = (await exportFile()).image;
        assert.deepEqual([marked.width, marked.height], [small.width, small.height]);
        // The watermark changes the bottom-right corner and nothing else.
        let inside = 0; let outside = 0;
        for (let y = 0; y < small.height; y += 2) for (let x = 0; x < small.width; x += 2) {
          const i = (y * small.width + x) * 4;
          if (Math.abs(small.data[i + 1] - marked.data[i + 1]) <= 2) continue; // eslint-disable-line no-continue
          if (x > small.width * 0.55 && y > small.height * 0.7) inside += 1; else outside += 1;
        }
        photo.watermark = { inside, outside };
        assert.ok(inside > 200 && outside < inside * 0.01, `${name}: watermark changes inside ${inside}, outside ${outside}`);
        // Preview against export: the drawn frame (no watermark) and the export scaled to it.
        // The drawn frame averaged over 4×4 blocks (in the page, so only a small array crosses over;
        // point samples would alias grain and sharpening).
        const frame = await page.evaluate(() => {
          const f = window.__photoEditorPreview?.read();
          if (!f) return null;
          const width = Math.floor(f.width / 4); const height = Math.floor(f.height / 4); const data = new Array(width * height * 4);
          for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) for (let c = 0; c < 4; c += 1) {
            let sum = 0;
            for (let dy = 0; dy < 4; dy += 1) for (let dx = 0; dx < 4; dx += 1) sum += f.data[((y * 4 + dy) * f.width + x * 4 + dx) * 4 + c];
            data[(y * width + x) * 4 + c] = sum / 16;
          }
          return { width, height, data };
        });
        if (frame) {
          const scaled = await decode(await sharp(Buffer.from(small.data), { raw: { width: small.width, height: small.height, channels: 4 } }).resize(frame.width, frame.height, { fit: 'fill' }).png().toBuffer());
          let sum = 0; let n = 0;
          for (let i = 0; i < frame.data.length; i += 4) { for (let c = 0; c < 3; c += 1) sum += Math.abs(frame.data[i + c] - scaled.data[i + c]); n += 3; }
          photo.previewVsExport = +(sum / n).toFixed(2);
          assert.ok(sum / n < 8, `${name}: preview and export differ by ${photo.previewVsExport} on average`);
        }
        await exportSettings({ longEdge: false, watermark: true });
        const full = await exportFile({ measure: true });
        const raw = await page.evaluate(([key, file]) => JSON.parse(localStorage.getItem(key) ?? 'null')?.photos.find((p) => p.source.name === file)?.source, [AUTOSAVE_KEY, name]);
        const expected = exportGeometry(entry.adjustments.geometry, { width: raw.width, height: raw.height }, { mode: 'original' }).output;
        photo.size = `${full.image.width}×${full.image.height}`;
        photo.exportMs = full.ms;
        photo.exportName = full.name;
        photo.mean = Math.round(full.image.mean);
        assert.deepEqual([full.image.width, full.image.height], [expected.width, expected.height], `${name}: full-size export ${photo.size}, expected ${expected.width}×${expected.height}`);
        assert.equal(full.name, `${name.replace(/\.[^.]+$/, '')}-quangedit.jpg`);
        assert.ok(photo.mean > 10 && photo.mean < 245, `${name}: export mean ${photo.mean}`);
        photo.format = format;
        photo.ok = true;
      });
    }

    const mixed = [...new Map(ready.map((entry) => [entry.format, entry])).values()].slice(0, 6);
    const zipRun = async (names) => {
      await tab(1);
      const list = page.locator('.pe-photo--list');
      await select(names[0]);
      for (const name of names.slice(1)) await page.locator('.pe-photo--list', { has: page.locator(`button.pe-photo__select[aria-label^="${name}"]`) }).locator('.pe-photo__check').check();
      assert.ok(await list.count());
      await page.click('.pe-batch__actions button:has-text("Export")');
      const dialog = page.locator('.pe-dialog[role=dialog]');
      await dialog.waitFor();
      await dialog.locator('input[name=pe-batch-output][value=zip]').check();
      await dialog.locator('input[name=pe-batch-format][value=jpeg]').check();
      await dialog.locator('select').selectOption('original');
      return dialog;
    };
    await step('a cancelled mixed-format batch saves nothing; its retry saves every photo', async () => {
      const names = mixed.map(({ name }) => name);
      let dialog = await zipRun(names);
      await dialog.locator('.pe-dialog__foot button.pe-button--primary').click();
      await dialog.locator('.pe-dialog__foot button:has-text("Cancel")').click();
      await poll(() => dialog.locator('.pe-dialog__foot button:has-text("Close")').count(), (n) => n > 0, 'batch cancelled', 120_000);
      result.cancelled = await dialog.locator('.pe-dialog__foot').textContent();
      await dialog.locator('.pe-dialog__foot button:has-text("Close")').click();
      await tab(1);
      for (const name of names.slice(1)) await page.locator('.pe-photo--list', { has: page.locator(`button.pe-photo__select[aria-label^="${name}"]`) }).locator('.pe-photo__check').uncheck().catch(() => {});
      dialog = await zipRun(names);
      const started = Date.now();
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 1_800_000 }), dialog.locator('.pe-dialog__foot button.pe-button--primary').click()]);
      const entries = readZip(readFileSync(await download.path()));
      result.batch = { ms: Date.now() - started, formats: mixed.map(({ format }) => format), entries: [] };
      assert.equal(entries.length, names.length, entries.map(({ name }) => name).join(', '));
      for (const name of names) {
        const wanted = `${name.replace(/\.[^.]+$/, '')}-quangedit.jpg`;
        const item = entries.find((entry) => entry.name === wanted);
        assert.ok(item, `${wanted} missing from the ZIP: ${entries.map((entry) => entry.name)}`);
        const image = await sharp(item.data).metadata();
        // Each photo's own size: a mix-up between photos would show here.
        assert.equal(`${image.width}×${image.height}`, result.photos[name].size, `${name} in the ZIP`);
        result.batch.entries.push({ name: item.name, size: `${image.width}×${image.height}` });
      }
      await dialog.locator('.pe-dialog__foot button:has-text("Close")').click();
    });

    await step('save edits, reload, reopen: every RAW photo gets its own edits back', async () => {
      const before = await saveDocument();
      await page.evaluate(() => localStorage.clear());
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('.pe[data-engine]');
      await importAll();
      await loadDocument(before, 'reopen');
      for (const { name } of ready) {
        const after = await savedWhen(name, (a) => a.exposure === 0.3 && a.retouch?.length === 1, `${name}: reopened`);
        const original = before.photos.find((p) => p.source.name === name).adjustments;
        assert.deepEqual(after.geometry, original.geometry);
        assert.deepEqual(after.local, original.local);
        assert.deepEqual(after.retouch, original.retouch);
      }
      result.reopened = ready.length;
    });
    assert.deepEqual(problems, [], problems.join('\n'));
    result.ok = true;
    delete result.step;
  } catch (error) {
    result.ok = false;
    result.error = error.message.split('\n').slice(0, 3).join(' ');
    result.problems = problems.slice(0, 5);
    await page.screenshot({ path: path.join(work, `${run.id}-failure.png`) }).catch(() => {});
  } finally {
    await context.close();
  }
  return result;
}

async function main() {
  await build({ root, logLevel: 'silent', configFile: path.join(root, 'vite.config.mjs') });
  const server = await preview({ root, configFile: path.join(root, 'vite.config.mjs'), preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
  const results = [];
  try {
    for (const run of RUNS.filter(({ id, skip }) => (ONLY ? ONLY.includes(id) : !skip))) {
      const result = await runOne(run);
      results.push(result);
      console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${result.environment} ${JSON.stringify({ ...result, environment: undefined, ok: undefined })}`);
    }
  } finally {
    server.httpServer.close();
  }
  if (process.env.RAW_FORMATS_OUT) writeFileSync(process.env.RAW_FORMATS_OUT, `${JSON.stringify(results, null, 2)}\n`);
  if (results.some(({ ok }) => !ok)) { console.log(`Screenshots in ${work}`); process.exitCode = 1; } else rmSync(work, { recursive: true, force: true });
}

await main();
