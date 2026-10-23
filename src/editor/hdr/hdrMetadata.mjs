// HDR bracket metadata: exposure facts from EXIF (JPEG, PNG, WebP) or LibRaw (RAW),
// relative exposure, exposure-role suggestions and the checks that decide whether three
// files can be merged. Roles are never taken from file names. Pure functions.

export const ROLES = Object.freeze(['under', 'normal', 'over']);
export const ROLE_LABELS = Object.freeze({ under: 'Underexposed', normal: 'Normal', over: 'Overexposed' });
export const BRACKET_SIZE = 3;
/** Neighbouring exposures closer than this add almost no range. */
export const MIN_STEP_EV = 0.6;
/** Beyond this the darkest and brightest frames share too few well-exposed tones to align and normalise. */
export const MAX_SPAN_EV = 8;
/** Relative difference in aspect ratio still treated as the same framing (raster inputs are scaled to match). */
export const ASPECT_TOLERANCE = 0.01;

const TAG = { exifIfd: 0x8769, exposureTime: 0x829a, fNumber: 0x829d, iso: 0x8827, bias: 0x9204, dateTime: 0x9003, model: 0x0110, orientation: 0x0112 };
const TYPE_SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

function readIfd(view, tiff, offset, little) {
  const entries = new Map();
  if (offset < 8 || tiff + offset + 2 > view.byteLength) return entries;
  const count = view.getUint16(tiff + offset, little);
  if (count > 1000) return entries;
  for (let i = 0; i < count; i += 1) {
    const at = tiff + offset + 2 + i * 12;
    if (at + 12 > view.byteLength) break;
    const type = view.getUint16(at + 2, little);
    const n = view.getUint32(at + 4, little);
    const bytes = (TYPE_SIZES[type] ?? 0) * n;
    const data = bytes <= 4 ? at + 8 : tiff + view.getUint32(at + 8, little);
    if (!TYPE_SIZES[type] || data + bytes > view.byteLength) continue;
    entries.set(view.getUint16(at, little), { type, n, data });
  }
  return entries;
}

function readValue(view, entry, little) {
  if (!entry) return null;
  const { type, n, data } = entry;
  if (type === 2) return String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + data, Math.min(n, 64))).replace(/\0[\s\S]*$/, '').trim();
  if (type === 3) return view.getUint16(data, little);
  if (type === 4) return view.getUint32(data, little);
  if (type === 5 || type === 10) {
    const read = type === 5 ? 'getUint32' : 'getInt32';
    const denominator = view[read](data + 4, little);
    return denominator ? view[read](data, little) / denominator : null;
  }
  return null;
}

const positive = (value) => (Number.isFinite(value) && value > 0 ? value : null);

/** Exposure facts from a TIFF (EXIF) block. Missing or malformed values are null. */
export function readTiffExposure(view, tiff) {
  const empty = { shutter: null, aperture: null, iso: null, bias: null, captured: null, model: '' };
  if (tiff + 8 > view.byteLength) return empty;
  const order = view.getUint16(tiff);
  if (order !== 0x4949 && order !== 0x4d4d) return empty;
  const little = order === 0x4949;
  const ifd0 = readIfd(view, tiff, view.getUint32(tiff + 4, little), little);
  const exifOffset = readValue(view, ifd0.get(TAG.exifIfd), little);
  const exif = exifOffset ? readIfd(view, tiff, exifOffset, little) : new Map();
  const bias = readValue(view, exif.get(TAG.bias), little);
  return {
    shutter: positive(readValue(view, exif.get(TAG.exposureTime), little)),
    aperture: positive(readValue(view, exif.get(TAG.fNumber), little)),
    iso: positive(readValue(view, exif.get(TAG.iso), little)),
    bias: Number.isFinite(bias) ? bias : null,
    captured: parseExifDate(readValue(view, exif.get(TAG.dateTime), little)),
    model: String(readValue(view, ifd0.get(TAG.model), little) ?? '').slice(0, 64),
  };
}

/** EXIF "YYYY:MM:DD HH:MM:SS" as milliseconds (local time treated as UTC: only differences are used). */
export function parseExifDate(text) {
  const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(text ?? '');
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number);
  const time = Date.UTC(y, mo - 1, d, h, mi, s);
  return Number.isFinite(time) ? time : null;
}

