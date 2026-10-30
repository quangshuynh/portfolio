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
