// Browser decoding, shared by the image worker and the export worker so the preview
// proxy and the export start from identical pixels: createImageBitmap (EXIF
// orientation applied, alpha not premultiplied, embedded colour profile converted
// to sRGB by the browser) drawn into an sRGB 2D canvas and read back as RGBA8.

import { ImageHeaderError, readImageHeader } from './imageHeader.mjs';
import { LIMITS, checkDimensions } from './files.mjs';

// 2×1 JPEG tagged with EXIF orientation 6: decodes as 1×2 when the browser rotates it.
const ORIENTATION_PROBE = '/9j/4QC8RXhpZgAASUkqAAgAAAAGABIBAwABAAAABgAAABoBBQABAAAAVgAAABsBBQABAAAAXgAAACgBAwABAAAAAgAAABMCAwABAAAAAQAAAGmHBAABAAAAZgAAAAAAAAA4YwAA6AMAADhjAADoAwAABgAAkAcABAAAADAyMTABkQcABAAAAAECAwAAoAcABAAAADAxMDABoAMAAQAAAP//AAACoAQAAQAAAAIAAAADoAQAAQAAAAEAAAAAAAAA/+IB8ElDQ19QUk9GSUxFAAEBAAAB4GxjbXMEIAAAbW50clJHQiBYWVogB+IAAwAUAAkADgAdYWNzcE1TRlQAAAAAc2F3c2N0cmwAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1oYW5keem/Vlo+AbaDI4VVRvdPqgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKZGVzYwAAAPwAAAAkY3BydAAAASAAAAAid3RwdAAAAUQAAAAUY2hhZAAAAVgAAAAsclhZWgAAAYQAAAAUZ1hZWgAAAZgAAAAUYlhZWgAAAawAAAAUclRSQwAAAcAAAAAgZ1RSQwAAAcAAAAAgYlRSQwAAAcAAAAAgbWx1YwAAAAAAAAABAAAADGVuVVMAAAAIAAAAHABzAFIARwBCbWx1YwAAAAAAAAABAAAADGVuVVMAAAAGAAAAHABDAEMAMAAAWFlaIAAAAAAAAPbWAAEAAAAA0y1zZjMyAAAAAAABDD8AAAXd///zJgAAB5AAAP2S///7of///aIAAAPcAADAcVhZWiAAAAAAAABvoAAAOPIAAAOPWFlaIAAAAAAAAGKWAAC3iQAAGNpYWVogAAAAAAAAJKAAAA+FAAC2xHBhcmEAAAAAAAMAAAACZmkAAPKnAAANWQAAE9AAAApb/9sAQwAQCwwODAoQDg0OEhEQExgoGhgWFhgxIyUdKDozPTw5Mzg3QEhcTkBEV0U3OFBtUVdfYmdoZz5NcXlwZHhcZWdj/9sAQwEREhIYFRgvGhovY0I4QmNjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2Nj/8AAEQgAAQACAwEiAAIRAQMRAf/EABQAAQAAAAAAAAAAAAAAAAAAAAD/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AAAP/9k=';

let browserOrients;

/** Whether createImageBitmap applies EXIF orientation here (checked once). */
export async function browserAppliesOrientation() {
  if (browserOrients === undefined) {
    try {
      const bytes = Uint8Array.from(atob(ORIENTATION_PROBE), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }), { imageOrientation: 'from-image' });
      browserOrients = bitmap.width === 1 && bitmap.height === 2;
      bitmap.close();
    } catch {
      browserOrients = false;
    }
  }
  return browserOrients;
}

// EXIF orientation -> canvas transform from stored to displayed pixels; width and
// height are the displayed size.
function orientationTransform(context, orientation, width, height) {
  switch (orientation) {
    case 2: context.transform(-1, 0, 0, 1, width, 0); break;
    case 3: context.transform(-1, 0, 0, -1, width, height); break;
    case 4: context.transform(1, 0, 0, -1, 0, height); break;
    case 5: context.transform(0, 1, 1, 0, 0, 0); break;
    case 6: context.transform(0, 1, -1, 0, width, 0); break;
    case 7: context.transform(0, -1, -1, 0, width, height); break;
    case 8: context.transform(0, -1, 1, 0, 0, height); break;
    default: break;
  }
}

