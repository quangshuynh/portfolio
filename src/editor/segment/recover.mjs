// Recover Detail (Interval 24.3, `recover/1`): thin parts a selection's 1024 px grid misses
// entirely (an antenna, a wing strut, a mirror stalk, a spoiler edge), added where the user
// paints over them, from the original pixels at refinement resolution (segment/refine.mjs).
//
// Inside a stroke, a pixel is structure when it is unlike the stroke's surroundings: the local
// background is the colour (mean and spread, triangle window) of the pixels in a ring just
// outside the stroke that are not already selected; the structure's colour is the mean of the
// clear outliers near it; coverage is the pixel's position between the two (simple matting, so
// edges and thin parts get partial coverage). Only parts connected to the selection, or spanning
// half the stroke (an antenna whose foot is hidden), are kept; specks are dropped; small enclosed
// holes (a highlight on a wing) are filled. Nothing is added outside the strokes, and where the
// structure does not stand out from its surroundings (a dark part at night, motion blur) nothing
// is added: the stroke is reported as not found and the Add brush is the fallback.
//
// Chosen on synthetic 24 MP scenes with exact alpha and real photos (docs/photography-editor.md,
// Recover Detail): an automatic search along the whole outline found ≈ 1 % of the missing parts
// and added more false pixels than true ones, so recovery is only ever where the user paints.
import { boxMean } from './analysis.mjs';

export const RECOVER_VERSION = 'recover/1';
const RING = 12; // px of surroundings sampled around a stroke
const WIN = 40; // px, window of the local colour statistics
const HI = 3; // spread units: clearly unlike the background
const LO = 1.5; // spread units: no evidence below this
const SPAN = 0.5; // a part not touching the selection is kept when it spans this share of its stroke
const FILL = 0.25; // enclosed holes up to this share of the recovered area are filled
const CHUNK = 512; // px of stroke per processing window (bounded memory)

const sstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/** A stroke ({ radius (short edges), points [[u, v, p]] }) in pixels of a W × H image. */
export const strokePixels = (stroke, W, H) => ({ r: stroke.radius * Math.min(W, H), points: stroke.points.map(([u, v]) => [u * W, v * H]) });

/** A stroke's polyline cut into pieces of at most `size` px extent (each with its own window). */
export function strokeChunks({ r, points }, size = CHUNK) {
  const pieces = [];
  let piece = [points[0]];
  let box = { x0: points[0][0], y0: points[0][1], x1: points[0][0], y1: points[0][1] };
  for (let k = 1; k < points.length; k += 1) {
    const [x, y] = points[k];
    const next = { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x), y1: Math.max(box.y1, y) };
    if (next.x1 - next.x0 > size || next.y1 - next.y0 > size) {
      pieces.push(piece);
      piece = [points[k - 1], points[k]];
      box = { x0: Math.min(points[k - 1][0], x), y0: Math.min(points[k - 1][1], y), x1: Math.max(points[k - 1][0], x), y1: Math.max(points[k - 1][1], y) };
    } else {
      piece.push(points[k]);
      box = next;
    }
  }
  pieces.push(piece);
  return pieces.map((pts) => ({ r, points: pts }));
}

/** Pixels of a window (x0, y0, w, h) within r of a polyline, and its length. */
export function strokeRegion({ r, points }, x0, y0, w, h) {
  const region = new Uint8Array(w * h);
  const pts = points.length === 1 ? [points[0], points[0]] : points;
  let length = 0;
  for (let k = 0; k + 1 < pts.length; k += 1) {
    const ax = pts[k][0] - x0; const ay = pts[k][1] - y0; const bx = pts[k + 1][0] - x0; const by = pts[k + 1][1] - y0;
    const dx = bx - ax; const dy = by - ay; const L2 = dx * dx + dy * dy;
    length += Math.sqrt(L2);
    const xa = Math.max(0, Math.floor(Math.min(ax, bx) - r)); const xb = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + r));
    const ya = Math.max(0, Math.floor(Math.min(ay, by) - r)); const yb = Math.min(h - 1, Math.ceil(Math.max(ay, by) + r));
    for (let y = ya; y <= yb; y += 1) {
      for (let x = xa; x <= xb; x += 1) {
        const t = L2 ? Math.min(1, Math.max(0, ((x + 0.5 - ax) * dx + (y + 0.5 - ay) * dy) / L2)) : 0;
        const ex = x + 0.5 - ax - t * dx; const ey = y + 0.5 - ay - t * dy;
        if (ex * ex + ey * ey <= r * r) region[y * w + x] = 1;
      }
    }
  }
  return { region, length };
}

const BLOCK = 32; // px, blocks sharing one background model
const NEAR = 40; // px around a block whose ring pixels form its background
const CLUSTERS = 4;

