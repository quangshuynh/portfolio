// The in-memory pixel cache of CMS gallery images: reuse by versioned URL, invalidation by a
// new version, clearing on sign-out, no caching of failures, and a byte bound.
import { clearPixelCache, loadPixels, pixelCacheStats } from './watermarkImages.js';

let decoded;
beforeEach(() => {
  clearPixelCache();
  decoded = [];
  vi.stubGlobal('Image', class {
    set src(url) {
      decoded.push(url);
      queueMicrotask(() => (url.includes('broken') ? this.onerror() : this.onload()));
    }
    get naturalWidth() { return decoded.at(-1).includes('large') ? 4000 : 10; }
    get naturalHeight() { return decoded.at(-1).includes('large') ? 3000 : 10; }
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function context() {
    const { width, height } = this;
    return { drawImage() {}, getImageData: () => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }) };
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test('the same versioned URL is decoded once; a new version or a sign-out reads it again', async () => {
  const first = await loadPixels('/api/images/a-gallery.jpg?v=1');
  expect(await loadPixels('/api/images/a-gallery.jpg?v=1')).toBe(first);
  expect(decoded).toEqual(['/api/images/a-gallery.jpg?v=1']);
  // Concurrent readers share one decode.
  await Promise.all([loadPixels('/api/images/b-gallery.jpg?v=1'), loadPixels('/api/images/b-gallery.jpg?v=1')]);
  expect(decoded.filter((url) => url.startsWith('/api/images/b-'))).toHaveLength(1);
  // The image changed on the server: a new token, a new read.
  await loadPixels('/api/images/a-gallery.jpg?v=2');
  expect(decoded.at(-1)).toBe('/api/images/a-gallery.jpg?v=2');
  clearPixelCache();
  await loadPixels('/api/images/a-gallery.jpg?v=2');
  expect(decoded.filter((url) => url === '/api/images/a-gallery.jpg?v=2')).toHaveLength(2);
  expect(pixelCacheStats.hits).toBeGreaterThan(0);
});

test('failures are not cached and the cache stays within its byte bound', async () => {
  await expect(loadPixels('/api/images/broken-gallery.jpg')).rejects.toThrow();
  await expect(loadPixels('/api/images/broken-gallery.jpg')).rejects.toThrow();
  expect(decoded.filter((url) => url.includes('broken'))).toHaveLength(2);
  // 48 MB each: the oldest is dropped once the bound (96 MB) is exceeded.
  for (const name of ['large-1', 'large-2', 'large-3']) await loadPixels(`/api/images/${name}.jpg`);
  await loadPixels('/api/images/large-3.jpg');
  await loadPixels('/api/images/large-1.jpg');
  expect(decoded.filter((url) => url.includes('large-1'))).toHaveLength(2);
  expect(decoded.filter((url) => url.includes('large-3'))).toHaveLength(1);
});
