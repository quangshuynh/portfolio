import { openEditorTool } from './editor-mobile-controls.mjs';
// Brush responsiveness check of /photography/editor on a production build: a 24 MP photo (and,
// with BRUSH_FIXTURE_DIR, a genuine camera JPEG) gets a brush local adjustment with exposure, then
// a stroke is painted from inside the page, one pointer move per animation frame, as a mouse or a
// finger delivers them. Per move it records the main-thread time of the input handler, the time
// until the preview's next draw call (WebGL draw or 2D put/draw) and every long animation frame
// (Chromium); in Chromium a CPU profile of the stroke lists the functions that cost the most.
// The stroke must commit as one undo step and its exported pixels must not depend on how it
// was painted (one stroke versus the same points loaded from a document).
// Regression gate (BRUSH_STRICT=1, desktop Chromium only): the median main-thread time per move
// stays under BRUSH_MAX_MAIN_MS (default 40 ms), generous enough for headless software WebGL.
// Usage: npm run check:editor:brush (BRUSH_RUNS=chromium,cpu,iphone,pixel; CHECK_GPU=1: real GPU;
// BRUSH_SKIP_BUILD=1 reuses dist/; BRUSH_GL_TRACE=1 times each draw; BRUSH_CHROME_TRACE=f.json; BRUSH_MOVES=120; BRUSH_PROFILE=1 prints the CPU profile;
// BRUSH_PAUSE_MS=0 paints at once and BRUSH_HOVER=0 skips the desktop
// hover step (which waits for an idle preview); BRUSH_GL_TRACE=cpu times calls on the main thread only;
// BRUSH_TIMELINE=1 lists main-thread work from pointerdown to the first composited frame;
// BRUSH_LOCAL=clarity paints a local Clarity adjustment instead of exposure, and reports the time
// from release until the final Detail frame, then paints a second stroke; BRUSH_PAUSE_MS=500 is
// the pause between setting the value and painting)
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { build, preview } from 'vite';
import { chromium, devices, webkit } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'editor-brush-'));
const PORT = 4196;
const URL_EDITOR = `http://localhost:${PORT}/photography/editor/`;
const ONLY_RUNS = process.env.BRUSH_RUNS?.split(',');
const MOVES = Number(process.env.BRUSH_MOVES ?? 120);
const MAX_MAIN_MS = Number(process.env.BRUSH_MAX_MAIN_MS ?? 40);
const GENUINE_DIR = process.env.BRUSH_FIXTURE_DIR ?? '';
const PAUSE_MS = Number(process.env.BRUSH_PAUSE_MS ?? 500);
const LOCAL = process.env.BRUSH_LOCAL === 'clarity' ? { section: /^Detail/, label: 'Clarity', value: '60' } : { label: 'Exposure', value: '1.5' };
const GENUINE = GENUINE_DIR && existsSync(GENUINE_DIR) ? readdirSync(GENUINE_DIR).filter((name) => /\.jpe?g$/i.test(name)).sort().slice(0, 1).map((name) => path.join(GENUINE_DIR, name)) : [];
const GPU_ARGS = process.env.CHECK_GPU ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : [];

