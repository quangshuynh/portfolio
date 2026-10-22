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
    window.dispatchEvent(new ErrorEvent('error', { message: 'SyntaxError: Unexpected token', filename: `${location.origin}/assets/index-abc.js`, lineno: 1, colno: 42 }));
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

  // Brave on iOS injects a wallet script that throws this on every page, ours or not.
  test('reports injected and cross-origin errors as external, counted, without blaming the editor', () => {
    runWatchdog();
    for (let i = 0; i < 20; i += 1) {
      window.dispatchEvent(new ErrorEvent('error', { message: "TypeError: undefined is not an object (evaluating 'window.ethereum.selectedAddress = undefined')" }));
      window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' }));
    }
    window.dispatchEvent(new ErrorEvent('error', { message: 'ReferenceError: x', filename: 'https://extension.example/inject.js', lineno: 3, colno: 1 }));
    vi.advanceTimersByTime(3000);
    expect(panel()).toBeNull();
    // Still shown if the editor then never starts, with the noise collapsed so a later real error fits.
    window.__editorStartup.stage('editor chunk requested');
    window.dispatchEvent(new ErrorEvent('error', { message: 'TypeError: real failure', filename: `${location.origin}/assets/photoEditorPage-x.js`, lineno: 9, colno: 2 }));
    vi.advanceTimersByTime(12000);
    const report = panel().querySelector('textarea').value;
    expect(report).toContain("external x20] TypeError: undefined is not an object (evaluating 'window.ethereum.selectedAddress = undefined') (no script URL)");
    expect(report).toContain('external x20] Script error. (no script URL)');
    expect(report).toContain('external] ReferenceError: x (https://extension.example/inject.js:3:1)');
    expect(report).toContain('error] TypeError: real failure (/assets/photoEditorPage-x.js:9:2)');
    expect(report).toMatch(/Stages:\r?\n {2}\[\d+ms\] shell\r?\n {2}\[\d+ms\] editor chunk requested/);
    expect(report).toContain('Editor marker: not set');
  });

  test('describes what React rendered when the editor never marks itself started', () => {
    runWatchdog();
    document.getElementById('root').innerHTML = '<div class="pe pe--x"></div>';
    vi.advanceTimersByTime(12000);
    expect(panel().querySelector('textarea').value).toMatch(/React root children: 1\r?\nRoot content: div\.pe\.pe--x \d+x\d+/);
  });

  test('treats the unsupported-browser page as started', () => {
    document.documentElement.dataset.editor = 'unsupported';
    runWatchdog();
    vi.advanceTimersByTime(20000);
    expect(panel()).toBeNull();
  });

  // An iPhone showed a blank page with no panel: the editor had mounted but was not visible.
  test('#startup-report opens the report with the editor layout even after a successful start', () => {
    window.history.replaceState({}, '', '/photography/editor#startup-report');
    document.documentElement.dataset.editor = 'ready';
    document.getElementById('root').innerHTML = '<div class="pe"><header class="pe-bar"></header></div>';
    runWatchdog();
    vi.advanceTimersByTime(4000);
    expect(panel()).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(panel().querySelector('h1').textContent).toBe('Photo editor startup report');
    const report = panel().querySelector('textarea').value;
    expect(report).toContain('Reason: requested with #startup-report');
    expect(report).toContain('Editor marker: ready');
    expect(report).toMatch(/Layout \.pe: div\.pe \d+x\d+ at \d+,\d+/);
    expect(report).toMatch(/Layout \.pe-bar: header\.pe-bar /);
    expect(report).toContain('Layout .pe-canvas: none');
    expect(report).toContain('On top at centre: ');
    // Stays until closed, although the editor has started.
    vi.advanceTimersByTime(5000);
    const close = [...panel().querySelectorAll('button')].find((button) => button.textContent === 'Close');
    close.click();
    expect(panel()).toBeNull();
  });
});
