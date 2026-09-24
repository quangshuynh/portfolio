# Hero navigation and bounded orbit refinement

Local implementation only; no commit, push, PR or deployment. This extends the existing scene, lazy loader, responsive profiles and static fallbacks. Earlier measurements remain in [hero-refinement.md](hero-refinement.md) and [hero-scene.md](hero-scene.md).

## Navigation and composition

The remaining structural overlap came from the collapsible navigation's negative bottom margin: its visible expanded height was up to 108 px, but it reserved only the 72 px collapsed height. JavaScript also independently calculated that expanded height from `innerHeight`, while CSS used `svh`. Earlier viewport tests could pass because hero padding happened to absorb the discrepancy; they did not establish a safe layout relationship.

A homepage-only sticky `.home-nav-slot` now reserves the expanded height in normal flow. Both the slot and expanded bar use `--home-nav-footprint`; the collapse code measures the slot rather than estimating its height again. A ResizeObserver updates those metrics when layout changes. The bar can shrink inside this stable slot without moving the hero's document position. At 1440×900, the browser measured a 90 px slot while the visible bar transitioned 90 → 84.27 → 72 px; the hero's document top remained 90 px. The hero's viewport budget subtracts the same footprint. Phone navigation remains in normal flow, and other routes do not receive the wrapper. The hero also adds only the expanded-minus-collapsed difference to its snap/anchor margin. Without that correction, the existing 72 px document scroll padding could automatically scroll the initial page by up to 36 px and begin collapsing the navigation. No large compensating top margin was added.

Both scene captions and their spacing are removed. Desktop, laptop and tablet retain the compact existing composition. At 1440×650, navigation ends at 72 px, introduction starts at 105.53 px, and the scene ends at 616.47 px. All seven requested desktop/tablet sizes fit the complete hero; phones retain normal scrolling. Extra 1280×600, 1152×650 and 1152×520 probes retain separation below navigation. The most constrained 520 px height needs some scrolling to see the scene's bottom.

The attachment available here contained text, not the referenced Mac screenshot. The negative-margin issue is verified in the code; exact reproduction on that physical Mac is not claimed. The 1440×650 viewport approximates reduced browser-chrome space. The 1152×520/DPR 1.25 probe approximates a 1440×650 window at 125% zoom; it is not an actual browser menu zoom test.

## Camera and input

`deskMotion.js` owns the current angle, target, selected manual offset, scroll offset, parallax and gesture intent. The responsive camera supplies the base azimuth/elevation. The final horizontal offset is clamped to **−90° through +90°**, including every input source, so repeated drags cannot accumulate spins. Elevation remains at the responsive profile's bounded value. Framing widens smoothly by up to 25% toward either side to keep the long desk and monitors in view, without changing the front fallback framing.

Normalized hero scroll progress contributes at most 0.06 radians (3.44°); fine-pointer parallax contributes at most 0.018 radians (1.03°). Scroll only updates while the mounted scene is active, visible, onscreen and motion-eligible. Active horizontal drag wins over both automatic inputs. Release stores the chosen target relative to the current scroll offset, preserving the selected angle. New drags start from the currently visible angle. Camera angles use 65 ms exponential damping; responsive base changes use 85 ms damping. Frames stop once convergence reaches the small tolerance. There is no permanent animation loop or inertia simulation.

Pointer Events handle mouse and touch. Touch needs 10 px displacement and horizontal movement exceeding vertical movement by 1.4×; mouse uses a 4 px threshold. Vertical intent locks out rotation for that gesture. Pointer capture starts only after horizontal intent. Native `pan-y pinch-zoom` remains enabled. Touch's initial implicit capture belongs to the child canvas; transferring it to the host must not end the gesture when the child's lost-capture event bubbles. The browser test caught and now covers that case. Cancellation, release, lost host capture, offscreen suspension and disposal all clear drag state. A drag-generated click is suppressed.

The ready interaction host is a labelled angle slider with arrow-key 10° steps, Home/End limits and Escape reset. Its canvas remains decorative. Static/failure states have no new focus stop. Existing links and CTAs retain their order and behavior. No new visible captions or controls were added.

## Physical scene changes

Both identical speaker bodies now use a 0.28-unit height instead of 0.46, with unchanged top/bottom radii 0.23/0.30. Their body centers move from y=0.437 to 0.347 and caps from y=0.675 to 0.495. The tapered black bodies, silver bases and restrained blue rings remain. Left x/z moves from −2.05/−0.45 to **−2.15/−1.10**; right from 1.65/−0.05 to **1.78/−0.70**. Both are at least partly visible from the front; the right speaker is naturally partially occluded by the tower.

