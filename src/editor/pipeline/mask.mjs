// Mask coverage (model/masks.mjs), evaluated per canvas pixel: the same function serves the GPU
// preview (a coverage texture computed here), the CPU preview and every export band, so the
// three agree and a mask has no seams at band or tile boundaries (nothing depends on the rows
// around a pixel). Coverage is returned as 8-bit codes; the compositor scales a pass's alpha or
// opacity by code / 255 on the CPU and on the GPU alike.
//
// A canvas pixel centre (x + 0.5, y + 0.5) is mapped into the mask's space by `map.matrix`
// (a 3 × 3 homography: identity for the canvas, the geometry's output → source matrix for
// 'image' masks, the layer matrix for 'layer' masks); `map.width`, `map.height` are the space's
// size in those pixels. Shapes are evaluated there, so a radial stays an ellipse on the photo's
// content however it is cropped, rotated, stretched or corrected for perspective.
//
// Edges: a hard edge (hardness 1, feather 0) still fades over one canvas pixel (`map.scale`,
// space pixels per canvas pixel), so it is antialiased at every render size.

import { IDENTITY3, invert3, project } from './geometry.mjs';
import { matrixScale } from './layerTransform.mjs';

const smooth = (t) => t * t * (3 - 2 * t);
const code8 = (v) => Math.min(255, Math.max(0, Math.floor(v * 255 + 0.5)));
/** Brush radius at a point of pressure p (0.05–1): full at 1 (mice, touch), a fifth at the lightest pen touch. */
export const pressureRadius = (radius, p) => radius * (0.2 + 0.8 * p);

/** A mask map: canvas px → space px, the space's size, and space px per canvas px. */
export function maskMap(matrix, width, height) {
  return { matrix: [...matrix], width, height, scale: matrixScale(matrix) };
}
/** The composition's own space at a canvas of `canvas` size. */
export const canvasMaskMap = (canvas) => maskMap(IDENTITY3, canvas.width, canvas.height);
/** The photo before Crop & Transform: `plan` = geometryPlan(geometry, native), canvas = render size. */
export const imageMaskMap = (plan, canvas, native) => maskMap(plan.toSource(canvas, native), native.width, native.height);
/** An image layer's box: `matrix` = layerMatrix(layer, canvas, raster). */
export const layerMaskMap = (matrix, raster) => maskMap(matrix, raster.width, raster.height);
export const maskMapKey = (map) => `${map.width}x${map.height}|${map.matrix.map((v) => v.toPrecision(12)).join(',')}`;

/** Falloff of a normalised distance q (1 at the edge) for a soft edge `edge` wide (fraction of the radius). */
function falloff(q, edge) {
  if (q >= 1) return 0;
  const inner = 1 - edge;
  return q <= inner ? 1 : 1 - smooth((q - inner) / edge);
}

/** Coverage of a linear gradient at a point of the space: 1 before its start, 0 past its end. */
function linearAt(c, map, sx, sy) {
  const ax = c.x0 * map.width;
  const ay = c.y0 * map.height;
  const dx = c.x1 * map.width - ax;
  const dy = c.y1 * map.height - ay;
  const length2 = dx * dx + dy * dy;
  if (length2 < 1e-12) return 0;
  const t = Math.min(1, Math.max(0, ((sx - ax) * dx + (sy - ay) * dy) / length2));
  // Feather 0: a straight ramp; 1: a smooth S-curve with no visible start or end.
  return 1 - ((1 - c.feather) * t + c.feather * smooth(t));
}

/** A radial component prepared for many points. */
function prepareRadial(c, map) {
  const short = Math.min(map.width, map.height);
  const rx = Math.max(1e-6, c.rx * short);
  const ry = Math.max(1e-6, c.ry * short);
  const a = (c.rotation * Math.PI) / 180;
  return { cx: c.x * map.width, cy: c.y * map.height, rx, ry, cos: Math.cos(a), sin: Math.sin(a), edge: Math.min(1, Math.max(c.feather, map.scale / Math.min(rx, ry))) };
}

function radialAt(r, sx, sy) {
  const dx = sx - r.cx;
  const dy = sy - r.cy;
  const u = (dx * r.cos + dy * r.sin) / r.rx;
  const v = (-dx * r.sin + dy * r.cos) / r.ry;
  return falloff(Math.sqrt(u * u + v * v), r.edge);
}

