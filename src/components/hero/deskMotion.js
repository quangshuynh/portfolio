export const ORBIT_LIMIT = Math.PI / 2;
const clamp = (value, min = -ORBIT_LIMIT, max = ORBIT_LIMIT) =>
  Math.max(min, Math.min(max, value));

// One angular target owns all input. Angles are offsets from the responsive front.
// No timer/DOM/Three dependency: the renderer requests frames only until settled.
export function createDeskMotion() {
  let angle = 0,
    target = 0,
    manual = 0,
    scroll = 0,
    parallax = 0,
    gesture = null,
    reducedMotion = false;
  const retarget = () => {
    if (gesture?.intent !== 'horizontal')
      target = clamp(manual + scroll + parallax);
  };
  return {
    get angle() {
      return angle;
    },
    get target() {
      return target;
    },
    get gesture() {
      return gesture;
    },
    setReducedMotion(value) {
      if (reducedMotion === value) return;
      reducedMotion = value;
      // Preserve the visible view when switching policy; discard automatic offsets.
      manual = target = angle;
      scroll = parallax = 0;
    },
    setScroll(progress) {
      if (reducedMotion) return;
      scroll = clamp(progress, 0, 1) * 0.06;
      retarget();
    },
    setParallax(value) {
      if (reducedMotion) return;
      parallax = gesture ? 0 : clamp(value, -1, 1) * 0.018;
      retarget();
    },
    begin(id, x, y, width, touch) {
      if (gesture) return false;
      gesture = {
        id,
        x,
        y,
        width: Math.max(1, width),
        threshold: touch ? 10 : 4,
        intent: 'pending',
        start: angle,
      };
      parallax = 0;
      return true;
    },
    move(id, x, y) {
      if (!gesture || gesture.id !== id) return false;
      const dx = x - gesture.x,
        dy = y - gesture.y;
      if (gesture.intent === 'pending') {
        // Once movement is meaningful, ambiguous diagonals belong to the page.
        if (
          Math.max(Math.abs(dx), Math.abs(dy)) >= gesture.threshold &&
          Math.abs(dx) <= Math.abs(dy) * 1.4
        )
          gesture.intent = 'vertical';
        else if (
          Math.abs(dx) >= gesture.threshold &&
          Math.abs(dx) > Math.abs(dy) * 1.4
        )
          gesture.intent = 'horizontal';
      }
      if (gesture.intent !== 'horizontal') return false;
      target = clamp(gesture.start - (dx / gesture.width) * Math.PI);
      return true;
    },
    end(id) {
      if (!gesture || gesture.id !== id) return false;
      const dragged = gesture.intent === 'horizontal';
      if (dragged) manual = target - scroll;
      gesture = null;
      parallax = 0;
      retarget();
      return dragged;
    },
    select(value) {
      target = clamp(value);
      manual = target - scroll;
      parallax = 0;
    },
    step(milliseconds) {
      if (reducedMotion) {
        angle = target;
        return false;
      }
      angle +=
        (target - angle) * (1 - Math.exp(-Math.min(milliseconds, 64) / 65));
      if (Math.abs(target - angle) < 0.0001) angle = target;
      return angle !== target;
    },
  };
}
