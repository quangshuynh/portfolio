import { act, fireEvent, render, screen, waitFor, within,  } from '@testing-library/react';

import App from './App';

// The homepage is a lazy chunk: load it once, then let each render resolve it.
beforeAll(() => import('./components/pages/homePage'));
async function renderApp(ui = <App />) {
  let view;
  await act(async () => { view = render(ui); });
  return view;
}


beforeEach(() => {
  window.history.replaceState({}, '', '/');

  document.documentElement.classList.remove(
    'overlay-open',
    'layout-changing',
  );

  document.documentElement.removeAttribute(
    'data-theme',
  );

  document.body.removeAttribute('style');
});


afterEach(() => {
  vi.restoreAllMocks();
});


describe('portfolio homepage', () => {
  test('renders the main portfolio sections', async () => {
    await renderApp();

    expect(
      screen.getByText('Hi, I’m Quang.'),
    ).toBeInTheDocument();

    expect(
      screen.getByRole('heading', {
        name: 'Experience',
      }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole('button', {
        name: 'View more projects',
      }),
    ).toBeInTheDocument();
  });


  test('links to the dedicated About page', async () => {
    await renderApp();

    expect(
      screen.getByRole('link', {
        name: /^Meet Quang/,
      }),
    ).toHaveAttribute(
      'href',
      '/about',
    );
  });


  test('expands and collapses additional projects', async () => {
    await renderApp();

    const toggle =
      screen.getByRole('button', {
        name: 'View more projects',
      });

    expect(toggle).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    fireEvent.click(toggle);

    expect(
      screen.getByRole('button', {
        name: 'Show fewer projects',
      }),
    ).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    expect(
      screen.getByRole('heading', {
        name: 'CaseNotes',
      }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Show fewer projects',
      }),
    );

    expect(
      screen.queryByRole('heading', {
        name: 'CaseNotes',
      }),
    ).not.toBeInTheDocument();
  });


  test('project galleries can switch views', async () => {
    await renderApp();

    const gallery = within(screen.getByLabelText('DashPilot gallery'));
    // Galleries open on the product, not the logo.
    expect(gallery.queryByRole('button', { name: 'Logo' })).not.toBeInTheDocument();
    expect(gallery.getByRole('button', { name: 'Work' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(gallery.getByRole('button', { name: 'Insights' }));
    expect(gallery.getByRole('button', { name: 'Insights' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('img', { name: /DashPilot Insights bar chart/i })).toBeInTheDocument();
  });

  test('theme toggle switches between dark and light modes', async () => {
    await renderApp();

    const toggle =
      screen.getByRole('button', {
        name: 'Switch to light mode',
      });

    fireEvent.click(toggle);

    expect(
      document.documentElement,
    ).toHaveAttribute(
      'data-theme',
      'light',
    );

    expect(
      screen.getByRole('button', {
        name: 'Switch to dark mode',
      }),
    ).toBeInTheDocument();
  });
});


describe('shared image lightbox', () => {
  test('opens, closes with Escape, and restores focus', async () => {
    await renderApp();

    const trigger =
      screen.getByRole('button', {
        name:
          'Open image: 585Dashcam585 storefront',
      });

    fireEvent.click(trigger);

    expect(
      screen.getByRole('dialog', {
        name:
          'Image viewer: 585Dashcam585 storefront',
      }),
    ).toBeInTheDocument();

    expect(
      document.documentElement,
    ).toHaveClass(
      'overlay-open',
    );

    expect(
      screen.getByRole('button', {
        name: 'Close image viewer',
      }),
    ).toHaveFocus();

    fireEvent.keyDown(
      document,
      {
        key: 'Escape',
      },
    );

    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });

    expect(
      screen.queryByRole('dialog', {
        name:
          'Image viewer: 585Dashcam585 storefront',
      }),
    ).not.toBeInTheDocument();

    expect(
      document.documentElement,
    ).not.toHaveClass(
      'overlay-open',
    );
  });
});


describe('routing', () => {
  test('renders the dedicated About page', async () => {
    window.history.replaceState(
      {},
      '',
      '/about',
    );

    await renderApp();

    expect(
      await screen.findByRole(
        'heading',
        {
          name: 'Hi, I’m Quang.',
        },
      ),
    ).toBeInTheDocument();

    expect(
      screen.getByRole('heading', {
        name: 'Beyond software',
      }),
    ).toBeInTheDocument();

    expect(
      document.title,
    ).toBe(
      'About Quang Huynh | Software Engineer & CS Student',
    );
  });


  test('renders the photography page', async () => {
    window.history.replaceState(
      {},
      '',
      '/photography/',
    );

    await renderApp();

    expect(
      await screen.findByRole(
        'heading',
        {
          level: 1,
          name: 'Huynh Photography',
        },
      ),
    ).toBeInTheDocument();

    expect(
      screen.queryByRole(
        'heading',
        {
          name: 'Experience',
        },
      ),
    ).not.toBeInTheDocument();
  });


  test('homepage navigation remains available', async () => {
    await renderApp();

    const nav =
      screen.getByRole(
        'navigation',
        {
          name: 'Primary navigation',
        },
      );

    expect(
      within(nav).getByRole(
        'link',
        {
          name: 'Experience',
        },
      ),
    ).toBeInTheDocument();

    expect(
      within(nav).getByRole(
        'link',
        {
          name: 'Projects',
        },
      ),
    ).toBeInTheDocument();

    expect(
      within(nav).getByRole(
        'link',
        {
          name: 'Contact',
        },
      ),
    ).toBeInTheDocument();
  });
});

describe('page metadata', () => {
  const robots = () => document.querySelector('meta[name="robots"]');

  beforeEach(() => {
    document.head.querySelectorAll('meta[name="robots"], link[rel="canonical"]').forEach((node) => node.remove());
    document.head.insertAdjacentHTML('beforeend', '<meta name="robots" content="noindex, follow" /><link rel="canonical" href="" />');
  });

  test('applies the route metadata on known routes', async () => {
    window.history.replaceState({}, '', '/about/');
    await renderApp();
    await screen.findByRole('heading', { name: 'Hi, I’m Quang.' });
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute('href', 'https://quanghuynh.com/about');
    expect(robots()).toHaveAttribute('content', 'index, follow, max-image-preview:large');
  });

  test('leaves the 404 page head alone on unknown paths', async () => {
    document.title = 'Page not found | Quang Huynh';
    window.history.replaceState({}, '', '/no-such-page');
    await renderApp();
    expect(document.title).toBe('Page not found | Quang Huynh');
    expect(robots()).toHaveAttribute('content', 'noindex, follow');
  });
});
