// The CMS's watermark data: one global preference and the portfolio overview for bulk staging.
// The mark is always drawn by QuangEdit in the browser (src/editor/watermark/); nothing here
// renders. The preference is a watermark configuration file (quanghuynh.watermark, version 1)
// at <workspace>/watermark.json. It is only the starting point for photos the owner watermarks
// from now on: every treatment stores its own resolved settings, so changing the preference
// never changes a saved, approved or published photograph.
import path from 'node:path';
import {
  WATERMARK_DEFAULTS, WatermarkConfigError, createWatermarkConfig, normalizeWatermark, parseWatermarkConfig, watermarkActive,
} from '../../src/editor/watermark/watermark.mjs';
import { readGeneratedManifest } from '../../scripts/photography-catalog-files.mjs';
import { editingSources, listTreatments, renderIsFresh } from './treatments.mjs';
import { hdrSourceStatus, watermarkStatus, watermarkTreatmentState } from './watermark-rules.mjs';
import { readJson, readWorkspace, writeAtomic } from './workspace.mjs';

export class WatermarkError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.code = 'bad-watermark';
    this.status = status;
  }
}

const preferenceFile = (dir) => path.join(dir, 'watermark.json');

/** :returns: { settings, saved, updatedAt } (the approved defaults until one is saved) */
export async function readWatermarkPreference(dir) {
  const stored = await readJson(preferenceFile(dir), null);
  // Until the owner saves one: the approved defaults with automatic white or charcoal.
  if (!stored) return { settings: { ...WATERMARK_DEFAULTS, color: 'auto' }, saved: false, updatedAt: null };
  try {
    const { settings } = parseWatermarkConfig(JSON.stringify(stored.config));
    return { settings, saved: true, updatedAt: typeof stored.updatedAt === 'string' ? stored.updatedAt : null };
  } catch (error) {
    if (error instanceof WatermarkConfigError) throw new WatermarkError(`The saved watermark preference is not valid: ${error.message}`, 500);
    throw error;
  }
}

export async function saveWatermarkPreference(dir, input, now = new Date()) {
  const settings = normalizeWatermark({ ...input, enabled: true });
  if (!settings) throw new WatermarkError('The watermark preference must use the HUYNH Photography preset.');
  const record = { config: createWatermarkConfig(settings, 'CMS global preference'), updatedAt: now.toISOString() };
  await writeAtomic(preferenceFile(dir), `${JSON.stringify(record, null, 2)}\n`);
  return readWatermarkPreference(dir);
}

/**
 * Every published photograph with what bulk watermarking needs to know: its size, where its
 * source is (checked for existence only: no file is read or hashed), and its treatment's
 * watermark (working and approved). Paths never leave the server.
 */
export async function portfolioOverview({ workspaceDir, libraryDir, derivativesDir, manifestFile }) {
  const workspace = await readWorkspace(workspaceDir);
  const treatments = await listTreatments(workspaceDir);
  const generated = new Map([...(await readGeneratedManifest(manifestFile)), ...workspace.previewManifest].map((entry) => [entry.id, entry]));
  const published = workspace.catalog.photographs.filter(({ status }) => status === 'published');
  // Drafts with an uploaded original are eligible as soon as they are imported (they get a
  // watermark draft before they are published); drafts without one are not listed.
  const uploaded = new Set(Object.values(workspace.originals).map(({ id }) => id));
  const imported = workspace.catalog.photographs.filter(({ id, status }) => status !== 'published' && uploaded.has(id));
  const photographs = [];
  for (const record of [...published, ...imported]) {
    const treatment = treatments[record.id] ?? { attached: [], document: null, status: 'none', approved: null };
    const sources = await editingSources({ workspaceDir, libraryDir, record, treatment, derivativesDir, hash: false });
    const [source] = sources;
    // Attached sources are stored under their content hash, so their hashes are known unread.
    const hdrSources = hdrSourceStatus(treatment.document, sources);
    const meta = generated.get(record.id);
    const state = watermarkTreatmentState(treatment);
    photographs.push({
      id: record.id,
      caption: record.caption,
      alt: record.alt,
      published: record.status === 'published',
      featured: Boolean(record.featured),
      // Proportions only (the public viewer image); the original's size is not read.
      width: meta?.viewerWidth ?? null,
      height: meta?.viewerHeight ?? null,
      source: source ? { kind: source.kind, format: source.format, available: source.available, limited: Boolean(source.limited) } : null,
      treatment: {
        status: treatment.status,
        revision: treatment.revision ?? 0,
        hdr: Boolean(hdrSources),
        // For a merged HDR: whether all three exposures are here, and which are missing.
        hdrSources,

        renderFresh: renderIsFresh(treatment),
        watermark: state.watermark,
        watermarked: watermarkActive(state.watermark),
        approvedWatermarked: watermarkActive(state.approvedWatermark),
        // Edits in the working treatment nobody approved: bulk staging leaves the photo alone.
        unapprovedEdits: state.unapprovedEdits,
        watermarkStatus: watermarkStatus(treatment),
      },
    });
  }
  return { count: published.length, drafts: imported.length, photographs, preference: await readWatermarkPreference(workspaceDir) };
}
