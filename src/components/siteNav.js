import React from 'react';
import chiTheCat from '../assets/chi-the-cat.png';

const homeHref = (hash = '') => `${process.env.PUBLIC_URL || ''}/${hash}`;
const aboutHref = `${process.env.PUBLIC_URL || ''}/about`;

/** Renders navigation that works from both the homepage and the About page. */
function SiteNav() {
  return (
    <nav className="site-nav" aria-label="Primary navigation">
      <div className="nav-inner">
        <a className="brand brand-cat" href={homeHref('#top')} aria-label="Back to homepage">
          <img src={chiTheCat} alt="" aria-hidden="true" />
        </a>
        <div className="nav-links">
          <a href={homeHref('#experience')}>Experience</a>
          <a href={homeHref('#projects')}>Projects</a>
          <a href={homeHref('#skills')}>Skills</a>
          <a href={homeHref('#about')}>About</a>
          <a href={homeHref('#contact')}>Contact</a>
        </div>
      </div>
    </nav>
  );
}

export { aboutHref, homeHref };
export default SiteNav;
