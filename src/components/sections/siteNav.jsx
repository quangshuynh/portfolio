import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FaCamera, FaFilePdf } from 'react-icons/fa';
import chiTheCat from '../../assets/chi-the-cat.png';
import ThemeToggle from '../ui/themeToggle';

const basePath = import.meta.env.BASE_URL;
const homeHref = (hash = '') => `${basePath}${hash}`;
const aboutHref = `${basePath}about`;
const photographyPageHref = `${basePath}photography/`;
const resumeHref = `${basePath}Quang_Huynh_Resume.pdf`;

const homeLinks = [
  { label: 'Experience', href: homeHref('#experience'), section: 'experience' },
  { label: 'Projects', href: homeHref('#projects'), section: 'projects' },
  { label: 'Skills', href: homeHref('#skills'), section: 'skills' },
  { label: 'About', href: aboutHref },
  { label: 'Photography', href: photographyPageHref },
  { label: 'Contact', href: homeHref('#contact'), section: 'contact' },
];

// The Photography route keeps a deliberately quiet nav so the photos lead.
const photographyLinks = [
  { label: 'Portfolio', href: homeHref() },
  { label: 'About', href: aboutHref },
];

const routeLinks = (current) => [
  { label: 'Portfolio', href: homeHref() },
  { label: 'Projects', href: homeHref('#projects') },
  { label: 'About', href: aboutHref, current: current === 'about' },
  { label: 'Photography', href: photographyPageHref, current: current === 'photography' },
  { label: 'Contact', href: homeHref('#contact') },
];

/** Tracks which homepage section is under the header for the nav marker. */
function useActiveSection(enabled) {
  const [active, setActive] = useState(null);
  useEffect(() => {
    if (!enabled || typeof IntersectionObserver !== 'function') return undefined;
    const sections = homeLinks
      .filter(({ section }) => section)
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

/** Shared site navigation; `current` marks the route, `variant` scopes Photography. */
function SiteNav({ variant = 'default', current = 'home' }) {
  const navRef = useRef(null);
  const listRef = useRef(null);
  const menuButton = useRef(null);
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [marker, setMarker] = useState(null);
  const isPhotography = variant === 'photography';
  const isHome = current === 'home';
  const activeSection = useActiveSection(isHome);
  const links = isHome ? homeLinks : isPhotography ? photographyLinks : routeLinks(current);

  useEffect(() => {
    let frame;
    const update = () => {
      frame = undefined;
      setScrolled(window.scrollY > 16);
    };
    const onScroll = () => { if (frame === undefined) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, []);

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

  return (
    <nav
      ref={navRef}
      className={`site-nav${isPhotography ? ' photography-nav' : ''}`}
      data-scrolled={scrolled || undefined}
      data-open={open || undefined}
      aria-label="Primary navigation"
    >
      <div className="nav-inner">
        <a className="brand brand-lockup" href={isPhotography ? photographyPageHref : homeHref('#top')} aria-label={isPhotography ? 'quanghuynh.com photography — back to photography gallery' : 'quanghuynh.com — back to homepage'}>
          <span className="brand-cat" aria-hidden="true">
            <img src={chiTheCat} width="1024" height="1024" alt="" decoding="async" />
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
            {links.map((link, index) => (
              <a
                key={link.label}
                href={link.href}
                aria-current={link.current ? 'page' : undefined}
                data-active={link.section && link.section === activeSection ? 'true' : undefined}
                data-index={String(index + 1).padStart(2, '0')}
                onClick={closeMenu}
              >
                {link.label}
              </a>
            ))}
            {marker && <span className="nav-marker" aria-hidden="true" style={{ transform: `translateX(${marker.left}px)`, width: `${marker.width}px` }} />}
          </div>
          <div className="nav-tools">
            <a className="nav-resume" href={resumeHref} target="_blank" rel="noreferrer">
              <FaFilePdf aria-hidden="true" /> Résumé
            </a>
            <ThemeToggle />
          </div>
        </div>
      </div>
    </nav>
  );
}

export { aboutHref, homeHref, photographyPageHref };
export default SiteNav;
