import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PHOTOGRAPHY_CATEGORIES,
  PHOTOGRAPHY_HERO_SLUG,
  featuredPhotographs,
  filterPhotographs,
  findPhotograph,
  photographs,
  sortPhotographs,
} from '../../data/photographs';
import { appHref, navigate, photographyHref } from '../../util/navigation';
import PhotographyLightbox, { formatCameraName } from '../photography/photographyLightbox';
import SiteNav from '../sections/siteNav';
import Footer from '../sections/footer';

export function formatExposure({ focalLength, aperture, shutterSpeed, iso }) {
  const parts = [];
  if (focalLength) parts.push(`${focalLength}mm`);
  if (aperture) parts.push(`f/${aperture}`);
  if (shutterSpeed) parts.push(shutterSpeed < 1 ? `1/${Math.round(1 / shutterSpeed)}` : `${shutterSpeed}s`);
  if (iso) parts.push(`ISO ${iso}`);
  return parts.join(' · ');
}

const padNumber = (value) => String(value).padStart(2, '0');
const aspectOf = (photograph) => (photograph.galleryWidth && photograph.galleryHeight ? photograph.galleryWidth / photograph.galleryHeight : 1.5);

function srcSet(photograph) {
  return `${photograph.gallerySrc} ${photograph.galleryWidth}w, ${photograph.viewerSrc} ${photograph.viewerWidth}w`;
}

// ---------- collections in the URL ----------
// `?collection=automotive` filters the archive; the hash stays the photo viewer's.
export const collectionParam = (category) => category.toLowerCase().replace(/[^a-z0-9]+/g, '-');
export function categoryFromSearch(search = '') {
  const value = new URLSearchParams(search).get('collection');
  return PHOTOGRAPHY_CATEGORIES.find((category) => collectionParam(category) === value) ?? 'All';
}
const searchFor = (category) => (category === 'All' ? '' : `?collection=${collectionParam(category)}`);

