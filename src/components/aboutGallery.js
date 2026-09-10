import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaMinus, FaPlus, FaSearchPlus, FaTimes } from 'react-icons/fa';
import useOverlayLock from './overlayLock';

const SPOTIFY_ENDPOINT = 'https://spotify-portfolio-api.quangs.workers.dev/recent';
const SPOTIFY_PROFILE = 'https://open.spotify.com/user/foahrtqqvuuvt7wscxub4uerd';
const SPOTIFY_CACHE_TTL = 5 * 60 * 1000;
let spotifyTracksCache = null;
let spotifyTracksCachedAt = null;
let spotifyRequest = null;

function getFreshSpotifyTracksCache() {
  if (spotifyTracksCache === null || spotifyTracksCachedAt === null) return null;
  return Date.now() - spotifyTracksCachedAt < SPOTIFY_CACHE_TTL
    ? spotifyTracksCache
    : null;
}

function getSpotifyTracks() {
  const cachedTracks = getFreshSpotifyTracksCache();
  if (cachedTracks) return Promise.resolve(cachedTracks);
  if (!spotifyRequest) {
    spotifyRequest = fetch(SPOTIFY_ENDPOINT)
      .then((response) => {
        if (!response.ok) throw new Error('Spotify request failed');
        return response.json();
      })
      .then((data) => {
        spotifyTracksCache = data.tracks ?? [];
        spotifyTracksCachedAt = Date.now();
        return spotifyTracksCache;
      })
      .finally(() => { spotifyRequest = null; });
  }
  return spotifyRequest;
}

export function resetSpotifyCacheForTests() {
  spotifyTracksCache = null;
  spotifyTracksCachedAt = null;
  spotifyRequest = null;
}

const galleryMetadata = {
  photography: ['Behind the lens', 'Photography by Quang', 'Close photography gallery'],
  // Reserved for a future expanded hiking gallery.
  hiking: ['On the trail', 'Hiking', 'Close hiking gallery'],
  personal: ['Beyond the résumé', 'More about Quang', 'Close personal photo gallery'],
  gaming: ['In the game', 'Gaming', 'Close gaming gallery'],
  family: ['Close to home', 'Family & friends', 'Close family and friends gallery'],
  music: ['On repeat', 'What I’ve been listening to', 'Close music activity'],
  technology: ['Under the hood', 'Cars & technology', 'Close cars and technology gallery']
};

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');
const galleryLabels = {
  personal: 'More photos of Quang',
  gaming: 'More gaming screenshots',
  technology: 'More cars and technology photos',
  family: 'Family and friends photos'
};

