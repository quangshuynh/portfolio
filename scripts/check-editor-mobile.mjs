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
  const layout = await page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      const box = element.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, height: box.height, visible: getComputedStyle(element).display !== 'none' };
    };
    return {
      width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth,
      stage: rect('.pe-stage'), tabs: rect('.pe-tabs'), panel: rect('.pe-inspector'), library: rect('.pe-library'),
    };
  });
  assert.ok(layout.overflow <= layout.width, 'horizontal page overflow');
  if (!mobile) return;
  assert.ok(layout.tabs.bottom <= layout.height + 1, 'navigation below viewport');
  assert.ok(layout.stage.height >= (layout.height < 600 ? 100 : 180), 'canvas too short');
  for (const panel of [layout.panel, layout.library]) {
    if (panel.visible) {
      assert.ok(layout.stage.bottom <= panel.top + 1, 'panel overlaps canvas');
      assert.ok(panel.bottom <= layout.tabs.top + 1, 'panel overlaps navigation');
    }
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
    const browser = await type.launch();
    try {
      for (const width of [320, 375, 390, 430, 768, 1280]) {
        const mobile = width <= 860;
        const page = await browser.newPage({ ...(mobile ? device : {}), viewport: { width, height: 844 } });
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        const shot = async (name) => {
          if (width === 390) await page.screenshot({ scale: 'css', path: path.join(output, `after-${engine}-${name}.png`) });
        };
        const check = () => checkLayout(page, mobile);
        const tool = (name) => page.getByLabel('Editing tool', { exact: true }).selectOption(name);
        await page.goto('http://127.0.0.1:4197/photography/editor/');
        await page.locator('.pe-empty').waitFor();
        await check();
        await shot('empty');
        if (mobile) {
          assert.equal(await page.locator('.pe-inspector').isVisible(), false);
          assert.equal(await page.locator('.pe-zoom').isVisible(), false);
        }
        await page.locator('input[type=file][multiple]').setInputFiles(fixture);
        await page.locator('.pe[data-ready]').waitFor({ timeout: 90_000 });
        await page.waitForFunction(() => !document.querySelector('.pe-stage-message'));
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
        if (mobile) {
          // Every raster tool is reachable and stays below the canvas.
          const options = await page.getByLabel('Editing tool', { exact: true }).locator('option').evaluateAll((items) => items.map((item) => item.value));
          for (const option of options) { await tool(option); await check(); }
          await page.locator('.pe-tabs').getByRole('button', { name: 'Photos', exact: true }).click();
          await check();
          await shot('photos');
          await page.locator('.pe-tabs').getByRole('button', { name: 'Export', exact: true }).click();
        }
        await check();
        await shot('export');
        for (const colorScheme of ['light', 'dark']) { await page.emulateMedia({ colorScheme }); await check(); }
        if (mobile) {
          await page.setViewportSize({ width, height: 560 });
          await check();
          await page.setViewportSize({ width, height: 844 });
          await check();
        }
        assert.deepEqual(errors, []);
        await page.close();
        console.log(`PASS ${engine} ${width}: layout, tools, undo/redo, themes${mobile ? ', pinch safety, viewport resizing' : ''}`);
      }
    } finally { await browser.close(); }
  }
  console.log(`Screenshots: ${output}`);
} finally { await new Promise((resolve) => server.httpServer.close(resolve)); }
