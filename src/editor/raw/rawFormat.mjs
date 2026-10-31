// Identifies RAW files from their content, never the file name: the container's magic
// (TIFF and its Olympus/Panasonic variants, Canon CR3 and CRW, Fujifilm RAF), then IFD0's
// Make, Model and DNGVersion. A format is supported (RAW_FORMATS) only after genuine files
// decoded, developed, edited and exported correctly (docs/raw-compatibility.md); other
// RAW formats are recognised so the error can name them. Everything is bounds-checked; a
// damaged header is reported, not trusted.

/** Every format this module can identify, with whether genuine files validated it. */
const KNOWN = Object.freeze({
  arw: { label: 'Sony ARW', validated: true },
  sr2: { label: 'Sony SR2', validated: true },
  srf: { label: 'Sony SRF', validated: false, reason: 'its four-colour (RGB + emerald) sensor cannot be developed accurately' },
  nef: { label: 'Nikon NEF', validated: true },
  nrw: { label: 'Nikon NRW', validated: true },
  cr2: { label: 'Canon CR2', validated: true },
  cr3: { label: 'Canon CR3', validated: true },
  crw: { label: 'Canon CRW', validated: true },
  raf: { label: 'Fujifilm RAF', validated: true },
  rw2: { label: 'Panasonic RW2', validated: true },
  orf: { label: 'Olympus ORF', validated: true },
  pef: { label: 'Pentax PEF', validated: true },
  dng: { label: 'DNG', validated: true },
});

export const RAW_FORMATS = Object.freeze(Object.fromEntries(Object.entries(KNOWN).filter(([, format]) => format.validated).map(([key, { label }]) => [key, { label }])));

/** What the editor's RAW support covers, for messages. */
export const RAW_SUPPORT = `${Object.values(RAW_FORMATS).map(({ label }) => label).slice(0, -1).join(', ')} and ${Object.values(RAW_FORMATS).at(-1).label}`;

/** The supported formats by extension, for short notes: "ARW, SR2, NEF, …, DNG". */
export const RAW_EXTENSION_LIST = Object.keys(RAW_FORMATS).map((key) => key.toUpperCase()).join(', ');

/** File-picker extensions and MIME types of the supported formats. */
export const RAW_ACCEPT = Object.freeze([...Object.keys(RAW_FORMATS).map((key) => `.${key}`), 'image/x-sony-arw', 'image/x-nikon-nef', 'image/x-canon-cr2', 'image/x-canon-cr3', 'image/x-fuji-raf', 'image/x-panasonic-rw2', 'image/x-olympus-orf', 'image/x-pentax-pef', 'image/x-adobe-dng']);

const ascii = (bytes, start, length) => String.fromCharCode(...bytes.subarray(start, start + length));

/** Recognised RAW formats outside the list above, refused with their name. */
const OTHERS = [
  { label: 'Samsung SRW', make: /^samsung/i },
  { label: 'Sigma X3F', test: (bytes) => ascii(bytes, 0, 4) === 'FOVb' },
  { label: 'Minolta MRW', test: (bytes) => ascii(bytes, 0, 4) === '\0MRM' },
  { label: 'Hasselblad 3FR', make: /^hasselblad/i },
  { label: 'Phase One IIQ', make: /^phase one/i },
  { label: 'Leica RWL', make: /^leica/i },
  { label: 'Kodak DCR', make: /^kodak|^eastman kodak/i },
];

const refused = (label, reason = `no genuine ${label} file has been validated with this editor`) => Object.assign(new Error(`${label} files are not supported: ${reason}. RAW support covers ${RAW_SUPPORT}.`), { code: 'unsupported' });

/** Bytes read from the start of a file to identify it (IFD0 and its strings sit near the start). */
export const RAW_SNIFF_BYTES = 256 * 1024;

const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_DNG_VERSION = 0xc612;

/** True when the bytes start with a TIFF header (little- or big-endian). */
export function isTiff(bytes) {
  if (bytes.length < 8) return false;
  const order = ascii(bytes, 0, 2);
  if (order === 'II') return bytes[2] === 42 && bytes[3] === 0;
  if (order === 'MM') return bytes[2] === 0 && bytes[3] === 42;
  return false;
}

// TIFF structures with their own magic number: Olympus ORF ("IIRO", "IIRS", "MMOR") and Panasonic RW2 ("IIU\0").
const tiffVariant = (bytes) => {
  if (bytes.length < 8) return null;
  const head = ascii(bytes, 0, 4);
  if (head === 'IIRO' || head === 'IIRS' || head === 'MMOR') return 'orf';
  if (head === 'IIU\0') return 'rw2';
  return null;
};

/** The non-TIFF RAW containers: Canon CR3 (ISO base media, brand "crx "), Canon CRW (CIFF) and Fujifilm RAF. */
const container = (bytes) => {
  if (bytes.length < 16) return null;
  if (ascii(bytes, 4, 4) === 'ftyp' && ascii(bytes, 8, 4) === 'crx ') return 'cr3';
  if (ascii(bytes, 0, 2) === 'II' && ascii(bytes, 6, 8) === 'HEAPCCDR') return 'crw';
  if (ascii(bytes, 0, 15) === 'FUJIFILMCCD-RAW') return 'raf';
  return null;
};

