# RAW-processing feasibility

Interval 0, 2026-10-22. The proof of concept, tests and benchmark scripts are in
[experiments/raw-decode-poc](../../experiments/raw-decode-poc/README.md).

**Interval 5:** the editor now ships this decoder (pinned `libraw-wasm` 1.6.0). What is
supported, measured and still unverified is in
[photography-editor.md](../photography-editor.md#raw); this file stays the Interval 0 record.

## Verdict

Genuine in-browser decoding is **validated** in Chromium and Node, using
LibRaw 0.22.1 compiled to WebAssembly (`libraw-wasm` 1.6.0) inside a Web
Worker, for:

- **Sony A7 III uncompressed 14-bit ARW**, the format of the owner's archive;
- **Sony A7 III uncompressed 12-bit ARW**, which the camera wrote for a
  1 s exposure;
- **Sony A6400 compressed (lossy) ARW**.

Still unvalidated:

- **A7 III compressed ARW**: none exists in the archive. It uses the same
  lossy ARW 2.3 format and decode path as the validated A6400 file.
- **DNG**: no DNG exists in the archive.

## Fixtures

| | A7 III 14-bit | A7 III 12-bit | A6400 compressed |
| --- | --- | --- | --- |
| File | `DSC09420.ARW` ("Pier light", 2026-10-17), 49.3 MB, SHA-256 `d64fbd28…e8fd057` | `DSC09546.ARW` ("High Falls", 2026-10-19), 49.2 MB, SHA-256 `03ff74ff…68556d7` | `DSC00042.ARW` (2026-09-29), 24.9 MB, SHA-256 `19783625…0cd4f28` |
| Source | `E:\cameras\Photography-Workspace\01-RAW\Sony-A7III\` | same | `photo-archive` repository, `sony-a6400/` |
| Body, firmware | ILCE-7M3 v4.04 | ILCE-7M3 v4.04 | ILCE-6400 v2.00 |
| Exposure | 1/250 s, ISO 100 | 1 s, ISO 640 | 1/160 s, ISO 3200 |
| Format | "Sony Uncompressed 14-bit RAW" (compression 1), 14 bits/sample | Same file type; `BitsPerSample` 12 | "Sony ARW Compressed" (compression 32767), stored 8 bits/pixel, 14-bit range after decoding |
| Sensor data | 48,674,304 bytes (16 bits/pixel) | 48,674,304 bytes | 24,337,152 bytes |
| Common to all | 6048×4024 CFA RGGB, black 512, white 15360, 1616×1080 embedded JPEG preview | | |

- The two A7 III frames are published, people-free photographs. The A6400
  frame is private and has a person in it.
- None is committed, and only the scratchpad ever held any output from them.

What the archive holds (ExifTool header scan of 586 files under `01-RAW/Sony-A7III`):

- 576 A7 III uncompressed 14-bit and 6 uncompressed 12-bit frames. The 12-bit
  frames are all exposures of 1 s or longer: DSC09279, DSC09544–09548.
- **No A7 III compressed RAW and no DNG.**
- 4 A6400 files filed under `Sony-A7III/2026-10-05` (DSC00382 onward).
- **No exposure-bracket set.** No frame has exposure-bracketing drive mode.
  The only near-bracket, DSC09212–09214 (2026-10-20), varies ISO at a fixed
  1/250 s, so it cannot extend dynamic range.

The reproducible procedure is in the PoC README.

## What "genuine decoding" was checked against

The embedded preview is 1616×1080, so a full-size result cannot come from it.
Each check below is a test in `test/fixture.test.mjs`, and all of them pass
against all three fixtures (10/10 each). The figures quoted are from the
A6400 file.

1. **Geometry:** LibRaw's `raw_width`×`raw_height` equals the CFA strip that
   the file's own TIFF SubIFD declares (parsed independently in `src/tiff.mjs`).
2. **Mosaic:** `rawImageData()` is a `Uint16Array` of 6048×4024 undemosaiced
   samples.
   - The two green sites match each other within 5%.
   - Red and blue each differ from green by more than 10%.
   - Interpolated or JPEG-derived data would not show this per-site structure.
3. **Resolution and depth:** the render is 4024×6024×3 at 16 bits, against a
   1616×1080 preview.
4. **Linearity:** with `LINEAR_SETTINGS`, a +1 EV exposure shift doubles
   unclipped values (median ratio 2.000 over 173,743 samples).
   - The negative control, LibRaw's default gamma, gives 1.547.
   - This also exposed a library bug (below).
5. **Data dependence:** overwriting the 6,048 stored bytes of sensor row 2012
   changes that mosaic row only. Every other row is bit-identical, and the
   embedded preview stays byte-identical. The pixels depend on the sensor
   data, not on the preview.
6. **Rejection:** feeding the preview JPEG in as input fails instead of
   producing an image.

Visual checks (scratchpad only, deleted afterwards) of the A6400 file and of
A7 III DSC09420 matched the camera JPEG in content, orientation and colour.
They look flatter, as expected for linear data with only the sRGB transfer
applied and no camera tone curve. Before the linear-gamma fix the A6400
render looked flat, which is what led to finding the `gamm` bug.

## Measurements

Machine: Intel Core i7-9700 (8 threads), 15.9 GB RAM, Windows 11.
- Node.js 24.18.0, and headless Chromium 153.0.8010.12 (Playwright build).
- Medians of three runs unless noted. The tables are for the A6400
  compressed file; A7 III results follow them.
- Settings are `LINEAR_SETTINGS`: 16-bit output, linear, camera white balance,
  no auto-bright, sRGB primaries.
- Single-threaded throughout (see Threads below).

| Case | Node (direct factory) | Chromium worker, with COOP/COEP | Chromium worker, without |
| --- | --- | --- | --- |
| Full, linear interpolation (`userQual 0`) | 1,184 ms | not run | not run |
| Full, AHD (`userQual 3`) | 2,436 ms | 3,347 ms (cold worker each run) | 3,372 ms |
| Full, DHT (`userQual 11`) | 4,039 ms | not run | not run |
| Half size (2012×3012, no demosaic) | 358 ms | 661 ms | 671 ms |
| Reused worker, 8 sequential full AHD decodes | n/a | 3,317 ms first, then 2,457–2,513 ms | 3,394 ms first, then 2,462–2,495 ms |

`open()` (parse only) takes 47–73 ms. Chromium times include worker start-up,
copying the 24.9 MB input in, and transferring the 145 MB 16-bit result out.

| Memory | Value | How measured |
| --- | --- | --- |
| Page + worker during a full decode (fresh worker) | 559 MB | `performance.measureUserAgentSpecificMemory()` (needs cross-origin isolation, so not available without COOP/COEP) |
| Page + worker during a half-size decode | 316 MB | same |
| Reused worker, steady state over 8 full decodes | 673 MB, flat after the second decode | same |
| Node RSS, full AHD / DHT / half | 777 / 939 / 893 MB peak | `process.memoryUsage().rss` (whole process) |
| Output buffer, full 16-bit RGB | 145 MB (4024×6024×3×2 bytes) | arithmetic |
| wasm heap | 256 MB initial, 2 GB maximum | declared by the module |

**A7 III uncompressed**, same machine and settings:

| Case | 14-bit DSC09420 | 12-bit DSC09546 |
| --- | --- | --- |
| Node: linear / AHD / DHT / half size | 1,145 / 2,355 / 3,791 / 312 ms | 1,000 / 2,239 / 3,811 / 280 ms |
| Chromium worker, full AHD, cold (with / without COOP/COEP) | 3,300 / 3,307 ms | 2,958 / 2,970 ms |
| Chromium worker, half size (with / without) | 587 / 589 ms | 519 / 522 ms |
| Reused worker, warm full AHD (runs 2–8) | 2,401–2,437 ms | 2,243–2,274 ms |
| Page + worker memory: full / half / reused steady state | 606 / 339 / 725 MB | 606 / 339 / 724 MB |
| Node peak RSS: AHD / DHT | 847 / 1,009 MB | 847 / 1,009 MB |

Uncompressed files are twice the size of compressed ones (49 MB against
25 MB) and use about 47 MB more memory, but decode at the same speed.

Not measured: Firefox, Safari or any mobile device; WebGL upload of the
decoded data; peak memory on low-RAM devices.

## Library findings (libraw-wasm 1.6.0)

- **`gamm` with two values is silently ignored**
  ([#8](https://github.com/ybouane/LibRaw-Wasm/issues/8), open). Output stays
  BT.709-gamma-encoded while the caller believes it is linear. Workaround:
  pass all six values. The linearity test guards it.
- **Memory leak when the factory is used directly.** Embind instances need
  `delete()`. Without it each instance keeps about 256 MB, and the 8th full
  decode failed with `memory access out of bounds` (2 GB limit). With
  `delete()`, RSS stayed at 777 MB. The package's worker entry point keeps a
  single instance per worker, and reusing that worker did not grow memory.
- **Threads:** the build links pthreads and allocates shared memory, but never
  starts a thread. OpenMP is compiled out
  ([#29](https://github.com/ybouane/LibRaw-Wasm/issues/29)), so decoding is
  single-threaded. As a result it worked identically in Chromium **without**
  cross-origin isolation, where `SharedArrayBuffer` is unavailable. Firefox and
  Safari behaviour with shared wasm memory and no isolation is **untested**.
- **Pixel stability across versions:** an upstream report shows NEF colours
  shifting between builds ([#12](https://github.com/ybouane/LibRaw-Wasm/issues/12)).
  Open PR [#30](https://github.com/ybouane/LibRaw-Wasm/issues/30) would change
  pixels again (removing `-ffast-math`) and add an opt-in threaded build that
  needs COOP/COEP. Pin the exact version and gate upgrades on fixture
  checksums.
- **API detail:** `metadata(false)` omits `color_data`, `colors` and
  `filters`.

## Candidates compared

| Candidate | Format coverage | Licence | Browser / worker | Evidence here | Verdict |
| --- | --- | --- | --- | --- | --- |
| **libraw-wasm 1.6.0** (LibRaw 0.22.1, LCMS 2.19.1, IJG libjpeg 9f) | LibRaw's formats: ARW compressed and uncompressed, DNG including lossy (JPEG), NEF, CR2/CR3. No zlib identity string is present in the wasm, so deflate DNG (for example float or HDR DNGs) is probably unsupported. | Wrapper: ISC per `package.json`, but no LICENSE file ([#31](https://github.com/ybouane/LibRaw-Wasm/issues/31)). LibRaw: LGPL-2.1 or CDDL-1.0. LCMS: MIT. | Yes: module Web Worker, 1.4 MB wasm, WASM SIMD required | Decoded, tested and benchmarked (above) | **Recommended**, pinned and wrapped |
| dcraw.js (`dcraw` 1.0.3, 2022) | dcraw tables have no ILCE-6400 or ILCE-7M3 entry | GPL-2.0 | Emscripten/asm.js, synchronous | Identified the file, then the full decode threw `RangeError: Invalid array length` | Rejected |
| `libraw.js` 3.0.0 / `libraw` 0.1.4 | LibRaw | LGPL-2.1 / MIT | Native Node add-ons, not browser | Not run | Not applicable to the browser |
| Own Emscripten build of LibRaw 0.22.2 | Same as LibRaw | LGPL-2.1 / CDDL-1.0 | Yes | Not built | Fallback if upstream stalls or a fix is needed |
| rawler / rawloader (Rust) compiled to wasm | Sony ARW, DNG; no LCMS colour pipeline | LGPL-2.1 | Would need our own wasm-bindgen build | Not built | Not pursued: more work, demosaic and colour left to us |
| Adobe DNG SDK | DNG only, no ARW | Adobe DNG SDK licence | No maintained wasm build | Not built | Not suitable as the primary decoder |
| exifr / embedded-preview extraction | Reads the 1616×1080 JPEG only | MIT | Yes | n/a | **Not RAW decoding**; usable only as an instant placeholder thumbnail |

## Colour management and bit depth

LibRaw applies the camera's colour matrix (`cam_xyz` from its Adobe-derived
table) and white balance, then converts to the requested output space. Two
limitations of 16-bit integer output:

- Values above the white point and negative (out-of-gamut) values are clipped.
- Headroom for highlight recovery is limited.

Recommendation for the editor:

- Decode to **linear Rec.2020 primaries** (`outputColor: 8`) with six-value
  `gamm` [1,1,…], camera WB, no auto-bright and `highlight: 0`, at 16 bits.
- Convert to float in the working pipeline.
- The PoC used sRGB primaries for simplicity. Rec.2020 output, LibRaw's
  highlight modes, and white-balance re-rendering (decoding with `userMul`
  instead of re-scaling rendered RGB) are Interval 3 work, unvalidated.

## Unsupported or unverified

- **A7 III compressed ARW**: unverified, because the archive has none. To
  validate it, shoot one frame with RAW File Type set to Compressed. The
  same lossy format is validated on the A6400.
- **Lossless compressed ARW** (A7 IV and later bodies): unverified. The A7 III
  does not offer it, according to Sony's specifications.
- **DNG** of any kind: unverified, no fixture. Deflate-compressed DNG is
  probably unsupported (no zlib in the build, as above).
- **Firefox, Safari and iOS**: untested. WASM SIMD needs Safari 16.4+. iOS
  per-tab memory limits may not fit a 560–725 MB decode; plan for half-size
  decoding there.
- **Embedded camera profiles, lens corrections and Sony picture profiles**:
  LibRaw does not reproduce the camera's JPEG look or apply lens corrections.
