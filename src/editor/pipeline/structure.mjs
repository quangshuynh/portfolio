// Structure guidance for the Remove fill (pipeline/inpaint.mjs). Finds straight or gently curved
// edges (lane lines, rails, roof lines, kerbs, wires) that run into the hole, pairs an end on one
// side with an end on the other only when their directions, positions and colour profiles agree
// (a straight line, or a circular arc), and returns guides: the structure's path through the
// hole. Inpaint adds a channel marking each guide to the patch features, so the fill along a
// structure is rebuilt from patches of that same structure, aligned with both of its ends. An
// end without a matching partner gets no guide; with no guide the fill is exactly the unguided
// one. Deterministic, environment-free.

// Detection works where the hole is at most this many pixels across (a pyramid level).
export const DETECT_EXTENT = 320;
const THETA_BINS = 120;
const MAX_PEAKS = 32;
const MAX_GUIDES = 6;
const MIN_CONFIDENCE = 0.45;
const MAX_PARALLEL = 3;

const PARALLEL = (6 * Math.PI) / 180;

// A pair's tangents may turn at most this far from the chord between its ends (a gentle curve).
const MAX_BEND = (20 * Math.PI) / 180;
// Guide channel: within GUIDE_BAND level pixels of a guide, its signed distance scaled to
// ±GUIDE_WEIGHT (which side of the structure, how far); GUIDE_OFF everywhere else.
export const GUIDE_WEIGHT = 0.5;
export const GUIDE_OFF = 3 * GUIDE_WEIGHT;
const GUIDE_BAND = 6;

/** Chamfer distance (pixels) to the nearest hole pixel, over the box { x0, y0, x1, y1 } (inclusive). */
function holeDistance(level, box) {
  const width = box.x1 - box.x0 + 1; const height = box.y1 - box.y0 + 1;
  const d = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) d[y * width + x] = level.hole[(y + box.y0) * level.width + x + box.x0] ? 0 : Infinity;
  const relax = (i, j, w) => { if (d[j] + w < d[i]) d[i] = d[j] + w; };
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const i = y * width + x;
    if (x > 0) relax(i, i - 1, 1);
    if (y > 0) { relax(i, i - width, 1); if (x > 0) relax(i, i - width - 1, Math.SQRT2); if (x < width - 1) relax(i, i - width + 1, Math.SQRT2); }
  }
  for (let y = height - 1; y >= 0; y -= 1) for (let x = width - 1; x >= 0; x -= 1) {
    const i = y * width + x;
    if (x < width - 1) relax(i, i + 1, 1);
    if (y < height - 1) { relax(i, i + width, 1); if (x < width - 1) relax(i, i + width + 1, Math.SQRT2); if (x > 0) relax(i, i + width - 1, Math.SQRT2); }
  }
  return d;
}

/**
 * Colour structure tensor at (x, y) from Sobel gradients of r, g and b (Di Zenzo), so an edge
 * between two colours of equal brightness (a grey rail against green leaves) still counts.
 * :returns: [jxx, jxy, jyy]
 */
function colourTensor({ width, height, color }, x, y) {
  let jxx = 0; let jxy = 0; let jyy = 0;
  const left = Math.max(0, x - 1) * 3; const right = Math.min(width - 1, x + 1) * 3; const mid = x * 3;
  const up = Math.max(0, y - 1) * width * 3; const down = Math.min(height - 1, y + 1) * width * 3; const row = y * width * 3;
  for (let k = 0; k < 3; k += 1) {
    const gx = (color[up + right + k] + 2 * color[row + right + k] + color[down + right + k] - color[up + left + k] - 2 * color[row + left + k] - color[down + left + k]) / 8;
    const gy = (color[down + left + k] + 2 * color[down + mid + k] + color[down + right + k] - color[up + left + k] - 2 * color[up + mid + k] - color[up + right + k]) / 8;
    jxx += gx * gx; jxy += gx * gy; jyy += gy * gy;
  }
  return [jxx, jxy, jyy];

}
/** Edge strength (root of the larger eigenvalue) and normal angle (mod π) of a tensor. */
function edgeOf([a, b, c]) {
  return [Math.sqrt(Math.max(0, (a + c) / 2 + Math.hypot((a - c) / 2, b))), 0.5 * Math.atan2(2 * b, a - c)];
}

