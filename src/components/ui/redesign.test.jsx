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

test('route navigation marks the current page and exposes résumé and menu controls', () => {
  render(<SiteNav current="photography" />);
  const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
  expect(within(nav).getByRole('link', { name: 'Photography' })).toHaveAttribute('aria-current', 'page');
  expect(within(nav).getByRole('link', { name: 'About' })).not.toHaveAttribute('aria-current');
  expect(within(nav).getByRole('link', { name: /Résumé/ })).toHaveAttribute('href', '/Quang_Huynh_Resume.pdf');
  const menu = within(nav).getByRole('button', { name: 'Menu' });
  expect(menu).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(menu);
  expect(within(nav).getByRole('button', { name: 'Close' })).toHaveAttribute('aria-expanded', 'true');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(within(nav).getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false');
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
