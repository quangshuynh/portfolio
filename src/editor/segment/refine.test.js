import { describe, expect, it } from 'vitest';
import {
  REFINE_EDGE, refineReach, refineSelection, refineSize, refineWindow, tileMapCode, tileMapSample, tileMapBytes,
} from './refine.mjs';

const FG = [200, 60, 40];
const BG = [40, 90, 200];

/** A guide W×H with a vertical edge at `edge` (px, may be fractional: the boundary pixel is mixed). */
function edgeGuide(W, H, edge, { fg = FG, bg = BG, alpha = null } = {}) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const a = Math.min(1, Math.max(0, edge - x)); // coverage of pixel x by [0, edge)
      const i = (y * W + x) * 4;
      for (let c = 0; c < 3; c += 1) data[i + c] = Math.round(fg[c] * a + bg[c] * (1 - a));
      data[i + 3] = alpha ? alpha(x, y) : 255;
    }
  }
  return { width: W, height: H, data };
}
/** A coarse grid w×h whose own edge (soft over `soft` cells) is at `edge` cells. */
function edgeGrid(w, h, edge, soft = 1.5) {
  const codes = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) codes[y * w + x] = Math.round(255 * Math.min(1, Math.max(0, 0.5 - (x + 0.5 - edge) / (2 * soft))));
  return { width: w, height: h, codes };
}
const row = (map, y) => Array.from({ length: map.width }, (_, x) => tileMapCode(map, x, y));
/** Where a row crosses code 128 (fractional px). */
function crossing(values) {
  for (let x = 0; x + 1 < values.length; x += 1) {
    if (values[x] >= 127.5 && values[x + 1] < 127.5) return x + 0.5 + (values[x] - 127.5) / (values[x] - values[x + 1]);
  }
  return null;
}

describe('refine sizes', () => {
  it('runs at the owner size up to REFINE_EDGE', () => {
    expect(refineSize(6000, 4000)).toEqual({ width: 6000, height: 4000 });
    expect(refineSize(8256, 5504)).toEqual({ width: REFINE_EDGE, height: Math.round(5504 * (REFINE_EDGE / 8256)) });
    expect(refineSize(300, 200)).toEqual({ width: 300, height: 200 });
  });
  it('widens the band with the edge radius', () => {
    expect(refineReach(6, 0).band).toBe(6);
    expect(refineReach(6, 1).band).toBe(24);
    expect(refineReach(1, 0).band).toBe(3);
  });
});

describe('refineSelection', () => {
  const W = 512; const H = 96; const scale = 8; // grid 64 × 12
  const grid = edgeGrid(W / scale, H / scale, 30); // coarse edge at 240 px
  it('moves an offset edge onto the image edge and keeps interiors exact', () => {
    const map = refineSelection(grid, edgeGuide(W, H, 244.3));
    const r = row(map, 48);
    expect(crossing(r)).toBeGreaterThan(243.3);
    expect(crossing(r)).toBeLessThan(245.3);
    expect(r[10]).toBe(255);
    expect(r[500]).toBe(0);
    // the boundary pixel is mixed (0.3 covered): partial coverage, not a hard cut
    expect(r[244]).toBeGreaterThan(30);
    expect(r[244]).toBeLessThan(140);
  });
  it('without an image edge keeps the coarse edge, crisp', () => {
    const flat = edgeGuide(W, H, 0, { bg: [120, 120, 120] });
    const map = refineSelection(grid, flat);
    const r = row(map, 48);
    expect(Math.abs(crossing(r) - 240)).toBeLessThan(0.6);
    // the upscaled grid ramps over 24 px; sharpened by scale / 1.5
    const ramp = r.filter((v) => v > 10 && v < 245).length;
    expect(ramp).toBeLessThanOrEqual(6);
  });
  it('does not punch holes: a background-coloured speck inside stays selected', () => {
    const guide = edgeGuide(W, H, 244);
    for (let y = 46; y < 50; y += 1) for (let x = 236; x < 239; x += 1) { const i = (y * W + x) * 4; guide.data.set([...BG, 255], i); }
    const map = refineSelection(grid, guide);
    expect(tileMapCode(map, 237, 48)).toBeGreaterThan(200);
  });
  it('limits coverage to the guide alpha (transparent layer sources)', () => {
    const guide = edgeGuide(W, H, 240, { alpha: (x) => (x < 100 ? 0 : 255) });
    const map = refineSelection(grid, guide);
    expect(tileMapCode(map, 50, 48)).toBe(0);
    expect(tileMapCode(map, 150, 48)).toBe(255);
  });
  it('applies Edge and Feather at refinement resolution', () => {
    const guide = edgeGuide(W, H, 240);
    const base = crossing(row(refineSelection(grid, guide), 48));
    const grown = crossing(row(refineSelection(grid, guide, { shift: 1 }), 48));
    const shrunk = crossing(row(refineSelection(grid, guide, { shift: -1 }), 48));
    expect(grown - base).toBeGreaterThan(2);
    expect(base - shrunk).toBeGreaterThan(2);
    const soft = row(refineSelection(grid, guide, { feather: 1 }), 48).filter((v) => v > 10 && v < 245).length;
    expect(soft).toBeGreaterThan(10);
  });
  it('is deterministic, sparse and independent of tiling', () => {
    const guide = edgeGuide(W, H, 244.3);
    const a = refineSelection(grid, guide); const b = refineSelection(grid, guide);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
    expect(a.states.filter((s) => s === 1).length).toBeLessThan(a.states.length);
    expect(tileMapBytes(a)).toBeLessThan(W * H);
    // the whole image as one window gives the same codes
    const n = W * H; const rgb = [0, 1, 2].map((c) => Float32Array.from({ length: n }, (_, i) => guide.data[i * 4 + c] / 255));
    const lum = Float32Array.from({ length: n }, (_, i) => 0.299 * rgb[0][i] + 0.587 * rgb[1][i] + 0.114 * rgb[2][i]);
    const U = new Float32Array(n);
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) { const gx = Math.min(grid.width - 1, Math.max(0, (x + 0.5) / scale - 0.5)); const ix = Math.floor(gx); const jx = Math.min(grid.width - 1, ix + 1); const t = gx - ix; const gy = Math.min(grid.height - 1, Math.max(0, (y + 0.5) / scale - 0.5)); const iy = Math.floor(gy); U[y * W + x] = (grid.codes[iy * grid.width + ix] * (1 - t) + grid.codes[iy * grid.width + jx] * t) / 255; }
    const whole = refineWindow(U, rgb, lum, W, H, { scale });
    let worst = 0;
    for (let x = 0; x < W; x += 1) worst = Math.max(worst, Math.abs(Math.round(whole[48 * W + x] * 255) - tileMapCode(a, x, 48)));
    expect(worst).toBeLessThanOrEqual(1);
  });
  it('can be cancelled', () => {
    expect(() => refineSelection(grid, edgeGuide(W, H, 244), {}, { cancelled: () => true })).toThrow('cancelled');
  });
  it('samples bilinearly at pixel centres', () => {
    const map = refineSelection(grid, edgeGuide(W, H, 0, { bg: [120, 120, 120] }));
    expect(tileMapSample(map, 10.5, 48.5)).toBe(1);
    expect(tileMapSample(map, 500.5, 48.5)).toBe(0);
    const mid = tileMapSample(map, 240, 48.5);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.8);
  });
});
