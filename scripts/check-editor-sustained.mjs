// Sustained editing check of /photography/editor on a production build (Interval 22.9). For each
// photo, in one browser session: import, Camera Natural (RAW default) and Auto Exposure (RAW, from
// the RAW panel), an Exposure edit with undo and redo, then crop, a brush local adjustment, Spot
// Heal, Remove, a text layer and the watermark through the editor's own Save edits / load edits
// document; full-size JPEG export; the preview agrees with the export; reload (reopen) restores the
// same edits from autosave and exports the same pixels; the photo is removed. Between photos it
// checks for stuck indicators and samples memory (post-GC JS heap in Chromium, whole-browser working
// set on Windows, live WebGL texture bytes). Playwright WebKit is not Safari on iOS.
// Usage: npm run check:editor:sustained (SUSTAINED_RUNS=chromium,iphone,pixel;
// SUSTAINED_DIR=folder of genuine RAW files, one per format is used; SUSTAINED_SKIP_BUILD=1)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { build, preview } from 'vite';
import { chromium, devices, webkit } from 'playwright';
import { openEditorTool } from './editor-mobile-controls.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'editor-sustained-'));
const PORT = 4198;
const URL_EDITOR = `http://localhost:${PORT}/photography/editor/`;
const AUTOSAVE_KEY = 'photo-editor:edits:v1';
const ONLY_RUNS = process.env.SUSTAINED_RUNS?.split(',');
const DIR = process.env.SUSTAINED_DIR ?? '';
const FORMATS = ['cr3', 'nef', 'raf', 'dng', 'cr2', 'orf', 'rw2', 'arw'];
const GENUINE = DIR && existsSync(DIR)
  ? FORMATS.map((ext) => readdirSync(DIR).sort().find((name) => name.toLowerCase().endsWith(`.${ext}`))).filter(Boolean).slice(0, 4).map((name) => path.join(DIR, name))
  : [];
const RUNS = [
  { id: 'chromium', name: 'Chromium, desktop', type: chromium },
  { id: 'iphone', name: 'WebKit, iPhone 13 emulation', type: webkit, device: 'iPhone 13' },
  { id: 'pixel', name: 'Chromium, Pixel 7 emulation', type: chromium, device: 'Pixel 7' },
];
// Live WebGL texture bytes (level 0 of every texture allocated and not deleted).
const INIT = () => {
  const proto = window.WebGL2RenderingContext?.prototype;
  if (!proto) return;
  const BYTES = { 0x8229: 1, 0x8058: 4, 0x8d7c: 6, 0x8815: 12, 0x8814: 16, 0x881a: 8, 0x822e: 4, 0x8230: 8 };
  const live = new Map();
  const bound = new WeakMap();
  window.__gpuTextureBytes = () => [...live.values()].reduce((sum, bytes) => sum + bytes, 0);
  const wrap = (name, fn) => { const original = proto[name]; proto[name] = function wrapped(...args) { const out = original.apply(this, args); fn.call(this, args); return out; }; };
  wrap('bindTexture', function bindTexture([target, texture]) { if (target === this.TEXTURE_2D) bound.set(this, texture); });
  wrap('deleteTexture', ([texture]) => live.delete(texture));
  wrap('texImage2D', function texImage2D(a) { if (a.length >= 9 && typeof a[3] === 'number' && a[1] === 0) live.set(bound.get(this), a[3] * a[4] * (BYTES[a[2]] ?? 4)); });
};