function trapTabKey(event, container) {
  if (event.key !== 'Tab') return;
  const controls = container?.querySelectorAll(focusableSelector);
  if (!controls?.length) return;
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

export function ImageTrigger({ children, className, label, onOpen }) {
  return (
    <button className={className} type="button" aria-label={label} aria-haspopup="dialog" onClick={(event) => onOpen(event.currentTarget)}>
      {children}
      <span className="photography-gallery-zoom-hint" aria-hidden="true"><FaSearchPlus /></span>
    </button>
  );
}

export function InterestCard({ icon: Icon, title, copy, photos, gallery, galleryItems, hasNonPhotoContent = false, onOpen, onOpenImage }) {
  const visibleSources = new Set((photos ?? []).map(({ src }) => src));
  const hasAdditionalContent = hasNonPhotoContent || Boolean(
    gallery && galleryItems?.some(({ src }) => !visibleSources.has(src))
  );
  const featuredImage = photos?.[0];
  const media = photos && (
    <div className={`interest-card-media${photos.length > 1 ? ' interest-card-media-pair' : ''}${title === 'Photography' ? ' interest-card-media-photography' : ''}${title === 'Music' ? ' interest-card-media-music' : ''}${title === 'Hiking' ? ' interest-card-media-hiking' : ''}${title === 'Time with family & friends' ? ' interest-card-media-family' : ''}`}>
      {photos.map(({ src, width, height, alt }) => <img src={src} width={width} height={height} alt={alt} key={src} />)}
    </div>
  );

  return (
    <article className="interest-card">
      {featuredImage
        ? <ImageTrigger className="interest-card-media-button" label={`Open featured ${title} image`} onOpen={(trigger) => onOpenImage(featuredImage, trigger)}>{media}</ImageTrigger>
        : media}
      <h3><Icon aria-hidden="true" />{title}</h3>
      <p>{copy}</p>
      {hasAdditionalContent && (
        <button className="interest-view-more" type="button" aria-haspopup="dialog" onClick={(event) => onOpen(gallery, event.currentTarget)}>
          {gallery === 'music' ? 'View listening' : 'View more'}
        </button>
      )}
    </article>
  );
}

function PhotoGallery({ items, label, className = '', onOpen }) {
  return (
    <div className={`photography-gallery${className ? ` ${className}` : ''}`} id={label === 'More photographs by Quang' ? 'photography-gallery' : undefined} aria-label={label}>
      {items.map(({ src, width, height, alt, caption, shape }) => {
        const portrait = shape === 'portrait';
        return (
          <figure className={portrait ? 'photography-gallery-portrait' : undefined} key={src}>
            <ImageTrigger className="photography-gallery-image-button" onOpen={(trigger) => onOpen(src, alt, caption, trigger)} label={`Open image: ${caption}`}>
              <img src={src} width={width} height={height} alt={alt} loading="lazy" />
            </ImageTrigger>
            <figcaption>{caption}</figcaption>
          </figure>
        );
      })}
    </div>
  );
}

export function formatRelativePlayTime(playedAt, now = Date.now()) {
  const playedDate = new Date(playedAt);
  const nowDate = new Date(now);
  if (!playedAt || Number.isNaN(playedDate.getTime()) || Number.isNaN(nowDate.getTime())) return null;

  const elapsedSeconds = Math.max(0, Math.floor((nowDate.getTime() - playedDate.getTime()) / 1000));
  if (elapsedSeconds < 60) return 'Just now';
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  if (hours < 48) return 'Yesterday';
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} days ago`;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    ...(playedDate.getFullYear() !== nowDate.getFullYear() ? { year: 'numeric' } : {})
  }).format(playedDate);
}

function TrackPlayTime({ playedAt }) {
  const relativeTime = formatRelativePlayTime(playedAt);
  if (!relativeTime) return null;
  const playedDate = new Date(playedAt);
  const exactTime = playedDate.toLocaleString();
  return <time className="spotify-track-time" dateTime={playedDate.toISOString()} title={exactTime} aria-label={`Played ${exactTime}`}>{relativeTime}</time>;
}

function getPlayedAtTime(playedAt) {
  if (!playedAt) return null;
  const time = new Date(playedAt).getTime();
  return Number.isNaN(time) ? null : time;
}

export function SpotifyListening() {
  const cachedTracks = getFreshSpotifyTracksCache();
  const [tracks, setTracks] = useState(cachedTracks ?? []);
  const [status, setStatus] = useState(cachedTracks ? 'success' : 'loading');
  const [requestAttempt, setRequestAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    getSpotifyTracks()
      .then((recentTracks) => {
        if (!active) return;
        setTracks(recentTracks);
        setStatus('success');
      })
      .catch(() => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, [requestAttempt]);

  const retry = () => {
    spotifyTracksCache = null;
    spotifyTracksCachedAt = null;
    spotifyRequest = null;

    setStatus('loading');
    setRequestAttempt((attempt) => attempt + 1);
  };

  if (status === 'loading') return <div className="spotify-listening"><p>Loading recent listening...</p></div>;
  if (status === 'error') {
    return (
      <div className="spotify-listening">
        <div className="spotify-listening-status" role="status">
          <div className="spotify-listening-status-copy">
            <strong>Couldn’t load recent listening</strong>
            <p>Spotify activity is temporarily unavailable.</p>
          </div>

          <div className="spotify-listening-actions">
            <button
              className="spotify-retry-button"
              type="button"
              onClick={retry}
            >
              Retry
            </button>

            <a
              className="spotify-profile-link spotify-profile-link-error"
              href={SPOTIFY_PROFILE}
              target="_blank"
              rel="noreferrer"
              aria-label="View my Spotify"
            >
              View my Spotify ↗
            </a>
          </div>
        </div>
      </div>
    );
  }
  if (!tracks.length) return <div className="spotify-listening"><p>No recent listening activity to show.</p></div>;

  const sortedTracks = [...tracks].sort((first, second) => {
    const firstPlayedAt = getPlayedAtTime(first.playedAt);
    const secondPlayedAt = getPlayedAtTime(second.playedAt);
    const firstIsValid = firstPlayedAt !== null;
    const secondIsValid = secondPlayedAt !== null;
    if (firstIsValid && secondIsValid) return secondPlayedAt - firstPlayedAt;
    if (firstIsValid) return -1;
    if (secondIsValid) return 1;
    return 0;
  });

  return <div className="spotify-listening"><div className="spotify-track-list">{sortedTracks.map((track, index) => <a className={`spotify-track${index === 0 && getPlayedAtTime(track.playedAt) !== null ? ' spotify-track-latest' : ''}`} href={track.url} target="_blank" rel="noreferrer" key={`${track.id}-${track.playedAt}`}>{track.image && <img src={track.image} alt="" loading="lazy" />}<div><strong>{track.name}</strong><span>{track.artist}</span><small>{track.album}</small><TrackPlayTime playedAt={track.playedAt} /></div></a>)}</div><a className="interest-view-more spotify-profile-link" href={SPOTIFY_PROFILE} target="_blank" rel="noreferrer">View my Spotify</a></div>;
}

export function PhotoLightbox({ image, onClose }) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const dialogRef = useRef(null);
  const closeButton = useRef(null);
  const stage = useRef(null);
  const imageElement = useRef(null);
  const drag = useRef(null);
  const scaleRef = useRef(scale);
  const helpId = useId();
  useOverlayLock();

  scaleRef.current = scale;

  const clampPosition = useCallback((next, nextScale = scaleRef.current) => {
    const stageRect = stage.current?.getBoundingClientRect();
    const baseWidth = imageElement.current?.offsetWidth;
    const baseHeight = imageElement.current?.offsetHeight;
    if (!stageRect || !baseWidth || !baseHeight || nextScale <= 1) return { x: 0, y: 0 };
    const maxX = Math.max(0, (baseWidth * nextScale - stageRect.width) / 2);
    const maxY = Math.max(0, (baseHeight * nextScale - stageRect.height) / 2);
    return { x: Math.max(-maxX, Math.min(maxX, next.x)), y: Math.max(-maxY, Math.min(maxY, next.y)) };
  }, []);

  const zoom = useCallback((amount) => {
    setScale((current) => {
      const next = Math.min(5, Math.max(1, Number((current + amount).toFixed(2))));
      scaleRef.current = next;
      setPosition((currentPosition) => clampPosition(currentPosition, next));
      return next;
    });
  }, [clampPosition]);

  const reset = useCallback(() => { setScale(1); setPosition({ x: 0, y: 0 }); }, []);

  useEffect(() => { closeButton.current?.focus(); }, []);
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(.25); }
      else if (event.key === '-' || event.key === '_') { event.preventDefault(); zoom(-.25); }
      else if (event.key === '0') { event.preventDefault(); reset(); }
      else trapTabKey(event, dialogRef.current);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, reset, zoom]);

  useEffect(() => {
    const handleResize = () => setPosition((current) => clampPosition(current));
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [clampPosition]);

  const endDrag = (event) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return createPortal(
    <div ref={dialogRef} className="photo-lightbox-backdrop" role="dialog" aria-modal="true" aria-label={image.caption ? `Image viewer: ${image.caption}` : 'Image viewer'} aria-describedby={helpId} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="photo-lightbox-toolbar"><div className="photo-lightbox-zoom-controls" aria-label="Image zoom controls"><button type="button" onClick={() => zoom(-.25)} disabled={scale <= 1} aria-label="Zoom out"><FaMinus aria-hidden="true" /></button><button className="photo-lightbox-scale" type="button" onClick={reset} aria-label="Reset zoom">{Math.round(scale * 100)}%</button><button type="button" onClick={() => zoom(.25)} disabled={scale >= 5} aria-label="Zoom in"><FaPlus aria-hidden="true" /></button></div><button className="photo-lightbox-close" type="button" onClick={onClose} ref={closeButton} aria-label="Close image viewer"><FaTimes aria-hidden="true" /></button></div>
      <div ref={stage} className={`photo-lightbox-stage${scale > 1 ? ' is-zoomed' : ''}`} onWheel={(event) => { event.preventDefault(); zoom(-Math.max(-100, Math.min(100, event.deltaY)) * .0025); }} onPointerDown={(event) => { if (scale <= 1 || event.button === 2) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: position }; }} onPointerMove={(event) => { const current = drag.current; if (!current || current.pointerId !== event.pointerId || scale <= 1) return; setPosition(clampPosition({ x: current.origin.x + event.clientX - current.startX, y: current.origin.y + event.clientY - current.startY })); }} onPointerUp={endDrag} onPointerCancel={endDrag} onDoubleClick={() => scale > 1 ? reset() : zoom(1)}>
        <img ref={imageElement} src={image.src} alt={image.alt} draggable="false" style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${scale})` }} />
      </div>
      {image.caption && <p className="photo-lightbox-caption">{image.caption}</p>}
      <p className="photo-lightbox-help" id={helpId}>Scroll to zoom · Drag to pan · 0 to reset</p>
    </div>,
    document.body
  );
}

