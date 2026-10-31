import React, { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import LayersPanel from './LayersPanel';
import { createAdjustmentLayer, createImageLayer, normalizeLayers } from '../model/layers.mjs';

const source = { sha256: 'c'.repeat(64), name: 'sky.png', size: 5, format: 'png', width: 300, height: 200 };
const canvas = { width: 600, height: 400 };
const stack = () => normalizeLayers([
  createImageLayer('img', source, canvas),
  { id: 'txt', type: 'text', text: 'Title' },
  createAdjustmentLayer('adj', { exposure: 1 }),
]);
const sources = (patch = {}) => ({ missing: () => null, thumbnail: () => null, workspace: [], onAddPhoto: vi.fn(), onImport: vi.fn(), onReconnect: vi.fn(), busy: false, message: null, ...patch });

function Harness({ initial = stack(), onApplySpy = () => {}, sourceProps = {} }) {
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
      onApply={(next) => { onApplySpy(next); setLayers(next); }}
      onPreview={setLayers}
      onCommit={() => {}}
      onAddText={() => {}}
      onAddAdjustment={() => {}}
      onEditSettings={() => {}}
      tool={false}
      onTool={() => {}}
      freeResize={false}
      onFreeResize={() => {}}
    />
  );
}
const rows = () => screen.getAllByRole('listitem').map((li) => li.querySelector('.pe-layer__label').textContent);

