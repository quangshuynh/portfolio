// Single source of truth for every project on the homepage.
//
// - `featured: true` projects render as case files in "Featured projects", in
//   array order; the rest render in "More projects", also in array order.
// - Screenshots of public projects are commit-pinned jsDelivr URLs built by
//   githubAsset(); see docs/project-assets.md.
// - Logos are tiny on the page, so they are served as display-sized WebP
//   derivatives (`logo.file` in src/assets/optimized). `logo.source` records the
//   pinned GitHub original that `npm run prepare:images` derives them from.
// - Private repositories (585dashcam585, 585photo585) have no public raw URLs,
//   so their images stay local: `{ local: '<optimized file name>' }`.
//
// This file is plain data with no asset imports so Node scripts can read it.
import { githubAsset } from './githubAssets.mjs';

/** @typedef {{ src?: string, local?: string, width: number, height: number, alt: string, caption: string, label?: string }} ProjectImage */
/** @typedef {{ file: string, source?: string, width?: number, height?: number, alt: string, className?: string }} ProjectLogo */

export const projects = [
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
    slug: 'flipper',
    name: 'Flipper',
    featured: true,
    label: 'Backend · Reselling & marketplace tooling',
    takeaway: 'Exact financial accounting from deal research through realized profit.',
    summary: 'Local-first reseller toolkit for researching deals, modeling sourcing economics, managing inventory, and reconciling marketplace sales from discovery through outcome.',
    highlights: [
      'Separates research estimates from authoritative accounting facts with immutable research snapshots, explicit acquisition state, and exact Decimal-based money semantics',
      'Researches marketplace opportunities with active and sold comparables, provenance-aware evidence, travel economics, and deterministic deal scoring',
      'Tracks inventory through acquisition and sale, including completed-order imports, buyer-paid shipping, marketplace fees, collect-and-remit taxes, and provisional economics when acquisition facts are incomplete',
      'Compares frozen pre-purchase expectations against authoritative sale outcomes while keeping external marketplace failures isolated from local records',
    ],
    technologies: ['Python', 'FastAPI', 'SQLite', 'Jinja', 'eBay APIs', 'pytest'],
    links: { github: 'https://github.com/quangshuynh/flipper' },
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
        width: 1600,
        height: 1000,
        label: 'Dashboard',
        alt: 'Flipper dashboard showing inventory, workflow state, attention items, and sales economics',
        caption: 'Flipper operational dashboard',
      },
      {
        src: githubAsset('flipper', 'docs/images/flipper-research.png'),
        width: 1600,
        height: 1000,
        label: 'Research',
        alt: 'Flipper Deals workspace showing live eBay opportunities, research modes, and comparison candidates',
        caption: 'Flipper marketplace research workspace',
      },
      {
        src: githubAsset('flipper', 'docs/images/flipper-inventory.png'),
        width: 1600,
        height: 1000,
        label: 'Inventory',
        alt: 'Flipper inventory showing Q-number records, lifecycle status, marketplace linkage, and sale references',
        caption: 'Flipper inventory workflow',
      },
      {
        src: githubAsset('flipper', 'docs/images/flipper-sale.png'),
        width: 1600,
        height: 1000,
        label: 'Sale',
        alt: 'Flipper sale detail showing seller revenue, fees, reconciliation state, and provisional realized economics',
        caption: 'Flipper sale reconciliation',
      },
    ],
  },
  {
    slug: 'gitprofilelens',
    name: 'GitProfileLens',
    featured: true,
    label: 'Developer tooling · GitHub APIs & authenticated data',
    takeaway: 'Explainable GitHub portfolio analysis with strict privacy boundaries.',
    summary: 'Audits GitHub profiles and repositories with transparent, deterministic rules to improve portfolio presentation, discoverability, and project selection without claiming to measure developer ability.',
    highlights: [
      'Analyzes public repository metadata with GitHub REST/GraphQL APIs using deterministic presentation scoring, portfolio candidacy, and pinned-repository recommendations',
      'Supports authorized private repositories through a read-only GitHub App with encrypted session material and strict public/private output boundaries',
      'Adds contribution discovery and follower/following analysis while withholding conclusions when GitHub data is incomplete or ambiguous',
      'Validates scoring and recommendations against a representative evaluation corpus with regression baselines designed to expose unintended behavior changes',
    ],
    technologies: ['JavaScript', 'Node.js', 'GitHub REST/GraphQL APIs', 'Vercel', 'Playwright'],
    links: { github: 'https://github.com/quangshuynh/gitprofilelens', live: 'https://gitprofilelens.vercel.app/' },
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
        label: 'Results',
        alt: 'GitProfileLens audit dashboard showing presentation and discoverability scores with prioritized recommendations',
        caption: 'GitProfileLens audit results',
      },
    ],
  },
  {
    slug: 'scribekit',
    name: 'ScribeKit',
    featured: true,
    label: 'Native macOS · Audio, transcription & reliability',
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
    slug: 'dashpilot',
    name: 'DashPilot',
    featured: true,
    label: 'Native iOS · Delivery workflow & local-first data',
    takeaway: 'Reliable shift and delivery tracking without cloud accounts or platform integrations.',
    summary: 'Local-first iOS companion for delivery drivers that tracks shifts, stacked deliveries, journeys, earnings, mileage, expenses, and performance without relying on delivery-platform integrations.',
    highlights: [
      'Models stacked delivery lifecycles, pickup waits, corrections, Park & Resume workflows, and historical journeys while preserving recorded delivery facts',
      'Tracks mileage, earnings, vehicle and fuel costs, and weekly performance while keeping authoritative records separate from estimates and derived metrics',
      'Integrates Live Activities and App Intents for glanceable delivery status and faster interaction during active shifts',
      'Persists driver data locally with SwiftData and supports corrections and exports without requiring an external account or delivery-platform connection',
    ],
    technologies: ['Swift', 'SwiftUI', 'SwiftData', 'Core Location', 'ActivityKit', 'App Intents', 'Swift Testing'],
    links: { github: 'https://github.com/quangshuynh/dashpilot' },
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
        src: githubAsset('dashpilot', 'docs/images/screenshots/home-stacked-deliveries.png'),
        width: 1206,
        height: 2622,
        label: 'Shift',
        alt: 'DashPilot home screen during an active shift with stacked deliveries',
        caption: 'Stacked delivery workflow',
      },
      {
        src: githubAsset('dashpilot', 'docs/images/screenshots/offer-sheet-three-shared.png'),
        width: 1206,
        height: 2622,
        label: 'Delivery',
        alt: 'DashPilot offer sheet showing a multi-delivery offer',
        caption: 'Multi-delivery offer',
      },
      {
        src: githubAsset('dashpilot', 'docs/images/screenshots/history-current-week.png'),
        width: 1206,
        height: 2622,
        label: 'History',
        alt: 'DashPilot history showing delivery activity for the current week',
        caption: 'Weekly delivery history',
      },
      {
        src: githubAsset('dashpilot', 'docs/images/screenshots/period-summary.png'),
        width: 600,
        height: 1304,
        label: 'Performance',
        alt: 'DashPilot period summary showing delivery performance and earnings metrics',
        caption: 'Performance summary',
      },
    ],
  },
  {
    slug: 'hymical-forms',
    name: 'Hymical Forms',
    summary: 'Self-hostable form ingestion service with durable, signed webhook delivery and production-minded failure handling.',
    detail: 'Built around idempotent submissions, a transactional PostgreSQL outbox, leased workers with ownership fencing, HMAC-signed webhooks, and real PostgreSQL concurrency tests.',
    technologies: ['Python', 'FastAPI', 'PostgreSQL', 'SQLAlchemy'],
    links: { github: 'https://github.com/hymical/forms' },
    logo: {
      file: 'hymical-forms-logo',
      source: githubAsset('hymical-forms', 'docs/images/logo_symbol_transparent.png'),
      alt: 'Hymical Forms project logo',
    },
  },
  {
    slug: 'ordixa',
    name: 'Ordixa',
    tagline: 'Business data workflows, simplified.',
    summary: 'Small-business data tool that imports CSV and Excel exports, validates and normalizes them through reusable import profiles, reconciles orders against payments, and delivers every exception in a structured Excel workbook.',
    detail: 'Versioned TOML profiles map each business’s headers, IDs, dates, and refund signs onto one model; exact Decimal parsing, duplicate and collision safeguards, and source-row tracing explain every rejected row; checksummed run manifests make each result verifiable. Runs locally as a command-line tool and has so far been exercised on fictional demo data.',
    technologies: ['Python', 'pandas', 'openpyxl', 'CSV & Excel', 'pytest'],
    links: { github: 'https://github.com/quangshuynh/ordixa' },
    logo: {
      file: 'ordixa-logo',
      source: githubAsset('ordixa', 'docs/images/ordixa-logo2.png'),
      trim: true,
      alt: 'Ordixa logo',
    },
    screenshots: [
      {
        src: githubAsset('ordixa', 'docs/images/workbook-summary.png'),
        width: 1601,
        height: 1929,
        alt: 'Ordixa workbook Summary sheet with financial totals, exception counts, a reading guide, data quality counts, and input checksums',
        caption: 'Ordixa reconciliation summary (fictional demo data)',
      },
      {
        src: githubAsset('ordixa', 'docs/images/workbook-exceptions.png'),
        width: 1601,
        height: 501,
        alt: 'Ordixa Exceptions sheet listing unpaid, partially paid, and overpaid orders, each with a note on what to check',
        caption: 'Ordixa exceptions sheet (fictional demo data)',
      },
      {
        src: githubAsset('ordixa', 'docs/images/cli-inspect.png'),
        width: 1600,
        height: 1696,
        alt: 'Terminal output of Ordixa inspect describing each column of three demo exports with identifier, date, amount, and personal-data suggestions',
        caption: 'Read-only inspection of unfamiliar exports',
      },
      {
        src: githubAsset('ordixa', 'docs/images/cli-demo-run.png'),
        width: 1600,
        height: 2330,
        alt: 'Terminal output of the seven-step Ordixa demo, from source exports to nine passing manifest verification checks',
        caption: 'Guided demo run ending in manifest verification',
      },
    ],
  },
  {
    slug: 'repo-radar',
    name: 'Repo Radar',
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
  {
    slug: 'chessed',
    name: 'Chessed',
    summary: 'Chess game review app that analyzes PGNs with Stockfish and explains move quality through engine-backed classifications and evaluations.',
    detail: 'Runs Stockfish in a Web Worker with cancellable MultiPV analysis, mover-relative evaluation, explainable move classifications, and regression testing across curated chess positions.',
    technologies: ['Next.js', 'TypeScript', 'Stockfish', 'Web Workers'],
    links: { github: 'https://github.com/quangshuynh/chessed' },
    logo: {
      file: 'chessed-logo',
      source: githubAsset('chessed', 'docs/images/chessed-logo.png'),
      alt: 'Chessed project logo',
    },
  },
  {
    slug: 'casenotes',
    name: 'CaseNotes',
    summary: 'Local-first native iOS notes app built with SwiftUI and SwiftData for Markdown writing, nested organization, drawings, version history, and export.',
    detail: 'Uses draft-based Save/Cancel editing, SwiftData persistence and migration coverage, safe nested-folder deletion, PencilKit drawings, real-text PDF export, interface gating, privacy shielding, and accessibility support.',
    technologies: ['Swift', 'SwiftUI', 'SwiftData', 'PencilKit'],
    links: { github: 'https://github.com/quangshuynh/casenotes', live: 'https://quangshuynh.github.io/casenotes/', liveLabel: 'Documentation' },
    logo: {
      file: 'casenotes-logo',
      source: githubAsset('casenotes', 'docs/images/casenotes-logo.png'),
      alt: 'CaseNotes project logo',
    },
  },
  {
    slug: 'inboxsweep',
    name: 'InboxSweep',
    summary: 'Privacy-conscious native macOS Gmail cleanup assistant that groups mail by sender, explains cleanup recommendations, and previews changes before anything happens.',
    detail: 'Built with metadata-only Gmail access, explicit OAuth scope boundaries, dry-run cleanup previews, confirmed archive and undo flows, safe unsubscribe handling, and synthetic offline test data.',
    technologies: ['Swift', 'SwiftUI', 'Gmail API', 'OAuth 2.0', 'Keychain'],
    links: { github: 'https://github.com/quangshuynh/inboxsweep' },
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
    slug: 'salonflow',
    name: 'SalonFlow',
    summary: 'Multi-tenant salon management application for scheduling appointments, managing customers, staff, and services, and supporting day-to-day salon operations.',
    detail: 'Backed by Supabase authentication and PostgreSQL persistence with database-enforced tenant isolation, tenant-scoped relational integrity, and integration tests that validate RLS behavior.',
    technologies: ['Next.js', 'TypeScript', 'Supabase', 'PostgreSQL'],
    links: { github: 'https://github.com/quangshuynh/salonflow' },
    logo: {
      file: 'salonflow-logo',
      source: githubAsset('salonflow', 'public/brand/salonflow-logo.png'),
      alt: 'SalonFlow project logo',
    },
  },
];

export const featuredProjects = projects.filter((project) => project.featured);
export const moreProjects = projects.filter((project) => !project.featured);