/** Least-squares line through points [x, y, …]: { cx, cy, dx, dy }, direction along `along`. */
function fitLine(points, along) {
  let cx = 0; let cy = 0;
  for (const [x, y] of points) { cx += x; cy += y; }
  cx /= points.length; cy /= points.length;
  let sxx = 0; let sxy = 0; let syy = 0;
  for (const [x, y] of points) { sxx += (x - cx) ** 2; sxy += (x - cx) * (y - cy); syy += (y - cy) ** 2; }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let dx = Math.cos(angle); let dy = Math.sin(angle);
  if (dx * along[0] + dy * along[1] < 0) { dx = -dx; dy = -dy; }
  return { cx, cy, dx, dy };
}

/** Do segments a–b and c–d cross? */
function crosses([a, b], [c, d]) {
  const side = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b);
}

/**
 * Structures crossing the hole of a pyramid level ({ width, height, color, hole, allowed, bounds }).
 * :returns: guides [{ path: [[x, y], …] (level pixels, along the whole structure), hole: [a, b]
 *   (where it enters and leaves the hole), confidence }], strongest first; [] when unsure
 */
export function findStructures(level) {
  const { width, height, allowed, bounds } = level;
  const extent = Math.max(bounds.x1 - bounds.x0 + 1, bounds.y1 - bounds.y0 + 1);
  if (extent < 6) return [];
  // Distances only near the hole: the guard band and the ring lie well within this margin.
  const margin = Math.ceil(0.25 * extent) + 48;
  const near = { x0: Math.max(0, bounds.x0 - margin), y0: Math.max(0, bounds.y0 - margin), x1: Math.min(width - 1, bounds.x1 + margin), y1: Math.min(height - 1, bounds.y1 + margin) };
  const nearWidth = near.x1 - near.x0 + 1;
  const dist = holeDistance(level, near);
  const distanceAt = (i) => {
    const x = i % width - near.x0; const y = Math.floor(i / width) - near.y0;
    return x < 0 || y < 0 || x >= nearWidth || y > near.y1 - near.y0 ? Infinity : dist[y * nearWidth + x];
  };
  let guard = Infinity;
  for (let y = near.y0; y <= near.y1; y += 1) for (let x = near.x0; x <= near.x1; x += 1) {
    const d = dist[(y - near.y0) * nearWidth + x - near.x0];
    if (allowed[y * width + x] && d < guard) guard = d;
  }
  if (guard === Infinity) return [];
  const ringWidth = Math.min(40, Math.max(6, Math.round(0.45 * extent)));
  const reach = guard + ringWidth;
  const inRing = (i) => allowed[i] === 1 && distanceAt(i) <= reach;
  const x0 = Math.max(1, Math.floor(bounds.x0 - reach - 2)); const y0 = Math.max(1, Math.floor(bounds.y0 - reach - 2));
  const x1 = Math.min(width - 2, Math.ceil(bounds.x1 + reach + 2)); const y1 = Math.min(height - 2, Math.ceil(bounds.y1 + reach + 2));

  // Edge pixels of the ring: strong, coherent (5×5 tensor) and the local maximum across the edge.
  const bw = x1 - x0 + 1; const bh = y1 - y0 + 1;
  const tensor = new Float32Array(bw * bh * 3);
  const strength = new Float32Array(bw * bh);
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
    if (!allowed[y * width + x]) continue; // eslint-disable-line no-continue
    const k = (y - y0) * bw + x - x0;
    const t = colourTensor(level, x, y);
    tensor.set(t, k * 3);
    [strength[k]] = edgeOf(t);
  }
  // The tensor summed over 5×5 neighbourhoods (separable running sums).
  const rows = new Float32Array(bw * bh * 3);
  const sums = new Float32Array(bw * bh * 3);
  for (let by = 0; by < bh; by += 1) for (let bx = 0; bx < bw; bx += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const j = (by * bw + Math.min(bw - 1, Math.max(0, bx + dx))) * 3;
      const k = (by * bw + bx) * 3;
      rows[k] += tensor[j]; rows[k + 1] += tensor[j + 1]; rows[k + 2] += tensor[j + 2];
    }
  }
  for (let by = 0; by < bh; by += 1) for (let bx = 0; bx < bw; bx += 1) {
    for (let dy = -2; dy <= 2; dy += 1) {
      const j = (Math.min(bh - 1, Math.max(0, by + dy)) * bw + bx) * 3;
      const k = (by * bw + bx) * 3;
      sums[k] += rows[j]; sums[k + 1] += rows[j + 1]; sums[k + 2] += rows[j + 2];
    }
  }
  const strengthAt = (bx, by) => (bx < 0 || by < 0 || bx >= bw || by >= bh ? 0 : strength[by * bw + bx]);
  const magnitudes = new Float32Array(bw * bh);
  let count = 0;
  const edges = [];
  for (let y = y0 + 1; y < y1; y += 1) for (let x = x0 + 1; x < x1; x += 1) {
    if (!inRing(y * width + x)) continue; // eslint-disable-line no-continue
    const bx = x - x0; const by = y - y0; const k = by * bw + bx;
    const m = strength[k];
    magnitudes[count] = m; count += 1;
    const sum = [sums[k * 3], sums[k * 3 + 1], sums[k * 3 + 2]];
    const coherence
 = Math.hypot(sum[0] - sum[2], 2 * sum[1]) / (sum[0] + sum[2] + 1e-12);
    // The normal from the smoothed tensor (robust on stair-stepped edges); the pixel's own for
    // non-maximum suppression.
    const [, phi] = edgeOf(sum);
    const [, own] = edgeOf([tensor[k * 3], tensor[k * 3 + 1], tensor[k * 3 + 2]]);
    const sx = Math.round(Math.cos(own)); const sy = Math.round(Math.sin(own));
    if (coherence > 0.6 && m >= strengthAt(bx + sx, by + sy) && m >= strengthAt(bx - sx, by - sy)) edges.push({ x, y, m, phi });
  }
  if (!count) return [];
  const threshold = Math.max(0.02, 2 * magnitudes.subarray(0, count).sort()[count >> 1]);

  const strong = edges.filter((e) => e.m > threshold);
  if (strong.length < 8) return [];

  // Hough transform about the hole's centre; each edge votes near its own normal direction.
  const cx = (bounds.x0 + bounds.x1) / 2; const cy = (bounds.y0 + bounds.y1) / 2;
  const rhoMax = Math.ceil(Math.hypot(bw, bh));
  const rhoBins = 2 * rhoMax + 1;
  const votes = new Float32Array(THETA_BINS * rhoBins);
  for (const e of strong) {
    const t0 = Math.round(((((e.phi % Math.PI) + Math.PI) % Math.PI) / Math.PI) * THETA_BINS);
    for (let k = -2; k <= 2; k += 1) {
      const t = (((t0 + k) % THETA_BINS) + THETA_BINS) % THETA_BINS;
      const theta = (t / THETA_BINS) * Math.PI;
      const rho = Math.round((e.x - cx) * Math.cos(theta) + (e.y - cy) * Math.sin(theta)) + rhoMax;
      votes[t * rhoBins + rho] += Math.min(e.m, 3 * threshold);
    }
  }
  const minVotes = 0.5 * ringWidth * threshold;
  const context = { strong, threshold, inRing, ringWidth, reach, guard, cx, cy, limit: Math.hypot(bw, bh) / 2 + 2 };
  const segments = [];
  for (let attempt = 0; attempt < MAX_PEAKS; attempt += 1) {
    let best = -1; let bestVotes = minVotes;
    for (let k = 0; k < votes.length; k += 1) if (votes[k] > bestVotes) { bestVotes = votes[k]; best = k; }
    if (best < 0) break;
    const t = Math.floor(best / rhoBins); const r = (best % rhoBins) - rhoMax;
    for (let dt = -4; dt <= 4; dt += 1) for (let dr = -3; dr <= 3; dr += 1) {
      const tt = (((t + dt) % THETA_BINS) + THETA_BINS) % THETA_BINS;
      // Wrapping past θ = π flips the sign of ρ.
      const rr = (t + dt < 0 || t + dt >= THETA_BINS ? -r : r) + dr + rhoMax;
      if (rr >= 0 && rr < rhoBins) votes[tt * rhoBins + rr] = 0;
    }
    for (const s of segmentsOn(level, (t / THETA_BINS) * Math.PI, r, context)) {
      // One end found twice (by neighbouring peaks): keep the better covered.
      const twin = segments.findIndex((o) => Math.hypot(o.end[0] - s.end[0], o.end[1] - s.end[1]) < 2 && o.dir[0] * s.dir[0] + o.dir[1] * s.dir[1] > 0.97);
      if (twin < 0) segments.push(s); else if (segments[twin].coverage < s.coverage) segments[twin] = s;
    }
  }

  const candidates = [];

  for (let i = 0; i < segments.length; i += 1) for (let j = i + 1; j < segments.length; j += 1) {
    const pair = pairUp(level, segments[i], segments[j]);
    if (pair) candidates.push(pair);
  }
  // Strongest first, each end used once; a guide crossing another is kept only when both are
  // confident, and never more than one crossing.
  candidates.sort((a, b) => b.confidence - a.confidence);
  const guides = [];
  const used = new Set();
  for (const c of candidates) {
    if (guides.length >= MAX_GUIDES) break;
    if (used.has(c.ends[0]) || used.has(c.ends[1])) continue; // eslint-disable-line no-continue
    const crossing = guides.filter((g) => crosses(g.hole, c.hole));
    if (crossing.length && (c.confidence < 0.7 || crossing.some((g) => g.confidence < 0.7) || crossing.length > 1 || guides.some((g) => g.crossed))) continue; // eslint-disable-line no-continue
    if (crossing.length) { c.crossed = true; crossing[0].crossed = true; }
    used.add(c.ends[0]); used.add(c.ends[1]);
    c.path = [...extend(level, c.ends[0], threshold, reach).reverse(), ...c.path, ...extend(level, c.ends[1], threshold, reach)];
    guides.push(c);
  }
  // Several parallel structures among many other edges are a repeating texture (brick courses
  // and their joints, tile grout), which patch matching continues well on its own; guiding
  // them only narrows the sources. No guidance then. (Parallel wires on open sky keep it.)
  const direction = (g) => Math.atan2(g.hole[1][1] - g.hole[0][1], g.hole[1][0] - g.hole[0][0]);
  const parallel = (g, h) => Math.abs(Math.sin(direction(g) - direction(h))) < Math.sin(PARALLEL);
  const explained = guides.reduce((sum, g) => sum + g.ends[0].points.length + g.ends[1].points.length, 0);
  if (guides.some((g) => guides.filter((h) => parallel(g, h)).length >= MAX_PARALLEL) && explained < 0.5 * strong.length) return [];
  return guides.map(({ path, hole, confidence }) => ({ path, hole, confidence }));
}

