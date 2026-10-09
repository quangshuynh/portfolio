import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FaCamera, FaFilePdf } from 'react-icons/fa';
import chiTheCat from '../../assets/optimized/chi-the-cat.webp';
import ThemeToggle from '../ui/themeToggle';

const basePath = import.meta.env.BASE_URL;
const homeHref = (hash = '') => `${basePath}${hash}`;
const aboutHref = `${basePath}about`;
const photographyPageHref = `${basePath}photography/`;
const resumeHref = `${basePath}Quang_Huynh_Resume.pdf`;

// About points at the homepage About & Education section; the dedicated
// /about page is reached from contextual links (Meet Quang, More about me).
const homeLinks = [
  { label: 'Experience', href: homeHref('#experience'), section: 'experience' },
  { label: 'Projects', href: homeHref('#projects'), section: 'projects' },
  { label: 'Skills', href: homeHref('#skills'), section: 'skills' },
  { label: 'About', href: homeHref('#about'), section: 'about' },
  { label: 'Contact', href: homeHref('#contact'), section: 'contact' },
];

// The Photography route keeps a deliberately quiet nav so the photos lead.
const photographyLinks = [
  { label: 'Portfolio', href: homeHref() },
  { label: 'About', href: homeHref('#about') },
];

const routeLinks = [
  { label: 'Portfolio', href: homeHref() },
  { label: 'Projects', href: homeHref('#projects') },
  { label: 'About', href: homeHref('#about') },
  { label: 'Contact', href: homeHref('#contact') },
];

// Scroll distance over which the expanded header settles into the compact bar
// (the original portfolio used 440px on desktop).
const collapseDistance = () => (window.innerWidth >= 1024 ? 440 : 180);

/** Tracks which homepage section is under the header for the nav marker. */
function useActiveSection(enabled) {
  const [active, setActive] = useState(null);
  useEffect(() => {
    if (!enabled || typeof IntersectionObserver !== 'function') return undefined;
    const sections = homeLinks
      .map(({ section }) => document.getElementById(section))
      .filter(Boolean);
    const visible = new Map();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => visible.set(entry.target.id, entry.isIntersecting));
      const current = sections.find((section) => visible.get(section.id));
      setActive(current?.id ?? null);
    }, { rootMargin: '-35% 0px -60% 0px' });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [enabled]);
  return active;
}

/**
 * Shared site navigation. On collapsible routes the header starts large at the
 * top of the page and eases into the compact sticky bar as the page scrolls,
 * driven by a single `--nav-progress` value (0 = expanded, 1 = compact).
 */
function SiteNav({ variant = 'default', current = 'home', collapsible = variant !== 'photography' }) {
  const navRef = useRef(null);
  const listRef = useRef(null);
  const menuButton = useRef(null);
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [marker, setMarker] = useState(null);
  const isPhotography = variant === 'photography';
  const isHome = current === 'home';
  const activeSection = useActiveSection(isHome);
  const links = isHome ? homeLinks : isPhotography ? photographyLinks : routeLinks;
  // Deep links (e.g. /#about) start compact, as the original header did.
  const initialProgress = typeof window !== 'undefined'
    && window.location.hash
    && window.location.hash !== '#top' ? 1 : 0;

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;
    let frame;
    let previous = -1;
    const update = () => {
      frame = undefined;
      const y = window.scrollY;
      setScrolled(y > 8);
      if (!collapsible) return;
      const progress = Math.min(1, Math.max(0, y / collapseDistance()));
      if (Math.abs(progress - previous) < 0.001) return;
      previous = progress;
      nav.style.setProperty('--nav-progress', progress.toFixed(3));
    };
    const request = () => { if (frame === undefined) frame = requestAnimationFrame(update); };
    const resize = () => { previous = -1; request(); };
    update();
    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', resize, { passive: true });
    return () => {
      window.removeEventListener('scroll', request);
      window.removeEventListener('resize', resize);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [collapsible]);

  // Slide one marker under the active link instead of toggling per-link underlines.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    const place = () => {
      const target = list.querySelector('[aria-current="page"], [data-active="true"]');
      if (!target) { setMarker(null); return; }
      setMarker({ left: target.offsetLeft, width: target.offsetWidth });
    };
    place();
    if (typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(place);
    observer.observe(list);
    return () => observer.disconnect();
  }, [activeSection, current]);

  const closeMenu = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const navigation = (
    <nav
      ref={navRef}
      className={`site-nav${collapsible ? ' site-nav--collapsible' : ''}${isPhotography ? ' photography-nav' : ''}`}
      style={collapsible ? { '--nav-progress': initialProgress } : undefined}
      data-scrolled={scrolled || undefined}
      data-open={open || undefined}
      aria-label="Primary navigation"
    >
      <div className="nav-inner">
        <a className="brand brand-lockup" href={isPhotography ? photographyPageHref : homeHref('#top')} aria-label={isPhotography ? 'quanghuynh.com photography — back to photography gallery' : 'quanghuynh.com — back to homepage'}>
          <span className="brand-cat" aria-hidden="true">
            <img src={chiTheCat} width="400" height="400" alt="" decoding="async" />
          </span>
          <span className="brand-name">
            <span className="brand-domain">quanghuynh</span>
            <span className="brand-tld">.com</span>
            {isPhotography && <span className="photography-brand-section">/photography</span>}
          </span>
          {isPhotography && <FaCamera className="photography-brand-camera" aria-hidden="true" focusable="false" />}
        </a>

        <button
          ref={menuButton}
          className="nav-menu-button"
          type="button"
          aria-expanded={open}
          aria-controls="site-nav-panel"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="nav-menu-button__lines" aria-hidden="true"><span /><span /></span>
          <span className="nav-menu-button__label">{open ? 'Close' : 'Menu'}</span>
        </button>

        <div className="nav-panel" id="site-nav-panel">
          <div className="nav-links" ref={listRef}>
            {links.map((link) => (
              <a
                key={link.label}
                href={link.href}
                data-active={link.section && link.section === activeSection ? 'true' : undefined}
                onClick={closeMenu}
              >
                {link.label}
              </a>
            ))}
            {marker && <span className="nav-marker" aria-hidden="true" style={{ transform: `translateX(${marker.left}px)`, width: `${marker.width}px` }} />}
          </div>
          <div className="nav-tools">
            <a className="nav-resume" href={resumeHref} target="_blank" rel="noreferrer">
              <FaFilePdf aria-hidden="true" /> Résumé{' '}<span className="visually-hidden">(PDF, opens in a new tab)</span>
            </a>
            <ThemeToggle />
          </div>
        </div>
      </div>
    </nav>
  );

  // The slot reserves the expanded height so the page never reflows while the
  // bar inside it shrinks (same approach as the original homepage header).
  return collapsible ? <div className="nav-slot">{navigation}</div> : navigation;
}

export { aboutHref, homeHref, photographyPageHref };
export default SiteNav;