export function InterestGalleryModal({ activeGallery, galleries, onClose }) {
  const [showAllPhotography, setShowAllPhotography] = useState(false);
  const [lightboxImage, setLightboxImage] = useState(null);
  const lightboxTrigger = useRef(null);
  const lightboxOpen = useRef(false);
  const closeButton = useRef(null);
  const [eyebrow, title, closeLabel] = galleryMetadata[activeGallery];
  useOverlayLock();

  const closeLightbox = useCallback(() => {
    lightboxOpen.current = false;
    setLightboxImage(null);
    requestAnimationFrame(() => lightboxTrigger.current?.focus());
  }, []);

  useEffect(() => {
    closeButton.current?.focus();
    const handleKeyDown = (event) => {
      if (lightboxOpen.current) return;
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      else trapTabKey(event, closeButton.current?.closest('.photography-modal'));
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const openLightbox = (src, alt, caption, trigger) => { lightboxTrigger.current = trigger; lightboxOpen.current = true; setLightboxImage({ src, alt, caption }); };
  let content;
  if (activeGallery === 'music') content = <SpotifyListening />;
  else if (activeGallery === 'photography') content = <><PhotoGallery items={showAllPhotography ? galleries.photography : galleries.photography.slice(0, 4)} label="More photographs by Quang" onOpen={openLightbox} />{!showAllPhotography && <button className="button photography-view-all" type="button" onClick={() => setShowAllPhotography(true)}>View all</button>}</>;
  else content = <PhotoGallery items={galleries[activeGallery]} label={galleryLabels[activeGallery]} className={`${activeGallery}-gallery`} onOpen={openLightbox} />;

  return createPortal(
    <div
      className="photography-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="photography-modal"
        role="dialog"
        aria-modal={lightboxImage ? undefined : "true"}
        aria-hidden={lightboxImage ? "true" : undefined}
        inert={Boolean(lightboxImage)}
        aria-labelledby="interest-modal-title"
      >
        <div className="photography-modal-header">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h3 id="interest-modal-title">{title}</h3>
          </div>

          <button
            className="photography-modal-close"
            type="button"
            onClick={onClose}
            ref={closeButton}
            aria-label={closeLabel}
          >
            <FaTimes aria-hidden="true" />
          </button>
        </div>

        {content}
      </section>

      {lightboxImage && (
        <PhotoLightbox
          image={lightboxImage}
          onClose={closeLightbox}
        />
      )}
    </div>,
    document.body
  );
}