/**
 * The ends of one Hough line where it runs into the hole: on each side of every stretch of hole
 * along the line, the edge pixels supporting it within the ring.
 * :returns: [{ points, end: [x, y] (nearest the hole, on the fitted line), dir (unit, into the
 *   hole), coverage (share of the ring stretch with edge support), profile }]
 */
function segmentsOn(level, theta, rho, { strong, threshold, inRing, reach, guard, cx, cy, limit }) {
  const { width, height, hole } = level;
  const n = [Math.cos(theta), Math.sin(theta)];
  const u = [-n[1], n[0]];
  const ox = cx + rho * n[0]; const oy = cy + rho * n[1];

  const samples = [];
  for (let t = -limit; t <= limit; t += 0.5) {
    const x = Math.round(ox + t * u[0]); const y = Math.round(oy + t * u[1]);
    if (x < 0 || y < 0 || x >= width || y >= height) continue; // eslint-disable-line no-continue
    const i = y * width + x;
    samples.push({ t, hole: hole[i] === 1, ring: !hole[i] && inRing(i) });
  }
  const runs = [];
  for (const s of samples) {
    if (!s.hole) continue; // eslint-disable-line no-continue
    const last = runs.at(-1);
    if (last && s.t - last[1] <= 1) last[1] = s.t; else runs.push([s.t, s.t]);
  }
  if (!runs.length) return [];
  const support = [];
  for (const e of strong) {
    if (Math.abs((e.x - ox) * n[0] + (e.y - oy) * n[1]) > 2) continue; // eslint-disable-line no-continue
    const dphi = Math.abs((((e.phi - theta) % Math.PI) + Math.PI * 1.5) % Math.PI - Math.PI / 2);
    if (dphi > (8 * Math.PI) / 180) continue; // eslint-disable-line no-continue
    support.push([e.x, e.y, (e.x - ox) * u[0] + (e.y - oy) * u[1]]);
  }
  const out = [];
  for (const [h0, h1] of runs) {
    for (const sign of [-1, 1]) {
      // The stretch of line from the hole outwards to the edge of the ring.
      const from = sign < 0 ? h0 - reach - 2 : h1;
      const to = sign < 0 ? h0 : h1 + reach + 2;
      const ringLength = samples.filter((s) => s.ring && s.t > from && s.t < to).length / 2;
      const points = support.filter(([, , t]) => t > from && t < to);
      if (ringLength < 3 || points.length < 4) continue; // eslint-disable-line no-continue
      const coverage = Math.min(1, new Set(points.map(([, , t]) => Math.floor(t))).size / ringLength);
      const nearest = points.reduce((a, b) => (sign < 0 ? (b[2] > a[2] ? b : a) : (b[2] < a[2] ? b : a)));
      // The edge must reach the hole (past the guard band), not stop short of it.
      if (Math.abs(nearest[2] - (sign < 0 ? h0 : h1)) > guard + Math.max(3, 0.35 * ringLength)) continue; // eslint-disable-line no-continue
      const dir = sign < 0 ? u : [-u[0], -u[1]];
      const line = fitLine(points, dir);
      const along = (nearest[0] - line.cx) * line.dx + (nearest[1] - line.cy) * line.dy;
      const end = [line.cx + along * line.dx, line.cy + along * line.dy];
      out.push({ points, end, dir: [line.dx, line.dy], coverage, threshold, profile: profileOf(level, points, [line.dx, line.dy]) });
    }
  }
  return out;
}

