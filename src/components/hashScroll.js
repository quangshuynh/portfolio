import { useEffect, useRef } from 'react';

/** Scrolls to an initial URL hash after the homepage DOM has mounted. */
function HashScroll() {
  const handledHash = useRef(null);

  useEffect(() => {
    const { hash } = window.location;
    if (!hash || handledHash.current === hash) return;

    let id;
    try {
      id = decodeURIComponent(hash.slice(1));
    } catch {
      return;
    }

    const target = document.getElementById(id);
    if (!target) return;

    handledHash.current = hash;
    target.scrollIntoView();
  }, []);

  return null;
}

export default HashScroll;
