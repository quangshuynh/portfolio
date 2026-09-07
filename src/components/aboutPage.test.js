import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AboutPage from './aboutPage';
import { formatRelativePlayTime, resetSpotifyCacheForTests, SpotifyListening } from './aboutGallery';

const originalFetch = global.fetch;

beforeEach(() => {
  resetSpotifyCacheForTests();
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

function renderAboutPage() {
  window.history.pushState({}, '', '/about');
  return render(<AboutPage />);
}

function photographyTrigger() {
  return within(screen.getByRole('heading', { name: 'Photography' }).closest('article'))
    .getByRole('button', { name: 'View more' });
}

function openSpotifyListening() {
  const musicCard = screen.getByRole('heading', { name: 'Music' }).closest('article');
  fireEvent.click(within(musicCard).getByRole('button', { name: 'View listening' }));
}

test('renders the updated biography and section headings', () => {
  renderAboutPage();
  expect(screen.getByText(/I’m a software developer and computer science student\. I was born in Vietnam and moved to the United States with my family when I was young\. Rochester has been home for most of my life\./)).toBeInTheDocument();
  expect(screen.getByText('My path into software')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'From coursework to production software' })).toBeInTheDocument();
  expect(screen.getByText('How I like to work')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'How I approach engineering' })).toBeInTheDocument();
  for (const value of ['Curiosity', 'Reliability', 'Usefulness']) {
    expect(screen.getByRole('heading', { name: value })).toBeInTheDocument();
  }
});

test('only interests with additional content render actions while every featured image opens directly', () => {
  renderAboutPage();
  const familyCard = screen.getByRole('heading', {
    name: 'Time with family & friends'
  }).closest('article');
  const hikingCard = screen.getByRole('heading', { name: 'Hiking' }).closest('article');
  expect(within(familyCard).queryByRole('button', { name: 'View more' })).not.toBeInTheDocument();
  expect(within(hikingCard).queryByRole('button', { name: 'View more' })).not.toBeInTheDocument();
  expect(within(familyCard).getByRole('button', { name: 'Open featured Time with family & friends image' })).toBeInTheDocument();
  expect(within(hikingCard).getByRole('button', { name: 'Open featured Hiking image' })).toBeInTheDocument();

  for (const title of ['Photography', 'Cars & technology', 'Gaming']) {
    const card = screen.getByRole('heading', { name: title }).closest('article');
    expect(within(card).getAllByRole('button')).toHaveLength(2);
    expect(within(card).getByRole('button', { name: 'View more' })).toBeInTheDocument();
  }
  const musicCard = screen.getByRole('heading', { name: 'Music' }).closest('article');
  expect(within(musicCard).getByRole('button', { name: 'View listening' })).toBeInTheDocument();
});

test.each([
  ['Photography', 'Photography'],
  ['Gaming', 'Gaming'],
  ['Hiking', 'Hiking']
])('clicking the %s featured image opens that image in the lightbox', (title, caption) => {
  renderAboutPage();
  const card = screen.getByRole('heading', { name: title }).closest('article');
  fireEvent.click(within(card).getByRole('button', { name: `Open featured ${title} image` }));
  expect(screen.getByRole('dialog', { name: `Image viewer: ${caption}` })).toBeInTheDocument();
});

test('formats recent play times and handles invalid timestamps', () => {
  const now = new Date('2026-09-07T16:00:00Z');
  expect(formatRelativePlayTime('2026-09-07T15:59:45Z', now)).toBe('Just now');
  expect(formatRelativePlayTime('2026-09-07T15:52:00Z', now)).toBe('8 minutes ago');
  expect(formatRelativePlayTime('2026-09-07T15:00:00Z', now)).toBe('1 hour ago');
  expect(formatRelativePlayTime('2026-09-06T15:00:00Z', now)).toBe('Yesterday');
  expect(formatRelativePlayTime('2026-09-04T16:00:00Z', now)).toBe('3 days ago');
  expect(formatRelativePlayTime(null, now)).toBeNull();
  expect(formatRelativePlayTime('not-a-date', now)).toBeNull();
});

