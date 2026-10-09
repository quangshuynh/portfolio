import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import App from '../../App';

import {
  featuredPhotographs,
  photographs,
  sortPhotographs,
} from '../../data/photographs';

import {
  getAppPathname,
  photographyHref,
} from '../../util/navigation';

import {
  PhotographyDetails,
  formatCameraName,
  resetPhotographyPreloadsForTests,
} from '../photography/photographyLightbox';


beforeEach(() => {
  resetPhotographyPreloadsForTests();

  window.history.replaceState({}, '', '/photography/');

  document.documentElement.classList.remove(
    'overlay-open',
    'layout-changing',
  );

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


test('renders the photography page and curated photographs', async () => {
  render(<App />);

  expect(
    await screen.findByRole('heading', { name: 'Photography' }),
  ).toBeInTheDocument();

  const renderedItems = [
    ...document.querySelectorAll('[data-photo-slug]'),
  ];

  expect(renderedItems).toHaveLength(photographs.length);

  const renderedSlugs = renderedItems.map(
    (item) => item.dataset.photoSlug,
  );

  expect(new Set(renderedSlugs).size).toBe(photographs.length);

  photographs.forEach((photograph) => {
    expect(renderedSlugs).toContain(photograph.slug);
  });

  expect(document.title).toBe('Photography Portfolio | Quang Huynh');
  expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute('href', 'https://quanghuynh.com/photography/');
});


test('accepts the photography pathname without a trailing slash', async () => {
  window.history.replaceState({}, '', '/photography');

  render(<App />);

  expect(
    await screen.findByRole('heading', { name: 'Photography' }),
  ).toBeInTheDocument();

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});


test('opens a photograph, navigates to the next photograph, and closes', async () => {
  const orderedPhotographs = sortPhotographs(photographs);

  const firstPhotograph = orderedPhotographs[0];
  const secondPhotograph = orderedPhotographs[1];

  render(<App />);

  fireEvent.click(
    await screen.findByRole('link', {
      name: `Open photograph: ${firstPhotograph.caption}`,
    }),
  );

  expect(window.location.hash).toBe(`#${firstPhotograph.slug}`);

  expect(
    screen.getByRole('dialog', {
      name: new RegExp(firstPhotograph.caption, 'i'),
    }),
  ).toBeInTheDocument();

  fireEvent.click(
    screen.getByRole('button', { name: 'Next photograph' }),
  );

  expect(window.location.hash).toBe(`#${secondPhotograph.slug}`);

  expect(
    screen.getByRole('dialog', {
      name: new RegExp(secondPhotograph.caption, 'i'),
    }),
  ).toBeInTheDocument();

  fireEvent.click(
    screen.getByRole('button', { name: 'Close photograph' }),
  );

  expect(window.location.hash).toBe('');

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});


test('Escape closes the viewer and restores focus to its thumbnail', async () => {
  const orderedPhotographs = sortPhotographs(photographs);
  const firstPhotograph = orderedPhotographs[0];

  render(<App />);

  const trigger = await screen.findByRole('link', {
    name: `Open photograph: ${firstPhotograph.caption}`,
  });

  fireEvent.click(trigger);

  expect(
    screen.getByRole('button', { name: 'Close photograph' }),
  ).toHaveFocus();

  expect(
    document.querySelector('.photography-page'),
  ).toHaveAttribute('inert');

  expect(document.documentElement).toHaveClass('overlay-open');

  fireEvent.keyDown(document, { key: 'Escape' });

  await waitFor(() => {
    expect(trigger).toHaveFocus();
  });

  expect(window.location.hash).toBe('');

  expect(
    document.querySelector('.photography-page'),
  ).not.toHaveAttribute('inert');

  await waitFor(() => {
    expect(document.documentElement).not.toHaveClass('overlay-open');
  });
});


test('previous and next navigation stop at collection boundaries', async () => {
  const orderedPhotographs = sortPhotographs(photographs);

  const firstPhotograph = orderedPhotographs[0];
  const lastPhotograph =
    orderedPhotographs[orderedPhotographs.length - 1];

  render(<App />);

  fireEvent.click(
    await screen.findByRole('link', {
      name: `Open photograph: ${firstPhotograph.caption}`,
    }),
  );

  expect(
    screen.getByRole('button', { name: 'Previous photograph' }),
  ).toBeDisabled();

  fireEvent.keyDown(document, { key: 'ArrowLeft' });

  expect(window.location.hash).toBe(`#${firstPhotograph.slug}`);

  act(() => {
    window.history.replaceState(
      {},
      '',
      photographyHref(lastPhotograph.slug),
    );

    window.dispatchEvent(
      new Event('portfolio:locationchange'),
    );
  });

  expect(
    screen.getByRole('button', { name: 'Next photograph' }),
  ).toBeDisabled();

  fireEvent.keyDown(document, { key: 'ArrowRight' });

  expect(window.location.hash).toBe(`#${lastPhotograph.slug}`);
});


test('opens a photograph directly from its hash', async () => {
  const photograph = photographs.find(
    ({ id }) => id === 'IMGP0739',
  ) ?? photographs[0];

  window.history.replaceState(
    {},
    '',
    photographyHref(photograph.slug),
  );

  render(<App />);

  expect(
    await screen.findByRole('dialog', {
      name: new RegExp(photograph.caption, 'i'),
    }),
  ).toBeInTheDocument();

  expect(window.location.hash).toBe(`#${photograph.slug}`);
});


test('invalid photograph hashes do not open the viewer', async () => {
  window.history.replaceState(
    {},
    '',
    '/photography/#not-a-real-photo',
  );

  render(<App />);

  expect(
    await screen.findByText(/could not be found/i),
  ).toBeInTheDocument();

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});


test('Back and Forward restore photograph viewer state', async () => {
  const orderedPhotographs = sortPhotographs(photographs);

  const firstPhotograph = orderedPhotographs[0];
  const secondPhotograph = orderedPhotographs[1];

  render(<App />);

  fireEvent.click(
    await screen.findByRole('link', {
      name: `Open photograph: ${firstPhotograph.caption}`,
    }),
  );

  fireEvent.click(
    screen.getByRole('button', { name: 'Next photograph' }),
  );

  expect(window.location.hash).toBe(`#${secondPhotograph.slug}`);

  await act(async () => {
    window.history.back();
  });

  await waitFor(() => {
    expect(window.location.hash).toBe(`#${firstPhotograph.slug}`);
  });

  expect(
    screen.getByRole('dialog', {
      name: new RegExp(firstPhotograph.caption, 'i'),
    }),
  ).toBeInTheDocument();

  await act(async () => {
    window.history.back();
  });

  await waitFor(() => {
    expect(window.location.hash).toBe('');
  });

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

  await act(async () => {
    window.history.forward();
  });

  await waitFor(() => {
    expect(window.location.hash).toBe(`#${firstPhotograph.slug}`);
  });

  expect(
    screen.getByRole('dialog', {
      name: new RegExp(firstPhotograph.caption, 'i'),
    }),
  ).toBeInTheDocument();
});


test('sorts photographs chronologically without mutating input', () => {
  const input = [
    {
      id: 'missing',
      capturedAt: null,
      curatedOrder: 3,
    },
    {
      id: 'newer',
      capturedAt: '2026-05-01T12:00:00Z',
      curatedOrder: 2,
    },
    {
      id: 'older',
      capturedAt: '2025-05-01T12:00:00Z',
      curatedOrder: 1,
    },
  ];

  const originalOrder = input.map(({ id }) => id);

  expect(
    sortPhotographs(input, 'newest').map(({ id }) => id),
  ).toEqual([
    'newer',
    'older',
    'missing',
  ]);

  expect(
    sortPhotographs(input, 'oldest').map(({ id }) => id),
  ).toEqual([
    'older',
    'newer',
    'missing',
  ]);

  expect(input.map(({ id }) => id)).toEqual(originalOrder);
});


test('changing the gallery order renders photographs in chronological order', async () => {
  render(<App />);

  await screen.findByRole('heading', { name: 'Photography' });

  fireEvent.change(
    screen.getByLabelText('Order'),
    {
      target: {
        value: 'newest',
      },
    },
  );

  const expected = sortPhotographs(
    photographs,
    'newest',
  );

  const renderedItems = [
    ...document.querySelectorAll('[data-photo-slug]'),
  ];

  expect(
    renderedItems.map(
      (item) => item.dataset.photoSlug,
    ),
  ).toEqual(
    expected.map(({ slug }) => slug),
  );
});


test('photography details handle partial metadata without placeholders', () => {
  render(
    <PhotographyDetails
      photograph={{
        id: 'DIBS2164',
        curatedOrder: 3,
        caption: 'A quiet moment on the grass at Cornell',
        capturedAt: '2026-04-04T16:56:19.000Z',
      }}
    />,
  );

  expect(
    screen.getByText('No. 03'),
  ).toBeInTheDocument();

  expect(
    screen.queryByText(/unknown/i),
  ).not.toBeInTheDocument();

  expect(
    screen.queryByText(/^Lens$/i),
  ).not.toBeInTheDocument();

  expect(
    screen.queryByText(/^ISO$/i),
  ).not.toBeInTheDocument();
});


test('photography details render available camera metadata', () => {
  render(
    <PhotographyDetails
      photograph={{
        id: 'metadata-test',
        caption: 'Test photograph',
        capturedAt: '2026-10-02T10:39:26.000Z',
        camera: 'SONY ILCE-6400',
        focalLength: 31,
        aperture: 10,
        shutterSpeed: 0.01,
        iso: 100,
      }}
    />,
  );

  expect(
    screen.getByText('Sony A6400'),
  ).toBeInTheDocument();

  expect(
    screen.getByText('31 mm'),
  ).toBeInTheDocument();

  expect(
    screen.getByText('f/10'),
  ).toBeInTheDocument();

  expect(
    screen.getByText('1/100 s'),
  ).toBeInTheDocument();

  expect(
    screen.getByText('ISO'),
  ).toBeInTheDocument();

  expect(
    screen.getByText('100'),
  ).toBeInTheDocument();

  expect(
    screen.queryByText(/unknown/i),
  ).not.toBeInTheDocument();
});


test('builds photography URLs for root and GitHub Pages base paths', () => {
  expect(
    photographyHref('IMGP0579', '/'),
  ).toBe('/photography/#IMGP0579');

  expect(
    photographyHref('IMGP0579', '/portfolio/'),
  ).toBe('/portfolio/photography/#IMGP0579');

  expect(
    photographyHref(undefined, '/portfolio/'),
  ).toBe('/portfolio/photography/');

  expect(
    getAppPathname(
      '/portfolio/photography/',
      '/portfolio/',
    ),
  ).toBe('/photography');
});


test('the About photography modal opens the full photography page', async () => {
  window.history.replaceState({}, '', '/about');

  render(<App />);

  const photographyHeading =
    await screen.findByRole(
      'heading',
      { name: 'Photography' },
    );

  const photographyArticle =
    photographyHeading.closest('article');

  fireEvent.click(
    photographyArticle.querySelector(
      '.interest-view-more',
    ),
  );

  expect(
    screen.getByRole('dialog', {
      name: 'Photography by Quang',
    }),
  ).toBeInTheDocument();

  fireEvent.click(
    screen.getByRole('link', {
      name: 'View all',
    }),
  );

  expect(
    await screen.findByRole('heading', {
      name: 'Featured',
    }),
  ).toBeInTheDocument();

  expect(window.location.pathname).toBe(
    '/photography/',
  );

  expect(
    screen.queryByRole('dialog', {
      name: 'Photography by Quang',
    }),
  ).not.toBeInTheDocument();

  await waitFor(() => {
    expect(
      document.documentElement,
    ).not.toHaveClass('overlay-open');
  });
});

test('featured is a restrained selection and every photograph stays in the collection', async () => {
  render(<App />);

  await screen.findByRole('heading', { name: 'Featured' });

  const featuredSlugs = [...document.querySelectorAll('[data-featured-slug]')].map((item) => item.dataset.featuredSlug);
  expect(featuredSlugs).toEqual(featuredPhotographs.map(({ slug }) => slug));
  expect(featuredSlugs.length).toBeGreaterThan(0);
  expect(featuredSlugs.length).toBeLessThan(photographs.length / 2);

  const collectionSlugs = new Set([...document.querySelectorAll('[data-photo-slug]')].map((item) => item.dataset.photoSlug));
  featuredSlugs.forEach((slug) => expect(collectionSlugs).toContain(slug));
});


test('category filters narrow the collection and All restores it', async () => {
  render(<App />);

  await screen.findByRole('heading', { name: 'All photographs' });

  const filters = screen.getByRole('group', { name: 'Filter photographs by category' });
  fireEvent.click(within(filters).getByRole('button', { name: /^Automotive/ }));

  const automotive = photographs.filter(({ category }) => category === 'Automotive');
  const shown = [...document.querySelectorAll('[data-photo-slug]')].map((item) => item.dataset.photoSlug);
  expect(shown.sort()).toEqual(automotive.map(({ slug }) => slug).sort());
  expect(within(filters).getByRole('button', { name: /^Automotive/ })).toHaveAttribute('aria-pressed', 'true');

  fireEvent.click(within(filters).getByRole('button', { name: /^All/ }));
  expect(document.querySelectorAll('[data-photo-slug]')).toHaveLength(photographs.length);
});


test('a photograph opened from Featured steps through the featured sequence', async () => {
  const [first, second] = featuredPhotographs;

  render(<App />);

  fireEvent.click(
    await screen.findByRole('link', { name: `View photograph: ${first.caption}` }),
  );

  expect(window.location.hash).toBe(`#${first.slug}`);

  fireEvent.click(screen.getByRole('button', { name: 'Next photograph' }));

  expect(window.location.hash).toBe(`#${second.slug}`);
});


test('camera names are shown in readable form, never as raw EXIF model codes', () => {
  expect(formatCameraName('SONY ILCE-6400')).toBe('Sony A6400');
  expect(formatCameraName('SONY ILCE-7M3')).toBe('Sony A7 III');
  expect(formatCameraName('SONY ILCE-6700')).toBe('Sony A6700');

  photographs
    .filter(({ camera }) => camera)
    .forEach(({ camera }) => {
      expect(formatCameraName(camera)).not.toMatch(/ILCE|^[A-Z]{3,} /);
    });
});

test('collections index lists each category with its real count and opens it in the archive', async () => {
  render(<App />);

  await screen.findByRole('heading', { name: 'Collections' });

  const automotive = photographs.filter(({ category }) => category === 'Automotive');
  const card = screen.getByRole('button', { name: `Automotive, ${automotive.length} photographs. Show in all photographs` });
  const cover = card.querySelector('img');
  expect(automotive.map(({ gallerySrc }) => gallerySrc)).toContain(cover.getAttribute('src'));

  fireEvent.click(card);

  const filters = screen.getByRole('group', { name: 'Filter photographs by category' });
  expect(within(filters).getByRole('button', { name: /^Automotive/ })).toHaveAttribute('aria-pressed', 'true');
  const shown = [...document.querySelectorAll('[data-photo-slug]')].map((item) => item.dataset.photoSlug);
  expect(shown.sort()).toEqual(automotive.map(({ slug }) => slug).sort());
  expect(screen.getByRole('heading', { name: 'All photographs' })).toHaveFocus();
});

test('the opening photograph is an existing photograph and opens in the existing viewer', async () => {
  render(<App />);

  await screen.findByRole('heading', { level: 1, name: 'Photography' });

  const hero = document.querySelector('[data-hero-slug]');
  const photograph = photographs.find(({ slug }) => slug === hero.dataset.heroSlug);
  expect(photograph).toBeDefined();
  expect(hero.querySelector('img')).toHaveAttribute('alt', photograph.alt);
  expect(document.querySelectorAll('[data-featured-slug]')).toHaveLength(featuredPhotographs.length);
  expect(document.querySelectorAll('[data-photo-slug]')).toHaveLength(photographs.length);

  fireEvent.click(within(hero).getByRole('link', { name: `View photograph: ${photograph.caption}` }));

  expect(window.location.hash).toBe(`#${photograph.slug}`);
  expect(screen.getByRole('dialog', { name: new RegExp(photograph.caption, 'i') })).toBeInTheDocument();
});
