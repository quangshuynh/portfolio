import React, { useRef } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import useEditorViewport from './useEditorViewport';

function Harness() {
  const root = useRef(null);
  useEditorViewport(root);
  return <div ref={root}><aside className="pe-inspector"><input defaultValue="kept" /></aside></div>;
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test('keyboard resize, viewport scrolling and restoration keep input state; listeners clean up', () => {
  const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 });
  vi.stubGlobal('visualViewport', viewport);
  vi.stubGlobal('innerHeight', 800);
  const frames = new Map();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (fn) => { frames.set(++id, fn); return id; });
  vi.stubGlobal('cancelAnimationFrame', (key) => frames.delete(key));
  const flush = () => act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach((fn) => fn()); });
  const remove = vi.spyOn(viewport, 'removeEventListener');
  const { container, unmount } = render(<Harness />);
  const root = container.firstChild;
  const input = container.querySelector('input');
  const panel = container.querySelector('aside');
  panel.getBoundingClientRect = () => ({ top: 200, bottom: 380 });
  input.getBoundingClientRect = () => ({ top: 400, bottom: 444 });
  input.focus();
  viewport.height = 420; viewport.offsetTop = 24;
  viewport.dispatchEvent(new Event('resize'));
  viewport.dispatchEvent(new Event('scroll'));
  expect(frames.size).toBe(1);
  flush();
  // Revealing the field must not wait behind a second (possibly expensive) paint.
  expect(frames.size).toBe(0);
  expect(root.style.getPropertyValue('--pe-viewport-height')).toBe('420px');
  expect(root.style.getPropertyValue('--pe-viewport-top')).toBe('24px');
  expect(root).toHaveAttribute('data-keyboard');
  expect(panel.scrollTop).toBe(72);
  viewport.scale = 2; viewport.height = 200;
  viewport.dispatchEvent(new Event('resize')); flush();
  expect(root.style.getPropertyValue('--pe-viewport-height')).toBe('420px');
  viewport.scale = 1; viewport.height = 800; viewport.offsetTop = 0;
  input.blur(); fireEvent(window, new Event('pageshow')); flush();
  expect(root).not.toHaveAttribute('data-keyboard');
  expect(root.style.getPropertyValue('--pe-viewport-height')).toBe('800px');
  expect(input.value).toBe('kept');
  unmount();
  expect(remove).toHaveBeenCalledTimes(2);
  expect(frames.size).toBe(0);
});
