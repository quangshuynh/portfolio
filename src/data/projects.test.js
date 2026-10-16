import { readdirSync } from 'node:fs';
import { featuredProjects, moreProjects, projects } from './projects.mjs';
import { validateProjects } from './validateProjects.mjs';

const optimizedFiles = new Set(
  readdirSync('src/assets/optimized').filter((file) => file.endsWith('.webp')).map((file) => file.replace(/\.webp$/, '')),
);

test('project data passes every deterministic asset and metadata check', () => {
  expect(validateProjects(projects, { optimizedFiles })).toEqual([]);
});

test('curation: featured and secondary projects keep their ranked order', () => {
  expect(featuredProjects.map((project) => project.slug)).toEqual([
    '585dashcam585', 'dashpilot', 'scribekit', 'flipper', 'puzzlepress', 'gitprofilelens',
  ]);
  expect(moreProjects.map((project) => project.slug)).toEqual([
    'ordixa', 'inboxsweep', 'hymical-forms', '585photo585', 'chessed', 'casenotes', 'repo-radar',
  ]);
});

test('Ordixa replaces Business Data Automation with its current repository and brand', () => {
  const ordixa = projects.find((project) => project.slug === 'ordixa');
  expect(ordixa.name).toBe('Ordixa');
  expect(ordixa.links.github).toBe('https://github.com/quangshuynh/ordixa');
  expect(ordixa.links.live).toBeUndefined();
  expect(ordixa.logo.source).toMatch(/\/gh\/quangshuynh\/ordixa@[0-9a-f]{40}\/docs\/images\/ordixa-logo2\.png$/);
  expect(ordixa.screenshots.map((shot) => shot.src.split('/').pop())).toEqual([
    'workbook-summary.png', 'workbook-exceptions.png', 'cli-inspect.png', 'cli-demo-run.png',
  ]);
  // Public copy states the maturity honestly and never uses the old name.
  const copy = JSON.stringify(projects);
  expect(copy).not.toMatch(/Business Data Automation|business-data-automation|\bBDA\b/);
  expect(ordixa.detail).toMatch(/fictional demo data/);
});

test('DashPilot keeps its public name until the Worklane rebrand ships', () => {
  expect(projects.map((project) => project.name)).toContain('DashPilot');
  expect(JSON.stringify(projects)).not.toMatch(/Worklane/i);
});

test('private repositories never get raw GitHub URLs', () => {
  for (const slug of ['585dashcam585', '585photo585']) {
    const project = projects.find((entry) => entry.slug === slug);
    expect(project.links.github).toBeUndefined();
    project.screenshots.forEach((shot) => expect(shot.src).toBeUndefined());
    expect(project.logo?.source).toBeUndefined();
  }
});

describe('validator catches bad entries', () => {
  const valid = projects.find((project) => project.slug === 'flipper');
  const problemsFor = (patch) => validateProjects([{ ...valid, ...patch }], { optimizedFiles });

  test.each([
    ['a mutable branch URL', { screenshots: [{ ...valid.screenshots[0], src: valid.screenshots[0].src.replace(/@[0-9a-f]{40}/, '@main') }] }, /not a commit-pinned/],
    ['a GitHub blob page', { screenshots: [{ ...valid.screenshots[0], src: 'https://github.com/quangshuynh/flipper/blob/main/docs/images/flipper-dashboard.png' }] }, /not a commit-pinned/],
    ['empty alt text', { screenshots: [{ ...valid.screenshots[0], alt: ' ' }] }, /needs alt text/],
    ['missing dimensions', { screenshots: [{ ...valid.screenshots[0], width: undefined }] }, /width and height/],
    ['a missing derivative', { logo: { ...valid.logo, file: 'no-such-logo' } }, /no-such-logo\.webp is missing/],
    ['an http link', { links: { github: 'http://github.com/quangshuynh/flipper' } }, /not an https URL/],
    ['no takeaway on a featured project', { takeaway: '' }, /needs a takeaway/],
  ])('rejects %s', (_, patch, message) => {
    expect(problemsFor(patch).join('\n')).toMatch(message);
  });

  test('rejects duplicate slugs and duplicate screenshots', () => {
    const problems = validateProjects([valid, valid], { optimizedFiles }).join('\n');
    expect(problems).toMatch(/duplicate slug/);
    expect(problems).toMatch(/duplicates https:/);
  });
});
