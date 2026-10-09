import featured from './featuredProjects.jsx?raw';
import more from './moreProjects.jsx?raw';
import nav from './siteNav.jsx?raw';
import experience from './experience.jsx?raw';
import education from './education.jsx?raw';
import prepareScript from '../../../scripts/prepare-site-images.mjs?raw';

const sources = { featured, more, nav, experience, education };

test('homepage sections use the display-sized derivatives, not multi-megabyte source PNGs', () => {
  for (const [name, source] of Object.entries(sources)) {
    expect(source, name).not.toMatch(/assets\/logos\/[\w-]+\.png/);
    expect(source, name).not.toMatch(/chi-the-cat\.png|585dashcam585-storefront\.png/);
  }
});

test('every optimized import is produced by the prepare:images script', () => {
  const produced = new Set([...prepareScript.matchAll(/', '([\w-]+)', /g)].map((match) => match[1]));
  const imported = Object.values(sources).flatMap((source) => [...source.matchAll(/assets\/optimized\/([\w-]+)\.webp/g)].map((match) => match[1]));
  expect(imported.length).toBeGreaterThan(0);
  imported.forEach((name) => expect(produced, name).toContain(name));
});
