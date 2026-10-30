// QuangEdit in the local CMS, end to end in real browsers (Playwright builds of Chromium,
// Firefox and WebKit; iPhone 13 and Pixel 7 emulation; a forced CPU preview). Starts the CMS
// with Vite against this checkout (offline, a temporary workspace; no branch, push or GitHub
// call), then per run: a draft upload with a saved treatment (a radial local adjustment and a
// rotation) opens from the CMS details panel; the saved edits are restored; a pasted recipe
// is reviewed and merged (the mask and geometry kept); Save treatment and Render for
// portfolio write a fresh full-resolution render; the CMS review shows original and edited and
// approves it; a published photograph opens with its "public image only" limitation, and its
// approved render is listed for the next publication. Checks: no horizontal scroll at phone
// width, no request leaves 127.0.0.1, no console errors. With CMS_EDITOR_FIXTURE_DIR (genuine
// Sony .ARW files) Chromium also attaches a RAW and three exposures, develops and merges them,
// and renders both at full size. Watermark: a global preference is saved, the Watermark view
// lists the published photographs with previews, one (given an attached original) is staged
// through the bulk queue (QuangEdit renders it from the original), compared and explicitly
// approved; the approved render differs from the original only inside the mark's box, and it
// is listed for the next publication.
// Usage: npm run check:cms:editor (CMS_EDITOR_RUNS=chromium,firefox to limit the runs)
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { chromium, devices, firefox, webkit } from 'playwright';
import { createEditDocument, serializeEditDocument } from '../src/editor/model/editDocument.mjs';
import { neutralAdjustments } from '../src/editor/model/adjustments.mjs';
import { WATERMARK_DEFAULTS, layoutWatermark, normalizeWatermark } from '../src/editor/watermark/watermark.mjs';
import { startCmsServer } from '../cms/server.mjs';

const work = mkdtempSync(path.join(tmpdir(), 'cms-editor-check-'));
const ONLY_RUNS = process.env.CMS_EDITOR_RUNS?.split(',');
const GENUINE_DIR = process.env.CMS_EDITOR_FIXTURE_DIR ?? '';
const RAW_FILES = GENUINE_DIR && existsSync(GENUINE_DIR) ? readdirSync(GENUINE_DIR).filter((name) => /\.arw$/i.test(name)).sort().map((name) => path.join(GENUINE_DIR, name)) : [];
const RUNS = [
  { id: 'chromium', type: chromium, genuine: true },
  { id: 'firefox', type: firefox },
  { id: 'webkit', type: webkit },
  { id: 'iphone', type: webkit, device: 'iPhone 13' },
  { id: 'pixel', type: chromium, device: 'Pixel 7' },
  { id: 'cpu', type: chromium, noWebgl2: true },
].filter(({ id }) => !ONLY_RUNS || ONLY_RUNS.includes(id));

const RECIPE = JSON.stringify({ format: 'quangedit-recipe', version: 1, name: 'CMS check', adjustments: { light: { contrast: 20 }, color: { vibrance: 15 } } });