test('KORE image opens the direct lightbox and Escape restores focus', async () => {
  document.body.style.overflow = 'scroll';
  renderAboutPage();
  const trigger = screen.getByRole('button', { name: 'Open KORE Wireless team lunch photo' });
  fireEvent.click(trigger);
  expect(document.body).toHaveStyle({ overflow: 'hidden' });
  expect(screen.getByRole('dialog', { name: /Image viewer: Team lunch/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(document.body).toHaveStyle({ overflow: 'scroll' });
});

test('About portrait still opens the personal gallery and restores focus', async () => {
  renderAboutPage();
  const trigger = screen.getByRole('button', { name: 'View more photos of Quang' });
  fireEvent.click(trigger);
  expect(screen.getByRole('dialog', { name: 'More about Quang' })).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(trigger).toHaveFocus());
});

test('gallery closes by button, Escape, and backdrop and restores its trigger', async () => {
  renderAboutPage();
  const trigger = photographyTrigger();

  fireEvent.click(trigger);
  expect(screen.getByRole('button', { name: 'Close photography gallery' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Close photography gallery' }));
  await waitFor(() => expect(trigger).toHaveFocus());

  fireEvent.click(trigger);
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(trigger).toHaveFocus());

  fireEvent.click(trigger);
  fireEvent.mouseDown(document.querySelector('.photography-modal-backdrop'));
  await waitFor(() => expect(trigger).toHaveFocus());
});

test('nested lightbox owns Escape, restores focus, and supports zoom shortcuts', async () => {
  document.body.style.overflow = 'auto';
  renderAboutPage();
  const trigger = photographyTrigger();
  fireEvent.click(trigger);
  expect(document.body).toHaveStyle({ overflow: 'hidden' });
  const imageTrigger = screen.getByRole('button', {
    name: /Open image: Looking up through Cornell/i
  });

  fireEvent.click(imageTrigger);
  const parentDialog = document.querySelector('.photography-modal');
  expect(parentDialog).toHaveAttribute('aria-hidden', 'true');
  expect(parentDialog).toHaveAttribute('inert');
  expect(document.body).toHaveStyle({ overflow: 'hidden' });
  expect(screen.getByRole('button', { name: 'Close image viewer' })).toHaveFocus();
  expect(screen.getByRole('dialog', { name: /Image viewer:/i })).toHaveAttribute(
    'aria-describedby'
  );

  fireEvent.keyDown(document, { key: '+' });
  expect(screen.getByRole('button', { name: 'Reset zoom' })).toHaveTextContent('125%');
  fireEvent.keyDown(document, { key: '0' });
  expect(screen.getByRole('button', { name: 'Reset zoom' })).toHaveTextContent('100%');

  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(imageTrigger).toHaveFocus());
  expect(screen.getByRole('dialog', { name: 'Photography by Quang' })).toBeInTheDocument();
  expect(document.body).toHaveStyle({ overflow: 'hidden' });

  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(document.body).toHaveStyle({ overflow: 'auto' });
});

test('gallery and lightbox trap Tab within the active dialog', () => {
  renderAboutPage();
  fireEvent.click(photographyTrigger());
  const galleryClose = screen.getByRole('button', { name: 'Close photography gallery' });
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
  expect(screen.getByRole('button', { name: 'View all' })).toHaveFocus();

  fireEvent.click(screen.getByRole('button', { name: /Open image: Looking up through Cornell/i }));
  const lightboxClose = screen.getByRole('button', { name: 'Close image viewer' });
  expect(lightboxClose).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Tab' });
  expect(screen.getByRole('button', { name: 'Reset zoom' })).toHaveFocus();
  expect(galleryClose).not.toHaveFocus();
});

test('Spotify stays lazy and shows its loading and failure states', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  renderAboutPage();

  expect(global.fetch).not.toHaveBeenCalled();
  openSpotifyListening();
  expect(screen.getByText('Loading recent listening...')).toBeInTheDocument();
  await screen.findByText('Couldn’t load my recent listening right now.');
  expect(global.fetch).toHaveBeenCalledWith(
    'https://spotify-portfolio-api.quangs.workers.dev/recent'
  );
  expect(screen.getByRole('link', { name: 'View my Spotify' })).toHaveAttribute(
    'href',
    'https://open.spotify.com/user/foahrtqqvuuvt7wscxub4uerd'
  );
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
});

test('Spotify retries a failed request successfully only after explicit action', async () => {
  global.fetch = jest.fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tracks: [{ id: 'recovered', name: 'Recovered song', artist: 'Artist', album: 'Album', url: 'https://open.spotify.com/track/recovered', playedAt: '2026-09-07T15:00:00Z' }] })
    });
  renderAboutPage();
  openSpotifyListening();
  const retry = await screen.findByRole('button', { name: 'Retry' });
  expect(global.fetch).toHaveBeenCalledTimes(1);

  fireEvent.click(retry);
  expect(screen.getByText('Loading recent listening...')).toBeInTheDocument();
  await screen.findByText('Recovered song');
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('Spotify renders valid play times semantically and omits invalid ones', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      tracks: [
        { id: 'valid', name: 'First song', artist: 'Artist', album: 'Album', url: 'https://open.spotify.com/track/valid', playedAt: new Date(Date.now() - 8 * 60 * 1000).toISOString() },
        { id: 'invalid', name: 'Second song', artist: 'Artist', album: 'Album', url: 'https://open.spotify.com/track/invalid', playedAt: 'invalid' }
      ]
    })
  });
  renderAboutPage();
  openSpotifyListening();
  await screen.findByText('First song');
  const time = screen.getByText('8 minutes ago');
  expect(time.tagName).toBe('TIME');
  expect(time).toHaveAttribute('dateTime');
  expect(time).toHaveAttribute('title');
  expect(screen.getByText('Second song').parentElement.querySelector('time')).not.toBeInTheDocument();
});