Four dark static cable runs connect keyboard→PC, Powerplay→PC, left→right speaker and right speaker→PC. Each uses a 12-segment curve with four radial tube segments and radius 0.014, merged into the existing dark material. Vertex heights are kept at/above the tabletop, with short rises to connectors. Routing follows the rear desk area without crossing the keyboard or mouse. No cable physics or animation.

The monitors gain three inexpensive rear vent strips apiece. The closed PC gains a rear panel, three slots and a simple rear vent. Existing monitor arms, mount, camera, coupe, peripherals and desk already have solid side/rear silhouettes. Front and both limits were inspected across all nine viewports: natural occlusion remains, with no need for a smaller orbit limit, new lights, textures or high-detail models.

## Measured cost

Uniform Node `gzipSync`, decimal kB; actual emitted production files:

| Metric            | Previous refinement | This refinement |
| ----------------- | ------------------: | --------------: |
| Draw calls        |                  15 |              15 |
| Triangles         |               2,334 |           2,902 |
| Lazy scene raw    |           569,965 B |       575,713 B |
| Lazy scene gzip   |           143,102 B |       145,063 B |
| Lazy scene Brotli |           117,660 B |       119,362 B |
| Entry gzip        |            84,325 B |        84,408 B |
| CSS gzip          |            13,334 B |        13,470 B |
| Desktop fallback  |            16,308 B |        16,846 B |
| Compact fallback  |            17,296 B |        17,850 B |
| Tablet fallback   |            17,354 B |        17,778 B |
| Mobile fallback   |            10,478 B |        10,834 B |

The lazy gzip increase is **1,961 bytes (1.37%)**. All four WebPs were regenerated from the physical scene using the existing renderer/Sharp workflow. There are still 15 material batches, two lights, six small procedural textures, one canvas and no external model/texture transfers. No dependency was added. DPR limits remain 1.5 desktop and 1.25 mobile. The existing Vite warning for the lazy chunk exceeding 500 kB raw remains visible.

See [bundle measurements](hero-orbit/bundle-measurements.json), [layout measurements](hero-orbit/layout-measurements.json) and [orbit measurements](hero-orbit/orbit-measurements.json).

## Validation and reproduction

The full unit suite passes: **8 files / 98 tests**, up from 91 tests. Seven new motion tests cover deterministic scroll mapping, damping termination, touch thresholds/vertical lock, pointer identity, repeated range clamps, drag priority/release persistence and starting from the visible angle. Existing progressive-enhancement tests remain intact.

The initial native-WebGL browser runs passed the orbit and existing lifecycle suites. Repeated later captures encountered headless Chromium Mac display-driver/disconnected-target failures; the final rerun uses a fresh isolated Brave/Chromium profile with ANGLE SwiftShader software WebGL. The software run used `--use-angle=swiftshader --enable-unsafe-swiftshader` on the isolated browser and `HERO_BROWSER_URL=http://localhost:9224` for the hero scripts (`CDP_URL` for Photography). These checks establish behavior and emitted geometry/transfer cost, not hardware rendering performance. The nine-size final layout capture also passed in the native profile.

The new browser driver checks actual mouse and touch drags, both limits, repeated clamping, no accidental click/navigation, keyboard control, vertical scrolling, resize persistence, return to hero, reduced motion, sticky navigation geometry and offscreen suspension. Across all nine viewports, **zero additional frames** occur in the 250 ms sample after 1.1 seconds of convergence. Offscreen scrolling changes neither frame count nor camera target in the 600 ms sample. These are browser frame-counter measurements, not OS GPU, battery or thermal measurements.

With the existing dedicated Brave/Chromium debugger on localhost:9223 and production preview on localhost:4173:

```sh
npm test
npm run build
npm run preview -- --host 127.0.0.1
# In another terminal, run browser scripts sequentially:
HERO_ASSERT_FIT=1 node scripts/capture-hero-layouts.mjs
node scripts/check-hero-orbit.mjs
npm run test:hero:browser
CDP_URL=http://127.0.0.1:9223 PORTFOLIO_URL=http://127.0.0.1:4173 node scripts/check-photography-scroll.mjs
npm run measure:hero
```

`HERO_CHECK_OUTPUT` changes each hero driver's output directory; `HERO_VIEWPORT` optionally selects one named viewport for the orbit driver (its shared navigation/lifecycle probes still run). Browser drivers must run sequentially because switching active tabs deliberately suspends hidden scenes. The fallback-generation instructions in the earlier report still apply.

