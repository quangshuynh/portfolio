import { githubAsset, isPinnedGithubAsset, repositories } from './githubAssets.mjs';

test('builds commit-pinned jsDelivr GitHub URLs', () => {
  expect(githubAsset('ordixa', 'docs/images/workbook-summary.png')).toBe(
    `https://cdn.jsdelivr.net/gh/quangshuynh/ordixa@${repositories.ordixa.commit}/docs/images/workbook-summary.png`,
  );
  expect(githubAsset('hymical-forms', 'docs/images/logo1.png')).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/gh\/hymical\/forms@[0-9a-f]{40}\//);
});

test('every repository is pinned to a full commit SHA, never a branch', () => {
  for (const [key, pin] of Object.entries(repositories)) {
    expect(pin.commit, key).toMatch(/^[0-9a-f]{40}$/);
    expect(pin.owner, key).toMatch(/^[\w-]+$/);
    expect(pin.repo, key).toMatch(/^[\w.-]+$/);
  }
});

test('rejects unknown repositories and paths that are not repository images', () => {
  expect(() => githubAsset('not-a-repo', 'docs/a.png')).toThrow(/Unknown asset repository/);
  for (const path of ['/docs/a.png', '../secrets.png', 'docs/readme.md', 'docs/a.png?token=x', 'https://example.com/a.png']) {
    expect(() => githubAsset('ordixa', path), path).toThrow(/image path/);
  }
});

test('recognizes only pinned jsDelivr image URLs', () => {
  const sha = 'a'.repeat(40);
  expect(isPinnedGithubAsset(`https://cdn.jsdelivr.net/gh/quangshuynh/ordixa@${sha}/docs/images/a.png`)).toBe(true);
  for (const url of [
    'https://cdn.jsdelivr.net/gh/quangshuynh/ordixa@main/docs/images/a.png',
    'https://cdn.jsdelivr.net/gh/quangshuynh/ordixa@v1.0.0/docs/images/a.png',
    `http://cdn.jsdelivr.net/gh/quangshuynh/ordixa@${sha}/docs/images/a.png`,
    `https://raw.githubusercontent.com/quangshuynh/ordixa/${sha}/docs/images/a.png`,
    'https://github.com/quangshuynh/ordixa/blob/main/docs/images/a.png',
    `https://cdn.jsdelivr.net/gh/quangshuynh/ordixa@${sha}/docs/images/a.png?token=x`,
    'not a url',
  ]) {
    expect(isPinnedGithubAsset(url), url).toBe(false);
  }
});
