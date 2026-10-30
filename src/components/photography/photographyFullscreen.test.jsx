import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import overlaysCss from '../../styles/overlays.css?raw';
import App from '../../App';
import { photographs, sortPhotographs } from '../../data/photographs';
import { photographyHref } from '../../util/navigation';
import { calculateFittedImageDimensions, resetPhotographyPreloadsForTests } from './photographyLightbox';

const ordered = sortPhotographs(photographs);

// A browser with the Fullscreen API: the element becomes document.fullscreenElement.
function installNativeFullscreen({ refuse = false } = {}) {
  let current = null;
  const change = () => document.dispatchEvent(new Event('fullscreenchange'));
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => true });
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => current });
  const request = vi.fn(function requestFullscreen() {
    if (refuse) return Promise.reject(new TypeError('Permissions check failed'));
    current = this;
    change();
    return Promise.resolve();
  });
  const exit = vi.fn(() => { current = null; change(); return Promise.resolve(); });
  Element.prototype.requestFullscreen = request;
  document.exitFullscreen = exit;
  // The user leaving with the browser's own Esc or gesture.
  const browserExit = () => { current = null; change(); };
  return { request, exit, browserExit };
}

function removeFullscreen() {
  delete document.fullscreenEnabled;
  delete document.fullscreenElement;
  delete Element.prototype.requestFullscreen;
  delete document.exitFullscreen;
}

async function openDirectly(photograph) {
  window.history.replaceState({}, '', photographyHref(photograph.slug));
  render(<App />);
  return screen.findByRole('dialog', { name: new RegExp(photograph.caption.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
}

const backdrop = () => document.querySelector('.photography-lightbox-backdrop');

beforeEach(() => {
  resetPhotographyPreloadsForTests();
  window.history.replaceState({}, '', '/photography/');
  document.documentElement.classList.remove('overlay-open', 'layout-changing');
  document.body.removeAttribute('style');
  if (!document.querySelector('link[rel="canonical"]')) {
    const canonical = document.createElement('link');
    canonical.rel = 'canonical';
    document.head.append(canonical);
  }
});

afterEach(() => {
  removeFullscreen();
  vi.restoreAllMocks();
});

test('a direct-linked photograph enters and leaves native fullscreen from a labelled button', async () => {
  const api = installNativeFullscreen();
  await openDirectly(ordered[1]);

  const button = screen.getByRole('button', { name: 'Enter fullscreen' });
  button.focus();
  await act(async () => { fireEvent.click(button); });

  expect(api.request).toHaveBeenCalledTimes(1);
  expect(document.fullscreenElement).toBe(backdrop());
  expect(backdrop()).toHaveClass('is-fullscreen', 'is-fullscreen--native');
  expect(button).toHaveAccessibleName('Exit fullscreen');
  expect(button).toHaveAttribute('aria-pressed', 'true');
  // Details stay reachable through the information sheet.
  expect(screen.getByRole('button', { name: 'Show photograph information' })).toBeInTheDocument();

  await act(async () => { fireEvent.click(button); });
  expect(api.exit).toHaveBeenCalledTimes(1);
  expect(backdrop()).not.toHaveClass('is-fullscreen');
  expect(button).toHaveAccessibleName('Enter fullscreen');
  expect(button).toHaveFocus();
});

test('leaving fullscreen with the browser (Esc, a gesture) clears the fullscreen view', async () => {
  const api = installNativeFullscreen();
  await openDirectly(ordered[0]);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' })); });

  act(() => api.browserExit());

  expect(backdrop()).not.toHaveClass('is-fullscreen');
  expect(screen.getByRole('button', { name: 'Enter fullscreen' })).toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: /Photography viewer/ })).toBeInTheDocument();
});

test('without the Fullscreen API the viewer uses the immersive view; Escape leaves it before closing', async () => {
  await openDirectly(ordered[0]);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' })); });

  expect(backdrop()).toHaveClass('is-fullscreen', 'is-fullscreen--immersive');

  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(backdrop()).not.toHaveClass('is-fullscreen'));
  expect(screen.getByRole('dialog', { name: /Photography viewer/ })).toBeInTheDocument();

  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: /Photography viewer/ })).not.toBeInTheDocument());
});

test('a refused fullscreen request falls back to the immersive view', async () => {
  const api = installNativeFullscreen({ refuse: true });
  await openDirectly(ordered[0]);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' })); });

  expect(api.request).toHaveBeenCalled();
  expect(backdrop()).toHaveClass('is-fullscreen--immersive');
});

