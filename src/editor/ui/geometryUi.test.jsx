import React, { useReducer } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import AdjustPanel from './AdjustPanel';
import CropOverlay from './CropOverlay';
import ExportPanel from './ExportPanel';
import { exportGeometry } from '../io/files.mjs';
import { DEFAULT_EXPORT_SETTINGS } from '../model/editDocument.mjs';
import { editorReducer, initialEditorState } from '../model/editorState.mjs';
import { BUILT_IN_PRESETS, createPreset } from '../model/presets.mjs';
import { createEditDocument, parseEditDocument, serializeEditDocument, DOCUMENT_TYPE } from '../model/editDocument.mjs';
import { geometryPlan, neutralGeometry, normalizeGeometry } from '../pipeline/geometry.mjs';

const NATIVE = { width: 600, height: 400 };

beforeEach(() => localStorage.setItem('photo-editor:sections:v1', JSON.stringify({ geometry: true })));
afterEach(() => localStorage.clear());

/** AdjustPanel with the Crop & Transform handlers wired as EditorApp wires them. */
function Harness({ onState }) {
  const [state, dispatch] = useReducer(editorReducer, undefined, () => {
    let s = editorReducer(initialEditorState(), { type: 'photosAdded', photos: [{ id: 'a', name: 'a.jpg', size: 1, lastModified: 0 }] });
    s = editorReducer(s, { type: 'importSucceeded', id: 'a', info: { format: 'jpeg', ...NATIVE, orientation: 1, sha256: null } });
    return s;
  });
  onState(state, dispatch);
  const onChange = (next, { preview = false, coalesceKey = null } = {}) => dispatch(preview
    ? { type: 'previewSettings', patch: { geometry: next } }
    : { type: 'applySettings', patch: { geometry: next }, coalesceKey });
  return (
    <AdjustPanel
      adjustments={state.photos[0].history.present}
      disabled={false}
      dispatch={dispatch}
      lut={{ library: [], onImport: () => {}, status: {} }}
      presets={{ userPresets: [], onChange: () => {}, onPreview: () => {}, onDownload: () => {}, newId: () => 'x' }}
      geometry={{ native: NATIVE, mode: null, onMode: () => {}, onChange, onCommit: () => dispatch({ type: 'commitAdjustment' }), onStraightening: () => {} }}
    />
  );
}

let state;
let dispatch;
const geometry = () => state.photos[0].history.present.geometry;
const setup = () => render(<Harness onState={(s, d) => { state = s; dispatch = d; }} />);
const typeValue = (label, value) => {
  const field = screen.getByLabelText(`${label} value`);
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value } });
  fireEvent.keyDown(field, { key: 'Enter' });
};

