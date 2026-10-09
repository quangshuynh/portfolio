import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergePhotographyMetadata } from './photography-utils.mjs';
import { PHOTOGRAPHY_HERO_SLUG, photographOverrides } from '../src/data/photographs.overrides.mjs';
import {
  DEFAULT_SOCIAL_IMAGE,
  NOT_FOUND_ROUTE,
  ROUTES,
  SITE_URL,
  buildJsonLd,
  buildSitemap,
  renderHeadTags,
  replaceHeadTags,
  routeForAppPath,
} from '../src/seo/site.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLACEHOLDER = '<!--seo-head-->';
const PHOTO_ASSET_DIR = 'src/assets/photography/generated/';

async function loadPhotographs() {
  const generated = JSON.parse(await readFile(path.join(root, 'src/data/photographs.generated.json'), 'utf8'));
  const byId = new Map(generated.map((record) => [record.id, record]));
  return photographOverrides.map((override) => mergePhotographyMetadata(byId.get(override.id), override));
}

const toPosix = (value) => value.split(path.sep).join('/');

/** Maps each source file (repo-relative) to its emitted asset file name. */
function assetFileNames(bundle) {
  const names = new Map();
  Object.values(bundle).forEach((output) => {
    if (output.type !== 'asset') return;
    (output.originalFileNames ?? []).forEach((original) => {
      names.set(toPosix(path.relative(root, path.resolve(root, original))), output.fileName);
    });
  });
  return names;
}

/** The lazy page chunk for a route plus the shared chunks it imports, minus the entry. */
function routeChunkFiles(bundle, moduleId) {
  if (!moduleId) return [];
  const chunks = Object.values(bundle).filter((output) => output.type === 'chunk');
  const chunk = chunks.find(({ facadeModuleId }) => facadeModuleId && toPosix(facadeModuleId).endsWith(moduleId));
  if (!chunk) throw new Error(`SEO: no chunk found for ${moduleId}.`);
  const entries = new Set(chunks.filter(({ isEntry }) => isEntry).map(({ fileName }) => fileName));
  return [chunk.fileName, ...chunk.imports.filter((fileName) => !entries.has(fileName))];
}

/**
 * Gives every public route its own static HTML with route-specific head tags, and
 * writes sitemap.xml and a noindex 404.html, so crawlers and link previews see the
 * right metadata without running JavaScript. The page body stays client-rendered.
 */
export default function seoPlugin() {
  let base = '/';

  return {
    name: 'portfolio-seo',

    configResolved(config) {
      base = config.base;
    },

    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (!html.includes(PLACEHOLDER)) throw new Error(`SEO: index.html is missing ${PLACEHOLDER}.`);
        // In dev the server answers every route with index.html; pick its metadata from the URL.
        const url = ctx.server ? new URL(ctx.originalUrl ?? '/', 'http://localhost').pathname : '/';
        const appPath = url.replace(/\/+$/, '') || '/';
        const route = routeForAppPath(appPath) ?? ROUTES[0];
        return html.replace(PLACEHOLDER, renderHeadTags(route, { jsonLd: buildJsonLd(route) }).trimStart());
      },
    },

    async writeBundle(options, bundle) {
      const outDir = options.dir;
      const template = await readFile(path.join(outDir, 'index.html'), 'utf8');
      const assets = assetFileNames(bundle);
      const assetPath = (filename) => {
        const fileName = assets.get(`${PHOTO_ASSET_DIR}${filename}`);
        if (!fileName) throw new Error(`SEO: emitted asset not found for ${filename}.`);
        return fileName;
      };

      const photographs = (await loadPhotographs()).map((photograph) => ({
        ...photograph,
        galleryFile: assetPath(photograph.galleryFilename),
        viewerFile: assetPath(photograph.viewerFilename),
      })).map((photograph) => ({
        ...photograph,
        galleryUrl: `${SITE_URL}/${photograph.galleryFile}`,
        viewerUrl: `${SITE_URL}/${photograph.viewerFile}`,
      }));
      const featured = photographs.filter(({ featured: order }) => order).sort((a, b) => a.featured - b.featured);
      const hero = photographs.find(({ slug }) => slug === PHOTOGRAPHY_HERO_SLUG) ?? featured[0];

      const pageOptions = (route) => {
        const preloads = routeChunkFiles(bundle, route.chunk)
          .map((fileName) => ({ rel: 'modulepreload', crossorigin: '', href: `${base}${fileName}` }));
        if (route.id !== 'photography') return { jsonLd: buildJsonLd(route), preloads };
        // The hero is the page's LCP element; start it before the lazy page chunk runs.
        // srcset/sizes mirror HeroFigure in photographyPage.jsx so the browser reuses the response.
        preloads.unshift({
          rel: 'preload',
          as: 'image',
          href: `${base}${hero.viewerFile}`,
          imagesrcset: `${base}${hero.galleryFile} ${hero.galleryWidth}w, ${base}${hero.viewerFile} ${hero.viewerWidth}w`,
          imagesizes: '(max-width: 899px) 100vw, 60vw',
          fetchpriority: 'high',
        });
        return {
          jsonLd: buildJsonLd(route, { photographs: [hero, ...featured.filter((photo) => photo !== hero)] }),
          preloads,
          image: { url: hero.viewerUrl, width: hero.viewerWidth, height: hero.viewerHeight, alt: hero.alt },
        };
      };

      for (const route of [...ROUTES, NOT_FOUND_ROUTE]) {
        const html = replaceHeadTags(template, renderHeadTags(route, route.indexable ? pageOptions(route) : { image: DEFAULT_SOCIAL_IMAGE }));
        const file = path.join(outDir, route.file);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, html);
      }

      const sitemap = buildSitemap(ROUTES, { '/photography/': photographs.map(({ viewerUrl }) => viewerUrl) });
      await writeFile(path.join(outDir, 'sitemap.xml'), sitemap);
    },
  };
}
