// QuangEdit Recipe check of /photography/editor on a production build in Chromium, Firefox and
// WebKit (Playwright builds; WebKit is not Safari on iOS), iPhone 13 and Pixel 7 emulation and a
// forced CPU preview. Each run: a photo with crop, a text layer and a masked local adjustment;
// invalid JSON is refused with its errors; a pasted recipe is reviewed (summary, changes,
// before/after) and Cancel changes nothing; Merge and Replace apply and keep crop, layer and mask;
// undo/redo; Copy settings (clipboard or its fallback), Save as recipe, Export and Import; a
// recipe whose LUT is missing is blocked until the right .cube (by SHA-256) is reimported, a wrong
// one is refused; batch application to PNG, JPEG and WebP photos with batch undo; PNG export equal
// to the Node reference; no horizontal scroll at phone width; no network requests. With
// RECIPE_FIXTURE_DIR (genuine Sony .ARW and .JPG files) Chromium and Firefox also apply a recipe
// to a genuine JPEG and RAW and export them, and Chromium to a merged RAW HDR.
// Usage: npm run check:editor:recipes (RECIPE_RUNS=chromium,firefox to limit the runs)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { createEditDocument, serializeEditDocument } from '../src/editor/model/editDocument.mjs';
import { RECIPE_FORMAT, parseRecipe, serializeRecipe } from '../src/editor/model/recipes.mjs';
import { EXAMPLE_RECIPES } from '../src/editor/model/recipeReference.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'editor-recipes-'));
const fixtures = path.join(work, 'fixtures');
mkdirSync(fixtures, { recursive: true });
const PORT = 4193;
const URL_EDITOR = `http://localhost:${PORT}/photography/editor/`;
const ONLY_RUNS = process.env.RECIPE_RUNS?.split(',');
const GENUINE_DIR = process.env.RECIPE_FIXTURE_DIR ?? '';
const GENUINE = GENUINE_DIR && existsSync(GENUINE_DIR) ? readdirSync(GENUINE_DIR).sort().map((name) => path.join(GENUINE_DIR, name)) : [];
const RAW_FILES = GENUINE.filter((file) => /\.arw$/i.test(file));
const JPEG_FILES = GENUINE.filter((file) => /\.jpe?g$/i.test(file));
const AUTOSAVE_KEY = 'photo-editor:edits:v1';
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

const RUNS = [
  { id: 'chromium', name: 'Chromium, desktop', type: chromium, genuine: true, hdr: true, clipboard: true },
  { id: 'firefox', name: 'Firefox, desktop', type: firefox, genuine: true },
  { id: 'webkit', name: 'WebKit, desktop', type: webkit },
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

/** A deterministic photo-like RGBA image with a transparent corner. */
function pattern(width, height, { alpha = false, seed: start = 11 } = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = start;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const t = x / width;
      const v = 40 + 150 * t + 30 * Math.sin(y / 17) + 25 * Math.sin(x / 3) * Math.sin(y / 4) + (rand() - 0.5) * 16;
      let rgb = [v + 30 * (1 - t), v, v - 30 * t];
      if (y > height * 0.55 && y < height * 0.75 && x < width * 0.3) rgb = [214, 168, 140];
      if (y > height * 0.55 && y < height * 0.75 && x > width * 0.35 && x < width * 0.6) rgb = [50, 150, 70];
      data.set([...rgb.map((c) => Math.max(0, Math.min(255, Math.round(c)))), 255], i);
      if (alpha && x < width / 6 && y > height * 0.85) data.set([0, 0, 0, 0], i);
    }
  }
  return { width, height, data };
}

