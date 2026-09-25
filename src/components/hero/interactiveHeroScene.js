import { OrthographicCamera, WebGLRenderer } from 'three';
import { createDeskScene, frameDesk } from './deskScene';
import { createDeskMotion, ORBIT_LIMIT } from './deskMotion';

export function mountDeskScene(host, { onReady, onError }) {
  let renderer,
    desk,
    observer,
    frame = 0,
    disposed = false,
    active = false;
  let width = 0,
    height = 0,
    base,
    baseTarget,
    frustum,
    lastTime = 0,
    suppressClick = false;
  const motion = createDeskMotion();
  const camera = new OrthographicCamera(-5, 5, 3, -3, 0.1, 60);
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  motion.setReducedMotion(reduced.matches);
  const hero = host.closest('.hero');
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  function eligible() {
    if (disposed || !active || document.hidden || !width || !height)
      return false;
    const rect = host.getBoundingClientRect();
    return (
      rect.bottom > 0 &&
      rect.top < innerHeight &&
      rect.right > 0 &&
      rect.left < innerWidth
    );
  }
  function syncScroll() {
    if (!hero) return;
    const rect = hero.getBoundingClientRect();
    const footprint =
      document.querySelector('.home-nav-slot')?.getBoundingClientRect()
        .height || 0;
    motion.setScroll((footprint - rect.top) / Math.max(1, rect.height));
  }
  function fail() {
    if (!disposed) {
      dispose();
      onError();
    }
  }
  function render(time) {
    frame = 0;
    if (!eligible()) return;
    try {
      const dt = lastTime ? Math.min(time - lastTime, 64) : 16;
      lastTime = time;
      let unsettled = motion.step(dt);
      for (const key of ['azimuth', 'radius', 'elevation']) {
        if (reduced.matches) base[key] = baseTarget[key];
        base[key] += (baseTarget[key] - base[key]) * (1 - Math.exp(-dt / 85));
        if (Math.abs(baseTarget[key] - base[key]) < 0.0001)
          base[key] = baseTarget[key];
        else unsettled = true;
      }
      const angle = base.azimuth + motion.angle;
      camera.position.set(
        Math.sin(angle) * base.radius,
        1.35 + base.elevation,
        Math.cos(angle) * base.radius,
      );
      camera.lookAt(0, 1.35, 0);
      // The long tabletop projects taller at side angles. Widen smoothly with
      // the orbit so the complete setup keeps breathing room at either limit.
      const framing = 1 + 0.25 * Math.abs(Math.sin(motion.angle));
      camera.left = frustum.left * framing;
      camera.right = frustum.right * framing;
      camera.top = frustum.top * framing;
      camera.bottom = frustum.bottom * framing;
      camera.updateProjectionMatrix();
      renderer.render(desk.scene, camera);
      canvas.dataset.frames = String(Number(canvas.dataset.frames || 0) + 1);
      canvas.dataset.drawCalls = String(renderer.info.render.calls);
      canvas.dataset.triangles = String(renderer.info.render.triangles);
      canvas.dataset.orbit = String(motion.angle);
      canvas.dataset.target = String(motion.target);

      host.setAttribute(
        'aria-valuenow',
        String(Math.round((motion.angle * 180) / Math.PI)),
      );
      onReady();
      if (unsettled) invalidate();
    } catch {
      fail();
    }
  }
  function invalidate() {
    if (eligible() && !frame) frame = requestAnimationFrame(render);
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
      const origin = frameDesk(camera, width, height);
      frustum = {
        left: camera.left,
        right: camera.right,
        top: camera.top,
        bottom: camera.bottom,
      };
      baseTarget = {
        azimuth: Math.atan2(origin.x, origin.z),
        radius: Math.hypot(origin.x, origin.z),
        elevation: origin.y - 1.35,
      };
      base ||= { ...baseTarget };
      endGesture();
      motion.setParallax(0);
      if (eligible()) syncScroll();
      invalidate();
    } catch {
      fail();
    }
  }
  function endGesture() {
    const id = motion.gesture?.id;
    if (id === undefined) return;
    suppressClick = motion.end(id);
    if (host.hasPointerCapture?.(id)) host.releasePointerCapture(id);
    host.dataset.dragging = 'false';
  }
  function down(event) {
    if (!eligible() || !event.isPrimary || event.button !== 0) return;
    // A fresh mouse press also recovers a release missed outside the window.
    if (event.pointerType === 'mouse') endGesture();
    suppressClick = false;
    motion.begin(
      event.pointerId,
      event.clientX,
      event.clientY,
      width,
      event.pointerType !== 'mouse',
    );
  }
  function move(event) {
    if (!eligible()) return;
    if (motion.gesture) {
      if (
        event.pointerType === 'mouse' &&
        event.pointerId === motion.gesture.id &&
        !(event.buttons & 1)
      ) {
        endGesture();
        invalidate();
        return;
      }
      if (motion.move(event.pointerId, event.clientX, event.clientY)) {
        if (!host.hasPointerCapture(event.pointerId)) {
          host.setPointerCapture(event.pointerId);
          host.dataset.drags = String(Number(host.dataset.drags || 0) + 1);
        }
        host.dataset.dragging = 'true';
        invalidate();
      }
      return;
    }
    if (
      event.pointerType !== 'mouse' ||
      reduced.matches ||
      !fine.matches ||
      !host.contains(event.target)
    )
      return;
    const rect = host.getBoundingClientRect();
    motion.setParallax(((event.clientX - rect.left) / width) * 2 - 1);
    invalidate();
  }
  function up(event) {
    if (motion.gesture?.id !== event.pointerId) return;
    endGesture();
    invalidate();
  }
  // Touch starts with implicit capture on the canvas. Its transfer to the host
  // bubbles a lost event; only losing the host's own capture ends this drag.
  function captureLost(event) {
    if (event.target === host) up(event);
  }
  function leave() {
    if (reduced.matches) return;
    if (!motion.gesture) {
      motion.setParallax(0);
      invalidate();
    }
  }
  function click(event) {
    if (suppressClick) {
      event.preventDefault();
      event.stopPropagation();
      suppressClick = false;
    }
  }
  function key(event) {
    if (!eligible()) return;
    const targets = {
      ArrowLeft: motion.target - Math.PI / 18,
      ArrowRight: motion.target + Math.PI / 18,
      Home: -ORBIT_LIMIT,
      End: ORBIT_LIMIT,
      Escape: 0,
    };
    if (!(event.key in targets)) return;
    event.preventDefault();
    endGesture();
    motion.select(targets[event.key]);
    invalidate();
  }
  function scroll() {
    if (reduced.matches) return;
    if (eligible()) {
      syncScroll();
      invalidate();
    }
  }
  function visibility() {
    if (document.hidden) {
      endGesture();
      cancelAnimationFrame(frame);
      frame = 0;
      lastTime = 0;
    } else if (eligible()) {
      syncScroll();
      invalidate();
    }
  }
  function blur() {
    endGesture();
    motion.setParallax(0);
    invalidate();
  }
  function preferences() {
    endGesture();
    motion.setReducedMotion(reduced.matches);
    if (!reduced.matches && eligible()) syncScroll();
    invalidate();
  }
  function lost(event) {
    event.preventDefault();
    fail();
  }
  function dispose() {
    if (disposed) return;
    endGesture();
    disposed = true;
    cancelAnimationFrame(frame);
    observer?.disconnect();
    host.removeEventListener('pointerdown', down);
    host.removeEventListener('pointerleave', leave);
    host.removeEventListener('lostpointercapture', captureLost);
    host.removeEventListener('click', click, true);
    host.removeEventListener('keydown', key);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    window.removeEventListener('blur', blur);
    window.removeEventListener('scroll', scroll);
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', visibility);
    reduced.removeEventListener('change', preferences);
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
    host.addEventListener('pointerdown', down, { passive: true });
    host.addEventListener('pointerleave', leave, { passive: true });
    host.addEventListener('lostpointercapture', captureLost);
    host.addEventListener('click', click, true);
    host.addEventListener('keydown', key);
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up, { passive: true });
    window.addEventListener('pointercancel', up, { passive: true });
    window.addEventListener('blur', blur);
    window.addEventListener('scroll', scroll, { passive: true });
    window.addEventListener('resize', resize, { passive: true });
    document.addEventListener('visibilitychange', visibility);
    reduced.addEventListener('change', preferences);
    observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
  } catch {
    fail();
  }
  return {
    dispose,
    setActive(value) {
      if (disposed || active === value) return;
      active = value;
      if (!active) {
        endGesture();
        cancelAnimationFrame(frame);
        frame = 0;
        lastTime = 0;
      } else if (eligible()) {
        syncScroll();
        invalidate();
      }
    },
  };
}
