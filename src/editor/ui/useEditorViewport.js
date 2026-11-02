import { useLayoutEffect } from 'react';

// Keep browser chrome/keyboard measurements out of React's editing state.
export default function useEditorViewport(rootRef) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      frame = 0;
      // Browser page zoom is an accessibility feature, not a keyboard resize.
      if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
      const height = viewport?.height ?? window.innerHeight;
      root.style.setProperty('--pe-viewport-height', `${height}px`);
      root.style.setProperty('--pe-viewport-top', `${viewport?.offsetTop ?? 0}px`);
      const input = document.activeElement;
      const editing = root.contains(input) && input.matches('input:not([type=range]):not([type=checkbox]):not([type=radio]), textarea, [contenteditable=true]');
      root.toggleAttribute('data-keyboard', editing && window.innerHeight - height > 120);
      if (editing) {
        // Scroll only the containing tray, never the page or the canvas.
        // Read the new layout now: another frame may wait behind image rendering.
        const panel = input.closest('.pe-dialog__body, .pe-inspector, .pe-library');
        if (!panel || document.activeElement !== input) return;
        const field = input.getBoundingClientRect();
        const bounds = panel.getBoundingClientRect();
        if (field.bottom > bounds.bottom - 8) panel.scrollTop += field.bottom - bounds.bottom + 8;
        else if (field.top < bounds.top + 8) panel.scrollTop -= bounds.top + 8 - field.top;
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const events = [[window, 'resize'], [window, 'pageshow'], [document, 'fullscreenchange'], [document, 'webkitfullscreenchange'],
      [root, 'focusin'], [root, 'focusout'], [viewport, 'resize'], [viewport, 'scroll']];
    events.forEach(([target, name]) => target?.addEventListener(name, schedule));
    update();
    return () => {
      events.forEach(([target, name]) => target?.removeEventListener(name, schedule));
      cancelAnimationFrame(frame);
      root.style.removeProperty('--pe-viewport-height');
      root.style.removeProperty('--pe-viewport-top');
      root.removeAttribute('data-keyboard');
    };
  }, [rootRef]);
}
