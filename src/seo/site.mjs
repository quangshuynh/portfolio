// Single source of truth for the public route inventory and its search metadata.
// Plain ESM with no Vite-specific imports so the build plugin (Node) and the app
// (browser) read the same titles, descriptions, and canonical URLs.
export const SITE_URL = 'https://quanghuynh.com';
export const SITE_NAME = 'Quang Huynh';

export const DEFAULT_SOCIAL_IMAGE = {
  url: `${SITE_URL}/social-preview.png`,
  width: 1200,
  height: 630,
  alt: 'Quang Huynh software engineering portfolio preview',
};

// Every real, indexable page. Homepage sections (#experience, #projects, …) and
// photograph deep links (/photography/#slug) are fragments of these pages, not routes.
// `file` is where the build writes the page's static HTML; `chunk` is the lazily
// loaded page module the HTML can start fetching early.
export const ROUTES = Object.freeze([
  {
    id: 'home',
    path: '/',
    file: 'index.html',
    title: 'Quang Huynh | Software Engineer & Developer',
    description: 'Quang Huynh is a software engineer and computer science student at Rochester Institute of Technology, building backend systems, developer tools, automation, and native applications.',
    ogType: 'website',
  },
  {
    id: 'about',
    path: '/about',
    file: 'about/index.html',
    chunk: 'src/components/pages/aboutPage.jsx',
    title: 'About Quang Huynh | Software Engineer & CS Student',
    description: 'About Quang Huynh, a software developer and computer science student in Rochester, New York: background, approach to engineering, and interests in photography, cars, tech, and music.',
    ogType: 'profile',
  },
  {
    id: 'photography',
    path: '/photography/',
    file: 'photography/index.html',
    chunk: 'src/components/pages/photographyPage.jsx',
    title: 'Photography Portfolio | Quang Huynh',
    description: 'Original photography by Quang Huynh, based in Rochester, New York: cars, places, landscapes, and nature, from city nights to waterfalls and lakeshores.',
    ogType: 'website',
  },
].map((route) => Object.freeze({ ...route, canonical: `${SITE_URL}${route.path}`, indexable: true })));

// Served with a 404 status for any path that is not a route above.
export const NOT_FOUND_ROUTE = Object.freeze({
  id: 'not-found',
  path: null,
  file: '404.html',
  title: 'Page not found | Quang Huynh',
  description: 'This page does not exist. Visit the portfolio of Quang Huynh, a software engineer and computer science student.',
  ogType: 'website',
  indexable: false,
});

/** Maps an app pathname (base path and trailing slash already stripped) to its route. */
export function routeForAppPath(appPath) {
  if (appPath === '/') return ROUTES[0];
  return ROUTES.find(({ path }) => path !== '/' && path.replace(/\/$/, '') === appPath) ?? null;
}

export const PERSON_ID = `${SITE_URL}/#person`;
export const WEBSITE_ID = `${SITE_URL}/#website`;

// Only facts stated on the site itself.
export const person = Object.freeze({
  '@type': 'Person',
  '@id': PERSON_ID,
  name: 'Quang Huynh',
  url: `${SITE_URL}/`,
  description: 'Software developer and computer science student at Rochester Institute of Technology.',
  homeLocation: { '@type': 'Place', name: 'Rochester, New York, USA' },
  affiliation: { '@type': 'CollegeOrUniversity', name: 'Rochester Institute of Technology', url: 'https://www.rit.edu/' },
  sameAs: ['https://github.com/quangshuynh', 'https://www.linkedin.com/in/quangs'],
});

const personReference = { '@type': 'Person', '@id': PERSON_ID, name: person.name, url: person.url };
const websiteReference = { '@type': 'WebSite', '@id': WEBSITE_ID, name: SITE_NAME, url: `${SITE_URL}/` };

function imageObject(photograph) {
  return {
    '@type': 'ImageObject',
    contentUrl: photograph.viewerUrl,
    thumbnailUrl: photograph.galleryUrl,
    url: `${SITE_URL}/photography/#${encodeURIComponent(photograph.slug)}`,
    name: photograph.caption,
    description: photograph.alt,
    width: { '@type': 'QuantitativeValue', value: photograph.viewerWidth, unitCode: 'E37' },
    height: { '@type': 'QuantitativeValue', value: photograph.viewerHeight, unitCode: 'E37' },
    creator: personReference,
    creditText: person.name,
  };
}

/**
 * Structured data for one route.
 * :param route: entry from ROUTES
 * :param photographs: featured photographs with absolute `viewerUrl`/`galleryUrl` (photography only)
 * :returns: JSON-LD object, or null when the route has none
 */
