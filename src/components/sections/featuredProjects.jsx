import React, { useState } from 'react';
import { FaExternalLinkAlt, FaGithub } from 'react-icons/fa';
import flipperLogo from '../../assets/logos/flipper-logo.png';
import flipperDashboard from '../../assets/flipper-dashboard.png';
import flipperResearch from '../../assets/flipper-research.png';
import flipperInventory from '../../assets/flipper-inventory.png';
import flipperSale from '../../assets/flipper-sale.png';
import gitProfileLensLogo from '../../assets/logos/gitprofilelens-logo.png';
import gitProfileLensResults from '../../assets/gitprofilelens-results-vert.png';
import scribeKitLogo from '../../assets/logos/scribekit-logo.png';
import scribeKitApp from '../../assets/scribekit-app2.png';
import scribeKitHistoryFind from '../../assets/scribekit-historyfind.png';
import scribeKitHistoryReview from '../../assets/scribekit-historyreview.png';
import scribeKitAudioCapture from '../../assets/scribekit-audiocapture.png';
import dashcamStorefront from '../../assets/585dashcam585-storefront.png';
import PersonalityButton from '../ui/personalityButton';
import { HomeImageTrigger } from '../utilities/homeLightbox';

const projects = [
  {
    name: '585Dashcam585',
    label: 'Production commerce platform',
    purpose: 'Built and deployed a full-stack commerce platform for a family-owned Rochester automotive services business, replacing its hosted website with a custom production application.',
    highlights: [
      'Runs guest and authenticated checkout with server-authoritative pricing, live Stripe payments, signed webhooks, and idempotent PostgreSQL order finalization',
      'Provides customer accounts, persistent carts and wishlists, order history, and a protected admin CRM for customers, fulfillment, catalog data, and analytics',
      'Sends transactional email through Resend with database-backed delivery state, retry handling, stale-claim recovery, and duplicate-delivery protection',
      'Deployed with Cloudflare Workers and Static Assets, Supabase authentication and RLS, least-privilege credentials, and privacy-conscious Cloudflare analytics',
    ],
    stack: 'React · Vite · JavaScript · Cloudflare Workers · Supabase · PostgreSQL · Stripe · Resend · Cloudflare GraphQL Analytics API',
    live: 'https://www.585dashcam585.com',
    visual: 'dashcam',
  },
  {
    name: 'Flipper',
    label: 'Backend · Reselling & marketplace tooling',
    purpose:
      'Local-first reseller toolkit for researching deals, modeling sourcing economics, managing inventory, and reconciling marketplace sales from discovery through outcome.',

    highlights: [
      'Separates research estimates from authoritative accounting facts with immutable research snapshots, explicit acquisition state, and exact Decimal-based money semantics',
      'Researches marketplace opportunities with active and sold comparables, provenance-aware evidence, travel economics, and deterministic deal scoring',
      'Tracks inventory through acquisition and sale, including completed-order imports, buyer-paid shipping, marketplace fees, collect-and-remit taxes, and provisional economics when acquisition facts are incomplete',
      'Compares frozen pre-purchase expectations against authoritative sale outcomes while keeping external marketplace failures isolated from local records',
    ],

    stack: 'Python · FastAPI · SQLite · Jinja · eBay APIs · pytest',
    github: 'https://github.com/quangshuynh/flipper',
    visual: 'flipper',
  },
  {
    name: 'GitProfileLens',
    label: 'Developer tooling · GitHub APIs & authenticated data',
    purpose:
      'Audits GitHub profiles and repositories with transparent, deterministic rules to improve portfolio presentation, discoverability, and project selection without claiming to measure developer ability.',

    highlights: [
      'Analyzes public repository metadata with GitHub REST/GraphQL APIs using deterministic presentation scoring, portfolio candidacy, and pinned-repository recommendations',
      'Supports authorized private repositories through a read-only GitHub App with encrypted session material and strict public/private output boundaries',
      'Adds contribution discovery and follower/following analysis while withholding conclusions when GitHub data is incomplete or ambiguous',
      'Validates scoring and recommendations against a representative evaluation corpus with regression baselines designed to expose unintended behavior changes',
    ],
    stack: 'JavaScript · Node.js · GitHub REST/GraphQL APIs · Vercel · Playwright',
    github: 'https://github.com/quangshuynh/gitprofilelens',
    live: 'https://gitprofilelens.vercel.app/',
    visual: 'gitprofilelens',
  },
  {
    name: 'ScribeKit',
    label: 'Native macOS · Audio, transcription & reliability',
    purpose:
      'Native macOS meeting transcription that captures selected application audio or a chosen microphone, transcribes it on-device with Apple speech frameworks, and durably writes timestamped Markdown.',

    highlights: [
      'Captures either user-selected application audio through ScreenCaptureKit or a chosen microphone, with one source per meeting and optional local audio retention',
      'Uses Apple’s on-device SpeechAnalyzer and SpeechTranscriber stack with no network fallback',
      'Preserves finalized speech with pause/resume, background operation, interruption handling, crash recovery, history search, and uncertainty review',
      'Validated with extensive automated testing, fault injection, long-duration capture testing, and manual keyboard and VoiceOver release checks',
    ],
    stack: 'Swift · SwiftUI · ScreenCaptureKit · Speech · AVFoundation · macOS · Swift Testing',
    github: 'https://github.com/quangshuynh/scribekit',
    documentation: 'https://quangshuynh.github.io/scribekit/',
    visual: 'scribekit',
  },
];

