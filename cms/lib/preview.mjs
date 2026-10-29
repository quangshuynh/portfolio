// The proposed public gallery for the CMS preview: the workspace's publication catalog
// (drafts removed, exactly as publishing would write it) with repository derivatives for
// photographs already in the repository and workspace derivatives for new uploads.
import { catalogErrors, publicPhotographs } from '../../scripts/photography-catalog.mjs';
import { readGeneratedManifest } from '../../scripts/photography-catalog-files.mjs';
import { publicationCatalog } from './catalog-ops.mjs';
import { listTreatments } from './treatments.mjs';
import { readWorkspace } from './workspace.mjs';

export const imageUrl = (filename) => `/api/images/${encodeURIComponent(filename)}`;

/**
 * :returns: { collection, errors } where collection is what `virtual:photography-catalog`
 *   serves in preview mode, and errors are reasons the preview cannot be shown
 */
export async function loadPreview(workspaceDir, { manifestFile } = {}) {
  const workspace = await readWorkspace(workspaceDir);
  const publication = publicationCatalog(workspace.catalog);
  const errors = catalogErrors(publication);
  if (errors.length) return { collection: null, errors };

  const repoManifest = new Map((await readGeneratedManifest(manifestFile)).map((entry) => [entry.id, entry]));
  const previewManifest = new Map(workspace.previewManifest.map((entry) => [entry.id, entry]));
  const photographs = publicPhotographs(publication);
  const generated = [];
  const assetUrls = {};
  const missing = [];
  for (const { id } of photographs) {
    const fromRepo = repoManifest.get(id);
    const fromUpload = previewManifest.get(id);
    if (fromRepo) generated.push(fromRepo);
    else if (fromUpload) {
      generated.push(fromUpload);
      assetUrls[fromUpload.galleryFilename] = imageUrl(fromUpload.galleryFilename);
      assetUrls[fromUpload.viewerFilename] = imageUrl(fromUpload.viewerFilename);
    } else missing.push(id);
  }
  if (missing.length) return { collection: null, errors: missing.map((id) => `"${id}" has no images yet; upload it again.`) };
  // Approved QuangEdit renders show as they would be published.
  const treatments = await listTreatments(workspaceDir);
  generated.forEach((entry, index) => {
    const render = treatments[entry.id]?.approved?.render;
    if (!render) return;
    generated[index] = { ...entry, galleryWidth: render.gallery.width, galleryHeight: render.gallery.height, viewerWidth: render.viewer.width, viewerHeight: render.viewer.height };
    assetUrls[entry.galleryFilename] = `/api/editor/photos/${entry.id}/images/approved-gallery?v=${render.sha256.slice(0, 16)}`;
    assetUrls[entry.viewerFilename] = `/api/editor/photos/${entry.id}/images/approved-viewer?v=${render.sha256.slice(0, 16)}`;
  });
  return {
    errors: [],
    collection: {
      captureTimeZone: publication.captureTimeZone,
      categories: publication.categories,
      heroSlug: photographs.find(({ id }) => id === publication.hero).slug,
      photographs,
      generated,
      assetUrls,
    },
  };
}
