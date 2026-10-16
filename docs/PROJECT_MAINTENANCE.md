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
| `npm run check:assets` | yes | Validates data, then fetches every remote image |

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
  moves from `links.documentation` to `links.live` + `liveLabel`. `npm test`
  lists anything missing.
- **Take off the page.** Set `hidden: true` to keep the entry (still validated,
  easy to restore) without rendering it. Hidden entries are still in the
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