describe('Layers panel', () => {
  test('a RAW image layer has a profile menu: new layers Camera Natural, saved ones Legacy until changed', () => {
    const raw = { ...source, name: 'DSC0002.ARW', format: 'arw' };
    const spy = vi.fn();
    const saved = normalizeLayers([{ ...createImageLayer('old', raw, canvas), rawProfile: undefined }])[0];
    render(<Harness initial={normalizeLayers([createImageLayer('img', raw, canvas), { ...saved, id: 'old' }])} onApplySpy={spy} />);
    fireEvent.click(screen.getAllByRole('button', { name: /^DSC0002\.ARW/ })[1]);
    const select = screen.getByRole('combobox', { name: 'RAW profile' });
    expect(select).toHaveValue('camera-natural');
    fireEvent.change(select, { target: { value: 'linear' } });
    expect(spy.mock.calls.at(-1)[0].find(({ id }) => id === 'img').rawProfile).toEqual({ profile: 'linear', profileVersion: 1 });
    fireEvent.click(screen.getAllByRole('button', { name: /^DSC0002\.ARW/ })[0]);
    const legacy = screen.getByRole('combobox', { name: 'RAW profile' });
    expect(legacy).toHaveValue('legacy');
    expect(within(legacy).getAllByRole('option')).toHaveLength(3);
  });

  test('JPEG, PNG and WebP layers have no RAW profile menu', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /^sky\.png/ }));
    expect(screen.queryByRole('combobox', { name: 'RAW profile' })).toBeNull();
  });

  test('lists the stack top first above the Background; image, text and adjustment rows differ', () => {
    render(<Harness />);
    expect(rows()).toEqual(['Adjustment', 'Title', 'sky.png', 'Background']);
    expect(document.querySelectorAll('.pe-layer[data-type]')).toHaveLength(3);
    expect(screen.getByRole('button', { name: /^sky\.png, Image layer/ })).toBeInTheDocument();
  });

  test('select, then reorder with Move up/down and Alt+arrow; hide and lock are toggle buttons', () => {
    const spy = vi.fn();
    render(<Harness onApplySpy={spy} />);
    const image = screen.getByRole('button', { name: /^sky\.png/ });
    fireEvent.click(image);
    expect(image).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Move up' }));
    expect(rows()).toEqual(['Adjustment', 'sky.png', 'Title', 'Background']);
    fireEvent.keyDown(screen.getByRole('button', { name: /^sky\.png/ }), { key: 'ArrowDown', altKey: true });
    expect(rows()).toEqual(['Adjustment', 'Title', 'sky.png', 'Background']);
    const hide = screen.getByRole('button', { name: 'Hide sky.png' });
    fireEvent.click(hide);
    expect(screen.getByRole('button', { name: 'Show sky.png' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Lock sky.png' }));
    expect(spy.mock.calls.at(-1)[0][0]).toMatchObject({ id: 'img', visible: false, locked: true });
    // Locked: opacity, blend and delete are disabled.
    expect(screen.getByRole('combobox', { name: 'Blend mode' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete…' })).toBeDisabled();
  });

  test('opacity, blend mode and transform fields change only the selected layer', () => {
    const spy = vi.fn();
    render(<Harness onApplySpy={spy} />);
    fireEvent.click(screen.getByRole('button', { name: /^sky\.png/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Blend mode' }), { target: { value: 'soft-light' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Opacity value (%)' }), { target: { value: '35' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Angle (degrees)' }), { target: { value: '-12' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'W (px)' }), { target: { value: '180' } });
    const image = spy.mock.calls.at(-1)[0].find(({ id }) => id === 'img');
    expect(image).toMatchObject({ blend: 'soft-light', opacity: 0.35, rotation: -12 });
    // Proportional: 180 px wide keeps 3:2.
    expect(image.width * 400).toBeCloseTo(180, 4);
    expect(image.height * 400).toBeCloseTo(120, 4);
    fireEvent.click(screen.getByRole('button', { name: 'Flip horizontal' }));
    expect(spy.mock.calls.at(-1)[0][0].flipH).toBe(true);
  });

  test('delete asks first and never touches the source; duplicate selects the copy', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /^sky\.png/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(rows()).toEqual(['Adjustment', 'Title', 'sky.png', 'sky.png', 'Background']);
    fireEvent.click(screen.getByRole('button', { name: 'Delete…' }));
    const confirm = screen.getByRole('group', { name: 'Confirm delete' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Keep' }));
    expect(rows()).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Delete…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete layer' }));
    expect(rows()).toEqual(['Adjustment', 'Title', 'sky.png', 'Background']);
  });

  test('pointer drag on the grip reorders (mouse and touch alike)', () => {
    render(<Harness />);
    const items = document.querySelectorAll('[data-layer-row]');
    items.forEach((row, i) => { row.getBoundingClientRect = () => ({ top: i * 40, bottom: i * 40 + 40, left: 0, right: 200, height: 40, width: 200 }); });
    const grip = items[2].querySelector('.pe-layer__grip');
    fireEvent.pointerDown(grip, { button: 0, pointerId: 1, clientY: 100, pointerType: 'touch' });
    fireEvent.pointerMove(grip, { pointerId: 1, clientY: 10 });
    expect(items[0]).toHaveAttribute('data-drop', 'above');
    fireEvent.pointerUp(grip, { pointerId: 1, clientY: 10 });
    expect(rows()).toEqual(['sky.png', 'Adjustment', 'Title', 'Background']);
  });

  test('a missing source says so and offers to reconnect the file', () => {
    const onReconnect = vi.fn();
    render(<Harness sourceProps={{ missing: (layer) => (layer.type === 'image' ? 'Its file sky.png is not loaded.' : null), onReconnect }} />);
    expect(screen.getByRole('button', { name: /sky\.png, Image layer, source missing/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^sky\.png/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('not loaded');
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect file…' }));
    expect(onReconnect).toHaveBeenCalledWith(expect.objectContaining({ id: 'img' }));
  });

  test('rename with a double click; the panel collapses', () => {
    render(<Harness />);
    fireEvent.doubleClick(screen.getByRole('button', { name: /^Title/ }));
    const field = screen.getByRole('textbox', { name: 'Name of Title' });
    fireEvent.change(field, { target: { value: 'Headline\u0007' } });
    fireEvent.blur(field);
    expect(rows()[1]).toBe('Headline');
    const toggle = screen.getByRole('button', { name: /Layers/ });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});
