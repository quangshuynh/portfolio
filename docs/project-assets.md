# Project data and GitHub-hosted assets

Every project on the homepage comes from one file, `src/data/projects.mjs`.
Screenshots of public projects are served from each project's own GitHub
repository, pinned to a commit. This page explains how that works and how to add
or update a project.

## Data model

`src/data/projects.mjs` exports `projects`, plus `featuredProjects` and
`moreProjects` filtered from it. Array order is display order, curated by hand
(never sorted or discovered); featured entries come first, and entries with
`hidden: true` are left out of both sections.

| Field | Used by | Notes |
| --- | --- | --- |
| `slug`, `name` | both | `slug` gives the `#project-<slug>` deep link on featured cards |
| `featured` | both | `true` puts the project in "Featured projects" |
| `hidden` | neither | `true` keeps the entry (validated) but renders it nowhere |
| `label`, `takeaway`, `highlights[]` | Featured | type line, one-sentence takeaway, 2+ engineering highlights |
| `tagline`, `detail` | More | optional short positioning line; one supporting paragraph |
| `summary` | both | what it is and what it does |
| `technologies[]` | both | rendered as tags |
| `links` | both | `github`, `live`, `liveLabel` (More), `documentation` and `release` (Featured) |
| `logo` | both | `{ file, source?, width?, height?, alt, className?, trim? }` |
| `screenshots[]` | both | `{ src \| local, width, height, alt, caption, label? }` |
| `video` | Featured | `{ src, page, poster, width, height, duration, title, caption }`; see [Project videos](#project-videos) |
| `tallScreenshots` | Featured | caps portrait or tall captures at 420px |

A featured project with a logo and screenshots gets a tabbed gallery: a Logo tab
followed by one tab per screenshot (`label`). A project with a `video` gets a
Video tab first, and the gallery opens on it. Without a logo, its first
screenshot is shown alone; with only a logo, the logo. In More projects, the first screenshot is the
preview, and clicking it opens every screenshot in the image viewer.

The file is plain data with no asset imports, so Node scripts
(`prepare:images`, `check:assets`) can read it too.

## Where images come from

| Image | Served from | Why |
| --- | --- | --- |
| Screenshots of public projects | `cdn.jsdelivr.net/gh/OWNER/REPO@SHA/path` | The repository is the source of truth; no copy lives here |
| Logos (all projects) | `src/assets/optimized/*.webp`, bundled | Shown at 44px or 260px. The originals are 250 KB to 1.4 MB |
| Private projects (585Dashcam585, 585photo585) | `src/assets`, through `prepare:images` | Private repositories have no public raw URLs |
| Video posters | `cdn.jsdelivr.net/gh/OWNER/REPO@SHA/path`, like screenshots | Committed to the project repository |
| Videos (Ordixa launch video) | `github.com/OWNER/REPO/releases/download/TAG/FILE` | Release attachment, not committed; jsDelivr cannot serve it |

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
- 1440 to 2880px on the long edge (a 2x capture of a 1440px window is fine),
  PNG for UI. Keep each file under about 600 KB: `check:assets` and
  `assets:refresh` warn above 1 MB, and `assets:refresh` refuses files over
  5 MB. Run captures through an optimizer
  such as `oxipng -o 4` or `pngquant --quality 80-95` before committing them
  to the project repository.
- Alt text describes what the screen shows, not what the feature is called.
  Captions are a short title for the viewer.
- Record the image's real `width` and `height`. They reserve layout space before
  the lazy image loads. `npm run assets:refresh -- --project <key>
  --update-dimensions` reads and writes them for you.

## Adding, updating, and refreshing projects

Step-by-step workflows (adding a project, replacing screenshots, the
`assets:refresh` command and its flags, size changes, troubleshooting, and
deploying) are in [PROJECT_MAINTENANCE.md](PROJECT_MAINTENANCE.md).

### Private or unavailable assets

- Never link raw URLs from a private repository. They 404 publicly, and a token
  in the URL would publish the token.
- For a private project, place the source image in `src/assets`, add it to
  `localImages` in `scripts/prepare-site-images.mjs`, and reference the
  derivative with `{ local: '<name>' }`.
- A project with no suitable image simply omits `screenshots` (and `logo`). The
  card renders without a visual. Do not create a placeholder screenshot.

## Project videos

A featured project may have one `video`, shown as the first gallery tab.

**Hosting.** jsDelivr's GitHub endpoint serves files *committed* to a
repository; GitHub Release attachments are not in the repository tree, so it
cannot serve them (`/gh/quangshuynh/ordixa@<sha>/launch.mp4` and
`.../docs/media/launch.mp4` both return 404). Ordixa's `launch.mp4` (6.9 MB,
1920x1080, H.264 + AAC, faststart) is deliberately not committed: the Ordixa
repository caps tracked files at 5 MB. So the video uses the release download
URL for a fixed tag:

