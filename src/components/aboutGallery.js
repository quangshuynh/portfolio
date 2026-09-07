import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { FaMinus, FaPlus, FaSearchPlus, FaTimes } from 'react-icons/fa';

const SPOTIFY_ENDPOINT = 'https://spotify-portfolio-api.quangs.workers.dev/recent';
const SPOTIFY_PROFILE = 'https://open.spotify.com/user/foahrtqqvuuvt7wscxub4uerd';
let spotifyTracksCache = null;
let spotifyRequest = null;

function getSpotifyTracks() {
  if (spotifyTracksCache) return Promise.resolve(spotifyTracksCache);
  if (!spotifyRequest) {
    spotifyRequest = fetch(SPOTIFY_ENDPOINT)
      .then((response) => {
        if (!response.ok) throw new Error('Spotify request failed');
        return response.json();
      })
      .then((data) => {
        spotifyTracksCache = data.tracks ?? [];
        return spotifyTracksCache;
      })
      .finally(() => { spotifyRequest = null; });
  }
  return spotifyRequest;
}

const galleryMetadata = {
  photography: ['Behind the lens', 'Photography by Quang', 'Close photography gallery'],
  personal: ['Beyond the résumé', 'More about Quang', 'Close personal photo gallery'],
  gaming: ['In the game', 'Gaming', 'Close gaming gallery'],
  music: ['On repeat', 'What I’ve been listening to', 'Close music activity'],
  technology: ['Under the hood', 'Cars & technology', 'Close cars and technology gallery']
};

const focusableSelector = 'button:not([disabled]), a[href]';

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

export function InterestCard({ icon: Icon, title, copy, photos, onOpen }) {
  const gallery = title === 'Photography' ? 'photography'
    : title === 'Cars & technology' ? 'technology'
      : title === 'Gaming' ? 'gaming'
        : title === 'Music' ? 'music' : null;

  return (
    <article className="interest-card">
      {photos && (
        <div className={`interest-card-media${photos.length > 1 ? ' interest-card-media-pair' : ''}${title === 'Photography' ? ' interest-card-media-photography' : ''}${title === 'Music' ? ' interest-card-media-music' : ''}${title === 'Hiking' ? ' interest-card-media-hiking' : ''}`}>
          {photos.map(([src, width, height, alt]) => <img src={src} width={width} height={height} alt={alt} key={src} />)}
        </div>
      )}
      <h3><Icon aria-hidden="true" />{title}</h3>
      <p>{copy}</p>
      {gallery && (
        <button className="interest-view-more" type="button" aria-haspopup="dialog" onClick={(event) => onOpen(gallery, event.currentTarget)}>
          {gallery === 'music' ? 'View listening' : 'View more'}
        </button>
      )}
    </article>
  );
}

function PhotoGallery({ items, label, className = '', captions, onOpen }) {
  return (
    <div className={`photography-gallery${className ? ` ${className}` : ''}`} id={label === 'More photographs by Quang' ? 'photography-gallery' : undefined} aria-label={label}>
      {items.map(([src, width, height, alt, itemCaption, shape]) => {
        const caption = captions?.[src] ?? itemCaption;
        const portrait = captions ? itemCaption === 'portrait' : shape === 'portrait';
        return (
          <figure className={portrait ? 'photography-gallery-portrait' : undefined} key={src}>
            <button className="photography-gallery-image-button" type="button" onClick={(event) => onOpen(src, alt, caption, event.currentTarget)} aria-label={`Open image: ${caption}`}>
              <img src={src} width={width} height={height} alt={alt} loading="lazy" />
              <span className="photography-gallery-zoom-hint" aria-hidden="true"><FaSearchPlus /></span>
            </button>
            <figcaption>{caption}</figcaption>
          </figure>
        );
      })}
    </div>
  );
}

export function SpotifyListening() {
  const [tracks, setTracks] = useState(spotifyTracksCache ?? []);
  const [status, setStatus] = useState(spotifyTracksCache ? 'success' : 'loading');

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
  }, []);

  if (status === 'loading') return <div className="spotify-listening"><p>Loading recent listening...</p></div>;
  if (status === 'error') return <div className="spotify-listening"><div className="spotify-listening-status"><p>Couldn’t load my recent listening right now.</p><a className="interest-view-more" href={SPOTIFY_PROFILE} target="_blank" rel="noreferrer">View my Spotify</a></div></div>;
  if (!tracks.length) return <div className="spotify-listening"><p>No recent listening activity to show.</p></div>;

  return <div className="spotify-listening"><div className="spotify-track-list">{tracks.map((track) => <a className="spotify-track" href={track.url} target="_blank" rel="noreferrer" key={`${track.id}-${track.playedAt}`}>{track.image && <img src={track.image} alt="" loading="lazy" />}<div><strong>{track.name}</strong><span>{track.artist}</span><small>{track.album}</small></div></a>)}</div><a className="interest-view-more spotify-profile-link" href={SPOTIFY_PROFILE} target="_blank" rel="noreferrer">View my Spotify</a></div>;
}

