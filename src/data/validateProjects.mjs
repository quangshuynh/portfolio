// Deterministic checks on src/data/projects.mjs. Runs in `npm test` (and so in
// CI) with no network access; `npm run check:assets` reuses it before probing
// the remote URLs. Returns a list of human-readable problems (empty when valid).
import { parsePinnedGithubAsset, repositories } from './githubAssets.mjs';

const LINK_HOSTS = /^https:\/\/([\w-]+\.)*(github\.com|github\.io|vercel\.app|585dashcam585\.com|585photo585\.com)(\/|$)/;
const REPOSITORY_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)$/;
// A video is a GitHub release attachment at a fixed tag (never /releases/latest/).
const RELEASE_VIDEO = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/releases\/download\/([\w.-]+)\/[\w.-]+\.(mp4|webm)$/;

const blank = (value) => typeof value !== 'string' || value.trim() === '';
const positiveInteger = (value) => Number.isInteger(value) && value > 0;
const sameRepo = (a, b) => `${a.owner}/${a.repo}`.toLowerCase() === `${b.owner}/${b.repo}`.toLowerCase();

/**
 * validates project metadata and asset references
 * :param projects: project entries
 * :param options: { optimizedFiles, derivativeSizes } where optimizedFiles is the set of
 *   derivative names in src/assets/optimized and derivativeSizes maps a name to its { width, height }
 * :returns: array of problem strings
 */