/** Canvas rectangle a space rectangle maps to (clipped to the region), or the whole region when the mapping cannot be inverted there. */
function canvasBox(inverse, box, region) {
  const whole = { x0: region.x0, y0: region.y0, x1: region.x1, y1: region.y1 };
  if (!inverse) return whole;
  const corners = [[box.x0, box.y0], [box.x1, box.y0], [box.x0, box.y1], [box.x1, box.y1]].map(([x, y]) => project(inverse, x, y));
  if (corners.some(([, , w]) => !(w > 0))) return whole;
  return {
    x0: Math.max(region.x0, Math.floor(Math.min(...corners.map(([x]) => x))) - 1),
    y0: Math.max(region.y0, Math.floor(Math.min(...corners.map(([, y]) => y))) - 1),
    x1: Math.min(region.x1, Math.ceil(Math.max(...corners.map(([x]) => x))) + 1),
    y1: Math.min(region.y1, Math.ceil(Math.max(...corners.map(([, y]) => y))) + 1),
  };
}

const strokePoints = (stroke, map) => {
  const short = Math.min(map.width, map.height);
  return stroke.points.map(([x, y, p]) => [x * map.width, y * map.height, Math.max(1e-6, pressureRadius(stroke.radius * short, p))]);
};
const union = (a, b) => (!a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });

/**
 * Paints a stroke's segments from segment `from` into `buffer` (the region's pixels, row-major).
 * A stroke is a chain of capsules whose radius follows the pen pressure; its coverage at a
 * pixel is the largest any capsule gives, so a stroke never builds up over itself.
 * :returns: the canvas box painted, or null
 */
function paintStroke(stroke, pts, from, map, inverse, region, buffer) {
  const m = map.matrix;
  const rw = region.x1 - region.x0;
  const hardEdge = 1 - stroke.hardness;
  const segments = Math.max(1, pts.length - 1);
  let painted = null;
  for (let k = Math.max(0, from); k < segments; k += 1) {
    const a = pts[k];
    const b = pts[Math.min(k + 1, pts.length - 1)];
    const r = Math.max(a[2], b[2]);
    const box = canvasBox(inverse, { x0: Math.min(a[0], b[0]) - r, y0: Math.min(a[1], b[1]) - r, x1: Math.max(a[0], b[0]) + r, y1: Math.max(a[1], b[1]) + r }, region);
    if (box.x1 <= box.x0 || box.y1 <= box.y0) continue; // eslint-disable-line no-continue
    painted = union(painted, box);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length2 = dx * dx + dy * dy;
    const r2 = r * r;
    for (let y = box.y0; y < box.y1; y += 1) {
      const cy = y + 0.5;
      const row = (y - region.y0) * rw - region.x0;
      for (let x = box.x0; x < box.x1; x += 1) {
        const i = row + x;
        if (buffer[i] >= 1) continue; // eslint-disable-line no-continue
        const cx = x + 0.5;
        const w = m[6] * cx + m[7] * cy + m[8];
        const sx = (m[0] * cx + m[1] * cy + m[2]) / w;
        const sy = (m[3] * cx + m[4] * cy + m[5]) / w;
        const t = length2 > 0 ? Math.min(1, Math.max(0, ((sx - a[0]) * dx + (sy - a[1]) * dy) / length2)) : 0;
        const ex = sx - a[0] - dx * t;
        const ey = sy - a[1] - dy * t;
        const d2 = ex * ex + ey * ey;
        if (d2 >= r2) continue; // eslint-disable-line no-continue
        const radius = a[2] + (b[2] - a[2]) * t;
        const q = Math.sqrt(d2) / radius;
        if (q >= 1) continue; // eslint-disable-line no-continue
        const cov = falloff(q, Math.min(1, Math.max(hardEdge, map.scale / radius)));
        if (cov > buffer[i]) buffer[i] = cov;
      }
    }
  }
  return painted;
}

