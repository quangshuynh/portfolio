// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { githubAsset, pinnedAssetUrl, repositories } from '../src/data/githubAssets.mjs';
import { projects } from '../src/data/projects.mjs';
import {
  LARGE_BYTES, MAX_BYTES, applyDimensions, applyPins, collectExpectedAssets, formatPlan, parseArgs, planRepository, rawFileUrl,
  sameAspectRatio, writeFilesSafely,
} from './asset-refresh.mjs';

const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);
const TOKEN = 'ghp_example-token-never-printed';
const pin = { owner: 'quangshuynh', repo: 'demo', commit: OLD };
const assets = [
  { path: 'docs/images/demo-logo.png', slug: 'demo', kind: 'logo' },
  { path: 'docs/images/home.png', slug: 'demo', kind: 'screenshot', width: 1600, height: 1000 },
];

/**
 * fakes GitHub: the API names NEW as latest, and `files` maps raw paths to image
 * descriptions ({ width, height, format?, pad? }), an HTTP status, or a Response
 * :param overrides: { latest?, repo?, files?, compare?, at? } where `at` is the commit the files live at
 */
function fakeGithub({ latest, repo, files = {}, compare, at = NEW } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, authorization: init.headers?.Authorization });
    if (url.endsWith('/commits/HEAD')) return latest ?? new Response(NEW);
    if (url.endsWith(`/repos/${pin.owner}/${pin.repo}`)) return repo ?? Response.json({ private: false, visibility: 'public' });
    if (url.includes('/compare/')) {
      return compare ? Response.json({ files: compare.map((filename) => ({ filename })) }) : new Response('', { status: 500 });
    }
    const filePath = decodeURIComponent(url.split(`/${at}/`)[1] ?? '');
    const file = files[filePath];
    if (file instanceof Response) return file;
    if (typeof file === 'number') return new Response('', { status: file });
    if (!file) return new Response('404: Not Found', { status: 404 });
    return new Response(JSON.stringify({ ...file, pad: file.pad ? 'x'.repeat(file.pad) : undefined }));
  };
  const measure = async (buffer) => {
    const size = JSON.parse(buffer.toString());
    if (!size.width) throw new Error('not an image');
    return { width: size.width, height: size.height, format: size.format };
  };
  return { deps: { fetch, measure }, calls };
}

const logo = { width: 512, height: 512, format: 'png' };
const allPresent = { 'docs/images/demo-logo.png': logo, 'docs/images/home.png': { width: 1600, height: 1000, format: 'png' } };
const withHome = (home) => ({ ...allPresent, 'docs/images/home.png': home });

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
  const defaults = { dryRun: false, help: false, updateDimensions: false, allowAspectChange: false };

  test('defaults to every repository, a real run, and no size changes', () => {
    expect(parseArgs([], keys)).toEqual({ ...defaults, keys });
  });

  test('refreshes only the named repositories', () => {
    expect(parseArgs(['ordixa', '--dry-run'], keys)).toEqual({ ...defaults, dryRun: true, keys: ['ordixa'] });
    expect(parseArgs(['--project', 'flipper', '--project=ordixa', 'flipper'], keys).keys).toEqual(['flipper', 'ordixa']);
    expect(parseArgs(['-n', '-p', 'flipper'], keys)).toEqual({ ...defaults, dryRun: true, keys: ['flipper'] });
  });

  test('size changes are opt-in, and aspect-ratio changes need both flags and a named project', () => {
    expect(parseArgs(['--project', 'flipper', '--update-dimensions'], keys)).toMatchObject({ updateDimensions: true, allowAspectChange: false });
    expect(parseArgs(['--update-dimensions'], keys)).toMatchObject({ updateDimensions: true, keys });
    expect(parseArgs(['-p', 'flipper', '--update-dimensions', '--allow-aspect-change'], keys)).toMatchObject({ updateDimensions: true, allowAspectChange: true });
    expect(() => parseArgs(['-p', 'flipper', '--allow-aspect-change'], keys)).toThrow(/only applies together with --update-dimensions/);
    expect(() => parseArgs(['--update-dimensions', '--allow-aspect-change'], keys)).toThrow(/needs --project/);
  });

  test('rejects unknown repositories and options instead of refreshing everything', () => {
    expect(() => parseArgs(['ordxa'], keys)).toThrow(/Unknown repository ordxa. Known: ordixa, flipper, hymical-forms/);
    expect(() => parseArgs(['--dryrun'], keys)).toThrow(/Unknown option/);
    expect(() => parseArgs(['--update-dimension'], keys)).toThrow(/Unknown option/);
    expect(() => parseArgs(['--project'], keys)).toThrow(/needs a repository key/);
  });
});

