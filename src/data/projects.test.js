// @vitest-environment node
import { readDerivatives } from '../../scripts/optimized-images.mjs';
import { pinnedAssetUrl, repositories } from './githubAssets.mjs';
import { featuredProjects, moreProjects, projects } from './projects.mjs';
import { unusedPins, validateProjects } from './validateProjects.mjs';

const derivatives = await readDerivatives();

test('project data passes every deterministic asset and metadata check', () => {
  expect(validateProjects(projects, derivatives)).toEqual([]);
});

test('every pinned repository is used by a project', () => {
  expect(unusedPins(projects)).toEqual([]);
  expect(unusedPins(projects, { ...repositories, stale: { owner: 'quangshuynh', repo: 'retired', commit: 'a'.repeat(40) } })).toEqual(['stale']);
});

test('sections list every visible project exactly once, featured first, in array order', () => {
  expect([...featuredProjects, ...moreProjects]).toEqual(projects.filter((project) => !project.hidden));
});

test('curation: featured and secondary projects keep their ranked order', () => {
  expect(featuredProjects.map((project) => project.slug)).toEqual([
    'dashpilot', '585dashcam585', 'quangedit', 'hymical-forms', 'gitprofilelens', 'ordixa',
  ]);
  expect(moreProjects.map((project) => project.slug)).toEqual([
    'scribekit', 'puzzlepress', 'flipper', 'inboxsweep', 'devpulse', 'carebridge',
    'chessed', 'casenotes', 'homemade', 'mover-git', '585photo585',
  ]);
  // Off the page but kept in the data, so it can be restored.
  expect(projects.filter((project) => project.hidden).map((project) => project.slug)).toEqual(['repo-radar']);
});

test('Ordixa replaces Business Data Automation with its current repository and brand', () => {
  const ordixa = projects.find((project) => project.slug === 'ordixa');
  expect(ordixa.name).toBe('Ordixa');
  expect(ordixa.featured).toBe(true);
  expect(ordixa.links.github).toBe('https://github.com/quangshuynh/ordixa');
  expect(ordixa.links.release).toBe('https://github.com/quangshuynh/ordixa/releases/tag/v2.0.0');
  expect(ordixa.links.live).toBeUndefined();
  expect(ordixa.logo.source).toMatch(/\/gh\/quangshuynh\/ordixa@[0-9a-f]{40}\/docs\/images\/ordixa-logo2\.png$/);
  expect(ordixa.screenshots.map((shot) => shot.src.split('/').pop())).toEqual([
    'workbook-summary.png', 'workbook-exceptions.png', 'workbook-change-summary.png', 'cli-demo-run.png',
  ]);
  // Public copy states the maturity honestly, never uses the old name, and
  // claims no web dashboard or customers.
  const copy = JSON.stringify(projects);
  expect(copy).not.toMatch(/Business Data Automation|business-data-automation|\bBDA\b/);
  expect(ordixa.summary).toMatch(/fictional demo data/);
  expect(JSON.stringify(ordixa)).not.toMatch(/dashboard|customers|clients/i);
});

test('the Ordixa launch video is the tag-versioned release asset with a pinned poster', () => {
  const { video } = projects.find((project) => project.slug === 'ordixa');
  // launch.mp4 is a release attachment, which jsDelivr's GitHub endpoint cannot serve.
  expect(video.src).toBe('https://github.com/quangshuynh/ordixa/releases/download/v2.0.0/launch.mp4');
  expect(video.page).toBe('https://github.com/quangshuynh/ordixa/releases/tag/v2.0.0');
  expect(video.poster).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/gh\/quangshuynh\/ordixa@[0-9a-f]{40}\/docs\/media\/thumbnail\.jpg$/);
  expect(video).toMatchObject({ width: 1920, height: 1080, duration: 23 });
});

test('the public build never names private repositories or private hosts', () => {
  const copy = JSON.stringify(projects);
  expect(copy).not.toMatch(/github\.com\/quangshuynh\/(devpulse|585dashcam585|585photo585)/i);
  expect(copy).not.toMatch(/raw\.githubusercontent|githubusercontent\.com/);
});

test('every More project belongs to a filter category', () => {
  moreProjects.forEach((project) => expect(project.category).toBeTruthy());
});

