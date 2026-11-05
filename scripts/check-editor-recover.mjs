// Recover Detail (Interval 24.3) end to end on a genuine RAW image layer, in Chromium, on a
// production build: a 3000 × 2000 grey photo with the RAW (default: the harbour sample ORF, where
// Select Subject keeps the boat but not its mast) as an image layer filling the canvas; Subject on
// the layer; Recover detail strokes over the mast; then
// - pixels change only under the first stroke (export before and after);
// - overlapping edits: a second stroke and an Edge change before the first result arrives; undo
//   and redo of each; tool and layer switching while a result is pending; a cancelled export;
// - stale results never win: the final export equals a fresh session's export of the saved file
//   (every map recomputed from scratch), bit for bit;
// - edit document version 20 holds the strokes and nothing derived;
// - a version 19 document (the same edit without strokes) renders the same as in a version 19
//   editor (RECOVER_MAIN_ROOT: a built checkout of main; skipped without it).
// Usage: node scripts/check-editor-recover.mjs (RECOVER_RAW=<file>, RECOVER_SKIP_BUILD=1,
//   RECOVER_MAIN_ROOT=<checkout with dist/>, RECOVER_SAVE=<dir> keeps the exports)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { DOCUMENT_VERSION } from '../src/editor/model/editDocument.mjs';
import { RECOVER_VERSION } from '../src/editor/segment/recover.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'editor-recover-'));
const RAW = process.env.RECOVER_RAW ?? 'C:\\Users\\cheem\\Desktop\\1\\sample-orf-files-sample1.orf';
const MAIN_ROOT = process.env.RECOVER_MAIN_ROOT ?? null;
const SAVE = process.env.RECOVER_SAVE ?? null;
const AUTOSAVE_KEY = 'photo-editor:edits:v1';
const CANVAS = { width: 3000, height: 2000 };
// The mast above the cabin and a stay, in fractions of the layer's source (the harbour ORF).
const MAST = [[0.4, 0.405], [0.4005, 0.33], [0.401, 0.26], [0.4015, 0.2]];
const STAY = [[0.405, 0.4], [0.42, 0.33], [0.44, 0.26]];

