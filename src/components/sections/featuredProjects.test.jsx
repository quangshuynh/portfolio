import { fireEvent, render, screen, within } from '@testing-library/react';
import { featuredProjects } from '../../data/projects.mjs';
import sectionsCss from '../../styles/sections.css?raw';
import overlaysCss from '../../styles/overlays.css?raw';
import FeaturedProjects from './featuredProjects';

function mediaBlock(css, query) {
  const start = css.indexOf(`@media ${query} {`);
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  for (let index = css.indexOf('{', start); index < css.length; index++) {
    if (css[index] === '{') depth++;
    if (css[index] === '}' && --depth === 0) return css.slice(start, index + 1);
  }
  throw new Error(`Unclosed media block: ${query}`);
}

function flexOrder(block, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp(`${escaped}\\s*\\{[^}]*order:\\s*(\\d+)`));
  expect(match, `${selector} has a phone order`).not.toBeNull();
  return Number(match[1]);
}

test('every featured project exposes the parts the phone layout reorders', () => {
  render(<FeaturedProjects />);
  const articles = document.querySelectorAll('.featured-project');
  expect(articles).toHaveLength(6);
  articles.forEach((article) => {
    ['.case-file__index', 'h3', '.case-file__meta > div:first-child .project-number', '.case-file__visual', '.project-purpose', '.project-takeaway', '.project-details__toggle', '.project-highlights', '.case-file__meta .project-stack', '.project-actions']
      .forEach((selector) => expect(article.querySelector(selector), selector).not.toBeNull());
  });
});

test('phones order projects as title, type, screenshot, purpose, takeaway, details, stack, actions', () => {
  const phone = mediaBlock(sectionsCss, '(max-width: 760px)');
  expect(phone).toMatch(/\.featured-project \.case-file__rail,\s*\.featured-project \.case-file__meta,\s*\.featured-project \.project-copy \{ display: contents; \}/);
  const order = [
    '.featured-project .case-file__index',
    '.featured-project .project-copy h3',
    '.featured-project .case-file__meta > div:first-child',
    '.featured-project .case-file__visual',
    '.featured-project .project-purpose',
    '.featured-project .project-takeaway',
    '.featured-project .project-details',
    '.featured-project .project-stack',
    '.featured-project .project-actions',
  ].map((selector) => flexOrder(phone, selector));
  expect(order).toEqual([...order].sort((first, second) => first - second));
  expect(new Set(order).size).toBe(order.length);
  // Desktop composition keeps the rail/visual/copy grid areas.
  expect(sectionsCss.slice(0, sectionsCss.indexOf('/* ============ responsive'))).not.toMatch(/display: contents/);
});

test('phone modal galleries use two columns of 3:4 portrait and 4:3 landscape cells', () => {
  const phone = mediaBlock(overlaysCss, '(max-width: 620px)');
  expect(phone).toMatch(/\.photography-gallery \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); grid-auto-rows: auto;/);
  expect(phone).toMatch(/\.photography-gallery figure \{ aspect-ratio: 4 \/ 3; \}/);
  expect(phone).toMatch(/\.photography-gallery-portrait \{ grid-row: auto; aspect-ratio: 3 \/ 4; \}/);
  expect(phone).toMatch(/\.photography-gallery figcaption \{[^}]*-webkit-line-clamp: 2;/);
});

