import { useEffect, useRef } from 'react';

// Input that means the visitor has taken over scrolling; after it we never re-align.
const userScrollEvents = ['wheel', 'touchstart', 'keydown', 'pointerdown'];

/** Scrolls to an initial URL hash after the homepage DOM has mounted. */
function HashScroll() {
  const handledHash = useRef(null);

  useEffect(() => {
    const { hash } = window.location;
    if (!hash) return undefined;

    let id;
    try {
      id = decodeURIComponent(hash.slice(1));
    } catch {
      return undefined;
    }

    const target = document.getElementById(id);
    if (!target) return undefined;

    // Jump once; a StrictMode re-mount only re-attaches the settle watcher below.
    if (handledHash.current !== hash) {
      handledHash.current = hash;
      target.scrollIntoView();
    }

    // Web fonts and late images can re-wrap content above the target after the
    // first jump (scroll anchoring is suppressed by the reveal transforms), which
    // pushed deep links to later projects off target on phones. While the page
    // settles, re-align whenever its size changes, until the visitor scrolls,
    // follows another link, or the settle window ends.
    let active = true;
    const realign = () => {
      if (active && window.location.hash === hash) target.scrollIntoView({ behavior: 'instant' });
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(realign) : null;
    const stop = () => {
      active = false;
      observer?.disconnect();
    };
    observer?.observe(document.body);
    const settleTimer = window.setTimeout(stop, 5000);
    userScrollEvents.forEach((type) => window.addEventListener(type, stop, { passive: true, once: true }));

    return () => {
      stop();
      window.clearTimeout(settleTimer);
      userScrollEvents.forEach((type) => window.removeEventListener(type, stop));
    };
  }, []);

  return null;
}

export default HashScroll;
