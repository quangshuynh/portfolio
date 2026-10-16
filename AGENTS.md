# AGENTS.md

Instructions for AI coding agents working in this repository: a personal
portfolio (React 19 + Vite, plain CSS) deployed to GitHub Pages and Vercel.
Human-facing workflows are in [docs/PROJECT_MAINTENANCE.md](docs/PROJECT_MAINTENANCE.md);
read it before changing projects or project assets.

## Important files

| Path | Role |
| --- | --- |
| `src/data/projects.mjs` | Single source of truth for homepage projects. Plain data, no asset imports (Node scripts read it). Array order is display order. |
| `src/data/githubAssets.mjs` | One commit pin per public project repository; `githubAsset(key, path)` builds pinned jsDelivr URLs. |
| `src/data/validateProjects.mjs` | Deterministic metadata checks, run by `npm test` and `check:assets`. |
| `src/components/sections/projectMedia.jsx` | Logo/screenshot gallery; `homeLightbox.jsx` is the image trigger, fallback, and viewer. |
| `scripts/asset-refresh.mjs` | Logic for `npm run assets:refresh` (CLI: `refresh-project-assets.mjs`). |
| `scripts/check-project-assets.mjs` | `npm run check:assets`: validation plus network probe of every remote image. |
| `scripts/prepare-site-images.mjs` | `npm run prepare:images`: WebP derivatives in `src/assets/optimized`. |
| `docs/project-assets.md` | Data model, caching rationale, screenshot guidelines. |

## Project metadata

- Edit projects only in `src/data/projects.mjs`. Featured entries stay above
  non-featured ones; order is curated by hand, never sorted or derived from
  GitHub. `hidden: true` removes a project from the page.
- Keep the curated lineup unless the user explicitly approves a change. Rank by
  verified evidence, describe only implemented capabilities, state maturity
  honestly (Ordixa: fictional demo data, never the old "Business Data
  Automation" name), and keep "DashPilot" until its repository ships the
  Worklane rebrand. Tests enforce these.
- Never delete, archive, or modify the project repositories themselves.
- Every screenshot needs real `width`/`height`, specific `alt` text, and a
  `caption`; featured gallery screenshots also need a short unique `label`.

## GitHub-hosted assets

- Public project images use `githubAsset('<key>', '<path>')`: commit-pinned
  jsDelivr URLs. Never use `@main`, tags, `raw.githubusercontent.com`, or
  hand-typed URLs; never purge jsDelivr.
- Move pins only with `npm run assets:refresh` (start with `--dry-run`); do not
  hand-edit SHAs unless pinning a non-default branch, and then verify with
  `--update-dimensions --dry-run` and `check:assets`.
- Private repositories get local derivatives (`{ local: '<name>' }`), never
  remote URLs. Never print, commit, or put `GITHUB_TOKEN` in a URL; it is
  optional.

## Screenshot sizes

- When a capture's size changes, run
  `npm run assets:refresh -- --project <key> --update-dimensions`; it writes the
  new size together with the new pin. Do not edit sizes or test expectations by
  hand to make tests pass.
- An aspect-ratio change needs `--allow-aspect-change` and visual review of the
  card. Do not add it without checking the layout.
- Logo `width`/`height` must equal the WebP derivative size printed by
  `prepare:images`.

## Tests

- Run `npm test` and `npm run build` before every commit; both are offline.
  `npm run check:assets` needs network and is also run in CI.
- Tests derive project expectations from `projects.mjs`. The only test that
  lists projects by name is the curated-order test in
  `src/data/projects.test.js`; update it only for an approved lineup change.
- Gallery behaviour is tested against fixtures in `projectMedia.test.jsx`; keep
  new component tests independent of real project data where possible.
- Mock all network access in tests (see `scripts/asset-refresh.test.mjs`). Never
  update an expected value just to silence a failure without finding the cause.

## Accessibility and responsive design

- Images keep meaningful `alt` text, intrinsic `width`/`height` (no layout
  shift), and `loading="lazy"` below the fold. Failed images must fall back to a
  labelled placeholder.
- Interactive elements are native buttons and links with visible focus,
  `aria-pressed`/`aria-expanded` state, and keyboard support; the image viewer
  is a modal dialog that returns focus on close. Respect reduced motion.
- Check changes at phone width (375px) as well as desktop, in light and dark
  themes. Breakpoints at 760px and 620px reorder featured cards and wrap gallery
  tabs; tests assert those CSS rules.

## Scope and git

- Make focused changes. Do not redesign layouts, restyle sections, rename
  tokens, add dependencies, or introduce a CMS, database, or image pipeline
  unless asked.
- Work on a feature branch from an up-to-date `main`; never commit directly to
  `main`. Write small, reviewable commits.
- Do not merge, open pull requests, tag, release, or deploy without the
  owner's approval. Merging to `main` deploys.
- Keep docs in step with behaviour: update `docs/PROJECT_MAINTENANCE.md` when a
  command, flag, or workflow changes, and the README only for setup-level
  changes.

## Photography

Public photos contain no identifiable people, and captions are short and
factual (no invented places, dates, or EXIF). Never rerun
`prepare:photography` over existing records; use `--only <ids>`.
