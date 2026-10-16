// Logic behind `npm run assets:refresh`; the CLI lives in
// refresh-project-assets.mjs. Network access, image decoding, and the GitHub
// token are passed in, so tests can exercise every path without a network.
//
// For each repository pinned in src/data/githubAssets.mjs:
//   1. ask GitHub for the latest commit on the default branch,
//   2. download every image src/data/projects.mjs references from that repository
//      at that commit, and check it decodes and keeps its recorded size,
//   3. propose the new pin only when every check passes.
// Nothing is written here; applyPins() turns approved plans into new source text.
import { parsePinnedGithubAsset, pinnedAssetUrl } from '../src/data/githubAssets.mjs';

const COMMIT = /^[0-9a-f]{40}$/;
const TIMEOUT_MS = 20_000;

export const USAGE = `Usage: npm run assets:refresh -- [--dry-run] [repository ...]

Moves each repository's pin in src/data/githubAssets.mjs to the latest commit on
its default branch, after checking that every screenshot and logo the portfolio
references still exists there as a readable image of the recorded size.

  repository   one or more keys from githubAssets.mjs (default: all)
  --project K  same as passing K as a repository key
  --dry-run    show the proposed changes and write nothing
  --help       show this message

Set GITHUB_TOKEN (or GH_TOKEN) to raise GitHub's API rate limit.`;

/**
 * parses command-line arguments
 * :param argv: arguments after the script name
 * :param knownKeys: repository keys from githubAssets.mjs
 * :returns: { dryRun, help, keys } where keys is every known key when none were named
 */
export function parseArgs(argv, knownKeys) {
  const options = { dryRun: false, help: false, keys: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run' || arg === '-n') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--project' || arg === '-p') {
      const value = argv[index += 1];
      if (!value || value.startsWith('-')) throw new Error(`${arg} needs a repository key`);
      options.keys.push(value);
    } else if (arg.startsWith('--project=')) options.keys.push(arg.slice('--project='.length));
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else options.keys.push(arg);
  }
  const unknown = options.keys.filter((key) => !knownKeys.includes(key));
  if (unknown.length) throw new Error(`Unknown repository ${unknown.join(', ')}. Known: ${knownKeys.join(', ')}`);
  options.keys = options.keys.length ? [...new Set(options.keys)] : [...knownKeys];
  return options;
}

/**
 * groups every remote image the project data references by repository key
 * :param projects: entries from src/data/projects.mjs
 * :param repositories: pins from src/data/githubAssets.mjs
 * :returns: { [key]: [{ path, slug, kind: 'logo' | 'screenshot', width?, height? }] }
 */
export function collectExpectedAssets(projects, repositories) {
  const keyByRepo = new Map(Object.entries(repositories).map(([key, pin]) => [`${pin.owner}/${pin.repo}`.toLowerCase(), key]));
  const expected = Object.fromEntries(Object.keys(repositories).map((key) => [key, []]));
  const add = (slug, kind, url, size = {}) => {
    const parsed = parsePinnedGithubAsset(url);
    if (!parsed) throw new Error(`${slug} ${kind} is not a commit-pinned jsDelivr URL: ${url}`);
    const key = keyByRepo.get(`${parsed.owner}/${parsed.repo}`.toLowerCase());
    if (!key) throw new Error(`${slug} ${kind} comes from ${parsed.owner}/${parsed.repo}, which has no pin in githubAssets.mjs`);
    if (expected[key].some((asset) => asset.path === parsed.path && asset.kind === kind)) return;
    expected[key].push({ path: parsed.path, slug, kind, ...size });
  };
  for (const project of projects) {
    if (project.logo?.source) add(project.slug, 'logo', project.logo.source);
    for (const shot of project.screenshots ?? []) {
      if (shot.src) add(project.slug, 'screenshot', shot.src, { width: shot.width, height: shot.height });
    }
  }
  return expected;
}

/**
 * builds the URL that answers whether a file exists publicly at a commit
 * :param pin: { owner, repo, commit }
 * :param path: repository-relative path
 * :returns: raw.githubusercontent.com URL (no token, so private files 404)
 */
export function rawFileUrl(pin, path) {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `https://raw.githubusercontent.com/${pin.owner}/${pin.repo}/${pin.commit}/${encoded}`;
}

