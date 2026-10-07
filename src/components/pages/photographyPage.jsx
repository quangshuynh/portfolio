import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaArrowLeft } from 'react-icons/fa';
import {
  PHOTOGRAPHY_CATEGORIES,
  featuredPhotographs,
  filterPhotographs,
  photographs,
  sortPhotographs,
} from '../../data/photographs';
import { appHref, navigate, photographyHref } from '../../util/navigation';
import PhotographyLightbox from '../photography/photographyLightbox';
import SiteNav from '../sections/siteNav';
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

const padNumber = (value) => String(value).padStart(2, '0');

function srcSet(photograph) {
  return `${photograph.gallerySrc} ${photograph.galleryWidth}w, ${photograph.viewerSrc} ${photograph.viewerWidth}w`;
}

// Featured rows: a full-width opener, then alternating pairs and single wide frames so
// landscape and portrait work trade places down the page.
const FEATURED_ROWS = [
  { layout: 'lead', size: 1, sizes: '(max-width: 760px) 100vw, min(1360px, 94vw)' },
  { layout: 'pair-portrait-first', size: 2, sizes: '(max-width: 760px) 92vw, 50vw' },
  { layout: 'single-offset', size: 1, sizes: '(max-width: 760px) 100vw, 80vw' },
  { layout: 'pair-landscape-first', size: 2, sizes: '(max-width: 760px) 92vw, 55vw' },
  { layout: 'single-wide', size: 1, sizes: '(max-width: 760px) 100vw, min(1360px, 94vw)' },
  { layout: 'pair-portrait-first pair--low', size: 2, sizes: '(max-width: 760px) 92vw, 55vw' },
];

export function groupFeaturedRows(items) {
  const rows = [];
  let index = 0;
  for (let rowIndex = 0; index < items.length; rowIndex += 1) {
    const row = FEATURED_ROWS[rowIndex % FEATURED_ROWS.length];
    rows.push({ ...row, photographs: items.slice(index, index + row.size) });
    index += row.size;
  }
  return rows;
}

function FeaturedFigure({ photograph, sizes, onOpen, priority }) {
  return (
    <figure data-featured-slug={photograph.slug} className={`featured-frame featured-frame--${photograph.shape ?? 'landscape'}`}>
      <a href={photographyHref(photograph.slug)} onClick={(event) => onOpen(event, 'featured')} aria-label={`View photograph: ${photograph.caption}`}>
        <img
          src={priority ? photograph.viewerSrc : photograph.gallerySrc}
          srcSet={srcSet(photograph)}
          sizes={sizes}
          width={photograph.viewerWidth}
          height={photograph.viewerHeight}
          alt={photograph.alt}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          decoding="async"
        />
      </a>
      <figcaption>
        <span className="mono" aria-hidden="true">{padNumber(photograph.featured)}</span>
        {photograph.caption}
      </figcaption>
    </figure>
  );
}

function PhotographFigure({ photograph, onOpen }) {
  const exposure = formatExposure(photograph);
  return (
    <figure data-photo-slug={photograph.slug} className={`photo-frame photo-frame--${photograph.shape ?? 'landscape'}`}>
      <a href={photographyHref(photograph.slug)} onClick={(event) => onOpen(event, 'collection')} aria-label={`Open photograph: ${photograph.caption}`}>
        <img
          src={photograph.gallerySrc}
          srcSet={srcSet(photograph)}
          sizes="(max-width: 340px) 92vw, (max-width: 820px) 46vw, 30vw"
          width={photograph.galleryWidth}
          height={photograph.galleryHeight}
          alt={photograph.alt}
          loading="lazy"
          decoding="async"
        />
        {exposure && <span className="photo-frame__exposure mono" aria-hidden="true">{exposure}</span>}
      </a>
      <figcaption>
        <span className="mono" aria-hidden="true">{padNumber(photograph.curatedOrder)}</span>
        {photograph.caption}
      </figcaption>
    </figure>
  );
}

const categoryCounts = Object.fromEntries(
  PHOTOGRAPHY_CATEGORIES.map((category) => [category, filterPhotographs(photographs, category).length]),
);
const filters = [['All', photographs.length], ...PHOTOGRAPHY_CATEGORIES.map((category) => [category, categoryCounts[category]])];

