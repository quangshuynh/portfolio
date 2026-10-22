# Editor and HDR architecture (proposal)

Interval 0 proposal for `/photography/editor`: a public, local-first editor
where files never leave the visitor's device. Only the RAW decode step has
been prototyped. Everything else here is design, and the numbers labelled
*estimate* were not measured.

## Principles

- **One definition of every operation.** Preview and export run the same
  shader with the same parameters. A CPU reference implementation defines the
  expected output and is what the tests check against.
- **Per-pixel operations only in v1.** Every listed control (white balance,
  exposure, highlights/shadows, contrast, colour, HSL, curves, LUT) is a
  function of one pixel. So a preview made from a downscaled proxy equals the
  full-resolution export at the same pixel, apart from resampling. Spatial
  operations (clarity, sharpening, noise reduction, local tone mapping) are
  out of v1. If added later, they need scale-aware parameters and
  overlapping tiles.
- **Float, linear and wide-gamut working data.** Working space is linear
  Rec.2020 in float32 on the CPU, and float16 or float32 on the GPU. CSS and
  Canvas 2D filters are not used to process images: they are 8-bit and
  display-referred, and have no curves, LUTs or HSL.
- **Non-destructive.** Sources are never modified. An edit is a small JSON
  document.

## Pipeline

```text
source ─► decode ─► working image ─► scene-linear adjustments ─► base rendering ─► display-referred adjustments ─► encode
          (worker)  linear Rec.2020    WB · exposure · highlights/   RAW/HDR: filmic   tone curve · 3D LUT          JPEG / PNG / WebP
                    float              shadows · contrast · sat/     JPEG/PNG/WebP:    (sRGB / Rec.709 encoded)     (16-bit later)
                                       vibrance · HSL (OkLCh)        inverse of input
```

1. **Decode** (in a worker):
   - **JPEG/PNG/WebP:** `createImageBitmap(file, { imageOrientation: 'from-image' })`,
     then OffscreenCanvas `getImageData`. The browser colour-manages embedded
     ICC profiles into the canvas colour space. A `display-p3` canvas keeps P3
     gamut where supported (to verify per browser). 16-bit PNGs arrive as
     8-bit (a known limitation). The result is linearised with the sRGB EOTF
     and converted to Rec.2020 primaries.
   - **RAW:** the libraw-wasm worker produces linear Rec.2020 16-bit data
     (see [raw-feasibility.md](raw-feasibility.md)).
   - **HDR:** the merge step below produces float32 radiance.
2. **Scene-linear adjustments**, in fixed order:
   - White balance: a Bradford chromatic adaptation from as-shot to a target
     temperature and tint. For RAW this is an approximation of re-decoding
     with new multipliers. It is chosen so that preview and export stay
     identical; exact RAW re-balancing can be added as an export-time
     re-decode later, and is flagged as a parity break if so.
   - Exposure: ×2^EV.
   - Highlights and shadows: smooth luminance-weighted gains in log2
     luminance (global, per-pixel).
   - Contrast: an S-curve in log space about 18% grey.
   - Saturation and vibrance.
   - HSL: eight hue bands with smooth weights in OkLCh.
3. **Base rendering** depends on the source:
   - RAW and HDR sources get a filmic display transform (tone mapping and
     highlight compression) to sRGB or Display P3, with gamut clipping in v1.
   - Display-referred sources (JPEG/PNG/WebP) get the exact inverse of their
     linearisation. That way neutral settings reproduce the input to within
     one 8-bit step, which is tested.
4. **Display-referred adjustments:**
   - Tone curve (master plus R, G and B): monotone cubic (Fritsch–Carlson)
     baked into 4096-entry 1D tables.
   - Creative 3D LUT with an intensity blend.
5. **Encode** (in a worker):
   - `OffscreenCanvas.convertToBlob` for JPEG, PNG and WebP, full resolution,
     metadata stripped by default.
   - 16-bit PNG or TIFF needs a small custom encoder (later).
   - Whether browsers embed an ICC profile for Display P3 exports is
     unverified, so sRGB is the default.

**Before/after** uses the same canvas with a split slider or a hold-to-compare
toggle. "Before" means neutral settings through the same pipeline: for RAW
there is no other "original", and for JPEG neutral is the identity.

## Adjustment state and presets

