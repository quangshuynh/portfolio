import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FaGithub } from 'react-icons/fa';
import '../styles/moreProjects.css';
import Footer from '../components/footer';

import ai_panel from '../assets/ai_panel.png';
import foody from '../assets/foody.png';

function MoreProjects() {
  const [selectedImage, setSelectedImage] = useState(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const handleImageClick = (image) => {
    setSelectedImage(image);
  };

  const closeModal = () => {
    setSelectedImage(null);
  };

  const Projects = [
    {
      name: 'Foody',
      description:
        'A modern React app to track, discover, and share restaurants with friends',
      logo: foody,
      github: 'https://github.com/quangshuynh/Foody',
      techStack: ['React', 'Leaflet', 'JavaScript', 'CSS'],
    },
    {
      name: 'AI Panel Game App',
      about:
        'A Tkinter-based GUI app that simulates an interactive panel of AI agents with unique personalities, responding to user questions and engaging in multi-agent conversations using Ollama LLM',
      logo: ai_panel,
      github: 'https://github.com/quangshuynh/AI-Panelist-GUI',
      techStack: ['Python', 'Tkinter', 'Ollama LLM'],
    },
  ];

  return (
    <section id="more-projects" className="more-projects-page experience-section">
      <h1>More Projects</h1>
      <div className="projects-container">
        {Projects.map((project, index) => (
          <div key={index} className="project-card">
            <img
              src={project.logo}
              alt={`${project.name} logo`}
              className="project-logo"
              onClick={() => handleImageClick(project.logo)}
            />
            <a
              href={project.github}
              target="_blank"
              rel="noopener noreferrer"
              className="github-link"
            >
              <FaGithub className="github-icon" /> GitHub Repo
            </a>
            <div className="project-details">
              <h3>{project.name}</h3>
              <p>{project.description || project.about}</p>
              <ul className="tech-stack">
                {project.techStack.map((tech, idx) => (
                  <li key={idx} className="tech-item">
                    {tech}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>

      {selectedImage && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <img
              src={selectedImage}
              alt="Enlarged project logo"
              className="modal-image"
            />
            <button className="close-modal" onClick={closeModal}>
              &times;
            </button>
          </div>
        </div>
      )}

      <div className="back-button-container">
        <Link to="/#projects" className="view-more-button back-button">
          ← Back
        </Link>
      </div>
      <footer>
        <Footer />
      </footer>
    </section>
  );
}

export default MoreProjects;
