import React, { useState } from 'react';
import { FaExternalLinkAlt, FaGithub } from 'react-icons/fa';
import foodyLogo from '../assets/logos/foody-logo.png';
import hymicalFormsLogo from '../assets/logos/hymical-forms-logo.png';
import repoRadarLogo from '../assets/logos/repo-radar-logo.png';
import moverGitLogo from '../assets/logos/git-mover-logo.png';
import salonFlowLogo from '../assets/logos/salonflow-logo.png';

const projects = [
  {
    name: 'Hymical Forms',
    description: 'Self-hostable form ingestion service with durable, signed webhook delivery and production-minded failure handling.',
    highlight: 'Built around idempotent submissions, a transactional PostgreSQL outbox, worker leases and retries, HMAC-signed webhooks, and real PostgreSQL concurrency tests.',
    technologies: ['Python', 'FastAPI', 'PostgreSQL', 'SQLAlchemy'],
    github: 'https://github.com/hymical/forms',
    logo: hymicalFormsLogo,
  },
{
    name: 'Repo Radar',
    description:
      'Personalized GitHub repository discovery tool that learns from starred repositories and explicit feedback to rank candidates by relevance, quality, activity, and novelty.',
    highlight:
      'Uses inspectable ranking heuristics with deterministic scoring, redundancy handling, and reproducible evaluation against graded scenarios and held-out real-world preference signals.',
    technologies: ['Python', 'FastAPI', 'GitHub API', 'Recommendation Systems'],
    github: 'https://github.com/quangshuynh/repo-radar',
    logo: repoRadarLogo,
  },
  {
    name: 'Mover Git',
    description: 'Python desktop utility for safely previewing, organizing, and moving files into Git repositories with automated batch commits and pushes.',
    highlight: 'Blocks moves when the destination repository has pending changes, stages with explicit pathspecs instead of blanket adds, and splits work into batches that respect GitHub file-size limits.',
    technologies: ['Python', 'Tkinter', 'Git', 'pytest'],
    github: 'https://github.com/quangshuynh/mover-git',
    logo: moverGitLogo,
  },
  {
    name: 'Foody',
    description: 'Restaurant visit, rating, saved-place, and nearby-recommendation tracking in a responsive mapping application.',
    highlight: 'Authenticated, persistent CRUD with Firebase Authentication and Cloud Firestore, plus React Leaflet and public location APIs.',
    technologies: ['React', 'Firebase Authentication', 'Cloud Firestore', 'React Leaflet'],
    github: 'https://github.com/quangshuynh/Foody',
    live: 'https://foody-rit.web.app/',
    logo: foodyLogo,
  },
  {
    name: 'SalonFlow',
    description: 'Salon-management SaaS interface for scheduling, staff, customers, services, and reporting, built around a multi-tenant product model.',
    highlight: 'Structured as a Next.js/TypeScript application with tested feature flows and CI checks for linting, tests, and production builds; Supabase-backed persistence is the next major milestone.',
    technologies: ['Next.js', 'TypeScript', 'Vitest'],
    github: 'https://github.com/quangshuynh/salonflow',
    logo: salonFlowLogo,
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
          <p>Supporting projects that add system-design, developer-tooling, automation, and product breadth without competing with the featured case studies.</p>
        </div>
        <div className="more-grid" id="more-projects-grid">
          {visibleProjects.map((project) => (
            <article className={`more-card${project.logo ? ' has-logo' : ''}`} key={project.name}>
              {project.logo && <img className="more-card-logo" src={project.logo} alt={`${project.name} project logo`} loading="lazy" />}
              <h3>{project.name}</h3>
              <p>{project.description}</p>
              <p className="more-highlight">{project.highlight}</p>
              <ul className="tag-list" aria-label={`${project.name} technologies`}>
                {project.technologies.map((item) => <li key={item}>{item}</li>)}
              </ul>
              <div className="more-links">
                <a className="text-link" href={project.github} target="_blank" rel="noreferrer" aria-label={`Open ${project.name} repository`}>Repository <FaGithub aria-hidden="true" /></a>
                {project.live && <a className="text-link" href={project.live} target="_blank" rel="noreferrer" aria-label={`Open ${project.name} live demo`}>Live demo <FaExternalLinkAlt aria-hidden="true" /></a>}
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
