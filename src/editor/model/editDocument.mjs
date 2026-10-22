// Portable edit document: adjustment values and export settings, plus enough about
// each source to match it again on reimport. It never contains pixels. Parsing is
// strict JSON with schema checks; nothing in a document is ever executed.

import { ADJUSTMENT_KEYS, normalizeAdjustments } from './adjustments.mjs';
import { FORMATS } from '../io/imageHeader.mjs';
import { safeSuffix } from '../io/files.mjs';

export const DOCUMENT_TYPE = 'quanghuynh.photo-editor.edits';
export const DOCUMENT_VERSION = 1;
export const MAX_DOCUMENT_BYTES = 1024 * 1024;

export const DEFAULT_EXPORT_SETTINGS = Object.freeze({
  format: 'jpeg',
  quality: 0.92,
  resize: Object.freeze({ mode: 'original', longEdge: 3840, maxWidth: 3840, maxHeight: 3840 }),
  suffix: '-edited',
});

export class EditDocumentError extends Error {}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const positiveInteger = (value) => (Number.isInteger(value) && value > 0 && value <= 1_000_000 ? value : null);

export function normalizeExportSettings(input = {}) {
  const source = isObject(input) ? input : {};
  const resize = isObject(source.resize) ? source.resize : {};
  const quality = Number(source.quality);
  return {
    format: Object.hasOwn(FORMATS, source.format) ? source.format : DEFAULT_EXPORT_SETTINGS.format,
    quality: Number.isFinite(quality) ? Math.min(1, Math.max(0.5, Math.round(quality * 100) / 100)) : DEFAULT_EXPORT_SETTINGS.quality,
    resize: {
      mode: ['original', 'long-edge', 'fit'].includes(resize.mode) ? resize.mode : 'original',
      longEdge: positiveInteger(resize.longEdge) ?? DEFAULT_EXPORT_SETTINGS.resize.longEdge,
      maxWidth: positiveInteger(resize.maxWidth) ?? DEFAULT_EXPORT_SETTINGS.resize.maxWidth,
      maxHeight: positiveInteger(resize.maxHeight) ?? DEFAULT_EXPORT_SETTINGS.resize.maxHeight,
    },
    suffix: typeof source.suffix === 'string' ? safeSuffix(source.suffix) : DEFAULT_EXPORT_SETTINGS.suffix,
  };
}

/** Identity used to match a saved entry to a reimported file. */
export const sourceKey = ({ sha256, name, size }) => (sha256 ? `sha256:${sha256}` : `file:${name}:${size}`);

/**
 * :param photos: editor photos ({ name, size, lastModified, sha256, format, width, height, orientation, adjustments })
 * :returns: the document as a plain object
 */
export function createEditDocument(photos, exportSettings, now = new Date()) {
  return {
    type: DOCUMENT_TYPE,
    version: DOCUMENT_VERSION,
    savedAt: now.toISOString(),
    exportSettings: normalizeExportSettings(exportSettings),
    photos: photos.map((photo) => ({
      source: {
        name: photo.name,
        size: photo.size,
        lastModified: photo.lastModified,
        sha256: photo.sha256 ?? null,
        format: photo.format,
        width: photo.width,
        height: photo.height,
        orientation: photo.orientation ?? 1,
      },
      adjustments: { ...normalizeAdjustments(photo.adjustments) },
    })),
  };
}

export const serializeEditDocument = (document) => `${JSON.stringify(document, null, 2)}\n`;

function parseSource(source, index) {
  if (!isObject(source)) throw new EditDocumentError(`Photo ${index + 1} has no source description.`);
  const name = typeof source.name === 'string' ? source.name.slice(0, 255) : '';
  const size = Number.isSafeInteger(source.size) && source.size >= 0 ? source.size : null;
  const sha256 = typeof source.sha256 === 'string' && /^[0-9a-f]{64}$/.test(source.sha256) ? source.sha256 : null;
  if (!sha256 && (!name || size === null)) throw new EditDocumentError(`Photo ${index + 1} cannot be matched to a file (no hash, name or size).`);
  return {
    name,
    size,
    sha256,
    lastModified: Number.isSafeInteger(source.lastModified) ? source.lastModified : null,
    format: Object.hasOwn(FORMATS, source.format) ? source.format : null,
    width: positiveInteger(source.width),
    height: positiveInteger(source.height),
  };
}

/**
 * Parses and validates a saved document. Unknown fields are ignored; out-of-range
 * adjustment values are clamped. Throws EditDocumentError with a readable message.
 */
export function parseEditDocument(text) {
  if (typeof text !== 'string') throw new EditDocumentError('The edit file could not be read.');
  if (text.length > MAX_DOCUMENT_BYTES) throw new EditDocumentError('The edit file is larger than 1 MB.');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new EditDocumentError('The edit file is not valid JSON.');
  }
  if (!isObject(data) || data.type !== DOCUMENT_TYPE) throw new EditDocumentError('This is not a photo editor edit file.');
  if (!Number.isInteger(data.version) || data.version < 1) throw new EditDocumentError('The edit file has no valid version.');
  if (data.version > DOCUMENT_VERSION) throw new EditDocumentError(`The edit file is version ${data.version}; this editor reads version ${DOCUMENT_VERSION}.`);
  if (!Array.isArray(data.photos)) throw new EditDocumentError('The edit file lists no photos.');
  if (data.photos.length > 500) throw new EditDocumentError('The edit file lists more than 500 photos.');
  return {
    version: data.version,
    exportSettings: normalizeExportSettings(data.exportSettings),
    photos: data.photos.map((entry, index) => {
      if (!isObject(entry)) throw new EditDocumentError(`Photo ${index + 1} is not an object.`);
      const adjustments = isObject(entry.adjustments) ? entry.adjustments : {};
      const numeric = Object.fromEntries(ADJUSTMENT_KEYS
        .filter((key) => typeof adjustments[key] === 'number' && Number.isFinite(adjustments[key]))
        .map((key) => [key, adjustments[key]]));
      return { source: parseSource(entry.source, index), adjustments: normalizeAdjustments(numeric) };
    }),
  };
}