describe('Crop & Transform panel', () => {
  test('quarter turns, 180° and flips are undoable steps', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Rotate 90° clockwise' }));
    expect(geometry().quarterTurns).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: '180°' }));
    expect(geometry().quarterTurns).toBe(3);
    fireEvent.click(screen.getByRole('button', { name: 'Flip horizontal' }));
    expect(geometry().flipH).toBe(true);
    expect(screen.getByRole('button', { name: 'Flip horizontal' })).toHaveAttribute('aria-pressed', 'true');
    act(() => dispatch({ type: 'undo' }));
    act(() => dispatch({ type: 'undo' }));
    expect(geometry()).toMatchObject({ quarterTurns: 1, flipH: false });
    act(() => dispatch({ type: 'undo' }));
    expect(geometry()).toEqual(neutralGeometry());
  });

  test('straightening crops to fill in the same undo step, and can keep the whole frame instead', () => {
    setup();
    typeValue('Straighten', '10');
    expect(geometry().angle).toBe(10);
    expect(geometryPlan(geometry(), NATIVE).covered).toBe(true);
    expect(geometry().crop).not.toBeNull();
    act(() => dispatch({ type: 'undo' }));
    expect(geometry()).toEqual(neutralGeometry());
    fireEvent.click(screen.getByRole('checkbox', { name: /Crop to fill/ }));
    typeValue('Straighten', '-6');
    expect(geometry()).toMatchObject({ angle: -6, crop: null, constrain: false });
    fireEvent.change(screen.getByRole('combobox', { name: 'Outside the photo' }), { target: { value: 'black' } });
    expect(geometry().background).toBe('black');
  });

  test('ratios crop without distorting; portrait swaps them', () => {
    setup();
    fireEvent.change(screen.getByRole('combobox', { name: 'Ratio' }), { target: { value: '1:1' } });
    let plan = geometryPlan(geometry(), NATIVE);
    expect(plan.crop.width).toBe(plan.crop.height);
    expect(geometry().stretch).toEqual({ x: 100, y: 100 });
    expect(screen.getByRole('button', { name: 'Landscape' })).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Ratio' }), { target: { value: '16:9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Landscape' }));
    expect(geometry().aspect).toBe('9:16');
    plan = geometryPlan(geometry(), NATIVE);
    expect(plan.crop.width / plan.crop.height).toBeCloseTo(9 / 16, 1);
    fireEvent.change(screen.getByLabelText('Custom W'), { target: { value: '1.91' } });
    fireEvent.change(screen.getByLabelText('H'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use ratio' }));
    expect(geometry().aspect).toBe('1.91:1');
  });

  test('resize keeps proportions by default, never upscales, and is separate from stretch', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '300' } });
    expect(geometryPlan(geometry(), NATIVE).native).toEqual({ width: 300, height: 200 });
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '9000' } });
    expect(geometry().resize).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Keep proportions' }));
    fireEvent.change(screen.getByLabelText('Height'), { target: { value: '100' } });
    expect(geometryPlan(geometry(), NATIVE).native).toEqual({ width: 600, height: 100 });
    expect(screen.getByText(/Unlocked: width and height scale separately/)).toBeInTheDocument();
    typeValue('Stretch horizontally', '150');
    expect(geometry().stretch).toEqual({ x: 150, y: 100 });
    expect(geometry().resize).toMatchObject({ locked: false });
    typeValue('Horizontal perspective', '250');
    expect(geometry().perspective.horizontal).toBe(100);
  });

  test('Reset geometry returns to neutral; the section shows when it is edited', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Rotate 90° counterclockwise' }));
    expect(screen.getByRole('button', { name: 'Crop & Transform (edited)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset geometry' }));
    expect(geometry()).toEqual(neutralGeometry());
  });

  test('presets never carry or change geometry', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Rotate 90° clockwise' }));
    const before = geometry();
    act(() => dispatch({ type: 'applyPreset', preset: BUILT_IN_PRESETS[0] }));
    expect(geometry()).toEqual(before);
    const preset = createPreset('Mine', state.photos[0].history.present, ['tone', 'hsl']);
    expect(JSON.stringify(preset)).not.toMatch(/geometry|quarterTurns/);
  });
});

describe('saved edits', () => {
  test('geometry is saved compactly and restored; older documents open with neutral geometry', () => {
    const adjustments = { geometry: normalizeGeometry({ angle: 3.5, crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 }, quad: [[0.1, 0], [0.9, 0], [1, 1], [0, 1]] }) };
    const photo = { name: 'a.jpg', size: 1, lastModified: 0, sha256: null, format: 'jpeg', ...NATIVE, adjustments };
    const text = serializeEditDocument(createEditDocument([photo], {}, new Date(0)));
    const saved = JSON.parse(text).photos[0].adjustments.geometry;
    expect(saved).toEqual({ angle: 3.5, crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 }, quad: [[0.1, 0], [0.9, 0], [1, 1], [0, 1]] });
    expect(parseEditDocument(text).photos[0].adjustments.geometry).toEqual(adjustments.geometry);
    const v5 = JSON.stringify({ type: DOCUMENT_TYPE, version: 5, photos: [{ source: { name: 'a.jpg', size: 1 }, adjustments: { exposure: 1 } }] });
    expect(parseEditDocument(v5).photos[0].adjustments.geometry).toEqual(neutralGeometry());
    const hostile = JSON.stringify({ type: DOCUMENT_TYPE, version: 6, photos: [{ source: { name: 'a.jpg', size: 1 }, adjustments: { geometry: { angle: 1e9, crop: { x: 2, y: -1, width: -3, height: 0 }, resize: { width: 1e12, height: 1 }, quad: 'x' } } }] });
    const parsed = parseEditDocument(hostile).photos[0].adjustments.geometry;
    expect(parsed.angle).toBe(45);
    expect(parsed.quad).toBeNull();
    expect(parsed.resize.width).toBe(16384);
    expect(geometryPlan(parsed, NATIVE).native.width).toBeGreaterThan(0);
  });
});

