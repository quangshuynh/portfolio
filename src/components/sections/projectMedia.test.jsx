import { fireEvent, render, screen, within } from '@testing-library/react';
import { HomeLightboxProvider } from '../utilities/homeLightbox';
import { projects } from '../../data/projects.mjs';
import FeaturedProjects from './featuredProjects';
import MoreProjects from './moreProjects';
import { ProjectGallery } from './projectMedia';

const project = (slug) => projects.find((entry) => entry.slug === slug);
const withLightbox = (ui) => render(<HomeLightboxProvider>{ui}</HomeLightboxProvider>);

test('a gallery starts on the logo and loads one screenshot per selected tab', () => {
  const flipper = project('flipper');
  withLightbox(<ProjectGallery project={flipper} />);
  const group = screen.getByRole('group', { name: 'Flipper gallery' });
  expect(within(group).getAllByRole('button').map((button) => button.textContent)).toEqual(['Logo', 'Dashboard', 'Research', 'Inventory', 'Sale']);

  const logo = screen.getByRole('img', { name: 'Flipper project logo' });
  expect(logo).toHaveAttribute('loading', 'lazy');
  // No screenshot is requested until its tab is chosen.
  expect(document.querySelectorAll('img[src*="cdn.jsdelivr.net"]')).toHaveLength(0);

  fireEvent.click(within(group).getByRole('button', { name: 'Research' }));
  expect(within(group).getByRole('button', { name: 'Research' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(group).getByRole('button', { name: 'Logo' })).toHaveAttribute('aria-pressed', 'false');
  const shot = screen.getByRole('img', { name: flipper.screenshots[1].alt });
  expect(shot).toHaveAttribute('src', flipper.screenshots[1].src);
  expect(shot).toHaveAttribute('loading', 'lazy');
  // Intrinsic size reserves the box before the image arrives.
  expect(shot).toHaveAttribute('width', '1600');
  expect(shot).toHaveAttribute('height', '1000');
  expect(document.querySelectorAll('img[src*="cdn.jsdelivr.net"]')).toHaveLength(1);
});

test('the enlarged view browses the whole screenshot set with the keyboard', () => {
  const scribekit = project('scribekit');
  withLightbox(<ProjectGallery project={scribekit} />);
  fireEvent.click(screen.getByRole('button', { name: 'Live' }));
  fireEvent.click(screen.getByRole('button', { name: `Open image: ${scribekit.screenshots[1].caption}` }));

  const dialog = screen.getByRole('dialog', { name: `Image viewer: ${scribekit.screenshots[1].caption}` });
  expect(within(dialog).getByText('2 of 4')).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'ArrowRight' });
  expect(within(dialog).getByRole('img', { name: scribekit.screenshots[2].alt })).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'ArrowLeft' });
  fireEvent.keyDown(document, { key: 'ArrowLeft' });
  expect(within(dialog).getByText('1 of 4')).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('a screenshot that fails to load becomes a labelled placeholder, not a broken button', () => {
  const gitprofilelens = project('gitprofilelens');
  withLightbox(<ProjectGallery project={gitprofilelens} />);
  fireEvent.click(screen.getByRole('button', { name: 'Results' }));
  fireEvent.error(screen.getByRole('img', { name: gitprofilelens.screenshots[0].alt }));

  const placeholder = screen.getByRole('img', { name: gitprofilelens.screenshots[0].alt });
  expect(placeholder.tagName).toBe('DIV');
  expect(placeholder).toHaveTextContent('Preview unavailable');
  expect(screen.queryByRole('button', { name: /Open image/ })).not.toBeInTheDocument();
  // The other tabs still work.
  fireEvent.click(screen.getByRole('button', { name: 'Logo' }));
  expect(screen.getByRole('img', { name: 'GitProfileLens project logo' })).toBeInTheDocument();
});

test('the image viewer explains a failed full-size image', () => {
  const ordixa = project('ordixa');
  withLightbox(<MoreProjects />);
  fireEvent.click(screen.getByRole('button', { name: `Open image: ${ordixa.screenshots[0].caption}` }));
  const dialog = screen.getByRole('dialog');
  fireEvent.error(within(dialog).getByRole('img', { name: ordixa.screenshots[0].alt }));
  expect(within(dialog).getByRole('status')).toHaveTextContent('This image could not be loaded.');
  // Browsing on still reaches the next screenshot.
  fireEvent.keyDown(document, { key: 'ArrowRight' });
  expect(within(dialog).getByRole('img', { name: ordixa.screenshots[1].alt })).toBeInTheDocument();
});

test('the Ordixa row shows its brand, positioning, honest status, and real screenshots', () => {
  withLightbox(<MoreProjects />);
  const row = screen.getByRole('heading', { level: 3, name: 'Ordixa' }).closest('article');
  expect(within(row).getByRole('img', { name: 'Ordixa logo' })).toBeInTheDocument();
  expect(row).toHaveTextContent('Business data workflows, simplified.');
  expect(row).toHaveTextContent(/fictional demo data/);
  expect(within(row).getByRole('link', { name: 'Open Ordixa repository' })).toHaveAttribute('href', 'https://github.com/quangshuynh/ordixa');
  expect(within(row).queryByRole('link', { name: /live demo/i })).not.toBeInTheDocument();
  expect(within(row).getByRole('list', { name: 'Ordixa technologies' })).toHaveTextContent(/Python.*pandas.*openpyxl/);
});

test('every rendered external link opens safely in a new tab', () => {
  withLightbox(<><FeaturedProjects /><MoreProjects /></>);
  fireEvent.click(screen.getByRole('button', { name: 'View more projects' }));
  const external = screen.getAllByRole('link').filter((link) => link.getAttribute('href').startsWith('http'));
  expect(external.length).toBeGreaterThan(15);
  external.forEach((link) => {
    expect(link.getAttribute('href')).toMatch(/^https:\/\//);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });
});