const CUBE = (warm) => `TITLE "Recipe check ${warm ? 'warm' : 'cool'}"\nLUT_3D_SIZE 2\n${[0, 1].flatMap((b) => [0, 1].flatMap((g) => [0, 1].map((r) => `${Math.min(1, r * (warm ? 1 : 0.85) + 0.05).toFixed(4)} ${g.toFixed(4)} ${Math.min(1, b * (warm ? 0.85 : 1) + 0.05).toFixed(4)}`))).join('\n')}\n`;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function makeFixtures() {
  const write = async (image, name, format) => {
    const file = path.join(fixtures, name);
    const pipeline = sharp(Buffer.from(image.data.buffer), { raw: { width: image.width, height: image.height, channels: 4 } });
    await (format === 'jpeg' ? pipeline.jpeg({ quality: 90 }) : format === 'webp' ? pipeline.webp({ lossless: true }) : pipeline.png()).toFile(file);
    return file;
  };
  const source = pattern(600, 400, { alpha: true });
  const second = pattern(480, 320, { seed: 5 });
  const files = {
    source,
    second,
    sourceFile: await write(source, 'recipe-source.png'),
    secondFile: await write(second, 'recipe-second.png'),
    jpegFile: await write(pattern(400, 300, { seed: 7 }), 'recipe-third.jpg', 'jpeg'),
    webpFile: await write(pattern(360, 240, { seed: 9 }), 'recipe-fourth.webp', 'webp'),
    lutFile: path.join(fixtures, 'warm.cube'),
    wrongLutFile: path.join(fixtures, 'cool.cube'),
  };
  writeFileSync(files.lutFile, CUBE(true));
  writeFileSync(files.wrongLutFile, CUBE(false));
  files.lutSha = sha256(readFileSync(files.lutFile));
  // Source-specific state of the first photo, opened as a saved edits file: crop, text, a mask.
  const size = readFileSync(files.sourceFile).length;
  const adjustments = normalizeAdjustments({
    contrast: 30,
    saturation: 15,
    geometry: { angle: 4, aspect: '1:1', crop: { x: 0.2, y: 0, width: 0.6, height: 1 } },
    layers: [{ id: 'l1', type: 'text', text: 'Recipe check', x: 0.5, y: 0.8 }],
    local: [{ id: 'm1', name: 'Top', mask: { space: 'image', components: [{ id: 'c1', type: 'linear', x0: 0.5, y0: 0, x1: 0.5, y1: 0.5 }] }, settings: { exposure: -0.5 } }],
  });
  files.sourceAdjustments = adjustments;
  files.editsFile = path.join(fixtures, 'edits.json');
  writeFileSync(files.editsFile, serializeEditDocument(createEditDocument([{ name: 'recipe-source.png', size, lastModified: 0, sha256: null, format: 'png', width: 600, height: 400, adjustments }], {})));
  files.recipe = serializeRecipe(EXAMPLE_RECIPES[1]);
  files.natural = serializeRecipe(EXAMPLE_RECIPES[0]);
  files.lutRecipe = serializeRecipe({ format: RECIPE_FORMAT, version: 1, name: 'Warm LUT', adjustments: { color: { vibrance: 8 } }, lut: { name: 'warm.cube', sha256: files.lutSha, intensity: 70 } });
  files.recipeFile = path.join(fixtures, 'imported.quangedit-recipe.json');
  writeFileSync(files.recipeFile, serializeRecipe({ ...EXAMPLE_RECIPES[0], name: 'Imported Daylight' }));
  return files;
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

/** The Node reference of a PNG export without layers or masks: warp, render, coverage. */
function reference(image, adjustments) {
  const values = normalizeAdjustments(adjustments);
  const sizes = exportGeometry(values.geometry, image, { mode: 'original' });
  const spec = warpSpec(sizes.plan, sizes.output, image);
  const warped = warpImage(image, spec.matrix, spec);
  const data = renderAnyImage(warped, deriveParams(values), { nativeWidth: sizes.plan.native.width, nativeHeight: sizes.plan.native.height });
  finishRows(spec, data, 0, spec.height, false);
  return { width: spec.width, height: spec.height, data };
}

function maxDifference(expected, actual) {
  let max = 0;
  for (let i = 0; i < expected.data.length; i += 4) {
    if (expected.data[i + 3] < 255 || actual[i + 3] < 255) continue;
    for (let c = 0; c < 3; c += 1) max = Math.max(max, Math.abs(expected.data[i + c] - actual[i + c]));
  }
  return max;
}

const reusable = (a) => {
  const { geometry, layers, local, grainSeed, ...rest } = normalizeAdjustments(a);
  return rest;
};
const specific = (a) => {
  const { geometry, layers, local, grainSeed, raw, rawTemperature, rawTint, hdrHighlights, hdrShadows } = normalizeAdjustments(a);
  return JSON.stringify({ geometry, layers, local, grainSeed, raw, rawTemperature, rawTint, hdrHighlights, hdrShadows });
};

async function runOne(run, files) {
  const profile = mkdtempSync(path.join(work, 'profile-'));
  const context = await run.type.launchPersistentContext(profile, { ...(run.device ? devices[run.device] : { viewport: { width: 1440, height: 900 } }), acceptDownloads: true });
  if (run.clipboard) await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://localhost:${PORT}` });
  if (run.init) await context.addInitScript(INIT[run.init]);
  const page = context.pages()[0] ?? await context.newPage();
  const problems = [];
  const requests = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('crash', () => problems.push('page crashed'));
  page.on('console', (message) => message.type() === 'error' && !/\[photo editor\] (webgl2|image-worker)/.test(message.text()) && problems.push(`console: ${message.text()}`));
  page.on('request', (request) => { if (!/^(http:\/\/localhost:\d+\/|blob:|data:)/.test(request.url())) requests.push(request.url()); });
  const result = { environment: run.name, browser: `${run.type.name()} ${context.browser()?.version() ?? ''}`.trim() };
  const touch = Boolean(run.device);
  const tab = async (index) => { if (run.device) await page.click(`.pe-tabs button:nth-child(${index})`); };
  const step = async (name, fn) => { result.step = name; return fn(); };
  const dialog = page.locator('.pe-dialog[role=dialog]');
  const openRecipes = async () => {
    await tab(2);
    const toggle = page.locator('.pe-section[data-section-id=recipes] .pe-section__toggle');
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
    await poll(() => page.evaluate(() => !document.querySelector('.pe-stage-message') && !document.querySelector('.pe-canvas-host').hidden), Boolean, 'preview', 300_000);
  };
  const saved = async (name) => page.evaluate(([key, file]) => JSON.parse(localStorage.getItem(key) ?? 'null')?.photos.find((p) => p.source.name === file)?.adjustments ?? null, [AUTOSAVE_KEY, name]);
  const savedWhen = (name, test, label) => poll(() => saved(name), (value) => Boolean(value) && test(normalizeAdjustments(value)), label, 15_000).then(normalizeAdjustments);
  const exportPng = async () => {
    await tab(3);
    await page.check('input[name=pe-format][value=png]');
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 300_000 }), page.click('.pe-export-button')]);
    const { data, info } = await sharp(await download.path()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  };
  const exportJpeg = async () => {
    await tab(3);
    await page.check('input[name=pe-format][value=jpeg]');
    const started = Date.now();
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 900_000 }), page.click('.pe-export-button')]);
    const meta = await sharp(await download.path()).metadata();
    return { ms: Date.now() - started, size: `${meta.width}×${meta.height}`, name: download.suggestedFilename() };
  };
  // Opens Paste settings (from the Recipes section, or the batch panel) and enters `text`.
  const review = async (text, { batch = false } = {}) => {
    if (batch) { await tab(1); await page.click('.pe-batch__actions button:has-text("Recipe")'); }
    else { await openRecipes(); await page.getByRole('button', { name: 'Paste settings…' }).click(); }
    await dialog.waitFor();
    const started = Date.now();
    await dialog.getByRole('textbox', { name: 'Recipe JSON' }).fill(text);
    if (!text.trim().startsWith('{ not')) await dialog.locator('.pe-recipe__summary h3').waitFor();
    return Date.now() - started;
  };
  const applyButton = () => dialog.locator('.pe-dialog__foot button.pe-button--primary');

  try {
    await step('load and a photo with crop, a text layer and a mask', async () => {
      await page.goto(URL_EDITOR, { waitUntil: 'load' });
      await page.waitForSelector('.pe[data-engine]', { timeout: 15_000 });
      result.engine = await page.$eval('.pe', (e) => e.dataset.engine);
      if (run.expectEngine) assert.equal(result.engine, run.expectEngine);
      await importFiles([files.sourceFile, files.secondFile, files.jpegFile, files.webpFile], 4);
      await tab(1);
      await page.setInputFiles('input[type=file][accept="application/json,.json"]:not([aria-label])', files.editsFile);
      const restored = await savedWhen('recipe-source.png', (a) => a.layers.length === 1 && a.local.length === 1, 'edits restored');
      assert.equal(restored.geometry.angle, 4);
      await select('recipe-source.png');
    });
    const before = await saved('recipe-source.png').then(normalizeAdjustments);

    await step('invalid recipes are refused with their errors', async () => {
      await review('{ not json');
      await dialog.getByRole('alert').waitFor();
      assert.match(await dialog.getByRole('alert').textContent(), /not valid JSON/);
      await dialog.getByRole('textbox', { name: 'Recipe JSON' }).fill(JSON.stringify({ format: RECIPE_FORMAT, version: 1, name: 'Bad', adjustments: { light: { contrast: 500, geometry: 1 } }, script: 'alert(1)' }));
      const text = await dialog.getByRole('alert').textContent();
      ['Unknown field "script"', 'contrast must be between -100 and 100', 'Unknown field adjustments.light.geometry'].forEach((part) => assert.ok(text.includes(part), `missing error: ${part}`));
      assert.equal(await applyButton().isDisabled(), true);
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await dialog.waitFor({ state: 'detached' });
    });

    await step('review shows summary, changes and before/after; Cancel changes nothing', async () => {
      result.reviewMs = await review(files.recipe);
      assert.equal(await dialog.locator('.pe-recipe__summary h3').textContent(), 'Cinematic Night');
      assert.equal(await dialog.locator('.pe-recipe__compare canvas').count(), 2);
      const rows = await dialog.locator('.pe-recipe__changes tbody tr').count();
      assert.ok(rows >= 5, `only ${rows} changed settings listed`);
      const sizes = await dialog.locator('.pe-recipe__compare canvas').evaluateAll((canvases) => canvases.map((c) => c.width * c.height));
      assert.ok(sizes.every((n) => n > 0), 'before/after canvases are empty');
      if (touch) {
        const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - window.innerWidth, dialog: Math.round(document.querySelector('.pe-dialog').getBoundingClientRect().width), viewport: window.innerWidth, apply: Math.round(document.querySelector('.pe-dialog__foot .pe-button--primary').getBoundingClientRect().height) }));
        result.mobile = layout;
        assert.ok(layout.overflow <= 0, `page scrolls sideways by ${layout.overflow}px`);
        assert.ok(layout.dialog <= layout.viewport, 'the dialog is wider than the screen');
        assert.ok(layout.apply >= 44, `Apply is ${layout.apply}px tall`);
      }
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await dialog.waitFor({ state: 'detached' });
      await page.waitForTimeout(400);
      assert.deepEqual(await saved('recipe-source.png').then(normalizeAdjustments), before, 'Cancel changed the photo');
    });

    await step('merge and replace keep crop, layer and mask; undo and redo', async () => {
      await review(files.recipe);
      await dialog.getByRole('button', { name: 'Merge settings' }).click();
      const started = Date.now();
      await applyButton().click();
      const merged = await savedWhen('recipe-source.png', (a) => a.filter?.id === 'look:cinematic-cool', 'merge applied');
      result.applyMs = Date.now() - started;
      assert.equal(merged.contrast, 30, 'merge reset a setting the recipe does not state');
      assert.equal(merged.highlights, -35);
      assert.equal(specific(merged), specific(before), 'merge changed photo-specific state');
      await review(files.natural);
      await applyButton().click();
      const replaced = await savedWhen('recipe-source.png', (a) => a.exposure === 0.15, 'replace applied');
      assert.equal(replaced.contrast, 8);
      assert.equal(replaced.saturation, 0, 'replace kept a Color setting the recipe leaves out');
      assert.equal(specific(replaced), specific(before), 'replace changed photo-specific state');
      if (!touch) {
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press(`${MOD}+z`);
        await savedWhen('recipe-source.png', (a) => a.exposure === 0 && a.filter?.id === 'look:cinematic-cool', 'undo');
        await page.keyboard.press(`${MOD}+z`);
        await savedWhen('recipe-source.png', (a) => JSON.stringify(a) === JSON.stringify(before), 'undo to before');
        await page.keyboard.press(`${MOD}+Shift+z`);
        await page.keyboard.press(`${MOD}+Shift+z`);
        await savedWhen('recipe-source.png', (a) => a.exposure === 0.15, 'redo');
      }
    });

    await step('Copy settings, Save as recipe, Export and Import', async () => {
      await openRecipes();
      await page.getByRole('button', { name: 'Copy settings…' }).click();
      await dialog.waitFor();
      const json = await dialog.getByRole('textbox', { name: 'Recipe JSON' }).inputValue();
      const recipe = parseRecipe(json);
      ['geometry', 'layers', 'local', 'grainSeed', 'Recipe check', 'recipe-source'].forEach((word) => assert.ok(!json.includes(word), `copied JSON contains ${word}`));
      assert.equal(recipe.adjustments.light.exposure, 0.15);
      await dialog.getByRole('button', { name: 'Copy JSON' }).click();
      const status = await poll(() => dialog.locator('.pe-dialog__summary').textContent(), (text) => /Copied|selected/.test(text), 'copy status');
      result.clipboard = /Copied/.test(status) ? 'clipboard' : 'fallback (selected)';
      // The Windows clipboard stores CRLF line ends.
      if (run.clipboard) assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n'), json);
      await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Check Daylight');
      await dialog.getByRole('button', { name: 'Save as recipe' }).click();
      const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Export JSON' }).click()]);
      assert.equal(download.suggestedFilename(), 'check-daylight.quangedit-recipe.json');
      assert.equal(parseRecipe(readFileSync(await download.path(), 'utf8')).name, 'Check Daylight');
      await dialog.getByRole('button', { name: 'Close Copy settings' }).click();
      await page.setInputFiles('input[type=file][aria-label="Import recipe"]', files.recipeFile);
      await page.getByRole('button', { name: 'Review and apply Imported Daylight' }).waitFor();
      await page.getByRole('button', { name: 'Review and apply Check Daylight' }).click();
      await dialog.locator('.pe-recipe__summary h3').waitFor();
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await dialog.waitFor({ state: 'detached' });
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('.pe[data-engine]');
      await openRecipes();
      await page.getByRole('button', { name: 'Review and apply Check Daylight' }).waitFor();
      await importFiles([files.sourceFile, files.secondFile, files.jpegFile, files.webpFile], 4);
      await select('recipe-source.png');
    });

    await step('a missing LUT blocks Apply; a wrong file is refused; the right one applies', async () => {
      await review(files.lutRecipe);
      await dialog.getByRole('group', { name: 'Missing LUT' }).waitFor();
      assert.equal(await applyButton().isDisabled(), true);
      await dialog.locator('input[aria-label="Import the recipe\'s LUT"]').setInputFiles(files.wrongLutFile);
      await poll(() => dialog.getByRole('alert').textContent().catch(() => ''), (text) => /different LUT/.test(text), 'wrong LUT refused');
      assert.equal(await applyButton().isDisabled(), true);
      await dialog.locator('input[aria-label="Import the recipe\'s LUT"]').setInputFiles(files.lutFile);
      await dialog.getByRole('group', { name: 'Missing LUT' }).waitFor({ state: 'detached' });
      await applyButton().click();
      const withLut = await savedWhen('recipe-source.png', (a) => a.lut?.sha256 === files.lutSha, 'LUT applied');
      assert.equal(withLut.lutIntensity, 70);
    });

    await step('batch: PNG, JPEG and WebP; per-photo settings kept; batch undo; export equals the reference', async () => {
      const others = ['recipe-second.png', 'recipe-third.jpg', 'recipe-fourth.webp'];
      await tab(1);
      if (touch) await page.getByRole('button', { name: 'Select…' }).click();
      if (touch) for (const name of others) await page.click(`.pe-photo--list button.pe-photo__select[aria-label^="${name}"]`);
      else { await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press(`${MOD}+a`); }
      const beforeBatch = Object.fromEntries(await Promise.all(['recipe-source.png', ...others].map(async (name) => [name, normalizeAdjustments(await saved(name) ?? {})])));
      result.batchReviewMs = await review(files.recipe, { batch: true });
      assert.equal(await dialog.locator('.pe-batch-plan__item').count(), 4);
      assert.equal(await dialog.locator('.pe-batch-plan__thumbs canvas').count(), 8);
      await applyButton().click();
      for (const name of others) await savedWhen(name, (a) => a.filter?.id === 'look:cinematic-cool', `${name} batch`);
      const source = await savedWhen('recipe-source.png', (a) => a.filter?.id === 'look:cinematic-cool', 'source batch');
      assert.equal(specific(source), specific(beforeBatch['recipe-source.png']), 'batch changed photo-specific state');
      assert.equal(source.lut?.sha256, files.lutSha, 'batch replaced a group the recipe does not contain');
      await tab(1);
      await page.locator('.pe-batch__history button', { hasText: /^Undo recipe/ }).click();
      for (const [name, value] of Object.entries(beforeBatch)) await savedWhen(name, (a) => JSON.stringify(reusable(a)) === JSON.stringify(reusable(value)), `${name} batch undo`);
      await page.locator('.pe-batch__history button', { hasText: /^Redo recipe/ }).click();
      const second = await savedWhen('recipe-second.png', (a) => a.filter?.id === 'look:cinematic-cool', 'batch redo');
      if (touch) { await tab(1); await page.getByRole('button', { name: 'Done selecting' }).click(); }
      await select('recipe-second.png');
      const png = await exportPng();
      const diff = maxDifference(reference(files.second, second), png.data);
      result.exportMaxDifference = diff;
      assert.ok(diff <= 1, `PNG export differs from the reference by ${diff}`);
    });

    await step('recipe instructions', async () => {
      await openRecipes();
      await page.getByRole('button', { name: 'Recipe instructions' }).click();
      const text = await dialog.getByRole('textbox', { name: 'Recipe instructions' }).inputValue();
      assert.ok(text.startsWith('# QuangEdit Recipe v1') && text.includes('filter:classic-ccd'));
      await dialog.getByRole('button', { name: 'Close Recipe instructions' }).click();
    });

    if (run.genuine && (JPEG_FILES.length || RAW_FILES.length)) {
      await step('genuine JPEG and Sony RAW: recipe applied, RAW development kept, full-size export', async () => {
        result.genuine = {};
        for (const file of [JPEG_FILES[0], RAW_FILES[0]].filter(Boolean)) {
          const name = path.basename(file);
          const count = await page.$$eval('.pe-photo--list', (items) => items.length);
          await importFiles([file], count + 1);
          await select(name);
          const start = normalizeAdjustments(await saved(name) ?? {});
          await review(files.natural);
          await applyButton().click();
          const after = await savedWhen(name, (a) => a.exposure === 0.15, `${name} recipe`);
          assert.equal(specific(after), specific(start));
          result.genuine[name] = await exportJpeg();
        }
      });
    }
    if (run.hdr && RAW_FILES.length >= 3) {
      await step('merged RAW HDR: recipe keeps the tone mapping; export', async () => {
        await tab(1);
        await page.click('.pe-library__actions button:has-text("Merge HDR")');
        await dialog.waitFor();
        await page.setInputFiles('.pe-dialog input[type=file][multiple]', RAW_FILES.slice(0, 3));
        await poll(() => page.$$eval('.pe-bracket__item', (items) => items.map((li) => li.dataset.status)), (s) => s.length === 3 && s.every((v) => v !== 'reading'), 'bracket inputs', 300_000);
        await page.click('.pe-dialog__foot button:has-text("Merge")');
        await page.waitForSelector('.pe-dialog', { state: 'detached', timeout: 600_000 });
        await poll(() => page.evaluate(() => !document.querySelector('.pe-stage-message')), Boolean, 'merged preview', 300_000);
        const name = await page.$eval('.pe-photo--list[aria-current], .pe-photo--list[data-active]', (li) => li.textContent).catch(() => null);
        await review(files.recipe);
        await applyButton().click();
        await page.waitForTimeout(500);
        result.hdr = { photo: name?.slice(0, 60) ?? 'merged', ...(await exportJpeg()) };
        assert.match(result.hdr.name, /-HDR-quangedit\.jpg$/);
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
  if (!GENUINE.length) console.log('Genuine photos not checked: set RECIPE_FIXTURE_DIR to a folder with Sony .ARW and .JPG files.');
  if (results.some(({ ok }) => !ok)) process.exitCode = 1;
}

await main();
