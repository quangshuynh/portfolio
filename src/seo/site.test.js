import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  NOT_FOUND_ROUTE,
  ROUTES,
  SITE_URL,
  buildJsonLd,
  buildSitemap,
  renderHeadTags,
  replaceHeadTags,
  routeForAppPath,
} from './site.mjs';

const SITEMAP_NS = 'http://www.sitemaps.org/schemas/sitemap/0.9';

const parseXml = (xml) => {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  expect(document.querySelector('parsererror')).toBeNull();
  return document;
};

describe('route inventory', () => {
  test('covers exactly the real pages', () => {
    expect(ROUTES.map(({ path }) => path)).toEqual(['/', '/about', '/photography/']);
  });

  test('gives every route a unique title, description, canonical, and output file', () => {
    ['title', 'description', 'canonical', 'file'].forEach((field) => {
      const values = [...ROUTES, NOT_FOUND_ROUTE].map((route) => route[field]).filter(Boolean);
      expect(new Set(values).size).toBe(values.length);
    });
  });

  test('keeps titles and descriptions within search-result lengths', () => {
    ROUTES.forEach(({ title, description }) => {
      expect(title.length).toBeLessThanOrEqual(60);
      expect(description.length).toBeGreaterThanOrEqual(70);
      expect(description.length).toBeLessThanOrEqual(200);
    });
  });

  test('uses absolute HTTPS apex canonicals without fragments or queries', () => {
    ROUTES.forEach(({ canonical, path }) => {
      const url = new URL(canonical);
      expect(url.origin).toBe(SITE_URL);
      expect(url.pathname).toBe(path);
      expect(url.hash).toBe('');
      expect(url.search).toBe('');
    });
  });

  test('resolves app paths with or without a trailing slash, and nothing else', () => {
    expect(routeForAppPath('/').id).toBe('home');
    expect(routeForAppPath('/about').id).toBe('about');
    expect(routeForAppPath('/photography').id).toBe('photography');
    expect(routeForAppPath('/projects')).toBeNull();
    expect(routeForAppPath(null)).toBeNull();
  });
});

describe('sitemap', () => {
  test('is valid XML listing every indexable canonical URL once', () => {
    const xml = buildSitemap(ROUTES, { '/photography/': [`${SITE_URL}/assets/a.jpg`] });
    const document = parseXml(xml);
    expect(document.documentElement.namespaceURI).toBe(SITEMAP_NS);
    const locs = [...document.getElementsByTagNameNS(SITEMAP_NS, 'loc')].map((node) => node.textContent);
    expect(locs).toEqual(ROUTES.map(({ canonical }) => canonical));
    expect(xml).not.toMatch(/<(lastmod|changefreq|priority)>/);
  });

  test('attaches image entries to their page', () => {
    const document = parseXml(buildSitemap(ROUTES, { '/photography/': [`${SITE_URL}/assets/a.jpg`, `${SITE_URL}/assets/b&c.jpg`] }));
    const images = [...document.getElementsByTagNameNS('http://www.google.com/schemas/sitemap-image/1.1', 'loc')];
    expect(images.map((node) => node.textContent)).toEqual([`${SITE_URL}/assets/a.jpg`, `${SITE_URL}/assets/b&c.jpg`]);
    expect(images[0].closest('url').getElementsByTagNameNS(SITEMAP_NS, 'loc')[0].textContent).toBe(`${SITE_URL}/photography/`);
  });

  test('leaves out non-indexable routes', () => {
    expect(buildSitemap([...ROUTES, NOT_FOUND_ROUTE])).toBe(buildSitemap(ROUTES));
  });
});

describe('robots.txt', () => {
  const robots = readFileSync(resolve(__dirname, '../../public/robots.txt'), 'utf8');

  test('allows crawling and points at the production sitemap', () => {
    expect(robots).toMatch(/^User-agent: \*$/m);
    expect(robots).toMatch(/^Allow: \/$/m);
    expect(robots).toMatch(/^Sitemap: https:\/\/quanghuynh\.com\/sitemap\.xml$/m);
  });

  test('blocks nothing', () => {
    expect(robots).not.toMatch(/^Disallow:\s*\S/m);
  });
});