/**
 * renders the business data automation image gallery
 * :returns: business data automation gallery markup
 */
function BusinessGallery() {
  const [slide, setSlide] = useState('architecture');

  return (
    <div className="project-visual dashboard gallery">
      <div className="gallery-stage">
        {slide === 'architecture' ? (
          <div className="pipeline" role="img" aria-label="Business data pipeline from CSV inputs through validation and reconciliation to reports, PostgreSQL, FastAPI, and a dashboard">
            <div className="pipeline-row"><span>Customer CSV</span><span>Order CSV</span><span>Payment CSV</span></div>
            <div className="pipeline-arrow" aria-hidden="true">↓</div>
            <div className="pipeline-row"><span>Validate</span><span>Quarantine</span><span>Reconcile</span></div>
            <div className="pipeline-arrow" aria-hidden="true">↓</div>
            <div className="pipeline-row"><span>CSV Reports</span><span>PostgreSQL</span><span>API + Dashboard</span></div>
          </div>
        ) : (
          <HomeImageTrigger src={dashboardImage} imageClassName="project-result-image" alt="Business Data Automation reconciliation dashboard showing financial totals, payment statuses, and flagged discrepancies" caption="Business Data Automation reconciliation dashboard" />
        )}
      </div>
      <div className="gallery-controls" aria-label="Business Data Automation gallery">
        <button type="button" aria-pressed={slide === 'architecture'} onClick={() => setSlide('architecture')}>Architecture</button>
        <button type="button" aria-pressed={slide === 'dashboard'} onClick={() => setSlide('dashboard')}>Dashboard</button>
      </div>
    </div>
  );
}

/**
 * renders the GitProfileLens project visual
 * :returns: GitProfileLens visual markup
 */
function GitProfileLensVisual() {
  const [slide, setSlide] = useState('logo');

  return (
    <div className="project-visual gallery">
      <div className="gallery-stage">
        {slide === 'logo' ? (
          <img className="gitprofilelens-logo" src={gitProfileLensLogo} width="788" height="737" alt="GitProfileLens project logo" loading="lazy" decoding="async" />
        ) : (
          <HomeImageTrigger src={gitProfileLensResults} imageClassName="project-result-image" alt="GitProfileLens audit dashboard showing presentation and discoverability scores with prioritized recommendations" caption="GitProfileLens audit results" />
        )}
      </div>
      <div className="gallery-controls" aria-label="GitProfileLens gallery">
        <button type="button" aria-pressed={slide === 'logo'} onClick={() => setSlide('logo')}>Logo</button>
        <button type="button" aria-pressed={slide === 'results'} onClick={() => setSlide('results')}>Results</button>
      </div>
    </div>
  );
}

/**
 * renders the ScribeKit image gallery
 * :returns: ScribeKit gallery markup
 */
const scribeKitGallery = [
  {
    src: scribeKitApp,
    alt: 'ScribeKit macOS meeting window showing selected application audio, on-device transcription status, and a live transcript',
    caption: 'ScribeKit macOS meeting window',
  },
  {
    src: scribeKitAudioCapture,
    alt: 'ScribeKit audio capture page',
    caption: 'ScribeKit audio capture',
  },
  {
    src: scribeKitHistoryFind,
    alt: 'ScribeKit history and find features',
    caption: 'ScribeKit history and find',
  },
  {
    src: scribeKitHistoryReview,
    alt: 'ScribeKit review features',
    caption: 'ScribeKit review',
  },
];

