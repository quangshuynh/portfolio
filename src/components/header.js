import React from 'react';
import '../styles/header.css';
import { FaLinkedin, FaGithub, FaEnvelope } from 'react-icons/fa';

function Header() {
  return (
    <div className="header">
      <div className="profile">
        <img
          src="https://i.imgur.com/6QbgYeB.png"
          alt="Quang Huynh"
          className="profile-pic"
        />
      </div>
      <h1 className="header-title">
        Hey there! <span className="wave">👋</span>
      </h1>
      <h2 className="header-subtitle">
        I'm <span className="highlight">Quang Huynh</span>, a creative software
        engineer driven by impactful solutions
      </h2>
      <a href="Quang_Huynh_Resume.pdf" target="_blank" rel="noopener noreferrer">
        <button className="cv-button">Download CV</button>
      </a>
      <div className="social-icons">
        <a
          href="https://linkedin.com/in/quangs"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="LinkedIn"
        >
          <FaLinkedin className="icon linkedin" />
        </a>
        <a
          href="https://github.com/quangshuynh"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub"
        >
          <FaGithub className="icon github" />
        </a>
        <a href="mailto:qth9368@rit.edu" aria-label="Email">
          <FaEnvelope className="icon email" />
        </a>
      </div>
    </div>
  );
}

export default Header;
