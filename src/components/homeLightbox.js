import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { FaSearchPlus } from 'react-icons/fa';
import { PhotoLightbox } from './aboutGallery';

const HomeLightboxContext = createContext(null);

export function HomeLightboxProvider({ children }) {
  const [image, setImage] = useState(null);
  const trigger = useRef(null);

  const openImage = useCallback((nextImage, nextTrigger) => {
    trigger.current = nextTrigger;
    setImage(nextImage);
  }, []);

  const closeImage = useCallback(() => {
    setImage(null);
    requestAnimationFrame(() => trigger.current?.focus());
  }, []);

  useEffect(() => {
    if (!image) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [image]);

  return (
    <HomeLightboxContext.Provider value={openImage}>
      {children}
      {image && <PhotoLightbox image={image} onClose={closeImage} />}
    </HomeLightboxContext.Provider>
  );
}

export function HomeImageTrigger({ src, alt, caption, className = '', imageClassName = '', loading = 'lazy' }) {
  const openImage = useContext(HomeLightboxContext);

  return (
    <button
      className={`home-image-trigger${className ? ` ${className}` : ''}`}
      type="button"
      aria-label={`Open image: ${caption || alt}`}
      onClick={(event) => openImage({ src, alt, caption }, event.currentTarget)}
    >
      <img className={imageClassName} src={src} alt={alt} loading={loading} />
      <span className="photography-gallery-zoom-hint" aria-hidden="true"><FaSearchPlus /></span>
    </button>
  );
}
