// @vitest-environment node
import { batchFileNames, zipFileName } from './batchNames.mjs';
import { createExportBatch } from './exportBatch.mjs';
import { createZipArchive } from './zipArchive.mjs';
import { readZip } from '../dev/zipVerify.mjs';

const bytes = (length, seed = 1) => {
  const data = new Uint8Array(length);
  let value = seed;
  for (let i = 0; i < length; i += 1) { value = (value * 1103515245 + 12345) % 2147483648; data[i] = value >> 16; }
  return data;
};
const blobOf = (data, type = 'image/jpeg') => new Blob([data], { type });

describe('batch file names', () => {
  test('follow exportFileName for every source kind, without doubling the suffix', () => {
    const names = batchFileNames([
      { id: 1, name: 'DSC09640.ARW' },
      { id: 2, name: 'IMG_1234.JPG' },
      { id: 3, name: 'DSC09641-HDR' },
      { id: 4, name: 'already-quangedit.png' },
      { id: 5, name: 'Ảnh đẹp 東京.webp' },
    ], { format: 'jpeg' });
    expect([...names.values()]).toEqual(['DSC09640-quangedit.jpg', 'IMG_1234-quangedit.jpg', 'DSC09641-HDR-quangedit.jpg', 'already-quangedit.jpg', 'Ảnh đẹp 東京-quangedit.jpg']);
    expect(batchFileNames([{ id: 1, name: 'IMG_1234.JPG' }], { format: 'webp' }).get(1)).toBe('IMG_1234-quangedit.webp');
  });

  test('number collisions deterministically, ignoring case, in export order', () => {
    const entries = [
      { id: 'a', name: 'DSC0001.jpg' },
      { id: 'b', name: 'dsc0001.png' },
      { id: 'c', name: 'DSC0001.webp' },
      { id: 'd', name: 'DSC0001-quangedit-2.jpg' },
    ];
    const first = [...batchFileNames(entries, { format: 'jpeg' }).values()];
    expect(first).toEqual(['DSC0001-quangedit.jpg', 'dsc0001-quangedit-2.jpg', 'DSC0001-quangedit-3.jpg', 'DSC0001-quangedit-2-quangedit.jpg']);
    expect([...batchFileNames(entries, { format: 'jpeg' }).values()]).toEqual(first);
    expect(new Set(first.map((name) => name.toLowerCase())).size).toBe(first.length);
  });

  test('keep custom names (sanitised, with the format extension) and never produce paths', () => {
    const names = batchFileNames([
      { id: 1, name: 'a.jpg', customName: 'Holiday final' },
      { id: 2, name: 'b.jpg', customName: '../../etc/passwd' },
      { id: 3, name: 'c.jpg', customName: 'C:\\Windows\\evil.exe' },
      { id: 4, name: '..\\..\\x.jpg' },
      { id: 5, name: 'CON.jpg' },
      { id: 6, name: 'd.jpg', customName: '   ' },
    ], { format: 'png' });
    expect([...names.values()]).toEqual(['Holiday final.png', 'passwd.png', 'evil.png', 'x-quangedit.png', 'photo-quangedit.png', 'd-quangedit.png']);
    names.forEach((name) => expect(name).not.toMatch(/[\\/]|^\.|\.\./));
  });

  test('ZIP names carry the date and a part number only when split', () => {
    const date = new Date('2026-10-23T12:00:00Z');
    expect(zipFileName({ date })).toBe('photos-quangedit-2026-10-23.zip');
    expect(zipFileName({ date, part: 2, split: true })).toBe('photos-quangedit-2026-10-23-part2.zip');
  });
});

