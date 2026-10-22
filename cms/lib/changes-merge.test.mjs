// @vitest-environment node
import { baseCatalog, record } from '../test-helpers.mjs';
import { addDraft, movePhotograph, setFeatured, setHero, setStatus, updatePhotograph } from './catalog-ops.mjs';
import { pullRequestBody, summarizeChanges } from './changes.mjs';
import { mergeCatalogs } from './merge.mjs';

const edit = (catalog, id, fields) => ({ ...catalog, photographs: catalog.photographs.map((r) => (r.id === id ? { ...r, ...fields } : r)) });

describe('change summary', () => {
  test('an untouched workspace has no changes', () => {
    expect(summarizeChanges(baseCatalog(), baseCatalog()).count).toBe(0);
  });

  test('reports added, withdrawn, edited, reordered, featured and hero changes', () => {
    const base = baseCatalog();
    let workspace = addDraft(base, record('delta', { caption: 'Delta', status: 'draft' }));
    workspace = setStatus(workspace, ['delta'], 'published');
    workspace = setStatus(workspace, ['beta'], 'draft');
    workspace = updatePhotograph(workspace, 'gamma', { caption: 'New caption', tags: ['Night'] });
    workspace = movePhotograph(workspace, 'gamma', 0);
    workspace = setHero(workspace, 'gamma');
    const summary = summarizeChanges(base, workspace);
    expect(summary).toMatchObject({
      added: ['delta'],
      withdrawn: ['beta'],
      edited: [{ id: 'gamma', fields: ['caption', 'tags'] }],
      moved: ['gamma'],
      hero: { before: 'alpha', after: 'gamma' },
      drafts: 1,
    });
    expect(summary.count).toBe(5);
  });

  test('a draft that never reaches the public gallery is not a public change', () => {
    const workspace = addDraft(baseCatalog(), record('secret', { caption: 'Private caption' }));
    const summary = summarizeChanges(baseCatalog(), workspace);
    expect(summary.count).toBe(0);
    expect(summary.newDrafts).toEqual(['secret']);
  });

  test('the pull request description lists every change and never mentions a draft', () => {
    const base = baseCatalog();
    let workspace = addDraft(base, record('secret', { caption: 'Private caption' }));
    workspace = addDraft(workspace, record('delta', { caption: 'Delta' }));
    workspace = setStatus(workspace, ['delta'], 'published');
    workspace = setFeatured(workspace, 'delta', 1);
    workspace = setStatus(workspace, ['beta'], 'draft');
    const body = pullRequestBody(summarizeChanges(base, workspace), workspace, { baseRef: 'origin/main', baseCommit: '0123456789abcdef0123' });
    expect(body).toContain('### Added (1)\n\n- `delta` "Delta"');
    expect(body).toContain('### Withdrawn (1)\n\n- `beta`');
    expect(body).toContain('### Featured');
    expect(body).toContain('`origin/main` at `0123456789ab`');
    expect(body).toMatch(/nothing here is live until this pull request is merged/);
    expect(body).not.toMatch(/secret|Private caption/);
  });
});

describe('three-way merge', () => {
  const base = baseCatalog();

  test('takes each side’s independent edits, including new photographs on both sides', () => {
    const ours = addDraft(edit(base, 'alpha', { caption: 'Ours' }), record('draft-one'));
    const theirs = { ...edit(base, 'beta', { alt: 'Theirs' }), photographs: [...edit(base, 'beta', { alt: 'Theirs' }).photographs, record('upstream')] };
    const { catalog, conflicts } = mergeCatalogs(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(catalog.photographs.find((r) => r.id === 'alpha').caption).toBe('Ours');
    expect(catalog.photographs.find((r) => r.id === 'beta').alt).toBe('Theirs');
    // The other side's new photograph goes right after the one that precedes it there.
    expect(catalog.photographs.map(({ id }) => id)).toEqual(['alpha', 'beta', 'gamma', 'upstream', 'draft-one']);
  });

  test('keeps our reordering when only we reordered', () => {
    const ours = movePhotograph(base, 'gamma', 0);
    const theirs = edit(base, 'beta', { caption: 'Theirs' });
    const { catalog } = mergeCatalogs(base, ours, theirs);
    expect(catalog.photographs.map(({ id }) => id)).toEqual(['gamma', 'alpha', 'beta']);
    expect(catalog.photographs[2].caption).toBe('Theirs');
  });

  test('reports conflicting edits and refuses to produce a catalog', () => {
    const ours = movePhotograph(edit(base, 'alpha', { caption: 'Ours' }), 'gamma', 0);
    const theirs = movePhotograph(edit(base, 'alpha', { caption: 'Theirs' }), 'beta', 0);
    const { catalog, conflicts } = mergeCatalogs(base, ours, theirs);
    expect(catalog).toBeNull();
    expect(conflicts).toEqual(['"alpha": caption changed on both sides', 'The curated order changed on both sides']);
  });

  test('a photograph removed upstream but edited locally is a conflict', () => {
    const ours = edit(base, 'beta', { caption: 'Still editing' });
    const theirs = { ...base, photographs: base.photographs.filter(({ id }) => id !== 'beta') };
    expect(mergeCatalogs(base, ours, theirs).conflicts).toEqual(['"beta" was removed on the base branch but edited in the workspace']);
    expect(mergeCatalogs(base, base, theirs).catalog.photographs.map(({ id }) => id)).toEqual(['alpha', 'gamma']);
  });
});
