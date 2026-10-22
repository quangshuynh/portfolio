# Photography platform: Interval 0

Feasibility and architecture for a private photography CMS
(`/admin/photography`) and a public, local-first photo editor
(`/photography/editor`), without changing the existing `/photography`
gallery. Interval 0 changed no site behaviour.

| Document | Contents |
| --- | --- |
| [repository-audit.md](repository-audit.md) | What exists, what can be reused, what is missing |
| [architecture-decisions.md](architecture-decisions.md) | Decision record: CMS auth, persistence, storage, publishing, decoder, pipeline, LUT, HDR, workers, privacy, tests, hosting, and open questions |
| [raw-feasibility.md](raw-feasibility.md) | RAW decoder evidence, measurements, fixtures, limitations |
| [editor-hdr-architecture.md](editor-hdr-architecture.md) | Editor pipeline, preview/export parity, LUTs, presets, batch, HDR merge |
| [dependencies-licensing.md](dependencies-licensing.md) | Dependency and licence risks |
| [../../experiments/raw-decode-poc](../../experiments/raw-decode-poc/README.md) | Isolated RAW decoding proof of concept with tests and benchmarks |
| [../photography-catalog.md](../photography-catalog.md) | Interval 1 result: catalog schema, workflows, CMS contract, migration and rollback |

## Status

- **Interval 0** (feasibility): done.
- **Interval 1** (catalog foundation): done on `feat/photography-catalog`
  (2026-10-22). It went as proposed below, with two changes:
  - the catalog is `src/data/photography.catalog.json`;
  - the 14 orphan derivatives were kept, as the owner asked.
  The documents in this folder describe the state before Interval 1; for the
  current data model see [photography-catalog.md](../photography-catalog.md).
- **Interval 2** became the **private photography CMS**, at the owner's
  request (2026-10-22), on `feat/photography-cms`:
  - a local-only server and dashboard, `npm run cms`;
  - drafts kept in a private workspace outside the repository;
  - publication through GitHub pull requests merged by hand.
  It replaces the hosted Cloudflare design in decisions 1–4 of
  [architecture-decisions.md](architecture-decisions.md), which could not be
  verified or set up without billing. See
  [photography-cms.md](../photography-cms.md).
- **Interval 3** (editor core): built on `feat/photography-editor-core`; see
  [photography-editor.md](../photography-editor.md). The plan below is kept
  for reference.
- *(Earlier plan)* **Interval 3** (editor core) needs authorization. Recommended scope, as
  previously planned for Interval 2:
  - **Route and shell:** the `/photography/editor` route (`ROUTES`,
    `seo-plugin`, `vercel.json`), as a lazy chunk with no effect on the
    gallery bundle.
  - **Import and state:** JPEG/PNG/WebP import in a worker, plus the edit
    document (schema 1).
  - **Rendering:** a CPU reference for white balance, exposure,
    highlights/shadows, contrast, saturation and vibrance; a WebGL2 preview
    using the same parameters; before/after.
  - **Export:** full-resolution JPEG/PNG/WebP.
  - **Tests:** neutral settings reproduce the input; GPU matches the CPU
    within 1/255; proxy matches full resolution.
  - **Out of scope:** RAW, LUTs, curves, HSL, presets, batch, HDR, and any
    new dependency.
  - **Before it:** a first live CMS publication of one photograph, after the
    branches are merged, to confirm push, pull request and deployment status
    against the real GitHub.

## Findings at a glance

**Validated in this repository:**

- Real RAW decoding in the browser works with LibRaw 0.22.1 as WebAssembly,
  in a Web Worker, in Chromium, for three formats:
  - Sony A7 III uncompressed 14-bit ARW,
  - Sony A7 III uncompressed 12-bit ARW,
  - Sony A6400 compressed ARW.
  - For an A7 III file, full-resolution 16-bit AHD takes 3.0–3.3 s cold and
    2.25–2.4 s in a warm worker; half size takes 0.52–0.59 s.
  - Memory is 606 MB for a full decode and 339 MB at half size.
  - Tests prove the output comes from sensor data, not the embedded
    1616×1080 JPEG.
- No COOP/COEP is needed for the current build: it never starts a thread
  (checked in Chromium only).
- libraw-wasm 1.6.0 has two traps:
  - it ignores a two-value `gamm`, so output that looks "linear" is
    gamma-encoded;
  - used directly through its factory, it leaks about 256 MB per instance
    unless freed.
  Both are handled and tested in the PoC.
- dcraw.js is unusable here: its decode crashed and it is GPL-2.0.

**Observed:**

- quanghuynh.com is served by Vercel, with its DNS zone on Cloudflare.
- The site has no auth, database, storage or server code.
- The A7 III ARWs in `E:\cameras\Photography-Workspace\01-RAW` are all
  uncompressed. The archive has no A7 III compressed RAW, no DNG and no
  exposure bracket.

**Not validated:**

- A7 III compressed ARW, DNG, Firefox, Safari, mobile.
- Everything about GPU rendering, LUTs and HDR (design only).

