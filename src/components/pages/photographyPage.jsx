import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { photographs, sortPhotographs } from '../../data/photographs';
import { navigate, photographyHref } from '../../util/navigation';
import PhotographyLightbox from '../photography/photographyLightbox';
import SiteNav, { aboutHref } from '../sections/siteNav';
import Footer from '../sections/footer';

export default function PhotographyPage({ selectedPhotograph, invalidPhotoId = false }) {
  const [sort, setSort] = useState('default');
  const viewerTrigger = useRef(null);
  const sortedPhotographs = useMemo(() => sortPhotographs(photographs, sort), [sort]);
  const navigateToPhotograph = useCallback((photograph) => navigate(photographyHref(photograph.slug)), []);
  const closePhotograph = useCallback(() => navigate(photographyHref()), []);

  useEffect(() => {
    if (window.scrollY) window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, []);

  useEffect(() => {
    if (!selectedPhotograph) return;
    document.querySelector('.photography-page')?.setAttribute('inert', '');
    return () => document.querySelector('.photography-page')?.removeAttribute('inert');
  }, [selectedPhotograph]);

  return (
    <div className="app-shell photography-page">
      <a className="skip-link" href={photographyHref()} onClick={(event) => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>Skip to photographs</a>
      <SiteNav />
      <main id="main-content" tabIndex="-1">
        <header className="photography-page-header">
          <div className="section-inner">
            <p className="eyebrow">Away from the keyboard</p>
            <h1>Photography</h1>
            <p>A personal collection of places, light, and everyday moments I wanted to remember.</p>
            <a className="photography-back-link" href={aboutHref}>More about me</a>
          </div>
        </header>

        <section className="photography-page-gallery-section" aria-labelledby="photography-collection-title">
          <div className="section-inner">
            <div className="photography-gallery-heading">
              <h2 id="photography-collection-title">Selected photographs</h2>
              <label>Order
                <select value={sort} onChange={(event) => setSort(event.target.value)}>
                  <option value="default">Default</option>
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                </select>
              </label>
            </div>

            {invalidPhotoId && <p className="photography-route-notice" role="status">That photograph could not be found. The full collection is shown below.</p>}

            <div className="photography-page-grid" id="photography-gallery" aria-label="Photography collection">
              {sortedPhotographs.map((photograph) => (
                <figure key={photograph.id} data-photo-slug={photograph.slug}>
                  <a href={photographyHref(photograph.slug)} onClick={(event) => { event.preventDefault(); viewerTrigger.current = event.currentTarget; navigate(event.currentTarget.href); }} aria-label={`Open photograph: ${photograph.caption}`}>
                    <img src={photograph.gallerySrc} width={photograph.galleryWidth} height={photograph.galleryHeight} alt={photograph.alt} loading="lazy" decoding="async" />
                  </a>
                  <figcaption>{photograph.caption}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
      {selectedPhotograph && <PhotographyLightbox photograph={selectedPhotograph} collection={sortedPhotographs} onNavigate={navigateToPhotograph} onClose={closePhotograph} returnFocusRef={viewerTrigger} />}
    </div>
  );
}