export function buildJsonLd(route, { photographs = [] } = {}) {
  if (route.id === 'home') {
    return {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebSite', '@id': WEBSITE_ID, name: SITE_NAME, url: `${SITE_URL}/`, inLanguage: 'en', publisher: { '@id': PERSON_ID } },
        person,
      ],
    };
  }
  if (route.id === 'about') {
    return {
      '@context': 'https://schema.org',
      '@type': 'ProfilePage',
      '@id': `${route.canonical}#profile`,
      url: route.canonical,
      name: route.title,
      description: route.description,
      inLanguage: 'en',
      isPartOf: websiteReference,
      mainEntity: person,
    };
  }
  if (route.id === 'photography') {
    return {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      '@id': `${route.canonical}#collection`,
      url: route.canonical,
      name: route.title,
      description: route.description,
      inLanguage: 'en',
      isPartOf: websiteReference,
      author: personReference,
      ...(photographs.length ? { primaryImageOfPage: imageObject(photographs[0]), hasPart: photographs.map(imageObject) } : {}),
    };
  }
  return null;
}

const escapeAttribute = (value) => String(value)
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeText = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const HEAD_START = '<!-- seo:start -->';
export const HEAD_END = '<!-- seo:end -->';

/**
 * Renders the route-specific head tags, wrapped in markers so the build can swap them.
 * :param route: entry from ROUTES or NOT_FOUND_ROUTE
 * :param options: { image, jsonLd, preloads } where preloads are extra <link> attribute maps
 * :returns: HTML string
 */
export function renderHeadTags(route, { image = DEFAULT_SOCIAL_IMAGE, jsonLd = null, preloads = [] } = {}) {
  const meta = (key, name, content) => `<meta ${key}="${name}" content="${escapeAttribute(content)}" />`;
  const tags = [
    `<title>${escapeText(route.title)}</title>`,
    meta('name', 'description', route.description),
    meta('name', 'robots', route.indexable ? 'index, follow, max-image-preview:large' : 'noindex, follow'),
  ];
  if (route.indexable) tags.push(`<link rel="canonical" href="${escapeAttribute(route.canonical)}" />`);
  tags.push(
    meta('property', 'og:type', route.ogType),
    meta('property', 'og:site_name', SITE_NAME),
    meta('property', 'og:locale', 'en_US'),
    meta('property', 'og:title', route.title),
    meta('property', 'og:description', route.description),
  );
  if (route.indexable) tags.push(meta('property', 'og:url', route.canonical));
  if (route.ogType === 'profile') {
    tags.push(meta('property', 'profile:first_name', 'Quang'), meta('property', 'profile:last_name', 'Huynh'));
  }
  tags.push(
    meta('property', 'og:image', image.url),
    meta('property', 'og:image:width', image.width),
    meta('property', 'og:image:height', image.height),
    meta('property', 'og:image:alt', image.alt),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:title', route.title),
    meta('name', 'twitter:description', route.description),
    meta('name', 'twitter:image', image.url),
    meta('name', 'twitter:image:alt', image.alt),
  );
  preloads.forEach((attributes) => {
    const rendered = Object.entries(attributes).map(([key, value]) => `${key}="${escapeAttribute(value)}"`).join(' ');
    tags.push(`<link ${rendered} />`);
  });
  if (jsonLd) {
    // `<` is escaped so photograph text can never close the script element.
    tags.push(`<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`);
  }
  return [HEAD_START, ...tags, HEAD_END].map((tag) => `    ${tag}`).join('\n');
}

/** Replaces the marked head block of a rendered page with new tags. */
export function replaceHeadTags(html, tags) {
  const start = html.indexOf(HEAD_START);
  const end = html.indexOf(HEAD_END);
  if (start === -1 || end === -1) throw new Error('SEO head markers not found in HTML.');
  const lineStart = html.lastIndexOf('\n', start) + 1;
  return `${html.slice(0, lineStart)}${tags}${html.slice(end + HEAD_END.length)}`;
}

/**
 * Builds sitemap.xml from the indexable routes.
 * No lastmod/changefreq/priority: the build has no reliable per-page modification date.
 * :param images: map of route path -> absolute image URLs shown on that page
 * :returns: XML string
 */
export function buildSitemap(routes = ROUTES, images = {}) {
  const urls = routes.filter(({ indexable }) => indexable).map(({ path, canonical }) => {
    const imageEntries = (images[path] ?? []).map((url) => `\n    <image:image>\n      <image:loc>${escapeText(url)}</image:loc>\n    </image:image>`).join('');
    return `  <url>\n    <loc>${escapeText(canonical)}</loc>${imageEntries}\n  </url>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}
