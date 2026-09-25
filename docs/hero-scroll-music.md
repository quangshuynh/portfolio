# Hero native scrolling, gesture recovery and music panel

> Follow-up: [confirmed reduced-motion input fix](hero-reduced-input.md). That pass changes reduced motion from a static-only policy to deliberate user rotation with automatic motion disabled. This report records the earlier policy and measurements.

Local changes only. No commit, push, PR or deployment. This continues the existing scene described in [hero-orbit.md](hero-orbit.md); the earlier layout and physical-scene refinements remain intact.

## Reproduction and root causes

The original production build was tested before changing interaction code. [Before measurements](hero-scroll-music/input-before.json) and [after measurements](hero-scroll-music/input-after.json) use real Brave/Chromium input through CDP, with motion explicitly enabled.

**Desktop/laptop scrolling:** `html { scroll-snap-type: y mandatory }` returned small native gestures to the hero snap point. At 1440×900, 1366×768 and 1440×650, three separate 100px wheel inputs each returned to `scrollY=0`; twelve 8px trackpad-like inputs also ended at 0. Wheel events were **not canceled**. Disabling snapping live, without touching scene handlers, produced positions 100, 200 and 300 with the same wheel inputs. This establishes CSS snapping as the reproduced cause, rather than a wheel-consuming Three.js handler. The compact hero is a full snap stage, so small gestures repeatedly return to it.

**Touch:** the same original build returned tablet vertical and diagonal swipes to 0 at 768×1024. At phone width (390×844), vertical swipes already advanced 769→904 and diagonal swipes 769→858. The existing ≤620px CSS disables snapping, explaining that difference. The latest report of blocked phone scrolling was not reproduced in this environment; physical-device behavior remains unverified.

**Mouse dragging:** normal primary-button dragging already rotated in the original build at all three desktop/laptop sizes. There is no touch-only orbit path, overlay blocking mouse input or incorrect `button` check in this checkout. Therefore an exact cause of a fresh-session mouse drag never starting cannot honestly be claimed. A separate interruption failure **was reproduced**: after a primary press and horizontal move, dispatching window blur left `data-dragging=true`; subsequent movement with `buttons=0` continued changing the orbit target. The implementation did not listen for window blur or check the held primary button during movement. A stale vertical/pending gesture could also survive a missed release and reject the next `begin()`. [Interruption evidence](hero-scroll-music/mouse-interruption-before.json) records the tested case; blur was injected, not an automated physical OS focus switch.

The Windows host also reports reduced motion by default. Browser drivers now explicitly choose `no-preference` for interactive checks and explicitly test `reduce` separately. The application still honors the actual user preference and displays its static fallback when reduced motion is requested.

## Event ownership and exact changes

- Added the homepage-only `html:has(.home-header) { scroll-snap-type: none }` override. Other routes retain their existing rules. Native anchor navigation and smooth scrolling remain available. Homepage section-to-section forced snapping is intentionally removed to allow continuous passage through the hero and Experience in both directions.
- Added window-blur cleanup, removed that listener on disposal, and clear stale mouse gestures when the primary button is no longer held. A fresh primary mouse press recovers any missed prior release before beginning a new gesture.
- At the existing 4px mouse / 10px touch threshold, motion that is not clearly horizontal now becomes page-owned vertical/ambiguous intent. Horizontal displacement must exceed vertical displacement by 1.4×. A page-owned gesture cannot switch to orbit later in that gesture.
- No wheel listener, wheel `preventDefault`, manual wheel-to-`scrollBy` bridge, new touch listener, body lock, overflow change or transparent overlay was added. Pointer and page-scroll listeners remain passive. `touch-action: pan-y pinch-zoom` and `user-select: none` remain on the existing interaction surface. The static fallback has `pointer-events: none`.
- Existing cancellation, lost host capture, pointerup, resize, offscreen suspension and disposal continue releasing capture/state. Click suppression applies only after a recognized drag; the only other event cancellation in the scene handles orbit keyboard keys and WebGL context loss. Tab, vertical arrows, PageDown and Space remain browser-owned.

