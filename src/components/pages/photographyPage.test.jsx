import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../../App';
import { photographs, sortPhotographs } from '../../data/photographs';

const curatedSlugs = [
  'cornell-architecture-spire',
  'cornell-bird-on-lawn',
  'rush-rhees-reading-room',
  'blue-cactus-rochester',
  'genesee-red-bridge',
  'ithaca-falls',
  'rochester-pink-sunset',
  'rochester-skyline-at-night',
  'train-tracks-around-the-bend',
  'bristol-mountain-forest-canopy',
  'last-light-over-the-water',
  'cornell-woodland-stream',
  'rush-rhees-in-winter',
  'irondequoit-bay-sunset',
  'cornell-hilltop-stone-architecture',
  'niagara-mist-and-skyline',
  'rochester-lower-falls',
  'subaru-wrx-after-dark',
];

beforeEach(() => {
  window.history.replaceState({}, '', '/photography');
  document.documentElement.classList.remove('overlay-open', 'layout-changing');
  document.body.removeAttribute('style');
});

test('renders the photography page in the exact curated order', async () => {
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Photography' })).toBeInTheDocument();
  expect([...document.querySelectorAll('[data-photo-slug]')].map((item) => item.dataset.photoSlug))
    .toEqual(curatedSlugs);
  expect(screen.getByLabelText('Order')).toHaveValue('default');
  expect(document.title).toBe('Photography | Quang Huynh');
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
  expect(sortPhotographs(photographs, 'newest').map(({ slug }) => slug)).toEqual(curatedSlugs);
});

test('opens a photo URL, navigates between photos, and closes to the collection', async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole('link', { name: /Open photograph: Looking up through Cornell/i }));
  expect(window.location.pathname).toBe('/photography/cornell-architecture-spire');
  expect(screen.getByRole('dialog', { name: /Looking up through Cornell/i })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Next photograph' }));
  expect(window.location.pathname).toBe('/photography/cornell-bird-on-lawn');
  expect(screen.getByRole('dialog', { name: /A quiet moment on the grass/i })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Close photograph' }));
  expect(window.location.pathname).toBe('/photography');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('resolves direct photo URLs and rejects invalid slugs', async () => {
  window.history.replaceState({}, '', '/photography/ithaca-falls');
  const view = render(<App />);
  expect(await screen.findByRole('dialog', { name: /Ithaca Falls in the summer/i })).toBeInTheDocument();

  view.unmount();
  window.history.replaceState({}, '', '/photography/not-a-real-photo');
  render(<App />);
  expect(await screen.findByText(/could not be found/i)).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('Back and Forward update the selected photograph', async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole('link', { name: /Open photograph: Looking up through Cornell/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Next photograph' }));

  await act(async () => { window.history.back(); });
  await waitFor(() => expect(window.location.pathname).toBe('/photography/cornell-architecture-spire'));
  expect(screen.getByRole('dialog', { name: /Looking up through Cornell/i })).toBeInTheDocument();

  await act(async () => { window.history.forward(); });
  await waitFor(() => expect(window.location.pathname).toBe('/photography/cornell-bird-on-lawn'));
  expect(screen.getByRole('dialog', { name: /A quiet moment on the grass/i })).toBeInTheDocument();
});

test('the About photography modal hands off cleanly to the photography route', async () => {
  window.history.replaceState({}, '', '/about');
  render(<App />);
  const photographyHeading = await screen.findByRole('heading', { name: 'Photography' });
  fireEvent.click(photographyHeading.closest('article').querySelector('.interest-view-more'));
  expect(screen.getByRole('dialog', { name: 'Photography by Quang' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('link', { name: 'View all' }));
  expect(await screen.findByRole('heading', { name: 'Selected photographs' })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/photography');
  expect(screen.queryByRole('dialog', { name: 'Photography by Quang' })).not.toBeInTheDocument();
  await waitFor(() => expect(document.documentElement).not.toHaveClass('overlay-open'));
  expect(document.body.style.overflow).toBe('');
});
