# Photography catalog

Every photograph on `/photography`, published or draft, is one record in
[`src/data/photography.catalog.json`](../src/data/photography.catalog.json).
It is plain JSON, so a script or the future CMS can update it without
editing JavaScript. It replaced `src/data/photographs.overrides.mjs` in
Interval 1 (2026-10-22).

| File | Written by | Holds |
| --- | --- | --- |
| `src/data/photography.catalog.json` | People, or later the CMS | Copy, status, category, tags, curated and featured order, manual metadata corrections |
| `src/data/photographs.generated.json` | `npm run prepare:photography` | Derivative names and sizes and the public EXIF subset, for **published** photographs only |
| `src/assets/photography/generated/` | `npm run prepare:photography` | Gallery (900×1200 box) and viewer (2200×1800 box) JPEGs, for **published** photographs only |
| `scripts/photography-sources.mjs` | People | Build-only camera-library paths (never shipped) |

## Schema (version 1)

```json
{
  "schemaVersion": 1,
  "captureTimeZone": "America/New_York",
  "hero": "river-arch-bridge",
  "categories": ["Automotive", "Places", "Landscape", "Nature"],
  "photographs": [
    {
      "id": "pier-light",
      "slug": "pier-light",
      "status": "published",
      "sourceFilename": "DSC09420.JPG",
      "caption": "Pier light",
      "alt": "A white pier light with a red band …",
      "shape": "portrait",
      "category": "Places",
      "tags": ["Water"],
      "featured": 6,
      "metadata": { "lens": "Corrected lens name" }
    }
  ]
}
```

### Top-level fields

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Always `1` for now. Any other value is rejected; a future change bumps it and ships a migration. |
| `captureTimeZone` | IANA zone used for EXIF times that carry no offset |
| `hero` | `id` of the opening frame. It also drives the hero preload and the page's social image, and must be published. |
| `categories` | Collection names in display order. Every photograph belongs to exactly one, through its `category`. |
| `photographs` | All records. **Array order is the curated order** of the full collection. |

### Record fields

| Field | Required | Rules |
| --- | --- | --- |
| `id` | yes | Stable identifier, `[A-Za-z0-9_-]`, unique. Derivative names are `<id>-gallery.jpg` and `<id>-viewer.jpg`. Never change it once published. |
| `slug` | yes | Deep link (`/photography/#<slug>`), same character set, unique. Never change it once published. |
| `status` | yes | `published` or `draft` |
| `sourceFilename` | yes | Original file name without folders, unique ignoring case; the library folder comes from `photography-sources.mjs` |
| `caption`, `alt` | yes | Non-empty, no surrounding spaces. Captions stay short and factual. |
| `shape` | yes | `landscape` or `portrait` |
| `category` | yes | One of `categories` |
| `tags` | no | Non-empty list of distinct values; omit for none |
| `featured` | no | Position in the Featured selection. Published ordinals must be unique and run 1..n without gaps. Drafts cannot be featured. |
| `metadata` | no | Corrections to extracted EXIF: `capturedAt`, `camera`, `lens`, `focalLength`, `aperture`, `shutterSpeed`, `iso`, `location`. `null` hides the extracted value. |

Unknown fields are errors, so a typo fails instead of being ignored.

### Publication

- **Published** photographs appear in the gallery, lightbox, sitemap, JSON-LD
  and preloads. Each has a manifest entry and two derivatives.
- **Drafts** appear nowhere public. They have no manifest entry, no derivative,
  and contribute nothing to the bundle.
  - The build serves the browser a filtered view (`virtual:photography-catalog`),
    and browser code never imports the catalog file; a test enforces both.
  - The build fails if a draft has a manifest entry or a derivative, because
    every file in the derivatives folder ships.
  - `prepare:photography` skips drafts and refuses `--only <draft>`.
- `curatedOrder` (the "No. 01" labels) is the position among **published**
  photographs, so publishing a draft renumbers the photographs after it, as
  inserting one always has.

## Commands

| Command | What it does |
| --- | --- |
| `npm run check:photography` | Validates schema, canonical formatting, manifest and derivatives; lists orphaned derivatives without failing |
| `npm run check:photography -- --write` | Same, and rewrites the catalog in canonical form (fixed key order, two-space indent, trailing newline) |
| `npm run prepare:photography -- --library-dir E:/cameras --only <ids>` | Generates derivatives and manifest entries for published photographs. Always pass `--only`: a full run rewrites every record. |
| `npm test`, `npm run build` | Both also validate the catalog; the build stops on any error |

Error messages name the record and field, for example
`photographs[12] ("pier-light"): "featured" must be a positive whole number.`

## Common changes

- **Add a photograph:**
  1. Add a record with `"status": "draft"` where it belongs in the sequence.
  2. When it is ready, set `"published"`.
  3. Add its library path if it comes from the camera library.
  4. Run `prepare:photography -- --only <id>`.
- **Reorder:** move the record within `photographs`.
- **Feature or unfeature:** set or remove `featured`, keeping the published
  ordinals 1..n.
- **Change the hero:** set `hero` to a published `id`.
- **Withdraw:**
  1. Set `"draft"`, or delete the record.
  2. Remove its manifest entry and its two derivatives; the build reports them
     until you do.
  3. The `PUBLISHED_PHOTOGRAPH_IDS` test in
     `src/data/photographyPipeline.test.js` protects older published links;
     changing it needs the owner's approval.

