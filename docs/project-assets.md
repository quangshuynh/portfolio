# Project data and GitHub-hosted assets

Every project on the homepage comes from one file, `src/data/projects.mjs`.
Screenshots of public projects are served from each project's own GitHub
repository, pinned to a commit. This page explains how that works and how to add
or update a project.

## Data model

`src/data/projects.mjs` exports `projects`, plus `featuredProjects` and
`moreProjects` filtered from it. Array order is display order.

| Field | Used by | Notes |
| --- | --- | --- |
| `slug`, `name` | both | `slug` gives the `#project-<slug>` deep link on featured cards |
| `featured` | both | `true` puts the project in "Featured projects" |
| `label`, `takeaway`, `highlights[]` | Featured | type line, one-sentence takeaway, 2+ engineering highlights |
| `tagline`, `detail` | More | optional short positioning line; one supporting paragraph |
| `summary` | both | what it is and what it does |
| `technologies[]` | both | rendered as tags |
| `links` | both | `github`, `live`, `liveLabel` (More), `documentation` (Featured) |
| `logo` | both | `{ file, source?, width?, height?, alt, className?, trim? }` |
| `screenshots[]` | both | `{ src \| local, width, height, alt, caption, label? }` |
| `tallScreenshots` | Featured | caps portrait or tall captures at 420px |

A featured project with a logo and screenshots gets a tabbed gallery: a Logo tab
followed by one tab per screenshot (`label`). Without a logo, its first
screenshot is shown alone. In More projects, the first screenshot is the
preview, and clicking it opens every screenshot in the image viewer.

The file is plain data with no asset imports, so Node scripts
(`prepare:images`, `check:assets`) can read it too.

## Where images come from

| Image | Served from | Why |
| --- | --- | --- |
| Screenshots of public projects | `cdn.jsdelivr.net/gh/OWNER/REPO@SHA/path` | The repository is the source of truth; no copy lives here |
| Logos (all projects) | `src/assets/optimized/*.webp`, bundled | Shown at 44px or 260px. The originals are 250 KB to 1.4 MB |
| Private projects (585Dashcam585, 585photo585) | `src/assets`, through `prepare:images` | Private repositories have no public raw URLs |

Logo derivatives are still *derived from GitHub*: `logo.source` records the
pinned original, and `npm run prepare:images` downloads it and writes the WebP.

### Delivery provider and caching

Remote images use **jsDelivr's GitHub endpoint**, always pinned to a full
40-character commit SHA (`src/data/githubAssets.mjs`):

- A commit URL is immutable. jsDelivr serves it with
  `Cache-Control: public, max-age=31536000, s-maxage=31536000, immutable`, so
  browsers and the CDN can keep it for a year. The checked responses were
  `image/png` with `access-control-allow-origin: *`.
- `raw.githubusercontent.com` returns `max-age=300`. It is a file endpoint, not a
  CDN with an availability guarantee, and it rate-limits.
- `@main` (or a tag) on jsDelivr is cached for 7 days in browsers and 12 hours at
  the edge (measured: `max-age=604800, s-maxage=43200`). A deploy could show a
  mix of old and new images, and an image changes without any portfolio commit.
  `githubAsset()` refuses non-SHA refs.

jsDelivr is a free public CDN with no SLA. If it is unreachable, screenshots
show a "Preview unavailable" placeholder (keeping their alt text), and the
image viewer says the image could not be loaded. Nothing else on the page
depends on it.

## Asset path conventions in project repositories

Use the repository's existing layout. The current repositories use:

- `docs/images/<name>-logo.png` for logos (transparent PNG)
- `docs/images/<screen>.png` or `docs/images/screenshots/<screen>.png`
- `docs/images/studio/<screen>-<width>.png` for responsive captures (PuzzlePress)

For a new project, `docs/images/` beside the README is a good default. The
README can then embed the same files.

## Screenshot guidelines

- Real application captures only, using demo or fictional data. Never mock-ups,
  and never real customer or personal data.
- Landscape around 16:10 to 4:3 fits a gallery best. Phone captures work with
  `tallScreenshots: true`. Avoid full-page captures taller than about 2:1, which
  shrink to unreadable strips.
- 1440 to 2200px on the long edge, PNG for UI. Keep each file under about
  600 KB (`check:assets` warns above 1 MB). Run captures through an optimizer
  such as `oxipng -o 4` or `pngquant --quality 80-95` before committing them
  to the project repository.
- Alt text describes what the screen shows, not what the feature is called.
  Captions are a short title for the viewer.
- Record the image's real `width` and `height`. They reserve layout space before
  the lazy image loads.

## Adding or updating a project

1. Commit the images to the **project** repository (see conventions above) and
   push. Note the commit SHA (`git rev-parse HEAD`).
2. In `src/data/githubAssets.mjs`, add the repository or bump its `commit`.
3. In `src/data/projects.mjs`, add or edit the entry. Use
   `githubAsset('<key>', 'docs/images/<file>.png')` for each screenshot and for
   `logo.source`, and set `logo.file` to the derivative name, e.g.
   `<slug>-logo`.
4. Run `npm run prepare:images`. This writes the logo derivative and needs network
   access. Commit the new `.webp`.
5. Run `npm test`. It runs the deterministic validator: required fields, unique
   entries, https links on expected hosts, pinned URLs only, alt text,
   dimensions, gallery labels, and that every derivative exists.
6. Run `npm run check:assets`. It fetches every remote image and fails on a 4xx or
   a non-image. Offline, timeouts, and 5xx responses are warnings, so a CDN
   hiccup never blocks you. CI runs it too.

To pick up changed images for an existing project, bump its SHA and repeat steps
4 to 6. Pinned URLs never change by themselves.

### Private or unavailable assets

- Never link raw URLs from a private repository. They 404 publicly, and a token
  in the URL would publish the token.
- For a private project, place the source image in `src/assets`, add it to
  `localImages` in `scripts/prepare-site-images.mjs`, and reference the
  derivative with `{ local: '<name>' }`.
- A project with no suitable image simply omits `screenshots` (and `logo`). The
  card renders without a visual. Do not create a placeholder screenshot.

## Ordixa presentation

Ordixa (formerly Business Data Automation, same repository, renamed) is shown in
More projects with its mark logo (`docs/images/ordixa-logo2.png`, trimmed), the
tagline "Business data workflows, simplified.", and four real captures from its
fictional demo: the Summary and Exceptions workbook sheets, `inspect`, and
the guided demo run. The copy covers only capabilities the repository lists as
implemented: CSV and XLSX import, versioned TOML profiles, validation and
normalization, reconciliation, the exceptions workbook, and verifiable
manifests. It says the tool has been exercised on fictional data. Planned items
(cross-run matching, vendor connectors, a hosted app, scheduling) are
deliberately left out. There is no deployed demo, so none is linked.

## Known limitations

- jsDelivr is a third-party CDN without an SLA; screenshots degrade to placeholders
  if it is down.
- jsDelivr serves files as committed and does not resize them. The gallery requests
  a screenshot only when its tab is opened, but that request is the full PNG
  (100 to 560 KB).
- jsDelivr's GitHub endpoint has file-size limits. Screenshots should stay far below them anyway.
- `prepare:images` and `check:assets` need network access. `npm run build` and
  `npm test` do not.
