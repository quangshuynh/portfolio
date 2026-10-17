// Project screenshots are served straight from each project's public GitHub
// repository through jsDelivr's GitHub endpoint, pinned to a full commit SHA.
// A pinned URL is immutable (jsDelivr answers with a one-year `immutable`
// Cache-Control), so a deploy always shows exactly the images it was built
// against. Branch URLs such as @main are cached for days at unpredictable
// edges and can change underneath a deploy, so they are rejected here.
// See docs/project-assets.md for the rationale and docs/PROJECT_MAINTENANCE.md
// for the workflow.

export const ASSET_HOST = 'cdn.jsdelivr.net';

// One pin per public repository. `npm run assets:refresh` bumps these SHAs after
// checking that every referenced image exists at the new commit; edit by hand
// only to add a repository. Each pin stays on one line so the script can update
// a single `commit` value without touching anything else.
export const repositories = {
  ordixa: { owner: 'quangshuynh', repo: 'ordixa', commit: 'f6f9c0b0f7a0ee3017463dee3f462a8b7381f55e' },
  flipper: { owner: 'quangshuynh', repo: 'flipper', commit: '652b25cfbb73fa44d4d47a3dfcf2b228176526aa' },
  gitprofilelens: { owner: 'quangshuynh', repo: 'gitprofilelens', commit: 'efefe676f02327c2404f5f817437ff292ba891e7' },
  scribekit: { owner: 'quangshuynh', repo: 'scribekit', commit: '33232da133c71f264d341f0527e11335873d45e4' },
  puzzlepress: { owner: 'quangshuynh', repo: 'puzzlepress', commit: '7491b7ea51db95b1e386765a58ced445314767ea' },
  dashpilot: { owner: 'quangshuynh', repo: 'dashpilot', commit: '8d6ceffa8caab866c23d929ab4d0ea21471f6eb0' },
  casenotes: { owner: 'quangshuynh', repo: 'casenotes', commit: '46a3f991ad19496b453d3b5c08c4ec4177abf01f' },
  'repo-radar': { owner: 'quangshuynh', repo: 'repo-radar', commit: '3abf290cf33e27aa1d2651591ce5f9185c6a1750' },
  chessed: { owner: 'quangshuynh', repo: 'chessed', commit: '7d5f22f4929ef76f92e39be666cda667011e53df' },
  inboxsweep: { owner: 'quangshuynh', repo: 'inboxsweep', commit: 'a2429fb1d23eb3b06a8dd9e5c65ee30952ba292f' },
  'hymical-forms': { owner: 'hymical', repo: 'forms', commit: '235f8afe0c056449f3226250854a03d6a82cb7b6' },
};

const COMMIT = /^[0-9a-f]{40}$/;
const IMAGE_PATH = /^(?!\/)(?!.*\.\.)[\w./-]+\.(png|jpe?g|webp|avif|gif|svg)$/i;

/**
 * builds a commit-pinned jsDelivr URL for a file in a registered repository
 * :param key: key in `repositories`
 * :param path: repository-relative image path, e.g. docs/images/logo.png
 * :returns: https://cdn.jsdelivr.net/gh/OWNER/REPO@SHA/PATH
 */
export function githubAsset(key, path) {
  const pin = repositories[key];
  if (!pin) throw new Error(`Unknown asset repository: ${key}`);
  return pinnedAssetUrl(pin, path, key);
}

/**
 * builds a commit-pinned jsDelivr URL from an explicit pin
 * :param pin: { owner, repo, commit }
 * :param path: repository-relative image path
 * :param label: name used in error messages
 * :returns: https://cdn.jsdelivr.net/gh/OWNER/REPO@SHA/PATH
 */
export function pinnedAssetUrl(pin, path, label = `${pin.owner}/${pin.repo}`) {
  if (!COMMIT.test(pin.commit)) throw new Error(`${label} must be pinned to a full 40-character commit SHA`);
  if (!IMAGE_PATH.test(path)) throw new Error(`Not a repository-relative image path: ${path}`);
  return `https://${ASSET_HOST}/gh/${pin.owner}/${pin.repo}@${pin.commit}/${path}`;
}

/**
 * checks that a URL is a commit-pinned jsDelivr GitHub image URL
 * :param url: candidate URL
 * :returns: true when the URL could have come from githubAsset
 */
export function isPinnedGithubAsset(url) {
  return parsePinnedGithubAsset(url) !== null;
}

/**
 * splits a commit-pinned jsDelivr GitHub image URL into its parts
 * :param url: candidate URL
 * :returns: { owner, repo, commit, path }, or null when the URL is not pinned
 */
export function parsePinnedGithubAsset(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const match = parsed.pathname.match(/^\/gh\/([\w.-]+)\/([\w.-]+)@([^/]+)\/(.+)$/);
  if (parsed.protocol !== 'https:' || parsed.host !== ASSET_HOST || parsed.search || parsed.hash || !match) return null;
  const [, owner, repo, commit, path] = match;
  return COMMIT.test(commit) && IMAGE_PATH.test(path) ? { owner, repo, commit, path } : null;
}
