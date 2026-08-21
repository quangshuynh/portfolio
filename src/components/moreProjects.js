import React from 'react';
import { FaGithub } from 'react-icons/fa';

const projects = [
  {
    name: 'SalonFlow',
    description: 'UI-complete salon management SaaS frontend for scheduling, staff, customers, services, and reporting. It currently runs on mock data while persistence work remains separate.',
    technologies: ['Next.js', 'TypeScript', 'Frontend'],
    github: 'https://github.com/quangshuynh/salonflow',
  },
  {
    name: 'GitHub to Markdown',
    description: 'Browser-based developer tool that exports public repository data to Markdown and audits repository names and descriptions with actionable suggestions.',
    technologies: ['JavaScript', 'GitHub API', 'Developer tooling'],
    github: 'https://github.com/quangshuynh/github-to-markdown',
  },
  {
    name: 'AI Cooking Assistant',
    description: 'Full-stack cooking assistant built for HACK.COMS 2024, combining a Flask application with Ollama and Weaviate-powered recipe generation and vector search.',
    technologies: ['Python', 'Flask', 'Ollama', 'Weaviate'],
    github: 'https://github.com/quangshuynh/AI-Cooking-Assistant',
  },
];

function MoreProjects() {
  return (
    <section className="page-section" id="more-projects" aria-labelledby="more-projects-title">
      <div className="section-inner">
        <div className="section-heading">
          <div><p className="eyebrow">Additional work</p><h2 id="more-projects-title">More projects</h2></div>
          <p>A smaller selection showing frontend, developer-tooling, and applied AI breadth.</p>
        </div>
        <div className="more-grid">
          {projects.map((project) => (
            <article className="more-card" key={project.name}>
              <h3>{project.name}</h3>
              <p>{project.description}</p>
              <ul className="tag-list" aria-label={`${project.name} technologies`}>
                {project.technologies.map((item) => <li key={item}>{item}</li>)}
              </ul>
              <a className="text-link" href={project.github} target="_blank" rel="noreferrer">Inspect repository <FaGithub aria-hidden="true" /></a>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export default MoreProjects;
