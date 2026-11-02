// Production editor, real panels and rendering: phone/tablet/desktop layout regression.
// Playwright iPhone/Android emulation is not physical-device Safari/Chrome testing.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, firefox, webkit, devices } from 'playwright';
import sharp from 'sharp';
import { build, preview } from 'vite';

const output = process.env.EDITOR_MOBILE_OUTPUT || mkdtempSync(path.join(tmpdir(), 'editor-mobile-'));
mkdirSync(output, { recursive: true });
const fixture = path.join(output, 'fixture.jpg');
// Already-public derivative; never read the private CMS workspace.
await sharp('src/assets/photography/generated/DSC00009-gallery.jpg').resize({ width: 1200 }).jpeg().toFile(fixture);
await build({ logLevel: 'error' });
const server = await preview({ preview: { port: 4197, host: '127.0.0.1', strictPort: true } });
const runs = [
  ['chromium', chromium, devices['Pixel 7']],
  ['firefox', firefox, {}],
  ['webkit', webkit, devices['iPhone 13']],
];

async function checkLayout(page, mobile) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const layout = await page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, height: box.height, visible: getComputedStyle(element).display !== 'none' };
    };
    return {
      width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth,
      stage: rect('.pe-stage'), tabs: rect('.pe-tabs'), panel: rect('.pe-inspector'), library: rect('.pe-library'),
    };
  });
  assert.ok(layout.overflow <= layout.width, 'horizontal page overflow');
  // Native fullscreen can expand Firefox's emulated viewport to the desktop screen.
  if (!mobile || layout.width > 860) return;
  assert.ok(layout.tabs.visible, 'mobile navigation is visible');
  assert.ok(layout.tabs.bottom <= layout.height + 1, 'navigation below viewport');
  assert.ok(layout.stage.height >= (layout.height < 600 ? 100 : 180), 'canvas too short');
  for (const panel of [layout.panel, layout.library]) {
    if (panel.visible) {
      assert.ok(layout.stage.bottom <= panel.top + 1 || layout.stage.right <= panel.left + 1, 'panel overlaps canvas');
      assert.ok(panel.bottom <= layout.tabs.top + 1, 'panel overlaps navigation');
    }
  }
}

// A mocked viewport contract, not a native on-screen keyboard.
async function checkKeyboard(page, input, capture = async () => {}) {
  await input.focus();
  await page.evaluate(() => {
    Object.defineProperties(visualViewport, { height: { configurable: true, value: 440 }, offsetTop: { configurable: true, value: 36 } });
    visualViewport.dispatchEvent(new Event('resize'));
  });
  try {
    await page.waitForTimeout(100);
    const keyboard = await page.evaluate(() => {
      const root = document.querySelector('.pe').getBoundingClientRect();
      const input = document.activeElement.getBoundingClientRect();
      const panel = document.activeElement.closest('.pe-inspector, .pe-library, .pe-dialog__body').getBoundingClientRect();
      return { top: root.top, bottom: root.bottom, field: [input.top, input.bottom], panel: [panel.top, panel.bottom], visible: input.top >= panel.top - 1 && input.bottom <= panel.bottom + 1 };
    });
    assert.equal(keyboard.top, 36);
    assert.equal(keyboard.bottom, 476);
    await capture();
    assert.ok(keyboard.visible, `focused field stays inside the tray: ${JSON.stringify(keyboard)}`);
  } finally {
    await page.evaluate(() => {
      delete visualViewport.height; delete visualViewport.offsetTop;
      visualViewport.dispatchEvent(new Event('resize'));
      document.activeElement.blur();
    });
    await page.waitForTimeout(100);
  }
}

async function pinchWithoutPainting(page) {
  const tool = page.locator('.pe-retouchtool');
  const box = await tool.boundingBox();
  assert.ok(box, 'retouch overlay is available');
  const send = (type, id, offset) => tool.dispatchEvent(type, {
    pointerId: id, pointerType: 'touch', isPrimary: id === 11, button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    clientX: box.x + box.width / 2 + offset, clientY: box.y + box.height / 2,
  });
  await send('pointerdown', 11, -20);
  await send('pointerdown', 12, 20);
  await send('pointermove', 11, -40);
  await send('pointermove', 12, 40);
  await send('pointerup', 11, -40);
  await send('pointerup', 12, 40);
  assert.equal((await page.locator('.pe-retouch .pe-count').textContent()).trim(), '0', 'pinching must not paint');
  assert.equal(await page.evaluate(() => scrollY), 0, 'gesture must not scroll the page');
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
}