function apiHeaders(token, accept = 'application/vnd.github+json') {
  return {
    Accept: accept,
    'User-Agent': 'portfolio-assets-refresh',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function describeApiFailure(response) {
  if (response.status === 404) return 'repository not found or not public (HTTP 404)';
  if (response.status === 401) return 'GitHub rejected the token (HTTP 401)';
  if ((response.status === 403 || response.status === 429) && response.headers.get('x-ratelimit-remaining') === '0') {
    return `GitHub API rate limit reached (HTTP ${response.status}); set GITHUB_TOKEN and retry`;
  }
  return `GitHub API answered HTTP ${response.status}`;
}

function networkFailure(error) {
  return error.name === 'TimeoutError' ? 'timed out' : `unreachable (${error.cause?.code ?? error.name})`;
}

/**
 * asks GitHub for the latest commit on a repository's default branch
 * :param pin: { owner, repo }
 * :param deps: { fetch, token }
 * :returns: { commit } or { error }
 */
export async function latestCommit(pin, { fetch, token }) {
  let response;
  try {
    response = await fetch(`https://api.github.com/repos/${pin.owner}/${pin.repo}/commits/HEAD`, {
      headers: apiHeaders(token, 'application/vnd.github.sha'),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return { error: `GitHub API ${networkFailure(error)}` };
  }
  if (!response.ok) return { error: describeApiFailure(response) };
  const commit = (await response.text()).trim();
  return COMMIT.test(commit) ? { commit } : { error: `GitHub API returned an unexpected commit id "${commit.slice(0, 60)}"` };
}

/**
 * lists files that changed between two commits, for reporting only
 * :param pin: { owner, repo }
 * :param from: current commit
 * :param to: proposed commit
 * :param deps: { fetch, token }
 * :returns: Set of changed paths (renames include both names), or null when unknown
 */
export async function changedFiles(pin, from, to, { fetch, token }) {
  try {
    const response = await fetch(`https://api.github.com/repos/${pin.owner}/${pin.repo}/compare/${from}...${to}`, {
      headers: apiHeaders(token),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = await response.json();
    // The compare API lists at most 300 files; past that the list is incomplete.
    if (!Array.isArray(body.files) || body.files.length >= 300) return null;
    return new Set(body.files.flatMap((file) => [file.filename, file.previous_filename].filter(Boolean)));
  } catch {
    return null;
  }
}

/**
 * downloads one asset at a commit and checks it is a readable image of the recorded size
 * :param pin: { owner, repo, commit }
 * :param asset: entry from collectExpectedAssets
 * :param deps: { fetch, measure } where measure(buffer) resolves to { width, height } or throws
 * :returns: null when the asset is fine, otherwise { kind: 'missing' | 'unverified' | 'unreadable' | 'resized', message }
 */
export async function verifyAsset(pin, asset, { fetch, measure }) {
  const where = `${asset.kind} ${asset.path}`;
  let response;
  try {
    response = await fetch(rawFileUrl(pin, asset.path), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    return { kind: 'unverified', message: `${where}: ${networkFailure(error)}` };
  }
  if (response.status === 404) return { kind: 'missing', message: `${where}: not found at this commit` };
  if (!response.ok) return { kind: 'unverified', message: `${where}: HTTP ${response.status}, could not verify` };
  let size;
  try {
    size = await measure(Buffer.from(await response.arrayBuffer()));
  } catch {
    return { kind: 'unreadable', message: `${where}: not a readable image (Git LFS pointer or corrupt file?)` };
  }
  if (asset.width && asset.height && (size.width !== asset.width || size.height !== asset.height)) {
    // Width and height reserve layout space, so a stale pair means a wrong box.
    const ratio = Math.abs(size.width / size.height - asset.width / asset.height) < 0.005 ? 'same' : 'different';
    return {
      kind: 'resized',
      message: `${where}: now ${size.width}x${size.height}, projects.mjs records ${asset.width}x${asset.height} (${ratio} aspect ratio, ${asset.slug}); update width and height there, then rerun`,
    };
  }
  return null;
}

/**
 * works out whether one repository's pin can move to its latest commit
 * :param key: repository key
 * :param pin: { owner, repo, commit } as currently pinned
 * :param assets: expected assets for this repository
 * :param deps: { fetch, measure, token }
 * :returns: { key, status: 'current' | 'update' | 'blocked' | 'inaccessible', from, to?, problems[], changed?, notes[] }
 */
export async function planRepository(key, pin, assets, deps) {
  const plan = { key, repo: `${pin.owner}/${pin.repo}`, from: pin.commit, problems: [], notes: [] };
  const latest = await latestCommit(pin, deps);
  if (latest.error) return { ...plan, status: 'inaccessible', problems: [latest.error] };
  plan.to = latest.commit;
  if (latest.commit === pin.commit) return { ...plan, status: 'current' };

  const next = { ...pin, commit: latest.commit };
  const results = await Promise.all(assets.map((asset) => verifyAsset(next, asset, deps)));
  plan.problems = results.filter(Boolean).map((result) => result.message);
  if (assets.length && results.every((result) => result?.kind === 'missing')) {
    plan.notes.push('every referenced file is missing: the images may have moved, or the repository may have gone private');
  }
  if (!assets.length) plan.notes.push('projects.mjs references no images from this repository');

  const changed = await changedFiles(pin, pin.commit, latest.commit, deps);
  if (changed) {
    plan.changed = assets.filter((asset) => changed.has(asset.path)).map((asset) => `${asset.kind} ${asset.path}`);
    if (assets.some((asset) => asset.kind === 'logo' && changed.has(asset.path))) {
      plan.notes.push('logo changed: run npm run prepare:images to regenerate its WebP derivative');
    }
  } else {
    plan.notes.push('could not list changed files; if the logo changed, run npm run prepare:images');
  }
  plan.sample = assets[0] ? pinnedAssetUrl(next, assets[0].path, key) : undefined;
  return { ...plan, status: plan.problems.length ? 'blocked' : 'update' };
}

/**
 * replaces pinned commit SHAs in the source of githubAssets.mjs
 * :param source: current file contents
 * :param updates: [{ key, from, to }]
 * :returns: new file contents; only the quoted SHAs change
 */
export function applyPins(source, updates) {
  let next = source;
  for (const { key, from, to } of updates) {
    if (!COMMIT.test(from) || !COMMIT.test(to)) throw new Error(`${key}: refusing to write a non-SHA pin`);
    const quoted = new RegExp(`(['"])${from}\\1`, 'g');
    const hits = next.match(quoted)?.length ?? 0;
    if (hits !== 1) throw new Error(`${key}: expected the pinned commit ${from} exactly once in githubAssets.mjs, found ${hits}`);
    next = next.replace(quoted, (_, quote) => `${quote}${to}${quote}`);
  }
  return next;
}

/**
 * formats a plan as report lines
 * :param plan: result of planRepository
 * :param dryRun: whether the run writes nothing
 * :returns: array of lines
 */
export function formatPlan(plan, dryRun) {
  const short = (sha) => sha?.slice(0, 7);
  const head = {
    current: `ok      ${plan.key} (${plan.repo}): already at latest ${short(plan.from)}`,
    update: `${dryRun ? 'would' : 'update'}  ${plan.key} (${plan.repo}): ${short(plan.from)} -> ${short(plan.to)}`,
    blocked: `SKIP    ${plan.key} (${plan.repo}): latest ${short(plan.to)} fails checks, pin stays at ${short(plan.from)}`,
    inaccessible: `SKIP    ${plan.key} (${plan.repo}): ${plan.problems[0]}, pin stays at ${short(plan.from)}`,
  }[plan.status];
  const lines = [head];
  if (plan.status === 'update') {
    lines.push(`          commit: '${plan.from}'`, `       -> commit: '${plan.to}'`);
    if (plan.changed) lines.push(`          referenced images changed: ${plan.changed.length ? plan.changed.join(', ') : 'none'}`);
    if (plan.sample) lines.push(`          e.g. ${plan.sample}`);
  }
  if (plan.status === 'blocked') plan.problems.forEach((problem) => lines.push(`          - ${problem}`));
  plan.notes.forEach((note) => lines.push(`          note: ${note}`));
  return lines;
}
