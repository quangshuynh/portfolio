// Select Subject (Interval 23.1): candidate masks from several prompts, ranked on segmentation
// evidence, with an honest confidence and plain-language warnings.
//
// U²-Netp's saliency says where the subject is, but one threshold can split it: a frame-filling
// car may only have its tail light above 0.5. So prompts come from the salient regions at two
// thresholds and from the box around all salient pixels; SAM (MobileSAM) gives three masks per
// prompt. Every candidate is scored on what the models say about it: SAM's predicted quality and
// stability, how much of the saliency it captures and how much non-salient area it adds, and its
// shape (a band across the whole photo is a horizon or a sky, not a subject; many pieces or a
// sliver are doubtful). Nothing here knows what a car is.
//
// Confidence is a heuristic between 0 and 1, not a probability: it was checked against reference
// masks (docs/photography-editor.md, Intelligent selections) and only separates likely from
// doubtful selections.
import { components, iou } from './analysis.mjs';

/** Raw saliency peak below which nothing stands out as a subject (benchmark: none ≤ 0.65, subjects ≥ 0.77). */
export const SALIENT_PEAK = 0.7;
export const SUBJECT_WARN = 0.6; // WARN_BELOW.subject in models.mjs

const WARNINGS = Object.freeze({
  band: 'it runs across the whole photo, like a horizon, sky or ground',
  competing: 'another part of the photo is about as likely to be the subject',
  partial: 'part of what stands out in the photo is left out',
  leak: 'it includes areas that do not stand out (probably background)',
  pieces: 'it is in several separate pieces',
  small: 'it is very small',
  outline: 'its outline is unsure',
  disagree: 'the saliency and outline models do not agree on it',
});

/** One sentence from warning codes (most important first), with what to do about it. */
export function subjectNote(warnings, { background = false } = {}) {
  if (!warnings.length) return null;
  const what = background ? 'The subject this background is cut around may be wrong' : 'This subject may be wrong';
  const why = warnings.slice(0, 2).map((code) => WARNINGS[code]).join(', and ');
  return `${what}: ${why}. Try the next candidate, refine it with Add and Subtract, or use Select Object.`;
}

/** Saliency (any range) normalised to 0–1. */
export function normaliseMap(map) {
  let lo = Infinity; let hi = -Infinity;
  for (let i = 0; i < map.length; i += 1) { if (map[i] < lo) lo = map[i]; if (map[i] > hi) hi = map[i]; }
  const span = hi - lo || 1;
  const out = new Float32Array(map.length);
  for (let i = 0; i < map.length; i += 1) out[i] = (map[i] - lo) / span;
  return out;
}

const boxIou = (a, b) => {
  const w = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const h = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = w * h;
  return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter || 1);
};

/**
 * SAM prompts from normalised saliency `s` at analysis size: each salient region (above 0.5 and
 * above 0.25) as a box and its most salient point, and the box around everything above 0.25.
 * Near-identical boxes are prompted once. At most `limit` prompts, largest first.
 */
