import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import App from './App';


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
  test('renders the main portfolio sections', () => {
    render(<App />);

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


  test('links to the dedicated About page', () => {
    render(<App />);

    expect(
      screen.getByRole('link', {
        name: /^Meet Quang/,
      }),
    ).toHaveAttribute(
      'href',
      '/about',
    );
  });


  test('expands and collapses additional projects', () => {
    render(<App />);

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


  test('project galleries can switch views', () => {
    render(<App />);

    const flipperGallery = within(
      screen.getByLabelText(
        'Flipper gallery',
      ),
    );

    expect(
      flipperGallery.getByRole(
        'button',
        {
          name: 'Logo',
        },
      ),
    ).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(
      flipperGallery.getByRole(
        'button',
        {
          name: 'Dashboard',
        },
      ),
    );

    expect(
      flipperGallery.getByRole(
        'button',
        {
          name: 'Dashboard',
        },
      ),
    ).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    expect(
      screen.getByRole('img', {
        name: /Flipper dashboard/i,
      }),
    ).toBeInTheDocument();
  });


  test('theme toggle switches between dark and light modes', () => {
    render(<App />);

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
    render(<App />);

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

    render(<App />);

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
      'Quang Huynh | About Quang',
    );
  });


  test('renders the photography page', async () => {
    window.history.replaceState(
      {},
      '',
      '/photography/',
    );

    render(<App />);

    expect(
      await screen.findByRole(
        'heading',
        {
          name: 'Photography',
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


  test('homepage navigation remains available', () => {
    render(<App />);

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