/** Finds the EXIF TIFF block of a JPEG, PNG or WebP header and reads its exposure facts. */
export function readRasterExposure(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at, length) => String.fromCharCode(...bytes.subarray(at, at + length));
  let tiff = null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1];
      if (marker === 0xda || marker === 0xd9) break;
      const length = view.getUint16(offset + 2);
      if (marker === 0xe1 && ascii(offset + 4, 6) === 'Exif\0\0') { tiff = offset + 10; break; }
      offset += 2 + length;
    }
  } else if (bytes[0] === 0x89 && ascii(1, 3) === 'PNG') {
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset);
      const type = ascii(offset + 4, 4);
      if (type === 'eXIf') { tiff = offset + 8; break; }
      if (type === 'IDAT' || type === 'IEND') break;
      offset += 12 + length;
    }
  } else if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const type = ascii(offset, 4);
      const length = view.getUint32(offset + 4, true);
      if (type === 'EXIF') { tiff = ascii(offset + 8, 6) === 'Exif\0\0' ? offset + 14 : offset + 8; break; }
      offset += 8 + length + (length % 2);
    }
  }
  return tiff === null ? readTiffExposure(view, view.byteLength) : readTiffExposure(view, tiff);
}

/** True when shutter, aperture and ISO are all known. */
export const hasExposure = (exposure) => Boolean(exposure?.shutter && exposure.aperture && exposure.iso);

/**
 * Photographic exposure in stops, log2(t · ISO / N²): one stop more light per +1.
 * Equal values mean the same sensor exposure. Null when a value is missing.
 */
export const exposureStops = (exposure) => (hasExposure(exposure) ? Math.log2((exposure.shutter * exposure.iso) / (exposure.aperture ** 2)) : null);

const describe = ({ shutter, aperture, iso }) => [
  shutter && (shutter >= 1 ? `${Number(shutter.toFixed(1))} s` : `1/${Math.round(1 / shutter)} s`),
  aperture && `f/${Number(aperture.toFixed(1))}`,
  iso && `ISO ${Math.round(iso)}`,
].filter(Boolean).join(', ');

/**
 * Suggested roles from exposure metadata (darkest = under). Only when all three record
 * shutter, aperture and ISO and neighbours differ by at least MIN_STEP_EV.
 * :returns: { roles: ['under' | 'normal' | 'over', ...] per input, stops } or null
 */
export function suggestRolesFromMetadata(inputs) {
  const stops = inputs.map(({ exposure }) => exposureStops(exposure));
  if (stops.some((value) => value === null)) return null;
  const order = stops.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  if (order[1].value - order[0].value < MIN_STEP_EV || order[2].value - order[1].value < MIN_STEP_EV) return null;
  const roles = [];
  order.forEach(({ index }, rank) => { roles[index] = ROLES[rank]; });
  return { roles, stops };
}

/** Suggested roles from measured brightness (median luminance), for files without exposure data. */
export function suggestRolesFromBrightness(brightness) {
  const order = brightness.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const roles = [];
  order.forEach(({ index }, rank) => { roles[index] = ROLES[rank]; });
  return roles;
}

/** True when roles name each of under, normal and over once. */
export const rolesComplete = (roles) => roles.length === BRACKET_SIZE && ROLES.every((role) => roles.filter((r) => r === role).length === 1);

/**
 * Checks three inputs before decoding their pixels.
 * :param inputs: [{ name, size, sha256, kind: 'raw' | 'raster', format, width, height,
 *   orientation, exposure: { shutter, aperture, iso, captured, model } }]
 * :returns: { errors: [string], warnings: [string], mode: 'radiance' | 'fusion' | null }
 *   radiance = RAW HDR merge; fusion = exposure fusion of JPEG, PNG or WebP
 */
