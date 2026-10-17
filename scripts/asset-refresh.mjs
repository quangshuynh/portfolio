// Logic behind `npm run assets:refresh`; the CLI lives in
// refresh-project-assets.mjs. Network access, image decoding, the GitHub token,
// and the file system are passed in, so tests can exercise every path offline.
//
// For each repository pinned in src/data/githubAssets.mjs:
//   1. ask GitHub for the latest commit on the default branch,
//   2. download every image src/data/projects.mjs references from that repository
//      at that commit, and check it decodes, is a web format of a sane size, and
//      keeps its recorded width and height,
//   3. propose the new pin only when every check passes. A screenshot whose size
//      changed is accepted only with --update-dimensions, and one whose aspect
//      ratio changed only with --allow-aspect-change as well.
// Nothing is written here; applyPins() and applyDimensions() turn approved plans
// into new source text, and writeFilesSafely() stages, verifies, and swaps it in.
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parsePinnedGithubAsset, pinnedAssetUrl } from '../src/data/githubAssets.mjs';

const COMMIT = /^[0-9a-f]{40}$/;
const TIMEOUT_MS = 20_000;
// Screenshots are served as committed; the gallery loads each one at full size.
export const LARGE_BYTES = 1024 * 1024;
export const MAX_BYTES = 5 * 1024 * 1024;
// Relative difference under which two width/height ratios count as the same
// (1601x1929 vs 1600x1929 is a crop, not a new layout).
const ASPECT_TOLERANCE = 0.005;
const FORMAT_BY_EXTENSION = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp', avif: 'avif', gif: 'gif', svg: 'svg' };

export const USAGE = `Usage: npm run assets:refresh -- [options] [repository ...]

Moves each repository's pin in src/data/githubAssets.mjs to the latest commit on
its default branch, after checking that every screenshot and logo the portfolio
references still exists there as a readable image of the recorded size.

  repository              one or more keys from githubAssets.mjs (default: all)
  --project K, -p K       same as passing K as a repository key
  --dry-run, -n           show the proposed changes and write nothing
  --update-dimensions     accept screenshots whose width and height changed (same
                          aspect ratio) and write the new size to projects.mjs;
                          also checks repositories that are already current
  --allow-aspect-change   with --update-dimensions and --project: also accept
                          screenshots whose aspect ratio changed
  --help, -h              show this message

GITHUB_TOKEN (or GH_TOKEN) is optional; it raises GitHub's API rate limit and is
sent only to api.github.com. Exit codes: 0 ok, 1 a repository was skipped,
2 bad arguments.`;

/**
 * parses command-line arguments
 * :param argv: arguments after the script name
 * :param knownKeys: repository keys from githubAssets.mjs
 * :returns: { dryRun, help, updateDimensions, allowAspectChange, keys } where keys is every known key when none were named
 */
export function parseArgs(argv, knownKeys) {
  const options = { dryRun: false, help: false, updateDimensions: false, allowAspectChange: false, keys: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run' || arg === '-n') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--update-dimensions') options.updateDimensions = true;
    else if (arg === '--allow-aspect-change') options.allowAspectChange = true;
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
  if (options.allowAspectChange && !options.updateDimensions) throw new Error('--allow-aspect-change only applies together with --update-dimensions');
  // A changed aspect ratio changes a card's layout; accept it one project at a time.
  if (options.allowAspectChange && !options.keys.length) throw new Error('--allow-aspect-change needs --project so it never applies to every repository at once');
  options.keys = options.keys.length ? [...new Set(options.keys)] : [...knownKeys];
  return options;
}

