import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaChevronLeft, FaChevronRight, FaCompress, FaExpand, FaInfoCircle, FaMinus, FaPlus, FaTimes } from 'react-icons/fa';
import useOverlayLock from '../utilities/overlayLock';
import useFullscreen from '../utilities/useFullscreen';

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

// Visitor-facing names for raw EXIF make/model strings; unknown models pass through.
const CAMERA_DISPLAY_NAMES = {
  'SONY ILCE-6400': 'Sony A6400',
  'SONY ILCE-7M3': 'Sony A7 III',
  'SONY ILCE-6700': 'Sony A6700',
  'NIKON D3100': 'Nikon D3100',
  'PENTAX K-50': 'Pentax K-50',
};

export function formatCameraName(camera) {
  return CAMERA_DISPLAY_NAMES[camera] ?? camera;
}

function formatMetadataValue(field, value) {
  if (field === 'capturedAt') return formatCapturedAt(value);
  if (field === 'camera') return formatCameraName(value);
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
      {photograph.curatedOrder && <p className="photography-lightbox-id">No. {String(photograph.curatedOrder).padStart(2, '0')}</p>}
      <p className="photography-lightbox-caption">{photograph.caption}</p>
      {photograph.category && <p className="photography-lightbox-tags">{[photograph.category, ...(photograph.tags ?? [])].join(' · ')}</p>}
      {rows.length > 0 && (
        <dl className="photography-lightbox-metadata">
          {rows.map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}
        </dl>
      )}
    </div>
  );
}

export function calculateFittedImageDimensions(width, height, availableWidth, availableHeight) {
  const safeWidth = Number(width) || 0;
  const safeHeight = Number(height) || 0;
  if (!safeWidth || !safeHeight || !Number.isFinite(safeWidth) || !Number.isFinite(safeHeight)) {
    return { width: 0, height: 0, scale: 1 };
  }
  const maxScale = Math.min((Number(availableWidth) || 0) / safeWidth, (Number(availableHeight) || 0) / safeHeight, 1);
  return {
    width: safeWidth * maxScale,
    height: safeHeight * maxScale,
    scale: maxScale,
  };
}

export const MAX_ZOOM = 5;
const DOUBLE_TAP_MS = 300;
const TAP_SLOP_PX = 24;
// A one-finger swipe at the fit changes photograph once it is mostly horizontal and passes
// SWIPE_START_PX; it commits past a fifth of the stage (at most SWIPE_COMMIT_PX) or on a flick.
const SWIPE_START_PX = 10;
const SWIPE_COMMIT_PX = 96;
const SWIPE_FLICK_PX = 32;
const SWIPE_FLICK_SPEED = 0.45;
const SWIPE_EDGE_RESISTANCE = 0.3;
export const SWIPE_SETTLE_MS = 200;

/**
 * Whether a released swipe changes photograph.
 * :param dx: horizontal travel in px (negative: towards the next photograph)
 * :param duration: ms since the finger went down
 * :param width: stage width in px
 */
export function swipeCommits(dx, duration, width) {
  const distance = Math.abs(dx);
  const speed = distance / Math.max(1, duration);
  return distance >= Math.min(SWIPE_COMMIT_PX, width * 0.2) || (distance >= SWIPE_FLICK_PX && speed >= SWIPE_FLICK_SPEED);
}

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * The view after zooming to `nextScale` (1–MAX_ZOOM) so that the image point under `point`
 * stays under `to` (default: the same place). Points are stage pixels from the stage's centre,
 * where the image is centred and scaled from.
 */
export function zoomAround({ scale, position }, nextScale, point, to = point) {
  const target = Math.min(MAX_ZOOM, Math.max(1, nextScale));
  const ratio = target / scale;
  return { scale: target, position: { x: to.x - (point.x - position.x) * ratio, y: to.y - (point.y - position.y) * ratio } };
}

export function resetPhotographyPreloadsForTests() {
  preloadedSources.clear();
}

