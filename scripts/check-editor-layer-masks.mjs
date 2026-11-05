// Image layer masks and Detail adjustment layers (Interval 24.1) on a production build, with the
// real selection models, in Chromium, Firefox and WebKit (Playwright builds; WebKit is not Safari
// on iOS), iPhone 13 and Pixel 7 emulation (touch) and a forced CPU preview. The workflow: a
// background photo (6 MP), a car photo added as an image layer, Mask from Subject on the layer
// (the layer's own image is analysed), edge and feather refined, the layer moved, scaled and
// rotated (no new analysis, mask data unchanged), Select Object by a tap on the rotated layer
// (the tap lands at the source point under it), a clipped adjustment layer with Clarity,
// Sharpening and colour, then:
// - the full-size PNG export equals the Node reference (composite.mjs) on every opaque pixel;
// - the preview matches the export, downscaled, within a small mean difference;
// - undo/redo, save and reopen keep every part; the original files are unchanged;
// - timings and (Windows) peak browser memory of exports with and without the Detail layer.
// Usage: npm run check:editor:layer-masks (LAYER_MASK_RUNS=chromium,firefox,webkit,iphone,pixel,cpu;
// LAYER_MASK_SKIP_BUILD=1 reuses dist/; LAYER_MASK_SAVE=<dir> keeps the export and preview; LAYER_MASK_RAW_DIR=<dir> also masks each genuine RAW file
// there as an image layer in Chromium, then exports the composite)
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { build, preview } from 'vite';
import { chromium, devices, firefox, webkit } from 'playwright';
import { decodeCodes } from '../src/editor/segment/analysis.mjs';
import { DOCUMENT_VERSION } from '../src/editor/model/editDocument.mjs';
import { renderAnyImage } from '../src/editor/pipeline/detailRenderer.mjs';
import { deriveParams } from '../src/editor/pipeline/spec.mjs';
import { finishRows, warpImage, warpSpec } from '../src/editor/pipeline/warp.mjs';
import { exportGeometry } from '../src/editor/io/files.mjs';
import { normalizeAdjustments } from '../src/editor/model/adjustments.mjs';
import { settingsNeutral } from '../src/editor/model/layers.mjs';
import { layerProgram } from '../src/editor/model/layerTree.mjs';
import { maskActive } from '../src/editor/model/masks.mjs';
import { adjustmentLayerPass, compositeImageSync, groupPass, rasterPass } from '../src/editor/pipeline/composite.mjs';
import { layerMatrix, rasterSize } from '../src/editor/pipeline/layerTransform.mjs';
import { canvasMaskMap, layerMaskMap } from '../src/editor/pipeline/mask.mjs';
import { openEditorTool } from './editor-mobile-controls.mjs';
import { REFINE_VERSION, refineSelection, refineSize } from '../src/editor/segment/refine.mjs';
import { registerRefined } from '../src/editor/segment/selectionMask.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'editor-layer-masks-'));
const PORT = 4197;
const URL_EDITOR = `http://localhost:${PORT}/photography/editor/`;
const AUTOSAVE_KEY = 'photo-editor:edits:v1';
const ONLY = process.env.LAYER_MASK_RUNS?.split(',');
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
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

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
  const loop = (async () => { while (running) { const m = await memoryMb(profile); if (m) peaks.push(m); await new Promise((r) => setTimeout(r, 300)); } })();
  return () => { running = false; loop.catch(() => {}); return peaks.length ? Math.max(...peaks) : null; };
}

/** Mean coverage (0–1) of a selection over a box of its grid (fractions of the source). */
function coverageIn(c, [u0, v0, u1, v1]) {
  const codes = decodeCodes(c.data, c.width * c.height);
  assert.ok(codes, 'selection data decodes');
  let sum = 0; let n = 0;
  for (let y = Math.floor(v0 * c.height); y < Math.ceil(v1 * c.height); y += 1) for (let x = Math.floor(u0 * c.width); x < Math.ceil(u1 * c.width); x += 1) { sum += codes[y * c.width + x] / 255; n += 1; }
  return +(sum / n).toFixed(3);
}

