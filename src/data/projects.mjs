// Single source of truth for every project on the homepage.
//
// - `featured: true` projects render as case files in "Featured projects", in
//   array order; the rest render in "More projects", also in array order. Keep
//   featured entries first. Order is curated by hand: move an entry to reorder,
//   flip `featured` to promote or demote, and set `hidden: true` to take a
//   project off the page while keeping its entry (it still ships in the bundle,
//   so delete entries that must not be public). See docs/PROJECT_MAINTENANCE.md.
// - Screenshots of public projects are commit-pinned jsDelivr URLs built by
//   githubAsset(); see docs/project-assets.md.
// - A `video` is a file attached to a GitHub release (jsDelivr cannot serve
//   release assets), referenced by its tag-versioned download URL. Its poster is
//   a commit-pinned repository image like any screenshot.
// - Logos are tiny on the page, so they are served as display-sized WebP
//   derivatives (`logo.file` in src/assets/optimized). `logo.source` records the
//   pinned GitHub original that `npm run prepare:images` derives them from.
// - Private repositories (585dashcam585, 585photo585, devpulse) have no public
//   raw URLs, so their images stay local: `{ local: '<optimized file name>' }`.
//   Mark them `private: true`; a private card may have no links at all.
// - Captures the portfolio took itself (QuangEdit, which lives in this
//   repository; live-site captures of Chessed and Homemade; the Hymical Forms
//   architecture diagram) are local derivatives too.
//
// This file is plain data with no asset imports so Node scripts can read it.
import { githubAsset } from './githubAssets.mjs';

// Filter groups for More projects, in chip order. Featured cards ignore them.
export const PROJECT_CATEGORIES = ['Native Applications', 'Developer Tools & Automation', 'Web & Product Engineering', 'Games & Creative Engineering', 'Backend & Infrastructure'];

/** @typedef {{ src?: string, local?: string, width: number, height: number, alt: string, caption: string, label?: string }} ProjectImage */
/** @typedef {{ file: string, source?: string, width?: number, height?: number, alt: string, className?: string, trim?: boolean }} ProjectLogo */
/** @typedef {{ src: string, page: string, poster: string, width: number, height: number, duration: number, title: string, caption: string }} ProjectVideo */
/**
 * @typedef {object} Project
 * @property {string} slug lowercase id; `#project-<slug>` anchor and the usual githubAssets.mjs key
 * @property {string} name display name
 * @property {boolean} [featured] case file in "Featured projects" (needs label, takeaway, highlights)
 * @property {boolean} [hidden] keep the entry but render it nowhere
 * @property {string} [label] featured: type line
 * @property {string} [takeaway] featured: one-sentence engineering takeaway
 * @property {string[]} [highlights] featured: two or more details behind the disclosure
 * @property {string[]} [facts] featured: two to four short, verifiable facts shown on the card
 * @property {string} [category] more: one of PROJECT_CATEGORIES (drives the filter chips)
 * @property {boolean} [private] private repository: no github link, local images only, links optional
 * @property {string} [tagline] more: optional positioning line
 * @property {string} [detail] more: supporting paragraph
 * @property {string} summary what it is and does (both sections)
 * @property {string[]} technologies tags, in display order
 * @property {{ github?: string, live?: string, liveLabel?: string, documentation?: string, release?: string }} links
 * @property {ProjectLogo} [logo]
 * @property {ProjectVideo} [video] featured: first gallery tab, loaded only on play
 * @property {ProjectImage[]} [screenshots]
 * @property {boolean} [tallScreenshots] featured: cap portrait captures at 420px
 */


