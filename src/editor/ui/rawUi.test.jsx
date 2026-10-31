import React, { useReducer } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import AdjustPanel from './AdjustPanel';
import ExportPanel from './ExportPanel';
import { editorReducer, initialEditorState } from '../model/editorState.mjs';
import { DOCUMENT_VERSION, createEditDocument, parseEditDocument, serializeEditDocument } from '../model/editDocument.mjs';
import { BUILT_IN_PRESETS } from '../model/presets.mjs';
import { exposureSummary } from './RawPanel';

// What the decoder reports for a Sony A7 III frame (LibRaw's ILCE-7M3 colour data).
const RAW = {
  format: 'arw', make: 'Sony', model: 'ILCE-7M3', lens: 'FE 28-70mm F3.5-5.6 OSS', iso: 100, shutter: 1 / 250, aperture: 8, focalLength: 50,
  blackLevel: 512, whiteLevel: 16383, flip: 5, width: 4024, height: 6024, asShotAvailable: true, asShot: [2.33984375, 1, 1.53515625],
  rgbCam: [1.635386, -0.421962, -0.213424, -0.131072, 1.542707, -0.411635, 0.01143, -0.419593, 1.408163],
  camXyz: [0.7374, -0.2389, -0.0551, -0.5435, 1.3162, 0.2519, -0.1006, 0.1795, 0.6552],
};

beforeEach(() => localStorage.clear());

function Harness({ raw, onState }) {
  const [state, dispatch] = useReducer(editorReducer, undefined, () => {
    let s = editorReducer(initialEditorState(), { type: 'photosAdded', photos: [{ id: 'a', name: 'DSC09420.ARW', size: 1, lastModified: 0 }] });
    s = editorReducer(s, { type: 'importSucceeded', id: 'a', info: { format: raw ? 'arw' : 'jpeg', width: 4024, height: 6024, orientation: 1, sha256: null, raw } });
    return s;
  });
  onState(state, dispatch);
  return (
    <AdjustPanel
      adjustments={state.photos[0].history.present}
      disabled={false}
      dispatch={dispatch}
      raw={state.photos[0].raw ?? null}
      lut={{ library: [], onImport: () => {}, status: {} }}
      presets={{ userPresets: [], onChange: () => {}, onPreview: () => {}, onDownload: () => {}, newId: () => 'x' }}
    />
  );
}

let state;
let dispatch;
const present = () => state.photos[0].history.present;
const setup = (raw = RAW) => render(<Harness raw={raw} onState={(s, d) => { state = s; dispatch = d; }} />);