```text
https://github.com/quangshuynh/ordixa/releases/download/v2.0.0/launch.mp4
```

That URL answers `302` to a short-lived signed URL on
`release-assets.githubusercontent.com`, which serves the file with
`Accept-Ranges: bytes` (`206` for range requests) and
`Content-Type: application/octet-stream`; Chromium plays it (checked in the
browser). The validator accepts only `releases/download/<tag>/` URLs from the
project's own repository, never `releases/latest/`, so a later release cannot
change what the page plays. Copying the MP4 into this repository would
duplicate 6.9 MB of media for no gain; do that only if the release URL proves
unreliable for a browser you care about.

**Poster.** `poster` is a commit-pinned jsDelivr image from the repository
(Ordixa: `docs/media/thumbnail.jpg`, 1920x1080, 221 KB), so it follows the same
pin as the screenshots. `assets:refresh` checks it and, with
`--update-dimensions`, keeps `video.width`/`height` equal to its size. Ordixa's
README GIF (`docs/media/ordixa-loop.gif`, 830 KB) is not used: it repeats the
video's content at a larger cost than the poster.

**Loading.** Only the poster (lazy, with intrinsic size) loads with the page.
The `<video>` element (with `controls`, `playsInline`, `preload="metadata"`)
is created when the visitor presses play, and playback with sound starts from
that press; nothing autoplays. With `prefers-reduced-motion: reduce` the player
loads paused and waits for its own controls. Poster, player, and fallback share
one 16:9 frame, so nothing shifts. If the video cannot play, a link to the
release page replaces it, and the caption always links there too.

**Checks.** `npm run check:assets` probes the video with a 1 KB range request:
it fails on a 4xx or a file that does not start like an MP4/WebM, warns when the
host ignores byte ranges, and prints the size. The full file is never
downloaded.

## Ordixa presentation

Ordixa (formerly Business Data Automation, same repository, renamed) is the
first featured project: v2.0.0 launch video, mark logo
(`docs/images/ordixa-logo2.png`, trimmed), and four real captures from its
fictional demos: the reconciliation Summary and Exceptions sheets, the
comparison change report, and the guided demo run. The copy covers what v2.0.0
implements: reconcile, clean, and compare workflows, versioned TOML profiles,
check-profile preflight, exact Decimal parsing, held-back rows with reasons,
atomic runs, checksummed manifests, and `verify`. It says the tool has been
exercised on fictional demo data, and claims no web dashboard, hosted app, or
customers (`docs/images/dashboard.png` in the repository is not used). There is
no deployed demo, so none is linked.

## Known limitations

- jsDelivr is a third-party CDN without an SLA; screenshots degrade to placeholders
  if it is down.
- jsDelivr serves files as committed and does not resize them. The gallery requests
  a screenshot only when its tab is opened, but that request is the full PNG
  (100 to 560 KB). Flipper's 2880x1800 recapture grew its four files from
  about 350 KB to 500 KB in total (108 to 131 KB each), within the guideline,
  so no resizing step was added.
- jsDelivr's GitHub endpoint has file-size limits. Screenshots should stay far below them anyway.
- Release videos depend on GitHub's release download service, which has no SLA
  and serves `application/octet-stream`. Chromium plays it; Safari and Firefox
  were not tested here. If a browser refuses it, the release link takes over.
- A release attachment can be deleted and re-uploaded under the same tag and
  name. The URL would not change, so `check:assets` prints the file size to make
  such a swap visible.
- `prepare:images`, `check:assets`, and `assets:refresh` need network access.
  `npm run build` and `npm test` do not.
- `assets:refresh` follows each repository's default branch only. To pin a
  commit from another branch, edit the SHA by hand and run `check:assets`.