describe('expected assets', () => {
  test('collects every logo source and remote screenshot from the real project data', () => {
    const expected = collectExpectedAssets(projects, repositories);
    expect(Object.keys(expected)).toEqual(Object.keys(repositories));
    const ordixa = projects.find((project) => project.slug === 'ordixa');
    expect(expected.ordixa).toContainEqual({ path: 'docs/images/ordixa-logo2.png', slug: 'ordixa', kind: 'logo' });
    expect(expected.ordixa).toContainEqual(expect.objectContaining({
      path: 'docs/images/workbook-summary.png', kind: 'screenshot', width: ordixa.screenshots[0].width, height: ordixa.screenshots[0].height,
    }));
    const remote = projects.flatMap((project) => [project.logo?.source, ...(project.screenshots ?? []).map((shot) => shot.src)]).filter(Boolean);
    expect(Object.values(expected).flat()).toHaveLength(new Set(remote).size);
  });

  test('skips hidden projects, so a retired project never blocks a refresh', () => {
    const flipper = projects.find((project) => project.slug === 'flipper');
    expect(collectExpectedAssets([{ ...flipper, hidden: true }], repositories).flipper).toEqual([]);
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
    expect(plan).toMatchObject({ status: 'update', from: OLD, to: NEW, problems: [], dimensions: [], changed: ['screenshot docs/images/home.png'] });
    expect(plan.sample).toBe(`https://cdn.jsdelivr.net/gh/quangshuynh/demo@${NEW}/docs/images/demo-logo.png`);
  });

  test('a screenshot replaced at the same path and size moves the pin with no size change', async () => {
    const { deps } = fakeGithub({ files: allPresent, compare: ['docs/images/home.png'] });
    const plan = await planRepository('demo', pin, assets, deps, { updateDimensions: true });
    expect(plan).toMatchObject({ status: 'update', to: NEW, dimensions: [] });
    expect(formatPlan(plan, true).join('\n')).toMatch(/would {2}demo .*aaaaaaa -> bbbbbbb[\s\S]*referenced images changed: screenshot docs\/images\/home\.png/);
  });

  test('blocks the update and names each missing asset', async () => {
    const { deps } = fakeGithub({ files: { 'docs/images/demo-logo.png': logo } });
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

  test('blocks on unreadable files and files it could not check', async () => {
    const { deps } = fakeGithub({ files: { 'docs/images/demo-logo.png': 503, 'docs/images/home.png': { lfs: true } } });
    expect((await planRepository('demo', pin, assets, deps)).problems).toEqual([
      'logo docs/images/demo-logo.png: HTTP 503, could not verify',
      'screenshot docs/images/home.png: not a readable image (Git LFS pointer or corrupt file?)',
    ]);

    const limited = fakeGithub({ files: withHome(429) });
    expect((await planRepository('demo', pin, assets, limited.deps)).problems).toEqual([
      'screenshot docs/images/home.png: rate limited by raw.githubusercontent.com (HTTP 429), could not verify',
    ]);

    const dropped = fakeGithub({ files: allPresent });
    const flaky = { ...dropped.deps, fetch: async (url, init) => (url.includes('raw.githubusercontent.com') ? Promise.reject(new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } })) : dropped.deps.fetch(url, init)) };
    const plan = await planRepository('demo', pin, assets, flaky);
    expect(plan.status).toBe('blocked');
    expect(plan.problems).toEqual([
      'logo docs/images/demo-logo.png: unreachable (ECONNRESET)',
      'screenshot docs/images/home.png: unreachable (ECONNRESET)',
    ]);
  });

  test('blocks formats browsers cannot show and files whose content does not match the name', async () => {
    const { deps } = fakeGithub({ files: withHome({ width: 1600, height: 1000, format: 'tiff' }) });
    expect((await planRepository('demo', pin, assets, deps)).problems[0]).toMatch(/home\.png: decodes as tiff, but the extension says png/);
    const renamed = fakeGithub({ files: withHome({ width: 1600, height: 1000, format: 'jpeg' }) });
    expect((await planRepository('demo', pin, assets, renamed.deps)).problems[0]).toMatch(/decodes as jpeg, but the extension says png/);
  });

  test('blocks unreasonably large files without downloading them, and warns about large ones', async () => {
    const declared = new Response('{}', { headers: { 'content-length': String(MAX_BYTES + 1) } });
    const { deps } = fakeGithub({ files: withHome(declared) });
    const plan = await planRepository('demo', pin, assets, deps);
    expect(plan.status).toBe('blocked');
    expect(plan.problems[0]).toMatch(/home\.png: 5121 KB is over the 5120 KB limit; optimize it/);

    const undeclared = fakeGithub({ files: withHome(new Response(new Uint8Array(MAX_BYTES + 1))) });
    expect((await planRepository('demo', pin, assets, undeclared.deps)).problems[0]).toMatch(/is over the 5120 KB limit/);

    const large = fakeGithub({ files: withHome({ width: 1600, height: 1000, format: 'png', pad: LARGE_BYTES }) });
    const warned = await planRepository('demo', pin, assets, large.deps);
    expect(warned.status).toBe('update');
    expect(warned.notes.join('\n')).toMatch(/screenshot docs\/images\/home\.png is 1025 KB; visitors download it at full size/);
  });

  test('reports an inaccessible repository without checking files', async () => {
    const { deps, calls } = fakeGithub({ latest: new Response('Not Found', { status: 404 }) });
    const plan = await planRepository('demo', pin, assets, deps);
    expect(plan).toMatchObject({ status: 'inaccessible', problems: ['repository not found or not public (HTTP 404)'] });
    expect(calls).toHaveLength(1);

    const reset = Date.UTC(2026, 9, 16, 14, 5) / 1000;
    const limited = fakeGithub({ latest: new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) } }) });
    expect((await planRepository('demo', pin, assets, limited.deps)).problems[0]).toBe('GitHub API rate limit reached (HTTP 403, resets at 14:05 UTC); set GITHUB_TOKEN and retry');

    const secondary = fakeGithub({ latest: new Response('', { status: 429, headers: { 'retry-after': '60' } }) });
    expect((await planRepository('demo', pin, assets, secondary.deps)).problems[0]).toMatch(/rate limit reached \(HTTP 429\)/);

    const offline = { ...deps, fetch: async () => { throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }); } };
    expect((await planRepository('demo', pin, assets, offline)).problems[0]).toBe('GitHub API unreachable (ENOTFOUND)');

    const timeout = { ...deps, fetch: async () => { throw new DOMException('timed out', 'TimeoutError'); } };
    expect((await planRepository('demo', pin, assets, timeout)).problems[0]).toBe('GitHub API timed out');
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

