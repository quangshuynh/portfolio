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