```json
{
  "schema": 1,
  "source": { "kind": "raw", "name": "DSC09546.ARW", "width": 6000, "height": 4000, "sha256": "…" },
  "adjustments": {
    "whiteBalance": { "temperature": 0, "tint": 0 },
    "exposure": 0, "contrast": 0, "highlights": 0, "shadows": 0,
    "saturation": 0, "vibrance": 0,
    "hsl": { "red": { "hue": 0, "saturation": 0, "luminance": 0 } },
    "curve": { "master": [[0, 0], [1, 1]] },
    "lut": { "sha256": "…", "intensity": 1 }
  }
}
```

- Values are relative to neutral, so the all-zero state is the identity and
  missing keys mean neutral. That keeps old documents valid as controls are
  added; `schema` changes only for breaking changes, with a migration.
- A **preset** is a named subset of `adjustments`. LUTs are referenced by
  content hash and stored once.
- **Batch sync** copies the chosen groups (for example everything except
  white balance) to the selected images. Thumbnails re-render. Export is a
  sequential queue with progress and cancellation that holds one
  full-resolution image at a time.

## LUTs (`.cube`)

- **Parser** (worker):
  - Accepts `TITLE`, `#` comments, `LUT_1D_SIZE`, `LUT_3D_SIZE` (2–256),
    `DOMAIN_MIN`/`DOMAIN_MAX`, and Resolve's
    `LUT_1D_INPUT_RANGE`/`LUT_3D_INPUT_RANGE`.
  - Data lines have red varying fastest.
  - Rejects the file if the count is not N³ or a value is non-finite. Errors
    are reported with a line number.
- **Interpolation:** tetrahedral, in both the CPU reference and the shader
  (`NEAREST`-sampled 3D texture plus manual tetrahedral weights). Hardware
  trilinear filtering would not match the CPU. Out-of-domain input is
  clamped.
- **Colour space:** `.cube` files declare none. The owner's six LUTs (33³,
  about 1.08 MB each) state "display-referred, Rec.709 in / Rec.709 out" in a
  comment. So LUTs apply after the base rendering, to sRGB-encoded values by
  default, with an option for a BT.1886 (gamma 2.4) input.
- **Size:** a 33³ LUT is 431 KB as float32 RGB, or 287 KB as an RGBA16F 3D
  texture. The owner's LUTs are not committed or redistributed.

## Rendering engine

| Option | Verdict |
| --- | --- |
| **WebGL2 fragment shaders** (float textures via `EXT_color_buffer_float`, `highp`) for preview and export, plus a **CPU reference** in JS float32 for tests | **Recommended**: available in current Chrome, Firefox and Safari |
| WebGPU | Later optimisation. Support is uneven, and two GPU back ends double the parity surface. |
| CPU only (JS or wasm SIMD) | Too slow for interactive sliders at full resolution *(estimate)*. Kept as the conformance oracle and as an export fallback when WebGL2 float rendering is unavailable. |
| CSS / Canvas 2D filters | Rejected: 8-bit, display-referred, unfaithful export |

- **Preview:** a proxy texture (long edge at most about 2560 px, about 35 MB
  as RGBA16F) re-rendered on each `requestAnimationFrame` with the latest
  parameters.
- **Export:**
  - The same shader renders the full-resolution source in tiles of at most
    2048², read back as RGBA8 with dithering for 8-bit output, or as float
    for 16-bit output.
  - A 24 MP RGBA16F texture is 192 MB and fits common 8192-px texture limits.
  - Tiling covers larger HDR results and devices with lower limits.
- **Parity tests:**
  1. GPU against the CPU reference on synthetic charts, maximum error 1/255
     in the 8-bit output, run in headless Chromium.
  2. Proxy render against a downscaled full render, mean ΔE2000 below 1.

## Workers, cancellation and memory

- **Decode worker:** one libraw-wasm worker, reused across files (memory
  stayed flat at 673 MB over 8 decodes). On cancellation it is terminated,
  because a running LibRaw call cannot be interrupted, and respawned
  (`open()` costs about 50 ms).
- **Image worker:** JPEG/PNG/WebP decoding, float conversion, LUT parsing,
  HDR alignment and merge, and encoding. All buffers are transferred, never
  copied.
- **Jobs:** each job has a monotonic id, results from stale ids are dropped,
  and preview requests coalesce so the latest parameters win.
- **Memory budget:**
  - Based on `navigator.deviceMemory` where it exists (Chromium); assume
    4 GB otherwise.
  - Hold at most one full-resolution working image plus proxies.
  - `ImageBitmap.close()` immediately after use.
  - Fall back to half-size RAW decoding when the budget is low (about
    316 MB instead of 559 MB, measured in Chromium).
