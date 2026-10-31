# RAW compatibility (Interval 21)

Genuine files tested with the editor's own pipeline (LibRaw 0.22.1 via `libraw-wasm` 1.6.0,
unchanged). The sample files are private and never committed. Rerun both checks against a
local folder:

```bash
RAW_COMPAT_DIR=C:/path/to/raws npm run check:raw:compat
RAW_COMPAT_DIR=C:/path/to/raws npm run check:editor:raw-formats
```

`check:raw:compat` (Node) runs identification, LibRaw metadata, half and full decodes, white
balance re-application against LibRaw's own decode (99.9th percentile within 8/65535), colour
against the camera's embedded JPEG (neutral R/G and B/G within 0.15 log, brightness within 6 L*
at some exposure from −1 to +2 EV, no magenta where green clipped) and a full-size export through
the worker's export handler (tone, colour, Detail, custom white balance, heal, crop, straighten).
`check:editor:raw-formats` (production build, browser) imports every file at once and, per photo,
applies a v13 document (tone, HSL, curve, grading, sharpening, noise reduction, white balance,
grain, crop and straighten, radial mask, Spot Heal, HUYNH watermark), then exports at full size,
compares preview and export, and checks that the watermark changes only its corner; then a
mixed-format ZIP with a cancelled first attempt, and saving, reloading and reopening the edits.

**Validated** = real-file decode, editing, preview and full-size export pass in Node and in
Chromium and Firefox. **Unsupported** = refused with a reason, before or during decoding.

## Matrix

