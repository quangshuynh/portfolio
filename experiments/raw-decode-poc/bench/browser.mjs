// Decodes RAW_FIXTURE in headless Chromium through libraw-wasm's Web Worker, once with
// cross-origin isolation (COOP/COEP) and once without, and prints a JSON report.
//
//   RAW_FIXTURE=path/to.ARW CHROME_PATH=path/to/chrome npm run bench:browser
//
// Uses a throwaway Chromium profile; never point CHROME_PATH at a personal profile.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixturePath = process.env.RAW_FIXTURE;
const chromePath = process.env.CHROME_PATH;
if (!fixturePath || !chromePath) throw new Error('Set RAW_FIXTURE and CHROME_PATH.');
const runs = Number(process.env.RUNS ?? 3);

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.dirname(fileURLToPath(import.meta.resolve('libraw-wasm/dist/index.js')));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm' };

function startServer(isolated) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    let file;
    if (url.pathname === '/') file = path.join(here, 'harness.html');
    else if (url.pathname === '/fixture') file = fixturePath;
    else if (url.pathname.startsWith('/libraw/')) file = path.join(distDir, path.basename(url.pathname));
    const headers = { 'Content-Type': TYPES[path.extname(file ?? '')] ?? 'application/octet-stream' };
    if (isolated) Object.assign(headers, { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
    try {
      if (!file) throw new Error('not found');
      response.writeHead(200, headers).end(await readFile(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function connect(port) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      return await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error('Chromium did not start.');
}

function cdp(webSocketUrl) {
  const ws = new WebSocket(webSocketUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
  });
  const opened = new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
  return {
    opened,
    close: () => ws.close(),
    send: (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    }),
  };
}

async function runIn(browser, origin) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await browser.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  await browser.send('Page.navigate', { url: `${origin}/` }, sessionId);
  for (let attempt = 0; attempt < 100 && !(await evaluate('Boolean(window.harnessReady)').catch(() => false)); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const report = await evaluate(`runBenchmark(${runs})`);
  await browser.send('Target.closeTarget', { targetId });
  return report;
}

const profile = await mkdtemp(path.join(tmpdir(), 'raw-poc-chrome-'));
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(chromePath, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--enable-blink-features=ForceEagerMeasureMemory',
], { stdio: 'ignore' });

try {
  const version = await connect(port);
  const browser = cdp(version.webSocketDebuggerUrl);
  await browser.opened;
  const report = { browser: version.Browser, fixtureBytes: (await readFile(fixturePath)).byteLength, scenarios: [] };
  for (const isolated of [true, false]) {
    const server = await startServer(isolated);
    const origin = `http://127.0.0.1:${server.address().port}`;
    report.scenarios.push({ coopCoep: isolated, ...(await runIn(browser, origin)) });
    server.close();
  }
  browser.close();
  console.log(JSON.stringify(report, null, 2));
} finally {
  chrome.kill();
  await new Promise((resolve) => setTimeout(resolve, 500));
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
