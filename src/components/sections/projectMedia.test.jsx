import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HomeLightboxProvider } from '../utilities/homeLightbox';
import { isPinnedGithubAsset, pinnedAssetUrl } from '../../data/githubAssets.mjs';
import { featuredProjects, projects } from '../../data/projects.mjs';
import FeaturedProjects from './featuredProjects';
import MoreProjects from './moreProjects';
import { ProjectGallery, ProjectScreenshot, ProjectVisual } from './projectMedia';

const project = (slug) => projects.find((entry) => entry.slug === slug);
const withLightbox = (ui) => render(<HomeLightboxProvider>{ui}</HomeLightboxProvider>);
const remoteImages = () => document.querySelectorAll('img[src*="cdn.jsdelivr.net"]');

// Independent of src/data/projects.mjs, so replacing a real screenshot never
// touches these expectations. Every capture has a different size, which would
// expose a gallery that showed the wrong entry or swapped width and height.
const fixturePin = { owner: 'example', repo: 'fixture', commit: 'c'.repeat(40) };
const fixture = {
  slug: 'fixture',
  name: 'Fixture',
  featured: true,
  logo: { file: 'flipper-logo', width: 780, height: 780, alt: 'Fixture logo' },
  screenshots: [
    { src: pinnedAssetUrl(fixturePin, 'docs/images/one.png'), width: 1200, height: 750, label: 'One', alt: 'First fixture screen', caption: 'Fixture one' },
    { src: pinnedAssetUrl(fixturePin, 'docs/images/two.png'), width: 2880, height: 1800, label: 'Two', alt: 'Second fixture screen', caption: 'Fixture two' },
    { src: pinnedAssetUrl(fixturePin, 'docs/images/three.png'), width: 900, height: 1600, label: 'Three', alt: 'Third fixture screen', caption: 'Fixture three' },
  ],
};