export default function PhotographyLightbox({ photograph, collection, onNavigate, onClose, returnFocusRef }) {
  const [infoOpen, setInfoOpen] = useState(false);
  // The view lives in a ref and is painted straight onto the image and the percentage, so a pan,
  // pinch or swipe never re-renders; `scale` (state) drives the zoom buttons and is committed
  // when a gesture ends.
  const [scale, setScale] = useState(1);
  const viewRef = useRef({ scale: 1, position: { x: 0, y: 0 } });
  const scaleLabelRef = useRef(null);
  // A swipe between photographs: its finger and start, and the image's horizontal offset.
  const swipeRef = useRef(null);
  const swipeOffsetRef = useRef(0);
  const settleTimerRef = useRef(null);
  const [fitSize, setFitSize] = useState({ width: 0, height: 0 });
  const backdropRef = useRef(null);
  const viewerRef = useRef(null);
  const sheetRef = useRef(null);
  const closeButtonRef = useRef(null);
  const infoButtonRef = useRef(null);
  const sheetCloseRef = useRef(null);
  const stageRef = useRef(null);
  const imageRef = useRef(null);
  const dragRef = useRef(null);
  // Touch gestures: pointers down on the image, a pinch in progress and the last tap.
  const pointersRef = useRef(new Map());
  const pinchRef = useRef(null);
  const tapRef = useRef(null);
  const tapZoomRef = useRef(-Infinity);
  const latestPhotograph = useRef(photograph);
  const sheetTitleId = useId();
  const index = collection.findIndex(({ id }) => id === photograph.id);
  const previous = index > 0 ? collection[index - 1] : null;
  const next = index >= 0 && index < collection.length - 1 ? collection[index + 1] : null;
  latestPhotograph.current = photograph;
  useOverlayLock();
  // The backdrop goes fullscreen, so the information sheet (its sibling) stays reachable.
  const fullscreen = useFullscreen(backdropRef);

  const measureFit = React.useCallback(() => {
    const stage = stageRef.current;
    const image = imageRef.current;
    if (!stage || !image) return;
    // The stage fills the viewer (the whole viewport in fullscreen); the photograph is fitted
    // inside it and zooms and pans across all of it, not only inside its fitted box.
    const availableWidth = stage.clientWidth;
    const availableHeight = stage.clientHeight;
    const nextFit = calculateFittedImageDimensions(
      image.naturalWidth || photograph.viewerWidth || image.width || 0,
      image.naturalHeight || photograph.viewerHeight || image.height || 0,
      availableWidth,
      availableHeight,
    );
    setFitSize(nextFit);
  }, [photograph.viewerHeight, photograph.viewerWidth]);

  const clampPosition = React.useCallback((next, nextScale = viewRef.current.scale) => {
    const stageRect = stageRef.current?.getBoundingClientRect();
    const baseWidth = fitSize.width || imageRef.current?.offsetWidth || 0;
    const baseHeight = fitSize.height || imageRef.current?.offsetHeight || 0;
    if (!stageRect || !baseWidth || !baseHeight || nextScale <= 1) return { x: 0, y: 0 };
    const maxX = Math.max(0, (baseWidth * nextScale - stageRect.width) / 2);
    const maxY = Math.max(0, (baseHeight * nextScale - stageRect.height) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
  }, [fitSize.height, fitSize.width]);

  const paint = React.useCallback(() => {
    const { scale: currentScale, position: { x, y } } = viewRef.current;
    if (imageRef.current) imageRef.current.style.transform = `translate3d(${x + swipeOffsetRef.current}px, ${y}px, 0) scale(${currentScale})`;
    const label = `${Math.round(currentScale * 100)}%`;
    if (scaleLabelRef.current && scaleLabelRef.current.textContent !== label) scaleLabelRef.current.textContent = label;
  }, []);

  // `commit: false` during a pinch: painted only; the zoom buttons follow when the fingers lift.
  const applyView = React.useCallback(({ scale: nextScale, position: nextPosition }, { commit = true } = {}) => {
    viewRef.current = { scale: nextScale, position: nextScale > 1 ? clampPosition(nextPosition, nextScale) : { x: 0, y: 0 } };
    paint();
    if (commit) setScale(nextScale);
  }, [clampPosition, paint]);

  const zoom = React.useCallback((amount) => {
    const { scale: current, position: currentPosition } = viewRef.current;
    applyView({ scale: Math.min(MAX_ZOOM, Math.max(1, Number((current + amount).toFixed(2)))), position: currentPosition });
  }, [applyView]);

  // Independent of the fit, so a rotation does not reset the zoom; only a new photograph does.
  const reset = React.useCallback(() => {
    viewRef.current = { scale: 1, position: { x: 0, y: 0 } };
    swipeRef.current = null;
    swipeOffsetRef.current = 0;
    paint();
    setScale(1);
  }, [paint]);

  const closeInfo = () => {
    setInfoOpen(false);
    requestAnimationFrame(() => infoButtonRef.current?.focus());
  };

  useEffect(() => { closeButtonRef.current?.focus(); }, []);
  useEffect(() => () => requestAnimationFrame(() => {
    const fallback = document.querySelector(`[data-photo-slug="${latestPhotograph.current.slug}"] a`);
    (returnFocusRef?.current?.isConnected ? returnFocusRef.current : fallback)?.focus({ preventScroll: true });
  }), [returnFocusRef]);

  // Before the new photograph is painted: it opens at the fit, sized from its catalog dimensions.
  useLayoutEffect(() => {
    clearTimeout(settleTimerRef.current);
    stageRef.current?.classList.remove('is-settling');
    reset();
  }, [photograph.id, reset]);
  useEffect(() => () => clearTimeout(settleTimerRef.current), []);

  useEffect(() => {
    if (infoOpen) sheetCloseRef.current?.focus();
  }, [infoOpen]);

  useLayoutEffect(() => {
    measureFit();
    const image = imageRef.current;
    if (!image) return undefined;
    // The photograph fades in once decoded (CSS), so a switch never shows a half-drawn image.
    const shown = () => { image.dataset.loaded = 'true'; };
    if (image.complete) {
      shown();
      measureFit();
      return undefined;
    }
    const handleLoad = () => { shown(); measureFit(); };
    image.addEventListener('load', handleLoad);
    image.addEventListener('error', shown);
    return () => {
      image.removeEventListener('load', handleLoad);
      image.removeEventListener('error', shown);
    };
  }, [measureFit, photograph.id]);

  // Entering or leaving fullscreen changes the stage; native fullscreen also fires resize.
  useEffect(() => { measureFit(); }, [fullscreen.mode, measureFit]);

  useEffect(() => {
    // Rotation, resizing and mobile browser chrome showing or hiding. The backdrop is sized to the
    // visual viewport, the area actually on screen (iOS Safari's layout viewport can be taller).
    const backdrop = backdropRef.current;
    const viewport = window.visualViewport;
    const handleResize = () => {
      if (backdrop && viewport) {
        backdrop.style.setProperty('--photography-viewport-height', `${viewport.height}px`);
        backdrop.style.setProperty('--photography-viewport-top', `${viewport.offsetTop}px`);
      }
      measureFit();
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    viewport?.addEventListener('resize', handleResize);
    viewport?.addEventListener('scroll', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      viewport?.removeEventListener('resize', handleResize);
      viewport?.removeEventListener('scroll', handleResize);
    };
  }, [measureFit]);

  // A new fit (rotation, fullscreen) keeps the zoom and brings the pan back inside the bounds.
  useEffect(() => {
    viewRef.current = { ...viewRef.current, position: clampPosition(viewRef.current.position) };
    paint();
  }, [clampPosition, paint]);

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
        else if (fullscreen.active) fullscreen.exit();
        else onClose();
        return;
      }
      if (infoOpen) {
        trapTabKey(event, sheetRef.current);
        return;
      }
      if (!isEditableTarget(event.target) && (event.key === '+' || event.key === '=')) {
        event.preventDefault();
        zoom(.25);
      } else if (!isEditableTarget(event.target) && (event.key === '-' || event.key === '_')) {
        event.preventDefault();
        zoom(-.25);
      } else if (!isEditableTarget(event.target) && (event.key === 'f' || event.key === 'F') && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        fullscreen.toggle();
      } else if (!isEditableTarget(event.target) && event.key === '0') {
        event.preventDefault();
        reset();
      } else if (!isEditableTarget(event.target) && event.key === 'ArrowLeft' && previous) {
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
  }, [infoOpen, onClose, onNavigate, previous, next, reset, zoom, fullscreen]);

  // A stage point (from its centre) of a pointer.
  const stagePoint = (x, y) => {
    const rect = stageRef.current.getBoundingClientRect();
    return { x: x - rect.left - rect.width / 2, y: y - rect.top - rect.height / 2 };
  };
  const settle = () => {
    const stage = stageRef.current;
    stage?.classList.add('is-settling');
    clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => stage?.classList.remove('is-settling'), SWIPE_SETTLE_MS);
  };
  const cancelSwipe = () => {
    if (!swipeRef.current) return;
    swipeRef.current = null;
    if (swipeOffsetRef.current) {
      swipeOffsetRef.current = 0;
      settle();
      paint();
    }
  };
  // A released swipe slides out and changes photograph, or springs back.
  const endSwipe = (swipe, event) => {
    swipeRef.current = null;
    const dx = event.clientX - swipe.startX;
    const target = dx < 0 ? next : previous;
    const width = stageRef.current?.getBoundingClientRect().width || window.innerWidth;
    if (target && swipeCommits(dx, event.timeStamp - swipe.time, width)) {
      if (prefersReducedMotion()) {
        onNavigate(target);
        return;
      }
      swipeRef.current = { ...swipe, leaving: true };
      swipeOffsetRef.current = Math.sign(dx) * width;
      settle();
      paint();
      settleTimerRef.current = setTimeout(() => onNavigate(target), SWIPE_SETTLE_MS);
      return;
    }
    swipeOffsetRef.current = 0;
    settle();
    paint();
  };
  const startPinch = () => {
    const [a, b] = [...pointersRef.current.values()];
    dragRef.current = null;
    cancelSwipe();
    pinchRef.current = { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: stagePoint((a.x + b.x) / 2, (a.y + b.y) / 2), ...viewRef.current };
  };
  const onPointerDown = (event) => {
    if (event.button === 2 || swipeRef.current?.leaving) return;
    const { scale: currentScale, position: currentPosition } = viewRef.current;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, time: event.timeStamp });
    // Touches are followed even at 100%, so a second finger can pinch.
    if (event.pointerType === 'touch' || currentScale > 1) event.currentTarget.setPointerCapture?.(event.pointerId);
    // The image follows the fingers without easing while they are down.
    event.currentTarget.classList.add('is-gesturing');
    if (pointersRef.current.size === 2) startPinch();
    else if (pointersRef.current.size === 1 && currentScale > 1) dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: currentPosition };
    // At the fit one finger may swipe to the neighbouring photograph; zoomed, it only pans.
    else if (pointersRef.current.size === 1 && event.pointerType === 'touch') swipeRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, time: event.timeStamp, active: false };
  };
  const onPointerMove = (event) => {
    const pointer = pointersRef.current.get(event.pointerId);
    if (!pointer) return;
    Object.assign(pointer, { x: event.clientX, y: event.clientY });
    const pinch = pinchRef.current;
    if (pinch && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()];
      const mid = stagePoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      applyView(zoomAround(pinch, pinch.scale * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance), pinch.mid, mid), { commit: false });
      return;
    }
    const swipe = swipeRef.current;
    if (swipe && !swipe.leaving && swipe.pointerId === event.pointerId) {
      const dx = event.clientX - swipe.startX;
      const dy = event.clientY - swipe.startY;
      if (!swipe.active) {
        if (Math.abs(dx) >= SWIPE_START_PX && Math.abs(dx) > Math.abs(dy)) swipe.active = true;
        else if (Math.abs(dy) >= SWIPE_START_PX) swipeRef.current = null;
      }
      if (swipe.active) {
        // Past the first or last photograph the image only gives a little.
        swipeOffsetRef.current = (dx < 0 ? next : previous) ? dx : dx * SWIPE_EDGE_RESISTANCE;
        paint();
      }
      return;
    }
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId || viewRef.current.scale <= 1) return;
    viewRef.current = {
      ...viewRef.current,
      position: clampPosition({ x: current.origin.x + event.clientX - current.startX, y: current.origin.y + event.clientY - current.startY }),
    };
    paint();
  };
  const endDrag = (event) => {
    const pointer = pointersRef.current.get(event.pointerId);
    pointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!pointersRef.current.size) event.currentTarget.classList.remove('is-gesturing');
    const { scale: currentScale, position: currentPosition } = viewRef.current;
    const swipe = swipeRef.current;
    if (swipe && !swipe.leaving && swipe.pointerId === event.pointerId) {
      swipeRef.current = null;
      // A flick can end before any move is delivered.
      const dx = event.clientX - swipe.startX;
      if (Math.abs(dx) >= SWIPE_START_PX && Math.abs(dx) > Math.abs(event.clientY - swipe.startY)) swipe.active = true;
      if (swipe.active) {
        tapRef.current = null;
        if (event.type === 'pointerup') endSwipe(swipe, event);
        else {
          swipeRef.current = swipe;
          cancelSwipe();
        }
        return;
      }
    }
    if (pinchRef.current) {
      // Lifting one finger of a pinch continues as a pan with the other.
      pinchRef.current = null;
      tapRef.current = null;
      setScale(currentScale);
      const [rest] = [...pointersRef.current.entries()];
      dragRef.current = rest && currentScale > 1 ? { pointerId: rest[0], startX: rest[1].x, startY: rest[1].y, origin: currentPosition } : null;
      return;
    }
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    // A double tap (touch) zooms in at the tap, or back to the fit when zoomed.
    if (!pointer || event.pointerType !== 'touch' || event.type !== 'pointerup') return;
    if (Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > TAP_SLOP_PX) { tapRef.current = null; return; }
    const tap = { time: event.timeStamp, x: event.clientX, y: event.clientY };
    const last = tapRef.current;
    if (last && tap.time - last.time <= DOUBLE_TAP_MS && Math.hypot(tap.x - last.x, tap.y - last.y) <= TAP_SLOP_PX) {
      tapRef.current = null;
      tapZoomRef.current = tap.time;
      if (currentScale > 1) reset();
      else applyView(zoomAround(viewRef.current, 2.5, stagePoint(tap.x, tap.y)));
    } else {
      tapRef.current = tap;
    }
  };
  // A double tap already toggled the zoom: the browser's own dblclick after it is ignored.
  const onDoubleClick = (event) => {
    if (event.timeStamp - tapZoomRef.current < 600) return;
    if (viewRef.current.scale > 1) reset();
    else applyView(zoomAround(viewRef.current, 2, stagePoint(event.clientX, event.clientY)));
  };

  const announcement = `Photo ${index + 1} of ${collection.length}. ${photograph.caption}.`;

  return createPortal(
    <div ref={backdropRef} className={`photography-lightbox-backdrop${fullscreen.mode ? ` is-fullscreen is-fullscreen--${fullscreen.mode}` : ''}`}>
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
            <div className="photography-lightbox-zoom-controls" aria-label="Image zoom controls">
              <button type="button" onClick={() => zoom(-.25)} disabled={scale <= 1} aria-label="Zoom out"><FaMinus aria-hidden="true" /></button>
              <button className="photography-lightbox-scale" type="button" onClick={reset} aria-label="Reset zoom"><span ref={scaleLabelRef}>100%</span></button>
              <button type="button" onClick={() => zoom(.25)} disabled={scale >= 5} aria-label="Zoom in"><FaPlus aria-hidden="true" /></button>
            </div>
            <button className="photography-lightbox-fullscreen" type="button" onClick={fullscreen.toggle} aria-pressed={fullscreen.active} aria-label={fullscreen.active ? 'Exit fullscreen' : 'Enter fullscreen'} title={fullscreen.active ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}>
              {fullscreen.active ? <FaCompress aria-hidden="true" /> : <FaExpand aria-hidden="true" />}
            </button>
            <button className="photography-lightbox-info" ref={infoButtonRef} type="button" onClick={() => setInfoOpen(true)} aria-label="Show photograph information"><FaInfoCircle aria-hidden="true" /></button>
            <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close photograph"><FaTimes aria-hidden="true" /></button>
          </div>
        </div>

        <div className="photography-lightbox-layout">
          <div className="photography-lightbox-stage">
            <button type="button" onClick={() => previous && onNavigate(previous)} disabled={!previous} aria-label="Previous photograph"><FaChevronLeft aria-hidden="true" /></button>
            <div
              ref={stageRef}
              className={`photography-lightbox-image-wrap${scale > 1 ? ' is-zoomed' : ''}`}
              onWheel={(event) => {
                event.preventDefault();
                const step = -Math.max(-100, Math.min(100, event.deltaY)) * .0025;
                applyView(zoomAround(viewRef.current, viewRef.current.scale + step, stagePoint(event.clientX, event.clientY)));
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onDoubleClick={onDoubleClick}
            >
              <img ref={imageRef} key={photograph.id} src={photograph.viewerSrc} width={photograph.viewerWidth} height={photograph.viewerHeight} alt={photograph.alt} loading="eager" fetchPriority="high" decoding="async" style={{ width: `${fitSize.width}px`, height: `${fitSize.height}px` }} />
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
