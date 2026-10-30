// Identifies supported RAW files from their content, never the file name: a TIFF
// structure whose first IFD carries a DNGVersion tag (DNG) or the maker "SONY" (ARW) or
// "NIKON" (NEF). A format is listed only after genuine files decoded and developed
// correctly (docs/photography-editor.md, RAW); other RAW formats are recognised so the
// error can name them. Everything is bounds-checked; a damaged header is reported, not trusted.

export const RAW_FORMATS = Object.freeze({
  arw: { label: 'Sony ARW' },
  nef: { label: 'Nikon NEF' },
  dng: { label: 'DNG' },
});

/** What the editor's RAW support covers, for messages. */
export const RAW_SUPPORT = 'Sony ARW, Nikon NEF and DNG';

const ascii = (bytes, start, length) => String.fromCharCode(...bytes.subarray(start, start + length));

/** Known RAW formats not validated with genuine files: refused with their name. */
const UNVALIDATED = [
  { label: 'Canon CR2', make: /^canon\b/i },
  { label: 'Canon CR3', test: (bytes) => ascii(bytes, 4, 4) === 'ftyp' && ascii(bytes, 8, 4) === 'crx ' },
  { label: 'Fujifilm RAF', test: (bytes) => ascii(bytes, 0, 15) === 'FUJIFILMCCD-RAW' },
  { label: 'Olympus ORF', make: /^olympus|^om digital/i },
  { label: 'Panasonic RW2', make: /^panasonic/i },
  { label: 'Pentax PEF', make: /^pentax|^ricoh/i },
];
const unvalidated = (label) => Object.assign(new Error(`${label} files are not supported yet: no genuine ${label} file has been validated with this editor. RAW support covers ${RAW_SUPPORT}.`), { code: 'unsupported' });

/** A RAW format outside the TIFF family that this editor recognises but does not support (Canon CR3, Fujifilm RAF), or null. */
export function unsupportedRawLabel(bytes) {
  if (bytes.length < 16) return null;
  return UNVALIDATED.find(({ test }) => test?.(bytes))?.label ?? null;
}

/** Bytes read from the start of a file to identify it (IFD0 and its strings sit near the start). */
export const RAW_SNIFF_BYTES = 256 * 1024;

const TAG_MAKE = 0x010f;
const TAG_DNG_VERSION = 0xc612;

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
 * :returns: 'arw' | 'nef' | 'dng' | null (not a TIFF structure)
 * :throws: Error with a `code` of 'unsupported' (another TIFF-based format) or 'corrupt'
 */
export function sniffRaw(bytes) {
  if (!isTiff(bytes)) return null;
  const ifd0 = readIfd0(bytes);
  if (!ifd0) throw Object.assign(new Error('The RAW file structure is damaged or incomplete.'), { code: 'corrupt' });
  if (ifd0.dng) return 'dng';
  if (/^sony\b/i.test(ifd0.make)) return 'arw';
  if (/^nikon\b/i.test(ifd0.make)) return 'nef';
  const known = UNVALIDATED.find(({ make }) => make?.test(ifd0.make));
  if (known) throw unvalidated(known.label);
  const what = ifd0.make ? `RAW or TIFF files from ${ifd0.make.slice(0, 40)}` : 'TIFF files';
  throw Object.assign(new Error(`${what} are not supported. RAW support covers ${RAW_SUPPORT}.`), { code: 'unsupported' });
}
