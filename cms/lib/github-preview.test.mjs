// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { publicPhotographs } from '../../scripts/photography-catalog.mjs';
import { baseCatalog, photograph } from '../test-helpers.mjs';
import { addDraft, movePhotograph, setStatus, updatePhotograph } from './catalog-ops.mjs';
import { redact } from './git.mjs';
import { createGitHubClient, resolveGitHubToken } from './github.mjs';
import { loadPreview } from './preview.mjs';
import { ingestUpload } from './uploads.mjs';
import { initWorkspace, readWorkspace, saveCatalog } from './workspace.mjs';

const response = (status, body) => ({ ok: status >= 200 && status < 300, status, statusText: 'x', json: async () => body });

describe('GitHub client', () => {
  test('creates pull requests with the token in the Authorization header only', async () => {
    const requests = [];
    const client = createGitHubClient({
      owner: 'quangshuynh', repo: 'portfolio', token: 'github_pat_secret123',
      fetch: async (url, init) => { requests.push({ url, init }); return response(201, { number: 7, html_url: 'https://github.com/x/pull/7', state: 'open' }); },
    });
    expect(await client.createPullRequest({ head: 'cms/x', base: 'main', title: 't', body: 'b' })).toEqual({ number: 7, url: 'https://github.com/x/pull/7', state: 'open' });
    expect(requests[0].url).toBe('https://api.github.com/repos/quangshuynh/portfolio/pulls');
    expect(requests[0].init.headers.Authorization).toBe('Bearer github_pat_secret123');
    expect(requests[0].url).not.toContain('secret');
    expect(JSON.parse(requests[0].init.body)).toMatchObject({ head: 'cms/x', base: 'main', maintainer_can_modify: false, draft: false });
  });

  test('turns authentication, permission, validation and network failures into clear errors', async () => {
    const make = (impl) => createGitHubClient({ owner: 'o', repo: 'r', token: 't', fetch: impl });
    await expect(make(async () => response(401, { message: 'Bad credentials' })).getPullRequest(1)).rejects.toMatchObject({ code: 'auth', status: 401 });
    await expect(make(async () => response(403, { message: 'Resource not accessible by personal access token' })).createPullRequest({}))
      .rejects.toMatchObject({ code: 'permission', message: expect.stringContaining('Contents and Pull requests write') });
    await expect(make(async () => response(422, { errors: [{ message: 'A pull request already exists' }] })).createPullRequest({}))
      .rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('already exists') });
    await expect(make(async () => { throw new Error('getaddrinfo ENOTFOUND'); }).getPullRequest(1)).rejects.toMatchObject({ code: 'network' });
    await expect(createGitHubClient({ owner: 'o', repo: 'r', token: null }).getPullRequest(1)).rejects.toMatchObject({ code: 'auth' });
  });

  test('reports merge state and per-environment deployment status', async () => {
    const routes = {
      '/pulls/5': { number: 5, html_url: 'u', state: 'closed', merged_at: '2026-10-22T00:00:00Z', merge_commit_sha: 'abc', head: { sha: 'h' } },
      '/deployments?sha=abc&per_page=20': [{ id: 1, environment: 'Production' }, { id: 2, environment: 'github-pages' }, { id: 3, environment: 'Production' }],
      '/deployments/1/statuses?per_page=1': [{ state: 'success' }],
      '/deployments/2/statuses?per_page=1': [{ state: 'in_progress' }],
    };
    const client = createGitHubClient({ owner: 'o', repo: 'r', token: 't', fetch: async (url) => response(200, routes[url.replace('https://api.github.com/repos/o/r', '')]) });
    expect(await client.getPullRequest(5)).toMatchObject({ state: 'merged', mergeCommit: 'abc' });
    expect(await client.deploymentStates('abc')).toEqual({ Production: 'success', 'github-pages': 'in_progress' });
  });

  test('prefers CMS_GITHUB_TOKEN, falls back to the GitHub CLI, and reports none', async () => {
    expect(await resolveGitHubToken({ env: { CMS_GITHUB_TOKEN: ' github_pat_x ' }, runGh: async () => ({ stdout: 'gho_y' }) })).toEqual({ token: 'github_pat_x', source: 'CMS_GITHUB_TOKEN' });
    expect(await resolveGitHubToken({ env: {}, runGh: async () => ({ stdout: 'gho_y\n' }) })).toEqual({ token: 'gho_y', source: 'gh' });
    expect(await resolveGitHubToken({ env: {}, runGh: async () => { throw new Error('gh missing'); } })).toEqual({ token: null, source: 'none' });
  });

  test('redacts credentials from git output', () => {
    expect(redact('fatal: https://x-access-token:ghp_abcdefghijklmnopqrstuvwxyz0123@github.com/o/r.git denied'))
      .toBe('fatal: https://***@github.com/o/r.git denied');
    expect(redact('token github_pat_11ABCDEFGHIJKLMNOPQRSTUV_xyz leaked')).toBe('token *** leaked');
  });
});