describe('structured data', () => {
  const photographs = [
    { slug: 'a b', caption: 'A', alt: 'Alt A', viewerUrl: `${SITE_URL}/a.jpg`, galleryUrl: `${SITE_URL}/a-g.jpg`, viewerWidth: 2200, viewerHeight: 1467 },
  ];
  const nodes = (data) => (data['@graph'] ?? [data]);

  test('describes the site and owner on the homepage', () => {
    const data = buildJsonLd(ROUTES[0]);
    expect(data['@context']).toBe('https://schema.org');
    expect(nodes(data).map((node) => node['@type'])).toEqual(['WebSite', 'Person']);
  });

  test('marks the about page as a profile of the owner', () => {
    const data = buildJsonLd(routeForAppPath('/about'));
    expect(data['@type']).toBe('ProfilePage');
    expect(data.mainEntity).toMatchObject({ '@type': 'Person', name: 'Quang Huynh' });
    expect(data.url).toBe(`${SITE_URL}/about`);
  });

  test('lists photographs as image objects credited to the owner', () => {
    const data = buildJsonLd(routeForAppPath('/photography'), { photographs });
    expect(data['@type']).toBe('CollectionPage');
    expect(data.hasPart).toHaveLength(1);
    expect(data.hasPart[0]).toMatchObject({
      '@type': 'ImageObject',
      contentUrl: `${SITE_URL}/a.jpg`,
      url: `${SITE_URL}/photography/#a%20b`,
      creditText: 'Quang Huynh',
      creator: { name: 'Quang Huynh' },
    });
  });

  test('makes no claims the site does not support', () => {
    const serialized = JSON.stringify(ROUTES.map((route) => buildJsonLd(route, { photographs })));
    ['aggregateRating', 'review', 'award', 'worksFor', 'offers', 'price', 'jobTitle', 'dateCreated', 'contentLocation', 'exifData']
      .forEach((field) => expect(serialized).not.toContain(`"${field}"`));
  });
});

describe('head tags', () => {
  test('render the route metadata and parseable JSON-LD', () => {
    const route = routeForAppPath('/about');
    const html = renderHeadTags(route, { jsonLd: buildJsonLd(route) });
    const head = new DOMParser().parseFromString(`<html><head>${html}</head></html>`, 'text/html').head;
    expect(head.querySelector('title').textContent).toBe(route.title);
    expect(head.querySelector('link[rel="canonical"]').getAttribute('href')).toBe(route.canonical);
    expect(head.querySelector('meta[property="og:url"]').getAttribute('content')).toBe(route.canonical);
    expect(head.querySelector('meta[property="og:type"]').getAttribute('content')).toBe('profile');
    expect(head.querySelector('meta[name="robots"]').getAttribute('content')).toMatch(/^index, follow/);
    expect(JSON.parse(head.querySelector('script[type="application/ld+json"]').textContent)['@type']).toBe('ProfilePage');
  });

  test('mark the 404 page noindex without a canonical', () => {
    const head = new DOMParser().parseFromString(`<html><head>${renderHeadTags(NOT_FOUND_ROUTE)}</head></html>`, 'text/html').head;
    expect(head.querySelector('meta[name="robots"]').getAttribute('content')).toBe('noindex, follow');
    expect(head.querySelector('link[rel="canonical"]')).toBeNull();
    expect(head.querySelector('meta[property="og:url"]')).toBeNull();
  });

  test('escape text that could break out of attributes or the JSON-LD script', () => {
    const html = renderHeadTags({ ...ROUTES[0], description: '"><script>x</script>' }, { jsonLd: { name: '</script><b>' } });
    expect(html).not.toContain('"><script>x');
    expect(html).toContain('\\u003c/script>\\u003cb>');
  });

  test('can be swapped in an already rendered page', () => {
    const page = `<head>\n    <meta charset="utf-8" />\n${renderHeadTags(ROUTES[0])}\n  </head>`;
    const swapped = replaceHeadTags(page, renderHeadTags(ROUTES[2]));
    expect(swapped).toContain(`<title>${ROUTES[2].title}</title>`);
    expect(swapped).not.toContain(`<title>${ROUTES[0].title}</title>`);
    expect(swapped).toContain('<meta charset="utf-8" />');
  });
});
