# Photo editor (`/photography/editor`)

A public, local-first editor for JPEG, PNG, WebP and RAW (Sony ARW, DNG). No
account, no upload, no server: files are decoded, edited and exported in the
visitor's browser. Built in Interval 3 (light and colour), extended in Interval 4
(tone curves, HSL, `.cube` LUTs, presets) and Interval 5 (RAW, see [RAW](#raw));
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
| `src/editor/pipeline/shader.mjs`, `glRenderer.mjs` | WebGL2 preview: GLSL mirror of `spec.mjs`, constants injected from it. |
| `src/editor/model/` | Adjustment registry, bounded undo history, reducer, edit document. |
| `src/editor/io/` | Header parsing, limits and filenames, decoding, the image worker. |
| `src/editor/ui/` | React workspace (`EditorApp`, `Viewer`, panels) and `editor.css`. |
| `src/editor/dev/parity.html` | Dev-server-only GPU/CPU parity harness (not a build input). |
| `scripts/check-editor-browser.mjs` | `npm run check:editor`: end-to-end check in Chromium. |
| `scripts/check-editor-engines.mjs` | `npm run check:editor:engines`: the same flow in WebKit, mobile Chromium and Firefox, with forced fallbacks. |
| `src/editor/io/diagnostics.mjs` | Local capability report and startup failures (Diagnostics panel, `window.__photoEditorDiagnostics`). |
| `src/editor/raw/` | RAW: format sniffing, LibRaw wrapper (`rawDecoder`), colour math (`rawColor`), worker tasks, job queue and export (`rawClient`). |
| `scripts/check-editor-raw.mjs` | `npm run check:editor:raw`: RAW parity, import, white balance, exports in Chromium, Firefox and WebKit; genuine ARW with `RAW_FIXTURE_DIR`. |
| `public/photography/third-party-notices.txt` | Licence notices for the RAW decoder, linked from the inspector. |

The route is `EDITOR_ROUTE` in `src/seo/site.mjs`: its own static HTML,
`noindex`, kept out of `ROUTES` and the sitemap until the owner decides to
index it, with a CSP meta tag (`connect-src 'self'`, inline scripts by hash).
The page is a lazy chunk; the gallery and homepage never load editor code
(tested in `src/seo/build.test.js`).

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
wasm heap. At most two run at once (one on phones and devices reporting ≤ 4 GB);
previews go before exports, exports before imports, and a newer preview cancels the
older one. Imports decode half size only; nothing is decoded at full size before
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

Playwright's Windows WebKit intermittently crashes the page when a RAW worker grows
its shared wasm heap ("mprotect failed: 487"; about half of the runs that import
the ARW after another RAW). Not seen in Chromium or Firefox; not caused by WebGL or
by starting fresh workers. Safari on macOS and iOS is **not verified**; test on a
real iPhone before relying on it. iOS canvases cap at about 16.7 MP, so a 24 MP
export fails there with the existing message (choose a smaller size). Not measured
on an M1 MacBook Air.

**Security and licences.** Files are identified by content and size-checked before
decoding; LibRaw's reported dimensions are checked before pixels are allocated;
damaged files and decoder errors become per-file messages. The decoder (ISC
wrapper, LibRaw under CDDL-1.0, Little CMS, IJG libjpeg, zlib) is a separate
1.4 MB wasm loaded only by the RAW worker; notices are in
`public/photography/third-party-notices.txt`. Open items:
[dependencies-licensing.md](photography-platform/dependencies-licensing.md).

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
  or second canvas is held. Cancelling terminates the worker. One export runs at
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
- Version 2 added curves, HSL and LUTs; version 3 RAW sources (`"format": "arw"`
  or `"dng"`) and RAW white balance (`"raw": { "whiteBalance": "custom" }`,
  `rawTemperature`, `rawTint`). Older files still open; an older editor rejects a
  newer version instead of silently dropping settings.
- **LUTs are referenced, not embedded**: by SHA-256 of the `.cube` file, with its
  name and size. After a reload or on another machine the LUT section and the
  export panel say which LUT is missing; export is blocked until the same file
  is imported again (then every photo using it resolves) or the LUT is removed.
- Parsing is `JSON.parse` plus validation: wrong type or version, more than
  4 MB or 500 photos is rejected; values and curve points are clamped,
  malformed curves and LUT references become neutral, unknown keys dropped.
- Entries match reimported files by SHA-256, or by name and size without a
  hash. Unmatched entries wait and apply when the same file is imported.
- **Save edits** downloads the document. The editor also autosaves it to
  `localStorage` (`photo-editor:edits:v1`): settings and filenames only, never
  pixels. After a reload the editor asks for the originals again; there is no
  full-session restore, because image files are not stored.

## Presets

- A preset is a name plus the **groups** it contains: Exposure, White balance,
  Tone, Vibrance and saturation, HSL, Tone curve, LUT. **Applying replaces those
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

`exportFileName()` in `io/files.mjs` names every export (later batch or ZIP
exports must use it too): the source's base name with its last extension removed
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
proxies (LRU); one GPU texture plus a 16 KB curve table and one LUT texture;
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
- Exports with every advanced stage on are slow on one CPU thread (about 10 s
  at 24 MP on a desktop; phones several times longer). Rendering bands on
  several workers is the next step.
- Pinch-zoom works with two pointers on the preview; it has not been tried on a
  physical phone.

**Deferred: sharpening and noise reduction.** Both are spatial filters, unlike
every stage above. Done properly they need a multi-pass GPU pipeline with float
render targets, overlapping bands in the export, and (the deciding issue) a
preview that is a downscaled proxy: at fit zoom, or at 100% on a 24 MP photo
(proxy at 0.68×), the preview cannot show what a 1-pixel radius does to the
export, so preview and export would disagree. They wait for a full-resolution
tiled preview at 100% zoom, which would also remove the first known issue.
Edge-preserving noise reduction (bilateral or non-local means) is also beyond
the single-thread CPU budget measured above; a plain blur would be the
low-quality approximation the brief rules out.

## Extension points

Every future feature stays non-destructive (settings in the edit document, applied
at render time), local and exportable at full resolution. Not built yet:

| Feature | Where it goes |
| --- | --- |
| More RAW formats (NEF, then CR2/CR3, RAF, ORF) | LibRaw decodes them already; add the maker to `sniffRaw`, then genuine fixtures and `rawFixtures.test.js` cases before claiming support. X-Trans (RAF) needs checking against `checkDecodable`. |
| Crop, rotate, straighten, perspective, resize | A geometry stage before the per-pixel pipeline: proxy and export sample through one transform; a `geometry` object in the settings (new document version). |
| Creative filters (bleach bypass, grain, halation, bloom) | Per-pixel looks fit after the LUT; grain, halation and bloom are spatial (see sharpening above). |
| Text, layers, blend modes | A layer list in the document composited after the photo pipeline, by the same engine in preview and banded export. |
| Brushes, masks, gradients, local adjustments | Per-layer masks evaluated per pixel; brush masks need a stored raster or stroke list. |
| Retouching, healing, noise reduction | Spatial; need the tiled full-resolution path below. |
| Faster export | Split bands across several workers (the band loop in `imageTasks.mjs` is already independent per band). |
| Sharpening, noise reduction, 1:1 preview | Tiled full-resolution decode around the viewport, a spatial stage after the per-pixel ones, band overlap in export. |
| Batch export, ZIP, preset sync | Queue over the export worker (and the RAW queue); names from `exportFileName()`; presets already apply per group to any photo. |
| HDR | Float source path plus the RAW base rendering. |
