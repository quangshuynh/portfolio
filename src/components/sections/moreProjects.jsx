import React, { useLayoutEffect, useRef, useState } from 'react';
import { FaExternalLinkAlt, FaGithub } from 'react-icons/fa';
import hymicalFormsLogo from '../../assets/logos/hymical-forms-logo.png';
import repoRadarLogo from '../../assets/logos/repo-radar-logo.png';
import moverGitLogo from '../../assets/logos/git-mover-logo.png';
import salonFlowLogo from '../../assets/logos/salonflow-logo.png';
import caseNotesLogo from '../../assets/logos/casenotes-logo.png';
import steamLogo from '../../assets/logos/Steam-icon-logo.svg';
import dashPilotLogo from '../../assets/logos/dashpilot-logo.png';
import inboxSweepLogo from '../../assets/logos/inboxsweep-logo.png';
import photoPortfolio from '../../assets/585photo585-portfolio.png';
import flipperLogo from '../../assets/logos/flipper-logo.png';
import chessedLogo from '../../assets/logos/chessed-logo.png';
import photo585Logo from '../../assets/logos/585photo585-logo.png';
import bdaLogo from '../../assets/logos/business-data-automation-logo.png';
import PersonalityButton from '../ui/personalityButton';
import { HomeImageTrigger } from '../utilities/homeLightbox';

