import React, { useReducer } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import App from '../../App';
import AdjustPanel from './AdjustPanel';
import ExportPanel from './ExportPanel';
import EditorApp, { AUTOSAVE_KEY } from './EditorApp';
import { editorReducer, initialEditorState } from '../model/editorState.mjs';
import { createEditDocument, serializeEditDocument } from '../model/editDocument.mjs';
import { neutralAdjustments } from '../model/adjustments.mjs';
import { debugFlag } from '../io/diagnostics.mjs';
import editorCss from './editor.css?raw';

// jsdom has no canvas or image decoding. These stand in for a browser without WebGL2:
// the viewer falls back to its CPU engine (a stub 2D context) and draws nothing.
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((type) => (type === '2d' ? {} : null));
  vi.stubGlobal('createImageBitmap', () => Promise.reject(new Error('not in jsdom')));
});
beforeEach(() => localStorage.clear());

/** AdjustPanel wired to the real reducer with one ready photo. */
function AdjustHarness({ onState }) {
  const [state, dispatch] = useReducer(editorReducer, undefined, () => {
    let s = editorReducer(initialEditorState(), { type: 'photosAdded', photos: [{ id: 'a', name: 'a.jpg', size: 1, lastModified: 0 }] });
    s = editorReducer(s, { type: 'importSucceeded', id: 'a', info: { format: 'jpeg', width: 10, height: 10, orientation: 1, sha256: null } });
    return s;
  });
  onState(state);
  return <AdjustPanel adjustments={state.photos[0].history.present} disabled={false} dispatch={dispatch} />;
}