// ---------- featured rows ----------
// A full-width opener, then pairs and single frames in turn. Pairs share one height (each frame
// takes width in proportion to its aspect ratio), so landscape and portrait sit side by side
// uncropped and aligned. Slot sizes give clean Featured counts of 1, 3, 4, 6, 7 and 9.
const FEATURED_ROWS = [
  { layout: 'lead', size: 1, sizes: '(max-width: 760px) 100vw, min(1520px, 94vw)' },
  { layout: 'pair', size: 2, sizes: '(max-width: 760px) 100vw, 60vw' },
  { layout: 'single', size: 1, sizes: '(max-width: 760px) 100vw, min(1520px, 94vw)' },
  { layout: 'pair', size: 2, sizes: '(max-width: 760px) 100vw, 60vw' },
  { layout: 'single', size: 1, sizes: '(max-width: 760px) 100vw, min(1520px, 94vw)' },
  { layout: 'pair', size: 2, sizes: '(max-width: 760px) 100vw, 60vw' },
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

// ---------- archive: justified rows ----------
// Rows fill the width at one height per row, so every frame keeps its full proportions and
// edges line up. Each break is chosen so the row height lands closest to the target, and no
// frame is narrower than `minWidth`; the last row keeps the target height instead of stretching.
export function justifyRows(items, { width, target, gap, minWidth = 0 }) {
  const rows = [];
  let row = [];
  let aspectSum = 0;
  const heightOf = (sum, count) => (width - gap * (count - 1)) / sum;
  const fits = (candidate, sum) => candidate.every((item) => aspectOf(item) * heightOf(sum, candidate.length) >= minWidth);
  for (const item of items) {
    const nextSum = aspectSum + aspectOf(item);
    const next = [...row, item];
    if (row.length && (!fits(next, nextSum) || Math.abs(heightOf(nextSum, next.length) - target) > Math.abs(heightOf(aspectSum, row.length) - target))) {
      rows.push({ items: row, complete: true, height: heightOf(aspectSum, row.length) });
      row = [item];
      aspectSum = aspectOf(item);
    } else {
      row = next;
      aspectSum = nextSum;
    }
  }
  if (row.length) {
    // The last row is not stretched, but still tall enough for the narrowest frame's minimum width.
    const fill = heightOf(aspectSum, row.length);
    const needed = minWidth / Math.min(...row.map(aspectOf));
    rows.push({ items: row, complete: fill <= target, height: Math.min(fill, Math.max(target, needed)) });
  }
  return rows;
}

// Target row heights by archive width: generous on wide screens, two-up on phones, where no
// frame is narrower than 160 px (164 leaves room for sub-pixel rounding).
export function archiveLayout(width) {
  if (width >= 1200) return { width, target: 330, gap: 20, minWidth: 0 };
  if (width >= 760) return { width, target: 260, gap: 16, minWidth: 0 };
  return { width, target: 210, gap: 12, minWidth: 164 };
}

const initialArchiveWidth = () => Math.max(280, Math.min(1520, (typeof window === 'undefined' ? 1440 : window.innerWidth)) - 2 * 20);

// ---------- figures ----------
function FrameCaption({ number, photograph }) {
  return (
    <figcaption>
      {number && <span className="photo-number mono" aria-hidden="true">{number}</span>}
      <span className="photo-title">{photograph.caption}</span>
      <span className="photo-meta">{photograph.category}</span>
    </figcaption>
  );
}

function FeaturedFigure({ photograph, sizes, onOpen, href, priority }) {
  return (
    <figure data-featured-slug={photograph.slug} className={`featured-frame featured-frame--${photograph.shape ?? 'landscape'}`} style={{ '--aspect': aspectOf(photograph) }}>
      <a href={href} onClick={(event) => onOpen(event, 'featured')} aria-label={`View photograph: ${photograph.caption}`}>
        <img
          src={priority ? photograph.viewerSrc : photograph.gallerySrc}
          srcSet={srcSet(photograph)}
          sizes={sizes}
          width={photograph.viewerWidth}
          height={photograph.viewerHeight}
          alt={photograph.alt}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
        />
      </a>
      <FrameCaption number={padNumber(photograph.featured)} photograph={photograph} />
    </figure>
  );
}

function PhotographFigure({ photograph, onOpen, href }) {
  return (
    <figure data-photo-slug={photograph.slug} className={`photo-frame photo-frame--${photograph.shape ?? 'landscape'}`} style={{ '--aspect': aspectOf(photograph) }}>
      <a href={href} onClick={(event) => onOpen(event, 'collection')} aria-label={`Open photograph: ${photograph.caption}`}>
        <img
          src={photograph.gallerySrc}
          srcSet={srcSet(photograph)}
          sizes="(max-width: 760px) 50vw, 34vw"
          width={photograph.galleryWidth}
          height={photograph.galleryHeight}
          alt={photograph.alt}
          loading="lazy"
          decoding="async"
        />
      </a>
      <figcaption><span className="photo-title">{photograph.caption}</span></figcaption>
    </figure>
  );
}

const categoryCounts = Object.fromEntries(
  PHOTOGRAPHY_CATEGORIES.map((category) => [category, filterPhotographs(photographs, category).length]),
);
const filters = [['All', photographs.length], ...PHOTOGRAPHY_CATEGORIES.map((category) => [category, categoryCounts[category]])];

// Each collection is fronted by its first frame in curated order that isn't already in
// Featured, so the index shows more of the work rather than repeating the sequence above.
export const photographyCollections = PHOTOGRAPHY_CATEGORIES.map((category) => {
  const members = sortPhotographs(filterPhotographs(photographs, category));
  const cover = members.find(({ featured }) => !featured) ?? members[0];
  return { category, count: members.length, cover };
}).filter(({ count }) => count > 0);
// The opening frame is the catalog's `hero`. The hero <img> srcSet/sizes are mirrored by the
// build's preload (scripts/seo-plugin.mjs) so the browser reuses that response.
const heroPhotograph = findPhotograph(PHOTOGRAPHY_HERO_SLUG) ?? featuredPhotographs[0];
const cameraCount = new Set(photographs.map(({ camera }) => camera).filter(Boolean)).size;
export const HERO_SIZES = '100vw';

function SectionHeader({ eyebrow, id, title, headingRef, children }) {
  return (
    <div className="photography-section-header">
      <div>
        <p className="photography-eyebrow">{eyebrow}</p>
        <h2 id={id} ref={headingRef} tabIndex={headingRef ? '-1' : undefined}>{title}</h2>
      </div>
      {children && <div className="photography-section-header__aside">{children}</div>}
    </div>
  );
}

export default function PhotographyPage({ selectedPhotograph, invalidPhotoId = false, search = '' }) {
  const category = categoryFromSearch(search);
  const [sort, setSort] = useState('default');
  const [viewerContext, setViewerContext] = useState('collection');
  const [archiveWidth, setArchiveWidth] = useState(initialArchiveWidth);
  const galleryRef = useRef(null);
  const featuredRef = useRef(null);
  const collectionsRef = useRef(null);
  const collectionRef = useRef(null);
  const viewerTrigger = useRef(null);
  const collectionPhotographs = useMemo(
    () => sortPhotographs(filterPhotographs(photographs, category), sort),
    [category, sort],
  );
  const archiveRows = useMemo(() => justifyRows(collectionPhotographs, archiveLayout(archiveWidth)), [collectionPhotographs, archiveWidth]);
  const featuredRows = useMemo(() => groupFeaturedRows(featuredPhotographs), []);
  const { gap: rowGap } = archiveLayout(archiveWidth);

  // Photo links keep the active collection, so closing the viewer returns to the same view.
  const query = searchFor(category);
  const hrefFor = useCallback((photograph) => `${photographyHref()}${query}${photograph ? `#${encodeURIComponent(photograph.slug)}` : ''}`, [query]);

  // The viewer steps through whichever sequence the photograph was opened from; a direct
  // link (or a photo hidden by the current filter) falls back to the full collection.
  const viewerCollection = useMemo(() => {
    if (!selectedPhotograph) return collectionPhotographs;
    if (viewerContext === 'featured' && featuredPhotographs.some(({ id }) => id === selectedPhotograph.id)) return featuredPhotographs;
    if (collectionPhotographs.some(({ id }) => id === selectedPhotograph.id)) return collectionPhotographs;
    return sortPhotographs(photographs);
  }, [collectionPhotographs, selectedPhotograph, viewerContext]);

  const navigateToPhotograph = useCallback((photograph) => navigate(hrefFor(photograph)), [hrefFor]);
  const closePhotograph = useCallback(() => navigate(hrefFor(null)), [hrefFor]);
  const openPhotograph = useCallback((event, context) => {
    event.preventDefault();
    viewerTrigger.current = event.currentTarget;
    setViewerContext(context);
    navigate(event.currentTarget.href);
  }, []);

  useEffect(() => {
    // This component mounts on route entry, but remains mounted for sort, collection and photo-hash state.
    if (window.scrollY) window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const update = () => setArchiveWidth(Math.round(galleryRef.current?.clientWidth || initialArchiveWidth()));
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    if (galleryRef.current) observer.observe(galleryRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!selectedPhotograph) return;
    document.querySelector('.photography-page')?.setAttribute('inert', '');
    return () => document.querySelector('.photography-page')?.removeAttribute('inert');
  }, [selectedPhotograph]);

  // In-app navigation to the editor; modified clicks keep the browser's own behaviour.
  const openEditor = useCallback((event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(event.currentTarget.href);
  }, []);

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

  // A collection is a history entry (shareable, Back returns to the previous one), never a reload.
  const chooseCollection = useCallback((name) => {
    if (name !== category) navigate(`${photographyHref()}${searchFor(name)}`);
  }, [category]);
  const showCollection = useCallback((name) => {
    chooseCollection(name);
    jumpTo(collectionRef);
  }, [chooseCollection, jumpTo]);

  return (
    <div className="app-shell photography-page">
      <a className="skip-link" href={photographyHref()} onClick={(event) => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>Skip to photographs</a>
      <SiteNav variant="photography" current="photography" />
      <main id="main-content" tabIndex="-1">
        <header className="photography-hero" aria-labelledby="photography-title">
          {heroPhotograph && (
            <figure className="photography-hero__media" data-hero-slug={heroPhotograph.slug}>
              <a href={hrefFor(heroPhotograph)} onClick={(event) => openPhotograph(event, 'featured')} aria-label={`View photograph: ${heroPhotograph.caption}`}>
                <img
                  src={heroPhotograph.viewerSrc}
                  srcSet={srcSet(heroPhotograph)}
                  sizes={HERO_SIZES}
                  width={heroPhotograph.viewerWidth}
                  height={heroPhotograph.viewerHeight}
                  alt={heroPhotograph.alt}
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                />
              </a>
              <figcaption className="photography-hero__credit">
                {heroPhotograph.caption}{heroPhotograph.camera ? ` · ${formatCameraName(heroPhotograph.camera)}` : ''}
              </figcaption>
            </figure>
          )}
          <div className="photography-hero__content">
            <p className="photography-eyebrow">Portfolio of Quang Huynh</p>
            <h1 id="photography-title" className="photography-wordmark">
              <span>Huynh</span> <span>Photography</span>
            </h1>
            <p className="photography-hero__lede">Cars, places, landscapes and nature, photographed in and around Rochester, New York.</p>
            <div className="photography-hero__actions">
              <button type="button" className="photography-button photography-button--primary" onClick={() => jumpTo(featuredRef)}>View featured work</button>
              <button type="button" className="photography-button" onClick={() => jumpTo(collectionRef)}>All {photographs.length} photographs</button>
            </div>
            <p className="photography-hero__facts">
              <span>{photographs.length} photographs</span><span>{photographyCollections.length} collections</span><span>{cameraCount} cameras</span>
            </p>
          </div>
        </header>

        {invalidPhotoId && <p className="photography-route-notice section-inner" role="status">That photograph could not be found. The full collection is shown below.</p>}

        <section className="photography-featured" aria-labelledby="photography-featured-title">
          <div className="section-inner">
            <SectionHeader eyebrow="Selected work" id="photography-featured-title" title="Featured" headingRef={featuredRef}>
              <p>{featuredPhotographs.length} photographs, chosen and sequenced.</p>
            </SectionHeader>
            <div className="featured-sequence">
              {featuredRows.map((row, rowIndex) => (
                <div className={`featured-row featured-row--${row.layout}`} key={rowIndex}>
                  {row.photographs.map((photograph) => (
                    <FeaturedFigure photograph={photograph} sizes={row.sizes} onOpen={openPhotograph} href={hrefFor(photograph)} key={photograph.id} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="photography-collections" aria-labelledby="photography-collections-title">
          <div className="section-inner">
            <SectionHeader eyebrow="Browse by subject" id="photography-collections-title" title="Collections" headingRef={collectionsRef} />
            <ul className="photography-collections__list">
              {photographyCollections.map(({ category: name, count, cover }) => (
                <li key={name}>
                  <button type="button" className="collection-card" aria-current={category === name ? 'true' : undefined} onClick={() => showCollection(name)} aria-label={`${name}, ${count} photographs. Show in all photographs`}>
                    <span className="collection-card__media">
                      <img
                        src={cover.gallerySrc}
                        sizes="(max-width: 760px) 50vw, 25vw"
                        srcSet={srcSet(cover)}
                        width={cover.galleryWidth}
                        height={cover.galleryHeight}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    </span>
                    <span className="collection-card__label">
                      <span className="collection-card__name">{name}</span>
                      <span className="collection-card__count">{count} photographs</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="photography-collection" aria-labelledby="photography-collection-title">
          <div className="section-inner">
            <SectionHeader eyebrow="Archive" id="photography-collection-title" title="All photographs" headingRef={collectionRef}>
              <p aria-hidden="true">{category === 'All' ? `Every published photograph, ${photographs.length} in all.` : `${collectionPhotographs.length} of ${photographs.length}: ${category}.`}</p>
            </SectionHeader>
            <div className="photography-collection__controls">
              <div className="photography-filters" role="group" aria-label="Filter photographs by category">
                {filters.map(([name, count]) => (
                  <button type="button" key={name} aria-pressed={category === name} onClick={() => chooseCollection(name)}>
                    {name} <span className="photography-filters__count" aria-hidden="true">{count}</span>
                    <span className="visually-hidden">, {count} photographs</span>
                  </button>
                ))}
              </div>
              <label className="photography-order">Order
                <select value={sort} onChange={(event) => setSort(event.target.value)}>
                  <option value="default">Curated</option>
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                </select>
              </label>
            </div>
            <p className="visually-hidden" role="status">
              {category === 'All' ? `Showing all ${collectionPhotographs.length} photographs` : `Showing ${collectionPhotographs.length} ${category} photographs`}
            </p>

            <div ref={galleryRef} className="photography-page-grid" id="photography-gallery" aria-label="Photography collection" style={{ '--row-gap': `${rowGap}px` }}>
              {archiveRows.map((row) => (
                <div className={`photography-row${row.complete ? '' : ' photography-row--last'}`} style={{ '--row-target': `${Math.round(row.height)}px` }} key={row.items[0].id}>
                  {row.items.map((photograph) => <PhotographFigure photograph={photograph} onOpen={openPhotograph} href={hrefFor(photograph)} key={photograph.id} />)}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="photography-editor-note" aria-labelledby="photography-editor-title">
          <div className="section-inner photography-editor-note__inner">
            <div>
              <p className="photography-eyebrow">QuangEdit</p>
              <h2 id="photography-editor-title">Edit your own photographs, free</h2>
            </div>
            <p className="photography-editor-note__text">A free photo editor that runs entirely in your browser: RAW development, tone and colour, retouching and export. Your files never leave your device.</p>
            <div className="photography-editor-note__links">
              <a className="photography-button" href={appHref('/photography/editor')} onClick={openEditor}>Open QuangEdit</a>
              <a className="photography-text-link photography-modal-back-link" href={appHref('/about')} onClick={backToAbout}>Back to About</a>
            </div>
          </div>
        </section>
      </main>
      <Footer variant="photography" />
      {selectedPhotograph && <PhotographyLightbox photograph={selectedPhotograph} collection={viewerCollection} onNavigate={navigateToPhotograph} onClose={closePhotograph} returnFocusRef={viewerTrigger} />}
    </div>
  );
}