The existing unified state model remains: **idle → pending pointer → horizontal orbit or page-owned vertical/ambiguous pan → idle**. Capture begins only after horizontal intent. User orbit overrides parallax and scroll updates during a drag; release preserves the selected target. The existing ±90° clamp, 65ms angle damping, responsive camera profiles, fine-pointer parallax and at-most-0.06-radian page-scroll contribution remain unchanged. Scroll response reads page position through the passive scroll listener; it cannot consume input. Demand rendering stops after convergence and suspends offscreen.

## Right portrait monitor

The existing 192×320 canvas texture now allocates **213px (66.6%) to code and 107px (33.4%) to music**. Its lower third has a dark background, original abstract sun/hills album art, fictional title/artist placeholders, previous/play/next symbols, a static progress line and restrained green accent. It adds no texture, material, mesh, light, animation, network request, SDK, audio or dependency. The landscape monitor is unchanged.

All four WebP fallbacks were regenerated using the existing scene renderer and Sharp workflow. Monitor arms, rear-left blue car, speakers/rings, cables, keyboard/mouse, camera and PC are unchanged. Artwork stays on the existing front screen plane, with natural occlusion when viewing the monitor from the side/rear; it is not painted onto the rear casing.

Screenshots: [monitor close-up](hero-scroll-music/right-monitor-close.webp), [front](hero-scroll-music/music-front.webp), [−60°](hero-scroll-music/music-left.webp), [+60°](hero-scroll-music/music-right.webp). The orbit capture set also covers both ±90° limits at all nine representative sizes.

## Measured cost

Same-environment production builds, Node 24.18.0 `gzipSync`, decimal kB:

| Metric | Before | After |
| --- | ---: | ---: |
| Draw calls | 15 | 15 |
| Triangles | 2,902 | 2,902 |
| Lazy JS raw | 575,713 B | 576,914 B |
| Lazy JS gzip | 145,830 B | 146,213 B |
| Lazy JS Brotli | 119,362 B | 119,665 B |
| Desktop fallback | 16,846 B | 16,862 B |
| Short-laptop fallback | 17,850 B | 17,962 B |
| Tablet fallback | 17,778 B | 18,002 B |
| Phone fallback | 10,834 B | 10,936 B |

Lazy gzip grows **383 bytes (0.26%)**. The historical report's 145,063 B baseline differs from the current compressor's 145,830 B for the same 575,713-byte original chunk; comparing only against that historical figure would misleadingly attribute compression-environment differences to the patch. [Before](hero-scroll-music/bundle-before.json) / [after](hero-scroll-music/bundle-after.json) measurements are retained. The existing raw-chunk >500kB Vite warning remains.

The focused input test measures **zero extra frames over 500ms after 1.1s settling** across desktop, laptop, short laptop, tablet and phone. It also asserts zero additional frames during its 600ms offscreen sample. These are frame-counter measurements with software WebGL, not hardware GPU utilization, energy or thermal measurements.

## Validation

The full unit suite passes **110 tests in 10 files** (previously 98 in 8). New tests exercise mounted scene event handling with a mocked renderer, primary-button capture and bounded orbit, release/cancel/blur/lost capture, missed release, uncanceled wheel input, vertical/diagonal/horizontal touch intent, keyboard scrolling, reduced motion, offscreen scheduling, convergence, and music baked into the existing six textures / 15 mesh batches / 2,902 triangles. Existing jsdom `window.scrollTo` warnings remain.

