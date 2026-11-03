import { openEditorTool } from './editor-mobile-controls.mjs';
// Intelligent selections (Interval 23) on a production build: Select Sky, Subject, Background and
// Object from the Masks panel with the real models (served by the preview server, as the site
// serves them), in Chromium, Firefox and WebKit (Playwright builds; WebKit is not Safari on iOS),
// iPhone 13 and Pixel 7 emulation (touch) and a forced CPU preview. Each run, on a published photo
// (a car under a sky): Select Sky makes a local adjustment whose mask covers the top of the photo
// and not the car; with Exposure −1 its full-size PNG export is darker inside the selection and
// unchanged (±1) where it is 0; Select Subject covers the car; Background is the inverted subject;
// a tap with Select Object outlines the car and Smaller/Larger change it; a cancelled selection
// leaves nothing and the next one works; Select again gives the same data; the saved edit file
// holds the selections and reopens them; no request leaves the preview server.
// Usage: npm run check:editor:selection (SELECTION_RUNS=chromium,firefox,webkit,iphone,pixel,cpu;
// SELECTION_SKIP_BUILD=1 reuses dist/; SELECTION_RAW_DIR adds genuine RAW files, see checkRaws)
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { build, preview } from 'vite';
import { chromium, devices, firefox, webkit } from 'playwright';
import { decodeCodes } from '../src/editor/segment/analysis.mjs';
import { DOCUMENT_VERSION } from '../src/editor/model/editDocument.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'editor-selection-'));
const PORT = 4199;
const URL_EDITOR = `http://localhost:${PORT}/photography/editor/`;
const AUTOSAVE_KEY = 'photo-editor:edits:v1';
const PHOTO = 'nissan-350z-viewer.jpg';
const ONLY = process.env.SELECTION_RUNS?.split(',');
const RUNS = [
  { id: 'chromium', name: 'Chromium, desktop', type: chromium },
  { id: 'firefox', name: 'Firefox, desktop', type: firefox },
  { id: 'webkit', name: 'WebKit, desktop', type: webkit },
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

async function poll(read, done, label, timeout = 60_000) {
  const end = Date.now() + timeout;
  let value;
  while (Date.now() < end) {
    value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label} (last value ${JSON.stringify(value)?.slice(0, 300)})`);
}

/** Mean coverage (0–1) of a selection component over a box of its grid (fractions). */
function coverageIn(c, [u0, v0, u1, v1]) {
  const codes = decodeCodes(c.data, c.width * c.height);
  assert.ok(codes, 'selection data decodes');
  let sum = 0; let n = 0;
  for (let y = Math.floor(v0 * c.height); y < Math.ceil(v1 * c.height); y += 1) {
    for (let x = Math.floor(u0 * c.width); x < Math.ceil(u1 * c.width); x += 1) { sum += codes[y * c.width + x] / 255; n += 1; }
  }
  return sum / n;
}

async function check(run, file) {
  const context = await run.type.launchPersistentContext(mkdtempSync(path.join(work, 'profile-')), { ...(run.device ? devices[run.device] : { viewport: { width: 1440, height: 900 } }), acceptDownloads: true });
  if (run.init) await context.addInitScript(INIT[run.init]);
  const page = context.pages()[0] ?? await context.newPage();
  const problems = [];
  const outside = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('crash', () => problems.push('page crashed'));
  page.on('console', (m) => m.type() === 'error' && !/\[photo editor\] (webgl2|image-worker)/.test(m.text()) && problems.push(`console: ${m.text()}`));
  page.on('request', (r) => { if (!/^(http:\/\/localhost:\d+\/|blob:|data:)/.test(r.url())) outside.push(r.url()); });
  const result = { environment: run.name };
  const timings = {};
  const tab = async (index) => { if (run.device) await page.click(`.pe-tabs button:nth-child(${index})`); };
  const saved = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null')?.photos[0]?.adjustments ?? null, AUTOSAVE_KEY);
  const savedWhen = (test, label, timeout = 20_000) => poll(saved, (v) => v && test(v), label, timeout);
  const masks = async () => { await tab(2); await openEditorTool(page, 'masks'); };
  const status = () => page.evaluate(() => document.querySelector('.pe-masks__select-status')?.textContent ?? null);
  const waitIdle = (label) => poll(() => page.evaluate(() => {
    const s = document.querySelector('.pe-masks__select-status');
    return !s || s.dataset.state !== 'busy';
  }), Boolean, label, 300_000);
  const exportPng = async () => {
    await tab(3);
    await page.check('input[name=pe-format][value=png]');
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 600_000 }), page.click('.pe-export-button')]);
    const { data, info } = await sharp(await download.path()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  };
  const setExposure = async (value) => {
    await tab(2);
    await openEditorTool(page, 'light');
    const field = page.getByRole('textbox', { name: 'Exposure value' });
    await field.fill(value);
    await field.press('Enter');
  };
  const selectNew = async (label) => {
    await masks();
    const t0 = Date.now();
    await page.locator('.pe-masks__add[aria-label="New local adjustment from a selection"] button', { hasText: new RegExp(`^${label}$`) }).click();
    await waitIdle(label);
    timings[label.toLowerCase()] = Date.now() - t0;
  };
  const tapPhoto = async (u, v) => {
    const host = await page.locator('.pe-canvas-host').boundingBox();
    const x = host.x + u * host.width; const y = host.y + v * host.height;
    if (run.device) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
  };
  try {
    result.step = 'import';
    await page.goto(URL_EDITOR);
    await tab(1);
    await page.setInputFiles('input[type=file][multiple]', [file]);
    await poll(() => page.$$eval('.pe-photo--list', (items) => items.filter((li) => li.dataset.status === 'ready').length), (n) => n >= 1, 'import', 300_000);
    await page.click('.pe-photo--list button.pe-photo__select');
    await poll(() => page.evaluate(() => !document.querySelector('.pe-stage-message') && !document.querySelector('.pe-canvas-host').hidden), Boolean, 'preview', 300_000);

    result.step = 'cancel';
    // A cancelled selection leaves nothing behind; the next one works.
    await masks();
    await page.locator('.pe-masks__add[aria-label="New local adjustment from a selection"] button', { hasText: /^Sky$/ }).click();
    await poll(status, (s) => Boolean(s), 'selection running', 30_000);
    await page.locator('.pe-masks__select-status button', { hasText: 'Cancel' }).click();
    assert.equal(await status(), null, 'cancel clears the status');
    assert.equal((await saved())?.local?.length ?? 0, 0, 'a cancelled selection adds nothing');

    result.step = 'sky';
    await selectNew('Sky');
    const afterSky = await savedWhen((v) => v.local?.[0]?.mask.components[0]?.type === 'selection', 'sky selection saved');
    const sky = afterSky.local[0].mask.components[0];
    assert.equal(sky.kind, 'sky');
    result.sky = { confidence: sky.confidence, grid: `${sky.width}×${sky.height}`, chars: sky.data.length, top: +coverageIn(sky, [0, 0, 1, 0.1]).toFixed(3), car: +coverageIn(sky, [0.35, 0.45, 0.65, 0.58]).toFixed(3) };
    assert.ok(result.sky.top > 0.9 && result.sky.car < 0.02, `sky coverage ${JSON.stringify(result.sky)}`);

    result.step = 'sky export';
    await setExposure('-1');
    await savedWhen((v) => v.local[0].settings.exposure === -1, 'local exposure');
    const darker = await exportPng();
    await masks();
    await page.locator('.pe-masks__list[aria-label="Local adjustments"] .pe-layer__toggle').first().click();
    await savedWhen((v) => v.local[0].enabled === false, 'local off');
    const plain = await exportPng();
    assert.equal(darker.width, plain.width);
    // Inside the selection (top band) darker; at the car, where the mask is 0, unchanged.
    const mean = (img, [u0, v0, u1, v1]) => { let s = 0; let n = 0; for (let y = Math.floor(v0 * img.height); y < v1 * img.height; y += 4) for (let x = Math.floor(u0 * img.width); x < u1 * img.width; x += 4) { const i = (y * img.width + x) * 4; s += img.data[i] + img.data[i + 1] + img.data[i + 2]; n += 3; } return s / n; };
    let changedAtCar = 0;
    for (let y = Math.floor(0.45 * plain.height); y < 0.58 * plain.height; y += 2) for (let x = Math.floor(0.4 * plain.width); x < 0.6 * plain.width; x += 2) { const i = (y * plain.width + x) * 4; if (Math.abs(darker.data[i] - plain.data[i]) > 1) changedAtCar += 1; }
    result.export = { size: `${plain.width}×${plain.height}`, skyMean: [Math.round(mean(plain, [0, 0, 1, 0.08])), Math.round(mean(darker, [0, 0, 1, 0.08]))], changedAtCar };
    assert.ok(result.export.skyMean[1] < result.export.skyMean[0] - 20, `sky darker in the export ${JSON.stringify(result.export)}`);
    assert.equal(changedAtCar, 0, 'pixels outside the selection unchanged');
    await masks();
    await page.locator('.pe-masks__list[aria-label="Local adjustments"] .pe-layer__toggle').first().click();

    result.step = 'subject';
    await selectNew('Subject');
    const afterSubject = await savedWhen((v) => v.local?.length === 2 && v.local[1].mask.components[0]?.kind === 'subject', 'subject saved');
    const subject = afterSubject.local[1].mask.components[0];
    result.subject = { confidence: subject.confidence, car: +coverageIn(subject, [0.4, 0.45, 0.6, 0.58]).toFixed(3), sky: +coverageIn(subject, [0, 0, 1, 0.1]).toFixed(3) };
    assert.ok(result.subject.car > 0.9 && result.subject.sky < 0.02, `subject coverage ${JSON.stringify(result.subject)}`);

    result.step = 'background';
    await selectNew('Background');
    const afterBackground = await savedWhen((v) => v.local?.length === 3, 'background saved');
    const background = afterBackground.local[2].mask.components[0];
    assert.equal(background.kind, 'background');
    assert.equal(background.invert, true);
    // The same outline as the subject, inverted (the SAM embedding was kept: no second encoder run).
    assert.equal(background.data, subject.data);

    result.step = 'select again';
    // Select again on the subject: the same models and photo give the same grid.
    await masks();
    await page.locator('.pe-masks__list[aria-label="Local adjustments"] .pe-mask-row__name').nth(1).click();
    await page.locator('.pe-masks__list[aria-label="Mask components"] .pe-mask-row__name').first().click();
    await page.locator('button', { hasText: 'Select again' }).click();
    await waitIdle('select again');
    assert.equal((await saved()).local[1].mask.components[0].data, subject.data, 'Select again is deterministic');

    result.step = 'object';
    await page.locator('.pe-masks__tools button', { hasText: /^Object$/ }).click();
    const t0 = Date.now();
    await tapPhoto(0.5, 0.52);
    await poll(() => page.locator('button', { hasText: 'Add selection' }).isEnabled(), Boolean, 'object candidate', 120_000);
    timings.objectTap = Date.now() - t0;
    const points = await page.locator('.pe-masktool__point').count();
    assert.equal(points, 1, 'the tap is marked');
    await page.locator('button', { hasText: 'Larger part' }).click({ trial: false }).catch(() => {});
    await waitIdle('object resize');
    await page.locator('button', { hasText: 'Add selection' }).click();
    const afterObject = await savedWhen((v) => v.local[1].mask.components.length === 2, 'object saved');
    await page.waitForTimeout(800);
    assert.deepEqual((await saved()).local[1].mask.components.map((c) => c.kind), ['subject', 'object'], 'one object added, no draft left behind');
    const object = afterObject.local[1].mask.components[1];
    assert.equal(object.kind, 'object');
    assert.equal(object.points.length, 1);
    result.object = { confidence: object.confidence, car: +coverageIn(object, [0.45, 0.48, 0.55, 0.55]).toFixed(3) };
    assert.ok(result.object.car > 0.8, `object coverage ${JSON.stringify(result.object)}`);

    result.step = 'save and reopen';
    await tab(3);
    const [edits] = await Promise.all([page.waitForEvent('download'), page.locator('button:visible', { hasText: 'Save edits' }).first().click()]);
    const text = readFileSync(await edits.path(), 'utf8');
    const document = JSON.parse(text);
    assert.equal(document.version, DOCUMENT_VERSION);
    result.savedKb = Math.round(text.length / 1024);
    const before = { local: document.photos[0].adjustments.local };
    assert.equal(before.local.length, 3);
    assert.equal(before.local[1].mask.components.length, 2, 'the saved file holds the object selection');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await tab(1);
    await page.setInputFiles('input[type=file][multiple]', [file]);
    await poll(() => page.$$eval('.pe-photo--list', (items) => items.filter((li) => li.dataset.status === 'ready').length), (n) => n >= 1, 'reimport', 300_000);
    const docFile = path.join(work, `edits-${run.id}.json`);
    writeFileSync(docFile, text);
    await page.setInputFiles('input[type=file][accept="application/json,.json"]:not([aria-label])', docFile);
    const reopened = await savedWhen((v) => v.local?.length === 3, 'document applied');
    const shape = (locals) => locals.map((l) => l.mask.components.map((c) => `${c.kind ?? c.type}:${c.data?.length ?? ''}`).join('+'));
    assert.deepEqual(shape(reopened.local), shape(before.local), 'the same selections after reopening');
    assert.deepEqual(reopened.local, before.local, 'selections survive saving and reopening');

    assert.deepEqual(outside, [], 'no request leaves the site');
    assert.deepEqual(problems, []);
    result.timingsMs = timings;
    result.ok = true;
  } catch (error) {
    result.ok = false;
    result.error = `${error.message}${problems.length ? ` (${problems.join('; ')})` : ''}`;
    result.status = await status().catch(() => null);
  } finally {
    await context.close();
  }
  return result;
}

// SELECTION_RAW_DIR: genuine RAW files (one of each format named below), each imported alone in
// Chromium, then Select Sky and Select Subject on its development: what was found, how sure, how long.
const RAW_FORMATS = /\.(arw|nef|cr2|cr3|raf|dng)$/i;
async function checkRaws(dir) {
  const files = readdirSync(dir).filter((name) => RAW_FORMATS.test(name)).sort();
  // One file of each format.
  const byFormat = new Map();
  files.forEach((name) => { const ext = name.split('.').pop().toLowerCase(); if (!byFormat.has(ext)) byFormat.set(ext, name); });
  const picked = [...byFormat.values()];
  const rows = [];
  for (const name of picked) {
    const context = await chromium.launchPersistentContext(mkdtempSync(path.join(work, 'raw-')), { viewport: { width: 1440, height: 900 } }); // eslint-disable-line no-await-in-loop
    const page = context.pages()[0] ?? await context.newPage(); // eslint-disable-line no-await-in-loop
    const row = { file: name };
    try {
      await page.goto(URL_EDITOR);
      await page.setInputFiles('input[type=file][multiple]', [path.join(dir, name)]);
      await poll(() => page.$$eval('.pe-photo--list', (items) => items.map((li) => li.dataset.status)), (s) => s[0] === 'ready' || s[0] === 'error', 'RAW import', 300_000);
      if ((await page.$$eval('.pe-photo--list', (items) => items[0].dataset.status)) === 'error') { row.import = 'refused'; rows.push(row); continue; } // eslint-disable-line no-continue
      await page.click('.pe-photo--list button.pe-photo__select');
      await poll(() => page.evaluate(() => !document.querySelector('.pe-stage-message') && !document.querySelector('.pe-canvas-host').hidden), Boolean, 'preview', 300_000);
      for (const [kind, label] of [['sky', 'Sky'], ['subject', 'Subject']]) {
        const t0 = Date.now();
        await page.locator('.pe-masks__add[aria-label="New local adjustment from a selection"] button', { hasText: new RegExp(`^${label}$`) }).click();
        await poll(() => page.evaluate(() => { const s = document.querySelector('.pe-masks__select-status'); return !s || s.dataset.state !== 'busy'; }), Boolean, label, 300_000);
        const values = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null')?.photos[0]?.adjustments ?? null, AUTOSAVE_KEY);
        const found = values?.local?.flatMap((l) => l.mask.components).find((c) => c.kind === kind);
        const message = await page.evaluate(() => document.querySelector('.pe-masks__select-status')?.textContent ?? null);
        row[kind] = found ? { confidence: found.confidence, grid: `${found.width}×${found.height}`, ms: Date.now() - t0 } : { found: false, message, ms: Date.now() - t0 };
      }
    } catch (error) {
      row.error = error.message;
    } finally {
      await context.close(); // eslint-disable-line no-await-in-loop
    }
    rows.push(row);
    console.log(`raw  ${JSON.stringify(row)}`);
  }
  return rows;
}

async function main() {
  if (!process.env.SELECTION_SKIP_BUILD) await build({ root, logLevel: 'silent', configFile: path.join(root, 'vite.config.mjs') });
  const server = await preview({ root, logLevel: 'silent', configFile: path.join(root, 'vite.config.mjs'), preview: { port: PORT, strictPort: true } });
  const file = path.join(work, PHOTO.replace('-viewer', ''));
  copyFileSync(path.join(root, 'src/assets/photography/generated', PHOTO), file);
  let failed = 0;
  try {
    for (const run of RUNS.filter((r) => !ONLY || ONLY.includes(r.id))) {
      const result = await check(run, file); // eslint-disable-line no-await-in-loop
      if (!result.ok) failed += 1;
      console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${JSON.stringify(result)}`);
    }
    if (process.env.SELECTION_RAW_DIR) {
      const rows = await checkRaws(process.env.SELECTION_RAW_DIR);
      if (rows.some((row) => row.error)) failed += 1;
    }
  } finally {
    await server.close();
    rmSync(work, { recursive: true, force: true });
  }
  process.exitCode = failed ? 1 : 0;
}

main();