const projects = [
  {
    name: 'Hymical Forms',
    description:
      'Self-hostable form ingestion service with durable, signed webhook delivery and production-minded failure handling.',
    highlight:
      'Built around idempotent submissions, a transactional PostgreSQL outbox, leased workers with ownership fencing, HMAC-signed webhooks, and real PostgreSQL concurrency tests.',
    technologies: ['Python', 'FastAPI', 'PostgreSQL', 'SQLAlchemy'],
    github: 'https://github.com/hymical/forms',
    logo: hymicalFormsLogo,
  },
  {
    name: 'DashPilot',
    description:
      'Local-first iOS companion for delivery drivers that tracks shifts, deliveries, routes, earnings, expenses, and performance without relying on delivery-platform integrations.',
    highlight:
        'Tracks stacked delivery lifecycles, Park & Resume workflows, mileage, pickup waits, vehicle and fuel costs, weekly performance, corrections, Live Activities, App Intents, and local exports while keeping recorded facts separate from estimates.',
    technologies: ['Swift', 'SwiftUI', 'SwiftData', 'Core Location', 'ActivityKit'],
    github: 'https://github.com/quangshuynh/dashpilot',
    logo: dashPilotLogo,
  },
  {
    name: 'Business Data Automation',
    description:
      'Backend data pipeline for validating related business records, reconciling financial transactions, and exposing trustworthy results through an API and dashboard.',
    highlight:
      'Quarantines invalid records without blocking valid processing, uses Decimal-based financial calculations, transactional PostgreSQL upserts, and automated coverage across validation, reconciliation, database, API, and end-to-end behavior.',
    technologies: ['Python', 'FastAPI', 'PostgreSQL', 'SQLAlchemy', 'pandas'],
    github: 'https://github.com/quangshuynh/business-data-automation',
    logo: bdaLogo,
  },
  {
    name: 'Repo Radar',
    description:
      'Personalized GitHub discovery tool for finding relevant repositories and open-source contribution opportunities from developer interests, feedback, and discovery history.',
    highlight:
      'Uses deterministic, explainable ranking to balance relevance, quality, activity, novelty, and diversity, with bounded GitHub issue discovery and reproducible offline evaluation.',
    technologies: ['Python', 'FastAPI', 'GitHub API', 'Recommendation Systems'],
    github: 'https://github.com/quangshuynh/repo-radar',
    logo: repoRadarLogo,
    logoClass: 'repo-radar-logo',
  },
  {
    name: 'Chessed',
    description:
      'Chess game review app that analyzes PGNs with Stockfish and explains move quality through engine-backed classifications and evaluations.',
    highlight:
      'Runs Stockfish in a Web Worker with cancellable MultiPV analysis, mover-relative evaluation, explainable move classifications, and regression testing across curated chess positions.',
    technologies: ['Next.js', 'TypeScript', 'Stockfish', 'Web Workers'],
    github: 'https://github.com/quangshuynh/chessed',
    logo: chessedLogo,
  },
  {
    name: 'CaseNotes',
    description:
      'Local-first native iOS notes app built with SwiftUI and SwiftData for Markdown writing, nested organization, drawings, version history, and export.',
    highlight:
      'Uses draft-based Save/Cancel editing, SwiftData persistence and migration coverage, safe nested-folder deletion, PencilKit drawings, real-text PDF export, interface gating, privacy shielding, and accessibility support.',
    technologies: ['Swift', 'SwiftUI', 'SwiftData', 'PencilKit'],
    github: 'https://github.com/quangshuynh/casenotes',
    live: 'https://quangshuynh.github.io/casenotes/',
    liveLabel: 'Documentation',
    logo: caseNotesLogo,
  },
  {
    name: 'InboxSweep',
    description:
      'Privacy-conscious native macOS Gmail cleanup assistant that groups mail by sender, explains cleanup recommendations, and previews changes before anything happens.',
    highlight:
      'Built with metadata-only Gmail access, explicit OAuth scope boundaries, dry-run cleanup previews, confirmed archive and undo flows, safe unsubscribe handling, and synthetic offline test data.',
    technologies: ['Swift', 'SwiftUI', 'Gmail API', 'OAuth 2.0', 'Keychain'],
    github: 'https://github.com/quangshuynh/inboxsweep',
    logo: inboxSweepLogo,
  },
  {
    name: '585photo585',
    description:
      'Custom photography portfolio and lightweight CMS built and deployed for a family-owned Rochester photography business.',
    highlight:
      'Responsive editorial galleries, progressive loading, and full-screen lightbox navigation, with a protected admin workflow for direct uploads, metadata and alt text, publishing, drag-and-drop ordering, and deletion.',
    technologies: ['React', 'Vite', 'Supabase', 'PostgreSQL', 'Storage', 'Auth & RLS'],
    live: 'https://www.585photo585.com',
    liveLabel: 'Live Site',
    logo: photo585Logo,
    image: photoPortfolio,
    imageAlt: '585photo585 editorial photography portfolio homepage with Featured, Portraits, and Clips collections',
  },
  {
    name: 'SalonFlow',
    description:
      'Multi-tenant salon management application for scheduling appointments, managing customers, staff, and services, and supporting day-to-day salon operations.',
    highlight:
      'Backed by Supabase authentication and PostgreSQL persistence with database-enforced tenant isolation, tenant-scoped relational integrity, and integration tests that validate RLS behavior.',
    technologies: ['Next.js', 'TypeScript', 'Supabase', 'PostgreSQL'],
    github: 'https://github.com/quangshuynh/salonflow',
    logo: salonFlowLogo,
  },
  {
    name: 'mover-git',
    description: 
      'Python desktop utility for safely previewing, organizing, and moving files into Git repositories with automated batch commits and pushes.',
    highlight: 
      'Blocks moves when the destination repository has pending changes, stages with explicit pathspecs instead of blanket adds, and splits work into batches that respect GitHub file-size limits.',
    technologies: ['Python', 'Tkinter', 'Git', 'pytest'],
    github: 'https://github.com/quangshuynh/mover-git',
    logo: moverGitLogo,
  },
  {
    name: 'Steam Value Lookup',
    description:
      'Aggregates public Steam profile, library, pricing, achievement, and supported inventory data into a single valuation dashboard.',
    highlight:
      'Coordinates multiple Steam APIs, parallelizes Store pricing lookups, handles private or incomplete account data, and covers API, pricing, database, route, and failure behavior with automated tests.',
    technologies: ['Python', 'Flask', 'SQLAlchemy', 'Steam Web API'],
    github: 'https://github.com/quangshuynh/steam-value-lookup',
    live: 'https://steam-value-lookup.onrender.com/',
    logo: steamLogo,
  },
];

