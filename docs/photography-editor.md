# Photo editor (`/photography/editor`)

A public, local-first editor for JPEG, PNG, WebP and RAW (Sony ARW, DNG). No
account, no upload, no server: files are decoded, edited and exported in the
visitor's browser. Built in Interval 3 (light and colour), extended in Interval 4
(tone curves, HSL, `.cube` LUTs, presets), Interval 5 (RAW, see [RAW](#raw)) and
Interval 6 (three-exposure HDR, see [Merge HDR](#merge-hdr)), Interval 7 (Texture,
Clarity, Dehaze, sharpening and noise reduction, see [Detail](#detail)) and Interval 8
(multi-photo selection, sync, batch export and ZIP, 1:1 Detail inspection, see
[Batch editing](#batch-editing));
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
  the image itself.
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
shown ("Detail: draft preview", "Detail preview at W×H"). The guide is cached while only
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
selected photos: Light, Color, HSL, Detail, Tone curve and LUT. **Sync…** copies chosen
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
is left out. Settings move freely between JPEG, PNG, WebP, RAW and merged photos.

**Presets, LUTs, reset.** **Preset…** applies a built-in or saved preset to every selected
photo exactly as to one (only the groups it contains). **LUT…** sets a loaded `.cube` (or
none) and its intensity on every selected photo; the colour assumptions are those of
[Pipeline](#pipeline). **Reset…** returns them to neutral (RAW as shot, merges kept). All
three preview the plan like Sync; Cancel changes nothing.

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
switch to `-quangedit`.

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
- Detail previews render on one CPU thread (exports use band workers): see
  [Detail](#detail). A multi-pass WebGL2 Detail preview is not built. 1:1 inspection is not
  available for merged HDR photos.

## Extension points

Every future feature stays non-destructive (settings in the edit document, applied
at render time), local and exportable at full resolution. Not built yet:

| Feature | Where it goes |
| --- | --- |
| More RAW formats (NEF, then CR2/CR3, RAF, ORF) | LibRaw decodes them already; add the maker to `sniffRaw`, then genuine fixtures and `rawFixtures.test.js` cases before claiming support. X-Trans (RAF) needs checking against `checkDecodable`. |
| Crop, rotate, straighten, perspective, resize | A geometry stage before the per-pixel pipeline: proxy and export sample through one transform; a `geometry` object in the settings (new document version). |
| Creative filters (bleach bypass, grain, halation, bloom) | Per-pixel looks fit after the LUT; grain, halation and bloom are spatial: the tiled renderer in `detailRenderer.mjs`. |
| Text, layers, blend modes | A layer list in the document composited after the photo pipeline, by the same engine in preview and banded export. |
| Brushes, masks, gradients, local adjustments | Per-layer masks evaluated per pixel; brush masks need a stored raster or stroke list. |
| Retouching, healing | Spatial; the tiled renderer and halo bands in `detailRenderer.mjs`. |
| Faster export | Band workers (`detailPool.mjs`) for non-Detail exports and Detail previews; per-pixel stages are independent per band too. |
| GPU Detail | A multi-pass WebGL2 version needs float render targets and parity checks against the CPU renderer. |
| 1:1 for merged HDR | The HDR worker would merge the three full-size files once and keep a crop, as `regionSource` does for one file. |
