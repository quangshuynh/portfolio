// Image loading in the photography page and viewer: responsive file choice, hero priority,
// lazy archive frames, neighbour prefetch, cancellation and stale responses.
import { act, fireEvent, render, screen } from '@testing-library/react';
import App from '../../App';
import { photographs, photographSources, photographSrcSet, photographTiers, pickPhotographSource, sortPhotographs } from '../../data/photographs';
import { photographyHref } from '../../util/navigation';
import { loadedPlaceholder, prefetchViewerSources, resetPhotographyPreloadsForTests, viewerDevicePixels } from './photographyLightbox';

const ordered = sortPhotographs(photographs);
const withMedium = photographs.find(({ mediumSrc }) => mediumSrc);
const fixture = {
  gallerySrc: '/a-gallery.jpg', galleryWidth: 900,
  mediumSrc: '/a-medium.jpg', mediumWidth: 1600,
  viewerSrc: '/a-viewer.jpg', viewerWidth: 2200, viewerHeight: 1467,
};
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Image elements created by the viewer for prefetching.
let created;
beforeEach(() => {
  resetPhotographyPreloadsForTests();
  window.history.replaceState({}, '', '/photography/');
  created = [];
  const NativeImage = window.Image;
  vi.spyOn(window, 'Image').mockImplementation(function MockImage() {
    const image = new NativeImage();
    image.decode = () => Promise.resolve();
    created.push(image);
    return image;
  });
});
afterEach(() => vi.restoreAllMocks());

test('sources are ordered narrowest first and the choice is the narrowest wide enough', () => {
  expect(photographSources(fixture).map(({ width }) => width)).toEqual([900, 1600, 2200]);
  expect(photographSrcSet(fixture)).toBe('/a-gallery.jpg 900w, /a-medium.jpg 1600w, /a-viewer.jpg 2200w');
  expect(pickPhotographSource(fixture, 500)).toBe('/a-gallery.jpg');
  expect(pickPhotographSource(fixture, 901)).toBe('/a-medium.jpg');
  expect(pickPhotographSource(fixture, 1600)).toBe('/a-medium.jpg');
  expect(pickPhotographSource(fixture, 1700)).toBe('/a-viewer.jpg');
  // Never more than the largest file: no upscaled request.
  expect(pickPhotographSource(fixture, 9000)).toBe('/a-viewer.jpg');
  // Without a medium file (the CMS preview, portraits) only two files are offered.
  const { mediumSrc, mediumWidth, ...twoFiles } = fixture;
  expect(photographSrcSet(twoFiles)).toBe('/a-gallery.jpg 900w, /a-viewer.jpg 2200w');
  expect(pickPhotographSource(twoFiles, 1200)).toBe('/a-viewer.jpg');
});

test('landscape photographs get a medium derivative between gallery and viewer widths', () => {
  expect(withMedium).toBeTruthy();
  expect(withMedium.mediumWidth).toBeGreaterThan(withMedium.galleryWidth);
  expect(withMedium.mediumWidth).toBeLessThan(withMedium.viewerWidth);
  // Same aspect ratio as the viewer file, within rounding.
  expect(Math.abs(withMedium.mediumWidth / withMedium.mediumHeight - withMedium.viewerWidth / withMedium.viewerHeight)).toBeLessThan(0.01);
});

test('archive sizes cap the pixel density at 2×', async () => {
  const { archiveFrameSizes } = await import('../pages/photographyPage');
  const frame = { galleryWidth: 900, galleryHeight: 600 };
  expect(archiveFrameSizes(frame, 200, 1)).toBe('300px');
  expect(archiveFrameSizes(frame, 200, 2)).toBe('300px');
  // 3×: asks for 600 device pixels' worth (300 × 2), so the 900 px file is chosen, not 1600 px.
  expect(archiveFrameSizes(frame, 200, 3)).toBe('200px');
});

