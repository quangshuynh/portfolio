import { useEffect, useState } from 'react';
import './App.css';
import { FaMoon, FaSun } from 'react-icons/fa';
import Header from './components/header';
import Experience from './components/experience';
import FeaturedProjects from './components/featuredProjects';
import TechStack from './components/techstack';
import MoreProjects from './components/moreProjects';
import Education from './components/education';
import Footer from './components/footer';
import AboutPage from './components/aboutPage';
import HashScroll from './components/hashScroll';
import { HomeLightboxProvider } from './components/homeLightbox';

/**
 * renders the portfolio application
 * :returns: portfolio application markup
 */
function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('portfolio-theme') || 'dark');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('portfolio-theme', theme);
    const themeColor = document.querySelector('meta[name="theme-color"]');
    themeColor?.setAttribute('content', theme === 'dark' ? '#0e1512' : '#f6f4ee');
  }, [theme]);

  const basePath = process.env.PUBLIC_URL || '';
  const path = window.location.pathname.replace(/\/$/, '');
  const isAbout = path === `${basePath}/about` || path === '/about';

  useEffect(() => {
    const title = isAbout ? 'Quang Huynh | About Quang' : 'Quang Huynh | Software Engineer';
    const description = isAbout
      ? 'Learn more about Quang Huynh, a software developer and Computer Science student in Rochester, NY, including his background, interests, and approach to engineering.'
      : 'Software developer building production web applications, backend systems, developer tools, automation, and native applications.';
    const canonicalUrl = `https://quanghuynh.com${isAbout ? '/about' : '/'}`;
    document.title = title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', description);
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', title);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', description);
    document.querySelector('meta[property="og:url"]')?.setAttribute('content', canonicalUrl);
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', canonicalUrl);
  }, [isAbout]);

  useEffect(() => {
    const stops = Array.from(document.querySelectorAll('.scroll-enter'));
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    if (reducedMotion || !('IntersectionObserver' in window)) {
      stops.forEach((stop) => stop.classList.add('is-visible'));
      return undefined;
    }

    document.documentElement.classList.add('reveal-ready');
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

    stops.forEach((stop) => observer.observe(stop));
    return () => {
      observer.disconnect();
      document.documentElement.classList.remove('reveal-ready');
    };
  }, [isAbout]);

  useEffect(() => {
    let frame;
    let lastScrollY = window.scrollY;
    const updateSnapBoundary = () => {
      frame = undefined;
      const header = document.querySelector('.app-shell > header, .about-page > header');
      const footer = document.querySelector('.site-footer');
      const currentScrollY = window.scrollY;
      const movingUp = currentScrollY < lastScrollY;
      const nearTop = currentScrollY === 0
        || (movingUp && currentScrollY <= (header?.offsetHeight ?? 0) + 96);
      const footerLead = Math.min(180, window.innerHeight * .2);
      const nearFooter = Boolean(footer) && currentScrollY + window.innerHeight >= footer.offsetTop - footerLead;
      document.documentElement.classList.toggle('snap-boundary', nearTop || nearFooter);
      lastScrollY = currentScrollY;
    };
    const scheduleUpdate = () => {
      if (!frame) frame = requestAnimationFrame(updateSnapBoundary);
    };

    updateSnapBoundary();
    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      document.documentElement.classList.remove('snap-boundary');
    };
  }, [isAbout]);

  /**
   * toggles the active color theme
   * :returns: no return value
   */
  const toggleTheme = () => setTheme((current) => current === 'dark' ? 'light' : 'dark');

  if (isAbout) {
    return <><AboutPage /><ThemeToggle theme={theme} toggleTheme={toggleTheme} /></>;
  }

  return (
    <HomeLightboxProvider>
    <div className="app-shell">
      <HashScroll />
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <Header />
      <main id="main-content">
        <Experience />
        <FeaturedProjects />
        <MoreProjects />
        <TechStack />
        <Education />
      </main>
      <Footer />
      <ThemeToggle theme={theme} toggleTheme={toggleTheme} />
    </div>
    </HomeLightboxProvider>
  );
}

function ThemeToggle({ theme, toggleTheme }) {
  return <button className="theme-toggle" type="button" onClick={toggleTheme} aria-pressed={theme === 'light'} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
    {theme === 'dark' ? <FaSun aria-hidden="true" /> : <FaMoon aria-hidden="true" />}<span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
  </button>;
}

export default App;
