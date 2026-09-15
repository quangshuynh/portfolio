import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../../App';
import { photographs, sortPhotographs } from '../../data/photographs';
import { getAppPathname, photographyHref } from '../../util/navigation';
import { calculateFittedImageDimensions, PhotographyDetails, resetPhotographyPreloadsForTests } from '../photography/photographyLightbox';
import { distributePhotographs, getPhotographyColumnCount } from './photographyPage';

const curatedSlugs = [
  '_DSC0023',
  'DIBS2164',
  'EJUT5331',
  'YJMZ4301',
  'IMG_0758',
  'IMGP0739',
  'IMG_0931',
  '_DSC0003',
  '_DSC0033',
  'IMGP0579',
  'IMG_0776',
  'NTIO3912',
  'PBTM8581',
  'IMG_0845',
  'TERM5977',
  'IMG_0858',
  'IMG_0811',
  'IMG_0846',
];

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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('renders every curated photograph exactly once with its caption and target', async () => {
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Photography' })).toBeInTheDocument();
  const renderedItems = [...document.querySelectorAll('[data-photo-slug]')];
  expect(document.getElementById('photography-gallery')).toHaveClass('photography-page-grid');
  expect(document.getElementById('photography-modal-gallery')).not.toBeInTheDocument();
  expect(renderedItems).toHaveLength(18);
  expect(renderedItems.map((item) => item.dataset.photoSlug).sort()).toEqual([...curatedSlugs].sort());
  renderedItems.forEach((item) => {
    const photograph = photographs.find(({ slug }) => slug === item.dataset.photoSlug);
    expect(item.querySelector('figcaption')).toHaveTextContent(photograph.caption);
    expect(item.querySelector('a')).toHaveAttribute('href', photographyHref(photograph.slug));
  });
  expect(screen.getAllByText('My 2011 Subaru WRX after dark')).toHaveLength(1);
  expect(document.querySelector('[data-photo-slug="IMG_0846"]')).toHaveTextContent('My 2011 Subaru WRX after dark');
  expect(document.querySelector('[data-photo-slug="_DSC0023"]')).toHaveTextContent("Looking up through Cornell's brick architecture");
  expect(screen.getByLabelText('Order')).toHaveValue('default');
  expect(document.title).toBe('Photography | Quang Huynh');
  expect(photographs.every(({ id, slug }) => id === slug)).toBe(true);
  expect(photographs.every(({ sourceFilename }) => sourceFilename !== null)).toBe(true);
  expect(photographs.find(({ id }) => id === 'IMGP0739').curatedOrder).toBe(6);
  expect(photographs.find(({ id }) => id === 'IMG_0858').curatedOrder).toBe(16);
  expect(document.querySelector('[data-photo-slug="_DSC0023"] img'))
    .toHaveAttribute('src', photographs[0].gallerySrc);
  expect(screen.getByRole('heading', { name: 'Featured' })).toBeInTheDocument();

  const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
  expect(within(nav).getByRole('link', { name: /quanghuynh.com photography/i })).toHaveAttribute('href', '/photography/');
  expect(nav).toHaveTextContent('quanghuynh.com/photography');
  expect(nav.querySelector('.brand-cat img')).toBeInTheDocument();
  expect(nav.querySelector('.photography-brand-camera')).toHaveAttribute('aria-hidden', 'true');
  expect(within(nav).getByRole('link', { name: 'Portfolio' })).toHaveAttribute('href', '/');
  expect(within(nav).getByRole('link', { name: 'About' })).toHaveAttribute('href', '/about');
  expect(within(nav).queryByRole('link', { name: 'Projects' })).not.toBeInTheDocument();
  expect(within(nav).queryByRole('link', { name: 'Contact' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'More about me' })).not.toBeInTheDocument();
});

