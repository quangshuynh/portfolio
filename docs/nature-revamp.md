# Nature portfolio revamp

Visual and UI redesign of `/`, `/about` and `/photography`. It keeps the React 19 + Vite app, the plain-CSS approach, all content, and all existing behaviour. Base: `main` @ `12f8300`.

Direction: *someone who builds software, drives interesting cars, carries a camera, and likes being outside.* The homepage leads with engineering. About is personal. Photography is visual storytelling. All three share one "field notes" design language.

## Design system (`src/styles/`)

| File | Role |
| --- | --- |
| `tokens.css` | Raw palette plus semantic tokens (`--bg-primary`, `--surface`, `--text-*`, `--accent`, `--forest`, `--moss`, `--stone`, `--sky`, `--earth`, `--signal`, `--ridge-*`, …). Dark and light are defined separately. Type, space and motion scales live here too. |
| `base.css` | Reset, film grain, type primitives (`.eyebrow`/`.mono`), buttons, viewfinder corner marks, section headings, the `data-reveal` system, the View Transitions theme reveal, and reduced motion. |
| `components.css` | Topographic contours, ridgelines, the Spotify disc, status dot. |
| `nav.css`, `home.css`, `sections.css`, `about.css`, `photography.css` | Page layers. |
| `overlays.css`, `personality.css` | Migrated lightbox, modal, Spotify list and personality-button styles, re-pointed at the tokens. |

**Dark: forest at dusk.** `#101913` background, cream `#ece7da` type, sage `#a9c09b` accent, amber `#e3b36e` signal and focus.
**Light: stone paper.** `#f1ede3` background, charcoal `#1b221e` type, deep moss `#3d5d40` accent, burnt-orange focus. Designed on its own terms, not inverted.
All text/background pairs pass WCAG AA (4.5:1+). The lowest text pair is tertiary on light `bg-secondary` at 4.71.

**Type**
- Display: Circular Bold (the existing Spotify face), now served as WOFF2.
- Body: Schibsted Grotesk (variable).
- Labels and metadata: Martian Mono.
- Quotes and asides: Newsreader italic.
All fonts are self-hosted.

**Motifs, used sparingly.** Topographic contours (every fifth line is an index contour), ridgeline silhouettes, viewfinder corner marks, mono metadata labels, coordinates, frame numbers and exposure data.

## Motion

Everything that animates continuously runs on the compositor (transform/opacity), and every animation has a reduced-motion fallback.

- **Hero entrance:** staggered rise; the headline is transform-only, so it paints immediately.
- **Scroll reveals:** `data-reveal`, IntersectionObserver plus MutationObserver, so rows added by expanding the project list also reveal.
- **Nav:** a sliding active-section marker; the header tightens on scroll.
- **Parallax:** ridgelines drift via scroll-driven CSS (`animation-timeline: view()`), with no JS and no scroll-jacking.
- **Trail line:** draws alongside the case files on very wide screens.
- **Topographic drift:** 90 s alternate.
- **Spotify disc:** rotates and pauses offscreen.
- **Photography:** the cover "develops" in; viewfinder brackets focus in on hover and reveal exposure data.
- **Theme switch:** circular View Transition reveal from the toggle.

## Spotify circular element

The Circular (Spotify) typeface stays the display face site-wide. The circular treatment is now a turning record: ring text set in Circular around a vinyl, with a bezel and compass-style ticks.
- **Home:** it sits on the hero workbench and links to `/about#music`, which opens the listening panel.
- **About:** it sits on the Music photo and opens the same panel.
- It never fetches by itself; a test enforces the existing lazy behaviour. If listening data is already cached, the latest album cover appears on the label.

## Higgsfield

One atmospheric plate was generated (dusk ridgelines, `z_image`; job `3c16b8ab-25e9-4f6d-bf76-9a531345fcd1`). Higher-tier models needed a paid plan, and the result CDN (`cloudfront.net`) is blocked by this environment's egress policy, so the file could not be brought into the repo. The atmosphere is built in code instead (SVG terrain) and from real photography. No generated imagery ships.

## Performance (Lighthouse 12, mobile simulated, local preview)

| Route | `main` | This branch |
| --- | --- | --- |
| `/` performance | 90–91 (LCP 3.3–3.5 s, TBT 70–90 ms) | 86–88 (LCP 3.7–3.9 s, TBT 100–140 ms) |
| `/about` performance | 76 | 75 |
| `/photography` performance | 77 | 75–77 |
| Accessibility / Best practices / SEO | 100 / 100 / 100 | 100 / 100 / 100 on all three routes |
| CLS | 0–0.002 | 0 |

The first pass regressed the homepage badly (63; TBT 580 ms) because ambient motion repainted SVG groups. That was fixed by moving motion to the compositor, slimming the fonts, and adding a WebP cover; see commit `feat(motion)`. The remaining small homepage cost comes from the extra display fonts and hero markup.

## Screenshots

- Baseline (`main`): `docs/nature-revamp/baseline/`
- After: `docs/nature-revamp/after/`
- Naming: `{home|about|photography}-{desktop|tablet|mobile}-{dark|light}.webp`, full page, at 1440×900, 1024×768 and 390×844.

Regenerate with:

```bash
npm run build && npx vite preview --port 4173 &
node scripts/capture-redesign.mjs http://127.0.0.1:4173 docs/nature-revamp/after
```
