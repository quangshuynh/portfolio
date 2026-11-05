// useSelections on an image layer (Interval 24.1): the layer's own source is analysed (never the
// photo), transparency limits the result, the mask is set on the layer chosen when the selection
// started, and a result for a layer that is no longer the target is not applied to another.
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { encodeCodes, decodeCodes } from '../segment/analysis.mjs';
import { createImageLayer, normalizeLayer } from '../model/layers.mjs';
import { createMask } from '../model/masks.mjs';

const requests = [];
vi.mock('../segment/selectionClient.mjs', () => ({
  createSelectionRunner: () => ({
    run: async (request) => {
      requests.push(request);
      const { width, height } = request.image;
      return { found: true, kind: request.kind, width, height, data: encodeCodes(new Uint8Array(width * height).fill(255)), confidence: 0.8, version: 'test/1', candidates: 1, candidate: 0 };
    },
    cancel: () => {}, trim: () => {}, dispose: () => {}, loaded: () => new Set(), busy: () => false,
  }),
}));
vi.mock('../raw/rawClient.mjs', () => ({ constrainedDevice: () => false }));

const { default: useSelections, ownerOf } = await import('./useSelections.js');

const source = { sha256: 'e'.repeat(64), name: 'car.png', size: 1, format: 'png', width: 400, height: 200 };
const layer = (id, patch = {}) => normalizeLayer({ ...createImageLayer(id, source, { width: 800, height: 600 }), ...patch });
// A source whose left half is transparent.
const decoded = ({ width, height }) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p += 1) data.set([200, 50, 50, (p % width) < width / 2 ? 0 : 255], p * 4);
  return { width, height, data };
};

function setup(target) {
  const calls = { layerSource: [], applied: [], opened: [], render: 0, applyMask: [] };
  const props = {
    photo: { id: 'p1', raw: null }, ready: true, viewProxy: { photoId: 'p1', image: {} }, adjustments: {}, lut: null,
    renderInWorker: async () => { calls.render += 1; return decoded({ width: 64, height: 48 }); },
    layerSource: async (l, size) => { calls.layerSource.push([l.id, size]); return decoded(size); },
    locals: [], onApplyLocals: () => {}, onSelectLocal: () => {}, target,
    onApplyMask: (mask) => calls.applyMask.push(mask), onPreviewMask: () => {}, onSelectComponent: () => {},
    newId: (prefix) => `${prefix}-1`,
    onApplyLayerMask: (id, update) => calls.applied.push([id, typeof update === 'function' ? update(null) : update]),
    onLayerMask: (id) => calls.opened.push(id),
  };
  const hook = renderHook((p) => useSelections(p), { initialProps: props });
  return { hook, calls, props };
}

describe('selections on an image layer', () => {
  beforeEach(() => { requests.length = 0; });

  test('the owner of a mask is the selected image layer, else the photo', () => {
    const l = layer('img');
    expect(ownerOf({ kind: 'layer', layer: l })).toEqual({ kind: 'layer', layer: l });
    expect(ownerOf({ kind: 'layer', layer: { ...l, type: 'adjustment' } })).toEqual({ kind: 'photo' });
    expect(ownerOf({ kind: 'local' })).toEqual({ kind: 'photo' });
  });

  test('Mask from Subject analyses the layer\'s source, limited to its alpha, and masks that layer', async () => {
    const l = layer('img');
    const { hook, calls } = setup(null);
    await act(() => hook.result.current.select('subject', { layer: l, replace: true }));
    expect(calls.render).toBe(0);
    expect(calls.layerSource).toEqual([['img', { width: 400, height: 200 }]]);
    expect(requests[0].imageKey).toMatch(/layer\|e{64}/);
    // The models saw an opaque image (transparent pixels over grey).
    expect(requests[0].image.data[3]).toBe(255);
    const [[id, mask]] = calls.applied;
    expect(id).toBe('img');
    expect(mask).toMatchObject({ space: 'layer', base: 'none' });
    const c = mask.components[0];
    const codes = decodeCodes(c.data, c.width * c.height);
    expect(codes[0]).toBe(0);
    expect(codes[c.width - 1]).toBe(255);
    expect(calls.opened).toEqual(['img']);
    // A second selection on the same layer reuses its analysis image.
    await act(() => hook.result.current.select('sky', { layer: l }));
    expect(calls.layerSource).toHaveLength(1);
  });

  test('adding to a layer mask that changed owner meanwhile is not applied', async () => {
    const a = layer('a', { mask: createMask('layer') });
    const b = layer('b', { mask: createMask('layer') });
    const { hook, calls, props } = setup({ kind: 'layer', layer: a });
    let pending;
    act(() => { pending = hook.result.current.select('subject', { mode: 'add' }); });
    hook.rerender({ ...props, target: { kind: 'layer', layer: b } });
    await act(() => pending);
    expect(calls.applyMask).toEqual([]);
    expect(hook.result.current.status?.text).toMatch(/selected layer changed/);
  });
});
