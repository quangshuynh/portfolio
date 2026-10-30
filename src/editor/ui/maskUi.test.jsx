import React, { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import MaskPanel, { DEFAULT_BRUSH, DEFAULT_OVERLAY } from './MaskPanel';
import MaskTool from './MaskTool';
import { createAdjustmentLayer } from '../model/layers.mjs';
import { createLinear, createMask, createRadial, normalizeMask } from '../model/masks.mjs';
import { canvasMaskMap } from '../pipeline/mask.mjs';

let ids = 0;
const newId = (prefix) => `${prefix}-${(ids += 1)}`;

function PanelHarness({ layer = null, spy = () => {} }) {
  const [locals, setLocals] = useState([]);
  const [layerState, setLayer] = useState(layer);
  const [activeLocal, setActiveLocal] = useState(null);
  const [layerMask, setLayerMask] = useState(false);
  const [selected, setSelected] = useState(null);
  const [tool, setTool] = useState(null);
  const [brush, setBrush] = useState(DEFAULT_BRUSH);
  const local = locals.find(({ id }) => id === activeLocal) ?? null;
  const target = local ? { kind: 'local', local } : layerMask && layerState?.mask ? { kind: 'layer', layer: layerState } : null;
  const applyMask = (mask) => {
    spy(mask);
    if (target?.kind === 'local') setLocals(locals.map((l) => (l.id === local.id ? { ...l, mask } : l)));
    else setLayer(mask ? { ...layerState, mask } : (({ mask: _, ...rest }) => rest)(layerState));
  };
  return (
    <>
      <MaskPanel
        disabled={false}
        locals={locals}
        layer={local ? null : layerState}
        target={target}
        space={{ width: 600, height: 400 }}
        selectedId={selected}
        onSelect={setSelected}
        onSelectLocal={(id, component = null) => { setActiveLocal(id); setSelected(component); }}
        onSelectLayerMask={setLayerMask}
        tool={tool}
        onTool={setTool}
        brush={brush}
        onBrush={setBrush}
        overlay={DEFAULT_OVERLAY}
        onOverlay={() => {}}
        onApplyLocals={(next) => { spy(next); setLocals(next); }}
        onApplyMask={applyMask}
        onPreviewMask={() => {}}
        onCommit={() => {}}
        newId={newId}
        onEditSettings={() => {}}
      />
      <output data-testid="state">{JSON.stringify({ locals, tool, brush, layerMask: layerState?.mask ?? null })}</output>
    </>
  );
}
const state = () => JSON.parse(screen.getByTestId('state').textContent);

describe('Masks panel', () => {
  const newLocal = (type) => {
    fireEvent.click(within(screen.getByRole('group', { name: 'New local adjustment' })).getByRole('button', { name: type }));
    if (type !== 'Brush') fireEvent.click(screen.getByRole('button', { name: `+ ${type}` }));
  };

  test('a new local adjustment starts empty with the matching tool on; + Linear adds a gradient without a pointer', () => {
    render(<PanelHarness />);
    fireEvent.click(within(screen.getByRole('group', { name: 'New local adjustment' })).getByRole('button', { name: 'Linear' }));
    expect(state().locals[0].mask).toMatchObject({ space: 'image', base: 'none', components: [] });
    expect(state().tool).toBe('linear');
    expect(screen.getByText('Drag on the photo to place the linear gradient.')).toHaveAttribute('role', 'status');
    fireEvent.click(screen.getByRole('button', { name: '+ Linear' }));
    expect(state().locals[0].mask.components[0].type).toBe('linear');
    expect(screen.getByRole('button', { name: /^Linear gradient 1/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('spinbutton', { name: 'Angle (degrees)' })).toBeInTheDocument();
  });

  test('components: add, subtract, invert, duplicate, delete; mask invert; amount', () => {
    render(<PanelHarness />);
    newLocal('Radial');
    fireEvent.click(screen.getByRole('button', { name: '+ Brush' }));
    expect(state().locals[0].mask.components.map(({ type }) => type)).toEqual(['radial', 'brush']);
    fireEvent.click(screen.getByRole('button', { name: /^Radial gradient 1/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Combine' }), { target: { value: 'subtract' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Outside' }));
    expect(state().locals[0].mask.components[0]).toMatchObject({ op: 'subtract', invert: true });
    fireEvent.click(within(screen.getByRole('group', { name: /Radial gradient 1/ })).getByRole('button', { name: 'Duplicate' }));
    expect(state().locals[0].mask.components).toHaveLength(3);
    fireEvent.click(within(screen.getByRole('group', { name: /Radial gradient 2/ })).getByRole('button', { name: 'Delete' }));
    expect(state().locals[0].mask.components).toHaveLength(2);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Invert mask' }));
    expect(state().locals[0].mask.invert).toBe(true);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Amount value (%)' }), { target: { value: '40' } });
    expect(state().locals[0].amount).toBe(0.4);
  });

  test('gradient fields are numeric alternatives to dragging', () => {
    render(<PanelHarness />);
    newLocal('Radial');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Width (radius, % of short edge)' }), { target: { value: '45' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Angle (degrees)' }), { target: { value: '30' } });
    expect(state().locals[0].mask.components[0]).toMatchObject({ rx: 0.45, rotation: 30 });
  });

  test('a selected layer can get a mask (full by default), edit it and remove it', () => {
    render(<PanelHarness layer={createAdjustmentLayer('A', { exposure: 1 })} />);
    fireEvent.click(screen.getByRole('button', { name: /Add mask to/ }));
    expect(state().layerMask).toMatchObject({ space: 'canvas', base: 'all', components: [] });
    expect(screen.getByRole('button', { name: 'Editing layer mask' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mask on' }));
    expect(state().layerMask.enabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Remove layer mask' }));
    expect(state().layerMask).toBeNull();
  });

  test('brush controls: paint/erase, size, hardness', () => {
    render(<PanelHarness />);
    fireEvent.click(within(screen.getByRole('group', { name: 'New local adjustment' })).getByRole('button', { name: 'Brush' }));
    fireEvent.click(screen.getByRole('button', { name: 'Erase' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Hardness value (%)' }), { target: { value: '90' } });
    expect(state().brush).toMatchObject({ mode: 'erase', hardness: 0.9 });
  });
});

describe('mask tool on the photo', () => {
  const box = { x: 0, y: 0, width: 600, height: 400 };
  const output = { width: 1200, height: 800 };
  const map = canvasMaskMap(output);
  const renderTool = (props) => {
    const handlers = { onSelect: vi.fn(), onPreview: vi.fn(), onCommit: vi.fn(), onRemove: vi.fn() };
    const tree = (more) => (
      <div className="pe-stage-area">
        <MaskTool mask={createMask('image')} map={map} box={box} output={output} tool={null} brush={DEFAULT_BRUSH} selectedId={null} newId={newId} {...handlers} {...props} {...more} />
      </div>
    );
    const view = render(tree());
    return { ...handlers, view, rerender: (more) => view.rerender(tree(more)), layer: view.container.querySelector('.pe-masktool') };
  };
  const pointer = (element, type, x, y, extra = {}) => fireEvent[type](element, { pointerId: 1, button: 0, clientX: x, clientY: y, pointerType: 'mouse', ...extra });

  test('painting records one stroke in mask space (not screen pixels) and commits once', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callback(); return 1; });
    const { layer, onCommit, onSelect } = renderTool({ tool: 'brush' });
    pointer(layer, 'pointerDown', 60, 200);
    pointer(layer, 'pointerMove', 300, 200);
    pointer(layer, 'pointerMove', 540, 210);
    pointer(layer, 'pointerUp', 540, 210);
    expect(onCommit).toHaveBeenCalledTimes(1);
    const mask = onCommit.mock.calls[0][0];
    expect(mask.components[0].type).toBe('brush');
    expect(onSelect).toHaveBeenCalledWith(mask.components[0].id);
    const [stroke] = mask.components[0].strokes;
    expect(stroke.points[0]).toEqual([0.1, 0.5, 1]);
    expect(stroke.points.at(-1)[0]).toBeCloseTo(0.9, 5);
    expect(stroke.mode).toBe('add');
    window.requestAnimationFrame.mockRestore();
  });

  test('Alt erases; a second touch cancels the stroke', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callback(); return 1; });
    const { layer, onCommit, onPreview } = renderTool({ tool: 'brush' });
    pointer(layer, 'pointerDown', 60, 200, { altKey: true });
    pointer(layer, 'pointerUp', 60, 200);
    expect(onCommit.mock.calls[0][0].components[0].strokes[0].mode).toBe('erase');
    pointer(layer, 'pointerDown', 60, 200, { pointerType: 'touch' });
    pointer(layer, 'pointerDown', 200, 200, { pointerId: 2, pointerType: 'touch' });
    expect(onPreview).toHaveBeenLastCalledWith(createMask('image'));
    pointer(layer, 'pointerUp', 60, 200);
    expect(onCommit).toHaveBeenCalledTimes(1);
    window.requestAnimationFrame.mockRestore();
  });

  test('a second touch a frame later restores the mask from before the stroke, not its preview', () => {
    const before = createMask('image');
    const { layer, onCommit, onPreview, rerender } = renderTool({ tool: 'brush', mask: before });
    pointer(layer, 'pointerDown', 60, 200, { pointerType: 'touch' });
    // The first point is previewed at once; the editor passes that preview back as the mask.
    const previewed = onPreview.mock.calls.at(-1)[0];
    expect(previewed.components[0].strokes).toHaveLength(1);
    rerender({ mask: previewed });
    pointer(layer, 'pointerDown', 200, 200, { pointerId: 2, pointerType: 'touch' });
    expect(onPreview).toHaveBeenLastCalledWith(before);
    pointer(layer, 'pointerUp', 200, 200, { pointerId: 2, pointerType: 'touch' });
    pointer(layer, 'pointerUp', 60, 200, { pointerType: 'touch' });
    expect(onCommit).not.toHaveBeenCalled();
  });

  test('dragging out a linear gradient sets its start and end; a click alone adds nothing', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callback(); return 1; });
    const { layer, onCommit } = renderTool({ tool: 'linear' });
    pointer(layer, 'pointerDown', 300, 40);
    pointer(layer, 'pointerUp', 300, 200);
    expect(onCommit.mock.calls[0][0].components[0]).toMatchObject({ type: 'linear', x0: 0.5, y0: 0.1, x1: 0.5, y1: 0.5 });
    pointer(layer, 'pointerDown', 100, 100);
    pointer(layer, 'pointerUp', 101, 100);
    expect(onCommit).toHaveBeenCalledTimes(1);
    window.requestAnimationFrame.mockRestore();
  });

  test('gradient handles are focusable: arrows move, Delete removes', () => {
    const mask = normalizeMask({ components: [createRadial('r', { x: 0.5, y: 0.5 }), createLinear('g')] }, 'image');
    const { onCommit, onRemove } = renderTool({ mask, selectedId: 'r' });
    const handle = screen.getByRole('button', { name: /Radial gradient 1/ });
    expect(handle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
    expect(onCommit.mock.calls[0][0].components[0].x).toBeCloseTo(0.52);
    fireEvent.keyDown(screen.getByRole('button', { name: /Linear gradient 2/ }), { key: 'Delete' });
    expect(onRemove).toHaveBeenCalledWith('g');
  });

  test('dragging a radius handle resizes the ellipse in mask units', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callback(); return 1; });
    const mask = normalizeMask({ components: [createRadial('r', { x: 0.5, y: 0.5, rx: 0.2, ry: 0.2 })] }, 'image');
    const { view, onCommit } = renderTool({ mask, selectedId: 'r' });
    const rx = view.container.querySelector('[data-handle="rx"]');
    act(() => {
      pointer(rx, 'pointerDown', 380, 200);
      pointer(rx, 'pointerMove', 420, 200);
      pointer(rx, 'pointerUp', 420, 200);
    });
    // 120 stage px from the centre = 240 canvas px = 0.3 of the 800 px short edge.
    expect(onCommit.mock.calls[0][0].components[0].rx).toBeCloseTo(0.3, 5);
    window.requestAnimationFrame.mockRestore();
  });
});