/**
 * renders the additional project collection
 * :returns: additional projects section markup
 */
function MoreProjects() {
  const [showAllProjects, setShowAllProjects] = useState(false);
  const collapsedScrollY = useRef(null);
  const pendingScrollY = useRef(null);
  const visibleProjects = showAllProjects ? projects : projects.slice(0, 3);

  useLayoutEffect(() => {
    if (pendingScrollY.current === null) return;
    const scrollY = pendingScrollY.current;
    pendingScrollY.current = null;
    if (window.scrollY !== scrollY) {
      window.scrollTo({ top: scrollY, left: 0, behavior: 'auto' });
    }
  }, [showAllProjects]);

  const toggleProjects = (event) => {
    if (showAllProjects) {
      pendingScrollY.current = collapsedScrollY.current ?? window.scrollY;
    } else {
      collapsedScrollY.current = window.scrollY;
      pendingScrollY.current = window.scrollY;
    }
    event.currentTarget.blur();
    setShowAllProjects((isExpanded) => !isExpanded);
  };

  return (
    <section className="page-section section-ledger" id="more-projects" aria-labelledby="more-projects-title">
      <div className="section-inner">
        <div className="section-heading" data-reveal>
          <div><p className="eyebrow">Additional work</p><h2 id="more-projects-title">More projects</h2></div>
          <p>Additional projects spanning system design, developer tooling, automation, native applications, and product engineering.</p>
        </div>
        <div className="more-grid ledger" id="more-projects-grid">
          {visibleProjects.map((project, index) => (
            <article className={`more-card ledger-row${project.logo ? ' has-logo' : ''}`} key={project.name} data-reveal style={{ '--reveal-delay': `${(index % 3) * 70}ms` }}>
              <div className="ledger-row__id">
                <span className="ledger-row__index mono" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                {project.logo && (
                  <img
                    className={`more-card-logo${project.name === 'Repo Radar' ? ' repo-radar-logo' : ''}`}
                    src={project.logo}
                    alt={`${project.name} project logo`}
                    loading="lazy"
                    decoding="async"
                  />
                )}
              </div>
              <div className="ledger-row__main">
                <h3>{project.name}</h3>
                <p>{project.description}</p>
                <p className="more-highlight">{project.highlight}</p>
              </div>
              <div className="ledger-row__side">
                {project.image && <HomeImageTrigger src={project.image} imageClassName="more-card-preview" alt={project.imageAlt} caption={`${project.name} project preview`} />}
                <ul className="tag-list" aria-label={`${project.name} technologies`}>
                  {project.technologies.map((item) => <li key={item}>{item}</li>)}
                </ul>
                <div className="more-links">
                  {project.github && <a className="text-link" href={project.github} target="_blank" rel="noreferrer" aria-label={`Open ${project.name} repository`}>Repository <FaGithub aria-hidden="true" /></a>}
                  {project.live && <a className="text-link" href={project.live} target="_blank" rel="noreferrer" aria-label={`Open ${project.name} ${project.liveLabel ? project.liveLabel.toLowerCase() : 'live demo'}`}>{project.liveLabel || 'Live demo'} <FaExternalLinkAlt aria-hidden="true" /></a>}
                </div>
              </div>
            </article>
          ))}
        </div>
        {projects.length > 3 && (
          <div className="more-toggle">
            <PersonalityButton
              secondary
              personality="auto"
              personalityKey="more-projects-toggle"
              type="button"
              aria-expanded={showAllProjects}
              aria-controls="more-projects-grid"
              onClick={toggleProjects}
            >
              {showAllProjects ? 'Show fewer projects' : 'View more projects'}
            </PersonalityButton>
          </div>
        )}
      </div>
    </section>
  );
}

export default MoreProjects;
