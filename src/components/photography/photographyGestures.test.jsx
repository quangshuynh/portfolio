import { act, render, screen } from '@testing-library/react';
import App from '../../App';
import { photographs, sortPhotographs } from '../../data/photographs';
import { photographyHref } from '../../util/navigation';
import { MAX_ZOOM, resetPhotographyPreloadsForTests, zoomAround } from './photographyLightbox';

const ordered = sortPhotographs(photographs);

async function open(photograph) {
  window.history.replaceState({}, '', photographyHref(photograph.slug));
  render(<App />);
  await screen.findByRole('dialog', { name: new RegExp(photograph.caption.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
  const stage = document.querySelector('.photography-lightbox-image-wrap');
  // A 400 × 300 stage at (100, 50) with the image filling it.
  stage.getBoundingClientRect = () => ({ left: 100, top: 50, width: 400, height: 300, right: 500, bottom: 350, x: 100, y: 50 });
  Object.defineProperty(stage.querySelector('img'), 'offsetWidth', { configurable: true, get: () => 400 });
  Object.defineProperty(stage.querySelector('img'), 'offsetHeight', { configurable: true, get: () => 300 });
  return stage;
}
const touch = (type, target, id, x, y, timeStamp = 0) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  // Event times as a browser gives them (one clock for the taps and the dblclick after them).
  Object.assign(event, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, button: 0, isPrimary: id === 1 });
  Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  act(() => { target.dispatchEvent(event); });
};
const shownScale = () => screen.getByRole('button', { name: 'Reset zoom' }).textContent;
const transform = (stage) => stage.querySelector('img').style.transform;

beforeEach(() => {
  resetPhotographyPreloadsForTests();
  window.history.replaceState({}, '', '/photography/');
  document.documentElement.classList.remove('overlay-open', 'layout-changing');
  document.body.removeAttribute('style');
});

test('zooming keeps the image point under the gesture in place, within 1×–5×', () => {
  const view = { scale: 2, position: { x: 30, y: -10 } };
  const point = { x: 80, y: 40 };
  const next = zoomAround(view, 3, point);
  // The image point under `point` (from the centre): (point − position) / scale, before and after.
  const before = { x: (point.x - view.position.x) / view.scale, y: (point.y - view.position.y) / view.scale };
  expect((point.x - next.position.x) / next.scale).toBeCloseTo(before.x, 10);
  expect((point.y - next.position.y) / next.scale).toBeCloseTo(before.y, 10);
  expect(zoomAround(view, 50, point).scale).toBe(MAX_ZOOM);
  expect(zoomAround(view, 0.2, point).scale).toBe(1);
  // With a moving midpoint the same image point follows it (a pinch that also pans).
  const moved = zoomAround(view, 3, point, { x: 100, y: 60 });
  expect((100 - moved.position.x) / 3).toBeCloseTo(before.x, 10);
});

test('two fingers pinch-zoom the gallery photograph; lifting one pans; a double tap zooms and resets', async () => {
  const stage = await open(ordered[0]);
  expect(shownScale()).toBe('100%');
  // Fingers 100 px apart around the centre (300, 200) spread to 200 px: 2×.
  touch('pointerdown', stage, 1, 250, 200);
  touch('pointerdown', stage, 2, 350, 200);
  touch('pointermove', stage, 1, 200, 200);
  touch('pointermove', stage, 2, 400, 200);
  expect(shownScale()).toBe('200%');
  expect(transform(stage)).toContain('scale(2)');
  // Lifting one finger continues as a one-finger pan, kept inside the photo's bounds.
  touch('pointerup', stage, 2, 400, 200);
  touch('pointermove', stage, 1, 260, 230);
  expect(transform(stage)).toMatch(/translate3d\(60px, 30px, 0\)/);
  touch('pointermove', stage, 1, 2000, 2000);
  // At 2× a 400 × 300 image can move at most 200 × 150 px from the centre.
  expect(transform(stage)).toMatch(/translate3d\(200px, 150px, 0\)/);
  touch('pointerup', stage, 1, 2000, 2000);
  // A double tap when zoomed returns to the fit.
  touch('pointerdown', stage, 3, 300, 200, 1000);
  touch('pointerup', stage, 3, 300, 200, 1050);
  touch('pointerdown', stage, 4, 302, 201, 1200);
  touch('pointerup', stage, 4, 302, 201, 1250);
  expect(shownScale()).toBe('100%');
  // …and at the fit zooms in around the tap: a tap right of centre moves the image left.
  touch('pointerdown', stage, 5, 400, 200, 3000);
  touch('pointerup', stage, 5, 400, 200, 3050);
  touch('pointerdown', stage, 6, 400, 200, 3200);
  touch('pointerup', stage, 6, 400, 200, 3250);
  expect(shownScale()).toBe('250%');
  expect(transform(stage)).toMatch(/translate3d\(-150px, 0px, 0\)/);
  // The dblclick a browser may send after the taps does not undo it.
  touch('dblclick', stage, 6, 400, 200, 3260);
  expect(shownScale()).toBe('250%');
  // A mouse double-click later still toggles.
  touch('dblclick', stage, 1, 400, 200, 9000);
  expect(shownScale()).toBe('100%');
  // Two slow taps are not a double tap.
  touch('pointerdown', stage, 7, 300, 200, 5000);
  touch('pointerup', stage, 7, 300, 200, 5050);
  touch('pointerdown', stage, 8, 300, 200, 5600);
  touch('pointerup', stage, 8, 300, 200, 5650);
  expect(shownScale()).toBe('100%');
});

test('a pinch never navigates, and next and previous still work after zooming', async () => {
  const stage = await open(ordered[1]);
  touch('pointerdown', stage, 1, 280, 200);
  touch('pointerdown', stage, 2, 320, 200);
  touch('pointermove', stage, 2, 400, 200);
  touch('pointerup', stage, 1, 280, 200);
  touch('pointerup', stage, 2, 400, 200);
  const at = () => window.location.pathname + window.location.hash;
  expect(at()).toBe(photographyHref(ordered[1].slug));
  act(() => { screen.getByRole('button', { name: 'Next photograph' }).click(); });
  expect(at()).toBe(photographyHref(ordered[2].slug));
  // A new photograph starts at the fit.
  expect(shownScale()).toBe('100%');
});
