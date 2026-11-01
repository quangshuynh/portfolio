// End-to-end check of /photography/editor in a real Chromium: GPU/CPU parity,
// import, editing, undo, comparison, export (verified against the CPU reference in
// Node), saved edits, memory and timing. Generates its own fixtures; uses a
// throwaway browser profile. Usage: npm run check:editor [-- --headed]
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { build, createServer, preview } from 'vite';
import { renderRgba8 } from '../src/editor/pipeline/cpuRenderer.mjs';
import { deriveParams } from '../src/editor/pipeline/spec.mjs';
import { parseEditDocument } from '../src/editor/model/editDocument.mjs';
import { parseCube } from '../src/editor/pipeline/lut.mjs';
import { lookCube } from '../src/editor/dev/lutFixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const headed = process.argv.includes('--headed');
const work = mkdtempSync(path.join(tmpdir(), 'editor-check-'));
const fixtures = path.join(work, 'fixtures');
const downloads = path.join(work, 'downloads');
const output = process.env.EDITOR_CHECK_OUTPUT || path.join(work, 'screenshots');
[fixtures, downloads, output].forEach((dir) => mkdirSync(dir, { recursive: true }));
const report = { checks: [], measurements: {} };
// Geometry on merged HDR interpolates float values: at the range-fit boundary of
// out-of-gamut colours float32 and float64 can differ by two codes (one pixel of the chart).
const HDR_GEOMETRY_PARITY_MAX = 2;
// Posterize/quantisation cases: pixels allowed to land one level apart (float32 vs double on a boundary).
const QUANTIZE_FLIPS = 4;
const failures = [];

// Each check gets at most three minutes, so one failure cannot stall the run.
function check(name, fn) {
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('check timed out')), 180_000); });
  return Promise.race([Promise.resolve().then(fn), limit]).finally(() => clearTimeout(timer)).then(
    (detail) => { report.checks.push({ name, ok: true, ...(detail ? { detail } : {}) }); console.log(`ok   ${name}${detail ? ` ${JSON.stringify(detail)}` : ''}`); },
    (error) => { failures.push(name); report.checks.push({ name, ok: false, error: error.message }); console.log(`FAIL ${name}: ${error.message}`); },
  );
}

// ---------- fixtures ----------
const COMBINED = { exposure: 0.35, contrast: 25, highlights: -60, shadows: 40, whites: 10, blacks: -15, temperature: 18, tint: -6, vibrance: 30, saturation: -10 };

function gradient(width, height, phase) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      data[i] = (x / width) * 255;
      data[i + 1] = (y / height) * 255;
      data[i + 2] = 128 + 100 * Math.sin((x + y + phase) / 300);
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } });
}

async function makeFixtures() {
  const chart = Buffer.alloc(64 * 64 * 4);
  let i = 0;
  for (let r = 0; r < 16; r += 1) for (let g = 0; g < 16; g += 1) for (let b = 0; b < 16; b += 1) { chart.set([r * 17, g * 17, b * 17, 255], i); i += 4; }
  const write = async (name, pipeline) => { await pipeline.toFile(path.join(fixtures, name)); return path.join(fixtures, name); };
  const files = {
    chart: await write('chart.png', sharp(chart, { raw: { width: 64, height: 64, channels: 4 } }).png()),
    large: await write('large-24mp.jpg', gradient(6000, 4000, 0).jpeg({ quality: 92 })),
    large2: await write('large-24mp-b.jpg', gradient(6000, 4000, 900).jpeg({ quality: 92 })),
    webp: await write('photo.webp', gradient(800, 533, 50).webp({ quality: 90 })),
    alpha: await write('alpha.png', sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 30, g: 90, b: 160, alpha: 0.5 } } }).png()),
  };
  // Stored 600×400, left half red and right half blue, EXIF orientation 6 (rotate 90° CW):
  // displayed 400×600 with red on top.
  const halves = Buffer.alloc(600 * 400 * 3);
  for (let p = 0; p < 600 * 400; p += 1) halves.set((p % 600) < 300 ? [220, 20, 20] : [20, 20, 220], p * 3);
  files.rotated = await write('rotated-exif6.jpg', sharp(halves, { raw: { width: 600, height: 400, channels: 3 } }).jpeg({ quality: 95 }).withMetadata({ orientation: 6 }));
  const png = readFileSync(files.chart);
  writeFileSync(path.join(fixtures, 'chart-copy.png'), png);
  files.duplicate = path.join(fixtures, 'chart-copy.png');
  const damagedPng = Buffer.from(png);
  damagedPng.fill(0x41, 60, damagedPng.length - 12);
  writeFileSync(path.join(fixtures, 'damaged.png'), damagedPng);
  files.damaged = path.join(fixtures, 'damaged.png');
  writeFileSync(path.join(fixtures, 'broken.jpg'), Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 0x07)]));
  files.broken = path.join(fixtures, 'broken.jpg');
  writeFileSync(path.join(fixtures, 'animation.jpg'), await sharp({ create: { width: 8, height: 8, channels: 3, background: '#888' } }).gif().toBuffer());
  files.gif = path.join(fixtures, 'animation.jpg');
  writeFileSync(path.join(fixtures, 'look-65.cube'), lookCube(65, 'Check look'));
  files.lut65 = path.join(fixtures, 'look-65.cube');
  writeFileSync(path.join(fixtures, 'empty.jpg'), Buffer.alloc(0));
  files.empty = path.join(fixtures, 'empty.jpg');
  return files;
}

