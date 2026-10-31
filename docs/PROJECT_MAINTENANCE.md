# Project maintenance

How to add, change, reorder, and retire projects on the homepage, and how to
keep their GitHub-hosted screenshots and logos current. Background on the data
model, why assets are served from jsDelivr, and screenshot guidelines is in
[project-assets.md](project-assets.md).

## Quick reference

| Command | Network | What it does |
| --- | --- | --- |
| `npm test` | no | Runs every test, including the project data validator |
| `npm run build` | no | Production build |
| `npm run dev` | no | Local site at http://localhost:5173 |
| `npm run assets:refresh -- --dry-run` | yes | Shows which pins would move and why; writes nothing |
| `npm run assets:refresh -- --project <key>` | yes | Moves one repository's pin to its verified latest commit |
| `npm run assets:refresh -- --project <key> --update-dimensions` | yes | Same, and accepts screenshots whose size changed (same shape) |
| `npm run assets:refresh` | yes | Refreshes every repository |
| `npm run prepare:images` | yes | Regenerates the WebP logo and local-image derivatives |
| `npm run check:assets` | yes | Validates data, fetches every remote image, and probes release videos |
| `npm run check:photography` | no | Validates the photography catalog and its derivatives ([photography-catalog.md](photography-catalog.md)) |
| `npm run check:photography:viewer` | no | Builds the site and checks the gallery viewer's fullscreen in Playwright WebKit (iPhone 13 emulation, desktop), Chromium (Pixel 7 emulation, desktop) and Firefox: stage fills the viewport, portrait/landscape/square/panoramic photos fit uncropped, a 4× pinch uses the whole viewport and stays anchored, pans stop at the edges, double tap, Reset zoom, rotation, previous/next, swipes (a zoomed drag only pans), no DOM changes during pinch and pan (cost per move printed), Esc, page never scrolls and closing restores its scroll. `VIEWER_ENGINES=webkit-iphone,…` limits runs; `SHOTS_DIR` saves screenshots |
| `npm run check:editor` | no | Builds the site and checks the photo editor end to end in a local Playwright Chromium: GPU/CPU parity, import, export, memory ([photography-editor.md](photography-editor.md)) |
| `npm run check:editor:raw` | no | Builds the site and checks RAW in Playwright Chromium, Firefox and WebKit (plus iPhone emulation and no WebGL2): RAW GPU/CPU parity, synthetic DNG import, unsupported and damaged files, white balance, exports against the Node reference, `-quangedit` names. With `RAW_FIXTURE_DIR` (folder with `DSC09420.ARW`) also a genuine ARW import and full-size export with timings and memory; `NEF_FIXTURE_DIR` (folder with `_DSC0051.NEF`) a genuine Nikon NEF with exposure, crop and watermark exported at full size. RAW camera files are never committed; both variables also enable `src/editor/raw/rawFixtures.test.js` in `npm test` |
| `npm run check:editor:hdr` | no | Builds the site and checks Merge HDR in Playwright Chromium, Firefox and WebKit (plus iPhone emulation and no WebGL2): HDR GPU/CPU parity, bracket validation, roles from EXIF, merge, tone controls, export against the Node reference, cancellation, exposure fusion, saved edits. With `HDR_FIXTURE_DIR` (folder with the A7 III `_DSC9015–9017.ARW` DRO set) also the refusal of that set and full-size timings and memory; the same variable enables `src/editor/hdr/hdrFixtures.test.js` in `npm test`. `HDR_BRACKET_DIR` (a genuine three-file bracket, e.g. DSC09640–09642) adds a full-size merge and export; `HDR_BRACKET_DIR` and `HDR_AUTO_ISO_DIR` also enable their cases in `hdrFixtures.test.js` |
| `npm run check:editor:detail` | no | Builds the site and checks the Detail section in Playwright Chromium, Firefox and WebKit (plus iPhone emulation and no WebGL2): controls, draft/final preview, compare, PNG export against the Node reference, 24 MP export timing and memory. With `DETAIL_FIXTURE_DIR` (folder with one `.ARW`) also a genuine RAW |
| `npm run check:editor:creative` | no | Builds the site and checks the Creative and Text sections in Playwright Chromium, Firefox, WebKit, iPhone 13 and Pixel 7 emulation (touch) and without WebGL2: a look and every effect, PNG exports against the Node reference (also with geometry), text added, bold and italic faces drawn at their weight with the same advances in every engine, dragged and rotated with its placement compared between the preview and two export sizes, paste without text and a ZIP equal to the single export, 24 MP timing and memory. With `CREATIVE_FIXTURE_DIR` (three Sony `.ARW` of one scene) also a genuine RAW, a merged HDR with bloom and halation, and cancelled exports. `CHECK_GPU=1` runs Chromium on the machine's GPU |
| `npm run check:editor:filters` | no | Builds the site and checks the Filter Library in Playwright Chromium, Firefox, WebKit, iPhone 13 and Pixel 7 emulation and without WebGL2: thumbnails, search, categories, favourites, switching latency, strength, Compare, undo, PNG exports of the digital filters (also with geometry and transparency) against the Node reference, a batch filter and a ZIP, 24 MP timing and memory. With `FILTER_FIXTURE_DIR` (genuine Sony `.ARW` and `.JPG`; three ARWs for HDR) also genuine JPEG, RAW and merged HDR exports. `CHECK_GPU=1` runs Chromium on the machine's GPU |
| `npm run check:editor:layers` | no | Layer compositing parity (WebGL2 vs CPU and vs the browser's canvas blend modes, on the dev server), then a production build in Playwright Chromium, Firefox, WebKit, iPhone 13 and Pixel 7 emulation and without WebGL2: image, text and adjustment layers from the Layers panel, blend, opacity, transform, reorder, drag, undo, PNG exports against the Node reference, reload and reconnect, batch ZIP, 24 MP timing and memory. With `LAYER_FIXTURE_DIR` (genuine Sony `.ARW` and `.JPG`; three ARWs for HDR) also layers over RAW and merged HDR. `CHECK_GPU=1` runs Chromium on the machine's GPU; `LAYER_RUNS=chromium,…` limits runs |
| `npm run check:editor:masks` | no | Masked-pass parity (WebGL2 vs CPU, dev server), then a production build in Playwright Chromium, Firefox, WebKit, iPhone 13 and Pixel 7 emulation and without WebGL2: local adjustments from the Masks panel (gradient dragged while zoomed, brush, radial with Clarity), undo, PNG exports against the Node reference, save/reload/reopen, geometry with masked adjustment and image layers, overlay and keys, touch painting and phone layout, 24 MP timing and memory (Chromium: exact PNG, so no band seams). With `MASK_FIXTURE_DIR` (genuine Sony `.ARW`; three for HDR) also RAW exports with unchanged pixels outside the masks, a masked text layer and a merged HDR with a local gradient. `MASK_RUNS=chromium,…` limits runs |
| `npm run check:editor:brush` | no | Builds the site and paints a brush stroke on a 24 MP photo from inside the page (one move per frame) in Playwright Chromium, without WebGL2, iPhone 13 (WebKit) and Pixel 7 emulation: hovering with real mouse input first (input → frame showing the brush outline, p50/p95; fails if hovering draws the preview), then input → draw latency and frame intervals (p50/p95), long animation frames, overlay drawn incrementally equal to a full redraw, one undo step per stroke. `CHECK_GPU=1` uses the real GPU in Chromium (otherwise SwiftShader); `BRUSH_FIXTURE_DIR` adds a genuine JPEG; `BRUSH_PROFILE=1` prints the CPU profile; `BRUSH_STRICT=1` fails when the median exceeds `BRUSH_MAX_MAIN_MS` (40). `BRUSH_RUNS=chromium,…` limits runs. Also reports the first point (pointerdown → first composited frame) and, on touch runs, pinches with the brush on (zooms, paints nothing). `BRUSH_LOCAL=clarity` paints a local Clarity instead of exposure, twice, and reports how many moves showed it and release → final; `BRUSH_PAUSE_MS` (500) is the pause before painting |
| `npm run check:editor:watermark` | no | Builds the site and checks the HUYNH watermark in Playwright Chromium, Firefox, WebKit, iPhone 13 and Pixel 7 emulation and without WebGL2: preview box against the export layout, PNG unchanged outside the mark and border at the exact blend, auto colour (charcoal on bright, white on dark), undo/redo, square crop, JPEG and WebP, Sync and ZIP with and without watermarks, text positions across engines, 24 MP export time and the watermark step itself. `WATERMARK_FIXTURE_DIR` (Sony `.ARW`) adds a RAW export; `WATERMARK_OUT` keeps the files; `EDITOR_ENGINES=chromium,…` limits runs |
| `npm run check:editor:retouch` | no | Builds the site and checks Remove, Spot Heal and Clone Stamp in Playwright Chromium, Firefox, WebKit, iPhone 13 and Pixel 7 emulation and without WebGL2: heal by click or tap, clone with Alt-click or Set source, a removal filled in the background and a source area, undo/redo, PNG export equal to the Node reference, a 90° turn, save/reload/reopen, 24 MP timing; on the phone emulations a touch step (a pinch drops the stroke, a finger landing again mid-pinch paints nothing, a tool change drops a stroke, Pan moves the photo, Set source taken where the finger lifts, 44 px controls, no page scroll). `RETOUCH_RAW_DIR` (a Sony .ARW and a Nikon .NEF) adds genuine full-size exports changed only inside the repairs and a batch ZIP of both; `RETOUCH_HDR_DIR` (one three-frame RAW bracket) merges it in Chromium and Firefox, then heals, clones, removes (overlapping, one cancelled), applies grading, sharpening, a local mask, the watermark, crop, straighten and perspective through a v13 document and checks full-size exports and preview against export; `CHECK_GPU=1` times Chromium on the real GPU |
| `npm run bench:remove` | no | Remove quality and speed against a baseline revision (`--baseline <ref>`, default `4357bd3`, Interval 19 merged): synthetic and portfolio-photo scenes in three groups (regression, hard, structure: lane markings, railings, building edges, wires, crossings, curves, tiles, irregular masks), 3 seeds each (colour error, low-frequency colour, continuity and false edges inside the object, structure, sharpness, seam, repetition, object leak), 24 MP fill time and peak memory per radius. Writes report.json and side-by-side PNGs to `--out` (default: a temp folder); never commit them |
| `npm run check:editor:recipes` | no | Builds the site and checks QuangEdit Recipes in Playwright Chromium, Firefox, WebKit, iPhone 13 and Pixel 7 emulation and without WebGL2: invalid JSON errors, review and Cancel, merge and replace keeping crop, text layer and mask, undo/redo, Copy settings (clipboard or fallback), save/export/import, missing and wrong LUT, batch on PNG, JPEG and WebP with batch undo, PNG export against the Node reference, phone layout, no network requests. With `RECIPE_FIXTURE_DIR` (genuine Sony `.ARW` and `.JPG`; three ARW for HDR) also genuine JPEG/RAW and a merged HDR. `RECIPE_RUNS=chromium,…` limits runs |
| `npm run recipe:reference` | no | Prints the QuangEdit Recipe authoring reference (same text as the editor's Recipe instructions) |
| `npm run check:editor:geometry` | no | Builds the site and checks Crop & Transform in Playwright Chromium, Firefox and WebKit (plus iPhone emulation with touch and no WebGL2): crop by pointer and keyboard, Cancel/Apply, straighten, ratio, flip, perspective, zoom on the output grid, PNG exports (with and without Detail) against the Node reference, a batch ZIP with resize, 24 MP timing and memory. With `GEOMETRY_FIXTURE_DIR` (three Sony `.ARW` of one scene) also a genuine RAW (1:1 and export) and, in Chromium, a merged HDR export |
| `npm run check:editor:batch` | no | Builds the site and checks batch editing in Playwright Chromium, Firefox, WebKit and iPhone/Pixel emulation: selection (click, Ctrl/Cmd, Shift, select all, touch mode), copy/paste and batch undo, Sync, presets, Export selected as a ZIP (entries, CRC, sizes) and as files, custom names, cancel and retry, repeated batches with memory. With `BATCH_FIXTURE_DIR` (three Sony `.ARW`, e.g. a bracket) also the genuine RAW and merged HDR flow in Chromium; `BATCH_OUT` keeps results and downloads |
| `npm run check:raw:compat` | no | RAW compatibility matrix in Node with the editor's own decoder and worker handlers: identification, LibRaw metadata, half and full decode timings and wasm heap, white balance re-application, colour against the embedded JPEG, full-size export with a representative edit. Needs `RAW_COMPAT_DIR` (genuine RAW files, never committed); `RAW_COMPAT_ONLY` (regex), `RAW_COMPAT_OUT` (JSON). Results: `docs/raw-compatibility.md` |
| `npm run check:editor:raw-formats` | no | Every file in `RAW_COMPAT_DIR` in the production editor: import and refusals, a v13 document (tone, HSL, curve, grading, Detail, white balance, crop, mask, heal, watermark), full-size and watermark exports, mixed-format ZIP, cancel and retry, save and reopen. Chromium and Firefox; `RAW_WEBKIT_GENUINE=1` adds WebKit and iPhone emulation; `EDITOR_ENGINES`, `RAW_FORMATS_OUT` |
| `npm run check:editor:raw-stability` | no | Regression check for the Playwright WebKit LibRaw crash (one-decoder pattern fixed in Interval 9; HDR exports from RAW still crash in WebKit) with the production RAW worker: fresh or reused workers, one or two at once, half or full decodes, desktop or iPhone emulation, each failure classified; exits non-zero on any failure (two decoders at once still crash, the editor runs one). Needs `RAW_STABILITY_DIR` (Sony `.ARW` files); `TRIALS`, `JOBS`, `SCENARIOS`, `ENGINES`, `OUT` |
| `npm run check:editor:memory` | no | Identical cycles of the heavy editor workflows in Chromium with genuine files; records the test browser's working set and private memory per process type (browser, renderer, GPU), page heap, live ArrayBuffers, canvases, ImageBitmaps and workers after each step, a 250 ms timeline per step, and fails on growth between the last two cycles or leftover workers. Needs `MEMORY_FIXTURE_DIR` (three `.ARW` of a bracket and a `.JPG`); `MEMORY_CYCLES` (2), `MEMORY_REPEATS`, `MEMORY_OUT`, `MEMORY_GROWTH_LIMIT_MB`, `CHECK_GPU=1`, `MEMORY_SKIP_BUILD=1` |
| `npm run check:editor:engines` | no | Builds the site and runs the editor flow (load, import, adjust, compare, export) in Playwright WebKit (iPhone emulation and desktop), mobile Chromium and Firefox, plus no-WebGL2 and no-worker fallbacks. First run `npx playwright install webkit firefox chromium` |
| `npm run cms` | yes (publishing) | Local photography CMS: drafts, uploads, ordering, preview, QuangEdit treatments, publication pull requests ([photography-cms.md](photography-cms.md)). `--library-dir` (or `PHOTOGRAPHY_LIBRARY_DIR`) lets QuangEdit read camera-library originals in place |
| `npm run check:cms:editor` | no | Starts the CMS (offline, temporary workspace, no GitHub call; branches only in a temporary clone) and checks QuangEdit in the CMS in Playwright Chromium, Firefox, WebKit, iPhone 13 and Pixel 7 emulation and without WebGL2: open from the details panel, saved treatment restored, recipe merged keeping mask and rotation, save, full-resolution render, review and approve, a published photograph's limitation and queued image, the Watermark view (preference, bulk staging of one photo through the queue, resume of a stopped run reporting it unchanged, explicit approval, the mark only inside its box, preference kept after remove-approved), phone layout, no request leaving 127.0.0.1. With `CMS_EDITOR_FIXTURE_DIR` (three Sony `.ARW`) Chromium also attaches and renders a RAW and a merged HDR, then runs the HDR watermark workflow on a published photograph: retouching and adjustments, an automatic draft cancelled mid-merge and resumed, a redraft after a retouch change, approval, and a publication dry run in a temporary clone (no camera file in its commit). `CMS_RAW_FORMATS_DIR` (other cameras, e.g. the RAW compatibility samples) adds one attach, full-size render and reopen per validated format plus a refused SRF. `CMS_EDITOR_RUNS=chromium,…` limits runs |


Everything about a project lives in two files:

- `src/data/projects.mjs`: one entry per project (copy, links, logo,
  screenshots, sizes, alt text). Array order is display order.
- `src/data/githubAssets.mjs`: one commit pin per public repository. Asset URLs
  are built from `githubAsset('<key>', '<path>')`, so a pin change moves every
  image from that repository at once. The key is normally the project's slug.

## The usual case: new screenshots in a project repository

1. In the project repository, replace the images (same paths are simplest),
   commit, and push to the default branch.
2. In this repository, on a branch:

   ```bash
   npm run assets:refresh -- --project flipper --update-dimensions --dry-run
   ```

   Read the report. It lists the proposed pin, which referenced images changed,
   and any recorded sizes that would change.
3. Apply it:

   ```bash
   npm run assets:refresh -- --project flipper --update-dimensions
   ```

4. If the report says `logo changed`, run `npm run prepare:images`.
5. `npm test`, `npm run check:assets`, look at it with `npm run dev`, review
   `git diff`, commit, and open a pull request.

No test expectations need editing: tests read sizes from `projects.mjs`.

### What the Flipper refresh looked like

Flipper's four captures were re-taken at 2880x1800 (previously 1600x1000, the
same 16:10 shape). Without `--update-dimensions` the refresh stops and keeps
the old pin:

```text
SKIP    flipper (quangshuynh/flipper): latest 652b25c fails checks, nothing changes, pin stays at 921dac5
          - screenshot docs/images/flipper-dashboard.png: now 2880x1800, projects.mjs records 1600x1000 (same aspect ratio, flipper); rerun with --update-dimensions to accept the new size
          ...
```

With it, the pin and all four sizes change together:

```text
update  flipper (quangshuynh/flipper): 921dac5 -> 652b25c
          commit: '921dac59074cbcf2ba777cc5f00c4b6c4668f8e4'
       -> commit: '652b25cfbb73fa44d4d47a3dfcf2b228176526aa'
          referenced images changed: screenshot docs/images/flipper-dashboard.png, ...
          sizes in projects.mjs:
            flipper docs/images/flipper-dashboard.png: 1600x1000 -> 2880x1800 (same aspect ratio)
            ...
```

The resulting diff is one changed SHA in `githubAssets.mjs` and eight changed
numbers in `projects.mjs`, nothing else.

## Screenshot size and shape changes

`width` and `height` reserve the image's box before it loads, so they must match
the file. The refresh compares each referenced screenshot with its recorded
size:

| Change | Default | `--update-dimensions` | `--update-dimensions --allow-aspect-change` |
| --- | --- | --- | --- |
| Same size | accepted | accepted | accepted |
| New size, same shape (e.g. 2x capture) | blocked | **written** | written |
| Different shape (e.g. 16:10 to 4:3) | blocked | blocked | **written** |

A different shape changes the card's layout, so `--allow-aspect-change` also
requires `--project`, and the report prints the old and new ratios. Check the
card visually afterwards. A tall phone capture in a project that does not set
`tallScreenshots: true` needs that flag too.

`--update-dimensions` also checks a repository whose pin is already current.
That fixes sizes after a pin was edited by hand:

```bash
npm run assets:refresh -- --project flipper --update-dimensions --dry-run
```

Logos are different: their `width`/`height` record the WebP derivative written
by `prepare:images`, and `npm test` fails if the two disagree. Copy the size
that `prepare:images` prints.

## Asset refresh CLI

```text
npm run assets:refresh -- [options] [repository ...]

  repository              key(s) from githubAssets.mjs (default: all)
  --project K, -p K       same as passing K
  --dry-run, -n           report only; write nothing
  --update-dimensions     accept same-shape size changes; also check current pins
  --allow-aspect-change   with --update-dimensions and --project: accept shape changes
  --help, -h              usage
```

For each requested repository it asks the GitHub API for the latest commit on
the default branch, downloads every image `projects.mjs` references from that
repository at that commit (anonymously, from `raw.githubusercontent.com`), and
checks that each one exists, is under 5 MB, decodes as png, jpeg, webp, avif,
gif, or svg matching its extension, and has the recorded size. Only if every
check passes does it propose the new pin.

What it guarantees:

- A repository that fails any check changes nothing: its pin and its recorded
  sizes stay as they were, so the site keeps serving what it was built with.
- `--project flipper` touches only Flipper's pin and Flipper's screenshots.
- Writes are all-or-nothing. Both files are staged beside the originals,
  re-imported, and compared with the planned change before replacing them. If a
  file was edited while the command ran, nothing is written.
- It runs no git commands and never purges jsDelivr.
- Hidden projects are skipped.

Exit codes: `0` success (or nothing to do), `1` a requested repository was
skipped or the write failed, `2` bad arguments. Unknown repository keys and
options stop the run instead of falling back to "all".

### GitHub token (optional)

Unauthenticated, GitHub allows 60 API requests an hour; a refresh uses two per
repository (three with a token). If you hit the limit:

```bash
GITHUB_TOKEN=$(gh auth token) npm run assets:refresh -- --dry-run
```

`GH_TOKEN` works too. A fine-grained token with no extra permissions is enough.
The token is sent only to `api.github.com`, never to file downloads, and is not
printed or written. With a token, a repository the token can see but the public
cannot is refused explicitly. Never put a token in a URL or in `.env` files that
are committed.

## Troubleshooting a skipped refresh

| Report | Meaning | What to do |
| --- | --- | --- |
| `not found at this commit` | file renamed, moved, or deleted | restore it, or fix the path in `projects.mjs` |
| `every referenced file is missing` | images moved, or the repository went private | as above; private projects use local images |
| `now WxH, projects.mjs records WxH (same aspect ratio ...)` | re-captured at another size | rerun with `--update-dimensions` |
| `aspect ratio changed from A to B` | new shape | check the capture, then `--project K --update-dimensions --allow-aspect-change` |
| `not a readable image` | corrupt file or Git LFS pointer | commit the real image |
| `decodes as X, but the extension says Y` | wrong extension or format browsers cannot show | re-export as png/jpeg/webp under a matching name |
| `... KB is over the 5120 KB limit` | far too large for a portfolio | optimize it (see project-assets.md), push, rerun |
| note: `... is N KB; visitors download it at full size` | over 1 MB; not blocking | consider optimizing |
| `HTTP 5xx, could not verify` / `timed out` / `unreachable` | GitHub or network hiccup | rerun later |
| `rate limited by raw.githubusercontent.com` | too many downloads | wait a few minutes |
| `GitHub API rate limit reached (... resets at HH:MM UTC)` | over 60 calls this hour | wait, or set `GITHUB_TOKEN` |
| `GitHub rejected the token (HTTP 401)` | expired or wrong token | fix or unset it |
| `repository not found or not public (HTTP 404)` | renamed, deleted, or private | fix `owner`/`repo` in `githubAssets.mjs`, or switch to local images |
| `repository is private` | only the token can see it | use local images |
| `changed on disk during the run` | a data file was edited mid-run | rerun |

The command follows each repository's default branch. To pin another commit,
edit the SHA by hand, then run
`npm run assets:refresh -- --project <key> --update-dimensions --dry-run` and
`npm run check:assets`.

## Adding a project

1. **Repository.** Make sure the GitHub repository is public. Private projects
   use local images (see below).
2. **Images in the project repository.** Commit the logo (transparent PNG) and
   screenshots, usually under `docs/images/`, following the guidelines in
   [project-assets.md](project-assets.md#screenshot-guidelines). Push.
3. **Pin.** Add one line to `repositories` in `src/data/githubAssets.mjs`, keyed
   by the project's slug, at the repository's current commit:

   ```bash
   git ls-remote https://github.com/quangshuynh/<repo> HEAD
   ```

   ```js
   newproject: { owner: 'quangshuynh', repo: 'newproject', commit: '<40-character SHA>' },
   ```

   Keep it on one line; the refresh command edits that line.
4. **Entry.** Add the project to `src/data/projects.mjs` where it should appear.
   A More projects entry:

   ```js
   {
     slug: 'newproject',
     name: 'NewProject',
     summary: 'What it is and what it does, in one sentence.',
     detail: 'One supporting paragraph on how it is built.',
     technologies: ['Python', 'FastAPI'],
     links: { github: 'https://github.com/quangshuynh/newproject' },
     logo: {
       file: 'newproject-logo',
       source: githubAsset('newproject', 'docs/images/newproject-logo.png'),
       alt: 'NewProject project logo',
     },
     screenshots: [
       {
         src: githubAsset('newproject', 'docs/images/dashboard.png'),
         width: 1, // filled in by the refresh below
         height: 1,
         alt: 'Describe what the screen shows',
         caption: 'Short title for the image viewer',
       },
     ],
   },
   ```

   A featured entry adds `featured: true`, `label`, `takeaway`, two or more
   `highlights`, a short `label` on each screenshot (gallery tab), and
   `width`/`height` on the logo; it omits `detail`. Copy an existing entry as a
   starting point. Put a demo in `links.live` and docs in
   `links.documentation` (featured) or `links.live` with
   `liveLabel: 'Documentation'` (More).
5. **Sizes.** Let the refresh read the real sizes and verify every file is
   publicly reachable at the pinned commit:

   ```bash
   npm run assets:refresh -- --project newproject --update-dimensions --allow-aspect-change --dry-run
   npm run assets:refresh -- --project newproject --update-dimensions --allow-aspect-change
   ```

6. **Logo derivative.** `npm run prepare:images` writes
   `src/assets/optimized/newproject-logo.webp` and prints its size; for a
   featured project, copy that size into `logo.width`/`logo.height`. Commit the
   WebP.
7. **Validate.** `npm test` (metadata, URLs, sizes, derivatives, alt text) and
   `npm run check:assets` (every remote image actually loads).
8. **Look at it.** `npm run dev`, then open
   http://localhost:5173/#project-newproject (featured) or the More projects
   section. Check every gallery tab, the image viewer, a narrow window, and
   dark mode.
9. **Curation test.** `src/data/projects.test.js` pins the curated order; add
   the slug there. This is the one test that changes when the lineup changes.
10. **Publish.** See [Validate and deploy](#validate-and-deploy).

### Private projects

Never link raw URLs from a private repository. Put the source image in
`src/assets`, add it to `localImages` in `scripts/prepare-site-images.mjs`, run
`npm run prepare:images`, and reference the derivative with
`{ local: '<name>', width, height, ... }`. Omit `links.github`. A project
without a suitable image simply omits `screenshots` (and `logo`); do not make a
placeholder.

## Changing projects

- **Copy.** Edit `summary`, `detail`, `tagline`, `takeaway`, `highlights`, or
  `technologies` in `projects.mjs`. Describe only what the repository actually
  implements; state maturity in the copy (for example Ordixa's "exercised on
  fictional demo data").
- **Reorder.** Move the entry within the array. Featured entries must stay
  above all others (the validator enforces it). Update the order in
  `src/data/projects.test.js`.
- **Promote or demote.** Flip `featured` and move the entry across the
  boundary. A featured project needs `label`, `takeaway`, `highlights`, gallery
  `label`s, and a sized logo; a More project needs `detail`, and its docs link
  moves from `links.documentation` to `links.live` + `liveLabel` (`video` and
  `links.release` are featured-only and must be removed). After flipping, run
  `npm run prepare:images`: featured logos are 780px derivatives, More logos
  132px, so record the new size on a featured logo and drop it on a demoted one.
  `npm test` lists anything missing.
- **Take off the page.** Set `hidden: true` to keep the entry (still validated,
  easy to restore) without rendering it (Repo Radar is kept this way). Older
  and archived work is reached through the GitHub link under More projects,
  not listed. Hidden entries are still in the
  JavaScript bundle; delete the entry instead if it must not be public, and
  remove its pin from `githubAssets.mjs` (`check:assets` reports unused pins).
  Never delete or archive the GitHub repository for this.
- **Rename.** Change `name` and alt text. Keep `slug` unless the old
  `#project-<slug>` link may break; if the repository was renamed, update
  `owner`/`repo` in `githubAssets.mjs` and `links.github`.
- **Replace a logo.** Push the new file to the project repository. If the path
  changed, update `logo.source`. Refresh the pin, run `npm run prepare:images`,
  and copy the printed size into `logo.width`/`logo.height` for featured
  projects.
- **Add, rename, or remove a screenshot.** Edit the `screenshots` array, then
  refresh with `--update-dimensions` (new files start with the
  `width: 1, height: 1` placeholders and need `--allow-aspect-change`).

## Adding a project video

Featured projects only. The video file stays a GitHub Release attachment (do
not commit large MP4s here or in the project repository); its poster is a
committed image.

1. Attach the video (H.264 + AAC MP4 with faststart) to a tagged release of the
   project repository, and commit a poster frame (JPEG, same size) under
   `docs/media/` or `docs/images/`. Push.
2. Refresh the pin so the poster is reachable:
   `npm run assets:refresh -- --project <key> --dry-run`, then without
   `--dry-run`.
3. Add the entry, using the tag-versioned download URL (never
   `releases/latest/`):

   ```js
   video: {
     src: 'https://github.com/quangshuynh/<repo>/releases/download/v1.0.0/launch.mp4',
     page: 'https://github.com/quangshuynh/<repo>/releases/tag/v1.0.0',
     poster: githubAsset('<key>', 'docs/media/thumbnail.jpg'),
     width: 1920,
     height: 1080,
     duration: 23, // whole seconds, shown on the play button
     title: '<Project> v1.0.0 launch video',
     caption: 'One line about what the video shows',
   },
   ```

4. `npm test` and `npm run check:assets` (the video probe prints its size and
   whether byte ranges work). Press play in `npm run dev`, with and without
   reduced motion.

For a new release, change the tag in `src` and `page` together; the validator
rejects a page for a different tag. See
[project-assets.md](project-assets.md#project-videos) for why release URLs are
used instead of jsDelivr.

## Verifying jsDelivr URLs

Every remote URL has the form
`https://cdn.jsdelivr.net/gh/OWNER/REPO@<40-character SHA>/path/to/file.png`.
`npm run check:assets` fetches each one, fails on a 4xx or non-image, and warns
on 5xx, timeouts, missing `immutable` caching, and files over 1 MB. To check
one by hand:

```bash
curl -sI https://cdn.jsdelivr.net/gh/quangshuynh/flipper@652b25cfbb73fa44d4d47a3dfcf2b228176526aa/docs/images/flipper-research.png
```

Expect `200`, `content-type: image/png`, and `cache-control` containing
`immutable`. Pinned URLs never change, so there is nothing to purge: a new image
gets a new URL through a new pin. Do not switch to `@main` URLs; the validator
rejects them.

## Validate and deploy

1. Work on a branch, never directly on `main`.
2. Run `npm test`, `npm run build`, and (with network) `npm run check:assets`.
3. Review `git diff`. A refresh normally changes one SHA per repository plus,
   with `--update-dimensions`, the size numbers it reported.
4. Push and open a pull request. CI (`.github/workflows/ci.yml`) runs the tests,
   `check:assets` (an unreachable CDN only warns), and the build.
5. Merging to `main` deploys GitHub Pages through
   `.github/workflows/deploy-pages.yml`, which reruns the tests first; Vercel
   builds `main` as well. A failing test on `main` blocks the Pages deploy.

`npm test` and `npm run build` never touch the network, so a GitHub or jsDelivr
outage cannot break them.