export function subjectPrompts(s, width, height, { limit = 6 } = {}) {
  const n = width * height;
  const prompts = [];
  const add = (box, point, source) => {
    if (prompts.some((p) => boxIou(p.box, box) > 0.85)) return;
    prompts.push({ box, point, source, area: (box[2] - box[0]) * (box[3] - box[1]) });
  };
  let union = null;
  for (const threshold of [0.5, 0.25]) {
    const hard = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) hard[i] = s[i] > threshold ? 1 : 0;
    const { labels, stats } = components(hard, width, height, s);
    const found = stats.filter(Boolean);
    if (!found.length) continue; // eslint-disable-line no-continue
    const biggest = Math.max(...found.map((r) => r.area));
    const kept = found.filter((r) => r.area >= Math.max(0.15 * biggest, 0.002 * n)).sort((a, b) => b.area - a.area).slice(0, 4);
    for (const r of kept) {
      // The most salient pixel of the region (its centroid can fall outside a ring or an arch).
      let best = -1; let point = [r.cx, r.cy];
      for (let y = r.y0; y <= r.y1; y += 1) {
        for (let x = r.x0; x <= r.x1; x += 1) {
          const i = y * width + x;
          if (labels[i] === r.label && s[i] > best) { best = s[i]; point = [x, y]; }
        }
      }
      add([r.x0, r.y0, r.x1 + 1, r.y1 + 1], point, `region>${threshold}`);
    }
    if (threshold === 0.25) {
      union = [width, height, 0, 0];
      for (const r of found.filter((x) => x.area >= 0.002 * n)) union = [Math.min(union[0], r.x0), Math.min(union[1], r.y0), Math.max(union[2], r.x1 + 1), Math.max(union[3], r.y1 + 1)];
    }
  }
  if (union && union[2] > union[0]) {
    let best = -1; let point = null;
    for (let i = 0; i < n; i += 1) if (s[i] > best) { best = s[i]; point = [i % width, Math.floor(i / width)]; }
    add(union, point, 'all');
  }
  return prompts.sort((a, b) => b.area - a.area).slice(0, limit);
}

/** SAM's stability: the mask thresholded at logit +1 over the mask at −1 (1 = a crisp mask). */
export function stability(logits) {
  let hi = 0; let lo = 0;
  for (let i = 0; i < logits.length; i += 1) { if (logits[i] > 1) hi += 1; if (logits[i] > -1) lo += 1; }
  return lo ? hi / lo : 0;
}

/**
 * Evidence about one candidate (coverage 0–1 at analysis size) against normalised saliency `s`.
 */
export function candidateEvidence(coverage, s, width, height) {
  const n = width * height;
  const hard = new Uint8Array(n);
  let area = 0; let inside = 0; let total = 0;
  let left = false; let right = false; let top = false; let bottom = false;
  let x0 = width; let y0 = height; let x1 = -1; let y1 = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      total += s[i];
      if (coverage[i] < 0.5) continue; // eslint-disable-line no-continue
      hard[i] = 1; area += 1; inside += s[i];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x === 0) left = true; if (x === width - 1) right = true; if (y === 0) top = true; if (y === height - 1) bottom = true;
    }
  }
  if (!area) return { area: 0, precision: 0, recall: 0, pieces: 0, largest: 0, band: false, fill: 0 };
  const { stats } = components(hard, width, height);
  const sizes = stats.filter(Boolean).map((c) => c.area).sort((a, b) => b - a);
  const big = sizes.filter((a) => a >= 0.02 * area).length;
  const boxW = x1 - x0 + 1; const boxH = y1 - y0 + 1;
  // A band touches two opposite edges and is much longer than it is thick (in the mean).
  const band = (left && right && area / width < 0.45 * height) || (top && bottom && area / height < 0.45 * width);
  return {
    area: area / n,
    precision: inside / area,
    recall: total ? inside / total : 0,
    pieces: big,
    largest: sizes[0] / area,
    band,
    fill: area / (boxW * boxH),
    edges: [left, top, right, bottom].filter(Boolean).length,
  };
}

/**
 * How plausible a candidate is as the photo's subject (0–1, a heuristic). SAM's own quality and
 * stability, the saliency it agrees with (F-measure of saliency captured and saliency inside),
 * and shape penalties.
 */
export function plausibility(ev, { score, stable }) {
  if (!ev.area) return 0;
  const f = ev.precision + ev.recall ? (2 * ev.precision * ev.recall) / (ev.precision + ev.recall) : 0;
  let p = Math.min(1, score) * Math.min(1, stable / 0.9) * Math.min(1, f / 0.7);
  if (ev.band) p *= 0.35;
  if (ev.largest < 0.75) p *= 0.75;
  if (ev.area < 0.003) p *= 0.5;
  if (ev.area > 0.85) p *= 0.4;
  // Most of the photo, touching three or four edges: ground, foliage or a backdrop, not a subject.
  else if (ev.area > 0.4 && ev.edges >= 3) p *= 0.6;
  return Math.max(0, Math.min(1, p));
}

