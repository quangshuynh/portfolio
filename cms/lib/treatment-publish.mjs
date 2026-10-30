// Approved QuangEdit treatments in a publication: which published photographs get new
// public images, decided by comparing the approved render's staged derivatives with the
// blobs at the base commit. Stable file names (<id>-gallery.jpg, <id>-viewer.jpg) keep
// every published URL and deep link; only their pixels change, and only after the merge.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { derivativeFilenames } from '../../scripts/photography-utils.mjs';
import { listTreatments, renderImage, restoreImage } from './treatments.mjs';

export const DERIVATIVES_PATH = 'src/assets/photography/generated';

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/**
 * :param ids: photographs in the publication catalog (drafts are never passed)
 * :returns: [{ id, render, files: { gallery, viewer } }] for approved renders that differ from `commit`;
 *   a removed treatment gives { id, restore, files }: the original's images, put back
 */
export async function approvedImageChanges({ git, commit, workspaceDir, ids }) {
  const treatments = await listTreatments(workspaceDir);
  const changes = [];
  for (const id of ids) {
    const { approved, restore } = treatments[id] ?? {};
    const staged = approved ? approved.render : restore;
    if (!staged) continue;
    const names = derivativeFilenames(id);
    const image = approved ? renderImage : restoreImage;
    const files = { gallery: image(workspaceDir, id, staged, 'gallery'), viewer: image(workspaceDir, id, staged, 'viewer') };
    let changed = false;
    for (const which of ['gallery', 'viewer']) {
      const bytes = await readFile(files[which]).catch(() => null);
      if (!bytes || sha256(bytes) !== staged[which].sha256) {
        throw Object.assign(new Error(approved ? `The approved render of "${id}" is missing or changed on disk; render and approve it again.`
          : `The original images of "${id}" (Remove approved treatment) are missing or changed on disk; remove the treatment again.`), { code: 'render-missing' });
      }
      const local = await git(['hash-object', files[which]]);
      const base = await git(['rev-parse', '--verify', '--quiet', `${commit}:${DERIVATIVES_PATH}/${names[`${which}Filename`]}`]).catch(() => null);
      if (local !== base) changed = true;
    }
    if (changed) changes.push(approved ? { id, render: approved.render, files } : { id, restore, files });
  }
  return changes;
}
