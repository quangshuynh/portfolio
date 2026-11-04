// Repeatable load measurements of /photography/ on a production build (or a deployed URL):
// LCP, CLS, which image files load before any scroll and in a full scroll, viewer open and
// next/previous timings with blank-frame counts. Assets are served with Vercel's cache headers
// (hashed /assets immutable, HTML revalidated) so warm runs match production. Chromium runs
// on broadband and Lighthouse-style slow 4G (CDP throttling, CPU 4x); Firefox and WebKit run
// unthrottled. Every scenario repeats RUNS times and reports p50/p95.
// Usage: npm run build && npm run measure:photography [-- --url https://quanghuynh.com | --dist other-dist] [--json out.json]
//   MEASURE_ENGINES=chromium,firefox,webkit  MEASURE_RUNS=5  MEASURE_SCENARIOS=load,scroll,viewer,editor,sessions
//   MEASURE_SESSIONS=30: viewer openings in the long-session scenario (heap, DOM nodes, listeners).
//   MEASURE_THROTTLE=server throttles in the server instead (every engine; logs cancelled responses).
//   MEASURE_VIEWER_SLOW_PAGE=1 throttles the viewer scenario from page load (default: from opening).
//   MEASURE_PROFILES=desktop,desktop-2x,mobile (also mobile-2x)  MEASURE_NETWORKS=broadband,slow-4g
//   RAW_COMPAT_DIR=<genuine RAW files> adds RAW previews to the editor scenario (MEASURE_RAW_FILES to choose).
import { createReadStream, existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { createGzip } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium, firefox, webkit, devices } = await import('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const dist = path.resolve(arg('--dist') ?? path.join(root, 'dist'));
const remote = arg('--url');
const RUNS = Number(process.env.MEASURE_RUNS || 5);
const ENGINES = (process.env.MEASURE_ENGINES || 'chromium,firefox,webkit').split(',');
const SCENARIOS = (process.env.MEASURE_SCENARIOS || 'load,scroll,viewer').split(','); // also: editor

// ---------- Vercel-like static server ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.ico': 'image/x-icon' };
// Server-side slow network (MEASURE_THROTTLE=server), for every engine: a latency per request
// and one bandwidth shared by all responses, sent in 8 KB chunks. Every response is logged
// with its chunks and whether the browser abandoned it, which shows cancellation in Firefox
// and WebKit too. Local HTTP/1.1 (six connections) unlike production HTTP/2.
let serverNetwork = null;
let serverLog = [];
let bucketFree = 0;
function sendThrottled(stream, response, entry) {
  const { latency, downloadThroughput } = serverNetwork;
  const chunks = [];
  let ended = false;
  let pumping = false;
  const pump = async () => {
    if (pumping) return;
    pumping = true;
    await new Promise((resolve) => setTimeout(resolve, latency));
    while (chunks.length || !ended) {
      if (!chunks.length) { await new Promise((resolve) => setTimeout(resolve, 5)); continue; }
      if (response.destroyed) return;
      const chunk = chunks.shift();
      const now = Date.now();
      bucketFree = Math.max(bucketFree, now) + (chunk.length / downloadThroughput) * 1000;
      await new Promise((resolve) => setTimeout(resolve, bucketFree - now));
      if (response.destroyed) return;
      response.write(chunk);
      entry.chunks.push([Date.now(), chunk.length]);
    }
    response.end();
  };
  stream.on('data', (data) => { for (let i = 0; i < data.length; i += 8192) chunks.push(data.subarray(i, i + 8192)); pump(); });
  stream.on('end', () => { ended = true; pump(); });
}
function serve() {
  if (!existsSync(path.join(dist, 'photography/index.html'))) throw new Error('Run `npm run build` first.');
  const server = createServer((request, response) => {
    let pathname = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    if (pathname === '/photography/editor') pathname = '/photography/editor/index.html';
    const file = path.join(dist, pathname);
    if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) { response.writeHead(404).end(); return; }
    const immutable = pathname.startsWith('/assets/') || pathname.startsWith('/photography/editor-models/');
    // Text is compressed as on Vercel; images are sent as they are.
    const compress = /\.(html|js|css|json|svg|txt)$/.test(file) && /gzip/.test(request.headers['accept-encoding'] ?? '');
    response.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      ...(compress ? { 'content-encoding': 'gzip', vary: 'accept-encoding' } : { 'content-length': statSync(file).size }),
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
    });
    const stream = compress ? createReadStream(file).pipe(createGzip()) : createReadStream(file);
    if (!serverNetwork) { stream.pipe(response); return; }
    const entry = { url: new URL(request.url, 'http://x').pathname, start: Date.now(), end: null, chunks: [], bytes: 0, canceled: false };
    serverLog.push(entry);
    response.on('close', () => {
      stream.destroy();
      entry.end = Date.now();
      entry.bytes = entry.chunks.reduce((sum, [, bytes]) => sum + bytes, 0);
      entry.canceled = !response.writableFinished;
    });
    sendThrottled(stream, response, entry);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ---------- helpers ----------
const quantile = (values, q) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
};
const summary = (values) => ({ p50: round(quantile(values, 0.5)), p95: round(quantile(values, 0.95)) });
const round = (value) => (value === null ? null : Math.round(value * 10) / 10);
const kb = (bytes) => Math.round(bytes / 1024);
// WebKit reports no body sizes for many responses: locally the file on disk is the size.
const sizeOf = ({ name, bytes }) => {
  const file = path.join(dist, 'assets', name.split('?')[0]);
  return !remote && existsSync(file) ? statSync(file).size : bytes;
};
// Same-origin image size: transferSize is 0 from cache, so the encoded body size is used and
// cached responses are counted separately.
const IMAGE_ENTRIES = `performance.getEntriesByType('resource').filter((entry) => /\\.(jpe?g|webp|avif|png)(\\?|$)/.test(entry.name) && entry.name.includes('/assets/'))
  .map((entry) => ({ name: entry.name.split('/').pop(), bytes: entry.encodedBodySize || entry.decodedBodySize, cached: entry.transferSize === 0, start: entry.startTime, end: entry.responseEnd }))`;

