// Import limits, filename hygiene and export sizing. Pure functions, unit tested.

import { FORMATS } from './imageHeader.mjs';

export const LIMITS = Object.freeze({
  maxFileBytes: 200 * 1024 * 1024,
  maxPixels: 100_000_000,
  maxSide: 16_384,
  maxPhotos: 50,
});

// Windows reserves these names regardless of extension.
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/**
 * Safe base name (no extension) for downloads: no path parts, control or reserved
 * characters, leading/trailing dots or spaces, or reserved device names.
 */
export function safeBaseName(name, fallback = 'photo') {
  const leaf = String(name ?? '').split(/[\\/]/).pop();
  const withoutExtension = leaf.replace(/\.[^.]{1,5}$/, '');
  const cleaned = withoutExtension
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-{2,}/g, '-')
    .replace(/^[\s.-]+|[\s.]+$/g, '')
    .slice(0, 100)
    .trim();
  if (!cleaned || RESERVED.test(cleaned)) return fallback;
  return cleaned;
}

/** Suffix limited to letters, digits, dash, underscore and dot, at most 40 characters. */
export function safeSuffix(suffix) {
  return String(suffix ?? '').replace(/[^\w.-]+/g, '').replace(/^\.+/, '').slice(0, 40);
}

/** Download filename for an export. */
export function exportFileName(sourceName, format, suffix = '') {
  const extension = FORMATS[format]?.extension;
  if (!extension) throw new Error(`Unsupported export format: ${format}`);
  return `${safeBaseName(sourceName)}${safeSuffix(suffix)}.${extension}`;
}

/** User-facing message when a header's size breaks the decode limits, else null. */
export function checkDimensions({ displayWidth: width, displayHeight: height }) {
  if (width > LIMITS.maxSide || height > LIMITS.maxSide) {
    return `${width}×${height} px is larger than the ${LIMITS.maxSide.toLocaleString('en-US')} px per side this editor can decode.`;
  }
  if (width * height > LIMITS.maxPixels) {
    return `${Math.round((width * height) / 1e6)} MP is above the ${LIMITS.maxPixels / 1e6} MP limit.`;
  }
  return null;
}

/**
 * Output size for an export. Never upscales; keeps the aspect ratio.
 * :param source: { width, height } of the oriented original
 * :param resize: { mode: 'original' | 'long-edge' | 'fit', longEdge, maxWidth, maxHeight }
 * :returns: { width, height, scaled }
 */
export function exportDimensions({ width, height }, resize = { mode: 'original' }) {
  let scale = 1;
  if (resize.mode === 'long-edge' && resize.longEdge > 0) {
    scale = Math.min(1, resize.longEdge / Math.max(width, height));
  } else if (resize.mode === 'fit') {
    const sx = resize.maxWidth > 0 ? resize.maxWidth / width : 1;
    const sy = resize.maxHeight > 0 ? resize.maxHeight / height : 1;
    scale = Math.min(1, sx, sy);
  }
  if (scale >= 1) return { width, height, scaled: false };
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scaled: true,
  };
}

/** Preview proxy size: the long edge capped at `maxEdge`, never upscaled. */
export function proxyDimensions({ width, height }, maxEdge) {
  return exportDimensions({ width, height }, { mode: 'long-edge', longEdge: maxEdge });
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
