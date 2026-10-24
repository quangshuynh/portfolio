import React, { useReducer } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AdjustPanel from './AdjustPanel';
import ExportPanel from './ExportPanel';
import HdrMergeDialog from './HdrMergeDialog';
import { editorReducer, initialEditorState } from '../model/editorState.mjs';
import { createEditDocument, parseEditDocument, serializeEditDocument } from '../model/editDocument.mjs';
import { BUILT_IN_PRESETS } from '../model/presets.mjs';
import { SYNTHETIC_RAW_INFO } from '../dev/hdrFixtures.mjs';

beforeEach(() => {
  localStorage.clear();
  // jsdom has no canvas or ImageData; thumbnails draw into a stub 2D context.
  globalThis.ImageData ??= class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((type) => (type === '2d' ? { putImageData: () => {} } : null));
});
afterEach(() => vi.restoreAllMocks());

const INPUTS = [
  { name: 'DSC09500.ARW', size: 10, sha256: 'a'.repeat(64), format: 'arw', role: 'under' },
  { name: 'DSC09501.ARW', size: 11, sha256: 'b'.repeat(64), format: 'arw', role: 'normal' },
  { name: 'DSC09502.ARW', size: 12, sha256: 'c'.repeat(64), format: 'arw', role: 'over' },
];
const HDR = {
  mode: 'radiance',
  inputs: INPUTS,
  settings: { align: true, deghost: true, deghostStrength: 50 },
  summary: {
    measuredStops: [-2.01, null, 1.98],
    alignment: [{ status: 'aligned', before: 0.12, after: 0.02 }, { status: 'reference', before: null, after: null }, { status: 'failed', before: 0.4, after: 0.25 }],
    ghostFraction: 0.013,
    warnings: ['Automatic alignment failed for at least one photo.'],
  },
};
const IDENTITY = 'd'.repeat(64);

function Harness({ hdr, onState }) {
  const [state, dispatch] = useReducer(editorReducer, undefined, () => {
    let s = editorReducer(initialEditorState(), { type: 'photosAdded', photos: [{ id: 'h', name: 'DSC09501-HDR', size: 33, lastModified: 0 }] });
    s = editorReducer(s, { type: 'importSucceeded', id: 'h', info: { format: 'hdr', width: 5900, height: 3940, orientation: 1, sha256: IDENTITY, raw: hdr.mode === 'radiance' ? { ...SYNTHETIC_RAW_INFO, hdrWhite: 4 } : null, hdr } });
    return s;
  });
  onState(state, dispatch);
  const photo = state.photos[0];
  return (
    <>
      <AdjustPanel
        adjustments={photo.history.present}
        disabled={false}
        dispatch={dispatch}
        raw={photo.raw ?? null}
        hdr={photo.hdr}
        lut={{ library: [], onImport: () => {}, status: {} }}
        presets={{ userPresets: [], onChange: () => {}, onPreview: () => {}, onDownload: () => {}, newId: () => 'x' }}
      />
      <ExportPanel settings={state.exportSettings} photo={photo} dispatch={dispatch} onExport={() => {}} onCancel={() => {}} unsupportedFormats={[]} busy={false} />
    </>
  );
}

let state;
let dispatch;
const present = () => state.photos[0].history.present;
const setup = (hdr = HDR) => render(<Harness hdr={hdr} onState={(s, d) => { state = s; dispatch = d; }} />);

