import React from 'react';
import '../styles/projects.css';
import { FaGithub } from 'react-icons/fa'; // Import GitHub icon

function Projects() {
  const projects = [
    {
      name: 'AI Cooking Assistant',
      about: 'A Flask-based recipe generation app that uses machine learning to create unique meal ideas.',
      logo: 'https://d112y698adiu2z.cloudfront.net/photos/production/software_photos/003/115/209/datas/gallery.jpg', 
      github: 'https://github.com/quangshuynh/AI-Cooking-Assistant/', 
    },
    {
      name: 'Car Price Prediction',
      about: 'A machine learning model built with PyTorch to predict the price of used cars based on key features.',
      logo: 'https://i.imgur.com/BW95ds4.png', 
      github: 'https://github.com/quangshuynh/car-prices-prediction', 
    },
  ];

  return (
    <section id="projects" className="experience-section">
      <h2>Projects</h2>
      <div className="projects-container">
        {projects.map((project, index) => (
          <div key={index} className="project-card">
            <img src={project.logo} alt={`${project.name} logo`} className="project-logo" />
            <div className="project-details">
              <h3>{project.name}</h3>
              <p>{project.about}</p>
              <a
                href={project.github}
                target="_blank"
                rel="noopener noreferrer"
                className="github-link"
              >
                <FaGithub className="github-icon" /> GitHub Repo
              </a>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default Projects;
