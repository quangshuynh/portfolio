import { expect, test } from 'vitest';
import { createInpaintRunner } from './inpaintClient.mjs';

// A worker stand-in that never answers until told to, and records being terminated.
function fakeWorkers() {
  const made = [];
  const spawn = () => {
    const worker = { terminated: false, messages: [], postMessage(message) { this.messages.push(message); }, terminate() { this.terminated = true; } };
    made.push(worker);
    return worker;
  };
  return { made, spawn };
}
const payload = () => ({ color: new Float32Array(3), hole: new Uint8Array(1), allowed: new Uint8Array(1) });

test('a superseded fill is cancelled with its worker; the new fill runs on a fresh one', async () => {
  const { made, spawn } = fakeWorkers();
  const runner = createInpaintRunner(spawn);
  const first = runner.run(payload());
  const second = runner.run(payload());
  await expect(first).rejects.toMatchObject({ code: 'cancelled' });
  expect(made).toHaveLength(2);
  expect(made[0].terminated).toBe(true);
  expect(made[1].terminated).toBe(false);
  const filled = new Float32Array(3).fill(0.5);
  made[1].onmessage({ data: { id: made[1].messages[0].id, type: 'done', filled } });
  await expect(second).resolves.toBe(filled);
});

test('cancel ends the running fill; the next one starts a new worker', async () => {
  const { made, spawn } = fakeWorkers();
  const runner = createInpaintRunner(spawn);
  const running = runner.run(payload());
  runner.cancel();
  await expect(running).rejects.toMatchObject({ code: 'cancelled' });
  expect(made[0].terminated).toBe(true);
  runner.run(payload()).catch(() => {});
  expect(made).toHaveLength(2);
  runner.dispose();
});