const poll = async (read, done, label, timeout = 60_000) => {
  const end = Date.now() + timeout;
  let value;
  while (Date.now() < end) {
    value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${label} (last value ${JSON.stringify(value)?.slice(0, 200)})`);
};
const decode = async (file) => { const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, width: info.width, height: info.height }; };

function browserMb(profile) {
  if (process.platform !== 'win32') return null;
  try {
    const command = ['$all = Get-CimInstance Win32_Process', `$ids = @($all | Where-Object { $_.CommandLine -like '*${path.basename(profile)}*' } | ForEach-Object { $_.ProcessId })`, 'do { $before = $ids.Count; $ids = @($ids + ($all | Where-Object { $ids -contains $_.ParentProcessId } | ForEach-Object { $_.ProcessId }) | Sort-Object -Unique) } while ($ids.Count -gt $before)', '($all | Where-Object { $ids -contains $_.ProcessId } | Measure-Object -Property WorkingSetSize -Sum).Sum'].join('; ');
    return Math.round(Number(execFileSync('powershell', ['-NoProfile', '-Command', command]).toString().trim()) / 1048576) || null;
  } catch { return null; }
}

// The edits added through the document: crop, a brush local adjustment, a heal, a removal, text, watermark.
function documentEdits(adjustments) {
  return {
    ...adjustments,
    geometry: { ...adjustments.geometry, crop: { x: 0.04, y: 0.05, width: 0.9, height: 0.86 } },
    local: [{ id: 'sus-brush', name: 'Brush', enabled: true, amount: 1, settings: { exposure: 0.5, saturation: -20 }, mask: { base: 'none', components: [{ id: 'sus-brush-c', type: 'brush', enabled: true, opacity: 1, invert: false, strokes: [{ mode: 'add', radius: 0.06, hardness: 0.5, opacity: 1, points: [[0.2, 0.6, 0.7], [0.35, 0.55, 0.7], [0.5, 0.62, 0.7]] }] }] } }],
    retouch: [
      { id: 'sus-heal', type: 'heal', enabled: true, radius: 0.02, hardness: 0.5, opacity: 1, spacing: 0.25, points: [[0.3, 0.3]], offset: { x: 0.05, y: 0 } },
      { id: 'sus-remove', type: 'remove', enabled: true, radius: 0.015, hardness: 0.5, opacity: 1, spacing: 0.25, points: [[0.6, 0.35], [0.64, 0.36]], offset: { x: 0, y: 0 } },
    ],
    layers: [{ id: 'sus-text', type: 'text', text: 'Sustained', x: 0.3, y: 0.2 }],
    watermark: { enabled: true },
  };
}

async function runOne(run, files) {
  const profile = mkdtempSync(path.join(work, 'profile-'));
  const context = await run.type.launchPersistentContext(profile, { ...(run.device ? devices[run.device] : { viewport: { width: 1440, height: 900 } }), acceptDownloads: true });
  await context.addInitScript(INIT);
  const page = context.pages()[0] ?? await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('crash', () => problems.push('page crashed'));
  const result = { environment: run.name, browser: `${run.type.name()} ${context.browser()?.version() ?? ''}`.trim(), photos: [], memory: [] };
  const cdp = run.type === chromium ? await context.newCDPSession(page) : null;
  const tab = async (index) => { if (run.device) await page.click(`.pe-tabs button:nth-child(${index})`); };
  const saved = (name) => page.evaluate(([key, file]) => JSON.parse(localStorage.getItem(key) ?? 'null')?.photos.find((p) => p.source.name === file)?.adjustments ?? null, [AUTOSAVE_KEY, name]);
  const savedWhen = (name, test, label, timeout = 30_000) => poll(() => saved(name), (v) => v && test(v), label, timeout);
  const idle = () => page.evaluate(() => ({
    importing: document.querySelectorAll('.pe-photo--list[data-status=importing]').length,
    retouchBusy: document.querySelectorAll('[data-retouch-busy]').length,
    layersLoading: document.querySelectorAll('[data-layers-loading]').length,
    stageMessage: document.querySelector('.pe-stage-message')?.textContent ?? null,
  }));
  const settled = (label) => poll(idle, (s) => !s.importing && !s.retouchBusy && !s.layersLoading && !s.stageMessage, `${label}: no busy indicator`, 300_000);
  const section = async (id, title) => {
    if (run.device) return openEditorTool(page, id);
    const toggle = page.locator('.pe-panel--adjust .pe-section__toggle', { hasText: title }).first();
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  };
  const sample = async (label) => {
    let jsHeapMb = null;
    if (cdp) { await cdp.send('HeapProfiler.collectGarbage'); jsHeapMb = Math.round((await cdp.send('Runtime.getHeapUsage')).usedSize / 1e5) / 10; }
    await page.waitForTimeout(1500);
    result.memory.push({ label, jsHeapMb, gpuTexturesMb: await page.evaluate(() => Math.round((window.__gpuTextureBytes?.() ?? 0) / 1e5) / 10), browserMb: browserMb(profile) });
  };
  const importAndShow = async (file, name) => {
    await tab(1);
    await page.setInputFiles('input[type=file][multiple]', file);
    await poll(() => page.locator('.pe-photo--list').filter({ hasText: name }).getAttribute('data-status').catch(() => null), (s) => s === 'ready', `import of ${name}`, 300_000);
    await page.locator('.pe-photo--list').filter({ hasText: name }).locator('button.pe-photo__select').click();
    await poll(() => page.evaluate(() => !document.querySelector('.pe-stage-message') && !document.querySelector('.pe-canvas-host').hidden), Boolean, `preview of ${name}`, 300_000);
  };
  const exportJpeg = async () => {
    await tab(3);
    await page.check('input[name=pe-format][value=jpeg]');
    const started = Date.now();
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 900_000 }), page.click('.pe-export-button')]);
    const file = path.join(work, `${Date.now()}-${download.suggestedFilename()}`);
    await download.saveAs(file);
    return { file, ms: Date.now() - started };
  };
  try {
    await page.goto(URL_EDITOR, { waitUntil: 'load' });
    await page.waitForSelector('.pe[data-engine]', { timeout: 30_000 });
    result.engine = await page.$eval('.pe', (e) => e.dataset.engine);
    await sample('empty');
    for (const file of files) {
      const name = path.basename(file);
      const raw = !/\.(jpe?g|png|webp)$/i.test(name);
      const photo = { name };
      result.step = `${name}: import`;
      await importAndShow(file, name);
      if (raw) {
        result.step = `${name}: Camera Natural and Auto Exposure`;
        const first = await savedWhen(name, () => true, 'autosave');
        assert.equal(first.raw?.profile, 'camera-natural', `new RAW photos develop with Camera Natural (${JSON.stringify(first.raw)})`);
        await section('raw', 'RAW');
        const apply = page.locator('[aria-label="Auto Exposure"] button', { hasText: /^Apply$/ });
        photo.autoExposure = await apply.count() ? 'applied' : (await page.getByTestId('raw-auto-exposure').textContent().catch(() => 'none'));
        if (await apply.count()) {
          await apply.click();
          await page.getByTestId('raw-auto-exposure').filter({ hasText: 'applied' }).waitFor();
          photo.autoExposure = (await savedWhen(name, (a) => typeof a.raw?.autoExposure === 'number', 'Auto Exposure saved')).raw.autoExposure;
        }
      }
      result.step = `${name}: Exposure edit, undo, redo`;
      await section('light', 'Light');
      const exposure = page.getByRole('textbox', { name: 'Exposure value' });
      await exposure.fill('0.4');
      await exposure.press('Enter');
      await savedWhen(name, (a) => a.exposure === 0.4, 'exposure');
      await page.locator('.pe-bar__actions button[aria-label=Undo]').click();
      await savedWhen(name, (a) => a.exposure === 0, 'undo');
      await page.locator('.pe-bar__actions button[aria-label=Redo]').click();
      await savedWhen(name, (a) => a.exposure === 0.4, 'redo');

      result.step = `${name}: crop, mask, heal, remove, layer, watermark (edit document)`;
      await tab(3);
      const [edits] = await Promise.all([page.waitForEvent('download'), page.locator('button:visible', { hasText: 'Save edits' }).first().click()]);
      const doc = JSON.parse(readFileSync(await edits.path(), 'utf8'));
      const entry = doc.photos.find((p) => p.source.name === name);
      entry.adjustments = documentEdits(entry.adjustments);
      const docFile = path.join(work, `doc-${Date.now()}.json`);
      writeFileSync(docFile, JSON.stringify(doc));
      await page.setInputFiles('input[type=file][accept="application/json,.json"]:not([aria-label])', docFile);
      const applied = await savedWhen(name, (a) => a.retouch?.length === 2 && a.local?.length === 1 && a.layers?.length === 1 && a.watermark?.enabled && a.geometry?.crop, 'document applied');
      assert.equal(applied.exposure, 0.4, 'the Exposure edit was kept');
      await settled(`${name} edits`);

      result.step = `${name}: full-size export, preview vs export`;
      const one = await exportJpeg();
      const exported = await decode(one.file);
      photo.export = { size: `${exported.width}×${exported.height}`, ms: one.ms };
      // The drawn frame, every 4th pixel's RGB (a full 3072 px frame is too large to pass out).
      const frame = await page.evaluate(() => {
        const f = window.__photoEditorPreview?.read();
        if (!f) return null;
        const rgb = [];
        for (let y = 0; y < f.height; y += 4) for (let x = 0; x < f.width; x += 4) { const i = (y * f.width + x) * 4; rgb.push(f.data[i], f.data[i + 1], f.data[i + 2]); }
        return { width: f.width, height: f.height, rgb };
      });
      if (frame) {
        assert.ok(Math.abs(frame.width / frame.height - exported.width / exported.height) < 0.01, `preview ${frame.width}×${frame.height} vs export ${photo.export.size}`);
        const scaled = await decode(await sharp(Buffer.from(exported.data), { raw: { width: exported.width, height: exported.height, channels: 4 } }).resize(frame.width, frame.height, { fit: 'fill' }).png().toBuffer());
        // The watermark is drawn over the preview by its own canvas: its corner is left out.
        let sum = 0; let n = 0; let k = 0;
        for (let y = 0; y < frame.height; y += 4) for (let x = 0; x < frame.width; x += 4, k += 3) {
          if (x > frame.width * 0.6 && y > frame.height * 0.7) continue; // eslint-disable-line no-continue
          const i = (y * frame.width + x) * 4;
          for (let c = 0; c < 3; c += 1) { sum += Math.abs(frame.rgb[k + c] - scaled.data[i + c]); n += 1; }
        }
        photo.previewVsExportMean = +(sum / n).toFixed(2);
        assert.ok(sum / n < 6, `preview and export differ by ${photo.previewVsExportMean} on average`);
      }

      result.step = `${name}: reopen (reload) restores the edits and exports the same pixels`;
      const before = await saved(name);
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('.pe[data-engine]', { timeout: 30_000 });
      await importAndShow(file, name);
      const restored = await savedWhen(name, (a) => a.retouch?.length === 2, 'restored edits');
      assert.deepEqual(restored, before, 'the reopened photo has different edits');
      await settled(`${name} reopened`);
      const two = await exportJpeg();
      const again = await decode(two.file);
      let max = 0;
      for (let i = 0; i < again.data.length; i += 1) max = Math.max(max, Math.abs(again.data[i] - exported.data[i]));
      photo.reopenExportMaxDiff = max;
      assert.equal(max, 0, 'the export after reopening differs');
      rmSync(one.file); rmSync(two.file);

      result.step = `${name}: remove`;
      await tab(1);
      await page.getByRole('button', { name: `Remove ${name} from the workspace` }).click();
      await settled(`${name} removed`);
      result.photos.push(photo);
      await sample(`after ${name}`);
    }
    assert.deepEqual(problems, [], problems.join('\n'));
    result.ok = true;
    delete result.step;
  } catch (error) {
    result.ok = false;
    result.error = error.message.replace(/\s+/g, ' ').slice(0, 600);
    result.problems = problems.slice(0, 5);
  } finally {
    if (cdp) await cdp.detach().catch(() => {});
    await context.close();
  }
  return result;
}

async function main() {
  if (!process.env.SUSTAINED_SKIP_BUILD) await build({ root, logLevel: 'error' });
  const server = await preview({ root, preview: { port: PORT, strictPort: true }, logLevel: 'error' });
  const jpeg = path.join(work, 'sustained-24mp.jpg');
  const w = 6000; const h = 4000;
  const data = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const v = 40 + 150 * (x / w) + 30 * Math.sin(y / 17) + 25 * Math.sin(x / 3) * Math.sin(y / 4);
    data.set([v + 20, v, v - 20].map((c) => Math.max(0, Math.min(255, Math.round(c)))), (y * w + x) * 3);
  }
  await sharp(data, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 90 }).toFile(jpeg);
  const files = [jpeg, ...GENUINE];
  let failed = false;
  try {
    for (const run of RUNS.filter(({ id }) => !ONLY_RUNS || ONLY_RUNS.includes(id))) {
      const result = await runOne(run, files);
      if (!result.ok) failed = true;
      console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${JSON.stringify(result)}`);
    }
    if (!GENUINE.length) console.log('Genuine RAW files not checked: set SUSTAINED_DIR to a folder of RAW files.');
  } finally {
    await server.close();
    rmSync(work, { recursive: true, force: true });
  }
  if (failed) process.exitCode = 1;
}

main();
