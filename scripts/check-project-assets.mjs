// Network check for every remote project image: `npm run check:assets`.
//
// Runs the deterministic validator first, then requests each commit-pinned
// jsDelivr URL. A definite answer that the asset is broken (4xx, a non-image
// content type) fails the run. Being unable to reach the CDN at all (offline,
// timeout, 5xx) only warns, so a CDN hiccup never blocks local work or CI.
import { projects } from '../src/data/projects.mjs';
import { unusedPins, validateProjects } from '../src/data/validateProjects.mjs';
import { readDerivatives } from './optimized-images.mjs';

const LARGE_BYTES = 1024 * 1024;
const TIMEOUT_MS = 20_000;

const problems = validateProjects(projects, await readDerivatives());
unusedPins(projects).forEach((key) => problems.push(`githubAssets.mjs: ${key} is pinned but no project uses it; remove the pin`));
if (problems.length) {
  console.error(`Project data is invalid:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

// Hidden projects are not on the page, so their images are not probed.
const urls = projects.filter((project) => !project.hidden).flatMap((project) => [
  ...(project.logo?.source ? [[project.slug, 'logo source', project.logo.source]] : []),
  ...(project.screenshots ?? []).filter((shot) => shot.src).map((shot) => [project.slug, shot.caption, shot.src]),
]);

async function probe(url) {
  // GET rather than HEAD: some edges answer HEAD without a content type.
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const bytes = Number(response.headers.get('content-length')) || (await response.arrayBuffer()).byteLength;
  return { status: response.status, type: response.headers.get('content-type') ?? '', bytes, cache: response.headers.get('cache-control') ?? '' };
}

const failures = [];
const warnings = [];
let totalBytes = 0;
await Promise.all(urls.map(async ([slug, what, url]) => {
  try {
    const { status, type, bytes, cache } = await probe(url);
    if (status >= 500) return void warnings.push(`${slug} ${what}: HTTP ${status} (CDN error, not checked) ${url}`);
    if (status !== 200) return void failures.push(`${slug} ${what}: HTTP ${status} ${url}`);
    if (!type.startsWith('image/')) return void failures.push(`${slug} ${what}: content-type "${type}" is not an image ${url}`);
    if (!/immutable/.test(cache)) warnings.push(`${slug} ${what}: response is not marked immutable (${cache || 'no cache-control'})`);
    // Logo sources only feed prepare:images; visitors download screenshots.
    if (what === 'logo source') return;
    if (bytes > LARGE_BYTES) warnings.push(`${slug} ${what}: ${(bytes / 1024).toFixed(0)} KB is large for the web`);
    totalBytes += bytes;
  } catch (error) {
    warnings.push(`${slug} ${what}: unreachable (${error.cause?.code ?? error.name}) ${url}`);
  }
}));

warnings.forEach((warning) => console.warn(`warn  ${warning}`));
failures.forEach((failure) => console.error(`FAIL  ${failure}`));
console.log(`${urls.length} remote assets: ${failures.length} broken, ${warnings.length} warnings; screenshots total ${(totalBytes / 1024).toFixed(0)} KB if every one were opened.`);
process.exit(failures.length ? 1 : 0);
