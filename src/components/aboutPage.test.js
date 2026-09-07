import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AboutPage from './aboutPage';
import { formatRelativePlayTime } from './aboutGallery';

function renderAboutPage() {
  window.history.pushState({}, '', '/about');
  return render(<AboutPage />);
}

function photographyTrigger() {
  return within(screen.getByRole('heading', { name: 'Photography' }).closest('article'))
    .getByRole('button', { name: 'View more' });
}

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
  const originalFetch = global.fetch;
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  renderAboutPage();

  expect(global.fetch).not.toHaveBeenCalled();
  const musicCard = screen.getByRole('heading', { name: 'Music' }).closest('article');
  fireEvent.click(within(musicCard).getByRole('button', { name: 'View listening' }));
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
  global.fetch = originalFetch;
});

test('Spotify retries a failed request only after explicit action', async () => {
  const originalFetch = global.fetch;
  global.fetch = jest.fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockRejectedValueOnce(new Error('still offline'));
  renderAboutPage();
  const musicCard = screen.getByRole('heading', { name: 'Music' }).closest('article');
  fireEvent.click(within(musicCard).getByRole('button', { name: 'View listening' }));
  const retry = await screen.findByRole('button', { name: 'Retry' });
  expect(global.fetch).toHaveBeenCalledTimes(1);

  fireEvent.click(retry);
  expect(screen.getByText('Loading recent listening...')).toBeInTheDocument();
  await screen.findByRole('button', { name: 'Retry' });
  expect(global.fetch).toHaveBeenCalledTimes(2);
  global.fetch = originalFetch;
});

test('Spotify renders valid play times semantically and omits invalid ones', async () => {
  const originalFetch = global.fetch;
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
  const musicCard = screen.getByRole('heading', { name: 'Music' }).closest('article');
  fireEvent.click(within(musicCard).getByRole('button', { name: 'View listening' }));
  await screen.findByText('First song');
  const time = screen.getByText('8 minutes ago');
  expect(time.tagName).toBe('TIME');
  expect(time).toHaveAttribute('dateTime');
  expect(time).toHaveAttribute('title');
  expect(screen.getByText('Second song').parentElement.querySelector('time')).not.toBeInTheDocument();
  global.fetch = originalFetch;
});