/** @type {Project[]} */
export const projects = [
  {
    slug: 'dashpilot',
    name: 'DashPilot',
    featured: true,
    label: 'Native iOS · Gig-work tracking & earnings',
    takeaway: 'A truthful, local-first record of gig work: what a shift paid, per hour and per mile, without platform integrations.',
    summary: 'Local-first iOS app for gig and delivery drivers that records shifts, stacked deliveries, routes, earnings, mileage, and expenses on device, and reports only what that recorded history supports.',
    facts: ['2,600+ Swift tests', 'UI journeys run in macOS CI', 'Tagged v0.1.1'],
    highlights: [
      'Models stacked delivery lifecycles, pickup waits, Park & Resume, corrections, and historical journeys while preserving recorded delivery facts',
      'Organizes the app into Home, Work, and Money workspaces, with weekly Insights charts, period summaries, and reports that show the coverage behind each figure',
      'Keeps authoritative records separate from estimates and derived per-hour and per-mile metrics, and exports one shift, a period, or all history as JSON and CSV',
      'Uses a Live Activity and App Intents for the running shift, Core Location with When In Use authorization only, and versioned SwiftData schemas with tested migrations; no DoorDash or other platform integration',
      'Domain tests and simulator UI journeys both run in CI on every change; built from source, not yet distributed through the App Store',
    ],
    technologies: ['Swift', 'SwiftUI', 'SwiftData', 'Swift Charts', 'Core Location', 'ActivityKit', 'App Intents', 'Swift Testing'],
    links: { github: 'https://github.com/quangshuynh/dashpilot', documentation: 'https://quangshuynh.github.io/dashpilot/' },
    logo: {
      file: 'dashpilot-logo',
      source: githubAsset('dashpilot', 'docs/images/dashpilot-logo.png'),
      width: 780,
      height: 771,
      alt: 'DashPilot app logo',
    },
    tallScreenshots: true,
    screenshots: [
      {
        src: githubAsset('dashpilot', 'docs/images/screenshots/work-workspace.png'),
        width: 1206,
        height: 2622,
        label: 'Work',
        alt: 'DashPilot Work workspace during a running shift with worked time, two deliveries in progress, and the next delivery step',
        caption: 'Work workspace with stacked deliveries',
      },
      {
        src: githubAsset('dashpilot', 'docs/images/screenshots/insights-earnings.png'),
        width: 1206,
        height: 2622,
        label: 'Insights',
        alt: 'DashPilot Insights bar chart of recorded gross earnings across eight weeks, with a note explaining partial coverage',
        caption: 'Eight weeks of recorded earnings',
      },
      {
        src: githubAsset('dashpilot', 'docs/images/screenshots/money-workspace.png'),
        width: 1206,
        height: 2622,
        label: 'Money',
        alt: 'DashPilot Money workspace with the selected week’s recorded earnings, recorded expenses, and net after recorded expenses',
        caption: 'Money workspace',
      },
      {
        src: githubAsset('dashpilot', 'docs/images/screenshots/home-workspace.png'),
        width: 1206,
        height: 2622,
        label: 'Home',
        alt: 'DashPilot Home workspace with a Start Shift button, this week’s completed-shift earnings, and recent work',
        caption: 'Home workspace',
      },
      {
        src: githubAsset('dashpilot', 'docs/images/screenshots/period-summary.png'),
        width: 1206,
        height: 2622,
        label: 'Summary',
        alt: 'DashPilot daily summary showing recorded gross earnings, per working hour and per active delivery hour rates, and time worked',
        caption: 'Period summary',
      },
    ],
  },
  {
    slug: '585dashcam585',
    name: '585Dashcam585',
    featured: true,
    private: true,
    label: 'Production commerce platform',
    takeaway: 'Production checkout and order processing with reliable payment finalization.',
    summary: 'Built and deployed a full-stack commerce platform for a family-owned Rochester automotive services business, replacing its hosted website with a custom production application.',
    facts: ['In production', 'Live Stripe payments', 'Built for a local business'],
    highlights: [
      'Runs guest and authenticated checkout with server-authoritative pricing, live Stripe payments, signed webhooks, and idempotent PostgreSQL order finalization',
      'Provides customer accounts, persistent carts and wishlists, order history, and a protected admin CRM for customers, fulfillment, catalog data, and analytics',
      'Sends transactional email through Resend with database-backed delivery state, retry handling, stale-claim recovery, and duplicate-delivery protection',
      'Deployed with Cloudflare Workers and Static Assets, Supabase authentication and RLS, least-privilege credentials, and privacy-conscious Cloudflare analytics',
    ],
    technologies: ['React', 'Vite', 'JavaScript', 'Cloudflare Workers', 'Supabase', 'PostgreSQL', 'Stripe', 'Resend', 'Vitest'],
    links: { live: 'https://www.585dashcam585.com' },
    // Private repository: the storefront capture is kept locally.
    screenshots: [
      {
        local: '585dashcam585-storefront',
        width: 1487,
        height: 1214,
        alt: '585Dashcam585 storefront showing dashcam products and local installation options',
        caption: '585Dashcam585 storefront',
      },
    ],
  },
  {
    slug: 'quangedit',
    name: 'QuangEdit',
    featured: true,
    label: 'Browser photo editor · RAW, layers & on-device ML',
    takeaway: 'Desktop-class photo editing with no upload: RAW decoding, compositing, and ML selections all run in the visitor’s browser.',
    summary: 'Local-first photo editor built into this site. It opens JPEG, PNG, WebP, and camera RAW files, edits them non-destructively with layers, masks, and intelligent selections, and exports full-resolution results, without an account or a server.',
    facts: ['12 camera RAW formats', 'ML selections run on device', 'No account, no upload'],
    highlights: [
      'Decodes 12 camera RAW formats with LibRaw compiled to WebAssembly in worker threads, using measured per-camera colour calibration and a corrective auto-exposure suggestion',
      'A non-destructive pipeline with a WebGL preview mirrored by the CPU export renderer: tone curves, HSL, LUT looks, detail, geometry, text, and image, text, and adjustment layers with W3C blend modes, groups, and clipping',
      'Select Sky, Subject, and Object run on device with ONNX Runtime Web; models are self-hosted and checked by SHA-256, and only a coverage grid of each selection is saved, never photo pixels',
      'Three-exposure HDR merge with registration and ghost masks, edge refinement up to 6,144 px in a worker, batch export to ZIP, and portable edit recipes',
      'A versioned edit document (now v20) with tested migrations, mobile workspace layouts, and browser checks for RAW, HDR, layers, masks, selections, memory, and sustained editing',
    ],
    technologies: ['JavaScript', 'React', 'WebGL', 'WebAssembly', 'Web Workers', 'ONNX Runtime Web', 'LibRaw', 'Vitest', 'Playwright'],
    links: { github: 'https://github.com/quangshuynh/portfolio', live: 'https://quanghuynh.com/photography/editor', liveLabel: 'Open the editor' },
    // QuangEdit lives in this repository, so its captures are local derivatives.
    screenshots: [
      {
        local: 'quangedit-adjust',
        width: 1600,
        height: 1000,
        label: 'Edit',
        alt: 'QuangEdit editing a photograph of a library reading room, with the photo library, the canvas, and Light adjustments for exposure, contrast, highlights, and shadows',
        caption: 'QuangEdit editing workspace',
      },
      {
        local: 'quangedit-layers',
        width: 1600,
        height: 1000,
        label: 'Select Sky',
        alt: 'QuangEdit highlighting an on-device Select Sky mask over a lakeshore photograph, with an adjustment layer created from the selection in the Layers panel',
        caption: 'On-device sky selection driving an adjustment layer',
      },
      {
        local: 'quangedit-mobile',
        width: 780,
        height: 1688,
        label: 'Mobile',
        alt: 'QuangEdit mobile workspace with a lakeshore photograph above a tool picker for Light, Color, Detail, Crop, Masks, Layers, and more, and Photos, Adjust, and Export navigation',
        caption: 'QuangEdit on a phone',
      },
    ],
  },
  {
    slug: 'hymical-forms',
    name: 'Hymical Forms',
    featured: true,
    label: 'Backend · Form ingestion & reliable webhook delivery',
    takeaway: 'A 202 means delivery is already promised: each submission and its delivery job commit in one PostgreSQL transaction.',
    summary: 'Self-hostable, open-source form backend: point a plain HTML form at it, and every submission is validated, stored, and delivered to the developer’s webhook with an HMAC signature, bounded retries, and an attempt history.',
    facts: ['PostgreSQL is the queue', 'Concurrency tests on real Postgres', 'Released v0.2.1'],
    highlights: [
      'Transactional outbox in PostgreSQL: the API stores the submission and its delivery job together and never makes an outbound request, so a crash cannot lose acknowledged work; PostgreSQL is the queue, with no broker or Redis',
      'Separate delivery worker that claims jobs with FOR UPDATE SKIP LOCKED leases, exponential backoff, and crash recovery; claim-token fencing stops a stale worker from overwriting a delivery another worker has reclaimed (delivery stays at-least-once, as documented)',
      'Idempotency-Key retries, HMAC-SHA256 signatures over the raw body, distributed per-source and per-endpoint rate limiting, and management API keys created by an operator CLI and stored only as digests',
      'Security hardening closed X-Forwarded-For and IPv6 /64 rate-limit bypasses and a worker poison-batch loop; operator tools cover replay, attempt history, JSON and CSV export, and safe retention cleanup',
      'Tested against real PostgreSQL, including concurrency and stale-worker races, with Alembic migrations, a startup revision check, and model drift tests',
    ],
    technologies: ['Python', 'FastAPI', 'PostgreSQL', 'SQLAlchemy', 'Alembic', 'Docker', 'pytest'],
    links: { github: 'https://github.com/hymical/forms', documentation: 'https://hymical.github.io/forms/', release: 'https://github.com/hymical/forms/releases/tag/v0.2.1' },
    logo: {
      file: 'hymical-forms-logo',
      // The largest transparent mark in the repository is 214x190.
      source: githubAsset('hymical-forms', 'docs/images/logo_symbol_transparent.png'),
      width: 214,
      height: 190,
      alt: 'Hymical Forms project logo',
    },
    // A backend has no screens; this diagram is drawn from the source
    // (src/hymical_forms) and kept locally.
    screenshots: [
      {
        local: 'hymical-forms-architecture',
        width: 3200,
        height: 1800,
        label: 'Architecture',
        alt: 'Diagram: an HTML form posts to the FastAPI API, which writes the submission and its delivery job in one PostgreSQL transaction; a separate worker claims jobs with SKIP LOCKED leases and sends signed webhooks with retries',
        caption: 'Hymical Forms architecture (drawn from the source)',
      },
    ],
  },
  {
    slug: 'gitprofilelens',
    name: 'GitProfileLens',
    featured: true,
    label: 'Developer tool · GitHub profile auditing',
    takeaway: 'Explainable, deterministic scoring: every point on the 0–100 scale traces back to a check a developer can act on.',
    summary: 'Live web tool that turns a GitHub profile into a transparent 0–100 presentation score with ranked, actionable recommendations, without claiming to measure developer ability.',
    facts: ['Live on Vercel', 'Released v1.3.1', 'More test code than app code'],
    highlights: [
      'Deterministic scoring over GitHub REST and GraphQL data: README quality, descriptions, discoverability, maintenance, and portfolio focus, each with a stated reason and fix',
      'Pinned-repository optimizer, portfolio-candidate recommendations, fork detection, organization audits, Markdown export, and shareable score cards',
      'Optional read-only GitHub App for private repositories, with strict boundaries so private names and data never reach public output',
      'Framework-free front end on Vercel serverless functions, with a public JSON report endpoint',
      'Browser tests plus regression baselines against a representative evaluation corpus guard the scoring from drifting',
    ],
    technologies: ['JavaScript', 'Node.js', 'GitHub REST/GraphQL APIs', 'GitHub Apps', 'Vercel', 'Playwright'],
    links: { github: 'https://github.com/quangshuynh/gitprofilelens', live: 'https://gitprofilelens.vercel.app/', release: 'https://github.com/quangshuynh/gitprofilelens/releases/tag/v1.3.1' },
    logo: {
      file: 'gitprofilelens-logo',
      source: githubAsset('gitprofilelens', 'docs/images/logo.png'),
      width: 780,
      height: 780,
      alt: 'GitProfileLens project logo',
    },
    screenshots: [
      {
        src: githubAsset('gitprofilelens', 'docs/images/gitprofilelens-audit.png'),
        width: 1440,
        height: 1100,
        label: 'Audit',
        alt: 'GitProfileLens audit dashboard showing presentation and discoverability scores with prioritized recommendations',
        caption: 'GitProfileLens audit results',
      },
    ],
  },
  {
    slug: 'ordixa',
    name: 'Ordixa',
    featured: true,
    label: 'Python CLI · Data cleaning, reconciliation & comparison',
    takeaway: 'Deterministic, auditable results: every held-back row has a reason, and every run can be re-verified.',
    summary: 'Command-line toolkit that cleans inconsistent CSV and Excel exports, reconciles orders against payments, and compares two versions of a dataset, driven by versioned TOML profiles. Released as v2.0.0 and exercised so far on fictional demo data.',
    facts: ['Released v2.0.0', '560+ passing tests', 'Re-verifiable, checksummed runs'],
    highlights: [
      'Three workflows on one engine: reconcile orders and payments into paid, partial, unpaid, and overpaid ledgers; clean one inconsistent table into typed, standardized output; compare two exports by explicit business key into a change report',
      'Profile-driven automation: versioned TOML profiles map each business’s headers, IDs, dates, and refund signs once, and a read-only check-profile preflight shows the mapping without printing cell values',
      'Parses money with exact Decimal arithmetic, keeps identifiers as exact text, and holds back duplicate, conflicting, or unparseable rows with a stated reason instead of guessing',
      'Writes atomic run directories with checksummed manifests; verify re-checks a finished run, and the same inputs reproduce the same result fingerprints',
      'Blocks card, bank, government-ID, and credential-looking columns and protects workbook output against formula injection; CI runs release checks, a clean-install validation, and both end-to-end demos',
    ],
    technologies: ['Python', 'pandas', 'openpyxl', 'TOML', 'CSV & Excel', 'pytest', 'GitHub Actions'],
    links: { github: 'https://github.com/quangshuynh/ordixa', release: 'https://github.com/quangshuynh/ordixa/releases/tag/v2.0.0' },
    // launch.mp4 is attached to the v2.0.0 release, not committed (6.9 MB), so
    // jsDelivr cannot serve it; the tag-versioned release URL is the stable one.
    video: {
      src: 'https://github.com/quangshuynh/ordixa/releases/download/v2.0.0/launch.mp4',
      page: 'https://github.com/quangshuynh/ordixa/releases/tag/v2.0.0',
      poster: githubAsset('ordixa', 'docs/media/thumbnail.jpg'),
      width: 1920,
      height: 1080,
      duration: 23,
      title: 'Ordixa v2.0.0 launch video',
      caption: 'v2.0.0 launch video: messy spreadsheet exports turned into validated results (fictional demo data)',
    },
    logo: {
      file: 'ordixa-logo',
      source: githubAsset('ordixa', 'docs/images/ordixa-logo2.png'),
      trim: true,
      width: 709,
      height: 780,
      alt: 'Ordixa logo',
    },
    screenshots: [
      {
        src: githubAsset('ordixa', 'docs/images/workbook-summary.png'),
        width: 1601,
        height: 1929,
        label: 'Summary',
        alt: 'Ordixa workbook Summary sheet with financial totals, exception counts, a reading guide, data quality counts, and input checksums',
        caption: 'Reconciliation summary (fictional demo data)',
      },
      {
        src: githubAsset('ordixa', 'docs/images/workbook-exceptions.png'),
        width: 1601,
        height: 501,
        label: 'Exceptions',
        alt: 'Ordixa Exceptions sheet listing unpaid, partially paid, and overpaid orders, each with a note on what to check',
        caption: 'Exceptions sheet (fictional demo data)',
      },
      {
        src: githubAsset('ordixa', 'docs/images/workbook-change-summary.png'),
        width: 817,
        height: 1057,
        label: 'Compare',
        alt: 'Ordixa change report Summary showing an Incomplete comparison result with its findings, then added, removed, modified, unchanged, ambiguous, and invalid record counts',
        caption: 'Comparison change report (fictional demo data)',
      },
      {
        src: githubAsset('ordixa', 'docs/images/cli-demo-run.png'),
        width: 1600,
        height: 2330,
        label: 'CLI',
        alt: 'Terminal output of the seven-step Ordixa demo, from source exports to nine passing manifest verification checks',
        caption: 'Guided demo run ending in manifest verification',
      },
    ],
  },
  {
    slug: 'scribekit',
    name: 'ScribeKit',
    category: 'Native Applications',
    tagline: 'Native macOS · On-device meeting transcription',
    summary: 'Native macOS app that captures selected application audio or a chosen microphone, transcribes it on device with Apple’s speech frameworks, and durably writes timestamped Markdown.',
    detail: 'ScreenCaptureKit app-audio capture, the SpeechAnalyzer stack with no network fallback, pause and resume, crash recovery, history search, uncertainty review, and a SHA-256 transcript seal that shows whether a saved file changed. Released as v0.2.0 and tested with fault injection and long-duration captures.',
    technologies: ['Swift', 'SwiftUI', 'ScreenCaptureKit', 'Speech', 'AVFoundation', 'Swift Testing'],
    links: { github: 'https://github.com/quangshuynh/scribekit', live: 'https://quangshuynh.github.io/scribekit/', liveLabel: 'Documentation' },
    logo: {
      file: 'scribekit-logo',
      source: githubAsset('scribekit', 'docs/images/scribekit-logo2.png'),
      alt: 'ScribeKit app logo',
    },
    screenshots: [
      {
        src: githubAsset('scribekit', 'docs/images/meeting-live.png'),
        width: 2120,
        height: 1782,
        alt: 'ScribeKit capturing a meeting with pause and stop controls and a timestamped live transcript',
        caption: 'ScribeKit live transcription',
      },
      {
        src: githubAsset('scribekit', 'docs/images/meeting-setup-app-audio.png'),
        width: 2120,
        height: 1782,
        alt: 'ScribeKit meeting setup with App Audio selected for QuickTime Player, a meeting title, language, audio retention, and save folder',
        caption: 'ScribeKit meeting setup',
      },
      {
        src: githubAsset('scribekit', 'docs/images/history-find.png'),
        width: 2120,
        height: 1784,
        alt: 'ScribeKit history searching past meetings for a word, with matches highlighted in the list and transcript',
        caption: 'ScribeKit history search and find',
      },
      {
        src: githubAsset('scribekit', 'docs/images/history-review.png'),
        width: 2120,
        height: 1782,
        alt: 'ScribeKit meeting details listing low-confidence passages to review, with play audio and mark reviewed actions',
        caption: 'ScribeKit uncertainty review',
      },
    ],
  },
  {
    slug: 'puzzlepress',
    name: 'PuzzlePress',
    category: 'Developer Tools & Automation',
    tagline: 'Print publishing pipeline · Python engine & React studio',
    summary: 'Deterministic Python engine and local web studio that takes a themed puzzle or coloring book from an approved plan to verified pages, a print-ready interior and full-wrap cover PDF, preflight checks, and a package for manual KDP upload.',
    detail: 'Seeded word-search generation with independent solution verification, coloring books from imported line art, ReportLab interiors preflighted against print and KDP structural rules, and covers whose spine width is derived from the interior and checked for bleed, safe areas, and effective DPI. A strictly typed core, CLI, and FastAPI-served React studio, with CI on Ubuntu and Windows across three Python versions. In active development; this describes the software, not published titles.',
    technologies: ['Python', 'ReportLab', 'pypdf', 'FastAPI', 'React', 'TypeScript', 'pytest', 'Playwright'],
    links: { github: 'https://github.com/quangshuynh/puzzlepress' },
    logo: {
      file: 'puzzlepress-logo',
      source: githubAsset('puzzlepress', 'docs/images/puzzlepress-logo.png'),
      alt: 'PuzzlePress project logo',
    },
    screenshots: [
      {
        src: githubAsset('puzzlepress', 'docs/images/studio/cover-1440.png'),
        width: 1440,
        height: 900,
        alt: 'PuzzlePress cover editor previewing a full-wrap paperback cover built from a harbour photograph, with crop controls and a 320 DPI print-quality check',
        caption: 'PuzzlePress cover editor',
      },
      {
        src: githubAsset('puzzlepress', 'docs/images/authoring/print-1440.png'),
        width: 1440,
        height: 900,
        alt: 'PuzzlePress print proof of a coloring book interior, with page thumbnails and a list of blocking and warning preflight findings',
        caption: 'Print proof with preflight findings',
      },
      {
        src: githubAsset('puzzlepress', 'docs/images/studio/print-spread.png'),
        width: 912,
        height: 940,
        alt: 'PuzzlePress print proof showing a rendered two-page spread, a puzzle page and a solutions page, with live-area and KDP margin overlays',
        caption: 'Print proof of rendered interior pages',
      },
      {
        src: githubAsset('puzzlepress', 'docs/images/studio/desktop.png'),
        width: 1440,
        height: 1471,
        alt: 'PuzzlePress solution view of a generated word search with highlighted placements, its seed, and an independently verified badge',
        caption: 'Generated puzzle with verified solution',
      },
    ],
  },
  {
    slug: 'flipper',
    name: 'Flipper',
    category: 'Web & Product Engineering',
    tagline: 'Python web app · Resale research, inventory & profit',
    summary: 'Local-first reseller toolkit for researching deals, modeling sourcing economics, managing inventory, and reconciling eBay sales from discovery through realized profit.',
    detail: 'Separates research estimates from authoritative accounting facts with immutable research snapshots and exact Decimal money; sold comparables, travel economics, and an explainable deal score; read-only eBay listing, order, and Finances APIs for sale reconciliation with explicit unknowns; verified backup and restore. Released as v0.2.1; runs locally.',
    technologies: ['Python', 'FastAPI', 'SQLite', 'Jinja', 'eBay APIs', 'pytest'],
    links: { github: 'https://github.com/quangshuynh/flipper', live: 'https://quangshuynh.github.io/flipper/', liveLabel: 'Documentation' },
    logo: {
      file: 'flipper-logo',
      source: githubAsset('flipper', 'docs/images/flipper-logo2.png'),
      alt: 'Flipper project logo',
    },
    screenshots: [
      {
        src: githubAsset('flipper', 'docs/images/flipper-dashboard.png'),
        width: 2880,
        height: 1800,
        alt: 'Flipper dashboard showing inventory, workflow state, attention items, and sales economics',
        caption: 'Flipper operational dashboard',
      },
      {
        src: githubAsset('flipper', 'docs/images/flipper-research.png'),
        width: 2880,
        height: 1800,
        alt: 'Flipper Deals workspace showing live eBay opportunities, research modes, and comparison candidates',
        caption: 'Flipper marketplace research workspace',
      },
      {
        src: githubAsset('flipper', 'docs/images/flipper-inventory.png'),
        width: 2880,
        height: 1800,
        alt: 'Flipper inventory showing Q-number records, lifecycle status, marketplace linkage, and sale references',
        caption: 'Flipper inventory workflow',
      },
      {
        src: githubAsset('flipper', 'docs/images/flipper-sale.png'),
        width: 2880,
        height: 1800,
        alt: 'Flipper sale detail showing seller revenue, fees, reconciliation state, and provisional realized economics',
        caption: 'Flipper sale reconciliation',
      },
    ],
  },
  {
    slug: 'inboxsweep',
    name: 'InboxSweep',
    category: 'Native Applications',
    tagline: 'Native macOS · Gmail cleanup with least-privilege access',
    summary: 'Privacy-conscious native macOS Gmail cleanup assistant that groups mail by sender, explains each cleanup recommendation, and previews changes before anything happens.',
    detail: 'Metadata-only Gmail access with explicit OAuth scope boundaries, a deterministic recommendation engine that states its evidence, dry-run previews, archive and undo that only move the Inbox label, safe List-Unsubscribe handling, and a synthetic mailbox for offline UI tests. Released as v1.0.0.',
    technologies: ['Swift', 'SwiftUI', 'Gmail API', 'OAuth 2.0', 'Keychain', 'XCTest'],
    links: { github: 'https://github.com/quangshuynh/inboxsweep', live: 'https://quangshuynh.github.io/inboxsweep/', liveLabel: 'Documentation' },
    logo: {
      file: 'inboxsweep-logo',
      source: githubAsset('inboxsweep', 'docs/images/inboxsweep-logo.png'),
      alt: 'InboxSweep project logo',
    },
  },
  {
    slug: 'devpulse',
    name: 'DevPulse',
    private: true,
    category: 'Developer Tools & Automation',
    tagline: 'Engineering observatory · Scheduled snapshots & dashboard',
    summary: 'Automated dashboard that records the state of a set of GitHub repositories twice a day, CI health, releases, open issues and pull requests, and turns those snapshots into daily summaries, trends, and an attention list.',
    detail: 'Immutable JSON snapshots per check, an attention rules engine, and a React dashboard that labels every figure as an observation with its coverage rather than an estimate. Public exports are built from an allowlist and fail if a withheld repository name appears. Private repository; screenshots use its synthetic fixture data.',
    technologies: ['Python', 'GitHub REST API', 'GitHub Actions', 'React', 'TypeScript', 'pytest'],
    links: {},
    screenshots: [
      {
        local: 'devpulse-overview',
        width: 1440,
        height: 900,
        alt: 'DevPulse overview of nine fixture repositories with summary counts, a fixture-data banner, and an observation timeline of checks per repository',
        caption: 'DevPulse overview (synthetic fixture data)',
      },
      {
        local: 'devpulse-trends',
        width: 1440,
        height: 900,
        alt: 'DevPulse historical trends with checks per day, open issues and pull requests charts, and a per-repository coverage table',
        caption: 'DevPulse trends (synthetic fixture data)',
      },
      {
        local: 'devpulse-repo-detail',
        width: 1440,
        height: 900,
        alt: 'DevPulse repository detail for a fixture repository with CI status, open issues, commits, and a thirty-day observation timeline',
        caption: 'DevPulse repository detail (synthetic fixture data)',
      },
    ],
  },
  {
    slug: 'carebridge',
    name: 'CareBridge',
    category: 'Native Applications',
    tagline: 'Flutter · Accessible communication for nonverbal people',
    summary: 'Local-first communication app that helps nonverbal people express everyday wants and needs through six large choices, spoken aloud with text-to-speech.',
    detail: 'Large touch targets, haptics, a hold-to-enable high-contrast mode, caregiver customization of choices, and offline backup export and import, with no account or backend. Layouts for phones and tablets in both orientations. Early-stage and not a medical device; physical-device testing is still to come.',
    technologies: ['Dart', 'Flutter', 'Text-to-speech', 'flutter_test'],
    links: { github: 'https://github.com/quangshuynh/carebridge', live: 'https://quangshuynh.github.io/carebridge/', liveLabel: 'Documentation' },
    logo: {
      file: 'carebridge-logo',
      source: githubAsset('carebridge', 'docs/images/carebridge-logo.png'),
      alt: 'CareBridge project logo',
    },
    screenshots: [
      {
        src: githubAsset('carebridge', 'docs/images/screenshots/tablet-landscape-selected.png'),
        width: 2360,
        height: 1640,
        alt: 'CareBridge on a tablet with Food selected among six large choices and the phrase I would like something to eat',
        caption: 'CareBridge on a tablet',
      },
      {
        src: githubAsset('carebridge', 'docs/images/screenshots/phone-portrait-high-contrast.png'),
        width: 780,
        height: 1688,
        alt: 'CareBridge on a phone in high-contrast mode with six large choices',
        caption: 'High-contrast mode on a phone',
      },
    ],
  },
  {
    slug: 'chessed',
    name: 'Chessed',
    category: 'Web & Product Engineering',
    tagline: 'Next.js · In-browser Stockfish game review',
    summary: 'Chess game reviewer that analyzes recent Chess.com games or pasted PGN with Stockfish running in the browser, then explains each move with engine-backed classifications.',
    detail: 'Cancellable MultiPV analysis in a Web Worker, mover-relative evaluation, an accuracy score calibrated against a recorded dataset, an evaluation graph, deterministic move explanations, keyboard navigation, and Markdown report export, with regression tests across curated positions. Not affiliated with Chess.com.',
    technologies: ['Next.js', 'TypeScript', 'Stockfish', 'Web Workers', 'chess.js', 'Vitest', 'Playwright'],
    links: { github: 'https://github.com/quangshuynh/chessed', live: 'https://chessed.vercel.app/' },
    logo: {
      file: 'chessed-logo',
      source: githubAsset('chessed', 'docs/images/chessed-logo.png'),
      alt: 'Chessed project logo',
    },
    // Captured from the live site; the repository has no screenshots yet.
    screenshots: [
      {
        local: 'chessed-review',
        width: 1440,
        height: 900,
        alt: 'Chessed reviewing an analyzed game: the board with accuracy for each player, the engine explanation of the selected move, and a move list with classifications',
        caption: 'Chessed game review (live site)',
      },
    ],
  },
  {
    slug: 'casenotes',
    name: 'CaseNotes',
    category: 'Native Applications',
    tagline: 'Native iOS · Local-first Markdown notes',
    summary: 'Local-first native iOS notes app built with SwiftUI and SwiftData for Markdown writing, nested organization, drawings, version history, and export.',
    detail: 'Draft-based Save and Cancel editing, SwiftData persistence with migration coverage, safe nested-folder deletion, PencilKit drawings, real-text PDF export, Face ID lock and privacy shielding, and accessibility support. Released as v1.1.0.',
    technologies: ['Swift', 'SwiftUI', 'SwiftData', 'PencilKit'],
    links: { github: 'https://github.com/quangshuynh/casenotes', live: 'https://quangshuynh.github.io/casenotes/', liveLabel: 'Documentation' },
    logo: {
      file: 'casenotes-logo',
      source: githubAsset('casenotes', 'docs/images/casenotes-logo.png'),
      alt: 'CaseNotes project logo',
    },
    screenshots: [
      {
        src: githubAsset('casenotes', 'docs/screenshots/library-dark.png'),
        width: 1206,
        height: 2622,
        alt: 'CaseNotes library in dark mode with All Notes, folders, and recent notes',
        caption: 'CaseNotes library',
      },
      {
        src: githubAsset('casenotes', 'docs/screenshots/note-markdown-dark.png'),
        width: 1206,
        height: 2622,
        alt: 'CaseNotes rendering a Markdown note with headings, bold text, and a bulleted list',
        caption: 'Rendered Markdown note',
      },
      {
        src: githubAsset('casenotes', 'docs/screenshots/drawing-dark.png'),
        width: 1206,
        height: 2622,
        alt: 'CaseNotes PencilKit drawing canvas with a sketch and the tool palette',
        caption: 'PencilKit drawing',
      },
    ],
  },
  {
    slug: 'homemade',
    name: 'Homemade',
    category: 'Games & Creative Engineering',
    tagline: 'Browser game · Offline-first PWA',
    summary: 'Cozy baking game about combining ingredients to discover recipes, decorating a kitchen, and following story arcs, playable offline in the browser.',
    detail: 'React 19 and TypeScript with no game engine: IndexedDB saves through a small wrapper with versioned, tested migrations (save format v7), a hand-written service worker for offline play, and sound effects synthesized by a build script. In active development.',
    technologies: ['React', 'TypeScript', 'Vite', 'IndexedDB', 'Service Worker', 'Vitest'],
    links: { github: 'https://github.com/quangshuynh/homemade', live: 'https://homemade-bake.vercel.app/', liveLabel: 'Play' },
    logo: {
      file: 'homemade-logo',
      source: githubAsset('homemade', 'docs/images/homemade-logo.png'),
      alt: 'Homemade game logo',
    },
    // Captured from the live game; the repository has no screenshots yet.
    screenshots: [
      {
        local: 'homemade-kitchen',
        width: 1440,
        height: 900,
        alt: 'Homemade kitchen named Sunny Kitchen with the baker level, Marmalade the cat, a mixing bowl on the counter, and Bake, Recipe Book, and Pantry tabs',
        caption: 'Homemade (live game)',
      },
    ],
  },
  {
    slug: 'mover-git',
    name: 'Mover-Git',
    category: 'Developer Tools & Automation',
    tagline: 'Python desktop utility · Verified file transfers into Git',
    summary: 'Tkinter desktop tool that previews files, moves them into a Git repository, and commits and pushes them in size-limited batches.',
    detail: 'Built for data safety: hash verification, sources removed only after a verified push, per-file and per-batch size limits, and durable pause, resume, cancel, and crash recovery. Released as v1.0.0, with recovery hardening merged since.',
    technologies: ['Python', 'Tkinter', 'Git', 'pytest'],
    links: { github: 'https://github.com/quangshuynh/mover-git' },
    logo: {
      file: 'mover-git-logo',
      source: githubAsset('mover-git', 'docs/images/logo.png'),
      alt: 'Mover-Git project logo',
    },
  },
  {
    slug: '585photo585',
    name: '585photo585',
    private: true,
    category: 'Web & Product Engineering',
    tagline: 'Photography portfolio & lightweight CMS',
    summary: 'Custom photography portfolio and lightweight CMS built and deployed for a family-owned Rochester photography business.',
    detail: 'Responsive editorial galleries, progressive loading, and full-screen lightbox navigation, with a protected admin workflow for direct uploads to private storage, metadata and alt text, publishing, and drag-to-reorder gallery management, secured by Supabase row-level security.',
    technologies: ['React', 'Vite', 'Supabase', 'PostgreSQL', 'Storage', 'Auth & RLS'],
    links: { live: 'https://www.585photo585.com', liveLabel: 'Live Site' },
    // Private repository: logo and capture are kept locally.
    logo: { file: '585photo585-logo', alt: '585photo585 project logo' },
    screenshots: [
      {
        local: '585photo585-portfolio',
        width: 1440,
        height: 1050,
        alt: '585photo585 editorial photography portfolio homepage with Featured, Portraits, and Clips collections',
        caption: '585photo585 project preview',
      },
    ],
  },
  {
    slug: 'repo-radar',
    name: 'Repo Radar',
    // Off the page: overlaps GitProfileLens as GitHub tooling. Kept so it can be restored.
    hidden: true,
    category: 'Developer Tools & Automation',
    summary: 'Personalized GitHub discovery tool for finding relevant repositories and open-source contribution opportunities from developer interests, feedback, and discovery history.',
    detail: 'Uses deterministic, explainable ranking to balance relevance, quality, activity, novelty, and diversity, with bounded GitHub issue discovery and reproducible offline evaluation.',
    technologies: ['Python', 'FastAPI', 'GitHub API', 'Recommendation Systems'],
    links: { github: 'https://github.com/quangshuynh/repo-radar' },
    logo: {
      file: 'repo-radar-logo',
      source: githubAsset('repo-radar', 'docs/repo-radar-logo.png'),
      alt: 'Repo Radar project logo',
      className: 'repo-radar-logo',
    },
  },
];

export const featuredProjects = projects.filter((project) => project.featured && !project.hidden);
export const moreProjects = projects.filter((project) => !project.featured && !project.hidden);
