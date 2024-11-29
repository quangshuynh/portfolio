import React from 'react';
import '../styles/projects.css';
import { FaGithub } from 'react-icons/fa'; // Import GitHub icon
import ai_cook from '../assets/ai_cook.jpg'
import car_price_prediction from '../assets/car_price_prediction.png'
import astro_game from '../assets/astro_game.png'
import ngram from '../assets/ngram.png'

function Projects() {
  const projects = [
    {
      name: 'AI Cooking Assistant',
      about: 'A Flask-based recipe generation app that uses an Ollama model and Weaviate DB to create unique meal ideas.',
      logo: ai_cook, 
      github: 'https://github.com/quangshuynh/AI-Cooking-Assistant/', 
    },
    {
      name: 'Car Price Prediction',
      about: 'A machine learning model built with PyTorch to predict the price of used cars based on key features.',
      logo: car_price_prediction, 
      github: 'https://github.com/quangshuynh/car-prices-prediction/', 
    },
    {
      name: 'Astro & Hoppers Game',
      about: 'A 2D puzzle game inspired by Lunar Landing, built with JavaFX, PTUI, MVC design pattern and BFS algorithms.',
      logo: astro_game, 
      github: 'https://github.com/quangshuynh/javafx-board-game/', 
    },
    {
      name: 'Ngram Text Statistics',
      about: 'Analyzed 4GB of Google Books Ngram data to visualize trends, compute word similarities, and uncover linguistic insights using Matplotlib, and NumPy.',
      logo: ngram, 
      github: 'https://github.com/quangshuynh/ngram/', 
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