export function validateProjects(projects, { optimizedFiles, derivativeSizes } = {}) {
  const problems = [];
  const seen = { slug: new Set(), name: new Set(), src: new Set(), local: new Set() };
  const repoUrls = new Set(Object.values(repositories).map(({ owner, repo }) => `https://github.com/${owner}/${repo}`));
  let sawSecondary = false;

  for (const project of projects) {
    const where = project.slug || project.name || '(unnamed project)';
    const fail = (message) => problems.push(`${where}: ${message}`);
    const checkDerivativeSize = (label, name, image) => {
      const actual = derivativeSizes?.get(name);
      if (actual && image.width && image.height && (actual.width !== image.width || actual.height !== image.height)) {
        fail(`${label} records ${image.width}x${image.height}, but ${name}.webp is ${actual.width}x${actual.height}`);
      }
    };

    for (const key of ['slug', 'name']) {
      if (blank(project[key])) fail(`missing ${key}`);
      else if (seen[key].has(project[key])) fail(`duplicate ${key} "${project[key]}"`);
      else seen[key].add(project[key]);
    }
    if (project.slug && !/^[a-z0-9-]+$/.test(project.slug)) fail('slug must be lowercase letters, digits, and hyphens');
    if (project.hidden !== undefined && typeof project.hidden !== 'boolean') fail('hidden must be true or false');
    if (blank(project.summary)) fail('missing summary');
    if (!Array.isArray(project.technologies) || project.technologies.length === 0) fail('needs at least one technology');
    else if (new Set(project.technologies).size !== project.technologies.length) fail('duplicate technology tags');

    // Display order is array order within each section; keeping every featured
    // entry first makes the file read top to bottom the way the page does.
    if (!project.featured) sawSecondary = true;
    else if (sawSecondary) fail('featured projects must be listed before every non-featured project');

    if (project.featured) {
      if (blank(project.label)) fail('featured project needs a label');
      if (blank(project.takeaway)) fail('featured project needs a takeaway');
      if (!Array.isArray(project.highlights) || project.highlights.length < 2) fail('featured project needs at least two highlights');
    } else if (blank(project.detail)) {
      fail('needs a detail line');
    }

    const links = project.links ?? {};
    if (!links.github && !links.live) fail('needs a repository or live link');
    for (const [key, url] of Object.entries(links)) {
      if (key === 'liveLabel') continue;
      if (!LINK_HOSTS.test(url)) fail(`${key} link is not an https URL on an expected host: ${url}`);
    }
    // More projects render only `github` and `live`; a documentation link would silently vanish.
    if (!project.featured && links.documentation) fail("documentation links only render on featured cards; in More projects use live with liveLabel: 'Documentation'");
    if (!project.featured && links.release) fail('release links only render on featured cards');
    const ownRepo = links.github?.match(REPOSITORY_URL);
    if (links.github && !ownRepo) fail(`github link must be a repository URL (https://github.com/OWNER/REPO): ${links.github}`);
    if (links.github && !repoUrls.has(links.github) && project.screenshots?.some((shot) => shot.src)) {
      fail(`screenshots come from GitHub but ${links.github} has no pinned entry in githubAssets.mjs`);
    }
    const checkPinned = (label, url) => {
      const parsed = parsePinnedGithubAsset(url);
      if (!parsed) return fail(`${label} is not a commit-pinned jsDelivr URL: ${url}`);
      if (!Object.values(repositories).some((pin) => sameRepo(pin, parsed) && pin.commit === parsed.commit)) {
        fail(`${label} is not pinned through githubAssets.mjs (use githubAsset()): ${url}`);
      }
      // Images must come from the project's own repository, never a neighbour's.
      if (ownRepo && !sameRepo(parsed, { owner: ownRepo[1], repo: ownRepo[2] })) fail(`${label} comes from ${parsed.owner}/${parsed.repo}, not ${links.github}`);
      if (!links.github) fail(`${label} is a GitHub asset, but the project has no github link`);
    };

    if (project.logo) {
      if (blank(project.logo.alt)) fail('logo needs alt text');
      if (blank(project.logo.file)) fail('logo needs a derivative file name');
      else if (optimizedFiles && !optimizedFiles.has(project.logo.file)) fail(`logo derivative ${project.logo.file}.webp is missing; run npm run prepare:images`);
      if (project.logo.source) checkPinned('logo source', project.logo.source);
      const { width, height } = project.logo;
      if ((width !== undefined || height !== undefined) && !(positiveInteger(width) && positiveInteger(height))) fail('logo width and height must both be positive integers');
      // Featured cards show the logo large, so its box must be reserved.
      else if (project.featured && project.screenshots?.length && !width) fail('featured gallery logo needs width and height (the size of its derivative)');
      if (!blank(project.logo.file)) checkDerivativeSize('logo', project.logo.file, project.logo);
    }

    if (project.video) {
      const { video } = project;
      if (!project.featured) fail('videos only render on featured cards');
      const asset = video.src?.match(RELEASE_VIDEO);
      if (!asset) fail(`video src must be a tag-versioned GitHub release download (https://github.com/OWNER/REPO/releases/download/TAG/FILE.mp4): ${video.src}`);
      else {
        if (!ownRepo || !sameRepo({ owner: asset[1], repo: asset[2] }, { owner: ownRepo[1], repo: ownRepo[2] })) fail(`video comes from ${asset[1]}/${asset[2]}, not the project's own repository`);
        if (video.page !== `https://github.com/${asset[1]}/${asset[2]}/releases/tag/${asset[3]}`) fail(`video page must be the release page for tag ${asset[3]}: ${video.page}`);
      }
      if (blank(video.poster)) fail('video needs a poster');
      else checkPinned('video poster', video.poster);
      if (!(positiveInteger(video.width) && positiveInteger(video.height))) fail('video needs integer width and height to reserve layout space');
      if (!positiveInteger(video.duration)) fail('video needs a duration in whole seconds');
      if (blank(video.title)) fail('video needs a title');
      if (blank(video.caption)) fail('video needs a caption');
    }

    const shots = project.screenshots ?? [];
    const gallery = project.featured && project.logo && shots.length > 0;
    const perProject = { alt: new Set(), label: new Set() };
    shots.forEach((shot, index) => {
      const label = `screenshot ${index + 1}`;
      if (Boolean(shot.src) === Boolean(shot.local)) fail(`${label} needs exactly one of src (pinned URL) or local (derivative name)`);
      if (shot.src) {
        if (seen.src.has(shot.src)) fail(`${label} duplicates ${shot.src}`);
        seen.src.add(shot.src);
        checkPinned(label, shot.src);
      }
      if (shot.local) {
        if (seen.local.has(shot.local)) fail(`${label} duplicates local image ${shot.local}`);
        seen.local.add(shot.local);
        if (optimizedFiles && !optimizedFiles.has(shot.local)) fail(`${label} derivative ${shot.local}.webp is missing`);
        checkDerivativeSize(label, shot.local, shot);
      }
      if (blank(shot.alt)) fail(`${label} needs alt text`);
      else if (perProject.alt.has(shot.alt)) fail(`${label} repeats the alt text of another screenshot`);
      else perProject.alt.add(shot.alt);
      if (blank(shot.caption)) fail(`${label} needs a caption`);
      if (!(positiveInteger(shot.width) && positiveInteger(shot.height))) fail(`${label} needs integer width and height to reserve layout space`);
      if (gallery && blank(shot.label)) fail(`${label} needs a short gallery tab label`);
      else if (gallery && perProject.label.has(shot.label)) fail(`${label} repeats the gallery tab label "${shot.label}"`);
      else if (gallery) perProject.label.add(shot.label);
    });
  }
  return problems;
}

/**
 * lists pins in githubAssets.mjs that no project uses, so stale pins get removed
 * :param projects: project entries
 * :param pins: repositories from githubAssets.mjs
 * :returns: array of unused repository keys
 */
export function unusedPins(projects, pins = repositories) {
  const used = new Set(projects.flatMap((project) => [project.logo?.source, project.video?.poster, ...(project.screenshots ?? []).map((shot) => shot.src)])
    .map((url) => url && parsePinnedGithubAsset(url))
    .filter(Boolean)
    .map(({ owner, repo }) => `${owner}/${repo}`.toLowerCase()));
  return Object.entries(pins).filter(([, pin]) => !used.has(`${pin.owner}/${pin.repo}`.toLowerCase())).map(([key]) => key);
}