describe('HDR panel and editor integration', () => {
  test('shows how the merge was made, with measured values only', () => {
    setup();
    const panel = screen.getByRole('button', { name: /^HDR/ }).closest('section');
    expect(within(panel).getByText('RAW HDR merge')).toBeInTheDocument();
    expect(within(panel).getByText('DSC09500.ARW · -2.01 EV')).toBeInTheDocument();
    expect(within(panel).getByText('Underexposed: aligned, edge mismatch 12% → 2.0%')).toBeInTheDocument();
    expect(within(panel).getByText(/Overexposed: alignment failed, not aligned/)).toBeInTheDocument();
    expect(within(panel).getByText('1.3% from the reference only')).toBeInTheDocument();
    expect(within(panel).getByText(/Automatic alignment failed/)).toBeInTheDocument();
  });

  test('tone controls and looks, with undo, redo and group reset', () => {
    setup();
    const compression = screen.getByRole('slider', { name: 'Highlight compression' });
    expect(compression).toHaveValue('50');
    fireEvent.input(compression, { target: { value: '80' } });
    expect(present().hdrHighlights).toBe(80);
    fireEvent.click(screen.getByRole('button', { name: 'Stronger' }));
    expect(present()).toMatchObject({ hdrHighlights: 85, hdrShadows: 45 });
    expect(screen.getByRole('button', { name: 'Stronger' })).toHaveAttribute('aria-pressed', 'true');
    act(() => dispatch({ type: 'undo' }));
    expect(present()).toMatchObject({ hdrHighlights: 80, hdrShadows: 0 });
    act(() => dispatch({ type: 'redo' }));
    expect(present().hdrShadows).toBe(45);
    fireEvent.click(screen.getByRole('button', { name: 'Reset HDR' }));
    expect(present()).toMatchObject({ hdrHighlights: 50, hdrShadows: 0 });
  });

  test('presets change the look but never the HDR tone mapping', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Stronger' }));
    act(() => dispatch({ type: 'applyPreset', preset: BUILT_IN_PRESETS.find(({ name }) => name === 'High Contrast') }));
    expect(present()).toMatchObject({ hdrHighlights: 85, hdrShadows: 45 });
    expect(present().contrast).not.toBe(0);
  });

  test('the existing controls work on the merge: RAW white balance, light, colour', () => {
    setup();
    expect(screen.getByRole('combobox', { name: 'White balance' })).toBeInTheDocument();
    fireEvent.input(screen.getByRole('slider', { name: 'Exposure' }), { target: { value: '0.5' } });
    fireEvent.input(screen.getByRole('slider', { name: 'Vibrance' }), { target: { value: '20' } });
    expect(present()).toMatchObject({ exposure: 0.5, vibrance: 20 });
  });

  test('exposure fusion has no tone controls and says no radiance was reconstructed', () => {
    setup({ ...HDR, mode: 'fusion', inputs: INPUTS.map((input) => ({ ...input, format: 'jpeg', name: input.name.replace('ARW', 'jpg') })) });
    const panel = screen.getByRole('button', { name: /^HDR/ }).closest('section');
    expect(within(panel).getByText(/no scene brightness is reconstructed/)).toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'Highlight compression' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'White balance' })).toBeNull();
  });

  test('exports are named after the reference exposure and say they are merged from the sources', () => {
    setup();
    const panel = screen.getByRole('heading', { name: 'Export' }).closest('section');
    expect(within(panel).getByText('DSC09501-HDR-quangedit.jpg')).toBeInTheDocument();
    expect(within(panel).getByText(/decode and merge the three source files again at the chosen size/)).toBeInTheDocument();
  });

  test('saved edits keep the merge recipe and restore onto the same merge only', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Stronger' }));
    const text = serializeEditDocument(createEditDocument(state.photos.map((photo) => ({ ...photo, adjustments: photo.history.present })), state.exportSettings));
    expect(text).not.toMatch(/thumbnail|blob:|data:/);
    const document = parseEditDocument(text);
    expect(document.version).toBe(6);
    expect(document.photos[0].source).toMatchObject({ format: 'hdr', sha256: IDENTITY, hdr: { mode: 'radiance', inputs: INPUTS, settings: HDR.settings } });
    // A fresh workspace waits for the merge; a merge of the same files picks the edits up.
    let s = editorReducer(initialEditorState(), { type: 'loadDocument', document });
    expect(s.pendingEdits).toHaveLength(1);
    s = editorReducer(s, { type: 'photosAdded', photos: [{ id: 'n', name: 'DSC09501-HDR', size: 33, lastModified: 0 }] });
    s = editorReducer(s, { type: 'importSucceeded', id: 'n', info: { format: 'hdr', width: 5900, height: 3940, orientation: 1, sha256: IDENTITY, raw: null, hdr: HDR } });
    expect(s.photos[0].history.present).toMatchObject({ hdrHighlights: 85, hdrShadows: 45 });
    expect(s.pendingEdits).toHaveLength(0);
    // A merged HDR entry without a valid description of its sources is rejected with a reason.
    const broken = JSON.parse(text);
    broken.photos[0].source.hdr.inputs.pop();
    expect(() => parseEditDocument(JSON.stringify(broken))).toThrow(/without a valid description of its three source files/);
  });
});