test('Spotify reuses a fresh cache and refreshes it after five minutes', async () => {
  let now = new Date('2026-09-07T16:00:00Z').getTime();
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ tracks: [{ id: 'first', name: 'Cached song', artist: 'Artist', album: 'Album', url: '#first', playedAt: '2026-09-07T15:00:00Z' }] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ tracks: [{ id: 'second', name: 'Fresh song', artist: 'Artist', album: 'Album', url: '#second', playedAt: '2026-09-07T15:30:00Z' }] }) });
  renderAboutPage();

  openSpotifyListening();
  await screen.findByText('Cached song');
  fireEvent.click(screen.getByRole('button', { name: 'Close music activity' }));

  now += 5 * 60 * 1000 - 1;
  openSpotifyListening();
  await screen.findByText('Cached song');
  expect(global.fetch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Close music activity' }));

  now += 1;
  openSpotifyListening();
  expect(screen.getByText('Loading recent listening...')).toBeInTheDocument();
  await screen.findByText('Fresh song');
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('Spotify deduplicates concurrent requests', async () => {
  let resolveFetch;
  global.fetch = jest.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));
  render(<><SpotifyListening /><SpotifyListening /></>);

  expect(global.fetch).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolveFetch({ ok: true, json: async () => ({ tracks: [{ id: 'shared', name: 'Shared song', artist: 'Artist', album: 'Album', url: '#shared', playedAt: '2026-09-07T15:00:00Z' }] }) });
  });
  expect(await screen.findAllByText('Shared song')).toHaveLength(2);
});

test('Spotify sorts newest valid plays first and leaves malformed timestamps after them', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ tracks: [
      { id: 'invalid', name: 'Malformed song', artist: 'Artist', album: 'Album', url: '#invalid', playedAt: 'not-a-date' },
      { id: 'older', name: 'Older song', artist: 'Artist', album: 'Album', url: '#older', playedAt: '2026-09-07T14:00:00Z' },
      { id: 'missing', name: 'Missing date song', artist: 'Artist', album: 'Album', url: '#missing' },
      { id: 'newest', name: 'Newest song', artist: 'Artist', album: 'Album', url: '#newest', playedAt: '2026-09-07T15:00:00Z' }
    ] })
  });
  renderAboutPage();
  openSpotifyListening();
  await screen.findByText('Newest song');

  const renderedTracks = [...document.querySelectorAll('.spotify-track')];
  expect(renderedTracks.map((track) => track.querySelector('strong').textContent)).toEqual([
    'Newest song', 'Older song', 'Malformed song', 'Missing date song'
  ]);
  expect(renderedTracks[0]).toHaveTextContent('Newest song');
  expect(renderedTracks[0]).toHaveClass('spotify-track-latest');
  expect(renderedTracks.slice(1).every((track) => !track.classList.contains('spotify-track-latest'))).toBe(true);
  expect(screen.getByText('Malformed song').parentElement.querySelector('time')).not.toBeInTheDocument();
  expect(screen.getByText('Missing date song').parentElement.querySelector('time')).not.toBeInTheDocument();
});
