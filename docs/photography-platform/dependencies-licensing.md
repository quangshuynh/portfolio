# Dependency and licensing risk assessment

Interval 0, 2026-10-22. The site itself gains **no** dependencies in
Interval 0: `libraw-wasm` is installed only in
`experiments/raw-decode-poc/`. The portfolio repository is public with no
licence file (all rights reserved), and that shapes what can be bundled.

## Proposed runtime dependencies

| Component | Version | Licence | Ships to | Size | Risk | Mitigation |
| --- | --- | --- | --- | --- | --- | --- |
| libraw-wasm (wrapper, worker, glue) | 1.6.0, published 2026-07-02 | ISC in `package.json`; **no LICENSE file** in the repository ([#31](https://github.com/ybouane/LibRaw-Wasm/issues/31)) | Editor chunk only | 1.42 MB wasm + 69 KB worker JS (2.07 MB unpacked) | One maintainer, 57 stars, 6 open issues. Two known bugs (`gamm` [#8](https://github.com/ybouane/LibRaw-Wasm/issues/8), pixel shifts between builds [#12](https://github.com/ybouane/LibRaw-Wasm/issues/12)). A pending PR changes pixels and adds an optional COOP/COEP build. | Pin the exact version with a lockfile integrity hash. Wrap it in our own adapter, gate upgrades on fixture checksums, and keep the option of an Emscripten build from LibRaw source. Ask upstream to add the LICENSE file, or record the ISC grant from `package.json` in our notices. |
| LibRaw (inside the wasm) | 0.22.1 | LGPL-2.1 **or** CDDL-1.0, at the distributor's choice | same | included above | Copyleft notice and source obligations | Choose CDDL-1.0 or LGPL-2.1 and publish third-party notices with the editor. Link the exact LibRaw tag and the build script. Serve the wasm as a separate, replaceable file, never inlined. Making no changes to LibRaw keeps the source obligations to a link. |
| Little CMS (inside the wasm) | 2.19.1 | MIT | same | included | Low | Copyright notice in the third-party notices |
| IJG libjpeg (inside the wasm) | 9f (14-Jan-2024, from the binary) | IJG licence | same | included | Binary distributions must say they are "based in part on the work of the Independent JPEG Group" | Include that sentence in the notices |

## Proposed development and infrastructure dependencies (not added)

| Component | Licence | Purpose | Notes |
| --- | --- | --- | --- |
| `@cloudflare/vitest-pool-workers`, `wrangler` | MIT / MIT-or-Apache-2.0 | CMS Worker tests and deploys | Already used by `spotify-portfolio-api/` |
| Playwright | Apache-2.0 | Firefox and WebKit editor tests | Optional; needs owner approval because it is a new dev dependency |
| Cloudflare Access, Workers, R2 | Service terms | Owner auth, admin API, private storage | Single-owner usage should fit the free allowances (R2: 10 GB-month, as noted in the archive's design); monitor storage of originals. R2 is S3-compatible, which limits lock-in. |
| GitHub App or fine-grained token | Service terms | Opening publish PRs | Scope it to this repository (`contents`, `pull_requests`). Store it only as a Worker secret, never in the browser or a URL. |

## Rejected for licensing or maintenance

| Component | Reason |
| --- | --- |
| dcraw.js (`dcraw` 1.0.3) | GPL-2.0: bundling it would oblige GPL licensing of the site. Also failed the decode test, and has no colour tables for these bodies. |
| Own Rust decoder (rawler/rawloader) | LGPL-2.1 is acceptable, but it means building and maintaining our own wasm bindings and colour pipeline |
| OpenCV.js for alignment | Apache-2.0 is acceptable, but it is about 8 MB for features we can implement with MTB alignment in a few hundred lines |

## Content licensing

- The owner's Q-COLOR Volume 01 `.cube` LUTs are owner content, possibly
  commercial. They are not committed and not shipped unless the owner
  decides to.
- The RAW fixtures are private photographs; they are not committed.
- LibRaw's camera colour matrices derive from Adobe DNG Converter data, as
  in every LibRaw distribution. No extra obligation was found beyond
  LibRaw's own licence.

## Deliverable when the editor ships

Add a `THIRD_PARTY_NOTICES` file, and a short credits panel in the editor,
covering libraw-wasm (ISC), LibRaw (with the chosen licence and a source
link), Little CMS (MIT) and the IJG notice.