describe('RAW panel', () => {
  test('appears only for RAW photos, with the camera details', () => {
    const { unmount } = setup(null);
    expect(screen.queryByRole('button', { name: /^RAW/ })).toBeNull();
    unmount();
    setup();
    const panel = screen.getByRole('button', { name: /^RAW/ }).closest('section');
    expect(within(panel).getByText('Sony ILCE-7M3')).toBeInTheDocument();
    expect(within(panel).getByText('1/250 s · f/8 · ISO 100 · 50 mm')).toBeInTheDocument();
    expect(within(panel).getByText('Sony ARW · 4024×6024')).toBeInTheDocument();
    expect(exposureSummary({ shutter: 1.3, aperture: 4.5 })).toBe('1.3 s · f/4.5');
  });

  test('profile: Camera Natural for a new import, labelled, switchable and undoable; Legacy only for edits that have it', () => {
    setup();
    const select = screen.getByRole('combobox', { name: 'Profile' });
    expect(select).toHaveValue('camera-natural');
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['Camera Natural', 'Linear / Neutral']);
    expect(screen.getByTestId('raw-profile-note')).toHaveTextContent('does not imitate the camera');
    fireEvent.change(select, { target: { value: 'linear' } });
    expect(present()).toMatchObject({ exposure: 0, raw: { whiteBalance: 'as-shot', profile: 'linear' } });
    // Changing the white balance keeps the profile.
    fireEvent.change(screen.getByRole('combobox', { name: 'White balance' }), { target: { value: 'daylight' } });
    expect(present().raw).toEqual({ whiteBalance: 'daylight', profile: 'linear' });
    act(() => dispatch({ type: 'undo' }));
    act(() => dispatch({ type: 'undo' }));
    expect(present().raw.profile).toBe('camera-natural');
    act(() => dispatch({ type: 'applySettings', patch: { raw: { whiteBalance: 'as-shot', profile: 'legacy' } } }));
    expect(within(screen.getByRole('combobox', { name: 'Profile' })).getAllByRole('option')).toHaveLength(3);
    act(() => dispatch({ type: 'applySettings', patch: { raw: { whiteBalance: 'as-shot', profile: 'linear' } } }));
    expect(screen.getByTestId('raw-profile-note')).not.toHaveTextContent('BaselineExposure');
  });

  test('profile note names a DNG BaselineExposure', () => {
    setup({ ...RAW, format: 'dng', baselineExposure: -0.5 });
    expect(screen.getByTestId('raw-profile-note')).toHaveTextContent("Includes the file's DNG BaselineExposure (-0.50 EV).");
  });

  test('white balance: as shot, daylight and custom, with undo and group reset', () => {
    setup();
    const select = screen.getByRole('combobox', { name: 'White balance' });
    expect(within(select).getByRole('option', { name: 'As shot (5150 K, +5)' })).toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'RAW temperature' })).toBeNull();
    // Custom starts from the as-shot values, so the photo does not jump.
    fireEvent.change(select, { target: { value: 'custom' } });
    expect(present()).toMatchObject({ raw: { whiteBalance: 'custom' }, rawTemperature: 5150, rawTint: 5 });
    const field = screen.getByRole('textbox', { name: 'RAW temperature value' });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: '3200' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(present().rawTemperature).toBe(3200);
    // The colour panel's relative Temperature is a separate control.
    expect(present().temperature).toBe(0);
    act(() => dispatch({ type: 'undo' }));
    expect(present().rawTemperature).toBe(5150);
    fireEvent.change(select, { target: { value: 'daylight' } });
    expect(present()).toMatchObject({ raw: { whiteBalance: 'daylight' }, rawTemperature: 5500, rawTint: 0 });
    expect(screen.getByRole('button', { name: 'RAW (edited)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset RAW' }));
    // Reset keeps the rendering profile: it is the photo's starting point, not an edit.
    expect(present().raw).toEqual({ whiteBalance: 'as-shot', profile: 'camera-natural' });
  });

  test('presets leave the RAW white balance alone; saved edits keep it', () => {
    setup();
    fireEvent.change(screen.getByRole('combobox', { name: 'White balance' }), { target: { value: 'daylight' } });
    act(() => dispatch({ type: 'applyPreset', preset: BUILT_IN_PRESETS[0] }));
    expect(present().raw).toEqual({ whiteBalance: 'daylight', profile: 'camera-natural' });
    const photo = { ...state.photos[0], adjustments: present() };
    const document = JSON.parse(serializeEditDocument(createEditDocument([photo], state.exportSettings)));
    expect(document).toMatchObject({ version: DOCUMENT_VERSION, photos: [{ source: { format: 'arw', name: 'DSC09420.ARW' }, adjustments: { raw: { whiteBalance: 'daylight', profile: 'camera-natural' } } }] });
    expect(parseEditDocument(JSON.stringify(document)).photos[0]).toMatchObject({ source: { format: 'arw' }, adjustments: { raw: { whiteBalance: 'daylight' } } });
  });
});

describe('RAW export panel', () => {
  test('says RAW exports are developed again from the sensor data, named -quangedit', () => {
    const photo = { status: 'ready', name: 'DSC09420.ARW', width: 4024, height: 6024, raw: RAW, exportStatus: { state: 'running', stage: 'decoding' } };
    render(<ExportPanel settings={initialEditorState().exportSettings} photo={photo} dispatch={() => {}} onExport={() => {}} onCancel={() => {}} unsupportedFormats={[]} />);
    expect(screen.getByText('DSC09420-quangedit.jpg')).toBeInTheDocument();
    expect(screen.getByText('Decoding RAW sensor data…')).toBeInTheDocument();
    expect(screen.getByText(/never from the preview or the embedded camera JPEG/)).toBeInTheDocument();
  });
});
