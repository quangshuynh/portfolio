import React, { useState } from 'react';
import { FaExternalLinkAlt, FaGithub } from 'react-icons/fa';
import PersonalityButton from '../ui/personalityButton';
import { featuredProjects as projects } from '../../data/projects.mjs';
import { ProjectVisual } from './projectMedia';

/**
 * renders a featured project's code, demo, and documentation links
 * :param project: project entry
 * :returns: action buttons markup
 */
function ProjectActions({ project }) {
  const { github, live, documentation } = project.links;
  return (
    <div className="project-actions">
      {live && !github && <PersonalityButton href={live} target="_blank" rel="noreferrer" aria-label={`Open ${project.name} live site`}>Live Site <FaExternalLinkAlt aria-hidden="true" /></PersonalityButton>}
      {github && <PersonalityButton href={github} target="_blank" rel="noreferrer" aria-label={`View ${project.name} code`}>View code <FaGithub aria-hidden="true" /></PersonalityButton>}
      {live && github && <PersonalityButton secondary personality="auto" personalityKey={`${project.name}-live`} href={live} target="_blank" rel="noreferrer" aria-label={`Open ${project.name} live demo`}>Live demo <FaExternalLinkAlt aria-hidden="true" /></PersonalityButton>}
      {documentation && <PersonalityButton secondary personality="auto" personalityKey={`${project.name}-documentation`} href={documentation} target="_blank" rel="noreferrer" aria-label={`Open ${project.name} documentation`}>Documentation <FaExternalLinkAlt aria-hidden="true" /></PersonalityButton>}
    </div>
  );
}

/**
 * renders a project's implementation highlights behind a disclosure toggle;
 * the list stays in the DOM (inert while collapsed) so it can animate open
 * and remains in the prerendered HTML
 * :param project: project entry
 * :returns: disclosure toggle and highlights panel markup
 */
function ProjectDetails({ project }) {
  const [open, setOpen] = useState(false);
  const panelId = `project-${project.slug}-details`;
  return (
    <div className={`project-details${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="project-details__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        aria-describedby={`project-${project.slug}-title`}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{open ? 'Hide technical details' : 'Explore technical details'}</span>
        <svg className="project-details__chevron" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          <path d="M2.5 4.5 6 8l3.5-3.5" />
        </svg>
      </button>
      <div className="project-details__panel" id={panelId} inert={!open}>
        <div className="project-details__inner">
          <ul className="project-highlights" aria-label={`${project.name} engineering highlights`}>
            {project.highlights.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      </div>
    </div>
  );
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
              id={`project-${project.slug}`}
              aria-labelledby={`project-${project.slug}-title`}
              className={`featured-project case-file${index === 0 ? ' flagship-project case-file--wide' : ''}${index % 2 === 0 ? '' : ' case-file--flip'}`}
            >
              <div className="case-file__rail" data-reveal>
                <span className="case-file__index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                <dl className="case-file__meta">
                  <div><dt>Type</dt><dd className="project-number">{project.label}</dd></div>
                  <div className="project-stack">
                    <dt>Stack</dt>
                    <dd>
                      <ul className="tech-tags" aria-label={`${project.name} technologies`}>
                        {project.technologies.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="case-file__visual viewfinder" data-reveal style={{ '--reveal-delay': '80ms' }}>
                <ProjectVisual project={project} />
              </div>
              <div className="project-copy" data-reveal style={{ '--reveal-delay': '140ms' }}>
                {/* Self-linking title: gives each project a shareable /#project-… URL. */}
                <h3 id={`project-${project.slug}-title`}>
                  <a className="project-permalink" href={`#project-${project.slug}`}>{project.name}</a>
                </h3>
                <p className="project-purpose">{project.summary}</p>
                <p className="project-takeaway"><span className="project-takeaway__label">Takeaway</span> {project.takeaway}</p>
                <ProjectDetails project={project} />
                <ProjectActions project={project} />
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export default FeaturedProjects;