/** Up to CLUSTERS colour clusters of samples ([r, g, b] 0–1): k-means seeded at luminance quantiles (deterministic). */
export function colourClusters(samples) {
  const lum = (s) => 0.299 * s[0] + 0.587 * s[1] + 0.114 * s[2];
  const sorted = [...samples].sort((a, b) => lum(a) - lum(b));
  let means = Array.from({ length: CLUSTERS }, (_, k) => [...sorted[Math.floor(((k + 0.5) / CLUSTERS) * sorted.length)]]);
  let assign = new Int32Array(samples.length);
  for (let iter = 0; iter < 6; iter += 1) {
    const sums = means.map(() => [0, 0, 0, 0]);
    samples.forEach((s, j) => {
      let best = Infinity; let k = 0;
      means.forEach((m, q) => { const d = (s[0] - m[0]) ** 2 + (s[1] - m[1]) ** 2 + (s[2] - m[2]) ** 2; if (d < best) { best = d; k = q; } });
      assign[j] = k;
      sums[k][0] += s[0]; sums[k][1] += s[1]; sums[k][2] += s[2]; sums[k][3] += 1;
    });
    means = sums.map((s, k) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : means[k]));
  }
  const spread = means.map(() => [0, 0]);
  samples.forEach((s, j) => { const m = means[assign[j]]; spread[assign[j]][0] += (s[0] - m[0]) ** 2 + (s[1] - m[1]) ** 2 + (s[2] - m[2]) ** 2; spread[assign[j]][1] += 1; });
  assign = null;
  // Clusters of a few samples (noise, a stray structure pixel in the ring) are not background.
  return means.map((mean, k) => ({ mean, spread: Math.sqrt(spread[k][0] / Math.max(1, spread[k][1])), count: spread[k][1] }))
    .filter((k) => k.count >= Math.max(4, 0.03 * samples.length));
}

const grow01 =(m, w, h, r) => { const b = boxMean(Float32Array.from(m), w, h, r); return Uint8Array.from(b, (v) => (v > 1e-7 ? 1 : 0)); };

/**
 * Structure found in `region` of a window, over the coverage there.
 * :param base: Float32 coverage of the window (the refined selection), 0–1
 * :param rgb: three Float32 0–1 channel planes of the window
 * :returns: { coverage (Float32, max of base and what was found), added (px newly ≥ 0.5) }
 */
