# RAW decode proof of concept (Interval 0)

Isolated experiment: genuine Sony ARW decoding with LibRaw compiled to
WebAssembly ([`libraw-wasm`](https://github.com/ybouane/LibRaw-Wasm) 1.6.0,
LibRaw 0.22.1). It is not part of the site: the root build, root `npm test`
and the deployed bundle never touch this folder, and it has its own
`package.json`. Findings are in
[docs/photography-platform/raw-feasibility.md](../../docs/photography-platform/raw-feasibility.md).

## What the tests prove

`test/fixture.test.mjs` runs against a real camera file and checks that the
output comes from sensor data, not the embedded JPEG:

1. LibRaw's sensor geometry matches the CFA strip declared in the TIFF structure.
2. `rawImageData()` is an undemosaiced `Uint16Array` mosaic with per-site
   Bayer structure (two matching green sites, distinct red and blue sites).
3. The full render is 16-bit, 3-channel and at least 3x the embedded preview's pixel count.
4. With `LINEAR_SETTINGS` the output is scene-linear: a +1 EV exposure shift
   doubles unclipped values (a gamma-encoded render gives about 1.5x).
5. Overwriting one stored sensor row changes exactly that mosaic row and
   nothing else, while the embedded preview JPEG stays byte-identical.
6. A JPEG passed in as input is rejected.

`test/tiff.test.mjs` covers the helpers with synthetic data and always runs.

## Fixtures

RAW files are not committed (size, and they are private photographs). Without
a fixture the fixture suite is reported as **skipped**, which is not evidence
of compatibility.

Validated so far (all tests pass on each):

- Sony ILCE-7M3, uncompressed 14-bit: `DSC09420.ARW`, 49.3 MB.
- Sony ILCE-7M3, uncompressed 12-bit (1 s exposure): `DSC09546.ARW`, 49.2 MB.
  Both are from `E:\cameras\Photography-Workspace\01-RAW\Sony-A7III\`.
- Sony ILCE-6400, "Sony ARW Compressed" (lossy ARW 2.3): `DSC00042.ARW`,
  24.9 MB, from `photo-archive/sony-a6400/2026-09-29`.

The drive is flaky, so copy a fixture locally before running. Still missing,
because the archive holds none:

- an A7 III **compressed** RAW (camera setting RAW File Type: Compressed),
- a DNG (for example Adobe DNG Converter output from an A7 III ARW).

Use frames with no people in them.

## Running

Requires Node.js 22 or later (tested on 24.18). From this folder:

```bash
npm ci
npm test
```

With a fixture (PowerShell: `$env:RAW_FIXTURE = 'E:\cameras\sony-a7iii\...\DSC0xxxx.ARW'`):

```bash
RAW_FIXTURE=/path/to/file.ARW npm test
RAW_FIXTURE=/path/to/file.ARW npm run bench:node
RAW_FIXTURE=/path/to/file.ARW CHROME_PATH=/path/to/chrome npm run bench:browser
```

`bench:browser` starts a throwaway headless Chromium profile, serves a
harness page twice (with and without COOP/COEP headers) and decodes through
the package's own Web Worker entry point. Playwright's bundled Chromium works,
for example `%LOCALAPPDATA%\ms-playwright\chromium-1243\chrome-win64\chrome.exe`.
Write reports to `results/` (git-ignored) if you want to keep them.

## Known library quirks (1.6.0)

- `gamm` is ignored unless it has six elements
  ([#8](https://github.com/ybouane/LibRaw-Wasm/issues/8)); `LINEAR_SETTINGS` passes six.
- `metadata(false)` omits `color_data`, `colors` and `filters`; use `metadata(true)`.
- Embind `LibRaw` instances must be freed with `delete()` when the Emscripten
  factory is used directly; `withRaw()` does this. The package's browser entry
  point keeps one instance per worker, and `dispose()` terminates the worker.
- The build is compiled with pthreads but never starts a thread, so it decodes
  single-threaded and does not need cross-origin isolation (checked in Chromium only).
