import { act, fireEvent, render, screen } from '@testing-library/react';
import App from '../../App';

// The homepage is a lazy chunk: load it once, then let each render resolve it.
beforeAll(() => import('../pages/homePage'));
async function renderApp(ui = <App />) {
  let view;
  await act(async () => { view = render(ui); });
  return view;
}

const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

async function navigateFromAbout(hash) {
  window.history.replaceState({}, '', '/about');
  const view = await renderApp();
  expect(await screen.findByRole('heading', { name: 'Beyond software' })).toBeInTheDocument();

  view.unmount();
  window.history.pushState({}, '', `/${hash}`);
  await renderApp();
}

test('scrolls to Projects after navigating from About to the homepage hash', async () => {
  await navigateFromAbout('#projects');

  expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  expect(Element.prototype.scrollIntoView.mock.instances[0]).toHaveAttribute('id', 'projects');
});

test('scrolls to another homepage section after navigating from About', async () => {
  await navigateFromAbout('#contact');

  expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  expect(Element.prototype.scrollIntoView.mock.instances[0]).toHaveAttribute('id', 'contact');
});

test('a homepage URL without a hash keeps the normal top-of-page behavior', async () => {
  await renderApp();

  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
});

test('same-page hash links retain native anchor navigation', async () => {
  await renderApp();
  const link = screen.getByRole('link', { name: 'View my work' });

  expect(link).toHaveAttribute('href', '#projects');
  expect(screen.getByRole('region', { name: 'Featured projects' })).toBeInTheDocument();
  fireEvent.click(link);
});

test('a nonexistent homepage hash is ignored without errors', async () => {
  window.history.replaceState({}, '', '/#does-not-exist');

  await expect(renderApp()).resolves.toBeTruthy();
  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
});

describe('settling after the initial jump', () => {
  let observers;
  const originalResizeObserver = global.ResizeObserver;

  beforeEach(() => {
    observers = [];
    global.ResizeObserver = class {
      constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
      observe() {}
      disconnect() { this.disconnected = true; }
    };
  });

  afterEach(() => {
    global.ResizeObserver = originalResizeObserver;
    vi.useRealTimers();
  });

  const resize = () => observers.forEach((observer) => !observer.disconnected && observer.callback([]));

  test('re-aligns a project deep link when content above it changes size', async () => {
    window.history.replaceState({}, '', '/#project-flipper');
    await renderApp();
    resize();
    const calls = Element.prototype.scrollIntoView.mock;
    expect(calls.instances.map((element) => element.id)).toEqual(['project-flipper', 'project-flipper']);
    expect(calls.calls[1][0]).toEqual({ behavior: 'instant' });
  });

  test('stops re-aligning once the visitor scrolls', async () => {
    window.history.replaceState({}, '', '/#project-flipper');
    await renderApp();
    fireEvent.wheel(window);
    resize();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  test('stops re-aligning after the hash changes or the settle window ends', async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/#project-flipper');
    await renderApp();
    window.history.replaceState({}, '', '/#project-dashpilot');
    resize();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    window.history.replaceState({}, '', '/#project-flipper');
    vi.advanceTimersByTime(5000);
    resize();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  test('a StrictMode re-mount jumps once but keeps settling', async () => {
    const { StrictMode } = await import('react');
    window.history.replaceState({}, '', '/#project-scribekit');
    await renderApp(<StrictMode><App /></StrictMode>);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    resize();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(2);
  });
});
