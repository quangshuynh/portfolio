import React, { useReducer, useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import AdjustPanel from './AdjustPanel';
import ExportPanel from './ExportPanel';
import { editorReducer, initialEditorState } from '../model/editorState.mjs';
import { PRESET_PACK_TYPE } from '../model/presets.mjs';

const LUT = { sha256: 'a'.repeat(64), name: 'look.cube', title: 'Look', size: 33 };

beforeEach(() => localStorage.clear());

/** AdjustPanel on the real reducer with one ready photo; exposes state and callbacks. */
function Harness({ onState, library = [], onImport = () => {}, onPreview = () => {}, onDownload = () => {}, initialPresets = [] }) {
  const [state, dispatch] = useReducer(editorReducer, undefined, () => {
    let s = editorReducer(initialEditorState(), { type: 'photosAdded', photos: [{ id: 'a', name: 'a.jpg', size: 1, lastModified: 0 }] });
    s = editorReducer(s, { type: 'importSucceeded', id: 'a', info: { format: 'jpeg', width: 10, height: 10, orientation: 1, sha256: null } });
    return s;
  });
  const [userPresets, setUserPresets] = useState(initialPresets);
  onState(state, dispatch, userPresets);
  let next = 0;
  return (
    <AdjustPanel
      adjustments={state.photos[0].history.present}
      disabled={false}
      dispatch={dispatch}
      lut={{ library, onImport, status: {} }}
      presets={{ userPresets, onChange: setUserPresets, onPreview, onDownload, newId: () => `p${(next += 1)}-${Math.random()}` }}
    />
  );
}

let state;
let dispatch;
let presets;
const present = () => state.photos[0].history.present;
const setup = (props = {}) => render(<Harness onState={(s, d, p) => { state = s; dispatch = d; presets = p; }} {...props} />);
const openSection = (name) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));