The final normal local run records **zero initial CLS at all nine viewports**. The retained baseline's previously reported zero initial CLS is not universal. With HTTP cache disabled and a controlled 100 ms latency / 250,000 B/s transfer rate at 1440×650, two paired runs show **0.000423818 before / 0.000419640 after**. All shifts attribute to the headline and brand text immediately after the existing Circular font loads (`font-display: swap`); none attribute to the scene. See [paired cold-font measurements](hero-orbit/cls-paired.json). The initial source check permits those verified baseline text nodes and fails for new shift sources. This pass preserves the existing typography; no real-network LCP or universal zero-CLS claim is made.

No configured lint/format script exists. Scoped hero/script files are checked with temporary Prettier 3.6.2; surrounding App.css and navigation formatting is preserved. `git diff --check` passes. Existing jsdom `window.scrollTo` and Vite chunk warnings are unrelated and remain visible.

Production build, all nine viewport layout assertions, the complete orbit driver, the existing hero browser regression suite and the Photography scroll/history regression script **pass**. The hero suite covers lazy resources, resize/orientation, fine-pointer response, idle/offscreen suspension, touch scroll, light mode, DPR 3 capping, reduced motion, Save-Data/low-core capability, blocked import, WebGL initialization failure, actual context loss, focus, work anchors and About navigation. Photography checks normal/direct-photo entry, stable image layout, previous/next, focus/scroll restoration, history, About modal return and home snapping. Raw final browser measurements are [saved here](hero-orbit/browser-measurements.json).

## Screenshots

Phone front/left/right captures scroll the interactive scene into view. Initial captures show the unscrolled layout. Keyboard-driven angle captures include the intentional focus outline.

| Viewport  | Initial                                             | Front                                           | −90°                                          | +90°                                            |
| --------- | --------------------------------------------------- | ----------------------------------------------- | --------------------------------------------- | ----------------------------------------------- |
| 1920×1080 | [Initial](hero-orbit/desktop-large-initial.webp)    | [Front](hero-orbit/desktop-large-front.webp)    | [Left](hero-orbit/desktop-large-left.webp)    | [Right](hero-orbit/desktop-large-right.webp)    |
| 1440×900  | [Initial](hero-orbit/desktop-initial.webp)          | [Front](hero-orbit/desktop-front.webp)          | [Left](hero-orbit/desktop-left.webp)          | [Right](hero-orbit/desktop-right.webp)          |
| 1366×768  | [Initial](hero-orbit/laptop-initial.webp)           | [Front](hero-orbit/laptop-front.webp)           | [Left](hero-orbit/laptop-left.webp)           | [Right](hero-orbit/laptop-right.webp)           |
| 1440×650  | [Initial](hero-orbit/mac-short-initial.webp)        | [Front](hero-orbit/mac-short-front.webp)        | [Left](hero-orbit/mac-short-left.webp)        | [Right](hero-orbit/mac-short-right.webp)        |
| 1280×800  | [Initial](hero-orbit/laptop-tall-initial.webp)      | [Front](hero-orbit/laptop-tall-front.webp)      | [Left](hero-orbit/laptop-tall-left.webp)      | [Right](hero-orbit/laptop-tall-right.webp)      |
| 1024×768  | [Initial](hero-orbit/tablet-landscape-initial.webp) | [Front](hero-orbit/tablet-landscape-front.webp) | [Left](hero-orbit/tablet-landscape-left.webp) | [Right](hero-orbit/tablet-landscape-right.webp) |
| 768×1024  | [Initial](hero-orbit/tablet-portrait-initial.webp)  | [Front](hero-orbit/tablet-portrait-front.webp)  | [Left](hero-orbit/tablet-portrait-left.webp)  | [Right](hero-orbit/tablet-portrait-right.webp)  |
| 390×844   | [Initial](hero-orbit/iphone-initial.webp)           | [Front](hero-orbit/iphone-front.webp)           | [Left](hero-orbit/iphone-left.webp)           | [Right](hero-orbit/iphone-right.webp)           |
| 320×740   | [Initial](hero-orbit/small-initial.webp)            | [Front](hero-orbit/small-front.webp)            | [Left](hero-orbit/small-left.webp)            | [Right](hero-orbit/small-right.webp)            |

Extra navigation probes: [1280×600](hero-orbit/nav-1280x600.webp), [1152×650](hero-orbit/nav-1152x650.webp), [1152×520 at DPR 1.25](hero-orbit/nav-1152x520.webp).

Physical Mac Safari, iPhone Safari/WebKit gesture arbitration, native zoom, dynamic browser chrome and battery/thermal behavior remain unverified. Chromium device emulation does not establish those results. The existing optimized static fallbacks remain the path for reduced motion, constrained devices, failed imports/WebGL and context loss.
