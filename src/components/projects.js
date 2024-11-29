import React from 'react';
import '../styles/projects.css';
import { FaGithub } from 'react-icons/fa'; // Import GitHub icon
import ai_cook from '../assets/ai_cook.jpg'
import car_price_prediction from '../assets/car_price_prediction.png'
import astro_game from '../assets/astro_game.png'
import ngram from '../assets/ngram.png'
import ai_panel from '../assets/ai_panel.png'
import pw_manager from '../assets/pw_manager.png'
import budget_assistant from '../assets/budget_assistant.png'

function Projects() {
  const projects = [
    {
      name: 'AI Cooking Assistant',
      about: 'A Flask-based recipe generation app that uses Ollama LLM and Weaviate DB to create unique meal ideas.',
      logo: ai_cook, 
      github: 'https://github.com/quangshuynh/AI-Cooking-Assistant/', 
    },
    {
      name: 'Personalized Budget Assistant',
      about: 'A Flask-based web app to track expenses, categorize transactions and visualize spending with dark/light mode support.',
      logo: budget_assistant, 
      github: 'https://github.com/quangshuynh/Personalized-Budgeting-Assistant', 
    },
    {
      name: 'AI Panel Game App',
      about: 'A Tkinkter-based GUI app that simulates an interactive panel of AI agents with unique personalities, responding to user questions and engaging in multi-agent conversations using Ollama LLM',
      logo: ai_panel, 
      github: 'https://github.com/quangshuynh/AI-Panelist-GUI', 
    },
    {
      name: 'Password Manager',
      about: 'Secure, GUI-based password manager using cryptography, and customtkinter. Built collaboratively with a focus on usability and encryption.',
      logo: pw_manager, 
      github: 'https://github.com/quangshuynh/passwordmanager', 
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
      about: 'Analyzed 4GB of Google Books Ngram data to visualize trends, compute word similarities and uncover linguistic insights using Matplotlib & NumPy.',
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
