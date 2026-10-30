// Real-layout check of the photography viewer's fullscreen mode on a production build, in
// WebKit (iPhone 13 emulation and desktop), Chromium (Pixel 7 emulation and desktop) and Firefox.
// Regression for the mobile clipping bug: the gesture surface was sized to the fitted photograph
// with overflow hidden, so a pinch only enlarged the photo inside that box. Each run checks that
// in fullscreen the stage fills the viewport, the photo fits without cropping (portrait, landscape,
// square and panoramic), a pinch and pan use the whole viewport within bounds, double tap and reset
// work, rotation refits, previous/next work and the page behind never scrolls.
// Gestures are synthesised pointer events; emulation is evidence, not a physical-device test.
// Usage: npm run check:photography:viewer  (VIEWER_ENGINES=webkit-iphone,... to narrow; SHOTS_DIR saves screenshots)
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { build, preview } from 'vite';

const { chromium, devices, firefox, webkit } = await import('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4183;
const ONLY = process.env.VIEWER_ENGINES?.split(',');
const SHOTS = process.env.SHOTS_DIR;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const RUNS = [
  { key: 'webkit-iphone', name: 'WebKit, iPhone 13 emulation', type: webkit, device: 'iPhone 13' },
  { key: 'chromium-pixel', name: 'Chromium, Pixel 7 emulation', type: chromium, device: 'Pixel 7' },
  { key: 'webkit-desktop', name: 'WebKit, desktop', type: webkit },
  { key: 'chromium-desktop', name: 'Chromium, desktop', type: chromium },
  { key: 'firefox-desktop', name: 'Firefox, desktop', type: firefox },
].filter(({ key }) => !ONLY || ONLY.includes(key));

// Real portrait and landscape photographs; square and panoramic are served in place of a real
// photograph's viewer file (the catalog has none), since the fit follows the decoded size.
const generated = JSON.parse(readFileSync(path.join(root, 'src/data/photographs.generated.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(path.join(root, 'src/data/photography.catalog.json'), 'utf8'));
const published = new Map(catalog.photographs.filter(({ status }) => status === 'published').map((record) => [record.id, record]));
const records = (Array.isArray(generated) ? generated : generated.photographs).filter(({ id }) => published.has(id));
const byRatio = [...records].sort((a, b) => a.viewerWidth / a.viewerHeight - b.viewerWidth / b.viewerHeight);
const portrait = byRatio[0];
const landscape = byRatio[byRatio.length - 1];
const substitute = byRatio[Math.floor(byRatio.length / 2)];
const synthetic = async (width, height) => sharp({ create: { width, height, channels: 3, background: { r: 90, g: 120, b: 150 } } }).jpeg().toBuffer();
const PHOTOS = [
  { label: 'portrait', record: portrait },
  { label: 'landscape', record: landscape },
  { label: 'square', record: substitute, size: [2000, 2000] },
  { label: 'panoramic', record: substitute, size: [2400, 800] },
];
const slug = (record) => published.get(record.id).slug;

const near = (a, b, tolerance = 2) => Math.abs(a - b) <= tolerance;
const measure = (page) => page.evaluate(() => {
  const rect = (element) => { const { left, top, width, height } = element.getBoundingClientRect(); return { left, top, width, height, right: left + width, bottom: top + height }; };
  const stage = document.querySelector('.photography-lightbox-image-wrap');
  const image = stage.querySelector('img');
  return {
    viewport: { width: window.visualViewport?.width ?? innerWidth, height: window.visualViewport?.height ?? innerHeight },
    backdrop: rect(document.querySelector('.photography-lightbox-backdrop')),
    stage: rect(stage),
    image: rect(image),
    natural: { width: image.naturalWidth, height: image.naturalHeight },
    scale: document.querySelector('[aria-label="Reset zoom"]').textContent,
    mode: document.querySelector('.photography-lightbox-backdrop').className,
    scrollY: window.scrollY,
    bodyPosition: document.body.style.position,
  };
});
// Synthesised touch pointers, dispatched on the stage as a browser would.
const touch = (page, steps) => page.evaluate((list) => {
  const stage = document.querySelector('.photography-lightbox-image-wrap');
  let time = performance.now();
  for (const [type, id, x, y, gap = 16] of list) {
    time += gap;
    stage.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
  }
}, steps);

function assertFits(m, label) {
  const { stage, image, viewport } = m;
  assert.ok(near(stage.width, viewport.width) && near(stage.height, viewport.height), `${label}: stage ${stage.width}×${stage.height} fills the viewport ${viewport.width}×${viewport.height}`);
  assert.ok(near(m.backdrop.height, viewport.height) && near(m.backdrop.top, 0), `${label}: backdrop follows the visual viewport`);
  assert.ok(image.left >= stage.left - 1 && image.right <= stage.right + 1 && image.top >= stage.top - 1 && image.bottom <= stage.bottom + 1, `${label}: the whole photo is visible`);
  const fitsWidth = near(image.width, stage.width);
  const fitsHeight = near(image.height, stage.height);
  const natural = near(image.width, m.natural.width);
  assert.ok(fitsWidth || fitsHeight || natural, `${label}: the photo is fitted to the viewport (${image.width}×${image.height} in ${stage.width}×${stage.height})`);
  assert.ok(near(image.width / image.height, m.natural.width / m.natural.height, 0.02), `${label}: aspect ratio kept`);
}

async function runPhoto(page, run, photo) {
  const label = `${run.name} / ${photo.label}`;
  await page.goto('about:blank');
  await page.goto(`http://localhost:${PORT}/photography/#${encodeURIComponent(slug(photo.record))}`);
  await page.waitForSelector('.photography-lightbox img');
  await page.waitForFunction(() => { const image = document.querySelector('.photography-lightbox img'); return image.complete && image.naturalWidth > 0; });
  if (photo.size) await page.waitForFunction(([w, h]) => { const image = document.querySelector('.photography-lightbox img'); return image.naturalWidth === w && image.naturalHeight === h; }, photo.size);
  await page.getByRole('button', { name: 'Enter fullscreen' }).click();
  await page.waitForFunction(() => document.querySelector('.photography-lightbox-backdrop').classList.contains('is-fullscreen'));
  await page.waitForTimeout(300);
  let m = await measure(page);
  assertFits(m, `${label}, fullscreen`);
  const fitted = m.image;
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${run.key}-${photo.label}-fit.png`) });

  // Pinch around a point right of and below the centre to 4×: the image point under the fingers stays put.
  const cx = m.stage.left + m.stage.width / 2;
  const cy = m.stage.top + m.stage.height / 2;
  const mid = { x: cx + fitted.width * 0.2, y: cy + fitted.height * 0.15 };
  const before = { x: (mid.x - fitted.left) / fitted.width, y: (mid.y - fitted.top) / fitted.height };
  const steps = [['pointerdown', 1, mid.x - 20, mid.y], ['pointerdown', 2, mid.x + 20, mid.y]];
  for (let k = 1; k <= 6; k += 1) steps.push(['pointermove', 1, mid.x - 20 * (1 + 0.5 * k), mid.y], ['pointermove', 2, mid.x + 20 * (1 + 0.5 * k), mid.y]);
  steps.push(['pointerup', 1, mid.x - 80, mid.y], ['pointerup', 2, mid.x + 80, mid.y]);
  await touch(page, steps);
  await page.waitForTimeout(150);
  m = await measure(page);
  assert.equal(m.scale, '400%', `${label}: pinch zooms to 4×`);
  const visible = {
    width: Math.min(m.image.right, m.stage.right) - Math.max(m.image.left, m.stage.left),
    height: Math.min(m.image.bottom, m.stage.bottom) - Math.max(m.image.top, m.stage.top),
  };
  // The bug: the zoomed photo stayed clipped to its fitted box. Now it spreads across the viewport.
  assert.ok(visible.width >= Math.min(m.stage.width, fitted.width * 4) - 2 && visible.height >= Math.min(m.stage.height, fitted.height * 4) - 2, `${label}: zoomed photo uses the full viewport (visible ${visible.width}×${visible.height}, fitted ${fitted.width}×${fitted.height})`);
  const after = { x: (mid.x - m.image.left) / m.image.width, y: (mid.y - m.image.top) / m.image.height };
  const clampedX = m.image.left >= m.stage.left - 1 || m.image.right <= m.stage.right + 1;
  const clampedY = m.image.top >= m.stage.top - 1 || m.image.bottom <= m.stage.bottom + 1;
  if (!clampedX) assert.ok(near(after.x, before.x, 0.01), `${label}: pinch anchored at its midpoint (x ${before.x} → ${after.x})`);
  if (!clampedY) assert.ok(near(after.y, before.y, 0.01), `${label}: pinch anchored at its midpoint (y ${before.y} → ${after.y})`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${run.key}-${photo.label}-zoom.png`) });

  // A long pan stops at the photo's edge: no gap between the photo and the viewport's edge.
  await touch(page, [['pointerdown', 3, cx, cy], ['pointermove', 3, cx + 5000, cy + 5000], ['pointerup', 3, cx + 5000, cy + 5000]]);
  await page.waitForTimeout(150);
  m = await measure(page);
  if (m.image.width > m.stage.width) assert.ok(near(m.image.left, m.stage.left, 1.5), `${label}: pan bounded on the left (${m.image.left})`);
  else assert.ok(near(m.image.left + m.image.width / 2, cx, 1.5), `${label}: narrow zoomed photo stays centred`);
  if (m.image.height > m.stage.height) assert.ok(near(m.image.top, m.stage.top, 1.5), `${label}: pan bounded at the top (${m.image.top})`);

  // Double tap resets; a second double tap zooms to 250 %; Reset zoom returns to the fit.
  const tap = (id, gap) => [['pointerdown', id, cx, cy, gap], ['pointerup', id, cx, cy, 40]];
  await touch(page, [...tap(4, 400), ...tap(5, 80)]);
  await page.waitForTimeout(150);
  assert.equal((await measure(page)).scale, '100%', `${label}: double tap resets`);
  await touch(page, [...tap(6, 900), ...tap(7, 80)]);
  assert.equal((await measure(page)).scale, '250%', `${label}: double tap zooms in`);
  await page.getByRole('button', { name: 'Reset zoom' }).click();
  await page.waitForTimeout(150);
  assertFits(await measure(page), `${label}, after reset`);
  assert.equal((await measure(page)).scrollY, 0, `${label}: the page behind did not scroll`);
}

// Firefox leaves native fullscreen when the window is resized; the viewer must follow and can re-enter.
async function refullscreen(page) {
  if (await page.evaluate(() => document.querySelector('.photography-lightbox-backdrop').classList.contains('is-fullscreen'))) return;
  await page.getByRole('button', { name: 'Enter fullscreen' }).click();
  await page.waitForFunction(() => document.querySelector('.photography-lightbox-backdrop').classList.contains('is-fullscreen'));
  await page.waitForTimeout(300);
}

async function runEngine(run, fixtures) {
  const browser = await run.type.launch();
  const options = run.device ? { ...devices[run.device] } : { viewport: { width: 1440, height: 900 } };
  if (run.type === firefox) delete options.isMobile;
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Synthesised pointers have no real pointer to capture.
  await page.addInitScript(() => {
    for (const name of ['setPointerCapture', 'releasePointerCapture']) {
      const original = Element.prototype[name];
      Element.prototype[name] = function capture(...args) { try { return original.apply(this, args); } catch { return undefined; } };
    }
  });
  await page.route(`**/${substitute.viewerFilename.replace(/\.jpg$/, '')}*`, (route, request) => {
    const size = page.currentSize;
    if (!size || request.resourceType() !== 'image') return route.continue();
    return route.fulfill({ contentType: 'image/jpeg', body: fixtures[size.join('x')] });
  });
  try {
    for (const photo of PHOTOS) {
      page.currentSize = photo.size;
      await runPhoto(page, run, photo);
    }

    // Rotation and resizing while zoomed refit the photo to the new viewport.
    page.currentSize = undefined;
    await page.goto('about:blank');
    await page.goto(`http://localhost:${PORT}/photography/#${encodeURIComponent(slug(landscape))}`);
    await page.waitForFunction(() => document.querySelector('.photography-lightbox img')?.naturalWidth > 0);
    await page.getByRole('button', { name: 'Enter fullscreen' }).click();
    await page.waitForFunction(() => document.querySelector('.photography-lightbox-backdrop').classList.contains('is-fullscreen'));
    const { width, height } = page.viewportSize();
    await page.setViewportSize({ width: height, height: width });
    await page.waitForTimeout(400);
    await refullscreen(page);
    assertFits(await measure(page), `${run.name}, rotated`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${run.key}-rotated.png`) });
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(400);
    await refullscreen(page);
    assertFits(await measure(page), `${run.name}, rotated back`);

    // Previous and next keep fullscreen; Escape leaves fullscreen, then closes the viewer.
    const caption = () => page.locator('.photography-lightbox').getAttribute('aria-label');
    const first = await caption();
    await page.getByRole('button', { name: 'Previous photograph' }).click();
    await page.waitForFunction((text) => document.querySelector('.photography-lightbox').getAttribute('aria-label') !== text, first);
    await page.waitForFunction(() => document.querySelector('.photography-lightbox img')?.naturalWidth > 0);
    await page.waitForTimeout(200);
    assertFits(await measure(page), `${run.name}, previous photograph`);
    await page.getByRole('button', { name: 'Next photograph' }).click();
    await page.waitForFunction((text) => document.querySelector('.photography-lightbox').getAttribute('aria-label') === text, first);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.photography-lightbox-backdrop').classList.contains('is-fullscreen'));
    await page.getByRole('button', { name: 'Close photograph' }).click();
    await page.waitForFunction(() => !document.querySelector('.photography-lightbox'));
    assert.equal(await page.evaluate(() => document.body.style.position), '', `${run.name}: the page is unlocked after closing`);
    assert.deepEqual(errors, [], `${run.name}: no page errors`);
    console.log(`ok  ${run.name}`);
  } finally {
    await browser.close();
  }
}

await build({ root, logLevel: 'silent', configFile: path.join(root, 'vite.config.mjs') });
const server = await preview({ root, configFile: path.join(root, 'vite.config.mjs'), preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
const fixtures = { '2000x2000': await synthetic(2000, 2000), '2400x800': await synthetic(2400, 800) };
let failed = false;
try {
  for (const run of RUNS) {
    try { await runEngine(run, fixtures); } catch (error) { failed = true; console.error(`FAIL ${run.name}: ${error.message}`); }
  }
} finally {
  await server.close();
}
if (failed) process.exit(1);
