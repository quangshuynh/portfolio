// Deterministic checks on src/data/projects.mjs. Runs in `npm test` (and so in
// CI) with no network access; `npm run check:assets` reuses it before probing
// the remote URLs. Returns a list of human-readable problems (empty when valid).
import { isPinnedGithubAsset, repositories } from './githubAssets.mjs';

const LINK_HOSTS = /^https:\/\/([\w-]+\.)*(github\.com|github\.io|vercel\.app|585dashcam585\.com|585photo585\.com)(\/|$)/;

const blank = (value) => typeof value !== 'string' || value.trim() === '';

/**
 * validates project metadata and asset references
 * :param projects: project entries
 * :param options: { optimizedFiles } set of derivative names in src/assets/optimized
 * :returns: array of problem strings
 */
export function validateProjects(projects, { optimizedFiles } = {}) {
  const problems = [];
  const seen = { slug: new Set(), name: new Set(), src: new Set() };
  const repoUrls = new Set(Object.values(repositories).map(({ owner, repo }) => `https://github.com/${owner}/${repo}`));

  for (const project of projects) {
    const where = project.slug || project.name || '(unnamed project)';
    const fail = (message) => problems.push(`${where}: ${message}`);

    for (const key of ['slug', 'name']) {
      if (blank(project[key])) fail(`missing ${key}`);
      else if (seen[key].has(project[key])) fail(`duplicate ${key} "${project[key]}"`);
      else seen[key].add(project[key]);
    }
    if (project.slug && !/^[a-z0-9-]+$/.test(project.slug)) fail('slug must be lowercase letters, digits, and hyphens');
    if (blank(project.summary)) fail('missing summary');
    if (!Array.isArray(project.technologies) || project.technologies.length === 0) fail('needs at least one technology');
    else if (new Set(project.technologies).size !== project.technologies.length) fail('duplicate technology tags');

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
    if (links.github && !repoUrls.has(links.github) && project.screenshots?.some((shot) => shot.src)) {
      fail(`screenshots come from GitHub but ${links.github} has no pinned entry in githubAssets.mjs`);
    }

    if (project.logo) {
      if (blank(project.logo.alt)) fail('logo needs alt text');
      if (blank(project.logo.file)) fail('logo needs a derivative file name');
      else if (optimizedFiles && !optimizedFiles.has(project.logo.file)) fail(`logo derivative ${project.logo.file}.webp is missing; run npm run prepare:images`);
      if (project.logo.source && !isPinnedGithubAsset(project.logo.source)) fail(`logo source is not a commit-pinned jsDelivr URL: ${project.logo.source}`);
    }

    const shots = project.screenshots ?? [];
    const gallery = project.featured && project.logo && shots.length > 0;
    shots.forEach((shot, index) => {
      const label = `screenshot ${index + 1}`;
      if (Boolean(shot.src) === Boolean(shot.local)) fail(`${label} needs exactly one of src (pinned URL) or local (derivative name)`);
      if (shot.src) {
        if (!isPinnedGithubAsset(shot.src)) fail(`${label} is not a commit-pinned jsDelivr URL: ${shot.src}`);
        else if (seen.src.has(shot.src)) fail(`${label} duplicates ${shot.src}`);
        else seen.src.add(shot.src);
      }
      if (shot.local && optimizedFiles && !optimizedFiles.has(shot.local)) fail(`${label} derivative ${shot.local}.webp is missing`);
      if (blank(shot.alt)) fail(`${label} needs alt text`);
      if (blank(shot.caption)) fail(`${label} needs a caption`);
      if (!(Number.isInteger(shot.width) && shot.width > 0 && Number.isInteger(shot.height) && shot.height > 0)) fail(`${label} needs integer width and height to reserve layout space`);
      if (gallery && blank(shot.label)) fail(`${label} needs a short gallery tab label`);
    });
  }
  return problems;
}
