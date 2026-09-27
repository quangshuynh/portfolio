import React, {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { FaMinus, FaPlus, FaTimes } from 'react-icons/fa';
import useOverlayLock from '../utilities/overlayLock';

const focusableSelector = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

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

export default function PhotoLightbox({
  image,
  onClose,
  onPrevious,
  onNext,
}) {
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

  const clampPosition = useCallback(
    (next, nextScale = scaleRef.current) => {
      const stageRect = stage.current?.getBoundingClientRect();
      const baseWidth = imageElement.current?.offsetWidth;
      const baseHeight = imageElement.current?.offsetHeight;

      if (
        !stageRect ||
        !baseWidth ||
        !baseHeight ||
        nextScale <= 1
      ) {
        return { x: 0, y: 0 };
      }

      const maxX = Math.max(
        0,
        (baseWidth * nextScale - stageRect.width) / 2
      );

      const maxY = Math.max(
        0,
        (baseHeight * nextScale - stageRect.height) / 2
      );

      return {
        x: Math.max(-maxX, Math.min(maxX, next.x)),
        y: Math.max(-maxY, Math.min(maxY, next.y)),
      };
    },
    []
  );

  const zoom = useCallback(
    (amount) => {
      setScale((current) => {
        const next = Math.min(
          5,
          Math.max(1, Number((current + amount).toFixed(2)))
        );

        scaleRef.current = next;

        setPosition((currentPosition) =>
          clampPosition(currentPosition, next)
        );

        return next;
      });
    },
    [clampPosition]
  );

  const reset = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  // Reset zoom and pan whenever the displayed gallery image changes.
  useEffect(() => {
    reset();
  }, [image.src, reset]);

  // Give keyboard users an immediate control inside the dialog.
  useEffect(() => {
    closeButton.current?.focus();
  }, []);

  // Keyboard controls.
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'ArrowLeft' && onPrevious) {
        event.preventDefault();
        onPrevious();
      } else if (event.key === 'ArrowRight' && onNext) {
        event.preventDefault();
        onNext();
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoom(0.25);
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        zoom(-0.25);
      } else if (event.key === '0') {
        event.preventDefault();
        reset();
      } else {
        trapTabKey(event, dialogRef.current);
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, onPrevious, onNext, reset, zoom]);

  // Keep a zoomed image within the available stage after resizing.
  useEffect(() => {
    const handleResize = () => {
      setPosition((current) => clampPosition(current));
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [clampPosition]);

  const endDrag = (event) => {
    if (drag.current?.pointerId !== event.pointerId) return;

    drag.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return createPortal(
    <div
      ref={dialogRef}
      className="photo-lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={
        image.caption
          ? `Image viewer: ${image.caption}`
          : 'Image viewer'
      }
      aria-describedby={helpId}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="photo-lightbox-toolbar">
        <div
          className="photo-lightbox-zoom-controls"
          aria-label="Image zoom controls"
        >
          <button
            type="button"
            onClick={() => zoom(-0.25)}
            disabled={scale <= 1}
            aria-label="Zoom out"
          >
            <FaMinus aria-hidden="true" />
          </button>

          <button
            className="photo-lightbox-scale"
            type="button"
            onClick={reset}
            aria-label="Reset zoom"
          >
            {Math.round(scale * 100)}%
          </button>

          <button
            type="button"
            onClick={() => zoom(0.25)}
            disabled={scale >= 5}
            aria-label="Zoom in"
          >
            <FaPlus aria-hidden="true" />
          </button>
        </div>

        <button
          className="photo-lightbox-close"
          type="button"
          onClick={onClose}
          ref={closeButton}
          aria-label="Close image viewer"
        >
          <FaTimes aria-hidden="true" />
        </button>
      </div>

      <div
        ref={stage}
        className={`photo-lightbox-stage${
          scale > 1 ? ' is-zoomed' : ''
        }`}
        onWheel={(event) => {
          event.preventDefault();

          zoom(
            -Math.max(-100, Math.min(100, event.deltaY)) * 0.0025
          );
        }}
        onPointerDown={(event) => {
          if (event.target.closest('.photo-lightbox-nav')) return;
          if (scale <= 1 || event.button === 2) return;

          event.currentTarget.setPointerCapture(event.pointerId);

          drag.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            origin: position,
          };
        }}
        onPointerMove={(event) => {
          const current = drag.current;

          if (
            !current ||
            current.pointerId !== event.pointerId ||
            scale <= 1
          ) {
            return;
          }

          setPosition(
            clampPosition({
              x:
                current.origin.x +
                event.clientX -
                current.startX,
              y:
                current.origin.y +
                event.clientY -
                current.startY,
            })
          );
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={(event) => {
          if (event.target.closest('.photo-lightbox-nav')) return;

          if (scale > 1) {
            reset();
          } else {
            zoom(1);
          }
        }}
      >
        {onPrevious && (
          <button
            type="button"
            className="photo-lightbox-nav photo-lightbox-nav--previous"
            onClick={(event) => {
              event.stopPropagation();
              onPrevious();
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
            }}
            aria-label="Previous image"
          >
            ‹
          </button>
        )}

        <img
          ref={imageElement}
          src={image.src}
          alt={image.alt}
          draggable="false"
          decoding="async"
          style={{
            transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${scale})`,
          }}
        />

        {onNext && (
          <button
            type="button"
            className="photo-lightbox-nav photo-lightbox-nav--next"
            onClick={(event) => {
              event.stopPropagation();
              onNext();
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
            }}
            aria-label="Next image"
          >
            ›
          </button>
        )}
      </div>

      {image.gallery && (
        <p
          className="photo-lightbox-counter"
          aria-live="polite"
        >
          {image.galleryIndex + 1} of {image.gallery.length}
        </p>
      )}

      {image.caption && (
        <p className="photo-lightbox-caption">
          {image.caption}
        </p>
      )}

      <div className="photo-lightbox-help" id={helpId}>
        <span className="photo-lightbox-help--desktop">
          {image.gallery
            ? '← → to browse · Scroll to zoom · Drag to pan · 0 to reset'
            : 'Scroll to zoom · Drag to pan · 0 to reset'}
        </span>

        <span className="photo-lightbox-help--mobile">
          {image.gallery
            ? 'Tap ‹ › to browse · Use + − to zoom · Drag to pan'
            : 'Use + − to zoom · Drag to pan'}
        </span>
      </div>
    </div>,
    document.body
  );
}
