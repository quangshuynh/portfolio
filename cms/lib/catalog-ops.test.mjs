// @vitest-environment node
import { catalogErrors, publicPhotographs } from '../../scripts/photography-catalog.mjs';
import { baseCatalog, record } from '../test-helpers.mjs';
import {
  CatalogEditError, addCollection, addDraft, idFromFilename, moveCollection, movePhotograph, movePhotographBy,
  publicationCatalog, removeCollection, removeDrafts, renameCollection, setCollection, setFeatured, setHero,
  setStatus, stableIdentityErrors, updatePhotograph, workspaceProblems,
} from './catalog-ops.mjs';

const ids = (catalog) => catalog.photographs.map(({ id }) => id);
const featured = (catalog) => catalog.photographs.filter((r) => r.featured).sort((a, b) => a.featured - b.featured).map(({ id }) => id);

describe('editing', () => {
  test('operations return new catalogs and never mutate the input', () => {
    const catalog = baseCatalog();
    const before = JSON.stringify(catalog);
    movePhotograph(catalog, 'alpha', 2);
    setStatus(catalog, ['beta'], 'draft');
    updatePhotograph(catalog, 'beta', { caption: 'New' });
    expect(JSON.stringify(catalog)).toBe(before);
  });

  test('metadata updates tidy optional fields so the validator accepts them', () => {
    let catalog = updatePhotograph(baseCatalog(), 'beta', { caption: 'Woods', tags: ['Night'], metadata: { lens: 'Corrected' } });
    expect(catalog.photographs[1]).toMatchObject({ caption: 'Woods', tags: ['Night'], metadata: { lens: 'Corrected' } });
    catalog = updatePhotograph(catalog, 'beta', { tags: [], metadata: {} });
    expect(catalog.photographs[1]).not.toHaveProperty('tags');
    expect(catalog.photographs[1]).not.toHaveProperty('metadata');
    expect(catalogErrors(catalog)).toEqual([]);
  });

  test('published photographs keep their id, slug and source file', () => {
    const base = baseCatalog();
    expect(() => updatePhotograph(base, 'alpha', { slug: 'renamed' }, { base })).toThrow(CatalogEditError);
    expect(() => updatePhotograph(base, 'alpha', { sourceFilename: 'other.JPG' }, { base })).toThrow(/cannot change/);
    expect(() => updatePhotograph(base, 'alpha', { id: 'x' })).toThrow(/fixed id/);
    const draft = addDraft(base, record('new', { status: 'draft' }));
    expect(updatePhotograph(draft, 'new', { slug: 'new-slug' }, { base }).photographs.at(-1).slug).toBe('new-slug');
    expect(stableIdentityErrors(base, { ...base, photographs: base.photographs.map((r) => (r.id === 'beta' ? { ...r, slug: 'x' } : r)) }))
      .toEqual(['"beta" is published, so its slug cannot change (was "beta").']);
  });

  test('reordering is deterministic and persistent in array order', () => {
    let catalog = movePhotograph(baseCatalog(), 'gamma', 0);
    expect(ids(catalog)).toEqual(['gamma', 'alpha', 'beta']);
    catalog = movePhotographBy(catalog, 'gamma', 1);
    expect(ids(catalog)).toEqual(['alpha', 'gamma', 'beta']);
    expect(ids(movePhotograph(catalog, 'alpha', 99))).toEqual(['gamma', 'beta', 'alpha']);
    expect(publicPhotographs(catalog).map(({ id, curatedOrder }) => `${curatedOrder}:${id}`)).toEqual(['1:alpha', '2:gamma', '3:beta']);
  });

  test('featured positions shift to stay 1..n', () => {
    let catalog = setFeatured(baseCatalog(), 'beta', 1);
    expect(featured(catalog)).toEqual(['beta', 'alpha', 'gamma']);
    catalog = setFeatured(catalog, 'alpha', null);
    expect(featured(catalog)).toEqual(['beta', 'gamma']);
    expect(catalog.photographs.map((r) => r.featured ?? null)).toEqual([null, 1, 2]);
    expect(catalogErrors(catalog)).toEqual([]);
  });

  test('draft and published transitions keep the catalog valid', () => {
    let catalog = setStatus(baseCatalog(), ['gamma'], 'draft');
    expect(catalog.photographs[2]).not.toHaveProperty('featured');
    expect(featured(catalog)).toEqual(['alpha']);
    expect(catalogErrors(catalog)).toEqual([]);
    expect(() => setStatus(catalog, ['alpha'], 'draft')).toThrow(/hero/);
    expect(() => setFeatured(catalog, 'gamma', 1)).toThrow(/Publish/);
    expect(() => setHero(catalog, 'gamma')).toThrow(/must be published/);
    catalog = setStatus(catalog, ['gamma'], 'published');
    expect(catalogErrors(catalog)).toEqual([]);
    expect(() => removeDrafts(catalog, ['gamma'])).toThrow(/Unpublish/);
    expect(ids(removeDrafts(setStatus(catalog, ['gamma'], 'draft'), ['gamma']))).toEqual(['alpha', 'beta']);
  });

  test('collections: move, rename, reorder, add and remove', () => {
    let catalog = setCollection(baseCatalog(), ['alpha', 'gamma'], 'Nature');
    expect(catalog.photographs.map(({ category }) => category)).toEqual(['Nature', 'Nature', 'Nature']);
    catalog = renameCollection(catalog, 'Nature', 'Woods');
    expect(catalog.categories).toEqual(['Places', 'Woods']);
    expect(new Set(catalog.photographs.map(({ category }) => category))).toEqual(new Set(['Woods']));
    catalog = moveCollection(addCollection(catalog, 'Cars'), 'Cars', 0);
    expect(catalog.categories).toEqual(['Cars', 'Places', 'Woods']);
    expect(removeCollection(catalog, 'Places').categories).toEqual(['Cars', 'Woods']);
    expect(() => removeCollection(catalog, 'Woods')).toThrow(/Move the 3 photographs/);
    expect(() => addCollection(catalog, 'woods')).toThrow(/already exists/);
    expect(() => setCollection(catalog, ['alpha'], 'Missing')).toThrow(/Unknown collection/);
    expect(catalogErrors(catalog)).toEqual([]);
  });
});

describe('publication view', () => {
  test('drafts are removed entirely and their problems do not block publication', () => {
    const workspace = addDraft(baseCatalog(), record('secret', { caption: '', alt: '' }));
    const publication = publicationCatalog(workspace);
    expect(ids(publication)).toEqual(['alpha', 'beta', 'gamma']);
    const problems = workspaceProblems(workspace, { base: baseCatalog() });
    expect(problems.publication).toEqual([]);
    expect(problems.drafts.secret).toEqual(expect.arrayContaining(['"caption" must be non-empty text without surrounding spaces.']));
  });

  test('invalid public edits are reported before publication', () => {
    const broken = { ...baseCatalog(), photographs: baseCatalog().photographs.map((r) => (r.id === 'beta' ? { ...r, alt: '' } : r)) };
    expect(workspaceProblems(broken, { base: baseCatalog() }).publication).toEqual([
      'photographs[1] ("beta"): "alt" must be non-empty text without surrounding spaces.',
    ]);
  });

  test('ids from file names are safe and unique', () => {
    expect(idFromFilename('DSC TEST (1).JPG', [])).toBe('DSC-TEST-1');
    expect(idFromFilename('alpha.jpg', ['alpha', 'Alpha-2'])).toBe('alpha-3');
    expect(idFromFilename('../../etc/passwd', [])).toBe('passwd');
    expect(idFromFilename('.jpg', [])).toBe('photograph');
  });
});