describe('ZIP archive', () => {
  const date = new Date(2026, 9, 23, 14, 30, 0);
  const collect = () => {
    const parts = [];
    return { parts, onPart: async (blob, info) => parts.push({ bytes: new Uint8Array(await blob.arrayBuffer()), ...info }) };
  };

  test('is a valid ZIP whose entries equal the inputs, byte for byte, with UTF-8 names', async () => {
    const { parts, onPart } = collect();
    const files = [['DSC09640-quangedit.jpg', bytes(70_000, 1)], ['Ảnh-quangedit.png', bytes(1, 2)], ['empty-quangedit.webp', bytes(0)]];
    const zip = createZipArchive({ onPart, date });
    for (const [name, data] of files) await zip.add(name, blobOf(data));
    expect(await zip.finish()).toBe(1);
    expect(parts).toHaveLength(1);
    const entries = readZip(parts[0].bytes);
    expect(entries.map(({ name }) => name)).toEqual(files.map(([name]) => name));
    entries.forEach((entry, index) => expect(Buffer.compare(entry.data, Buffer.from(files[index][1]))).toBe(0));
    expect(entries[0].modified).toEqual(date);
    expect(parts[0].split).toBe(false);
  });

  test('splits into complete parts when a part would pass its limit', async () => {
    const { parts, onPart } = collect();
    const zip = createZipArchive({ onPart, date, partBytes: 250_000 });
    for (let i = 0; i < 5; i += 1) await zip.add(`p${i}.jpg`, blobOf(bytes(100_000, i + 1)));
    expect(await zip.finish()).toBe(3);
    expect(parts.map(({ names }) => names)).toEqual([['p0.jpg', 'p1.jpg'], ['p2.jpg', 'p3.jpg'], ['p4.jpg']]);
    expect(parts.map(({ split }) => split)).toEqual([true, true, true]);
    parts.forEach(({ bytes: data, names }) => expect(readZip(data).map(({ name }) => name)).toEqual(names));
    // A file larger than the limit still gets a part of its own.
    const big = collect();
    const single = createZipArchive({ onPart: big.onPart, date, partBytes: 1000 });
    await single.add('big.jpg', blobOf(bytes(5000)));
    await single.finish();
    expect(readZip(big.parts[0].bytes)[0].size).toBe(5000);
  });

  test('an aborted part is never delivered; finished parts stay', async () => {
    const { parts, onPart } = collect();
    const zip = createZipArchive({ onPart, date, partBytes: 150_000 });
    await zip.add('a.jpg', blobOf(bytes(100_000)));
    await zip.add('b.jpg', blobOf(bytes(100_000)));
    zip.abort();
    await expect(zip.finish()).rejects.toMatchObject({ code: 'cancelled' });
    await expect(zip.add('c.jpg', blobOf(bytes(10)))).rejects.toMatchObject({ code: 'cancelled' });
    expect(parts.map(({ names }) => names)).toEqual([['a.jpg']]);
    expect(readZip(parts[0].bytes)).toHaveLength(1);
  });

  test('an empty batch delivers nothing', async () => {
    const { parts, onPart } = collect();
    expect(await createZipArchive({ onPart }).finish()).toBe(0);
    expect(parts).toEqual([]);
  });
});

