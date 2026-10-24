// @vitest-environment node
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { build } from 'vite';
import catalog from '../data/photography.catalog.json';
import { publicPhotographs } from '../../scripts/photography-catalog.mjs';
import { createHash } from 'node:crypto';
import { EDITOR_ROUTE, NOT_FOUND_ROUTE, ROUTES, SITE_URL } from './site.mjs';

const root = resolve(__dirname, '../..');
const photographs = publicPhotographs(catalog);

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

  test('names every emitted asset by its content, so Vercel can cache /assets/ as immutable', () => {
    const files = readdirSync(join(outDir, 'assets'));
    expect(files.length).toBeGreaterThan(0);
    files.forEach((name) => expect(name).toMatch(/-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/));
  });

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

  test('serves the photo editor as its own noindex page with a no-upload CSP', () => {
    const html = readFileSync(join(outDir, EDITOR_ROUTE.file), 'utf8');
    const head = readHead(outDir, EDITOR_ROUTE.file);
    expect(head.querySelector('title').textContent).toBe(EDITOR_ROUTE.title);
    expect(meta(head, 'meta[name="robots"]')).toBe('noindex, follow');
    expect(head.querySelector('link[rel="canonical"]')).toBeNull();
    expect(head.querySelector('script[type="application/ld+json"]')).toBeNull();
    const csp = meta(head, 'meta[http-equiv="Content-Security-Policy"]');
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("default-src 'self'");
    // Every inline script in the page must be allowed by hash, or the theme bootstrap breaks.
    [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach(([, body]) => {
      expect(csp).toContain(`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
    });
    expect(head.querySelector('link[rel="modulepreload"]').getAttribute('href')).toMatch(/photoEditorPage/);
    expect(readFileSync(join(outDir, 'sitemap.xml'), 'utf8')).not.toContain('editor');
  });

  test('loads the editor startup watchdog as a same-origin classic script before the app bundle', () => {
    const html = readFileSync(join(outDir, EDITOR_ROUTE.file), 'utf8');
    const watchdog = html.indexOf('<script src="/photography/editor-startup.js"></script>');
    expect(watchdog).toBeGreaterThan(html.indexOf('Content-Security-Policy'));
    expect(watchdog).toBeLessThan(html.indexOf('<script type="module"'));
    expect(existsSync(join(outDir, 'photography/editor-startup.js'))).toBe(true);
    [...ROUTES, NOT_FOUND_ROUTE].forEach(({ file }) => expect(readFileSync(join(outDir, file), 'utf8')).not.toContain('editor-startup'));
  });

  test('keeps editor code out of every other page', () => {
    const editorChunks = readdirSync(join(outDir, 'assets')).filter((name) => /photoEditorPage|imageWorker/.test(name));
    expect(editorChunks.some((name) => name.startsWith('imageWorker'))).toBe(true);
    [...ROUTES, NOT_FOUND_ROUTE].forEach(({ file }) => {
      const html = readFileSync(join(outDir, file), 'utf8');
      editorChunks.forEach((chunk) => expect(html).not.toContain(chunk));
    });
    // The entry chunk only references the editor through a dynamic import.
    const entry = readFileSync(join(outDir, 'index.html'), 'utf8').match(/src="\/(assets\/index-[^"]+\.js)"/)[1];
    const entryCode = readFileSync(join(outDir, entry), 'utf8');
    expect(entryCode).not.toMatch(/imageWorker|createEditorContext|uExposureGain/);
  });

  test('copies robots.txt with the sitemap directive', () => {
    expect(readFileSync(join(outDir, 'robots.txt'), 'utf8')).toContain('Sitemap: https://quanghuynh.com/sitemap.xml');
  });
});

describe('draft photographs', () => {
  // A draft whose every field is a unique marker, so any leak into any output is visible.
  const draft = {
    id: 'zzdraftid7341',
    slug: 'zzdraftslug7341',
    status: 'draft',
    sourceFilename: 'ZZDRAFTSOURCE7341.ARW',
    caption: 'Zz draft caption 7341',
    alt: 'Zz draft alt text 7341',
    shape: 'landscape',
    category: catalog.categories[0],
    tags: ['Zzdrafttag7341'],
    metadata: { location: 'Zz draft location 7341' },
  };
  const markers = ['7341', 'zzdraft', 'ZZDRAFT', 'Zz draft'];
  const publishedMarker = 'Published marker 7342';
  let outDir;
  let catalogDir;

  beforeAll(async () => {
    catalogDir = mkdtempSync(join(tmpdir(), 'portfolio-catalog-'));
    const file = join(catalogDir, 'catalog.json');
    // Inserted mid-sequence, so it would also shift curated numbering if it leaked.
    // The first published caption also changes, to prove this catalog is what was built.
    const photographsWithDraft = catalog.photographs.map((record, index) => (index === 0 ? { ...record, caption: publishedMarker } : record));
    photographsWithDraft.splice(3, 0, draft);
    writeFileSync(file, JSON.stringify({ ...catalog, photographs: photographsWithDraft }));
    process.env.PHOTOGRAPHY_CATALOG = file;
    try {
      outDir = await buildSite('/');
    } finally {
      delete process.env.PHOTOGRAPHY_CATALOG;
    }
  }, 60_000);
  afterAll(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
    if (catalogDir) rmSync(catalogDir, { recursive: true, force: true });
  });

  const outputFiles = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => (
    entry.isDirectory() ? outputFiles(join(directory, entry.name)) : [join(directory, entry.name)]
  ));

  test('appear in no built file name or text output', () => {
    const files = outputFiles(outDir);
    const textFiles = files.filter((file) => /\.(html|js|css|xml|json|txt|webmanifest)$/.test(file));
    expect(textFiles.length).toBeGreaterThan(5);
    const leaks = files.filter((file) => markers.some((marker) => file.includes(marker)))
      .concat(textFiles.filter((file) => markers.some((marker) => readFileSync(file, 'utf8').includes(marker))));
    expect(leaks).toEqual([]);
    // Control: published copy from the same catalog does reach the output.
    expect(textFiles.some((file) => readFileSync(file, 'utf8').includes(publishedMarker))).toBe(true);
  });

  test('leave the sitemap and structured data listing only published photographs', () => {
    const xml = readFileSync(join(outDir, 'sitemap.xml'), 'utf8');
    expect(xml.match(/<image:loc>/g)).toHaveLength(photographs.length);
    const head = readHead(outDir, 'photography/index.html');
    const data = JSON.parse(head.querySelector('script[type="application/ld+json"]').textContent);
    expect(data.hasPart).toHaveLength(photographs.filter(({ featured }) => featured).length);
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

  test('caches only content-hashed assets as immutable', () => {
    const immutable = (config.headers ?? []).filter(({ headers }) => headers.some(({ key, value }) => key === 'Cache-Control' && /immutable/.test(value)));
    expect(immutable.map(({ source }) => source)).toEqual(['/assets/(.*)']);
  });

  test('serves every route and redirects its non-canonical twin', () => {
    const rewrites = new Map((config.rewrites ?? []).map(({ source, destination }) => [source, destination]));
    const redirects = new Map((config.redirects ?? []).map(({ source, destination, permanent }) => [source, { destination, permanent }]));
    [...ROUTES, EDITOR_ROUTE].forEach(({ path, file }) => {
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
