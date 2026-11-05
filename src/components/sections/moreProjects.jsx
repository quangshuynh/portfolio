import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FaExternalLinkAlt, FaGithub } from 'react-icons/fa';
import PersonalityButton from '../ui/personalityButton';
import { moreProjects as projects, PROJECT_CATEGORIES } from '../../data/projects.mjs';
import { optimizedImage, ProjectScreenshot } from './projectMedia';

/**
 * renders a project's repository and live/documentation links
 * :param project: project entry
 * :returns: links markup
 */
function ProjectLinks({ project }) {
  const { github, live, liveLabel } = project.links;
  if (!github && !live) return <p className="more-links more-links--private">Private repository</p>;
  return (
    <div className="more-links">
      {github && <a className="text-link" href={github} target="_blank" rel="noreferrer" aria-label={`Open ${project.name} repository`}>Repository <FaGithub aria-hidden="true" /></a>}
      {live && <a className="text-link" href={live} target="_blank" rel="noreferrer" aria-label={`Open ${project.name} ${liveLabel ? liveLabel.toLowerCase() : 'live demo'}`}>{liveLabel || 'Live demo'} <FaExternalLinkAlt aria-hidden="true" /></a>}
    </div>
  );
}

/**
 * renders the additional project collection
 * :returns: additional projects section markup
 */
// Collapsed, the "All" view shows two rows of the three-column grid.
export const COLLAPSED_COUNT = 6;
const categories = PROJECT_CATEGORIES.filter((category) => projects.some((project) => project.category === category));

/**
 * renders a More project's preview: its first screenshot (opening every
 * screenshot in the viewer), else its logo on a quiet panel
 * :param project: project entry
 * :returns: preview markup, or null with neither
 */
function ProjectPreview({ project }) {
  if (project.screenshots?.length) {
    return <div className="more-card__media"><ProjectScreenshot project={project} index={0} imageClassName="more-card-preview" /></div>;
  }
  if (!project.logo) return null;
  return (
    <div className="more-card__media more-card__media--logo">
      <img src={optimizedImage(project.logo.file)} alt={project.logo.alt} loading="lazy" decoding="async" />
    </div>
  );
}

function MoreProjects() {
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [filter, setFilter] = useState('All');
  const collapsedScrollY = useRef(null);
  const pendingScrollY = useRef(null);
  const toggleButton = useRef(null);
  const grid = useRef(null);
  const filtered = filter === 'All' ? projects : projects.filter((project) => project.category === filter);
  // A category is short enough to show whole; only "All" collapses.
  const collapsible = filter === 'All' && projects.length > COLLAPSED_COUNT;
  const visibleProjects = collapsible && !showAllProjects ? projects.slice(0, COLLAPSED_COUNT) : filtered;

  // A deep link to a project hidden by the collapsed view opens the full list.
  useEffect(() => {
    const reveal = () => {
      if (projects.slice(COLLAPSED_COUNT).some((project) => window.location.hash === `#project-${project.slug}`)) {
        setFilter('All');
        setShowAllProjects(true);
      }
    };
    reveal();
    window.addEventListener('hashchange', reveal);
    return () => window.removeEventListener('hashchange', reveal);
  }, []);

  useLayoutEffect(() => {
    if (pendingScrollY.current === null) return;
    const scrollY = pendingScrollY.current;
    pendingScrollY.current = null;
    if (window.scrollY !== scrollY) {
      window.scrollTo({ top: scrollY, left: 0, behavior: 'auto' });
    }
    // Focus moves only after the scroll is restored, with preventScroll, so it
    // never drags the page. Expanding lands on the first newly shown project;
    // collapsing returns to the toggle (otherwise focus would fall to <body>).
    const target = showAllProjects
      ? grid.current?.querySelector(`article:nth-child(${COLLAPSED_COUNT + 1}) h3`)
      : toggleButton.current;
    target?.focus({ preventScroll: true });
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
        <div className="project-filters" role="group" aria-label="Filter projects by category" data-reveal>
          {['All', ...categories].map((category) => {
            const count = category === 'All' ? projects.length : projects.filter((project) => project.category === category).length;
            return (
              <button key={category} type="button" aria-pressed={filter === category} aria-controls="more-projects-grid" onClick={() => setFilter(category)}>
                {category} <span className="project-filters__count" aria-hidden="true">{count}</span>
              </button>
            );
          })}
        </div>
        <p className="visually-hidden" role="status" aria-live="polite">{filter === 'All' ? '' : `${filtered.length} ${filter} projects shown`}</p>
        <div className="more-grid" id="more-projects-grid" ref={grid}>
          {visibleProjects.map((project) => (
            // Same anchor as a featured case file, so links to a demoted project keep working.
            <article className="more-card" id={`project-${project.slug}`} key={project.slug} aria-labelledby={`more-${project.slug}-title`}>
              <ProjectPreview project={project} />
              <div className="more-card__body">
                <div className="more-card__head">
                  {project.logo && project.screenshots?.length > 0 && (
                    <img className={`more-card-logo${project.logo.className ? ` ${project.logo.className}` : ''}`} src={optimizedImage(project.logo.file)} width="28" height="28" alt="" loading="lazy" decoding="async" />
                  )}
                  <p className="more-card__category">{project.category}</p>
                </div>
                <h3 id={`more-${project.slug}-title`} tabIndex={-1}>{project.name}</h3>
                {project.tagline && <p className="more-card__tagline">{project.tagline}</p>}
                <p className="more-card__summary">{project.summary}</p>
                <details className="more-card__detail">
                  <summary>How it’s built</summary>
                  <p className="more-highlight">{project.detail}</p>
                </details>
                <ul className="tag-list" aria-label={`${project.name} technologies`}>
                  {project.technologies.map((item) => <li key={item}>{item}</li>)}
                </ul>
                <ProjectLinks project={project} />
              </div>
            </article>
          ))}
        </div>
        {collapsible && (
          <div className="more-toggle">
            <PersonalityButton
              secondary
              personality="auto"
              personalityKey="more-projects-toggle"
              ref={toggleButton}
              type="button"
              aria-expanded={showAllProjects}
              aria-controls="more-projects-grid"
              onClick={toggleProjects}
            >
              {showAllProjects ? 'Show fewer projects' : 'View more projects'}
            </PersonalityButton>
          </div>
        )}
        <p className="more-archive">
          Older coursework, experiments, and archived projects stay on{' '}
          <a className="text-link" href="https://github.com/quangshuynh?tab=repositories" target="_blank" rel="noreferrer">GitHub <FaGithub aria-hidden="true" /></a>.
        </p>
      </div>
    </section>
  );
}

export default MoreProjects;
