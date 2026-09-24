# Hero refinement: fit, monitor mount and stereo speakers

This refines the existing scene and progressive-enhancement architecture. No new dependencies or unrelated section changes. No commit, push, PR or deployment.

## What caused the clipping

The original hero combined a large copy block with a second full-width scene row, wide vertical gaps, and desktop typography up to 92.8px. Its shorter-screen rules were designed for the introduction alone. On portrait tablets, the old breakpoint also moved the portrait into a separate row. The scene caption ended at 964px in a 768px laptop viewport and 1,183px in a 1,024px portrait-tablet viewport.

There was also a navigation overlap: the homepage's expanded navigation rendered at 160–192px high but reserved only 72px of document flow through a negative bottom margin. Simply compacting the hero exposed the overlap with the eyebrow/greeting. Both problems needed to be addressed together.

## Responsive composition

The existing copy and portrait remain in two columns above the scene on desktop/tablet. The headline uses a height-aware `clamp()` and 1.06 line height. Body copy remains 16px / 1.5 line height; CTA targets remain at least 44px. Gaps, margins and padding are reduced together. The portrait stays beside the introduction on tablets, with Meet Quang visible. No copy, links, ordering or project content changed.

Above 620px, headline size is bounded by both viewport height and width breakpoints. Desktop scene width is capped by `min(100%, 680px, 76svh)`; tablet uses `min(100%, 640px, 70svh)` with a 2:1 card. A separate `max-height: 820px` rule tightens spacing on short laptops. The homepage navigation expands only to 72–108px, with correspondingly bounded logo/type sizes. It retains its original links, sticky placement and scroll-collapse behavior; About/Photography navigation is unaffected.

Phones keep their existing headline/body sizes, Meet Quang card, normal vertical flow and 4:3 scene. Nothing forces the complete phone hero into one screen. Extremely small/zoomed viewports may still scroll rather than clip content.

All six desktop/laptop/tablet samples fit the complete hero, including navigation, eyebrow/greeting, headline, paragraph, metadata, both CTAs, Meet Quang, scene and both labels. Assertions check viewport bounds **and** that navigation does not cover the introduction.

| Viewport        | Before caption bottom | After caption bottom | Before / after screenshots                                                                                    |
| --------------- | --------------------: | -------------------: | ------------------------------------------------------------------------------------------------------------- |
| 1920×1080       |                1431px |                944px | [Before](hero-refinement/before/desktop-large.webp) · [After](hero-refinement/after/desktop-large.webp)       |
| 1440×900        |                 973px |                814px | [Before](hero-refinement/before/desktop.webp) · [After](hero-refinement/after/desktop.webp)                   |
| 1366×768        |                 964px |                712px | [Before](hero-refinement/before/laptop.webp) · [After](hero-refinement/after/laptop.webp)                     |
| 1280×800        |                 891px |                735px | [Before](hero-refinement/before/laptop-tall.webp) · [After](hero-refinement/after/laptop-tall.webp)           |
| 1024×768 tablet |                 848px |                714px | [Before](hero-refinement/before/tablet-landscape.webp) · [After](hero-refinement/after/tablet-landscape.webp) |
| 768×1024 tablet |                1183px |                923px | [Before](hero-refinement/before/tablet-portrait.webp) · [After](hero-refinement/after/tablet-portrait.webp)   |
| 390×844 phone   |                1341px |               1341px | [Before](hero-refinement/before/iphone.webp) · [After](hero-refinement/after/iphone.webp)                     |
| 320×740 phone   |                1386px |               1386px | [Before](hero-refinement/before/small.webp) · [After](hero-refinement/after/small.webp)                       |

The short-laptop before screenshot directly reproduces the described problem: only the upper portion of the desk card is visible, while navigation also covers the top of the copy. The after screenshot shows the complete composition with roughly 56px below the labels. Headline sizes range from 33.6px on landscape tablet to 51.84px on large desktop; phones remain unchanged at 42.4–50.7px.

The attachment provided written requirements but no separate screenshot or speaker image. Comparison therefore uses captures of the actual pre-refinement build; speaker styling follows the supplied written description.

## Scene changes

**Monitor mount:** removed both individual posts/rectangular feet and their old contact patches. Added a rear desk clamp, shared upright, two articulated box-section branches, cylindrical joints and small rear VESA plates. The arms use the existing dark/edge materials and merge into the existing material batches. Landscape/portrait monitors keep their previous equal-diagonal proportions and static screen content.

**Blue 22B:** moved from front-right `(1.65, 0.29, 1.4)` to rear-left `(-3.4, 0.29, -0.9)`, with its contact patch moved too. It remains visible below/left of the landscape display from the current camera, behind the camera object, clear of keyboard/mouse and speakers. Existing blue paint, gold wheels, scoop and wing remain. No new car geometry was needed.

**Stereo speakers:** exactly two matching tapered, 16-sided bodies. Each has a dark circular top, a silver base and a thin static blue ring. A shared 32×32 repeating texture suggests mesh rather than modeling a grille. The body geometry is cloned from one template and then merged by material; both speakers share their materials. A basic blue material suggests illumination without another light, glow pass or animation. The left speaker sits under the landscape monitor at `(-2.05, -0.45)` in desk x/z; the right sits between portrait monitor and PC at `(1.65, -0.05)`. Both remain visible without covering display content. The right is deliberately partly framed by the PC.

