import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import App from './App';

describe('portfolio homepage', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
  });

  test('renders the portfolio and primary project sections', () => {
    render(<App />);

    expect(screen.getByText('Hi, I’m Quang.')).toBeInTheDocument();

    expect(
      screen.getByRole('heading', {
        name: 'I build reliable backend systems, developer tools, automation, and native applications.',
      })
    ).toBeInTheDocument();

    expect(
      screen.getByRole('heading', { name: 'Business Data Automation' })
    ).toBeInTheDocument();

    expect(
      screen.getByRole('heading', { name: '585Dashcam585' })
    ).toBeInTheDocument();

    expect(
      screen.getByRole('heading', { name: 'GitProfileLens' })
    ).toBeInTheDocument();

    expect(
      screen.getByRole('heading', { name: 'ScribeKit' })
    ).toBeInTheDocument();

    expect(
      screen.getByRole('heading', { name: 'Experience' })
    ).toBeInTheDocument();
  });

  test('shows featured additional projects and expands the full project grid', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'Hymical Forms' })
    ).toBeInTheDocument();

    expect(
      screen.getByRole('heading', { name: 'DashPilot' })
    ).toBeInTheDocument();

    expect(
      screen.getByRole('heading', { name: 'CaseNotes' })
    ).toBeInTheDocument();

    expect(
      screen.queryByRole('heading', { name: 'InboxSweep' })
    ).not.toBeInTheDocument();

    expect(
      screen.queryByRole('heading', { name: '585photo585' })
    ).not.toBeInTheDocument();

    expect(
      screen.queryByRole('heading', { name: 'SalonFlow' })
    ).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', {
      name: 'View more projects',
    });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);

    expect(
      screen.getByRole('heading', { name: 'InboxSweep' })
    ).toBeInTheDocument();

    expect(
      screen.getByRole('heading', { name: 'Repo Radar' })
    ).toBeInTheDocument();

    expect(
      screen.getByRole('heading', { name: '585photo585' })
    ).toBeInTheDocument();

    expect(
      screen.getByRole('heading', { name: 'SalonFlow' })
    ).toBeInTheDocument();

    expect(
      screen.getByRole('heading', { name: 'mover-git' })
    ).toBeInTheDocument();

    expect(
      screen.getByRole('heading', { name: 'Steam Value Lookup' })
    ).toBeInTheDocument();

    const collapseButton = screen.getByRole('button', {
      name: 'Show fewer projects',
    });

    expect(collapseButton).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(collapseButton);

    expect(
      screen.queryByRole('heading', { name: 'InboxSweep' })
    ).not.toBeInTheDocument();

    expect(
      screen.queryByRole('heading', { name: 'SalonFlow' })
    ).not.toBeInTheDocument();
  });

  test('important project links point to the expected destinations', () => {
    render(<App />);

    expect(
      screen.getByRole('link', {
        name: 'Open 585Dashcam585 live site',
      })
    ).toHaveAttribute('href', 'https://www.585dashcam585.com');

    expect(
      screen.getByRole('link', {
        name: 'View GitProfileLens code',
      })
    ).toHaveAttribute(
      'href',
      'https://github.com/quangshuynh/gitprofilelens'
    );

    expect(
      screen.getByRole('link', {
        name: 'Open GitProfileLens live demo',
      })
    ).toHaveAttribute(
      'href',
      'https://gitprofilelens.vercel.app/'
    );

    const toggle = screen.getByRole('button', {
      name: 'View more projects',
    });

    fireEvent.click(toggle);

    expect(
      screen.getByRole('link', {
        name: 'Open Hymical Forms repository',
      })
    ).toHaveAttribute(
      'href',
      'https://github.com/hymical/forms'
    );

    expect(
      screen.getByRole('link', {
        name: 'Open CaseNotes documentation',
      })
    ).toHaveAttribute(
      'href',
      'https://quangshuynh.github.io/casenotes/'
    );

    expect(
      screen.getByRole('link', {
        name: 'Open InboxSweep repository',
      })
    ).toHaveAttribute(
      'href',
      'https://github.com/quangshuynh/inboxsweep'
    );

    expect(
      screen.getByRole('link', {
        name: 'Open 585photo585 live site',
      })
    ).toHaveAttribute(
      'href',
      'https://www.585photo585.com'
    );

    expect(
      screen.getByRole('link', {
        name: 'Open Steam Value Lookup live demo',
      })
    ).toHaveAttribute(
      'href',
      'https://steam-value-lookup.onrender.com/'
    );
  });

  test('project galleries switch between their available views', () => {
    render(<App />);

    const businessGallery = within(
      screen.getByLabelText('Business Data Automation gallery')
    );

    expect(
      businessGallery.getByRole('button', {
        name: 'Architecture',
      })
    ).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(
      businessGallery.getByRole('button', {
        name: 'Dashboard',
      })
    );

    expect(
      businessGallery.getByRole('button', {
        name: 'Dashboard',
      })
    ).toHaveAttribute('aria-pressed', 'true');

    expect(
      screen.getByRole('img', {
        name: /Business Data Automation reconciliation dashboard/i,
      })
    ).toBeInTheDocument();

    const gitProfileLensGallery = within(
      screen.getByLabelText('GitProfileLens gallery')
    );

    fireEvent.click(
      gitProfileLensGallery.getByRole('button', {
        name: 'Results',
      })
    );

    expect(
      screen.getByRole('img', {
        name: /GitProfileLens audit dashboard/i,
      })
    ).toBeInTheDocument();

    const scribeKitGallery = within(
      screen.getByLabelText('ScribeKit gallery')
    );

    expect(
      scribeKitGallery.getByRole('button', {
        name: 'Logo',
      })
    ).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(
      scribeKitGallery.getByRole('button', {
        name: 'App',
      })
    );

    expect(
      scribeKitGallery.getByRole('button', {
        name: 'App',
      })
    ).toHaveAttribute('aria-pressed', 'true');

    expect(
      screen.getByRole('img', {
        name: /ScribeKit macOS meeting window/i,
      })
    ).toBeInTheDocument();

    fireEvent.click(
      scribeKitGallery.getByRole('button', {
        name: 'Transcript',
      })
    );

    expect(
      screen.getByRole('img', {
        name: 'ScribeKit timestamped Markdown transcript output',
      })
    ).toBeInTheDocument();
  });

  test('theme toggle switches between dark and light modes', () => {
    render(<App />);

    const themeToggle = screen.getByRole('button', {
      name: 'Switch to light mode',
    });

    fireEvent.click(themeToggle);

    expect(document.documentElement).toHaveAttribute(
      'data-theme',
      'light'
    );

    expect(
      screen.getByRole('button', {
        name: 'Switch to dark mode',
      })
    ).toBeInTheDocument();
  });
});