describe('crop overlay', () => {
  const box = { x: 0, y: 0, width: 600, height: 400 };
  const content = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const props = (overrides = {}) => ({
    mode: 'crop', geometry: normalizeGeometry({ crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } }), content, ratio: null,
    output: { width: 300, height: 200 }, box, guide: false,
    onPreview: vi.fn(), onCommit: vi.fn(), onSet: vi.fn(), onApply: vi.fn(), onCancel: vi.fn(), ...overrides,
  });

  test('keyboard: arrows resize from the focused edge or move the box; Enter applies, Escape cancels', () => {
    const p = props();
    render(<CropOverlay {...p} />);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Crop right edge' }), { key: 'ArrowLeft' });
    expect(p.onSet.mock.calls[0][0].crop.width).toBeCloseTo(0.495);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Crop area' }), { key: 'ArrowDown', shiftKey: true });
    expect(p.onSet.mock.calls[1][0].crop).toMatchObject({ y: 0.3, height: 0.5 });
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Crop area' }), { key: 'Enter' });
    expect(p.onApply).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Crop top-left corner' }), { key: 'Escape' });
    expect(p.onCancel).toHaveBeenCalledTimes(1);
    expect(screen.getByText('300 × 200')).toBeInTheDocument();
  });

  test('pointer and touch drags preview, and record one step on release', () => {
    const p = props({ ratio: 1 });
    render(<CropOverlay {...p} />);
    const corner = screen.getByRole('slider', { name: 'Crop bottom-right corner' });
    fireEvent.pointerDown(corner, { pointerId: 3, pointerType: 'touch', button: 0, clientX: 450, clientY: 300 });
    fireEvent.pointerMove(corner, { pointerId: 3, pointerType: 'touch', clientX: 510, clientY: 300 });
    const rect = p.onPreview.mock.calls.at(-1)[0].crop;
    expect(rect.width).toBeCloseTo(0.6);
    expect(rect.height).toBeCloseTo(0.6);
    expect(rect.x).toBeCloseTo(0.25);
    fireEvent.pointerUp(corner, { pointerId: 3, pointerType: 'touch' });
    expect(p.onCommit).toHaveBeenCalledTimes(1);
  });

  test('corners mode moves one perspective point and refuses a folded quad', () => {
    const p = props({ mode: 'corners', geometry: normalizeGeometry({}) });
    render(<CropOverlay {...p} />);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Top-left perspective point' }), { key: 'ArrowRight', shiftKey: true });
    expect(p.onSet.mock.calls[0][0].quad[0]).toEqual([0.05, 0]);
    const point = screen.getByRole('slider', { name: 'Top-right perspective point' });
    fireEvent.pointerDown(point, { pointerId: 1, button: 0, clientX: 600, clientY: 0 });
    fireEvent.pointerMove(point, { pointerId: 1, clientX: 0, clientY: 390 });
    expect(p.onPreview).not.toHaveBeenCalled();
  });
});

test('the Export panel states the size after geometry', () => {
  const output = exportGeometry({ quarterTurns: 1, crop: { x: 0, y: 0, width: 0.5, height: 1 } }, NATIVE, { mode: 'original' }).output;
  render(<ExportPanel settings={DEFAULT_EXPORT_SETTINGS} photo={{ status: 'ready', name: 'a.jpg', ...NATIVE }} output={output} dispatch={() => {}} onExport={() => {}} onCancel={() => {}} unsupportedFormats={[]} busy={false} />);
  expect(screen.getByText('200 × 600')).toBeInTheDocument();
});