export function recoverWindow(base, rgb, w, h, region, length) {
  const n = w * h;
  const around = grow01(region, w, h, RING);
  const bw = new Float32Array(n);
  for (let i = 0; i < n; i += 1) if (around[i] && !region[i] && base[i] < 0.02) bw[i] = 1;
  const r2 = WIN >> 1;
  const tri = (a) => boxMean(boxMean(a, w, h, r2), w, h, r2);
  const weighted = (wgt) => rgb.map((ch) => { const o = new Float32Array(n); for (let i = 0; i < n; i += 1) o[i] = ch[i] * wgt[i]; return tri(o); });
  // Local background: the ring pixels near each block, as up to K colour clusters. A pixel's
  // distance is to its nearest cluster, in units of that cluster's spread, so a sky, a white trim
  // and a brown wall around a stroke each count as background, and an antenna unlike all of them
  // does not (one mean and spread over them all made the antenna look like background).
  const z = new Float32Array(n);
  const B = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let by = 0; by < h; by += BLOCK) {
    for (let bx = 0; bx < w; bx += BLOCK) {
      const bx1 = Math.min(w, bx + BLOCK); const by1 = Math.min(h, by + BLOCK);
      let wanted = false;
      for (let y = by; y < by1 && !wanted; y += 1) for (let x = bx; x < bx1; x += 1) if (region[y * w + x] && base[y * w + x] < 0.5) { wanted = true; break; }
      if (!wanted) continue; // eslint-disable-line no-continue
      const samples = [];
      for (let y = Math.max(0, by - NEAR); y < Math.min(h, by1 + NEAR); y += 2) {
        for (let x = Math.max(0, bx - NEAR); x < Math.min(w, bx1 + NEAR); x += 2) {
          const i = y * w + x;
          if (bw[i]) samples.push([rgb[0][i], rgb[1][i], rgb[2][i]]);
        }
      }
      if (samples.length < 8) continue; // eslint-disable-line no-continue
      const clusters = colourClusters(samples);
      if (!clusters.length) continue; // eslint-disable-line no-continue
      for (let y = by; y < by1; y += 1) {
        for (let x = bx; x < bx1; x += 1) {
          const i = y * w + x;
          if (!region[i] || base[i] >= 0.5) continue; // eslint-disable-line no-continue
          let best = Infinity; let pick = null;
          for (const k of clusters) {
            const d = Math.sqrt((rgb[0][i] - k.mean[0]) ** 2 + (rgb[1][i] - k.mean[1]) ** 2 + (rgb[2][i] - k.mean[2]) ** 2) / (k.spread + 0.02);
            if (d < best) { best = d; pick = k; }
          }
          z[i] = best;
          for (let c = 0; c < 3; c += 1) B[c][i] = pick.mean[c];
        }
      }
    }
  }
  // The part's colour: the clear outliers near a pixel, else those of the whole stroke (an antenna
  // crossing a dark window keeps the colour found where it crosses the sky).
  const core = Float32Array.from(z, (v) => (v > HI ? 1 : 0));
  const wF = tri(core); const mF = weighted(core);
  const whole = [0, 0, 0]; let cores = 0;
  for (let i = 0; i < n; i += 1) if (core[i]) { cores += 1; for (let c = 0; c < 3; c += 1) whole[c] += rgb[c][i]; }
  const alpha = new Float32Array(n);
  if (!cores) return { coverage: Float32Array.from(base), added: 0 };
  for (let c = 0; c < 3; c += 1) whole[c] /= cores;
  for (let i = 0; i < n; i += 1) {
    if (!region[i] || base[i] >= 0.5 || !z[i]) continue; // eslint-disable-line no-continue
    const local = wF[i] > 0.002;
    const F = [0, 1, 2].map((c) => (local ? mF[c][i] / wF[i] : whole[c]));
    let num = 0; let den = 0; let dF = 0; let dB = 0;
    for (let c = 0; c < 3; c += 1) {
      const d = F[c] - B[c][i];
      num += (rgb[c][i] - B[c][i]) * d; den += d * d;
      dF += (rgb[c][i] - F[c]) ** 2; dB += (rgb[c][i] - B[c][i]) ** 2;
    }
    if (den < 1e-6) continue; // eslint-disable-line no-continue
    // Structure: closer to the part's colour than to the nearest background colour, and clearly
    // unlike that background (in its own spread, or by an absolute step for flat backgrounds).
    const evidence = Math.max(sstep(LO, HI, z[i]), sstep(0.04, 0.1, Math.sqrt(dB)));
    alpha[i] = dF < dB ? Math.min(1, Math.max(0, num / den)) * evidence : 0;
  }
  // Parts (8-connected, coverage ≥ 0.5): kept when touching the selection or spanning the stroke.
  const fgNear = grow01(Uint8Array.from(base, (v) => (v >= 0.5 ? 1 : 0)), w, h, 2);
  const label = new Int32Array(n);
  const keep = [0];
  const stack = new Int32Array(n);
  let next = 1;
  for (let s = 0; s < n; s += 1) {
    if (alpha[s] < 0.5 || label[s]) continue; // eslint-disable-line no-continue
    label[s] = next;
    let top = 0; stack[top++] = s;
    let touches = false; let x0 = w; let x1 = 0; let y0 = h; let y1 = 0;
    while (top) {
      const i = stack[--top]; const x = i % w; const y = (i / w) | 0;
      if (fgNear[i]) touches = true;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; // eslint-disable-line curly
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = x + dx; const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; // eslint-disable-line no-continue
          const j = yy * w + xx;
          if (alpha[j] >= 0.5 && !label[j]) { label[j] = next; stack[top++] = j; }
        }
      }
    }
    keep.push(touches || Math.hypot(x1 - x0, y1 - y0) >= SPAN * length ? 1 : 0);
    next += 1;
  }
  const kept = Uint8Array.from(label, (l) => (l && keep[l] ? 1 : 0));
  let keptArea = 0;
  for (let i = 0; i < n; i += 1) keptArea += kept[i];
  // Enclosed holes (4-connected, inside the stroke, not reaching the window edge) up to a share of the area.
  const seen = new Uint8Array(n);
  for (let s = 0; s < n && keptArea; s += 1) {
    if (kept[s] || seen[s] || base[s] >= 0.5 || !region[s]) continue; // eslint-disable-line no-continue
    const comp = []; let open = false; let top = 0; stack[top++] = s; seen[s] = 1;
    while (top) {
      const i = stack[--top]; comp.push(i);
      const x = i % w;
      if (!region[i] || x === 0 || x === w - 1 || i < w || i >= n - w) open = true;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j >= 0 && j < n && !seen[j] && !kept[j] && base[j] < 0.5) { seen[j] = 1; stack[top++] = j; }
      }
    }
    if (!open && comp.length <= FILL * keptArea) for (const i of comp) { kept[i] = 1; alpha[i] = 1; }
  }
  // The soft fringe within 2 px of kept parts; nothing else.
  const near = grow01(kept, w, h, 2);
  const coverage = Float32Array.from(base);
  let added = 0;
  for (let i = 0; i < n; i += 1) {
    if (!near[i] || !region[i] || alpha[i] <= coverage[i]) continue; // eslint-disable-line no-continue
    if (alpha[i] >= 0.5 && base[i] < 0.5) added += 1;
    coverage[i] = alpha[i];
  }
  return { coverage, added };
}

/** The halo a stroke's window needs around the stroke (px). */
export const recoverHalo = (r) => Math.ceil(r + RING + WIN + 4);
