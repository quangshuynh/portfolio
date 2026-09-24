# Hero desk prototype — implementation and measurements

> Historical first-interval report. The [hero refinement report](hero-refinement.md) supersedes the layout, monitor mount, car position, speakers, camera profiles and current measurements below.

Implemented locally only. No commit, push, PR or deployment. Recommend **keeping this bounded prototype**, subject to a physical iPhone/Safari check before release. The measured scene cost is comfortably below the requested 1–2 MB compressed budget.

## Existing architecture and scope

The Vite / React 19 homepage imports `Header` synchronously. Its hero is a two-column grid: large copy and CTAs, then a narrow portrait linking to About. A separate Meet Quang card appears on mobile; the portrait hides there. About and Photography already load lazily. The baseline had six test files / 78 tests and no lint or format script.

`header.jsx` changes by only an import and `<HeroVisual />`. The desk occupies a bounded additional grid row after the existing introduction. Copy, CTA ordering, portrait, Meet Quang links, navigation, projects, photographs, viewer and global animation rules are unchanged. The intentional layout tradeoff is a taller hero, with the scene after the CTAs rather than narrowing the existing copy. The baseline already placed some CTAs below the first screen at the sampled viewport sizes; desktop and phone CTA positions are preserved.

## Architecture and dependency decision

```text
Header (existing content and portrait)
  HeroVisual (React lifecycle, preferences, viewport eligibility)
    StaticHeroScene (responsive picture, immediately available)
    lazy import -> interactiveHeroScene.mountDeskScene
      createDeskScene (procedural desk, monitors, keyboard/mouse,
                       opaque PC, camera, blue coupe)
      frameDesk (desktop / elevated mobile composition)
```

Only `three@0.186.0` was added (MIT). Investigated React Three Fiber 9.8.0, including React 19 compatibility and demand rendering, and Drei 10.7.8's dependencies. This scene needs no React reconciler, controls, loaders, text helpers or post-processing, so neither wrapper was adopted. Their package/dependency metadata informed the decision; no claim is made about a measured hypothetical R3F/Drei production chunk. The actual chosen dependency's emitted chunk was measured below. No animation library was added.

