// What a workspace would change on the public site, compared with the public catalog it
// started from. Drives the dashboard's "pending changes" and the pull request description.
import { publishedRecords } from '../../scripts/photography-catalog.mjs';

const DESCRIBED_FIELDS = ['caption', 'alt', 'shape', 'category', 'tags', 'metadata', 'slug', 'sourceFilename'];
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Items outside a longest increasing subsequence of old positions are the ones that moved.
function movedIds(beforeIds, afterIds) {
  const position = new Map(beforeIds.map((id, i) => [id, i]));
  const common = afterIds.filter((id) => position.has(id));
  const sequence = common.map((id) => position.get(id));
  const tails = [];
  const previous = new Array(sequence.length);
  const tailIndex = [];
  sequence.forEach((value, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = value;
    tailIndex[lo] = i;
    previous[i] = lo ? tailIndex[lo - 1] : -1;
  });
  const keep = new Set();
  for (let i = tailIndex[tails.length - 1] ?? -1; i >= 0; i = previous[i]) keep.add(common[i]);
  return common.filter((id) => !keep.has(id));
}

/**
 * :param base: public catalog the workspace started from
 * :param workspace: edited workspace catalog (drafts included)
 * :returns: summary of public changes plus draft counts
 */
export function summarizeChanges(base, workspace) {
  const before = publishedRecords(base);
  const after = publishedRecords(workspace);
  const beforeById = new Map(before.map((record) => [record.id, record]));
  const afterById = new Map(after.map((record) => [record.id, record]));
  const baseIds = new Set(base.photographs.map(({ id }) => id));

  const added = after.filter(({ id }) => !beforeById.has(id)).map(({ id }) => id);
  const withdrawn = before.filter(({ id }) => !afterById.has(id)).map(({ id }) => id);
  const edited = after.filter(({ id }) => beforeById.has(id)).flatMap((record) => {
    const fields = DESCRIBED_FIELDS.filter((key) => !same(record[key], beforeById.get(record.id)[key]));
    return fields.length ? [{ id: record.id, fields }] : [];
  });
  const moved = movedIds(before.map(({ id }) => id), after.map(({ id }) => id));
  const featured = (records) => records.filter((record) => record.featured).sort((a, b) => a.featured - b.featured).map(({ id }) => id);
  const featuredBefore = featured(before);
  const featuredAfter = featured(after);
  const summary = {
    added,
    withdrawn,
    edited,
    moved,
    featured: same(featuredBefore, featuredAfter) ? null : { before: featuredBefore, after: featuredAfter },
    hero: base.hero === workspace.hero ? null : { before: base.hero, after: workspace.hero },
    collections: same(base.categories, workspace.categories) ? null : { before: base.categories, after: workspace.categories },
    drafts: workspace.photographs.filter(({ status }) => status === 'draft').length,
    newDrafts: workspace.photographs.filter(({ id, status }) => status === 'draft' && !baseIds.has(id)).map(({ id }) => id),
  };
  summary.count = added.length + withdrawn.length + edited.length + moved.length
    + (summary.featured ? 1 : 0) + (summary.hero ? 1 : 0) + (summary.collections ? 1 : 0);
  return summary;
}

const list = (ids, caption) => ids.map((id) => `- \`${id}\`${caption ? ` ${caption(id)}` : ''}`).join('\n');

/** Markdown pull request description for a publication. Mentions no draft. */
export function pullRequestBody(summary, workspace, { baseRef, baseCommit }) {
  const byId = new Map(workspace.photographs.map((record) => [record.id, record]));
  const caption = (id) => (byId.get(id) ? `"${byId.get(id).caption}"` : '');
  const sections = [
    '## Photography publication',
    '',
    `Prepared by the local photography CMS against \`${baseRef}\` at \`${baseCommit.slice(0, 12)}\`.`,
    'Merging deploys the changes; nothing here is live until this pull request is merged and the deployments finish.',
    '',
  ];
  const add = (title, body) => {
    if (body) sections.push(`### ${title}`, '', body, '');
  };
  add(`Added (${summary.added.length})`, summary.added.length && list(summary.added, caption));
  add(`Withdrawn (${summary.withdrawn.length})`, summary.withdrawn.length && list(summary.withdrawn));
  add(`Edited (${summary.edited.length})`, summary.edited.length
    && summary.edited.map(({ id, fields }) => `- \`${id}\`: ${fields.join(', ')}`).join('\n'));
  add(`Reordered (${summary.moved.length})`, summary.moved.length && list(summary.moved));
  add(`New images from QuangEdit (${summary.images?.length ?? 0})`, summary.images?.length && `${list(summary.images, caption)}

Approved treatments rendered from the originals; same file names, so links are unchanged.`);
  add('Featured', summary.featured && `Before: ${summary.featured.before.join(', ') || 'none'}\nAfter: ${summary.featured.after.join(', ') || 'none'}`);
  add('Hero', summary.hero && `\`${summary.hero.before}\` → \`${summary.hero.after}\``);
  add('Collections', summary.collections && `Before: ${summary.collections.before.join(', ')}\nAfter: ${summary.collections.after.join(', ')}`);
  sections.push('### Checks', '', '- Catalog validated with `scripts/photography-catalog.mjs` and asset report clean before commit.',
    '- Drafts and unpublished originals are not part of this branch.', '- CI runs `npm test`, `check:assets` and the build on this pull request.', '');
  return sections.join('\n');
}