async function poll(read, ok, label, timeout = 120_000) {
  const end = Date.now() + timeout;
  let value;
  while (Date.now() < end) {
    value = await read();
    if (ok(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label} (last: ${JSON.stringify(value)?.slice(0, 200)})`);
}

/** A photo-like synthetic JPEG: gradients and texture, distinct per seed. */
async function syntheticJpeg(seed, width = 2400, height = 1600) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const t = x / width;
      const v = 50 + 140 * t + 25 * Math.sin(y / (13 + seed)) + 20 * Math.sin(x / 5) * Math.sin(y / 7);
      data.set([v + 25 * (1 - t), v, v - 20 * t + seed].map((c) => Math.max(0, Math.min(255, Math.round(c)))), (y * width + x) * 3);
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
}

const radialTreatment = (source) => serializeEditDocument(createEditDocument([{
  name: source.name, size: source.size, sha256: source.sha256, format: source.format, width: 2400, height: 1600, lastModified: 0,
  adjustments: {
    ...neutralAdjustments(),
    exposure: 0.3,
    geometry: { angle: 3 },
    local: [{ id: 'cms-l1', name: 'Centre', enabled: true, amount: 100, settings: { exposure: -0.6 },
      mask: { space: 'image', base: 0, enabled: true, invert: false, opacity: 100, components: [{ id: 'cms-c1', type: 'radial', name: 'Centre', enabled: true, op: 'add', invert: false, opacity: 100, x: 0.5, y: 0.5, rx: 0.3, ry: 0.2, rotation: 0, feather: 0.5 }] } }],
  },
}], {}));

const cms = await startCmsServer({ port: 4321, workspace: path.join(work, 'workspace'), offline: true, log: () => {} });
const origin = new URL(cms.url).origin;
const results = [];
let failed = false;

async function api(page, method, url, body) {
  return page.evaluate(async ([m, u, b]) => {
    const response = await fetch(u, { method: m, headers: { 'X-CMS-Request': '1', ...(b !== null ? { 'Content-Type': 'application/json' } : {}) }, body: b === null ? undefined : JSON.stringify(b) });
    return { status: response.status, json: await response.json().catch(() => null) };
  }, [method, url, body ?? null]);
}

try {
  let seed = 1;
  for (const run of RUNS) {
    const browser = await run.type.launch();
    const context = await browser.newContext({ ...(run.device ? devices[run.device] : { viewport: { width: 1440, height: 900 } }), acceptDownloads: true });
    if (run.noWebgl2) {
      await context.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) { return type === 'webgl2' ? null : original.call(this, type, ...rest); };
      });
    }
    const page = await context.newPage();
    const outside = [];
    const errors = [];
    // Any loopback port counts as local (Vite's client retries its disabled HMR socket on 24678).
    page.on('request', (request) => { if (!/^(data|blob):/.test(request.url()) && new URL(request.url()).hostname !== '127.0.0.1') outside.push(request.url()); });
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(error.message));
    const result = { run: run.id, steps: {} };
    const step = async (name, action) => {
      const start = performance.now();
      try {
        result.steps[name] = { ...(await action() ?? {}), ms: Math.round(performance.now() - start) };
      } catch (error) {
        result.steps[name] = { error: error.message.split('\n')[0] };
        throw error;
      }
    };
    const phone = Boolean(run.device);
    const noSideScroll = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'horizontal scroll');
    try {
      await page.goto(cms.signInUrl);
      let id;
      await step('upload a draft and save a treatment with a mask', async () => {
        const bytes = await syntheticJpeg(seed += 1);
        id = await page.evaluate(async (data) => {
          const response = await fetch(`/api/uploads?filename=cms-check-${Date.now()}.jpg`, { method: 'POST', headers: { 'X-CMS-Request': '1' }, body: new Uint8Array(data) });
          return (await response.json()).id;
        }, [...bytes]);
        const described = await api(page, 'GET', `/api/editor/photos/${id}`);
        const saved = await api(page, 'PUT', `/api/editor/photos/${id}/treatment`, { document: radialTreatment(described.json.sources[0]), revision: described.json.treatment.revision });
        assert.equal(saved.status, 200, JSON.stringify(saved.json));
        return { id };
      });
      await step('open from the details panel; saved edits restored', async () => {
        await page.goto(`${origin}/admin/photography/#photo=${id}`);
        await page.reload();
        await page.getByRole('button', { name: /QuangEdit/ }).click();
        await page.waitForURL(/\/admin\/photography\/editor\//);
        await page.waitForSelector('.pe[data-engine]', { timeout: 30_000 });
        await page.locator('.cms-host').waitFor();
        await poll(() => page.locator('.cms-host__status').textContent().catch(() => ''), (text) => /Draft treatment/.test(text) && !/unsaved/.test(text), 'restored treatment', 60_000);
        if (phone) { await page.locator('.pe-tabs button', { hasText: 'Photos' }).click(); }
        const restored = await page.locator('.pe-photo__badge', { hasText: 'Saved edits applied' }).count();
        if (phone) { await page.locator('.pe-tabs button', { hasText: 'Adjust' }).click(); }
        await noSideScroll();
        return { restoredBadge: restored, engine: await page.$eval('.pe', (el) => el.dataset.engine) };
      });
      await step('paste a recipe, review and merge it (mask and rotation kept)', async () => {
        const toggle = page.locator('.pe-section[data-section-id=recipes] .pe-section__toggle');
        if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
        await page.getByRole('button', { name: 'Paste settings…' }).click();
        const dialog = page.locator('.pe-dialog[role=dialog]');
        await dialog.getByRole('textbox', { name: 'Recipe JSON' }).fill(RECIPE);
        await dialog.locator('.pe-recipe__summary h3').waitFor();
        await dialog.getByRole('button', { name: 'Merge settings' }).click().catch(() => {});
        await dialog.locator('.pe-dialog__foot button.pe-button--primary').click();
        await dialog.waitFor({ state: 'detached' });
        await poll(() => page.locator('.cms-host__status').textContent(), (text) => /unsaved changes/.test(text), 'unsaved state');
      });
      await step('save the treatment', async () => {
        await page.getByRole('button', { name: 'Save treatment' }).click();
        await poll(() => page.locator('.cms-host__status').textContent(), (text) => !/unsaved/.test(text), 'saved');
        const { json } = await api(page, 'GET', `/api/editor/photos/${id}`);
        const adjustments = json.treatment.document.photos[0].adjustments;
        assert.equal(adjustments.contrast, 20);
        assert.equal(adjustments.vibrance, 15);
        assert.equal(adjustments.exposure, 0.3);
        assert.deepEqual(adjustments.geometry, { angle: 3 });
        assert.equal(adjustments.local[0].mask.components[0].type, 'radial');
      });
      await step('render for portfolio (full resolution, from the original)', async () => {
        await page.getByRole('button', { name: 'Render for portfolio' }).click();
        await poll(() => page.locator('.cms-host__status').textContent(), (text) => /render up to date/.test(text), 'render', 300_000);
        const { json } = await api(page, 'GET', `/api/editor/photos/${id}`);
        assert.equal(json.renderFresh, true);
        const { render } = json.treatment;
        assert.ok(render.width <= 2400 && render.height <= 1600 && render.width > 2000, `render ${render.width}×${render.height}`);
        assert.match(render.file, /-quangedit\.jpg$/);
        return { size: `${render.width}×${render.height}`, bytes: render.bytes };
      });
      await step('review in the CMS: original and edited, then approve', async () => {
        await page.getByRole('link', { name: 'Review in CMS' }).click();
        await page.waitForURL(/\/admin\/photography\/#review=/);
        const compare = page.locator('.cms-compare img');
        await poll(() => compare.evaluateAll((imgs) => imgs.map((img) => img.complete && img.naturalWidth)), (sizes) => sizes.length === 2 && sizes.every(Boolean), 'compare images');
        // The split's original (matched to the edit) and edited image share one box: aligned.
        const boxes = await compare.evaluateAll((imgs) => imgs.map((img) => { const r = img.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }));
        assert.ok(boxes[0].every((v, i) => Math.abs(v - boxes[1][i]) <= 1), `split images not aligned: ${JSON.stringify(boxes)}`);
        await page.getByRole('button', { name: 'Approve for publication' }).click();
        await page.locator('.cms-treatment__states', { hasText: 'Approved treatment' }).waitFor();
        await page.locator('.cms-badge--edit', { hasText: 'Edit: approved' }).first().waitFor();
        await noSideScroll();
      });
      await step('a published photograph: public image only, approved image queued for publication', async () => {
        const published = (await api(page, 'GET', '/api/workspace')).json.catalog.photographs.filter(({ status }) => status === 'published')[RUNS.indexOf(run)].id;
        await page.goto(`${origin}/admin/photography/editor/?photo=${published}`);
        await page.locator('.cms-host__note', { hasText: '2200 px' }).waitFor({ timeout: 60_000 });
        await poll(() => page.locator('.cms-host__status').textContent(), (text) => /No treatment saved/.test(text), 'ready');
        await page.waitForSelector('.pe-photo[data-status=ready]', { state: 'attached', timeout: 60_000 });
        // Each run takes its own published photograph, so runs never see another's treatment.
        // Edit it: one recipe application is enough to differ from the live image.
        const toggle = page.locator('.pe-section[data-section-id=recipes] .pe-section__toggle');
        if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
        await page.getByRole('button', { name: 'Paste settings…' }).click();
        const dialog = page.locator('.pe-dialog[role=dialog]');
        await dialog.getByRole('textbox', { name: 'Recipe JSON' }).fill(RECIPE);
        await dialog.locator('.pe-recipe__summary h3').waitFor();
        await dialog.locator('.pe-dialog__foot button.pe-button--primary').click();
        await page.getByRole('button', { name: 'Render for portfolio' }).click();
        await poll(() => page.locator('.cms-host__status').textContent(), (text) => /render up to date/.test(text), 'render', 300_000);
        const described = (await api(page, 'GET', `/api/editor/photos/${published}`)).json;
        assert.ok(described.treatment.render.width <= 2200, 'no upscaling past the public image');
        const approved = await api(page, 'POST', `/api/editor/photos/${published}/approve`, { revision: described.treatment.revision });
        assert.equal(approved.status, 200);
        const workspace = (await api(page, 'GET', '/api/workspace')).json;
        assert.ok(workspace.images.includes(published), 'listed for the next publication');
        // Back to the original image, so the next run starts clean.
        await api(page, 'POST', `/api/editor/photos/${published}/discard`, { revision: approved.json.treatment.revision });
        return { published };
      });
      await step('watermark: global preference, bulk staging of one photograph, explicit approval', async () => {
        const preference = await api(page, 'PUT', '/api/watermark', { settings: { ...WATERMARK_DEFAULTS, position: 'bottom-left', color: 'auto' } });
        assert.equal(preference.status, 200);
        const published = (await api(page, 'GET', '/api/workspace')).json.catalog.photographs.filter(({ status }) => status === 'published');
        const target = published[RUNS.indexOf(run) + 20];
        // Give it an original, so it can be staged at full resolution.
        const bytes = await syntheticJpeg(seed += 1);
        const before = await api(page, 'GET', `/api/editor/photos/${target.id}`);
        const attached = await page.evaluate(async ([photo, revision, data]) => {
          const response = await fetch(`/api/editor/photos/${photo}/sources?filename=wm-original.jpg&revision=${revision}`, { method: 'POST', headers: { 'X-CMS-Request': '1' }, body: new Uint8Array(data) });
          return response.status;
        }, [target.id, before.json.treatment.revision, [...bytes]]);
        assert.equal(attached, 200);
        await page.goto(`${origin}/admin/photography/#watermark`);
        await page.locator('#cms-watermark-portfolio').waitFor({ timeout: 60_000 });
        // Every published photograph is listed; only those given an original are eligible (no library here).
        await poll(() => page.locator('.cms-watermark-stats').textContent(), (text) => text.includes(`Published${published.length}`) && /Eligible[1-9]/.test(text), 'eligible count', 60_000);
        await poll(() => page.locator('.cms-watermark-preview').count(), (n) => n >= 3, 'watermark previews', 60_000);
        if (phone) await noSideScroll();
        const chooseTarget = page.getByRole('checkbox', { name: `Stage ${target.caption || target.id}` });
        await poll(async () => { if (!(await chooseTarget.isChecked())) await chooseTarget.click({ timeout: 5_000 }).catch(() => {}); return chooseTarget.isChecked(); }, Boolean, 'photo chosen for staging', 60_000);
        await page.getByRole('button', { name: 'Stage 1 photograph…' }).click();
        await page.getByRole('button', { name: 'Start staging' }).click();
        await page.waitForURL(/queue=watermark/, { timeout: 30_000 });
        await page.waitForURL(/#watermark$/, { timeout: 600_000 });
        await page.locator('[data-watermark-run]', { hasText: '1 staged' }).waitFor({ timeout: 60_000 });
        await page.locator('#cms-watermark-staged', { hasText: '(1)' }).waitFor();
        // Lazy images above still load and shift the page on phones: click, then confirm the state.
        const chooseStaged = page.locator('.cms-watermark-compare li').first().getByRole('checkbox');
        await poll(async () => { if (!(await chooseStaged.isChecked())) await chooseStaged.click({ timeout: 5_000 }).catch(() => {}); return chooseStaged.isChecked(); }, Boolean, 'staged photo chosen', 60_000);
        await page.getByRole('button', { name: 'Approve 1…' }).click();
        const approve = page.locator('.cms-watermark-confirm button.cms-button--primary');
        assert.equal(await approve.isDisabled(), true, 'approval needs the review checkbox');
        await page.getByRole('checkbox', { name: 'I compared each before and after.' }).check();
        await approve.click();
        const approved = await poll(async () => (await api(page, 'GET', `/api/editor/photos/${target.id}`)).json, (json) => json.treatment.status === 'approved', 'approval');
        const mark = approved.treatment.approved.document.photos[0].adjustments.watermark;
        assert.deepEqual(mark, { ...WATERMARK_DEFAULTS, position: 'bottom-left', color: 'auto' });
        // The approved full render against the original: the mark's box changed, the rest is re-encoding only.
        const full = await page.evaluate(async (photo) => [...new Uint8Array(await (await fetch(`/api/editor/photos/${photo}/images/approved-full`)).arrayBuffer())], target.id);
        const render = await sharp(Buffer.from(full)).raw().toBuffer({ resolveWithObject: true });
        const original = await sharp(bytes).raw().toBuffer();
        const { width, height } = render.info;
        const layout = layoutWatermark(normalizeWatermark(mark), width, height);
        const diff = { inside: [0, 0], outside: [0, 0] };
        for (let y = 0; y < height; y += 2) {
          for (let x = 0; x < width; x += 2) {
            const i = (y * width + x) * 3;
            const d = Math.abs(render.data[i] - original[i]) + Math.abs(render.data[i + 1] - original[i + 1]) + Math.abs(render.data[i + 2] - original[i + 2]);
            const where = x >= layout.x && x < layout.x + layout.width && y >= layout.y && y < layout.y + layout.height ? 'inside' : 'outside';
            diff[where][0] += d;
            diff[where][1] += 1;
          }
        }
        const inside = diff.inside[0] / diff.inside[1];
        const outsideMean = diff.outside[0] / diff.outside[1];
        assert.ok(inside > 8 * outsideMean && outsideMean < 3, `mark not where expected (inside ${inside.toFixed(2)}, outside ${outsideMean.toFixed(2)})`);
        const workspace = (await api(page, 'GET', '/api/workspace')).json;
        assert.ok(workspace.images.includes(target.id), 'listed for the next publication');
        // Resume a stopped run: the photo already has these settings and a fresh render, so nothing changes.
        await page.evaluate(([photo, settings]) => localStorage.setItem('cms-watermark-queue', JSON.stringify({ ids: [photo], settings: { [photo]: settings }, index: 0, results: [], stopped: true })), [target.id, mark]);
        await page.goto(`${origin}/admin/photography/#watermark`);
        await page.reload();
        await page.getByRole('button', { name: 'Resume (1)' }).click();
        await page.waitForURL(/#watermark$/, { timeout: 300_000 });
        await page.locator('[data-watermark-run]', { hasText: '1 unchanged' }).waitFor({ timeout: 60_000 });
        assert.equal((await api(page, 'GET', `/api/editor/photos/${target.id}`)).json.treatment.revision, approved.treatment.revision, 'a re-run left the treatment untouched');
        // Rollback: removing an approved treatment (the upload's, which has its original) keeps the global watermark policy.
        const uploaded = (await api(page, 'GET', `/api/editor/photos/${id}`)).json;
        const removed = await api(page, 'POST', `/api/editor/photos/${id}/remove-approved`, { revision: uploaded.treatment.revision });
        assert.equal(removed.status, 200, JSON.stringify(removed.json));
        assert.equal((await api(page, 'GET', '/api/watermark')).json.settings.position, 'bottom-left');
        await api(page, 'POST', `/api/editor/photos/${target.id}/discard`, { revision: approved.treatment.revision });
        return { photo: target.id, size: `${width}×${height}`, inside: Math.round(inside * 10) / 10, outside: Math.round(outsideMean * 100) / 100 };
      });

      if (run.genuine && RAW_FILES.length >= 3) {
        await step('genuine ARW: attach, develop from sensor data, render full size', async () => {
          const bytes = await syntheticJpeg(seed += 1, 1200, 800);
          const rawId = await page.evaluate(async (data) => {
            const response = await fetch(`/api/uploads?filename=raw-check-${Date.now()}.jpg`, { method: 'POST', headers: { 'X-CMS-Request': '1' }, body: new Uint8Array(data) });
            return (await response.json()).id;
          }, [...bytes]);
          await page.goto(`${origin}/admin/photography/editor/?photo=${rawId}`);
          await page.locator('.cms-host').waitFor();
          await page.waitForSelector('.pe-photo[data-status=ready]', { state: 'attached', timeout: 60_000 });
          await page.setInputFiles('.cms-host input[type=file]', RAW_FILES[0]);
          await page.waitForURL(/editor/);
          await page.waitForSelector('.pe-photo[data-status=ready]', { state: 'attached', timeout: 300_000 });
          await poll(() => page.locator('.cms-host__meta').textContent(), (text) => /\.ARW \(attached/.test(text), 'ARW source');
          await page.getByRole('button', { name: 'Render for portfolio' }).click();
          await poll(() => page.locator('.cms-host__status').textContent(), (text) => /render up to date/.test(text), 'RAW render', 900_000);
          const { json } = await api(page, 'GET', `/api/editor/photos/${rawId}`);
          assert.equal(json.treatment.document.photos[0].source.format, 'arw');
          return { size: `${json.treatment.render.width}×${json.treatment.render.height}`, name: json.treatment.render.file };
        });
        await step('genuine HDR: attach three exposures, merge, save, render', async () => {
          const bytes = await syntheticJpeg(seed += 1, 1200, 800);
          const hdrId = await page.evaluate(async (data) => {
            const response = await fetch(`/api/uploads?filename=hdr-check-${Date.now()}.jpg`, { method: 'POST', headers: { 'X-CMS-Request': '1' }, body: new Uint8Array(data) });
            return (await response.json()).id;
          }, [...bytes]);
          await page.goto(`${origin}/admin/photography/editor/?photo=${hdrId}`);
          await page.locator('.cms-host').waitFor();
          await page.waitForSelector('.pe-photo[data-status=ready]', { state: 'attached', timeout: 60_000 });
          await page.setInputFiles('.cms-host input[type=file]', RAW_FILES.slice(0, 3));
          await poll(() => page.$$eval('.pe-photo--list[data-status=ready]', (items) => items.length), (count) => count === 3, 'three exposures', 600_000);
          await page.click('.pe-library__actions button:has-text("Merge HDR")');
          const dialog = page.locator('.pe-dialog[role=dialog]');
          for (let i = 0; i < 3; i += 1) await dialog.locator('.pe-bracket__workspace button:not([disabled])').first().click();
          await poll(() => page.$$eval('.pe-bracket__item', (items) => items.map((li) => li.dataset.status)), (s) => s.length === 3 && s.every((v) => v !== 'reading'), 'bracket', 300_000);
          await page.click('.pe-dialog__foot button:has-text("Merge")');
          await page.waitForSelector('.pe-dialog', { state: 'detached', timeout: 600_000 });
          await page.getByRole('button', { name: 'Render for portfolio' }).click();
          await poll(() => page.locator('.cms-host__status').textContent(), (text) => /render up to date|render out of date/.test(text) && !/Rendering/.test(text), 'HDR render', 900_000);
          const { json } = await api(page, 'GET', `/api/editor/photos/${hdrId}`);
          assert.equal(json.renderFresh, true);
          assert.ok(json.treatment.document.photos[0].source.hdr, 'HDR document');
          assert.match(json.treatment.render.file, /-HDR-quangedit\.jpg$/);
          return { size: `${json.treatment.render.width}×${json.treatment.render.height}`, name: json.treatment.render.file };
        });
      }
      assert.deepEqual(outside, [], `requests outside 127.0.0.1: ${outside.slice(0, 3).join(', ')}`);
      const relevant = errors.filter((text) => !/favicon|Failed to load resource: the server responded with a status of 404/.test(text));
      assert.deepEqual(relevant, [], `console errors: ${relevant.slice(0, 3).join(' | ')}`);
    } catch (error) {
      failed = true;
      result.error = error.message.split('\n')[0];
      await page.screenshot({ path: path.join(work, `${run.id}-failure.png`) }).catch(() => {});
    } finally {
      results.push(result);
      await browser.close();
    }
  }
} finally {
  await cms.close();
}
console.log(JSON.stringify(results, null, 2));
if (failed) {
  console.error(`Failed; screenshots in ${work}`);
  process.exitCode = 1;
} else rmSync(work, { recursive: true, force: true });
