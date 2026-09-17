/**
 * Real-layout regression checks (jsdom cannot implement CSS scroll snapping).
 * Start Vite and a disposable Chromium browser with --remote-debugging-port=9222,
 * then run: node scripts/check-photography-scroll.mjs
 * Optional: PORTFOLIO_URL and CDP_URL override the local server/debugger URLs.
 */
import assert from 'node:assert/strict';

const origin = process.env.PORTFOLIO_URL || 'http://127.0.0.1:5173';
const debuggerUrl = process.env.CDP_URL || 'http://127.0.0.1:9222';
const tab = await (await fetch(`${debuggerUrl}/json/new?about:blank`, { method: 'PUT' })).json();
const socket = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let sequence = 0;
const pending = new Map();
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timeout);
  if (message.error) request.reject(new Error(JSON.stringify(message.error)));
  else request.resolve(message.result);
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 10000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(expression) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(expression)) return;
    await delay(50);
  }
  throw new Error(`Condition not reached: ${expression}`);
}
async function settle() {
  await evaluate('document.fonts.ready.then(() => true)');
  // Include smooth scrolling and the two-frame overlay unlock/re-snap window.
  await delay(700);
}
async function enter(path, ready) {
  await send('Page.navigate', { url: `${origin}${path}` });
  await waitFor(ready);
  await settle();
}
const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const galleryReady = "!!document.querySelector('.photography-page-grid')";
const viewerReady = "!!document.querySelector('.photography-lightbox')";
const close = '[aria-label="Close photograph"]';
async function expectTop(label) {
  await settle();
  assert.equal(await evaluate('scrollY'), 0, label);
}

try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await enter('/photography', galleryReady);
  await expectTop('Normal Photography entry stays at the top');
  assert.equal(await evaluate('getComputedStyle(document.documentElement).scrollSnapType'), 'none');
  assert.equal(await evaluate('history.scrollRestoration'), 'auto');
  await evaluate(`Promise.all([...document.querySelectorAll('.photography-page-grid img')].map(image => { image.loading = 'eager'; return image.decode().catch(() => {}); }))`);
  await expectTop('Image loading does not move the page');

  await enter('/photography/#IMG_0846', viewerReady);
  assert.match(await evaluate("document.querySelector('.photography-lightbox').textContent"), /My 2011 Subaru WRX after dark/);
  await click(close);
  await waitFor(`!(${viewerReady})`);
  await expectTop('Deep-link close does not scroll to the last thumbnail');
  assert.equal(await evaluate('document.activeElement.closest("[data-photo-slug]")?.dataset.photoSlug'), 'IMG_0846');

  await evaluate("window.scrollTo({top: 700, behavior: 'instant'})");
  const position = await evaluate('scrollY');
  await click('[data-photo-slug="_DSC0023"] a');
  await waitFor(viewerReady);
  await click('[aria-label="Next photograph"]');
  await waitFor("location.hash === '#DIBS2164'");
  await click('[aria-label="Previous photograph"]');
  await waitFor("location.hash === '#_DSC0023'");
  await click(close);
  await settle();
  assert.equal(await evaluate('scrollY'), position, 'Close preserves the gallery position');
  assert.equal(await evaluate('document.activeElement.closest("[data-photo-slug]")?.dataset.photoSlug'), '_DSC0023');
  await evaluate('history.back()');
  await waitFor(viewerReady);
  await evaluate('history.forward()');
  await waitFor(`!(${viewerReady})`);
  await settle();
  assert.equal(await evaluate('scrollY'), position, 'Back/Forward close preserves the gallery position');

  await click('.photography-modal-back-link');
  await waitFor("!!document.querySelector('#photography-modal-gallery')");
  await click('.photography-view-all');
  await waitFor(galleryReady);
  await expectTop('About modal View all enters at the top after overlay cleanup');
  await evaluate('history.back()');
  await waitFor("!!document.querySelector('#photography-modal-gallery')");
  await evaluate('history.forward()');
  await waitFor(galleryReady);
  await expectTop('Forward to the gallery stays at the top');

  await enter('/', "!!document.querySelector('.home-header')");
  assert.equal(await evaluate('getComputedStyle(document.documentElement).scrollSnapType'), 'y mandatory', 'Home snapping remains enabled');
  assert.equal(await evaluate('history.scrollRestoration'), 'auto');
  console.log('PASS: normal entry, image layout, direct photo, focus/scroll restoration, previous/next, history, About modal return, home snapping.');
} finally {
  socket.close();
  await fetch(`${debuggerUrl}/json/close/${tab.id}`);
}
