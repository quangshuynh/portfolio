import { afterEach, describe, expect, it } from 'vitest';
import { RECOVER_VERSION, colourClusters, recoverWindow, strokeChunks, strokePixels, strokeRegion } from './recover.mjs';
import { refineSelection, tileMapCode } from './refine.mjs';
import { encodeCodes } from './analysis.mjs';
import { refinedMask, refinementsOf } from './refineClient.mjs';
import { forgetRefined, refinementKey, registerRefined } from './selectionMask.mjs';
import { appendRecoverStroke, MASK_LIMITS, normalizeMask, removeRecoverStrokes } from '../model/masks.mjs';

const W = 240; const H = 160;
const BG = [190, 180, 170]; const CAR = [60, 40, 120]; const ANT = [20, 20, 25];
/**
 * A scene: a car block below y = 100, an antenna 3 px wide rising from it at x = 120 to y = 30,
 * a lamp post (as dark) at x = 200 from y = 0 to y = 60 that does not touch the car.
 */
function scene({ antenna = ANT, ground = BG } = {}) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      let c = ground;
      if (y >= 100) c = CAR;
      else if (x >= 119 && x < 122 && y >= 30) c = antenna;
      else if (x >= 199 && x < 202 && y < 60) c = ANT;
      data.set([...c, 255], (y * W + x) * 4);
    }
  }
  return { width: W, height: H, data };
}
const planes = (img) => [0, 1, 2].map((c) => Float32Array.from({ length: W * H }, (_, i) => img.data[i * 4 + c] / 255));
const baseOf = () => Float32Array.from({ length: W * H }, (_, i) => (Math.floor(i / W) >= 100 ? 1 : 0));
const stroke = (points, r) => ({ r, points });

describe('recoverWindow', () => {
  it('adds a thin part under the stroke that joins the selection, nothing outside the stroke', () => {
    const s = stroke([[120.5, 100], [120.5, 25]], 8);
    const { region, length } = strokeRegion(s, 0, 0, W, H);
    const { coverage, added } = recoverWindow(baseOf(), planes(scene()), W, H, region, length);
    expect(added).toBeGreaterThan(150);
    for (let y = 35; y < 95; y += 5) expect(coverage[y * W + 120]).toBeGreaterThan(0.9);
    expect(coverage[60 * W + 110]).toBe(0); // beside the antenna
    expect(coverage[60 * W + 200]).toBe(0); // the lamp post was not painted
    const base = baseOf();
    let outside = 0;
    for (let i = 0; i < W * H; i += 1) if (!region[i] && coverage[i] !== base[i]) outside += 1;
    expect(outside).toBe(0);
  });
  it('drops detached parts that span less than half of the stroke (a lamp post grazed by a long stroke)', () => {
    // From the car up past the post's foot and along the top: the post (60 px) is detached from the car.
    const s = stroke([[200.5, 99], [200.5, 2], [60, 2]], 6);
    const { region, length } = strokeRegion(s, 0, 0, W, H);
    const { added } = recoverWindow(baseOf(), planes(scene()), W, H, region, length);
    expect(added).toBe(0);
  });
  it('adds nothing where the part does not stand out (low contrast): the Add brush is the fallback', () => {
    const s = stroke([[120.5, 100], [120.5, 25]], 8);
    const { region, length } = strokeRegion(s, 0, 0, W, H);
    const { added } = recoverWindow(baseOf(), planes(scene({ antenna: [186, 176, 168] })), W, H, region, length);
    expect(added).toBe(0);
  });
  it('gives partial coverage to mixed pixels', () => {
    const img = scene();
    // a half-covered column beside the antenna
    for (let y = 30; y < 100; y += 1) { const i = (y * W + 122) * 4; for (let c = 0; c < 3; c += 1) img.data[i + c] = Math.round((ANT[c] + BG[c]) / 2); }
    const s = stroke([[120.5, 100], [120.5, 25]], 8);
    const { region, length } = strokeRegion(s, 0, 0, W, H);
    const { coverage } = recoverWindow(baseOf(), planes(img), W, H, region, length);
    expect(coverage[60 * W + 122]).toBeGreaterThan(0.3);
    expect(coverage[60 * W + 122]).toBeLessThan(0.7);
  });
  it('copes with surroundings too scattered to form a cluster (no background: nothing added)', () => {
    const scattered = Array.from({ length: 8 }, (_, i) => [i / 8, (i * 3) % 8 / 8, (i * 5) % 8 / 8]);
    expect(colourClusters(scattered).length).toBeLessThanOrEqual(4);
    const s = stroke([[120.5, 100], [120.5, 25]], 8);
    const { region, length } = strokeRegion(s, 0, 0, W, H);
    // a ring of only a few background pixels: the stroke fills the window
    const base = baseOf();
    const tiny = recoverWindow(base, planes(scene()), W, H, Uint8Array.from(region, (v, i) => (v || base[i] < 0.5 ? 1 : 0)), length);
    expect(tiny.added).toBe(0);
  });
  it('cuts long strokes into bounded windows', () => {
    const pieces = strokeChunks({ r: 5, points: [[0, 0], [300, 0], [600, 0], [900, 10], [1400, 10]] }, 512);
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) expect(Math.max(...p.points.map((q) => q[0])) - Math.min(...p.points.map((q) => q[0]))).toBeLessThanOrEqual(512);
    expect(strokePixels({ radius: 0.05, points: [[0.5, 0.25, 1]] }, 200, 100)).toEqual({ r: 5, points: [[100, 25]] });
  });
});

