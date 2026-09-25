# Desktop drag diagnosis — physical confirmation pending

> Historical diagnostic pass. The user's physical-drag export subsequently confirmed the reduced-motion gate. See [the confirmed fix](hero-reduced-input.md). The temporary HUD, diagnostic hooks and diagnostic script have now been removed; the evidence below is retained as the before-state record.

**No interaction fix is claimed in this pass.** Only temporary development diagnostics were added. Scrolling, music artwork, eligibility rules, mouse/touch behavior and the scene are unchanged. No commit, push, PR or deployment.

## Observed failure and its limits

The dedicated Brave/Chromium browser on this Windows host was opened without a reduced-motion override. Both development (`localhost:5173`) and production preview (`localhost:4173`) report:

| Query/state | Native result |
| --- | --- |
| `prefers-reduced-motion: reduce` | true |
| `pointer: fine` | true |
| `pointer: coarse` | false |
| `hover: hover` | true |
| `navigator.maxTouchPoints` | 0 |
| Hero ready | false |
| WebGL canvas | absent |
| Scene pointer listeners on interaction host | none |
| Active visual | static fallback |

**First failing stage in this observed configuration:** the lazy-loader eligibility gate rejects reduced motion, before scene mounting, pointer listener registration or pending gesture creation. Input reaches the visible stage, but no interactive scene exists to receive it. This is an intentional current fallback policy, not a failed button guard or render scheduling issue.

This is an actual browser observation with native media preferences, **not confirmation of the user's physical mouse failure**. No physical mouse interaction or personal browser session was available to the agent. CDP-generated events, even when the browser marks them `isTrusted=true`, are not described here as physical input. The requested manual development/preview matrix (focus switching, route return, resize, scrolling away/back and clicking elsewhere) remains for the user's browser. Per the request, work stops at diagnostic instrumentation pending that evidence.

## Hit testing, geometry and computed CSS

At the sampled center, left monitor, right monitor, keyboard, PC and empty background, native-preference `elementsFromPoint()` returns this stack:

```text
div.hero-desk__stage
div.hero-desk
div.hero-inner.reveal-content
section#top.hero
header.home-header.snap-stage.scroll-enter.is-visible
div.app-shell
div#root
body
html
```

The recorder also observed `pointerdown.target = div.hero-desk__stage` for CDP input at all six positions. **The target of the user's physical pointerdown is still unknown**; the HUD/export will record it without changing input ownership.

At viewport 1440×900, measured rectangles (CSS pixels) are:

| Element | x | y | width | height |
| --- | ---: | ---: | ---: | ---: |
| Hero visual / stage | 372.5 | 514.4375 | 680 | 299.1875 |
| Interaction host | 373.5 | 515.4375 | 678 | 297.1875 |
| Fallback picture / image | 373.5 | 515.4375 | 678 | 297.1875 |
| Canvas, forced-motion control only | 373.5 | 515.4375 | 678 | 297.1875 |

The one-pixel inset is the card border. The interaction surface covers the entire interior; there is no measured smaller hit area. In the native-preference case it is **hidden**, not undersized.

Computed styles: the stage is relative, visible, `pointer-events:auto`, `overflow:hidden`, `touch-action:pan-y pinch-zoom`; the interaction host is absolute, `pointer-events:auto`, `user-select:none`, `touch-action:pan-y pinch-zoom`, but `visibility:hidden`. The fallback picture and image are visible with `pointer-events:none`. All inspected stage/host/fallback pseudo-elements have `content:none`. There is no observed intercepting loading layer, hero link or decorative overlay at these six positions. The temporary HUD also uses `pointer-events:none` and does not appear in their hit stacks.

## Why the earlier automated drag checks passed

An explicitly labeled **control**, forcing `prefers-reduced-motion:no-preference`, mounts WebGL. The six hit stacks then start with `canvas → div.hero-desk__canvas → div.hero-desk__stage`, followed by the same ancestors. The canvas and handler host have identical rectangles.

