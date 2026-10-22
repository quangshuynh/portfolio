import { lazy, Suspense } from 'react';
import { render, screen } from '@testing-library/react';
import RouteErrorBoundary, { isChunkLoadError } from './routeErrorBoundary';

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));

describe('route error boundary', () => {
  test('a lazy page whose code cannot be downloaded shows the failure and a Retry', async () => {
    const Page = lazy(() => Promise.reject(new TypeError('Importing a module script failed.')));
    render(<RouteErrorBoundary name="The photo editor" homePath="/photography/" homeLabel="Back to photography"><Suspense fallback={null}><Page /></Suspense></RouteErrorBoundary>);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The photo editor could not start');
    expect(alert).toHaveTextContent('Failing operation: loading page code');
    expect(alert).toHaveTextContent('TypeError: Importing a module script failed.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to photography' })).toHaveAttribute('href', '/photography/');
  });

  test('an exception while starting the page is shown, not swallowed into a blank screen', () => {
    const Broken = () => { throw new TypeError("undefined is not an object (evaluating 'gl.getParameter')"); };
    render(<RouteErrorBoundary name="The photo editor"><Broken /></RouteErrorBoundary>);
    expect(screen.getByRole('alert')).toHaveTextContent('Failing operation: starting the page');
    expect(screen.getByRole('alert')).toHaveTextContent("gl.getParameter");
    expect(console.error).toHaveBeenCalled();
  });

  test('recognises chunk failures from Chromium, Safari and Firefox', () => {
    ['Failed to fetch dynamically imported module: /assets/x.js', 'Importing a module script failed.', 'error loading dynamically imported module'].forEach((message) => expect(isChunkLoadError(new TypeError(message))).toBe(true));
    expect(isChunkLoadError(new Error('x is undefined'))).toBe(false);
  });
});
