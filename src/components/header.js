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
          <p className="eyebrow">Software Engineering · Python · Backend · Automation</p>
          <h1 id="hero-title">Hi, I’m Quang. I build software that solves practical problems.</h1>
          <p className="hero-lede">
            Software engineer with professional experience in .NET, SQL, and enterprise automation,
            plus independent work across Python, backend systems, APIs, databases, and full-stack development.
          </p>
          <div className="hero-meta" aria-label="Location and focus">
            <span><FaMapMarkerAlt aria-hidden="true" /> Rochester, NY</span>
            <span>Backend systems</span>
            <span>Data workflows</span>
            <span>Practical engineering</span>
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
