// A merged HDR photo as a source: which three files, in which roles, merged how. Saved in
// edit documents (never pixels), so a restore can ask for exactly those files again and
// reproduce the merge. Its identity is a hash of the mode and the inputs' hashes in role
// order, so saved edits match it like any other photo.

import { safeBaseName } from '../io/files.mjs';
import { contentHash } from '../io/hash.mjs';
import { DEFAULT_MERGE_SETTINGS } from './hdrMerge.mjs';
import { ROLES } from './hdrMetadata.mjs';

export const HDR_MODES = Object.freeze({
  radiance: { label: 'RAW HDR merge' },
  fusion: { label: 'Exposure fusion' },
});
export const HDR_NAME_SUFFIX = '-HDR';
const INPUT_FORMATS = ['arw', 'nef', 'dng', 'jpeg', 'png', 'webp'];

/**
 * Name of a merged photo: the reference (normal) exposure's base name plus "-HDR",
 * never twice, numbered when the workspace already has one: DSC09501.ARW -> DSC09501-HDR.
 */
export function hdrPhotoName(referenceName, existingNames = []) {
  const base = safeBaseName(referenceName);
  const stem = base.toLowerCase().endsWith(HDR_NAME_SUFFIX.toLowerCase()) ? base : `${base}${HDR_NAME_SUFFIX}`;
  const taken = new Set(existingNames.map((name) => name.toLowerCase()));
  if (!taken.has(stem.toLowerCase())) return stem;
  for (let n = 2; ; n += 1) if (!taken.has(`${stem}-${n}`.toLowerCase())) return `${stem}-${n}`;
}

const byRole = (inputs) => ROLES.map((role) => inputs.find((input) => input.role === role));

/** Identity of a merge: 64 hex characters, or null when an input has no hash. */
export async function hdrIdentity(mode, inputs) {
  const ordered = byRole(inputs);
  if (ordered.some((input) => !input?.sha256)) return null;
  return contentHash(new TextEncoder().encode(`hdr:${mode}:${ordered.map(({ sha256 }) => sha256).join(':')}`));
}

/** The document form: mode, the inputs by role, and the merge settings. */
export function describeHdrSource({ mode, inputs, settings }) {
  return {
    mode,
    inputs: byRole(inputs).map(({ name, size, sha256, format, role }) => ({ name, size, sha256: sha256 ?? null, format, role })),
    settings: { ...DEFAULT_MERGE_SETTINGS, ...settings },
  };
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Validates an HDR source from untrusted JSON; null when it is not a usable description. */
export function parseHdrSource(input) {
  if (!isObject(input) || !Object.hasOwn(HDR_MODES, input.mode) || !Array.isArray(input.inputs) || input.inputs.length !== ROLES.length) return null;
  const inputs = input.inputs.map((entry) => (isObject(entry) ? {
    name: typeof entry.name === 'string' ? entry.name.slice(0, 255) : '',
    size: Number.isSafeInteger(entry.size) && entry.size >= 0 ? entry.size : null,
    sha256: typeof entry.sha256 === 'string' && /^[0-9a-f]{64}$/.test(entry.sha256) ? entry.sha256 : null,
    format: INPUT_FORMATS.includes(entry.format) ? entry.format : null,
    role: ROLES.includes(entry.role) ? entry.role : null,
  } : null));
  if (inputs.some((entry) => !entry || !entry.role || !entry.name) || new Set(inputs.map(({ role }) => role)).size !== ROLES.length) return null;
  const settings = isObject(input.settings) ? input.settings : {};
  const strength = Number(settings.deghostStrength);
  return {
    mode: input.mode,
    inputs,
    settings: {
      align: settings.align !== false,
      deghost: settings.deghost !== false,
      deghostStrength: Number.isFinite(strength) ? Math.min(100, Math.max(0, Math.round(strength))) : DEFAULT_MERGE_SETTINGS.deghostStrength,
    },
  };
}

/** True when a saved HDR source names these three files (by hash, or by name and size). */
export function hdrSourceMatches(saved, inputs) {
  return saved.inputs.every((entry) => inputs.some((input) => (entry.sha256 && input.sha256 ? entry.sha256 === input.sha256 : entry.name === input.name && entry.size === input.size)));
}