const RUNS = [
  { id: 'chromium', name: 'Chromium, desktop', type: chromium, args: GPU_ARGS, profile: true, gate: true },
  { id: 'cpu', name: 'Chromium, desktop, no WebGL2', type: chromium, init: 'noWebgl2' },
  { id: 'iphone', name: 'WebKit, iPhone 13 emulation', type: webkit, device: 'iPhone 13' },
  { id: 'pixel', name: 'Chromium, Pixel 7 emulation', type: chromium, device: 'Pixel 7' },
];
const INIT = {
  noWebgl2: () => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) { return type === 'webgl2' ? null : original.call(this, type, ...rest); };
  },
};
// BRUSH_GL_TRACE=1: every WebGL draw is followed by a 1×1 readPixels and timed, grouped by target
// (canvas or framebuffer), viewport and program, to show which passes cost GPU time. gl.finish()
// is not enough: headless Chromium with SwiftShader returns from it before the work runs. It
// serialises the GPU, so its frame times are not comparable with untraced runs.
const GL_TRACE = () => {
  const proto = globalThis.WebGL2RenderingContext?.prototype;
  if (!proto) return;
  window.__glTrace = [];
  const pixel = new Uint8Array(4);
  const sync = (gl) => {
    // A float framebuffer (HDR, glow) cannot be read as RGBA8; those draws are timed unsynced.
    try { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); } catch { /* ignore */ }
    gl.getError();
  };
  const programs = new WeakMap();
  let nextProgram = 0;
  // BRUSH_GL_TRACE=cpu: every call is timed on the main thread only (no readback), so it shows
  // which calls block the page (waiting on the GPU process) without serialising the GPU.
  if (window.__glTraceCpu) {
    // 2D canvas calls too (the mask overlay): an accelerated canvas also waits on the GPU process.
    for (const [kind, target] of [['gl', proto], ['2d', globalThis.CanvasRenderingContext2D?.prototype]]) {
      for (const name of Object.getOwnPropertyNames(target ?? {})) {
        const fn = Object.getOwnPropertyDescriptor(target, name).value;
        if (typeof fn !== 'function' || name === 'constructor') continue; // eslint-disable-line no-continue
        target[name] = function timed(...args) {
          const t0 = performance.now();
          const result = fn.apply(this, args);
          const ms = performance.now() - t0;
          if (ms >= 1) window.__glTrace.push({ at: t0, ms, pass: `cpu ${kind} ${name}` });
          return result;
        };
      }
    }
    return;
  }
  // BRUSH_GL_TRACE=all: every other call is timed the same way, grouped by name.
  if (window.__glTraceAll) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      const fn = Object.getOwnPropertyDescriptor(proto, name).value;
      if (typeof fn !== 'function' || /^(get|is|finish|flush|drawArrays|readPixels|constructor)/.test(name)) continue; // eslint-disable-line no-continue
      proto[name] = function timed(...args) {
        const t0 = performance.now();
        const result = fn.apply(this, args);
        sync(this);
        window.__glTrace.push({ at: t0, ms: performance.now() - t0, pass: name });
        return result;
      };
    }
  }
  const original = proto.drawArrays;
  proto.drawArrays = function traced(...args) {
    const program = this.getParameter(this.CURRENT_PROGRAM);
    if (program && !programs.has(program)) programs.set(program, (nextProgram += 1));
    const [, , w, h] = this.getParameter(this.VIEWPORT);
    const target = this.getParameter(this.FRAMEBUFFER_BINDING) ? 'fbo' : 'canvas';
    const scissor = this.isEnabled(this.SCISSOR_TEST);
    const t0 = performance.now();
    const result = original.apply(this, args);
    sync(this);
    window.__glTrace.push({ at: t0, ms: performance.now() - t0, pass: `${target} ${w}×${h} p${programs.get(program) ?? 0}${scissor ? ' scissor' : ''}` });
    return result;
  };
};
// BRUSH_TIMELINE=1: every animation frame callback, React scheduler task (MessageChannel) and
// timer is timed on the main thread, so the first point's path (pointerdown → frames → first draw)
// splits into handler, script and waiting time; works in WebKit, which has no long-frame API.
const TIMELINE = () => {
  const log = (window.__timeline = []);
  const timed = (kind, fn) => function run(...args) {
    const start = performance.now();
    try { return fn.apply(this, args); } finally { log.push({ kind, start, ms: performance.now() - start, name: fn.name || '' }); }
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf(timed('frame', cb));
  const timeout = window.setTimeout.bind(window);
  window.setTimeout = (cb, ...rest) => (typeof cb === 'function' ? timeout(timed('timer', cb), ...rest) : timeout(cb, ...rest));
  const descriptor = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'onmessage');
  Object.defineProperty(MessagePort.prototype, 'onmessage', {
    configurable: true,
    get() { return descriptor.get.call(this); },
    set(fn) { descriptor.set.call(this, typeof fn === 'function' ? timed('task', fn) : fn); },
  });
};
// Records when the preview draws, so a move's latency is "input → next draw call".
const DRAW_PROBE = () => {
  window.__brushDraws = [];
  const mark = () => { window.__brushDraws.push(performance.now()); if (window.__drawStacks) window.__drawStacks.push(new Error().stack.split('\n').slice(2, 14).join(' | ')); };
  const wrap = (proto, name) => {
    const original = proto?.[name];
    if (!original) return;
    proto[name] = function wrapped(...args) { mark(); return original.apply(this, args); };
  };
  wrap(globalThis.WebGL2RenderingContext?.prototype, 'drawArrays');
  wrap(globalThis.CanvasRenderingContext2D?.prototype, 'putImageData');
  wrap(globalThis.CanvasRenderingContext2D?.prototype, 'drawImage');
  // A composited GPU frame (masked passes) ends by drawing to the canvas after framebuffer passes.
  window.__brushComposites = [];
  const bind = globalThis.WebGL2RenderingContext?.prototype.bindFramebuffer;
  if (bind) {
    let offscreen = false;
    WebGL2RenderingContext.prototype.bindFramebuffer = function bindFramebuffer(target, framebuffer) {
      if (framebuffer) offscreen = true;
      else if (offscreen) { offscreen = false; window.__brushComposites.push(performance.now()); }
      return bind.call(this, target, framebuffer);
    };
  }
  // GPU traffic (Interval 22.8): textures created and deleted, bytes uploaded by full and sub-
  // image uploads, and synchronous readbacks; the stroke reports the difference over its moves.
  const gpu = { creates: 0, deletes: 0, fullUploads: 0, fullBytes: 0, subUploads: 0, subBytes: 0, readbacks: 0 };
  window.__brushGpu = gpu;
  const proto = globalThis.WebGL2RenderingContext?.prototype;
  if (proto) {
    const BYTES = { 0x8229: 1, 0x1903: 1, 0x8058: 4, 0x1908: 4, 0x8d7c: 6, 0x8815: 12, 0x8814: 16 };
    const count = (name, fn) => { const original = proto[name]; proto[name] = function counted(...args) { fn(args, this); return original.apply(this, args); }; };
    count('createTexture', () => { gpu.creates += 1; });
    count('deleteTexture', () => { gpu.deletes += 1; });
    count('readPixels', () => { gpu.readbacks += 1; });
    count('texImage2D', (a) => { if (a.length >= 9 && typeof a[3] === 'number') { gpu.fullUploads += 1; gpu.fullBytes += a[3] * a[4] * (BYTES[a[2]] ?? 4); } });
    count('texSubImage2D', (a) => { if (a.length >= 9 && typeof a[4] === 'number') { gpu.subUploads += 1; gpu.subBytes += a[4] * a[5] * (a[6] === 0x1903 || a[6] === 0x8d94 ? 1 : 4); } });
  }
  window.__brushFrames = [];
  try {
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__brushFrames.push({ start: entry.startTime, duration: entry.duration, blocking: entry.blockingDuration, render: entry.renderStart ? entry.startTime + entry.duration - entry.renderStart : 0, styleLayout: entry.styleAndLayoutStart ? entry.startTime + entry.duration - entry.styleAndLayoutStart : 0, scripts: (entry.scripts ?? []).map((x) => ({ invoker: x.invoker, ms: Math.round(x.duration), fn: x.sourceFunctionName })) }); })
      .observe({ type: 'long-animation-frame', buffered: false });
  } catch { /* not Chromium */ }
};