| File | Camera | Format | Sensor | Image (oriented) | Node decode half / full s | Node export s | Heap MB | Neutral R / B (log) | Export (browser) | Chromium / Firefox export s | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Apple-iPhone-12-Pro.DNG | Apple iPhone13,3 back camera | DNG 1.4 | linear (demosaiced in camera), 16-bit | 3024×4032 | 1.2 / 0.9 | 6.9 | 307 | 0.029 / 0.004 | 2720×3628 | 12.3 / 11.3 | Validated |
| Canon-5D-Mark-IV.CR2 | Canon EOS 5D Mark IV | CR2 | Bayer RGGB, 14-bit | 6744×4502 | 1.2 / 3.6 | 18.9 | 499 | 0.006 / 0.001 | 6068×4050 | 16.2 / 33.0 | Validated |
| Canon-EOS-D60.CRW | Canon EOS D60 | CRW (CIFF) | Bayer RGGB, 12-bit | 3088×2056 | 0.2 / 0.6 | 4.0 | 256 | 0.035 / 0.031 | 2778×1850 | 4.3 / 7.1 | Validated |
| Canon-EOS-R.CR3 | Canon EOS R | CR3 (CRX) | Bayer RGGB, 14-bit | 6742×4498 | 0.6 / 2.9 | 18.3 | 494 | -0.011 / 0.003 | 6066×4048 | 16.8 / 30.4 | Validated |
| DJI_0020.DNG | Hasselblad L2D-20c | DNG 1.4 | Bayer RGGB, 16-bit | 5280×3956 | 0.3 / 1.8 | 12.3 | 363 | 0.001 / 0.015 | 4752×3560 | 12.7 / 21.1 | Validated |
| DSCF3103.RAF | Fujifilm X100V | RAF | X-Trans 6×6, 14-bit | 6246×4170 | 0.3 / 15.6 | 33.2 | 457 | 0.055 / 0.033 | 5620×3752 | 34.0 / 90.2 | Validated |
| Fujifilm-X-T4.RAF | Fujifilm X-T4 | RAF | X-Trans 6×6, 14-bit | 6246×4170 | 2.5 / 24.2 | 39.8 | 427 | 0.001 / 0.046 | 5620×3752 | 35.4 / 96.2 | Validated |
| IMG20231031184843.dng | OPPO Find X6 Pro | DNG 1.4 | Bayer BGGR, 10-bit | 4096×3072 | 0.1 / 1.2 | 8.1 | 256 | 0.036 / 0.017 | 3686×2764 | 7.5 / 12.6 | Validated |
| IMG_6266.CR3 | Canon EOS R8 | CR3 (CRX) | Bayer RGGB, 14-bit | 4024×6022 | 0.6 / 2.6 | 15.0 | 396 | -0.004 / -0.024 | 3620×5418 | 12.8 / 26.5 | Validated |
| Nikon-Coolpix-P1000.NRW | Nikon COOLPIX P1000 | NRW | Bayer RGGB, 12-bit | 4624×3470 | 0.3 / 1.5 | 9.5 | 307 | -0.124 / 0.044 | 4160×3122 | 8.3 / 15.6 | Validated |
| Nikon-Z6.NEF | Nikon Z 6 | NEF | Bayer RGGB, 14-bit | 6064×4040 | 0.8 / 2.9 | 16.4 | 401 | 0.027 / -0.096 | 5456×3636 | 14.5 / 26.1 | Validated |
| OM-System-OM-1.ORF | OM Digital OM-1 | ORF | Bayer RGGB, 12-bit | 5220×3912 | 1.0 / 2.3 | 13.0 | 334 | -0.017 / 0.017 | 4698×3520 | 12.8 / 22.8 | Validated |
| Panasonic-G9.RW2 | Panasonic DC-G9 | RW2 | Bayer RGGB, 12-bit | 5208×3904 | 0.6 / 2.1 | 12.6 | 336 | 0.079 / -0.021 | 4686×3512 | 12.0 / 22.5 | Validated |
| Ricoh-GR-III.DNG | Ricoh GR III | DNG 1.2 | Bayer RGGB, 14-bit | 6020×4024 | 0.8 / 2.6 | 15.1 | 405 | 0.02 / -0.001 | 5418×3620 | 13.0 / 27.1 | Validated |
| Sony-DSC-R1.SR2 | Sony DSC-R1 | SR2 | Bayer GRBG, 14-bit | 3925×2608 | 0.1 / 0.9 | 5.8 | 256 | -0.015 / 0.068 | 3530×2346 | 5.8 / 10.5 | Validated |
| sample-nrw-files-sample1.nrw | Nikon COOLPIX P7100 | NRW | Bayer RGGB, 12-bit | 3664×2744 | 0.2 / 0.9 | 6.1 | 256 | 0.042 / -0.034 | 3296×2468 | 6.0 / 10.7 | Validated |
| sample-orf-files-sample1.orf | Olympus E-300 | ORF | Bayer RGGB, 12-bit | 3340×2504 | 0.2 / 0.8 | 4.9 | 256 | 0 / -0.012 | 3006×2252 | 5.4 / 9.1 | Validated |
| sample-pef-files-sample1.pef | Pentax K-5 | PEF | Bayer BGGR, 14-bit | 4950×3284 | 0.5 / 1.6 | 9.9 | 307 | -0.029 / 0.013 | 4454×2954 | 9.2 / 17.5 | Validated |
| sample-rw2-files-sample1.rw2 | Panasonic DMC-FZ70 | RW2 | Bayer RGGB, 12-bit | 4624×3088 | 0.3 / 1.4 | 9.0 | 256 | 0.05 / -0.029 | 4160×2778 | 7.9 / 15.6 | Validated |
| sample1.cr2 | Canon EOS 5DS | CR2 | Bayer RGGB, 14-bit | 8736×5856 | 1.9 / 6.0 | 31.9 | 850 | 0.002 / 0.008 | 7862×5270 | 26.4 / 61.0 | Validated |

Export (browser) is the full-resolution JPEG after the 90 % crop and 2° straighten; heap is the
LibRaw wasm heap after a full decode (Node; the browser worker is ended after each job). Timings
from one Windows desktop run (Node 24, Chromium 141, Firefox 142, CPU preview off: WebGL2).

## Findings

- **Colour.** As-shot white balance matches the camera JPEG on neutral tones for every
  validated file (worst: COOLPIX P1000 red −0.12 log, a sunset with few neutral pixels). Colour
  charts (5D Mark IV, X-T4) render with correct hues.