function ScribeKitGallery() {
  const [slide, setSlide] = useState('logo');

  return (
    <div className="project-visual gallery">
      <div className="gallery-stage">
          {slide === 'logo' && (
            <img
              src={scribeKitLogo}
              width="788"
              height="737"
              alt="ScribeKit app logo"
              loading="lazy"
              decoding="async"
            />
          )}

          {slide === 'app' && (
            <HomeImageTrigger
              src={scribeKitApp}
              imageClassName="project-result-image vertical-project-shot"
              alt="ScribeKit macOS meeting window showing selected application audio, on-device transcription status, and a live transcript"
              caption="ScribeKit macOS meeting window"
              gallery={scribeKitGallery}
              galleryIndex={0}
            />
          )}

          {slide === 'audio' && (
            <HomeImageTrigger
              src={scribeKitAudioCapture}
              imageClassName="project-result-image vertical-project-shot"
              alt="ScribeKit audio capture page"
              caption="ScribeKit audio capture"
              gallery={scribeKitGallery}
              galleryIndex={1}
            />
          )}

          {slide === 'find' && (
            <HomeImageTrigger
              src={scribeKitHistoryFind}
              imageClassName="project-result-image vertical-project-shot"
              alt="ScribeKit history and find features"
              caption="ScribeKit history and find"
              gallery={scribeKitGallery}
              galleryIndex={2}
            />
          )}

          {slide === 'review' && (
            <HomeImageTrigger
              src={scribeKitHistoryReview}
              imageClassName="project-result-image vertical-project-shot"
              alt="ScribeKit review features"
              caption="ScribeKit review"
              gallery={scribeKitGallery}
              galleryIndex={3}
            />
          )}
        </div>
      <div className="gallery-controls" aria-label="ScribeKit gallery">
        <button type="button" aria-pressed={slide === 'logo'} onClick={() => setSlide('logo')}>Logo</button>
        <button type="button" aria-pressed={slide === 'app'} onClick={() => setSlide('app')}>App</button>
        <button type="button" aria-pressed={slide === 'audio'} onClick={() => setSlide('audio')}>Audio</button>
        <button type="button" aria-pressed={slide === 'find'} onClick={() => setSlide('find')}>Find</button>
        <button type="button" aria-pressed={slide === 'review'} onClick={() => setSlide('review')}>Review</button>
      </div>
    </div>
  );
}


/** 
 * renders the Flipper project visual
 * :returns: Flipper visual markup
*/
const flipperGallery = [
  {
    src: flipperDashboard,
    alt: 'Flipper dashboard showing inventory, workflow state, attention items, and sales economics',
    caption: 'Flipper operational dashboard',
  },
  {
    src: flipperResearch,
    alt: 'Flipper Deals workspace showing live eBay opportunities, research modes, and comparison candidates',
    caption: 'Flipper marketplace research workspace',
  },
  {
    src: flipperInventory,
    alt: 'Flipper inventory showing Q-number records, lifecycle status, marketplace linkage, and sale references',
    caption: 'Flipper inventory workflow',
  },
  {
    src: flipperSale,
    alt: 'Flipper sale detail showing seller revenue, fees, reconciliation state, and provisional realized economics',
    caption: 'Flipper sale reconciliation',
  },
];

function FlipperVisual() {
  const [slide, setSlide] = useState('logo');

  const screenshots = {
    dashboard: {
      ...flipperGallery[0],
      galleryIndex: 0,
    },
    research: {
      ...flipperGallery[1],
      galleryIndex: 1,
    },
    inventory: {
      ...flipperGallery[2],
      galleryIndex: 2,
    },
    sale: {
      ...flipperGallery[3],
      galleryIndex: 3,
    },
  };

  return (
    <div className="project-visual gallery">
      <div className="gallery-stage">
        {slide === 'logo' ? (
          <img
            className="flipper-logo"
            src={flipperLogo}
            alt="Flipper project logo"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <HomeImageTrigger
            src={screenshots[slide].src}
            imageClassName="project-result-image"
            alt={screenshots[slide].alt}
            caption={screenshots[slide].caption}
            gallery={flipperGallery}
            galleryIndex={screenshots[slide].galleryIndex}
          />
        )}
      </div>

      <div className="gallery-controls" aria-label="Flipper gallery">
        <button
          type="button"
          aria-pressed={slide === 'logo'}
          onClick={() => setSlide('logo')}
        >
          Logo
        </button>
        <button
          type="button"
          aria-pressed={slide === 'dashboard'}
          onClick={() => setSlide('dashboard')}
        >
          Dashboard
        </button>
        <button
          type="button"
          aria-pressed={slide === 'research'}
          onClick={() => setSlide('research')}
        >
          Research
        </button>
        <button
          type="button"
          aria-pressed={slide === 'inventory'}
          onClick={() => setSlide('inventory')}
        >
          Inventory
        </button>
        <button
          type="button"
          aria-pressed={slide === 'sale'}
          onClick={() => setSlide('sale')}
        >
          Sale
        </button>
      </div>
    </div>
  );
}

