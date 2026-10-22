import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The watchdog is a plain script in public/, run here as the browser would before the bundle.
const source = readFileSync(join(process.cwd(), 'public/photography/editor-startup.js'), 'utf8');
const runWatchdog = () => new Function(source)();
const panel = () => document.getElementById('editor-startup-failure');

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="root"></div>';
  delete document.documentElement.dataset.editor;
  window.history.replaceState({}, '', '/photography/editor');
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  window.history.replaceState({}, '', '/');
});

describe('editor startup watchdog', () => {
  test('replaces a blank page with the captured error, a report and Retry when React never mounts', () => {
    runWatchdog();
    window.dispatchEvent(new ErrorEvent('error', { message: 'SyntaxError: Unexpected token', filename: 'https://example.test/assets/index-abc.js', lineno: 1, colno: 42 }));
    expect(panel()).toBeNull();
    vi.advanceTimersByTime(3000);
    expect(panel()).toHaveAttribute('role', 'alert');
    expect(panel().querySelector('h1').textContent).toBe('The photo editor did not start');
    const report = panel().querySelector('textarea').value;
    expect(report).toContain('SyntaxError: Unexpected token (/assets/index-abc.js:1:42)');
    expect(report).toContain('React root children: 0');
    expect([...panel().querySelectorAll('button')].map((button) => button.textContent)).toEqual(['Retry', 'Copy report']);
    expect(panel().querySelector('a')).toHaveAttribute('href', '/photography/');
  });

  test('reports a silent stall after the timeout, and records failed script loads', () => {
    runWatchdog();
    const script = document.createElement('script');
    script.src = '/assets/photoEditorPage-x.js';
    document.head.appendChild(script);
    script.dispatchEvent(new Event('error'));
    vi.advanceTimersByTime(12000);
    expect(panel().querySelector('textarea').value).toContain('Could not load /assets/photoEditorPage-x.js');
    script.remove();
  });

  test('stays hidden once the editor marks itself ready, and removes itself after a slow start', () => {
    runWatchdog();
    vi.advanceTimersByTime(12000);
    expect(panel()).not.toBeNull();
    document.documentElement.dataset.editor = 'ready';
    vi.advanceTimersByTime(1000);
    expect(panel()).toBeNull();

    document.body.innerHTML = '<div id="root"></div>';
    runWatchdog();
    vi.advanceTimersByTime(20000);
    expect(panel()).toBeNull();
  });
});
