import React, { useEffect, useId, useRef } from 'react';

/**
 * Modal dialog shell: focus moves in and returns to the opener on close, Tab stays inside,
 * Escape closes (unless `busy`). Same markup and styles as the Merge HDR dialog.
 */
export default function Dialog({ title, onClose, busy = false, footer, children, className = '' }) {
  const titleId = useId();
  const ref = useRef(null);
  useEffect(() => {
    const opener = document.activeElement;
    ref.current?.querySelector('input, select, button:not([data-close])')?.focus();
    return () => opener?.focus?.();
  }, []);
  const onKeyDown = (event) => {
    if (event.key === 'Escape') { event.stopPropagation(); if (!busy) onClose(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...ref.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [href]')];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return (
    <div className="pe-dialog-backdrop">
      <div ref={ref} className={`pe-dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        <header className="pe-dialog__head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="pe-icon-button" data-close onClick={onClose} disabled={busy} aria-label={`Close ${title}`}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </header>
        <div className="pe-dialog__body">{children}</div>
        <footer className="pe-dialog__foot">{footer}</footer>
      </div>
    </div>
  );
}