/** Combines a painted stroke (`buffer` inside `box`) into a brush component's coverage; `clear` empties the buffer there. */
function applyStroke(stroke, buffer, box, region, comp, clear) {
  const rw = region.x1 - region.x0;
  const erase = stroke.mode === 'erase';
  for (let y = box.y0; y < box.y1; y += 1) {
    for (let x = box.x0; x < box.x1; x += 1) {
      const i = (y - region.y0) * rw + x - region.x0;
      const c = buffer[i] * stroke.opacity;
      if (clear) buffer[i] = 0;
      if (c <= 0) continue; // eslint-disable-line no-continue
      comp[i] = erase ? comp[i] * (1 - c) : comp[i] + c - comp[i] * c;
    }
  }
}

const sameStrokeStart = (live, stroke) => live.mode === stroke.mode && live.radius === stroke.radius && live.hardness === stroke.hardness
  && live.opacity === stroke.opacity && live.count <= stroke.points.length
  && live.points.slice(0, live.count).every((p, i) => p[0] === stroke.points[i][0] && p[1] === stroke.points[i][1] && p[2] === stroke.points[i][2]);

/**
 * A brush component's coverage over the region. With a `cache` (a Map the caller keeps, e.g. the
 * preview while painting), the coverage of every stroke but the last is kept, and the last stroke
 * keeps its painted buffer while it only grows, so each new point costs only its own segment.
 * The result is the same as without the cache.
 */
function brushCoverage(component, map, inverse, region, n, cache) {
  const { strokes } = component;
  if (!cache) {
    const comp = new Float32Array(n);
    const scratch = new Float32Array(n);
    for (const stroke of strokes) {
      const box = paintStroke(stroke, strokePoints(stroke, map), 0, map, inverse, region, scratch);
      if (box) applyStroke(stroke, scratch, box, region, comp, true);
    }
    return comp;
  }
  const key = brushKey(component, map, region);
  let entry = cache.get(key);
  if (!entry) {
    // Two brush components at most (three canvas-size buffers each): the one being painted and one more.
    const brushes = [...cache.keys()].filter((name) => !name.startsWith('rows|'));
    if (brushes.length >= 2) cache.delete(brushes[0]);
    entry = { prefix: [], prefixComp: new Float32Array(n), scratch: new Float32Array(n), live: null };
    cache.set(key, entry);
  }
  const last = strokes.length - 1;
  let k = 0;
  while (k < entry.prefix.length && k < last && entry.prefix[k] === strokes[k]) k += 1;
  if (k < entry.prefix.length) {
    entry.prefix = [];
    entry.prefixComp.fill(0);
    k = 0;
  }
  for (; k < last; k += 1) {
    const stroke = strokes[k];
    // The stroke just finished: its painted buffer is reused when it is the same stroke.
    const live = entry.live && sameStrokeStart(entry.live, stroke) && entry.live.count === stroke.points.length ? entry.live : null;
    const box = live ? live.box : paintStroke(stroke, strokePoints(stroke, map), 0, map, inverse, region, entry.scratch);
    if (box) applyStroke(stroke, live ? live.buffer : entry.scratch, box, region, entry.prefixComp, true);
    if (live) entry.live = null;
    entry.prefix.push(stroke);
  }
  const comp = entry.prefixComp.slice();
  if (last < 0) return comp;
  const stroke = strokes[last];
  let { live } = entry;
  const continues = live && sameStrokeStart(live, stroke);
  if (!continues) {
    live = { buffer: live?.buffer ?? new Float32Array(n), box: null, count: 0 };
    live.buffer.fill(0);
  }
  growLive(entry, live, stroke, continues, map, inverse, region);
  if (live.box) applyStroke(stroke, live.buffer, live.box, region, comp, false);
  return comp;
}

/** Paints the live stroke's new segments; returns the canvas box they touched, or null. */
function growLive(entry, live, stroke, continues, map, inverse, region) {
  const box = paintStroke(stroke, strokePoints(stroke, map), continues ? live.count - 1 : 0, map, inverse, region, live.buffer);
  Object.assign(live, { box: union(live.box, box), count: stroke.points.length, points: stroke.points, mode: stroke.mode, radius: stroke.radius, hardness: stroke.hardness, opacity: stroke.opacity });
  entry.live = live;
  return box;
}

