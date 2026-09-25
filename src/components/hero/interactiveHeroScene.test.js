import { mountDeskScene } from './interactiveHeroScene';

vi.mock('three', async (original) => ({
  ...(await original()),
  WebGLRenderer: class {
    info = { render: { calls: 15, triangles: 2902 } };
    setClearColor() {}
    setPixelRatio() {}
    setSize() {}
    render() {}
    dispose() {}
    forceContextLoss() {}
  },
}));
vi.mock('./deskScene', () => ({
  createDeskScene: () => ({ scene: {}, dispose() {} }),
  frameDesk: () => ({ x: 2, y: 4, z: 9 }),
}));

let host, instance, canvas, frames, reduced;
function pointer(type, x, y = 100, options = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    clientX: x,
    clientY: y,
    ...options,
  });
  host.dispatchEvent(event);
  return event;
}
function settle() {
  for (let i = 0; frames.size && i < 150; i++) {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((cb) => cb((i + 1) * 16));
  }
  expect(frames.size).toBe(0);
}
beforeEach(() => {
  frames = new Map();
  let id = 0;
  reduced = {
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn((q) => (q.includes('reduced') ? reduced : { matches: true })),
  );
  vi.stubGlobal('requestAnimationFrame', (cb) => {
    frames.set(++id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id) => frames.delete(id));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  host = document.createElement('div');
  document.body.append(host);
  host.getBoundingClientRect = () => ({
    width: 500,
    height: 250,
    top: 0,
    left: 0,
    right: 500,
    bottom: 250,
  });
  let capture;
  host.setPointerCapture = vi.fn((id) => {
    capture = id;
  });
  host.hasPointerCapture = (id) => capture === id;
  host.releasePointerCapture = vi.fn(() => {
    capture = undefined;
  });
  instance = mountDeskScene(host, { onReady() {}, onError: vi.fn() });
  instance.setActive(true);
  canvas = host.querySelector('canvas');
  settle();
});
afterEach(() => {
  instance.dispose();
  host.remove();
  vi.unstubAllGlobals();
});

test('wheel stays uncanceled before, during and after mouse drag', () => {
  for (const phase of ['idle', 'drag', 'released']) {
    if (phase === 'drag') {
      pointer('pointerdown', 100);
      pointer('pointermove', 200);
    }
    if (phase === 'released') pointer('pointerup', 200);
    const wheel = new WheelEvent('wheel', {
      deltaY: 80,
      bubbles: true,
      cancelable: true,
    });
    expect(canvas.dispatchEvent(wheel)).toBe(true);
    expect(wheel.defaultPrevented).toBe(false);
  }
});
test('primary mouse enters bounded orbit and release retains angle then idles', () => {
  pointer('pointerdown', 100);
  expect(host.setPointerCapture).not.toHaveBeenCalled();
  pointer('pointermove', 102);
  expect(host.setPointerCapture).not.toHaveBeenCalled();
  pointer('pointermove', 800);
  settle();
  expect(host.dataset.dragging).toBe('true');
  expect(+canvas.dataset.target).toBe(-Math.PI / 2);
  pointer('pointerup', 800);
  settle();
  expect(host.dataset.dragging).toBe('false');
  expect(host.hasPointerCapture(1)).toBe(false);
  expect(+canvas.dataset.orbit).toBe(-Math.PI / 2);
  expect(frames.size).toBe(0);
});
test.each(['pointercancel', 'blur', 'lostpointercapture'])(
  '%s clears drag ownership',
  (type) => {
    pointer('pointerdown', 100);
    pointer('pointermove', 200);
    if (type === 'blur') window.dispatchEvent(new Event('blur'));
    else pointer(type, 200);
    expect(host.dataset.dragging).toBe('false');
    expect(host.hasPointerCapture(1)).toBe(false);
    settle();
  },
);
test('missed release cannot keep rotating on buttonless mouse movement', () => {
  pointer('pointerdown', 100);
  pointer('pointermove', 200);
  settle();
  const target = canvas.dataset.target;
  pointer('pointermove', 300, 100, { buttons: 0 });
  settle();
  expect(host.dataset.dragging).toBe('false');
  expect(canvas.dataset.target).toBe(target);
});
test.each([
  [0, 30],
  [30, 25],
])('vertical/ambiguous touch %s,%s stays page owned', (dx, dy) => {
  pointer('pointerdown', 100, 100, { pointerType: 'touch' });
  const event = pointer('pointermove', 100 + dx, 100 + dy, {
    pointerType: 'touch',
  });
  expect(event.defaultPrevented).toBe(false);
  expect(host.setPointerCapture).not.toHaveBeenCalled();
  pointer('pointermove', 250, 100 + dy, { pointerType: 'touch' });
  expect(host.setPointerCapture).not.toHaveBeenCalled();
});
test('horizontal touch waits for threshold then captures and rotates', () => {
  pointer('pointerdown', 100, 100, { pointerType: 'touch' });
  pointer('pointermove', 105, 101, { pointerType: 'touch' });
  expect(host.setPointerCapture).not.toHaveBeenCalled();
  pointer('pointermove', 150, 102, { pointerType: 'touch' });
  settle();
  expect(host.hasPointerCapture(1)).toBe(true);
  expect(+canvas.dataset.target).toBeLessThan(0);
});
test('reduced motion permits manual drag but schedules no scroll or hover motion', () => {
  reduced.matches = true;
  reduced.addEventListener.mock.calls.find(([type]) => type === 'change')[1]();
  settle();
  pointer('pointermove', 200, 100, { buttons: 0 });
  window.dispatchEvent(new Event('scroll'));
  expect(frames.size).toBe(0);
  pointer('pointerdown', 100);
  pointer('pointermove', 200);
  expect(frames.size).toBe(1);
  settle();
  expect(+canvas.dataset.orbit).toBeLessThan(-0.5);
  pointer('pointerup', 200);
  settle();
  const angle = canvas.dataset.orbit;
  pointer('pointermove', 400, 100, { buttons: 0 });
  window.dispatchEvent(new Event('scroll'));
  expect(canvas.dataset.orbit).toBe(angle);
  expect(frames.size).toBe(0);
});
test('offscreen suspension releases dragging and schedules no frames', () => {
  pointer('pointerdown', 100);
  pointer('pointermove', 200);
  instance.setActive(false);
  expect(frames.size).toBe(0);
  expect(host.dataset.dragging).toBe('false');
  window.dispatchEvent(new Event('scroll'));
  expect(frames.size).toBe(0);
});
test('Tab and vertical keyboard scrolling are not intercepted', () => {
  for (const key of ['Tab', 'ArrowDown', 'PageDown', ' ']) {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    });
    expect(host.dispatchEvent(event)).toBe(true);
  }
});