// Colour samples across an edge, either side of it (also both sides of a thin line).
const OFFSETS = [-3, -1, 1, 3];
function profileOf({ width, height, color, allowed }, points, dir) {
  const normal = [-dir[1], dir[0]];
  return OFFSETS.map((o) => {
    const sum = [0, 0, 0]; let count = 0;
    for (const [x, y] of points) {
      const sx = Math.round(x + o * normal[0]); const sy = Math.round(y + o * normal[1]);
      if (sx < 0 || sy < 0 || sx >= width || sy >= height || !allowed[sy * width + sx]) continue; // eslint-disable-line no-continue
      const i = (sy * width + sx) * 3;
      sum[0] += color[i]; sum[1] += color[i + 1]; sum[2] += color[i + 2]; count += 1;
    }
    return count ? sum.map((v) => v / count) : null;
  });
}

/**
 * Two ends of one structure? Their tangents must point at each other: a straight line (both
 * along the chord between the ends) or a circular arc (turning equally and oppositely from the
 * chord, at most MAX_BEND), with the same colour profile across the edge. Null when not.
 */
function pairUp(level, a, b) {
  const chord = [b.end[0] - a.end[0], b.end[1] - a.end[1]];
  const length = Math.hypot(...chord);
  if (length < 2) return null;
  const c = [chord[0] / length, chord[1] / length];
  // Travel from a to b: along a's direction into the hole, leaving along the reverse of b's.
  const ta = a.dir; const tb = [-b.dir[0], -b.dir[1]];
  const angle = (t) => Math.atan2(c[0] * t[1] - c[1] * t[0], c[0] * t[0] + c[1] * t[1]);
  const alphaA = angle(ta); const alphaB = angle(tb);
  if (Math.abs(alphaA) > MAX_BEND || Math.abs(alphaB) > MAX_BEND) return null;
  // On an arc alphaB = −alphaA; equal signs mean the ends are offset sideways.
  const asymmetry = Math.abs(alphaA + alphaB);
  const maxAsymmetry = 2 * Math.max(1.5 / length, 0.05);
  if (asymmetry > maxAsymmetry) return null;
  const bend = Math.max(Math.abs(alphaA), Math.abs(alphaB));
  // Profiles: b's runs the other way across the edge.
  const pa = a.profile; const pb = [...b.profile].reverse();
  if ([...pa, ...pb].some((p) => !p)) return null;
  const mean = (p) => [0, 1, 2].map((k) => p.reduce((sum, v) => sum + v[k], 0) / p.length);
  const ma = mean(pa); const mb = mean(pb);
  const diff = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const contrast = Math.max(...[pa, pb].flatMap((p) => p.map((v, k) => diff(v, p[(k + 1) % p.length]))));
  const shift = diff(ma, mb);
  let mismatch = 0;
  for (let k = 0; k < OFFSETS.length; k += 1) {
    mismatch = Math.max(mismatch, diff(pa[k].map((v, i) => v - ma[i]), pb[k].map((v, i) => v - mb[i])));
  }
  const maxMismatch = 0.05 + 0.3 * contrast;
  let agreement = (1 - mismatch / maxMismatch) * (1 - shift);

  if (mismatch > maxMismatch || shift > 0.2) {
    // A line crossing from one background into another (a pole across a kerb): the line's own
    // colour the same at one sample at least, and a profile of the same shape though not the
    // same contrast.
    const same = Math.min(...pa.map((v, k) => diff(v, pb[k])));
    const centred = (p, m) => p.flatMap((v) => v.map((x, k) => x - m[k]));
    const ca = centred(pa, ma); const cb = centred(pb, mb);
    const dot = ca.reduce((sum, v, k) => sum + v * cb[k], 0);
    const correlation = dot / (Math.hypot(...ca) * Math.hypot(...cb) + 1e-9);
    if (correlation < 0.85 || same > 0.08 || Math.min(Math.hypot(...ca), Math.hypot(...cb)) < 0.06) return null;

    agreement = (correlation - 0.85) / 0.15;
  }
  const coverage = Math.min(a.coverage, b.coverage);
  if (coverage < 0.45) return null;
  const confidence = coverage * (1 - 0.4 * asymmetry / maxAsymmetry) * (1 - 0.3 * bend / MAX_BEND) * (0.6 + 0.4 * agreement);


  if (confidence < MIN_CONFIDENCE) return null;
  return { ends: [a, b], hole: [a.end, b.end], path: hermite(a.end, ta, b.end, tb, length), confidence };
}