const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
async function poll(read, done, label, timeout = 60_000) {
  const end = Date.now() + timeout;
  let value;
  while (Date.now() < end) {
    value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${label} (last value ${JSON.stringify(value)?.slice(0, 300)})`);
}
/** A layer-source point on the canvas (fractions), as the editor places the layer. */
function forward(layer, u, v) {
  const short = Math.min(CANVAS.width, CANVAS.height);
  const a = (layer.rotation * Math.PI) / 180;
  const x = (u - 0.5) * layer.width * short * (layer.flipH ? -1 : 1);
  const y = (v - 0.5) * layer.height * short * (layer.flipV ? -1 : 1);
  return [(layer.x * CANVAS.width + x * Math.cos(a) - y * Math.sin(a)) / CANVAS.width, (layer.y * CANVAS.height + x * Math.sin(a) + y * Math.cos(a)) / CANVAS.height];
}

const open = new Set();
/** One editor session against a preview server. */
async function session(url, files) {
  const context = await chromium.launchPersistentContext(mkdtempSync(path.join(work, 'profile-')), { viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  open.add(context);
  const page = context.pages()[0] ?? await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (m) => m.type() === 'error' && !/\[photo editor\] (webgl2|image-worker)/.test(m.text()) && problems.push(`console: ${m.text()}`));
  const saved = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null')?.photos[0]?.adjustments ?? null, AUTOSAVE_KEY);
  const savedWhen = (test, label, timeout = 30_000) => poll(saved, (v) => v && test(v), label, timeout);
  const s = {
    page, problems, saved, savedWhen,
    async open() {
      await page.goto(url);
      await page.setInputFiles('input[type=file][multiple]', [files.background]);
      await poll(() => page.$$eval('.pe-photo--list', (items) => items.filter((li) => li.dataset.status === 'ready').length), (n) => n >= 1, 'import', 300_000);
      await page.click('.pe-photo--list button.pe-photo__select');
      await poll(() => page.evaluate(() => !document.querySelector('.pe-stage-message') && !document.querySelector('.pe-canvas-host').hidden), Boolean, 'preview', 300_000);
    },
    async refined() {
      await page.locator('[data-refine=done]').waitFor({ timeout: 300_000 });
      await poll(() => page.evaluate(() => !document.querySelector('[data-layers-loading]')), Boolean, 'layers loaded', 300_000);
      await page.waitForTimeout(500);
    },
    /** Layers loaded (an export waits for every refined map itself). */
    async settle() {
      await poll(() => page.evaluate(() => !document.querySelector('[data-layers-loading]')), Boolean, 'layers loaded', 300_000);
    },
    async exportPng(name) {
      await page.check('input[name=pe-format][value=png]');
      const t0 = Date.now();
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 900_000 }), page.click('.pe-export-button')]);
      const file = await download.path();
      if (SAVE) await sharp(file).png().toFile(path.join(SAVE, `${name}.png`));
      const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return { width: info.width, height: info.height, data, ms: Date.now() - t0 };
    },
    async paint(points, layer) {
      const box = await page.locator('.pe-canvas-host').boundingBox();
      const at = ([u, v]) => { const [cu, cv] = forward(layer, u, v); return [box.x + cu * box.width, box.y + cv * box.height]; };
      const trail = points.map(at);
      await page.mouse.move(...trail[0]);
      await page.mouse.down();
      for (const p of trail.slice(1)) await page.mouse.move(...p, { steps: 6 }); // eslint-disable-line no-await-in-loop
      await page.mouse.up();
    },
    async openDocument(text, name) {
      const file = path.join(work, name);
      writeFileSync(file, text);
      await page.setInputFiles('input[type=file][accept="application/json,.json"]:not([aria-label])', file);
      await savedWhen((v) => v.layers?.length >= 1, 'document applied');
      // The layer's file is not part of the edit: reconnect it.
      await page.locator('.pe-layer[data-type=image] .pe-layer__name').click();
      await page.waitForTimeout(500);
      if (!(await page.locator('button', { hasText: 'Reconnect file…' }).count())) return;
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('button', { hasText: 'Reconnect file…' }).click()]);
      await chooser.setFiles(files.raw);
      await poll(() => page.locator('button', { hasText: 'Reconnect file…' }).count(), (n) => n === 0, 'layer reconnected', 300_000);
    },
    close: () => { open.delete(context); return context.close(); },
  };
  return s;
}

function compare(a, b) {
  assert.equal(a.width, b.width); assert.equal(a.height, b.height);
  let count = 0; let max = 0;
  for (let i = 0; i < a.data.length; i += 1) { const d = Math.abs(a.data[i] - b.data[i]); if (d) { count += 1; max = Math.max(max, d); } }
  return { count, max };
}
/** Changed pixels of two exports, and how many lie farther than `margin` canvas px from a polyline (canvas fractions). */
function changedOutside(a, b, polyline, margin) {
  const pts = polyline.map(([u, v]) => [u * a.width, v * a.height]);
  let changed = 0; let outside = 0;
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      const i = (y * a.width + x) * 4;
      if (a.data[i] === b.data[i] && a.data[i + 1] === b.data[i + 1] && a.data[i + 2] === b.data[i + 2] && a.data[i + 3] === b.data[i + 3]) continue; // eslint-disable-line no-continue
      changed += 1;
      let best = Infinity;
      for (let k = 0; k + 1 < pts.length; k += 1) {
        const [ax, ay] = pts[k]; const [bx, by] = pts[k + 1]; const dx = bx - ax; const dy = by - ay;
        const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
        best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
      }
      if (best > margin) outside += 1;
    }
  }
  return { changed, outside };
}

async function main() {
  if (!process.env.RECOVER_SKIP_BUILD) await build({ root, logLevel: 'silent', configFile: path.join(root, 'vite.config.mjs') });
  const server = await preview({ root, logLevel: 'silent', configFile: path.join(root, 'vite.config.mjs'), preview: { port: 4195, strictPort: true } });
  const mainServer = MAIN_ROOT ? await preview({ root: MAIN_ROOT, logLevel: 'silent', configFile: path.join(MAIN_ROOT, 'vite.config.mjs'), preview: { port: 4194, strictPort: true } }) : null;
  const background = path.join(work, 'grey.png');
  await sharp({ create: { ...CANVAS, channels: 3, background: '#808080' } }).png().toFile(background);
  const files = { background, raw: RAW };
  const rawHash = sha(RAW);
  const result = { raw: path.basename(RAW), timings: {} };
  const editor = 'photography/editor/';
  const a = await session(`http://localhost:4195/${editor}`, files);
  const { page } = a;
  try {
    result.step = 'RAW image layer filling the canvas, Subject, refined';
    await a.open();
    await page.setInputFiles('[data-layer-input]', RAW);
    await page.locator('.pe-layer[data-type=image]').waitFor({ timeout: 300_000 });
    const width = page.getByRole('spinbutton', { name: 'W (px)' }).first();
    await width.fill('3000'); await width.press('Tab');
    await a.savedWhen((v) => v.layers?.[0]?.width > 1.4, 'layer width');
    let t0 = Date.now();
    await page.locator('.pe-layers__props button', { hasText: /^Subject$/ }).click();
    const afterSubject = await a.savedWhen((v) => v.layers[0].mask?.components?.[0]?.kind === 'subject', 'subject', 400_000);
    await a.refined();
    result.timings.subjectAndRefineMs = Date.now() - t0;
    const layer = afterSubject.layers[0];
    const before = await a.exportPng('before');

    result.step = 'tool switching: Recover detail on, off, on';
    const recoverButton = page.getByRole('button', { name: 'Recover detail' });
    await recoverButton.click();
    assert.equal(await recoverButton.getAttribute('aria-pressed'), 'true');
    await recoverButton.click();
    assert.equal(await recoverButton.getAttribute('aria-pressed'), 'false');
    // a drag with the tool off paints nothing
    await a.paint(MAST, layer);
    await page.waitForTimeout(600);
    assert.equal((await a.saved()).layers[0].mask.components[0].recover, undefined, 'no stroke without the tool');
    await recoverButton.click();

    result.step = 'Recover detail over the mast';
    t0 = Date.now();
    await a.paint(MAST, layer);
    const one = await a.savedWhen((v) => v.layers[0].mask.components[0].recover?.strokes.length === 1, 'stroke saved');
    await a.refined();
    result.timings.firstStrokeMs = Date.now() - t0;
    assert.equal(one.layers[0].mask.components[0].recover.version, RECOVER_VERSION);
    result.foundNothingNote = await page.locator('[data-recover=empty]').count();
    const afterOne = await a.exportPng('after-stroke');
    const canvasMast = MAST.map(([u, v]) => forward(layer, u, v));
    const radiusPx = one.layers[0].mask.components[0].recover.strokes[0].radius * Math.min(layer.source.width, layer.source.height) * (layer.width * Math.min(CANVAS.width, CANVAS.height) / layer.source.width);
    result.firstStroke = { radiusCanvasPx: +radiusPx.toFixed(1), ...changedOutside(before, afterOne, canvasMast, radiusPx + 3) };
    assert.ok(result.firstStroke.changed > 200, `the mast was recovered ${JSON.stringify(result.firstStroke)}`);
    assert.equal(result.firstStroke.outside, 0, 'nothing changed outside the stroke');

    result.step = 'overlapping edits: second stroke and an Edge change before the result arrives';
    await a.paint(STAY, layer);
    const edge = page.getByRole('spinbutton', { name: /^Edge/ }).first();
    await edge.fill('-10'); await edge.press('Tab');
    const both = await a.savedWhen((v) => v.layers[0].mask.components[0].recover?.strokes.length === 2 && v.layers[0].mask.components[0].shift === -0.1, 'stroke 2 and edge');
    await a.refined();
    const read = () => page.evaluate(() => { const { data } = window.__photoEditorPreview.read(); let h = 0; for (let i = 0; i < data.length; i += 7) h = (h * 31 + data[i]) >>> 0; return h; });
    const settled = await read();

    result.step = 'undo and redo (Edge, then the stroke)';
    const undo = page.locator('.pe-bar__actions button[aria-label=Undo]');
    const redo = page.locator('.pe-bar__actions button[aria-label=Redo]');
    await undo.click();
    await a.savedWhen((v) => v.layers[0].mask.components[0].shift === 0, 'undo edge');
    await undo.click();
    await a.savedWhen((v) => v.layers[0].mask.components[0].recover?.strokes.length === 1, 'undo stroke');
    await a.refined();
    await redo.click(); await redo.click();
    await a.savedWhen((v) => v.layers[0].mask.components[0].recover?.strokes.length === 2 && v.layers[0].mask.components[0].shift === -0.1, 'redo both');
    await a.refined();
    assert.equal(await read(), settled, 'redo shows the same preview as before undo');

    result.step = 'layer switching while a result is pending';
    await page.getByRole('button', { name: 'Recover detail' }).click(); // off
    await page.locator('button.pe-button', { hasText: /^Adjustment$/ }).first().click();
    await a.savedWhen((v) => v.layers.length === 2, 'adjustment layer');
    await page.locator('.pe-layer[data-type=image] .pe-layer__name').click();
    const undoEdge = await a.saved();
    await undo.click(); // remove the adjustment layer again
    await a.savedWhen((v) => v.layers.length === 1, 'adjustment removed');
    assert.deepEqual((await a.saved()).layers[0].mask, undoEdge.layers.find((l) => l.type === 'image').mask, 'the image layer mask is untouched by switching');

    result.step = 'a cancelled export, then a complete one';
    await page.check('input[name=pe-format][value=png]');
    let downloaded = false;
    page.once('download', () => { downloaded = true; });
    await page.click('.pe-export-button');
    await page.locator('.pe-export-progress button', { hasText: /^Cancel$/ }).click({ timeout: 10_000 });
    await poll(() => page.locator('.pe-export-progress').count(), (n) => n === 0, 'export cancelled', 30_000);
    await page.waitForTimeout(1500);
    assert.equal(downloaded, false, 'a cancelled export saves nothing');
    const final = await a.exportPng('final');

    result.step = 'save: version 20, strokes kept, nothing derived';
    const [edits] = await Promise.all([page.waitForEvent('download'), page.locator('button:visible', { hasText: 'Save edits' }).first().click()]);
    const text = readFileSync(await edits.path(), 'utf8');
    const doc = JSON.parse(text);
    assert.equal(doc.version, DOCUMENT_VERSION);
    assert.equal(DOCUMENT_VERSION, 20);
    const component = doc.photos[0].adjustments.layers[0].mask.components[0];
    assert.equal(component.recover.strokes.length, 2);
    assert.ok(!('refinedKey' in component), 'no derived data saved');
    result.savedKb = Math.round(text.length / 1024);
    assert.deepEqual(a.problems, []);
    await a.close();

    result.step = 'reopen in a fresh session: every map recomputed, export identical';
    const b = await session(`http://localhost:4195/${editor}`, files);
    await b.open();
    await b.openDocument(text, 'edits-v20.json');
    await b.settle();
    const reopened = await b.exportPng('reopened');
    result.reopenedVsFinal = compare(final, reopened);
    assert.equal(result.reopenedVsFinal.count, 0, `stale or different maps: ${JSON.stringify(result.reopenedVsFinal)}`);
    assert.deepEqual((await b.saved()).layers[0].mask, doc.photos[0].adjustments.layers[0].mask);

    result.step = 'version 19 document (no strokes)';
    const legacy = JSON.parse(text);
    legacy.version = 19;
    for (const c of legacy.photos[0].adjustments.layers[0].mask.components) delete c.recover;
    const legacyText = JSON.stringify(legacy);
    await b.openDocument(legacyText, 'edits-v19.json');
    await b.settle();
    const here = await b.exportPng('v19-here');
    assert.equal((await b.saved()).layers[0].mask.components[0].recover, undefined);
    assert.deepEqual(b.problems, []);
    await b.close();
    if (mainServer) {
      const m = await session(`http://localhost:4194/${editor}`, files);
      await m.open();
      await m.openDocument(legacyText, 'edits-v19.json');
      await m.settle();
      const there = await m.exportPng('v19-main');
      result.v19VsMain = compare(here, there);
      assert.equal(result.v19VsMain.count, 0, `a version 19 document renders differently: ${JSON.stringify(result.v19VsMain)}`);
      await m.close();
    } else result.v19VsMain = 'skipped (RECOVER_MAIN_ROOT not set)';
    assert.equal(sha(RAW), rawHash, 'the RAW file is unchanged');
    result.ok = true;
  } catch (error) {
    result.ok = false;
    result.error = error.message;
  } finally {
    for (const context of open) await context.close().catch(() => {}); // eslint-disable-line no-await-in-loop
    await server.close();
    await mainServer?.close();
    try { rmSync(work, { recursive: true, force: true }); } catch { /* a browser still releasing its profile */ }
  }
  console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${JSON.stringify(result)}`);
  process.exitCode = result.ok ? 0 : 1;
}

main();
