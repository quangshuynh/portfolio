import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { currentLocation, discardPendingNavigation, locationChangeEvent, navigate } from './navigation';

const refuse = () => {
  throw new DOMException('Attempt to use history.pushState() more than 100 times per 10 seconds', 'SecurityError');
};

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState({}, '', '/photography/');
});

afterEach(() => {
  discardPendingNavigation();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test('a refused history write still moves the app, then lands as one entry once the browser allows it', () => {
  const changes = vi.fn();
  window.addEventListener(locationChangeEvent, changes);
  const push = vi.spyOn(window.history, 'pushState').mockImplementation(refuse);
  const replace = vi.spyOn(window.history, 'replaceState').mockImplementation(refuse);

  navigate('/photography/#a');
  navigate('/photography/#b', { replace: true });

  expect(changes).toHaveBeenCalledTimes(2);
  expect(currentLocation()).toEqual({ pathname: '/photography/', search: '', hash: '#b' });
  expect(window.location.hash).toBe('');

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

test('browser navigation discards a pending write', () => {
  vi.spyOn(window.history, 'pushState').mockImplementation(refuse);
  navigate('/photography/#a');
  discardPendingNavigation();
  vi.restoreAllMocks();
  vi.advanceTimersByTime(5000);
  expect(currentLocation().hash).toBe('');
  expect(window.location.hash).toBe('');
});

test('other history errors are not swallowed', () => {
  vi.spyOn(window.history, 'pushState').mockImplementation(() => { throw new TypeError('bad state'); });
  expect(() => navigate('/photography/#a')).toThrow(TypeError);
});
