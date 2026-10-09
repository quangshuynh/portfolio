import { render } from '@testing-library/react';
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
  expect(articles).toHaveLength(5);
  articles.forEach((article) => {
    ['.case-file__index', 'h3', '.case-file__meta > div:first-child .project-number', '.case-file__visual', '.project-purpose', '.project-takeaway', '.project-highlights', '.case-file__meta .project-stack', '.project-actions']
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
    '.featured-project .project-highlights',
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
    'Flipper gallery', 'GitProfileLens gallery', 'ScribeKit gallery', 'DashPilot gallery',
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
    '585Dashcam585', 'Flipper', 'GitProfileLens', 'ScribeKit', 'DashPilot',
  ]);
  expect(articles.map((article) => article.querySelector('.project-takeaway').textContent)).toEqual([
    'Takeaway Production checkout and order processing with reliable payment finalization.',
    'Takeaway Exact financial accounting from deal research through realized profit.',
    'Takeaway Explainable GitHub portfolio analysis with strict privacy boundaries.',
    'Takeaway On-device transcription designed to preserve work through interruptions.',
    'Takeaway Reliable shift and delivery tracking without cloud accounts or platform integrations.',
  ]);
  articles.forEach((article) => {
    const purpose = article.querySelector('.project-purpose');
    expect(purpose.nextElementSibling).toHaveClass('project-takeaway');
  });
});

test('each project is a named, deep-linkable article whose title links to itself', () => {
  const { getByRole } = render(<FeaturedProjects />);
  for (const [name, slug] of [['585Dashcam585', '585dashcam585'], ['Flipper', 'flipper'], ['GitProfileLens', 'gitprofilelens'], ['ScribeKit', 'scribekit'], ['DashPilot', 'dashpilot']]) {
    const article = getByRole('article', { name });
    expect(article).toHaveAttribute('id', `project-${slug}`);
    // The heading's accessible name stays the bare project name.
    expect(getByRole('heading', { level: 3, name })).toBeInTheDocument();
    expect(getByRole('link', { name })).toHaveAttribute('href', `#project-${slug}`);
  }
});