**Framing:** retained the existing orthographic camera system. It now selects phone, tablet, short-laptop or desktop framing from viewport media queries, rather than mistaking a narrower desktop card for a phone. Tablets have a more elevated, less oblique view; short laptops raise the camera slightly; phones retain their elevated composition. All objects and desk edges have breathing room. Desktop pointer motion, touch behavior, DPR caps, on-demand rendering and cleanup are unchanged.

## Matching optimized fallbacks

All four static assets are rendered from the revised scene itself, with the same viewport profile as the interactive camera. Responsive `<picture>` sources select phone first, then tablet, short laptop, or desktop. The generator explicitly emulates each viewport before capturing its canvas. Old stands/car placement are absent and both speakers are present in every fallback.

| Fallback               |       Before |    After |
| ---------------------- | -----------: | -------: |
| Desktop, 1000×440      |     15,704 B | 16,308 B |
| Short laptop, 1000×440 | Used desktop | 17,296 B |
| Tablet, 900×450        | Used desktop | 17,354 B |
| Phone, 500×375         |     10,026 B | 10,478 B |

Only the selected source transfers. New tablet/compact assets do not add all four images to initial route cost. WebP quality 85 remains unchanged. Documentation screenshots are optimized WebP too and are not bundled into the application.

## Cost and validation

| Metric                      |    Before |                After |
| --------------------------- | --------: | -------------------: |
| Draw calls                  |        13 |                   15 |
| Triangles                   |     1,530 |                2,334 |
| Lazy scene raw JS           | 568,882 B |            569,965 B |
| Lazy scene gzip             | 142,668 B |            143,102 B |
| Entry gzip                  |  84,296 B |             84,325 B |
| CSS gzip                    |  13,049 B |             13,334 B |
| Initial CLS                 |         0 | 0 at all eight sizes |
| Extra idle/offscreen frames |         0 |                    0 |

The lazy scene grows by **434 bytes gzip (0.3%)**. Two additional material batches account for the mesh-like speaker bodies and blue rings; the mount uses existing batches. Six tiny generated textures replace the previous five, with no model/texture downloads. No new lights, reflections, transparency, shadow maps, post-processing or continuously animated LEDs. One canvas, capped DPR, lazy import and existing lifecycle handling remain intact. Emitted chunks were measured with the same Node `gzipSync` method as the previous interval.

- **91 tests pass across seven files**, including the original 90 plus matching responsive fallback-source coverage. The default parallel run initially hit unrelated 5-second timeouts while host simulator processes were heavily active. The entire suite passes with `npm test -- --maxWorkers=1`; no test timeout was relaxed.
- **Browser regression suite passes** across all eight viewports, including resize/orientation, pointer behavior, touch scrolling, complete initial hero fit on desktop/tablet, no navigation overlap, no horizontal overflow, idle/offscreen pause, return, reduced motion, Save-Data/low-core exclusion, actual context loss, initialization failure, rejected chunk, keyboard focus, work anchor and About navigation. Tablet scroll checks cross the existing page scroll-snap threshold rather than treating a short swipe snapping back as a blocked gesture.
- **Production build passes**; the pre-existing raw chunk >500 kB Vite warning remains visible. No configured lint command exists. Scoped Prettier checks and `git diff --check` pass.
- Before/after screenshots at all eight sizes were inspected, including the full phone scenes after scrolling: [390px scene](hero-refinement/after/iphone-scene.webp), [320px scene](hero-refinement/after/small-scene.webp). Raw layout bounds and [browser metrics](hero-refinement/browser-metrics.json) accompany them.

Three paired preview runs (HTTP cache disabled, no CPU/network throttling) measured median LCP as follows: 1440×900 **100 → 100 ms**, 1366×768 **80 → 88 ms**, 768×1024 **68 → 80 ms**, and 390×844 **68 → 84 ms**. The 0–16ms median changes sit within observed run-to-run spread (60–176ms overall); this small local sample does not establish real mobile-network performance. Initial CLS stayed zero in every paired run. At a fixed 600px scroll, existing navigation-related CLS fell from 0.01021 → 0.00184 on desktop and 0.01227 → 0.00184 on laptop; tablet/phone remained zero. [Raw paired samples](hero-refinement/paired-metrics.json) are retained.

Because the complete scene is now initially visible, eligible desktop/tablet browsers normally request the lazy chunk after the existing 900ms/idle delay rather than waiting for a scroll. That is an intentional consequence of fitting the scene: its ~143kB transfer is still separate from the entry and does not block hero copy/CTAs. Reduced-motion and constrained-device cases still skip that request entirely.

## Reproduce and remaining device checks

Use the dedicated local Chromium setup documented in [the initial interval report](hero-scene.md#validation-and-reproduction). Start Vite preview on port 4173; then:

```sh
HERO_ASSERT_FIT=1 node scripts/capture-hero-layouts.mjs
npm run test:hero:browser
npm test -- --maxWorkers=1
npm run build
npm run measure:hero
git diff --check
```

Layout captures go to `/tmp/hero-layouts` by default. Set `HERO_PREVIEW_URL` and `HERO_CHECK_OUTPUT` to capture another build/directory. Run browser scripts sequentially: a newly opened headless tab backgrounds the previous tab, intentionally suspending its scene. Regenerate all four static cameras with `npm run prepare:hero` against the development server. The original lazy import, reduced-motion/device exclusions, WebGL/context-loss fallback and lifecycle isolation are preserved.

Physical iPhone/iPad and Safari/WebKit validation, cellular conditions, battery/thermal behavior and broad GPU compatibility remain release checks. The tested tablet/phone sizes use real Chromium with touch emulation, not physical devices. Keep the refinement based on its verified fit and small rendering/payload increase; retain the static fallback on constrained devices.