test('accepts the photography gallery pathname without a trailing slash', async () => {
  window.history.replaceState({}, '', '/photography');
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Photography' })).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('keeps photography navigation and theming isolated from the homepage', async () => {
  window.history.replaceState({}, '', '/');
  render(<App />);
  const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
  expect(document.querySelector('.photography-page')).not.toBeInTheDocument();
  expect(nav).not.toHaveClass('photography-nav');
  expect(nav.querySelector('.photography-brand-camera')).not.toBeInTheDocument();
  expect(within(nav).getByRole('link', { name: 'Experience' })).toBeInTheDocument();
  expect(within(nav).getByRole('link', { name: 'Projects' })).toBeInTheDocument();
  expect(within(nav).getByRole('link', { name: 'Contact' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Switch to .* mode/ })).not.toHaveClass('theme-toggle--photography');
});

test('same-path generic lightbox cleanup still restores its locked scroll position', async () => {
  let simulatedScrollY = 420;
  vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => simulatedScrollY);
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation((first, second) => {
    simulatedScrollY = typeof first === 'object' ? first.top : second;
  });
  window.history.replaceState({}, '', '/');
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Open image: 585Dashcam585 storefront' }));

  simulatedScrollY = 0;
  fireEvent.keyDown(document, { key: 'Escape' });

  await waitFor(() => expect(simulatedScrollY).toBe(420));
  expect(scrollTo).toHaveBeenCalledWith({ top: 420, left: 0, behavior: 'auto' });
});

