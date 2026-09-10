import React from 'react';
import { FaArrowRight, FaFilePdf, FaMapMarkerAlt } from 'react-icons/fa';
import quangPhoto from '../assets/quang.jpg';
import wavingHand from '../assets/waving_hand.svg';
import SiteNav, { aboutHref } from './siteNav';
import PersonalityButton from './personalityButton';

/**
 * renders the primary navigation and portfolio introduction
 * :returns: header markup
 */
function Header() {
  return (
    <header className="home-header scroll-stop scroll-enter">
      <SiteNav />

      <section className="hero" id="top" aria-labelledby="hero-title">
        <div className="hero-inner reveal-content">
          <div className="hero-copy">
          <p className="eyebrow">Software Engineering | Backend | Developer Tools | Native Apps</p>
          <p className="hero-intro">
            Hi, I’m Quang.
            <img className="waving-hand" src={wavingHand} alt="" aria-hidden="true" />
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
