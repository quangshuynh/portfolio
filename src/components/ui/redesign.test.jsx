import { fireEvent, render, screen, within } from '@testing-library/react';
import SpotifyDisc, { SPOTIFY_DISC_LABEL } from './spotifyDisc';
import ThemeToggle from './themeToggle';
import SiteNav from '../sections/siteNav';
import AboutPage from '../pages/aboutPage';
import { formatExposure } from '../pages/photographyPage';
import { resetSpotifyCacheForTests } from '../about/aboutGallery';
import { contourRings } from './terrain';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  resetSpotifyCacheForTests();
  document.documentElement.removeAttribute('data-theme');
  localStorage.clear();
});

test('the Spotify disc is decorative, labelled, and never fetches by itself', () => {
  global.fetch = vi.fn();
  render(<SpotifyDisc href="/about#music" />);
  const link = screen.getByRole('link', { name: SPOTIFY_DISC_LABEL });
  expect(link).toHaveAttribute('href', '/about#music');
  expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  expect(link.querySelector('textPath')).toHaveTextContent(/recently played/i);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('two discs on one page use distinct ring paths', () => {
  render(<><SpotifyDisc href="#a" label="First" /><SpotifyDisc href="#b" label="Second" /></>);
  const ids = [...document.querySelectorAll('.spotify-disc defs path')].map((path) => path.id);
  expect(new Set(ids).size).toBe(2);
  document.querySelectorAll('textPath').forEach((textPath, index) => {
    expect(textPath.getAttribute('href')).toBe(`#${ids[index]}`);
  });
});

test('/about#music opens the listening panel directly', async () => {
  global.fetch = vi.fn().mockRejectedValue(new Error('offline'));
  window.history.pushState({}, '', '/about#music');
  render(<AboutPage />);
  expect(screen.getByRole('dialog', { name: 'What I’ve been listening to' })).toBeInTheDocument();
  expect(await screen.findByText('Couldn’t load recent listening')).toBeInTheDocument();
});

test('the Music card disc opens the same listening panel', () => {
  global.fetch = vi.fn().mockRejectedValue(new Error('offline'));
  window.history.pushState({}, '', '/about');
  render(<AboutPage />);
  const musicCard = screen.getByRole('heading', { name: 'Music' }).closest('article');
  fireEvent.click(within(musicCard).getByRole('button', { name: SPOTIFY_DISC_LABEL }));
  expect(screen.getByRole('dialog', { name: 'What I’ve been listening to' })).toBeInTheDocument();
});

test('theme toggle persists the choice and updates the theme colour', () => {
  document.head.insertAdjacentHTML('beforeend', '<meta name="theme-color" content="#000000">');
  render(<ThemeToggle />);
  fireEvent.click(screen.getByRole('button', { name: 'Switch to light mode' }));
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(localStorage.getItem('portfolio-theme')).toBe('light');
  expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#f1ede3');
});

test('primary navigation points About at the homepage section and keeps Photography contextual', () => {
  render(<SiteNav current="about" />);
  const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
  expect(within(nav).getByRole('link', { name: 'About' })).toHaveAttribute('href', '/#about');
  expect(within(nav).queryByRole('link', { name: 'Photography' })).not.toBeInTheDocument();
  expect(within(nav).getByRole('link', { name: /Résumé/ })).toHaveAttribute('href', '/Quang_Huynh_Resume.pdf');
  const menu = within(nav).getByRole('button', { name: 'Menu' });
  expect(menu).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(menu);
  expect(within(nav).getByRole('button', { name: 'Close' })).toHaveAttribute('aria-expanded', 'true');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(within(nav).getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false');
});

test('the header expands at the top and reports compact progress as the page scrolls', () => {
  window.scrollY = 0;
  const { container } = render(<SiteNav current="home" />);
  const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
  expect(container.firstChild).toHaveClass('nav-slot');
  expect(nav).toHaveClass('site-nav--collapsible');
  expect(nav.style.getPropertyValue('--nav-progress')).toBe('0.000');
});

test('photography keeps a compact, non-collapsing header', () => {
  render(<SiteNav variant="photography" current="photography" />);
  expect(screen.getByRole('navigation', { name: 'Primary navigation' })).not.toHaveClass('site-nav--collapsible');
});

test('exposure notes only include populated EXIF fields', () => {
  expect(formatExposure({ focalLength: 55, aperture: 8, shutterSpeed: 0.004, iso: 100 })).toBe('55mm · f/8 · 1/250 · ISO 100');
  expect(formatExposure({ aperture: 2.8 })).toBe('f/2.8');
  expect(formatExposure({})).toBe('');
});

test('terrain contours are deterministic', () => {
  const options = { cx: 100, cy: 100, rings: 3, baseRadius: 10, step: 10, seed: 5 };
  expect(contourRings(options)).toEqual(contourRings(options));
  expect(contourRings(options)[0]).toMatch(/^M[\d.-]+ [\d.-]+C/);
});

test('contact names the roles and areas of interest and offers the résumé alongside other contact methods', async () => {
  const { default: Footer } = await import('../sections/footer');
  render(<Footer />);
  expect(screen.getByText(/software engineering internships and co-op opportunities, especially\s+in backend systems, full-stack development, automation, and developer tooling/)).toBeInTheDocument();
  const contact = document.getElementById('contact');
  for (const name of [/Email me/, /GitHub/, /LinkedIn/, /Résumé \(PDF, opens in a new tab\)/]) {
    expect(within(contact).getByRole('link', { name })).toBeInTheDocument();
  }
  expect(within(contact).getByRole('link', { name: /Résumé/ })).toHaveAttribute('href', '/Quang_Huynh_Resume.pdf');
});

test('at 320px the menu button collapses to an icon but keeps its text as the accessible name', async () => {
  const { default: navCss } = await import('../../styles/nav.css?raw');
  const block = navCss.slice(navCss.indexOf('@media (max-width: 360px)'));
  expect(block).toMatch(/\.nav-menu-button \{[^}]*width: 2\.75rem;/);
  expect(block).toMatch(/\.nav-menu-button__label \{[^}]*clip: rect\(0 0 0 0\);/);
  render(<SiteNav />);
  expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false');
});
