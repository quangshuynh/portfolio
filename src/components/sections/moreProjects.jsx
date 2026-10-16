import React, { useLayoutEffect, useRef, useState } from 'react';
import { FaExternalLinkAlt, FaGithub } from 'react-icons/fa';
import PersonalityButton from '../ui/personalityButton';
import { moreProjects as projects } from '../../data/projects.mjs';
import { optimizedImage, ProjectScreenshot } from './projectMedia';

/**
 * renders a project's repository and live/documentation links
 * :param project: project entry
 * :returns: links markup
 */
function ProjectLinks({ project }) {
  const { github, live, liveLabel } = project.links;
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
function MoreProjects() {
  const [showAllProjects, setShowAllProjects] = useState(false);
  const collapsedScrollY = useRef(null);
  const pendingScrollY = useRef(null);
  const toggleButton = useRef(null);
  const grid = useRef(null);
  const visibleProjects = showAllProjects ? projects : projects.slice(0, 3);

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
      ? grid.current?.querySelector('article:nth-child(4) h3')
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
        <div className="more-grid ledger" id="more-projects-grid" ref={grid}>
          {visibleProjects.map((project, index) => (
            <article className={`more-card ledger-row${project.logo ? ' has-logo' : ''}`} key={project.slug} data-reveal style={{ '--reveal-delay': `${(index % 3) * 70}ms` }}>
              <div className="ledger-row__id">
                <span className="ledger-row__index mono" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                {project.logo && (
                  <img
                    className={`more-card-logo${project.logo.className ? ` ${project.logo.className}` : ''}`}
                    src={optimizedImage(project.logo.file)}
                    width="44"
                    height="44"
                    alt={project.logo.alt}
                    loading="lazy"
                    decoding="async"
                  />
                )}
              </div>
              <div className="ledger-row__main">
                <h3 tabIndex={-1}>{project.name}</h3>
                {project.tagline && <p className="ledger-row__tagline">{project.tagline}</p>}
                <p>{project.summary}</p>
                <p className="more-highlight">{project.detail}</p>
              </div>
              <div className="ledger-row__side">
                {project.screenshots?.length > 0 && <ProjectScreenshot project={project} index={0} imageClassName="more-card-preview" />}
                <ul className="tag-list" aria-label={`${project.name} technologies`}>
                  {project.technologies.map((item) => <li key={item}>{item}</li>)}
                </ul>
                <ProjectLinks project={project} />
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
      </div>
    </section>
  );
}

export default MoreProjects;