/**
 * groups every remote image the visible project data references by repository key
 * :param projects: entries from src/data/projects.mjs (hidden entries are skipped)
 * :param repositories: pins from src/data/githubAssets.mjs
 * :returns: { [key]: [{ path, slug, kind: 'logo' | 'screenshot' | 'poster', width?, height? }] }
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
    if (project.hidden) continue;
    if (project.logo?.source) add(project.slug, 'logo', project.logo.source);
    // The video file itself is a release asset; only its poster lives in the repository.
    if (project.video?.poster) add(project.slug, 'poster', project.video.poster, { width: project.video.width, height: project.video.height });
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
  if (response.status === 401) return 'GitHub rejected the token (HTTP 401); check GITHUB_TOKEN or unset it';
  if ((response.status === 403 || response.status === 429) && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after'))) {
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    const when = reset ? `, resets at ${new Date(reset * 1000).toISOString().slice(11, 16)} UTC` : '';
    return `GitHub API rate limit reached (HTTP ${response.status}${when}); set GITHUB_TOKEN and retry`;
  }
  return `GitHub API answered HTTP ${response.status}`;
}

function networkFailure(error) {
  return error.name === 'TimeoutError' ? 'timed out' : `unreachable (${error.cause?.code ?? error.name})`;
}

async function callApi(url, { fetch, token }, accept) {
  try {
    const response = await fetch(url, { headers: apiHeaders(token, accept), signal: AbortSignal.timeout(TIMEOUT_MS) });
    return response.ok ? { response } : { error: describeApiFailure(response) };
  } catch (error) {
    return { error: `GitHub API ${networkFailure(error)}` };
  }
}

/**
 * asks GitHub for the latest commit on a repository's default branch; with a
 * token, first confirms the repository is public, since a token can see
 * private repositories whose files must never be linked
 * :param pin: { owner, repo }
 * :param deps: { fetch, token }
 * :returns: { commit } or { error }
 */