// --- Merge HDR dialog ---------------------------------------------------------------

const exposure = (shutter) => ({ shutter, aperture: 8, iso: 100, captured: 0, model: 'ILCE-7M3' });
const thumb = (value) => ({ kind: 'raw', width: 4, height: 4, data: new Uint16Array(48).fill(value) });
const bracketInput = (name, shutter, value, overrides = {}) => ({
  file: { name }, name, size: name.length, sha256: name.padEnd(64, '0').replace(/[^0-9a-f]/g, 'e').slice(0, 64), kind: 'raw', format: 'arw',
  width: 6024, height: 4024, orientation: 1, raw: { ...SYNTHETIC_RAW_INFO }, thumbnail: thumb(value), exposure: shutter ? exposure(shutter) : null, ...overrides,
});

function openDialog({ inspect, merge = () => ({ promise: new Promise(() => {}), cancel: () => {} }), onMerged = () => {}, onClose = () => {}, pending = [] }) {
  const utils = render(<HdrMergeDialog accept="*" inspect={inspect} describe={() => Promise.reject(new Error('none'))} merge={merge} onMerged={onMerged} onClose={onClose} workspace={[]} pending={pending} />);
  const input = utils.container.querySelector('input[type=file][multiple]');
  const choose = (names) => act(async () => { fireEvent.change(input, { target: { files: names.map((name) => ({ name })) } }); });
  return { ...utils, choose };
}
const roleSelects = () => screen.getAllByRole('combobox', { name: 'Exposure' });

