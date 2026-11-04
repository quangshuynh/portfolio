import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ensureMediumDerivatives, MEDIUM_DERIVATIVE, needsMedium } from './photography-responsive.mjs';

let work;
const viewer = (name, width, height, shade = 120) => sharp({ create: { width, height, channels: 3, background: { r: shade, g: 90, b: 60 } } })
  .jpeg({ quality: 88 }).toBuffer().then((bytes) => writeFile(path.join(work, 'derivatives', name), bytes));

beforeEach(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'medium-'));
  await mkdir(path.join(work, 'derivatives'));
});
afterEach(() => rm(work, { recursive: true, force: true }));

test('only viewer files well above 1600 px get a medium derivative', () => {
  expect(needsMedium({ viewerWidth: 2200, viewerHeight: 1467 })).toBe(true);
  expect(needsMedium({ viewerWidth: 1192, viewerHeight: 1800 })).toBe(false);
  expect(needsMedium({ viewerWidth: 1700, viewerHeight: 1000 })).toBe(false);
});

test('medium derivatives are resized from the viewer file, cached by content and invalidated on change', async () => {
  await viewer('a-viewer.jpg', 2200, 1467);
  await viewer('b-viewer.jpg', 1192, 1800);
  const records = [
    { id: 'a', viewerFilename: 'a-viewer.jpg', viewerWidth: 2200, viewerHeight: 1467 },
    { id: 'b', viewerFilename: 'b-viewer.jpg', viewerWidth: 1192, viewerHeight: 1800 },
  ];
  const cache = path.join(work, 'cache');
  const first = await ensureMediumDerivatives(records, path.join(work, 'derivatives'), cache);
  expect([...first.keys()]).toEqual(['a']);
  expect(first.get('a')).toMatchObject({ width: MEDIUM_DERIVATIVE.width, height: 1067 });
  const { mtimeMs } = await stat(first.get('a').file);

  // Unchanged viewer file: the cached file is reused, not re-encoded.
  const second = await ensureMediumDerivatives(records, path.join(work, 'derivatives'), cache);
  expect(second.get('a').file).toBe(first.get('a').file);
  expect((await stat(second.get('a').file)).mtimeMs).toBe(mtimeMs);

  // A new treatment of the photograph: a new file, and the stale one is removed.
  await viewer('a-viewer.jpg', 2200, 1467, 200);
  const third = await ensureMediumDerivatives(records, path.join(work, 'derivatives'), cache);
  expect(third.get('a').file).not.toBe(first.get('a').file);
  expect(await readdir(cache)).toEqual([path.basename(third.get('a').file)]);

  // An unpublished photograph's cached file is removed too.
  await ensureMediumDerivatives([], path.join(work, 'derivatives'), cache);
  expect(await readdir(cache)).toEqual([]);
});