/** Canvas fraction of a source point (u, v) of an image layer (layerTransform's placement). */
function forward(layer, canvas, u, v) {
  const short = Math.min(canvas.width, canvas.height);
  const a = (layer.rotation * Math.PI) / 180;
  const x = (u - 0.5) * layer.width * short * (layer.flipH ? -1 : 1);
  const y = (v - 0.5) * layer.height * short * (layer.flipV ? -1 : 1);
  return [(layer.x * canvas.width + x * Math.cos(a) - y * Math.sin(a)) / canvas.width, (layer.y * canvas.height + x * Math.sin(a) + y * Math.cos(a)) / canvas.height];
}

/** The Node reference of the PNG export: the background's reference render, then every layer through composite.mjs. */
function reference(base, adjustments, rasters) {
  const values = normalizeAdjustments(adjustments);
  const sizes = exportGeometry(values.geometry, base, { mode: 'original' });
  const spec = warpSpec(sizes.plan, sizes.output, base);
  const data = renderAnyImage(warpImage(base, spec.matrix, spec), deriveParams(values), { nativeWidth: sizes.plan.native.width, nativeHeight: sizes.plan.native.height });
  finishRows(spec, data, 0, spec.height, false);
  const out = { width: spec.width, height: spec.height, data };
  const passes = layerProgram(values.layers).map((step) => {
    if (step.op !== 'layer') return groupPass(step);
    const { layer } = step;
    const mask = maskActive(layer.mask) ? layer.mask : null;
    if (layer.type === 'adjustment') return adjustmentLayerPass(layer, null, mask && { def: mask, map: canvasMaskMap(out) }, sizes.output);
    const raster = rasters[layer.source.sha256];
    assert.deepEqual(rasterSize(layer, out), { width: raster.width, height: raster.height }, 'the layer would be resampled by the browser');
    assert.ok(settingsNeutral(layer.settings));
    const matrix = layerMatrix(layer, out, raster);
    return rasterPass(layer, raster, matrix, out, mask && { def: refinedReference(mask, raster), map: layerMaskMap(matrix, raster) });
  });
  return compositeImageSync(out, passes);
}

/** Refined selections of a layer mask (Interval 24.2), from the layer's source as decoded here (its refinement size). */
function refinedReference(mask, source) {
  return {
    ...mask,
    components: mask.components.map((c, k) => {
      if (c.type !== 'selection' || c.refine?.version !== REFINE_VERSION) return c;
      const size = refineSize(source.width, source.height);
      assert.deepEqual(size, { width: source.width, height: source.height }, 'the source is refined at its own size');
      const key = `reference|${k}|${c.data.length}|${c.shift}|${c.feather}|${c.refine.radius}`;
      registerRefined(key, refineSelection({ width: c.width, height: c.height, codes: decodeCodes(c.data, c.width * c.height) }, source, { radius: c.refine.radius, shift: c.shift, feather: c.feather }));
      return { ...c, refinedKey: key };
    }),
  };
}

function compare(expected, actual) {
  let max = 0; let count = 0; let alpha = 0;
  for (let i = 0; i < expected.data.length; i += 4) {
    if (Math.abs(expected.data[i + 3] - actual[i + 3]) > 1) alpha += 1;
    if (expected.data[i + 3] !== 255) continue; // eslint-disable-line no-continue
    for (let c = 0; c < 3; c += 1) { const d = Math.abs(expected.data[i + c] - actual[i + c]); if (d) count += 1; max = Math.max(max, d); }
  }
  return { max, count, alphaMismatches: alpha, ok: max === 0 && alpha === 0 };
}

async function fixtures() {
  const generated = path.join(root, 'src/assets/photography/generated');
  // 6 MP background; the car layer 1100 px wide, kept at source size on the export canvas.
  const backgroundFile = path.join(work, 'shore-background.png');
  await sharp(path.join(generated, 'beach-cloud-bank-viewer.jpg')).resize(3000, 2000, { fit: 'fill' }).removeAlpha().png().toFile(backgroundFile);
  const carFile = path.join(work, 'car-layer.png');
  await sharp(path.join(generated, 'nissan-350z-viewer.jpg')).resize(1100).removeAlpha().png().toFile(carFile);
  const read = async (file) => { const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) }; };
  return { backgroundFile, carFile, background: await read(backgroundFile), car: await read(carFile), hashes: { background: sha(backgroundFile), car: sha(carFile) } };
}