// ---------- browser ----------
function findChrome() {
  if (process.env.EDITOR_CHROME) return process.env.EDITOR_CHROME;
  const base = path.join(process.env.LOCALAPPDATA ?? path.join(homedir(), '.cache'), 'ms-playwright');
  const builds = existsSync(base) ? readdirSync(base).filter((name) => /^chromium-\d+$/.test(name)).sort().reverse() : [];
  for (const name of builds) {
    const candidates = [path.join(base, name, 'chrome-win64', 'chrome.exe'), path.join(base, name, 'chrome-linux', 'chrome'), path.join(base, name, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')];
    const found = candidates.find(existsSync);
    if (found) return found;
  }
  throw new Error('No Chromium found. Set EDITOR_CHROME to a Chromium or Chrome executable.');
}

class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.listeners = []; }
  async open() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    this.ws.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const call = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) call.reject(new Error(`${call.method}: ${message.error.message}`)); else call.resolve(message.result);
      } else this.listeners.forEach((listener) => listener(message));
    };
    return this;
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = (this.id += 1);
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(listener) { this.listeners.push(listener); }
  close() { this.ws.close(); }
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const files = await makeFixtures();
  await build({ root, logLevel: 'silent', configFile: path.join(root, 'vite.config.mjs') });
  const previewServer = await preview({ root, configFile: path.join(root, 'vite.config.mjs'), preview: { port: 4179, strictPort: true }, logLevel: 'silent' });
  const devServer = await createServer({ root, configFile: path.join(root, 'vite.config.mjs'), server: { port: 5179, strictPort: true }, logLevel: 'silent' });
  await devServer.listen();
  const origin = 'http://localhost:4179';

  const profile = path.join(work, 'profile');
  const chrome = spawn(findChrome(), [
    '--remote-debugging-port=9229', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    ...(headed ? [] : ['--headless=new']), '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1440,900', 'about:blank',
  ], { stdio: 'ignore' });
  let version;
  for (let attempt = 0; attempt < 50 && !version; attempt += 1) {
    try { version = await (await fetch('http://localhost:9229/json/version')).json(); } catch { await pause(200); }
  }
  const browser = await new Cdp(version.webSocketDebuggerUrl).open();
  await browser.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
  const target = await (await fetch('http://localhost:9229/json/new?about:blank', { method: 'PUT' })).json();
  const page = await new Cdp(target.webSocketDebuggerUrl).open();
  await Promise.all(['Page.enable', 'Runtime.enable', 'DOM.enable', 'Log.enable'].map((method) => page.send(method)));
  // Headless targets never receive OS focus; without this, keyboard focus is unreliable.
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await page.send('Page.bringToFront');
  const problems = [];
  page.on(({ method, params }) => {
    if (method === 'Runtime.exceptionThrown') problems.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
    if (method === 'Log.entryAdded' && params.entry.level === 'error' && !/favicon/.test(params.entry.url ?? '')) problems.push(params.entry.text);
    if (method === 'Runtime.consoleAPICalled' && params.type === 'error') problems.push(params.args.map((arg) => arg.value ?? arg.description).join(' '));
  });

  const evaluate = async (expression) => {
    const result = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression, message, timeout = 30_000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await evaluate(`!!(${expression})`)) return;
      await pause(50);
    }
    throw new Error(`Timed out: ${message}`);
  };
  const navigate = async (url) => {
    await page.send('Page.navigate', { url });
    await waitFor('document.readyState === "complete"', `load ${url}`);
  };
  // Printable keys without modifiers are sent as 'keyDown' with text, like a real key press.
  const key = async (keyName, { modifiers = 0, code, keyCode, text } = {}) => {
    const fields = {
      key: keyName,
      code: code ?? (/^[a-z]$/i.test(keyName) ? `Key${keyName.toUpperCase()}` : keyName),
      windowsVirtualKeyCode: keyCode ?? keyName.toUpperCase().charCodeAt(0),
      modifiers,
    };
    const typed = text ?? (keyName.length === 1 && !modifiers ? keyName : undefined);
    await page.send('Input.dispatchKeyEvent', typed === undefined ? { type: 'rawKeyDown', ...fields } : { type: 'keyDown', text: typed, unmodifiedText: typed, ...fields });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...fields });
    await pause(20);
  };
  const blur = () => evaluate('document.activeElement?.blur()');
  const click = (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('missing ${selector.replace(/'/g, '')}'); el.click(); return true; })()`);
  const setValue = async (label, value) => {
    await evaluate(`document.querySelector('input[aria-label="${label} value"]').focus()`);
    await pause(30);
    await evaluate(`document.activeElement.select()`);
    await page.send('Input.insertText', { text: String(value) });
    await pause(50);
    await key('Enter', { keyCode: 13, text: String.fromCharCode(13) });
    await pause(30);
    await evaluate('document.activeElement?.blur()');
  };
  const valueOf = (label) => evaluate(`document.querySelector('input[aria-label="${label} value"]').value`);
  // A real click moves focus (committing any typed value) before the click handler runs.
  const selectPhoto = async (name) => {
    await evaluate('document.activeElement?.blur()');
    await click(`.pe-photo--list button.pe-photo__select[aria-label^="${name}"]`);
  };
  const previewReady = () => waitFor(`!document.querySelector('.pe-stage-message') && !document.querySelector('.pe-canvas-host').hidden`, 'preview ready', 60_000);
  const importFiles = async (paths) => {
    const { root: doc } = await page.send('DOM.getDocument', { depth: -1 });
    const { nodeId } = await page.send('DOM.querySelector', { nodeId: doc.nodeId, selector: 'input[type=file][multiple]' });
    await page.send('DOM.setFileInputFiles', { nodeId, files: paths });
  };
  const waitDownload = async (name, timeout = 120_000) => {
    const file = path.join(downloads, name);
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (existsSync(file) && !existsSync(`${file}.crdownload`)) { await pause(200); return file; }
      await pause(100);
    }
    throw new Error(`No download ${name}`);
  };
  const memoryMb = () => {
    try {
      const command = `(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${path.basename(profile)}*' } | Measure-Object -Property WorkingSetSize -Sum).Sum`;
      return Math.round(Number(execFileSync('powershell', ['-NoProfile', '-Command', command]).toString().trim()) / 1048576);
    } catch { return null; }
  };
  const viewport = (width, height, mobile = false) => page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });

  try {
    // ---------- GPU/CPU parity ----------
    await navigate('http://localhost:5179/src/editor/dev/parity.html');
    await waitFor('window.parityResult', 'parity result', 60_000);
    const parity = await evaluate('window.parityResult');
    report.measurements.parity = parity;
    await check('WebGL2 shader matches the CPU reference within 1 code value', () => {
      assert.ok(parity.available, 'WebGL2 unavailable');
      const worst = Math.max(...parity.results.map(({ max }) => max));
      const mean = Math.max(...parity.results.map(({ mean: m }) => m));
      assert.ok(worst <= 1, `max difference ${worst}`);
      assert.ok(parity.results[0].max === 0, 'neutral is not exact');
      assert.ok(parity.splitSourceExact, 'split left half is not the exact source');
      const rawWorst = Math.max(...parity.rawResults.map(({ max }) => max));
      assert.ok(rawWorst <= 1 && parity.rawSplitMax <= 1, `RAW max difference ${rawWorst}, split ${parity.rawSplitMax}`);
      return { gpu: parity.gpu, cases: parity.results.length, worstMax: worst, worstMean: Number(mean.toFixed(4)), rawCases: parity.rawResults.length, rawWorstMax: rawWorst };
    });
    await check('geometry: the shader warp matches warpImage + the CPU renderer', () => {
      const integer = parity.geometryResults.filter(({ name }) => !name.startsWith('HDR'));
      const float = parity.geometryResults.filter(({ name }) => name.startsWith('HDR'));
      const worst = Math.max(...integer.map(({ max }) => max));
      const hdrWorst = Math.max(...float.map(({ max }) => max));
      const mean = Math.max(...parity.geometryResults.map(({ mean: m }) => m));
      assert.ok(worst <= 1 && hdrWorst <= HDR_GEOMETRY_PARITY_MAX, `max difference ${worst} (HDR ${hdrWorst}): ${JSON.stringify(parity.geometryResults)}`);
      return { cases: parity.geometryResults.length, worstMax: worst, hdrWorstMax: hdrWorst, worstMean: Number(mean.toFixed(4)) };
    });
    await check('creative: the shader (looks, grain, glow, vignette, grading, alpha, RAW, HDR, geometry) matches the CPU renderer', () => {
      // Quantisation is a step function: a value on a level boundary may round to the neighbouring
      // level in float32. Those cases may differ by one level in at most QUANTIZE_FLIPS pixels.
      const stepped = ({ name }) => /posterize|Posterized/.test(name);
      const flips = parity.creativeResults.filter(stepped);
      assert.ok(flips.every(({ over1 }) => over1 <= QUANTIZE_FLIPS), `quantisation parity: ${JSON.stringify(flips)}`);
      const integer = parity.creativeResults.filter((item) => !stepped(item) && !item.name.startsWith('HDR') && !item.name.startsWith('geometry'));
      const other = parity.creativeResults.filter(({ name }) => name.startsWith('HDR') || name.startsWith('geometry'));
      const worst = Math.max(...integer.map(({ max }) => max));
      const otherWorst = Math.max(...other.map(({ max }) => max));
      const mean = Math.max(...parity.creativeResults.map(({ mean: m }) => m));
      assert.ok(worst <= 1 && otherWorst <= HDR_GEOMETRY_PARITY_MAX && parity.creativeResults.every((item) => stepped(item) || item.name.startsWith('HDR') || item.name.startsWith('geometry') || item.over1 === 0), `creative parity: ${JSON.stringify(parity.creativeResults.filter((item) => !stepped(item) && item.max > 1))}`);
      return { cases: parity.creativeResults.length, worstMax: worst, hdrAndGeometryWorstMax: otherWorst, worstMean: Number(mean.toFixed(4)) };
    });

    // ---------- page load ----------
    await viewport(1440, 900);
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__csp=[];addEventListener("securitypolicyviolation",e=>__csp.push(e.violatedDirective+" "+e.blockedURI));' });
    const baseline = memoryMb();
    await navigate(`${origin}/photography/editor`);
    await waitFor('document.querySelector(".pe[data-engine]")', 'editor mounted');
    await check('editor page loads with WebGL2, its own title, noindex and no CSP violations', async () => {
      const info = await evaluate('({ engine: document.querySelector(".pe").dataset.engine, title: document.title, robots: document.querySelector("meta[name=robots]").content, csp: __csp, scripts: performance.getEntriesByType("resource").filter(r => r.initiatorType === "script").map(r => r.name.split("/").pop()) })');
      assert.equal(info.engine, 'webgl2');
      assert.equal(info.title, 'Photo Editor | Quang Huynh');
      assert.equal(info.robots, 'noindex, follow');
      assert.deepEqual(info.csp, []);
      return { engine: info.engine };
    });
    await check('the gallery does not load editor code', async () => {
      const { root: _ } = { root: null };
      await navigate(`${origin}/photography/`);
      await pause(1500);
      const names = await evaluate('performance.getEntriesByType("resource").map(r => r.name.split("/").pop())');
      assert.ok(!names.some((name) => /photoEditorPage|imageWorker/.test(name)), names.join(','));
      await navigate(`${origin}/photography/editor`);
      await waitFor('document.querySelector(".pe[data-engine]")', 'editor mounted');
    });

    await check('the photography page links to the editor without a full page load', async () => {
      await navigate(`${origin}/photography/`);
      await waitFor('document.querySelector("a[href$=editor]")', 'gallery rendered');
      await evaluate('window.__sameDocument = true');
      await click('a[href$=editor]');
      await waitFor('document.querySelector(".pe[data-engine]")', 'editor mounted in-app');
      assert.equal(await evaluate('window.__sameDocument'), true, 'the page reloaded');
      assert.equal(await evaluate('location.pathname'), '/photography/editor');
      await navigate(`${origin}/photography/editor`);
      await waitFor('document.querySelector(".pe[data-engine]")', 'editor mounted');
    });

    // ---------- import ----------
    let started = Date.now();
    await importFiles([files.chart, files.webp, files.alpha, files.rotated, files.duplicate, files.damaged, files.broken, files.gif, files.empty]);
    await waitFor(`document.querySelectorAll('.pe-photo--list').length === 9 && !document.querySelector('.pe-photo--list[data-status=importing]')`, 'imports settle');
    report.measurements.importSmallMs = Date.now() - started;
    await check('imports valid files and reports each invalid one', async () => {
      const rows = await evaluate(`[...document.querySelectorAll('.pe-photo--list')].map(li => ({ name: li.querySelector('.pe-photo__name').textContent, status: li.dataset.status, detail: li.querySelector('.pe-photo__detail').textContent }))`);
      const by = Object.fromEntries(rows.map((row) => [row.name, row]));
      ['chart.png', 'photo.webp', 'alpha.png', 'rotated-exif6.jpg'].forEach((name) => assert.equal(by[name].status, 'ready', name));
      assert.match(by['chart-copy.png'].detail, /Already in the workspace as chart\.png/);
      assert.match(by['damaged.png'].detail, /could not decode|damaged/i);
      assert.match(by['broken.jpg'].detail, /damaged or incomplete/);
      assert.match(by['animation.jpg'].detail, /Only JPEG, PNG, WebP and RAW/);
      assert.match(by['empty.jpg'].detail, /empty/);
      assert.match(by['rotated-exif6.jpg'].detail, /^400×600/);
      return rows.filter((row) => row.status === 'error').map((row) => `${row.name}: ${row.detail}`);
    });

    // ---------- editing, undo, per-photo state ----------
    await selectPhoto('chart.png');
    await previewReady();
    await check('adjustments, undo/redo and keyboard slider steps', async () => {
      await setValue('Exposure', '1');
      assert.equal(await valueOf('Exposure'), '+1.00 EV');
      await blur();
      await key('z', { modifiers: 2 });
      assert.equal(await valueOf('Exposure'), '0.00 EV');
      await key('z', { modifiers: 10 });
      assert.equal(await valueOf('Exposure'), '+1.00 EV');
      await evaluate('document.getElementById("pe-adjust-shadows").focus()');
      for (let n = 0; n < 5; n += 1) await key('ArrowRight', { keyCode: 39 });
      assert.equal(await valueOf('Shadows'), '+5');
      await blur();
      await key('z', { modifiers: 2 });
      assert.equal(await valueOf('Shadows'), '0', 'five key steps should undo as one');
      await click('button[aria-label="Reset Exposure"]');
      assert.equal(await valueOf('Exposure'), '0.00 EV');
    });
    await check('each photo keeps its own edits when switching', async () => {
      for (const [label, value] of Object.entries({ Exposure: COMBINED.exposure, Contrast: COMBINED.contrast, Highlights: COMBINED.highlights, Shadows: COMBINED.shadows, Whites: COMBINED.whites, Blacks: COMBINED.blacks, Temperature: COMBINED.temperature, Tint: COMBINED.tint, Vibrance: COMBINED.vibrance, Saturation: COMBINED.saturation })) await setValue(label, value);
      await selectPhoto('photo.webp');
      await previewReady();
      assert.equal(await valueOf('Exposure'), '0.00 EV');
      await setValue('Saturation', -40);
      await selectPhoto('chart.png');
      await previewReady();
      assert.equal(await valueOf('Exposure'), '+0.35 EV');
      assert.equal(await valueOf('Tint'), '-6');
      await selectPhoto('photo.webp');
      assert.equal(await valueOf('Saturation'), '-40');
      await selectPhoto('chart.png');
    });

    await check('before/after: original, split divider and keyboard control', async () => {
      await click('.pe-compare button:nth-child(2)');
      assert.equal(await evaluate('document.querySelector(".pe-stage-badge")?.textContent'), 'Original');
      await click('.pe-compare button:nth-child(3)');
      await evaluate('document.querySelector(".pe-split__handle").focus()');
      await key('ArrowLeft', { keyCode: 37 });
      assert.equal(await evaluate('document.querySelector(".pe-split__handle").getAttribute("aria-valuenow")'), '48');
      await blur();
      await key('\\', { code: 'Backslash', keyCode: 220 });
      await waitFor('document.querySelector(".pe-compare button[aria-pressed=true]").textContent === "Original"', 'backslash shows the original', 3000);
      await click('.pe-compare button:nth-child(1)');
    });

    // ---------- export ----------
    const exportPhoto = async (format, extra = '') => {
      await evaluate('document.activeElement?.blur()');
    await evaluate(`document.querySelector('input[name=pe-format][value=${format}]').click()`);
      if (extra) await evaluate(extra);
      await pause(50);
      await click('.pe-export-button');
    };
    await check('PNG export equals the CPU reference exactly', async () => {
      await exportPhoto('png');
      const file = await waitDownload('chart-quangedit.png');
      const exported = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const source = await sharp(files.chart).ensureAlpha().raw().toBuffer();
      const expected = renderRgba8(new Uint8ClampedArray(source), deriveParams(COMBINED));
      assert.equal(exported.info.width, 64);
      assert.equal(exported.info.height, 64);
      let max = 0;
      for (let i = 0; i < expected.length; i += 1) max = Math.max(max, Math.abs(expected[i] - exported.data[i]));
      assert.equal(max, 0, `max difference ${max}`);
      rmSync(file);
      return { maxDifference: max };
    });
    await check('LUT import, HSL, curve keyboard edits and a preset: PNG export equals the CPU reference', async () => {
      const openSection = async (id) => {
        if (await evaluate(`document.querySelector('.pe-section[data-section-id=${id}] .pe-section__toggle').getAttribute('aria-expanded') === 'false'`)) await click(`.pe-section[data-section-id=${id}] .pe-section__toggle`);
      };
      await openSection('lut');
      const started = Date.now();
      const { root: doc } = await page.send('DOM.getDocument', { depth: -1 });
      const { nodeId } = await page.send('DOM.querySelector', { nodeId: doc.nodeId, selector: 'input[aria-label="Import a .cube LUT"]' });
      await page.send('DOM.setFileInputFiles', { nodeId, files: [files.lut65] });
      await waitFor(`document.querySelector('.pe-lut select')?.value.length === 64`, 'LUT imported', 30_000);
      const lutImportMs = Date.now() - started;
      await setValue('Intensity', 70);
      await openSection('hsl');
      await click('.pe-hsl__swatch[aria-label^="Blue"]');
      await setValue('Blue saturation', -35);
      await click('.pe-hsl__swatch[aria-label^="Orange"]');
      await setValue('Orange hue', 20);
      await openSection('curves');
      await click('.pe-curve__actions .pe-text-button');
      await evaluate(`document.querySelector('.pe-curve__point[aria-label="Point 2 of 3"]').focus()`);
      for (let n = 0; n < 3; n += 1) await key('ArrowUp', { keyCode: 38, modifiers: 8 });
      assert.equal(await evaluate(`document.querySelector('.pe-curve__point[aria-label="Point 2 of 3"]').getAttribute('aria-valuetext')`), 'Input 128, output 158');
      await blur();
      await exportPhoto('png');
      const file = await waitDownload('chart-quangedit.png');
      const exported = await sharp(file).ensureAlpha().raw().toBuffer();
      const source = await sharp(files.chart).ensureAlpha().raw().toBuffer();
      const settings = { ...COMBINED, blueSaturation: -35, orangeHue: 20, lut: { sha256: '0'.repeat(64), name: 'look' }, lutIntensity: 70, curves: { master: [[0, 0], [128, 158], [255, 255]] } };
      const expected = renderRgba8(new Uint8ClampedArray(source), deriveParams(settings, { lut: parseCube(readFileSync(files.lut65, 'utf8')) }));
      let max = 0;
      for (let i = 0; i < expected.length; i += 1) max = Math.max(max, Math.abs(expected[i] - exported[i]));
      assert.equal(max, 0, `max difference ${max}`);
      rmSync(file);
      // A preset applies to another photo as one undo step, through the same engine.
      await selectPhoto('photo.webp');
      await previewReady();
      await openSection('presets');
      const before = await valueOf('Contrast');
      await click('.pe-preset__apply[aria-label="Apply High Contrast"]');
      assert.equal(await valueOf('Contrast'), '+35');
      await blur();
      await key('z', { modifiers: 2 });
      assert.equal(await valueOf('Contrast'), before);
      await selectPhoto('chart.png');
      await previewReady();
      report.measurements.lut65ImportMs = lutImportMs;
      return { maxDifference: max, lut65ImportMs: lutImportMs };
    });
    await check('neutral export of an EXIF-rotated JPEG is upright and full size', async () => {
      await selectPhoto('rotated-exif6.jpg');
      await previewReady();
      await exportPhoto('png');
      const file = await waitDownload('rotated-exif6-quangedit.png');
      const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
      assert.deepEqual([info.width, info.height], [400, 600]);
      const at = (x, y) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
      const [r1, , b1] = at(200, 100);
      const [r2, , b2] = at(200, 500);
      assert.ok(r1 > 180 && b1 < 60, `top ${at(200, 100)}`);
      assert.ok(b2 > 180 && r2 < 60, `bottom ${at(200, 500)}`);
    });
    await check('WebP export with resize keeps the aspect ratio and format', async () => {
      await selectPhoto('photo.webp');
      await previewReady();
      await evaluate(`(() => { const s = document.querySelector('[data-section=export] select'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'long-edge'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await pause(50);
      await evaluate(`(() => { const i = document.querySelector('.pe-field--inline input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '400'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await exportPhoto('webp');
      const file = await waitDownload('photo-quangedit.webp');
      const metadata = await sharp(file).metadata();
      assert.equal(metadata.format, 'webp');
      assert.deepEqual([metadata.width, metadata.height], [400, 267]);
      assert.equal(metadata.exif, undefined, 'export carries EXIF');
      await evaluate(`(() => { const s = document.querySelector('[data-section=export] select'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'original'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    });
    await check('JPEG export flattens transparency onto white', async () => {
      await selectPhoto('alpha.png');
      await previewReady();
      await exportPhoto('jpeg');
      const file = await waitDownload('alpha-quangedit.jpg');
      const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
      assert.equal(info.channels, 3);
      // 50% of (30, 90, 160) over white in linear light.
      const expected = renderRgba8(new Uint8ClampedArray([30, 90, 160, 128]), deriveParams({}), { flattenAlpha: true });
      [0, 1, 2].forEach((c) => assert.ok(Math.abs(data[c] - expected[c]) <= 3, `channel ${c}: ${data[c]} vs ${expected[c]}`));
    });

    // ---------- large photographs: switching, memory, export timing ----------
    started = Date.now();
    await importFiles([files.large, files.large2]);
    await waitFor(`[...document.querySelectorAll('.pe-photo--list')].filter(li => li.dataset.status === 'ready').length === 6`, 'large imports', 120_000);
    report.measurements.importTwo24mpMs = Date.now() - started;
    const switchTimes = [];
    const memory = { baseline };
    await check('switching repeatedly between two 24 MP photographs', async () => {
      for (let n = 0; n < 10; n += 1) {
        const name = n % 2 ? 'large-24mp-b.jpg' : 'large-24mp.jpg';
        const t = Date.now();
        await selectPhoto(name);
        await pause(16);
        await previewReady();
        switchTimes.push(Date.now() - t);
      }
      memory.afterSwitching = memoryMb();
      report.measurements.switchMs = switchTimes;
      return { firstTwoMs: switchTimes.slice(0, 2), cachedMedianMs: switchTimes.slice(2).sort((a, b) => a - b)[4] };
    });
    await check('full-resolution 24 MP JPEG export', async () => {
      await selectPhoto('large-24mp.jpg');
      await previewReady();
      await setValue('Exposure', 0.5);
      await setValue('Highlights', -50);
      await setValue('Vibrance', 25);
      const peaks = [];
      const sampler = setInterval(() => { const m = memoryMb(); if (m) peaks.push(m); }, 400);
      const t = Date.now();
      await exportPhoto('jpeg');
      const file = await waitDownload('large-24mp-quangedit.jpg', 180_000);
      clearInterval(sampler);
      const wall = Date.now() - t;
      const metadata = await sharp(file).metadata();
      assert.deepEqual([metadata.width, metadata.height, metadata.format], [6000, 4000, 'jpeg']);
      const timings = await evaluate(`performance.getEntriesByName('pe-export').at(-1)?.duration`);
      memory.peakDuringExport = Math.max(...peaks);
      // Compare a region with the CPU reference applied to sharp's decode of the source.
      const region = { left: 2000, top: 1500, width: 400, height: 300 };
      const exported = await sharp(file).extract(region).ensureAlpha().raw().toBuffer();
      const source = await sharp(files.large).extract(region).ensureAlpha().raw().toBuffer();
      const expected = renderRgba8(new Uint8ClampedArray(source), deriveParams({ exposure: 0.5, highlights: -50, vibrance: 25 }));
      let sum = 0;
      for (let i = 0; i < expected.length; i += 4) for (let c = 0; c < 3; c += 1) sum += Math.abs(expected[i + c] - exported[i + c]);
      const mean = sum / (expected.length * 0.75);
      assert.ok(mean < 2, `mean difference ${mean}`);
      report.measurements.export24mp = { wallMs: wall, measuredMs: Math.round(timings), bytes: metadata.size, meanDifferenceVsNodeReference: Number(mean.toFixed(3)) };
      return report.measurements.export24mp;
    });
    await check('export cancellation', async () => {
      await exportPhoto('png');
      await waitFor(`document.querySelector('.pe-export-progress')`, 'export started');
      await pause(300);
      await click('.pe-export-progress button');
      await waitFor(`document.querySelector('.pe-inspector')?.textContent.includes('Export cancelled.')`, 'cancel message');
      await pause(500);
      assert.ok(!existsSync(path.join(downloads, 'large-24mp-quangedit.png')));
    });

    // ---------- screenshots ----------
    await click('.pe-compare button:nth-child(3)');
    await pause(400);
    const shot = async (name) => {
      const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(path.join(output, name), Buffer.from(data, 'base64'));
    };
    await shot('editor-desktop.png');
    await check('mobile layout at 375 px has no horizontal overflow and keeps every panel reachable', async () => {
      await viewport(375, 812, true);
      await pause(500);
      const overflow = await evaluate('document.documentElement.scrollWidth - window.innerWidth');
      assert.ok(overflow <= 0, `overflow ${overflow}px`);
      const stage = await evaluate('document.querySelector(".pe-stage").getBoundingClientRect().height');
      assert.ok(stage >= 200, `stage only ${stage}px tall`);
      await shot('editor-mobile-adjust.png');
      await click('.pe-tabs button:nth-child(3)');
      assert.ok(await evaluate('!!document.querySelector(".pe-export-button")?.offsetParent'));
      await click('.pe-tabs button:nth-child(1)');
      assert.ok(await evaluate('!!document.querySelector(".pe-library .pe-button--primary")?.offsetParent'));
      await shot('editor-mobile-photos.png');
      await click('.pe-tabs button:nth-child(2)');
      await click('.pe-mobile-tools__list button');
      const thumb = await evaluate('Math.round(document.querySelector(".pe-section[data-section-id=light] .pe-range").getBoundingClientRect().height)');
      assert.ok(thumb >= 36, `slider ${thumb}px`);
      await viewport(1440, 900);
    });

    // ---------- saved edits ----------
    await check('save edits, reload, reimport restores them', async () => {
      await click('.pe-bar__actions .pe-button');
      const name = `photo-edits-${new Date().toISOString().slice(0, 10)}.json`;
      const document = parseEditDocument(readFileSync(await waitDownload(name), 'utf8'));
      const chart = document.photos.find(({ source }) => source.name === 'chart.png');
      assert.deepEqual(Object.fromEntries(Object.keys(COMBINED).map((k) => [k, chart.adjustments[k]])), COMBINED);
      assert.equal(chart.adjustments.lut.name, 'look-65.cube');
      assert.deepEqual(chart.adjustments.curves.master, [[0, 0], [128, 158], [255, 255]]);
      assert.ok(!readFileSync(path.join(downloads, name), 'utf8').includes('"data"'), 'LUT data saved in the document');
      assert.ok(!readFileSync(path.join(downloads, name), 'utf8').includes('blob:'));
      await navigate(`${origin}/photography/editor`);
      await waitFor(`document.querySelector('.pe-notice')?.textContent.includes('Reimport the original')`, 'restore notice');
      await importFiles([files.chart]);
      await waitFor(`document.querySelector('.pe-photo__badge')`, 'restored badge');
      await selectPhoto('chart.png');
      assert.equal(await valueOf('Exposure'), '+0.35 EV');
      assert.equal(await valueOf('Saturation'), '-10');
      // The LUT is referenced, not stored: it is reported missing and export waits for it.
      await waitFor(`document.querySelector('.pe-lut__missing')?.textContent.includes('look-65.cube')`, 'missing LUT notice');
      assert.ok(await evaluate(`document.querySelector('.pe-export-button').disabled`), 'export not blocked');
      const { root: doc } = await page.send('DOM.getDocument', { depth: -1 });
      const { nodeId } = await page.send('DOM.querySelector', { nodeId: doc.nodeId, selector: 'input[aria-label="Import a .cube LUT"]' });
      await page.send('DOM.setFileInputFiles', { nodeId, files: [files.lut65] });
      await waitFor(`!document.querySelector('.pe-lut__missing') && !document.querySelector('.pe-export-button').disabled`, 'LUT restored');
    });

    await check('removing photos releases memory', async () => {
      await importFiles([files.large, files.large2]);
      await waitFor(`[...document.querySelectorAll('.pe-photo--list')].filter(li => li.dataset.status === 'ready').length === 3`, 'large reimport', 120_000);
      for (const name of ['large-24mp.jpg', 'large-24mp-b.jpg']) { await selectPhoto(name); await previewReady(); }
      memory.twoLargeLoaded = memoryMb();
      while (await evaluate(`document.querySelectorAll('.pe-photo__remove').length`)) {
        await click('.pe-photo__remove');
        await pause(50);
      }
      await page.send('HeapProfiler.collectGarbage').catch(() => {});
      await pause(2000);
      memory.afterRemovingAll = memoryMb();
      assert.equal(await evaluate(`document.querySelectorAll('.pe-photo--list').length`), 0);
      return memory;
    });
    report.measurements.memoryMb = memory;
    await check('no uncaught errors or console errors', () => {
      const relevant = problems.filter((text) => !/Failed to load resource.*favicon/.test(text));
      assert.deepEqual(relevant, []);
    });
  } finally {
    report.screenshots = output;
    writeFileSync(path.join(work, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`\nreport: ${path.join(work, 'report.json')}`);
    console.log(JSON.stringify({ ...report.measurements, parity: report.measurements.parity && { gpu: report.measurements.parity.gpu, cases: report.measurements.parity.results?.length } }));
    page.close();
    browser.close();
    chrome.kill();
    await previewServer.close();
    await devServer.close();
    if (!failures.length && !process.env.EDITOR_CHECK_OUTPUT) rmSync(path.join(work, 'fixtures'), { recursive: true, force: true });
  }
  if (failures.length) {
    console.log(`\n${failures.length} check(s) failed: ${failures.join('; ')}`);
    process.exitCode = 1;
  }
}

await main();