/** The curve through the hole: a cubic Hermite from one end to the other along both tangents. */
function hermite(pa, ta, pb, tb, length) {
  const out = [];
  const steps = Math.max(2, Math.ceil(length));
  for (let k = 0; k <= steps; k += 1) {
    const s = k / steps; const s2 = s * s; const s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1; const h10 = s3 - 2 * s2 + s; const h01 = -2 * s3 + 3 * s2; const h11 = s3 - s2;
    out.push([0, 1].map((i) => h00 * pa[i] + h10 * ta[i] * length + h01 * pb[i] + h11 * tb[i] * length));
  }
  return out;
}

/**
 * The structure's known part beyond one end: outwards from the end (against its direction into
 * the hole), 1 px steps, as long as the photo still shows an edge there in that direction; gaps
 * up to MAX_GAP pixels (another structure crossing it) are bridged.
 */
const MAX_GAP = 10;
const EXTEND = 1.5;
function extend(level, segment, threshold, reach) {
  const { width, height, hole } = level;
  const [dx, dy] = segment.dir;
  const out = [];
  let misses = 0;
  for (let step = 1; misses < MAX_GAP && step <= EXTEND * reach; step += 1) {

    const x = segment.end[0] - dx * step; const y = segment.end[1] - dy * step;
    if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) break;
    let found = false;
    for (let k = -1; k <= 1 && !found; k += 1) {
      const qx = Math.round(x - k * dy); const qy = Math.round(y + k * dx);
      if (hole[qy * width + qx]) continue; // eslint-disable-line no-continue
      const [m, phi] = edgeOf(colourTensor(level, qx, qy));
      // The edge's normal is across the structure: perpendicular to its direction.
      if (m > 0.6 * threshold && Math.abs(Math.cos(phi) * dx + Math.sin(phi) * dy) < 0.3) found = true;
    }
    misses = found ? 0 : misses + 1;
    out.push([x, y]);
  }
  return out.slice(0, Math.max(0, out.length - misses));
}