- **Brightness.** Neutral development is scene-linear, with no camera tone curve or baseline
  exposure, so it is darker than in-camera JPEGs: about +1.5 to +2 EV is needed to match the
  5D Mark IV, 5DS, EOS R, Nikon Z 6, OM-1, G9 and DJI (Mavic 3) files, +0.5 to +1 EV for most others.
  Colours and white balance are unaffected; Exposure corrects it. Same nature as the D3100
  NEF gap (0.4–0.9 EV) recorded in Interval 17.
- **X-Trans** (X-T4, X100V) uses LibRaw's 3-pass Markesteijn demosaic: full decodes take 16–24 s
  in Node (versus 1–6 s for Bayer files of similar size). Half-size previews are fast.
- **Odd sensor width.** The DSC-R1 develops 3925 px wide but half-size import reports 3924;
  full decodes are cropped to 3924 (one column, never resampled).
- **Apple ProRAW** (iPhone 12 Pro) is a linear (already demosaiced) DNG: half and full decodes
  are the same 12 MP image. Its local tone map is not applied.
- **EOS D60 (CRW)** records two different green multipliers (758 and 756); a re-applied white
  balance has one green, so greens differ by up to 0.26 % from LibRaw's own decode.
- **HDR.** No sample set holds a bracket, so RAW HDR merging stays limited to ARW, NEF and DNG
  (validated with genuine brackets earlier); other RAW formats are refused in the merge dialog.
- **Embedded previews** are never used; several are small (F828 640×480, R1 640×424, DJI 960×720).

## Unsupported

| File | Camera | Reason |
| --- | --- | --- |
| Sony-DSC-F828.SRF | Sony DSC-F828 | Four-colour RGB + emerald sensor; LibRaw outputs four channels and the file has no as-shot white balance. Refused by content (model) before decoding. |
| _DSC5331.NEF | Nikon Z 9 | High Efficiency\* NEF (`NEFCompression` 14, TicoRAW): not in open-source LibRaw. Identified, then refused by the decoder with that reason. |
| _TJP6418.NEF, _AUS9380.NEF | Nikon Z 8 | Same (HE\*). |

Recognised without a genuine sample and refused by name: Samsung SRW, Sigma X3F, Minolta MRW,
Hasselblad 3FR, Phase One IIQ, Leica RWL, Kodak DCR.

## Browsers

All on Windows 11, Playwright builds, one run each (24 files: 20 validated, 4 refused).

| Environment | Import (all files) | Validated photos exported | Mixed ZIP (DNG, CR2, CRW, CR3, RAF, NRW) | Reopen |
| --- | --- | --- | --- | --- |
| Chromium 141 | 29 s | 20/20 | 87 s, names and sizes correct | 20/20 |
| Firefox 142 | 79 s | 20/20 | 224 s | 20/20 |
| WebKit 26 (`RAW_WEBKIT_GENUINE=1`) | 28 s | 20/20 (4–41 s each) | 96 s | 20/20 |
| WebKit, iPhone 13 emulation | 8 s (files under 25 MB) | import and preview only | – | – |

Every run: unsupported files fail with their reason while the rest import; the cancelled ZIP
leaves its photos "Cancelled" and the retry saves all six; preview and export agree within
1–5 levels (mean, 8-bit); the watermark changes only its corner. The Playwright WebKit LibRaw
crash on Windows (docs/photography-editor.md, Known issues) did not occur in this run; it is
intermittent, so this is not evidence that it is fixed. Firefox exports X-Trans RAF about 2.6×
slower than Chromium.

## Not verified

Physical iPhone or Android devices; Safari on macOS or iOS; Canon sRAW/mRAW, Fujifilm
compressed RAF from other bodies, Pentax K-1/K-3 III, Nikon HE NEFs (unsupported), Olympus
High Res Shot ORF, Panasonic high-resolution RW2, RAW HDR brackets from the new formats.
