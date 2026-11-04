// Pixels of CMS images for the watermark previews and placement check (browser only).

/** The full-size frame the mark is laid out for: the photo's proportions at a 6000 px long edge (originals are not read here). */
export const nominalFrame = (width, height) => {
  const k = 6000 / Math.max(width, height);
  return { width: Math.round(width * k), height: Math.round(height * k) };
};

// Decoded gallery pixels, reused while the dashboard is open: the Watermark view re-reads every
// photograph on each settings change and placement pass. In memory only (never Cache Storage or
// IndexedDB), keyed by the versioned URL so a changed image is read again, bounded by bytes and
// emptied on sign-out or an expired session (clearPixelCache).
const PIXEL_CACHE_BYTES = 96 * 1024 * 1024;
const pixelCache = new Map(); // url -> Promise<ImageData>, least recently used first
const cachedBytes = new Map(); // url -> bytes, once decoded

function evict() {
  let total = [...cachedBytes.values()].reduce((sum, bytes) => sum + bytes, 0);
  for (const url of pixelCache.keys()) {
    if (total <= PIXEL_CACHE_BYTES) break;
    if (!cachedBytes.has(url)) continue; // still decoding
    total -= cachedBytes.get(url);
    pixelCache.delete(url);
    cachedBytes.delete(url);
  }
}

export function clearPixelCache() {
  pixelCache.clear();
  cachedBytes.clear();
}

export const pixelCacheStats = { hits: 0, misses: 0 };

/** The image's pixels (shared: callers only read them). */
export function loadPixels(url) {
  const cached = pixelCache.get(url);
  if (cached) {
    pixelCacheStats.hits += 1;
    pixelCache.delete(url);
    pixelCache.set(url, cached);
    return cached;
  }
  pixelCacheStats.misses += 1;
  const pending = decodePixels(url).then((pixels) => {
    if (pixelCache.get(url) === pending) {
      cachedBytes.set(url, pixels.data.byteLength);
      evict();
    }
    return pixels;
  }, (error) => {
    if (pixelCache.get(url) === pending) pixelCache.delete(url);
    throw error;
  });
  pixelCache.set(url, pending);
  return pending;
}

function decodePixels(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = Object.assign(document.createElement('canvas'), { width: image.naturalWidth, height: image.naturalHeight });
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      resolve(context.getImageData(0, 0, canvas.width, canvas.height));
    };
    image.onerror = () => reject(new Error('The gallery image could not be read.'));
    image.src = url;
  });
}
