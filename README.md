# Quang Huynh - Software Engineering Portfolio

Personal portfolio highlighting professional software engineering experience, backend and data-oriented projects, technical breadth, and education.

[![CI](https://github.com/quangshuynh/portfolio/actions/workflows/ci.yml/badge.svg)](https://github.com/quangshuynh/portfolio/actions/workflows/ci.yml)

**Live site:** [quanghuynh.com](https://quanghuynh.com/)

Also deployed to [GitHub Pages](https://quangshuynh.github.io/portfolio/) and [Vercel](https://quangs.vercel.app/).

## Stack

- React 19 and Vite
- Plain CSS design system in `src/styles` (semantic light/dark tokens, reduced-motion support); see [docs/nature-revamp.md](docs/nature-revamp.md)
- Self-hosted fonts via Fontsource (Schibsted Grotesk, Martian Mono) plus Circular
- React Icons
- GitHub Pages deployment through GitHub Actions
- Vercel deployment from the same repository

## Local development

```bash
npm install
npm run dev
```

Run the test suite or create a production build:

```bash
npm test
npm run build
```

## Deployment

- CI runs on every pull request and push, installing dependencies, running tests, and verifying a production build.
- Pushes to `main` also deploy to GitHub Pages through `.github/workflows/deploy-pages.yml`. The workflow sets Vite's `BASE_PATH` to `/portfolio/` so assets resolve correctly under the GitHub Pages subpath while root deployments keep `/`.
- Vercel builds the same repository with the standard `npm run build` command for root deployment. `vercel.json` maps `/about` to its prerendered HTML, redirects non-canonical trailing-slash variants, and lets unknown paths fall through to `404.html` (served with a 404 status). There is deliberately no catch-all rewrite, so `/sitemap.xml` and `/robots.txt` are always the real files.

No manual deployment step is required after merging to `main`.

Portfolio content is maintained in this repository, with no GitHub API calls at runtime. Both project sections render from `src/data/projects.mjs`.

## Search metadata

The public routes and their titles, descriptions, canonical URLs, and JSON-LD live in `src/seo/site.mjs`. At build time `scripts/seo-plugin.mjs` writes a static HTML page per route (`index.html`, `about/index.html`, `photography/index.html`) with that route's head tags, plus `404.html` (noindex) and `sitemap.xml` (pages plus every photograph). The page body is still rendered client-side. Add a new page to `ROUTES` and it will get its own HTML, sitemap entry, and tests. `vite preview` does not apply `vercel.json`, so check redirects and 404s against a Vercel deployment.

## Projects and images

Projects (order, copy, links, logos, screenshots, alt text) live in `src/data/projects.mjs`. Screenshots of public projects load from each project's GitHub repository through commit-pinned jsDelivr URLs. Logos are WebP derivatives sized to about 3x their display size and derived from those pinned originals. Private projects keep local images. [docs/project-assets.md](docs/project-assets.md) covers the caching strategy, conventions, and how to add a project.

```bash
npm run prepare:images   # regenerate WebP derivatives (needs network for project logos)
npm run check:assets     # validate project data and fetch every remote image
npm run assets:refresh -- --dry-run [key]   # propose moving pins to each repository's latest verified commit
```

## Photography preparation

Retained originals live outside this public repository. Generate public gallery and viewer derivatives by passing their directory explicitly:

```bash
npm run prepare:photography -- --source-dir /path/to/retained/originals
```

The command validates source identity, reads EXIF locally, auto-orients and resizes each image, strips embedded metadata, and writes deterministic derivatives plus `src/data/photographs.generated.json`. Human-authored captions, alt text, IDs, and curated order remain in `src/data/photographs.overrides.mjs`. Capture times without an EXIF offset are interpreted in `America/New_York`; exact GPS coordinates are never written to public metadata.
