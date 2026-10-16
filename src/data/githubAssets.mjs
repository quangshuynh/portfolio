// Project screenshots are served straight from each project's public GitHub
// repository through jsDelivr's GitHub endpoint, pinned to a full commit SHA.
// A pinned URL is immutable (jsDelivr answers with a one-year `immutable`
// Cache-Control), so a deploy always shows exactly the images it was built
// against. Branch URLs such as @main are cached for days at unpredictable
// edges and can change underneath a deploy, so they are rejected here.
// See docs/project-assets.md for the workflow.

export const ASSET_HOST = 'cdn.jsdelivr.net';

// One pin per public repository. Bump a SHA (and re-run `npm run check:assets`)
// to pick up new or changed images from that repository.
export const repositories = {
  ordixa: { owner: 'quangshuynh', repo: 'ordixa', commit: '06d4e4d70fc6924fbf2b71791a85363bd1bbfb3a' },
  flipper: { owner: 'quangshuynh', repo: 'flipper', commit: '921dac59074cbcf2ba777cc5f00c4b6c4668f8e4' },
  gitprofilelens: { owner: 'quangshuynh', repo: 'gitprofilelens', commit: 'efefe676f02327c2404f5f817437ff292ba891e7' },
  scribekit: { owner: 'quangshuynh', repo: 'scribekit', commit: '33232da133c71f264d341f0527e11335873d45e4' },
  dashpilot: { owner: 'quangshuynh', repo: 'dashpilot', commit: 'e8a8f22d46dfafa6ee1c22116bca5419e42a301a' },
  casenotes: { owner: 'quangshuynh', repo: 'casenotes', commit: '46a3f991ad19496b453d3b5c08c4ec4177abf01f' },
  'repo-radar': { owner: 'quangshuynh', repo: 'repo-radar', commit: '3abf290cf33e27aa1d2651591ce5f9185c6a1750' },
  chessed: { owner: 'quangshuynh', repo: 'chessed', commit: '7d5f22f4929ef76f92e39be666cda667011e53df' },
  inboxsweep: { owner: 'quangshuynh', repo: 'inboxsweep', commit: 'a2429fb1d23eb3b06a8dd9e5c65ee30952ba292f' },
  salonflow: { owner: 'quangshuynh', repo: 'salonflow', commit: '6f3c5f05b7a78631500eb06368989594697cac5f' },
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
  if (!COMMIT.test(pin.commit)) throw new Error(`${key} must be pinned to a full 40-character commit SHA`);
  if (!IMAGE_PATH.test(path)) throw new Error(`Not a repository-relative image path: ${path}`);
  return `https://${ASSET_HOST}/gh/${pin.owner}/${pin.repo}@${pin.commit}/${path}`;
}

/**
 * checks that a URL is a commit-pinned jsDelivr GitHub image URL
 * :param url: candidate URL
 * :returns: true when the URL could have come from githubAsset
 */
export function isPinnedGithubAsset(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const match = parsed.pathname.match(/^\/gh\/[\w.-]+\/[\w.-]+@([^/]+)\/(.+)$/);
  return parsed.protocol === 'https:'
    && parsed.host === ASSET_HOST
    && !parsed.search
    && !parsed.hash
    && Boolean(match)
    && COMMIT.test(match[1])
    && IMAGE_PATH.test(match[2]);
}
