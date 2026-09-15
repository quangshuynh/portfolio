import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaChevronLeft, FaChevronRight, FaInfoCircle, FaTimes } from 'react-icons/fa';
import useOverlayLock from '../utilities/overlayLock';

const preloadedSources = new Set();
const metadataFields = [
  ['capturedAt', 'Captured'],
  ['camera', 'Camera'],
  ['lens', 'Lens'],
  ['focalLength', 'Focal length'],
  ['aperture', 'Aperture'],
  ['shutterSpeed', 'Shutter'],
  ['iso', 'ISO'],
  ['location', 'Location'],
];

function isEditableTarget(target) {
  return target instanceof HTMLElement
    && (target.matches('input, textarea, select') || target.isContentEditable);
}

function trapTabKey(event, container) {
  if (event.key !== 'Tab') return;
  const controls = [...(container?.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])') ?? [])]
    .filter((control) => {
      const style = getComputedStyle(control);
      return !control.hidden && style.display !== 'none' && style.visibility !== 'hidden';
    });
  if (!controls.length) return;
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

function formatCapturedAt(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const datePart = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'long',
    timeZone: 'America/New_York',
  }).format(date);
  const timePart = new Intl.DateTimeFormat(undefined, {
    timeStyle: 'short',
    timeZone: 'America/New_York',
  }).format(date);
  return `${datePart} · ${timePart}`;
}

function formatMetadataValue(field, value) {
  if (field === 'capturedAt') return formatCapturedAt(value);
  if (field === 'focalLength') return `${value} mm`;
  if (field === 'aperture') return `f/${value}`;
  if (field === 'shutterSpeed') {
    return value < 1 ? `1/${Math.round(1 / value)} s` : `${value} s`;
  }
  return value;
}

export function PhotographyDetails({ photograph }) {
  const rows = metadataFields.flatMap(([field, label]) => {
    const rawValue = photograph[field];
    const value = formatMetadataValue(field, rawValue);
    return value === null || value === undefined || value === '' ? [] : [[label, value]];
  });

  return (
    <div className="photography-lightbox-details-content">
      <p className="photography-lightbox-id">#{photograph.id}</p>
      <p className="photography-lightbox-caption">{photograph.caption}</p>
      {rows.length > 0 && (
        <dl className="photography-lightbox-metadata">
          {rows.map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}
        </dl>
      )}
    </div>
  );
}

export function resetPhotographyPreloadsForTests() {
  preloadedSources.clear();
}

export default function PhotographyLightbox({ photograph, collection, onNavigate, onClose, returnFocusRef }) {
  const [infoOpen, setInfoOpen] = useState(false);
  const viewerRef = useRef(null);
  const sheetRef = useRef(null);
  const closeButtonRef = useRef(null);
  const infoButtonRef = useRef(null);
  const sheetCloseRef = useRef(null);
  const latestPhotograph = useRef(photograph);
  const sheetTitleId = useId();
  const index = collection.findIndex(({ id }) => id === photograph.id);
  const previous = index > 0 ? collection[index - 1] : null;
  const next = index >= 0 && index < collection.length - 1 ? collection[index + 1] : null;
  latestPhotograph.current = photograph;
  useOverlayLock();

  const closeInfo = () => {
    setInfoOpen(false);
    requestAnimationFrame(() => infoButtonRef.current?.focus());
  };

  useEffect(() => { closeButtonRef.current?.focus(); }, []);
  useEffect(() => () => requestAnimationFrame(() => {
    const fallback = document.querySelector(`[data-photo-slug="${latestPhotograph.current.slug}"] a`);
    (returnFocusRef?.current?.isConnected ? returnFocusRef.current : fallback)?.focus();
  }), [returnFocusRef]);

  useEffect(() => {
    if (infoOpen) sheetCloseRef.current?.focus();
  }, [infoOpen]);

  useEffect(() => {
    preloadedSources.add(photograph.viewerSrc);
    [previous, next].forEach((adjacent) => {
      if (!adjacent || preloadedSources.has(adjacent.viewerSrc)) return;
      preloadedSources.add(adjacent.viewerSrc);
      const preload = new Image();
      preload.src = adjacent.viewerSrc;
    });
  }, [photograph.viewerSrc, previous, next]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (infoOpen) closeInfo();
        else onClose();
        return;
      }
      if (infoOpen) {
        trapTabKey(event, sheetRef.current);
        return;
      }
      if (!isEditableTarget(event.target) && event.key === 'ArrowLeft' && previous) {
        event.preventDefault();
        onNavigate(previous);
      } else if (!isEditableTarget(event.target) && event.key === 'ArrowRight' && next) {
        event.preventDefault();
        onNavigate(next);
      } else {
        trapTabKey(event, viewerRef.current);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [infoOpen, onClose, onNavigate, previous, next]);

  const announcement = `Photo ${index + 1} of ${collection.length}. ${photograph.caption}.`;

  return createPortal(
    <div className="photography-lightbox-backdrop">
      <section
        ref={viewerRef}
        className="photography-lightbox"
        role="dialog"
        aria-modal={infoOpen ? undefined : 'true'}
        aria-hidden={infoOpen ? 'true' : undefined}
        inert={infoOpen || undefined}
        aria-label={`Photography viewer: ${photograph.caption}`}
      >
        <h2 className="visually-hidden">Photography viewer</h2>
        <p className="visually-hidden" aria-live="polite" aria-atomic="true">{announcement}</p>
        <div className="photography-lightbox-toolbar">
          <span aria-hidden="true">{index + 1} / {collection.length}</span>
          <div>
            <button className="photography-lightbox-info" ref={infoButtonRef} type="button" onClick={() => setInfoOpen(true)} aria-label="Show photograph information"><FaInfoCircle aria-hidden="true" /></button>
            <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close photograph"><FaTimes aria-hidden="true" /></button>
          </div>
        </div>

        <div className="photography-lightbox-layout">
          <div className="photography-lightbox-stage">
            <button type="button" onClick={() => previous && onNavigate(previous)} disabled={!previous} aria-label="Previous photograph"><FaChevronLeft aria-hidden="true" /></button>
            <div className="photography-lightbox-image-wrap">
              <img key={photograph.id} src={photograph.viewerSrc} width={photograph.viewerWidth} height={photograph.viewerHeight} alt={photograph.alt} loading="eager" fetchPriority="high" decoding="async" />
            </div>
            <button type="button" onClick={() => next && onNavigate(next)} disabled={!next} aria-label="Next photograph"><FaChevronRight aria-hidden="true" /></button>
          </div>
          <aside className="photography-lightbox-details" aria-label="Photograph details"><PhotographyDetails photograph={photograph} /></aside>
        </div>
      </section>

      {infoOpen && (
        <section ref={sheetRef} className="photography-lightbox-sheet" role="dialog" aria-modal="true" aria-labelledby={sheetTitleId}>
          <div className="photography-lightbox-sheet-header">
            <h2 id={sheetTitleId}>Photograph information</h2>
            <button ref={sheetCloseRef} type="button" onClick={closeInfo} aria-label="Close photograph information"><FaTimes aria-hidden="true" /></button>
          </div>
          <PhotographyDetails photograph={photograph} />
        </section>
      )}
    </div>,
    document.body
  );
}