/**
 * The subject from scored candidates [{ coverage, score, stable }]. Option 0 is the automatic
 * answer: the most plausible candidate plus other distinct candidates about as salient (two birds,
 * two swans). Options 1… are the other distinct candidates alone, best first (Next candidate).
 * :returns: { options: [{ pick: [indices], confidence, warnings }], evidence } (options empty when none)
 */
export function rankSubjects(candidates, s, width, height, { peak = 1 } = {}) {
  const scored = candidates.map((c, k) => {
    const ev = candidateEvidence(c.coverage, s, width, height);
    return { k, ev, p: plausibility(ev, c) };
  }).filter((c) => c.ev.area > 0);
  if (!scored.length) return { options: [], evidence: null };
  scored.sort((a, b) => b.p - a.p);
  // Distinct answers only: a candidate much like a better one is the same answer.
  const distinct = [];
  for (const c of scored) {
    if (!distinct.some((d) => iou(candidates[d.k].coverage, candidates[c.k].coverage) > 0.85)) distinct.push(c);
  }
  // Share of the smaller candidate's area that the two have in common.
  const overlap = (a, b) => {
    const ca = candidates[a.k].coverage; const cb = candidates[b.k].coverage;
    let both = 0;
    for (let i = 0; i < ca.length; i += 1) if (ca[i] >= 0.5 && cb[i] >= 0.5) both += 1;
    const small = Math.min(a.ev.area, b.ev.area) * ca.length;
    return small ? both / small : 0;
  };
  const assess = (pick) => {
    const [best] = pick;
    const rival = distinct.find((c) => !pick.includes(c) && pick.every((p) => overlap(p, c) < 0.5));
    const warnings = [];
    let confidence = best.p;
    if (best.ev.band) warnings.push('band');
    if (rival && rival.p >= 0.85 * best.p) { warnings.push('competing'); confidence = Math.min(confidence, 0.55); }
    if (pick.reduce((sum, c) => sum + c.ev.recall, 0) < 0.45) { warnings.push('partial'); confidence *= 0.8; }
    if (best.ev.precision < 0.35) warnings.push('leak');
    if (best.ev.largest < 0.75) warnings.push('pieces');
    if (best.ev.area < 0.003) warnings.push('small');
    if (candidates[best.k].score < 0.7 || candidates[best.k].stable < 0.8) warnings.push('outline');
    // A weakly salient photo gives a weaker subject.
    confidence = Math.max(0, Math.min(1, confidence * Math.min(1, peak / 0.95)));
    // Only doubtful results carry warnings: a confident one is not second-guessed.
    if (confidence >= SUBJECT_WARN) return { pick: pick.map((c) => c.k), confidence, warnings: [] };
    return { pick: pick.map((c) => c.k), confidence, warnings: warnings.length ? warnings : ['disagree'] };
  };
  let [best] = distinct;
  // A salient part of a larger object: when SAM confidently outlines a whole that contains the
  // best candidate (a car around its tail light, a building around a tower), the whole is the
  // subject, as long as it is not most of the photo. The part stays as the next candidate.
  const whole = distinct.find((c) => c !== best && candidates[c.k].whole && candidates[c.k].score >= 0.85 && candidates[c.k].stable >= 0.85
    && c.ev.area >= 3 * best.ev.area && c.ev.area <= 0.6 && c.ev.edges <= 2 && !c.ev.band && overlap(best, c) >= 0.9);
  if (whole) { whole.p = Math.max(whole.p, best.p); distinct.splice(distinct.indexOf(whole), 1); distinct.unshift(whole); best = whole; }
  const pick = [best];
  for (const c of distinct.slice(1)) {
    if (c.p >= 0.8 * best.p && c.ev.precision >= 0.6 && !c.ev.band && pick.every((p) => overlap(p, c) < 0.1)) pick.push(c);
  }
  const options = [assess(pick), ...distinct.filter((c) => !pick.includes(c)).slice(0, 4).map((c) => assess([c]))];
  return { options, evidence: best.ev };
}
