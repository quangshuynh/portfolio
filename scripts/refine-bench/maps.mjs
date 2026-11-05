// Helpers of the edge-refinement benchmark: the stored grid sampled at a resolution as the editor
// samples it, contour bands, morphology and the scores.
import { boxMean } from '../../src/editor/segment/analysis.mjs';

export { boxMean };

export function upsample(grid, W, H) {
  const { width: w, height: h, codes } = grid;
  const U = new Float32Array(W * H);
  for (let y = 0; y < H; y += 1) {
    const gy = Math.min(h - 1, Math.max(0, ((y + 0.5) / H) * h - 0.5));
    const iy = Math.floor(gy); const jy = Math.min(h - 1, iy + 1); const ty = gy - iy;
    for (let x = 0; x < W; x += 1) {
      const gx = Math.min(w - 1, Math.max(0, ((x + 0.5) / W) * w - 0.5));
      const ix = Math.floor(gx); const jx = Math.min(w - 1, ix + 1); const tx = gx - ix;
      const t = codes[iy * w + ix] * (1 - tx) + codes[iy * w + jx] * tx;
      const b = codes[jy * w + ix] * (1 - tx) + codes[jy * w + jx] * tx;
      U[y * W + x] = (t * (1 - ty) + b * ty) / 255;
    }
  }
  return U;
}

/** Pixels within d (Chebyshev) of where U crosses 0.5. */
export function contourBand(U, W, H, d) {
  const e = new Float32Array(U.length);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x; const a = U[i] >= 0.5;
      if ((x + 1 < W && (U[i + 1] >= 0.5) !== a) || (y + 1 < H && (U[i + W] >= 0.5) !== a)) { e[i] = 1; if (x + 1 < W) e[i + 1] = 1; if (y + 1 < H) e[i + W] = 1; }
    }
  }
  const m = boxMean(e, W, H, d);
  return Uint8Array.from(m, (v) => (v > 1e-7 ? 1 : 0));
}

const erode = (m, W, H, r) => Uint8Array.from(boxMean(Float32Array.from(m), W, H, r), (v) => (v > 0.999 ? 1 : 0));
const dilate = (m, W, H, r) => Uint8Array.from(boxMean(Float32Array.from(m), W, H, r), (v) => (v > 1e-7 ? 1 : 0));
function edges(m, W, H) {
  const e = new Uint8Array(m.length);
  for (let y = 1; y < H - 1; y += 1) for (let x = 1; x < W - 1; x += 1) { const i = y * W + x; if (m[i] !== m[i - 1] || m[i] !== m[i + 1] || m[i] !== m[i - W] || m[i] !== m[i + W]) e[i] = 1; }
  return e;
}

/**
 * Scores of a coverage `a` against a reference `gt` (0–1; exact alpha or a 0/1 reference).
 * `zone`: where the refinement may act (near the stored outline, and covered by the reference).
 * zSad mean |a − gt| in the zone; zLeak coverage on reference background, zMiss missing on
 * reference foreground (both per zone pixel); holes ‰ of the zone more than 6 px inside the
 * reference's foreground or background but on the wrong side; bf boundary F (2 px); thin recall
 * of reference parts an opening of radius 4 removes.
 */
export function scores(a, gt, W, H, zone) {
  const n = a.length;
  const pa = Uint8Array.from(a, (v) => (v >= 0.5 ? 1 : 0)); const pg = Uint8Array.from(gt, (v) => (v >= 0.5 ? 1 : 0));
  let tp = 0; let fp = 0; let fn = 0; let zs = 0; let zl = 0; let zm = 0; let zn = 0;
  for (let i = 0; i < n; i += 1) {
    if (pa[i] && pg[i]) tp += 1; else if (pa[i]) fp += 1; else if (pg[i]) fn += 1;
    if (!zone[i]) continue; // eslint-disable-line no-continue
    zn += 1; zs += Math.abs(a[i] - gt[i]);
    if (gt[i] < 0.02) zl += a[i];
    if (gt[i] > 0.98) zm += 1 - a[i];
  }
  const ea = edges(pa, W, H); const eg = edges(pg, W, H); const na = dilate(ea, W, H, 2); const ng = dilate(eg, W, H, 2);
  let ma = 0; let ca = 0; let mg = 0; let cg = 0;
  for (let i = 0; i < n; i += 1) { if (ea[i]) { ca += 1; if (ng[i]) ma += 1; } if (eg[i]) { cg += 1; if (na[i]) mg += 1; } }
  const bp = ca ? ma / ca : 1; const br = cg ? mg / cg : 1;
  const deepF = erode(pg, W, H, 6); const deepB = erode(pg.map((v) => 1 - v), W, H, 6);
  let holes = 0;
  for (let i = 0; i < n; i += 1) if (zone[i] && ((deepF[i] && !pa[i]) || (deepB[i] && pa[i]))) holes += 1;
  const opened = dilate(erode(pg, W, H, 4), W, H, 4);
  let thin = 0; let thinHit = 0;
  for (let i = 0; i < n; i += 1) if (pg[i] && !opened[i]) { thin += 1; if (pa[i]) thinHit += 1; }
  return { iou: tp / (tp + fp + fn), bf: (2 * bp * br) / (bp + br || 1), zSad: zs / zn, zLeak: zl / zn, zMiss: zm / zn, holes: (holes / zn) * 1000, thin: thin ? thinHit / thin : null };
}
