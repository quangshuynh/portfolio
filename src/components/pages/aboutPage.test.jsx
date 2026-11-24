import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import AboutPage from './aboutPage';

import aboutCss from '../../styles/about.css?raw';

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

test('the page index links to sections that exist on the page', () => {
  renderAboutPage();

  const index = screen.getByRole('navigation', { name: 'On this page' });
  const links = within(index).getAllByRole('link');

  expect(links).toHaveLength(4);
  links.forEach((link) => {
    const id = link.getAttribute('href').slice(1);
    expect(document.getElementById(id)).not.toBeNull();
  });
});


test('the path keeps the verified co-op, testimonial and team photo', () => {
  renderAboutPage();

  const path = document.getElementById('path');

  expect(within(path).getByRole('heading', { name: 'IoT Software Engineering Co-op at KORE Wireless' })).toBeInTheDocument();
  expect(within(path).getByText('Matt Telesky, Director of Software Engineering')).toBeInTheDocument();
  expect(within(path).getByRole('button', { name: 'Open KORE Wireless team lunch photo' }).querySelector('img')).toHaveAttribute('width', '1200');
  expect(path.querySelectorAll('time')).toHaveLength(2);
});


test('every interest keeps its featured image, kicker and a lazily loaded photo', () => {
  renderAboutPage();

  const cards = document.querySelectorAll('#beyond-software article.interest-card');

  expect(cards).toHaveLength(6);
  cards.forEach((card) => {
    const image = card.querySelector('.interest-card-media img');
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image).toHaveAttribute('alt');
    expect(image.getAttribute('width')).toMatch(/^\d+$/);
    expect(card.querySelector('.interest-card-kicker')).not.toBeNull();
  });
});


test('each principle pairs its idea with an example from real work', () => {
  renderAboutPage();

  const principles = within(document.getElementById('approach')).getAllByRole('listitem');

  expect(principles.map((item) => within(item).getByRole('heading').textContent)).toEqual(['Curiosity', 'Reliability', 'Usefulness']);
  principles.forEach((item) => expect(within(item).getByText('In practice')).toBeInTheDocument());
});


test('the closing links reach projects, GitHub, the résumé and the contact section', () => {
  renderAboutPage();

  const cta = screen.getByRole('heading', { name: 'Want to see what I’ve been building?' }).closest('section');
  const hrefs = within(cta).getAllByRole('link').map((link) => link.getAttribute('href'));

  expect(hrefs).toEqual(['/#projects', 'https://github.com/quangshuynh', '/Quang_Huynh_Resume.pdf', '#contact']);
  expect(document.getElementById('contact')).not.toBeNull();
  expect(screen.getByRole('heading', { name: 'Currently' })).toBeInTheDocument();
});


function openPhotoStage() {
  renderAboutPage();

  const trigger = screen.getByRole('button', { name: 'View more photos of Quang' });

  fireEvent.click(trigger);

  return { trigger, dialog: screen.getByRole('dialog', { name: 'More about Quang' }) };
}


const stageImage = (dialog) => within(dialog).getByRole('button', { name: /^Open image:/ }).querySelector('img');
const stageThumbs = (dialog) => within(dialog).getAllByRole('button', { name: /^Show photo/ });
const currentThumbs = (dialog) => stageThumbs(dialog).map((thumb) => thumb.getAttribute('aria-current'));


test('the portrait shows the cover and counts only the other photos', () => {
  renderAboutPage();

  const portrait = screen.getByRole('button', { name: 'View more photos of Quang' });
  const cover = portrait.querySelector('img');

  expect(cover).toHaveAttribute('alt', 'Quang laughing in a dark suit jacket and open-collared white shirt');
  expect(Number(cover.getAttribute('width')) / Number(cover.getAttribute('height'))).toBeCloseTo(4 / 5, 3);
  expect(portrait).toHaveTextContent('4 more photos');
});


test('the square phone portrait keeps the top of the cover, where the head is', () => {
  const phone = aboutCss.slice(aboutCss.indexOf('@media (max-width: 760px)'));

  expect(phone).toMatch(/\.about-portrait-button img \{ aspect-ratio: 1; object-position: top; \}/);
});


