// @vitest-environment node
import sharp from 'sharp';
import { ImageHeaderError, readImageHeader, sniffFormat } from './imageHeader.mjs';
import { LIMITS, checkDimensions, exportDimensions, exportFileName, proxyDimensions, safeBaseName, safeSuffix } from './files.mjs';

const solid = (width, height) => sharp({ create: { width, height, channels: 3, background: { r: 200, g: 100, b: 50 } } });
const bytes = async (pipeline) => new Uint8Array(await pipeline.toBuffer());

describe('image headers', () => {
  test.each([
    ['jpeg', (p) => p.jpeg()],
    ['png', (p) => p.png()],
    ['webp', (p) => p.webp()],
    ['webp', (p) => p.webp({ lossless: true })],
  ])('reads %s format and size from real encoder output', async (format, encode) => {
    const header = readImageHeader(await bytes(encode(solid(321, 123))));
    expect(header).toMatchObject({ format, width: 321, height: 123, orientation: 1, displayWidth: 321, displayHeight: 123 });
  });

  test('reads extended WebP (VP8X) with alpha', async () => {
    const data = await bytes(sharp({ create: { width: 64, height: 32, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } }).webp());
    expect(readImageHeader(data)).toMatchObject({ format: 'webp', width: 64, height: 32 });
  });

  test.each([3, 6, 8])('reads EXIF orientation %i and swaps display size for rotations', async (orientation) => {
    const header = readImageHeader(await bytes(solid(300, 200).jpeg().withMetadata({ orientation })));
    expect(header.orientation).toBe(orientation);
    expect([header.displayWidth, header.displayHeight]).toEqual(orientation >= 5 ? [200, 300] : [300, 200]);
  });

  test('reads EXIF orientation from WebP and PNG', async () => {
    expect(readImageHeader(await bytes(solid(30, 20).webp().withMetadata({ orientation: 6 }))).orientation).toBe(6);
    expect(readImageHeader(await bytes(solid(30, 20).png().withMetadata({ orientation: 8 }))).orientation).toBe(8);
  });

  test('rejects unsupported formats by content, not name', async () => {
    const gif = await bytes(solid(4, 4).gif());
    expect(sniffFormat(gif)).toBeNull();
    expect(() => readImageHeader(gif)).toThrow(expect.objectContaining({ code: 'unsupported' }));
    expect(() => readImageHeader(new TextEncoder().encode('%PDF-1.7 not an image'))).toThrow(ImageHeaderError);
    expect(() => readImageHeader(new Uint8Array(0))).toThrow(expect.objectContaining({ code: 'unsupported' }));
  });

  test('rejects truncated and damaged files as corrupt', async () => {
    const jpeg = await bytes(solid(50, 50).jpeg());
    expect(() => readImageHeader(jpeg.slice(0, 20))).toThrow(expect.objectContaining({ code: 'corrupt' }));
    const garbage = jpeg.slice();
    garbage.fill(0x00, 3, 400);
    expect(() => readImageHeader(garbage)).toThrow(expect.objectContaining({ code: 'corrupt' }));
    const png = await bytes(solid(50, 50).png());
    expect(() => readImageHeader(png.slice(0, 16))).toThrow(expect.objectContaining({ code: 'corrupt' }));
    const webp = await bytes(solid(50, 50).webp());
    expect(() => readImageHeader(webp.slice(0, 16))).toThrow(expect.objectContaining({ code: 'corrupt' }));
  });

  test('reports a decompression bomb from its header alone', () => {
    // A 1×1 PNG header rewritten to claim 20000×20000.
    const header = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x4e, 0x20, 0, 0, 0x4e, 0x20, 8, 6, 0, 0, 0]);
    const parsed = readImageHeader(header);
    expect(parsed).toMatchObject({ width: 20000, height: 20000 });
    expect(checkDimensions(parsed)).toMatch(/16,384 px/);
    expect(checkDimensions({ displayWidth: 12000, displayHeight: 9000 })).toMatch(/MP/);
    expect(checkDimensions({ displayWidth: 6000, displayHeight: 4000 })).toBeNull();
    expect(LIMITS.maxPixels).toBeGreaterThanOrEqual(61_000_000);
  });
});

describe('filenames', () => {
  test.each([
    ['DSC09546.JPG', 'DSC09546'],
    ['../../etc/passwd.png', 'passwd'],
    ['C:\\Users\\me\\holiday photo.webp', 'holiday photo'],
    ['a<b>c:d"e|f?g*h.jpg', 'a-b-c-d-e-f-g-h'],
    ['  ..hidden.jpg', 'hidden'],
    ['CON.jpg', 'photo'],
    ['nul', 'photo'],
    ['', 'photo'],
    ['\u0000\u001f.jpg', 'photo'],
    ['x'.repeat(300), 'x'.repeat(100)],
  ])('safeBaseName(%j) = %j', (input, expected) => {
    expect(safeBaseName(input)).toBe(expected);
  });

  test('builds export names from format and a cleaned suffix', () => {
    expect(exportFileName('IMG_1.HEIC.jpg', 'webp', '-edited')).toBe('IMG_1.HEIC-edited.webp');
    expect(exportFileName('sunset.png', 'jpeg', '-edited')).toBe('sunset-edited.jpg');
    expect(exportFileName('sunset.png', 'png', '/../x y')).toBe('sunsetxy.png');
    expect(safeSuffix('...v2')).toBe('v2');
    expect(() => exportFileName('a.jpg', 'gif')).toThrow();
  });
});

describe('export and preview sizing', () => {
  const source = { width: 6000, height: 4000 };

  test('original resolution is the default and never changes size', () => {
    expect(exportDimensions(source)).toEqual({ width: 6000, height: 4000, scaled: false });
  });

  test('long edge and fit modes keep the aspect ratio', () => {
    expect(exportDimensions(source, { mode: 'long-edge', longEdge: 3000 })).toEqual({ width: 3000, height: 2000, scaled: true });
    expect(exportDimensions({ width: 4000, height: 6000 }, { mode: 'long-edge', longEdge: 1500 })).toEqual({ width: 1000, height: 1500, scaled: true });
    expect(exportDimensions(source, { mode: 'fit', maxWidth: 1000, maxHeight: 1000 })).toEqual({ width: 1000, height: 667, scaled: true });
  });

  test('never upscales', () => {
    expect(exportDimensions(source, { mode: 'long-edge', longEdge: 10000 })).toEqual({ ...source, scaled: false });
    expect(exportDimensions(source, { mode: 'fit', maxWidth: 9000, maxHeight: 9000 })).toEqual({ ...source, scaled: false });
    expect(proxyDimensions({ width: 800, height: 600 }, 2048)).toEqual({ width: 800, height: 600, scaled: false });
  });
});