The new real-browser input driver passes at 1440×900, 1366×768, 1440×650, 768×1024 and 390×844. It checks wheel over/outside the scene, repeated small trackpad-like deltas, horizontal wheel non-orbit behavior, stationary-pointer fast scrolling past the hero and back, native-scroll camera response, mouse drag/release, no selection, clicks without dragging, cancel/blur/resize/outside cleanup, Tab escape, touch vertical/horizontal/diagonal ownership, overflow and idle/offscreen rendering. Afterward the 12×8px sequence advances exactly 96px at each desktop/laptop size. Tablet vertical and diagonal swipes now advance 206→341 and 206→295 respectively; phone results remain 769→904 and 769→858.

The older browser drivers use explicit CDP touch-event streams now. `Input.synthesizeScrollGesture` emitted pointer events but did not pan in this Windows headless backend; explicit touch events exercise native browser pan arbitration and verify actual page movement, without programmatically scrolling in the gesture under test. The orbit driver's old inline snapping override was removed so it tests the production CSS.

Production build, scoped Prettier 3.6.2 checks and `git diff --check` pass. There is no configured lint script; surrounding CSS/Photography formatting was preserved instead of reformatting those files.

The existing orbit driver, hero lifecycle browser suite, all-nine-size layout assertions and Photography regression driver **pass**. The orbit suite verifies actual mouse/touch drags, both ±90° limits, repeated clamping, drag click suppression, keyboard angle controls, selected-angle persistence through resize, return to hero, reduced motion, and unchanged navigation geometry. Photography verifies normal/direct-photo entry, image layout, previous/next, focus and scroll restoration, history and return through About to native homepage scrolling. Its homepage assertion now expects `none`, the intentional new scroll policy.

[Lifecycle metrics](hero-scroll-music/browser/metrics.json) record **zero initial CLS, zero idle/offscreen extra frames, and no horizontal overflow at all nine sizes**: 1920×1080, 1440×900, 1366×768, 1440×650, 1280×800, 1024×768, 768×1024, 390×844 and 320×740. Desktop/laptop/tablet hero content fits; phones retain natural vertical flow. [Layout metrics](hero-scroll-music/layout/layout.json) and [orbit measurements](hero-scroll-music/orbit/metrics.json) accompany viewport screenshots. The lifecycle suite also covers lazy resources, orientation, DPR capping, pointer response, light mode, reduced motion, constrained capability, blocked import, WebGL initialization failure, actual context loss, focus, CTA anchors and About navigation.

The zero-CLS result refers to initial layout in this local run. Small later values occur while the existing navigation collapses during scripted scrolling, as in earlier reports. No universal zero-CLS or real-network LCP claim is made.

## Reproduction and limitations

Start a dedicated Brave/Chromium debugging profile at port 9223 and Vite production preview at port 4173. Run browser drivers sequentially: creating a new active tab backgrounds the previous scene and intentionally suspends it.

```sh
npm test -- --maxWorkers=1
npm run build
node scripts/check-hero-input.mjs
node scripts/check-hero-orbit.mjs
npm run test:hero:browser
node scripts/capture-hero-layouts.mjs
node scripts/check-photography-scroll.mjs
```

Set `HERO_CHECK_OUTPUT` for capture destinations; `HERO_BROWSER_URL` and `HERO_PREVIEW_URL` override the hero driver's endpoints. Photography uses `CDP_URL` and `PORTFOLIO_URL`. Set `HERO_ASSERT_FIT=1` for layout assertions. `capture-hero-music.mjs` and `npm run prepare:hero` need the development server on port 5173.

Tested browser: Brave/Chromium on Windows using ANGLE SwiftShader. Automatic approval review rejected launching a separate Chrome instance with “blocked by policy”; that browser run was not performed. No physical Mac trackpad, Windows precision touchpad, Safari/WebKit, iPhone/iPad, native pinch/back gesture, dynamic browser-chrome or hardware battery/thermal check is claimed. Small pixel wheel deltas approximate trackpad input, but do not establish physical-device gesture behavior. The unreplicated fresh-session desktop-drag and phone-scroll reports remain physical-device follow-up items rather than invented root causes.

