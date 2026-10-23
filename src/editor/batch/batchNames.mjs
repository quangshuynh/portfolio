// Names for a batch export: every file is named by exportFileName() (the source's base
// name, the suffix, the format's extension), so ZIP entries and individual downloads have
// the same names. Collisions (case-insensitive, as on Windows and macOS) are numbered in
// workspace order: DSC0001-quangedit.jpg, DSC0001-quangedit-2.jpg. A custom name typed for
// one photo is kept as given (sanitised, with the format's extension) and takes part in
// the same collision check. Names never contain a path, so a ZIP entry cannot escape.

import { DEFAULT_EXPORT_SUFFIX, exportFileName, safeBaseName } from '../io/files.mjs';
import { FORMATS } from '../io/imageHeader.mjs';

/** Splits "name.ext" at the last dot. */
const splitExtension = (fileName) => {
  const dot = fileName.lastIndexOf('.');
  return [fileName.slice(0, dot), fileName.slice(dot)];
};

/**
 * :param entries: [{ id, name, customName? }] in export order
 * :param options: { format, suffix }
 * :returns: Map id -> file name
 */
export function batchFileNames(entries, { format, suffix = DEFAULT_EXPORT_SUFFIX }) {
  const extension = FORMATS[format]?.extension;
  if (!extension) throw new Error(`Unsupported export format: ${format}`);
  const taken = new Set();
  const names = new Map();
  entries.forEach(({ id, name, customName }) => {
    const wanted = customName && customName.trim()
      ? `${safeBaseName(customName)}.${extension}`
      : exportFileName(name, format, suffix);
    const [stem, ext] = splitExtension(wanted);
    let candidate = wanted;
    for (let n = 2; taken.has(candidate.toLowerCase()); n += 1) candidate = `${stem}-${n}${ext}`;
    taken.add(candidate.toLowerCase());
    names.set(id, candidate);
  });
  return names;
}

/**
 * Name of a batch ZIP: photos-quangedit-2026-10-23.zip, or …-part2.zip when the batch was
 * split into several archives (`split`: this is not the only part).
 */
export function zipFileName({ date = new Date(), part = 1, split = false, suffix = DEFAULT_EXPORT_SUFFIX } = {}) {
  const day = date.toISOString().slice(0, 10);
  const stem = safeBaseName(`photos${suffix}`, 'photos');
  return `${stem}-${day}${split ? `-part${part}` : ''}.zip`;
}
