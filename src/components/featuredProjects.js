import React, { useState } from 'react';
import { FaExternalLinkAlt, FaGithub } from 'react-icons/fa';
import foodyImage from '../assets/foody.png';
import dashboardImage from '../assets/business-data-dashboard.png';
import steamLogo from '../assets/Steam-icon-logo.svg';

const projects = [
  {
    name: 'Business Data Automation',
    label: 'Featured · v1.0.0 portfolio release',
    problem: 'Businesses receive related records from multiple sources, where malformed data and mismatched transactions make manual reconciliation unreliable.',
    built: 'A Python pipeline that validates datasets, quarantines bad records, reconciles exact-cent transactions, optionally persists validated data to PostgreSQL, and exposes shared logic through FastAPI and a lightweight dashboard.',
    engineering: ['Python', 'FastAPI', 'PostgreSQL', 'SQLAlchemy', 'pandas', 'Docker', 'pytest · 52 tests', 'GitHub Actions'],
    github: 'https://github.com/quangshuynh/business-data-automation',
    visual: 'dashboard',
  },
  {
    name: 'Steam Value Lookup',
    label: 'Backend & API integration',
    problem: 'Estimating a game library’s value requires combining account data with many separate pricing requests from an external service.',
    built: 'A Flask application that analyzes Steam libraries, manages application data with SQLAlchemy, and uses ThreadPoolExecutor to make concurrent Steam Web API pricing requests before calculating sortable game and aggregate library metrics.',
    engineering: ['Python', 'Flask', 'SQLAlchemy', 'Steam Web API', 'Concurrency'],
    github: 'https://github.com/quangshuynh/steam-value-lookup',
    visual: 'steam',
  },
  {
    name: 'Foody',
    label: 'Full-stack application breadth',
    problem: 'Restaurant lists, recommendations, visits, and location data are difficult to keep useful when they live across different tools.',
    built: 'A restaurant discovery and tracking application with CRUD workflows, persistent data, audit logging, React Context and Hooks, plus interactive maps and geocoding through React-Leaflet and OpenStreetMap services.',
    engineering: ['React', 'JavaScript', 'CRUD', 'Persistent data', 'React-Leaflet', 'Nominatim'],
    github: 'https://github.com/quangshuynh/Foody',
    visual: 'foody',
  },
];

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
          <img src={dashboardImage} alt="Business Data Automation reconciliation dashboard showing financial totals, payment statuses, and flagged discrepancies" loading="lazy" />
        )}
      </div>
      <div className="gallery-controls" aria-label="Business Data Automation gallery">
        <button type="button" aria-pressed={slide === 'architecture'} onClick={() => setSlide('architecture')}>Architecture</button>
        <button type="button" aria-pressed={slide === 'dashboard'} onClick={() => setSlide('dashboard')}>Dashboard</button>
      </div>
    </div>
  );
}

function ProjectVisual({ type, name }) {
  if (type === 'dashboard') {
    return (
      <BusinessGallery />
    );
  }
  if (type === 'steam') {
    return (
      <div className="project-visual steam">
        <img className="steam-corner-logo" src={steamLogo} alt="" aria-hidden="true" />
        <div className="steam-mark" aria-label={`${name} project graphic`}>
          <div><strong>∑</strong><span>Library value</span></div>
        </div>
      </div>
    );
  }
  return <div className="project-visual foody"><img src={foodyImage} alt="Foody restaurant tracking application interface" loading="lazy" /></div>;
}

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
            <article className="featured-project" key={project.name}>
              <ProjectVisual type={project.visual} name={project.name} />
              <div className="project-copy">
                <span className="project-number">{String(index + 1).padStart(2, '0')} · {project.label}</span>
                <h3>{project.name}</h3>
                <p><strong>Problem.</strong> {project.problem}</p>
                <p><strong>Built.</strong> {project.built}</p>
                <ul className="tag-list" aria-label={`${project.name} technologies`}>
                  {project.engineering.map((item) => <li key={item}>{item}</li>)}
                </ul>
                <div className="project-actions">
                  <a className="button" href={project.github} target="_blank" rel="noreferrer">View code <FaGithub aria-hidden="true" /></a>
                  {index === 0 && <a className="button button-secondary" href={`${project.github}#architecture`} target="_blank" rel="noreferrer">Architecture <FaExternalLinkAlt aria-hidden="true" /></a>}
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