/**
 * The guide channel of a level: inside the band around a guide, GUIDE_WEIGHT × its signed
 * distance / band (nearest guide); GUIDE_OFF outside. The band is GUIDE_BAND pixels of the full
 * photo, so it narrows on coarser levels (`depth` below full size). Guide points are in the
 * detection level's pixels; `scale` maps them to this level (2 per level finer).
 */
export function drawGuides({ width, height }, guides, scale, depth = 0) {
  const d2 = new Float32Array(width * height).fill(Infinity);
  const channel = new Float32Array(width * height).fill(GUIDE_OFF);
  const band = Math.max(1.5, GUIDE_BAND / 2 ** depth);
  const radius = Math.ceil(band);
  for (const { path } of guides) {
    for (let k = 0; k + 1 < path.length; k += 1) {
      const [ax, ay] = path[k].map((v) => (v + 0.5) * scale - 0.5);
      const [bx, by] = path[k + 1].map((v) => (v + 0.5) * scale - 0.5);
      const length = Math.hypot(bx - ax, by - ay);
      if (length < 1e-6) continue; // eslint-disable-line no-continue
      const ux = (bx - ax) / length; const uy = (by - ay) / length;
      for (let y = Math.max(0, Math.floor(Math.min(ay, by) - radius)); y <= Math.min(height - 1, Math.ceil(Math.max(ay, by) + radius)); y += 1) {
        for (let x = Math.max(0, Math.floor(Math.min(ax, bx) - radius)); x <= Math.min(width - 1, Math.ceil(Math.max(ax, bx) + radius)); x += 1) {
          // Distance to this piece of the path; the side from its direction.
          const t = Math.max(0, Math.min(length, (x - ax) * ux + (y - ay) * uy));
          const d = (x - ax - t * ux) ** 2 + (y - ay - t * uy) ** 2;
          const i = y * width + x;
          if (d >= d2[i] || d > band * band) continue; // eslint-disable-line no-continue
          d2[i] = d;
          const side = (x - ax) * uy - (y - ay) * ux;
          channel[i] = GUIDE_WEIGHT * Math.sign(side) * Math.sqrt(d) / band;

        }
      }
    }
  }
  return channel;
}
