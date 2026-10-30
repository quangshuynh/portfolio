// When bulk watermarking may touch a photograph's treatment (shared by the server's portfolio
// overview and the editor's queue, so both decide the same way). The watermark is one setting
// over the original, so re-staging replaces it: it never stacks, and every render starts again
// from the original file, so repeated runs never lose quality.
import { adjustmentsEqual, neutralAdjustments } from '../../src/editor/model/adjustments.mjs';
import { parseEditDocument } from '../../src/editor/model/editDocument.mjs';
import { normalizeWatermark, watermarkActive, watermarksEqual } from '../../src/editor/watermark/watermark.mjs';

const firstPhoto = (document) => {
  if (!document) return null;
  try {
    return parseEditDocument(typeof document === 'string' ? document : JSON.stringify(document)).photos[0] ?? null;
  } catch {
    return null;
  }
};
const sourceKey = (photo) => (photo?.source.hdr ? photo.source.hdr.inputs.map(({ sha256 }) => sha256).join(',') : photo?.source.sha256 ?? null);
const withoutMark = (adjustments) => ({ ...adjustments, watermark: null });

/**
 * :param treatment: { document, approved: { document } | null, status, render, documentHash } (a CMS treatment)
 * :param target: the watermark settings bulk staging would apply, or null
 * :returns: { unapprovedEdits, watermark, approvedWatermark, upToDate }
 *   unapprovedEdits: the working treatment differs from the approved one (or, never approved,
 *   from the untouched photo) in anything but the watermark: staging would publish edits nobody
 *   approved, so the photo is left for review
 *   upToDate: it already has exactly `target` and a fresh render (re-running changes nothing)
 */
/**
 * Published photographs whose public image carries no HUYNH watermark: no approved treatment
 * with an active one. Publication refuses while any are listed, unless the owner overrides.
 * :param catalog: { photographs } (the catalog to publish)
 * :param treatments: { id: treatment } (listTreatments)
 * :returns: ids, in catalog order
 */
export function unwatermarkedPhotographs(catalog, treatments) {
  return catalog.photographs
    .filter(({ status }) => status === 'published')
    .filter(({ id }) => !watermarkActive(normalizeWatermark(firstPhoto(treatments[id]?.approved?.document)?.adjustments.watermark ?? null)))
    .map(({ id }) => id);
}

export function watermarkTreatmentState(treatment, target = null) {
  const working = firstPhoto(treatment?.document);
  const approved = firstPhoto(treatment?.approved?.document);
  const watermark = normalizeWatermark(working?.adjustments.watermark ?? null);
  const approvedWatermark = normalizeWatermark(approved?.adjustments.watermark ?? null);
  let unapprovedEdits = false;
  if (working) {
    const reference = approved ? approved.adjustments : neutralAdjustments();
    unapprovedEdits = !adjustmentsEqual(withoutMark(working.adjustments), withoutMark(reference)) || Boolean(approved && sourceKey(approved) !== sourceKey(working));
  }
  const fresh = Boolean(treatment?.document && treatment.render && treatment.render.documentHash === treatment.documentHash);
  return {
    unapprovedEdits,
    watermark,
    approvedWatermark,
    upToDate: Boolean(target && watermarkActive(watermark) && watermarksEqual(watermark, normalizeWatermark(target)) && fresh),
  };
}

/**
 * Where a photograph's watermark stands, from its treatment alone (so it survives restarts):
 * - missing: the working treatment has no enabled watermark (or there is no treatment)
 * - draft: the watermark is in the working treatment but it was never rendered
 * - needs-regeneration: rendered, but the treatment changed since (edits, crop, geometry or
 *   watermark settings), so the render is out of date
 * - needs-review: a fresh watermarked render waits for approval
 * - approved: the approved treatment carries the watermark and nothing changed since
 * An approved version stays what publication uses until a newer draft is approved.
 */
export function watermarkStatus(treatment) {
  const working = firstPhoto(treatment?.document);
  if (!watermarkActive(normalizeWatermark(working?.adjustments.watermark ?? null))) return 'missing';
  if (!treatment.render) return 'draft';
  if (treatment.render.documentHash !== treatment.documentHash) return 'needs-regeneration';
  return treatment.status === 'approved' && treatment.approved?.documentHash === treatment.documentHash ? 'approved' : 'needs-review';
}

/** Statuses automatic drafting works on: it adds, renders or re-renders the watermark. */
export const AUTO_STATUSES = Object.freeze(['missing', 'draft', 'needs-regeneration']);

/**
 * The photographs automatic drafting should process, with the watermark settings for each.
 * A photograph that already has a watermark keeps its own (per-photo) settings, so a stale
 * draft is re-rendered as it was; a missing one gets the policy, at the calmer corner when
 * the placement check flags the policy's. Approved and awaiting-review photographs are left
 * alone; nothing approved is replaced here.
 * :param photos: portfolio overview entries ({ id, source, treatment: { watermarkStatus, watermark, hdr } })
 * :param policy: the CMS watermark preference (settings)
 * :param placements: { id: { flags, suggestion } } from placementReport, where known
 * :param skip: ids not to touch now (open in the editor, failed in this session)
 * :returns: { ids, settings: { id: settings } }
 */
export function autoDraftPlan(photos, policy, placements = {}, skip = new Set()) {
  const ids = [];
  const settings = {};
  for (const photo of photos) {
    if (ids.includes(photo.id) || skip.has(photo.id)) continue;
    if (!AUTO_STATUSES.includes(photo.treatment.watermarkStatus)) continue;
    if (!photo.source?.available || photo.source.limited || photo.treatment.hdr) continue;
    const own = watermarkActive(photo.treatment.watermark) ? photo.treatment.watermark : null;
    const placement = placements[photo.id];
    const position = !own && placement?.flags?.length && placement.suggestion ? placement.suggestion : undefined;
    const target = normalizeWatermark({ ...(own ?? policy), ...(position ? { position } : {}), enabled: true });
    if (!target) continue;
    ids.push(photo.id);
    settings[photo.id] = target;
  }
  return { ids, settings };
}