async function check(run, files) {
  const profile = mkdtempSync(path.join(work, 'profile-'));
  const context = await run.type.launchPersistentContext(profile, { ...(run.device ? devices[run.device] : { viewport: { width: 1440, height: 900 } }), acceptDownloads: true });
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
  const tool = async (id) => { if (run.device) { await tab(2); await openEditorTool(page, id); } };
  const saved = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null')?.photos[0]?.adjustments ?? null, AUTOSAVE_KEY);
  const savedWhen = (test, label, timeout = 20_000) => poll(saved, (v) => v && test(v), label, timeout);
  const props = () => page.locator('.pe-layers__props');
  const busy = () => page.evaluate(() => [...document.querySelectorAll('.pe-masks__select-status, .pe-layers__props [role=status]')].some((s) => s.dataset.state === 'busy' || /Preparing|Downloading|Analysing|Outlining|Working/.test(s.textContent)));
  const idle = (label) => poll(busy, (b) => !b, label, 400_000);
  const settled = async () => {
    await poll(() => page.evaluate(() => !document.querySelector('[data-layers-loading]') && !document.querySelector('[data-detail-preview=rendering]') && !document.querySelector('[data-detail-preview=draft]')), Boolean, 'preview settled', 300_000);
    await page.waitForTimeout(400);
  };
  const setNumber = async (name, value) => { const field = page.getByRole('spinbutton', { name }).first(); await field.fill(String(value)); await field.press('Tab'); };
  const setValue = async (label, value, group) => {
    await tool(group);
    if (!run.device) {
      // Desktop: open the panel's section if it is collapsed (Detail is by default).
      const toggle = page.locator('.pe-panel--adjust .pe-section__toggle', { hasText: new RegExp(`^${group === 'detail' ? 'Detail' : group === 'color' ? 'Color' : 'Light'}$`) }).first();
      if (await toggle.count() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
    }
    const field = page.getByRole('textbox', { name: `${label} value` });
    await field.fill(value);
    await field.press('Enter');
  };
  const exportPng = async () => {
    await tab(3);
    await page.check('input[name=pe-format][value=png]');
    const peak = sampler(profile);
    const t0 = Date.now();
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 900_000 }), page.click('.pe-export-button')]);
    const file = await download.path();
    const ms = Date.now() - t0;
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { ms, peakMb: peak(), image: { width: info.width, height: info.height, data } };
  };
  const host = () => page.locator('.pe-canvas-host').boundingBox();
  const tap = async ([u, v]) => {
    const box = await host();
    const x = box.x + u * box.width; const y = box.y + v * box.height;
    if (run.device) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
  };
  try {
    result.step = 'import background, add the car as an image layer';
    await page.goto(URL_EDITOR);
    await tab(1);
    await page.setInputFiles('input[type=file][multiple]', [files.backgroundFile]);
    await poll(() => page.$$eval('.pe-photo--list', (items) => items.filter((li) => li.dataset.status === 'ready').length), (n) => n >= 1, 'import', 300_000);
    await page.click('.pe-photo--list button.pe-photo__select');
    await poll(() => page.evaluate(() => !document.querySelector('.pe-stage-message') && !document.querySelector('.pe-canvas-host').hidden), Boolean, 'preview', 300_000);
    await tool('layers');
    await page.setInputFiles('[data-layer-input]', files.carFile);
    await page.locator('.pe-layer[data-type=image]').waitFor();
    // Wider than its source on the 3000 px canvas, so the export uses the source as it is.
    await tool('layers');
    await setNumber('W (px)', 1300);
    await savedWhen((v) => v.layers?.[0]?.width > 0.64, 'layer width');

    result.step = 'Mask from Subject (the layer\'s own image)';
    await tool('layers');
    let t0 = Date.now();
    await props().locator('button', { hasText: /^Subject$/ }).click();
    await poll(busy, Boolean, 'selection started', 30_000).catch(() => {});
    await idle('subject');
    const afterSubject = await savedWhen((v) => v.layers[0].mask?.components[0]?.kind === 'subject', 'subject mask', 30_000);
    timings.subjectMs = Date.now() - t0;
    const subject = afterSubject.layers[0].mask.components[0];
    assert.equal(afterSubject.layers[0].mask.space, 'layer');
    assert.equal(afterSubject.layers[0].mask.base, 'none');
    result.subject = { confidence: subject.confidence, grid: `${subject.width}×${subject.height}`, car: coverageIn(subject, [0.4, 0.45, 0.6, 0.58]), sky: coverageIn(subject, [0, 0, 1, 0.1]) };
    assert.ok(result.subject.car > 0.9 && result.subject.sky < 0.02, `subject on the layer ${JSON.stringify(result.subject)}`);

    result.step = 'refine edge and feather';
    await tool('masks');
    const row = page.locator('.pe-masks__list[aria-label="Mask components"] .pe-mask-row__name').first();
    // The new selection is already the selected component (a click would deselect it).
    if (await row.getAttribute('aria-pressed') !== 'true') await row.click();
    await setNumber(/^Edge/, -20);
    await setNumber('Feather value (%)', 25);
    await savedWhen((v) => v.layers[0].mask.components[0].shift === -0.2 && v.layers[0].mask.components[0].feather === 0.25, 'edge refined');

    result.step = 'Refine edge: on by default, computed from the full-resolution source, can be turned off and on';
    assert.deepEqual((await saved()).layers[0].mask.components[0].refine, { version: REFINE_VERSION, radius: 0 });
    t0 = Date.now();
    const refinedNote = page.locator('[data-refine=done]');
    await refinedNote.waitFor({ timeout: 300_000 });
    timings.refineMs = Date.now() - t0;
    await page.getByRole('checkbox', { name: 'Refine edge' }).uncheck();
    await savedWhen((v) => !v.layers[0].mask.components[0].refine, 'refine off');
    await page.getByRole('checkbox', { name: 'Refine edge' }).check();
    await savedWhen((v) => v.layers[0].mask.components[0].refine?.version === REFINE_VERSION, 'refine on');
    await refinedNote.waitFor({ timeout: 300_000 });

    result.step = 'move, scale and rotate: no new analysis, mask data unchanged';
    await tool('layers');
    t0 = Date.now();
    await setNumber('X (% of width)', 38);
    await setNumber('Y (% of height)', 58);
    await setNumber('Angle (degrees)', -9);
    const moved = await savedWhen((v) => v.layers[0].rotation === -9 && v.layers[0].x === 0.38, 'transformed');
    await settled();
    timings.transformMs = Date.now() - t0;
    assert.equal(await busy(), false, 'a transform runs no selection');
    assert.equal(moved.layers[0].mask.components[0].data, subject.data, 'mask data unchanged by the transform');

    result.step = 'Select Object by a tap on the rotated layer';
    await tool('layers');
    await props().locator('button', { hasText: /^Object$/ }).click();
    const canvas = { width: files.background.width, height: files.background.height };
    t0 = Date.now();
    await tap(forward(moved.layers[0], canvas, 0.5, 0.52));
    await poll(() => page.locator('button', { hasText: 'Add selection' }).isEnabled(), Boolean, 'object candidate', 300_000);
    timings.objectTapMs = Date.now() - t0;
    await page.locator('button', { hasText: 'Add selection' }).click();
    const afterObject = await savedWhen((v) => v.layers[0].mask.components.length === 2, 'object added');
    const object = afterObject.layers[0].mask.components[1];
    const [pu, pv] = object.points[0];
    result.object = { tap: [+pu.toFixed(4), +pv.toFixed(4)], confidence: object.confidence, car: coverageIn(object, [0.45, 0.48, 0.55, 0.55]) };
    // The point stored is the source point under the tap (one screen pixel of the fitted view).
    const tolerance = 2 / Math.min((await host()).width * moved.layers[0].width * (Math.min(canvas.width, canvas.height) / canvas.width), 1e9);
    assert.ok(Math.abs(pu - 0.5) < Math.max(0.005, tolerance) && Math.abs(pv - 0.52) < Math.max(0.005, tolerance), `tap mapped to ${result.object.tap}`);
    assert.ok(result.object.car > 0.8, `object ${JSON.stringify(result.object)}`);

    result.step = 'clipped adjustment with Detail and colour';
    await tool('layers');
    await page.locator('.pe-layer[data-type=image] .pe-layer__name').click();
    await props().locator('button', { hasText: 'Add clipped adjustment' }).click();
    await page.locator('.pe-layer[data-clip] .pe-layer__name').waitFor();
    if (run.device) await page.locator('.pe-layers__props button', { hasText: 'Edit adjustment settings' }).click();
    await page.waitForSelector('.pe-adjust-target');
    await setValue('Exposure', '-0.3', 'light');
    await setValue('Temperature', '12', 'color');
    await setValue('Clarity', '35', 'detail');
    await setValue('Sharpening', '50', 'detail');
    const values = await savedWhen((v) => v.layers[1]?.clip && v.layers[1].settings.sharpening === 50 && v.layers[1].settings.clarity === 35, 'detail layer');
    assert.equal(values.exposure, 0, 'the photo kept its own settings');

    result.step = 'undo and redo the Detail change';
    await page.locator('.pe-bar__actions button[aria-label=Undo]').click();
    await savedWhen((v) => v.layers[1].settings.sharpening === undefined, 'undo sharpening');
    await page.locator('.pe-bar__actions button[aria-label=Redo]').click();
    await savedWhen((v) => v.layers[1].settings.sharpening === 50, 'redo sharpening');

    result.step = 'PNG export equals the Node reference';
    await settled();
    // The preview's own pixels (window.__photoEditorPreview, the output frame at preview size):
    // Playwright's WebKit on Windows can screenshot a stale WebGL frame.
    const png = await page.evaluate(() => {
      const { width, height, data } = window.__photoEditorPreview.read();
      const scratch = Object.assign(document.createElement('canvas'), { width, height });
      scratch.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
      return scratch.toDataURL('image/png').split(',')[1];
    });
    const shot = await sharp(Buffer.from(png, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const full = await exportPng();
    timings.exportMs = full.ms;
    // LAYER_MASK_SAVE=<dir>: the export and the preview, for looking at the edges.
    if (process.env.LAYER_MASK_SAVE) {
      await sharp(Buffer.from(full.image.data), { raw: { width: full.image.width, height: full.image.height, channels: 4 } }).png().toFile(path.join(process.env.LAYER_MASK_SAVE, `export-${run.id}.png`));
      await sharp(shot.data, { raw: { width: shot.info.width, height: shot.info.height, channels: 4 } }).png().toFile(path.join(process.env.LAYER_MASK_SAVE, `preview-${run.id}.png`));
    }
    result.exportPeakMb = full.peakMb;
    const finalValues = await saved();
    const expected = reference(files.background, finalValues, { [files.hashes.car]: files.car });
    result.exportVsReference = compare(expected, full.image.data);
    assert.ok(result.exportVsReference.ok, `export differs from the reference: ${JSON.stringify(result.exportVsReference)}`);
    // The mask, the Detail layer and the colour changed the car only: the background far from it is unchanged.
    assert.deepEqual(Array.from(full.image.data.slice(0, 4)), Array.from(files.background.data.slice(0, 4)));

    result.step = 'preview matches the export';
    // Both at half the shown size (sub-pixel placement of the displayed canvas, at fractional
    // device pixel ratios, otherwise dominates), without a 2-pixel border and the corner where a
    // preview watermark may be drawn. The car layer's box is compared with the rest of the frame:
    // the layers must match as well as the photo itself does.
    const cw = Math.round(shot.info.width / 2);
    const ch = Math.round(shot.info.height / 2);
    const half = (input, raw) => sharp(input, raw ? { raw } : undefined).resize(cw, ch, { fit: 'fill' }).removeAlpha().raw().toBuffer();
    const shown = await half(shot.data, { width: shot.info.width, height: shot.info.height, channels: 4 });
    const exported = await half(Buffer.from(full.image.data), { width: full.image.width, height: full.image.height, channels: 4 });
    const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => forward(finalValues.layers[0], canvas, u, v));
    const box = { x0: Math.min(...corners.map(([x]) => x)) * cw, x1: Math.max(...corners.map(([x]) => x)) * cw, y0: Math.min(...corners.map(([, y]) => y)) * ch, y1: Math.max(...corners.map(([, y]) => y)) * ch };
    const layerDiffs = [];
    const otherDiffs = [];
    for (let y = 2; y < ch - 2; y += 1) {
      for (let x = 2; x < cw - 2; x += 1) {
        if (x > cw * 0.82 && y > ch * 0.84) continue; // eslint-disable-line no-continue
        const i = (y * cw + x) * 3;
        const d = (Math.abs(shown[i] - exported[i]) + Math.abs(shown[i + 1] - exported[i + 1]) + Math.abs(shown[i + 2] - exported[i + 2])) / 3;
        (x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1 ? layerDiffs : otherDiffs).push(d);
      }
    }
    const stats = (values) => { const sorted = [...values].sort((a, b) => a - b); return { mean: +(sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(2), p99: +sorted[Math.floor(sorted.length * 0.99)].toFixed(1) }; };
    result.previewVsExport = { size: `${cw}×${ch}`, layer: stats(layerDiffs), photo: stats(otherDiffs) };
    const { layer: ld, photo: pd } = result.previewVsExport;
    assert.ok(ld.mean < 3 && ld.mean <= pd.mean + 1.5 && ld.p99 <= pd.p99 + 10, `preview differs from the export ${JSON.stringify(result.previewVsExport)}`);

    result.step = 'export without the Detail layer (timing and memory baseline)';
    await tool('layers');
    await page.locator('.pe-layer[data-clip] button[aria-label^="Hide"]').click();
    await savedWhen((v) => v.layers[1].visible === false, 'detail layer hidden');
    const flat = await exportPng();
    timings.exportWithoutDetailMs = flat.ms;
    result.exportWithoutDetailPeakMb = flat.peakMb;
    await tool('layers');
    await page.locator('.pe-layer[data-clip] button[aria-label^="Show"]').click();
    await savedWhen((v) => v.layers[1].visible !== false, 'detail layer shown');

    result.step = 'save and reopen';
    await tab(3);
    const [edits] = await Promise.all([page.waitForEvent('download'), page.locator('button:visible', { hasText: 'Save edits' }).first().click()]);
    const text = readFileSync(await edits.path(), 'utf8');
    const document = JSON.parse(text);
    assert.equal(document.version, DOCUMENT_VERSION);
    assert.equal(DOCUMENT_VERSION, 20);
    assert.ok(document.photos[0].adjustments.layers[0].mask.components.every((c) => c.refine && !("refinedKey" in c)), "refine settings saved, no derived data");
    const before = document.photos[0].adjustments.layers;
    result.savedKb = Math.round(text.length / 1024);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await tab(1);
    await page.setInputFiles('input[type=file][multiple]', [files.backgroundFile]);
    await poll(() => page.$$eval('.pe-photo--list', (items) => items.filter((li) => li.dataset.status === 'ready').length), (n) => n >= 1, 'reimport', 300_000);
    const docFile = path.join(work, `edits-${run.id}.json`);
    writeFileSync(docFile, text);
    await page.setInputFiles('input[type=file][accept="application/json,.json"]:not([aria-label])', docFile);
    const reopened = await savedWhen((v) => v.layers?.length === 2, 'document applied');
    assert.deepEqual(reopened.layers, before, 'layers, masks and Detail settings survive saving and reopening');
    assert.equal(sha(files.backgroundFile), files.hashes.background, 'background file unchanged');
    assert.equal(sha(files.carFile), files.hashes.car, 'layer file unchanged');

    assert.deepEqual(outside, [], 'no request leaves the site');
    assert.deepEqual(problems, []);
    result.timingsMs = timings;
    result.ok = true;
  } catch (error) {
    result.ok = false;
    result.error = `${error.message}${problems.length ? ` (${problems.join('; ')})` : ''}`;
    result.timingsMs = timings;
  } finally {
    await context.close();
  }
  return result;
}

// LAYER_MASK_RAW_DIR: genuine RAW files, each added as an image layer in Chromium: Mask from Subject
// analyses its development (LibRaw, Camera Natural), not an embedded preview; then a PNG export.
async function checkRaw(file, files) {
  const context = await chromium.launchPersistentContext(mkdtempSync(path.join(work, 'raw-')), { viewport: { width: 1440, height: 900 } });
  const page = context.pages()[0] ?? await context.newPage();
  const row = { file: path.basename(file) };
  try {
    await page.goto(URL_EDITOR);
    await page.setInputFiles('input[type=file][multiple]', [files.backgroundFile]);
    await poll(() => page.$$eval('.pe-photo--list', (items) => items.filter((li) => li.dataset.status === 'ready').length), (n) => n >= 1, 'import', 300_000);
    await page.click('.pe-photo--list button.pe-photo__select');
    await page.setInputFiles('[data-layer-input]', file);
    await page.locator('.pe-layer[data-type=image]').waitFor({ timeout: 300_000 });
    const t0 = Date.now();
    await page.locator('.pe-layers__props button', { hasText: /^Subject$/ }).click();
    const read = () => page.evaluate((key) => ({
      mask: JSON.parse(localStorage.getItem(key) ?? 'null')?.photos[0]?.adjustments.layers?.[0]?.mask ?? null,
      message: document.querySelector('.pe-layers__props [role=status]')?.textContent ?? null,
    }), AUTOSAVE_KEY);
    const got = await poll(read, (r) => r.mask?.components?.length || /No subject|ran out|could not/i.test(r.message ?? ''), 'RAW subject', 400_000);
    const c = got.mask?.components?.[0];
    Object.assign(row, c ? { kind: c.kind, confidence: c.confidence, grid: `${c.width}×${c.height}`, ms: Date.now() - t0 } : { found: false, message: got.message });
    if (c) {
      const t1 = Date.now();
      await page.check('input[name=pe-format][value=png]');
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 900_000 }), page.click('.pe-export-button')]);
      const meta = await sharp(await download.path()).metadata();
      row.export = { size: `${meta.width}×${meta.height}`, ms: Date.now() - t1, refined: c.refine?.version ?? null };
    }
  } catch (error) {
    row.error = error.message;
  } finally {
    await context.close();
  }
  return row;
}

