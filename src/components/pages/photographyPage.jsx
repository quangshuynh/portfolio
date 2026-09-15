import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaChevronLeft, FaChevronRight, FaTimes } from 'react-icons/fa';
import { photographs, sortPhotographs } from '../../data/photographs';
import { navigate, photographyHref } from '../../util/navigation';
import useOverlayLock from '../utilities/overlayLock';
import SiteNav, { aboutHref } from '../sections/siteNav';
import Footer from '../sections/footer';

function PhotographyViewerShell({ photograph }) {
  const dialog = useRef(null);
  const closeButton = useRef(null);
  const index = photographs.indexOf(photograph);
  const previous = index > 0 ? photographs[index - 1] : null;
  const next = index < photographs.length - 1 ? photographs[index + 1] : null;
  useOverlayLock();

  const goTo = (photo) => {
    if (photo) navigate(photographyHref(photo.slug));
  };

  useEffect(() => {
    closeButton.current?.focus();
    return () => requestAnimationFrame(() => {
      document.querySelector(`[data-photo-slug="${photograph.slug}"] a`)?.focus();
    });
  }, [photograph.slug]);
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        navigate(photographyHref());
      } else if (event.key === 'ArrowLeft' && previous) {
        event.preventDefault();
        goTo(previous);
      } else if (event.key === 'ArrowRight' && next) {
        event.preventDefault();
        goTo(next);
      } else if (event.key === 'Tab') {
        const controls = [...(dialog.current?.querySelectorAll('button:not([disabled])') ?? [])];
        if (!controls.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [previous, next]);

  return createPortal(
    <div ref={dialog} className="photography-viewer-shell" role="dialog" aria-modal="true" aria-label={`Photograph: ${photograph.caption}`}>
      <div className="photography-viewer-toolbar">
        <span>{index + 1} / {photographs.length}</span>
        <button ref={closeButton} type="button" onClick={() => navigate(photographyHref())} aria-label="Close photograph"><FaTimes aria-hidden="true" /></button>
      </div>
      <div className="photography-viewer-stage">
        <button type="button" onClick={() => goTo(previous)} disabled={!previous} aria-label="Previous photograph"><FaChevronLeft aria-hidden="true" /></button>
        <figure>
          <img src={photograph.src} width={photograph.width} height={photograph.height} alt={photograph.alt} decoding="async" />
          <figcaption>{photograph.caption}</figcaption>
        </figure>
        <button type="button" onClick={() => goTo(next)} disabled={!next} aria-label="Next photograph"><FaChevronRight aria-hidden="true" /></button>
      </div>
    </div>,
    document.body
  );
}

export default function PhotographyPage({ selectedPhotograph, invalidSlug = false }) {
  const [sort, setSort] = useState('default');
  const sortedPhotographs = useMemo(() => sortPhotographs(photographs, sort), [sort]);

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
      <a className="skip-link" href="#photography-gallery">Skip to photographs</a>
      <SiteNav />
      <main id="main-content">
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

            {invalidSlug && <p className="photography-route-notice" role="status">That photograph could not be found. The full collection is shown below.</p>}

            <div className="photography-page-grid" id="photography-gallery" aria-label="Photography collection">
              {sortedPhotographs.map((photograph) => (
                <figure key={photograph.id} data-photo-slug={photograph.slug}>
                  <a href={photographyHref(photograph.slug)} onClick={(event) => { event.preventDefault(); navigate(event.currentTarget.href); }} aria-label={`Open photograph: ${photograph.caption}`}>
                    <img src={photograph.src} width={photograph.width} height={photograph.height} alt={photograph.alt} loading="lazy" decoding="async" />
                  </a>
                  <figcaption>{photograph.caption}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
      {selectedPhotograph && <PhotographyViewerShell photograph={selectedPhotograph} />}
    </div>
  );
}