describe('page around the editor', () => {
  // On iPhones (Safari and Brave, iOS 18) overflow: hidden on both html and body made body
  // a 0px-tall clipping box around the fixed editor, and nothing was painted.
  test('never clips html or body, so iOS WebKit paints the fixed editor', () => {
    const pageRules = [...editorCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, selector]) => /(^|[\s,])(html|body)\b/.test(selector.replace(/\/\*[\s\S]*?\*\//g, '')));
    expect(pageRules.map(([, selector]) => selector.replace(/\/\*[\s\S]*?\*\//g, '').trim())).toContain('html.pe-document, html.pe-document body');
    pageRules.forEach(([, , body]) => expect(body).not.toMatch(/overflow(-[xy])?\s*:\s*(hidden|clip|auto|scroll)/));
  });
});

describe('viewer bar', () => {
  // A long note (Detail preview, "Preview at …") once widened the viewer grid at 375 px,
  // pushing the photo off centre and the note under the zoom buttons.
  test('the viewer grid column and the note can shrink below their text width', () => {
    const rule = (selector) => [...editorCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, s]) => s.trim() === selector)?.[2] ?? '';
    expect(rule('.pe-viewer')).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(rule('.pe-readout-note')).toMatch(/min-width:\s*0/);
  });
});

describe('touch targets', () => {
  test('touch screens get about 44 px buttons and a larger slider thumb', () => {
    const coarse = editorCss.match(/@media \(pointer: coarse\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(coarse).toMatch(/\.pe-button, \.pe-text-button, \.pe-icon-button[^{]*\{ min-height: 2\.75rem; \}/);
    expect(coarse).toMatch(/\.pe-range::-webkit-slider-thumb \{ width: 22px; height: 22px;/);
  });
});

describe('troubleshooting switches', () => {
  afterEach(() => window.history.replaceState({}, '', '/'));

  test('debugFlag reads hash switches joined by & or comma', () => {
    expect(debugFlag('cpu-preview', '#cpu-preview')).toBe(true);
    expect(debugFlag('cpu-preview', '#startup-report&cpu-preview')).toBe(true);
    expect(debugFlag('cpu-preview', '#startup-report,cpu-preview')).toBe(true);
    expect(debugFlag('cpu-preview', '#cpu-preview-x')).toBe(false);
    expect(debugFlag('cpu-preview', '')).toBe(false);
  });

  test('#cpu-preview never asks for a WebGL2 context', async () => {
    window.history.replaceState({}, '', '/photography/editor#cpu-preview');
    HTMLCanvasElement.prototype.getContext.mockClear();
    const { container } = render(<EditorApp />);
    await screen.findByRole('button', { name: 'Choose photos' });
    expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalledWith('webgl2', expect.anything());
    expect(container.querySelector('.pe')).toHaveAttribute('data-engine', 'cpu');
  });
});

describe('editor route', () => {
  test('renders the editor at /photography/editor with privacy messaging and a noindex head', async () => {
    window.history.replaceState({}, '', '/photography/editor');
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Photo editor' })).toBeInTheDocument();
    expect(screen.getByText('Processed on this device. Nothing is uploaded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose photos' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Photography' })).toHaveAttribute('href', '/photography/');
    expect(document.title).toBe('Photo Editor | Quang Huynh');
    // The HTML-shell startup watchdog waits for this marker.
    expect(document.documentElement.dataset.editor).toBe('ready');
    window.history.replaceState({}, '', '/');
  });
});

describe('adjustment panel', () => {
  let state;
  const present = () => state.photos[0].history.present;
  const past = () => state.photos[0].history.past;
  const renderPanel = () => render(<AdjustHarness onState={(value) => { state = value; }} />);

  test('labels every control with its range, value and a reset button', () => {
    renderPanel();
    const exposure = screen.getByRole('slider', { name: 'Exposure' });
    expect(exposure).toHaveAttribute('min', '-5');
    expect(exposure).toHaveAttribute('max', '5');
    expect(exposure).toHaveAttribute('aria-valuetext', '0.00 EV');
    // Only Light and Color start open; HSL, curve, LUT and presets are collapsed.
    expect(screen.getAllByRole('slider')).toHaveLength(10);
    // Disabled resets are hidden; changing a value reveals the button.
    expect(screen.queryByRole('button', { name: 'Reset Exposure' })).toBeNull();
    fireEvent.input(exposure, { target: { value: '1' } });
    expect(screen.getByRole('button', { name: 'Reset Exposure' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^Light/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /^Color/ })).toHaveAttribute('aria-expanded', 'true');
  });

  test('a pointer drag previews every value and records one undo step on release', () => {
    renderPanel();
    const slider = screen.getByRole('slider', { name: 'Contrast' });
    fireEvent.pointerDown(slider);
    [10, 20, 35].forEach((value) => fireEvent.input(slider, { target: { value: String(value) } }));
    expect(present().contrast).toBe(35);
    expect(past()).toHaveLength(0);
    act(() => { window.dispatchEvent(new Event('pointerup')); });
    expect(past()).toHaveLength(1);
  });

  test('typed values are clamped, and reset returns to neutral', () => {
    renderPanel();
    const field = screen.getByRole('textbox', { name: 'Shadows value' });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: '250' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(present().shadows).toBe(100);
    expect(field).toHaveValue('+100');
    fireEvent.click(screen.getByRole('button', { name: 'Reset Shadows' }));
    expect(present().shadows).toBe(0);
    fireEvent.change(screen.getByRole('slider', { name: 'Tint' }), { target: { value: '12' } });
    fireEvent.input(screen.getByRole('slider', { name: 'Tint' }), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset all' }));
    expect(present()).toEqual(neutralAdjustments());
  });

  test('Escape abandons a typed value', () => {
    renderPanel();
    const field = screen.getByRole('textbox', { name: 'Tint value' });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: '40' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(present().tint).toBe(0);
  });
});

describe('export panel', () => {
  const photo = { status: 'ready', name: 'DSC0001.JPG', width: 6000, height: 4000, exportStatus: { state: 'idle' } };
  const settings = initialEditorState().exportSettings;

  test('summarises the output file and size, and hides quality for PNG', () => {
    const dispatch = vi.fn();
    const { rerender } = render(<ExportPanel settings={settings} photo={photo} dispatch={dispatch} onExport={vi.fn()} onCancel={vi.fn()} unsupportedFormats={[]} />);
    expect(screen.getByText('DSC0001-quangedit.jpg')).toBeInTheDocument();
    expect(screen.getByText('6000 × 4000 (original)')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Quality' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'PNG' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'setExportSettings', settings: { format: 'png' } });
    rerender(<ExportPanel settings={{ ...settings, format: 'png', resize: { ...settings.resize, mode: 'long-edge', longEdge: 1500 } }} photo={photo} dispatch={dispatch} onExport={vi.fn()} onCancel={vi.fn()} unsupportedFormats={['webp']} />);
    expect(screen.queryByRole('slider', { name: 'Quality' })).toBeNull();
    expect(screen.getByText('1500 × 1000')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'WebP' })).toBeDisabled();
    expect(screen.getByText(/cannot encode WebP/)).toBeInTheDocument();
  });

  test('shows progress with cancel while running, and errors after', () => {
    const onCancel = vi.fn();
    const running = { ...photo, exportStatus: { state: 'running', stage: 'rendering', fraction: 0.4 } };
    const { rerender } = render(<ExportPanel settings={settings} photo={running} dispatch={vi.fn()} onExport={vi.fn()} onCancel={onCancel} unsupportedFormats={[]} />);
    // The live region names the stage only, so screen readers are not told every percent.
    const stage = screen.getByText('Rendering');
    expect(stage).toHaveAttribute('role', 'status');
    expect(stage.parentElement).toHaveTextContent('Rendering 40%');
    expect(screen.getByRole('progressbar', { name: 'Export progress' })).toHaveAttribute('value', '0.4');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    rerender(<ExportPanel settings={settings} photo={{ ...photo, exportStatus: { state: 'error', message: 'This browser cannot encode WebP.' } }} dispatch={vi.fn()} onExport={vi.fn()} onCancel={onCancel} unsupportedFormats={[]} />);
    expect(screen.getByRole('alert')).toHaveTextContent('cannot encode WebP');
  });

  test('cannot export without a ready photo or while another export runs', () => {
    const { rerender } = render(<ExportPanel settings={settings} photo={null} dispatch={vi.fn()} onExport={vi.fn()} onCancel={vi.fn()} unsupportedFormats={[]} />);
    expect(screen.getByRole('button', { name: 'Export photo' })).toBeDisabled();
    rerender(<ExportPanel settings={settings} photo={photo} busy dispatch={vi.fn()} onExport={vi.fn()} onCancel={vi.fn()} unsupportedFormats={[]} />);
    expect(screen.getByRole('button', { name: 'Export photo' })).toBeDisabled();
  });
});

describe('editor workspace', () => {
  test('explains that saved edits need their originals after a reload', async () => {
    const saved = createEditDocument([{ name: 'lake.jpg', size: 10, sha256: 'a'.repeat(64), format: 'jpeg', width: 4, height: 3, adjustments: { ...neutralAdjustments(), exposure: 1 } }]);
    localStorage.setItem(AUTOSAVE_KEY, serializeEditDocument(saved));
    render(<EditorApp />);
    const notice = await screen.findByText(/Reimport the original file to continue: lake\.jpg/);
    expect(notice).toHaveTextContent('settings only, not images');
    fireEvent.click(screen.getByRole('button', { name: 'Discard saved edits' }));
    expect(screen.queryByText(/Reimport the original/)).toBeNull();
    await act(() => new Promise((resolve) => setTimeout(resolve, 450)));
    expect(localStorage.getItem(AUTOSAVE_KEY)).toBeNull();
  });

  test('rejects an invalid edit file with a readable error', async () => {
    const { container } = render(<EditorApp />);
    const input = container.querySelector('input[accept="application/json,.json"]');
    const file = new File(['{"type":"something-else"}'], 'edits.json', { type: 'application/json' });
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }); });
    expect(await screen.findByRole('alert')).toHaveTextContent('This is not a photo editor edit file.');
  });

  test('controls that need a photo are disabled, and mobile panel tabs expose their state', () => {
    render(<EditorApp />);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save edits' })).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Exposure' })).toBeDisabled();
    // The panel tabs only display below 860 px; jsdom lays out at desktop width.
    const tabs = within(document.querySelector('nav.pe-tabs'));
    expect(tabs.getByRole('button', { name: 'Adjust', hidden: true })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(tabs.getByRole('button', { name: 'Export', hidden: true }));
    expect(tabs.getByRole('button', { name: 'Export', hidden: true })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('startup on limited browsers', () => {
  test('a browser without createImageBitmap gets a specific compatibility message, not a blank page', () => {
    vi.stubGlobal('createImageBitmap', undefined);
    try {
      render(<EditorApp />);
      expect(screen.getByRole('alert')).toHaveTextContent('This browser cannot run the photo editor');
      expect(screen.getByRole('alert')).toHaveTextContent('missing: image decoding (createImageBitmap)');
      expect(screen.getByText('Diagnostics')).toBeInTheDocument();
    } finally {
      vi.stubGlobal('createImageBitmap', () => Promise.reject(new Error('not in jsdom')));
    }
  });

  test('without WebGL2 the editor starts with the CPU preview and records why', () => {
    render(<EditorApp />);
    expect(screen.getByRole('button', { name: 'Choose photos' })).toBeInTheDocument();
    expect(document.querySelector('.pe').dataset.engine).toBe('cpu');
    fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));
    const report = JSON.parse(screen.getByRole('textbox', { name: 'Diagnostics report' }).value);
    expect(report.previewEngine).toBe('cpu');
    expect(report.events.some(({ area, message }) => area === 'webgl2' && /CPU preview/.test(message))).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(/blob:|\.jpe?g/i);
  });

  test('without any 2D canvas the preview shows an error instead of failing silently', () => {
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((type) => (type === '2d' && !spy.mock.calls.some(([t]) => t === 'webgl2') ? {} : null));
    try {
      render(<EditorApp />);
      expect(screen.getByText('This browser cannot draw a 2D canvas, so the preview cannot be shown.')).toBeInTheDocument();
    } finally {
      spy.mockImplementation((type) => (type === '2d' ? {} : null));
    }
  });
});

describe('fullscreen workspace', () => {
  test('the bar toggles fullscreen (a focus mode without the Fullscreen API) and keeps the controls', async () => {
    render(<EditorApp />);
    const enter = await screen.findByRole('button', { name: 'Enter fullscreen' });
    await act(async () => { fireEvent.click(enter); });
    const root = document.querySelector('.pe');
    expect(root).toHaveAttribute('data-fullscreen', 'immersive');
    const exit = screen.getByRole('button', { name: 'Exit fullscreen' });
    expect(exit).toHaveAttribute('aria-pressed', 'true');
    exit.focus();
    // Undo, redo and compare stay in the bar; the library and filmstrip step aside (CSS).
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Compare' })).toBeInTheDocument();
    expect(editorCss).toMatch(/\.pe\[data-fullscreen\] \.pe-library, \.pe\[data-fullscreen\] \.pe-filmstrip/);
    await act(async () => { fireEvent.click(exit); });
    expect(root).not.toHaveAttribute('data-fullscreen');
    expect(screen.getByRole('button', { name: 'Enter fullscreen' })).toHaveFocus();
  });
});
