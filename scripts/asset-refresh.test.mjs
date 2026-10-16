// @vitest-environment node
import { readFileSync } from 'node:fs';
import { githubAsset, pinnedAssetUrl, repositories } from '../src/data/githubAssets.mjs';
import { projects } from '../src/data/projects.mjs';
import { applyPins, collectExpectedAssets, formatPlan, parseArgs, planRepository, rawFileUrl } from './asset-refresh.mjs';

const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);
const pin = { owner: 'quangshuynh', repo: 'demo', commit: OLD };
const assets = [
  { path: 'docs/images/demo-logo.png', slug: 'demo', kind: 'logo' },
  { path: 'docs/images/home.png', slug: 'demo', kind: 'screenshot', width: 1600, height: 1000 },
];

/**
 * fakes GitHub: the API names NEW as latest, and `files` maps raw paths to image sizes
 * :param overrides: { latest?: Response, files?: { [path]: { width, height } | number }, compare?: string[] }
 */
function fakeGithub({ latest, files = {}, compare } = {}) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url.endsWith('/commits/HEAD')) return latest ?? new Response(NEW);
    if (url.includes('/compare/')) {
      return compare ? Response.json({ files: compare.map((filename) => ({ filename })) }) : new Response('', { status: 500 });
    }
    const path = decodeURIComponent(url.split(`/${NEW}/`)[1]);
    const file = files[path];
    if (typeof file === 'number') return new Response('', { status: file });
    if (!file) return new Response('404: Not Found', { status: 404 });
    return new Response(JSON.stringify(file));
  };
  const measure = async (buffer) => {
    const size = JSON.parse(buffer.toString());
    if (!size.width) throw new Error('not an image');
    return size;
  };
  return { deps: { fetch, measure }, calls };
}

const allPresent = { 'docs/images/demo-logo.png': { width: 512, height: 512 }, 'docs/images/home.png': { width: 1600, height: 1000 } };

describe('URL generation', () => {
  test('a refreshed pin produces the same URL shape githubAsset builds, at the new commit', () => {
    const current = githubAsset('ordixa', 'docs/images/workbook-summary.png');
    const refreshed = pinnedAssetUrl({ ...repositories.ordixa, commit: NEW }, 'docs/images/workbook-summary.png');
    expect(refreshed).toBe(current.replace(repositories.ordixa.commit, NEW));
    expect(refreshed).toBe(`https://cdn.jsdelivr.net/gh/quangshuynh/ordixa@${NEW}/docs/images/workbook-summary.png`);
  });

  test('never builds a URL from a branch or short ref', () => {
    for (const commit of ['main', 'HEAD', 'abc1234', `${OLD}x`]) {
      expect(() => pinnedAssetUrl({ ...pin, commit }, 'docs/a.png'), commit).toThrow(/40-character commit SHA/);
    }
  });

  test('checks existence through an unauthenticated raw URL at the exact commit', () => {
    expect(rawFileUrl(pin, 'docs/images/my shot.png')).toBe(
      `https://raw.githubusercontent.com/quangshuynh/demo/${OLD}/docs/images/my%20shot.png`,
    );
  });
});

describe('arguments', () => {
  const keys = ['ordixa', 'flipper', 'hymical-forms'];

  test('defaults to every repository and a real run', () => {
    expect(parseArgs([], keys)).toEqual({ dryRun: false, help: false, keys });
  });

  test('refreshes only the named repositories', () => {
    expect(parseArgs(['ordixa', '--dry-run'], keys)).toEqual({ dryRun: true, help: false, keys: ['ordixa'] });
    expect(parseArgs(['--project', 'flipper', '--project=ordixa', 'flipper'], keys).keys).toEqual(['flipper', 'ordixa']);
  });

  test('rejects unknown repositories and options instead of refreshing everything', () => {
    expect(() => parseArgs(['ordxa'], keys)).toThrow(/Unknown repository ordxa. Known: ordixa, flipper, hymical-forms/);
    expect(() => parseArgs(['--dryrun'], keys)).toThrow(/Unknown option/);
    expect(() => parseArgs(['--project'], keys)).toThrow(/needs a repository key/);
  });
});

describe('expected assets', () => {
  test('collects every logo source and remote screenshot from the real project data', () => {
    const expected = collectExpectedAssets(projects, repositories);
    expect(Object.keys(expected)).toEqual(Object.keys(repositories));
    expect(expected.ordixa).toContainEqual({ path: 'docs/images/ordixa-logo2.png', slug: 'ordixa', kind: 'logo' });
    expect(expected.ordixa).toContainEqual(expect.objectContaining({ path: 'docs/images/workbook-summary.png', kind: 'screenshot', width: 1601, height: 1929 }));
    const remote = projects.flatMap((project) => [project.logo?.source, ...(project.screenshots ?? []).map((shot) => shot.src)]).filter(Boolean);
    expect(Object.values(expected).flat()).toHaveLength(new Set(remote).size);
  });

  test('refuses images from a repository that has no pin', () => {
    const stray = [{ slug: 'x', screenshots: [{ src: `https://cdn.jsdelivr.net/gh/someone/else@${OLD}/a.png`, width: 1, height: 1 }] }];
    expect(() => collectExpectedAssets(stray, repositories)).toThrow(/someone\/else, which has no pin/);
  });
});

