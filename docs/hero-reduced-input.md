# Confirmed desktop drag failure: reduced-motion eligibility

The user's physical-drag trace confirms the cause of the desktop failure. The scene was intentionally never mounted under reduced motion. This pass fixes that eligibility policy while preserving reduced-motion treatment of automatic animation. Scrolling, the music panel, geometry and layout are unchanged. No commit, push, PR or deployment.

## Evidence and first failing stage

The user's Windows Chrome 153 export reports `reducedMotion:true`, `fine:true`, `coarse:false`, `hover:true`, and `maxTouchPoints:0`. It records **one pointerdown, 514 pointermoves and one pointerup**, but `webgl:false`, `ready:false`, `state:null`, and the blocker `loader: reduced-motion disables WebGL and all orbit input`. Retained mouse movement has `buttons:1`, `button:-1`, and no prevented default. The latest viewport is **742×1277**; the interaction rectangle is **x=44.5, y=748.25, width=638, height=318**.

The failure occurs **before pointer handler registration / pending gesture creation**, at the loader's reduced-motion exclusion. The fallback can look like the interactive scene, but no renderer, orbit state or pointer handlers existed. The renderer also independently rejected reduced motion; removing only the loader check would not have fixed input.

The retained physical movement targets `.hero-desk__stage`; release outside targets `.hero-inner.reveal-content`. The original pointerdown event details were evicted from the bounded recorder by the long 514-move sequence, so its precise target is not asserted from the count alone. The preceding browser audit measured the same fallback stack at all six positions. Under WebGL, hit testing reaches the canvas and bubbles to `.hero-desk__canvas`; canvas and handler-host rectangles match. There is no evidence of an undersized surface, overlay interception, touch-only input path or incorrect mouse button guard. See [the retained surface audit](hero-input-diagnosis/surface-audit.json).

Earlier CDP tests forced `prefers-reduced-motion:no-preference`, bypassing the exact policy causing the physical failure. Their successful drag simulation was insufficient evidence for the user's default configuration.

## Minimal behavior change

- `HeroVisual` no longer excludes reduced-motion users from lazy scene loading. Existing Save-Data, slow-network, low-capability, unsupported-browser and WebGL/import-failure fallbacks remain.
- The renderer permits intentional pointer and keyboard interaction under reduced motion. The existing shared pending / horizontal-orbit / page-pan gesture logic, mouse button checks, pointer capture, release cleanup and ±90° bounds are unchanged.
- Reduced motion disables automatic scroll contribution and pointer parallax, including frame requests from those inputs. Manual updates render directly without easing or residual post-release animation. Responsive camera changes likewise do not ease. Normal-motion damping, scroll-linked turning and parallax remain as before.
- Switching the preference preserves the displayed view and removes automatic offsets. The existing renderer/listeners remain mounted. Offscreen and hidden-document suspension remain active.
- The temporary HUD, global diagnostic object, diagnostic module, renderer hooks and diagnosis driver have been removed.

The deliberate consequence is that reduced-motion users now receive the lazy scene payload when otherwise eligible. They retain native wheel/trackpad scrolling and touch vertical panning; the preference suppresses automatic animation rather than disabling a user control.

## Targeted regression and validation

`scripts/check-hero-reduced-input.mjs` explicitly removes the older helper's media override and records the host's native preference. On this host it is already `reduce`; **no `no-preference` override is used for these assertions**. It tests development and production preview at 1440×900 and the user's 742×1277 viewport.

The reduced-motion regression **passes** at center, left monitor, right monitor, keyboard, PC and empty background. At every point it verifies canvas hit testing, primary-button horizontal drag, capture, displayed angle changes and clean release. Both ±90° limits, keyboard input, native wheel scrolling, return from offscreen, no hover/scroll-driven changes, no easing tail, zero idle/offscreen frames and removal of diagnostic UI are asserted. [Raw measurements](hero-reduced-input/metrics.json).

The full unit suite passes **112 tests in 10 files**. Regressions now cover reduced-motion scene loading and retained interaction on preference change, mounted manual drag with no automatic frame requests, and the motion model's automatic-offset suppression and direct manual response. The production build passes. Existing jsdom `scrollTo` and Vite raw-chunk warnings remain.

The existing **nine-viewport hero browser suite, focused mobile input regression, desktop orbit/lifecycle regression and Photography regression all pass**. The hero suite records zero initial CLS, zero extra idle/offscreen frames and no horizontal overflow at all nine sizes. Mobile horizontal drag and vertical/diagonal native pan continue working. Normal-motion desktop damping/parallax/scroll response and both bounds still pass, as does switching to reduced motion at runtime without removing the interaction host. Scoped Prettier checks and `git diff --check` pass. Evidence: [hero suite](hero-reduced-input/browser/metrics.json), [mobile input](hero-reduced-input/mobile/input-after.json), [orbit](hero-reduced-input/orbit/metrics.json).

Physical before-state evidence comes from the user. After-state mouse tests are browser-generated CDP input, not a claim that the agent physically operated the user's PC. The user has been asked to reload the normal development site and confirm the correction with their mouse. Physical Safari/trackpad validation remains outside this environment.

## Performance

| Metric | Before this fix | After |
| --- | ---: | ---: |
| Draw calls | 15 | 15 |
| Triangles | 2,902 | 2,902 |
| Lazy scene raw | 576,914 B | 577,126 B |
| Lazy scene gzip, Node 24 | 146,213 B | 146,289 B |
| Extra idle frames | 0 | 0 |
| Extra offscreen frames | 0 | 0 |

Gzip growth is **76 bytes**. No new dependency, texture, material, geometry, loop or polling was introduced. The Spotify-style monitor texture and four fallback assets were not changed in this pass.
