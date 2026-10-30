// Reads the format, pixel dimensions and EXIF orientation from the first bytes of a
// file, before anything is decoded, so oversized or mislabelled files are rejected
// without allocating their pixels. Never trusts the file extension or MIME type.

import { RAW_SUPPORT, unsupportedRawLabel } from '../raw/rawFormat.mjs';

export const FORMATS = Object.freeze({
  jpeg: { label: 'JPEG', mime: 'image/jpeg', extension: 'jpg' },
  png: { label: 'PNG', mime: 'image/png', extension: 'png' },
  webp: { label: 'WebP', mime: 'image/webp', extension: 'webp' },
});

export class ImageHeaderError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const ascii = (bytes, start, length) => String.fromCharCode(...bytes.subarray(start, start + length));

/** Identifies JPEG, PNG or WebP by magic bytes; returns null otherwise. */
export function sniffFormat(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, i) => bytes[i] === value)) return 'png';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
  return null;
}

/** EXIF orientation (1–8) from a TIFF block, or 1 when absent or malformed. */
export function readTiffOrientation(view, tiffStart) {
  if (tiffStart + 8 > view.byteLength) return 1;
  const order = view.getUint16(tiffStart);
  if (order !== 0x4949 && order !== 0x4d4d) return 1;
  const little = order === 0x4949;
  const ifd = tiffStart + view.getUint32(tiffStart + 4, little);
  if (ifd + 2 > view.byteLength) return 1;
  const count = view.getUint16(ifd, little);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > view.byteLength) return 1;
    if (view.getUint16(entry, little) === 0x0112) {
      const value = view.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

function parseJpeg(bytes, view) {
  let offset = 2;
  let orientation = 1;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) throw new ImageHeaderError('corrupt', 'The JPEG structure is damaged.');
    const marker = bytes[offset + 1];
    if (marker === 0xff) { offset += 1; continue; }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { offset += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) break;
    const length = view.getUint16(offset + 2);
    if (length < 2) throw new ImageHeaderError('corrupt', 'The JPEG structure is damaged.');
    if (marker === 0xe1 && offset + 10 <= bytes.length && ascii(bytes, offset + 4, 6) === 'Exif\0\0') {
      orientation = readTiffOrientation(view, offset + 10);
    }
    // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (offset + 9 > bytes.length) break;
      return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5), orientation };
    }
    offset += 2 + length;
  }
  throw new ImageHeaderError('corrupt', 'The JPEG header is damaged or incomplete.');
}

function parsePng(bytes, view) {
  if (bytes.length < 24 || ascii(bytes, 12, 4) !== 'IHDR') throw new ImageHeaderError('corrupt', 'The PNG header is damaged.');
  let orientation = 1;
  // eXIf chunks are rare and may come after IHDR; scan what was read.
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = ascii(bytes, offset + 4, 4);
    if (type === 'eXIf') orientation = readTiffOrientation(view, offset + 8);
    if (type === 'IDAT' || type === 'IEND') break;
    offset += 12 + length;
  }
  return { width: view.getUint32(16), height: view.getUint32(20), orientation };
}

function parseWebp(bytes, view) {
  let offset = 12;
  let size = null;
  let orientation = 1;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const length = view.getUint32(offset + 4, true);
    const data = offset + 8;
    if (type === 'VP8X' && data + 10 <= bytes.length) {
      const read24 = (at) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
      size = { width: read24(data + 4) + 1, height: read24(data + 7) + 1 };
    } else if (type === 'VP8 ' && !size && data + 10 <= bytes.length) {
      if (bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) {
        throw new ImageHeaderError('corrupt', 'The WebP image data is damaged.');
      }
      size = { width: view.getUint16(data + 6, true) & 0x3fff, height: view.getUint16(data + 8, true) & 0x3fff };
    } else if (type === 'VP8L' && !size && data + 5 <= bytes.length) {
      if (bytes[data] !== 0x2f) throw new ImageHeaderError('corrupt', 'The WebP image data is damaged.');
      const bits = view.getUint32(data + 1, true);
      size = { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    } else if (type === 'EXIF') {
      const exif = ascii(bytes, data, 6) === 'Exif\0\0' ? data + 6 : data;
      orientation = readTiffOrientation(view, exif);
    }
    offset = data + length + (length % 2);
  }
  if (!size) throw new ImageHeaderError('corrupt', 'No image size was found in the WebP header.');
  return { ...size, orientation };
}

/**
 * :param bytes: Uint8Array holding at least the file's header (the first 512 KB is plenty)
 * :returns: { format, width, height, orientation, displayWidth, displayHeight }
 */
export function readImageHeader(bytes) {
  const format = sniffFormat(bytes);
  if (!format) {
    const raw = unsupportedRawLabel(bytes);
    throw new ImageHeaderError('unsupported', raw
      ? `${raw} files are not supported yet. Only JPEG, PNG, WebP and RAW (${RAW_SUPPORT}) files are supported.`
      : `Only JPEG, PNG, WebP and RAW (${RAW_SUPPORT}) files are supported.`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let header;
  try {
    header = { jpeg: parseJpeg, png: parsePng, webp: parseWebp }[format](bytes, view);
  } catch (error) {
    if (error instanceof ImageHeaderError) throw error;
    throw new ImageHeaderError('corrupt', 'The image header could not be read.');
  }
  if (!header.width || !header.height) throw new ImageHeaderError('corrupt', 'The image reports a size of zero.');
  // Orientations 5–8 rotate by 90°, swapping the displayed width and height.
  const swap = header.orientation >= 5;
  return {
    format,
    ...header,
    displayWidth: swap ? header.height : header.width,
    displayHeight: swap ? header.width : header.height,
  };
}