const brushKey = (component, map, region) => `${component.id}|${maskMapKey(map)}|${region.x0},${region.y0},${region.x1},${region.y1}`;
// Everything about a mask except its brush strokes. While this is unchanged and only the stroke
// being painted grew, only the pixels its new segments touch can change.
const maskShape = (mask) => JSON.stringify([mask.base, mask.invert, mask.opacity, mask.components.map((c) => (c.type === 'brush' ? { ...c, strokes: c.strokes.length } : c))]);
// Per-component coverage is kept while painting; masks with more components are evaluated in full.
const MAX_CACHED_COMPONENTS = 6;

/** Which brush component's last stroke grew since `entry`, or { changed: true } for anything else. */
function strokeChange(entry, active, cache, map, region) {
  let growing = null;
  for (let index = 0; index < active.length; index += 1) {
    const c = active[index];
    if (c.type !== 'brush') continue; // eslint-disable-line no-continue
    const before = entry.strokes.get(c.id);
    if (before.length === c.strokes.length && before.every((stroke, i) => stroke === c.strokes[i])) continue; // eslint-disable-line no-continue
    const last = c.strokes.length - 1;
    const brush = cache.get(brushKey(c, map, region));
    const grows = !growing && last >= 0 && before.length === c.strokes.length && before.slice(0, last).every((stroke, i) => stroke === c.strokes[i])
      && brush?.live && brush.prefix.length === last && sameStrokeStart(brush.live, c.strokes[last]);
    if (!grows) return { changed: true };
    growing = { component: c, brush, index };
  }
  return { changed: false, growing };
}

/**
 * maskRows with a cache (the preview while painting): each component's coverage and the codes
 * are kept, and when the only change is the stroke being painted growing, only the box of its
 * new segments is recomputed (a dirty rectangle). Each pixel goes through exactly the arithmetic
 * of the full path, so the codes are identical; any other change recomputes everything.
 */
function cachedMaskRows(mask, map, width, y0, y1, x0, out, cache) {
  const n = width * Math.max(0, y1 - y0);
  const region = { x0, y0, x1: x0 + width, y1 };
  const key = `rows|${maskMapKey(map)}|${region.x0},${region.y0},${region.x1},${region.y1}`;
  const shape = maskShape(mask);
  const active = mask.components.filter((c) => c.enabled && c.opacity > 0 && !(c.type === 'brush' && !c.strokes.length && !c.invert));
  if (active.length > MAX_CACHED_COMPONENTS) {
    cache.delete(key);
    return maskRows(mask, map, width, y0, y1, { x0, out });
  }
  let entry = cache.get(key);
  let dirty = null;
  const change = entry && entry.shape === shape ? strokeChange(entry, active, cache, map, region) : { changed: true };
  if (!change.changed && !change.growing) {
    out.set(entry.codes);
    return out;
  }
  if (!change.changed) {
    const { component, brush, index } = change.growing;
    const stroke = component.strokes[component.strokes.length - 1];
    dirty = growLive(brush, brush.live, stroke, true, map, invert3(map.matrix), region);
    entry.strokes.set(component.id, component.strokes.slice());
    if (dirty) {
      // The component's coverage in the box: finished strokes, then the live stroke (applyStroke).
      const cov = entry.covs[index];
      const erase = stroke.mode === 'erase';
      for (let y = dirty.y0; y < dirty.y1; y += 1) {
        for (let x = dirty.x0, i = (y - y0) * width + x - x0; x < dirty.x1; x += 1, i += 1) {
          const c = brush.live.buffer[i] * stroke.opacity;
          const p = brush.prefixComp[i];
          cov[i] = c <= 0 ? p : erase ? p * (1 - c) : p + c - p * c;
        }
      }
    }
  } else {
    const inverse = invert3(map.matrix);
    const covs = active.map((c) => (c.type === 'brush' ? brushCoverage(c, map, inverse, region, n, cache) : componentCoverage(c, map, region)));
    entry = { shape, covs, strokes: new Map(active.filter(({ type }) => type === 'brush').map((c) => [c.id, c.strokes.slice()])), codes: new Uint8ClampedArray(n) };
    cache.delete(key);
    cache.set(key, entry);
    dirty = region;
  }
  if (dirty) {
    const base = mask.base === 'all' ? 1 : 0;
    for (let y = dirty.y0; y < dirty.y1; y += 1) {
      for (let x = dirty.x0, i = (y - y0) * width + x - x0; x < dirty.x1; x += 1, i += 1) {
        let acc = base;
        for (let j = 0; j < active.length; j += 1) {
          const { invert, opacity, op } = active[j];
          const raw = entry.covs[j][i];
          const c = (invert ? 1 - raw : raw) * opacity;
          // Rounded to float32 at each step, as maskRows' Float32Array accumulator is.
          acc = Math.fround(op === 'subtract' ? acc * (1 - c) : acc + c - acc * c);
        }
        entry.codes[i] = code8(mask.opacity * (mask.invert ? 1 - acc : acc));
      }
    }
  }
  out.set(entry.codes);
  return out;
}