/**
 * selects and renders a project visual
 * :param type: project visual type
 * :returns: selected project visual markup
 */
function ProjectVisual({ type }) {
  if (type === 'dashcam') {
    return (
      <div className="project-visual production-site-visual">
        <HomeImageTrigger
          src={dashcamStorefront}
          alt="585Dashcam585 storefront showing dashcam products and local installation options"
          caption="585Dashcam585 storefront"
        />
      </div>
    );
  }

  if (type === 'flipper') {
    return <FlipperVisual />;
  }

  if (type === 'scribekit') {
    return <ScribeKitGallery />;
  }

  return <GitProfileLensVisual />;
}

/**
 * renders the featured project collection
 * :returns: featured projects section markup
 */
function FeaturedProjects() {
  return (
    <section className="page-section featured-section" id="projects" aria-labelledby="projects-title">
      <div className="section-inner">
        <div className="section-heading" data-reveal>
          <div><p className="eyebrow">Selected work</p><h2 id="projects-title">Featured projects</h2></div>
          <p>Selected projects highlighting engineering decisions, reliability, system design, and practical problem solving.</p>
        </div>
        <svg className="trail-line" viewBox="0 0 20 1000" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path d="M10 0 C 2 120, 18 240, 10 360 S 2 600, 10 720 S 18 900, 10 1000" pathLength="1" />
        </svg>
        <div className="featured-list">
          {projects.map((project, index) => (
            <article
              key={project.name}
              className={`featured-project case-file${index === 0 ? ' flagship-project case-file--wide' : ''}${index % 2 === 0 ? '' : ' case-file--flip'}${project.name === 'GitProfileLens' ? ' gitprofilelens-project' : ''}`}
            >
              <div className="case-file__rail" data-reveal>
                <span className="case-file__index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                <dl className="case-file__meta">
                  <div><dt>Type</dt><dd className="project-number">{project.label}</dd></div>
                  <div className="project-stack">
                    <dt>Stack</dt>
                    <dd>
                      <ul className="tech-tags" aria-label={`${project.name} technologies`}>
                        {project.stack.split(' · ').map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="case-file__visual viewfinder" data-reveal style={{ '--reveal-delay': '80ms' }}>
                <ProjectVisual type={project.visual} />
              </div>
              <div className="project-copy" data-reveal style={{ '--reveal-delay': '140ms' }}>
                <h3>{project.name}</h3>
                <p className="project-purpose">{project.purpose}</p>
                <ul className="project-highlights" aria-label={`${project.name} engineering highlights`}>
                  {project.highlights.map((item) => <li key={item}>{item}</li>)}
                </ul>
                <div className="project-actions">
                  {project.live && !project.github && <PersonalityButton href={project.live} target="_blank" rel="noreferrer" aria-label={`Open ${project.name} live site`}>Live Site <FaExternalLinkAlt aria-hidden="true" /></PersonalityButton>}
                  {project.github && <PersonalityButton href={project.github} target="_blank" rel="noreferrer" aria-label={`View ${project.name} code`}>View code <FaGithub aria-hidden="true" /></PersonalityButton>}
                  {project.live && project.github && <PersonalityButton secondary personality="auto" personalityKey={`${project.name}-live`} href={project.live} target="_blank" rel="noreferrer" aria-label={`Open ${project.name} live demo`}>Live demo <FaExternalLinkAlt aria-hidden="true" /></PersonalityButton>}
                  {project.documentation && <PersonalityButton secondary personality="auto" personalityKey={`${project.name}-documentation`} href={project.documentation} target="_blank" rel="noreferrer" aria-label={`Open ${project.name} documentation`}>Documentation <FaExternalLinkAlt aria-hidden="true" /></PersonalityButton>}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export default FeaturedProjects;
