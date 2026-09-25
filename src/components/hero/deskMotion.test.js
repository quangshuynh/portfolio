import { createDeskMotion, ORBIT_LIMIT } from './deskMotion';
test('reduced motion suppresses automatic offsets and easing, not deliberate orbit', () => {
  const m = createDeskMotion();
  m.setReducedMotion(true);
  m.setScroll(1);
  m.setParallax(1);
  expect(m.target).toBe(0);
  m.begin(1, 0, 0, 300, false);
  m.move(1, 100, 0);
  expect(m.step(16)).toBe(false);
  expect(m.angle).toBeCloseTo(-Math.PI / 3);
  m.end(1);
  m.setScroll(0.5);
  expect(m.target).toBe(m.angle);
  m.select(100);
  m.step(16);
  expect(m.angle).toBe(ORBIT_LIMIT);
  m.setReducedMotion(false);
  m.setScroll(0.5);
  m.select(0);
  expect(m.step(16)).toBe(true);
});
const settle = (m) => {
  let frames = 0;
  while (m.step(16) && frames++ < 150) {}
  expect(frames).toBeLessThan(150);
  return frames;
};

test('scroll maps deterministically to a small target, then reaches exact idle', () => {
  const m = createDeskMotion();
  m.setScroll(0.5);
  expect(m.target).toBeCloseTo(0.03);
  expect(settle(m)).toBeGreaterThan(0);
  expect(m.angle).toBe(m.target);
  expect(m.step(16)).toBe(false);
  m.setScroll(-1);
  expect(m.target).toBe(0);
  m.setScroll(50);
  expect(m.target).toBe(0.06);
});
test('touch requires clear horizontal intent and never adopts a vertical swipe', () => {
  const m = createDeskMotion();
  m.begin(1, 100, 100, 300, true);
  expect(m.move(1, 105, 102)).toBe(false);
  expect(m.gesture.intent).toBe('pending');
  expect(m.move(1, 106, 120)).toBe(false);
  expect(m.gesture.intent).toBe('vertical');
  expect(m.move(1, 250, 120)).toBe(false);
  expect(m.end(1)).toBe(false);
  expect(m.target).toBe(0);
});
test('horizontal touch intent engages after threshold; other pointers are ignored', () => {
  const m = createDeskMotion();
  m.begin(1, 100, 100, 300, true);
  expect(m.move(2, 160, 100)).toBe(false);
  expect(m.move(1, 120, 103)).toBe(true);
  expect(m.target).toBeLessThan(0);
  expect(m.end(2)).toBe(false);
  expect(m.end(1)).toBe(true);
});
test('both large drags clamp to exactly 180 total degrees and cannot accumulate spins', () => {
  const m = createDeskMotion();
  for (const direction of [-1, 1, -1, 1]) {
    m.begin(1, 0, 0, 300, false);
    m.move(1, direction * 3000, 0);
    settle(m);
    expect(Math.abs(m.angle)).toBe(ORBIT_LIMIT);
    m.end(1);
    settle(m);
    expect(Math.abs(m.angle)).toBeLessThanOrEqual(ORBIT_LIMIT);
  }
});
test('drag wins over changing scroll/parallax, and release preserves selected target', () => {
  const m = createDeskMotion();
  m.setScroll(0.5);
  settle(m);
  m.begin(1, 0, 0, 300, false);
  m.move(1, 70, 1);
  const chosen = m.target;
  m.setScroll(1);
  m.setParallax(1);
  expect(m.target).toBe(chosen);
  m.end(1);
  expect(m.target).toBeCloseTo(chosen, 12);
  settle(m);
  expect(m.angle).toBeCloseTo(chosen, 12);
  m.setScroll(0.5);
  expect(m.target).toBeCloseTo(chosen - 0.03);
});
test('parallax and scroll cannot exceed manual limits; keyboard selection uses same clamp', () => {
  const m = createDeskMotion();
  m.select(20);
  m.setScroll(1);
  m.setParallax(1);
  expect(m.target).toBe(ORBIT_LIMIT);
  settle(m);
  expect(m.step(16)).toBe(false);
  m.select(-20);
  expect(m.target).toBe(-ORBIT_LIMIT);
});
test('a new drag resumes from the visible angle rather than snapping to an unsettled target', () => {
  const m = createDeskMotion();
  m.select(1);
  m.step(16);
  const visible = m.angle;
  m.begin(1, 0, 0, 300, false);
  m.move(1, 5, 0);
  expect(m.target).toBeCloseTo(visible - (5 / 300) * Math.PI);
});
