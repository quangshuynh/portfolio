import React, { useState } from 'react';
import { FaExternalLinkAlt, FaGithub } from 'react-icons/fa';
import dashboardImage from '../assets/business-data-dashboard.png';
import gitProfileLensLogo from '../assets/gitprofilelens-logo.png';
import gitProfileLensResults from '../assets/gitprofilelens-results-vert.png';
import steamLogo from '../assets/Steam-icon-logo.svg';
import steamResults from '../assets/steam-value-lookup-vert.png';

const projects = [
  {
    name: 'Business Data Automation',
    label: 'Flagship project · Backend & data engineering',
    purpose: 'Validates related business records and reconciles financial transactions without allowing isolated bad records to halt valid processing.',
    highlights: [
      'Fails fast on structural dataset errors while quarantining invalid rows with explainable validation_errors',
      'Calculates payments, refunds, and signed adjustments with Decimal-based cent precision',
      'Uses transactional PostgreSQL primary-key upserts, rollback handling, and FastAPI reporting endpoints',
      'Covers validation, reconciliation, database, API, and end-to-end behavior with 52 pytest tests',
    ],
    stack: 'Python · FastAPI · PostgreSQL · SQLAlchemy · pandas · Docker · pytest · GitHub Actions',
    github: 'https://github.com/quangshuynh/business-data-automation',
    visual: 'dashboard',
  },
  {
    name: 'GitProfileLens',
    label: 'Developer tooling · GitHub APIs & authenticated data',
    purpose: 'Audits GitHub profiles and repositories using explainable scoring to identify presentation and discoverability improvements without claiming to measure developer ability.',
    highlights: [
      'Analyzes public repository metadata with GitHub REST/GraphQL APIs and deterministic category scoring',
      'Supports authorized private repositories through a read-only GitHub App with encrypted session material and isolated caching',
      'Separates private data from public/shareable audit output while handling repository pagination, filtering, and authenticated metadata',
      'Validates scoring and recommendations against an evaluation corpus of 13 representative profiles and 185 repositories, with regression baselines designed to expose unintended behavior changes',
    ],
    stack: 'JavaScript · Node.js · GitHub REST/GraphQL APIs · Vercel · Playwright',
    github: 'https://github.com/quangshuynh/gitprofilelens',
    live: 'https://gitprofilelens.vercel.app/',
    visual: 'gitprofilelens',
  },
  {
    name: 'Steam Value Lookup',
    label: 'External API & backend engineering',
    purpose: 'Aggregates public Steam profile, library, pricing, achievement, and supported inventory data into one valuation dashboard.',
    highlights: [
      'Accepts SteamIDs and vanity names, then coordinates data from multiple external API endpoints',
      'Parallelizes Store pricing requests with ThreadPoolExecutor to reduce lookup latency',
      'Handles private profiles, empty libraries, missing prices, and unavailable API responses',
      'Tests API integration, pricing behavior, database models, routes, and failure cases in GitHub Actions',
    ],
    stack: 'Python · Flask · SQLAlchemy · Steam Web API · pytest · GitHub Actions',
    github: 'https://github.com/quangshuynh/steam-value-lookup',
    live: 'https://steam-value-lookup.onrender.com/',
    visual: 'steam',
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
          <img className="project-result-image" src={dashboardImage} alt="Business Data Automation reconciliation dashboard showing financial totals, payment statuses, and flagged discrepancies" loading="lazy" />
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
          <img src={gitProfileLensLogo} alt="GitProfileLens project logo" loading="lazy" />
        ) : (
          <img className="project-result-image" src={gitProfileLensResults} alt="GitProfileLens audit dashboard showing presentation and discoverability scores with prioritized recommendations" loading="lazy" />
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
 * renders the steam value lookup image gallery
 * :param name: project name used for accessible image text
 * :returns: steam value lookup gallery markup
 */
function SteamGallery({ name }) {
  const [slide, setSlide] = useState('value');

  return (
    <div className="project-visual steam gallery">
      <div className="gallery-stage">
        {slide === 'value' ? (
          <>
            <img className="steam-corner-logo" src={steamLogo} alt="" aria-hidden="true" />
            <div className="steam-mark" aria-label={`${name} library value graphic`}>
              <div><strong>∑</strong><span>Library value</span></div>
            </div>
          </>
        ) : (
          <img className="project-result-image vertical-project-shot" src={steamResults} alt="Steam Value Lookup results showing library totals, achievements, game values, and sortable game data" loading="lazy" />
        )}
      </div>
      <div className="gallery-controls" aria-label="Steam Value Lookup gallery">
        <button type="button" aria-pressed={slide === 'value'} onClick={() => setSlide('value')}>Library value</button>
        <button type="button" aria-pressed={slide === 'results'} onClick={() => setSlide('results')}>Results</button>
      </div>
    </div>
  );
}

/**
 * selects and renders a project visual
 * :param type: project visual type
 * :param name: project name used for accessible image text
 * :returns: selected project visual markup
 */
function ProjectVisual({ type, name }) {
  if (type === 'dashboard') {
    return (
      <BusinessGallery />
    );
  }
  if (type === 'steam') {
    return <SteamGallery name={name} />;
  }
  return <GitProfileLensVisual />;
}

/**
 * renders the featured project collection
 * :returns: featured projects section markup
 */
function FeaturedProjects() {
  return (
    <section className="page-section" id="projects" aria-labelledby="projects-title">
      <div className="section-inner">
        <div className="section-heading">
          <div><p className="eyebrow">Selected work</p><h2 id="projects-title">Featured projects</h2></div>
          <p>Substantial projects selected for the engineering decisions behind them and not just the technologies used.</p>
        </div>
        <div className="featured-list">
          {projects.map((project, index) => (
            <article className={`featured-project${index === 0 ? ' flagship-project' : ''}`} key={project.name}>
              <ProjectVisual type={project.visual} name={project.name} />
              <div className="project-copy">
                <span className="project-number">{String(index + 1).padStart(2, '0')} · {project.label}</span>
                <h3>{project.name}</h3>
                <p className="project-purpose">{project.purpose}</p>
                <ul className="project-highlights" aria-label={`${project.name} engineering highlights`}>
                  {project.highlights.map((item) => <li key={item}>{item}</li>)}
                </ul>
                <p className="project-stack"><strong>Stack</strong> {project.stack}</p>
                <div className="project-actions">
                  <a className="button" href={project.github} target="_blank" rel="noreferrer" aria-label={`View ${project.name} code`}>View code <FaGithub aria-hidden="true" /></a>
                  {index === 0 && <a className="button button-secondary" href={`${project.github}#architecture`} target="_blank" rel="noreferrer" aria-label="Read Business Data Automation architecture">Read architecture <FaExternalLinkAlt aria-hidden="true" /></a>}
                  {project.live && <a className="button button-secondary" href={project.live} target="_blank" rel="noreferrer" aria-label={`Open ${project.name} live demo`}>Live demo <FaExternalLinkAlt aria-hidden="true" /></a>}
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
