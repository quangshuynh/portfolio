import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { FaSearchPlus } from 'react-icons/fa';
import PhotoLightbox from '../ui/photoLightbox';

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

  const showPrevious = useCallback(() => {
    setImage((current) => {
      if (!current?.gallery?.length) return current;

      const index =
        (current.galleryIndex - 1 + current.gallery.length) %
        current.gallery.length;

      return {
        ...current.gallery[index],
        gallery: current.gallery,
        galleryIndex: index,
      };
    });
  }, []);

  const showNext = useCallback(() => {
    setImage((current) => {
      if (!current?.gallery?.length) return current;

      const index = (current.galleryIndex + 1) % current.gallery.length;

      return {
        ...current.gallery[index],
        gallery: current.gallery,
        galleryIndex: index,
      };
    });
  }, []);

  return (
    <HomeLightboxContext.Provider value={openImage}>
      {children}
      {image && (
        <PhotoLightbox
          image={image}
          onClose={closeImage}
          onPrevious={image.gallery ? showPrevious : undefined}
          onNext={image.gallery ? showNext : undefined}
        />
      )}
    </HomeLightboxContext.Provider>
  );
}

export function HomeImageTrigger({
  src,
  alt,
  caption,
  className = '',
  imageClassName = '',
  loading = 'lazy',
  width,
  height,
  gallery,
  galleryIndex,
}) {
  const openImage = useContext(HomeLightboxContext);
  const [failedSrc, setFailedSrc] = useState(null);

  // A remote screenshot can be unreachable (CDN outage, a bad pin). Swap in a
  // quiet placeholder that keeps the alt text instead of a broken-image icon
  // and a button that would open an empty viewer.
  if (failedSrc === src) {
    return (
      <div className={`image-fallback${imageClassName ? ` ${imageClassName}` : ''}`} role="img" aria-label={alt}>
        <span aria-hidden="true">Preview unavailable</span>
      </div>
    );
  }

  return (
    <button
      className={`home-image-trigger${className ? ` ${className}` : ''}`}
      type="button"
      aria-label={`Open image: ${caption || alt}`}
      aria-haspopup="dialog"
      onClick={(event) =>
        openImage(
          {
            src,
            alt,
            caption,
            gallery,
            galleryIndex,
          },
          event.currentTarget
        )
      }
    >
      <img
        className={imageClassName}
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={loading}
        decoding="async"
        onError={() => setFailedSrc(src)}
      />
      <span className="photography-gallery-zoom-hint" aria-hidden="true"><FaSearchPlus /></span>
    </button>
  );
}