- **GPU:** rendering on the main thread at first. Moving it to an
  OffscreenCanvas in a worker is an option once it is measured.

## Session persistence and privacy

- No uploads, no analytics on image content, and no network requests from
  the editor beyond its own static assets. Enforced with a CSP:
  - Vercel headers for the editor route: `connect-src 'self'`, and
    `script-src` with `'wasm-unsafe-eval'`.
  - A `<meta>` CSP on GitHub Pages, which cannot set headers.
- Edit documents and presets go in IndexedDB. Keeping source files across
  reloads is **opt-in**: copies go into the Origin Private File System, the
  size is shown, and a "Clear session" control removes them.
- Exports strip metadata, GPS included, by default.
- Everything is wrapped in try/catch: private windows and blocked storage
  still let a visitor edit and export, just without restore.

## HDR merge (three brackets)

1. **Validate:**
   - Exactly three frames; all RAW in v1.
   - Same camera model, lens, focal length, orientation and dimensions.
   - Distinct exposure times at least 0.7 EV apart.
   - Capture times within 10 s.
   - A warning if aperture or ISO differ; they are still compensated.
   - Values come from LibRaw metadata (`shutter`, `aperture`, `iso_speed`,
     `timestamp`).
2. **Decode identically:**
   - White-balance multipliers taken from the middle frame and applied to all
     three (`userMul`), so colour cannot shift between frames.
   - Linear Rec.2020, no auto-bright, 16-bit.
   - Each frame's clipping level is recorded.
3. **Align:** median-threshold-bitmap translation (Ward 2003) on an
   exposure-normalised luminance pyramid, searching ±64 px at full
   resolution.
   - Reports the shift and a confidence score.
   - Rotation is not corrected in v1; a tripod is expected, and handheld
     brackets are supported only for small translations.
4. **Merge with exposure data:**
   - Radiance is `E = Σ wᵢ · xᵢ / (tᵢ · Sᵢ/100 / Nᵢ²) / Σ wᵢ`, where `x` is
     linear RAW-derived data, `t` the exposure time, `S` the ISO and `N` the
     f-number.
   - The weight `w` falls to zero near black (noise) and at 95% of each
     frame's clip level, using the pixel's maximum channel so hue cannot
     shift.
   - The result is scaled so the middle frame's exposure maps to 1.
   - No camera-response recovery is needed, because RAW data is already
     linear. JPEG brackets would need Debevec–Malik or Robertson response
     recovery and are deferred. Averaging or overlaying frames is not a
     merge and is not offered.
5. **Deghost:**
   - Where unclipped, normalised frames disagree with the reference by more
     than the expected noise, use the middle frame alone.
   - The mask is dilated and feathered, and shown as an overlay.
6. **Tone-map and edit:** the float32 result becomes an HDR source in the
   editor. The filmic base rendering and the exposure and highlight controls
   work across its wider range.
   - Local tone mapping is a later addition.
   - Exposure fusion (Mertens) ignores exposure data, so it is at most a
     separately labelled mode.
7. **Export:** the normal export path. Writing linear EXR, float TIFF or
   linear DNG is out of scope for v1.

### Browser-only versus server-assisted

| | Browser only (**recommended**) | Server-assisted |
| --- | --- | --- |
| Privacy | Files stay on the device | 75–150 MB of originals uploaded per merge; retention and access obligations |
| Infrastructure | None (static hosting) | Cloudflare Workers are capped at 128 MB of memory (documented limit), so this needs containers or VMs: new cost and operations |
| Time | About 7–10 s of decoding (3 × 2.4–3.3 s, measured per frame) plus align and merge *(estimate 2–5 s)* | Faster with native multi-threaded LibRaw, plus upload time |
| Memory | *Estimate* 1.3–1.4 GB peak at full size: frames decoded one at a time (560–670 MB each, worker freed between), 3 × 145 MB linear frames, 291 MB float result, pyramids. Half-size mode is about a quarter of that. | Server-bounded |

Main risks:

- Out-of-memory on phones; mitigated with half-size mode and the budget
  check.
- Alignment failure on handheld brackets, and moving subjects.
- Highlight clipping detection after white-balance scaling.
- Negative out-of-gamut values in Rec.2020.
- Main-thread stalls; avoided by keeping all heavy work in workers.

**Fixture needed:** an A7 III three-frame AEB bracket (for example −2/0/+2 EV)
on a tripod and one handheld, both without people.