describe('image lightbox', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
  });

  test('opens, closes with Escape, and restores focus', async () => {
    render(<App />);

    const trigger = screen.getByRole('button', {
      name: 'Open image: 585Dashcam585 storefront',
    });

    fireEvent.click(trigger);

    const lightbox = screen.getByRole('dialog', {
      name: 'Image viewer: 585Dashcam585 storefront',
    });

    expect(lightbox).toBeInTheDocument();
    expect(lightbox.parentElement).toBe(document.body);

    expect(document.documentElement).toHaveClass(
      'overlay-open'
    );

    expect(
      screen.getByRole('button', {
        name: 'Close image viewer',
      })
    ).toHaveFocus();

    fireEvent.keyDown(document, {
      key: 'Escape',
    });

    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });

    expect(
      screen.queryByRole('dialog', {
        name: 'Image viewer: 585Dashcam585 storefront',
      })
    ).not.toBeInTheDocument();

    expect(document.documentElement).not.toHaveClass(
      'overlay-open'
    );
  });
});

describe('About Quang route', () => {
  test('renders the dedicated About page', async () => {
    window.history.pushState({}, '', '/about');

    render(<App />);

    expect(
      await screen.findByRole('heading', {
        name: 'Hi, I’m Quang.',
      })
    ).toBeInTheDocument();

    expect(
      screen.getByRole('heading', {
        name: 'Beyond software',
      })
    ).toBeInTheDocument();

    expect(
      screen.getByRole('heading', {
        name: 'How I approach engineering',
      })
    ).toBeInTheDocument();

    expect(
      screen.getByRole('link', {
        name: 'About',
      })
    ).toHaveAttribute('href', '/#about');

    expect(
      screen.getByRole('link', {
        name: /View my work/i,
      })
    ).toHaveAttribute('href', '/#projects');

    expect(document.title).toBe(
      'Quang Huynh | About Quang'
    );
  });

  test('opens and closes the personal photo gallery', () => {
    window.history.pushState({}, '', '/about');

    render(<App />);

    const trigger = screen.getByRole('button', {
      name: 'View more photos of Quang',
    });

    fireEvent.click(trigger);

    expect(
      screen.getByRole('dialog', {
        name: 'More about Quang',
      })
    ).toBeInTheDocument();

    expect(document.documentElement).toHaveClass(
      'overlay-open'
    );

    expect(
      screen.getByLabelText('More photos of Quang')
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Close personal photo gallery',
      })
    );

    expect(
      screen.queryByRole('dialog', {
        name: 'More about Quang',
      })
    ).not.toBeInTheDocument();

    expect(document.documentElement).not.toHaveClass(
      'overlay-open'
    );
  });

  test('opens the photography gallery and expands it', () => {
    window.history.pushState({}, '', '/about');

    render(<App />);

    const photographyCard = screen
      .getByRole('heading', {
        name: 'Photography',
      })
      .closest('article');

    const toggle = within(photographyCard).getByRole(
      'button',
      {
        name: 'View more',
      }
    );

    expect(
      screen.queryByLabelText(
        'More photographs by Quang'
      )
    ).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(
      screen.getByLabelText(
        'More photographs by Quang'
      )
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'View all',
      })
    );

    expect(
      screen.getByRole('img', {
        name: /church spire/i,
      })
    ).toHaveAttribute('loading', 'lazy');

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Close photography gallery',
      })
    );

    expect(
      screen.queryByRole('dialog', {
        name: 'Photography by Quang',
      })
    ).not.toBeInTheDocument();
  });

  test('opens and closes the cars and technology gallery', () => {
    window.history.pushState({}, '', '/about');

    render(<App />);

    const carsCard = screen
      .getByRole('heading', {
        name: 'Cars & technology',
      })
      .closest('article');

    fireEvent.click(
      within(carsCard).getByRole('button', {
        name: 'View more',
      })
    );

    expect(
      screen.getByRole('dialog', {
        name: 'Cars & technology',
      })
    ).toBeInTheDocument();

    expect(
      screen.getByRole('img', {
        name: /computer hardware/i,
      })
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Close cars and technology gallery',
      })
    );

    expect(
      screen.queryByRole('dialog', {
        name: 'Cars & technology',
      })
    ).not.toBeInTheDocument();
  });
});
