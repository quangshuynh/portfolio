import React from 'react';
import { FaExternalLinkAlt, FaGithub } from 'react-icons/fa';
import foodyLogo from '../assets/foody-logo.png';
import repoRadarLogo from '../assets/repo-radar-logo.png';

const projects = [
  {
    name: 'SalonFlow',
    description: 'UI-complete salon-management SaaS frontend for scheduling, staff, customers, services, and reporting. It currently uses realistic mock data; Supabase persistence is not yet implemented.',
    highlight: '14 Vitest tests with CI checks for lint, test, and production build',
    technologies: ['Next.js', 'TypeScript', 'Vitest'],
    github: 'https://github.com/quangshuynh/salonflow',
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
    name: 'Repo Radar',
    description: 'Personalized GitHub repository discovery tool that learns from starred repositories and explicit feedback to rank candidates by relevance, quality, activity, and novelty.',
    highlight: 'Combines preference signals, discovery history, exclusions, and feedback with inspectable ranking behavior; currently in recommendation-quality validation mode.',
    technologies: ['Python', 'FastAPI', 'GitHub API', 'Recommendation Systems'],
    github: 'https://github.com/quangshuynh/repo-radar',
    logo: repoRadarLogo,
  },
  {
    name: 'AI Cooking Assistant',
    description: 'Full-stack cooking assistant built for HACK.COMS 2024, combining a Flask application with Ollama and Weaviate-powered recipe generation and vector search.',
    highlight: 'Modular model providers with ingredient filters and recipe-similarity search',
    technologies: ['Python', 'Flask', 'Ollama', 'Weaviate'],
    github: 'https://github.com/quangshuynh/AI-Cooking-Assistant',
  },
];

/**
 * renders the additional project collection
 * :returns: additional projects section markup
 */
function MoreProjects() {
  return (
    <section className="page-section" id="more-projects" aria-labelledby="more-projects-title">
      <div className="section-inner">
        <div className="section-heading">
          <div><p className="eyebrow">Additional work</p><h2 id="more-projects-title">More projects</h2></div>
          <p>Supporting projects that add product, developer-tooling, and applied AI breadth without competing with the featured work.</p>
        </div>
        <div className="more-grid">
          {projects.map((project) => (
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
      </div>
    </section>
  );
}

export default MoreProjects;