test('reacts to native hash changes without treating the hash as an anchor target', async () => {
  render(<App />);
  act(() => { window.location.hash = 'IMGP0579'; });
  expect(await screen.findByRole('dialog', { name: /Looking up through the trees at Bristol Mountain/i })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/photography/');
});

test('date sorting is deterministic, puts missing dates last, and does not mutate input', () => {
  const input = [
    { id: 'missing-two', capturedAt: null, curatedOrder: 4 },
    { id: 'newer', capturedAt: '2025-05-01T12:00:00Z', curatedOrder: 2 },
    { id: 'missing-one', capturedAt: null, curatedOrder: 3 },
    { id: 'older', capturedAt: '2024-05-01T12:00:00Z', curatedOrder: 1 },
  ];
  const originalOrder = input.map(({ id }) => id);

  expect(sortPhotographs(input, 'newest').map(({ id }) => id))
    .toEqual(['newer', 'older', 'missing-one', 'missing-two']);
  expect(sortPhotographs(input, 'oldest').map(({ id }) => id))
    .toEqual(['older', 'newer', 'missing-one', 'missing-two']);
  expect(input.map(({ id }) => id)).toEqual(originalOrder);
  expect(sortPhotographs(photographs, 'newest').map(({ slug }) => slug)).toEqual([
    'IMG_0931', 'IMG_0858', 'IMG_0846', 'IMG_0845', 'IMG_0811', 'IMG_0776',
    'IMG_0758', 'IMGP0739', 'IMGP0579', '_DSC0003', '_DSC0033', 'DIBS2164',
    'NTIO3912', 'TERM5977', '_DSC0023', 'EJUT5331', 'YJMZ4301', 'PBTM8581',
  ]);
});

test('uses deterministic responsive masonry column counts and fit geometry from the stage', () => {
  expect(getPhotographyColumnCount(1600)).toBe(3);
  expect(getPhotographyColumnCount(1200)).toBe(3);
  expect(getPhotographyColumnCount(821)).toBe(3);
  expect(getPhotographyColumnCount(820)).toBe(2);
  expect(getPhotographyColumnCount(800)).toBe(2);
  expect(getPhotographyColumnCount(420)).toBe(2);

  const portraitFit = calculateFittedImageDimensions(1200, 1600, 720, 820);
  expect(portraitFit.width).toBeCloseTo(615, 5);
  expect(portraitFit.height).toBeCloseTo(820, 5);

  const landscapeFit = calculateFittedImageDimensions(1600, 900, 1080, 760);
  expect(landscapeFit.width).toBeCloseTo(1080, 5);
  expect(landscapeFit.height).toBeCloseTo(607.5, 5);
});

test('opens a photo hash, navigates between photos, and closes to the collection', async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole('link', { name: /Open photograph: Looking up through Cornell/i }));
  expect(window.location.pathname).toBe('/photography/');
  expect(window.location.hash).toBe('#_DSC0023');
  expect(screen.getByRole('dialog', { name: /Looking up through Cornell/i })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Next photograph' }));
  expect(window.location.pathname).toBe('/photography/');
  expect(window.location.hash).toBe('#DIBS2164');
  expect(screen.getByRole('dialog', { name: /A quiet moment on the grass/i })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Close photograph' }));
  expect(window.location.pathname).toBe('/photography/');
  expect(window.location.hash).toBe('');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('focus enters the viewer, the page is inert, and normal close restores its thumbnail', async () => {
  render(<App />);
  const trigger = await screen.findByRole('link', { name: /Open photograph: Looking up through Cornell/i });
  fireEvent.click(trigger);
  expect(screen.getByRole('button', { name: 'Close photograph' })).toHaveFocus();
  expect(document.querySelector('.photography-page')).toHaveAttribute('inert');
  expect(document.documentElement).toHaveClass('overlay-open');

  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(window.location.hash).toBe('');
  expect(document.querySelector('.photography-page')).not.toHaveAttribute('inert');
  await waitFor(() => expect(document.documentElement).not.toHaveClass('overlay-open'));
});

test('direct-hash close safely focuses the matching thumbnail', async () => {
  window.history.replaceState({}, '', '/photography/#IMGP0739');
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Close photograph' }));
  const fallback = document.querySelector('[data-photo-slug="IMGP0739"] a');
  await waitFor(() => expect(fallback).toHaveFocus());
});

test('arrow navigation is non-wrapping at the first and last photographs', async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole('link', { name: /Open photograph: Looking up through Cornell/i }));
  expect(screen.getByRole('button', { name: 'Previous photograph' })).toBeDisabled();
  fireEvent.keyDown(document, { key: 'ArrowLeft' });
  expect(window.location.hash).toBe('#_DSC0023');
  fireEvent.keyDown(document, { key: 'ArrowRight' });
  expect(window.location.hash).toBe('#DIBS2164');

  act(() => window.history.replaceState({}, '', '/photography/#IMG_0846'));
  act(() => window.dispatchEvent(new Event('portfolio:locationchange')));
  expect(screen.getByRole('button', { name: 'Next photograph' })).toBeDisabled();
  fireEvent.keyDown(document, { key: 'ArrowRight' });
  expect(window.location.hash).toBe('#IMG_0846');
  fireEvent.keyDown(document, { key: 'ArrowLeft' });
  expect(window.location.hash).toBe('#IMG_0811');
});

test('mobile information opens as a nested dialog and Escape dismisses it first', async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole('link', { name: /Open photograph: Looking up through Cornell/i }));
  const info = document.querySelector('.photography-lightbox-info');
  expect(info).toHaveAttribute('aria-label', 'Show photograph information');
  fireEvent.click(info);
  expect(screen.getByRole('dialog', { name: 'Photograph information' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Close photograph information' })).toHaveFocus();

  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(info).toHaveFocus());
  expect(screen.queryByRole('dialog', { name: 'Photograph information' })).not.toBeInTheDocument();
  expect(window.location.hash).toBe('#_DSC0023');

  fireEvent.click(info);
  fireEvent.click(screen.getByRole('button', { name: 'Close photograph information' }));
  await waitFor(() => expect(info).toHaveFocus());

  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(window.location.hash).toBe(''));
});