describe('export batch', () => {
  /** Fake exports: resolve or fail on demand, counting how many run at once. */
  function fakeExports({ fail = [], hang = [] } = {}) {
    const calls = [];
    const cancelled = [];
    let running = 0;
    let peak = 0;
    const exportOne = (item, { onProgress, onCancel }) => new Promise((resolve, reject) => {
      calls.push(item.id);
      running += 1;
      peak = Math.max(peak, running);
      const end = (fn) => { running -= 1; fn(); };
      onCancel(() => { cancelled.push(item.id); end(() => reject(Object.assign(new Error('Cancelled.'), { code: 'cancelled' }))); });
      onProgress({ stage: 'rendering', fraction: 0.5 });
      if (hang.includes(item.id)) return;
      setTimeout(() => end(() => (fail.includes(item.id)
        ? reject(new Error(`${item.id} ran out of memory`))
        : resolve({ blob: blobOf(bytes(10)), width: 4, height: 3 }))), 5);
    });
    return { exportOne, calls, cancelled, peak: () => peak };
  }
  const items = (...ids) => ids.map((id) => ({ id, fileName: `${id}.jpg` }));

  test('runs one at a time by default, delivers in order and isolates failures', async () => {
    const fakes = fakeExports({ fail: ['b'] });
    const delivered = [];
    const updates = [];
    const batch = createExportBatch({ items: items('a', 'b', 'c'), exportOne: fakes.exportOne, deliver: async (item) => delivered.push(item.id), onUpdate: (id, s) => updates.push([id, s.state]) });
    const result = await batch.start();
    expect(result).toEqual({ done: ['a', 'c'], failed: ['b'], cancelled: [] });
    expect(fakes.peak()).toBe(1);
    expect(delivered).toEqual(['a', 'c']);
    expect(batch.status('b')).toEqual({ state: 'error', message: 'b ran out of memory' });
    expect(batch.status('a')).toEqual({ state: 'done', width: 4, height: 3, bytes: 10 });
    expect(updates.filter(([id]) => id === 'a').map(([, s]) => s)).toEqual(['running', 'running', 'done']);
  });

  test('never queues a photo twice; concurrency is bounded when raised', async () => {
    const fakes = fakeExports();
    const batch = createExportBatch({ items: items('a', 'a', 'b', 'c', 'd'), exportOne: fakes.exportOne, deliver: async () => {}, concurrency: 2 });
    await batch.start();
    expect(fakes.calls).toEqual(['a', 'b', 'c', 'd']);
    expect(fakes.peak()).toBe(2);
  });

  test('cancel stops the running export and everything queued; nothing is delivered after', async () => {
    const fakes = fakeExports({ hang: ['b'] });
    const delivered = [];
    const batch = createExportBatch({ items: items('a', 'b', 'c'), exportOne: fakes.exportOne, deliver: async (item) => delivered.push(item.id) });
    const started = batch.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    batch.cancel();
    expect(await started).toEqual({ done: ['a'], failed: [], cancelled: ['b', 'c'] });
    expect(fakes.cancelled).toEqual(['b']);
    expect(fakes.calls).toEqual(['a', 'b']);
    expect(delivered).toEqual(['a']);
  });

  test('a removed photo is dropped from the queue, or stopped and never delivered', async () => {
    const fakes = fakeExports({ hang: ['a'] });
    const delivered = [];
    const batch = createExportBatch({ items: items('a', 'b', 'c'), exportOne: fakes.exportOne, deliver: async (item) => delivered.push(item.id) });
    const started = batch.start();
    batch.remove('c');
    await new Promise((resolve) => setTimeout(resolve, 5));
    batch.remove('a');
    const result = await started;
    expect(result.done).toEqual(['b']);
    expect(fakes.calls).toEqual(['a', 'b']);
    expect(batch.status('a').state).toBe('removed');
    expect(delivered).toEqual(['b']);
  });

  test('a failed delivery (e.g. the ZIP) fails that item only; retry runs the failed ones again', async () => {
    const fakes = fakeExports({ fail: ['b'] });
    const batch = createExportBatch({ items: items('a', 'b', 'c'), exportOne: fakes.exportOne, deliver: async (item) => { if (item.id === 'c') throw new Error('Disk full'); } });
    const first = await batch.start();
    expect(first.failed).toEqual(['b', 'c']);
    const retried = fakeExports();
    const retry = createExportBatch({ items: batch.items.filter(({ id }) => first.failed.includes(id)), exportOne: retried.exportOne, deliver: async () => {} });
    expect((await retry.start()).done).toEqual(['b', 'c']);
  });

  test('cancelling one queued item skips it and the rest run', async () => {
    const fakes = fakeExports();
    const batch = createExportBatch({ items: items('a', 'b', 'c'), exportOne: fakes.exportOne, deliver: async () => {} });
    batch.cancelItem('b');
    expect(await batch.start()).toEqual({ done: ['a', 'c'], failed: [], cancelled: ['b'] });
  });
});
