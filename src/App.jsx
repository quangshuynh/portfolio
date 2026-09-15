import { lazy, Suspense, useEffect, useState } from 'react';
import './App.css';
import { FaMoon, FaSun } from 'react-icons/fa';
import Header from './components/sections/header';
import Experience from './components/sections/experience';
import FeaturedProjects from './components/sections/featuredProjects';
import TechStack from './components/sections/techStack';
import MoreProjects from './components/sections/moreProjects';
import Education from './components/sections/education';
import Footer from './components/sections/footer';
import HashScroll from './components/utilities/hashScroll';
import { HomeLightboxProvider } from './components/utilities/homeLightbox';
import SiteNav from './components/sections/siteNav';
import RevealAnimations from './components/utilities/revealAnimations';
import useLocation from './components/utilities/useLocation';
import { findPhotograph } from './data/photographs';
import { getAppPathname } from './util/navigation';

const AboutPage = lazy(() => import('./components/pages/aboutPage'));
const PhotographyPage = lazy(() => import('./components/pages/photographyPage'));

/**
 * renders the portfolio application
 * :returns: portfolio application markup
 */
function App() {
  const location = useLocation();
  const path = getAppPathname(location.pathname);
  const isAbout = path === '/about';
  const photographyMatch = path?.match(/^\/photography(?:\/([^/]+))?$/);
  let photoSlug = null;
  try { photoSlug = photographyMatch?.[1] ? decodeURIComponent(photographyMatch[1]) : null; } catch { photoSlug = '__invalid__'; }
  const selectedPhotograph = photoSlug ? findPhotograph(photoSlug) : null;
  const isPhotography = Boolean(photographyMatch);

  useEffect(() => {
    const title = selectedPhotograph
      ? `${selectedPhotograph.caption} | Quang Huynh Photography`
      : isPhotography
        ? 'Photography | Quang Huynh'
        : isAbout ? 'Quang Huynh | About Quang' : 'Quang Huynh | Software Engineer';
    const description = isPhotography
      ? 'A curated collection of amateur photography by Quang Huynh.'
      : isAbout
        ? 'Learn more about Quang Huynh, a software developer and Computer Science student in Rochester, NY, including his background, interests, and approach to engineering.'
        : 'Software developer building production web applications, backend systems, developer tools, automation, and native applications.';
    const canonicalPath = selectedPhotograph ? `/photography/${selectedPhotograph.slug}` : isPhotography ? '/photography' : isAbout ? '/about' : '/';
    const canonicalUrl = `https://quanghuynh.com${canonicalPath}`;
    document.title = title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', description);
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', title);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', description);
    document.querySelector('meta[property="og:url"]')?.setAttribute('content', canonicalUrl);
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', canonicalUrl);
  }, [isAbout, isPhotography, selectedPhotograph]);

  if (isAbout) {
    return <><Suspense fallback={null}><AboutPage /><RevealAnimations /></Suspense><ThemeToggle /></>;
  }

  if (isPhotography) {
    return <><Suspense fallback={null}><PhotographyPage selectedPhotograph={selectedPhotograph} invalidSlug={Boolean(photoSlug && !selectedPhotograph)} /></Suspense><ThemeToggle /></>;
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