test('the personal gallery opens on the photo used as the cover', () => {
  const { dialog } = openPhotoStage();

  expect(stageImage(dialog)).toHaveAttribute('alt', 'Quang laughing in a dark suit jacket and open-collared white shirt');
  expect(within(dialog).getByText('Caught mid-laugh')).toBeInTheDocument();
  expect(within(dialog).getByText('1 of 5')).toBeInTheDocument();
  expect(currentThumbs(dialog)).toEqual(['true', null, null, null, null]);
});


test('the previous cover is part of the personal gallery', () => {
  const { dialog } = openPhotoStage();

  fireEvent.click(within(dialog).getByRole('button', { name: /^Show photo \d of 5: On the bench$/ }));

  expect(stageImage(dialog)).toHaveAttribute('alt', 'Quang seated on a bench outdoors');
});


test('next and previous browse the stage and wrap at both ends', () => {
  const { dialog } = openPhotoStage();

  fireEvent.click(within(dialog).getByRole('button', { name: 'Next photo' }));
  expect(within(dialog).getByText('2 of 5')).toBeInTheDocument();
  expect(currentThumbs(dialog)).toEqual([null, 'true', null, null, null]);

  fireEvent.click(within(dialog).getByRole('button', { name: 'Previous photo' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Previous photo' }));
  expect(within(dialog).getByText('5 of 5')).toBeInTheDocument();

  fireEvent.click(within(dialog).getByRole('button', { name: 'Next photo' }));
  expect(within(dialog).getByText('1 of 5')).toBeInTheDocument();
});


test('arrow keys browse the stage', () => {
  const { dialog } = openPhotoStage();

  fireEvent.keyDown(document, { key: 'ArrowRight' });
  expect(within(dialog).getByText('2 of 5')).toBeInTheDocument();

  fireEvent.keyDown(document, { key: 'ArrowLeft' });
  expect(within(dialog).getByText('1 of 5')).toBeInTheDocument();
});


test('a horizontal swipe browses the stage, a vertical scroll or pinch does not', () => {
  const { dialog } = openPhotoStage();
  const photo = within(dialog).getByRole('button', { name: /^Open image:/ });
  const swipe = (from, to, fingers = 1) => {
    fireEvent.touchStart(photo, { touches: Array.from({ length: fingers }, () => ({ clientX: from[0], clientY: from[1] })) });
    fireEvent.touchEnd(photo, { touches: [], changedTouches: [{ clientX: to[0], clientY: to[1] }] });
  };

  swipe([200, 100], [190, 220]);
  swipe([200, 100], [185, 100]);
  swipe([200, 100], [80, 100], 2);
  expect(within(dialog).getByText('1 of 5')).toBeInTheDocument();

  swipe([200, 100], [80, 110]);
  expect(within(dialog).getByText('2 of 5')).toBeInTheDocument();

  swipe([80, 100], [200, 110]);
  expect(within(dialog).getByText('1 of 5')).toBeInTheDocument();
});


test('the viewer opened from the stage browses one photo per key and returns to the photo it showed last', async () => {
  const { dialog } = openPhotoStage();
  const photo = within(dialog).getByRole('button', { name: /^Open image:/ });

  fireEvent.click(photo);

  expect(screen.getByRole('dialog', { name: 'Image viewer: Caught mid-laugh' })).toBeInTheDocument();

  fireEvent.keyDown(document, { key: 'ArrowRight' });

  const viewer = screen.getByRole('dialog', { name: /^Image viewer:/ });
  expect(within(viewer).getByText('2 of 5')).toBeInTheDocument();

  fireEvent.click(within(viewer).getByRole('button', { name: 'Next image' }));
  expect(within(viewer).getByText('3 of 5')).toBeInTheDocument();

  fireEvent.keyDown(document, { key: 'Escape' });

  await waitFor(() => expect(photo).toHaveFocus());
  expect(screen.queryByRole('dialog', { name: /^Image viewer:/ })).not.toBeInTheDocument();
  expect(within(dialog).getByText('3 of 5')).toBeInTheDocument();
});


test('closing the stage returns focus to the portrait', async () => {
  const { trigger } = openPhotoStage();

  fireEvent.keyDown(document, { key: 'Escape' });

  await waitFor(() => expect(trigger).toHaveFocus());
  expect(screen.queryByRole('dialog', { name: 'More about Quang' })).not.toBeInTheDocument();
});