/** A linear or radial component's coverage over the region, before invert and opacity. */
function componentCoverage(component, map, region) {
  const m = map.matrix;
  const cov = new Float32Array((region.x1 - region.x0) * (region.y1 - region.y0));
  const radial = component.type === 'radial' ? prepareRadial(component, map) : null;
  let i = 0;
  for (let y = region.y0; y < region.y1; y += 1) {
    const cy = y + 0.5;
    for (let x = region.x0; x < region.x1; x += 1, i += 1) {
      const cx = x + 0.5;
      const w = m[6] * cx + m[7] * cy + m[8];
      const sx = (m[0] * cx + m[1] * cy + m[2]) / w;
      const sy = (m[3] * cx + m[4] * cy + m[5]) / w;
      cov[i] = radial ? radialAt(radial, sx, sy) : linearAt(component, map, sx, sy);
    }
  }
  return cov;
}

/**
 * Coverage of `mask` over canvas rows [y0, y1), columns [x0, x0 + width), as 8-bit codes
 * (row-major, `width` per row).
 * :param map: maskMap() for the canvas being rendered
 */
export function maskRows(mask, map, width, y0, y1, { x0 = 0, out = new Uint8ClampedArray(width * Math.max(0, y1 - y0)), cache = null } = {}) {
  if (cache) return cachedMaskRows(mask, map, width, y0, y1, x0, out, cache);
  const n = width * Math.max(0, y1 - y0);
  const region = { x0, y0, x1: x0 + width, y1 };
  const acc = new Float32Array(n).fill(mask.base === 'all' ? 1 : 0);
  const m = map.matrix;
  const inverse = invert3(m);
  for (const component of mask.components) {
    if (!component.enabled || component.opacity <= 0) continue; // eslint-disable-line no-continue
    const subtract = component.op === 'subtract';
    const { invert, opacity } = component;
    if (component.type === 'brush') {
      if (!component.strokes.length && !invert) continue; // eslint-disable-line no-continue
      const comp = brushCoverage(component, map, inverse, region, n, cache);
      for (let i = 0; i < n; i += 1) {
        const c = (invert ? 1 - comp[i] : comp[i]) * opacity;
        acc[i] = subtract ? acc[i] * (1 - c) : acc[i] + c - acc[i] * c;
      }
      continue; // eslint-disable-line no-continue
    }
    const radial = component.type === 'radial' ? prepareRadial(component, map) : null;
    let i = 0;
    for (let y = y0; y < y1; y += 1) {
      const cy = y + 0.5;
      for (let x = x0; x < x0 + width; x += 1, i += 1) {
        const cx = x + 0.5;
        const w = m[6] * cx + m[7] * cy + m[8];
        const sx = (m[0] * cx + m[1] * cy + m[2]) / w;
        const sy = (m[3] * cx + m[4] * cy + m[5]) / w;
        const raw = radial ? radialAt(radial, sx, sy) : linearAt(component, map, sx, sy);
        const c = (invert ? 1 - raw : raw) * opacity;
        acc[i] = subtract ? acc[i] * (1 - c) : acc[i] + c - acc[i] * c;
      }
    }
  }
  for (let i = 0; i < n; i += 1) out[i] = code8(mask.opacity * (mask.invert ? 1 - acc[i] : acc[i]));
  return out;
}

/**
 * Coverage of a whole canvas of `size` ({ width, height, data } with one code per pixel).
 * :param cache: a Map kept by the caller for strokes being painted (see brushCoverage), or null
 */
export const rasterizeMask = (mask, map, size, cache = null) => ({ width: size.width, height: size.height, data: maskRows(mask, map, size.width, 0, size.height, { cache }) });
