# Photo editor (`/photography/editor`)

A public, local-first editor for JPEG, PNG and WebP. No account, no upload, no
server: files are decoded, edited and exported in the visitor's browser.
Built in Interval 3; the original proposal is in
[photography-platform/editor-hdr-architecture.md](photography-platform/editor-hdr-architecture.md).

## Layout of the code

| Path | Role |
| --- | --- |
| `src/editor/pipeline/spec.mjs` | **The rendering specification**: `deriveParams()` and the per-pixel reference (`processLinear`, `toneCurve`). |
| `src/editor/pipeline/colorMath.mjs` | sRGB transfer, matrices, daylight locus, Bradford white balance. |
| `src/editor/pipeline/cpuRenderer.mjs` | Deterministic CPU renderer: tests, export, no-WebGL2 preview. |
| `src/editor/pipeline/shader.mjs`, `glRenderer.mjs` | WebGL2 preview: GLSL mirror of `spec.mjs`, constants injected from it. |
| `src/editor/model/` | Adjustment registry, bounded undo history, reducer, edit document. |
| `src/editor/io/` | Header parsing, limits and filenames, decoding, the image worker. |
| `src/editor/ui/` | React workspace (`EditorApp`, `Viewer`, panels) and `editor.css`. |
| `src/editor/dev/parity.html` | Dev-server-only GPU/CPU parity harness (not a build input). |
| `scripts/check-editor-browser.mjs` | `npm run check:editor`: end-to-end check in Chromium. |

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
| Encode | – | sRGB OETF, rounded to 8 bits. |

Neutral settings reproduce the source bit for bit. The CPU renderer
tabulates tone mapping and encodes with code thresholds; it is tested to stay
within one code value of the exact spec. A locked snapshot fixture in
`pipeline.test.js` catches any change to rendering: update it only on purpose.

**Limits of 8-bit sources.** Input is 8-bit and display-referred. Highlights
can compress bright tones that still hold detail, but clipped areas stay
clipped: there is nothing to recover in a JPEG. Strong pushes can show banding
that was hidden in the source. Shadows lift noise and JPEG artefacts.

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
  (never upscaled), renders it on the CPU in 256-row bands with progress,
  and encodes it with `OffscreenCanvas.convertToBlob`. Cancelling terminates
  the worker. One export runs at a time. JPEG output is flattened onto white
  in linear light. Metadata (EXIF, GPS) is not copied. If the browser cannot
  encode the format, the export fails with a message instead of falling back
  to PNG.

**Expected differences**

| Comparison | Difference | Cause |
| --- | --- | --- |
| GPU preview vs CPU reference | ≤ 1 code value, mean ≤ 0.033 (23 cases) | float32 vs float64, GPU rounding |
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
  "version": 1,
  "savedAt": "2026-10-22T12:00:00.000Z",
  "exportSettings": { "format": "jpeg", "quality": 0.92, "resize": { "mode": "original", "longEdge": 3840, "maxWidth": 3840, "maxHeight": 3840 }, "suffix": "-edited" },
  "photos": [{
    "source": { "name": "DSC0001.jpg", "size": 1234567, "lastModified": 0, "sha256": "…", "format": "jpeg", "width": 6000, "height": 4000, "orientation": 1 },
    "adjustments": { "exposure": 0.35, "contrast": 25, "highlights": -60, "shadows": 40, "whites": 0, "blacks": 0, "temperature": 0, "tint": 0, "vibrance": 0, "saturation": 0 }
  }]
}
```

- Values are relative to neutral, and missing keys mean 0, so new controls
  keep old documents valid. `version` changes only for breaking changes.
- Parsing is `JSON.parse` plus validation: wrong type or version, more than
  1 MB or 500 photos is rejected; values are clamped and unknown keys dropped.
- Entries match reimported files by SHA-256, or by name and size without a
  hash. Unmatched entries wait and apply when the same file is imported.
- **Save edits** downloads the document. The editor also autosaves it to
  `localStorage` (`photo-editor:edits:v1`): settings and filenames only, never
  pixels. After a reload the editor asks for the originals again; there is no
  full-session restore, because image files are not stored.

## Import limits

Files are identified by content (magic bytes), never by name or MIME type.
Limits are checked from the header before decoding: 200 MB per file, 16 384 px
per side, 100 MP, and 50 photos per workspace. Duplicates (same SHA-256) are
reported against the original. Errors are per file: unsupported, empty,
damaged header, failed decode, too large.

## Memory and performance

Measured with `npm run check:editor`, headless Chromium on the development
machine (Windows, desktop GPU), two 6000×4000 JPEGs:

| Measure | Result (range over 4 runs) |
| --- | --- |
| CPU render, 24 MP (Node, single thread) | 2.4 s |
| Full-resolution 24 MP JPEG export | 2.3–2.4 s in page, 3.3 s until the file is written |
| First switch to a 24 MP photo (decodes a 4096 px proxy) | 270–360 ms |
| Switch back to a cached photo | 30–55 ms |
| Import of two 24 MP JPEGs (hash, header, thumbnail) | 0.2–0.26 s |
| Chromium memory, all processes incl. GPU: baseline | 1369–1418 MB |
| … after 10 switches between the two photos | 1881–2018 MB |
| … peak during the 24 MP export | 2474–2850 MB |
| … after removing every photo | 1607–1898 MB |

Removing photos drops every reference (proxies, thumbnails, texture, canvas
buffer), but Chromium does not reliably return the memory to the OS straight
away, so the last row varies.

Bounds: thumbnails only (320 px) for inactive photos; at most two decoded
proxies (LRU); one GPU texture; one export worker at a time; a newer proxy
decode terminates the older one. Not measured on an M1 MacBook Air; the
numbers above are from a desktop Windows machine.

## Browser support

Needs `createImageBitmap` with resize options, `OffscreenCanvas` 2D in
workers, module workers and `crypto.subtle` (secure contexts). Current
Chromium is verified by `check:editor`. Firefox and Safari 17+ should work but
are **not verified**; Safari cannot encode WebP (the option is disabled when
the browser cannot encode a format).

## Known issues

- Zoom past the proxy (about 170% of the source width for 24 MP) is upscaled.
- Thumbnails re-render on the main thread (about 7 ms each, throttled).
- No touch pinch-zoom; buttons, wheel and keyboard zoom only.
- The CPU fallback preview copies the proxy to the worker on every render.

## Extension points

| Feature | Where it goes |
| --- | --- |
| RAW (ARW, DNG) | New decoder in the worker producing linear data; skip the sRGB decode step and add a filmic base rendering stage in `spec.mjs` and the shader. Needs float textures. |
| Tone curve, HSL | New registry entries and stages in `spec.mjs`; curves as 1D tables uploaded as textures. |
| `.cube` LUTs | Display-referred stage after encode, tetrahedral in both renderers. |
| Presets, batch sync | Named subsets of `adjustments`; the reducer already keeps per-photo histories. |
| Batch export | Queue over the existing export worker (one at a time). |
| HDR | Float source path plus the RAW base rendering. |