describe('screenshot dimension changes', () => {
  const retina = withHome({ width: 3200, height: 2000, format: 'png' });
  const squarer = withHome({ width: 1440, height: 1080, format: 'png' });

  test('a resized capture blocks the refresh by default and says how to accept it', async () => {
    const { deps } = fakeGithub({ files: retina });
    const plan = await planRepository('demo', pin, assets, deps);
    expect(plan.status).toBe('blocked');
    expect(plan.dimensions).toEqual([]);
    expect(plan.problems).toEqual([
      'screenshot docs/images/home.png: now 3200x2000, projects.mjs records 1600x1000 (same aspect ratio, demo); rerun with --update-dimensions to accept the new size',
    ]);
  });

  test('--update-dimensions accepts a same-shape resize and reports the change', async () => {
    const { deps } = fakeGithub({ files: retina, compare: ['docs/images/home.png'] });
    const plan = await planRepository('demo', pin, assets, deps, { updateDimensions: true });
    expect(plan).toMatchObject({ status: 'update', to: NEW, problems: [] });
    expect(plan.dimensions).toEqual([
      { slug: 'demo', path: 'docs/images/home.png', from: { width: 1600, height: 1000 }, to: { width: 3200, height: 2000 }, aspectChanged: false },
    ]);
    expect(formatPlan(plan, true)).toContain('            demo docs/images/home.png: 1600x1000 -> 3200x2000 (same aspect ratio)');
  });

  test('an aspect-ratio change is refused even with --update-dimensions', async () => {
    const { deps } = fakeGithub({ files: squarer });
    const plan = await planRepository('demo', pin, assets, deps, { updateDimensions: true });
    expect(plan.status).toBe('blocked');
    expect(plan.dimensions).toEqual([]);
    expect(plan.problems[0]).toMatch(/now 1440x1080, projects\.mjs records 1600x1000; aspect ratio changed from 1\.600 to 1\.333 \(demo\)\. .*--project demo --update-dimensions --allow-aspect-change/);
  });

  test('--allow-aspect-change accepts it and the report says so', async () => {
    const { deps } = fakeGithub({ files: squarer });
    const plan = await planRepository('demo', pin, assets, deps, { updateDimensions: true, allowAspectChange: true });
    expect(plan.status).toBe('update');
    expect(plan.dimensions[0]).toMatchObject({ to: { width: 1440, height: 1080 }, aspectChanged: true });
    expect(formatPlan(plan, false).join('\n')).toMatch(/1600x1000 -> 1440x1080 \(aspect ratio 1\.600 -> 1\.333, accepted by --allow-aspect-change\)/);
  });

  test('one bad file keeps every size change in that repository from applying', async () => {
    const { deps } = fakeGithub({ files: { ...retina, 'docs/images/demo-logo.png': 404 } });
    const plan = await planRepository('demo', pin, assets, deps, { updateDimensions: true });
    expect(plan.status).toBe('blocked');
  });

  test('with a current pin, --update-dimensions checks the pinned files and fixes stale sizes', async () => {
    const { deps, calls } = fakeGithub({ latest: new Response(OLD), files: retina, at: OLD });
    const plan = await planRepository('demo', pin, assets, deps, { updateDimensions: true });
    expect(plan).toMatchObject({ status: 'update', from: OLD, to: OLD });
    expect(plan.dimensions).toHaveLength(1);
    expect(plan.changed).toBeUndefined();
    expect(calls.some(({ url }) => url.includes('/compare/'))).toBe(false);
    expect(formatPlan(plan, true)[0]).toBe('would  demo (quangshuynh/demo): pin stays at aaaaaaa, recorded sizes change');

    const inSync = fakeGithub({ latest: new Response(OLD), files: allPresent, at: OLD });
    expect(await planRepository('demo', pin, assets, inSync.deps, { updateDimensions: true })).toMatchObject({ status: 'current' });
  });

  test('aspect ratios compare by shape within a small tolerance', () => {
    expect(sameAspectRatio({ width: 1600, height: 1000 }, { width: 2880, height: 1800 })).toBe(true);
    expect(sameAspectRatio({ width: 1600, height: 1929 }, { width: 1601, height: 1929 })).toBe(true);
    expect(sameAspectRatio({ width: 1600, height: 1000 }, { width: 1600, height: 1100 })).toBe(false);
  });
});