export function validateBracket(inputs) {
  const errors = [];
  const warnings = [];
  if (inputs.length !== BRACKET_SIZE) {
    errors.push(`Choose exactly three photographs (${inputs.length} selected).`);
    return { errors, warnings, mode: null };
  }
  const kinds = new Set(inputs.map(({ kind }) => kind));
  if (kinds.size > 1) errors.push('Use three RAW files or three JPEG, PNG or WebP files; RAW and processed images cannot be merged together.');
  const mode = kinds.size === 1 ? (inputs[0].kind === 'raw' ? 'radiance' : 'fusion') : null;

  const hashes = inputs.map(({ sha256 }) => sha256).filter(Boolean);
  inputs.forEach((input, index) => {
    const earlier = inputs.slice(0, index).find((other) => (input.sha256 && other.sha256 === input.sha256)
      || (!input.sha256 && other.name === input.name && other.size === input.size));
    if (earlier) errors.push(`${input.name} is the same file as ${earlier.name}. Choose three different exposures.`);
  });
  if (hashes.length < inputs.length) warnings.push('Duplicate files can only be detected by name and size in this browser.');

  const [first] = inputs;
  if (mode === 'radiance') {
    const models = new Set(inputs.map(({ exposure }) => exposure?.model).filter(Boolean));
    if (models.size > 1) errors.push(`The RAW files come from different cameras (${[...models].join(', ')}).`);
    if (inputs.some(({ width, height }) => width !== first.width || height !== first.height)) {
      errors.push(`The RAW files have different sizes (${inputs.map(({ width, height }) => `${width}×${height}`).join(', ')}).`);
    }
  } else if (mode === 'fusion') {
    const landscape = (input) => input.width >= input.height;
    if (inputs.some((input) => landscape(input) !== landscape(first))) {
      errors.push('The photos have different orientations (portrait and landscape). Rotate them the same way first.');
    } else {
      const aspect = (input) => input.width / input.height;
      if (inputs.some((input) => Math.abs(aspect(input) / aspect(first) - 1) > ASPECT_TOLERANCE)) {
        errors.push(`The photos have different aspect ratios (${inputs.map(({ width, height }) => `${width}×${height}`).join(', ')}), so they are not the same framing.`);
      } else if (inputs.some(({ width, height }) => width !== first.width || height !== first.height)) {
        warnings.push('The photos differ in size; they are merged at the smallest size.');
      }
    }
  }

  const known = inputs.filter(({ exposure }) => hasExposure(exposure));
  if (known.length === BRACKET_SIZE) {
    const stops = inputs.map(({ exposure }) => exposureStops(exposure));
    const sorted = [...stops].sort((a, b) => a - b);
    if (sorted[2] - sorted[0] < 0.05) {
      errors.push(`All three photos were taken with the same exposure (${describe(first.exposure)}), so they hold no extra highlight or shadow information. This is not an exposure bracket (for example, Sony DRO bracketing saves one exposure several times).`);
    } else if (sorted[1] - sorted[0] < MIN_STEP_EV || sorted[2] - sorted[1] < MIN_STEP_EV) {
      warnings.push(`Two of the exposures are less than ${MIN_STEP_EV} EV apart; the merge adds little range.`);
    }
    if (sorted[2] - sorted[0] > MAX_SPAN_EV) errors.push(`The exposures span ${(sorted[2] - sorted[0]).toFixed(1)} EV; at most ${MAX_SPAN_EV} EV can be aligned and merged reliably.`);
    const isos = new Set(inputs.map(({ exposure }) => Math.round(exposure.iso)));
    if (isos.size > 1) warnings.push('ISO differs between the exposures; the brighter frames carry more noise than a shutter-speed bracket.');
    const apertures = new Set(inputs.map(({ exposure }) => exposure.aperture.toFixed(1)));
    if (apertures.size > 1) warnings.push('The aperture changes between exposures, so depth of field differs; use a shutter-speed bracket where possible.');
  } else if (mode === 'radiance') {
    warnings.push('Some RAW files do not record shutter, aperture and ISO; the exposure difference is measured from the images.');
  } else if (mode === 'fusion') {
    warnings.push(known.length ? 'Not every photo records its exposure; check the roles below.' : 'These photos do not record their exposure; roles are suggested from brightness. Check them below.');
  }

  const times = inputs.map(({ exposure }) => exposure?.captured).filter(Number.isFinite);
  if (times.length === BRACKET_SIZE && Math.max(...times) - Math.min(...times) > 60_000) {
    warnings.push('The photos were taken more than a minute apart; light or subjects may have changed.');
  }
  return { errors, warnings, mode };
}

/** Exposure description for the review step, e.g. "1/125 s, f/8, ISO 100". */
export const exposureLabel = (exposure) => (exposure ? describe(exposure) : '');
