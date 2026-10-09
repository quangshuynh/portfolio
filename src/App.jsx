import { lazy, Suspense, useEffect, useState } from 'react';
import './App.css';
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
import { routeForAppPath } from './seo/site.mjs';

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
  const isPhotography = path === '/photography';
  let photoId = null;
  try { photoId = isPhotography && location.hash ? decodeURIComponent(location.hash.slice(1)) : null; } catch { photoId = '__invalid__'; }
  const selectedPhotograph = photoId ? findPhotograph(photoId) : null;

  const route = routeForAppPath(path);

  // Keeps the head in step with in-app navigation. Each route's static HTML already
  // carries the same values for crawlers; unknown paths keep the 404 page's noindex head.
  useEffect(() => {
    if (!route) return;
    const title = selectedPhotograph ? `${selectedPhotograph.caption} | Quang Huynh Photography` : route.title;
    const setContent = (selector, value) => document.querySelector(selector)?.setAttribute('content', value);
    document.title = title;
    setContent('meta[name="description"]', route.description);
    setContent('meta[name="robots"]', 'index, follow, max-image-preview:large');
    setContent('meta[property="og:title"]', title);
    setContent('meta[property="og:description"]', route.description);
    setContent('meta[property="og:url"]', route.canonical);
    setContent('meta[name="twitter:title"]', title);
    setContent('meta[name="twitter:description"]', route.description);
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', route.canonical);
  }, [route, selectedPhotograph]);

  if (isAbout) {
    return <Suspense fallback={null}><AboutPage /><RevealAnimations /></Suspense>;
  }

  if (isPhotography) {
    return <Suspense fallback={null}><PhotographyPage selectedPhotograph={selectedPhotograph} invalidPhotoId={Boolean(photoId && !selectedPhotograph)} /><RevealAnimations /></Suspense>;
  }

  return (
    <HomeLightboxProvider>
    <div className="app-shell">
      <HashScroll />
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <SiteNav current="home" />
      <Header />
      <main id="main-content">
        <Experience />
        <FeaturedProjects />
        <MoreProjects />
        <TechStack />
        <Education />
      </main>
      <Footer />
      <RevealAnimations />
    </div>
    </HomeLightboxProvider>
  );
}

export default App;