test('DashPilot keeps its public name until the Worklane rebrand ships', () => {
  expect(projects.map((project) => project.name)).toContain('DashPilot');
  expect(JSON.stringify(projects)).not.toMatch(/Worklane/i);
});

test('private repositories never get raw GitHub URLs', () => {
  const privateSlugs = projects.filter((entry) => entry.private).map((entry) => entry.slug);
  expect(privateSlugs).toEqual(['585dashcam585', 'devpulse', '585photo585']);
  for (const slug of privateSlugs) {
    const project = projects.find((entry) => entry.slug === slug);
    expect(project.links.github).toBeUndefined();
    project.screenshots.forEach((shot) => expect(shot.src).toBeUndefined());
    expect(project.logo?.source).toBeUndefined();
  }
});

describe('validator catches bad entries', () => {
  const valid = projects.find((project) => project.slug === 'dashpilot');
  const problemsFor = (patch) => validateProjects([{ ...valid, ...patch }], derivatives);
  const shot = (patch) => ({ screenshots: [{ ...valid.screenshots[0], ...patch }, ...valid.screenshots.slice(1)] });
  const otherRepo = pinnedAssetUrl(repositories.ordixa, 'docs/images/workbook-summary.png');
  const video = {
    src: 'https://github.com/quangshuynh/dashpilot/releases/download/v1.0.0/launch.mp4',
    page: 'https://github.com/quangshuynh/dashpilot/releases/tag/v1.0.0',
    poster: pinnedAssetUrl(repositories.dashpilot, 'docs/images/screenshots/work-workspace.png'),
    width: 1920,
    height: 1080,
    duration: 30,
    title: 'Fixture video',
    caption: 'A fixture video',
  };
  const secondary = { featured: false, detail: 'Supporting line.', links: { github: valid.links.github } };

  test.each([
    ['a mutable branch URL', { screenshots: [{ ...valid.screenshots[0], src: valid.screenshots[0].src.replace(/@[0-9a-f]{40}/, '@main') }] }, /not a commit-pinned/],
    ['a GitHub blob page', { screenshots: [{ ...valid.screenshots[0], src: 'https://github.com/quangshuynh/dashpilot/blob/main/docs/images/screenshots/work-workspace.png' }] }, /not a commit-pinned/],
    ['empty alt text', { screenshots: [{ ...valid.screenshots[0], alt: ' ' }] }, /needs alt text/],
    ['missing dimensions', { screenshots: [{ ...valid.screenshots[0], width: undefined }] }, /width and height/],
    ['a missing derivative', { logo: { ...valid.logo, file: 'no-such-logo' } }, /no-such-logo\.webp is missing/],
    ['an http link', { links: { github: 'http://github.com/quangshuynh/dashpilot' } }, /not an https URL/],
    ['no takeaway on a featured project', { takeaway: '' }, /needs a takeaway/],
    ['a zero dimension', shot({ height: 0 }), /width and height/],
    ['a fractional dimension', shot({ width: 1440.5 }), /width and height/],
    ['a screenshot from a neighbouring repository', shot({ src: otherRepo }), /comes from quangshuynh\/ordixa, not https:\/\/github\.com\/quangshuynh\/dashpilot/],
    ['a hand-typed URL at an unpinned commit', shot({ src: valid.screenshots[0].src.replace(/@[0-9a-f]{40}/, `@${'d'.repeat(40)}`) }), /not pinned through githubAssets\.mjs/],
    ['a GitHub link that is not a repository', { links: { ...valid.links, github: 'https://github.com/quangshuynh/dashpilot/tree/main' } }, /must be a repository URL/],
    ['repeated gallery tab labels', shot({ label: valid.screenshots[1].label }), /repeats the gallery tab label/],
    ['repeated alt text', shot({ alt: valid.screenshots[1].alt }), /repeats the alt text/],
    ['a missing gallery tab label', shot({ label: '' }), /needs a short gallery tab label/],
    ['a logo size that does not match its derivative', { logo: { ...valid.logo, width: 999 } }, /logo records 999x771, but dashpilot-logo\.webp is 780x771/],
    ['a gallery logo without a size', { logo: { ...valid.logo, width: undefined, height: undefined } }, /needs width and height/],
    ['a non-boolean hidden flag', { hidden: 'yes' }, /hidden must be true or false/],
    ['a demoted project that keeps a documentation link', { featured: false, detail: 'Supporting line.' }, /documentation links only render on featured cards/],
    ['a release link on a More project', { ...secondary, links: { ...secondary.links, release: `${valid.links.github}/releases/tag/v1.0.0` } }, /release links only render on featured cards/],
    ['a video on a More project', { ...secondary, video }, /videos only render on featured cards/],
    ['a video from the latest release instead of a tag', { video: { ...video, src: 'https://github.com/quangshuynh/dashpilot/releases/latest/download/launch.mp4' } }, /tag-versioned GitHub release download/],
    ['a video served from a branch', { video: { ...video, src: 'https://cdn.jsdelivr.net/gh/quangshuynh/dashpilot@main/launch.mp4' } }, /tag-versioned GitHub release download/],
    ['a video from another repository', { video: { ...video, src: 'https://github.com/quangshuynh/ordixa/releases/download/v1.0.0/launch.mp4' } }, /video comes from quangshuynh\/ordixa/],
    ['a video page for a different tag', { video: { ...video, page: 'https://github.com/quangshuynh/dashpilot/releases/tag/v9.9.9' } }, /release page for tag v1\.0\.0/],
    ['an unpinned video poster', { video: { ...video, poster: 'https://raw.githubusercontent.com/quangshuynh/dashpilot/main/poster.jpg' } }, /video poster is not a commit-pinned/],
    ['too few facts on a featured project', { facts: ['One fact'] }, /two to four facts/],
    ['an overlong fact', { facts: ['Short', 'x'.repeat(41)] }, /at most 40 characters/],
    ['a More project without a category', { ...secondary, links: { github: valid.links.github } }, /category must be one of/],
    ['a private project that links its repository', { private: true }, /private projects must not link their repository/],
    ['a private project with a GitHub-hosted image', { private: true, links: {} }, /private projects use local images only/],
    ['a link to an unexpected host', { links: { ...valid.links, live: 'https://example.com/' } }, /not an https URL on an expected host/],
    ['a video without a size or duration', { video: { ...video, width: undefined, duration: 0 } }, /video needs integer width and height[\s\S]*duration in whole seconds/],
  ])('rejects %s', (_, patch, message) => {
    expect(problemsFor(patch).join('\n')).toMatch(message);
  });

  test('rejects duplicate slugs and duplicate screenshots', () => {
    const problems = validateProjects([valid, valid], derivatives).join('\n');
    expect(problems).toMatch(/duplicate slug/);
    expect(problems).toMatch(/duplicate name/);
    expect(problems).toMatch(/duplicates https:/);
  });

  test('rejects a featured project listed after a non-featured one', () => {
    const secondary = projects.find((project) => !project.featured);
    expect(validateProjects([secondary, valid], derivatives)).toEqual(['dashpilot: featured projects must be listed before every non-featured project']);
  });

  test('rejects a local screenshot whose recorded size differs from its derivative', () => {
    const storefront = projects.find((project) => project.slug === '585dashcam585');
    const resized = { ...storefront, screenshots: [{ ...storefront.screenshots[0], width: 1600 }] };
    expect(validateProjects([resized], derivatives).join('\n')).toMatch(/screenshot 1 records 1600x\d+, but 585dashcam585-storefront\.webp is \d+x\d+/);
  });

  test('accepts a tag-versioned release video on a featured project', () => {
    expect(problemsFor({ video })).toEqual([]);
  });

  test('accepts a private project with no links and local images only', () => {
    const storefront = projects.find((project) => project.slug === '585dashcam585');
    expect(validateProjects([{ ...storefront, links: {} }], derivatives)).toEqual([]);
  });

  test('accepts a hidden project and a valid minimal More entry', () => {
    const minimal = { slug: 'minimal', name: 'Minimal', summary: 'A small tool.', detail: 'One supporting line.', technologies: ['Go'], category: 'Developer Tools & Automation', links: { github: 'https://github.com/quangshuynh/minimal' } };
    expect(validateProjects([{ ...valid, hidden: true }, minimal], derivatives)).toEqual([]);
  });
});
