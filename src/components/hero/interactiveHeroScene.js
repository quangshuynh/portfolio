import { OrthographicCamera, WebGLRenderer } from 'three';
import { createDeskScene, frameDesk } from './deskScene';

// Imperative renderer stays behind the import boundary; React owns only the host.
export function mountDeskScene(host, { onReady, onError }) {
  let renderer,
    desk,
    observer,
    frame = 0,
    disposed = false,
    active = false;
  let origin,
    width = 0,
    height = 0,
    x = 0,
    y = 0;
  const camera = new OrthographicCamera(-5, 5, 3, -3, 0.1, 60);
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const fail = () => {
    if (!disposed) {
      dispose();
      onError();
    }
  };
  function render() {
    frame = 0;
    if (disposed || !active || document.hidden || !width || !height) return;
    try {
      camera.position.copy(origin);
      // Approx. two degrees maximum. Touch and mobile never change the camera.
      if (fine.matches && width >= 540) {
        camera.position.x += x * 0.28;
        camera.position.y += y * 0.18;
      }
      camera.lookAt(0, 1.35, 0);
      renderer.render(desk.scene, camera);
      // Small DOM diagnostics make lifecycle/performance regression checks possible.
      canvas.dataset.frames = String(Number(canvas.dataset.frames || 0) + 1);
      canvas.dataset.drawCalls = String(renderer.info.render.calls);
      canvas.dataset.triangles = String(renderer.info.render.triangles);
      onReady();
    } catch {
      fail();
    }
  }
  function invalidate() {
    if (!disposed && active && !document.hidden && !frame)
      frame = requestAnimationFrame(render);
  }
  function resize() {
    if (disposed) return;
    const rect = host.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    if (!width || !height) return;
    try {
      renderer.setPixelRatio(
        Math.min(window.devicePixelRatio || 1, width < 540 ? 1.25 : 1.5),
      );
      renderer.setSize(width, height, false);
      origin = frameDesk(camera, width, height);
      x = 0;
      y = 0;
      invalidate();
    } catch {
      fail();
    }
  }
  function move(event) {
    if (
      event.pointerType !== 'mouse' ||
      !fine.matches ||
      width < 540 ||
      !active
    )
      return;
    const rect = host.getBoundingClientRect();
    x = Math.max(
      -1,
      Math.min(1, ((event.clientX - rect.left) / width) * 2 - 1),
    );
    y = Math.max(
      -1,
      Math.min(1, ((event.clientY - rect.top) / height) * 2 - 1),
    );
    invalidate();
  }
  function reset() {
    x = 0;
    y = 0;
    invalidate();
  }
  function visibility() {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else invalidate();
  }
  function lost(event) {
    event.preventDefault();
    fail();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    observer?.disconnect();
    host.removeEventListener('pointermove', move);
    host.removeEventListener('pointerleave', reset);
    document.removeEventListener('visibilitychange', visibility);
    canvas.removeEventListener('webglcontextlost', lost);
    desk?.dispose();
    renderer?.dispose();
    renderer?.forceContextLoss();
    canvas.remove();
  }
  try {
    renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
    renderer.setClearColor(0x000000, 0);
    desk = createDeskScene();
    host.appendChild(canvas);
    canvas.addEventListener('webglcontextlost', lost);
    host.addEventListener('pointermove', move, { passive: true });
    host.addEventListener('pointerleave', reset, { passive: true });
    document.addEventListener('visibilitychange', visibility);
    observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
  } catch {
    fail();
  }
  return {
    dispose,
    setActive(value) {
      active = value;
      if (!active) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else invalidate();
    },
  };
}
