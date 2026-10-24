import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import BatchDialog from './BatchDialog';
import BatchExportDialog from './BatchExportDialog';
import BatchPanel from './BatchPanel';
import { createHistory } from '../model/history.mjs';
import { normalizeAdjustments } from '../model/adjustments.mjs';
import { DEFAULT_EXPORT_SETTINGS, normalizeExportSettings } from '../model/editDocument.mjs';

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((type) => (type === '2d' ? { putImageData: () => {} } : null));
  if (typeof ImageData === 'undefined') vi.stubGlobal('ImageData', class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } });
});

const photo = (id, name, values = {}, extra = {}) => ({
  id, name, status: 'ready', width: 600, height: 400, format: 'jpeg', exportStatus: { state: 'idle' }, history: createHistory(normalizeAdjustments(values)), ...extra,
});
const thumb = { width: 4, height: 3, data: new Uint8ClampedArray(48).fill(128) };
const LUT = { sha256: 'b'.repeat(64), name: 'film.cube', title: 'Film', size: 17 };

describe('BatchPanel', () => {
  const props = { readyCount: 3, selecting: false, onToggleSelecting: () => {}, onSelectAll: () => {}, onClear: () => {}, onCopy: () => {}, onPaste: () => {}, onOpen: () => {}, onExport: () => {}, batches: { past: [], future: [], last: null }, dispatch: () => {}, canEdit: true, busy: false };

  test('shows the selected count and enables multi-photo actions only with several selected', () => {
    const { rerender } = render(<BatchPanel {...props} selectedCount={1} clipboard={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('1 photo selected');
    expect(screen.getByRole('button', { name: 'Sync…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Paste edits' })).toBeDisabled();
    rerender(<BatchPanel {...props} selectedCount={3} clipboard={{ name: 'a.jpg' }} />);
    expect(screen.getByRole('button', { name: 'Sync…' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Paste to 3' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Export 3 photos…' })).toBeEnabled();
  });

  test('offers batch undo with what it undoes, and reports skipped photos', () => {
    const dispatch = vi.fn();
    render(<BatchPanel {...props} dispatch={dispatch} selectedCount={2} clipboard={null} batches={{ past: [{ label: 'sync edits', changes: [] }], future: [], last: { label: 'sync edits', applied: 2, skipped: 1, kind: 'undo' } }} />);
    expect(screen.getByText(/Undid sync edits: 2 photos; 1 photo edited since or removed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo sync edits' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'undoBatch' });
    expect(screen.getByRole('button', { name: 'Redo batch' })).toBeDisabled();
  });
});

describe('BatchDialog', () => {
  const source = photo('a', 'a.jpg', { exposure: 1, saturation: 30, lut: LUT });
  const targets = [photo('b', 'b.jpg', { contrast: 20 }), photo('c', 'c.jpg')];
  const common = { thumbnailOf: () => thumb, lutFor: () => null, presets: [], onClose: () => {} };

  test('Sync shows what changes per photo with before/after thumbnails and applies the plan', () => {
    const onApply = vi.fn();
    render(<BatchDialog {...common} mode="sync" source={source} targets={targets} luts={[LUT]} onApply={onApply} />);
    const dialog = screen.getByRole('dialog', { name: 'Sync edits' });
    expect(within(dialog).getAllByText(/Changes Light, Color, LUT/)).toHaveLength(2);
    expect(dialog.querySelectorAll('.pe-batch-plan__thumbs canvas')).toHaveLength(4);
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Light' }));
    expect(within(dialog).getAllByText(/Changes Color, LUT/)).toHaveLength(2);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply to 2' }));
    const [plan, label] = onApply.mock.calls[0];
    expect(label).toBe('sync edits');
    expect(plan.items.map(({ after }) => [after.exposure, after.saturation, after.contrast])).toEqual([[0, 30, 20], [0, 30, 0]]);
  });

  test('refuses before anything changes when a LUT is not loaded, or no group is chosen', () => {
    render(<BatchDialog {...common} mode="sync" source={source} targets={targets} luts={[]} onApply={() => {}} />);
    expect(screen.getByRole('button', { name: /Apply to/ })).toBeDisabled();
    expect(screen.getByText(/The LUT "Film" is not loaded/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'LUT' }));
    expect(screen.getByRole('button', { name: 'Apply to 2' })).toBeEnabled();
    ['Light', 'Color', 'HSL', 'Detail', 'Tone curve', 'Creative'].forEach((name) => fireEvent.click(screen.getByRole('checkbox', { name })));
    expect(screen.getByText('Choose at least one group of settings.')).toBeInTheDocument();
  });

  test('a preset or a LUT applies to every selected photo; Cancel applies nothing', () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    const { unmount } = render(<BatchDialog {...common} mode="preset" source={source} targets={[source, ...targets]} luts={[]} onApply={onApply} onClose={onClose} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'builtin:black-and-white' } });
    expect(screen.getByText(/Replaces: Tone, Vibrance and saturation, HSL/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
    unmount();
    render(<BatchDialog {...common} mode="lut" source={source} targets={targets} luts={[LUT]} onApply={onApply} />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply to 2' }));
    expect(onApply.mock.calls[0][0].items.every(({ after }) => after.lut.sha256 === LUT.sha256 && after.lutIntensity === 40)).toBe(true);
  });
});

describe('BatchExportDialog', () => {
  const settings = normalizeExportSettings(DEFAULT_EXPORT_SETTINGS);
  const photos = [photo('a', 'DSC0001.jpg'), photo('b', 'DSC0001.png'), photo('c', 'IMG_2.ARW', {}, { raw: { width: 6024, height: 4024 } })];
  const base = { settings, dispatch: () => {}, unsupportedFormats: [], outputOf: (item) => ({ width: item.width, height: item.height }), constrained: false, onCancel: () => {}, onCancelItem: () => {}, onRetry: () => {}, onClose: () => {} };

  test('lists collision-safe -quangedit names, blocked photos, and starts with the chosen output and custom names', () => {
    const onStart = vi.fn();
    render(<BatchExportDialog {...base} photos={photos} blockerFor={(item) => (item.id === 'c' ? 'Import the LUT "x" again.' : null)} run={null} onStart={onStart} />);
    expect(screen.getByText('DSC0001-quangedit.jpg')).toBeInTheDocument();
    expect(screen.getByText('DSC0001-quangedit-2.jpg')).toBeInTheDocument();
    expect(screen.getByText(/Not exported: Import the LUT/)).toBeInTheDocument();
    // The ARW is blocked, so neither its size nor the RAW decoder counts.
    expect(document.querySelector('[data-batch-memory]').textContent).toMatch(/one at a time.*600×400 needs a 1 MB canvas\. Output/);
    fireEvent.click(screen.getByRole('button', { name: 'Rename the export of DSC0001.png' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'File name for DSC0001.png' }), { target: { value: 'Final' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByText('Final.jpg')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Separate files' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export 2 files' }));
    expect(onStart).toHaveBeenCalledWith({ mode: 'files', customNames: { b: 'Final' } });
  });

  test('shows per-photo progress, Cancel while running, and Retry for failed photos afterwards', () => {
    const onRetry = vi.fn();
    const onCancelItem = vi.fn();
    const running = photos.slice(0, 2).map((item, index) => ({ ...item, exportStatus: index ? { state: 'queued' } : { state: 'running', stage: 'rendering', fraction: 0.4 } }));
    const { rerender } = render(<BatchExportDialog {...base} photos={running} blockerFor={() => null} run={{ running: true, mode: 'zip' }} onStart={() => {}} onCancelItem={onCancelItem} />);
    expect(screen.getByText(/Rendering 40%/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close Export selected' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the export of DSC0001.png' }));
    expect(onCancelItem).toHaveBeenCalledWith('b');
    const settled = [{ ...photos[0], exportStatus: { state: 'done', width: 600, height: 400, bytes: 2048, fileName: 'x' } }, { ...photos[1], exportStatus: { state: 'error', message: 'Out of memory.' } }];
    rerender(<BatchExportDialog {...base} photos={settled} blockerFor={() => null} run={{ running: false, mode: 'zip', outcome: 'Saved 1 of 2 in one ZIP. 1 failed.' }} onStart={() => {}} onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Out of memory.');
    expect(screen.getByText(/Retried photos download as separate files/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry 1 failed' }));
    expect(onRetry).toHaveBeenCalledWith(['b'], { mode: 'files', customNames: {} });
  });

  test('warns on phones that full-size RAW exports may not fit', () => {
    render(<BatchExportDialog {...base} constrained photos={[photo('c', 'IMG_2.ARW', {}, { raw: {}, width: 6024, height: 4024 })]} blockerFor={() => null} run={null} onStart={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/Long edge 4096 px or smaller/);
  });
});
