import React from 'react';
import { FaArrowRight, FaFilePdf, FaMapMarkerAlt } from 'react-icons/fa';
import quangPhoto from '../assets/quang.jpg';
import chiTheCat from '../assets/chi-the-cat.png';

/**
 * renders the primary navigation and portfolio introduction
 * :returns: header markup
 */
function Header() {
  return (
    <header>
      <nav className="site-nav" aria-label="Primary navigation">
        <div className="nav-inner">
          <a className="brand brand-cat" href="#top" aria-label="Chi the cat, back to top">
            <img src={chiTheCat} alt="" aria-hidden="true" />
          </a>
          <div className="nav-links">
            <a href="#experience">Experience</a>
            <a href="#projects">Projects</a>
            <a href="#skills">Skills</a>
            <a href="#about">About</a>
            <a href="#contact">Contact</a>
          </div>
        </div>
      </nav>

      <section className="hero" id="top" aria-labelledby="hero-title">
        <div className="hero-inner">
          <p className="eyebrow">Software Engineering | Backend | Developer Tools | Native Apps</p>
          <p className="hero-intro">Hi, I’m Quang.</p>
          <h1 id="hero-title">I build reliable backend systems, developer tools, automation, and native applications.</h1>
          <p className="hero-lede">
            I’m a software developer with professional experience in .NET applications,
            databases, and enterprise workflows, alongside independent work in backend
            services, developer tools, and native applications.
          </p>
          <div className="hero-meta" aria-label="Location and focus">
            <span><FaMapMarkerAlt aria-hidden="true" /> Rochester, NY</span>
            <span>Backend systems</span>
            <span>Developer tools</span>
            <span>Native applications</span>
          </div>
          <div className="hero-actions">
            <a className="button" href="#projects">View my work <FaArrowRight aria-hidden="true" /></a>
            <a className="button button-secondary" href={`${process.env.PUBLIC_URL}/Quang_Huynh_Resume.pdf`} target="_blank" rel="noreferrer">
              View résumé <FaFilePdf aria-hidden="true" />
            </a>
          </div>
          <img className="hero-photo" src={quangPhoto} alt="Quang Huynh" />
        </div>
      </section>
    </header>
  );
}

export default Header;
