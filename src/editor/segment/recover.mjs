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

const grow01 = (m, w, h, r) => { const b = boxMean(Float32Array.from(m), w, h, r); return Uint8Array.from(b, (v) => (v > 1e-7 ? 1 : 0)); };

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
  const wB = tri(bw); const mB = weighted(bw);
  const sq = new Float32Array(n);
  for (let i = 0; i < n; i += 1) sq[i] = (rgb[0][i] ** 2 + rgb[1][i] ** 2 + rgb[2][i] ** 2) * bw[i];
  const qB = tri(sq);
  // Distance from the local background in units of its spread.
  const z = new Float32Array(n);
  const B = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i += 1) {
    if (!region[i] || base[i] >= 0.5 || wB[i] < 1e-4) continue; // eslint-disable-line no-continue
    let d2 = 0; let m2 = 0;
    for (let c = 0; c < 3; c += 1) { B[c][i] = mB[c][i] / wB[i]; m2 += B[c][i] ** 2; d2 += (rgb[c][i] - B[c][i]) ** 2; }
    z[i] = Math.sqrt(d2) / (Math.sqrt(Math.max(0, qB[i] / wB[i] - m2)) + 0.02);
  }
  const core = Float32Array.from(z, (v) => (v > HI ? 1 : 0));
  const wF = tri(core); const mF = weighted(core);
  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    if (!z[i] || wF[i] < 1e-4) continue; // eslint-disable-line no-continue
    let num = 0; let den = 0;
    for (let c = 0; c < 3; c += 1) { const d = mF[c][i] / wF[i] - B[c][i]; num += (rgb[c][i] - B[c][i]) * d; den += d * d; }
    if (den < 1e-6) continue; // eslint-disable-line no-continue
    alpha[i] = Math.min(1, Math.max(0, num / den)) * sstep(LO, HI, z[i]);
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
