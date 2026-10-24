import React, { useReducer } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import AdjustPanel from './AdjustPanel';
import LayerHandles from './LayerHandles';
import { editorReducer, initialEditorState } from '../model/editorState.mjs';
import { createPreset } from '../model/presets.mjs';
import { BUILT_IN_LOOKS, lookPatch } from '../model/looks.mjs';
import { createTextOverlay, normalizeOverlays } from '../model/overlays.mjs';
import { normalizeLayers } from '../model/layers.mjs';
import { groupIsNeutral, normalizeAdjustments } from '../model/adjustments.mjs';
import { deriveParams } from '../pipeline/spec.mjs';
import { DEFAULT_SYNC_GROUPS, planSync } from '../model/sync.mjs';
import { DOCUMENT_VERSION, createEditDocument, parseEditDocument, serializeEditDocument } from '../model/editDocument.mjs';

beforeEach(() => localStorage.clear());

function Harness({ onState, onPreview = () => {}, text = {}, presets = {} }) {
  const [state, dispatch] = useReducer(editorReducer, undefined, () => {
    let s = editorReducer(initialEditorState(), { type: 'photosAdded', photos: [{ id: 'a', name: 'a.jpg', size: 1, lastModified: 0 }] });
    s = editorReducer(s, { type: 'importSucceeded', id: 'a', info: { format: 'jpeg', width: 1200, height: 800, orientation: 1, sha256: null } });
    return s;
  });
  onState(state, dispatch);
  const [selectedId, setSelectedId] = React.useState(null);
  return (
    <AdjustPanel
      adjustments={state.photos[0].history.present}
      disabled={false}
      dispatch={dispatch}
      lut={{ library: [], onImport: () => {}, status: {} }}
      presets={{ userPresets: [], onChange: () => {}, onPreview, onDownload: () => {}, newId: () => 'p1', ...presets }}
      text={{ selectedId, onSelect: setSelectedId, editing: false, onTool: () => {}, focusRequest: 0, ...text }}
    />
  );
}

let state;
let dispatch;
const present = () => state.photos[0].history.present;
const setup = (props = {}) => render(<Harness onState={(s, d) => { state = s; dispatch = d; }} {...props} />);
const openSection = (name) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
const setNumber = (name, value) => {
  const field = screen.getByRole('textbox', { name: `${name} value` });
  fireEvent.change(field, { target: { value: String(value) } });
  fireEvent.blur(field);
};

