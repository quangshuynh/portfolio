import React, { useEffect, useState } from 'react';
import { FaArrowRight, FaFilePdf, FaMapMarkerAlt } from 'react-icons/fa';
import quangPhoto from '../assets/quang.jpg';
import { aboutHref } from './siteNav';
import PersonalityButton from './personalityButton';

/**
 * renders the primary navigation and portfolio introduction
 * :returns: header markup
 */
function Header() {
  const [isWaving, setIsWaving] = useState(false);
  const [waveRun, setWaveRun] = useState(0);

  useEffect(() => {
    if (!isWaving) return undefined;
    const stopWaving = window.setTimeout(() => setIsWaving(false), 2100);
    return () => window.clearTimeout(stopWaving);
  }, [isWaving, waveRun]);

  const waveHello = () => {
    setIsWaving(true);
    setWaveRun((run) => run + 1);
  };

  return (
    <header className="home-header snap-stage scroll-enter">
      <section className="hero" id="top" aria-labelledby="hero-title">
        <div className="hero-inner reveal-content">
          <div className="hero-copy">
          <p className="eyebrow">Software Engineering | Backend | Developer Tools | Native Apps</p>
          <p className="hero-intro">
            Hi, I’m Quang.
            <button
              className={`wave-trigger${isWaving ? ' is-waving' : ''}`}
              type="button"
              aria-label="Wave hello"
              onClick={waveHello}
            >
              <span key={waveRun} className={`wave${isWaving ? ' is-waving' : ''}`} role="img" aria-label="Waving hand">👋🏻</span>
            </button>
          </p>
          <h1 id="hero-title">I build reliable backend systems, developer tools, automation, and native applications.</h1>
          <p className="hero-lede">
            I’m a software developer with professional experience in .NET applications,
            databases, and enterprise workflows. I also design, deploy, and maintain production
            web applications for family-owned businesses alongside my backend, developer-tool,
            and native application work.
          </p>
          <div className="hero-meta" aria-label="Location and focus">
            <span><FaMapMarkerAlt aria-hidden="true" /> Rochester, NY</span>
            <span>Backend systems</span>
            <span>Developer tools</span>
            <span>Native applications</span>
          </div>
          <div className="hero-actions">
            <PersonalityButton href="#projects" personality="rally" personalityKey="hero-view-work">View my work <FaArrowRight aria-hidden="true" /></PersonalityButton>
            <a className="button button-secondary" href={`${process.env.PUBLIC_URL}/Quang_Huynh_Resume.pdf`} target="_blank" rel="noreferrer">
              View résumé <FaFilePdf aria-hidden="true" />
            </a>
          </div>
          </div>
          <div className="hero-photo-wrap">
            <a className="hero-photo-link" href={aboutHref} aria-label="About Quang">
              <img className="hero-photo" src={quangPhoto} alt="Quang Huynh" />
            </a>
            <a className="about-float-link" href={aboutHref}>
              <span>Meet Quang</span><FaArrowRight aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>
    </header>
  );
}

export default Header;
