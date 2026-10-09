import { fireEvent, render, screen } from '@testing-library/react';
import App from '../../App';

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
  const view = render(<App />);
  expect(await screen.findByRole('heading', { name: 'Beyond software' })).toBeInTheDocument();

  view.unmount();
  window.history.pushState({}, '', `/${hash}`);
  render(<App />);
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

test('a homepage URL without a hash keeps the normal top-of-page behavior', () => {
  render(<App />);

  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
});

test('same-page hash links retain native anchor navigation', () => {
  render(<App />);
  const link = screen.getByRole('link', { name: 'View my work' });

  expect(link).toHaveAttribute('href', '#projects');
  expect(screen.getByRole('region', { name: 'Featured projects' })).toBeInTheDocument();
  fireEvent.click(link);
});

test('a nonexistent homepage hash is ignored without errors', () => {
  window.history.replaceState({}, '', '/#does-not-exist');

  expect(() => render(<App />)).not.toThrow();
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

  test('re-aligns a project deep link when content above it changes size', () => {
    window.history.replaceState({}, '', '/#project-flipper');
    render(<App />);
    resize();
    const calls = Element.prototype.scrollIntoView.mock;
    expect(calls.instances.map((element) => element.id)).toEqual(['project-flipper', 'project-flipper']);
    expect(calls.calls[1][0]).toEqual({ behavior: 'instant' });
  });

  test('stops re-aligning once the visitor scrolls', () => {
    window.history.replaceState({}, '', '/#project-flipper');
    render(<App />);
    fireEvent.wheel(window);
    resize();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  test('stops re-aligning after the hash changes or the settle window ends', () => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/#project-flipper');
    render(<App />);
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
    render(<StrictMode><App /></StrictMode>);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    resize();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(2);
  });
});
