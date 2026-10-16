import { existsSync } from 'node:fs';
import featured from './featuredProjects.jsx?raw';
import more from './moreProjects.jsx?raw';
import media from './projectMedia.jsx?raw';
import nav from './siteNav.jsx?raw';
import experience from './experience.jsx?raw';
import education from './education.jsx?raw';
import prepareScript from '../../../scripts/prepare-site-images.mjs?raw';
import { projects } from '../../data/projects.mjs';

const sources = { featured, more, media, nav, experience, education };

test('homepage sections use the display-sized derivatives, not multi-megabyte source PNGs', () => {
  for (const [name, source] of Object.entries(sources)) {
    expect(source, name).not.toMatch(/assets\/logos\/[\w-]+\.png/);
    expect(source, name).not.toMatch(/chi-the-cat\.png|585dashcam585-storefront\.png|585photo585-portfolio\.png/);
  }
});

test('every optimized import is produced by the prepare:images script', () => {
  const produced = new Set([...prepareScript.matchAll(/', '([\w-]+)', /g)].map((match) => match[1]));
  const imported = Object.values(sources).flatMap((source) => [...source.matchAll(/assets\/optimized\/([\w-]+)\.webp/g)].map((match) => match[1]));
  expect(imported.length).toBeGreaterThan(0);
  imported.forEach((name) => expect(produced, name).toContain(name));
});

test('every project derivative has a source the prepare:images script knows about', () => {
  const produced = new Set([...prepareScript.matchAll(/', '([\w-]+)', /g)].map((match) => match[1]));
  for (const project of projects) {
    // Public logos are derived from their pinned GitHub `source`; private ones are listed locally.
    if (project.logo) expect(Boolean(project.logo.source) || produced.has(project.logo.file), project.slug).toBe(true);
    for (const shot of project.screenshots ?? []) {
      if (shot.local) expect(produced, `${project.slug} ${shot.local}`).toContain(shot.local);
    }
  }
  expect(existsSync('src/assets/optimized/ordixa-logo.webp')).toBe(true);
});
