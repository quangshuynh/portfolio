// Layers panel: groups, clipping and layer masks (Interval 24), with fixtures independent of real
// photos. Keyboard and pointer (touch) paths are both exercised.
import React, { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import LayersPanel from './LayersPanel';
import MaskPanel from './MaskPanel';
import { createAdjustmentLayer, createImageLayer, normalizeLayers } from '../model/layers.mjs';
import { createMask, createSelection } from '../model/masks.mjs';

const source = { sha256: 'c'.repeat(64), name: 'sky.png', size: 5, format: 'png', width: 300, height: 200 };
const canvas = { width: 600, height: 400 };
const stack = () => normalizeLayers([
  createImageLayer('img', source, canvas),
  { id: 'txt', type: 'text', text: 'Title' },
  createAdjustmentLayer('adj', { exposure: 1 }),
]);
const sources = (patch = {}) => ({ missing: () => null, thumbnail: () => null, maskThumbnail: () => ({ width: 4, height: 2, data: new Uint8ClampedArray(8).fill(255) }), workspace: [], onAddPhoto: vi.fn(), onImport: vi.fn(), onReconnect: vi.fn(), busy: false, message: null, ...patch });

function Harness({ initial = stack(), onAdd = () => {}, onEditMask = () => {}, sourceProps = {} }) {
  const [layers, setLayers] = useState(initial);
  const [active, setActive] = useState(null);
  return (
    <LayersPanel
      layers={layers}
      activeId={active}
      disabled={false}
      canvas={canvas}
      sources={sources(sourceProps)}
      onSelect={setActive}
      onApply={(next) => setLayers(normalizeLayers(next))}
      onPreview={setLayers}
      onCommit={() => {}}
      onAddText={() => {}}
      onAddAdjustment={onAdd}
      onEditSettings={() => {}}
      onEditMask={onEditMask}
      tool={false}
      onTool={() => {}}
      freeResize={false}
      onFreeResize={() => {}}
    />
  );
}
const rows = () => [...document.querySelectorAll('[data-layer-row]')].map((li) => `${li.querySelector('.pe-layer__label').textContent}${li.style.getPropertyValue('--pe-depth') ? `@${li.style.getPropertyValue('--pe-depth')}` : ''}${li.dataset.clip ? '*' : ''}`);
// A layer row's name button (its accessible name starts "label, Type layer").
const name = (label) => screen.getByRole('button', { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, `) });

describe('Layers panel: groups and clipping', () => {
  test('Group puts the selected layer in a new group; the tree shows it indented and it collapses', () => {
    render(<Harness />);
    fireEvent.click(name('Title'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Group' })[1]);
    expect(rows()).toEqual(['Adjustment', 'Group', 'Title@1', 'sky.png']);
    const toggle = screen.getByRole('button', { name: 'Collapse Group' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(rows()).toEqual(['Adjustment', 'Group', 'sky.png']);
    expect(screen.getByRole('button', { name: /^Group, Group layer, 1 inside, collapsed/ })).toBeInTheDocument();
    // ← and → on a group row collapse and expand it.
    fireEvent.keyDown(name('Group'), { key: 'ArrowRight' });
    expect(rows()).toContain('Title@1');
    // A group's mode menu offers Pass through, which explains itself.
    fireEvent.click(name('Group'));
    const mode = screen.getByRole('combobox', { name: 'Blend mode' });
    expect(mode).toHaveValue('pass-through');
    expect(screen.getByText(/as if not grouped/)).toBeInTheDocument();
    fireEvent.change(mode, { target: { value: 'multiply' } });
    expect(screen.getByText(/combined first/)).toBeInTheDocument();
  });

  test('keyboard: Ctrl/Cmd+G groups, Ctrl/Cmd+Alt+G clips, Ctrl/Cmd+Shift+G ungroups, Alt+arrows move whole units', () => {
    render(<Harness />);
    fireEvent.keyDown(name('Title'), { key: 'g', ctrlKey: true, altKey: true });
    expect(rows()).toEqual(['Adjustment', 'Title*', 'sky.png']);
    expect(name('Title').getAttribute('aria-label')).toMatch(/clipped to sky\.png/);
    // Moving the base takes its clipped layer along.
    fireEvent.keyDown(name('sky.png'), { key: 'ArrowUp', altKey: true });
    expect(rows()).toEqual(['Title*', 'sky.png', 'Adjustment']);
    fireEvent.keyDown(name('Adjustment'), { key: 'g', metaKey: true });
    expect(rows()).toEqual(['Title*', 'sky.png', 'Group', 'Adjustment@1']);
    fireEvent.keyDown(name('Group'), { key: 'g', ctrlKey: true, shiftKey: true });
    expect(rows()).toEqual(['Title*', 'sky.png', 'Adjustment']);
  });

  test('the clip checkbox is offered only where valid; an adjustment layer below makes no base', () => {
    render(<Harness />);
    fireEvent.click(name('Adjustment'));
    const clip = screen.getByRole('checkbox', { name: /Clip to layer below/ });
    expect(clip).toBeEnabled();
    fireEvent.click(clip);
    expect(rows()[0]).toBe('Adjustment*');
    expect(screen.getByRole('checkbox', { name: /Clip to layer below \(Title\)/ })).toBeChecked();
    fireEvent.click(name('sky.png'));
    expect(screen.getByRole('checkbox', { name: /Clip to layer below/ })).toBeDisabled();
  });

  test('In group moves a layer in and out; Delete on a group asks first and removes its contents', () => {
    render(<Harness initial={normalizeLayers([...stack(), { id: 'g', type: 'group', name: 'Shapes' }])} />);
    fireEvent.click(name('sky.png'));
    fireEvent.change(screen.getByRole('combobox', { name: 'In group' }), { target: { value: 'g' } });
    expect(rows()).toEqual(['Shapes', 'sky.png@1', 'Adjustment', 'Title']);
    fireEvent.change(screen.getByRole('combobox', { name: 'In group' }), { target: { value: '' } });
    expect(rows()).toEqual(['sky.png', 'Shapes', 'Adjustment', 'Title']);
    fireEvent.change(screen.getByRole('combobox', { name: 'In group' }), { target: { value: 'g' } });
    fireEvent.click(name('Shapes'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete…' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Confirm delete' })).getByRole('button', { name: 'Delete group and contents' }));
    expect(rows()).toEqual(['Adjustment', 'Title']);
  });

  test('touch drag drops a unit above or below the row under the finger, into that row\'s group', () => {
    render(<Harness initial={normalizeLayers([createImageLayer('img', source, canvas), { id: 'txt', type: 'text', text: 'Title', parent: 'g' }, { id: 'g', type: 'group' }, createAdjustmentLayer('adj', { exposure: 1 })])} />);
    const items = [...document.querySelectorAll('[data-layer-row]')];
    items.forEach((row, i) => { row.getBoundingClientRect = () => ({ top: i * 40, bottom: i * 40 + 40, left: 0, right: 200, height: 40, width: 200 }); });
    expect(rows()).toEqual(['Adjustment', 'Group', 'Title@1', 'sky.png']);
    const grip = items[0].querySelector('.pe-layer__grip');
    fireEvent.pointerDown(grip, { button: 0, pointerId: 3, clientY: 20, pointerType: 'touch' });
    // Lower half of the Title row: below Title, inside the group.
    fireEvent.pointerMove(grip, { pointerId: 3, clientY: 110 });
    expect(items[2]).toHaveAttribute('data-drop', 'below');
    fireEvent.pointerUp(grip, { pointerId: 3, clientY: 110 });
    expect(rows()).toEqual(['Group', 'Title@1', 'Adjustment@1', 'sky.png']);
    // A cancelled pointer changes nothing.
    const again = document.querySelectorAll('[data-layer-row]')[3].querySelector('.pe-layer__grip');
    fireEvent.pointerDown(again, { button: 0, pointerId: 4, clientY: 140 });
    fireEvent.pointerCancel(again, { pointerId: 4, clientY: 10 });
    expect(rows()).toEqual(['Group', 'Title@1', 'Adjustment@1', 'sky.png']);
  });

  test('a layer mask shows a thumbnail button that opens it; clipped adjustments and selections start from the panel', () => {
    const onEditMask = vi.fn();
    const onAdd = vi.fn();
    const masked = normalizeLayers([createImageLayer('img', source, canvas), { ...createAdjustmentLayer('adj', { exposure: 1 }), mask: createMask('canvas') }]);
    const selections = [{ id: 'local:l:s', label: 'Sky · Sky', name: 'Sky', mask: createMask('canvas', 'none') }];
    render(<Harness initial={masked} onEditMask={onEditMask} onAdd={onAdd} sourceProps={{ selections }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit the mask of Adjustment' }));
    expect(onEditMask).toHaveBeenCalledWith(expect.objectContaining({ id: 'adj' }));
    fireEvent.click(name('sky.png'));
    fireEvent.click(screen.getByRole('button', { name: 'Add clipped adjustment' }));
    expect(onAdd).toHaveBeenLastCalledWith({ clip: true });
    fireEvent.change(screen.getByRole('combobox', { name: /saved selection/ }), { target: { value: 'local:l:s' } });
    expect(onAdd).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Sky', clip: false }));
  });
});

describe('Masks panel: selections in a layer mask', () => {
  const result = { kind: 'sky', version: 't/1', width: 4, height: 2, data: 'AAA=', confidence: 0.9 };
  const panel = (layer, onApplyMask, savedSelections) => render(
    <MaskPanel
      disabled={false}
      locals={[]}
      layer={layer}
      target={{ kind: 'layer', layer }}
      space={canvas}
      selectedId={null}
      onSelect={() => {}}
      onSelectLocal={() => {}}
      onSelectLayerMask={() => {}}
      tool={null}
      onTool={() => {}}
      brush={{ radius: 0.05, hardness: 0.5, opacity: 1, mode: 'add' }}
      onBrush={() => {}}
      overlay={{ show: false, view: 'overlay', color: '#ff3b30' }}
      onOverlay={() => {}}
      onApplyLocals={() => {}}
      onApplyMask={onApplyMask}
      onPreviewMask={() => {}}
      onCommit={() => {}}
      newId={(prefix) => `${prefix}-new`}
      onEditSettings={() => {}}
      savedSelections={savedSelections}
    />,
  );

  test('a saved selection is copied into an adjustment layer\'s mask without running a model', () => {
    const onApplyMask = vi.fn();
    const saved = [{ id: 'local:l:s', label: 'Sky · Sky', mask: { ...createMask('canvas', 'none'), components: [createSelection('s', result)] } }];
    panel(normalizeLayers([{ ...createAdjustmentLayer('adj', { exposure: 1 }), mask: createMask('canvas') }])[0], onApplyMask, saved);
    fireEvent.change(screen.getByRole('combobox', { name: 'Copy a saved selection into this mask' }), { target: { value: 'local:l:s' } });
    const mask = onApplyMask.mock.calls[0][0];
    expect(mask.components.at(-1)).toMatchObject({ id: 'selection-new', type: 'selection', kind: 'sky', data: 'AAA=' });
  });

  test('an image layer\'s mask explains why it cannot hold a selection', () => {
    panel(normalizeLayers([{ ...createImageLayer('img', source, canvas), mask: createMask('layer') }])[0], vi.fn(), []);
    expect(screen.getByText(/image layer's mask cannot hold them/)).toBeInTheDocument();
  });
});