test('featured cards cannot be widened past the column by their gallery tabs', () => {
  // An implicit `auto` track let five gallery tabs stretch every card to ~460px on a 375px phone.
  expect(sectionsCss).toMatch(/\.featured-list \{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
  const phone = mediaBlock(sectionsCss, '(max-width: 620px)');
  expect(phone).toMatch(/\.gallery-controls \{[^}]*flex-wrap: wrap;/);
});

test('gallery tab sets are named groups of toggle buttons', () => {
  const { getAllByRole } = render(<FeaturedProjects />);
  const groups = getAllByRole('group', { name: /gallery$/ });
  expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual([
    'DashPilot gallery', 'ScribeKit gallery', 'Flipper gallery', 'PuzzlePress gallery', 'GitProfileLens gallery',
  ]);
  groups.forEach((group) => {
    const pressed = [...group.querySelectorAll('button')].filter((button) => button.getAttribute('aria-pressed') === 'true');
    expect(pressed).toHaveLength(1);
  });
});

test('projects keep their order and each pairs its purpose with an engineering takeaway', () => {
  const { getAllByRole } = render(<FeaturedProjects />);
  const articles = getAllByRole('article');
  expect(articles.map((article) => article.querySelector('h3').textContent)).toEqual([
    '585Dashcam585', 'DashPilot', 'ScribeKit', 'Flipper', 'PuzzlePress', 'GitProfileLens',
  ]);
  expect(articles.map((article) => article.querySelector('.project-takeaway').textContent)).toEqual([
    'Takeaway Production checkout and order processing with reliable payment finalization.',
    'Takeaway Reliable shift and delivery tracking without cloud accounts or platform integrations.',
    'Takeaway On-device transcription designed to preserve work through interruptions.',
    'Takeaway Exact financial accounting from deal research through realized profit.',
    'Takeaway Deterministic, independently verified print output from structured book content.',
    'Takeaway Explainable GitHub portfolio analysis with strict privacy boundaries.',
  ]);
  articles.forEach((article) => {
    const purpose = article.querySelector('.project-purpose');
    expect(purpose.nextElementSibling).toHaveClass('project-takeaway');
  });
});

test('each project is a named, deep-linkable article whose title links to itself', () => {
  const { getByRole } = render(<FeaturedProjects />);
  for (const [name, slug] of [['585Dashcam585', '585dashcam585'], ['DashPilot', 'dashpilot'], ['ScribeKit', 'scribekit'], ['Flipper', 'flipper'], ['PuzzlePress', 'puzzlepress'], ['GitProfileLens', 'gitprofilelens']]) {
    const article = getByRole('article', { name });
    expect(article).toHaveAttribute('id', `project-${slug}`);
    // The heading's accessible name stays the bare project name.
    expect(getByRole('heading', { level: 3, name })).toBeInTheDocument();
    expect(getByRole('link', { name })).toHaveAttribute('href', `#project-${slug}`);
  }
});

test('technical details start collapsed behind a labelled, inert disclosure', () => {
  render(<FeaturedProjects />);
  const toggles = screen.getAllByRole('button', { name: 'Explore technical details' });
  expect(toggles).toHaveLength(featuredProjects.length);
  toggles.forEach((toggle, index) => {
    const { slug, name } = featuredProjects[index];
    const panel = document.getElementById(toggle.getAttribute('aria-controls'));
    expect(toggle).toHaveAttribute('type', 'button');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Six identical labels: each is described by its project title for context.
    expect(toggle).toHaveAccessibleDescription(name);
    expect(panel).toHaveAttribute('id', `project-${slug}-details`);
    expect(panel).toHaveAttribute('inert');
    expect(panel.closest('article')).toHaveAttribute('id', `project-${slug}`);
  });
});

test('each project expands and collapses its own details without losing a bullet', () => {
  render(<FeaturedProjects />);
  const [first, second] = screen.getAllByRole('article');
  const toggle = within(first).getByRole('button', { name: 'Explore technical details' });
  toggle.focus();
  fireEvent.click(toggle);

  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(toggle).toHaveTextContent('Hide technical details');
  expect(document.activeElement).toBe(toggle);
  const panel = document.getElementById(toggle.getAttribute('aria-controls'));
  expect(panel).not.toHaveAttribute('inert');
  expect(within(panel).getAllByRole('listitem').map((item) => item.textContent)).toEqual(featuredProjects[0].highlights);
  // Siblings stay collapsed.
  expect(within(second).getByRole('button', { name: 'Explore technical details' })).toHaveAttribute('aria-expanded', 'false');

  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(panel).toHaveAttribute('inert');
});

test('every highlight remains in the markup while collapsed', () => {
  render(<FeaturedProjects />);
  screen.getAllByRole('article').forEach((article, index) => {
    const items = [...article.querySelectorAll('.project-highlights li')].map((item) => item.textContent);
    expect(items).toEqual(featuredProjects[index].highlights);
  });
});

test('toggling details leaves gallery tabs and project links untouched', () => {
  render(<FeaturedProjects />);
  const article = screen.getByRole('article', { name: 'DashPilot' });
  const gallery = within(article).getByRole('group', { name: 'DashPilot gallery' });
  const tab = within(gallery).getAllByRole('button')[1];
  fireEvent.click(tab);
  expect(tab).toHaveAttribute('aria-pressed', 'true');
  const links = within(article).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')]);

  fireEvent.click(within(article).getByRole('button', { name: 'Explore technical details' }));
  expect(tab).toHaveAttribute('aria-pressed', 'true');
  expect(within(article).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual(links);
});

test('the disclosure animates with the shared motion tokens', () => {
  expect(sectionsCss).toMatch(/\.project-details__panel \{[^}]*grid-template-rows: 0fr;[^}]*visibility: hidden;[^}]*var\(--dur-base\) var\(--ease-out\)/);
  expect(sectionsCss).toMatch(/\.project-details\.is-open \.project-details__panel \{[^}]*grid-template-rows: 1fr;[^}]*visibility: visible;/);
  expect(sectionsCss).toMatch(/\.project-details\.is-open \.project-details__chevron \{ transform: rotate\(180deg\); \}/);
});
