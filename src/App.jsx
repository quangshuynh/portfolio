import { lazy, Suspense, useEffect, useState } from 'react';
import './App.css';
import RevealAnimations from './components/utilities/revealAnimations';
import RouteErrorBoundary from './components/utilities/routeErrorBoundary';
import useLocation from './components/utilities/useLocation';
import { findPhotograph } from './data/photographs';
import { getAppPathname } from './util/navigation';
import { routeForAppPath } from './seo/site.mjs';

const HomePage = lazy(() => import('./components/pages/homePage'));
const AboutPage = lazy(() => import('./components/pages/aboutPage'));
const PhotographyPage = lazy(() => import('./components/pages/photographyPage'));
// Stages feed the editor's HTML-shell startup report (public/photography/editor-startup.js).
const editorStage = (name) => window.__editorStartup?.stage(name);
const PhotoEditorPage = lazy(() => {
  editorStage('editor chunk requested');
  return import('./components/pages/photoEditorPage').then(
    (module) => { editorStage('editor chunk loaded'); return module; },
    (error) => { editorStage(`editor chunk failed: ${error?.message}`); throw error; },
  );
});

/**
 * renders the portfolio application
 * :returns: portfolio application markup
 */
function App() {
  const location = useLocation();
  const path = getAppPathname(location.pathname);
  const isAbout = path === '/about';
  const isPhotography = path === '/photography';
  const isPhotoEditor = path === '/photography/editor';
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
    setContent('meta[name="robots"]', route.indexable ? 'index, follow, max-image-preview:large' : 'noindex, follow');
    setContent('meta[property="og:title"]', title);
    setContent('meta[property="og:description"]', route.description);
    setContent('meta[property="og:url"]', route.canonical);
    setContent('meta[name="twitter:title"]', title);
    setContent('meta[name="twitter:description"]', route.description);
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', route.canonical);
  }, [route, selectedPhotograph]);

  if (isAbout) {
    return <RouteErrorBoundary name="About"><Suspense fallback={null}><AboutPage /><RevealAnimations /></Suspense></RouteErrorBoundary>;
  }

  if (isPhotoEditor) {
    return <RouteErrorBoundary name="The photo editor" homePath="/photography/" homeLabel="Back to photography"><Suspense fallback={null}><PhotoEditorPage /></Suspense></RouteErrorBoundary>;
  }

  if (isPhotography) {
    return <RouteErrorBoundary name="Photography"><Suspense fallback={null}><PhotographyPage selectedPhotograph={selectedPhotograph} invalidPhotoId={Boolean(photoId && !selectedPhotograph)} search={location.search} /><RevealAnimations /></Suspense></RouteErrorBoundary>;
  }

  return <RouteErrorBoundary name="The homepage"><Suspense fallback={null}><HomePage /></Suspense></RouteErrorBoundary>;
}

export default App;
