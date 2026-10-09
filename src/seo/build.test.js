// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { build } from 'vite';
import { photographOverrides as photographs } from '../data/photographs.overrides.mjs';
import { NOT_FOUND_ROUTE, ROUTES, SITE_URL } from './site.mjs';

const root = resolve(__dirname, '../..');

async function buildSite(base) {
  const outDir = mkdtempSync(join(tmpdir(), 'portfolio-seo-'));
  await build({
    root,
    configFile: join(root, 'vite.config.mjs'),
    base,
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true },
  });
  return outDir;
}

const readHead = (outDir, file) => new JSDOM(readFileSync(join(outDir, file), 'utf8')).window.document.head;
const meta = (head, selector) => head.querySelector(selector)?.getAttribute('content') ?? head.querySelector(selector)?.getAttribute('href');

describe('production build at the site root', () => {
  let outDir;
  beforeAll(async () => { outDir = await buildSite('/'); }, 60_000);
  afterAll(() => outDir && rmSync(outDir, { recursive: true, force: true }));

  test('writes a static HTML page for every route and a 404 page', () => {
    [...ROUTES, NOT_FOUND_ROUTE].forEach(({ file }) => expect(existsSync(join(outDir, file))).toBe(true));
  });

  test('gives each page exactly one set of its own metadata', () => {
    const seen = { title: new Set(), description: new Set() };
    ROUTES.forEach((route) => {
      const head = readHead(outDir, route.file);
      expect(head.querySelectorAll('title')).toHaveLength(1);
      ['meta[name="description"]', 'link[rel="canonical"]', 'meta[property="og:url"]', 'meta[property="og:image"]', 'meta[name="robots"]']
        .forEach((selector) => expect(head.querySelectorAll(selector)).toHaveLength(1));
      expect(head.querySelector('title').textContent).toBe(route.title);
      expect(meta(head, 'meta[name="description"]')).toBe(route.description);
      expect(meta(head, 'link[rel="canonical"]')).toBe(route.canonical);
      expect(meta(head, 'meta[property="og:url"]')).toBe(route.canonical);
      expect(meta(head, 'meta[name="robots"]')).toMatch(/^index, follow/);
      seen.title.add(route.title);
      seen.description.add(route.description);
    });
    expect(seen.title.size).toBe(ROUTES.length);
    expect(seen.description.size).toBe(ROUTES.length);
  });

  test('keeps the 404 page out of the index', () => {
    const head = readHead(outDir, NOT_FOUND_ROUTE.file);
    expect(meta(head, 'meta[name="robots"]')).toBe('noindex, follow');
    expect(head.querySelector('link[rel="canonical"]')).toBeNull();
  });

  test('ships valid JSON-LD on every page', () => {
    const types = ROUTES.map((route) => {
      const scripts = readHead(outDir, route.file).querySelectorAll('script[type="application/ld+json"]');
      expect(scripts).toHaveLength(1);
      const data = JSON.parse(scripts[0].textContent);
      expect(data['@context']).toBe('https://schema.org');
      return data['@type'] ?? data['@graph'].map((node) => node['@type']).join('+');
    });
    expect(types).toEqual(['WebSite+Person', 'ProfilePage', 'CollectionPage']);
  });

  test('points photography structured data and previews at emitted photographs', () => {
    const head = readHead(outDir, 'photography/index.html');
    const data = JSON.parse(head.querySelector('script[type="application/ld+json"]').textContent);
    const featured = photographs.filter(({ featured: order }) => order);
    expect(data.hasPart).toHaveLength(featured.length);
    data.hasPart.forEach(({ contentUrl, thumbnailUrl }) => {
      [contentUrl, thumbnailUrl].forEach((url) => {
        expect(url.startsWith(`${SITE_URL}/assets/`)).toBe(true);
        expect(existsSync(join(outDir, new URL(url).pathname))).toBe(true);
      });
    });
    const ogImage = meta(head, 'meta[property="og:image"]');
    expect(existsSync(join(outDir, new URL(ogImage).pathname))).toBe(true);
    const preload = head.querySelector('link[rel="preload"][as="image"]');
    expect(preload.getAttribute('fetchpriority')).toBe('high');
    expect(existsSync(join(outDir, preload.getAttribute('href')))).toBe(true);
    expect(head.querySelector('link[rel="modulepreload"]').getAttribute('href')).toMatch(/^\/assets\/photographyPage-.+\.js$/);
  });

  test('writes a sitemap of exactly the canonical pages and every photograph', () => {
    const xml = readFileSync(join(outDir, 'sitemap.xml'), 'utf8');
    const document = new JSDOM(xml, { contentType: 'application/xml' }).window.document;
    expect(document.querySelector('parsererror')).toBeNull();
    const pages = [...document.querySelectorAll('url')].map((url) => url.querySelector('loc').textContent);
    expect(pages).toEqual(ROUTES.map(({ canonical }) => canonical));
    const images = [...document.getElementsByTagName('image:loc')].map((node) => node.textContent);
    expect(images).toHaveLength(photographs.length);
    images.forEach((url) => expect(existsSync(join(outDir, new URL(url).pathname))).toBe(true));
    expect(xml).not.toContain('#');
  });

  test('copies robots.txt with the sitemap directive', () => {
    expect(readFileSync(join(outDir, 'robots.txt'), 'utf8')).toContain('Sitemap: https://quanghuynh.com/sitemap.xml');
  });
});

describe('production build under the GitHub Pages base path', () => {
  let outDir;
  beforeAll(async () => { outDir = await buildSite('/portfolio/'); }, 60_000);
  afterAll(() => outDir && rmSync(outDir, { recursive: true, force: true }));

  test('prefixes page-relative preloads with the base but keeps canonical production URLs', () => {
    const head = readHead(outDir, 'photography/index.html');
    expect(meta(head, 'link[rel="canonical"]')).toBe(`${SITE_URL}/photography/`);
    expect(head.querySelector('link[rel="preload"][as="image"]').getAttribute('href')).toMatch(/^\/portfolio\/assets\//);
    expect(head.querySelector('link[rel="modulepreload"]').getAttribute('href')).toMatch(/^\/portfolio\/assets\//);
  });
});

describe('Vercel routing', () => {
  const config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));

  test('has no catch-all rewrite that could swallow sitemap.xml, robots.txt, or 404s', () => {
    (config.rewrites ?? []).forEach(({ source }) => {
      expect(source).not.toMatch(/\(\.\*\)|:path\*|\/\*$/);
      ['/sitemap.xml', '/robots.txt', '/missing-page'].forEach((path) => expect(source).not.toBe(path));
    });
  });

  test('serves every route and redirects its non-canonical twin', () => {
    const rewrites = new Map((config.rewrites ?? []).map(({ source, destination }) => [source, destination]));
    const redirects = new Map((config.redirects ?? []).map(({ source, destination, permanent }) => [source, { destination, permanent }]));
    ROUTES.forEach(({ path, file }) => {
      // Static files are served as-is; extensionless paths need an explicit rewrite to their file.
      if (path.endsWith('/')) expect(file).toBe(`${path.slice(1)}index.html`);
      else expect(rewrites.get(path)).toBe(`/${file}`);
      if (path !== '/') {
        const twin = path.endsWith('/') ? path.slice(0, -1) : `${path}/`;
        expect(redirects.get(twin)).toEqual({ destination: path, permanent: true });
      }
    });
  });
});