test('arrow keys and the previous and next buttons keep working in fullscreen', async () => {
  installNativeFullscreen();
  await openDirectly(ordered[1]);
  await act(async () => { fireEvent.keyDown(document, { key: 'f' }); });
  expect(backdrop()).toHaveClass('is-fullscreen--native');

  fireEvent.keyDown(document, { key: 'ArrowRight' });
  expect(await screen.findByRole('dialog', { name: new RegExp(ordered[2].caption.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })).toBeInTheDocument();
  expect(window.location.hash).toBe(`#${ordered[2].slug}`);
  expect(backdrop()).toHaveClass('is-fullscreen--native');

  fireEvent.click(screen.getByRole('button', { name: 'Previous photograph' }));
  expect(window.location.hash).toBe(`#${ordered[1].slug}`);
  expect(document.fullscreenElement).toBe(backdrop());
});

test('closing the viewer while fullscreen leaves fullscreen and returns focus to the thumbnail', async () => {
  const api = installNativeFullscreen();
  render(<App />);
  const trigger = await screen.findByRole('link', { name: `Open photograph: ${ordered[0].caption}` });
  fireEvent.click(trigger);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' })); });

  fireEvent.click(screen.getByRole('button', { name: 'Close photograph' }));

  await waitFor(() => expect(trigger).toHaveFocus());
  expect(api.exit).toHaveBeenCalled();
  expect(document.fullscreenElement).toBeNull();
  expect(document.documentElement).not.toHaveClass('overlay-open');
});

test('the fitted size keeps the aspect ratio and never enlarges past the derivative', () => {
  // A 4K fullscreen stage, landscape and portrait derivatives.
  const landscape = calculateFittedImageDimensions(2200, 1467, 3840, 2160);
  expect(landscape).toEqual({ width: 2200, height: 1467, scale: 1 });
  const portrait = calculateFittedImageDimensions(1467, 2200, 1920, 1000);
  expect(portrait.height).toBe(1000);
  expect(portrait.width / portrait.height).toBeCloseTo(1467 / 2200, 6);
  const phone = calculateFittedImageDimensions(2200, 1467, 375, 600);
  expect(phone.width).toBe(375);
  expect(phone.width / phone.height).toBeCloseTo(2200 / 1467, 6);
});

test('fullscreen styles keep safe-area spacing and do not clip the page globally', () => {
  expect(overlaysCss).toMatch(/\.photography-lightbox \{[^}]*env\(safe-area-inset-top\)[^}]*env\(safe-area-inset-bottom\)/);
  expect(overlaysCss).toMatch(/\.is-fullscreen \.photography-lightbox-details \{ display: none; \}/);
  expect(overlaysCss).toMatch(/\.is-fullscreen \.photography-lightbox-info \{ display: grid !important; \}/);
  expect(overlaysCss).not.toMatch(/(^|\n)\s*(html|body)\s*\{[^}]*overflow:\s*hidden/);
});

// Regression: on phones the gesture surface was sized to the fitted photograph (overflow hidden),
// so in fullscreen a pinch only enlarged the photo inside that box. Real layout: check:photography:viewer.
test('in fullscreen a pinch zooms across the whole viewport, not only the fitted photograph box', async () => {
  await openDirectly(ordered[0]);
  // A 390 × 664 phone viewport.
  const fitted = calculateFittedImageDimensions(ordered[0].viewerWidth, ordered[0].viewerHeight, 390, 664);
  const stage = document.querySelector('.photography-lightbox-image-wrap');
  Object.defineProperty(stage, 'clientWidth', { configurable: true, get: () => 390 });
  Object.defineProperty(stage, 'clientHeight', { configurable: true, get: () => 664 });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' })); });
  // The gesture surface is never shrunk to the fitted photograph.
  expect(stage.style.width).toBe('');
  expect(stage.style.height).toBe('');
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 390, height: 664, right: 390, bottom: 664, x: 0, y: 0 });
  const image = stage.querySelector('img');
  Object.defineProperty(image, 'offsetWidth', { configurable: true, get: () => fitted.width });
  Object.defineProperty(image, 'offsetHeight', { configurable: true, get: () => fitted.height });
  const pointer = (type, id, x, y) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, button: 0 });
    act(() => { stage.dispatchEvent(event); });
  };
  // Pinch to 4× at the centre, then pan far down-right: the 4× photo is bounded by the viewport,
  // not by its fitted box.
  pointer('pointerdown', 1, 175, 332);
  pointer('pointerdown', 2, 215, 332);
  pointer('pointermove', 1, 115, 332);
  pointer('pointermove', 2, 275, 332);
  pointer('pointerup', 2, 275, 332);
  pointer('pointermove', 1, 5000, 5000);
  const max = { x: Math.max(0, (fitted.width * 4 - 390) / 2), y: Math.max(0, (fitted.height * 4 - 664) / 2) };
  expect(image.style.transform).toBe(`translate3d(${max.x}px, ${max.y}px, 0) scale(4)`);
  expect(screen.getByRole('button', { name: 'Reset zoom' })).toHaveTextContent('400%');
});

test('fullscreen fills the visual viewport and lets the photo use all of it', () => {
  expect(overlaysCss).toMatch(/\.photography-lightbox-backdrop \{[^}]*height: var\(--photography-viewport-height, 100dvh\)[^}]*touch-action: none/);
  expect(overlaysCss).toMatch(/\.is-fullscreen \.photography-lightbox-image-wrap \{ position: absolute; inset: 0;/);
  expect(overlaysCss).toMatch(/\.photography-lightbox-image-wrap \{[^}]*width: 100%; height: 100%;/);
});
