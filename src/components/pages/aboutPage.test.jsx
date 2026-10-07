import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import AboutPage from './aboutPage';

import { photographs } from '../../data/photographs';

import {
  formatRelativePlayTime,
  resetSpotifyCacheForTests,
} from '../about/aboutGallery';


const originalFetch = global.fetch;


beforeEach(() => {
  resetSpotifyCacheForTests();

  window.history.replaceState({}, '', '/about');

  document.documentElement.classList.remove(
    'overlay-open',
    'layout-changing',
  );

  document.body.removeAttribute('style');
});


afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});


function renderAboutPage() {
  window.history.replaceState({}, '', '/about');

  return render(<AboutPage />);
}


function photographyCard() {
  return screen
    .getByRole('heading', { name: 'Photography' })
    .closest('article');
}


function photographyTrigger() {
  return within(photographyCard()).getByRole(
    'button',
    { name: 'View more' },
  );
}


function musicCard() {
  return screen
    .getByRole('heading', { name: 'Music' })
    .closest('article');
}


function openSpotifyListening() {
  fireEvent.click(
    within(musicCard()).getByRole(
      'button',
      { name: 'View listening' },
    ),
  );
}


test('renders the About page and main sections', () => {
  renderAboutPage();

  expect(
    screen.getByRole('heading', {
      name: 'From coursework to production software',
    }),
  ).toBeInTheDocument();

  expect(
    screen.getByRole('heading', {
      name: 'How I approach engineering',
    }),
  ).toBeInTheDocument();

  expect(
    screen.getByRole('heading', {
      name: 'Photography',
    }),
  ).toBeInTheDocument();

  expect(
    screen.getByRole('heading', {
      name: 'Music',
    }),
  ).toBeInTheDocument();
});


test('opens the photography gallery', () => {
  renderAboutPage();

  fireEvent.click(
    photographyTrigger(),
  );

  expect(
    screen.getByRole('dialog', {
      name: 'Photography by Quang',
    }),
  ).toBeInTheDocument();

  expect(
    screen.getByRole('button', {
      name: 'Close photography gallery',
    }),
  ).toHaveFocus();

  expect(
    document.body.style.overflow,
  ).toBe('hidden');
});


test('Escape closes the photography gallery and restores focus', async () => {
  renderAboutPage();

  const trigger = photographyTrigger();

  fireEvent.click(trigger);

  expect(
    screen.getByRole('dialog', {
      name: 'Photography by Quang',
    }),
  ).toBeInTheDocument();

  fireEvent.keyDown(
    document,
    { key: 'Escape' },
  );

  await waitFor(() => {
    expect(trigger).toHaveFocus();
  });

  expect(
    screen.queryByRole('dialog', {
      name: 'Photography by Quang',
    }),
  ).not.toBeInTheDocument();
});


test('a featured interest image opens in the image viewer', () => {
  renderAboutPage();

  const card = photographyCard();

  fireEvent.click(
    within(card).getByRole('button', {
      name: 'Open featured Photography image',
    }),
  );

  expect(
    screen.getByRole('dialog', {
      name: /Image viewer:/i,
    }),
  ).toBeInTheDocument();

  expect(
    screen.getByRole('button', {
      name: 'Close image viewer',
    }),
  ).toHaveFocus();
});


test('nested photography lightbox handles Escape before the parent gallery', async () => {
  renderAboutPage();

  const galleryTrigger = photographyTrigger();

  fireEvent.click(
    galleryTrigger,
  );

  const imageTrigger = screen.getByRole('button', {
    name: `Open image: ${photographs[0].caption}`,
  });

  fireEvent.click(imageTrigger);

  const parentDialog =
    document.querySelector(
      '.photography-modal',
    );

  expect(
    parentDialog,
  ).toHaveAttribute(
    'aria-hidden',
    'true',
  );

  expect(
    parentDialog,
  ).toHaveAttribute(
    'inert',
  );

  expect(
    screen.getByRole('dialog', {
      name: /Image viewer:/i,
    }),
  ).toBeInTheDocument();

  fireEvent.keyDown(
    document,
    { key: 'Escape' },
  );

  await waitFor(() => {
    expect(imageTrigger).toHaveFocus();
  });

  expect(
    screen.queryByRole('dialog', {
      name: /Image viewer:/i,
    }),
  ).not.toBeInTheDocument();

  expect(
    screen.getByRole('dialog', {
      name: 'Photography by Quang',
    }),
  ).toBeInTheDocument();

  fireEvent.keyDown(
    document,
    { key: 'Escape' },
  );

  await waitFor(() => {
    expect(galleryTrigger).toHaveFocus();
  });

  expect(
    screen.queryByRole('dialog', {
      name: 'Photography by Quang',
    }),
  ).not.toBeInTheDocument();
});


