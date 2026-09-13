import { lazy, Suspense, useEffect, useState } from 'react';
import './App.css';
import { FaMoon, FaSun } from 'react-icons/fa';
import Header from './components/header';
import Experience from './components/experience';
import FeaturedProjects from './components/featuredProjects';
import TechStack from './components/techstack';
import MoreProjects from './components/moreProjects';
import Education from './components/education';
import Footer from './components/footer';
import HashScroll from './components/hashScroll';
import { HomeLightboxProvider } from './components/homeLightbox';
import SiteNav from './components/siteNav';
import RevealAnimations from './components/revealAnimations';

const AboutPage = lazy(() => import('./components/aboutPage'));

/**
 * renders the portfolio application
 * :returns: portfolio application markup
 */
function App() {
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

  if (isAbout) {
    return <><Suspense fallback={null}><AboutPage /><RevealAnimations /></Suspense><ThemeToggle /></>;
  }

  return (
    <HomeLightboxProvider>
    <div className="app-shell">
      <HashScroll />
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <SiteNav collapsible />
      <Header />
      <main id="main-content">
        <Experience />
        <FeaturedProjects />
        <MoreProjects />
        <TechStack />
        <Education />
      </main>
      <Footer />
      <ThemeToggle />
      <RevealAnimations />
    </div>
    </HomeLightboxProvider>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState(() => localStorage.getItem('portfolio-theme') || 'dark');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('portfolio-theme', theme);
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#0e1512' : '#f6f4ee');
  }, [theme]);

  const toggleTheme = () => setTheme((current) => current === 'dark' ? 'light' : 'dark');

  return <button className="theme-toggle" type="button" onClick={toggleTheme} aria-pressed={theme === 'light'} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
    {theme === 'dark' ? <FaSun aria-hidden="true" /> : <FaMoon aria-hidden="true" />}<span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
  </button>;
}

export default App;
