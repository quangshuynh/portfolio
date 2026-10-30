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
| `src/data/photography.catalog.json` | Photography catalog: every photograph, published or draft, in curated order. Schema and workflows in `docs/photography-catalog.md`; logic in `scripts/photography-catalog.mjs`. |
| `cms/` | Local photography CMS (`npm run cms`): server, API, publication, dashboard. Docs in `docs/photography-cms.md`. |
| `cms/lib/treatments.mjs`, `editor-api.mjs`, `treatment-publish.mjs`, `cms/admin/editorHost.jsx` | QuangEdit in the CMS (Interval 15): private treatments (edit document v10), editing sources, staged renders, approval, approved images in publication; the editor's CMS host (`EditorApp` `host` prop, served only by the CMS). Docs in `docs/photography-cms.md` (Editing in QuangEdit). |
| `docs/photography-platform/` | Interval 0 audit and architecture for the photography CMS and editor (planning only). |
| `src/editor/raw/` | Editor RAW support (Interval 5): content sniffing, LibRaw wrapper, colour math, worker tasks, queue. Behaviour, limits and measurements in `docs/photography-editor.md` (RAW); notices in `public/photography/third-party-notices.txt`. |
| `src/editor/hdr/` | Merge HDR (Interval 6): bracket validation, registration, radiance merge, exposure fusion, ghost masks, staged export. Behaviour, limits and measurements in `docs/photography-editor.md` (Merge HDR). Genuine-file tests need `HDR_FIXTURE_DIR`. |
| `src/editor/batch/` | Batch export (Interval 8): queue, collision-safe `-quangedit` names, ZIP parts with client-zip. Selection, sync and batch undo are in `src/editor/model/`; behaviour and limits in `docs/photography-editor.md` (Batch editing). |
| `src/editor/pipeline/geometry.mjs`, `warp.mjs` | Crop & Transform (Interval 10): geometry model and transform order, inverse-mapped resampling shared by preview (shader mirror) and export. Behaviour and limits in `docs/photography-editor.md` (Geometry). |
| `src/editor/pipeline/creative.mjs`, `src/editor/model/overlays.mjs`, `src/editor/text/` | Creative stage and looks (Interval 11), text overlays (schema, bundled OFL fonts, layout, export sprites). Behaviour and limits in `docs/photography-editor.md` (Creative and text). |
| `src/editor/pipeline/digital.mjs`, `src/editor/model/filters.mjs` | Digital effects and the Filter Library (Interval 11.5): capture, JPEG, channel shift, noise; original filters, filter record, thumbnails (`ui/filterThumbs.mjs`). Behaviour, resolution semantics and limits in `docs/photography-editor.md` (Creative and text). |
| `src/editor/model/layers.mjs`, `src/editor/pipeline/composite.mjs`, `blend.mjs`, `compositeShader.mjs` | Layers (Interval 12): stack schema and v8→v9 migration, W3C blend modes, CPU compositor and GLSL mirror; export in `src/editor/io/composeLayers.mjs`, UI `ui/LayersPanel.jsx`. Behaviour and limits in `docs/photography-editor.md` (Layers). |
| `src/editor/model/masks.mjs`, `src/editor/pipeline/mask.mjs` | Masks and local adjustments (Interval 13): mask schema (image, canvas or layer space; brush strokes, linear and radial gradients), doc v10, per-pixel coverage used by `composite.mjs` and the composite shader; UI `ui/MaskPanel.jsx`, `ui/MaskTool.jsx`. Behaviour and limits in `docs/photography-editor.md` (Masks and local adjustments). |
| `src/editor/model/recipes.mjs`, `recipeReference.mjs` | QuangEdit Recipes (Interval 14): portable recipe JSON (own version, v1), validation, replace/merge apply, saved library, generated authoring reference (`npm run recipe:reference`). UI `ui/RecipeDialog.jsx`, `ui/RecipePanel.jsx`. Behaviour and limits in `docs/photography-editor.md` (QuangEdit Recipes). |
| `src/editor/watermark/`, `cms/lib/watermark.mjs`, `cms/lib/watermark-rules.mjs`, `cms/admin/components/WatermarkView.jsx` | HUYNH Photography watermark (Interval 16.7): the one design spec, layout and renderer (`adjustments.watermark`, doc v11); CMS global preference, portfolio overview, bulk staging rules and review view. Behaviour in `docs/photography-editor.md` (Watermark) and `docs/photography-cms.md` (Watermark). |
| `experiments/raw-decode-poc/` | Isolated RAW decoding proof of concept with its own `package.json`; not part of the site build or root `npm test`. |

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

- Edit photographs only in `src/data/photography.catalog.json`, then run
  `npm run check:photography` (`-- --write` fixes formatting).
- Drafts must never get a manifest entry or derivative; the build fails if
  they do.
- Never change a published `id` or `slug`.
- Keep the 14 orphaned derivatives until the owner approves removing them.
- The CMS is local-only (loopback, sign-in link, session cookie). Do not add
  a hosted admin route, API or CMS code to the public build.
- Never commit, build from or serve the CMS workspace (drafts and private
  originals, outside the repository).
- Never run a live CMS publication or create pull requests from it without
  the owner's approval; tests mock GitHub.

## Token Efficiency & Documentation Rules

Prioritize implementation, correctness, testing, and maintainability over lengthy documentation or explanations.

**Documentation**
- Keep documentation concise, practical, and proportional to the changes.
- Update existing documentation instead of creating new files whenever possible.
- Avoid repeating information already documented elsewhere.
- Do not generate lengthy architecture reports, implementation diaries, or excessive Markdown files.
- Keep README updates brief and focused on installation, usage, configuration, and essential limitations.
- Document important architectural decisions, security considerations, and non-obvious behavior, but avoid explaining straightforward code.
- Do not create documentation files solely to summarize work already described in the final handoff.
- Prefer short tables, bullet points, and references to existing documentation over long prose.

**Implementation**
- Spend tokens on working code, debugging, tests, and verification rather than narrating every step.
- Avoid unnecessary abstractions, dependencies, and speculative future architecture.
- Use clear naming and self-explanatory code instead of excessive comments.
- Do not sacrifice security, correctness, accessibility, or test coverage to reduce token usage.

**Communication**
- Keep progress updates minimal. Only report significant milestones, blockers, or decisions.
- Do not repeatedly summarize completed work.
- Avoid printing large files, full logs, or extensive test output unless necessary for debugging.
- Use targeted searches, diffs, and test runs instead of repeatedly reading entire files.
- Keep the final handoff to approximately 300–500 words, preferably shorter.

**Final handoff format**
1. What changed (3–6 bullets).
2. Branch and commits.
3. Tests and build results.
4. Important limitations or blockers.
5. Recommended next interval.

**Core rule:** Be concise in documentation and communication, but thorough in implementation and verification. Optimize token usage without cutting essential functionality or quality.