test('nested lightbox supports basic zoom controls', () => {
  renderAboutPage();

  fireEvent.click(
    photographyTrigger(),
  );

  fireEvent.click(
    screen.getByRole('button', {
      name: `Open image: ${photographs[0].caption}`,
    }),
  );

  fireEvent.keyDown(
    document,
    { key: '+' },
  );

  expect(
    screen.getByRole('button', {
      name: 'Reset zoom',
    }),
  ).toHaveTextContent('125%');

  fireEvent.keyDown(
    document,
    { key: '0' },
  );

  expect(
    screen.getByRole('button', {
      name: 'Reset zoom',
    }),
  ).toHaveTextContent('100%');
});


test('Spotify does not load until the listening panel is opened', async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      tracks: [],
    }),
  });

  renderAboutPage();

  expect(
    global.fetch,
  ).not.toHaveBeenCalled();

  openSpotifyListening();

  await waitFor(() => {
    expect(
      global.fetch,
    ).toHaveBeenCalledTimes(1);
  });
});


test('Spotify shows loading and failure states', async () => {
  global.fetch = vi
    .fn()
    .mockRejectedValue(
      new Error('offline'),
    );

  renderAboutPage();

  openSpotifyListening();

  expect(
    screen.getByText(
      'Loading recent listening...',
    ),
  ).toBeInTheDocument();

  expect(
    await screen.findByText(
      'Couldn’t load recent listening',
    ),
  ).toBeInTheDocument();

  expect(
    screen.getByText(
      'Spotify activity is temporarily unavailable.',
    ),
  ).toBeInTheDocument();

  expect(
    screen.getByRole('button', {
      name: 'Retry',
    }),
  ).toBeInTheDocument();
});


test('Spotify renders a successful response', async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,

    json: async () => ({
      tracks: [
        {
          id: 'track-1',
          name: 'Test song',
          artist: 'Test artist',
          album: 'Test album',
          url: 'https://open.spotify.com/track/test',
          playedAt:
            new Date(
              Date.now() -
              8 * 60 * 1000,
            ).toISOString(),
        },
      ],
    }),
  });

  renderAboutPage();

  openSpotifyListening();

  expect(
    await screen.findByText(
      'Test song',
    ),
  ).toBeInTheDocument();

  expect(
    screen.getByText(
      'Test artist',
    ),
  ).toBeInTheDocument();

  expect(
    screen.getByText(
      '8 minutes ago',
    ),
  ).toBeInTheDocument();
});


test('Spotify retry performs a new request after failure', async () => {
  global.fetch = vi
    .fn()

    .mockRejectedValueOnce(
      new Error('offline'),
    )

    .mockResolvedValueOnce({
      ok: true,

      json: async () => ({
        tracks: [
          {
            id: 'recovered',
            name: 'Recovered song',
            artist: 'Artist',
            album: 'Album',
            url: 'https://open.spotify.com/track/recovered',
            playedAt:
              new Date().toISOString(),
          },
        ],
      }),
    });

  renderAboutPage();

  openSpotifyListening();

  const retry =
    await screen.findByRole(
      'button',
      { name: 'Retry' },
    );

  expect(
    global.fetch,
  ).toHaveBeenCalledTimes(1);

  fireEvent.click(
    retry,
  );

  expect(
    screen.getByText(
      'Loading recent listening...',
    ),
  ).toBeInTheDocument();

  expect(
    await screen.findByText(
      'Recovered song',
    ),
  ).toBeInTheDocument();

  expect(
    global.fetch,
  ).toHaveBeenCalledTimes(2);
});


test('formats relative Spotify play times', () => {
  const now =
    new Date(
      '2026-09-07T16:00:00Z',
    );

  expect(
    formatRelativePlayTime(
      '2026-09-07T15:59:45Z',
      now,
    ),
  ).toBe('Just now');

  expect(
    formatRelativePlayTime(
      '2026-09-07T15:52:00Z',
      now,
    ),
  ).toBe('8 minutes ago');

  expect(
    formatRelativePlayTime(
      '2026-09-07T15:00:00Z',
      now,
    ),
  ).toBe('1 hour ago');

  expect(
    formatRelativePlayTime(
      '2026-09-06T15:00:00Z',
      now,
    ),
  ).toBe('Yesterday');

  expect(
    formatRelativePlayTime(
      null,
      now,
    ),
  ).toBeNull();

  expect(
    formatRelativePlayTime(
      'not-a-date',
      now,
    ),
  ).toBeNull();
});