const PROFILES = [
  { key: 'desktop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  { key: 'desktop-2x', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  { key: 'mobile', device: 'iPhone 13' },
  { key: 'mobile-2x', device: 'iPhone SE', optional: true },
].filter((profile) => (process.env.MEASURE_PROFILES ? process.env.MEASURE_PROFILES.split(',').includes(profile.key) : !profile.optional));
const NETWORKS = {
  broadband: null,
  'slow-4g': { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, cpu: 4 },
};

async function newContext(browser, engine, profile) {
  const options = profile.device ? { ...devices[profile.device] } : { viewport: profile.viewport, deviceScaleFactor: profile.deviceScaleFactor };
  if (engine === 'firefox') delete options.isMobile; // Firefox has no mobile emulation.
  return browser.newContext({ ...options, reducedMotion: 'reduce' });
}

const SERVER_THROTTLE = process.env.MEASURE_THROTTLE === 'server';
async function throttle(page, engine, network) {
  if (SERVER_THROTTLE && network) serverNetwork = network;
  if (engine !== 'chromium' || !network) return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  if (!SERVER_THROTTLE) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: network.latency, downloadThroughput: network.downloadThroughput, uploadThroughput: network.uploadThroughput });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: network.cpu });
}

// LCP and CLS observers installed before any page script runs.
const OBSERVERS = () => {
  window.__perf = { lcp: null, lcpUrl: null, cls: 0 };
  try {
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) { window.__perf.lcp = entry.startTime; window.__perf.lcpUrl = entry.url; } }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch { /* WebKit/Firefox without LCP */ }
  try {
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__perf.cls += entry.value; }).observe({ type: 'layout-shift', buffered: true });
  } catch { /* not supported */ }
};

// Time until the hero <img> has decoded and is complete, as a cross-engine LCP stand-in.
const heroReady = (page) => page.waitForFunction(() => {
  const image = document.querySelector('.photography-hero__media img');
  return image && image.complete && image.naturalWidth > 0;
}, null, { timeout: 120_000 });

