import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaArrowLeft } from 'react-icons/fa';
import { photographs, sortPhotographs } from '../../data/photographs';
import { appHref, navigate, photographyHref } from '../../util/navigation';
import PhotographyLightbox from '../photography/photographyLightbox';
import SiteNav from '../sections/siteNav';
import Footer from '../sections/footer';

export function getPhotographyColumnCount(contentWidth = window.innerWidth) {
  return contentWidth > 820 ? 3 : 2;
}

const CAPTION_LINE_HEIGHT = 20;
const CAPTION_BASE_HEIGHT = 30;

export function distributePhotographs(orderedPhotographs, columnCount) {
  const columns = Array.from({ length: columnCount }, () => ({ photographs: [], estimatedHeight: 0 }));

  orderedPhotographs.forEach((photograph) => {
    const shortestColumn = columns.reduce((shortest, column) => (
      column.estimatedHeight < shortest.estimatedHeight ? column : shortest
    ));
    const aspectRatio = photograph.galleryWidth && photograph.galleryHeight
      ? photograph.galleryHeight / photograph.galleryWidth
      : 1;
    const estimatedCaptionLines = Math.max(1, Math.ceil((photograph.caption?.length ?? 0) / 32));
    shortestColumn.photographs.push(photograph);
    shortestColumn.estimatedHeight += aspectRatio * 1000 + CAPTION_BASE_HEIGHT + estimatedCaptionLines * CAPTION_LINE_HEIGHT;
  });

  return columns.map(({ photographs: columnPhotographs }) => columnPhotographs);
}

export default function PhotographyPage({ selectedPhotograph, invalidPhotoId = false }) {
  const [sort, setSort] = useState('default');
  const [columnCount, setColumnCount] = useState(() => getPhotographyColumnCount());
  const galleryRef = useRef(null);
  const viewerTrigger = useRef(null);
  const sortedPhotographs = useMemo(() => sortPhotographs(photographs, sort), [sort]);
  const photographColumns = useMemo(
    () => distributePhotographs(sortedPhotographs, columnCount),
    [columnCount, sortedPhotographs]
  );
  const navigateToPhotograph = useCallback((photograph) => navigate(photographyHref(photograph.slug)), []);
  const closePhotograph = useCallback(() => navigate(photographyHref()), []);

  useEffect(() => {
    // This component mounts on route entry, but remains mounted for sort and photo-hash state.
    if (window.scrollY) window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const updateColumns = () => setColumnCount(getPhotographyColumnCount(galleryRef.current?.clientWidth || window.innerWidth));
    updateColumns();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateColumns);
      return () => window.removeEventListener('resize', updateColumns);
    }
    const observer = new ResizeObserver(updateColumns);
    if (galleryRef.current) observer.observe(galleryRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!selectedPhotograph) return;
    document.querySelector('.photography-page')?.setAttribute('inert', '');
    return () => document.querySelector('.photography-page')?.removeAttribute('inert');
  }, [selectedPhotograph]);

  const backToAbout = useCallback((event) => {
    event.preventDefault();
    const nextState = { ...(window.history.state ?? {}), restorePhotographyModal: true, returnSection: 'beyond-software' };
    window.history.pushState(nextState, '', appHref('/about'));
    window.dispatchEvent(new Event('portfolio:locationchange'));
  }, []);

  return (
    <div className="app-shell photography-page">
      <a className="skip-link" href={photographyHref()} onClick={(event) => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>Skip to photographs</a>
      <SiteNav variant="photography" />
      <main id="main-content" tabIndex="-1">
        <header className="photography-page-header">
          <div className="section-inner">
            <a className="photography-modal-back-link" href={appHref('/about')} onClick={backToAbout}>
              <FaArrowLeft aria-hidden="true" /> Back to photography modal
            </a>
            <p className="eyebrow">Away from the keyboard</p>
            <h1>Photography</h1>
            <p>A personal collection of places, light, and everyday moments I wanted to remember.</p>
          </div>
        </header>

        <section className="photography-page-gallery-section" aria-labelledby="photography-collection-title">
          <div className="section-inner">
            <div className="photography-gallery-heading">
              <h2 id="photography-collection-title">Featured</h2>
              <label>Order
                <select value={sort} onChange={(event) => setSort(event.target.value)}>
                  <option value="default">Default</option>
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                </select>
              </label>
            </div>

            {invalidPhotoId && <p className="photography-route-notice" role="status">That photograph could not be found. The full collection is shown below.</p>}

            {/* Explicit columns trade row-major keyboard order for compact, deterministic packing. */}
            <div ref={galleryRef} className="photography-page-grid" id="photography-gallery" aria-label="Photography collection" style={{ '--photography-columns': columnCount }}>
              {photographColumns.map((column, columnIndex) => (
                <div className="photography-masonry-column" key={columnIndex}>
                  {column.map((photograph) => (
                    <figure key={photograph.id} data-photo-slug={photograph.slug}>
                      <a href={photographyHref(photograph.slug)} onClick={(event) => { event.preventDefault(); viewerTrigger.current = event.currentTarget; navigate(event.currentTarget.href); }} aria-label={`Open photograph: ${photograph.caption}`}>
                        <img src={photograph.gallerySrc} width={photograph.galleryWidth} height={photograph.galleryHeight} alt={photograph.alt} loading="lazy" decoding="async" />
                      </a>
                      <figcaption>{photograph.caption}</figcaption>
                    </figure>
                  ))}
                </div>
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
