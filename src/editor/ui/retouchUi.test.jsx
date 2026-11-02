import React from 'react';
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import RetouchTool from './RetouchTool';
import { canvasMaskMap } from '../pipeline/mask.mjs';

let ids = 0;
const newId = (prefix) => `${prefix}-${(ids += 1)}`;
const BRUSH = { radius: 0.02, hardness: 0.5, opacity: 1, spacing: 0.25 };

describe('retouch tool on the photo, by touch', () => {
  const box = { x: 0, y: 0, width: 600, height: 400 };
  const output = { width: 1200, height: 800 };
  const map = canvasMaskMap(output);
  const renderTool = (props) => {
    const handlers = { onPreview: vi.fn(), onCommit: vi.fn(), onSelect: vi.fn(), onUpdate: vi.fn(), onSource: vi.fn(), onError: vi.fn(), findSource: vi.fn(() => ({ x: 0.05, y: 0 })) };
    const tree = (more) => (
      <div className="pe-stage-area">
        <RetouchTool map={map} box={box} output={output} tool="heal" brush={BRUSH} operations={[]} selectedId={null} clone={{ source: null, aligned: true, offset: null }} picking={false} newId={newId} {...handlers} {...props} {...more} />
      </div>
    );
    const view = render(tree());
    return { ...handlers, rerender: (more) => view.rerender(tree(more)), layer: view.container.querySelector('.pe-retouchtool') };
  };
  const touch = (element, type, id, x, y, primary = false) => fireEvent[type](element, { pointerId: id, isPrimary: primary, button: 0, clientX: x, clientY: y, pointerType: 'touch' });

  test('a pinch drops the stroke, and a finger landing again while the other is down paints nothing', () => {
    const { layer, onCommit, onPreview } = renderTool();
    touch(layer, 'pointerDown', 1, 100, 100, true);
    touch(layer, 'pointerDown', 2, 300, 300);
    expect(onPreview).toHaveBeenLastCalledWith(null);
    touch(layer, 'pointerUp', 1, 100, 100);
    touch(layer, 'pointerDown', 3, 120, 100);
    touch(layer, 'pointerMove', 3, 160, 100);
    touch(layer, 'pointerUp', 3, 160, 100);
    touch(layer, 'pointerUp', 2, 300, 300);
    expect(onCommit).not.toHaveBeenCalled();
    // Every finger up: the next touch is a repair again.
    touch(layer, 'pointerDown', 4, 200, 200, true);
    touch(layer, 'pointerUp', 4, 200, 200);
    expect(onCommit).toHaveBeenCalledTimes(1);
    const [u, v] = onCommit.mock.calls[0][0].points[0];
    expect([u, v]).toEqual([expect.closeTo(1 / 3, 5), 0.5]);
  });


  test('a stroke in progress is dropped when the tool changes', () => {
    const { layer, onCommit, onPreview, rerender } = renderTool({ tool: 'clone', clone: { source: { x: 0.5, y: 0.5 }, aligned: false, offset: null } });
    touch(layer, 'pointerDown', 1, 60, 60, true);
    touch(layer, 'pointerMove', 1, 120, 60);
    rerender({ tool: 'remove' });
    expect(onPreview).toHaveBeenLastCalledWith(null);
    touch(layer, 'pointerUp', 1, 120, 60);
    expect(onCommit).not.toHaveBeenCalled();
  });

  test('losing focus drops a stroke and clears interrupted touch pointers', () => {
    const { layer, onCommit, onPreview } = renderTool();
    touch(layer, 'pointerDown', 1, 100, 100, true);
    fireEvent.blur(window);
    touch(layer, 'pointerUp', 1, 100, 100);
    expect(onCommit).not.toHaveBeenCalled();
    expect(onPreview).toHaveBeenLastCalledWith(null);
    touch(layer, 'pointerDown', 2, 100, 100, true);
    touch(layer, 'pointerUp', 2, 100, 100);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  test('Set source by touch follows the finger and takes the point where it lifts; Alt-click still sets it at once', () => {
    const { layer, onSource, rerender } = renderTool({ tool: 'clone', picking: true });
    touch(layer, 'pointerDown', 1, 60, 80, true);
    expect(onSource).not.toHaveBeenCalled();
    touch(layer, 'pointerMove', 1, 300, 200);
    expect(layer.querySelector('.pe-retouch-marker').hidden).toBe(false);
    touch(layer, 'pointerUp', 1, 300, 200);
    expect(onSource).toHaveBeenCalledTimes(1);
    expect(onSource.mock.calls[0][0]).toEqual({ x: 0.5, y: 0.5 });
    rerender({ tool: 'clone', picking: false });
    fireEvent.pointerDown(layer, { pointerId: 9, button: 0, clientX: 150, clientY: 100, pointerType: 'mouse', altKey: true });
    expect(onSource).toHaveBeenLastCalledWith({ x: 0.25, y: 0.25 });
  });
});
