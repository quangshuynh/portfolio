import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { currentLocation, currentState, isTraversing, locationChangeEvent, navigate, navigateBack, resetHistorySync } from './navigation';

const refuse = () => {
  throw new DOMException('Attempt to use history.pushState() more than 100 times per 10 seconds', 'SecurityError');
};
// Writes with their (fake) times, still applied to jsdom's history.
const recordWrites = () => {
  const writes = [];
  for (const name of ['pushState', 'replaceState']) {
    const original = window.history[name].bind(window.history);
    vi.spyOn(window.history, name).mockImplementation((...args) => { writes.push({ name, at: Date.now(), href: args[2] }); return original(...args); });
  }
  return writes;
};
const busiestTenSeconds = (writes) => Math.max(0, ...writes.map(({ at }) => writes.filter((write) => write.at >= at && write.at < at + 10_000).length));
const popstate = () => window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  window.history.replaceState({}, '', '/photography/');
  resetHistorySync();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  resetHistorySync();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test('a burst of steps writes at once, then coalesces into trailing writes of the latest location', () => {
  const writes = recordWrites();
  for (let step = 0; step < 300; step += 1) {
    navigate(`/photography/#p${step}`, { replace: true });
    vi.advanceTimersByTime(30); // a held key repeats about 33 times a second
  }
  vi.advanceTimersByTime(1000);
  expect(currentLocation().hash).toBe('#p299');
  expect(window.location.hash).toBe('#p299');
  expect(busiestTenSeconds(writes)).toBeLessThanOrEqual(60);
  expect(writes.length).toBeLessThan(80);
  // Writes go out in order: none of them is older than the one before.
  const steps = writes.map(({ href }) => Number(href.split('#p')[1]));
  expect(steps).toEqual([...steps].sort((a, b) => a - b));
});

test('the same budget holds for hundreds of steps over a minute', () => {
  const writes = recordWrites();
  for (let step = 0; step < 1200; step += 1) {
    navigate(`/photography/#p${step}`, { replace: true });
    vi.advanceTimersByTime(50);
  }
  vi.advanceTimersByTime(1000);
  expect(busiestTenSeconds(writes)).toBeLessThanOrEqual(60);
  expect(window.location.hash).toBe('#p1199');
});

test('a refused write still moves the app, is retried, and lands as one entry', () => {
  const changes = vi.fn();
  window.addEventListener(locationChangeEvent, changes);
  const push = vi.spyOn(window.history, 'pushState').mockImplementation(refuse);
  const replace = vi.spyOn(window.history, 'replaceState').mockImplementation(refuse);

  navigate('/photography/#a');
  navigate('/photography/#b', { replace: true });

  expect(changes).toHaveBeenCalledTimes(2);
  expect(currentLocation()).toEqual({ pathname: '/photography/', search: '', hash: '#b' });
  expect(window.location.hash).toBe('');
  expect(console.warn).toHaveBeenCalledTimes(1);

  vi.advanceTimersByTime(1000);
  expect(push).toHaveBeenCalledTimes(2); // still refused; keeps retrying

  push.mockRestore();
  replace.mockRestore();
  const pushSpy = vi.spyOn(window.history, 'pushState');
  vi.advanceTimersByTime(1000);
  // The refused push still owes its history entry, written with the latest location.
  expect(pushSpy).toHaveBeenCalledTimes(1);
  expect(window.location.hash).toBe('#b');
  expect(currentLocation().hash).toBe('#b');
  window.removeEventListener(locationChangeEvent, changes);
});

test('browser Back or Forward discards a pending write', () => {
  vi.spyOn(window.history, 'pushState').mockImplementation(refuse);
  navigate('/photography/#a');
  expect(currentLocation().hash).toBe('#a');
  popstate();
  expect(currentLocation().hash).toBe('');
  vi.restoreAllMocks();
  vi.advanceTimersByTime(5000);
  expect(window.location.hash).toBe('');
});