describe('refineSelection with recovery', () => {
  // grid 60 × 40 (4 px cells): the car only
  const grid = { width: 60, height: 40, codes: Uint8Array.from({ length: 2400 }, (_, i) => (Math.floor(i / 60) >= 25 ? 255 : 0)) };
  const recover = [{ radius: 8 / H, points: [[120.5 / W, 100 / H], [120.5 / W, 25 / H]] }];
  it('recovers the antenna into the map, reports it per stroke, deterministically', () => {
    const a = refineSelection(grid, scene(), { recover });
    const b = refineSelection(grid, scene(), { recover });
    expect(a.recovered[0].added).toBeGreaterThan(150);
    expect(tileMapCode(a, 120, 60)).toBeGreaterThan(230);
    expect(tileMapCode(refineSelection(grid, scene()), 120, 60)).toBe(0);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
  });
  it('Edge and Feather apply to recovered parts too', () => {
    const grown = refineSelection(grid, scene(), { recover, shift: 1 });
    expect(tileMapCode(grown, 124, 60)).toBeGreaterThan(tileMapCode(refineSelection(grid, scene(), { recover }), 124, 60));
  });
  it('is limited to the visible part of a transparent source', () => {
    const img = scene();
    for (let y = 0; y < 70; y += 1) for (let x = 0; x < W; x += 1) img.data[(y * W + x) * 4 + 3] = 0;
    const map = refineSelection(grid, img, { recover });
    expect(tileMapCode(map, 120, 50)).toBe(0);
    expect(tileMapCode(map, 120, 85)).toBeGreaterThan(200);
  });
});

describe('document and keys', () => {
  afterEach(() => forgetRefined());
  const selection = () => ({ id: 's1', type: 'selection', kind: 'subject', version: 't/1', width: 60, height: 40, data: encodeCodes(new Uint8Array(2400)), confidence: 1, refine: { version: 'contour-colour/1', radius: 0 } });
  it('stores strokes on the selection (radius capped, points budgeted) and removes them', () => {
    let mask = normalizeMask({ base: 'none', components: [selection()] }, 'image');
    mask = appendRecoverStroke(mask, 's1', { radius: 0.5, points: [[0.5, 0.2, 1], [0.5, 0.6, 1]] }, RECOVER_VERSION);
    mask = appendRecoverStroke(mask, 's1', { radius: 0.02, points: [[0.1, 0.1, 1]] }, RECOVER_VERSION);
    const c = mask.components[0];
    expect(c.recover.version).toBe(RECOVER_VERSION);
    expect(c.recover.strokes.map((s) => s.radius)).toEqual([MASK_LIMITS.recoverRadius, 0.02]);
    expect(removeRecoverStrokes(mask, 's1').components[0].recover.strokes.length).toBe(1);
    expect(removeRecoverStrokes(mask, 's1', true).components[0].recover).toBeUndefined();
    const budget = { points: 2 };
    expect(normalizeMask({ base: 'none', components: [c] }, 'image', budget).components[0].recover.strokes.length).toBe(1);
  });
  it('a stroke changes the map key; the preview keeps the last map meanwhile, an export never does', () => {
    const plain = normalizeMask({ base: 'none', components: [selection()] }, 'image');
    const withStroke = appendRecoverStroke(plain, 's1', { radius: 0.02, points: [[0.5, 0.5, 1]] }, RECOVER_VERSION);
    const k0 = refinementKey('photo|p', plain.components[0]);
    const k1 = refinementKey('photo|p', withStroke.components[0]);
    expect(k1).not.toBe(k0);
    expect(refinementsOf({ local: [{ mask: withStroke }], layers: [] }, 'photo|p')[0].key).toBe(k1);
    registerRefined(k0, refineSelection({ width: 60, height: 40, codes: new Uint8Array(2400) }, scene()));
    expect(refinedMask(plain, 'photo|p').components[0].refinedKey).toBe(k0);
    expect(refinedMask(withStroke, 'photo|p').components[0].refinedKey).toBe(k0);
    expect(refinedMask(withStroke, 'photo|p', { exact: true }).components[0].refinedKey).toBeUndefined();
  });
  it('version 19 selections (no recover) keep their key', () => {
    const c = selection();
    expect(refinementKey('photo|p', c)).not.toContain('recover');
  });
});