describe('GitHub token', () => {
  test('is optional: without one, no Authorization header is sent and no visibility call is made', async () => {
    const { deps, calls } = fakeGithub({ files: allPresent, compare: [] });
    await planRepository('demo', pin, assets, deps);
    expect(calls.every(({ authorization }) => authorization === undefined)).toBe(true);
    expect(calls.some(({ url }) => url.endsWith('/repos/quangshuynh/demo'))).toBe(false);
  });

  test('is sent only to api.github.com, never to file downloads, and never appears in the report', async () => {
    const { deps, calls } = fakeGithub({ files: allPresent, compare: [] });
    const plan = await planRepository('demo', pin, assets, { ...deps, token: TOKEN });
    for (const { url, authorization } of calls) {
      expect(authorization, url).toBe(new URL(url).host === 'api.github.com' ? `Bearer ${TOKEN}` : undefined);
    }
    expect(calls.filter(({ url }) => url.includes('raw.githubusercontent.com'))).toHaveLength(2);
    expect(JSON.stringify(plan) + formatPlan(plan, false).join('\n')).not.toContain(TOKEN);
  });

  test('a repository the token can see but the public cannot is refused', async () => {
    const { deps, calls } = fakeGithub({ repo: Response.json({ private: true, visibility: 'private' }), files: allPresent });
    const plan = await planRepository('demo', pin, assets, { ...deps, token: TOKEN });
    expect(plan).toMatchObject({ status: 'inaccessible', problems: [expect.stringMatching(/repository is private/)] });
    expect(calls).toHaveLength(1);
  });

  test('a rejected token is reported without echoing it', async () => {
    const { deps } = fakeGithub({ repo: new Response('', { status: 401 }) });
    const plan = await planRepository('demo', pin, assets, { ...deps, token: TOKEN });
    expect(plan.problems).toEqual(['GitHub rejected the token (HTTP 401); check GITHUB_TOKEN or unset it']);
    expect(formatPlan(plan, false).join('\n')).not.toContain(TOKEN);
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

describe('writing screenshot sizes', () => {
  const source = readFileSync(new URL('../src/data/projects.mjs', import.meta.url), 'utf8');
  const flipper = projects.find((project) => project.slug === 'flipper');
  const research = flipper.screenshots[1];
  const researchPath = research.src.split(`@${repositories.flipper.commit}/`)[1];
  const changedLines = (next) => next.split('\n').map((line, index) => [line, source.split('\n')[index]]).filter(([line, old]) => line !== old);

  test('changes only the width and height of the named screenshot in the real projects.mjs', () => {
    const next = applyDimensions(source, 'flipper', [
      { path: researchPath, from: { width: research.width, height: research.height }, to: { width: 1234, height: 567 } },
    ]);
    expect(changedLines(next).map(([line]) => line.trim())).toEqual(['width: 1234,', 'height: 567,']);
    // The neighbouring Flipper captures keep their sizes.
    const dashboard = next.slice(next.indexOf(flipper.screenshots[0].src.split('/').pop()));
    expect(dashboard.slice(0, 120)).toContain(`width: ${flipper.screenshots[0].width}`);
  });

  test('handles several screenshots in one pass', () => {
    const updates = flipper.screenshots.map((shot) => ({
      path: shot.src.split(`@${repositories.flipper.commit}/`)[1], from: { width: shot.width, height: shot.height }, to: { width: shot.width + 1, height: shot.height + 1 },
    }));
    expect(changedLines(applyDimensions(source, 'flipper', updates))).toHaveLength(flipper.screenshots.length * 2);
  });

  test('refuses to write when the recorded size is not what the plan saw', () => {
    expect(() => applyDimensions(source, 'flipper', [{ path: researchPath, from: { width: 1, height: research.height }, to: { width: 2, height: 2 } }]))
      .toThrow(/width is \d+ in projects\.mjs, expected 1; was it edited during the run/);
  });

  test('refuses unknown or ambiguous screenshots and invalid sizes', () => {
    const size = { from: { width: 1, height: 1 }, to: { width: 2, height: 2 } };
    expect(() => applyDimensions(source, 'flipper', [{ path: 'docs/images/nope.png', ...size }])).toThrow(/expected one screenshot src in projects\.mjs, found 0/);
    // The logo source is not a screenshot entry.
    expect(() => applyDimensions(source, 'flipper', [{ path: 'docs/images/flipper-logo2.png', ...size }])).toThrow(/found 0/);
    const twice = `${source}\nconst x = [{ src: githubAsset('flipper', '${researchPath}'), width: 1, height: 1 }];`;
    expect(() => applyDimensions(twice, 'flipper', [{ path: researchPath, ...size }])).toThrow(/found 2/);
    expect(() => applyDimensions(source, 'flipper', [{ path: researchPath, from: size.from, to: { width: 0, height: 2 } }])).toThrow(/non-positive/);
  });

  test('ignores braces inside strings and comments when finding the entry', () => {
    const tricky = `const p = [{
  // a comment with a stray } brace
  alt: 'text with { and } inside',
  src: githubAsset('demo', 'docs/a.png'),
  caption: "more } braces {",
  width: 10,
  height: 20,
}, { src: githubAsset('demo', 'docs/b.png'), width: 10, height: 20 }];`;
    const next = applyDimensions(tricky, 'demo', [{ path: 'docs/a.png', from: { width: 10, height: 20 }, to: { width: 30, height: 60 } }]);
    expect(next).toContain('width: 30,\n  height: 60,');
    expect(next).toContain("src: githubAsset('demo', 'docs/b.png'), width: 10, height: 20");
  });
});

describe('writing files safely', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'asset-refresh-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const file = (name, text) => { const target = path.join(dir, name); writeFileSync(target, text); return target; };
  const leftovers = () => readdirSync(dir).filter((name) => name.includes('refresh-tmp'));

  test('replaces every file once all of them are staged and verified', async () => {
    const pins = file('pins.mjs', 'old pins');
    const data = file('data.mjs', 'old data');
    const verified = [];
    await writeFilesSafely([
      { file: pins, original: 'old pins', content: 'new pins', verify: async (temp) => verified.push(readFileSync(temp, 'utf8')) },
      { file: data, original: 'old data', content: 'new data' },
    ]);
    expect(verified).toEqual(['new pins']);
    expect([readFileSync(pins, 'utf8'), readFileSync(data, 'utf8')]).toEqual(['new pins', 'new data']);
    expect(leftovers()).toEqual([]);
  });

  test('a failed verification leaves every file untouched', async () => {
    const pins = file('pins.mjs', 'old pins');
    const data = file('data.mjs', 'old data');
    await expect(writeFilesSafely([
      { file: pins, original: 'old pins', content: 'new pins' },
      { file: data, original: 'old data', content: 'broken', verify: async () => { throw new Error('staged projects differs'); } },
    ])).rejects.toThrow('staged projects differs');
    expect([readFileSync(pins, 'utf8'), readFileSync(data, 'utf8')]).toEqual(['old pins', 'old data']);
    expect(leftovers()).toEqual([]);
  });

  test('a file edited during the run is never overwritten', async () => {
    const pins = file('pins.mjs', 'edited by hand meanwhile');
    await expect(writeFilesSafely([{ file: pins, original: 'old pins', content: 'new pins' }])).rejects.toThrow(/changed on disk during the run/);
    expect(readFileSync(pins, 'utf8')).toBe('edited by hand meanwhile');
  });

  test('if the second swap fails, the first file is restored', async () => {
    const pins = file('pins.mjs', 'old pins');
    const data = file('data.mjs', 'old data');
    let renames = 0;
    const fs = { readFile, writeFile, rm, rename: async (from, to) => { renames += 1; if (renames === 2) throw new Error('EPERM'); return rename(from, to); } };
    await expect(writeFilesSafely([
      { file: pins, original: 'old pins', content: 'new pins' },
      { file: data, original: 'old data', content: 'new data' },
    ], { fs })).rejects.toThrow(/could not replace files \(EPERM\); restored pins\.mjs/);
    expect([readFileSync(pins, 'utf8'), readFileSync(data, 'utf8')]).toEqual(['old pins', 'old data']);
    expect(leftovers()).toEqual([]);
  });
});
