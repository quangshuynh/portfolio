import { useCallback, useEffect, useRef, useState } from 'react';

const fullscreenElement = () => document.fullscreenElement ?? document.webkitFullscreenElement ?? null;

/** Whether `element` can enter native fullscreen (iPhone Safari cannot, for anything but video). */
export function nativeFullscreenSupported(element) {
  if (typeof document === 'undefined' || !element) return false;
  const enabled = document.fullscreenEnabled ?? document.webkitFullscreenEnabled ?? false;
  return Boolean(enabled && (element.requestFullscreen || element.webkitRequestFullscreen));
}

/**
 * Fullscreen for one element, shared by the photography viewer, the CMS review image and the
 * photo editor. `mode` is 'native' (the Fullscreen API: the browser's chrome is hidden) or
 * 'immersive' (the element fills the viewport with CSS: used when the API is missing or the
 * browser refuses; the browser's own chrome stays). `null` when neither is on.
 * The native mode follows the browser: leaving with Esc or a system gesture clears it.
 */
export default function useFullscreen(targetRef) {
  const [mode, setMode] = useState(null);
  // The element that entered native fullscreen; the ref is already detached when the view unmounts.
  const enteredRef = useRef(null);

  useEffect(() => {
    const changed = () => setMode((current) => (current === 'native' && fullscreenElement() !== targetRef.current ? null : current));
    document.addEventListener('fullscreenchange', changed);
    document.addEventListener('webkitfullscreenchange', changed);
    return () => {
      document.removeEventListener('fullscreenchange', changed);
      document.removeEventListener('webkitfullscreenchange', changed);
    };
  }, [targetRef]);

  // Leaving the view (closing the viewer) leaves fullscreen with it.
  useEffect(() => () => {
    const element = enteredRef.current;
    if (element && fullscreenElement() === element) (document.exitFullscreen ?? document.webkitExitFullscreen)?.call(document)?.catch?.(() => {});
  }, [targetRef]);

  const enter = useCallback(async () => {
    const element = targetRef.current;
    if (!element) return;
    if (nativeFullscreenSupported(element)) {
      try {
        await (element.requestFullscreen ?? element.webkitRequestFullscreen).call(element, { navigationUI: 'hide' });
        enteredRef.current = element;
        setMode('native');
        return;
      } catch { /* refused (no user gesture, an iframe without permission): fall back below */ }
    }
    setMode('immersive');
  }, [targetRef]);

  const exit = useCallback(async () => {
    if (fullscreenElement() && fullscreenElement() === enteredRef.current) {
      try { await (document.exitFullscreen ?? document.webkitExitFullscreen).call(document); } catch { /* already left */ }
    }
    setMode(null);
  }, [targetRef]);

  const toggle = useCallback(() => (mode ? exit() : enter()), [mode, enter, exit]);

  return { mode, active: mode !== null, enter, exit, toggle };
}