test('the hero loads first at high priority; featured and archive frames are lazy with exact archive sizes', async () => {
  render(<App />);
  await screen.findAllByRole('link', { name: /^View photograph:/ });
  const hero = document.querySelector('.photography-hero__media img');
  expect(hero.getAttribute('loading')).toBe('eager');
  expect(hero.getAttribute('fetchpriority')).toBe('high');
  expect(hero.getAttribute('sizes')).toBe('100vw');

  const featured = [...document.querySelectorAll('.featured-frame img')];
  expect(featured.length).toBeGreaterThan(0);
  featured.forEach((image) => expect(image.getAttribute('loading')).toBe('lazy'));

  const archive = [...document.querySelectorAll('#photography-gallery img')];
  expect(archive).toHaveLength(photographs.length);
  archive.forEach((image) => {
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(image.getAttribute('sizes')).toMatch(/^\d+px$/);
    expect(image.getAttribute('width')).toBeTruthy();
    expect(image.getAttribute('height')).toBeTruthy();
  });
  // Within a row every frame shares the row height, so sizes follow each frame's aspect ratio.
  const row = document.querySelector('.photography-row');
  const target = Number.parseFloat(row.style.getPropertyValue('--row-target'));
  [...row.querySelectorAll('img')].forEach((image) => {
    const aspect = Number(image.getAttribute('width')) / Number(image.getAttribute('height'));
    expect(Math.abs(Number.parseInt(image.getAttribute('sizes'), 10) - aspect * target)).toBeLessThanOrEqual(2);
  });
});

test('the viewer chooses a file for the fitted size and prefetches only its neighbours, after it has loaded', async () => {
  const photograph = ordered[1];
  window.history.replaceState({}, '', photographyHref(photograph.slug));
  render(<App />);
  await screen.findByRole('dialog', { name: new RegExp(escape(photograph.caption), 'i') });
  const image = document.querySelector('.photography-lightbox-image-wrap img[data-full]');
  const expected = pickPhotographSource(photograph, viewerDevicePixels(photograph, window.innerWidth, window.innerHeight));
  expect(image.getAttribute('src')).toBe(expected);
  // Nothing competes with the photograph while it downloads.
  expect(created).toHaveLength(0);

  await act(async () => { fireEvent.load(image); await Promise.resolve(); await Promise.resolve(); });
  expect(image.dataset.loaded).toBe('true');
  const prefetched = created.map((entry) => entry.getAttribute('src'));
  expect(prefetched).toHaveLength(2);
  expect(prefetched).toEqual(expect.arrayContaining([ordered[0], ordered[2]].map((adjacent) => pickPhotographSource(adjacent, viewerDevicePixels(adjacent, window.innerWidth, window.innerHeight)))));
  created.forEach((entry) => expect(entry.fetchPriority).toBe('low'));
});

test('obsolete prefetches are cancelled and the prefetch set stays bounded', () => {
  prefetchViewerSources(['/one.jpg', '/two.jpg']);
  const [one, two] = created;
  prefetchViewerSources(['/two.jpg', '/three.jpg']);
  expect(one.getAttribute('src')).toBeNull();
  expect(two.getAttribute('src')).toBe('/two.jpg');
  expect(created).toHaveLength(3);
  for (let i = 0; i < 10; i += 1) prefetchViewerSources([`/rapid-${i}.jpg`, `/rapid-${i + 1}.jpg`]);
  const live = created.filter((entry) => entry.getAttribute('src'));
  expect(live.length).toBeLessThanOrEqual(4);
  prefetchViewerSources([]);
  expect(created.filter((entry) => entry.getAttribute('src'))).toHaveLength(0);
});

