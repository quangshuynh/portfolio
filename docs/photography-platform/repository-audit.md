# Repository audit

Interval 0, 2026-10-22, against `main` at `f080fd7`. Everything here was read
from the repository or observed from the live hosts on that date.

## Stack, routing and hosting

| Area | What exists |
| --- | --- |
| Framework | React 19.2, Vite 8 (Rolldown), plain JavaScript (`.jsx`/`.mjs`). No TypeScript, ESLint or Prettier, so there is no typecheck or lint step. |
| Routing | No router library. `components/utilities/useLocation.js` and `util/navigation.js` (`pushState` plus a custom event); `App.jsx` branches on the path and lazy-loads `aboutPage` and `photographyPage`. Photograph deep links are fragments (`/photography/#slug`). |
| Route inventory | `src/seo/site.mjs` `ROUTES`; `scripts/seo-plugin.mjs` writes a static HTML file per route with its head tags, plus `404.html` and `sitemap.xml` (which lists every photograph). The body still renders client-side. |
| Production host | Vercel serves `quanghuynh.com` (`Server: Vercel`, HTML `Cache-Control: public, max-age=0, must-revalidate`). `vercel.json` has redirects, one rewrite (`/about`), no functions, no catch-all and no security headers. |
| DNS | The `quanghuynh.com` zone is on Cloudflare (`walk`/`yahir.ns.cloudflare.com`). The site records are DNS-only: responses carry no Cloudflare headers. |
| Mirror | GitHub Pages at `quangshuynh.github.io/portfolio/`, built with `BASE_PATH=/portfolio/` (`Cache-Control: max-age=600`). Pages cannot set custom headers or run server code. |
| Server code | None in the site. `spotify-portfolio-api/` is a separate Cloudflare Worker (Wrangler, CORS allowlist, Spotify secrets, no storage bindings). |
| Auth, database, storage, APIs | None anywhere in the repository. |
| CI | `ci.yml` (Node 22: `npm ci`, `npm test`, `check:assets`, `build`) on PRs and `main`; `deploy-pages.yml` deploys Pages on push to `main`. Vercel builds the same branch. |
| Tests | Vitest 5 + jsdom + Testing Library: 268 tests passing. Browser checks (`scripts/check-*.mjs`) attach to a dedicated Chromium over CDP; they are run by hand, not in CI. |
| Licence | The portfolio repository is public with no licence file (all rights reserved). This rules out GPL dependencies that would require licensing the site under the GPL. |

## Photography today

- **Data** is split three ways:
  - `src/data/photographs.overrides.mjs` (hand-written): id, slug, source
    filename, alt, caption, shape, category, tags, and a `featured` ordinal.
    Array order is the curated order. It also holds `PHOTOGRAPHY_HERO_SLUG`
    and the categories.
  - `src/data/photographs.generated.json` (machine-written): derivative names
    and sizes plus an EXIF subset.
  - `scripts/photography-sources.mjs` (build-only): camera-library paths,
    never shipped to the browser.
- **Loader**: `src/data/photographs.js` merges the two, fails the build on
  duplicate IDs, source mismatches, unknown categories or undeclared records,
  and resolves derivatives through `import.meta.glob('…/generated/*.jpg')`.
  That gives content-hashed URLs, but every JPEG in the folder ships,
  orphans included.
- **Pipeline**: `scripts/prepare-photography.mjs` uses sharp and exifr. It
  auto-orients, writes mozjpeg derivatives (gallery 900×1200 box at q82,
  viewer 2200×1800 box at q88) and strips metadata. GPS is never published,
  and EXIF times without an offset are read as `America/New_York`. It
  rewrites whole records, so it must be run with `--only <ids>`. It reads
  camera JPEGs; sharp cannot decode ARW.
- **Assets**: 53 photographs. `src/assets/photography/` is 38 MB, holding 120
  JPEGs (106 in use and 14 orphans, all of which ship) and 69 legacy `*w.webp`
  files that nothing imports.
- **UI**:
  - `components/pages/photographyPage.jsx`: hero, Featured, Collections, and
    All photographs with category filters, sort orders and masonry columns.
  - `components/photography/photographyLightbox.jsx`: portal dialog with a
    focus trap, zoom, EXIF details, preloading and hash deep links.
  - `components/ui/photoLightbox.jsx`: a separate viewer used by About and
    the homepage.
  - Styles live in `styles/photography.css` and `styles/overlays.css`.
- **Design tokens**: `styles/tokens.css` (forest/stone palettes, type scale,
  spacing, radii, easing). The theme is `data-theme`, persisted in
  `localStorage['portfolio-theme']`.

## Related repository: `quangshuynh/photo-archive` (private)

- Originals are organised as `<camera>/<YYYY-MM-DD>/<file>`: 4,866 files,
  including 3,058 JPG, 744 NEF and 72 ARW.
  - All 72 ARWs are Sony A6400 files from `2026-09-29`.
  - The `sony-a7iii/` folders there hold JPEGs only. The A7 III ARWs are on
    the external drive.
- Its own gallery app (`gallery/`, TypeScript) and six owner `.cube` LUTs
  (33³, display-referred Rec.709).
- A designed but undeployed sharing service in `docs/online-sharing*.md`:
  Vercel HTTP service, Neon Postgres, a private R2 bucket, and an owner bearer
  credential stored as a SHA-256 digest.

## Reuse, gaps and constraints

| Need | Reuse | Missing |
| --- | --- | --- |
| Public gallery and lightbox | Page, lightbox, filters, SEO plugin, sitemap, JSON-LD, tests | A machine-writable catalog with draft/published state (today the curated data is a hand-edited `.mjs` module) |
| Derivatives | `prepare-photography.mjs` (deterministic, metadata-stripping, `--only`) | A way to run it without a local checkout and drive |
| Owner auth | Cloudflare zone (DNS), Worker deploy experience | Any authentication or server-side authorization |
| Private storage | Archive design already chose a private R2 bucket | A deployed bucket; the site repository is public, so nothing private can be committed |
| Editor | Tokens, focus-trap and overlay patterns, lazy page chunks, CDP browser-check harness | Image pipeline, workers, GPU rendering, RAW decoder |
| New routes | `ROUTES` + `seo-plugin` + `vercel.json` pattern used by `/about` | `/photography/editor` and an admin entry |

Constraints carried forward from `AGENTS.md`:

- Focused changes and no redesign.
- No new dependencies in the site without approval.
- Feature branches only; merging to `main` deploys.
- Public photos contain no identifiable people.
- Captions stay factual.
- `prepare:photography` only with `--only`.