export default function PhotographyPage({ selectedPhotograph, invalidPhotoId = false }) {
  const [sort, setSort] = useState('default');
  const [category, setCategory] = useState('All');
  const [viewerContext, setViewerContext] = useState('collection');
  const [columnCount, setColumnCount] = useState(() => getPhotographyColumnCount());
  const galleryRef = useRef(null);
  const collectionRef = useRef(null);
  const viewerTrigger = useRef(null);
  const collectionPhotographs = useMemo(
    () => sortPhotographs(filterPhotographs(photographs, category), sort),
    [category, sort],
  );
  const photographColumns = useMemo(
    () => sort === 'default' ? distributePhotographs(collectionPhotographs, columnCount) : [],
    [collectionPhotographs, columnCount, sort],
  );
  const featuredRows = useMemo(() => groupFeaturedRows(featuredPhotographs), []);

  // The viewer steps through whichever sequence the photograph was opened from; a direct
  // link (or a photo hidden by the current filter) falls back to the full collection.
  const viewerCollection = useMemo(() => {
    if (!selectedPhotograph) return collectionPhotographs;
    if (viewerContext === 'featured' && featuredPhotographs.some(({ id }) => id === selectedPhotograph.id)) return featuredPhotographs;
    if (collectionPhotographs.some(({ id }) => id === selectedPhotograph.id)) return collectionPhotographs;
    return sortPhotographs(photographs);
  }, [collectionPhotographs, selectedPhotograph, viewerContext]);

  const navigateToPhotograph = useCallback((photograph) => navigate(photographyHref(photograph.slug)), []);
  const closePhotograph = useCallback(() => navigate(photographyHref()), []);
  const openPhotograph = useCallback((event, context) => {
    event.preventDefault();
    viewerTrigger.current = event.currentTarget;
    setViewerContext(context);
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

  // The URL hash belongs to the photo viewer, so in-page jumps scroll instead of linking.
  const jumpTo = useCallback((ref) => {
    const target = ref.current;
    if (!target) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    target.focus({ preventScroll: true });
  }, []);

  return (
    <div className="app-shell photography-page">
      <a className="skip-link" href={photographyHref()} onClick={(event) => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>Skip to photographs</a>
      <SiteNav variant="photography" current="photography" />
      <main id="main-content" tabIndex="-1">
        <header className="photography-intro section-inner">
          <a className="photography-modal-back-link" href={appHref('/about')} onClick={backToAbout}>
            <FaArrowLeft aria-hidden="true" /> Back to photography modal
          </a>
          <div className="photography-intro__grid">
            <h1>Photography</h1>
            <div className="photography-intro__aside">
              <p>Cars, places, and whatever catches my eye.</p>
              <button type="button" className="photography-jump" onClick={() => jumpTo(collectionRef)}>
                All {photographs.length} photographs <span aria-hidden="true">↓</span>
              </button>
            </div>
          </div>
        </header>

        {invalidPhotoId && <p className="photography-route-notice section-inner" role="status">That photograph could not be found. The full collection is shown below.</p>}

        <section className="photography-featured" aria-labelledby="photography-featured-title">
          <div className="section-inner">
            <div className="photography-section-label">
              <h2 id="photography-featured-title">Featured</h2>
              <span className="mono">{padNumber(featuredPhotographs.length)} selected</span>
            </div>
            <div className="featured-sequence">
              {featuredRows.map((row, rowIndex) => (
                <div className={`featured-row ${row.layout.split(' ').map((name) => `featured-row--${name}`).join(' ')}`} key={rowIndex}>
                  {row.photographs.map((photograph) => (
                    <FeaturedFigure photograph={photograph} sizes={row.sizes} onOpen={openPhotograph} priority={rowIndex === 0} key={photograph.id} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="photography-collection" aria-labelledby="photography-collection-title">
          <div className="section-inner">
            <div className="photography-section-label photography-collection__header">
              <h2 id="photography-collection-title" ref={collectionRef} tabIndex="-1">All photographs</h2>
              <div className="photography-collection__controls">
                <div className="photography-filters" role="group" aria-label="Filter photographs by category">
                  {filters.map(([name, count]) => (
                    <button type="button" key={name} aria-pressed={category === name} onClick={() => setCategory(name)}>
                      {name} <span className="mono" aria-hidden="true">{count}</span>
                      <span className="visually-hidden">, {count} photographs</span>
                    </button>
                  ))}
                </div>
                <label>Order
                  <select value={sort} onChange={(event) => setSort(event.target.value)}>
                    <option value="default">Curated</option>
                    <option value="newest">Newest</option>
                    <option value="oldest">Oldest</option>
                  </select>
                </label>
              </div>
            </div>
            <p className="visually-hidden" role="status">
              {category === 'All' ? `Showing all ${collectionPhotographs.length} photographs` : `Showing ${collectionPhotographs.length} ${category} photographs`}
            </p>

            <div ref={galleryRef} className={`photography-page-grid photography-page-grid--${sort === 'default' ? 'masonry' : 'chronological'}`} id="photography-gallery" aria-label="Photography collection" style={{ '--photography-columns': columnCount }}>
              {sort === 'default'
                ? photographColumns.map((column, columnIndex) => (
                  // Explicit columns trade row-major keyboard order for compact curated packing.
                  <div className="photography-masonry-column" key={columnIndex}>
                    {column.map((photograph) => <PhotographFigure photograph={photograph} onOpen={openPhotograph} key={photograph.id} />)}
                  </div>
                ))
                : collectionPhotographs.map((photograph) => <PhotographFigure photograph={photograph} onOpen={openPhotograph} key={photograph.id} />)}
            </div>
          </div>
        </section>
      </main>
      <Footer />
      {selectedPhotograph && <PhotographyLightbox photograph={selectedPhotograph} collection={viewerCollection} onNavigate={navigateToPhotograph} onClose={closePhotograph} returnFocusRef={viewerTrigger} />}
    </div>
  );
}