async function measureLoad(browser, engine, profile, network, warm) {
  const context = await newContext(browser, engine, profile);
  await context.addInitScript(OBSERVERS);
  const page = await context.newPage();
  await throttle(page, engine, network);
  if (warm) {
    await page.goto(`${base}/photography/`, { waitUntil: 'load' });
    await heroReady(page);
    await page.waitForTimeout(500);
  }
  const started = Date.now();
  await page.goto(`${base}/photography/`, { waitUntil: 'commit' });
  await heroReady(page);
  const heroMs = Date.now() - started;
  await page.waitForLoadState('load');
  await page.waitForTimeout(1500);
  serverNetwork = null;
  const result = await page.evaluate(`({ perf: window.__perf, images: ${IMAGE_ENTRIES}, hero: document.querySelector('.photography-hero__media img').currentSrc.split('/').pop(), navStart: performance.timeOrigin })`);
  await context.close();
  // A cold context has nothing cached (WebKit reports transferSize 0 even for network responses).
  const transferred = warm ? result.images.filter(({ cached }) => !cached) : result.images;
  return {
    heroMs,
    lcp: result.perf.lcp,
    cls: result.perf.cls,
    hero: result.hero,
    imageCount: result.images.length,
    imageKB: kb(transferred.reduce((sum, entry) => sum + sizeOf(entry), 0)),
    images: result.images.map(({ name }) => name),
  };
}

const widths = new Map();
async function fileWidth(name) {
  if (!widths.has(name)) {
    const { default: sharp } = await import('sharp');
    const bytes = remote ? Buffer.from(await (await fetch(`${base}/assets/${name}`)).arrayBuffer()) : await import('node:fs/promises').then(({ readFile }) => readFile(path.join(dist, 'assets', name)));
    widths.set(name, (await sharp(bytes).metadata()).width);
  }
  return widths.get(name);
}

async function measureScroll(browser, engine, profile) {
  const context = await newContext(browser, engine, profile);
  const page = await context.newPage();
  await page.goto(`${base}/photography/`, { waitUntil: 'load' });
  await heroReady(page);
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 600) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(2500);
  const images = await page.evaluate(IMAGE_ENTRIES);
  // Frames whose rendered width needs more pixels than the file chosen (upscaled) or less than
  // half of it (oversized), at the device pixel ratio.
  // naturalWidth is density-corrected for srcset images, so the chosen file's own width is read.
  const shown = await page.evaluate(() => [...document.querySelectorAll('main img')].filter((image) => image.currentSrc && image.complete && /\/assets\/.*\.jpe?g/.test(image.currentSrc))
    .map((image) => ({ need: image.getBoundingClientRect().width * devicePixelRatio, name: image.currentSrc.split('/').pop() })));
  const fit = [];
  for (const { need, name } of shown) fit.push({ need, have: await fileWidth(name) });
  await context.close();
  return {
    imageCount: images.length,
    imageKB: kb(images.reduce((sum, entry) => sum + sizeOf(entry), 0)),
    viewerFiles: images.filter(({ name }) => name.includes('-viewer')).length,
    upscaled: fit.filter(({ need, have }) => have < need * 0.95).length,
    oversized: fit.filter(({ need, have }) => have > need * 2.2).length,
  };
}

