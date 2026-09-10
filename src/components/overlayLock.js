import { useEffect } from 'react';

let lockCount = 0;
let lockedScrollY = 0;
let previousBodyStyles = null;

/** Keeps viewport overlays independent from page scrolling and scroll snapping. */
export default function useOverlayLock(active = true) {
  useEffect(() => {
    if (!active) return undefined;

    if (lockCount === 0) {
      lockedScrollY = window.scrollY;
      previousBodyStyles = {
        position: document.body.style.position,
        top: document.body.style.top,
        width: document.body.style.width,
        overflow: document.body.style.overflow,
      };
      document.documentElement.classList.add('overlay-open');
      document.body.style.position = 'fixed';
      document.body.style.top = `-${lockedScrollY}px`;
      document.body.style.width = '100%';
      document.body.style.overflow = 'hidden';
    }
    lockCount += 1;

    return () => {
      lockCount -= 1;
      if (lockCount > 0) return;

      document.documentElement.classList.remove('overlay-open');
      Object.assign(document.body.style, previousBodyStyles);
      previousBodyStyles = null;
      if (lockedScrollY !== 0) window.scrollTo(0, lockedScrollY);
    };
  }, [active]);
}
