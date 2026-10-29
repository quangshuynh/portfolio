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

/**
 * Adds one stroke to a brush component's coverage `comp` (the region's pixels, row-major).
 * A stroke is a chain of capsules whose radius follows the pen pressure; its coverage at a
 * pixel is the largest any capsule gives, so a stroke never builds up over itself.
 */
function addStroke(stroke, map, inverse, region, comp) {
  const short = Math.min(map.width, map.height);
  const pts = stroke.points.map(([x, y, p]) => [x * map.width, y * map.height, Math.max(1e-6, pressureRadius(stroke.radius * short, p))]);
  const reach = Math.max(...pts.map(([, , r]) => r));
  const all = canvasBox(inverse, {
    x0: Math.min(...pts.map(([x]) => x)) - reach, y0: Math.min(...pts.map(([, y]) => y)) - reach,
    x1: Math.max(...pts.map(([x]) => x)) + reach, y1: Math.max(...pts.map(([, y]) => y)) + reach,
  }, region);
  if (all.x1 <= all.x0 || all.y1 <= all.y0) return;
  const bw = all.x1 - all.x0;
  const buffer = new Float32Array(bw * (all.y1 - all.y0));
  const m = map.matrix;
  const hardEdge = 1 - stroke.hardness;
  const segments = pts.length === 1 ? [[pts[0], pts[0]]] : pts.slice(1).map((b, i) => [pts[i], b]);
  for (const [a, b] of segments) {
    const r = Math.max(a[2], b[2]);
    const box = canvasBox(inverse, { x0: Math.min(a[0], b[0]) - r, y0: Math.min(a[1], b[1]) - r, x1: Math.max(a[0], b[0]) + r, y1: Math.max(a[1], b[1]) + r }, all);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length2 = dx * dx + dy * dy;
    for (let y = box.y0; y < box.y1; y += 1) {
      const cy = y + 0.5;
      for (let x = box.x0; x < box.x1; x += 1) {
        const cx = x + 0.5;
        const w = m[6] * cx + m[7] * cy + m[8];
        const sx = (m[0] * cx + m[1] * cy + m[2]) / w;
        const sy = (m[3] * cx + m[4] * cy + m[5]) / w;
        const t = length2 > 0 ? Math.min(1, Math.max(0, ((sx - a[0]) * dx + (sy - a[1]) * dy) / length2)) : 0;
        const radius = a[2] + (b[2] - a[2]) * t;
        const q = Math.hypot(sx - a[0] - dx * t, sy - a[1] - dy * t) / radius;
        if (q >= 1) continue; // eslint-disable-line no-continue
        const cov = falloff(q, Math.min(1, Math.max(hardEdge, map.scale / radius)));
        const i = (y - all.y0) * bw + x - all.x0;
        if (cov > buffer[i]) buffer[i] = cov;
      }
    }
  }
  const rw = region.x1 - region.x0;
  const erase = stroke.mode === 'erase';
  for (let y = all.y0; y < all.y1; y += 1) {
    for (let x = all.x0; x < all.x1; x += 1) {
      const c = buffer[(y - all.y0) * bw + x - all.x0] * stroke.opacity;
      if (c <= 0) continue; // eslint-disable-line no-continue
      const i = (y - region.y0) * rw + x - region.x0;
      comp[i] = erase ? comp[i] * (1 - c) : comp[i] + c - comp[i] * c;
    }
  }
}

/**
 * Coverage of `mask` over canvas rows [y0, y1), columns [x0, x0 + width), as 8-bit codes
 * (row-major, `width` per row).
 * :param map: maskMap() for the canvas being rendered
 */
export function maskRows(mask, map, width, y0, y1, { x0 = 0, out = new Uint8ClampedArray(width * Math.max(0, y1 - y0)) } = {}) {
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
      const comp = new Float32Array(n);
      for (const stroke of component.strokes) addStroke(stroke, map, inverse, region, comp);
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

/** Coverage of a whole canvas of `size` ({ width, height, data } with one code per pixel). */
export const rasterizeMask = (mask, map, size) => ({ width: size.width, height: size.height, data: maskRows(mask, map, size.width, 0, size.height) });
