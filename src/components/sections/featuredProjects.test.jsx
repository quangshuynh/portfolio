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
  expect(articles).toHaveLength(4);
  articles.forEach((article) => {
    ['.case-file__index', 'h3', '.case-file__meta > div:first-child .project-number', '.case-file__visual', '.project-purpose', '.project-highlights', '.case-file__meta .project-stack', '.project-actions']
      .forEach((selector) => expect(article.querySelector(selector), selector).not.toBeNull());
  });
});

test('phones order projects as title, type, screenshot, details, stack, actions', () => {
  const phone = mediaBlock(sectionsCss, '(max-width: 760px)');
  expect(phone).toMatch(/\.featured-project \.case-file__rail,\s*\.featured-project \.case-file__meta,\s*\.featured-project \.project-copy \{ display: contents; \}/);
  const order = [
    '.featured-project .case-file__index',
    '.featured-project .project-copy h3',
    '.featured-project .case-file__meta > div:first-child',
    '.featured-project .case-file__visual',
    '.featured-project .project-purpose',
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
