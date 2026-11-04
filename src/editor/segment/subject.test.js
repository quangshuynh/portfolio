import { describe, expect, test } from 'vitest';
import { skyFromProbability } from './analysis.mjs';
import { candidateEvidence, normaliseMap, plausibility, rankSubjects, stability, subjectNote, subjectPrompts, SUBJECT_WARN } from './subject.mjs';

const W = 100;
const H = 80;
/** A 0/1 coverage of the box [x0, y0, x1, y1). */
function box(x0, y0, x1, y1, value = 1, width = W, height = H) {
  const out = new Float32Array(width * height);
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) out[y * width + x] = value;
  return out;
}
const max = (...maps) => maps.reduce((a, b) => a.map((v, i) => Math.max(v, b[i])));
/** An RGBA image of one grey level, with an optional brighter box. */
function grey(level, width = W, height = H) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).map((_, i) => (i % 4 === 3 ? 255 : level)) };
}
const sam = (coverage, score = 0.95, stable = 0.95) => ({ coverage, score, stable });

describe('subject prompts', () => {
  test('a frame-filling subject whose saliency peaks in one part is prompted as a whole too', () => {
    // A car (moderately salient, 0.35) with a tail light (fully salient) inside it.
    const s = max(box(5, 20, 95, 78, 0.35), box(60, 40, 75, 50, 1));
    const prompts = subjectPrompts(s, W, H);
    const boxes = prompts.map((p) => p.box);
    expect(boxes).toContainEqual([60, 40, 75, 50]);
    expect(boxes).toContainEqual([5, 20, 95, 78]);
    // The tail light's prompt point is inside it.
    const light = prompts.find((p) => p.box[0] === 60);
    expect(light.point[0]).toBeGreaterThanOrEqual(60);
    expect(light.point[0]).toBeLessThan(75);
  });

  test('nothing salient gives no prompts', () => {
    expect(subjectPrompts(new Float32Array(W * H), W, H)).toEqual([]);
  });

  test('saliency is normalised to 0–1', () => {
    expect(Array.from(normaliseMap(Float32Array.from([2, 4, 6])))).toEqual([0, 0.5, 1]);
  });
});

describe('subject candidates', () => {
  test('stability is SAM\'s mask at +1 over the mask at −1', () => {
    expect(stability(Float32Array.from([5, 5, 0, -5]))).toBeCloseTo(2 / 3);
    expect(stability(Float32Array.from([-5, -5]))).toBe(0);
  });

  test('the whole frame-filling car outranks its tail light', () => {
    const s = max(box(5, 20, 95, 78, 0.35), box(60, 40, 75, 50, 1));
    const light = sam(box(60, 40, 75, 50), 0.97);
    const car = sam(box(5, 20, 95, 78), 0.93);
    const { options } = rankSubjects([light, car], s, W, H);
    expect(options[0].pick).toEqual([1]);
    // The tail light remains as the next candidate.
    expect(options[1].pick).toEqual([0]);
  });

  test('a band across the whole photo (a sunset sky) is doubtful, with a reason', () => {
    // Afterglow: the bright band of sky is the most salient thing in the photo.
    const s = box(0, 20, W, 40, 1);
    const band = sam(box(0, 20, W, 40), 0.98, 0.98);
    expect(candidateEvidence(band.coverage, s, W, H).band).toBe(true);
    const [option] = rankSubjects([band], s, W, H).options;
    expect(option.confidence).toBeLessThan(SUBJECT_WARN);
    expect(option.warnings[0]).toBe('band');
    expect(subjectNote(option.warnings)).toMatch(/across the whole photo/);
  });

  test('two separate, equally salient subjects are selected together', () => {
    const s = max(box(10, 10, 30, 30, 1), box(60, 40, 80, 60, 1));
    const { options } = rankSubjects([sam(box(10, 10, 30, 30)), sam(box(60, 40, 80, 60))], s, W, H);
    expect(options[0].pick.sort()).toEqual([0, 1]);
    expect(options[0].warnings).toEqual([]);
  });

  test('a rival answer as plausible as the best is reported, not hidden', () => {
    // An object, and a bigger mask taking in background as well: SAM is surer of the bigger one.
    const s = max(box(30, 20, 60, 50, 1), box(60, 20, 75, 50, 0.45));
    const object = sam(box(30, 20, 60, 50), 0.8, 0.85);
    const wider = sam(box(30, 20, 75, 50), 0.97, 0.97);
    const { options } = rankSubjects([object, wider], s, W, H);
    // Overlapping answers are alternatives (Next candidate), not rivals; a distinct one is a rival.
    expect(options.length).toBe(2);
    expect(options[0].warnings).not.toContain('competing');
    // Two overlapping outlines of a salient area, equally plausible: which one is meant is unclear.
    const s2 = box(30, 20, 80, 50, 1);
    const ranked = rankSubjects([sam(box(30, 20, 60, 50), 0.9, 0.9), sam(box(50, 20, 80, 50), 0.9, 0.9)], s2, W, H);
    expect(ranked.options[0].confidence).toBeLessThanOrEqual(0.55);
    expect(ranked.options[0].warnings).toContain('competing');
  });

  test('a good, clear subject carries no warning', () => {
    const s = box(30, 20, 60, 50, 1);
    const [option] = rankSubjects([sam(box(30, 20, 60, 50))], s, W, H).options;
    expect(option.confidence).toBeGreaterThan(0.8);
    expect(option.warnings).toEqual([]);
  });

  test('fragments and slivers are less plausible', () => {
    const s = box(0, 0, W, H, 1);
    const whole = candidateEvidence(box(10, 10, 70, 50), s, W, H);
    const split = candidateEvidence(max(box(10, 10, 30, 50), box(32, 10, 52, 50), box(60, 10, 80, 50)), s, W, H);
    expect(split.pieces).toBe(3);
    expect(plausibility(split, { score: 0.9, stable: 0.9 })).toBeLessThan(plausibility(whole, { score: 0.9, stable: 0.9 }));
    expect(rankSubjects([sam(new Float32Array(W * H))], s, W, H).options).toEqual([]);
  });
});