// Long session: SESSIONS openings from the archive, each stepping, zooming and closing, with the
// viewport rotated every fifth (phones). Chromium samples, after a forced GC, the JS heap, DOM
// nodes and event listeners (CDP); every engine reports viewer images left in the page and
// gallery images still without a file (paused and never resumed).
const SESSIONS = Number(process.env.MEASURE_SESSIONS || 30);
async function measureSessions(browser, engine, profile, network) {
  const context = await newContext(browser, engine, profile);
  const page = await context.newPage();
  await throttle(page, engine, network);
  await page.goto(`${base}/photography/`, { waitUntil: 'load' });
  await heroReady(page);
  const first = page.locator('#photography-gallery figure a').first();
  await first.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  const cdp = engine === 'chromium' ? await context.newCDPSession(page) : null;
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  const sample = async () => {
    const dom = await page.evaluate(() => ({
      viewerImages: document.querySelectorAll('.photography-lightbox-image-wrap img').length,
      unresumed: [...document.querySelectorAll('main img')].filter((image) => !image.hasAttribute('src') && !image.hasAttribute('srcset')).length,
      scrollY: Math.round(window.scrollY),
    }));
    if (!cdp) return dom;
    await cdp.send('HeapProfiler.collectGarbage');
    const { usedSize } = await cdp.send('Runtime.getHeapUsage');
    const { nodes, jsEventListeners } = await cdp.send('Memory.getDOMCounters');
    return { ...dom, heapMB: round(usedSize / 1048576), nodes, listeners: jsEventListeners };
  };
  const samples = [{ session: 0, ...(await sample()) }];
  const shown = () => page.waitForFunction(() => document.querySelector('.photography-lightbox-image-wrap img[data-full]')?.dataset.loaded === 'true', null, { timeout: 60_000 })
    .catch(async (error) => {
      console.log('  stalled', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.photography-lightbox-image-wrap img')].map((image) => ({ src: image.getAttribute('src'), complete: image.complete, w: image.naturalWidth, loaded: image.dataset.loaded, sharp: image.dataset.sharp })))));
      throw error;
    });
  const viewport = page.viewportSize();
  const trace = (step) => process.env.MEASURE_VERBOSE && console.log(`  ${step}`);
  for (let session = 1; session <= SESSIONS; session += 1) {
    trace(`session ${session}`);
    await page.locator('#photography-gallery figure a').nth(session % 8).click();
    await shown();
    trace('step');
    for (const key of ['ArrowRight', 'ArrowRight', 'ArrowLeft']) await page.keyboard.press(key);
    await shown();
    trace('zoom');
    await page.keyboard.press('+');
    await page.keyboard.press('+');
    await page.waitForTimeout(150);
    await page.keyboard.press('0');
    for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowRight');
    await shown();
    if (profile.device && session % 5 === 0) {
      const rotated = page.viewportSize().width === viewport.width;
      await page.setViewportSize(rotated ? { width: viewport.height, height: viewport.width } : viewport);
      await page.waitForTimeout(200);
    }
    trace('close');
    // The button, not Escape: WebKit desktop (Playwright, main as well) sometimes drops that key here.
    await page.getByRole('button', { name: 'Close photograph' }).click();
    await page.waitForFunction(() => !document.querySelector('.photography-lightbox-image-wrap')).catch(async (error) => {
      console.log('  close stalled', JSON.stringify(await page.evaluate(() => ({ hash: location.hash, body: document.body.style.position }))), [...new Set(errors)].slice(0, 3));
      throw error;
    });
    // Each session makes ~10 history entries; WebKit refuses more than 100 per 10 s.
    await page.waitForTimeout(1200);
    if (session % 10 === 0) samples.push({ session, ...(await sample()) });
  }
  await context.close();
  serverNetwork = null;
  return samples;
}

// Every request of the page with its bytes per moment (Chromium, CDP): resource timing has no
// entry for a cancelled request, so this is how cancellation and contention are seen. Times are
// wall-clock ms, comparable with Date.now() here.
async function recordRequests(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  const requests = new Map();
  let offset = 0; // wall ms − monotonic ms
  cdp.on('Network.requestWillBeSent', ({ requestId, request, timestamp, wallTime }) => {
    offset = wallTime * 1000 - timestamp * 1000;
    requests.set(requestId, { url: request.url, start: wallTime * 1000, end: null, chunks: [], bytes: 0, canceled: false, failed: false });
  });
  cdp.on('Network.dataReceived', ({ requestId, timestamp, encodedDataLength, dataLength }) => {
    const entry = requests.get(requestId);
    if (entry) entry.chunks.push([timestamp * 1000 + offset, encodedDataLength || dataLength]);
  });
  cdp.on('Network.loadingFinished', ({ requestId, timestamp, encodedDataLength }) => {
    const entry = requests.get(requestId);
    if (entry) Object.assign(entry, { end: timestamp * 1000 + offset, bytes: encodedDataLength });
  });
  cdp.on('Network.loadingFailed', ({ requestId, timestamp, canceled }) => {
    const entry = requests.get(requestId);
    if (entry) Object.assign(entry, { end: timestamp * 1000 + offset, canceled: Boolean(canceled), failed: true, bytes: entry.chunks.reduce((sum, [, b]) => sum + b, 0) });
  });
  return () => [...requests.values()].filter(({ url }) => /\/assets\/.*\.(jpe?g|webp|avif|png)(\?|$)/.test(url));
}
const receivedBetween = (entry, from, to) => entry.chunks.reduce((sum, [time, bytes]) => sum + (time >= from && time <= to ? bytes : 0), 0);

// Opens the viewer from the archive, then steps forward and back, zooms, steps rapidly and
// closes. "Blank" means a sampled animation frame where the viewer shows no painted photograph.
// Files the viewer asked for (its <img> elements and Image() prefetches/upgrades) are told
// apart from the gallery's, so background traffic while the viewer is open can be counted.
async function measureViewer(browser, engine, profile, network) {
  const context = await newContext(browser, engine, profile);
  await context.addInitScript(() => {
    window.__viewerFrames = { blank: 0, total: 0 };
    window.__viewerUrls = new Set();
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ...descriptor,
      set(value) {
        if (!this.isConnected && window.__viewerOpen && value) window.__viewerUrls.add(new URL(value, document.baseURI).href);
        descriptor.set.call(this, value);
      },
    });
    const sample = () => {
      const wrap = document.querySelector('.photography-lightbox-image-wrap');
      window.__viewerOpen = Boolean(wrap) || window.__viewerOpen;
      if (wrap) {
        window.__viewerFrames.total += 1;
        const images = [...wrap.querySelectorAll('img')];
        images.forEach((image) => image.currentSrc && window.__viewerUrls.add(image.currentSrc));
        const shown = images.some((image) => image.complete && image.naturalWidth > 0 && getComputedStyle(image).opacity !== '0');
        if (!shown) window.__viewerFrames.blank += 1;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const page = await context.newPage();
  serverLog = [];
  const requests = SERVER_THROTTLE && network ? () => serverLog.filter(({ url }) => /\/assets\/.*\.(jpe?g|webp|avif|png)$/.test(url))
    : engine === 'chromium' ? await recordRequests(page) : null;
  // MEASURE_VIEWER_SLOW_PAGE=1: the whole visit on the network (the archive loads on it too).
  const early = Boolean(process.env.MEASURE_VIEWER_SLOW_PAGE);
  if (early) await throttle(page, engine, network);
  await page.goto(`${base}/photography/`, { waitUntil: 'load' });
  await heroReady(page);
  // Load the archive area as a visitor would before opening a photograph from it. The frame to
  // click is brought into view first: click() would otherwise scroll there under throttling,
  // waking lazy images above it that a visitor scrolling down has already loaded.
  const first = page.locator('#photography-gallery figure a').first();
  await first.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  if (!early) await throttle(page, engine, network);
  const viewerShown = () => page.waitForFunction(() => {
    const image = document.querySelector('.photography-lightbox-image-wrap img[data-full]') ?? document.querySelector('.photography-lightbox-image-wrap img');
    return image && image.complete && image.naturalWidth > 0 && image.dataset.loaded === 'true';
  }, null, { timeout: 60_000 });
  // The file the fitted size needs at the device pixel ratio is on screen (not the first, smaller one).
  const viewerSharp = () => page.waitForFunction(() => document.querySelector('.photography-lightbox-image-wrap img[data-full]')?.dataset.sharp !== 'false'
    && document.querySelector('.photography-lightbox-image-wrap img[data-full]').complete, null, { timeout: 60_000 });
  const anyShown = () => page.waitForFunction(() => [...document.querySelectorAll('.photography-lightbox-image-wrap img')].some((image) => image.complete && image.naturalWidth > 0 && getComputedStyle(image).opacity !== '0'), null, { timeout: 60_000, polling: 'raf' });
  const openedAt = await page.evaluate(() => performance.now());
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const openedWall = Date.now();
  let started = Date.now();
  await first.click();
  await anyShown();
  const openVisible = Date.now() - started;
  await viewerShown();
  const openFull = Date.now() - started;
  await viewerSharp();
  const openSharp = Date.now() - started;
  const steps = [];
  for (const key of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'ArrowRight']) {
    await page.waitForTimeout(400);
    started = Date.now();
    if (process.env.MEASURE_VERBOSE) console.log(`  press ${key} at ${Math.round(await page.evaluate(() => performance.now()) - openedAt)} ms`);
    await page.keyboard.press(key);
    await anyShown();
    const visible = Date.now() - started;
    await viewerShown();
    const full = Date.now() - started;
    await viewerSharp();
    steps.push({ visible, full, sharp: Date.now() - started });
  }
  // Zoom to 200 % (keyboard): the full-size file must arrive.
  await page.waitForTimeout(400);
  started = Date.now();
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('+');
  await viewerSharp();
  const zoomSharp = Date.now() - started;
  await page.keyboard.press('0');
  // Rapid navigation: ten steps without waiting, then the shown photograph must be the last one.
  for (let i = 0; i < 10; i += 1) await page.keyboard.press('ArrowRight');
  await viewerShown();
  await page.waitForTimeout(1500);
  const frames = await page.evaluate(() => window.__viewerFrames);
  // Image files requested after opening: bytes and how many were 2200 px viewer files.
  const fetched = (await page.evaluate(IMAGE_ENTRIES)).filter(({ start }) => start >= openedAt);
  const viewerUrls = new Set(await page.evaluate(() => [...window.__viewerUrls].map((url) => new URL(url).pathname)));
  // Close: the page must be back where it was, and the gallery must recover without a burst.
  const closedWall = Date.now();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.photography-lightbox-image-wrap'));
  // WebKit unlocks the page (and restores the scroll) a frame after the viewer is gone.
  await page.waitForFunction(() => document.body.style.position !== 'fixed');
  const scrollAfter = await page.evaluate(() => window.scrollY);
  await page.waitForTimeout(network ? 6000 : 2000);
  const recovered = await page.evaluate(() => {
    const visible = [...document.querySelectorAll('main img')].filter((image) => {
      const rect = image.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < innerHeight && rect.width > 0;
    });
    return { visible: visible.length, complete: visible.filter((image) => image.complete && image.naturalWidth > 0).length };
  });
  const log = requests ? requests() : [];
  // A file the viewer showed may have been requested by the gallery before opening: only
  // requests made after opening count as the viewer's.
  const isViewer = ({ url, start }) => start >= openedWall && viewerUrls.has(new URL(url, 'http://x').pathname);
  const gallery = log.filter((entry) => !isViewer(entry));
  const viewer = log.filter(isViewer);
  const overlapping = gallery.filter(({ start, end }) => start < closedWall && (end === null || end > openedWall));
  const network_ = requests ? {
    // From the click to the first viewer request.
    viewerStartMs: Math.round(Math.min(...viewer.filter(({ start }) => start >= openedWall).map(({ start }) => start)) - openedWall),
    galleryOverlap: overlapping.length,
    galleryStartedOpen: gallery.filter(({ start }) => start >= openedWall && start < closedWall).length,
    galleryKBOpen: kb(gallery.reduce((sum, entry) => sum + receivedBetween(entry, openedWall, closedWall), 0)),
    viewerKBOpen: kb(viewer.reduce((sum, entry) => sum + receivedBetween(entry, openedWall, closedWall), 0)),
    canceled: log.filter(({ canceled, start }) => canceled && start < closedWall).length,
    canceledKB: kb(log.filter(({ canceled }) => canceled).reduce((sum, { chunks }) => sum + chunks.reduce((s, [, b]) => s + b, 0), 0)),
    totalKB: kb(log.reduce((sum, { bytes, chunks, end }) => sum + (end ? bytes : chunks.reduce((s, [, b]) => s + b, 0)), 0)),
    // Gallery requests in the first second after closing (a burst would be many).
    burstAfterClose: gallery.filter(({ start }) => start >= closedWall && start < closedWall + 1000).length,
  } : {};
  if (process.env.MEASURE_VERBOSE) {
    console.log('steps', JSON.stringify(steps), 'zoomSharp', zoomSharp, JSON.stringify(network_));
    for (const entry of log) console.log(`  ${isViewer(entry) ? 'V' : 'g'} ${Math.round(entry.start - openedWall)}–${entry.end ? Math.round(entry.end - openedWall) : '…'} ms ${entry.url.split('/').pop()} ${kb(entry.bytes)} KB${entry.canceled ? ' (cancelled)' : ''}`);
    if (!requests) for (const entry of fetched) console.log(`  ${Math.round(entry.start - openedAt)}–${Math.round(entry.end - openedAt)} ms ${entry.name} ${kb(sizeOf(entry))} KB${entry.cached ? ' (cache)' : ''}`);
  }
  await context.close();
  serverNetwork = null;
  return { openVisible, openFull, openSharp, steps, zoomSharp, blankFrames: frames.blank, frames: frames.total,
    viewerKB: kb(fetched.reduce((sum, entry) => sum + sizeOf(entry), 0)), viewerFiles: fetched.filter(({ name }) => name.includes('-viewer')).length, files: fetched.length,
    scrollRestored: scrollBefore === scrollAfter, recovered, network: network_ };
}


// Editor startup: time to the ready interface, scripts/WASM/models fetched before any file is
// opened, then time from choosing a file to its first preview (JPEG and genuine RAW files from
// RAW_COMPAT_DIR, when set). Files stay local; nothing is uploaded.
const EDITOR_FIXTURES = [];
async function editorFixtures() {
  if (EDITOR_FIXTURES.length) return EDITOR_FIXTURES;
  const { default: sharp } = await import('sharp');
  const dir = mkdtempSync(path.join(tmpdir(), 'measure-editor-'));
  const jpeg = path.join(dir, 'gradient-24mp.jpg');
  const { width, height } = { width: 6000, height: 4000 };
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) data.set([(x / width) * 255, (y / height) * 255, 128 + 100 * Math.sin((x + y) / 300)], (y * width + x) * 3);
  await sharp(data, { raw: { width, height, channels: 3 } }).jpeg({ quality: 92 }).toFile(jpeg);
  EDITOR_FIXTURES.push({ label: 'jpeg-24mp', file: jpeg });
  const rawDir = process.env.RAW_COMPAT_DIR;
  if (rawDir && existsSync(rawDir)) {
    for (const name of (process.env.MEASURE_RAW_FILES || 'Nikon-Z6.NEF,Canon-EOS-R.CR3,Fujifilm-X-T4.RAF,Panasonic-G9.RW2,OM-System-OM-1.ORF,Canon-5D-Mark-IV.CR2,Ricoh-GR-III.DNG').split(',')) {
      if (existsSync(path.join(rawDir, name))) EDITOR_FIXTURES.push({ label: name, file: path.join(rawDir, name) });
    }
  }
  return EDITOR_FIXTURES;
}

async function measureEditor(browser, engine, profile, network) {
  const context = await newContext(browser, engine, profile);
  const page = await context.newPage();
  await throttle(page, engine, network);
  const started = Date.now();
  await page.goto(`${base}/photography/editor`, { waitUntil: 'commit' });
  await page.waitForFunction(() => document.documentElement.dataset.editor === 'ready', null, { timeout: 120_000 });
  const readyMs = Date.now() - started;
  await page.waitForTimeout(2000);
  const startup = await page.evaluate(() => {
    const entries = performance.getEntriesByType('resource');
    const pick = (pattern) => entries.filter(({ name }) => pattern.test(name));
    const sum = (list) => Math.round(list.reduce((total, entry) => total + (entry.encodedBodySize || entry.transferSize || 0), 0) / 1024);
    return {
      jsKB: sum(pick(/\.m?js(\?|$)/)),
      jsFiles: pick(/\.m?js(\?|$)/).map(({ name }) => name.split('/').pop().replace(/-[\w-]{8}\.js$/, '')),
      wasmKB: sum(pick(/\.wasm(\?|$)/)),
      modelKB: sum(pick(/\.onnx|editor-models/)),
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    };
  });
  const imports = [];
  for (const { label, file } of await editorFixtures()) {
    if (profile.device && label !== 'jpeg-24mp') continue;
    const before = await page.$$eval('.pe-photo--list', (items) => items.length);
    const t0 = Date.now();
    await page.setInputFiles('input[type=file][multiple]', file);
    await page.waitForFunction((count) => {
      const items = document.querySelectorAll('.pe-photo--list');
      return items.length > count && items[items.length - 1].dataset.status !== 'importing';
    }, before, { timeout: 180_000 });
    const status = await page.$$eval('.pe-photo--list', (items) => items[items.length - 1].dataset.status);
    await page.waitForFunction(() => !document.querySelector('.pe-stage-message') && !document.querySelector('.pe-canvas-host')?.hidden, null, { timeout: 180_000 }).catch(() => {});
    imports.push({ label, status, previewMs: Date.now() - t0 });
  }
  await context.close();
  serverNetwork = null;
  return { readyMs, ...startup, imports };
}

// ---------- run ----------
const server = remote ? null : await serve();
const base = remote ?? `http://127.0.0.1:${server.address().port}`;
const engines = { chromium, firefox, webkit };
const report = { base: remote ?? 'local dist', runs: RUNS, results: [] };
const log = (label, value) => { console.log(`${label.padEnd(44)} ${JSON.stringify(value)}`); report.results.push({ label, ...value }); };

try {
  for (const engineName of ENGINES) {
    const browser = await engines[engineName].launch();
    try {
      for (const profile of PROFILES) {
        if (engineName === 'firefox' && profile.device) continue;
        const networks = (engineName === 'chromium' || SERVER_THROTTLE ? Object.keys(NETWORKS) : ['broadband'])
          .filter((network) => !process.env.MEASURE_NETWORKS || process.env.MEASURE_NETWORKS.split(',').includes(network));
        if (SCENARIOS.includes('load')) {
          for (const network of networks) {
            for (const warm of [false, true]) {
              const samples = [];
              for (let i = 0; i < RUNS; i += 1) samples.push(await measureLoad(browser, engineName, profile, NETWORKS[network], warm));
              log(`load ${engineName} ${profile.key} ${network} ${warm ? 'warm' : 'cold'}`, {
                hero: samples[0].hero,
                heroMs: summary(samples.map(({ heroMs }) => heroMs)),
                lcp: summary(samples.map(({ lcp }) => lcp).filter((value) => value !== null)),
                cls: round(Math.max(...samples.map(({ cls }) => cls)) * 1000) / 1000,
                images: samples[0].imageCount,
                imageKB: summary(samples.map(({ imageKB }) => imageKB)),
              });
            }
          }
        }
        if (SCENARIOS.includes('scroll')) log(`scroll ${engineName} ${profile.key}`, await measureScroll(browser, engineName, profile));
        if (SCENARIOS.includes('editor') && profile.key !== 'desktop-2x') {
          for (const network of networks) {
            const samples = [];
            for (let i = 0; i < RUNS; i += 1) samples.push(await measureEditor(browser, engineName, profile, NETWORKS[network]));
            const labels = samples[0].imports.map(({ label }) => label);
            log(`editor ${engineName} ${profile.key} ${network}`, {
              readyMs: summary(samples.map(({ readyMs }) => readyMs)),
              jsKB: samples[0].jsKB, wasmKB: samples[0].wasmKB, modelKB: samples[0].modelKB, heapMB: samples[0].heapMB,
              scripts: samples[0].jsFiles.length,
              previews: Object.fromEntries(labels.map((label) => [label, { ...summary(samples.map(({ imports }) => imports.find((entry) => entry.label === label)?.previewMs).filter(Boolean)), status: samples[0].imports.find((entry) => entry.label === label).status }])),
            });
            if (process.env.MEASURE_VERBOSE) console.log(samples[0].jsFiles.join(' '));
          }
        }
        if (SCENARIOS.includes('sessions')) {
          for (const network of networks) log(`sessions ${engineName} ${profile.key} ${network}`, { samples: await measureSessions(browser, engineName, profile, NETWORKS[network]) });
        }
        if (SCENARIOS.includes('viewer')) {
          for (const network of networks) {
            const samples = [];
            for (let i = 0; i < Math.max(1, Math.ceil(RUNS / 2)); i += 1) samples.push(await measureViewer(browser, engineName, profile, NETWORKS[network]));
            const steps = samples.flatMap(({ steps: values }) => values);
            log(`viewer ${engineName} ${profile.key} ${network}`, {
              openVisible: summary(samples.map(({ openVisible }) => openVisible)),
              openFull: summary(samples.map(({ openFull }) => openFull)),
              stepVisible: summary(steps.map(({ visible }) => visible)),
              stepFull: summary(steps.map(({ full }) => full)),
              openSharp: summary(samples.map(({ openSharp }) => openSharp)),
              stepSharp: summary(steps.map(({ sharp }) => sharp)),
              viewerKB: summary(samples.map(({ viewerKB }) => viewerKB)),
              viewerFiles: summary(samples.map(({ viewerFiles }) => viewerFiles)),
              zoomSharp: summary(samples.map(({ zoomSharp }) => zoomSharp)),
              blankFramePct: round((100 * samples.reduce((sum, { blankFrames }) => sum + blankFrames, 0)) / Math.max(1, samples.reduce((sum, { frames }) => sum + frames, 0))),
              scrollRestored: samples.every(({ scrollRestored }) => scrollRestored),
              recovered: samples.map(({ recovered }) => `${recovered.complete}/${recovered.visible}`).join(' '),
              ...(samples[0].network.viewerStartMs !== undefined ? {
                net: Object.fromEntries(Object.keys(samples[0].network).map((key) => [key, summary(samples.map(({ network: values }) => values[key]))])),
              } : {}),
            });
          }
        }
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  server?.close();
}
if (arg('--json')) writeFileSync(arg('--json'), JSON.stringify(report, null, 2));
