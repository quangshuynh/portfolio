import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AboutPage from './aboutPage';

function renderAboutPage() {
  window.history.pushState({}, '', '/about');
  return render(<AboutPage />);
}

function photographyTrigger() {
  return within(screen.getByRole('heading', { name: 'Photography' }).closest('article'))
    .getByRole('button', { name: 'View more' });
}

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
  renderAboutPage();
  const trigger = photographyTrigger();
  fireEvent.click(trigger);
  const imageTrigger = screen.getByRole('button', {
    name: /Open image: Looking up through Cornell/i
  });

  fireEvent.click(imageTrigger);
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

  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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
  global.fetch = originalFetch;
});
