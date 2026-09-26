import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaArrowLeft } from 'react-icons/fa';
import { photographs, sortPhotographs } from '../../data/photographs';
import { appHref, navigate, photographyHref } from '../../util/navigation';
import PhotographyLightbox from '../photography/photographyLightbox';
import SiteNav from '../sections/siteNav';
import coverSmall from '../../assets/photography/cover/IMGP0739-cover-640.webp';
import coverLarge from '../../assets/photography/cover/IMGP0739-cover-1100.webp';
import Footer from '../sections/footer';

// Two columns only once each column stays roughly 160px wide; narrower phones get
// a single column rather than thin portrait strips.
export const PHOTOGRAPHY_TWO_COLUMN_MIN_WIDTH = 340;

export function getPhotographyColumnCount(contentWidth = window.innerWidth) {
  if (contentWidth > 820) return 3;
  return contentWidth >= PHOTOGRAPHY_TWO_COLUMN_MIN_WIDTH ? 2 : 1;
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

export function formatExposure({ focalLength, aperture, shutterSpeed, iso }) {
  const parts = [];
  if (focalLength) parts.push(`${focalLength}mm`);
  if (aperture) parts.push(`f/${aperture}`);
  if (shutterSpeed) parts.push(shutterSpeed < 1 ? `1/${Math.round(1 / shutterSpeed)}` : `${shutterSpeed}s`);
  if (iso) parts.push(`ISO ${iso}`);
  return parts.join(' · ');
}

function PhotographFigure({ photograph, onOpen }) {
  const exposure = formatExposure(photograph);
  const frame = String(photograph.curatedOrder).padStart(2, '0');
  return (
    <figure data-photo-slug={photograph.slug} className={`photo-frame photo-frame--${photograph.shape ?? 'landscape'}`}>
      <a className="viewfinder" href={photographyHref(photograph.slug)} onClick={(event) => onOpen(event, photograph)} aria-label={`Open photograph: ${photograph.caption}`}>
        <img src={photograph.gallerySrc} width={photograph.galleryWidth} height={photograph.galleryHeight} alt={photograph.alt} loading="lazy" decoding="async" />
        {exposure && <span className="photo-frame__exposure mono" aria-hidden="true">{exposure}</span>}
      </a>
      <div className="photo-frame__meta">
        <span className="photo-frame__number mono" aria-hidden="true">No. {frame}</span>
        <figcaption>{photograph.caption}</figcaption>
      </div>
    </figure>
  );
}

const captureYears = photographs
  .map(({ capturedAt }) => (capturedAt ? new Date(capturedAt).getFullYear() : null))
  .filter((year) => Number.isFinite(year));
const firstYear = captureYears.length ? Math.min(...captureYears) : null;
const lastYear = captureYears.length ? Math.max(...captureYears) : null;
const yearRange = firstYear && (firstYear === lastYear ? String(firstYear) : `${firstYear}–${lastYear}`);
// Cover: a lightweight WebP derivative of an existing frame (Ithaca Falls).
const coverPhotograph = photographs.find(({ id }) => id === 'IMGP0739') ?? photographs[0];

export default function PhotographyPage({ selectedPhotograph, invalidPhotoId = false }) {
  const [sort, setSort] = useState('default');
  const [columnCount, setColumnCount] = useState(() => getPhotographyColumnCount());
  const galleryRef = useRef(null);
  const viewerTrigger = useRef(null);
  const sortedPhotographs = useMemo(() => sortPhotographs(photographs, sort), [sort]);
  const photographColumns = useMemo(
    () => sort === 'default' ? distributePhotographs(sortedPhotographs, columnCount) : [],
    [columnCount, sort, sortedPhotographs]
  );
  const navigateToPhotograph = useCallback((photograph) => navigate(photographyHref(photograph.slug)), []);
  const closePhotograph = useCallback(() => navigate(photographyHref()), []);
  const openPhotograph = useCallback((event) => {
    event.preventDefault();
    viewerTrigger.current = event.currentTarget;
    navigate(event.currentTarget.href);
  }, []);

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
      <SiteNav variant="photography" current="photography" />
      <main id="main-content" tabIndex="-1">
        <header className="photography-page-header">
          <div className="section-inner photography-header-grid">
            <div className="photography-header-copy">
              <a className="photography-modal-back-link" href={appHref('/about')} onClick={backToAbout}>
                <FaArrowLeft aria-hidden="true" /> Back to photography modal
              </a>
              <p className="eyebrow">Away from the keyboard</p>
              <h1>Photography</h1>
              <p className="photography-intro">A personal collection of places, light, and everyday moments I wanted to remember.</p>
              <dl className="photography-stats">
                <div><dt>Frames</dt><dd>{photographs.length}</dd></div>
                {yearRange && <div><dt>Captured</dt><dd>{yearRange}</dd></div>}
                <div><dt>Around</dt><dd>Rochester · Ithaca · Niagara</dd></div>
              </dl>
            </div>
            <a className="photography-cover viewfinder" href={photographyHref(coverPhotograph.slug)} onClick={openPhotograph} aria-label={`Cover — ${coverPhotograph.caption}. Open photograph`}>
              <img src={coverSmall} srcSet={`${coverSmall} 640w, ${coverLarge} 1100w`} sizes="(max-width: 860px) 92vw, 480px" width={coverPhotograph.viewerWidth} height={coverPhotograph.viewerHeight} alt={coverPhotograph.alt} fetchPriority="high" decoding="async" />
              <span className="photography-cover__caption mono">Cover — {coverPhotograph.caption}</span>
            </a>
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

            <div ref={galleryRef} className={`photography-page-grid photography-page-grid--${sort === 'default' ? 'masonry' : 'chronological'}`} id="photography-gallery" aria-label="Photography collection" style={{ '--photography-columns': columnCount }}>
              {sort === 'default'
                ? photographColumns.map((column, columnIndex) => (
                  // Explicit columns trade row-major keyboard order for compact curated packing.
                  <div className="photography-masonry-column" key={columnIndex}>
                    {column.map((photograph) => <PhotographFigure photograph={photograph} onOpen={openPhotograph} key={photograph.id} />)}
                  </div>
                ))
                : sortedPhotographs.map((photograph) => <PhotographFigure photograph={photograph} onOpen={openPhotograph} key={photograph.id} />)}
            </div>
          </div>
        </section>
      </main>
      <Footer />
      {selectedPhotograph && <PhotographyLightbox photograph={selectedPhotograph} collection={sortedPhotographs} onNavigate={navigateToPhotograph} onClose={closePhotograph} returnFocusRef={viewerTrigger} />}
    </div>
  );
}
