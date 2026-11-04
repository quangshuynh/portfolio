import { afterEach, describe, expect, test, vi } from 'vitest';
import { createSelectionRunner } from './selectionClient.mjs';

/** A stand-in worker: `answer(message, worker)` decides what it posts back (or nothing). */
function fakeWorkers(answer) {
  const spawned = [];
  const spawn = () => {
    const worker = {
      terminated: false,
      onmessage: null,
      onerror: null,
      terminate() { this.terminated = true; },
      postMessage(message) { queueMicrotask(() => answer(message, worker)); },
      reply(data) { if (!this.terminated) this.onmessage?.({ data }); },
    };
    spawned.push(worker);
    return worker;
  };
  return { spawn, spawned };
}

afterEach(() => vi.useRealTimers());

describe('selection runner', () => {
  test('repeated selections reuse one worker; idle time ends it', async () => {
    vi.useFakeTimers();
    const { spawn, spawned } = fakeWorkers((m, w) => w.reply({ id: m.id, type: 'done', result: { found: true, n: m.id } }));
    const runner = createSelectionRunner({ spawn, base: '/', idleMs: 1000 });
    await expect(runner.run({ kind: 'sky' })).resolves.toMatchObject({ n: 1 });
    await expect(runner.run({ kind: 'subject' })).resolves.toMatchObject({ n: 2 });
    expect(spawned).toHaveLength(1);
    expect([...runner.loaded()].sort()).toEqual(['saliency', 'samDecoder', 'samEncoder', 'sky']);
    vi.advanceTimersByTime(1000);
    expect(spawned[0].terminated).toBe(true);
    expect(runner.loaded().size).toBe(0);
  });

  test('a new selection cancels the one running; cancel ends the worker', async () => {
    const { spawn, spawned } = fakeWorkers(() => {});
    const runner = createSelectionRunner({ spawn, base: '/' });
    const first = runner.run({ kind: 'sky' });
    runner.run({ kind: 'sky' }).catch(() => {});
    await expect(first).rejects.toMatchObject({ code: 'cancelled' });
    expect(spawned[0].terminated).toBe(true);
    expect(runner.busy()).toBe(true);
    runner.cancel();
    expect(runner.busy()).toBe(false);
    expect(spawned[1].terminated).toBe(true);
  });

  test('a selection that stops responding is ended, and the next one gets a fresh worker', async () => {
    vi.useFakeTimers();
    let silent = true;
    const { spawn, spawned } = fakeWorkers((m, w) => {
      if (silent) { w.reply({ id: m.id, type: 'progress', progress: { stage: 'analyse' } }); return; }
      w.reply({ id: m.id, type: 'done', result: { found: true } });
    });
    const runner = createSelectionRunner({ spawn, base: '/', stallMs: 5000 });
    const stuck = runner.run({ kind: 'subject' });
    stuck.catch(() => {});
    await vi.advanceTimersByTimeAsync(4000);
    expect(runner.busy()).toBe(true);
    await vi.advanceTimersByTimeAsync(1500);
    await expect(stuck).rejects.toMatchObject({ code: 'timeout' });
    expect(spawned[0].terminated).toBe(true);
    expect(runner.busy()).toBe(false);
    silent = false;
    await expect(runner.run({ kind: 'subject' })).resolves.toMatchObject({ found: true });
    expect(spawned).toHaveLength(2);
  });

  test('a failed model initialisation can be retried; a damaged model gets a fresh worker', async () => {
    let fail = 'model-download';
    const { spawn, spawned } = fakeWorkers((m, w) => {
      if (fail) w.reply({ id: m.id, type: 'error', code: fail, message: 'no' });
      else w.reply({ id: m.id, type: 'done', result: { found: true } });
    });
    const runner = createSelectionRunner({ spawn, base: '/' });
    await expect(runner.run({ kind: 'sky' })).rejects.toMatchObject({ code: 'model-download' });
    // A download failure keeps the worker (other models may be loaded); a corrupt model does not.
    expect(spawned[0].terminated).toBe(false);
    fail = 'model-corrupt';
    await expect(runner.run({ kind: 'sky' })).rejects.toMatchObject({ code: 'model-corrupt' });
    expect(spawned[0].terminated).toBe(true);
    fail = null;
    await expect(runner.run({ kind: 'sky' })).resolves.toMatchObject({ found: true });
    expect(spawned).toHaveLength(2);
  });

  test('a worker that dies is reported and replaced', async () => {
    let die = true;
    const { spawn, spawned } = fakeWorkers((m, w) => {
      if (die) w.onerror({ message: '' });
      else w.reply({ id: m.id, type: 'done', result: { found: true } });
    });
    const runner = createSelectionRunner({ spawn, base: '/' });
    await expect(runner.run({ kind: 'sky' })).rejects.toMatchObject({ code: 'worker-failed' });
    die = false;
    await expect(runner.run({ kind: 'sky' })).resolves.toMatchObject({ found: true });
    expect(spawned).toHaveLength(2);
  });
});

test('trimming ends an idle worker but never a running selection', async () => {
  const { spawn, spawned } = fakeWorkers(() => {});
  const runner = createSelectionRunner({ spawn, base: '/' });
  const running = runner.run({ kind: 'sky' });
  running.catch(() => {});
  runner.trim();
  expect(spawned[0].terminated).toBe(false);
  spawned[0].reply({ id: 1, type: 'done', result: { found: true } });
  await running;
  runner.trim();
  expect(spawned[0].terminated).toBe(true);
  expect(runner.loaded().size).toBe(0);
});