function pattern(width, height) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const t = x / width;
      const v = 40 + 150 * t + 30 * Math.sin(y / 17) + 25 * Math.sin(x / 3) * Math.sin(y / 4);
      const i = (y * width + x) * 3;
      data[i] = Math.max(0, Math.min(255, v + 30 * (1 - t)));
      data[i + 1] = Math.max(0, Math.min(255, v));
      data[i + 2] = Math.max(0, Math.min(255, v - 30 * t));
    }
  }
  return data;
}

async function poll(read, done, label, timeout = 60_000) {
  const end = Date.now() + timeout;
  let value;
  while (Date.now() < end) {
    value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label} (last value ${JSON.stringify(value)?.slice(0, 200)})`);
}
const quantile = (values, q) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] * 10) / 10;
};
const stats = (values) => ({ p50: quantile(values, 0.5), p95: quantile(values, 0.95), max: quantile(values, 1) });

// Self time per function from a V8 CPU profile, the top `count`.
function topFunctions(profile, count = 15) {
  const self = new Map();
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const dt = profile.timeDeltas;
  profile.samples.forEach((id, index) => {
    const { callFrame } = byId.get(id);
    const name = `${callFrame.functionName || '(anonymous)'} ${callFrame.url.split('/').pop()}:${callFrame.lineNumber + 1}:${callFrame.columnNumber + 1}`;
    self.set(name, (self.get(name) ?? 0) + (dt[index] ?? 0) / 1000);
  });
  return [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, count).map(([name, ms]) => `${ms.toFixed(0).padStart(6)} ms  ${name}`);
}

// Hovering with the brush (no button): real pointer input (CDP), one move per ~frame, across the
// photo. Per move: the event's timestamp → the brush outline's DOM update → the next frame after
// it, and every preview draw call in the window (must be none: hovering renders nothing).
async function hover(page, moves = 90, offset = 0) {
  const host = await page.evaluate((stacks) => {
    window.__hover = { events: [], updates: [], frames: [] };
    const tool = document.querySelector('.pe-masktool');
    window.__hoverListener ??= (event) => { if (!event.buttons) window.__hover.events.push(event.timeStamp); };
    tool.addEventListener('pointermove', window.__hoverListener, { capture: true });
    window.__hoverObserver?.disconnect();
    window.__hoverObserver = new MutationObserver(() => {
      const now = performance.now();
      window.__hover.updates.push(now);
      requestAnimationFrame((t) => window.__hover.frames.push({ update: now, frame: t }));
    });
    window.__hoverObserver.observe(tool, { attributes: true, subtree: true, childList: true, attributeFilter: ['cx', 'cy', 'style', 'hidden'] });
    window.__hoverDraws = window.__brushDraws.length;
    window.__drawStacks = stacks ? [] : null;
    window.__hoverLong = window.__brushFrames.length;
    window.__hoverReady = performance.getEntriesByName('pe-local-ready').length;
    const r = document.querySelector('.pe-canvas-host').getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }, Boolean(process.env.BRUSH_STACKS));
  for (let k = 0; k <= moves; k += 1) {
    await page.mouse.move(host.left + host.width * (0.1 + (0.8 * k) / moves), host.top + host.height * (0.5 + offset + 0.3 * Math.sin((k / moves) * Math.PI * 3))); // eslint-disable-line no-await-in-loop
    await page.waitForTimeout(16); // eslint-disable-line no-await-in-loop
  }
  await page.waitForTimeout(100);
  const measured = await page.evaluate(() => {
    window.__hoverObserver.disconnect();
    const { events, updates, frames } = window.__hover;
    const toUpdate = [];
    const toFrame = [];
    events.forEach((t, i) => {
      const next = events[i + 1] ?? Infinity;
      const update = updates.find((u) => u >= t);
      if (update === undefined || update > next + 200) return;
      toUpdate.push(update - t);
      const frame = frames.find((f) => f.update === update);
      if (frame) toFrame.push(frame.frame - t);
    });
    const long = window.__brushFrames.slice(window.__hoverLong);
    const drawStacks = window.__drawStacks;
    window.__drawStacks = null;
    return { events: events.length, updates: updates.length, toUpdate, toFrame, draws: window.__brushDraws.length - window.__hoverDraws, ready: performance.getEntriesByName('pe-local-ready').length - window.__hoverReady, longFrames: long.length, longMs: long.reduce((s, f) => s + f.duration, 0), drawStacks };
  });
  if (measured.drawStacks?.length) console.log(measured.drawStacks.join('\n'));
  return { moves: measured.events, outlineUpdates: measured.updates, inputToOutlineMs: stats(measured.toUpdate), inputToFrameMs: stats(measured.toFrame), previewDraws: measured.draws, filteredFramesArrived: measured.ready, longFrames: measured.longFrames, longFramesMs: Math.round(measured.longMs) };
}

async function runOne(run, file) {
  const browser = await run.type.launch({ args: run.args ?? [] });
  const context = await browser.newContext(run.device ? devices[run.device] : { viewport: { width: 1440, height: 900 } });
  if (run.init) await context.addInitScript(INIT[run.init]);
  await context.addInitScript(DRAW_PROBE);
  if (process.env.BRUSH_TIMELINE) await context.addInitScript(TIMELINE);
  if (process.env.BRUSH_GL_TRACE === 'all') await context.addInitScript(() => { window.__glTraceAll = true; });
  if (process.env.BRUSH_GL_TRACE === 'cpu') await context.addInitScript(() => { window.__glTraceCpu = true; });
  if (process.env.BRUSH_GL_TRACE) await context.addInitScript(GL_TRACE);
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('crash', () => problems.push('page crashed'));
  if (process.env.BRUSH_VERBOSE) page.on('console', (message) => console.log(`  [page] ${message.text()}`));
  const result = { environment: run.name, photo: path.basename(file) };
  const step = (name) => { result.step = name; if (process.env.BRUSH_VERBOSE) console.log(`  … ${run.id}: ${name}`); };
  const tab = async (index) => { if (run.device) await page.click(`.pe-tabs button:nth-child(${index})`); };
  const strokesNow = () => page.evaluate(() => JSON.parse(localStorage.getItem('photo-editor:edits:v1') ?? 'null')?.photos[0]?.adjustments.local?.[0]?.mask.components[0]?.strokes?.length ?? 0);
  try {
    step('import');
    await page.goto(URL_EDITOR);
    await tab(1);
    await page.setInputFiles('input[type=file][multiple]', [file]);
    await poll(() => page.$$eval('.pe-photo--list', (items) => items.filter((li) => li.dataset.status === 'ready').length), (n) => n >= 1, 'import', 300_000);
    step('open');
    await page.click('.pe-photo--list button.pe-photo__select');
    await poll(() => page.evaluate(() => !document.querySelector('.pe-stage-message') && !document.querySelector('.pe-canvas-host').hidden), Boolean, 'preview', 300_000);
    step('brush');
    await tab(2); await openEditorTool(page, 'masks');
    await page.locator('.pe-masks__add[aria-label="New local adjustment"] button', { hasText: /^Brush$/ }).click();
    await page.locator('.pe-masktool').waitFor();
    await openEditorTool(page, LOCAL.section ? 'detail' : 'light');
    if (LOCAL.section) {
      const toggle = page.locator('.pe-panel--adjust .pe-section__toggle', { hasText: LOCAL.section });
      if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    }
    const field = page.getByRole('textbox', { name: `${LOCAL.label} value` });
    await field.fill(LOCAL.value);
    await field.press('Enter');
    if (run.device) { await openEditorTool(page, 'masks'); await page.locator('.pe-masks__tools button', { hasText: /^Brush$/ }).click(); }
    // The pause is timed from here: the brush is selected and the value set (tool selection).
    await page.evaluate(() => performance.mark('brush-check-ready'));
    if (PAUSE_MS) await page.waitForTimeout(PAUSE_MS);
    // Local Detail: the stroke starts once the frame with the setting is final.
    if (LOCAL.section) await poll(() => page.evaluate(() => document.querySelector('[data-detail-preview]')?.dataset.detailPreview ?? null), (q) => q === null || q === 'final', 'Detail preview', 120_000);
    result.engine = await page.evaluate(() => (document.querySelector('.pe-canvas-host canvas')?.getContext ? document.querySelector('.pe-engine')?.textContent ?? null : null));
    if (!run.device && process.env.BRUSH_HOVER !== '0') {
      step('hover');
      // A local Detail's warm pass may still finish (and draw) after the preview reads "final".
      await poll(async () => { const n = await page.evaluate(() => window.__brushDraws.length); await page.waitForTimeout(1000); return n === await page.evaluate(() => window.__brushDraws.length); }, Boolean, 'an idle preview', 60_000);
      result.hover = await hover(page);
      // Only a local Detail frame arriving from its worker meanwhile may draw (one draw each).
      assert.ok(result.hover.previewDraws <= result.hover.filteredFramesArrived, `hovering drew the preview: ${JSON.stringify(result.hover)}`);
      assert.ok(result.hover.outlineUpdates > 0, 'the brush outline follows the pointer');
    }
    const cdp = run.profile && process.env.BRUSH_PROFILE ? await context.newCDPSession(page) : null;
    const startProfile = async () => { if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); } };
    // With BRUSH_LOCAL the profile covers the second stroke only.
    if (!LOCAL.section) await startProfile();
    step('stroke');
    // The stroke: a wave across the photo, one move per animation frame.
    const paintStroke = (offset) => page.evaluate(async ({ moves, pointerType, offset }) => {
      const tool = document.querySelector('.pe-masktool');
      const host = document.querySelector('.pe-canvas-host').getBoundingClientRect();
      const at = (k) => ({ clientX: host.left + host.width * (0.1 + (0.8 * k) / moves), clientY: host.top + host.height * (0.5 + offset + 0.25 * Math.sin((k / moves) * Math.PI * 4)) });
      const send = (type, k) => tool.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType, isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, pressure: 0.5, ...at(k) }));
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      await frame();
      window.__brushFrames.length = 0;
      if (window.__glTrace) window.__glTrace.length = 0;
      const gpuBefore = { ...(window.__brushGpu ?? {}) };
      const inputs = [];
      const handler = [];
      const frameTimes = [];
      const quality = [];
      let last = await frame();
      const down = performance.now();
      send('pointerdown', 0);
      const downHandler = performance.now() - down;
      for (let k = 1; k <= moves; k += 1) {
        const now = await frame();
        frameTimes.push(now - last);
        last = now;
        quality.push(document.querySelector('[data-detail-preview]')?.dataset.detailPreview ?? null);
        const t0 = performance.now();
        send('pointermove', k);
        handler.push(performance.now() - t0);

        inputs.push(t0);
      }
      // Let the last move render (MaskTool's frame, the React commit, the viewer's frame), then release.
      for (let k = 0; k < 4; k += 1) await frame(); // eslint-disable-line no-await-in-loop
      const gpuAfter = window.__brushGpu ?? {};
      const gpuTraffic = Object.fromEntries(Object.keys(gpuAfter).map((key) => [key, gpuAfter[key] - (gpuBefore[key] ?? 0)]));
      const draws = window.__brushDraws.slice();
      const overlay = document.querySelector('.pe-mask-overlay');
      const overlaySum = () => (overlay?.width ? overlay.getContext('2d').getImageData(0, 0, overlay.width, overlay.height).data : null);
      const overlayPainted = overlaySum();
      // Hide and show the overlay mid-stroke: a full redraw of the same raster.
      const key = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', bubbles: true }));
      key(); for (let k = 0; k < 3; k += 1) await frame(); // eslint-disable-line no-await-in-loop
      key(); for (let k = 0; k < 4; k += 1) await frame(); // eslint-disable-line no-await-in-loop
      const overlayRedrawn = overlaySum();
      const t0 = performance.now();
      const finals = performance.getEntriesByName('pe-detail-final').length + performance.getEntriesByName('pe-local-detail').length;
      send('pointerup', moves);
      await frame(); await frame();
      const commitMs = performance.now() - t0;
      // Local Detail: release → the preview final again (the base frame and every local Detail pass).
      let settleMs = null;
      if (quality.some(Boolean)) {
        const end = performance.now() + 120_000;
        const settled = () => document.querySelector('[data-detail-preview]')?.dataset.detailPreview === 'final' && performance.getEntriesByName('pe-detail-final').length + performance.getEntriesByName('pe-local-detail').length > finals;
        while (!settled() && performance.now() < end) await frame(); // eslint-disable-line no-await-in-loop
        settleMs = performance.now() - t0;
      }
      const latency = inputs.map((t, i) => {
        const next = inputs[i + 1] ?? Infinity;
        const draw = draws.find((d) => d >= t);
        return draw !== undefined && draw < next + 1000 ? draw - t : null;
      }).filter((v) => v !== null);
      const strokeEnd = inputs.at(-1) + 50;
      const longFrames = window.__brushFrames.filter((f) => f.start >= inputs[0] - 20 && f.start <= strokeEnd);
      // Canvases store premultiplied colour, so compare alpha and premultiplied channels.
      let overlayDiff = null;
      if (overlayPainted && overlayRedrawn) {
        overlayDiff = { alpha: 0, premultiplied: 0, pixels: 0 };
        for (let i = 0; i < overlayPainted.length; i += 4) {
          const a = Math.abs(overlayPainted[i + 3] - overlayRedrawn[i + 3]);
          let p = 0;
          for (let c = 0; c < 3; c += 1) p = Math.max(p, Math.abs((overlayPainted[i + c] * overlayPainted[i + 3]) / 255 - (overlayRedrawn[i + c] * overlayRedrawn[i + 3]) / 255));
          if (a || p > 1) overlayDiff.pixels += 1;
          overlayDiff.alpha = Math.max(overlayDiff.alpha, a);
          overlayDiff.premultiplied = Math.max(overlayDiff.premultiplied, Math.round(p * 100) / 100);
        }
      }
      // The first point: pointerdown to the first draw of the preview after it (the brush overlay
      // or the edited frame, whichever comes first) and to the first draw after the first move.
      // On the GPU preview, the first composited frame (the masked pass) is the stroke shown.
      const firstDraw = draws.find((d) => d >= down);
      const firstComposite = window.__brushComposites.find((d) => d >= down);
      const firstFrames = frameTimes.slice(0, 4);
      const firstPoint = { frames: firstFrames.map((t) => Math.round(t)), handler: downHandler, toDraw: firstDraw === undefined ? null : firstDraw - down, toComposite: firstComposite === undefined ? null : firstComposite - down, maxFrameOfFirstFour: Math.max(...firstFrames) };
      // BRUSH_TIMELINE: main-thread work from pointerdown to the first composited frame (ms from down).
      const until = firstComposite ?? firstDraw ?? down;
      const timeline = window.__timeline ? window.__timeline.filter((e) => e.start >= down - 1 && e.start <= until + 1)
        .map((e) => ({ kind: e.kind, at: Math.round(e.start - down), ms: Math.round(e.ms * 10) / 10, ...(e.name ? { name: e.name } : {}) })) : null;
      if (timeline) firstPoint.timeline = timeline;
      // The viewer's own split of its frames (pe-frame) between pointerdown and the first composite.
      const frames = performance.getEntriesByName('pe-frame').filter((e) => e.startTime >= down && e.startTime <= until + 200).slice(0, 3);
      if (timeline) firstPoint.viewerFrames = frames.map(({ startTime, detail }) => ({ at: Math.round(startTime - down), ...Object.fromEntries(Object.entries(detail).map(([k, v]) => [k, Math.round(v * 10) / 10])) }));
      const detailShown = quality.some(Boolean) ? { final: quality.filter((q) => q === 'final').length, draft: quality.filter((q) => q === 'draft').length, rendering: quality.filter((q) => q === 'rendering').length } : null;
      const glTrace = window.__glTrace ? Object.values(window.__glTrace.filter((d) => d.at >= down && d.at <= strokeEnd).reduce((all, { pass, ms }) => {
        const entry = (all[pass] ??= { pass, draws: 0, ms: 0 });
        entry.draws += 1; entry.ms += ms;
        return all;
      }, {})).map((e) => ({ ...e, ms: Math.round(e.ms) })).sort((a, b) => b.ms - a.ms) : null;
      return { handler, frameTimes, latency, commitMs, settleMs, detailShown, firstPoint, longFrames, span: inputs.at(-1) - inputs[0], overlayDiff, gpuTraffic, glTrace };
    }, { moves: MOVES, pointerType: run.device ? 'touch' : 'mouse', offset });
    // With BRUSH_LOCAL a second stroke follows (painting over a local Detail that already shows).
    // BRUSH_CHROME_TRACE=file.json (Chromium): a performance trace of the first stroke, all processes.
    const chromeTrace = process.env.BRUSH_CHROME_TRACE && run.type === chromium ? process.env.BRUSH_CHROME_TRACE : null;
    if (chromeTrace) await browser.startTracing(page, { path: chromeTrace, categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'gpu', 'cc', 'viz', 'toplevel', 'blink', 'disabled-by-default-gpu.service'] });
    const measured = await paintStroke(0);
    if (chromeTrace) await browser.stopTracing();
    const second = LOCAL.section ? await (async () => { await page.waitForTimeout(300); await startProfile(); return paintStroke(-0.2); })() : null;
    if (cdp) {
      const { profile } = await cdp.send('Profiler.stop');
      const totalMs = (profile.endTime - profile.startTime) / 1000;
      result.profileTop = topFunctions(profile);
      result.profileMs = Math.round(totalMs);
    }
    const busy = measured.longFrames.reduce((sum, f) => sum + f.duration, 0);
    result.moves = MOVES;
    result.firstPointMs = Object.fromEntries(Object.entries(measured.firstPoint).filter(([k]) => k !== 'timeline' && k !== 'viewerFrames').map(([k, v]) => [k, Array.isArray(v) || v === null ? v : !Number.isFinite(v) ? null : Math.round(v * 10) / 10]));
    if (process.env.BRUSH_LOAF) result.firstLongFrames = measured.longFrames.slice(0, 3);
    if (measured.firstPoint.timeline) Object.assign(result, { firstPointTimeline: measured.firstPoint.timeline, firstViewerFrames: measured.firstPoint.viewerFrames });
    result.handlerMs = stats(measured.handler);
    result.frameIntervalMs = stats(measured.frameTimes);
    result.fps = Math.round((1000 * MOVES) / measured.span);
    result.inputToDrawMs = stats(measured.latency);
    result.longFrames = measured.longFrames.length ? { count: measured.longFrames.length, durationMs: stats(measured.longFrames.map((f) => f.duration)), renderMs: stats(measured.longFrames.map((f) => f.render)), busyShare: Math.round((100 * busy) / measured.span) } : 'none (or not Chromium)';
    result.commitMs = Math.round(measured.commitMs);
    const g = measured.gpuTraffic;
    if (measured.glTrace) result.glTrace = measured.glTrace;
    if (g) result.gpuPerStroke = { texturesCreated: g.creates, texturesDeleted: g.deletes, fullUploads: g.fullUploads, fullUploadMb: Math.round(g.fullBytes / 1e5) / 10, subUploads: g.subUploads, subUploadMb: Math.round(g.subBytes / 1e5) / 10, readbacks: g.readbacks };
    if (measured.settleMs !== null) Object.assign(result, { detailFinalAfterReleaseMs: Math.round(measured.settleMs), detailDuringStroke: measured.detailShown });
    if (second) {
      result.secondStroke = { inputToDrawMs: stats(second.latency), frameIntervalMs: stats(second.frameTimes), detailDuringStroke: second.detailShown, commitMs: Math.round(second.commitMs), detailFinalAfterReleaseMs: second.settleMs === null ? null : Math.round(second.settleMs) };
    }
    // Frames drawn ahead of the first stroke while idle (Intervals 22.10–22.11): warm-ups that
    // finished before or during the stroke, their idle steps (bands and fence polls) and main-thread time.
    const warmed = await page.evaluate(() => performance.getEntriesByName('pe-stroke-warm-done').map(({ detail }) => detail));
    const last = warmed.at(-1);
    result.strokeWarm = { finished: warmed.length, ...(last ? { ms: Math.round(last.ms), steps: last.steps, mainThreadMs: Math.round(last.mainThreadMs) } : {}) };
    // Tool selection → the warm-up's GPU work done (its fence signalled), when it finished before the stroke.
    result.selectToWarmMs = await page.evaluate(() => {
      const ready = performance.getEntriesByName('brush-check-ready')[0]?.startTime;
      const done = performance.getEntriesByName('pe-stroke-warm-done').at(-1);
      return ready === undefined || !done ? null : Math.round(done.startTime - ready);
    });
    step('overlay');
    // The overlay drawn box by box while painting equals a full redraw of the same mask (alpha
    // exactly; premultiplied colour within the canvas's rounding of one level).
    if (measured.overlayDiff) {
      result.overlayVsFullRedraw = measured.overlayDiff;
      assert.ok(measured.overlayDiff.pixels === 0, `incremental overlay differs from a full redraw: ${JSON.stringify(measured.overlayDiff)}`);
    }
    if (run.device) {
      // Touch: two fingers on the photo with the brush on pinch-zoom it and paint nothing.
      step('pinch');
      await poll(strokesNow, (n) => n >= 1, 'stroke saved', 15_000);
      const before = await strokesNow();
      const pinched = await page.evaluate(async () => {
        const tool = document.querySelector('.pe-masktool');
        const host = document.querySelector('.pe-canvas-host').getBoundingClientRect();
        const cx = host.left + host.width / 2;
        const cy = host.top + host.height / 2;
        const send = (type, id, x) => tool.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: id === 11, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: cy }));
        const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
        const readout = () => document.querySelector('.pe-readout')?.textContent;
        const zoomBefore = readout();
        send('pointerdown', 11, cx - 30); await frame();
        send('pointerdown', 12, cx + 30); await frame();
        for (let k = 1; k <= 10; k += 1) { send('pointermove', 11, cx - 30 - 6 * k); send('pointermove', 12, cx + 30 + 6 * k); await frame(); } // eslint-disable-line no-await-in-loop
        send('pointerup', 12, cx + 90); send('pointerup', 11, cx - 90);
        for (let k = 0; k < 4; k += 1) await frame(); // eslint-disable-line no-await-in-loop
        return { zoomBefore, zoomAfter: readout() };
      });
      await page.waitForTimeout(300);
      result.pinch = { ...pinched, strokesBefore: before, strokesAfter: await strokesNow() };
      assert.ok(parseInt(pinched.zoomAfter, 10) >= 2 * parseInt(pinched.zoomBefore, 10) - 2, `pinch zoom ${JSON.stringify(pinched)}`);
      assert.equal(result.pinch.strokesAfter, before, 'a pinch paints nothing');
    }
    step('undo');
    // One stroke, one undo step.
    const strokes = strokesNow;
    const painted = second ? 2 : 1;
    await poll(strokes, (n) => n === painted, 'stroke saved', 15_000);
    await page.keyboard.press('Control+z');
    await poll(strokes, (n) => n === painted - 1, 'undo removes the whole stroke', 15_000);
    await page.keyboard.press('Control+y');
    await poll(strokes, (n) => n === painted, 'redo restores it', 15_000);
    if (LOCAL.section && !run.device) {
      // Hovering while a local Detail preview renders (a new value starts it); its own draws are expected.
      step('hover while rendering');
      await field.fill('30');
      await field.press('Enter');
      result.hoverWhileRendering = await hover(page, 60, 0.1);
    }
    assert.deepEqual(problems, []);
    const median = result.handlerMs.p50 + (result.inputToDrawMs.p50 ?? 0);
    result.ok = !(process.env.BRUSH_STRICT && run.gate) || median <= MAX_MAIN_MS;
    if (!result.ok) result.error = `median input→draw ${median} ms > ${MAX_MAIN_MS} ms`;
  } catch (error) {
    result.ok = false;
    result.error = `${error.message}${problems.length ? ` (${problems.join('; ')})` : ''}`;
  } finally {
    await browser.close();
  }
  return result;
}

async function main() {
  const fixtures = path.join(work, 'fixtures');
  mkdirSync(fixtures, { recursive: true });
  const large = path.join(fixtures, 'brush-24mp.jpg');
  await sharp(pattern(6000, 4000), { raw: { width: 6000, height: 4000, channels: 3 } }).jpeg({ quality: 90 }).toFile(large);
  if (!process.env.BRUSH_SKIP_BUILD) await build({ root, logLevel: 'silent', configFile: path.join(root, 'vite.config.mjs') });
  const server = await preview({ root, configFile: path.join(root, 'vite.config.mjs'), preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
  const failures = [];
  try {
    for (const run of RUNS.filter(({ id }) => !ONLY_RUNS || ONLY_RUNS.includes(id))) {
      for (const file of [large, ...(run.id === 'chromium' ? GENUINE : [])]) {
        const result = await runOne(run, file);
        const { profileTop, ...summary } = result;
        console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${JSON.stringify(summary)}`);
        if (profileTop && process.env.BRUSH_PROFILE) console.log(profileTop.join('\n'));
        if (!result.ok) failures.push(`${run.id} ${result.photo}`);
      }
    }
  } finally {
    server.httpServer.close();
    rmSync(work, { recursive: true, force: true });
  }
  if (failures.length) process.exitCode = 1;
}

await main();