test('rapid next/previous shows the last photograph, ignores stale loads and offers a loaded placeholder', async () => {
  const start = ordered[3];
  window.history.replaceState({}, '', photographyHref(start.slug));
  render(<App />);
  await screen.findByRole('dialog', { name: new RegExp(escape(start.caption), 'i') });
  const first = document.querySelector('.photography-lightbox-image-wrap img[data-full]');
  await act(async () => { fireEvent.load(first); await Promise.resolve(); await Promise.resolve(); });
  expect(loadedPlaceholder(start)).toBe(first.getAttribute('src'));

  const steps = 5;
  for (let i = 0; i < steps; i += 1) {
    await act(async () => { fireEvent.keyDown(document, { key: 'ArrowRight' }); });
  }
  const target = ordered[3 + steps];
  expect(decodeURIComponent(window.location.hash.slice(1))).toBe(target.slug);
  const current = document.querySelector('.photography-lightbox-image-wrap img[data-full]');
  expect([...photographSources(target).map(({ src }) => src)]).toContain(current.getAttribute('src'));
  expect(current.dataset.loaded).toBeUndefined();
  // A late load for a photograph already left does not mark the current one shown.
  await act(async () => { fireEvent.load(first); await Promise.resolve(); });
  expect(current.dataset.loaded).toBeUndefined();
  // One viewer image element for the current photograph (plus at most its placeholder).
  expect(document.querySelectorAll('.photography-lightbox-image-wrap img[data-full]')).toHaveLength(1);
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

  test('the 1600 px file shows first and the 2200 px file replaces it once decoded, if the visitor stays', async () => {
    const photograph = ordered[landscape];
    // The fitted width at 2× needs more than 1600 px, so the full-size file is the viewer file.
    expect(viewerDevicePixels(photograph, window.innerWidth, window.innerHeight)).toBeGreaterThan(1600);
    window.history.replaceState({}, '', photographyHref(photograph.slug));
    render(<App />);
    await screen.findByRole('dialog', { name: new RegExp(escape(photograph.caption), 'i') });
    const image = document.querySelector('.photography-lightbox-image-wrap img[data-full]');
    expect(image.getAttribute('src')).toBe(photograph.mediumSrc);
    expect(image.dataset.sharp).toBe('false');
    await act(async () => { fireEvent.load(image); await Promise.resolve(); await Promise.resolve(); });
    // Neighbours at the first size only (1600 px when they have it), on an unknown network.
    const prefetched = created.map((entry) => entry.getAttribute('src'));
    const pixels = (adjacent) => viewerDevicePixels(adjacent, window.innerWidth, window.innerHeight);
    expect(prefetched).toEqual([ordered[landscape + 1], ordered[landscape - 1]].map((adjacent) => photographTiers(adjacent, pixels(adjacent)).step));
    expect(created.some((entry) => entry.getAttribute('src') === photograph.viewerSrc)).toBe(false);
    await wait(400);
    expect(created.some((entry) => entry.getAttribute('src') === photograph.viewerSrc)).toBe(true);
    // Same element: no remount, no blank frame; the sharper file is swapped in.
    expect(document.querySelector('.photography-lightbox-image-wrap img[data-full]')).toBe(image);
    expect(image.getAttribute('src')).toBe(photograph.viewerSrc);
    expect(image.dataset.sharp).toBe('true');
    expect(image.dataset.loaded).toBe('true');
  });

  test('moving on before the dwell never requests the 2200 px file, and a late upgrade is ignored', async () => {
    const photograph = ordered[landscape];
    window.history.replaceState({}, '', photographyHref(photograph.slug));
    render(<App />);
    await screen.findByRole('dialog', { name: new RegExp(escape(photograph.caption), 'i') });
    const image = document.querySelector('.photography-lightbox-image-wrap img[data-full]');
    await act(async () => { fireEvent.load(image); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { fireEvent.keyDown(document, { key: 'ArrowRight' }); });
    await act(async () => { fireEvent.keyDown(document, { key: 'ArrowRight' }); });
    await wait(400);
    expect(created.some((entry) => entry.getAttribute('src') === photograph.viewerSrc)).toBe(false);
    const target = ordered[landscape + 2];
    const current = document.querySelector('.photography-lightbox-image-wrap img[data-full]');
    expect(photographSources(target).map(({ src }) => src)).toContain(current.getAttribute('src'));
    // Nothing of the photograph left behind is shown or still downloading.
    expect(created.filter((entry) => entry.getAttribute('src') === photograph.viewerSrc)).toHaveLength(0);
  });

  test('zooming loads the full-size file at once, without waiting for the dwell', async () => {
    const photograph = ordered[landscape];
    window.history.replaceState({}, '', photographyHref(photograph.slug));
    render(<App />);
    await screen.findByRole('dialog', { name: new RegExp(escape(photograph.caption), 'i') });
    const image = document.querySelector('.photography-lightbox-image-wrap img[data-full]');
    await act(async () => { fireEvent.load(image); await Promise.resolve(); await Promise.resolve(); });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    await wait(30);
    expect(image.getAttribute('src')).toBe(photograph.viewerSrc);
    expect(image.style.transform).toContain('scale(1.25)');
  });

  test('going back prefetches the previous photograph first', async () => {
    const photograph = ordered[landscape];
    window.history.replaceState({}, '', photographyHref(ordered[landscape + 1].slug));
    render(<App />);
    await screen.findByRole('dialog');
    await act(async () => { fireEvent.keyDown(document, { key: 'ArrowLeft' }); });
    await screen.findByRole('dialog', { name: new RegExp(escape(photograph.caption), 'i') });
    created.length = 0;
    const image = document.querySelector('.photography-lightbox-image-wrap img[data-full]');
    await act(async () => { fireEvent.load(image); await Promise.resolve(); await Promise.resolve(); });
    const sources = photographSources(ordered[landscape - 1]).map(({ src }) => src);
    expect(sources).toContain(created[0]?.getAttribute('src'));
  });
});