test('the hashchange that follows a popstate does not discard newer work', () => {
  window.history.pushState({}, '', '/photography/#a');
  popstate();
  navigate('/photography/#b', { replace: true });
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  expect(currentLocation().hash).toBe('#b');
  expect(window.location.hash).toBe('#b');
});

test('other history errors do not break navigation and still surface', () => {
  vi.spyOn(window.history, 'pushState').mockImplementation(() => { throw new TypeError('bad state'); });
  const changes = vi.fn();
  window.addEventListener(locationChangeEvent, changes);
  expect(() => navigate('/photography/#a')).not.toThrow();
  expect(changes).toHaveBeenCalledTimes(1);
  expect(currentLocation().hash).toBe('#a');
  expect(() => vi.runOnlyPendingTimers()).toThrow(TypeError);
  window.removeEventListener(locationChangeEvent, changes);
});

test('navigateBack leaves a returnable entry with the browser Back, after writing its last step', () => {
  navigate('/photography/#a', { returnable: true });
  expect(window.history.state.returnTo).toBe(new URL('/photography/', window.location.href).href);
  // Exhaust the budget so the last step is still pending when the viewer closes.
  const replace = vi.spyOn(window.history, 'replaceState');
  for (let step = 0; step < 40; step += 1) navigate(`/photography/#s${step}`, { replace: true, keepState: true });
  expect(window.location.hash).not.toBe('#s39');
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});

  navigateBack('/photography/');
  expect(window.location.hash).toBe('#s39'); // so Forward reopens the photograph left
  expect(back).toHaveBeenCalledTimes(1);
  expect(currentLocation().hash).toBe('');
  expect(isTraversing()).toBe(true);
  expect(replace.mock.calls.at(-1)[0].returnTo).toBeTruthy();

  // Something opened before the Back arrived waits for it, then is written.
  navigate('/photography/#c', { returnable: true });
  expect(window.location.hash).toBe('#s39');
  back.mockRestore();
  window.history.replaceState(null, '', '/photography/'); // where the Back lands
  popstate();
  expect(isTraversing()).toBe(false);
  expect(currentLocation().hash).toBe('#c');
  vi.advanceTimersByTime(1000); // the budget is still spent
  expect(window.location.hash).toBe('#c');
  expect(window.history.state.returnTo).toBe(new URL('/photography/', window.location.href).href);
});

test('navigateBack replaces an entry that was not pushed from the target (a direct link)', () => {
  window.history.replaceState(null, '', '/photography/#a');
  const back = vi.spyOn(window.history, 'back');
  navigateBack('/photography/');
  expect(back).not.toHaveBeenCalled();
  expect(window.location.hash).toBe('');
  expect(currentState()).toEqual({});
});

test('navigateBack drops an entry that was never written', () => {
  const push = vi.spyOn(window.history, 'pushState').mockImplementation(refuse);
  const replace = vi.spyOn(window.history, 'replaceState');
  const back = vi.spyOn(window.history, 'back');
  navigate('/photography/#a', { returnable: true });
  navigate('/photography/#b', { replace: true, keepState: true });
  navigateBack('/photography/');
  expect(currentLocation().hash).toBe('');
  expect(back).not.toHaveBeenCalled();
  push.mockRestore();
  vi.advanceTimersByTime(5000);
  expect(replace).not.toHaveBeenCalled();
  expect(window.location.hash).toBe('');
});

test('a Back that never arrives is replaced by the target', () => {
  navigate('/photography/#a', { returnable: true });
  vi.spyOn(window.history, 'back').mockImplementation(() => {});
  navigateBack('/photography/');
  expect(window.location.hash).toBe('#a');
  vi.advanceTimersByTime(1000);
  expect(isTraversing()).toBe(false);
  expect(window.location.hash).toBe('');
});

test('a hidden page gets the latest location at once', () => {
  for (let step = 0; step < 30; step += 1) navigate(`/photography/#p${step}`, { replace: true });
  expect(window.location.hash).not.toBe('#p29');
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  delete document.visibilityState;
  expect(window.location.hash).toBe('#p29');
});