export function PhotoLightbox({ image, onClose }) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const closeButton = useRef(null);
  const stage = useRef(null);
  const imageElement = useRef(null);
  const drag = useRef(null);
  const helpId = useId();

  const clampPosition = useCallback((next, nextScale = scale) => {
    const stageRect = stage.current?.getBoundingClientRect();
    const imageRect = imageElement.current?.getBoundingClientRect();
    if (!stageRect || !imageRect || nextScale <= 1) return { x: 0, y: 0 };
    const baseWidth = imageRect.width / scale;
    const baseHeight = imageRect.height / scale;
    const maxX = Math.max(0, (baseWidth * nextScale - stageRect.width) / 2);
    const maxY = Math.max(0, (baseHeight * nextScale - stageRect.height) / 2);
    return { x: Math.max(-maxX, Math.min(maxX, next.x)), y: Math.max(-maxY, Math.min(maxY, next.y)) };
  }, [scale]);

  const zoom = useCallback((amount) => {
    setScale((current) => {
      const next = Math.min(5, Math.max(1, Number((current + amount).toFixed(2))));
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
      else trapTabKey(event, event.currentTarget.querySelector('.photo-lightbox-backdrop'));
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

  return (
    <div className="photo-lightbox-backdrop" role="dialog" aria-modal="true" aria-label={image.caption ? `Image viewer: ${image.caption}` : 'Image viewer'} aria-describedby={helpId} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="photo-lightbox-toolbar"><div className="photo-lightbox-zoom-controls" aria-label="Image zoom controls"><button type="button" onClick={() => zoom(-.25)} disabled={scale <= 1} aria-label="Zoom out"><FaMinus aria-hidden="true" /></button><button className="photo-lightbox-scale" type="button" onClick={reset} aria-label="Reset zoom">{Math.round(scale * 100)}%</button><button type="button" onClick={() => zoom(.25)} disabled={scale >= 5} aria-label="Zoom in"><FaPlus aria-hidden="true" /></button></div><button className="photo-lightbox-close" type="button" onClick={onClose} ref={closeButton} aria-label="Close image viewer"><FaTimes aria-hidden="true" /></button></div>
      <div ref={stage} className={`photo-lightbox-stage${scale > 1 ? ' is-zoomed' : ''}`} onWheel={(event) => { event.preventDefault(); zoom(-Math.max(-100, Math.min(100, event.deltaY)) * .0025); }} onPointerDown={(event) => { if (scale <= 1 || event.button === 2) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: position }; }} onPointerMove={(event) => { const current = drag.current; if (!current || current.pointerId !== event.pointerId || scale <= 1) return; setPosition(clampPosition({ x: current.origin.x + event.clientX - current.startX, y: current.origin.y + event.clientY - current.startY })); }} onPointerUp={endDrag} onPointerCancel={endDrag} onDoubleClick={() => scale > 1 ? reset() : zoom(1)}>
        <img ref={imageElement} src={image.src} alt={image.alt} draggable="false" style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${scale})` }} />
      </div>
      {image.caption && <p className="photo-lightbox-caption">{image.caption}</p>}
      <p className="photo-lightbox-help" id={helpId}>Scroll or use + and − to zoom. Drag to pan. Double-click to zoom. Press 0 to reset.</p>
    </div>
  );
}

export function InterestGalleryModal({ activeGallery, galleries, photographyCaptions, onClose }) {
  const [showAllPhotography, setShowAllPhotography] = useState(false);
  const [lightboxImage, setLightboxImage] = useState(null);
  const lightboxTrigger = useRef(null);
  const lightboxOpen = useRef(false);
  const closeButton = useRef(null);
  const [eyebrow, title, closeLabel] = galleryMetadata[activeGallery];

  const closeLightbox = useCallback(() => {
    lightboxOpen.current = false;
    setLightboxImage(null);
    requestAnimationFrame(() => lightboxTrigger.current?.focus());
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const handleKeyDown = (event) => {
      if (lightboxOpen.current) return;
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      else trapTabKey(event, closeButton.current?.closest('.photography-modal'));
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', handleKeyDown); };
  }, [onClose]);

  const openLightbox = (src, alt, caption, trigger) => { lightboxTrigger.current = trigger; lightboxOpen.current = true; setLightboxImage({ src, alt, caption }); };
  let content;
  if (activeGallery === 'music') content = <SpotifyListening />;
  else if (activeGallery === 'photography') content = <><PhotoGallery items={showAllPhotography ? galleries.photography : galleries.photography.slice(0, 3)} label="More photographs by Quang" captions={photographyCaptions} onOpen={openLightbox} />{!showAllPhotography && <button className="button photography-view-all" type="button" onClick={() => setShowAllPhotography(true)}>View all</button>}</>;
  else content = <PhotoGallery items={galleries[activeGallery]} label={activeGallery === 'personal' ? 'More photos of Quang' : activeGallery === 'gaming' ? 'More gaming screenshots' : 'More cars and technology photos'} className={`${activeGallery}-gallery`} onOpen={openLightbox} />;

  return <div className="photography-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="photography-modal" role="dialog" aria-modal="true" aria-labelledby="interest-modal-title"><div className="photography-modal-header"><div><p className="eyebrow">{eyebrow}</p><h3 id="interest-modal-title">{title}</h3></div><button className="photography-modal-close" type="button" onClick={onClose} ref={closeButton} aria-label={closeLabel}><FaTimes aria-hidden="true" /></button></div>{content}</section>{lightboxImage && <PhotoLightbox image={lightboxImage} onClose={closeLightbox} />}</div>;
}
