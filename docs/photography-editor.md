# Photo editor (`/photography/editor`)

A public, local-first editor for JPEG, PNG, WebP and RAW (Sony ARW, DNG). No
account, no upload, no server: files are decoded, edited and exported in the
visitor's browser. Built in Interval 3 (light and colour), extended in Interval 4
(tone curves, HSL, `.cube` LUTs, presets), Interval 5 (RAW, see [RAW](#raw)) and
Interval 6 (three-exposure HDR, see [Merge HDR](#merge-hdr)), Interval 7 (Texture,
Clarity, Dehaze, sharpening and noise reduction, see [Detail](#detail)) and Interval 8
(multi-photo selection, sync, batch export and ZIP, 1:1 Detail inspection, see
[Batch editing](#batch-editing)) and Interval 10 (crop, rotation, flips, perspective, stretch
and resize, see [Geometry](#geometry-crop--transform)), Interval 11 (creative effects, looks and
text, see [Creative and text](#creative-and-text)) and Interval 12 (image, text and adjustment
layers with blend modes, see [Layers](#layers));
the original proposal is in
[photography-platform/editor-hdr-architecture.md](photography-platform/editor-hdr-architecture.md).
`/photography` links to it with a small "Edit a photo" text link (in-app
navigation).

## Layout of the code

| Path | Role |
| --- | --- |
| `src/editor/pipeline/spec.mjs` | **The rendering specification**: `deriveParams()` and the per-pixel reference (`processLinear`, `toneCurve`, `processDisplay`, `applyHsl`). |
| `src/editor/pipeline/curves.mjs`, `lut.mjs` | Curve validation and monotone interpolation; `.cube` parsing and tetrahedral sampling. |
| `src/editor/model/presets.mjs` | Preset schema, validation, built-in presets, apply rules. |
| `src/editor/pipeline/colorMath.mjs` | sRGB transfer, matrices, daylight locus, Bradford white balance. |
| `src/editor/pipeline/cpuRenderer.mjs` | Deterministic CPU renderer: tests, export, no-WebGL2 preview. |
| `src/editor/pipeline/geometry.mjs`, `warp.mjs` | Geometry: model, validation, transform order, crop constraints (`geometry.mjs`); inverse-mapped Catmull-Rom resampling and edge coverage (`warp.mjs`). UI: `ui/GeometryPanel.jsx`, `ui/CropOverlay.jsx`. |
| `src/editor/pipeline/creative.mjs`, `model/looks.mjs` | Creative stage (parameters, per-pixel reference, glow map, grain hash) and built-in looks. UI: `ui/CreativePanel.jsx`. |
| `src/editor/pipeline/digital.mjs`, `model/filters.mjs` | Digital effects (sensor colour, response, clipping, quantisation, noise, capture and JPEG, channel shift, soft focus) and the Filter Library catalogue, search and filter record. UI: `ui/FilterLibrary.jsx`, thumbnails `ui/filterThumbs.mjs`. |
| `scripts/check-editor-filters.mjs` | `npm run check:editor:filters`: library, thumbnails, search, switching latency, strength, compare, undo, PNG exports of digital filters against the Node reference, batch filter and ZIP, phones, CPU preview, 24 MP; genuine JPEG, ARW and merged HDR with `FILTER_FIXTURE_DIR`. |
| `src/editor/model/overlays.mjs`, `src/editor/text/` | Text fields (schema, validation) and their fonts, layout and drawing (`rasterizeTextLayer`). UI: `ui/TextPanel.jsx`. |
| `src/editor/model/layers.mjs`, `pipeline/blend.mjs`, `composite.mjs`, `layerTransform.mjs`, `compositeShader.mjs` | Layers (Interval 12): stack schema, limits, migration, operations; W3C blend modes; CPU compositor and its GLSL mirror; layer placement. Export orchestration `io/composeLayers.mjs`; UI `ui/LayersPanel.jsx`, `ui/LayerHandles.jsx`, preview rasters `ui/layerRasters.mjs`; parity page `dev/layerParity.html`. |
| `src/editor/model/masks.mjs`, `pipeline/mask.mjs` | Masks and local adjustments (Interval 13): schema, limits, editing helpers; per-pixel coverage and mask maps. UI `ui/MaskPanel.jsx`, `ui/MaskTool.jsx`; passes in `composite.mjs` (`localPasses`, `passMask`, Detail passes). |
| `scripts/check-editor-masks.mjs` | `npm run check:editor:masks`: masked-pass parity, the Masks panel and on-photo tools, PNG exports against the Node reference (with geometry and masked layers), save and reopen, phones, CPU preview, 24 MP; genuine ARW and merged HDR with `MASK_FIXTURE_DIR`. |
| `scripts/check-editor-layers.mjs` | `npm run check:editor:layers`: GPU/CPU and canvas parity of every blend mode, the Layers panel flow, PNG exports against the Node reference, text placement, reload and reconnect, batch ZIP, phones, CPU preview, 24 MP; genuine JPEG/RAW layers over RAW and over merged HDR with `LAYER_FIXTURE_DIR`. |
| `scripts/check-editor-creative.mjs` | `npm run check:editor:creative`: looks and effects, PNG exports against the Node reference, text placement in preview and exports, paste and ZIP, phones, CPU preview, 24 MP; genuine ARW and merged HDR with `CREATIVE_FIXTURE_DIR`. |
| `scripts/check-editor-geometry.mjs` | `npm run check:editor:geometry`: crop tool (pointer, touch, keyboard), PNG exports against the Node reference, batch resize, 24 MP timing; genuine ARW and merged HDR with `GEOMETRY_FIXTURE_DIR`. |
| `src/editor/pipeline/detail.mjs`, `detailRenderer.mjs` | Detail stage (spatial filters, guide) and the tiled renderer used by the Detail preview and every export with Detail. |
| `src/editor/pipeline/detailRegion.mjs`, `ui/InspectView.jsx` | 1:1 Detail inspection: crop and region maths, region render equal to the export. |
| `src/editor/io/detailPool.mjs` | Detail exports rendered in bands on several render workers. |
| `src/editor/model/sync.mjs` | Batch plans: sync groups and compatibility, paste, presets, LUTs and reset on several photos. Selection and batch undo are in `editorState.mjs`. |
| `src/editor/batch/` | Batch export: queue (`exportBatch`), names (`batchNames`), ZIP parts (`zipArchive`, client-zip). |
| `scripts/check-editor-batch.mjs`, `check-editor-raw-stability.mjs` | `npm run check:editor:batch` (batch flow, ZIP integrity, genuine ARW with `BATCH_FIXTURE_DIR`); `npm run check:editor:raw-stability` (WebKit LibRaw crash regression check; fails on any crash). |
| `scripts/check-editor-memory.mjs` | `npm run check:editor:memory`: two identical cycles of the heavy workflows (import, switching, RAW exports, HDR merge and cancel, ZIP cancel and retry, remove all) with genuine files from `MEMORY_FIXTURE_DIR`; working set, page heap and live workers after each step (Chromium, Windows). |
| `src/editor/pipeline/shader.mjs`, `glRenderer.mjs` | WebGL2 preview: GLSL mirror of `spec.mjs`, constants injected from it. |
| `src/editor/model/` | Adjustment registry, bounded undo history, reducer, edit document. |
| `src/editor/io/` | Header parsing, limits and filenames, decoding, the image worker. |
| `src/editor/ui/` | React workspace (`EditorApp`, `Viewer`, panels) and `editor.css`. |
| `src/editor/dev/parity.html` | Dev-server-only GPU/CPU parity harness (not a build input). |
| `scripts/check-editor-browser.mjs` | `npm run check:editor`: end-to-end check in Chromium. |
| `scripts/check-editor-engines.mjs` | `npm run check:editor:engines`: the same flow in WebKit, mobile Chromium and Firefox, with forced fallbacks. |
| `src/editor/io/diagnostics.mjs` | Local capability report and startup failures (Diagnostics panel, `window.__photoEditorDiagnostics`). |
| `src/editor/raw/` | RAW: format sniffing, LibRaw wrapper (`rawDecoder`), colour math (`rawColor`), worker tasks, job queue and export (`rawClient`). |
| `src/editor/hdr/` | Merge HDR: bracket metadata and validation, registration (`hdrAlign`), radiance merge, ghost masks and exposure fusion (`hdrMerge`), worker tasks, page orchestration and export (`hdrClient`), document form (`hdrSource`). |
| `scripts/check-editor-hdr.mjs` | `npm run check:editor:hdr`: HDR parity, Merge HDR flow and exports in Chromium, Firefox and WebKit; genuine A7 III files with `HDR_FIXTURE_DIR`. |
| `scripts/check-editor-detail.mjs` | `npm run check:editor:detail`: Detail controls, preview, PNG export and 1:1 inspection against the Node reference, 24 MP export timing, iPhone emulation; a genuine ARW with `DETAIL_FIXTURE_DIR`. |
| `scripts/check-editor-raw.mjs` | `npm run check:editor:raw`: RAW parity, import, white balance, exports in Chromium, Firefox and WebKit; genuine ARW with `RAW_FIXTURE_DIR`. |
| `public/photography/third-party-notices.txt` | Licence notices for the RAW decoder, linked from the inspector. |

The route is `EDITOR_ROUTE` in `src/seo/site.mjs`: its own static HTML,
`noindex`, kept out of `ROUTES` and the sitemap until the owner decides to
index it, with a CSP meta tag (`connect-src 'self'`, inline scripts by hash).
The page is a lazy chunk; the gallery and homepage never load editor code
(tested in `src/seo/build.test.js`). On Vercel, `/assets/*` (every file content-hashed,
tested) is served `public, max-age=31536000, immutable`, so repeat visits do not
revalidate the editor chunks, workers or the 1.4 MB LibRaw wasm; the HTML pages keep
`max-age=0, must-revalidate`. Workers and wasm are served as `application/javascript` and
`application/wasm` (checked on production).

Touch screens (`pointer: coarse`) get 44 px buttons and a larger slider thumb; export
progress announces stage changes only (the percentage is on the progress bar).

## Pipeline

Linear sRGB (Rec.709 primaries, D65), float64 on the CPU and highp float32 on
the GPU, in this fixed order:

| Step | Control (range) | Operation |
| --- | --- | --- |
| Decode | – | sRGB EOTF on 8-bit values. |
| White balance | Temperature, Tint (±100) | Bradford adaptation from an assumed illuminant to the neutral one. Temperature moves it 0.75 mired per unit along the CIE daylight locus; tint moves it 0.0002 Duv per unit. Exactly the identity at 0/0. |
| Exposure | ±5 EV | × 2^EV. |
| Tone | Contrast, Highlights, Shadows, Whites, Blacks (±100) | Applied to luminance in the sRGB-encoded domain `p`, then to RGB as a ratio, so hue is kept. Contrast blends toward a power S-curve through middle grey (0.18 linear); highlights/shadows add `x⁵(1−x)` / `x(1−x)⁵` bumps (black and white stay fixed); whites scale `x(1 + k·x²)`; blacks offset `k(1−x)²`. Strengths in `TONE_LIMITS` keep every curve monotonic (tested). |
| Vibrance | ±100 | Saturation about luminance, weighted by `1 − chroma`. |
| Saturation | ±100 | Scales the distance from luminance; −100 is grey. |
| Range fit | – | Out-of-range colours move toward their own luminance instead of clipping channels independently. |
| Encode | – | sRGB OETF. |
| Detail | Texture, Clarity, Dehaze (±100); Sharpening, Luminance and Color noise reduction (0–100) | Spatial, on the encoded values; see [Detail](#detail). |
| Tone curves | Master RGB, then Red, Green, Blue: 2–16 integer points on 0–255 | On encoded values. Monotone cubic (Fritsch–Carlson/PCHIP slopes): passes through every point, never overshoots, flat beyond the first and last point. Points stay ordered and distinct. Both renderers sample the same 1024-entry table linearly. |
| HSL | Hue, Saturation, Luminance (±100) for Red 0°, Orange 30°, Yellow 60°, Green 120°, Aqua 180°, Blue 240°, Purple 270°, Magenta 300° | Range weights from the HSV hue of the encoded pixel, blended between neighbouring centres with a raised cosine (sums to 1, no hard edges). Hue turns ±30° on the HSV wheel at constant luminance; saturation scales chroma about luminance in linear light; luminance is up to ±1 EV × the pixel's HSV saturation. Greys and untouched ranges are returned exactly. Then range fit. |
| 3D LUT | Intensity 0–100% | Encoded RGB mapped through `DOMAIN_MIN`…`DOMAIN_MAX` to the grid, tetrahedral interpolation, output clamped to 0–1, mixed with the input by intensity. |
| Creative | Looks, bleach bypass, film, grain, glow, vignette, colour grading | See [Creative and text](#creative-and-text). Glow, vignette and grain depend on the position in the output frame. |
| Quantise | – | Rounded to 8 bits. |

Each stage after Encode runs only when it changes something, so neutral
settings reproduce the source bit for bit and Interval 3 edits render exactly
as before (locked fixture in `pipeline.test.js`; a second one in
`advanced.test.js` locks every stage together; update them only on purpose).
The CPU renderer tabulates tone mapping and the transfer functions (within
1e-6) and is tested to stay within one code value of the exact spec.

**LUT colour assumptions.** A LUT receives the editor's sRGB-encoded,
display-referred RGB after every other adjustment, and its output is read as
sRGB. That suits "look" LUTs made for Rec.709/sRGB material. LUTs that expect
camera log (S-Log3, LogC), linear or Rec.2020 input will not look as intended;
the editor cannot tell what a LUT was built for and does not claim colorimetric
accuracy.

**Limits of 8-bit sources.** Input is 8-bit and display-referred. Highlights
can compress bright tones that still hold detail, but clipped areas stay
clipped: there is nothing to recover in a JPEG. Strong pushes can show banding
that was hidden in the source. Shadows lift noise and JPEG artefacts.

## RAW

Sony ARW and DNG files are developed from their sensor data with LibRaw 0.22.1
(`libraw-wasm` 1.6.0, pinned). The embedded camera JPEG is never used: not as the
preview, thumbnail, "before" image or export. Nothing is uploaded.

**Supported, with evidence:** Sony A7 III uncompressed 14-bit and 12-bit ARW
(genuine files: `rawFixtures.test.js` with `RAW_FIXTURE_DIR`, and the browser
check); uncompressed 16-bit Bayer DNG (synthetic DNGs written by the tests, decoded
by the real LibRaw build). Validated in Interval 0 only: A6400 lossy ARW.
**Not verified:** A7 III compressed ARW, lossless-compressed ARW, camera or Adobe
DNG Converter DNGs (lossless JPEG, lossy, deflate or float), any other maker.
Other TIFF-based RAWs are refused by content; a file without colour data is
refused rather than developed with wrong colour.

**Order of operations**

| # | Stage | Where |
| --- | --- | --- |
| 1–5 | Sensor decode, black-level subtraction, white-level normalisation, AHD demosaic (previews: half size, each 2×2 block one pixel), as-shot white balance normalised by the largest multiplier so nothing clips | LibRaw in a worker; 16-bit linear camera RGB (`DECODE_SETTINGS`) |
| 6 | White balance: per-channel gain from as shot to the chosen multipliers, then LibRaw's clip at the sensor white | `developRaw`, both renderers |
| 7 | Camera RGB → linear sRGB (Rec.709, D65) with LibRaw's `rgb_cam` (the camera's Adobe-derived D65 matrix, or a DNG's own ColorMatrix) | `developRaw` |
| 8 | Relative white balance, exposure, RAW highlight rolloff (only when exposure is raised), tone, vibrance, saturation, range fit | `processLinear` |
| 9 | sRGB encode, tone curves, HSL, LUT | `processDisplay` |
| 10–11 | 8-bit quantisation; canvas encoding | renderer; page |

Re-applying white balance after LibRaw equals decoding with those multipliers:
within 4–6/65535 on half-size decodes of both A7 III files and on synthetic DNG
interiors. With the full AHD demosaic it differs only near hard edges, because AHD
interpolates with the balance it is given. Preview and export use the same method.

**White balance** (RAW section): As shot (shown as the equivalent kelvin and tint),
Daylight (5500 K, CIE D55), or Custom temperature 2000–12000 K and tint ±150
(0.0002 Duv per unit; positive is magenta). Kelvin to multipliers goes through the
camera's XYZ→camera matrix and the Planckian locus, and reproduces LibRaw's own
daylight multipliers to three decimals. No Auto: grey-world averaging is not
accurate enough to offer. The Color panel's Temperature and Tint remain a relative
shift after development, as for JPEGs, so presets behave the same on every format;
presets never change RAW white balance.

**Default rendering** is colorimetric: sensor white maps to display white, with no
added contrast, saturation or curve. Against the camera's embedded JPEG of both
A7 III frames the median L* differs by about 0.7 (test bound: 4). The camera JPEG
(Sony "Standard") has about 1.4× the chroma and compresses highlights; that look is
not imitated (use Vibrance or a preset). Not compared with Lightroom or another
converter (none available here), so no equivalence is claimed. Limits: one D65
matrix for every illuminant (tungsten colour less accurate than dual-illuminant
profiles), no DCP or camera profiles, no lens corrections.

**Highlights.** Clipped sensor channels stay clipped, as in LibRaw mode 0; there is
no reconstruction and so no "highlight recovery" control. Raising Exposure on a RAW
rolls luminance above 50% off toward the sensor white instead of clipping it
(`highlightRolloff`). Lowering it reveals nothing hidden: the default already shows
everything up to the sensor white.

**Precision.** LibRaw output is 16-bit linear; the GPU reads it as an `RGB16UI`
integer texture, the CPU as float64. Nothing is reduced to 8 bits before the final
quantisation (test: a +5 EV push of a 16-bit shadow ramp keeps over 3× the levels
of the same ramp from an 8-bit file). Output is 8-bit sRGB.

**Preview, before/after, export.** Previews and thumbnails come from half-size
sensor data (3012×2012 for an A7 III, downscaled in linear light where the device
limit is smaller), so zooming past about 50% is upscaled. Original and Split show
the neutral development (as shot, no edits). Export decodes the RAW again: half
size when the output fits, else the full AHD demosaic, area-averaged to the output
size, rendered in 256-row bands that the page writes into its canvas and encodes.
GPU preview vs CPU: ≤ 1 code value (7 RAW cases; Chromium, Firefox, WebKit). PNG
export vs the Node reference with the same LibRaw build: 0.

**Memory and isolation.** LibRaw runs only in RAW workers, never on the page. Each
job gets a fresh worker, ended afterwards or on cancel, which is what frees the
wasm heap. One runs at a time on every device (peak: one LibRaw heap; importing three
ARWs takes 3.7 s instead of 3.2 s with two); previews go before exports, exports before
imports, and a newer preview cancels the older one. LibRaw is instantiated after the file
header is checked and before the whole file is read (see [Known issues](#known-issues)).
If it cannot start (too little memory for its heap, or a compile failure) the import says
so and JPEG, PNG and WebP keep working. Imports decode half size only; nothing is decoded at full size before
an export. Removing a photo cancels its import. A worker that dies mid-job is
reported as out of memory. The full decode cannot be tiled with this wrapper
(LibRaw holds the whole image); the stages after it are banded and seam-free
because they are per-pixel.

Genuine A7 III 14-bit ARW (49 MB) on Windows (i7-9700), whole browser incl. GPU
and workers (`npm run check:editor:raw`):

| Browser | Import | Preview | Full-size JPEG export (4024×6024) | Memory: with preview → export peak |
| --- | --- | --- | --- | --- |
| Chromium 141 | 0.9 s | 1.0 s | 5.5 s | 645 → 1358 MB |
| Firefox 142 | 2.3 s | 2.1 s | 17.8 s | 930 → 1740 MB |
| WebKit 26 (Playwright, Windows) | 1.0 s | 1.0 s | 6.1 s | 690 → 1555 MB |

The Playwright Windows WebKit crash of Intervals 5–8 is mitigated, not gone (see
[Known issues](#known-issues)). Safari on macOS and iOS is **not verified**; test on a
real iPhone before relying on it. iOS canvases cap at about 16.7 MP, so a 24 MP
export fails there with the existing message (choose a smaller size). Not measured
on an M1 MacBook Air.

**Security and licences.** Files are identified by content and size-checked before
decoding; LibRaw's reported dimensions are checked before pixels are allocated;
damaged files and decoder errors become per-file messages. The decoder (ISC
wrapper, LibRaw under CDDL-1.0, Little CMS, IJG libjpeg, zlib) is a separate
1.4 MB wasm loaded only by the RAW worker; notices are in
`public/photography/third-party-notices.txt`. Licence decisions:
[dependencies-licensing.md](photography-platform/dependencies-licensing.md).

## Merge HDR

**Capturing a bracket.** Three frames of one scene, 2 EV apart (−2, 0, +2), ideally on
a tripod: on Sony bodies Drive mode → Bracket (continuous, 3 frames, 2.0 EV), in M or A
mode so the shutter speed changes and ISO and aperture stay fixed. **DRO bracketing is
not an exposure bracket**: it records one exposure and saves it several times (with
differently processed JPEG previews), so there is nothing to merge; the editor refuses it.

**Inputs.** Exactly three files, all RAW (Sony ARW and DNG as in [RAW](#raw)) or all
JPEG/PNG/WebP. Refused with a reason: mixed kinds, duplicates (hash), different cameras
or RAW sizes, different orientation or aspect ratio, the same recorded exposure (all three, or any two), more
than 8 EV span, unrelated scenes, motion that would crop more than 30%, roles that
contradict the measured brightness. Raster inputs of different sizes are merged at the
smallest. Roles (under, normal, over) are suggested from shutter, aperture and ISO when all
three record them (never from file names), else from measured brightness, and can be
changed; the normal exposure is the reference. Inputs can be new files or photos already
imported; they are never changed.

**RAW merge (radiance).** Each frame is LibRaw's 16-bit linear camera RGB (black and white
levels, AHD demosaic, as-shot balance; [RAW](#raw)), brought to the reference's white
balance, divided by its exposure relative to the reference and averaged with weights
proportional to that exposure (brighter frames carry less relative noise), falling
smoothly to zero as any channel nears its sensor white (0.80–0.96). The exposure ratio is
**measured** from mutually well-exposed pixels (median, linear data) and compared with
EXIF; a difference over 0.35 EV is reported and the measured value used. The result is
float32 camera RGB in reference units, unclipped up to the darkest frame's sensor white
(`hdrWhite`, 4 for a −2 EV frame). Areas clipped in every frame stay at that white.

**Raster merge (exposure fusion).** JPEG/PNG/WebP are already tone mapped and clipped, so
no scene radiance is reconstructed: the frames are blended by contrast, saturation and
well-exposedness in a Laplacian pyramid (Mertens et al. 2007). The UI and the HDR panel
call it exposure fusion; the result is an ordinary 8-bit photo.

**Alignment.** Median-threshold bitmaps (exposure-independent) searched over an image
pyramid, with rotation searched in 0.25° steps up to ±1°, then Lucas–Kanade refinement of
translation and rotation on rank-equalised luminance using the reference's gradients
(no noise bias), on the largest pyramid level up to 1600 px. The HDR panel shows the
measured bitmap mismatch before → after per frame; above 20% (or a shift over 6% of the
width) alignment is reported as failed and that frame is merged unaligned with a warning;
featureless frames are merged unaligned with a warning. The output is cropped to the
area all frames cover, so there are no empty borders. Large parallax and perspective
changes are not modelled (similarity transform only). Accuracy: synthetic brackets
within 0.2 px; genuine A7 III sensor data with simulated motion within 0.3 px and 0.15°.

**Ghosts.** At analysis size (≤ 1024 px) each frame is compared with the reference where
both are well exposed (RAW: exposure-normalised log ratio; raster: after histogram
matching); disagreement beyond a threshold set by Ghost reduction strength is opened,
dilated by 1% of the width and feathered, and those areas take the reference only. Not
detected: motion where the reference is clipped (the darker frame alone fills it).

**Tone mapping and editing.** A merged photo is a new photo (`DSC09501-HDR`); the merge is
fixed and only its rendering is edited, non-destructively. RAW merges get an HDR section:
Highlight compression 0–100 (the rolloff knee from 0.9 to 0.1; 50 is the RAW knee, 0.5)
and Shadow lift 0–100 (up to 2× in the deepest tones, monotonic), with Natural and
Stronger looks; global and per pixel, so no halos and GPU = CPU. Exposure, RAW white
balance, tone, colour, curves, HSL, LUTs, presets (which never change HDR controls),
undo and before/after all work; Original shows the merge with default tone mapping.
[Detail](#detail) (Clarity, Dehaze) adds local contrast on top of the global rolloff.
HDR GPU preview vs CPU: at most 1 code value (9 cases; 0 in Chromium).

**Saving and export.** Edit documents (version 4 and later) store `format: "hdr"` with the mode, the
three inputs by role (name, size, SHA-256) and the merge settings; restoring asks for
those files and the merge picks up its saved roles, settings and edits. Export decodes
the three sources again at the chosen size (RAW: half-size sensor data when enough, else
the full demosaic), merges them one at a time into the accumulators (never three decoded
frames at once) and renders bands; PNG export equals the Node reference within 1. Names:
`DSC09501-HDR-quangedit.jpg`, `-HDR` never doubled, a second merge of the same reference
`DSC09501-HDR-2`. Cancelling ends every worker; a cancelled merge adds nothing. When the
estimated memory exceeds the device budget (40% of `deviceMemory`, else 900 MB on phones,
3 GB on desktops), export is blocked with the largest long edge that fits; nothing is
downscaled silently.

**Measurements** (Windows, i7-9700; three 6024×4024 DNGs made from genuine A7 III sensor
data with simulated −2/0/+2 EV and motion; whole browser incl. GPU and workers):

| Browser | Preview merge (decode · analyse · merge) | Full-size JPEG export | Memory: baseline → merge peak → export peak |
| --- | --- | --- | --- |
| Chromium 141 | 5.7 s (1.6 · 2.2 · 1.1) | 14.1 s, 6016×4016 | 531 → 801 → 2117 MB |
| Firefox 142 | 10.8–14.9 s (6.1–9.2 · 2.6–3.6 · 1.8–1.9) | 48.5 s, 6016×4016 | 797 → 1166–1526 → 2444 MB |

After a second merge of the same files Chromium settled at 1.05–1.12 GB and Firefox at
1.15–1.28 GB (the first merge stays in the workspace, so some growth is expected); after
export both returned to about their post-merge level. Phones are **not verified** (full-size
HDR export there is blocked by the memory budget; previews use the 2048–3072 px proxy).
Playwright's Windows WebKit still crashes in most HDR exports from RAW (3 of 4 export
steps with `HDR_WEBKIT_EXPORT=1` in Interval 9) while a LibRaw worker starts and the HDR
worker holds the merge (see [Known issues](#known-issues)); not seen in Chromium or Firefox.
Safari on macOS and iOS is not verified.

**Real-world validation** (A7 III, Windows i7-9700; genuine-file tests and the browser step
run only with the folder variables set):

| Set | What it is | Result |
| --- | --- | --- |
| `DSC09640–09642` (2026-10-23, `HDR_BRACKET_DIR`) | Genuine shutter bracket: 0.8, 3.2, 13 s at f/8, ISO 100, A mode, 15 s apart; indoor, window in frame | Measured −1.99 / +2.00 EV (EXIF −2 / +2); shifts of 9–10 px removed (edge mismatch 1.3% → 0.0%, 1.1% → 0.2%); ghost mask 0%; merged white 3.98. The normal frame clips 0.76% of pixels, the Natural merge 0.55% (the curtain pattern blown in the normal frame is back, but flat under the global rolloff), Stronger 0.41%; mean brightness equal to the normal frame (62.6 vs 62.5); shadows visibly cleaner; no doubled edges at 100%. Chromium: merge 5.5 s (decode 1.6, analyse 2.5, merge 1.1), full-size JPEG export 14.8 s at 6002×4018 as `DSC09641-HDR-quangedit.jpg`, browser memory 506 → 801 (merge) → 1849 MB (export), equal to the Node reference within JPEG re-encoding (mean 0.53) |
| `DSC09636–09638` (`HDR_AUTO_ISO_DIR`) | −2/0/+2 compensation bracket in M mode with Auto ISO: 1/160 s, f/6.3 at ISO 4000, 6400, 6400 | ISO hit its limit, so 0 and +2 hold the same exposure (0.005 EV apart; independent noise). Earlier versions merged it when the duplicate got the "over" role; now refused from metadata and measured data. Forced merge: hand-held alignment 2.6% → 1.3%, ghost mask 0.15%, noise σ 5.5 → 4.0 codes; 0.69 EV is too little range to judge highlights |
| `DSC09633–09635` | Same, all at ISO 6400 | Refused (same exposure) |
| `_DSC9015–9017` (2026-10-05, `HDR_FIXTURE_DIR`) | Sony DRO bracket: one exposure, identical sensor data | Refused; used for simulated brackets on genuine sensor data |

Not validated on real files: hand-held brackets with large motion, moving subjects (real
ghosts), outdoor scenes, Firefox and WebKit timings for genuine files.

## Rendering, preview and export

- **Decode** (worker): `createImageBitmap` with EXIF orientation applied,
  alpha not premultiplied, and the embedded profile converted to sRGB by the
  browser, then read back from an sRGB 2D canvas. The preview proxy and the
  export use this same path, so they start from the same pixels. If a browser
  ignores EXIF orientation (checked once with a 2×1 probe), the editor rotates
  the image itself. Firefox 142 loses alpha when `createImageBitmap` resizes with
  `premultiplyAlpha: 'none'` (transparent areas came back opaque in reduced-size decodes, found
  in Interval 12); a 2×2 PNG probe detects it, and affected browsers decode at the stored size
  and let the canvas scale. Decodes at the stored size never pass resize options.
- **Preview**: a proxy of at most 4096 px on the long edge, capped by
  `MAX_TEXTURE_SIZE`, drawn by WebGL2 into a canvas of the same size. Zoom and
  pan are CSS transforms of the processed pixels; past the proxy's resolution
  the viewer says so. Without WebGL2 (or with a failed shader), the CPU
  renderer draws a 2048 px proxy in the worker, one job at a time, keeping
  only the latest values.
- **Before/after**: one shader pass. Pixels left of the split show the
  untouched source texture (tested exact), so the two sides always share zoom,
  pan and scaling.
- **Export**: a dedicated worker re-decodes the original at the chosen size
  (never upscaled) into one canvas, then reads, renders and writes it back in
  256-row bands with progress, and encodes that canvas. No full-resolution copy
  or second canvas is held. Cancelling terminates the worker. On desktops (band
  workers, see [Detail](#detail)) an edited photo is instead decoded to the page and
  its 256-row bands rendered by up to four workers with the same per-pixel code,
  bit for bit equal (tested): 24 MP camera JPEG 2.5 → 1.1 s (+0.2 GB peak), A7 III
  ARW 5.6 → 3.9 s (peak 1.42 → 1.14 GB, LibRaw's heap is freed before rendering);
  Chromium, heavy tone and colour edits without Detail. One export runs at
  a time. JPEG output is flattened onto white in linear light. Metadata (EXIF,
  GPS) is not copied. If the browser cannot encode the format, or cannot hold a
  canvas of the export size (iOS Safari caps canvases at about 16.7 MP), the
  export fails with a message instead of falling back or shrinking the image.

**Expected differences**

| Comparison | Difference | Cause |
| --- | --- | --- |
| GPU preview vs CPU reference | ≤ 1 code value, mean ≤ 0.044 (79 cases: every slider extreme, curves, HSL, identity and look LUTs at 17³/33³/65³, intensity, everything combined; Chromium 141, WebKit 26, Firefox 142, headless) | float32 vs float64, GPU rounding |
| PNG export vs Node CPU reference | 0 | Same pixels, same code |
| 24 MP JPEG export vs Node reference on sharp's decode | mean 0.52 | Browser vs libvips JPEG decoding, JPEG re-encoding |
| Preview vs export at the same pixel | resampling only | Per-pixel pipeline; the proxy is downscaled before processing |

Display P3 and other wide-gamut sources are converted to sRGB on decode, and
exports are untagged sRGB. Semi-transparent PNG/WebP pixels pass through the
canvas's premultiplied storage, so very low alpha loses precision.

## Geometry (Crop & Transform)

**Crop** (C, or **Crop** under the preview): the viewer shows the whole transformed frame
with the crop box; drag the box, its edges or corners (44 px touch targets), or focus one
and use the arrow keys (Shift: larger steps). Enter or **Apply** keeps it, Escape or
**Cancel** restores the geometry the tool opened with (one more undo step); every drag is an
ordinary undo step. Ratios: Freeform, Original, 1:1, 4:3, 3:2, 16:9, 9:16, 5:4, 4:5 or a
custom W:H, turned with Landscape/Portrait; a new ratio makes the largest crop with it around
the current centre. Ratios are in output pixels and never stretch the photo. **Perspective
corners** shows the frame without perspective and four points to place on lines that should
form a rectangle. The inspector section holds the numbers: 90° turns and 180°, Straighten
(−45° to +45°, 0.05° steps, fine grid while dragging), flips, Vertical/Horizontal keystone
(±100: the shorter edge of the quad mapped onto the frame is 60% of the other at 100),
Stretch and Resize. Detail is not previewed while the crop tool is open.

**Order** (`geometry.mjs`), source to output, all at native size: quarter turns (clockwise)
then flips → straighten about the frame centre (the frame keeps its size) → perspective (a
homography taking a quad of the straightened frame onto the frame, so it follows the
straightened axes) → stretch → crop → resize; then the Export panel's resize. Every render
maps each output pixel centre back to the source through one 3×3 matrix (inverse mapping, no
holes) and samples it with a Catmull-Rom kernel, edges clamped, RGBA premultiplied;
pixel-aligned crops, turns and flips at full size copy pixels exactly. Turning or flipping
acts on the result shown: crop, angle, perspective, stretch, resize and ratio are carried
along (tested against the composed transforms).

**Coordinates and sizes.** Crop and corners are normalised (0–1, origin top left) in the
stretched, straightened frame; the crop snaps inwards to whole native pixels (the output size
in the viewer bar and inspector). **Crop to fill** (default) shrinks the crop about its
centre whenever straightening or perspective would put empty corners inside it, and a first
straighten makes the largest crop with the photo's proportions. Turned off, areas outside the
photo fade to transparent (PNG, WebP; white in JPEG), white or black over one output pixel.
**Stretch** scales an axis 50–200%, normalised so the output never gains pixels; **Resize**
fits the crop into width × height and never upscales (upscaling is not offered); unlocked it
scales each axis to its own size, which distorts and says so.

**Preview and export.** The WebGL2 shader warps the proxy with the same matrix, kernel,
1/256 px position grid and rounding as `warpRows`, so preview, before/after and split share
one mapping (RGBA and RAW within one code value of the CPU, merged HDR within two at the
range fit of out-of-gamut colours; parity cases in `check:editor`). The CPU fallback, Detail
frames, thumbnails and 1:1 inspection warp in the worker. Zoom is in output pixels: 100% is
the export's pixel grid at original size, and 1:1 Detail renders a region cut from the warped
output, equal to those export pixels (unit test). Exports decode the original only as large
as the warp needs (`decodeSize`: at least one source pixel per output pixel in every
direction), warp it (RAW: the development, after LibRaw's worker has ended; merged HDR: the
finished merge, its three sources and merge settings untouched), then render as before, with
Detail radii relative to the geometry's native output. On desktops the warp runs on the band
workers, each sent only the source rows its band reads (bit for bit a whole warp, tested);
this holds the decoded original and the warped output at once (about 2 × 96 MB at 24 MP
RGBA). Neutral geometry keeps every earlier path and size unchanged. Invalid transforms (a
perspective that would send part of the photo to infinity, folded or degenerate corners) are
rejected when edited, read from a file, or exported.

**Measurements** (`npm run check:editor:geometry`, Windows i7-9700, headless Playwright,
whole browser memory; small PNG with straighten 6.5°, 3:2, flip, perspective, with and
without Detail: **exports equal the Node reference exactly** in all five environments):

| Environment | Crop key step · straighten · perspective (to the painted frame) | 24 MP JPEG straightened −4°, cropped (5442×3628) | Genuine ARW, straighten 2.5°, 4:5, Texture: 1:1 first frame · export | Merged RAW HDR (DSC09640–42), straighten and turn: export |
| --- | --- | --- | --- | --- |
| Chromium 141 | 68 · 54 · 41 ms | 4.4 s, peak 1051 MB (baseline 489) | 5.4 s (1573 MB) · 4.7 s (1416 MB) | 16.4 s, 3730×5572, 2106 MB |
| Firefox 142 | 30 · 9 · 7 ms | 3.5 s, 1354 MB (863) | 15.8 s (1969 MB) · 15.6 s (1875 MB) | not run |
| WebKit 26 | 81 · 77 · 25 ms | 16.9 s, 924 MB (500) | not run (LibRaw crash, see Known issues) | not run |
| Chromium, no WebGL2 | 32 · 26 · 33 ms | – | – | – |

Warp alone (Node, one thread, 24 MP RGBA, straightened): 2.1 s; a pixel-aligned crop 0.25 s.
Without geometry nothing changed (neutral plans skip the warp). WebKit's 24 MP time includes
main-thread decoding (Playwright's Windows WebKit has no worker canvas).

## Detail

Texture, Clarity, Dehaze, Sharpening and Luminance/Color noise reduction, in a Detail
section between HSL and Tone Curve. All operate on pixels (`pipeline/detail.mjs`), after
the base stage and before curves, HSL and LUT, on the encoded values split into luma
`P` and chroma (`R − P`, `B − P`), so luminance edits never shift hue; the result is
range-fitted toward `P` like the base stage.

| Control | Method |
| --- | --- |
| Color NR (0–100) | Chroma pulled to its box mean (radius 1–8 native px), kept where luma or chroma varies more than noise (an edge, also between colours of equal luma). |
| Luminance NR (0–100) | Adaptive Wiener (Lee) filter on `P`, radius 1–3 px, noise level up to 0.06; 10% of the removed detail is put back so surfaces do not look plastic. |
| Dehaze (±100) | Koschmieder model `I = J·t + A(1 − t)` in linear light. Transmission from the per-pixel dark channel of the guide (He et al.), refined by a guided filter on luma; grey airlight (mean luminance of the haziest 0.1%), so no colour cast; floor t ≥ 0.25 (at most 4× gain, so noise in dense haze grows up to 4×). Negative adds grey haze, more where the estimate says farther. A bounded approximation, not a physical reconstruction: on clear skies it darkens and saturates the sky. |
| Clarity (±100) | Self-guided filter on `P` (box radius 1.2% of the long edge, edge threshold 0.015): base = `a·P + b`, detail = `P − base`; strong edges stay in the base, so halos stay small (≤ 6 codes at a black–white step, tested). Weighted toward mid-tones, soft-limited, detail below 0.02 boosted less. It lifts fine structure too, so on high-ISO files it raises grain (combine with NR). |
| Texture (±100) | Band between Gaussians of σ 1 and 4 native px; large band values (edges) boosted less, noise-level values not boosted. Negative removes the band. |
| Sharpening (0–100) | Unsharp mask against the σ 1 Gaussian, gain up to 2, noise threshold 0.008, overshoot soft-limited to 0.08. |

Order: colour and luminance NR (from the same input), Dehaze, Clarity, then Texture and
Sharpening (from the same input). Measured on a 2048 px synthetic image (unit tests): Texture
lifts 12–24 px structure ×1.5 and leaves 96 px structure alone, Clarity also lifts
160 px structure ×1.4, Sharpening acts below 12 px; ±100 moves mean brightness less than
one code. On a genuine ISO 6400 A7 III frame (flat patch, σ in codes): luminance NR 50/100
3.8 → 1.7/1.1 with chroma unchanged; colour NR 50/100 5.6 → 2.2/0.9 with luma unchanged;
Texture +100 raises luma noise by 25%, Clarity +100 by 45%.

**Resolution independence.** Fine filters (NR, Texture, Sharpening) run at the render size
with radii in the photo's native pixels times render/native, so a preview looks like the
export downscaled (tested: mean difference within 1.5 codes of the plain downscale
difference). Below about one native pixel they fade, as fine detail does when an image is
downscaled: at fit zoom on a 24 MP photo Sharpening and NR are barely visible, exactly as in
a downscaled export. Clarity and Dehaze use a **guide**: the base stage of the image
area-averaged to at most 768 px, where guided-filter coefficients are computed; every
render samples them bilinearly and applies them to its own full-resolution luma (fast
guided filter), so edges stay sharp and preview, export and any export size share one
guide.

**Tiles and bands.** A tile (512 px wide, 256 rows) is processed with a halo equal to the
sum of the fine filters' footprints (`detailHalo`, at most about 17 px at full size),
clamped at the image edge (edge pixels replicated), and only its core is kept. Tiled and
whole renders are bit-identical (tested down to 1-row bands and 7 px tiles, raster with
alpha, RAW, merged HDR). Scratch planes are sized by one tile plus halo and reused; nothing
is allocated per image besides the output. Transparent pixels: blurs are normalised by
alpha and the guide averages colour weighted by alpha, so colours under transparent pixels
never reach visible ones; alpha is copied.

**Preview.** The GPU shader is not used for Detail: with any Detail value set, the worker
renders the frame with the export's renderer (same code, so the same result), first a
1024 px draft, then a 2048 px frame when values stop changing; the viewer says which one is
shown ("CPU preview: draft", "CPU preview at W×H"). The guide is cached while only
fine filters change. WebGL2 draws the frame (scaled to the canvas) and still renders the
"before" side; the CPU fallback draws it on its 2D canvas. With all Detail values at 0 the
GPU path runs as before, bit for bit. A multi-pass WebGL2 version was not built: it needs
float render targets (several 64–128 MB textures at a 4096 px proxy, a risk on phones) and
its own parity checks; the CPU frame is exact.

**Export.** On desktops (at least 4 logical cores, more than 4 GB reported, not a phone)
Detail exports render in 256-row bands on `min(4, cores − 2)` render workers
(`io/detailPool.mjs`): the original is decoded at the export size (RAW: developed by LibRaw,
whose worker then ends), the page computes the guide while yielding, and each worker
receives only its band plus the halo. Bit for bit equal to the one-thread render (tested
with transparency, JPEG flattening and RAW). This holds the decoded image and the output
canvas at once, about 300 MB more at 24 MP. Elsewhere, and for merged HDR, the one-thread
export stays: JPEG/PNG/WebP render in place in the decode canvas, each band keeping a copy of
the rows above it (tested equal to a whole render); RAW and HDR render from the decoded
image. Cancelling works between bands.

Profile before the change (Node, 24 MP, all six controls, 11.2 s): the per-pixel Detail
loops 42%, box blurs 23%, transfer functions 10%. Unclamped blur loops and larger tiles gained
0–8% (V8 already optimises the clamped loops), so the filters are unchanged and the speed-up
comes from the band workers.

**1:1 inspection** (**1:1 Detail** next to the zoom buttons): the visible area rendered at
one source pixel per device pixel by the export's renderer, so Sharpening and noise
reduction show what a full-size export shows; this is not CSS zoom of the preview. The
original is decoded once at full size in a worker (RAW: the full demosaic) and only a crop is
kept: the region (at most 2048×1536), half its size again on each side to pan, and the
largest Detail halo, plus the guide source (≤ 768 px, independent of the settings). Edits and
pans inside that crop re-render only the region in the render worker; leaving it decodes
again. Equal to the same pixels of a full-size export (unit tests, and 0 difference in
Chromium against the Node reference). Original and Split compare with the source or the
neutral RAW development; drag or arrow keys pan, Escape closes. Not available for merged HDR
(it would merge three full-size files) or for RAW on phones and devices reporting ≤ 4 GB.
Genuine A7 III ARW (Chromium): first frame 3.6 s (full development), browser peak 1652 MB.

**Measurements** (`npm run check:editor:detail`, Windows i7-9700, headless Playwright,
whole browser incl. GPU and workers; draft / final frame after a value is committed):

| Browser | 24 MP JPEG (4096 px proxy): first Detail value · Sharpening change · Exposure change · four more controls | Full-size JPEG export, all six controls: Interval 7 → 8 (4 band workers) | Memory: baseline → export peak (Interval 8) |
| --- | --- | --- | --- |
| Chromium 141 | 1.1/2.3 s · 0.18/1.3 s · 0.28/1.8 s · 0.85/2.8 s | 16.2 → 6.1 s (6000×4000) | 469–485 → 1419–1452 MB |
| Firefox 142 | 0.53/1.1 s · 0.21/0.78 s · 0.36/1.1 s · 1.0/2.9 s | 24.8 → 7.0 s | 858 → 1717 MB |
| WebKit 26 | 1.4–1.8/2.2–2.7 s · 0.47–0.60/1.1–1.5 s · 0.61–0.70/1.7–2.1 s · 0.64/2.0–4.7 s | 18.5 → 9.0 s | 446 → 1373 MB |

Genuine A7 III ARW (`DSC09640`, Texture 40, luminance NR 30, Sharpening 40), full-size JPEG
export with band workers: 5.6–5.8 s at 1403–1493 MB peak (Chromium), 17.0 s at 1859 MB
(Firefox). Previews are unchanged (still one worker; the timings in the second column are
Interval 7's).

Genuine ISO 6400 ARW (`DSC09356`, Texture and luminance NR): first value 1.1/2.3 s
(Chromium), 1.1/2.5 s (Firefox); full-size export 11.8 s at 1689 MB peak (Chromium), 25.8 s
at 1994 MB (Firefox). Against Interval 6: photos without Detail are unchanged (GPU preview,
2.0–2.4 s for a 24 MP JPEG export); Detail costs about 7–10 s more per 24 MP export with
all six controls, and its preview is not interactive at GPU speed. PNG exports equal the
Node reference exactly in all five environments. Playwright's Windows WebKit has no
worker canvas, so decoding runs on the main thread there, but Detail rendering stays in its
worker; the iPhone 13 emulation (WebKit) has
the Detail section reachable in the Adjust tab with no sideways scrolling. Not measured on
a physical phone.

## Creative and text

**Creative** (section after LUT; `pipeline/creative.mjs`) holds looks and five parts, each
with its own reset. All are settings applied at render time, neutral at their defaults
(character settings such as hue, radius or threshold change nothing until their amount is
set), undoable, saved in edit documents, and in presets and sync as the **Creative** group.

| Part | Controls | Method (an approximation, not a simulation of a chemical process or another app) |
| --- | --- | --- |
| Bleach Bypass | Amount, Contrast, Desaturation, Highlight protection | A black-and-white "silver" copy (S-curve on luma) laid over the colour in soft-light mode (on greys 3p² − 2p³: denser shadows), mixed by amount with highlight protection, then desaturated toward luma; skin hues (around 25°) are spared up to 60% of moderate desaturation; 100/100 is monochrome. |
| Film | Fade, Highlight roll-off, Black and White tint (hue + strength) | Lifted blacks (up to code 56), rational shoulder `v / (1 + a·v⁴)^¼`, tints colouring only the lifted black and the lowered white. Monotonic (tested). |
| Grain | Amount, Size, Roughness, New grain pattern | Cubic B-spline value noise on a lattice of 1–4 native output px, normalised to unit variance at every position (no grid pattern), two octaves mixed by roughness, from an integer hash of the lattice point and the photo's `grainSeed` (saved; changes only with New grain pattern). Weaker in deep shadows and highlights. At smaller renders the amplitude is scaled as a downscale averages it (tested statistically), so previews look like the export downscaled; at 100% and in 1:1 Detail it is the export's grain. |
| Glow | Bloom amount, radius, threshold; Halation amount, radius, threshold, hue (red–orange) | Soft-threshold bright pass of the finished colours on the guide grid (≤ 768 px, as Clarity), Gaussian blur (bloom σ 1–8%, halation 0.2–2% of the long edge), sampled bilinearly and screen-added in linear light: bloom in the image's colour, halation as a tinted, tighter bleed. Small specular highlights below one guide pixel glow less than large ones. Dehaze and Clarity do not change which areas glow. |
| Vignette | Amount ±, Midpoint, Roundness ±, Feather | Elliptical falloff on the output frame (after crop, rotation, perspective), toward a circle (+) or rectangle (−); negative darkens in linear light (up to −2.3 EV), positive lightens toward white. Always centred on the exported frame. |
| Color Grading | Shadows, Midtones, Highlights, Global: hue, saturation, luminance; Balance, Blending | Weights `(1 − L)^q`, `L^q` and the rest (sum 1, smooth; balance bends L, blending sets q 3.5–1.2). Zero-luma tint offsets that fade out toward pure black, luminance offsets ±0.07 (monotonic for any combination, tested). Colour wheel by pointer; the Hue/Saturation/Luminance sliders are its keyboard and screen-reader alternative. |

Three more parts (`pipeline/digital.mjs`, Interval 11.5), approximations chosen by eye, not
measured from any camera or codec:

| Part | Controls | Method |
| --- | --- | --- |
| Digital Camera | Sensor color ± (cool CCD-like / warm), Response, Highlight clipping, Noise, Noise color | A channel-crosstalk matrix (rows sum to 1, greys stay grey); a symmetric power S-curve per channel (0, ½, 1 fixed) with up to +50% saturation; each channel scaled and hard-clipped on its own (up to 35% of the range), so clipped colours shift hue; white noise per pixel of a virtual ~2 MP sensor (1600 px long edge, or per capture pixel), luma plus per-channel chroma (blue noisiest), stronger in shadows, from the photo's `grainSeed`. |
| Low Resolution & JPEG | Low resolution, Pixel edges, JPEG compression, Quantization, Dither | A capture grid of at most 768 px (the guide grid) down to 48 px on the long edge (geometric), area-averaged from the guide source and rendered with every earlier stage; JPEG: full-range YCbCr, 4:2:0 averaged chroma, 8 × 8 DCT with the ITU-T T.81 example tables scaled by IJG quality 92 → 2; the output is resampled from the grid (Pixel edges 0 bilinear … 100 nearest neighbour, alpha-weighted). Quantization: 256 → 2 levels per channel; ordered 8 × 8 Bayer dither only inside a capture. |
| Lens & Diffusion | Chromatic aberration, Channel shift, Shift angle, Soft focus, Radius | Red scaled out and blue in from the centre (0.6% at 100) and/or moved apart along an angle (0.8% of the long edge), sampled bilinearly from the base image before the display stages (a lens effect; the spatial renderer's halo grows by the displacement); soft focus: the image blurred on the guide grid (σ 0.4–3% of the long edge) mixed in linear light, fully where brighter, half where darker. |

**Resolution semantics.** The capture grid and the channel displacement are fractions of the
frame, so pixel blocks, 8 × 8 JPEG blocks and fringes cover the same part of the photo in the
preview, at 100%, in 1:1 Detail and in a full-size export; noise follows grain's rule (a smaller
render shows the deviation a downscale would leave). JPEG alone uses the 768 px grid, so it
always softens a large photo to that size: it is a degradation effect, not an encoder setting.
Thumbnails are their own guide, so captures there are never finer than the thumbnail.

**Filter Library** (`model/filters.mjs`, `ui/FilterLibrary.jsx`): 48 original filters in four
categories (Digicam & early digital 12, Vintage & nostalgic 11, Cinematic & dramatic 13,
Experimental 12; the seven Interval 11 looks keep their names and ids), plus Custom. Search
(every word, accents and case ignored), category tabs, Favorites and Recent (this browser only,
`localStorage`), a 3-column grid of thumbnails of the shown photo with its edits. One click
applies a filter: it **replaces the Creative group** (keeps the grain seed and every other
section: Light, Color, HSL, Detail, curves, LUT, geometry, RAW, HDR, text) in one undo step and
records `filter: { id, strength }`. Strength 0–100 scales the amounts from neutral (0 is the
photo without Creative effects; hues, radii and thresholds stay); a second filter replaces the
first. Changing a Creative control afterwards marks the filter **Modified** and locks strength
until **Revert changes** or **Save as custom** (a preset with only the Creative group, listed
under Custom and usable with a strength). **Compare** shows the photo without the filter;
**Remove filter** sets Creative to neutral. Hover or focus previews a filter. Every filter is
labelled an approximation; a test renders all of them and fails if two differ by less than 2.5
codes on average.

**Thumbnails.** One 144 px source per photo, proxy and geometry: the shown proxy area-averaged
(to 288 px and warped when there is geometry) on the page, then rendered in a worker of its own
(`filterThumbs` task, four filters per call) with each filter's patch over the photo's other
settings. Only filters in the shown list are rendered; a change of photo, settings or list drops
older work between calls, and old thumbnails stay until replaced (a settings change waits
300 ms). About 55 kB each, kept for the current photo only.

**Order and colour space.** After the LUT, on display-referred sRGB values: [channel shift,
before the display stages] → glow and soft focus → sensor colour → response → clipping →
bleach bypass → fade → grading → quantisation → vignette → sensor noise → [capture: low
resolution, JPEG, reconstruction] → grain, then 8-bit quantisation; geometry is applied before
any colour (the photo is warped first), so position-dependent effects use output pixels; text
is drawn last, over the finished photo. Colour-only effects run per pixel on the CPU and in the
shader; glow, soft focus, vignette, grain and noise need the pixel's position, so CPU renders of
photos with them use the spatial renderer of [Detail](#detail) (bands, 1:1 regions, band
workers). Capture and channel shift are **CPU only** (`params.cpuOnly`): the preview renders
them on the CPU like Detail (draft at 1024 px, final at 2048 px), and while cropping they are
left out. The WebGL2 preview runs everything else in the shader, with the glow and soft-focus
maps computed in the render worker from the guide grid. Neutral Creative settings leave every
earlier path bit for bit unchanged.

**Reference audit (DigiCamFX, 24 Oct 2026).** Inspected in a browser without uploading a photo,
so controls and names were verified, results were not: tools JPEG (quality presets, resolution,
JPEG quality, noise, sharpen, 2× pixelate), Filters (two groups of preset buttons, among them
Nashville, Sepia, 2014, Bleach Bypass, B&W, B&W Clamped, Desat; Intensity, Vignette and an
iPhone6 grain slider), Collage, Blur/Pixelate (uniform, vignette or drawn; Gaussian or pixel
size), CCD (blur, bloom amount and tint, lens reflection, noise with blend mode, JPEG quality,
resolution, sharpen, pixelate), and fully automatic Nokia, 1/4", iPhone3gs and one emoji-named
effect. Effects are applied destructively with Apply; filter buttons are labelled swatches,
not photo thumbnails. Already possible here before: bleach bypass, desaturation and
monochrome, sepia-like grading, vignette, grain, bloom. New here: JPEG blocks, low resolution
and pixelation, chromatic aberration and channel displacement, quantisation and dither,
sensor noise, per-channel clipping and early-camera response, soft focus. No code, artwork or
preset values were taken; every filter here is an original approximation.

**Text** (section Text, **Text** under the preview or T): Add text, then edit the wording,
font (Schibsted Grotesk or Martian Mono, SIL OFL, bundled), bold, italic (Grotesk), size
(% of the short edge), colour, opacity, alignment, outline, shadow, position, rotation and
scale; Duplicate, Bring forward / Send backward and Delete. With the tool on, drag a text to
move it (the photo does not pan), the corner handle scales, the round handle rotates (Shift:
15° steps); focused text moves with the arrow keys (Shift: larger), Delete removes it, Enter
or a double-click edits the wording; handles are 44 px on touch screens. Since Interval 12 each
object is a text layer in `adjustments.layers` (see [Layers](#layers)): `{ id, type: 'text', text,
font, weight, italic, size, x, y, rotation, scale, color, opacity, align, outline, shadow }`
plus the layer fields; Bring forward / Send backward move it within the whole stack. Coordinates are relative to the output frame (centre at x, y),
so text keeps its place and proportions after a crop, a turn or any export size. Text is
plain data drawn with `fillText`; on import, control and bidi-override characters are
removed, 500 characters, 20 lines and 30 objects per photo at most, values clamped.

**Text rendering.** Preview and export use the same layout (in output pixels) and drawing
code (`text/textRender.mjs`, `rasterizeTextLayer`): each object is drawn (outline, then fill,
with its shadow) into a sprite at the render's own resolution (the preview canvas, or the export
size) cut to its ink, outline and shadow, then composited like any layer with its opacity and
blend mode (opacity now applies to text and shadow together, as group opacity). Fonts load from the site's own assets (about 300 kB, only once text is used;
no font service); characters outside their Latin, Latin Extended (and Cyrillic for Martian
Mono) subsets are drawn with a system font, and the Text panel says so. Placement measured
in the check: preview, full-size and 300 px exports agree to 0.4% of the frame in Chromium,
Firefox, WebKit and both phone emulations; glyph rasterisation differs slightly between
browsers. Text is not shown in Original, sits on the edited side of Split, is hidden while
cropping and in 1:1 Detail, and is not drawn in thumbnails. In the preview it is as sharp as the
preview canvas (up to 4096 px), so past that zoom it is upscaled like the photo.

**Presets, sync, reset.** Presets contain Creative, never layers. Paste copies Creative, never
layers; **Sync…** copies the layer stack only when Layers is ticked. Reset all clears layers too
(one undo step); the Text section's reset removes text layers only.

**Filter Library measurements** (`npm run check:editor:filters`, Windows i7-9700, headless
Playwright, whole browser memory; Chromium with `CHECK_GPU=1` on the RTX 3070, as headless
Chromium otherwise draws WebGL2 with SwiftShader). PNG exports of nine digital filters (every new
operation), with geometry and transparency, and batch ZIP entries equal the Node reference
(max 0; WebKit 1 for Classic CCD) in Chromium, Firefox, WebKit, iPhone 13 and Pixel 7 emulation
and without WebGL2. Shader vs CPU: 69 creative parity cases, new effects and GPU-capable
filters included, within one code value (posterize: at most 4 pixels one level apart).

| | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| Library open · 48 thumbnails (600×400 photo) | 69 ms · 0.7 s | 68 ms · 0.9 s | 1.4 s · 1.5 s |
| 48 thumbnails: 24 MP · genuine JPEG · genuine ARW | 1.2 · 0.9 · 1.4 s | 1.0 · 1.0 · 1.2 s | 0.6 s · not run |
| Filter switch to painted frame, 600×400: GPU · CPU-only (median) | 153 · 255 ms | 190 · 323 ms | 350 · 575 ms |
| 24 MP switch: Soft Focus (GPU) · Early Smartphone · Chromatic Fringing (final CPU frame) | 128 ms · 0.8 s · 2.6 s | 157 ms · 1.1 s · 2.8 s | 237 ms · 0.9 s · 2.0 s |
| 24 MP JPEG export: none · Early Smartphone · Soft Focus · Chromatic Fringing; peak | 0.7 · 1.9 · 3.4 · 3.8 s; 1794 MB (baseline 601) | 0.7 · 2.1 · 4.2 · 4.8 s; 2093 MB | 1.5 · 2.1 · 3.7 · 4.9 s; 1637 MB |
| Genuine A7 III JPEG, Classic CCD: switch · export (none); peak | 0.7 s · 2.0 s (0.6); 1726 MB | 1.1 s · 2.0 s (0.8); 2189 MB | not run |
| Genuine ARW, Early Smartphone: switch · export (none); peak | 0.7 s · 4.4 s (3.5); 2132 MB | 1.0 s · 20.5 s (14.8); 2342 MB | not run |
| Merged RAW HDR (DSC09640–42), Soft CCD Glow export | 15.4 s, 2731 MB | not run | not run |

The first CPU-only filter on a photo also sends the proxy to the render worker (24 MP: about
1.4–1.6 s instead of 0.7 s). Phones (emulation, not devices): thumbnails 0.9 s (iPhone 13) and
0.7 s (Pixel 7), GPU switch about 200 ms; without WebGL2 the median switch is 247 ms. Node,
one thread, final 2048 px CPU preview frame from a 4096 px proxy: 135 ms (Pixelated) to 850 ms
(Chromatic Fringing), drafts 60–330 ms. No physical iPhone was tested.

**Measurements** (`npm run check:editor:creative`, Windows i7-9700, headless Playwright,
whole browser memory). PNG exports with a look and every effect, with geometry + vignette,
and a pasted photo equal the Node reference exactly (0) in all six environments (Chromium,
Firefox, WebKit, iPhone 13 and Pixel 7 emulation, no WebGL2); ZIP entries equal the single
exports byte for byte. Shader vs CPU: 26 creative parity cases within one code value.

| | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| Slider to painted frame, 600×400 · 24 MP (4096 px proxy) | 185–200 ms · 2.7 s (SwiftShader); 52–89 ms on the RTX 3070 (`CHECK_GPU=1`), 52 ms without creative | 230–250 ms · 244 ms | 152–155 ms · 221 ms |
| Glow map after a radius change (preview) | 0.9 s; merged HDR 4.1 s | 1.2 s | 1.0 s |
| 24 MP JPEG, Warm Analog + bloom + bleach + text: export, peak | 5.9 s, 1536 MB (baseline 596) | 11.4 s, 1697 MB | 7.1 s, 1449 MB |
| Genuine A7 III ARW, bleach + grain: export, peak | 6.3 s, 1468 MB | 20.7 s, 2242 MB | not run |
| Merged RAW HDR (DSC09640–42), bloom + halation | 21.4 s, 2276 MB | not run | not run |

Three exports of the ARW cancelled after 1.5 s: 1299, 1291, 1290 MB (no growth). Headless
Chromium renders WebGL2 with SwiftShader, so its preview timings for grain are CPU-bound;
the creative shader is per pixel (grain reads 32 lattice values) and meant for a GPU.

## Layers

**Using them** (Layers panel at the top of the inspector, Adjust tab on phones; collapsible).
The stack is listed top first above **Background**, the photo with all its own settings.
Add **Image file…** (JPEG, PNG, WebP, ARW, DNG; imported for this photo only, not added to the
workspace), **Photo…** (another workspace photo), **Text** or **Adjustment**; a new layer goes
directly above the selected one. Select a row to edit that layer: blend mode, opacity, and for
image layers X, Y, W, H (px of the canvas), angle, Free resize, Flip horizontal/vertical and
Reset transform. Reorder by dragging the grip (mouse, pen or touch), with Move up/down, or
Alt+↑/↓ on a focused row. The eye hides a layer, the lock keeps its content, position, opacity,
blend mode and settings (visibility, name and order still change; it cannot be deleted).
Double-click or F2 renames. **Delete…** asks first and never touches the file. With an image or
adjustment layer selected, the Adjust panel edits **that layer's colour settings** (Light,
Color, HSL, Tone Curve, LUT, Creative colour parts, presets), labelled with the layer's name;
select Background to edit the photo. On the photo (**Move**, or T), image and text layers get a
box: drag to move (the photo does not pan), corner handle to resize (proportional; Shift or
Free resize: each axis), round handle to rotate (Shift: 15°), arrow keys move the focused
layer; handles are 44 px on touch screens. Every change is one undo step (drags record one
step on release).

| Type | Content | Settings |
| --- | --- | --- |
| Image | A source file named by SHA-256 (plus name, size, format, dimensions); box `x`, `y` (centre, 0–1 of the canvas), `width`, `height` (canvas short edges), `rotation`, `flipH`, `flipV` | Per-pixel colour controls applied to the layer's own pixels; RAW sources are developed with their as-shot white balance first |
| Text | The Interval 11 text object (`text`, font, size, colour, outline, shadow, `x`, `y`, `rotation`, `scale`) plus flips | – |
| Adjustment | – | The same colour controls, applied to everything below it |

Common fields: `id`, `type`, `name`, `visible`, `locked`, `opacity`, `blend`. Limits: 40 layers,
8 image, 30 text, 12 adjustment. Colour settings are Light, Color, HSL, Tone Curve, LUT, and from
Creative bleach bypass, film fade and tints, colour grading, sensor colour, response, highlight
clipping and quantisation. Detail, glow, soft focus, grain, noise, vignette, capture/JPEG and
lens effects need neighbouring pixels or the frame position and stay with the Background; RAW
white balance and HDR tone stay with their own source.

**Order and canvas.** `layers[0]` sits on the Background, the last entry is on top; each layer is
composited over everything below it. Per render: (1) each source is developed (Background: RAW,
HDR, every adjustment, Detail, Creative, Crop & Transform, exactly as before; image layer: its
decode or RAW development and its colour settings), (2) image and text layers are placed with
their transform, (3) composited bottom to top, adjustment layers acting on the composite below
them, (4) encoded. The canvas is the Background's output frame: Crop & Transform shapes the
canvas, and layer positions are relative to it, so they keep their place in the frame at every
zoom, export size and device pixel ratio. Cropping does not move layers with the photo's
content, and the Background's vignette and grain do not cover the layers.

**Blending** (`pipeline/blend.mjs`, W3C Compositing and Blending Level 1): Normal, Multiply,
Screen, Overlay, Soft Light, Hard Light, Darken, Lighten, Color Dodge, Color Burn, Difference,
Exclusion, Hue, Saturation, Color, Luminosity. Blending runs on **sRGB-encoded** values (as CSS,
canvas and most editors' 8-bit modes), not linear light; non-separable modes use the
recommendation's weights 0.3, 0.59, 0.11. Colours are straight; the general formula
`Co = (αs·((1 − αb)·Cs + αb·B(Cb, Cs)) + αb·(1 − αs)·Cb) / αo` with `αs` = the layer's alpha ×
edge coverage × opacity, so a layer over transparency keeps its colour and soft edges never
darken. An adjustment layer moves the composite toward `B(Cb, adjusted)` by its opacity and
keeps its alpha. Results are not claimed to match Photoshop.

**Compositing** (`pipeline/composite.mjs` CPU reference, `compositeShader.mjs` GPU mirror). The
canvas is RGBA8 after every layer pass, on both. An image layer's raster is sampled at each
canvas pixel centre through its inverse transform with the geometry warp's Catmull-Rom kernel
(premultiplied, 1/256 px grid) and faded over one pixel at its edges; text is rasterised by the
shared `textRender.mjs` at the render's own resolution and placed pixel for pixel. Passes are per
pixel (the kernel reads the layer's raster, never the canvas), so bands need no overlap and
tiles cannot seam. Preview: with visible layers the shader draws the photo into a framebuffer,
then one pass per layer between two framebuffers (an adjustment layer runs the main shader in
direct mode first); without WebGL2 the CPU composites the CPU frame. Layers are left out in
Original, on the "before" side of Split, while cropping and in 1:1 Detail. Export: the photo
renders as before into the export canvas, which is read once; each visible layer is prepared
alone (image: decoded, or for RAW developed in the RAW queue, at the size its box needs on the
export canvas, never more than the source; text: rasterised at export size), composited in
256-row bands on the band workers (on the page, yielding, on phones), then released; the canvas
is written back and encoded. At most one layer raster is held besides the canvas and its copy.
A photo without layers, or with only hidden layers, empty text or neutral adjustment layers,
renders exactly as before.

**Projects.** Layers are part of the photo's settings: undo, autosave, Save edits/Open edits
(version 9). Documents keep layer records and source references, never pixels. Version 8 and
older files open with their text objects as text layers (same ids, order and fields; tested with
documents written by the Interval 11.5 editor). When an image layer's file is not loaded (after a
reload, or on another machine) the row says "missing", the layer is not drawn and the export is
blocked with the layer's name; **Reconnect file…** accepts only the file with the same SHA-256
(another file is refused with a message); importing the same file as a workspace photo also
resolves it. Presets never contain layers; Paste never copies them; **Sync…** copies the whole
stack only when **Layers** is ticked (it replaces the target's stack). Thumbnails and the Filter
Library show the photo without layers.

**Accuracy and measurements** (`npm run check:editor:layers`): Windows i7-9700, headless Playwright,
whole browser memory, Chromium without `CHECK_GPU` (SwiftShader).

- **Parity** (29 cases: every blend mode with a rotated, flipped, soft-alpha layer at 80%, over
  transparency, an exact sprite, five adjustment layers, a three-layer stack). Shader passes vs
  the CPU reference over the shader's own photo render: raster passes ≤ 1 code in Chromium 141,
  Firefox 142 and WebKit 26; adjustment passes ≤ 1 in Chromium, ≤ 4 in Firefox and WebKit, where
  a 1-code difference in the adjusted colour (the established shader tolerance) is amplified by
  Luminosity's clip-to-gamut step (few pixels, mean 0.02). End to end, including the photo's own
  shader-vs-CPU difference: ≤ 1 (Chromium), ≤ 6 (Firefox, WebKit; dodge and burn amplify it).
  The CPU reference against the browsers' own canvas blend modes (an independent implementation
  of the same formulas): ≤ 4 codes, dodge/burn ≤ 10 (canvases store premultiplied 8-bit values).
- **Exports**: PNG exports with a hard-alpha PNG layer (multiply, 80%, 20°) and an adjustment
  layer, in both orders, **equal the Node reference exactly** in all six environments (Chromium,
  Firefox, WebKit, iPhone 13 and Pixel 7 emulation, no WebGL2); a text layer changes only pixels
  around it, centred within 6 px of where its fields put it. Soft-alpha PNG layers are decoded
  through the browser's premultiplied canvas, which can move their colours by a code before
  compositing (covered by the unit and parity tests instead).

| | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| Add a 300×200 PNG layer to its first composited frame · blend change · opacity change · drag frame (median) | 287 · 72 · 141 · 157 ms | 651 · 18 · 50 · 32 ms | 742 · 63 · 70 · 47 ms |
| 24 MP photo + 12 MP JPEG layer + adjustment layer: layer preview · JPEG export · peak · after deleting both | 114 ms · 2.0 s · 1803 MB · 1424 MB | 279 ms · 2.2 s · 1979 MB · 1755 MB | 604 ms · 2.9 s · 1597 MB · 857 MB |
| Genuine A7 III ARW + JPEG layer (soft light) + ARW layer (screen, 2000 px) + text: layer previews · export · peak | 3.8 s · 7.7 s · 7.7 s · 1612 MB | 0.5 s · 4.5 s · 19.4 s · 2185 MB | not run (LibRaw crash, see Known issues) |
| Merged RAW HDR (DSC09640–42) + JPEG layer (overlay, 60%) + text: export · peak | 17.2 s · 2319 MB | not run | not run |

Phones (emulation, not devices): adding a layer 0.3 s (Pixel 7) and 0.8 s (iPhone 13), drag
frames 64–147 ms, grips and row targets 44 px, no sideways scroll. Without WebGL2 the CPU
composites at the preview size (drag frame 90 ms at 600×400). The RAW layer preview waits for
the RAW queue (one decoder at a time), so a RAW layer appears after its half-size decode.
Repeated project switching with layers was not measured separately; the raster cache is bounded
(8 rasters, 384 MB) and cleared when the workspace empties. No physical iPhone was tested.

## Masks and local adjustments

**Using them** (Masks panel, below Layers; Adjust tab on phones). **New local adjustment →
Brush, Linear or Radial** adds an empty local adjustment with that tool on: paint, or drag on the
photo to place the gradient (+ Brush, + Linear, + Radial add a component without a pointer).
While a local adjustment is selected, the Adjust panel shows only **its** Light, Color, HSL and
Detail (labelled "local …"); select it again to edit the photo. With an image, text or
adjustment layer selected, **Add mask to "…"** gives it a mask (starts as "Everything selected":
paint Erase or subtract to hide). For the selected mask: Amount (local adjustments), Mask on
(layer masks), Invert mask, Start with nothing/everything, Density, overlay (tint colour or the
mask in greyscale), the component list (add or subtract, invert/"Outside", opacity, feather,
duplicate, delete, turn off), numeric X, Y, angle and transition (linear) or radii and angle
(radial). On the photo: brush (size, hardness, stroke opacity, Paint/Erase, Alt erases while
held, pen pressure narrows strokes; a ring shows the brush), drag to create a gradient, drag its
handles (linear: start = full effect, end = none, centre moves; radial: centre, both radii,
rotation). Gradient centres are focusable: arrow keys move them (Shift: larger steps), Delete
removes. Keys: M tool on/off, O overlay, X paint/erase, [ ] brush size, Esc ends the tool.
While a tool is on, one pointer paints or drags (the photo does not pan, the page does not
scroll); a second touch cancels the stroke; turn the tool off to pan or pinch. Handles are 44 px
on touch screens. Every stroke or drag is one undo step.

**Model** (`model/masks.mjs`, plain data in the photo's settings). A mask is
`{ space, base, enabled, invert, opacity, components }`; a component is a brush (`strokes`), a
`linear` (`x0, y0` full → `x1, y1` none, `feather` 0 = straight ramp … 1 = smooth curve) or a
`radial` (`x, y`, radii `rx, ry`, `rotation`, `feather` = share of the radius that fades), each
with `id`, `name`, `enabled`, `op` (`add`: m + c − m·c; `subtract`: m·(1 − c)), `invert`,
`opacity`, applied in order from `base` (0 or 1); the mask's invert and density apply last, so
combining is deterministic. A stroke is `{ mode: add|erase, radius, hardness, opacity, points:
[[x, y, pressure]…] }`: capsules along the path (no gaps however far apart the points are), a
pixel's coverage within one stroke is its maximum (a stroke does not build up over itself),
strokes combine like components. Pressure scales the radius (0.2–1 ×; mice and touch use 1).
Flow is not implemented. Points are recorded every 1.5 screen px or 15% of the radius, so a long
stroke is a few hundred points (about 25 bytes each).

| Owner | Space (coordinates) | Follows |
| --- | --- | --- |
| Local adjustment (`adjustments.local`) | `image`: the photo as imported, before Crop & Transform | the photo's content through crop, rotation, flips, perspective, stretch and resize |
| Adjustment and text layer (`layer.mask`) | `canvas`: the output frame | the composition, as layer positions do |
| Image layer (`layer.mask`) | `layer`: the layer's own box | the layer when it moves, rotates or flips |

Positions are fractions of the space's width and height (gradients may start outside it,
−2…3); radii in units of its short edge, so circles stay round. Screen, zoom and pan are only
used to convert the pointer into these units. A local adjustment is `{ id, name, enabled,
amount, mask, settings }`; `settings` holds non-neutral Light, Color, HSL and Detail values.
Limits: 16 local adjustments, 16 components per mask, 400 strokes, 2000 points per stroke and
40 000 brush points per photo (local adjustments first, then layer masks), which keeps edit
documents within 4 MB. Imported masks are validated like every other setting: unknown types,
bad ids and non-numbers are dropped or defaulted, coordinates and radii clamped, and the space
is the owner's whatever the file says.

**Rendering** (`pipeline/mask.mjs`, `composite.mjs`). A mask is evaluated per canvas pixel: its
centre is mapped into the mask's space (a homography: identity, the geometry's output → source
matrix, or the layer matrix), shapes are evaluated there, and the coverage is stored as 8-bit
codes. It scales a raster pass's alpha (`αs` = alpha × edge coverage × opacity × mask) or an
adjustment's opacity per pixel, so blend modes, layer opacity and transparent edges behave as
without a mask. Hard edges are antialiased over one canvas pixel. Local adjustments are passes
directly above the finished photo and below the layers, in list order: the Detail settings as a
Detail pass (`detailRenderer.mjs` with only those settings, its guide from the composite so far),
then Light, Color and HSL through the adjustment-layer renderer, both mixed back by mask ×
amount. They act on the 8-bit finished photo (after its global settings, including Creative
grain and vignette), like adjustment layers, not on the linear RAW or HDR data. Neutral settings,
amount 0 and empty masks add no pass. Preview: the GPU reads a mask texture computed by the same
code on the page (exactly the CPU's codes); a local adjustment with Detail switches the preview to
the CPU renderer (draft, then final, labelled). Exports evaluate masks band by band at the
export's size; Detail passes read a halo of rows around each band from the unchanged composite
and render only the rows and columns their mask covers, so tiles have no seams. While the brush
paints, the edited mask keeps its finished strokes' coverage and the stroke being drawn, so each
new point costs only its own segment (bounded to two components, released when the brush is put
away). Clipping masks (a layer clipped to the one below) are **not built**: they would need
nested passes and a second alpha source per pass, and no control is shown for them.

**Projects.** Version 10 documents add `local` and `layer.mask`; version 9 files open unchanged
(tested with a document written by the Interval 12 editor). Masks are geometry and paths, never
bitmaps. Presets never contain masks or local adjustments; Paste never copies them; **Sync…**
copies **Local gradients** only when ticked: linear and radial components with their settings
(brush components are dropped, and a local adjustment left with nothing is not copied); **Layers**
copies layer masks with the stack. A local adjustment's `settings` are kept apart from its
`mask`, so reusable values can be applied without touching a photo's masks or layers.

**Accuracy and measurements** (`npm run check:editor:masks`; Windows i7-9700, headless
Playwright, Chromium on SwiftShader):

- **Parity**: masked passes (an image layer masked in its own space in three blend modes, an
  adjustment layer masked by a gradient, brush strokes and a subtracted radial, a local adjustment
  under crop, rotation and perspective): raster passes 0 codes, adjustment passes ≤ 1 code from the
  CPU reference in Chromium 141, Firefox 142 and WebKit 26.
- **Exports** equal the Node reference **exactly** in all six environments (Chromium, Firefox,
  WebKit, iPhone 13 and Pixel 7 emulation, no WebGL2): a gradient dragged while zoomed, a
  brush with an erase stroke, a radial with Clarity; then geometry with a masked Multiply
  adjustment layer, a masked image layer and a fourth local adjustment. Saving, reloading and
  reopening gives the same masks and the same pixels. A 24 MP PNG with a Dehaze gradient and a
  Clarity/Sharpening radial equals the reference (Chromium), so band boundaries leave no seams.
- **Genuine** (A7 III ARW, DSC09640): a sky gradient, a radial with Clarity and a brush; every
  sampled pixel farther than the Clarity halo from all three masks is unchanged (0 of 710 207 in
  Chromium; 0 of 488 474 in Firefox, with geometry). A masked text layer (erase stroke) and a
  merged RAW HDR (DSC09640–42) with a local gradient (exposure, Dehaze) export in Chromium.

| | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| Gradient drag · brush move to painted frame (median, 600×400) | 84–133 · 150 ms | 40–55 · 46 ms | 93 · 79 ms |
| Local Clarity to the final CPU frame (600×400) | 270–330 ms | 205–210 ms | 258 ms |
| 24 MP, Dehaze gradient + Clarity radial: export · peak · after | 25 s (PNG) · 1.76 GB · 1.36 GB | 22 s (JPEG) · 1.90 GB · 1.40 GB | 20 s (JPEG) · 1.94 GB · 1.26 GB |
| Genuine ARW (6024×4024) with three local adjustments: PNG export · peak | 14.8 s · 1.89 GB | 22.2 s · 2.44 GB (geometry, 5420×3419) | not run (LibRaw crash) |
| Merged RAW HDR + local gradient: JPEG export · peak | 24.3 s · 2.48 GB | not run | not run |

Mask evaluation (Node, same machine): a linear or radial over a 2048×1365 preview 80–90 ms; a
400-point brush stroke 232 ms from scratch and 34 ms per new point while painting (p95 38 ms).
Single-thread local Detail at 24 MP: 2.1 s (Clarity radial) to 3.8 s (Dehaze over a half-frame
gradient). Phones (emulation): brush frames 80 ms (iPhone 13) and 150 ms (Pixel 7), list rows and
handles 44 px, no sideways scroll, no global `overflow: hidden`; touch painting does not pan.
Without WebGL2 the brush frame is 69 ms. RAW decoder concurrency is unchanged (one at a time).

## Batch editing

**Selection** (library list and filmstrip). The active photo is the one shown and edited,
and the source of a sync; it is always selected. Click opens one photo and selects only it;
Ctrl/⌘-click adds or removes a photo without changing the active one; Shift-click selects
the range from the anchor (Ctrl/⌘-Shift adds it); as in file managers, a Ctrl/⌘-click moves
the anchor. Each list row has a checkbox; Ctrl/⌘ A selects every ready photo, Esc clears.
On touch screens **Select…** (Photos panel) or **Select** (filmstrip) turns taps into
add/remove until **Done**. Rows show: active (border), selected (accent ring), edited and
not exported with these settings (dot), exporting (pulsing dot), export failed (red dot and
"Export failed"); the same states are in each button's accessible name. Edits always change
the active photo only; nothing changes the other selected photos until a batch action is
applied.

**Copy, paste, sync** (`model/sync.mjs`). Copy edits (Ctrl/⌘ Shift C) keeps the active
photo's settings (parameters, never pixels). Paste (Ctrl/⌘ Shift V) applies them to the
selected photos: Light, Color, HSL, Detail, Tone curve, LUT and Creative (never text). **Sync…** copies chosen
groups from the active photo to the other selected photos and lists, per photo, which
groups change, with before/after thumbnails (first 12; thumbnails do not show Detail),
before anything is applied. Chosen groups are **replaced exactly** (a neutral source group
resets it on the target, a source without LUT removes the target's LUT); other groups keep
each photo's values. Source-specific data is not a setting and is never copied: a RAW
file's as-shot multipliers, camera matrix and exposure data (`photo.raw`), a merge's files,
roles and merge settings (`photo.hdr`). Two groups are off by default and copy only where
they apply: **RAW white balance** (mode, kelvin and tint; RAW source to RAW and merged RAW
targets, each developed through its own camera matrix) and **HDR tone mapping** (between
merged RAW HDR photos). A LUT that is not loaded blocks the sync until it is imported or LUT
is left out. Geometry is copied only when ticked (paste never copies it): **Output size
(resize)** copies the resize box to any photo; **Crop & transform** (crop, ratio, turns,
flips, straighten, perspective, stretch) only to photos with the same proportions. Settings move freely between JPEG, PNG, WebP, RAW and merged photos.

**Presets, filters, LUTs, reset.** **Preset…** applies a built-in or saved preset to every selected
photo exactly as to one (only the groups it contains); a preset's Creative values replace a
photo's filter record. **Filter…** applies a Filter Library filter (built-in or custom) at a
strength: each photo's Creative group is replaced and its grain pattern, text, geometry and
other groups are kept; paste and Sync copy the filter record with the Creative group. **LUT…** sets a loaded `.cube` (or
none) and its intensity on every selected photo; the colour assumptions are those of
[Pipeline](#pipeline). **Reset…** returns them to neutral (RAW as shot, merges kept). All
four preview the plan like Sync; Cancel changes nothing.

**Undo.** A batch change adds one history entry per changed photo (so Ctrl/⌘ Z on a photo
undoes its part) and one batch entry holding that photo's settings before and after (a few
hundred bytes each; never pixels; the last 20 batches). **Undo/Redo <batch>** restores
every photo still at the value the batch left, and skips (and counts) photos edited since
or removed.

**Export selected.** One format (JPEG, PNG, WebP where the browser encodes it), quality,
size (original, long edge, fit within; aspect ratio always kept, never upscaled) and suffix
for all; each photo rendered from its original file with its own settings by the same code
as a single export (RAW from sensor data, merged HDR from its three files, Detail at full
resolution). Saved as **one ZIP** or **separate files**. Photos that cannot be exported now
(missing LUT, HDR memory budget, unsupported format) are listed with the reason and left
out. Per-photo progress, Cancel for one photo or the batch, and **Retry** for failed or
cancelled photos (as separate files with the same names). File sizes are not estimated
(they depend on content); the dialog states the largest canvas (exact: width × height × 4)
and adds the RAW decoder for RAW photos. Phones and devices reporting ≤ 4 GB get a warning
for full-size RAW/HDR outputs above 16.7 MP (iOS canvas cap).

**Queue** (`batch/exportBatch.mjs`): one export at a time. RAW and HDR exports need several
hundred MB to 1.5 GB each, and one at a time keeps the peak at the largest photo rather than
the sum; Detail already uses up to four render workers per photo, and RAW decoding still
goes through the RAW queue. Each item gets its own workers, ended afterwards or on cancel. A
photo is queued once; removing a photo drops it from the queue or stops it, and its result
is never delivered; a failure ends that photo only, and finished photos are delivered as
they finish. A single export and a batch never run together.

**Names** (`batch/batchNames.mjs`): `exportFileName()` for each photo (`DSC09640.ARW` →
`DSC09640-quangedit.jpg`, `DSC09641-HDR-quangedit.jpg`, Unicode kept, unsafe characters
replaced, suffix never doubled), then collisions numbered in workspace order ignoring case
(`DSC0001-quangedit.jpg`, `DSC0001-quangedit-2.jpg`). A custom name typed in the dialog
(Rename) is kept, sanitised, with the format's extension. Names never contain a path, so
ZIP entries cannot escape the folder; ZIP entries and separate downloads have the same
names. The ZIP is `photos-quangedit-YYYY-MM-DD.zip`.

**ZIP** (`batch/zipArchive.mjs`, [client-zip](https://github.com/Touffy/client-zip) 2.5.1,
MIT, 2.6 kB, no compression or wasm, ZIP64): each encoded photo is streamed into the
archive as it finishes and then released; decoded images are never kept. The archive is
collected as Blob chunks. Parts are limited to 1 GB (256 MB on phones and ≤ 4 GB devices);
a larger batch is split into complete `…-part1.zip`, `…-part2.zip`. A part is downloaded
only after its central directory is written: a ZIP failure discards that part (its photos
are marked failed), and Cancel finishes the ZIP with the photos already done, so no
half-written archive is ever delivered. Entries are stored with one modification time
(the batch start). Integrity is checked by an independent reader (`dev/zipVerify.mjs`:
central directory, local headers, CRC-32) in unit tests and the browser check.

**Validation** (`npm run check:editor:batch`, Windows i7-9700, headless Playwright):
selection, copy/paste with batch undo and redo, Sync without Light, a preset on four photos,
a ZIP and separate files (names, CRC, sizes), a custom name, cancel after one photo then
retry, in Chromium 141, Firefox 142 and WebKit 26 (desktop), and selection mode plus a ZIP
export without sideways scrolling in iPhone 13 (WebKit) and Pixel 7 (Chromium) emulation.
Three batches of four PNGs at full size in a row: Chromium peak 630–642 MB on a 574–587 MB
baseline (no growth between batches).

Genuine A7 III ARWs (`DSC09640–09642`, `BATCH_FIXTURE_DIR`, Chromium): import of three
2.6 s; one photo edited (Exposure, Shadows, Texture), pasted to the other two, Natural preset
on two, then three full-size JPEGs (6024×4024, names `DSC0964x-quangedit.jpg`):

| Batch | Time | Browser memory peak (baseline 641 MB) |
| --- | --- | --- |
| Three separate files | 18.6 s (32.5 s before the Detail band workers) | 1660 MB |
| The same three as one ZIP | 17.6 s (32.0 s); entries byte-identical to the separate files | 1559 MB, 1008 MB after |
| Merge of the bracket (`DSC09641-HDR`), then the three RAWs and the merge (6002×4018) as one ZIP | 32.0 s (47.2 s) | 2140 MB |

Not verified: physical phones (iPhone, Android), Safari on macOS, batches of 50 full-size
RAWs, ZIP parts above 1 GB.

## Edit documents and persistence

```json
{
  "type": "quanghuynh.photo-editor.edits",
  "version": 3,
  "savedAt": "2026-10-22T12:00:00.000Z",
  "exportSettings": { "format": "jpeg", "quality": 0.92, "resize": { "mode": "original", "longEdge": 3840, "maxWidth": 3840, "maxHeight": 3840 }, "suffix": "-quangedit" },
  "photos": [{
    "source": { "name": "DSC0001.jpg", "size": 1234567, "lastModified": 0, "sha256": "…", "format": "jpeg", "width": 6000, "height": 4000, "orientation": 1 },
    "adjustments": {
      "exposure": 0.35, "contrast": 25, "highlights": -60, "shadows": 40, "whites": 0, "blacks": 0, "temperature": 0, "tint": 0, "vibrance": 0, "saturation": 0,
      "orangeHue": -15, "blueLuminance": -30, "lutIntensity": 60,
      "curves": { "master": [[0, 12], [128, 140], [255, 250]] },
      "lut": { "sha256": "…", "name": "teal-orange.cube", "title": "Teal & Orange", "size": 33 }
    }
  }]
}
```

- Values are relative to neutral (LUT intensity defaults to 100). The ten
  Interval 3 controls are always written; other controls, curves and the LUT
  only when they change something. Missing keys are neutral.
- Version 10 added masks (see [Masks and local adjustments](#masks-and-local-adjustments)):
  `local` (local adjustments) and an optional `mask` on layers, stored as geometry and stroke
  paths, never bitmaps. Version 9 files open unchanged with none.
- Version 9 replaced `overlays` with `layers` (see [Layers](#layers)): image layers store
  `source: { sha256, name, size, format, width, height }`, never pixels; settings are compacted
  like the photo's. Older files' text objects become text layers (same ids and order).
- Version 8 added the digital creative controls (`sensorColor` … `diffusionRadius`, see
  [Creative and text](#creative-and-text)) and `filter` (`{ "id": "filter:classic-ccd",
  "strength": 70 }`, the Filter Library record; an unknown id is kept and shown as modified,
  a malformed one dropped). Older files open with them neutral and no filter.
- Version 7 added the creative controls (`bleachAmount` … `gradeBlending`, `grainSeed`) and
  `overlays` (text objects, see [Creative and text](#creative-and-text)); older files open with
  them neutral and no text. Malformed objects are dropped, values clamped.
- Version 6 added `geometry` (only parts that differ from neutral are written, for example
  `{ "angle": 3.5, "crop": { "x": 0.1, "y": 0.1, "width": 0.5, "height": 0.5 } }`); values
  are clamped and degenerate quads dropped on reading; older files open with none.
- Version 5 added the Detail controls `texture`, `clarity`, `dehaze`,
  `sharpening`, `luminanceNoise`, `colorNoise`; older files open with Detail neutral.
- Version 4 added merged HDR sources (see [Merge HDR](#merge-hdr)) and the HDR tone
  controls `hdrHighlights`, `hdrShadows`.
- Version 2 added curves, HSL and LUTs; version 3 RAW sources (`"format": "arw"`
  or `"dng"`) and RAW white balance (`"raw": { "whiteBalance": "custom" }`,
  `rawTemperature`, `rawTint`). Older files still open; an older editor rejects a
  newer version instead of silently dropping settings.
- **LUTs are referenced, not embedded**: by SHA-256 of the `.cube` file, with its
  name and size. After a reload or on another machine the LUT section and the
  export panel say which LUT is missing; export is blocked until the same file
  is imported again (then every photo using it resolves) or the LUT is removed.
- Parsing is `JSON.parse` plus validation: wrong type or version, more than
  4 MB (checked from the file size before reading it; presets likewise at 1 MB) or 500 photos is rejected; values and curve points are clamped,
  malformed curves and LUT references become neutral, unknown keys dropped.
- Entries match reimported files by SHA-256, or by name and size without a
  hash. Unmatched entries wait and apply when the same file is imported.
- **Save edits** downloads the document. The editor also autosaves it to
  `localStorage` (`photo-editor:edits:v1`): settings and filenames only, never
  pixels. After a reload the editor asks for the originals again; there is no
  full-session restore, because image files are not stored.

## Presets

- A preset is a name plus the **groups** it contains: Exposure, White balance,
  Tone, Vibrance and saturation, HSL, Detail, Tone curve, LUT. **Applying replaces those
  groups exactly** (anything the preset leaves out of a group becomes neutral)
  and leaves every other group of the photo alone, in one undo step.
- Hovering or focusing a preset previews it on the photo (badge "Preview:
  …"); nothing is recorded until it is clicked.
- Saving preselects the groups that are edited, except Exposure and White
  balance (usually per-photo corrections); any group can be ticked.
- Presets never contain or change geometry or layers (they belong to one photo); Creative is a group. Applied with an image or adjustment layer selected, a preset sets that layer's colour settings.
- Built-ins (Natural, Warm Portrait, Cool Landscape, Soft Film, High Contrast,
  Black & White) are ordinary presets run through the same engine; none
  touches exposure or white balance.
- Your presets live in `localStorage` (`photo-editor:presets:v1`), up to 200.
  Export writes `{ "type": "quanghuynh.photo-editor.presets", "version": 1,
  "presets": [{ "name", "groups", "settings" }] }`; import accepts that or a
  single preset, at most 1 MB, validated like edit documents. A preset with a
  LUT stores the LUT reference only.

## Export filenames

`exportFileName()` in `io/files.mjs` names every export (batch exports and ZIP entries
through `batchFileNames()`, see [Batch editing](#batch-editing)): the source's base name with its last extension removed
(1–5 letters or digits, any case), sanitised, then the suffix, then the chosen
format's extension. The default suffix is `-quangedit`: `DSC09420.ARW` →
`DSC09420-quangedit.jpg`, `portrait.png` → `portrait-quangedit.webp`. A name that
already ends with the suffix gets no second one; Unicode names, extra dots and
names without an extension are kept. A custom suffix typed in the Export panel is
kept (empty is allowed); saved settings that still hold the old default `-edited`
switch to `-quangedit`. A layered photo is named after its Background (the composition is that
photo's), so `DSC09641-HDR` with layers exports as `DSC09641-HDR-quangedit.jpg`.

## Import limits

Files are identified by content (magic bytes), never by name or MIME type. A TIFF
structure goes to the RAW decoder, which accepts it only as DNG (DNGVersion tag)
or Sony ARW (maker "SONY") and names anything else ("RAW or TIFF files from Canon
are not supported").
Limits are checked from the header before decoding: 200 MB per file, 16 384 px
per side, 100 MP, and 50 photos per workspace. Duplicates (same SHA-256) are
reported against the original. Errors are per file: unsupported, empty,
damaged header, failed decode, too large.

`.cube` LUTs: 3D only (`LUT_3D_SIZE` 2–65; 17, 33 and 65 are common), optional
`TITLE`, `DOMAIN_MIN`/`DOMAIN_MAX` or `LUT_3D_INPUT_RANGE`, comments and blank
lines; up to 16 MB, parsed and hashed in the worker (a 65³ file in about
0.26 s). 1D LUTs, unknown keywords (for example `LUT_IN_VIDEO_RANGE`),
incomplete or extra data, bad numbers and invalid domains are rejected with the
line and reason; nothing is reinterpreted. LUTs are kept for the session only
(up to about 3.3 MB each at 65³) and never uploaded.

## Memory and performance

**Heavy workflows** (`npm run check:editor:memory`, Chromium, genuine `DSC09640–42` ARW +
JPG; working set of all browser processes after a forced collection): two identical cycles
of import, 6 switches, two full-size RAW exports with Detail, a cancelled and a finished
Merge HDR, Detail on the merge, a ZIP cancelled after one photo and then complete, and
removing everything. Final Interval 9 build: baseline 724 MB; peak 2.7–2.8 GB (the ZIP of
six photos incl. the HDR, 42 s, was 47–49 s); empty workspace after cycle 1 / cycle 2:
1186 / 1207 MB, 1138 MB 35 s later (21 MB growth between identical cycles; before the
viewer stopped keeping the last photo's frames, 1318 / 1328 MB on a 779 MB baseline); live
workers back to 0. The rest above baseline is memory the allocators keep and download Blobs (revoked 30 s after each download starts).

Measured with `npm run check:editor`, headless Chromium on the development
machine (Windows, desktop GPU), two 6000×4000 JPEGs:

| Measure | Result (range over 4 runs) |
| --- | --- |
| CPU render, 24 MP (Node, single thread, i7-9700) | Interval 3 controls 2.6 s; + curves 4.5 s; + HSL 7.9 s; + 65³ LUT 5.4 s; all together 10.4 s |
| Full-resolution 24 MP JPEG export | 2.3–2.4 s in page, 3.3 s until the file is written; banded export: 2.0–2.1 s, 2.9–3.0 s (2 runs) |
| First switch to a 24 MP photo (decodes a 4096 px proxy) | 270–360 ms |
| Switch back to a cached photo | 30–55 ms |
| Import of two 24 MP JPEGs (hash, header, thumbnail) | 0.2–0.26 s |
| Chromium memory, all processes incl. GPU: baseline | 1369–1418 MB |
| … after 10 switches between the two photos | 1881–2018 MB |
| … peak during the 24 MP export | 2474–2850 MB (+1.1–1.4 GB); banded export: 2195 MB on a 1466 MB baseline (+0.73 GB) and 2493 MB on 1715 MB (+0.78 GB, no higher than with two 24 MP photos loaded) |
| … after removing every photo | 1607–1898 MB; with idle workers ended: 2063 MB on a 1715 MB baseline (1 run) |

Removing photos drops every reference (proxies, thumbnails, texture, canvas
buffer), and emptying the workspace ends the idle image workers so their heaps
go at once; Chromium still returns memory to the OS on its own schedule, so
the last row varies. The baseline itself varies by a few hundred MB between
runs; compare deltas.

Bounds: thumbnails only (320 px) for inactive photos; at most two decoded
proxies (LRU), and the viewer drops frames cached for a photo once it is not shown; one GPU texture plus a 16 KB curve table and one LUT texture;
one export worker at a time, holding one canvas and one 256-row band; the CPU
fallback preview keeps its proxy and up to two LUTs in its worker instead of
receiving them each frame; a newer proxy decode terminates the older one.
The GPU preview stays interactive with every stage on (about 0.05–0.07 ms per
64×64 frame in headless browsers; not a real-GPU figure). Not measured on an
M1 MacBook Air; the numbers above are from a desktop Windows machine.

## Browser support and startup failures

Required: `createImageBitmap`, a 2D canvas and `Blob.arrayBuffer` (Safari 15.4+,
current Chrome, Edge, Firefox). Without them the editor shows which API is
missing instead of the workspace. Everything else has a fallback:

| Missing | Fallback |
| --- | --- |
| WebGL2, highp float, or a shader that fails to compile | CPU preview (2048 px), reason recorded |
| Module workers, or `OffscreenCanvas` in workers (Safari < 16.4, Playwright WebKit) | Image tasks run on the main thread, yielding between bands; export can still be cancelled |
| `crypto.subtle` (insecure origin) | No duplicate detection by hash; edits match by name and size |
| `localStorage` | No autosave |

Phones (coarse pointer, screen ≤ 1024 px) and devices reporting ≤ 4 GB use a
3072 px preview (2048 px at ≤ 2 GB); exports always use the full resolution.

A route error boundary around every lazily loaded page shows the failing
operation, the error and a Retry (reload) instead of a blank page, for example
when page code cannot be downloaded after a deploy. **Diagnostics** in the
inspector shows and copies a local report (capabilities, preview engine, image
worker mode, recorded failures; no file names or pixels). The console has the
same as `window.__photoEditorDiagnostics`. Nothing is sent anywhere.

Before React, the editor HTML loads `public/photography/editor-startup.js`, a
same-origin ES5 watchdog (allowed by the CSP's `script-src 'self'`). If
`EditorApp` has not set `<html data-editor>` (`ready` or `unsupported`) within
12 s, or a same-origin error or failed script load leaves `#root` empty, it
shows "The photo editor did not start" with Retry and a copyable report:
startup stages with timings (chunk requested/loaded, preview engine, editor
mounted), what `#root` holds, errors with script paths, CSP violations, user
agent and capabilities; no photos or file names. Errors without a same-origin
script URL (browser extensions, injected scripts such as Brave iOS's wallet
`window.ethereum` shim, masked "Script error.") are listed as `external`,
counted rather than repeated, and never trigger the panel.
`window.__editorStartup.report()` gives the same text. The engine check blocks
the entry bundle, and injects wallet errors, in WebKit and Chromium.

For a page that started but shows nothing, open
`/photography/editor#startup-report`: after 5 s the same report opens (with
Close) regardless of start state, adding the visual viewport, the size and
position of the editor's main parts and the element on top at the top, centre
and bottom of the screen, measured before the panel covers the page. Errors
attributed to the page URL itself are listed as `inline` (iOS reports injected
scripts there) and never open the panel.

Troubleshooting hash switch (`debugFlag` in `diagnostics.mjs`, combinable with
`&`): `cpu-preview` never creates a WebGL2 context. Example:
`/photography/editor#cpu-preview&startup-report`.

Never put `overflow: hidden` on html and body for the editor. With both
clipped, body is a 0px-tall clipping box around the fixed `.pe` (`#root` has no
height) and iOS WebKit (Safari and Brave, iOS 18) paints nothing, though the
editor is mounted and hit-testable. Found on a real iPhone by turning the
scroll lock off; desktop WebKit does not reproduce it. A CSS test and the
engine check guard it.

Tested with `npm run check:editor:engines` (full flow incl. 12 MP export and a
`.cube` LUT): Playwright WebKit 26.0 (iPhone 13 emulation and desktop),
Chromium 141 (Pixel 7 emulation), Firefox 142, forced no-WebGL2 (WebKit) and
no-worker (Chromium); also WebKit 17.4 and 18.2 via `EDITOR_PLAYWRIGHT`
(those Windows builds cannot encode JPEG; the editor says so).
Playwright's WebKit is not Safari on iOS; physical iPhones and desktop Safari
are **not verified**. Playwright's Windows WebKit PNG encoder changes some
values by 1 on its own, so that check allows the encoder error it measures.
Safari cannot encode WebP (the option is disabled when the browser cannot).

## Known issues

- Zoom past the proxy (about 170% of the source width for 24 MP) is upscaled.
- Thumbnails re-render on the main thread (about 7 ms each, throttled).
- Main-thread image tasks (no worker canvas) pause the page briefly while decoding.
- Phones, ≤ 4 GB devices and CPUs with fewer than four threads export on one CPU thread
  (no band workers), so heavy edits take several times longer there.
- Pinch-zoom works with two pointers on the preview; it has not been tried on a
  physical phone.
- Filter Library (Interval 11.5): capture and channel-shift filters preview on the CPU (0.7–2.6 s
  to the final frame on 24 MP, a draft sooner) and are left out while cropping; capture
  thumbnails are coarser than the photo; JPEG compression always works at the 768 px capture
  grid, so it softens large photos; DigiCamFX's results were not compared visually (no photo
  was uploaded there).

- **Playwright Windows WebKit LibRaw crash: mitigated in Interval 9, not gone.** The web content process
  died (Playwright `crash`, "mprotect failed: 487" in Interval 5–7) when a RAW worker created
  LibRaw's shared wasm memory (256 MB initial, 2 GB maximum) **after** it had read the whole
  file into an ArrayBuffer, once an earlier RAW worker had ended, or while another RAW worker
  was decoding. Bisected with worker bundles that differ in one step (A7 III ARWs, trials of
  9 decodes in a fresh WebKit 26, Windows):

  | Worker (fresh per job, one at a time) | Crashed |
  | --- | --- |
  | Production worker (Interval 8), three runs | 3/10, 5/10, 6/10 |
  | Same code read through Playwright routing, as a classic worker | 6/10, 12/20 |
  | LibRaw calls inline, instantiated first; with `self.close()`; 512 MB initial memory; 36 MB results transferred or copied; no LibRaw at all | 0/10 each |
  | Editor `decodeRaw` + `sniffRaw` (read file, then instantiate) | 8/15 |
  | Inline calls, read file then instantiate · `decodeRaw`, instantiate then read | **7/15 · 0/15** |
  | Shared wasm memory held on the page · plain memory held · worker reused while jobs keep coming | 1/10 each · 7/10 · 0/10 |

  Fix: `rawTasks.mjs` checks the size and the header (256 KB), instantiates LibRaw, and only
  then reads the file; no memory is kept and workers are still ended after each job.
  `npm run check:editor:raw-stability` on the fixed production build, 20 trials each: one
  decoder at a time with half-size, full-size and iPhone 13 emulated decodes **0/20, 0/20,
  0/20**; two decoders at once still 12/20 and 14/20, so the editor runs one RAW decoder at
  a time (also the memory target). It still happens when LibRaw starts while other workers
  are busy with large buffers: a fresh worker warmed while the page fills 100 MB crashed
  8/15 (100 MB page allocations *between* jobs: 0/15), and full-size HDR exports from RAW
  crashed in 3 of 4 WebKit runs of `check:editor:hdr` (so `HDR_WEBKIT_EXPORT` stays
  opt-in). Only keeping LibRaw workers alive avoided it, which would keep up to about
  700 MB per worker; that is not done for a test-browser defect. Chromium and Firefox never
  crashed. It looks like a
  defect in the Windows WebKit port's handling of shared wasm memory; Safari on macOS and
  iOS has not been tested, so it is not known whether it is affected.
- Layers (Interval 12): no clipping masks, groups or smart objects; Detail, grain, vignette and
  geometry apply to the Background only (not over the layers); 1:1 Detail, thumbnails and the
  Filter Library show the photo without layers; layer previews of RAW sources wait for the RAW
  queue; in the preview a layer is as sharp as the preview canvas (4096 px at most). Merged HDR
  photos cannot be image layers (only the Background).
- Masks (Interval 13): local adjustments act on the finished 8-bit photo (after its global
  settings, Creative grain and vignette included), not on linear RAW or HDR data, so strong
  local exposure cannot recover clipped highlights; local Detail previews on one CPU thread and
  exports on the page thread (band by band, only where its mask covers); no flow (strokes do
  not build up within themselves), no feathering of a whole mask after combining (gradients have
  feather, brushes hardness), no clipping masks, no component renaming in the UI; 1:1 Detail,
  thumbnails and the Filter Library show the photo without masks; touch was tested with
  synthetic pointer events in emulation and pen pressure only by unit tests of the coverage, not on a
  physical iPhone or pen tablet.
- Geometry is manual: no automatic straightening, lens or camera-profile correction; no
  upscaling; Detail is not previewed while the crop tool is open; perspective corners stay
  inside the frame. Geometry adds the warp to exports (see
  [Geometry](#geometry-crop--transform)). Touch was tested with synthetic pointer events in
  iPhone 13 emulation, not on a physical phone or in Safari.
- Detail previews render on one CPU thread (exports use band workers): see
  [Detail](#detail). A multi-pass WebGL2 Detail preview is not built. 1:1 inspection is not
  available for merged HDR photos.

## Extension points

Every future feature stays non-destructive (settings in the edit document, applied
at render time), local and exportable at full resolution. Not built yet:

| Feature | Where it goes |
| --- | --- |
| More RAW formats (NEF, then CR2/CR3, RAF, ORF) | LibRaw decodes them already; add the maker to `sniffRaw`, then genuine fixtures and `rawFixtures.test.js` cases before claiming support. X-Trans (RAF) needs checking against `checkDecodable`. |
| Clipping masks, layer groups | Nested passes: a clipped layer's `αs` also multiplied by the alpha of the layer below (a second alpha source per pass in `composite.mjs` and the shader). |
| AI subject or sky selection | A new mask component type whose coverage comes from a computed map; the combine rules in `pipeline/mask.mjs` stay. |
| Local adjustments in linear light | Evaluating masks inside the base stage (RAW/HDR linear data) instead of on the finished 8-bit photo; needs the mask in the shader's source space. |
| Canvas-level effects over layers | Vignette, grain and geometry over the whole composite need the spatial renderer on the composited canvas (halo bands per pass). |
| Retouching, healing | Spatial; the tiled renderer and halo bands in `detailRenderer.mjs`. |
| Faster export | Band workers (`detailPool.mjs`) for non-Detail exports and Detail previews; per-pixel stages are independent per band too. |
| GPU Detail | A multi-pass WebGL2 version needs float render targets and parity checks against the CPU renderer. |
| 1:1 for merged HDR | The HDR worker would merge the three full-size files once and keep a crop, as `regionSource` does for one file. |
