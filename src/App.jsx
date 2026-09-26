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
    const canonicalPath = isPhotography ? '/photography/' : isAbout ? '/about' : '/';
    const canonicalUrl = `https://quanghuynh.com${canonicalPath}`;
    document.title = title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', description);
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', title);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', description);
    document.querySelector('meta[property="og:url"]')?.setAttribute('content', canonicalUrl);
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', canonicalUrl);
  }, [isAbout, isPhotography, selectedPhotograph]);

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
