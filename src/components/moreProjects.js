import React, { useState } from 'react';
import { FaExternalLinkAlt, FaGithub } from 'react-icons/fa';
import foodyLogo from '../assets/logos/foody-logo.png';
import hymicalFormsLogo from '../assets/logos/hymical-forms-logo.png';
import repoRadarLogo from '../assets/logos/repo-radar-logo.png';
import moverGitLogo from '../assets/logos/git-mover-logo.png';
import salonFlowLogo from '../assets/logos/salonflow-logo.png';
import caseNotesLogo from '../assets/logos/casenotes-logo.png';
import steamLogo from '../assets/logos/Steam-icon-logo.svg';

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
    name: 'Repo Radar',
    description:
      'Personalized GitHub discovery tool that recommends relevant repositories and open-source contribution opportunities using preference signals, feedback, and discovery history.',
    highlight:
      'Uses deterministic, explainable ranking to balance relevance, quality, activity, novelty, and diversity, with bounded GitHub issue discovery and reproducible offline evaluation.',
    technologies: ['Python', 'FastAPI', 'GitHub API', 'Recommendation Systems'],
    github: 'https://github.com/quangshuynh/repo-radar',
    logo: repoRadarLogo,
    logoClass: 'repo-radar-logo',
  },
  {
    name: 'SalonFlow',
    description:
      'Responsive mapping application for tracking restaurant visits, ratings, saved places, and nearby recommendations.',
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
  {
    name: 'Foody',
    description: 
      'Restaurant visit, rating, saved-place, and nearby-recommendation tracking in a responsive mapping application.',
    highlight: 
      'Authenticated, persistent CRUD with Firebase Authentication and Cloud Firestore, plus React Leaflet and public location APIs.',
    technologies: ['React', 'Firebase Authentication', 'Cloud Firestore', 'React Leaflet'],
    github: 'https://github.com/quangshuynh/Foody',
    live: 'https://foody-rit.web.app/',
    logo: foodyLogo,
  },
];

/**
 * renders the additional project collection
 * :returns: additional projects section markup
 */
function MoreProjects() {
  const [showAllProjects, setShowAllProjects] = useState(false);
  const visibleProjects = showAllProjects ? projects : projects.slice(0, 3);

  return (
    <section className="page-section" id="more-projects" aria-labelledby="more-projects-title">
      <div className="section-inner">
        <div className="section-heading">
          <div><p className="eyebrow">Additional work</p><h2 id="more-projects-title">More projects</h2></div>
          <p>Additional projects spanning system design, developer tooling, automation, native applications, and product engineering.</p>
        </div>
        <div className="more-grid" id="more-projects-grid">
          {visibleProjects.map((project) => (
            <article className={`more-card${project.logo ? ' has-logo' : ''}`} key={project.name}>
              {project.logo && (
                <img
                  className={`more-card-logo ${
                    project.name === 'Repo Radar' ? 'repo-radar-logo' : ''
                  }`}
                  src={project.logo}
                  alt={`${project.name} project logo`}
                  loading="lazy"
                />
              )}
              <h3>{project.name}</h3>
              <p>{project.description}</p>
              <p className="more-highlight">{project.highlight}</p>
              <ul className="tag-list" aria-label={`${project.name} technologies`}>
                {project.technologies.map((item) => <li key={item}>{item}</li>)}
              </ul>
              <div className="more-links">
                <a className="text-link" href={project.github} target="_blank" rel="noreferrer" aria-label={`Open ${project.name} repository`}>Repository <FaGithub aria-hidden="true" /></a>
                {project.live && <a className="text-link" href={project.live} target="_blank" rel="noreferrer" aria-label={`Open ${project.name} ${project.liveLabel ? project.liveLabel.toLowerCase() : 'live demo'}`}>{project.liveLabel || 'Live demo'} <FaExternalLinkAlt aria-hidden="true" /></a>}
              </div>
            </article>
          ))}
        </div>
        {projects.length > 3 && (
          <div className="more-toggle">
            <button
              className="button button-secondary"
              type="button"
              aria-expanded={showAllProjects}
              aria-controls="more-projects-grid"
              onClick={() => setShowAllProjects((isExpanded) => !isExpanded)}
            >
              {showAllProjects ? 'Show fewer projects' : 'View more projects'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

export default MoreProjects;
