import React, { useState } from 'react';
import '../styles/featuredProjects.css';
import { FaGithub } from 'react-icons/fa'; 
import { Link } from 'react-router-dom';
import useClickSound from '../hooks/useClickSound';

import ai_cook from '../assets/ai_cook.jpg';
import car_price_prediction from '../assets/car_price_prediction.png';
import astro_game from '../assets/astro_game.png';
import ngram from '../assets/ngram.png';
import pw_manager from '../assets/pw_manager.png';
import ray_trace_sim from '../assets/ray_trace_sim.png';

function FeaturedProjects() {
  const [selectedImage, setSelectedImage] = useState(null);

  const handleImageClick = (image) => {
    setSelectedImage(image);
  };

  const closeModal = () => {
    setSelectedImage(null);
  };

  const { playOn, playOff, hover } = useClickSound();

  const projects = [
    {
      name: 'Ray Trace Simulator',
      about: 'A Python-based GUI tool that simulates ray tracing through single lenses. It calculates lens power, effective focal length (EFL), and numerical aperture (NA), with interactive lens visualization using CustomTkinter and PyRayT',
      logo: ray_trace_sim, 
      github: 'https://github.com/tatefinger/learning/tree/main', 
      techStack: ['Python', 'CustomTkinter', 'Matplotlib', 'PyRayT', 'Tinygfx'],
    },
    {
      name: 'AI Cooking Assistant',
      about: 'A Flask-based recipe generation app that uses Ollama LLM and Weaviate DB to create unique meal ideas',
      logo: ai_cook, 
      github: 'https://github.com/quangshuynh/AI-Cooking-Assistant/', 
      techStack: ['Python', 'Flask', 'Ollama LLM', 'Weaviate DB', 'HTML', 'CSS', 'JavaScript'],
    },
    {
      name: 'Password Manager',
      about: 'Secure, GUI-based password manager using cryptography, and customtkinter. Built collaboratively with a focus on usability and encryption',
      logo: pw_manager, 
      github: 'https://github.com/quangshuynh/passwordmanager', 
      techStack: ['Python', 'CustomTkinter', 'Fernet'],
    },
    {
      name: 'Car Price Prediction',
      about: 'A machine learning model built with PyTorch to predict the price of used cars based on key features',
      logo: car_price_prediction, 
      github: 'https://github.com/quangshuynh/car-prices-prediction/', 
      techStack: ['Python', 'PyTorch', 'NumPy', 'Pandas', 'HTML', 'CSS', 'JavaScript'],
    },
    {
      name: 'Astro & Hoppers Game',
      about: 'A 2D puzzle game inspired by Lunar Landing, built with JavaFX, PTUI, MVC design pattern and BFS algorithms',
      logo: astro_game, 
      github: 'https://github.com/quangshuynh/javafx-board-game/', 
      techStack: ['Java', 'JavaFX', 'BFS Algorithm', 'MVC'],
    },
    {
      name: 'Ngram Text Statistics',
      about: 'Analyzed 4GB of Google Books Ngram data to visualize trends, compute word similarities and uncover linguistic insights using Matplotlib & NumPy',
      logo: ngram, 
      github: 'https://github.com/quangshuynh/ngram/', 
      techStack: ['Python', 'NumPy', 'Matplotlib'],
    },
  ];

  return (
    <section id="projects" className="experience-section">
      <h2>Featured Projects</h2>
      <div className="projects-container">
        {projects.map((project, index) => (
          <div key={index} className="project-card">
            <img src={project.logo} alt={`${project.name} logo`} className="project-logo" onClick={() => {playOn(); handleImageClick(project.logo)}}/>
            <a href={project.github} target="_blank" rel="noopener noreferrer" className="github-link" onClick={playOn}> <FaGithub className="github-icon" /> GitHub Repo </a>
            <div className="project-details">
              <h3>{project.name}</h3>
              <p>{project.about}</p>
              <ul className="tech-stack">
                {project.techStack.map((tech, idx) => (
                  <li key={idx} onMouseEnter={hover} className="tech-item">{tech}</li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>

      {selectedImage && (
        <div className="modal-overlay" onClick={() => {playOff(); closeModal();}}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <img src={selectedImage} alt="Enlarged project logo" className="modal-image" />
            <button className="close-modal" onClick={() => {playOff(); closeModal();}}>&times;</button>
          </div>
        </div>
      )}

      <div className="view-more-container">
        <Link to="/moreprojects" className="view-more-button" onClick={playOn}>
          View more of my projects!
        </Link>
      </div>
    </section>
  );
}

export default FeaturedProjects;