## Recommendation summary

- **CMS:**
  - Cloudflare Access protecting an admin Worker at `admin.quanghuynh.com`,
    which verifies the Access JWT server-side on every request.
  - A private R2 bucket holding a JSON catalog, originals and previews.
  - Publishing opens a PR that regenerates derivatives with the existing
    sharp pipeline; the owner merges to deploy.
  - The public gallery stays static and unchanged.
- **Editor:**
  - Static and local-first: no uploads.
  - A per-pixel, linear Rec.2020 float pipeline, rendered by WebGL2 shaders
    for both preview and export and checked against a CPU reference.
  - LUTs after the base rendering, with tetrahedral interpolation.
  - libraw-wasm pinned behind an adapter.
- **HDR:** a browser-only merge of three RAW brackets using exposure time,
  ISO and aperture: MTB alignment, clipping- and noise-aware weights,
  deghosting, then tone mapping in the editor.

## Revised roadmap (Intervals 1–8)

The original handoff's interval plan was not available, so this is a proposed
order, not a diff against it. Infrastructure-free work comes first, so the
editor can progress while the owner decides on Cloudflare.

| Interval | Scope | Needs from the owner |
| --- | --- | --- |
| **1. Catalog foundation** | Machine-writable photography catalog, validator, draft/published status; gallery output unchanged (scope below) | Answer to open question 6 (orphan derivatives) |
| 2. Editor core | `/photography/editor` route and lazy chunk; JPEG/PNG/WebP import; adjustment state; CPU reference; WebGL2 preview; before/after; full-resolution JPEG/PNG/WebP export; parity tests | None |
| 3. RAW in the editor | libraw-wasm adapter and worker, Rec.2020 linear decoding, cancellation, memory budget and half-size fallback, Vite/base-path packaging, third-party notices | One A7 III compressed ARW and a DNG (uncompressed is already validated) |
| 4. Colour tools and sessions | Tone curves, HSL, `.cube` LUTs, presets, batch sync and export queue, IndexedDB/OPFS session restore, CSP | Whether to bundle Q-COLOR LUTs |
| 5. HDR | Three-bracket validation, MTB alignment, radiance merge, deghosting, tone mapping, half-size mode | A7 III tripod and handheld exposure brackets (none in the archive) |
| 6. CMS backend | Admin Worker, Access JWT verification, R2 catalog with conditional writes and history, upload endpoints, Worker tests | Cloudflare Access/R2 approval, subdomain |
| 7. CMS UI and publishing | Admin UI on the protected host, uploads, previews, ordering, featured and collections, publish-PR workflow with derivative generation in Actions, `/admin/photography` redirect | Auto-merge or manual merge |
| 8. Archive integration and hardening | Optional import from `photo-archive` (by path or SHA-256, never exposing private index data), accessibility and responsive audit, cross-browser checks, maintenance docs | Whether archive integration is wanted |

Changes from a straight "CMS first" plan:

- The catalog migration is split out first, because both the CMS and safe
  publishing depend on it.
- RAW support follows the editor core instead of leading it.
- The CMS waits for the account decisions.

## Proposed Interval 1 scope: catalog foundation

**Goal:** replace the hand-edited `photographs.overrides.mjs` with a
machine-writable catalog that a CMS can later write, while keeping the
rendered gallery, sitemap and JSON-LD unchanged.

**In scope:**

1. A `src/data/photography/catalog.json` (name to be confirmed) holding today's
   override fields in curated order, plus `status: "published"` on every
   existing record and the hero slug and categories.
   - The curation notes in the current module's comments move to docs.
   - `photographs.generated.json` and the build-only
     `scripts/photography-sources.mjs` stay as they are.
2. A deterministic validator (in the style of `validateProjects.mjs`),
   checking:
   - unique IDs and slugs, and required `alt` and `caption`;
   - known category;
   - unique `featured` ordinals;
   - the hero exists, is published and is landscape;
   - every published record has generated metadata and derivatives;
   - drafts have none of the published-only requirements.
3. `src/data/photographs.js` and `scripts/prepare-photography.mjs` read the
   catalog. Drafts are excluded from the gallery, lightbox deep links,
   sitemap and JSON-LD.
4. Tests:
   - the validator, against fixtures;
   - draft exclusion;
   - an equality test showing the migrated catalog yields the same records
     and order as before;
   - the existing 268 tests unchanged and green.
5. Docs: a short photography section in `docs/PROJECT_MAINTENANCE.md` (or a
   linked doc) and the `AGENTS.md` important-files table.
6. With approval only: delete the 14 orphan derivatives that currently ship
   unused.

**Out of scope:**
- Any backend, authentication, R2, upload UI, editor or new dependency.
- Visual changes.

**Done when:**
- `npm test` and `npm run build` pass.
- `dist/sitemap.xml`, the photography JSON-LD and head tags, and the
  rendered gallery markup are unchanged compared with `main`, apart from
  content-hashed asset names.
- `/photography` looks identical at 375 px and on desktop, in light and dark
  themes.