describe('Creative section', () => {
  test('starts collapsed and renders its controls only when opened', () => {
    setup();
    expect(screen.getByRole('button', { name: /^Creative/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('slider', { name: 'Bleach bypass amount' })).toBeNull();
    openSection('Creative');
    ['Bleach bypass amount', 'Fade', 'Grain amount', 'Bloom amount', 'Halation amount', 'Vignette amount', 'Shadows hue', 'Grading balance'].forEach((name) => expect(screen.getByRole('slider', { name })).toBeInTheDocument());
  });

  test('a filter previews on hover, applies as one undo step, scales by strength and keeps every other edit', () => {
    const onPreview = vi.fn();
    setup({ onPreview });
    openSection('Creative');
    act(() => dispatch({ type: 'applySettings', patch: { exposure: 0.5, grainSeed: 77, vignetteRoundness: 40 } }));
    const look = BUILT_IN_LOOKS.find(({ name }) => name === 'Warm Analog');
    const button = screen.getByRole('button', { name: 'Warm Analog' });
    fireEvent.pointerEnter(button, { pointerType: 'mouse' });
    expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Warm Analog', groups: ['creative'] }));
    fireEvent.click(button);
    expect(present()).toMatchObject({ ...lookPatch(look, 100), exposure: 0.5, grainSeed: 77, filter: { id: look.id, strength: 100 } });
    // The filter replaces the Creative group: a value it does not set returns to neutral.
    expect(present().vignetteRoundness).toBe(0);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    const strength = screen.getByRole('slider', { name: 'Filter strength' });
    fireEvent.input(strength, { target: { value: '50' } });
    expect(present().grainAmount).toBe(Math.round(look.settings.grainAmount / 2));
    expect(present().gradeHighlightsHue).toBe(look.settings.gradeHighlightsHue);
    expect(present().filter).toEqual({ id: look.id, strength: 50 });
    // Strength 0 is the photo without Creative effects, other edits kept.
    fireEvent.input(strength, { target: { value: '0' } });
    expect(deriveParams(present()).creativeActive).toBe(false);
    expect(present().exposure).toBe(0.5);
    fireEvent.input(strength, { target: { value: '50' } });
    // Compare shows the photo without the filter (nothing recorded).
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
    expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Without filter', settings: { grainSeed: 77 } }));
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
    expect(onPreview).toHaveBeenLastCalledWith(null);
    // Changing a control by hand marks the filter modified; its strength is then locked until reverted.
    setNumber('Grain amount', 5);
    expect(screen.getByText('Modified')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Filter strength' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Revert changes' }));
    expect(present().grainAmount).toBe(Math.round(look.settings.grainAmount / 2));
    // A second filter replaces the first.
    fireEvent.click(screen.getByRole('button', { name: 'Sepia' }));
    expect(present().filter).toEqual({ id: 'filter:sepia', strength: 100 });
    expect(present().halationAmount).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter' }));
    expect(present().filter).toBeNull();
    expect(groupIsNeutral({ ...present(), grainSeed: 0 }, 'creative')).toBe(true);
    // Six steps: apply, strength (coalesced), the hand edit, revert, Sepia, remove.
    for (let i = 0; i < 6; i += 1) act(() => dispatch({ type: 'undo' }));
    expect(present().filter).toBeNull();
    expect(present().exposure).toBe(0.5);
    expect(groupIsNeutral({ ...present(), grainSeed: 0, vignetteRoundness: 0 }, 'creative')).toBe(true);
  }, 20000);

  test('filters can be searched, browsed by category, starred, found again under Recent and saved as custom filters', () => {
    const onChange = vi.fn();
    render(<Harness onState={(s, d) => { state = s; dispatch = d; }} presets={{ onChange }} />);
    openSection('Creative');
    const grid = () => screen.getByRole('list', { name: 'Filters' });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search filters' }), { target: { value: 'jpeg' } });
    expect(within(grid()).getAllByRole('button', { name: /^(?!Favorite)/ }).map((b) => b.textContent)).toEqual(expect.arrayContaining(['JPEG Damage']));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search filters' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Experimental' }));
    expect(within(grid()).queryByRole('button', { name: 'Sepia' })).toBeNull();
    expect(within(grid()).getByRole('button', { name: 'Pixelated' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Favorite Pixelated' }));
    expect(JSON.parse(localStorage.getItem('photo-editor:filters:favorites:v1'))).toEqual(['filter:pixelated']);
    fireEvent.click(within(grid()).getByRole('button', { name: 'Pixelated' }));
    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }));
    expect(within(grid()).getAllByRole('button', { name: 'Pixelated' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Recent' }));
    expect(within(grid()).getByRole('button', { name: 'Pixelated' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save as custom' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Custom filter name' }), { target: { value: 'My blocks' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const [[saved]] = onChange.mock.calls;
    expect(saved[0]).toMatchObject({ name: 'My blocks', groups: ['creative'], settings: { captureResolution: 85, pixelEdges: 100 } });
    expect(present().filter).toEqual({ id: 'preset:My blocks', strength: 100 });
  }, 20000);

  test('each part resets on its own; character settings stay disabled until their amount is set', { timeout: 20000 }, () => {
    setup();
    openSection('Creative');
    expect(screen.getByRole('slider', { name: 'Black tint hue' })).toBeDisabled();
    setNumber('Fade', 30);
    expect(screen.getByRole('slider', { name: 'Black tint hue' })).toBeEnabled();
    setNumber('Vignette amount', -40);
    fireEvent.click(screen.getByRole('button', { name: 'Reset Film' }));
    expect(present()).toMatchObject({ fade: 0, vignetteAmount: -40 });
    expect(screen.getByRole('button', { name: 'New grain pattern' })).toBeDisabled();
    setNumber('Grain amount', 30);
    fireEvent.click(screen.getByRole('button', { name: 'New grain pattern' }));
    expect(present().grainSeed).not.toBe(0);
  });

  test('colour grading: ranges, sliders as the keyboard alternative to the wheel, and the wheel by pointer', () => {
    setup();
    openSection('Creative');
    fireEvent.click(screen.getByRole('button', { name: 'Highlights' }));
    const hue = screen.getByRole('slider', { name: 'Highlights hue' });
    fireEvent.input(hue, { target: { value: '200' } });
    expect(present().gradeHighlightsHue).toBe(200);
    setNumber('Highlights saturation', 35);
    expect(screen.getByRole('button', { name: 'Highlights (edited)' })).toBeInTheDocument();
    const wheel = document.querySelector('.pe-wheel');
    expect(wheel).toHaveAttribute('aria-hidden', 'true');
    wheel.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 });
    fireEvent.pointerDown(wheel, { button: 0, clientX: 50, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(wheel, { clientX: 50, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(present()).toMatchObject({ gradeHighlightsHue: 90, gradeHighlightsSat: 100 });
  });
});

describe('Text section', () => {
  test('add, edit, duplicate, reorder and delete text, each an undo step', () => {
    setup();
    openSection('Text');
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }));
    expect(present().layers).toHaveLength(1);
    const textarea = screen.getByRole('textbox', { name: 'Text' });
    fireEvent.change(textarea, { target: { value: 'Ha Long Bay\u0007\r\nat dusk' } });
    expect(present().layers[0].text).toBe('Ha Long Bay\nat dusk');
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(present().layers).toHaveLength(2);
    expect(present().layers[1].x).toBeCloseTo(present().layers[0].x + 0.03, 5);
    // The copy is selected and in front; send it backward.
    fireEvent.click(screen.getByRole('button', { name: 'Send backward' }));
    expect(present().layers[0].id).not.toBe(present().layers[1].id);
    const ids = present().layers.map(({ id }) => id);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(present().layers.map(({ id }) => id)).toEqual([ids[1]]);
    act(() => dispatch({ type: 'undo' }));
    expect(present().layers.map(({ id }) => id)).toEqual(ids);
    act(() => dispatch({ type: 'redo' }));
    expect(present().layers).toHaveLength(1);
  });

  test('font, weight, alignment, outline, shadow and transform are stored per object', () => {
    setup();
    openSection('Text');
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Font' }), { target: { value: 'mono' } });
    expect(screen.getByRole('checkbox', { name: 'Italic' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Right' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Outline' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Shadow' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: /^Rotation value/ }), { target: { value: '-30' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: /^Size value/ }), { target: { value: '12' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: /^Opacity value/ }), { target: { value: '80' } });
    expect(present().layers[0]).toMatchObject({ font: 'mono', align: 'right', rotation: -30, size: 0.12, opacity: 0.8, outline: { width: 0.06 }, shadow: { opacity: 0.6 } });
  });
});

describe('text on the photo', () => {
  const output = { width: 1200, height: 800 };
  const box = { x: 0, y: 0, width: 600, height: 400 };
  const renderLayer = (props) => render(
    <div className="pe-stage-area">
      <LayerHandles layers={normalizeLayers([createTextOverlay('t1', { text: 'Hello' })])} box={box} output={output} selectedId="t1" onSelect={() => {}} onPreview={() => {}} onCommit={() => {}} onApply={() => {}} onEdit={() => {}} {...props} />
    </div>,
  );

  test('keyboard: arrows move (Shift larger), Delete removes, Enter edits, Escape deselects', () => {
    const onApply = vi.fn();
    const onEdit = vi.fn();
    const onSelect = vi.fn();
    renderLayer({ onApply, onEdit, onSelect });
    const text = screen.getByRole('button', { name: /^Text “Hello”/ });
    fireEvent.keyDown(text, { key: 'ArrowRight' });
    expect(onApply.mock.calls[0][0][0].x).toBeCloseTo(0.502, 6);
    fireEvent.keyDown(text, { key: 'ArrowUp', shiftKey: true });
    expect(onApply.mock.calls[1][0][0].y).toBeCloseTo(0.48, 6);
    fireEvent.keyDown(text, { key: 'Enter' });
    expect(onEdit).toHaveBeenCalledWith('t1');
    fireEvent.keyDown(text, { key: 'Delete' });
    expect(onApply.mock.calls[2][0]).toEqual([]);
    fireEvent.keyDown(text, { key: 'Escape' });
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  test('drags move, resize and rotate only the text, previewing and committing once', () => {
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    const stagePointer = vi.fn();
    render(
      <div className="pe-stage-area" onPointerDown={stagePointer}>
        <LayerHandles layers={normalizeLayers([createTextOverlay('t1', { text: 'Hello' })])} box={box} output={output} selectedId="t1" onSelect={() => {}} onPreview={onPreview} onCommit={onCommit} onApply={() => {}} onEdit={() => {}} />
      </div>,
    );
    document.querySelector('.pe-stage-area').getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 400 });
    const text = screen.getByRole('button', { name: /^Text “Hello”/ });
    fireEvent.pointerDown(text, { button: 0, clientX: 300, clientY: 200, pointerId: 3 });
    fireEvent.pointerMove(text, { clientX: 360, clientY: 160, pointerId: 3 });
    fireEvent.pointerUp(text, { clientX: 360, clientY: 160, pointerId: 3 });
    expect(stagePointer).not.toHaveBeenCalled();
    expect(onPreview.mock.calls.at(-1)[0][0]).toMatchObject({ x: 0.6, y: 0.4 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    const scale = document.querySelector('.pe-textbox__handle--scale');
    fireEvent.pointerDown(scale, { button: 0, clientX: 340, clientY: 200, pointerId: 4 });
    fireEvent.pointerUp(scale, { clientX: 380, clientY: 200, pointerId: 4 });
    expect(onPreview.mock.calls.at(-1)[0][0].scale).toBeCloseTo(2, 6);
    const rotate = document.querySelector('.pe-textbox__handle--rotate');
    fireEvent.pointerDown(rotate, { button: 0, clientX: 300, clientY: 150, pointerId: 5 });
    fireEvent.pointerUp(rotate, { clientX: 350, clientY: 200, pointerId: 5, shiftKey: true });
    expect(onPreview.mock.calls.at(-1)[0][0].rotation).toBe(90);
    expect(onCommit).toHaveBeenCalledTimes(3);
  });

  test('a locked layer can be selected but not moved or deleted', () => {
    const onApply = vi.fn();
    const onPreview = vi.fn();
    const onSelect = vi.fn();
    renderLayer({ layers: normalizeLayers([{ ...createTextOverlay('t1', { text: 'Hello' }), locked: true }]), onApply, onPreview, onSelect });
    const text = screen.getByRole('button', { name: /^Text “Hello”\. Locked/ });
    fireEvent.keyDown(text, { key: 'ArrowRight' });
    fireEvent.keyDown(text, { key: 'Delete' });
    fireEvent.pointerDown(text, { button: 0, clientX: 300, clientY: 200, pointerId: 3 });
    fireEvent.pointerMove(text, { clientX: 360, clientY: 160, pointerId: 3 });
    expect(onApply).not.toHaveBeenCalled();
    expect(onPreview).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith('t1');
    expect(document.querySelector('.pe-textbox__handle')).toBeNull();
  });
});

describe('creative settings and text in presets, sync and documents', () => {
  const overlays = normalizeOverlays([{ id: 'a', type: 'text', text: 'One' }, { id: 'b', text: 'Two', color: '#ff0000', shadow: { blur: 0.2 } }]);
  const values = normalizeAdjustments({ bleachAmount: 40, grainAmount: 20, grainSeed: 9, gradeShadowsSat: 30, overlays });

  test('presets carry Creative but never text', () => {
    const preset = createPreset('Look', values, ['creative']);
    expect(preset.settings).toMatchObject({ bleachAmount: 40, grainAmount: 20, gradeShadowsSat: 30 });
    expect(preset.settings.overlays).toBeUndefined();
  });

  test('sync copies Creative by default, text only when ticked; paste never copies text', () => {
    expect(DEFAULT_SYNC_GROUPS).toContain('creative');
    expect(DEFAULT_SYNC_GROUPS).not.toContain('layers');
    const target = { id: 't', name: 't.jpg', status: 'ready', history: { present: normalizeAdjustments({ overlays: normalizeOverlays([{ id: 'x', text: 'Mine' }]) }) } };
    const pasted = planSync(values, [target]);
    expect(pasted.items[0].after).toMatchObject({ bleachAmount: 40 });
    expect(pasted.items[0].after.layers.map(({ text }) => text)).toEqual(['Mine']);
    const withText = planSync(values, [target], { groups: [...DEFAULT_SYNC_GROUPS, 'layers'] });
    expect(withText.items[0].after.layers.map(({ text }) => text)).toEqual(['One', 'Two']);
    expect(withText.items[0].changed).toEqual(expect.arrayContaining(['creative', 'layers']));
  });

  test('documents (version 9) keep creative values and editable text layers; older versions open without them', () => {
    const photo = { name: 'a.jpg', size: 1, lastModified: 0, sha256: null, format: 'jpeg', width: 10, height: 10, adjustments: values };
    const text = serializeEditDocument(createEditDocument([photo], {}, new Date(0)));
    const saved = JSON.parse(text);
    expect(saved.version).toBe(DOCUMENT_VERSION);
    expect(DOCUMENT_VERSION).toBe(9);
    expect(saved.photos[0].adjustments.layers[1]).toMatchObject({ id: 'b', text: 'Two', color: '#ff0000', shadow: { blur: 0.2 } });
    const read = parseEditDocument(text).photos[0].adjustments;
    expect(read).toMatchObject({ bleachAmount: 40, grainSeed: 9 });
    expect(read.layers).toEqual(values.layers);
    const old = parseEditDocument(JSON.stringify({ type: 'quanghuynh.photo-editor.edits', version: 6, photos: [{ source: { name: 'a.jpg', size: 1 }, adjustments: { exposure: 1 } }] }));
    expect(old.photos[0].adjustments).toMatchObject({ exposure: 1, bleachAmount: 0, layers: [] });
  });

  test('malformed text objects are dropped or clamped; text stays plain data', () => {
    const hostile = parseEditDocument(JSON.stringify({
      type: 'quanghuynh.photo-editor.edits',
      version: 7,
      photos: [{
        source: { name: 'a.jpg', size: 1 },
        adjustments: {
          overlays: [
            { id: 'ok', text: '<img src=x onerror=alert(1)>‮', size: 99, x: 1e9, rotation: 725, color: 'red', opacity: -3, font: 'Comic Sans', weight: 900, align: 'justify', outline: { width: 9 }, shadow: 'yes' },
            { id: 'ok', text: 'duplicate id' },
            { id: '../../etc', text: 'bad id' },
            { id: 'img', type: 'image', text: 'not text' },
            'string',
            ...Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, text: 'x'.repeat(900) })),
          ],
          bleachAmount: 1e6,
          grainSeed: -5,
        },
      }],
    })).photos[0].adjustments;
    const [first] = hostile.layers;
    expect(first).toMatchObject({ id: 'ok', text: '<img src=x onerror=alert(1)>', size: 0.5, x: 2, rotation: 5, color: '#ffffff', opacity: 0, font: 'sans', weight: 700, align: 'center', outline: { width: 0.3 }, shadow: null });
    expect(hostile.layers).toHaveLength(30);
    expect(hostile.layers[1].text).toHaveLength(500);
    expect(hostile).toMatchObject({ bleachAmount: 100, grainSeed: 0 });
  });

  test('Reset all clears text too (one undo step brings it back)', () => {
    setup();
    act(() => dispatch({ type: 'applySettings', patch: { layers: normalizeLayers(overlays), fade: 20 } }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset all' }));
    expect(present().layers).toEqual([]);
    act(() => dispatch({ type: 'undo' }));
    expect(present().layers).toHaveLength(2);
  });
});