describe('planning a refresh', () => {
  test('proposes the new commit when every asset exists at the recorded size', async () => {
    const { deps } = fakeGithub({ files: allPresent, compare: ['docs/images/home.png', 'README.md'] });
    const plan = await planRepository('demo', pin, assets, deps);
    expect(plan).toMatchObject({ status: 'update', from: OLD, to: NEW, problems: [], changed: ['screenshot docs/images/home.png'] });
    expect(plan.sample).toBe(`https://cdn.jsdelivr.net/gh/quangshuynh/demo@${NEW}/docs/images/demo-logo.png`);
  });

  test('blocks the update and names each missing asset', async () => {
    const { deps } = fakeGithub({ files: { 'docs/images/demo-logo.png': allPresent['docs/images/demo-logo.png'] } });
    const plan = await planRepository('demo', pin, assets, deps);
    expect(plan.status).toBe('blocked');
    expect(plan.problems).toEqual(['screenshot docs/images/home.png: not found at this commit']);
    expect(formatPlan(plan, false).join('\n')).toMatch(/SKIP {4}demo .*pin stays at aaaaaaa[\s\S]*home\.png: not found/);
  });

  test('explains when every asset is missing', async () => {
    const { deps } = fakeGithub();
    const plan = await planRepository('demo', pin, assets, deps);
    expect(plan.status).toBe('blocked');
    expect(plan.problems).toHaveLength(2);
    expect(plan.notes.join(' ')).toMatch(/moved, or the repository may have gone private/);
  });

  test('blocks on unreadable files, changed dimensions, and files it could not check', async () => {
    const { deps } = fakeGithub({ files: { 'docs/images/demo-logo.png': 503, 'docs/images/home.png': { width: 1440, height: 900 } } });
    const plan = await planRepository('demo', pin, assets, deps);
    expect(plan.status).toBe('blocked');
    expect(plan.problems).toEqual([
      'logo docs/images/demo-logo.png: HTTP 503, could not verify',
      'screenshot docs/images/home.png: now 1440x900, projects.mjs records 1600x1000 (same aspect ratio, demo); update width and height there, then rerun',
    ]);

    const lfs = fakeGithub({ files: { ...allPresent, 'docs/images/home.png': { lfs: true } } });
    expect((await planRepository('demo', pin, assets, lfs.deps)).problems).toEqual([
      'screenshot docs/images/home.png: not a readable image (Git LFS pointer or corrupt file?)',
    ]);
  });

  test('reports an inaccessible repository without checking files', async () => {
    const { deps, calls } = fakeGithub({ latest: new Response('Not Found', { status: 404 }) });
    const plan = await planRepository('demo', pin, assets, deps);
    expect(plan).toMatchObject({ status: 'inaccessible', problems: ['repository not found or not public (HTTP 404)'] });
    expect(calls).toHaveLength(1);

    const limited = fakeGithub({ latest: new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }) });
    expect((await planRepository('demo', pin, assets, limited.deps)).problems[0]).toMatch(/rate limit.*GITHUB_TOKEN/);

    const offline = { ...deps, fetch: async () => { throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }); } };
    expect((await planRepository('demo', pin, assets, offline)).problems[0]).toBe('GitHub API unreachable (ENOTFOUND)');
  });

  test('leaves a current pin alone without downloading anything', async () => {
    const { deps, calls } = fakeGithub({ latest: new Response(OLD) });
    expect(await planRepository('demo', pin, assets, deps)).toMatchObject({ status: 'current', from: OLD, to: OLD });
    expect(calls).toHaveLength(1);
  });

  test('asks for prepare:images when the logo changed', async () => {
    const { deps } = fakeGithub({ files: allPresent, compare: ['docs/images/demo-logo.png'] });
    expect((await planRepository('demo', pin, assets, deps)).notes).toContain('logo changed: run npm run prepare:images to regenerate its WebP derivative');
  });
});

describe('writing pins', () => {
  const source = readFileSync(new URL('../src/data/githubAssets.mjs', import.meta.url), 'utf8');

  test('changes only the refreshed commit and leaves everything else byte-for-byte', () => {
    const from = repositories.flipper.commit;
    const next = applyPins(source, [{ key: 'flipper', from, to: NEW }]);
    expect(next).toBe(source.replace(from, NEW));
    expect(next.split(/\r?\n/).filter((line, index) => line !== source.split(/\r?\n/)[index])).toEqual([
      `  flipper: { owner: 'quangshuynh', repo: 'flipper', commit: '${NEW}' },`,
    ]);
  });

  test('refuses ambiguous or non-SHA pins', () => {
    expect(() => applyPins(`a: '${OLD}', b: '${OLD}'`, [{ key: 'a', from: OLD, to: NEW }])).toThrow(/exactly once.*found 2/);
    expect(() => applyPins(source, [{ key: 'flipper', from: OLD, to: NEW }])).toThrow(/found 0/);
    expect(() => applyPins(source, [{ key: 'flipper', from: repositories.flipper.commit, to: 'main' }])).toThrow(/non-SHA/);
  });
});
