// Identifies supported RAW files from their content, never the file name: a TIFF
// structure whose first IFD carries a DNGVersion tag (DNG) or the maker "SONY" (ARW).
// Everything is bounds-checked; a damaged header is reported, not trusted.

export const RAW_FORMATS = Object.freeze({
  arw: { label: 'Sony ARW' },
  dng: { label: 'DNG' },
});

/** Bytes read from the start of a file to identify it (IFD0 and its strings sit near the start). */
export const RAW_SNIFF_BYTES = 256 * 1024;

const TAG_MAKE = 0x010f;
const TAG_DNG_VERSION = 0xc612;

const ascii = (bytes, start, length) => String.fromCharCode(...bytes.subarray(start, start + length));

/** True when the bytes start with a TIFF header (little- or big-endian). */
export function isTiff(bytes) {
  if (bytes.length < 8) return false;
  const order = ascii(bytes, 0, 2);
  if (order === 'II') return bytes[2] === 42 && bytes[3] === 0;
  if (order === 'MM') return bytes[2] === 0 && bytes[3] === 42;
  return false;
}

/** Reads IFD0's Make and DNGVersion. Returns null when the structure is out of bounds. */
function readIfd0(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const little = bytes[0] === 0x49;
  const ifd = view.getUint32(4, little);
  if (ifd < 8 || ifd + 2 > bytes.length) return null;
  const count = view.getUint16(ifd, little);
  if (count === 0 || count > 1000 || ifd + 2 + count * 12 > bytes.length) return null;
  const result = { make: '', dng: false };
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    const tag = view.getUint16(entry, little);
    if (tag === TAG_DNG_VERSION) result.dng = true;
    if (tag === TAG_MAKE && view.getUint16(entry + 2, little) === 2) {
      const length = Math.min(64, view.getUint32(entry + 4, little));
      const at = length <= 4 ? entry + 8 : view.getUint32(entry + 8, little);
      if (at + length <= bytes.length) result.make = ascii(bytes, at, length).replace(/\0[\s\S]*$/, '').trim();
    }
  }
  return result;
}

/**
 * :param bytes: Uint8Array with the start of a file (RAW_SNIFF_BYTES is enough)
 * :returns: 'arw' | 'dng' | null (not a TIFF structure)
 * :throws: Error with a `code` of 'unsupported' (another TIFF-based format) or 'corrupt'
 */
export function sniffRaw(bytes) {
  if (!isTiff(bytes)) return null;
  const ifd0 = readIfd0(bytes);
  if (!ifd0) throw Object.assign(new Error('The RAW file structure is damaged or incomplete.'), { code: 'corrupt' });
  if (ifd0.dng) return 'dng';
  if (/^sony\b/i.test(ifd0.make)) return 'arw';
  const what = ifd0.make ? `RAW or TIFF files from ${ifd0.make.slice(0, 40)}` : 'TIFF files';
  throw Object.assign(new Error(`${what} are not supported. RAW support covers Sony ARW and DNG.`), { code: 'unsupported' });
}