async function main() {
  if (!process.env.LAYER_MASK_SKIP_BUILD) await build({ root, logLevel: 'silent', configFile: path.join(root, 'vite.config.mjs') });
  const server = await preview({ root, logLevel: 'silent', configFile: path.join(root, 'vite.config.mjs'), preview: { port: PORT, strictPort: true } });
  const files = await fixtures();
  let failed = 0;
  try {
    for (const run of RUNS.filter((r) => !ONLY || ONLY.includes(r.id))) {
      const result = await check(run, files); // eslint-disable-line no-await-in-loop
      if (!result.ok) failed += 1;
      console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${JSON.stringify(result)}`);
    }
    if (process.env.LAYER_MASK_RAW_DIR) {
      const dir = process.env.LAYER_MASK_RAW_DIR;
      for (const name of readdirSync(dir).filter((n) => /\.(arw|nef|cr2|cr3|raf|dng|orf|rw2|pef|nrw|srw)$/i.test(n)).sort()) {
        const row = await checkRaw(path.join(dir, name), files); // eslint-disable-line no-await-in-loop
        console.log(`raw  ${JSON.stringify(row)}`);
        if (row.error) failed += 1;
      }
    }
  } finally {
    await server.close();
    rmSync(work, { recursive: true, force: true });
  }
  process.exitCode = failed ? 1 : 0;
}

main();