try {
  for (const [engine, type, device] of runs) {
    if (process.env.EDITOR_MOBILE_ENGINES && !process.env.EDITOR_MOBILE_ENGINES.split(',').includes(engine)) continue;
    const browser = await type.launch();
    try {
      for (const width of process.env.EDITOR_MOBILE_WIDTHS?.split(',').map(Number) ?? [320, 375, 390, 430, 768, 1280]) {
        const mobile = width <= 860;
        const page = await browser.newPage({ ...(mobile ? device : {}), viewport: { width, height: 844 } });
        const errors = [];
        const timing = {};
        page.on('pageerror', (error) => errors.push(error.message));
        const shot = async (name) => {
          if (width === 390) await page.screenshot({ scale: 'css', path: path.join(output, `after-${engine}-${name}.png`) });
        };
        const check = () => checkLayout(page, mobile);
        const tool = (name) => page.getByLabel('Editing tool', { exact: true }).selectOption(name);
        let started = performance.now();
        await page.goto('http://127.0.0.1:4197/photography/editor/');
        await page.locator('.pe-empty').waitFor();
        timing.load = Math.round(performance.now() - started);
        await check();
        await shot('empty');
        if (mobile) {
          assert.equal(await page.locator('.pe-inspector').isVisible(), false);
          assert.equal(await page.locator('.pe-zoom').isVisible(), false);
        }
        started = performance.now();
        await page.locator('input[type=file][multiple]').setInputFiles(fixture);
        await page.locator('.pe[data-ready]').waitFor({ timeout: 90_000 });
        await page.waitForFunction(() => !document.querySelector('.pe-stage-message'));
        timing.import = Math.round(performance.now() - started);
        await check();
        await shot('imported');
        if (mobile) await page.getByRole('navigation', { name: 'Editing tools', exact: true }).getByRole('button', { name: 'Light', exact: true }).click();
        const exposure = page.locator('input[aria-label="Exposure value"]');
        await exposure.fill('0.5');
        await exposure.press('Enter');
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        assert.equal(await exposure.inputValue(), '0.00 EV');
        await page.getByRole('button', { name: 'Redo', exact: true }).click();
        assert.equal(await exposure.inputValue(), '+0.50 EV');
        await check();
        await shot('adjustments');
        if (width === 390) {
          await checkKeyboard(page, exposure, () => shot('keyboard-contract'));
          assert.equal(await exposure.inputValue(), '+0.50 EV');
          await check();
        }
        if (mobile) await tool('retouch');
        else await page.locator('#pe-retouch-title button').click();
        await page.getByRole('button', { name: 'Spot Heal', exact: true }).click();
        await check();
        await shot('retouch');
        if (mobile) {
          await pinchWithoutPainting(page);
          await tool('layers');
          assert.equal(await page.locator('.pe-retouchtool').count(), 0, 'navigation stops painting');
        }
        await check();
        await page.locator('.pe-layers__add').getByRole('button', { name: 'Text', exact: true }).click();
        await check();
        await shot('layers');
        if (width === 390) {
          await page.locator('.pe-layer__name').first().dblclick();
          const rename = page.locator('.pe-layer__rename');
          await rename.fill('Mobile text');
          await checkKeyboard(page, rename);
          assert.ok(await page.getByRole('button', { name: /Mobile text, Text layer/ }).count());
        }
        if (mobile) {
          // Every raster tool is reachable and stays below the canvas.
          const options = await page.getByLabel('Editing tool', { exact: true }).locator('option').evaluateAll((items) => items.map((item) => item.value));
          started = performance.now();
          for (const option of options) { await tool(option); await check(); }
          timing.toolRoundTrip = Math.round((performance.now() - started) / options.length);
          if (width === 390) {
            await tool('text');
            const text = page.locator('.pe-inspector textarea');
            await text.fill('Mobile session');
            await checkKeyboard(page, text);
            assert.equal(await text.inputValue(), 'Mobile session');
            await tool('presets');
            await page.getByRole('button', { name: 'Save current as preset…', exact: true }).click();
            const preset = page.getByLabel('Preset name', { exact: true });
            await preset.fill('Mobile preset');
            await checkKeyboard(page, preset);
            assert.equal(await preset.inputValue(), 'Mobile preset');
            await page.locator('.pe-preset-form').getByRole('button', { name: 'Cancel', exact: true }).click();
            await tool('watermark');
            await page.locator('.pe-watermark input[type=checkbox]').first().check();
            await checkKeyboard(page, page.locator('.pe-watermark input[type=number]').first());
            const inspector = page.locator('.pe-inspector');
            await inspector.evaluate((element) => { element.scrollTop = element.scrollHeight; });
            await check();
            const remembered = await inspector.evaluate((element) => element.scrollTop);
            await tool('light');
            await tool('watermark');
            await check();
            assert.ok(Math.abs(await inspector.evaluate((element) => element.scrollTop) - remembered) < 2, 'tool scroll position restored');
          }
          await page.locator('.pe-tabs').getByRole('button', { name: 'Photos', exact: true }).click();
          await check();
          await shot('photos');
          await page.locator('.pe-tabs').getByRole('button', { name: 'Export', exact: true }).click();
        }
        await check();
        await shot('export');
        if (width === 390) {
          const suffix = page.getByLabel('Filename suffix', { exact: true });
          await suffix.fill('-mobile-check');
          await checkKeyboard(page, suffix);
          assert.equal(await suffix.inputValue(), '-mobile-check');
          const durations = [];
          const heaps = [];
          const session = engine === 'chromium' ? await page.context().newCDPSession(page) : null;
          for (let cycle = 0; cycle < 3; cycle++) {
            await page.locator('.pe-tabs').getByRole('button', { name: 'Adjust', exact: true }).click();
            for (const name of ['layers', 'retouch', 'masks', 'light']) await tool(name);
            await page.locator('.pe-tabs').getByRole('button', { name: 'Export', exact: true }).click();
            const download = page.waitForEvent('download');
            const start = performance.now();
            await page.getByRole('button', { name: 'Export photo', exact: true }).click();
            const file = await download;
            assert.equal(await file.failure(), null);
            assert.match(file.suggestedFilename(), /mobile-check/);
            durations.push(Math.round(performance.now() - start));
            await file.delete();
            if (session) {
              await session.send('HeapProfiler.collectGarbage');
              const heap = await session.send('Runtime.getHeapUsage');
              heaps.push(Math.round(heap.usedSize / 1048576 * 10) / 10);
            }
          }
          await session?.detach();
          console.log(`SESSION ${engine}: export ms ${JSON.stringify(durations)}, post-GC JS heap MB ${JSON.stringify(heaps)} (not total process memory)`);
        }
        for (const colorScheme of ['light', 'dark']) { await page.emulateMedia({ colorScheme }); await check(); }
        if (mobile) {
          await page.setViewportSize({ width, height: 560 });
          await check();
          await page.setViewportSize({ width, height: 844 });
          await check();
          await page.setViewportSize({ width: 844, height: 390 });
          await page.waitForTimeout(100);
          await check();
          await shot('landscape');
          await page.setViewportSize({ width, height: 844 });
          await page.waitForTimeout(100);
          await check();
        }
        if (width === 390) {
          await page.getByRole('button', { name: 'More editor options', exact: true }).click();
          await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
          await page.locator('.pe[data-fullscreen]').waitFor();
          await check();
          await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
          await page.locator('.pe:not([data-fullscreen])').waitFor();
          await check();
          await page.waitForFunction(() => {
            const saved = JSON.parse(localStorage.getItem('photo-editor:edits:v1'));
            return saved?.version === 15 && saved.photos[0].adjustments.watermark?.enabled && saved.photos[0].adjustments.layers.some((layer) => layer.text === 'Mobile session');
          });
          await page.reload();
          await page.locator('.pe-empty').waitFor();
          await check();
          await page.locator('input[type=file][multiple]').setInputFiles(fixture);
          await page.locator('.pe[data-ready]').waitFor({ timeout: 90_000 });
          await page.locator('[data-mobile-choice=light]').click();
          assert.equal(await page.getByRole('textbox', { name: 'Exposure value', exact: true }).inputValue(), '+0.50 EV');
        }
        assert.deepEqual(errors, []);
        await page.close();
        console.log(`PASS ${engine} ${width}: layout, tools, undo/redo, themes${mobile ? ', pinch safety, viewport resizing' : ''}`);
        if (width === 390) console.log(`TIMING ${engine} ms (automation included): ${JSON.stringify(timing)}`);
      }
    } finally { await browser.close(); }
  }
  console.log(`Screenshots: ${output}`);
} finally { await new Promise((resolve) => server.httpServer.close(resolve)); }