describe('sky evidence', () => {
  const size = 40;
  const prob = (fill) => { const p = new Float32Array(size * size); for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) p[y * size + x] = fill(x, y); return p; };

  test('sky-like regions below the sky (a reflection, a dark driveway) are dropped', () => {
    const image = grey(150, 200, 200);
    // Sky at the top, and a separate "sky" region in the lower third (water or a car window).
    const sky = skyFromProbability(prob((x, y) => (y < 12 || (y > 28 && x > 10 && x < 30) ? 0.99 : 0.01)), size, image);
    expect(sky.found).toBe(true);
    expect(sky.regions).toBe(1);
    expect(sky.dropped).toBe(1);
    expect(sky.coverage[170 * 200 + 100]).toBe(0);
    // Sky between branches, within the sky's own extent, stays.
    const branches = skyFromProbability(prob((x, y) => (y < 20 && !(y > 4 && y < 8) ? 0.99 : 0.01)), size, image);
    expect(branches.regions).toBe(2);
  });

  test('a dark region that does not reach the top is not night sky', () => {
    const image = grey(10, 200, 200);
    const none = skyFromProbability(prob((x, y) => (y > 15 && y < 30 ? 0.99 : 0.01)), size, image);
    expect(none.found).toBe(false);
    // A dark sky in part of the top (beside a house) is kept, with a warning that night skies are
    // easily confused with dark trees; an open night sky across the whole top is not flagged.
    const night = skyFromProbability(prob((x, y) => (y < 12 && x < 20 ? 0.99 : 0.01)), size, image);
    expect(night.found).toBe(true);
    expect(night.confidence).toBeLessThanOrEqual(0.65);
    expect(night.warnings).toEqual(['dark']);
    expect(night.note).toMatch(/night/);
    const open = skyFromProbability(prob((x, y) => (y < 12 ? 0.99 : 0.01)), size, image);
    expect(open.warnings).toEqual([]);
  });

  test('a clear daytime sky carries no warning', () => {
    const sky = skyFromProbability(prob((x, y) => (y < 15 ? 0.99 : 0.01)), size, grey(150, 200, 200));
    expect(sky.confidence).toBeGreaterThan(0.7);
    expect(sky.warnings).toEqual([]);
    expect(sky.note).toBeNull();
  });
});

test('the panel warns below the same confidences the analysis does', async () => {
  const { WARN_BELOW } = await import('./models.mjs');
  const { SKY_WARN } = await import('./analysis.mjs');
  expect(WARN_BELOW.sky).toBe(SKY_WARN);
  expect(WARN_BELOW.subject).toBe(SUBJECT_WARN);
  expect(WARN_BELOW.background).toBe(SUBJECT_WARN);
});

test('selections saved by Interval 23 keep their grid and algorithm version', async () => {
  const { createSelection, normalizeMask, createMask } = await import('../model/masks.mjs');
  const { encodeCodes, quantize } = await import('./analysis.mjs');
  const data = encodeCodes(quantize(box(10, 10, 40, 40)));
  const saved = createSelection('s1', { kind: 'subject', version: 'u2netp+mobilesam/1', width: W, height: H, data, confidence: 0.9 });
  const [again] = normalizeMask({ ...createMask('image'), components: [saved] }, 'image').components;
  expect(again).toMatchObject({ kind: 'subject', version: 'u2netp+mobilesam/1', data, confidence: 0.9 });
});