describe('preview', () => {
  let dir;
  beforeEach(async () => {
    dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'cms-preview-')), 'workspace');
    await initWorkspace(dir, { baseRef: 'main', baseCommit: 'abc', baseCatalog: baseCatalog() });
  });
  afterEach(() => rmSync(path.dirname(dir), { recursive: true, force: true }));

  const repoManifest = () => {
    const file = path.join(path.dirname(dir), 'manifest.json');
    const entries = baseCatalog().photographs.map(({ id, sourceFilename }) => ({ id, sourceFilename, galleryFilename: `${id}-gallery.jpg`, viewerFilename: `${id}-viewer.jpg`, galleryWidth: 900, galleryHeight: 600, viewerWidth: 2200, viewerHeight: 1467 }));
    return import('node:fs').then(({ writeFileSync }) => { writeFileSync(file, JSON.stringify(entries)); return file; });
  };

  test('shows the proposed gallery: pending order, captions, new photographs, nothing unpublished', async () => {
    const workspace = await readWorkspace(dir);
    const { record } = await ingestUpload(dir, { filename: 'new.jpg', bytes: await photograph() }, workspace.catalog);
    let catalog = addDraft(workspace.catalog, { ...record, caption: 'New one', alt: 'A new photograph' }, { index: 0 });
    const { record: secret } = await ingestUpload(dir, { filename: 'secret.jpg', bytes: await photograph({ color: { r: 9, g: 9, b: 9 } }) }, catalog);
    catalog = addDraft(catalog, { ...secret, caption: 'Secret', alt: 'Secret' });
    catalog = setStatus(catalog, ['new'], 'published');
    catalog = setStatus(catalog, ['beta'], 'draft');
    catalog = movePhotograph(updatePhotograph(catalog, 'gamma', { caption: 'Renamed' }), 'gamma', 1);
    await saveCatalog(dir, catalog, workspace.revision);

    const { collection, errors } = await loadPreview(dir, { manifestFile: await repoManifest() });
    expect(errors).toEqual([]);
    expect(collection.photographs.map(({ id, caption, curatedOrder }) => `${curatedOrder}:${id}:${caption}`)).toEqual(['1:new:New one', '2:gamma:Renamed', '3:alpha:Caption alpha']);
    expect(collection.generated.map(({ id }) => id)).toEqual(['new', 'gamma', 'alpha']);
    expect(collection.assetUrls).toEqual({ 'new-gallery.jpg': '/api/images/new-gallery.jpg', 'new-viewer.jpg': '/api/images/new-viewer.jpg' });
    expect(JSON.stringify(collection)).not.toMatch(/secret|Secret|"beta"/);
    expect(collection.photographs).toEqual(publicPhotographs({ ...catalog, photographs: catalog.photographs.filter(({ status }) => status === 'published') }));
  }, 60_000);

  test('refuses to preview a workspace that could not be published', async () => {
    const workspace = await readWorkspace(dir);
    await saveCatalog(dir, updatePhotograph(workspace.catalog, 'alpha', { caption: '' }), workspace.revision);
    const { collection, errors } = await loadPreview(dir, { manifestFile: await repoManifest() });
    expect(collection).toBeNull();
    expect(errors[0]).toMatch(/"caption" must be non-empty/);
  });
});