describe('gallery (fixture data)', () => {
  test('starts on the logo and requests no screenshot until a tab is chosen', () => {
    withLightbox(<ProjectGallery project={fixture} />);
    const group = screen.getByRole('group', { name: 'Fixture gallery' });
    expect(within(group).getAllByRole('button').map((button) => button.textContent)).toEqual(['Logo', 'One', 'Two', 'Three']);
    expect(within(group).getByRole('button', { name: 'Logo' })).toHaveAttribute('aria-pressed', 'true');

    const logo = screen.getByRole('img', { name: 'Fixture logo' });
    expect(logo).toHaveAttribute('loading', 'lazy');
    expect(logo).toHaveAttribute('width', '780');
    expect(remoteImages()).toHaveLength(0);
  });

  test('each tab shows its own screenshot at its own intrinsic size, one image at a time', () => {
    withLightbox(<ProjectGallery project={fixture} />);
    const group = screen.getByRole('group', { name: 'Fixture gallery' });
    const expected = [
      ['One', 'docs/images/one.png', '1200', '750'],
      ['Two', 'docs/images/two.png', '2880', '1800'],
      ['Three', 'docs/images/three.png', '900', '1600'],
    ];
    for (const [label, path, width, height] of expected) {
      fireEvent.click(within(group).getByRole('button', { name: label }));
      expect(within(group).getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
      expect(within(group).getAllByRole('button').filter((button) => button.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
      const [shot] = remoteImages();
      expect(remoteImages()).toHaveLength(1);
      expect(shot.getAttribute('src')).toMatch(new RegExp(`/${path}$`));
      // Intrinsic size reserves the box before the lazy image arrives.
      expect(shot).toHaveAttribute('width', width);
      expect(shot).toHaveAttribute('height', height);
      expect(shot).toHaveAttribute('loading', 'lazy');
      expect(shot).toHaveAttribute('decoding', 'async');
    }
  });

  test('tabs are reachable and operable from the keyboard', () => {
    withLightbox(<ProjectGallery project={fixture} />);
    // Logo tab, then the screenshot tabs; the logo slide itself is not focusable.
    userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Logo' }));
    userEvent.tab();
    userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Two' }));
    userEvent.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Two' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('img', { name: 'Second fixture screen' })).toBeInTheDocument();

    userEvent.tab({ shift: true });
    userEvent.keyboard(' ');
    expect(screen.getByRole('button', { name: 'One' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('img', { name: 'First fixture screen' })).toBeInTheDocument();
  });

  test('the enlarged view browses the whole screenshot set with the keyboard, wrapping at both ends', () => {
    withLightbox(<ProjectGallery project={fixture} />);
    fireEvent.click(screen.getByRole('button', { name: 'Two' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open image: Fixture two' }));

    const dialog = screen.getByRole('dialog', { name: 'Image viewer: Fixture two' });
    expect(within(dialog).getByText('2 of 3')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(within(dialog).getByRole('img', { name: 'Third fixture screen' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(within(dialog).getByText('1 of 3')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(within(dialog).getByText('3 of 3')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('a screenshot that fails to load becomes a labelled placeholder, not a broken button', () => {
    withLightbox(<ProjectGallery project={fixture} />);
    fireEvent.click(screen.getByRole('button', { name: 'One' }));
    fireEvent.error(screen.getByRole('img', { name: 'First fixture screen' }));

    const placeholder = screen.getByRole('img', { name: 'First fixture screen' });
    expect(placeholder.tagName).toBe('DIV');
    expect(placeholder).toHaveTextContent('Preview unavailable');
    expect(screen.queryByRole('button', { name: /Open image/ })).not.toBeInTheDocument();
    // The other tabs still work.
    fireEvent.click(screen.getByRole('button', { name: 'Logo' }));
    expect(screen.getByRole('img', { name: 'Fixture logo' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Three' }));
    expect(screen.getByRole('button', { name: 'Open image: Fixture three' })).toBeInTheDocument();
  });

  test('the image viewer explains a failed full-size image and still browses on', () => {
    withLightbox(<ProjectScreenshot project={fixture} index={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open image: Fixture one' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.error(within(dialog).getByRole('img', { name: 'First fixture screen' }));
    expect(within(dialog).getByRole('status')).toHaveTextContent('This image could not be loaded.');
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(within(dialog).getByRole('img', { name: 'Second fixture screen' })).toBeInTheDocument();
  });

  test('without a logo a project shows its first screenshot alone; with only a logo, the logo', () => {
    const { unmount } = withLightbox(<ProjectVisual project={{ ...fixture, logo: undefined }} />);
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'First fixture screen' })).toHaveAttribute('width', '1200');
    unmount();

    withLightbox(<ProjectVisual project={{ ...fixture, screenshots: undefined }} />);
    expect(screen.getByRole('img', { name: 'Fixture logo' })).toBeInTheDocument();
    expect(remoteImages()).toHaveLength(0);
  });
});

describe('gallery (real project data)', () => {
  test('rendered Flipper dimensions come from its metadata', () => {
    const flipper = project('flipper');
    withLightbox(<ProjectGallery project={flipper} />);
    const group = screen.getByRole('group', { name: 'Flipper gallery' });
    fireEvent.click(within(group).getByRole('button', { name: flipper.screenshots[1].label }));
    const shot = screen.getByRole('img', { name: flipper.screenshots[1].alt });
    expect(shot).toHaveAttribute('src', flipper.screenshots[1].src);
    expect(shot).toHaveAttribute('width', String(flipper.screenshots[1].width));
    expect(shot).toHaveAttribute('height', String(flipper.screenshots[1].height));
  });

  const galleries = featuredProjects.filter((entry) => entry.logo && entry.screenshots?.length);

  test.each(galleries.map((entry) => [entry.name, entry]))('every %s tab renders its screenshot at its recorded size', (_, entry) => {
    withLightbox(<ProjectGallery project={entry} />);
    const group = screen.getByRole('group', { name: `${entry.name} gallery` });
    expect(within(group).getAllByRole('button').map((button) => button.textContent)).toEqual(['Logo', ...entry.screenshots.map((shot) => shot.label)]);
    entry.screenshots.forEach((shot) => {
      expect(Number.isInteger(shot.width) && shot.width > 0, `${shot.label} width`).toBe(true);
      expect(Number.isInteger(shot.height) && shot.height > 0, `${shot.label} height`).toBe(true);
      expect(isPinnedGithubAsset(shot.src), shot.src).toBe(true);
      fireEvent.click(within(group).getByRole('button', { name: shot.label }));
      const image = screen.getByRole('img', { name: shot.alt });
      expect(image).toHaveAttribute('src', shot.src);
      expect(image).toHaveAttribute('width', String(shot.width));
      expect(image).toHaveAttribute('height', String(shot.height));
      expect(image).toHaveAttribute('loading', 'lazy');
    });
  });
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
  const ordixa = project('ordixa');
  expect(within(row).getByRole('img', { name: ordixa.screenshots[0].alt })).toHaveAttribute('width', String(ordixa.screenshots[0].width));
});

test('every rendered external link opens safely in a new tab', () => {
  withLightbox(<><FeaturedProjects /><MoreProjects /></>);
  fireEvent.click(screen.getByRole('button', { name: 'View more projects' }));
  const external = screen.getAllByRole('link').filter((link) => link.getAttribute('href').startsWith('http'));
  // Every project has at least one repository or live link.
  expect(external.length).toBeGreaterThanOrEqual(featuredProjects.length + projects.filter((entry) => !entry.featured && !entry.hidden).length);
  external.forEach((link) => {
    expect(link.getAttribute('href')).toMatch(/^https:\/\//);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });
});