## How the CMS reads and updates it

The local CMS ([photography-cms.md](photography-cms.md), Interval 2) uses
`scripts/photography-catalog.mjs`, which has no file or network access:

1. `parseCatalog(text)` reads and validates. It throws a `CatalogError` whose
   `errors` array lists every problem.
2. The CMS edits the plain object: changes status, fields, array order,
   `featured`, `hero`.
3. `catalogErrors(catalog)` validates before saving; nothing invalid is ever
   written.
4. `serializeCatalog(catalog)` produces canonical text, so each save is a
   minimal, reviewable diff.
5. `publicPhotographs(catalog)` is the public view, and
   `assetReport(catalog, generated, files)` checks assets before a publish
   PR.

The working copy, with drafts, lives in a private workspace folder outside
the repository; R2 was not used. Publishing writes only the **published**
records into the repository catalog through a pull request, so drafts no
longer appear in this repository at all. It also runs the image pipeline
for newly published IDs.

## Migration from the overrides (Interval 1)

1. `scripts/migrate-photography-overrides.mjs` (commit `c1acf88`) converted the
   overrides:
   - every record became `"published"`,
   - array order was kept,
   - `taughannock-falls`'s manual `lens` moved under `metadata`,
   - `PHOTOGRAPHY_HERO_SLUG`, `PHOTOGRAPHY_CATEGORIES` and
     `EXIF_CAPTURE_TIMEZONE` became `hero`, `categories` and
     `captureTimeZone`.
   It refused to write unless the result reproduced the overrides exactly,
   and a test pinned the committed catalog to its output.
2. Commit `6925076` switched the site, SEO build and pipeline to the catalog
   and removed the overrides and the migration script.
3. Compared with the pre-migration build:
   - The rendered `/photography` DOM, all 53 merged records (fields, order,
     featured, hero, categories, time zone), `sitemap.xml` and the emitted
     photo asset names are identical.
   - Built HTML differs only in JavaScript chunk hashes, for both the root
     and the `/portfolio/` GitHub Pages builds.
4. No original or derivative was re-encoded, moved or deleted.

### Rollback

```bash
git revert 6925076 c1acf88
```

This restores `photographs.overrides.mjs` and the previous loaders. The
derivatives and `photographs.generated.json` were not changed by the
migration, so nothing needs regenerating. If the catalog has been edited
since, carry those edits back into the overrides by hand: drafts have no
equivalent there and must stay out.

## Orphaned derivatives

Fourteen viewer JPEGs in `src/assets/photography/generated/` belong to no
record. They are earlier removals, and they still ship because the folder is
globbed:

`bird-in-bare-branches`, `genesee-gorge-kodak-tower`, `gorge-cascade`,
`high-falls-rochester`, `impreza-through-the-fence`, `letchworth-gorge-wall`,
`letchworth-upper-falls`, `orange-domes`, `rochester-skyline-dusk`,
`rush-rhees-reading-room`, `shoreline-at-dusk`, `south-bristol-overlook`,
`steel-over-white-water`, `waterfall-spring-runoff` (each `-viewer.jpg`).

They are kept until the owner approves deleting them.
`scripts/photography-catalog.repo.test.mjs` pins this exact list, so any
change to it is deliberate.

## Fullscreen viewing

The gallery viewer (Featured, collections, the archive and `#slug` links) has **Enter
fullscreen** (or `F`). `src/components/utilities/useFullscreen.js` is the one implementation,
also used by the CMS comparison and the editor's workspace: the Fullscreen API where the
browser allows it for an element, otherwise (iPhone Safari, or a refused request) an
immersive view that fills the viewport inside the browser's own chrome. Fullscreen shows the
viewer derivative (2200 px, the largest public image) fitted without enlarging past its pixels;
details move to the information sheet; previous/next, arrows, zoom and pan keep working; `Esc`
leaves fullscreen before it closes the viewer; closing the viewer leaves fullscreen and returns
focus to the thumbnail.

In fullscreen the photograph and its gesture surface fill the whole screen (the toolbar and
previous/next float above it, inside the safe-area insets). The backdrop is sized to the
visual viewport (`--photography-viewport-height`, updated on resize, rotation and mobile
toolbar changes) and has `touch-action: none`, so the page behind never scrolls or zooms. The
gesture surface fills the stage in every mode: it is never sized to the fitted photograph, which
was the old mobile bug (a pinch enlarged the photo only inside its fitted box). Pans paint the
transform from a ref without re-rendering. `npm run check:photography:viewer` checks this in
real layout (see PROJECT_MAINTENANCE.md). Zooming past 100% enlarges the 2200 px viewer image;
there is no larger public derivative.

**Zoom gestures** (`photographyLightbox.jsx`, tested in `photographyGestures.test.jsx`): the
image area has `touch-action: none`, so the viewer handles them itself. Two fingers zoom
(100–500%) around their midpoint, which follows the fingers; lifting one continues as a pan;
one finger pans while zoomed, kept inside the photo's edges. A double tap zooms to 250% at the
tap, or back to the fit when zoomed (the `dblclick` a browser may send after it is ignored); a
mouse double-click and the wheel (both around the pointer), `+`/`-`, the zoom buttons and **Reset zoom** still work. A
new photograph starts at the fit; gestures never navigate (only the buttons and arrow keys do).
Browser page zoom outside the image is unchanged.
