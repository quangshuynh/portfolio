// jest-dom adds custom matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom/vitest';

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// History writes and Back traversals still pending from the previous test must not leak into
// the next one, which sets its location with history.replaceState directly.
if (typeof window !== 'undefined') {
  const { afterEach, beforeEach } = await import('vitest');
  const { isTraversing, resetHistorySync } = await import('./util/navigation');
  // Closing the viewer goes Back, which jsdom applies a task later.
  afterEach(async () => {
    if (!isTraversing()) return;
    await new Promise((resolve) => {
      window.addEventListener('popstate', resolve, { once: true });
      setTimeout(resolve, 200);
    });
  });
  beforeEach(() => resetHistorySync());
}