/** Reads, validates and hashes a file. Throws ImageHeaderError with user-facing text. */
export async function inspectFile(file) {
  if (file.size > LIMITS.maxFileBytes) {
    throw new ImageHeaderError('too-large', `The file is larger than ${LIMITS.maxFileBytes / (1024 * 1024)} MB.`);
  }
  if (file.size === 0) throw new ImageHeaderError('corrupt', 'The file is empty.');
  const buffer = await file.arrayBuffer();
  const header = readImageHeader(new Uint8Array(buffer));
  const sizeProblem = checkDimensions(header);
  if (sizeProblem) throw new ImageHeaderError('too-large', sizeProblem);
  let sha256 = null;
  if (globalThis.crypto?.subtle) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
    sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return { header, sha256 };
}

/**
 * A 2D canvas: OffscreenCanvas where it exists (workers, modern browsers), else a
 * DOM canvas, which only exists on the main thread (the no-worker fallback).
 */
export function createCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') return Object.assign(document.createElement('canvas'), { width, height });
  throw Object.assign(new Error('This browser cannot process images in a background worker.'), { code: 'worker-canvas' });
}

// Browsers cap canvas area (iOS Safari at about 16.7 MP) and fail silently above it:
// the context is null or drawing does nothing. Checked with one pixel at the far corner,
// loosely: anti-fingerprinting (Safari, Brave) may add small noise to readback.
function assertCanvasWorks(context, width, height) {
  if (context) {
    context.fillStyle = '#ff00ff';
    context.fillRect(width - 1, height - 1, 1, 1);
    const [r, g, b] = context.getImageData(width - 1, height - 1, 1, 1).data;
    context.clearRect(width - 1, height - 1, 1, 1);
    if (r > 200 && g < 55 && b > 200) return;
  }
  throw Object.assign(
    new Error(`This browser cannot hold a ${width}×${height} image (${Math.round((width * height) / 1e6)} MP) in memory. Choose a smaller export size.`),
    { code: 'canvas-limit' },
  );
}

/** Encodes a canvas: convertToBlob on OffscreenCanvas, toBlob on a DOM canvas. */
export function encodeCanvas(canvas, type, quality) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type, ...(quality === undefined ? {} : { quality }) });
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The image could not be encoded.'))), type, quality));
}

/**
 * Decodes a file into a 2D canvas at the given displayed (oriented) size.
 * :param header: readImageHeader() result
 * :param size: { width, height } at most the displayed size
 * :returns: { canvas, context } with the pixels drawn; read them back in bands to bound memory
 */
export async function decodeToCanvas(file, header, { width, height }) {
  const orients = await browserAppliesOrientation();
  const manual = !orients && header.orientation !== 1;
  const swap = manual && header.orientation >= 5;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, {
      ...(orients ? { imageOrientation: 'from-image' } : {}),
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'default',
      resizeWidth: swap ? height : width,
      resizeHeight: swap ? width : height,
      resizeQuality: 'high',
    });
  } catch {
    throw new ImageHeaderError('corrupt', 'The browser could not decode this image. It may be damaged or use an unsupported variant.');
  }
  try {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    assertCanvasWorks(context, width, height);
    if (manual) orientationTransform(context, header.orientation, width, height);
    // Explicit size: browsers that ignore the resize options still scale, never crop.
    context.drawImage(bitmap, 0, 0, swap ? height : width, swap ? width : height);
    context.setTransform(1, 0, 0, 1, 0, 0);
    return { canvas, context };
  } finally {
    bitmap.close();
  }
}

/**
 * Decodes a file to RGBA8 at the given displayed (oriented) size.
 * :returns: { width, height, data: Uint8ClampedArray }
 */
export async function decodeToRgba(file, header, size) {
  const { context } = await decodeToCanvas(file, header, size);
  const { data } = context.getImageData(0, 0, size.width, size.height, { colorSpace: 'srgb' });
  return { width: size.width, height: size.height, data };
}