test('metadata renders only populated public fields without placeholders', () => {
  render(<PhotographyDetails photograph={{
    id: '2C6A1754',
    caption: 'Evening light',
    capturedAt: '2026-04-13T14:47:00Z',
    camera: 'Canon EOS R6 Mark II',
    focalLength: 70,
    aperture: 2.8,
    shutterSpeed: 0.004,
    iso: 100,
    location: 'Ithaca, New York',
  }} />);
  expect(screen.getByText('#2C6A1754')).toBeInTheDocument();
  expect(screen.getByText('Canon EOS R6 Mark II')).toBeInTheDocument();
  expect(screen.getByText('70 mm')).toBeInTheDocument();
  expect(screen.getByText('f/2.8')).toBeInTheDocument();
  expect(screen.getByText('1/250 s')).toBeInTheDocument();
  expect(screen.getByText(/April 13, 2026 · 10:47 AM/)).toBeInTheDocument();
  expect(screen.getByText('Ithaca, New York')).toBeInTheDocument();
  expect(screen.queryByText('Lens')).not.toBeInTheDocument();
  expect(screen.queryByText(/Unknown/i)).not.toBeInTheDocument();
});

test('announces photo changes and preloads only adjacent images', async () => {
  const loaded = [];
  const orderedPhotographs = sortPhotographs(photographs);
  const ithacaIndex = orderedPhotographs.findIndex(({ id }) => id === 'IMGP0739');
  const previousPhotograph = orderedPhotographs[ithacaIndex - 1];
  const ithacaPhotograph = orderedPhotographs[ithacaIndex];
  const nextPhotograph = orderedPhotographs[ithacaIndex + 1];
  const followingPhotograph = orderedPhotographs[ithacaIndex + 2];
  vi.stubGlobal('Image', class { set src(value) { loaded.push(value); } });
  window.history.replaceState({}, '', '/photography/#IMGP0739');
  render(<App />);
  expect(await screen.findByText('Photo 6 of 18. Ithaca Falls in the summer.')).toBeInTheDocument();
  expect(loaded).toEqual([previousPhotograph.viewerSrc, nextPhotograph.viewerSrc]);
  expect(document.querySelector('.photography-lightbox img')).toHaveAttribute('src', ithacaPhotograph.viewerSrc);

  fireEvent.click(screen.getByRole('button', { name: 'Next photograph' }));
  expect(screen.getByText(`Photo 7 of 18. ${nextPhotograph.caption}.`)).toBeInTheDocument();
  expect(loaded).toEqual([previousPhotograph.viewerSrc, nextPhotograph.viewerSrc, followingPhotograph.viewerSrc]);
});

test('packs sorted photographs deterministically without duplicates or mutation', () => {
  for (const order of ['default', 'newest', 'oldest']) {
    const sorted = sortPhotographs(photographs, order);
    const before = sorted.map(({ id }) => id);
    const first = distributePhotographs(sorted, 3);
    const second = distributePhotographs(sorted, 3);
    expect(first).toEqual(second);
    expect(first.flat().map(({ id }) => id).sort()).toEqual([...before].sort());
    expect(new Set(first.flat().map(({ id }) => id)).size).toBe(18);
    expect(sorted.map(({ id }) => id)).toEqual(before);
  }
});