export async function latestCommit(pin, deps) {
  const base = `https://api.github.com/repos/${pin.owner}/${pin.repo}`;
  if (deps.token) {
    const repo = await callApi(base, deps);
    if (repo.error) return repo;
    const body = await repo.response.json().catch(() => ({}));
    if (body.private || (body.visibility && body.visibility !== 'public')) {
      return { error: 'repository is private; its images cannot be served publicly (use local images instead)' };
    }
  }
  const latest = await callApi(`${base}/commits/HEAD`, deps, 'application/vnd.github.sha');
  if (latest.error) return latest;
  const commit = (await latest.response.text()).trim();
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
export async function changedFiles(pin, from, to, deps) {
  const result = await callApi(`https://api.github.com/repos/${pin.owner}/${pin.repo}/compare/${from}...${to}`, deps);
  if (result.error) return null;
  try {
    const body = await result.response.json();
    // The compare API lists at most 300 files; past that the list is incomplete.
    if (!Array.isArray(body.files) || body.files.length >= 300) return null;
    return new Set(body.files.flatMap((file) => [file.filename, file.previous_filename].filter(Boolean)));
  } catch {
    return null;
  }
}

// Rounded up, so a file just over a limit never reads as equal to it.
const kilobytes = (bytes) => `${Math.ceil(bytes / 1024)} KB`;

/**
 * downloads one asset at a commit and checks it is a readable web image of a sane size
 * :param pin: { owner, repo, commit }
 * :param asset: entry from collectExpectedAssets
 * :param deps: { fetch, measure } where measure(buffer) resolves to { width, height, format? } or throws
 * :returns: { size, bytes } on success, otherwise { error: { kind: 'missing' | 'unverified' | 'unreadable' | 'unsupported' | 'oversized', message } }
 */
export async function inspectAsset(pin, asset, { fetch, measure }) {
  const where = `${asset.kind} ${asset.path}`;
  const fail = (kind, message) => ({ error: { kind, message: `${where}: ${message}` } });
  let response;
  try {
    response = await fetch(rawFileUrl(pin, asset.path), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    return fail('unverified', networkFailure(error));
  }
  if (response.status === 404) return fail('missing', 'not found at this commit');
  if (response.status === 429) return fail('unverified', 'rate limited by raw.githubusercontent.com (HTTP 429), could not verify');
  if (!response.ok) return fail('unverified', `HTTP ${response.status}, could not verify`);
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_BYTES) {
    await response.body?.cancel().catch(() => {});
    return fail('oversized', `${kilobytes(declared)} is over the ${kilobytes(MAX_BYTES)} limit; optimize it before publishing`);
  }
  let buffer;
  try {
    buffer = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    return fail('unverified', `download failed (${networkFailure(error)})`);
  }
  if (buffer.length > MAX_BYTES) return fail('oversized', `${kilobytes(buffer.length)} is over the ${kilobytes(MAX_BYTES)} limit; optimize it before publishing`);
  let size;
  try {
    size = await measure(buffer);
  } catch {
    return fail('unreadable', 'not a readable image (Git LFS pointer or corrupt file?)');
  }
  if (!(Number.isInteger(size?.width) && size.width > 0 && Number.isInteger(size?.height) && size.height > 0)) {
    return fail('unreadable', 'image has no usable width and height');
  }
  const expectedFormat = FORMAT_BY_EXTENSION[asset.path.split('.').pop().toLowerCase()];
  if (size.format && size.format !== expectedFormat) {
    return fail('unsupported', `decodes as ${size.format}, but the extension says ${expectedFormat ?? 'an unsupported format'}; browsers need png, jpeg, webp, avif, gif, or svg under a matching name`);
  }
  return { size: { width: size.width, height: size.height }, bytes: buffer.length };
}

/**
 * compares two width/height pairs by shape
 * :param a: { width, height }
 * :param b: { width, height }
 * :returns: true when the aspect ratios match within tolerance
 */
export function sameAspectRatio(a, b) {
  return Math.abs((a.width / a.height) / (b.width / b.height) - 1) <= ASPECT_TOLERANCE;
}

const dims = ({ width, height }) => `${width}x${height}`;
const ratio = ({ width, height }) => (width / height).toFixed(3);

/**
 * works out whether one repository's pin can move to its latest commit, and
 * which recorded screenshot sizes would change with it
 * :param key: repository key
 * :param pin: { owner, repo, commit } as currently pinned
 * :param assets: expected assets for this repository
 * :param deps: { fetch, measure, token }
 * :param options: { updateDimensions, allowAspectChange }
 * :returns: { key, repo, status: 'current' | 'update' | 'blocked' | 'inaccessible', from, to?, problems[], notes[], dimensions[], changed?, sample? }
 */
export async function planRepository(key, pin, assets, deps, { updateDimensions = false, allowAspectChange = false } = {}) {
  const plan = { key, repo: `${pin.owner}/${pin.repo}`, from: pin.commit, problems: [], notes: [], dimensions: [] };
  const latest = await latestCommit(pin, deps);
  if (latest.error) return { ...plan, status: 'inaccessible', problems: [latest.error] };
  plan.to = latest.commit;
  const moving = latest.commit !== pin.commit;
  // A current pin needs no downloads, unless the run is syncing recorded sizes.
  if (!moving && !updateDimensions) return { ...plan, status: 'current' };

  const next = { ...pin, commit: latest.commit };
  const results = await Promise.all(assets.map((asset) => inspectAsset(next, asset, deps)));
  results.forEach((result, index) => {
    const asset = assets[index];
    const where = `${asset.kind} ${asset.path}`;
    if (result.error) return void plan.problems.push(result.error.message);
    if (result.bytes > LARGE_BYTES && asset.kind !== 'logo') {
      plan.notes.push(`${where} is ${kilobytes(result.bytes)}; visitors download it at full size, so consider optimizing it`);
    }
    if (!asset.width || !asset.height || (result.size.width === asset.width && result.size.height === asset.height)) return;
    // Width and height reserve layout space, so a stale pair means a wrong box.
    const recorded = { width: asset.width, height: asset.height };
    const aspectChanged = !sameAspectRatio(recorded, result.size);
    const change = `now ${dims(result.size)}, projects.mjs records ${dims(recorded)}`;
    if (!updateDimensions) {
      plan.problems.push(`${where}: ${change} (${aspectChanged ? 'different' : 'same'} aspect ratio, ${asset.slug}); rerun with --update-dimensions to accept the new size`);
    } else if (aspectChanged && !allowAspectChange) {
      plan.problems.push(`${where}: ${change}; aspect ratio changed from ${ratio(recorded)} to ${ratio(result.size)} (${asset.slug}). Check the new capture fits its card, then rerun with --project ${key} --update-dimensions --allow-aspect-change`);
    } else {
      plan.dimensions.push({ slug: asset.slug, kind: asset.kind, path: asset.path, from: recorded, to: result.size, aspectChanged });
    }
  });
  if (assets.length && results.every((result) => result.error?.kind === 'missing')) {
    plan.notes.push('every referenced file is missing: the images may have moved, or the repository may have gone private');
  }
  if (!assets.length) plan.notes.push('projects.mjs references no images from this repository');

  if (moving) {
    const changed = await changedFiles(pin, pin.commit, latest.commit, deps);
    if (changed) {
      plan.changed = assets.filter((asset) => changed.has(asset.path)).map((asset) => `${asset.kind} ${asset.path}`);
      if (assets.some((asset) => asset.kind === 'logo' && changed.has(asset.path))) {
        plan.notes.push('logo changed: run npm run prepare:images to regenerate its WebP derivative');
      }
    } else {
      plan.notes.push('could not list changed files; if the logo changed, run npm run prepare:images');
    }
  }
  plan.sample = assets[0] ? pinnedAssetUrl(next, assets[0].path, key) : undefined;
  if (plan.problems.length) return { ...plan, status: 'blocked' };
  return { ...plan, status: moving || plan.dimensions.length ? 'update' : 'current' };
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
 * lists the [start, end] offsets of every {...} block in JavaScript source,
 * skipping braces inside strings and comments
 * :param source: file contents
 * :returns: array of [start, end] pairs
 */
function objectRanges(source) {
  const ranges = [];
  const open = [];
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '/' && source[index + 1] === '/') index = source.indexOf('\n', index) === -1 ? source.length : source.indexOf('\n', index);
    else if (char === '/' && source[index + 1] === '*') index = source.indexOf('*/', index + 2) + 1 || source.length;
    else if (char === "'" || char === '"' || char === '`') {
      for (index += 1; index < source.length && source[index] !== char; index += 1) if (source[index] === '\\') index += 1;
    } else if (char === '{') open.push(index);
    else if (char === '}' && open.length) ranges.push([open.pop(), index]);
  }
  return ranges;
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * rewrites recorded screenshot and video-poster sizes in the source of projects.mjs
 * :param source: current file contents
 * :param key: repository key the screenshots come from
 * :param updates: [{ path, from: { width, height }, to: { width, height } }]
 * :returns: new file contents; only the width and height numbers of the named screenshots change
 */
export function applyDimensions(source, key, updates) {
  let next = source;
  for (const { path: assetPath, from, to } of updates) {
    for (const value of [to.width, to.height]) if (!(Number.isInteger(value) && value > 0)) throw new Error(`${assetPath}: refusing to write a non-positive size`);
    const call = new RegExp(`(?:src|poster):\\s*githubAsset\\(\\s*(['"])${escapeRegExp(key)}\\1\\s*,\\s*(['"])${escapeRegExp(assetPath)}\\2\\s*\\)`, 'g');
    const calls = [...next.matchAll(call)];
    if (calls.length !== 1) throw new Error(`${key} ${assetPath}: expected one screenshot src or video poster in projects.mjs, found ${calls.length}`);
    const at = calls[0].index;
    const [start, end] = objectRanges(next).filter(([open, close]) => open < at && close > at).sort((a, b) => b[0] - a[0])[0] ?? [];
    if (start === undefined) throw new Error(`${key} ${assetPath}: could not find the screenshot entry around its src`);
    let entry = next.slice(start, end + 1);
    for (const field of ['width', 'height']) {
      const pattern = new RegExp(`(\\b${field}:\\s*)(\\d+)`, 'g');
      const hits = [...entry.matchAll(pattern)];
      if (hits.length !== 1) throw new Error(`${key} ${assetPath}: expected one ${field} in its entry, found ${hits.length}`);
      if (Number(hits[0][2]) !== from[field]) throw new Error(`${key} ${assetPath}: ${field} is ${hits[0][2]} in projects.mjs, expected ${from[field]}; was it edited during the run?`);
      entry = entry.replace(pattern, `$1${to[field]}`);
    }
    next = next.slice(0, start) + entry + next.slice(end + 1);
  }
  return next;
}

/**
 * writes several files so that either all of them change or none do: each new
 * version is staged beside its file and verified, then swapped in; if a swap
 * fails, files already swapped are restored
 * :param writes: [{ file, original, content, verify? }] where original is the text the change was computed from and verify(tempFile) throws to reject
 * :param deps: { fs } with readFile, writeFile, rename, rm (defaults to node:fs/promises)
 * :returns: list of files written
 */
export async function writeFilesSafely(writes, { fs = { readFile, writeFile, rename, rm } } = {}) {
  const staged = [];
  const discard = () => Promise.all(staged.map(({ temp }) => fs.rm(temp, { force: true })));
  try {
    for (const write of writes) {
      if ((await fs.readFile(write.file, 'utf8')) !== write.original) throw new Error(`${path.basename(write.file)} changed on disk during the run; nothing was written, rerun the command`);
      // `.mjs` so verify() can import it; the leading dot and suffix are gitignored.
      const temp = path.join(path.dirname(write.file), `.${path.basename(write.file, '.mjs')}.${process.pid}-${Date.now()}.refresh-tmp.mjs`);
      staged.push({ ...write, temp });
      await fs.writeFile(temp, write.content);
      await write.verify?.(temp);
    }
  } catch (error) {
    await discard();
    throw error;
  }
  const swapped = [];
  try {
    for (const write of staged) {
      await fs.rename(write.temp, write.file);
      swapped.push(write);
    }
  } catch (error) {
    await Promise.all(swapped.map((write) => fs.writeFile(write.file, write.original)));
    await discard();
    throw new Error(`could not replace files (${error.message}); restored ${swapped.length ? swapped.map((write) => path.basename(write.file)).join(', ') : 'nothing, no file had changed'}`);
  }
  return staged.map((write) => write.file);
}

/**
 * formats a plan as report lines
 * :param plan: result of planRepository
 * :param dryRun: whether the run writes nothing
 * :returns: array of lines
 */
export function formatPlan(plan, dryRun) {
  const short = (sha) => sha?.slice(0, 7);
  const moving = plan.to && plan.to !== plan.from;
  const verb = dryRun ? 'would' : 'update';
  const head = {
    current: `ok      ${plan.key} (${plan.repo}): already at latest ${short(plan.from)}`,
    update: moving
      ? `${verb}  ${plan.key} (${plan.repo}): ${short(plan.from)} -> ${short(plan.to)}`
      : `${verb}  ${plan.key} (${plan.repo}): pin stays at ${short(plan.from)}, recorded sizes change`,
    blocked: `SKIP    ${plan.key} (${plan.repo}): ${moving ? `latest ${short(plan.to)} fails checks` : `current ${short(plan.from)} fails checks`}, nothing changes, pin stays at ${short(plan.from)}`,
    inaccessible: `SKIP    ${plan.key} (${plan.repo}): ${plan.problems[0]}, pin stays at ${short(plan.from)}`,
  }[plan.status];
  const lines = [head];
  if (plan.status === 'update') {
    if (moving) lines.push(`          commit: '${plan.from}'`, `       -> commit: '${plan.to}'`);
    if (plan.changed) lines.push(`          referenced images changed: ${plan.changed.length ? plan.changed.join(', ') : 'none'}`);
    if (plan.dimensions.length) {
      lines.push('          sizes in projects.mjs:');
      plan.dimensions.forEach(({ slug, path: assetPath, from, to, aspectChanged }) => {
        const shape = aspectChanged ? `aspect ratio ${ratio(from)} -> ${ratio(to)}, accepted by --allow-aspect-change` : 'same aspect ratio';
        lines.push(`            ${slug} ${assetPath}: ${dims(from)} -> ${dims(to)} (${shape})`);
      });
    }
    if (plan.sample) lines.push(`          e.g. ${plan.sample}`);
  }
  if (plan.status === 'blocked') plan.problems.forEach((problem) => lines.push(`          - ${problem}`));
  plan.notes.forEach((note) => lines.push(`          note: ${note}`));
  return lines;
}
