// The open viewer's photograph comes first: neighbour prefetches of a photograph left are
// cancelled at once, the shown photograph's sharper file goes before further prefetches, and a
// file the browser finished without a load event is still reused. Gallery images are left alone.
import { act, fireEvent, render, screen } from '@testing-library/react';
import App from '../../App';
import { photographs, photographSources, sortPhotographs } from '../../data/photographs';
import { photographyHref } from '../../util/navigation';
import { holdPrefetches, isSourceLoaded, loadedPlaceholder, prefetchViewerSources, resetPhotographyPreloadsForTests, viewerRequestState } from './photographyLightbox';

const ordered = sortPhotographs(photographs);
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const absolute = (src) => new URL(src, document.baseURI).href;
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

// jsdom never loads images: an image counts as loaded or in flight as a test declares.
function setLoaded(image, loaded, currentSrc = image.getAttribute('src')) {
  Object.defineProperties(image, {
    complete: { value: loaded, configurable: true },
    naturalWidth: { value: loaded ? 900 : 0, configurable: true },
    currentSrc: { value: currentSrc ? absolute(currentSrc) : '', configurable: true },
  });
}

let created;
let decodeGate = null; // a pending decode, for a download still in progress
beforeEach(() => {
  decodeGate = null;
  resetPhotographyPreloadsForTests();
  window.history.replaceState({}, '', '/photography/');
  created = [];
  const NativeImage = window.Image;
  vi.spyOn(window, 'Image').mockImplementation(function MockImage() {
    const image = new NativeImage();
    image.decode = () => decodeGate ?? Promise.resolve();
    created.push(image);
    return image;
  });
});
afterEach(() => vi.restoreAllMocks());

test('opening the viewer during gallery downloads leaves them alone and closing keeps every frame', async () => {
  // Chromium and WebKit finish an <img> download even when its file is taken away, so the viewer
  // does not touch the page's images: they keep loading and stay usable as placeholders.
  render(<App />);
  await screen.findAllByRole('link', { name: /^Open photograph:/ });
  const frames = [...document.querySelectorAll('#photography-gallery img')];
  frames.forEach((image) => setLoaded(image, false));
  const originals = frames.map((image) => [image.getAttribute('src'), image.getAttribute('srcset')]);
  fireEvent.click(frames[1].closest('a'));
  await screen.findByRole('dialog');
  expect(frames.map((image) => [image.getAttribute('src'), image.getAttribute('srcset')])).toEqual(originals);
  await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(frames.map((image) => [image.getAttribute('src'), image.getAttribute('srcset')])).toEqual(originals);
});

test('moving to another photograph cancels the old neighbour prefetches at once', async () => {
  const start = ordered[4];
  window.history.replaceState({}, '', photographyHref(start.slug));
  render(<App />);
  await screen.findByRole('dialog', { name: new RegExp(escape(start.caption), 'i') });
  const image = document.querySelector('.photography-lightbox-image-wrap img[data-full]');
  await act(async () => { fireEvent.load(image); await settle(); });
  const [nextPrefetch, previousPrefetch] = created;
  expect(nextPrefetch.getAttribute('src')).toBeTruthy();
  expect(previousPrefetch.getAttribute('src')).toBeTruthy();
  await act(async () => { fireEvent.keyDown(document, { key: 'ArrowRight' }); });
  // The new photograph has not loaded yet: its file (the old "next" prefetch) keeps downloading,
  // the old "previous" one stops, and nothing new starts until the new photograph is shown.
  const current = document.querySelector('.photography-lightbox-image-wrap img[data-full]');
  expect(nextPrefetch.getAttribute('src')).toBe(current.getAttribute('src'));
  expect(previousPrefetch.getAttribute('src')).toBeNull();
  expect(created).toHaveLength(2);
  expect(viewerRequestState().inFlight).toEqual([current.getAttribute('src')]);
});

test('a file the browser finished without a load event serves as the placeholder', () => {
  const photograph = ordered[2];
  const [gallery, ...larger] = photographSources(photograph).map(({ src }) => src);
  const finished = new Set([absolute(gallery)]);
  vi.spyOn(performance, 'getEntriesByName').mockImplementation((url) => (finished.has(url) ? [{ responseEnd: 900, decodedBodySize: 120_000 }] : url === absolute(larger[0]) ? [{ responseEnd: 0, decodedBodySize: 0 }] : []));
  expect(loadedPlaceholder(photograph)).toBe(gallery);
  // An entry without a body (an abandoned request) does not count.
  expect(isSourceLoaded(larger[0])).toBe(false);
  expect(isSourceLoaded(gallery)).toBe(true);
});

test('a held queue starts nothing until released, then continues in order', () => {
  prefetchViewerSources(['/next.jpg', '/previous.jpg'], { concurrency: 1 });
  const release = holdPrefetches();
  created[0].onload();
  expect(created).toHaveLength(1);
  expect(viewerRequestState().held).toBe(true);
  release();
  release();
  expect(created.map((entry) => entry.getAttribute('src'))).toEqual(['/next.jpg', '/previous.jpg']);
  expect(viewerRequestState().held).toBe(false);
});

