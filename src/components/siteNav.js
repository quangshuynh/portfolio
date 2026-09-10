import React, { useLayoutEffect, useRef } from 'react';
import chiTheCat from '../assets/chi-the-cat.png';

const homeHref = (hash = '') => `${process.env.PUBLIC_URL || ''}/${hash}`;
const aboutHref = `${process.env.PUBLIC_URL || ''}/about`;

const desktopNavQuery = '(min-width: 1024px)';
const collapseDistance = 440;

const mix = (expanded, compact, progress) => expanded + (compact - expanded) * progress;

const readNavMetrics = () => {
  const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return {
    rootFontSize,
    expandedNavHeight: Math.min(12 * rootFontSize, Math.max(10 * rootFontSize, window.innerHeight * 0.2)),
    expandedLogoSize: Math.min(9.25 * rootFontSize, Math.max(8 * rootFontSize, window.innerWidth * 0.08)),
    expandedBrandSize: Math.min(2.9 * rootFontSize, Math.max(2.5 * rootFontSize, window.innerWidth * 0.03)),
  };
};

const writeNavProgress = (nav, progress, metrics) => {
  const { rootFontSize, expandedNavHeight, expandedLogoSize, expandedBrandSize } = metrics;

  nav.style.setProperty('--nav-progress', progress.toFixed(3));
  nav.style.setProperty('--nav-current-height', `${mix(expandedNavHeight, 4.5 * rootFontSize, progress)}px`);
  nav.style.setProperty('--logo-current-size', `${mix(expandedLogoSize, 54, progress)}px`);
  nav.style.setProperty('--logo-image-current-size', `${mix(expandedLogoSize * 2, 108, progress)}px`);
  nav.style.setProperty('--brand-current-size', `${mix(expandedBrandSize, 1.05 * rootFontSize, progress)}px`);
  nav.style.setProperty('--brand-current-gap', `${mix(1.35, 0.75, progress)}rem`);
  nav.style.setProperty('--nav-current-padding', `${mix(0.75, 0.5625, progress)}rem`);
  nav.style.setProperty('--links-current-size', `${mix(1.12, 0.92, progress)}rem`);
  nav.style.setProperty('--links-current-gap', `${mix(2.15, 1.5, progress)}rem`);
  nav.style.setProperty('--tld-current-padding-y', `${mix(0.34, 0.2, progress)}rem`);
  nav.style.setProperty('--tld-current-padding-x', `${mix(0.68, 0.42, progress)}rem`);
  nav.style.setProperty('--nav-background-mix', `${mix(92, 100, progress)}%`);
};

/** Renders navigation that works from both the homepage and the About page. */
function SiteNav({ collapsible = false }) {
  const navRef = useRef(null);
  const initialProgress = typeof window !== 'undefined'
    && window.location.hash
    && window.location.hash !== '#top' ? 1 : 0;

  useLayoutEffect(() => {
    if (!collapsible || typeof window.matchMedia !== 'function') return undefined;

    const nav = navRef.current;
    const desktopQuery = window.matchMedia(desktopNavQuery);
    let animationFrame;
    let previousProgress = -1;
    let metrics;

    if (!nav) return undefined;

    const updateProgress = () => {
      animationFrame = undefined;

      if (!desktopQuery.matches) return;

      const progress = Math.min(1, Math.max(0, window.scrollY / collapseDistance));

      if (Math.abs(progress - previousProgress) >= 0.001) {
        metrics ||= readNavMetrics();
        writeNavProgress(nav, progress, metrics);
        previousProgress = progress;
      }
    };

    const requestProgressUpdate = () => {
      if (animationFrame === undefined) animationFrame = window.requestAnimationFrame(updateProgress);
    };
    const requestResizedProgressUpdate = () => {
      metrics = undefined;
      previousProgress = -1;
      requestProgressUpdate();
    };

    updateProgress();
    window.addEventListener('scroll', requestProgressUpdate, { passive: true });
    window.addEventListener('resize', requestResizedProgressUpdate, { passive: true });
    desktopQuery.addEventListener?.('change', requestResizedProgressUpdate);

    return () => {
      if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('scroll', requestProgressUpdate);
      window.removeEventListener('resize', requestResizedProgressUpdate);
      desktopQuery.removeEventListener?.('change', requestResizedProgressUpdate);
    };
  }, [collapsible]);

  return (
    <nav
      ref={navRef}
      className={`site-nav${collapsible ? ' site-nav--collapsible' : ''}`}
      style={collapsible ? { '--nav-progress': initialProgress } : undefined}
      aria-label="Primary navigation"
    >
      <div className="nav-inner">
        <a className="brand brand-lockup" href={homeHref('#top')} aria-label="quanghuynh.com — back to homepage">
          <span className="brand-cat" aria-hidden="true">
            <img src={chiTheCat} alt="" />
          </span>
          <span className="brand-name">
            <span className="brand-domain">quanghuynh</span>
            <span className="brand-tld">.com</span>
          </span>
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