describe('collapsible groups', () => {
  test('advanced groups start collapsed, open on demand and remember it', () => {
    const { unmount } = setup();
    ['HSL', 'Tone Curve', 'LUT', 'Presets'].forEach((name) => expect(screen.getByRole('button', { name: new RegExp(`^${name}`) })).toHaveAttribute('aria-expanded', 'false'));
    openSection('HSL');
    expect(screen.getByRole('button', { name: /^HSL/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('slider', { name: 'Red hue' })).toBeVisible();
    unmount();
    setup();
    expect(screen.getByRole('button', { name: /^HSL/ })).toHaveAttribute('aria-expanded', 'true');
  });

  test('a group shows when it is edited and resets on its own', () => {
    setup();
    act(() => dispatch({ type: 'applySettings', patch: { exposure: 1, contrast: 20, saturation: 30 } }));
    expect(screen.getByRole('button', { name: 'Light (edited)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset Light' }));
    expect(present()).toMatchObject({ exposure: 0, contrast: 0, saturation: 30 });
    expect(screen.queryByRole('button', { name: 'Light (edited)' })).toBeNull();
  });
});

describe('value fields', () => {
  test('focusing never rewrites the text, so the first typed characters are not appended to it', () => {
    setup({ library: [LUT] });
    act(() => dispatch({ type: 'applySettings', patch: { lut: LUT } }));
    openSection('LUT');
    const field = screen.getByRole('textbox', { name: 'Intensity value' });
    fireEvent.focus(field);
    expect(field).toHaveValue('100%');
    fireEvent.change(field, { target: { value: '60' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(present().lutIntensity).toBe(60);
    // The formatted text itself also commits: "+0.50 EV" is read as 0.5.
    const exposure = screen.getByRole('textbox', { name: 'Exposure value' });
    fireEvent.focus(exposure);
    fireEvent.change(exposure, { target: { value: '+0.50 EV' } });
    fireEvent.blur(exposure);
    expect(present().exposure).toBe(0.5);
  });
});

describe('HSL panel', () => {
  test('each colour range has hue, saturation and luminance, and resets on its own', () => {
    setup();
    openSection('HSL');
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
    const slider = screen.getByRole('slider', { name: 'Blue saturation' });
    fireEvent.input(slider, { target: { value: '-40' } });
    expect(present().blueSaturation).toBe(-40);
    expect(screen.getByRole('button', { name: 'Blue (edited)' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Red' }));
    fireEvent.input(screen.getByRole('slider', { name: 'Red hue' }), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset red' }));
    expect(present()).toMatchObject({ redHue: 0, blueSaturation: -40 });
    fireEvent.click(screen.getByRole('button', { name: 'Reset HSL' }));
    expect(present().blueSaturation).toBe(0);
  });
});

describe('tone curve editor', () => {
  test('points are keyboard sliders: arrows move them, Shift by 10, within their neighbours', () => {
    setup();
    openSection('Tone Curve');
    fireEvent.click(screen.getByRole('button', { name: 'Add point' }));
    expect(present().curves.master).toEqual([[0, 0], [128, 128], [255, 255]]);
    const point = screen.getByRole('slider', { name: 'Point 2 of 3' });
    fireEvent.keyDown(point, { key: 'ArrowUp', shiftKey: true });
    fireEvent.keyDown(point, { key: 'ArrowUp' });
    expect(present().curves.master[1]).toEqual([128, 139]);
    expect(point).toHaveAttribute('aria-valuetext', 'Input 128, output 139');
    // Repeated key steps on one curve are one undo step.
    act(() => dispatch({ type: 'undo' }));
    expect(present().curves.master[1]).toEqual([128, 128]);
    // Inputs stay strictly between neighbours, so points never cross or duplicate.
    fireEvent.keyDown(point, { key: 'ArrowLeft', shiftKey: true });
    for (let i = 0; i < 20; i += 1) fireEvent.keyDown(point, { key: 'ArrowLeft', shiftKey: true });
    expect(present().curves.master[1][0]).toBe(1);
  });

  test('numeric fields edit the selected point; Delete removes it; channels are separate', () => {
    setup();
    openSection('Tone Curve');
    fireEvent.click(screen.getByRole('button', { name: 'Red' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add point' }));
    fireEvent.focus(screen.getByRole('slider', { name: 'Point 2 of 3' }));
    const output = screen.getByRole('spinbutton', { name: 'Output' });
    fireEvent.change(output, { target: { value: '160' } });
    fireEvent.keyDown(output, { key: 'Enter' });
    expect(present().curves.red).toEqual([[0, 0], [128, 160], [255, 255]]);
    expect(present().curves.master).toEqual([[0, 0], [255, 255]]);
    expect(screen.getByRole('button', { name: 'Red (edited)' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Point 2 of 3' }), { key: 'Delete' });
    expect(present().curves.red).toEqual([[0, 0], [255, 255]]);
    expect(screen.getByRole('button', { name: 'Remove point' })).toBeDisabled();
  });

  test('the endpoints cannot be removed below two points, and Reset restores the channel', () => {
    setup();
    openSection('Tone Curve');
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Point 1 of 2' }), { key: 'ArrowUp', shiftKey: true });
    expect(present().curves.master[0]).toEqual([0, 10]);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Point 1 of 2' }), { key: 'Delete' });
    expect(present().curves.master).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Reset RGB' }));
    expect(present().curves.master).toEqual([[0, 0], [255, 255]]);
  });
});

describe('LUT panel', () => {
  test('choosing, intensity and removing a LUT are settings of the photo', () => {
    setup({ library: [LUT] });
    openSection('LUT');
    expect(screen.getByRole('slider', { name: 'Intensity' })).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: 'LUT' }), { target: { value: LUT.sha256 } });
    expect(present().lut).toEqual(LUT);
    fireEvent.input(screen.getByRole('slider', { name: 'Intensity' }), { target: { value: '45' } });
    expect(present().lutIntensity).toBe(45);
    expect(screen.getByRole('textbox', { name: 'Intensity value' })).toHaveValue('45%');
    fireEvent.click(screen.getByRole('button', { name: 'Remove LUT' }));
    expect(present().lut).toBeNull();
  });

  test('a LUT that is referenced but not imported is reported, and export is blocked', () => {
    setup({ library: [] });
    act(() => dispatch({ type: 'applySettings', patch: { lut: LUT } }));
    openSection('LUT');
    expect(screen.getByRole('alert')).toHaveTextContent('LUT not loaded: look.cube (33³)');
    expect(screen.getByRole('combobox', { name: 'LUT' })).toHaveDisplayValue('Missing: look.cube');
    render(<ExportPanel settings={state.exportSettings} photo={state.photos[0]} dispatch={() => {}} onExport={() => {}} onCancel={() => {}} unsupportedFormats={[]} busy={false} blockedReason="The LUT is not loaded." />);
    expect(screen.getByRole('button', { name: 'Export photo' })).toBeDisabled();
  });

  test('importing passes the chosen file to the editor', () => {
    const onImport = vi.fn();
    setup({ onImport });
    openSection('LUT');
    const file = new File(['LUT_3D_SIZE 2'], 'look.cube');
    fireEvent.change(screen.getByLabelText('Import a .cube LUT'), { target: { files: [file] } });
    expect(onImport).toHaveBeenCalledWith(file);
  });
});

describe('presets panel', () => {
  test('hovering previews a built-in preset; clicking applies it as one undo step', () => {
    const onPreview = vi.fn();
    setup({ onPreview });
    openSection('Presets');
    const natural = screen.getByRole('button', { name: 'Apply Natural' });
    fireEvent.pointerEnter(natural);
    expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Natural' }));
    fireEvent.click(natural);
    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(present()).toMatchObject({ contrast: 8, vibrance: 15 });
    expect(state.photos[0].history.past).toHaveLength(1);
  });

  test('saves the current settings with chosen groups, then renames and deletes with confirmation', () => {
    setup();
    act(() => dispatch({ type: 'applySettings', patch: { exposure: 1, contrast: 30, blueHue: 20 } }));
    openSection('Presets');
    fireEvent.click(screen.getByRole('button', { name: 'Save current as preset…' }));
    // Changed groups are preselected, except per-photo exposure and white balance.
    expect(screen.getByRole('checkbox', { name: 'Tone' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'HSL' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Exposure' })).not.toBeChecked();
    fireEvent.change(screen.getByRole('textbox', { name: 'Preset name' }), { target: { value: 'Blue punch' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save preset' }));
    expect(presets).toEqual([expect.objectContaining({ name: 'Blue punch', groups: ['tone', 'hsl'] })]);
    expect(presets[0].settings).toMatchObject({ contrast: 30, blueHue: 20 });
    expect(presets[0].settings.exposure).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'Rename Blue punch' }));
    const field = screen.getByRole('textbox', { name: 'New name for Blue punch' });
    fireEvent.change(field, { target: { value: 'Natural' } });
    fireEvent.submit(field.closest('form'));
    expect(presets[0].name).toBe('Natural');

    const list = screen.getAllByRole('list').at(-1);
    fireEvent.click(within(list).getByRole('button', { name: 'Delete Natural' }));
    expect(presets).toHaveLength(1);
    fireEvent.click(within(list).getByRole('button', { name: 'Confirm deleting Natural' }));
    expect(presets).toHaveLength(0);
  });

  test('exports user presets as a pack and imports files, reporting bad ones', async () => {
    const onDownload = vi.fn();
    setup({ onDownload, initialPresets: [{ id: 'x', name: 'Mine', groups: ['presence'], settings: { saturation: -20 } }] });
    openSection('Presets');
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    const [blob, name] = onDownload.mock.calls[0];
    expect(name).toBe('photo-editor-presets.json');
    const text = await blob.text();
    expect(JSON.parse(text)).toMatchObject({ type: PRESET_PACK_TYPE, presets: [{ name: 'Mine' }] });

    const input = screen.getByLabelText('Import presets');
    await act(async () => fireEvent.change(input, { target: { files: [new File([text], 'p.json')] } }));
    expect(presets.map(({ name: n }) => n)).toEqual(['Mine', 'Mine (2)']);
    await act(async () => fireEvent.change(input, { target: { files: [new File(['{"type":"x"}'], 'bad.json')] } }));
    expect(screen.getByRole('alert')).toHaveTextContent('This is not a photo editor preset file.');
  });
});

describe('Detail section', () => {
  test('sits between HSL and Tone Curve, starts collapsed and holds the six controls', () => {
    setup();
    const order = screen.getAllByRole('button', { expanded: false }).map((button) => button.getAttribute('aria-label')).filter(Boolean);
    expect(order.indexOf('Detail')).toBeGreaterThan(order.indexOf('HSL'));
    expect(order.indexOf('Detail')).toBeLessThan(order.indexOf('Tone Curve'));
    openSection('Detail');
    ['Texture', 'Clarity', 'Dehaze', 'Sharpening', 'Luminance noise reduction', 'Color noise reduction'].forEach((name) => expect(screen.getByRole('slider', { name })).toBeVisible());
    expect(screen.getByRole('slider', { name: 'Sharpening' })).toHaveAttribute('min', '0');
    expect(screen.getByRole('slider', { name: 'Texture' })).toHaveAttribute('min', '-100');
  });

  test('slider, value field, per-control reset, group reset and undo', () => {
    setup();
    openSection('Detail');
    fireEvent.input(screen.getByRole('slider', { name: 'Clarity' }), { target: { value: '35' } });
    expect(present().clarity).toBe(35);
    const field = screen.getByRole('textbox', { name: 'Sharpening value' });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: '140' } });
    fireEvent.blur(field);
    expect(present().sharpening).toBe(100);
    expect(screen.getByRole('button', { name: 'Detail (edited)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset Sharpening' }));
    expect(present()).toMatchObject({ sharpening: 0, clarity: 35 });
    fireEvent.click(screen.getByRole('button', { name: 'Reset Detail' }));
    expect(present().clarity).toBe(0);
    act(() => dispatch({ type: 'undo' }));
    expect(present().clarity).toBe(35);
  });

  test('presets offer the Detail group when Detail is edited', () => {
    setup();
    act(() => dispatch({ type: 'applySettings', patch: { texture: 20, colorNoise: 40 } }));
    openSection('Presets');
    fireEvent.click(screen.getByRole('button', { name: 'Save current as preset…' }));
    expect(screen.getByRole('checkbox', { name: 'Detail' })).toBeChecked();
  });
});
