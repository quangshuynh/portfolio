// @vitest-environment node
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { baseCatalog, photograph } from '../test-helpers.mjs';
import { MAX_UPLOAD_BYTES, ingestUpload, safeSourceFilename, sniffImageType } from './uploads.mjs';
import { cleanInterruptedUploads, initWorkspace, paths, readWorkspace } from './workspace.mjs';

let dir;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

beforeEach(async () => {
  dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'cms-uploads-')), 'workspace');
  await initWorkspace(dir, { baseRef: 'main', baseCommit: 'abc', baseCatalog: baseCatalog() });
});
afterEach(() => rmSync(path.dirname(dir), { recursive: true, force: true }));

describe('validation', () => {
  test('identifies formats by content, not by name', async () => {
    expect(sniffImageType(await photograph())).toBe('jpeg');
    expect(sniffImageType(await photograph({ format: 'png' }))).toBe('png');
    expect(sniffImageType(await photograph({ format: 'webp' }))).toBe('webp');
    expect(sniffImageType(Buffer.from('GIF89a......'))).toBeNull();
    expect(sniffImageType(Buffer.from('II*\0 raw file'))).toBeNull();
  });

  test('rejects unsupported, empty, malformed and oversized files', async () => {
    const catalog = baseCatalog();
    await expect(ingestUpload(dir, { filename: 'a.jpg', bytes: Buffer.from('not an image at all') }, catalog)).rejects.toMatchObject({ code: 'unsupported', status: 415 });
    await expect(ingestUpload(dir, { filename: 'a.jpg', bytes: Buffer.alloc(0) }, catalog)).rejects.toMatchObject({ code: 'empty' });
    const truncated = (await photograph()).subarray(0, 600);
    await expect(ingestUpload(dir, { filename: 'a.jpg', bytes: truncated }, catalog)).rejects.toMatchObject({ code: 'unreadable' });
    const huge = Buffer.alloc(MAX_UPLOAD_BYTES + 1);
    huge.set([0xff, 0xd8, 0xff]);
    await expect(ingestUpload(dir, { filename: 'a.jpg', bytes: huge }, catalog)).rejects.toMatchObject({ code: 'too-large', status: 413 });
    expect(readdirSync(paths(dir).originals)).toEqual([]);
  });

  test('safe file names keep only safe characters and a matching extension', () => {
    expect(safeSourceFilename('..\\..\\Windows\\DSC 001 (copy).JPG', 'jpeg')).toBe('DSC-001-copy.JPG');
    expect(safeSourceFilename('../../etc/passwd', 'png')).toBe('passwd.png');
    expect(safeSourceFilename('photo.webp.exe', 'webp')).toBe('photo-webp.webp');
    expect(safeSourceFilename('', 'jpeg')).toBe('photograph.jpg');
  });
});

describe('ingest', () => {
  test('stores the original privately, generates public-pipeline derivatives and describes a draft', async () => {
    const bytes = await photograph({ width: 1200, height: 1800 });
    const result = await ingestUpload(dir, { filename: 'DSC09999.JPG', bytes }, baseCatalog());
    expect(result).toMatchObject({
      duplicate: false,
      record: { id: 'DSC09999', slug: 'DSC09999', status: 'draft', sourceFilename: 'DSC09999.JPG', caption: '', alt: '', shape: 'portrait', category: 'Places' },
    });
    const p = paths(dir);
    expect(sha(readFileSync(path.join(p.originals, 'DSC09999.JPG')))).toBe(sha(bytes));
    expect(readdirSync(p.previewDir).sort()).toEqual(['DSC09999-gallery.jpg', 'DSC09999-viewer.jpg']);
    const viewer = await sharp(path.join(p.previewDir, 'DSC09999-viewer.jpg')).metadata();
    expect([viewer.width, viewer.height]).toEqual([1200, 1800]);
    expect(viewer.exif).toBeUndefined();
    const workspace = await readWorkspace(dir);
    expect(workspace.previewManifest.map(({ id }) => id)).toEqual(['DSC09999']);
    expect(workspace.originals[sha(bytes)]).toMatchObject({ id: 'DSC09999', sourceFilename: 'DSC09999.JPG' });
  }, 60_000);

  test('the same file again is a duplicate, and a different file with the same name never overwrites', async () => {
    const first = await photograph();
    const { record } = await ingestUpload(dir, { filename: 'beta.JPG', bytes: first }, baseCatalog());
    // "beta.JPG" is already a catalog source, so the upload takes the hash-suffixed name.
    expect(record.sourceFilename).toBe(`beta--${sha(first).slice(0, 8)}.JPG`);
    expect(record.id).toBe('beta-2');
    const catalog = { ...baseCatalog(), photographs: [...baseCatalog().photographs, record] };
    expect(await ingestUpload(dir, { filename: 'renamed.jpg', bytes: first }, catalog)).toMatchObject({ duplicate: true, id: 'beta-2' });

    const second = await photograph({ color: { r: 200, g: 40, b: 40 } });
    const other = await ingestUpload(dir, { filename: 'beta.JPG', bytes: second }, catalog);
    expect(other.record.sourceFilename).toBe(`beta--${sha(second).slice(0, 8)}.JPG`);
    expect(sha(readFileSync(path.join(paths(dir).originals, record.sourceFilename)))).toBe(sha(first));
  }, 60_000);

  test('a retry after a failed attempt reuses the stored original instead of duplicating it', async () => {
    const bytes = await photograph();
    const p = paths(dir);
    // Simulate an attempt that stored the original but crashed before indexing it.
    writeFileSync(path.join(p.originals, 'retry.jpg'), bytes);
    const result = await ingestUpload(dir, { filename: 'retry.jpg', bytes }, baseCatalog());
    expect(result.record.sourceFilename).toBe('retry.jpg');
    expect(readdirSync(p.originals)).toEqual(['retry.jpg']);
  }, 60_000);

  test('interrupted temporary files are removed on start-up', async () => {
    const p = paths(dir);
    writeFileSync(path.join(p.originals, '.incoming-abc123'), 'partial');
    expect(await cleanInterruptedUploads(dir)).toEqual(['.incoming-abc123']);
    expect(existsSync(path.join(p.originals, '.incoming-abc123'))).toBe(false);
  });
});