The implementation follows [Three's on-demand rendering approach](https://threejs.org/manual/pages/rendering-on-demand.html); [R3F's performance guidance](https://r3f.docs.pmnd.rs/advanced/scaling-performance) was also reviewed. Three state stays entirely behind one dynamic import. The import starts only after the scene intersects the viewport, a 900 ms delay and an idle opportunity. Text and controls never await it. About/Photography routes do not import it.

## Reference and objects

The attachment contained instructions, not a separate image. The existing `src/assets/about/cars-tech/room-setup-2025.jpg` was inspected as the desk reference. Its dark environment, wood surface, left landscape monitor, tall right monitor, pale keyboard, dark pad and right-hand PC determined the composition. Personal foreground additions are a small blue 22B-inspired coupe with gold wheels, scoop and wing, and a recognizable camera with a stepped lens.

Both displays preserve the approximate equal-diagonal 16:9 / 9:16 relationship. Content is original static terminal/code imagery, not the actual desktop. The keyboard uses one texture with pale caps and colored angled legend marks. The mouse has a rounded lightweight silhouette; the PC uses an opaque illustrated panel with restrained fan-ring/RGB accents. These are stylized proportions, not exact Samsung/Dell/Logitech/Subaru CAD or branded models. No third-party models, photographs or texture assets were downloaded for the scene. All meshes, textures and fallback renders are original; the reference photo is not shipped in the hero.

## Interaction, accessibility and fallback

Desktop fine-pointer movement changes the camera by roughly two degrees at most, coalesced to one requested frame; leaving resets it. No perpetual motion, entrance sequence, orbit controls or hover-only information. On touch and narrow scenes, the composition is static, elevated, and framed independently. Passive events and `touch-action: pan-y pinch-zoom` preserve vertical scrolling and zoom.

The whole drawing is decorative and `aria-hidden`; a short visible interests caption sits outside it. There are no inaccessible canvas hit targets or new object links. Existing semantic headings, links, focus styles and keyboard order remain intact.

Reduced motion, Save-Data, reported 2G/3G, at most 2 GB reported memory, or at most two logical cores keep the static image without fetching Three. Missing observer support does the same. Unknown device capability does not automatically exclude a device. Preference/connection changes are observed. Import failure, WebGL initialization failure, render failure and context loss retain/restore the fallback, with no retry loop. Context loss intentionally stays static until a new mount/reload. Fixed aspect ratios reserve space throughout loading/failure.

## Rendering budget and asset optimization

- One canvas, 13 draw calls, 1,530 triangles, merged static material batches.
- Two lights: hemisphere and directional. No shadow maps, reflections, transparency passes, video or post-processing. Contact patches and panel details are baked/faked.
- Five small canvas-generated textures; largest dimension 384 px. No network GLB/model/texture payload.
- DPR capped at 1.5 desktop and 1.25 mobile. Verified mobile cap at emulated DPR 3.
- No animation loop: request frames only for first render, actual pointer updates, resize and visibility return. Zero additional frames observed during idle and offscreen samples. Document visibility handler also checked. GPU utilization/battery draw were not measured at OS level.
- Observers, events, pending frames, geometries, materials, textures and context are disposed on unmount/preferences/failure.
- Fallbacks are transparent WebP, quality 85: desktop 1000×440 / **15,704 bytes**, mobile 500×375 / **10,026 bytes**. Only the appropriate picture source transfers. No large source PNG is checked in.

## Before / after production measurements

Baseline build/test/browser capture happened before source changes. An untouched baseline build was retained locally for paired checks. Sizes below are actual emitted files, measured consistently with Node `gzipSync` (decimal kB):

| File group     |   Before raw / gzip |     After raw / gzip |
| -------------- | ------------------: | -------------------: |
| Entry JS       | 268.314 / 83.467 kB |  270.714 / 84.296 kB |
| CSS            |  62.432 / 12.816 kB |   63.481 / 13.049 kB |
| Lazy desk JS   |                   — | 568.882 / 142.668 kB |
| About JS       |   23.284 / 8.086 kB |    23.284 / 8.085 kB |
| Photography JS |   12.690 / 4.334 kB |    12.690 / 4.334 kB |

Entry growth: **829 bytes gzip**, plus **233 bytes gzip CSS**, plus the selected 10–16 kB fallback. Enhancement adds approximately **143 kB gzip**, or 117.133 kB Brotli. No separate model/texture transfers. Total added gzip transfer with a desktop fallback is about **159.4 kB**, including entry/CSS growth.

Vite's displayed gzip estimates differ slightly from Node's compression: entry 84.55 → 85.41 kB, lazy scene 144.40 kB. The uniform Node measurements above match local preview's resource timing encoded sizes. Vite warns that the raw lazy chunk exceeds 500 kB; this warning is retained, not suppressed. The engine is absent from the entry and is fetched separately only when eligible/in view. Browser failure/reduced-motion/constrained-device tests confirm this behavior.

Three paired local preview runs per viewport, HTTP cache disabled, same installed Chromium browser, no network/CPU throttling:

| Viewport             | Baseline median LCP | After median LCP | Initial CLS before / after |
| -------------------- | ------------------: | ---------------: | -------------------------: |
| Desktop 1440×1000    |               88 ms |            84 ms |                      0 / 0 |
| Laptop 1366×768      |               76 ms |            72 ms |                      0 / 0 |
| iPhone-sized 390×844 |               88 ms |            84 ms |                      0 / 0 |
| Small mobile 320×740 |               84 ms |            80 ms |                      0 / 0 |

These tiny differences are noise, not a claimed improvement. The first unpaired cold baseline desktop capture had 1,328 ms LCP; comparing it against warmed later runs would be misleading. Paired measurements show no detectable local LCP regression. They do not establish real cellular/Safari performance.

After a fixed 600 px scroll, desktop/laptop CLS was 0.00919 / 0.01227 in **both** builds; attribution identified the existing brand/navigation collapse. Phones remained zero. No additional shift was attributed to the desk. Raw paired samples and bundle sizes are in `hero-scene-measurements.json`.

## Validation and reproduction

- Full suite: **7 files, 90 tests pass**, versus baseline 6 / 78. Twelve focused tests cover immediate content/CTAs, responsive static picture, viewport lazy loading, reduced motion, data saving/slow network, rejected import, failed WebGL, post-render failure, viewport return, dynamic preferences, late import cleanup and missing observers.
- Production build passes. Existing test-suite warning about jsdom `window.scrollTo` remains.
- Browser assertions pass in actual headless Brave/Chromium at all four sizes: loading, resize/orientation, no horizontal overflow, desktop pointer response, mobile no-rotation/touch scroll, idle/offscreen inactivity, return, light mode, DPR cap, reduced motion, constrained capability, blocked import, WebGL failure, actual context loss, keyboard focus, work anchor and About navigation. Screenshots were inspected.
- No configured lint/format checker. New files checked with temporary Prettier 3.6.2; no formatter dependency added. `git diff --check` passes.

To reproduce (Node 22+ for native WebSocket), start a dedicated browser profile with remote debugging bound to localhost, for example on this Mac:

```sh
"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" --headless=new --remote-debugging-port=9223 --user-data-dir=/tmp/portfolio-hero-browser --no-first-run about:blank
```

In another terminal, `npm run build` then `npm run preview -- --host 127.0.0.1`. Run `npm run test:hero:browser`. Outputs (screenshots/JSON) go to `/tmp/portfolio-hero-check`; set `HERO_CHECK_OUTPUT`, `HERO_BROWSER_URL` or `HERO_PREVIEW_URL` to override. `npm run measure:hero` reports emitted chunks; `node scripts/measure-hero-bundles.mjs /path/to/baseline dist` compares builds.

To regenerate fallbacks after editing geometry/cameras: run `npm run dev -- --host 127.0.0.1`, use the same dedicated browser, then `npm run prepare:hero`. It renders each camera directly, captures only the canvas, and uses the existing Sharp dependency to encode optimized WebP files. It needs working WebGL and is deliberately separate from normal builds. Set `HERO_DEV_URL` if needed; use the root development base path. Inspect both outputs and run the browser checks before replacing them. No AI image service or external source image is required.

## Limitations / recommendation

Keep the prototype: the measured transfer, geometry and idle rendering costs are modest, and progressive enhancement leaves the site functional when it fails. The hero is deliberately taller. Materials and silhouettes are illustrative; keyboard legends are subtle at phone size. There are no object-specific hover labels or links, which were optional. No physical iPhone, Safari/WebKit, thermal/battery, cellular-network or broad GPU-matrix testing was available; these remain release checks, not claimed passes. Simplify to the existing optimized static version if those device checks reveal a regression.