describe('on a 2× display', () => {
  let ratio;
  beforeEach(() => {
    ratio = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
  });
  afterEach(() => {
    if (ratio) Object.defineProperty(window, 'devicePixelRatio', ratio);
    else delete window.devicePixelRatio;
  });
  const wait = (ms) => act(() => new Promise((resolve) => { setTimeout(resolve, ms); }));
  const landscape = ordered.findIndex((photograph, index) => photograph.mediumSrc && index > 0 && index < ordered.length - 2);

  test('the sharper file downloads at high priority and holds the prefetches not yet started', async () => {
    const photograph = ordered[landscape];
    let arrive;
    window.history.replaceState({}, '', photographyHref(photograph.slug));
    render(<App />);
    await screen.findByRole('dialog', { name: new RegExp(escape(photograph.caption), 'i') });
    const image = document.querySelector('.photography-lightbox-image-wrap img[data-full]');
    // A pinch is in progress while the sharper file arrives.
    const stage = document.querySelector('.photography-lightbox-image-wrap');
    await act(async () => { fireEvent.load(image); await settle(); });
    fireEvent.pointerDown(stage, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100, buttons: 1 });
    fireEvent.pointerDown(stage, { pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 100, buttons: 1 });
    fireEvent.pointerMove(stage, { pointerId: 2, pointerType: 'touch', clientX: 260, clientY: 100, buttons: 1 });
    decodeGate = new Promise((resolve) => { arrive = resolve; });
    await wait(400);
    const upgrade = created.find((entry) => entry.getAttribute('src') === photograph.viewerSrc);
    expect(upgrade.fetchPriority).toBe('high');
    // While it downloads, a neighbour prefetch finishing does not start the next one.
    expect(viewerRequestState().held).toBe(true);
    const started = created.length;
    created.filter((entry) => entry !== upgrade).forEach((entry) => entry.onload?.());
    expect(created).toHaveLength(started);
    await act(async () => { arrive(); await settle(); });
    // No swap mid-pinch: the image keeps its file until both fingers lift.
    expect(image.getAttribute('src')).toBe(photograph.mediumSrc);
    fireEvent.pointerUp(stage, { pointerId: 2, pointerType: 'touch', clientX: 260, clientY: 100 });
    await wait(50);
    expect(image.getAttribute('src')).toBe(photograph.mediumSrc);
    fireEvent.pointerUp(stage, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 });
    await wait(200);
    expect(image.getAttribute('src')).toBe(photograph.viewerSrc);
    expect(viewerRequestState().held).toBe(false);
  });
});

// Renders the page and the viewer 30 times: ~4 s alone, longer when the suite runs in parallel.
test('thirty viewer sessions leave no listeners, prefetches or changed gallery images behind', { timeout: 20_000 }, async () => {
  const counts = new Map();
  const track = (target, name) => {
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    vi.spyOn(target, 'addEventListener').mockImplementation((type, ...rest) => { counts.set(`${name}:${type}`, (counts.get(`${name}:${type}`) ?? 0) + 1); return add(type, ...rest); });
    vi.spyOn(target, 'removeEventListener').mockImplementation((type, ...rest) => { counts.set(`${name}:${type}`, (counts.get(`${name}:${type}`) ?? 0) - 1); return remove(type, ...rest); });
  };
  render(<App />);
  await screen.findAllByRole('link', { name: /^Open photograph:/ });
  const frames = [...document.querySelectorAll('#photography-gallery img')];
  frames.forEach((image) => setLoaded(image, false));
  const before = frames.map((image) => image.getAttribute('srcset'));
  track(document, 'document');
  track(window, 'window');
  for (let session = 0; session < 30; session += 1) {
    fireEvent.click(document.querySelectorAll('#photography-gallery figure a')[session % 6]);
    await screen.findByRole('dialog');
    const image = document.querySelector('.photography-lightbox-image-wrap img[data-full]');
    await act(async () => { fireEvent.load(image); await settle(); });
    await act(async () => { fireEvent.keyDown(document, { key: 'ArrowRight' }); });
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(screen.queryByRole('dialog')).toBeNull();
  }
  expect(frames.map((image) => image.getAttribute('srcset'))).toEqual(before);
  expect(viewerRequestState()).toMatchObject({ queued: [], inFlight: [], kept: 0, held: false });
  // The set of files seen loaded holds URLs only and is bounded by the catalog.
  expect(viewerRequestState().known).toBeLessThanOrEqual(photographs.length * 3);
  const unbalanced = [...counts].filter(([key, count]) => /keydown|resize|orientationchange|scroll/.test(key) && count !== 0);
  expect(unbalanced).toEqual([]);
});
