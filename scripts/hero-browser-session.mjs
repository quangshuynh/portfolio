import { writeFile } from 'node:fs/promises';
// Attach to a dedicated local Chromium instance; never use a personal profile.
const endpoint = process.env.HERO_BROWSER_URL || 'http://localhost:9223';
const target = await (
  await fetch(`${endpoint}/json/new?about:blank`, { method: 'PUT' })
).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', ({ data }) => {
  const m = JSON.parse(data);
  if (m.id) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.reject(m.error) : p.resolve(m.result);
  }
});
export function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
export async function evaluate(expression) {
  const r = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
export const pause = (ms) => new Promise((r) => setTimeout(r, ms));
export async function screenshot(path) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path, Buffer.from(data, 'base64'));
}
export async function close() {
  await send('Page.close');
  ws.close();
}
await send('Page.enable');
await send('Runtime.enable');
// Make interactive checks independent of the host OS animation preference.
// Individual reduced-motion probes explicitly override this later.
await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
});