`DOMDebugger.getEventListeners` confirms passive `pointerdown` and `pointerleave` listeners on the live host, plus `lostpointercapture`, click and keyboard listeners. The trace observes `pointerdown.target=canvas`, `currentTarget=div.hero-desk__canvas`, `button=0`, `buttons=1`, `isPrimary=true`. Movement uses `button=-1`, `buttons=1`; the implementation correctly tests `buttons`, not `pointermove.button`. The control trace reaches horizontal intent, capture, a changed target, invalidation and rendered angles. Fine/hover queries govern parallax, not deliberate drag admission.

The previous helper explicitly forced this `no-preference` state, so its successful dragging checks did not cover the host's native fallback state. That discrepancy is established. Whether it explains the user's failure awaits the physical-drag export. No preference policy has been changed based solely on this control.

Raw evidence: [surface/CSS/pseudo-element audit](hero-input-diagnosis/surface-audit.json), [native development input](hero-input-diagnosis/dev-native-preferences.json), [forced-motion diagnostic control](hero-input-diagnosis/dev-forced-motion-control.json), [native production preview](hero-input-diagnosis/preview-native-preferences.json). `scripts/diagnose-hero-input.mjs` deliberately avoids the previous media-overriding browser helper.

## Temporary diagnostic instrumentation

`heroInputDebug.js` loads only in development. The HUD appears over the hero, including when the scene stays static. `window.__heroInputDebug` exposes counters, active pointer, gesture state, target/display angles, actual interaction element, last target, a bounded event trace, snapshots and `report()`.

Document capture observes physical hits even if an overlay prevents the host receiving them. Scene hooks separately record whether the actual host/window handler ran, its guards, invalidation and rendering. Records include pointer type/ID, primary/button/buttons, coordinates/deltas, event target/currentTarget, `elementFromPoint`, capture status, state and target changes. An after-dispatch task observes state after native event listeners finish; it is not a polling loop. Document-wide pointer movement observation exists only during a sequence and is removed on release/cancel/blur and disposal. No diagnostic changes capture, prevents an event, changes preferences or drives the camera. No React state updates or permanent frame loop were added. Listener/observer cleanup follows the existing hero lifecycle.

## One failed physical drag needed

1. Open **http://localhost:5173/** in the normal browser where dragging fails. Do not override reduced motion in DevTools. Reload if the HUD is missing.
2. Try one normal primary-button horizontal drag in the hero.
3. In DevTools Console run:

   ```js
   copy(window.__heroInputDebug.report())
   ```

4. Paste the copied report. It contains local URL, browser user agent, pointer/preferences, geometry and hero input diagnostics, not page form data or storage. If copying is inconvenient, report: **WebGL/FALLBACK, reduced motion, down/move/up counters, state, buttons, dx/dy, orbit target and displayed angle**, plus browser name and the area dragged.

Interpretation: FALLBACK + reduced motion true + down/up counts with no handler records confirms the eligibility policy path. WebGL with no host handler record points to hit routing/listener lifetime. Pending with rejected guards identifies intent/button/pointer filtering. Changed target without rendered angle identifies invalidation/render eligibility. The export distinguishes these without assuming the result in advance.

## Validation and performance

- Full suite: **110 tests pass**. No new generic drag regression was substituted for the missing physical reproduction.
- Production build, scoped formatting and `git diff --check` pass. Existing jsdom scrollTo and raw-chunk-size warnings remain.
- Final production entry, CSS and lazy scene have the same emitted filenames as before this diagnostic pass. No debug module, HUD or debug-property strings occur in emitted JS. The lazy scene remains **576,914 bytes raw / 146,213 bytes gzip**.
- Production geometry and rendering behavior are unchanged: **15 draw calls / 2,902 triangles**, with the preceding run's zero idle/offscreen frame measurements. Native reduced-motion fallback has no scene renderer at all. Diagnostic DOM work in development is temporary and is not claimed to be production performance.
- Mobile dragging and native scrolling were not modified. Their previous real-browser regression results remain applicable to the identical production artifacts; a new physical mobile or touchpad validation was not performed in this pass.
- No physical mouse validation, physical Safari/trackpad validation, or exact physical-PC root-cause confirmation is claimed. The HUD remains in development as requested until a failed physical drag identifies the cause; production is unchanged.
