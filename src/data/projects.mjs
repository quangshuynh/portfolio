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
// - Private repositories (585dashcam585, 585photo585) have no public raw URLs,
//   so their images stay local: `{ local: '<optimized file name>' }`.
//
// This file is plain data with no asset imports so Node scripts can read it.
import { githubAsset } from './githubAssets.mjs';

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
    slug: 'ordixa',
    name: 'Ordixa',
    featured: true,
    label: 'Python CLI · Data cleaning, reconciliation & comparison',
    takeaway: 'Deterministic, auditable results: every held-back row has a reason, and every run can be re-verified.',
    summary: 'Command-line toolkit that cleans inconsistent CSV and Excel exports, reconciles orders against payments, and compares two versions of a dataset, driven by versioned TOML profiles. Released as v2.0.0 and exercised so far on fictional demo data.',
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
    slug: '585dashcam585',
    name: '585Dashcam585',
    featured: true,
    label: 'Production commerce platform',
    takeaway: 'Production checkout and order processing with reliable payment finalization.',
    summary: 'Built and deployed a full-stack commerce platform for a family-owned Rochester automotive services business, replacing its hosted website with a custom production application.',
    highlights: [
      'Runs guest and authenticated checkout with server-authoritative pricing, live Stripe payments, signed webhooks, and idempotent PostgreSQL order finalization',
      'Provides customer accounts, persistent carts and wishlists, order history, and a protected admin CRM for customers, fulfillment, catalog data, and analytics',
      'Sends transactional email through Resend with database-backed delivery state, retry handling, stale-claim recovery, and duplicate-delivery protection',
      'Deployed with Cloudflare Workers and Static Assets, Supabase authentication and RLS, least-privilege credentials, and privacy-conscious Cloudflare analytics',
    ],
    technologies: ['React', 'Vite', 'JavaScript', 'Cloudflare Workers', 'Supabase', 'PostgreSQL', 'Stripe', 'Resend', 'Cloudflare GraphQL Analytics API'],
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
    slug: 'dashpilot',
    name: 'DashPilot',
    featured: true,
    label: 'Native iOS · Gig-work tracking & earnings',
    takeaway: 'A truthful, local-first record of gig work: what a shift paid, per hour and per mile, without platform integrations.',
    summary: 'Local-first iOS app for gig and delivery drivers that records shifts, stacked deliveries, routes, earnings, mileage, and expenses on device, and reports only what that recorded history supports.',
    highlights: [
      'Models stacked delivery lifecycles, pickup waits, Park & Resume, corrections, and historical journeys while preserving recorded delivery facts',
      'Organizes the app into Home, Work, and Money workspaces, with weekly recorded earnings, expenses, qualified net, period summaries, and reports that show the coverage behind each figure',
      'Keeps authoritative records separate from estimates and derived per-hour and per-mile metrics, and exports one shift, a period, or all history as JSON and CSV',
      'Uses a Live Activity and App Intents for the running shift, Core Location with When In Use authorization only, and versioned SwiftData schemas with tested migrations; no DoorDash or other platform integration',
    ],
    technologies: ['Swift', 'SwiftUI', 'SwiftData', 'Core Location', 'ActivityKit', 'App Intents', 'Swift Testing'],
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
        alt: 'DashPilot Work workspace during a running shift with worked time, two stacked deliveries, and the next delivery step',
        caption: 'Work workspace with stacked deliveries',
      },
      {
        src: githubAsset('dashpilot', 'docs/images/screenshots/home-workspace.png'),
        width: 1206,
        height: 2622,
        label: 'Home',
        alt: 'DashPilot Home workspace with a Start Shift control and links to work history and money',
        caption: 'Home workspace',
      },
      {
        src: githubAsset('dashpilot', 'docs/images/screenshots/money-workspace.png'),
        width: 1206,
        height: 2622,
        label: 'Money',
        alt: 'DashPilot Money workspace linking to recorded expenses and period summaries',
        caption: 'Money workspace',
      },
      {
        src: githubAsset('dashpilot', 'docs/images/screenshots/period-summary.png'),
        width: 600,
        height: 1304,
        label: 'Summary',
        alt: 'DashPilot period summary showing recorded earnings, per-hour rates, and working time',
        caption: 'Period summary',
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
    highlights: [
      'Transactional outbox in PostgreSQL: the API stores the submission and its delivery job together and never makes an outbound request, so a crash cannot lose acknowledged work; PostgreSQL is the queue, with no broker or Redis',
      'Separate delivery worker with leases, exponential backoff, and crash recovery; v0.2.1 adds claim-token fencing so a stale worker cannot overwrite a delivery another worker has reclaimed (delivery stays at-least-once, as documented)',
      'Idempotency-Key retries, HMAC-SHA256 signatures over the raw body, distributed per-source and per-endpoint rate limiting, and management API keys created by an operator CLI and stored only as digests',
      'Operator tools for delivery replay, attempt history, filtered JSON and CSV export, and retention cleanup that never deletes a submission a delivery could still need',
      'Tested against real PostgreSQL, including concurrency and stale-worker races, with Alembic migrations, a startup revision check, and model drift tests',
    ],
    technologies: ['Python', 'FastAPI', 'PostgreSQL', 'SQLAlchemy', 'Alembic', 'pytest'],
    links: { github: 'https://github.com/hymical/forms', documentation: 'https://hymical.github.io/forms/' },
    // No product screenshots exist; the card shows the logo alone.
    logo: {
      file: 'hymical-forms-logo',
      // The largest transparent mark in the repository is 214x190.
      source: githubAsset('hymical-forms', 'docs/images/logo_symbol_transparent.png'),
      width: 214,
      height: 190,
      alt: 'Hymical Forms project logo',
    },
  },
  {
    slug: 'scribekit',
    name: 'ScribeKit',
    featured: true,
    label: 'Native macOS · Audio capture & on-device transcription',
    takeaway: 'On-device transcription designed to preserve work through interruptions.',
    summary: 'Native macOS meeting transcription that captures selected application audio or a chosen microphone, transcribes it on-device with Apple speech frameworks, and durably writes timestamped Markdown.',
    highlights: [
      'Captures either user-selected application audio through ScreenCaptureKit or a chosen microphone, with one source per meeting and optional local audio retention',
      'Uses Apple’s on-device SpeechAnalyzer and SpeechTranscriber stack with no network fallback',
      'Preserves finalized speech with pause/resume, background operation, interruption handling, crash recovery, history search, and uncertainty review',
      'Validated with extensive automated testing, fault injection, long-duration capture testing, and manual keyboard and VoiceOver release checks',
    ],
    technologies: ['Swift', 'SwiftUI', 'ScreenCaptureKit', 'Speech', 'AVFoundation', 'macOS', 'Swift Testing'],
    links: { github: 'https://github.com/quangshuynh/scribekit', documentation: 'https://quangshuynh.github.io/scribekit/' },
    logo: {
      file: 'scribekit-logo',
      source: githubAsset('scribekit', 'docs/images/scribekit-logo2.png'),
      width: 780,
      height: 730,
      alt: 'ScribeKit app logo',
    },
    tallScreenshots: true,
    screenshots: [
      {
        src: githubAsset('scribekit', 'docs/images/meeting-setup-app-audio.png'),
        width: 2120,
        height: 1782,
        label: 'Setup',
        alt: 'ScribeKit meeting setup with App Audio selected for QuickTime Player, a meeting title, language, audio retention, and save folder',
        caption: 'ScribeKit meeting setup',
      },
      {
        src: githubAsset('scribekit', 'docs/images/meeting-live.png'),
        width: 2120,
        height: 1782,
        label: 'Live',
        alt: 'ScribeKit capturing a meeting with pause and stop controls and a timestamped live transcript',
        caption: 'ScribeKit live transcription',
      },
      {
        src: githubAsset('scribekit', 'docs/images/history-find.png'),
        width: 2120,
        height: 1784,
        label: 'Find',
        alt: 'ScribeKit history searching past meetings for a word, with matches highlighted in the list and transcript',
        caption: 'ScribeKit history search and find',
      },
      {
        src: githubAsset('scribekit', 'docs/images/history-review.png'),
        width: 2120,
        height: 1782,
        label: 'Review',
        alt: 'ScribeKit meeting details listing low-confidence passages to review, with play audio and mark reviewed actions',
        caption: 'ScribeKit uncertainty review',
      },
    ],
  },
  {
    slug: 'flipper',
    name: 'Flipper',
    featured: true,
    label: 'Python web app · Resale research, inventory & profit',
    takeaway: 'Exact financial accounting from deal research through realized profit.',
    summary: 'Local-first reseller toolkit for researching deals, modeling sourcing economics, managing inventory, and reconciling marketplace sales from discovery through outcome.',
    highlights: [
      'Separates research estimates from authoritative accounting facts with immutable research snapshots, explicit acquisition state, and exact Decimal-based money semantics',
      'Researches marketplace opportunities with active and sold comparables, provenance-aware evidence, travel economics, and deterministic deal scoring',
      'Tracks inventory through acquisition and sale, including completed-order imports, buyer-paid shipping, marketplace fees, collect-and-remit taxes, and provisional economics when acquisition facts are incomplete',
      'Compares frozen pre-purchase expectations against authoritative sale outcomes while keeping external marketplace failures isolated from local records',
    ],
    technologies: ['Python', 'FastAPI', 'SQLite', 'Jinja', 'eBay APIs', 'pytest'],
    links: { github: 'https://github.com/quangshuynh/flipper', documentation: 'https://quangshuynh.github.io/flipper/' },
    logo: {
      file: 'flipper-logo',
      source: githubAsset('flipper', 'docs/images/flipper-logo2.png'),
      width: 780,
      height: 780,
      alt: 'Flipper project logo',
    },
    screenshots: [
      {
        src: githubAsset('flipper', 'docs/images/flipper-dashboard.png'),
        width: 2880,
        height: 1800,
        label: 'Dashboard',
        alt: 'Flipper dashboard showing inventory, workflow state, attention items, and sales economics',
        caption: 'Flipper operational dashboard',
      },
      {
        src: githubAsset('flipper', 'docs/images/flipper-research.png'),
        width: 2880,
        height: 1800,
        label: 'Research',
        alt: 'Flipper Deals workspace showing live eBay opportunities, research modes, and comparison candidates',
        caption: 'Flipper marketplace research workspace',
      },
      {
        src: githubAsset('flipper', 'docs/images/flipper-inventory.png'),
        width: 2880,
        height: 1800,
        label: 'Inventory',
        alt: 'Flipper inventory showing Q-number records, lifecycle status, marketplace linkage, and sale references',
        caption: 'Flipper inventory workflow',
      },
      {
        src: githubAsset('flipper', 'docs/images/flipper-sale.png'),
        width: 2880,
        height: 1800,
        label: 'Sale',
        alt: 'Flipper sale detail showing seller revenue, fees, reconciliation state, and provisional realized economics',
        caption: 'Flipper sale reconciliation',
      },
    ],
  },
  {
    slug: 'puzzlepress',
    name: 'PuzzlePress',
    summary: 'Deterministic Python engine and local web studio that takes a themed puzzle book from an approved plan to verified puzzles, a print-ready interior and full-wrap cover PDF, preflight checks, and a package for manual KDP upload.',
    detail: 'Seeded word-search generation with independent solution verification; deterministic ReportLab interiors preflighted against print and KDP structural rules; covers whose spine width is derived from the interior and checked for bleed, safe areas, and effective DPI; a strictly typed core and CLI behind a FastAPI-served React studio. This entry describes the production software, not published titles.',
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
    slug: 'gitprofilelens',
    name: 'GitProfileLens',
    summary: 'Live web tool that turns a public GitHub profile into a transparent 0–100 presentation score with ranked, actionable recommendations, without claiming to measure developer ability.',
    detail: 'Deterministic scoring over GitHub REST and GraphQL data, pinned-repository and portfolio-candidate recommendations, an optional read-only GitHub App for private repositories with strict public/private output boundaries, and regression baselines against a representative evaluation corpus. Released as v1.3.1.',
    technologies: ['JavaScript', 'Node.js', 'GitHub REST/GraphQL APIs', 'Vercel', 'Playwright'],
    links: { github: 'https://github.com/quangshuynh/gitprofilelens', live: 'https://gitprofilelens.vercel.app/' },
    logo: {
      file: 'gitprofilelens-logo',
      source: githubAsset('gitprofilelens', 'docs/images/logo.png'),
      alt: 'GitProfileLens project logo',
    },
    screenshots: [
      {
        src: githubAsset('gitprofilelens', 'docs/images/gitprofilelens-audit.png'),
        width: 1440,
        height: 1100,
        alt: 'GitProfileLens audit dashboard showing presentation and discoverability scores with prioritized recommendations',
        caption: 'GitProfileLens audit results',
      },
    ],
  },
  {
    slug: 'inboxsweep',
    name: 'InboxSweep',
    summary: 'Privacy-conscious native macOS Gmail cleanup assistant that groups mail by sender, explains cleanup recommendations, and previews changes before anything happens.',
    detail: 'Built with metadata-only Gmail access, explicit OAuth scope boundaries, dry-run cleanup previews, confirmed archive and undo flows, safe unsubscribe handling, and synthetic offline test data. Released as v1.0.0.',
    technologies: ['Swift', 'SwiftUI', 'Gmail API', 'OAuth 2.0', 'Keychain'],
    links: { github: 'https://github.com/quangshuynh/inboxsweep', live: 'https://quangshuynh.github.io/inboxsweep/', liveLabel: 'Documentation' },
    logo: {
      file: 'inboxsweep-logo',
      source: githubAsset('inboxsweep', 'docs/images/inboxsweep-logo.png'),
      alt: 'InboxSweep project logo',
    },
  },
  {
    slug: '585photo585',
    name: '585photo585',
    summary: 'Custom photography portfolio and lightweight CMS built and deployed for a family-owned Rochester photography business.',
    detail: 'Responsive editorial galleries, progressive loading, and full-screen lightbox navigation, with a protected admin workflow for direct uploads, metadata and alt text, publishing, drag-and-drop ordering, and deletion.',
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
    slug: 'casenotes',
    name: 'CaseNotes',
    summary: 'Local-first native iOS notes app built with SwiftUI and SwiftData for Markdown writing, nested organization, drawings, version history, and export.',
    detail: 'Uses draft-based Save/Cancel editing, SwiftData persistence and migration coverage, safe nested-folder deletion, PencilKit drawings, real-text PDF export, interface gating, privacy shielding, and accessibility support. Released as v1.1.0.',
    technologies: ['Swift', 'SwiftUI', 'SwiftData', 'PencilKit'],
    links: { github: 'https://github.com/quangshuynh/casenotes', live: 'https://quangshuynh.github.io/casenotes/', liveLabel: 'Documentation' },
    logo: {
      file: 'casenotes-logo',
      source: githubAsset('casenotes', 'docs/images/casenotes-logo.png'),
      alt: 'CaseNotes project logo',
    },
  },
  {
    slug: 'chessed',
    name: 'Chessed',
    summary: 'Chess game review app (MVP) that analyzes PGNs or recent Chess.com games with Stockfish and explains move quality through engine-backed classifications and evaluations.',
    detail: 'Runs Stockfish in a Web Worker with cancellable MultiPV analysis, mover-relative evaluation, explainable move classifications, and regression testing across curated chess positions.',
    technologies: ['Next.js', 'TypeScript', 'Stockfish', 'Web Workers'],
    links: { github: 'https://github.com/quangshuynh/chessed', live: 'https://chessed.vercel.app/' },
    logo: {
      file: 'chessed-logo',
      source: githubAsset('chessed', 'docs/images/chessed-logo.png'),
      alt: 'Chessed project logo',
    },
  },
  {
    slug: 'repo-radar',
    name: 'Repo Radar',
    // Off the page: overlaps GitProfileLens as GitHub tooling. Kept so it can be restored.
    hidden: true,
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