describe('Merge HDR dialog', () => {
  const byName = {
    'b.ARW': bracketInput('b.ARW', 1 / 30, 40000),
    'c.ARW': bracketInput('c.ARW', 1 / 500, 3000),
    'a.ARW': bracketInput('a.ARW', 1 / 125, 12000),
  };
  const inspect = (file) => Promise.resolve(byName[file.name]);

  test('is a labelled modal dialog with steps, and Escape closes it', async () => {
    const onClose = vi.fn();
    openDialog({ inspect, onClose });
    const dialog = screen.getByRole('dialog', { name: 'Merge HDR' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByText('Select three photos')).toHaveAttribute('aria-current', 'step');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  test('suggests roles from EXIF in any file order and keeps them one of each when changed', async () => {
    const { choose } = openDialog({ inspect });
    await choose(['b.ARW', 'c.ARW', 'a.ARW']);
    await waitFor(() => expect(roleSelects().map((s) => s.value)).toEqual(['over', 'under', 'normal']));
    expect(screen.getByText(/suggested from the recorded exposure/)).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Steps' })).getByText('Review exposures')).toHaveAttribute('aria-current', 'step');
    fireEvent.change(roleSelects()[0], { target: { value: 'normal' } });
    expect(roleSelects().map((s) => s.value)).toEqual(['normal', 'under', 'over']);
    expect(screen.getByRole('button', { name: 'Merge' })).toBeEnabled();
  });

  test('without exposure data, roles come from brightness and say so', async () => {
    const plain = { 'x.ARW': bracketInput('x.ARW', null, 50000), 'y.ARW': bracketInput('y.ARW', null, 2000), 'z.ARW': bracketInput('z.ARW', null, 9000) };
    const { choose } = openDialog({ inspect: (file) => Promise.resolve(plain[file.name]) });
    await choose(['x.ARW', 'y.ARW', 'z.ARW']);
    await waitFor(() => expect(roleSelects().map((s) => s.value)).toEqual(['over', 'under', 'normal']));
    expect(screen.getByText(/suggested from brightness/)).toBeInTheDocument();
  });

  test('refuses unsuitable sets with the reason and keeps Merge disabled', async () => {
    const same = { '1.ARW': bracketInput('1.ARW', 1 / 30, 9000), '2.ARW': bracketInput('2.ARW', 1 / 30, 9000), '3.ARW': bracketInput('3.ARW', 1 / 30, 9000) };
    const { choose } = openDialog({ inspect: (file) => Promise.resolve(same[file.name]) });
    await choose(['1.ARW', '2.ARW', '3.ARW']);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/not an exposure bracket/));
    expect(screen.getByRole('button', { name: 'Merge' })).toBeDisabled();
  });

  test('a file that cannot be read shows its error and can be removed or replaced', async () => {
    const { choose } = openDialog({ inspect: (file) => (file.name === 'bad.CR2' ? Promise.reject(new Error('RAW or TIFF files from Canon are not supported.')) : inspect(file)) });
    await choose(['b.ARW', 'bad.CR2', 'a.ARW']);
    await waitFor(() => expect(screen.getByText(/Canon are not supported/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Merge' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove bad.CR2 from the bracket' }));
    expect(screen.queryByText(/Canon/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Choose 1 more…' })).toBeInTheDocument();
  });

  test('more than three files: the extra ones are not added, with a note', async () => {
    const { choose } = openDialog({ inspect });
    await choose(['b.ARW', 'c.ARW', 'a.ARW', 'a.ARW']);
    expect(screen.getByRole('alert')).toHaveTextContent(/exactly three photos; 1 extra file was not added/);
  });

  test('merging shows progress, can be cancelled, and reports errors without closing', async () => {
    let reject;
    const cancel = vi.fn(() => reject(Object.assign(new Error('Cancelled.'), { code: 'cancelled' })));
    const merge = vi.fn((inputs, settings, onProgress) => {
      onProgress({ stage: 'decoding', index: 1, fraction: 0.3 });
      return { promise: new Promise((_, r) => { reject = r; }), cancel };
    });
    const onMerged = vi.fn();
    const { choose } = openDialog({ inspect, merge, onMerged });
    await choose(['b.ARW', 'c.ARW', 'a.ARW']);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Merge' })).toBeEnabled());
    fireEvent.click(screen.getByRole('checkbox', { name: /Reduce ghosting/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    expect(merge.mock.calls[0][1]).toEqual({ align: true, deghost: false, deghostStrength: 50 });
    expect(merge.mock.calls[0][0].map(({ role }) => role)).toEqual(['over', 'under', 'normal']);
    expect(within(screen.getByRole('list', { name: 'Steps' })).getByText('Align and merge')).toHaveAttribute('aria-current', 'step');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });
    expect(cancel).toHaveBeenCalled();
    expect(screen.getByText('Merge cancelled.')).toBeInTheDocument();
    expect(onMerged).not.toHaveBeenCalled();
    merge.mockImplementationOnce(() => ({ promise: Promise.reject(new Error('These photos do not appear to show the same scene.')), cancel: () => {} }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Merge' })); });
    expect(screen.getByRole('alert')).toHaveTextContent(/same scene/);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('the source files of a saved merge get its roles and settings back', async () => {
    const saved = [{ source: { name: 'a-HDR', hdr: { mode: 'radiance', settings: { align: false, deghost: true, deghostStrength: 80 }, inputs: [
      { name: 'b.ARW', size: 5, sha256: byName['b.ARW'].sha256, role: 'under' },
      { name: 'c.ARW', size: 5, sha256: byName['c.ARW'].sha256, role: 'over' },
      { name: 'a.ARW', size: 5, sha256: byName['a.ARW'].sha256, role: 'normal' },
    ] } } }];
    const { choose } = openDialog({ inspect, pending: saved });
    await choose(['b.ARW', 'c.ARW', 'a.ARW']);
    await waitFor(() => expect(roleSelects().map((s) => s.value)).toEqual(['under', 'over', 'normal']));
    expect(screen.getByText(/source files of a-HDR/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Align photos/ })).not.toBeChecked();
    expect(screen.getByRole('slider')).toHaveValue('80');
  });
});