test('resolves direct photo hashes and rejects invalid hashes', async () => {
  window.history.replaceState({}, '', '/photography/#IMGP0739');
  const view = render(<App />);
  expect(await screen.findByRole('dialog', { name: /Ithaca Falls in the summer/i })).toBeInTheDocument();
  expect(document.querySelector('link[rel="canonical"]'))
    .toHaveAttribute('href', 'https://quanghuynh.com/photography/');

  view.unmount();
  window.history.replaceState({}, '', '/photography/#not-a-real-photo');
  render(<App />);
  expect(await screen.findByText(/could not be found/i)).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('keeps the waterfall photographs on their stable hashes', async () => {
  window.history.replaceState({}, '', '/photography/#IMG_0858');
  const view = render(<App />);
  expect(await screen.findByRole('dialog', { name: /Mist and skyline at Niagara Falls/i })).toBeInTheDocument();

  view.unmount();
  window.history.replaceState({}, '', '/photography/#IMGP0739');
  render(<App />);
  expect(await screen.findByRole('dialog', { name: /Ithaca Falls in the summer/i })).toBeInTheDocument();
});

test('Back and Forward open, change, and close photograph state', async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole('link', { name: /Open photograph: Looking up through Cornell/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Next photograph' }));

  await act(async () => { window.history.back(); });
  await waitFor(() => expect(window.location.hash).toBe('#_DSC0023'));
  expect(screen.getByRole('dialog', { name: /Looking up through Cornell/i })).toBeInTheDocument();

  await act(async () => { window.history.back(); });
  await waitFor(() => expect(window.location.hash).toBe(''));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

  await act(async () => { window.history.forward(); });
  await waitFor(() => expect(window.location.hash).toBe('#_DSC0023'));
  expect(screen.getByRole('dialog', { name: /Looking up through Cornell/i })).toBeInTheDocument();

  await act(async () => { window.history.forward(); });
  await waitFor(() => expect(window.location.hash).toBe('#DIBS2164'));
  expect(screen.getByRole('dialog', { name: /A quiet moment on the grass/i })).toBeInTheDocument();
});

test('does not treat obsolete pathname IDs as photo routes', async () => {
  window.history.replaceState({}, '', '/photography/IMGP0739');
  render(<App />);
  expect(await screen.findByRole('heading', { name: /I build reliable backend systems/i })).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('builds photography hashes for root and GitHub Pages base paths', () => {
  expect(photographyHref('IMGP0579', '/')).toBe('/photography/#IMGP0579');
  expect(photographyHref('_DSC0023', '/portfolio/')).toBe('/portfolio/photography/#_DSC0023');
  expect(photographyHref(undefined, '/portfolio/')).toBe('/portfolio/photography/');
  expect(getAppPathname('/portfolio/photography/', '/portfolio/')).toBe('/photography');
});

test('the About photography modal hands off cleanly to the photography route', async () => {
  let simulatedScrollY = 640;
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation((first, second) => {
    simulatedScrollY = typeof first === 'object' ? first.top : second;
  });
  vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => simulatedScrollY);
  window.history.replaceState({}, '', '/about');
  render(<App />);
  const photographyHeading = await screen.findByRole('heading', { name: 'Photography' });
  fireEvent.click(photographyHeading.closest('article').querySelector('.interest-view-more'));
  expect(screen.getByRole('dialog', { name: 'Photography by Quang' })).toBeInTheDocument();
  expect(document.getElementById('photography-modal-gallery')).toBeInTheDocument();
  expect(document.querySelectorAll('#photography-gallery')).toHaveLength(0);

  fireEvent.click(screen.getByRole('link', { name: 'View all' }));
  expect(await screen.findByRole('heading', { name: 'Featured' })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/photography/');
  expect(window.location.hash).toBe('');
  expect(screen.queryByRole('dialog', { name: 'Photography by Quang' })).not.toBeInTheDocument();
  await waitFor(() => expect(document.documentElement).not.toHaveClass('overlay-open'));
  expect(document.body.style.overflow).toBe('');
  expect(scrollTo).toHaveBeenCalledWith(0, 0);
  expect(simulatedScrollY).toBe(0);

  const backLink = screen.getByRole('link', { name: 'Back to photography modal' });
  expect(backLink).toHaveAttribute('href', '/about');
  fireEvent.click(backLink);
  expect(await screen.findByRole('dialog', { name: 'Photography by Quang' })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/about');
  expect(window.location.hash).toBe('');
  expect(document.getElementById('photography-modal-gallery')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: 'View all' }));
  expect(await screen.findByRole('heading', { name: 'Featured' })).toBeInTheDocument();

  scrollTo.mockClear();
  fireEvent.change(screen.getByLabelText('Order'), { target: { value: 'newest' } });
  fireEvent.click(screen.getByRole('link', { name: /Open photograph: Pink skies over Rochester/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Next photograph' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close photograph' }));
  expect(scrollTo).not.toHaveBeenCalled();
});
