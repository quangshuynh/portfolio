// Approved QuangEdit treatments in a publication: which published photographs get new
// public images, decided by comparing the approved render's staged derivatives with the
// blobs at the base commit. Stable file names (<id>-gallery.jpg, <id>-viewer.jpg) keep
// every published URL and deep link; only their pixels change, and only after the merge.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { derivativeFilenames } from '../../scripts/photography-utils.mjs';
import { listTreatments, renderImage } from './treatments.mjs';

export const DERIVATIVES_PATH = 'src/assets/photography/generated';

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/**
 * :param ids: photographs in the publication catalog (drafts are never passed)
 * :returns: [{ id, render, files: { gallery, viewer } }] for approved renders that differ from `commit`
 */
export async function approvedImageChanges({ git, commit, workspaceDir, ids }) {
  const treatments = await listTreatments(workspaceDir);
  const changes = [];
  for (const id of ids) {
    const approved = treatments[id]?.approved;
    if (!approved?.render) continue;
    const names = derivativeFilenames(id);
    const files = { gallery: renderImage(workspaceDir, id, approved.render, 'gallery'), viewer: renderImage(workspaceDir, id, approved.render, 'viewer') };
    let changed = false;
    for (const which of ['gallery', 'viewer']) {
      const bytes = await readFile(files[which]).catch(() => null);
      if (!bytes || sha256(bytes) !== approved.render[which].sha256) {
        throw Object.assign(new Error(`The approved render of "${id}" is missing or changed on disk; render and approve it again.`), { code: 'render-missing' });
      }
      const local = await git(['hash-object', files[which]]);
      const base = await git(['rev-parse', '--verify', '--quiet', `${commit}:${DERIVATIVES_PATH}/${names[`${which}Filename`]}`]).catch(() => null);
      if (local !== base) changed = true;
    }
    if (changed) changes.push({ id, render: approved.render, files });
  }
  return changes;
}
