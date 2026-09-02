import React, { useState } from 'react';
import { FaExternalLinkAlt, FaGithub } from 'react-icons/fa';
import dashboardImage from '../assets/business-data-dashboard.png';
import gitProfileLensLogo from '../assets/logos/gitprofilelens-logo.png';
import gitProfileLensResults from '../assets/gitprofilelens-results-vert.png';
import scribeKitLogo from '../assets/logos/scribekit-logo.png';
import scribeKitApp from '../assets/scribekit-app.png';
import scribeKitTranscript from '../assets/scribekit-md.png';

const projects = [
  {
    name: 'Business Data Automation',
    label: 'Backend & data engineering',
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
    name: 'ScribeKit',
    label: 'Native macOS · On-device transcription & reliability',
    purpose: 'Native macOS meeting transcription that captures audio from selected applications, transcribes it on-device with Apple speech frameworks, and durably writes timestamped Markdown.',
    highlights: [
      'Captures only user-selected application audio through ScreenCaptureKit rather than recording all system audio or the microphone',
      'Uses Apple’s on-device SpeechAnalyzer and SpeechTranscriber stack with no network fallback',
      'Preserves finalized speech during recording with pause/resume, background operation, interruption handling, and crash recovery',
      'Validated with 703 automated tests, fault injection, a real 60-minute capture soak, and manual keyboard and VoiceOver release testing',
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
 * renders the ScribeKit image gallery
 * :returns: ScribeKit gallery markup
 */
function ScribeKitGallery() {
  const [slide, setSlide] = useState('logo');

  return (
    <div className="project-visual gallery">
      <div className="gallery-stage">
        {slide === 'logo' && <img src={scribeKitLogo} alt="ScribeKit app logo" loading="lazy" />}
        {slide === 'app' && <img className="project-result-image vertical-project-shot" src={scribeKitApp} alt="ScribeKit macOS meeting window showing selected application audio, on-device transcription status, and a live transcript" loading="lazy" />}
        {slide === 'transcript' && <img className="project-result-image vertical-project-shot" src={scribeKitTranscript} alt="ScribeKit timestamped Markdown transcript output" loading="lazy" />}
      </div>
      <div className="gallery-controls" aria-label="ScribeKit gallery">
        <button type="button" aria-pressed={slide === 'logo'} onClick={() => setSlide('logo')}>Logo</button>
        <button type="button" aria-pressed={slide === 'app'} onClick={() => setSlide('app')}>App</button>
        <button type="button" aria-pressed={slide === 'transcript'} onClick={() => setSlide('transcript')}>Transcript</button>
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
  if (type === 'dashboard') {
    return (
      <BusinessGallery />
    );
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
    <section className="page-section" id="projects" aria-labelledby="projects-title">
      <div className="section-inner">
        <div className="section-heading">
          <div><p className="eyebrow">Selected work</p><h2 id="projects-title">Featured projects</h2></div>
          <p>Substantial projects selected for the engineering decisions behind them and not just the technologies used.</p>
        </div>
        <div className="featured-list">
          {projects.map((project, index) => (
            <article className={`featured-project${index === 0 ? ' flagship-project' : ''}`} key={project.name}>
              <ProjectVisual type={project.visual} />
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
                  {project.documentation && <a className="button button-secondary" href={project.documentation} target="_blank" rel="noreferrer" aria-label={`Open ${project.name} documentation`}>Documentation <FaExternalLinkAlt aria-hidden="true" /></a>}
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