/** True when the bytes start like a RAW file of any kind this module identifies: the editor sends those to the RAW decoder. */
export const isRawContainer = (bytes) => isTiff(bytes) || Boolean(tiffVariant(bytes) || container(bytes) || unsupportedRawLabel(bytes));

/** A recognised non-TIFF RAW format that this editor does not support (Sigma X3F, Minolta MRW), or null. */
export function unsupportedRawLabel(bytes) {
  if (bytes.length < 16) return null;
  return OTHERS.find(({ test }) => test?.(bytes))?.label ?? null;
}

/** Reads IFD0's Make, Model and DNGVersion. Returns null when the structure is out of bounds. */
function readIfd0(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const little = bytes[0] === 0x49;
  const ifd = view.getUint32(4, little);
  if (ifd < 8 || ifd + 2 > bytes.length) return null;
  const count = view.getUint16(ifd, little);
  if (count === 0 || count > 1000 || ifd + 2 + count * 12 > bytes.length) return null;
  const result = { make: '', model: '', dng: false };
  const text = (entry) => {
    const length = Math.min(64, view.getUint32(entry + 4, little));
    const at = length <= 4 ? entry + 8 : view.getUint32(entry + 8, little);
    return at + length <= bytes.length ? ascii(bytes, at, length).replace(/\0[\s\S]*$/, '').trim() : '';
  };
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    const tag = view.getUint16(entry, little);
    const ascii2 = view.getUint16(entry + 2, little) === 2;
    if (tag === TAG_DNG_VERSION) result.dng = true;
    if (tag === TAG_MAKE && ascii2) result.make = text(entry);
    if (tag === TAG_MODEL && ascii2) result.model = text(entry);
  }
  return result;
}

const damaged = () => Object.assign(new Error('The RAW file structure is damaged or incomplete.'), { code: 'corrupt' });

/** The format of a TIFF-structured RAW file from its maker and model. */
function tiffFormat({ make, model, dng }, variant, bytes) {
  if (dng) return 'dng';
  if (variant === 'orf' && /^olympus|^om digital/i.test(make)) return 'orf';
  if (variant === 'rw2' && /^panasonic/i.test(make)) return 'rw2';
  if (variant) return null;
  if (/^sony\b/i.test(make)) {
    // Sony's two pre-ARW formats are model-specific (as in LibRaw): SR2 from the DSC-R1, SRF from the DSC-F828 and DSC-V3.
    if (/^DSC-R1$/i.test(model)) return 'sr2';
    if (/^DSC-(F828|V3)$/i.test(model)) return 'srf';
    return 'arw';
  }
  if (/^nikon\b/i.test(make)) return /^coolpix/i.test(model) ? 'nrw' : 'nef';
  // CR2 marks itself with "CR" and major version 2 after the TIFF header.
  if (/^canon\b/i.test(make) && ascii(bytes, 8, 2) === 'CR' && bytes[10] === 2) return 'cr2';
  if (/^pentax|^ricoh imaging/i.test(make)) return 'pef';
  return null;
}

/**
 * Identifies any RAW file this module knows, supported or not.
 * :param bytes: Uint8Array with the start of a file (RAW_SNIFF_BYTES is enough)
 * :returns: { format, make, model } (format null for an unknown TIFF-based file) or null (not RAW)
 * :throws: Error with code 'corrupt' when a TIFF structure is out of bounds
 */
export function identifyRaw(bytes) {
  const outer = container(bytes);
  if (outer) return { format: outer, make: '', model: '' };
  const variant = tiffVariant(bytes);
  if (!variant && !isTiff(bytes)) return null;
  const ifd0 = readIfd0(bytes);
  if (!ifd0) throw damaged();
  return { format: tiffFormat(ifd0, variant, bytes), make: ifd0.make, model: ifd0.model };
}

/**
 * :param bytes: Uint8Array with the start of a file (RAW_SNIFF_BYTES is enough)
 * :returns: a key of RAW_FORMATS, or null (not a RAW container)
 * :throws: Error with a `code` of 'unsupported' (a RAW format outside RAW_FORMATS) or 'corrupt'
 */
export function sniffRaw(bytes) {
  const other = unsupportedRawLabel(bytes);
  if (other) throw refused(other);
  const found = identifyRaw(bytes);
  if (!found) return null;
  const known = KNOWN[found.format];
  if (known?.validated) return found.format;
  if (known) throw refused(known.label, known.reason);
  const named = OTHERS.find(({ make }) => make?.test(found.make));
  if (named) throw refused(named.label);
  const what = found.make ? `RAW or TIFF files from ${found.make.slice(0, 40)}` : 'TIFF files';
  throw Object.assign(new Error(`${what} are not supported. RAW support covers ${RAW_SUPPORT}.`), { code: 'unsupported' });
}
