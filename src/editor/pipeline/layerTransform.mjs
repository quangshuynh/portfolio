// Placement of a layer on the canvas (the background's output frame) at a render's size.
// Everything is in that render's pixels, computed from the layer's canvas-relative fields
// (model/layers.mjs), so the preview at any zoom, the 1:1 view and an export of any size place
// a layer at the same part of the frame. The DOM never holds the authoritative geometry.
//
// An image layer's raster (its source decoded and developed at some size) is mapped onto its
// box: raster pixel (u, v) lands at centre + R(θ) · F · ((u / w − ½) · boxWidth, (v / h − ½) · boxHeight),
// with F the flips. Compositing inverts that (canvas pixel centre → raster position, as the
// geometry warp does) and samples with warp.mjs's kernel.

import { exactMapping } from './warp.mjs';

/** Box of an image layer on a canvas of `canvas` size: centre, size and angle in pixels/radians. */
export function layerFrame(layer, canvas) {
  const short = Math.min(canvas.width, canvas.height);
  return {
    cx: layer.x * canvas.width,
    cy: layer.y * canvas.height,
    width: layer.width * short,
    height: layer.height * short,
    angle: (layer.rotation * Math.PI) / 180,
    fx: layer.flipH ? -1 : 1,
    fy: layer.flipV ? -1 : 1,
  };
}

/** Corners of an image layer's box in canvas pixels (top left, top right, bottom right, bottom left of its content). */
export function layerCorners(layer, canvas) {
  const f = layerFrame(layer, canvas);
  const cos = Math.cos(f.angle);
  const sin = Math.sin(f.angle);
  return [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([u, v]) => {
    const x = u * f.width * f.fx;
    const y = v * f.height * f.fy;
    return [f.cx + x * cos - y * sin, f.cy + x * sin + y * cos];
  });
}

const snap = (value) => (Math.abs(value - Math.round(value)) < 1e-9 ? Math.round(value) : value) + 0;

/**
 * Canvas pixel → raster pixel matrix (row-major 3 × 3) for an image layer whose raster is
 * `raster` ({ width, height }); the inverse of the placement above.
 */
export function layerMatrix(layer, canvas, raster) {
  const f = layerFrame(layer, canvas);
  const cos = Math.cos(f.angle);
  const sin = Math.sin(f.angle);
  const ku = raster.width / (f.width * f.fx);
  const kv = raster.height / (f.height * f.fy);
  // u = ku · ( (X − cx)·cos + (Y − cy)·sin ) + w/2;  v = kv · ( −(X − cx)·sin + (Y − cy)·cos ) + h/2
  const m = [
    ku * cos, ku * sin, ku * (-f.cx * cos - f.cy * sin) + raster.width / 2,
    -kv * sin, kv * cos, kv * (f.cx * sin - f.cy * cos) + raster.height / 2,
    0, 0, 1,
  ];
  return m.map(snap);
}

/** Matrix of a raster already in canvas pixels, placed with its top left at (x, y): a text sprite. */
export const offsetMatrix = (x, y) => [1, 0, -x, 0, 1, -y, 0, 0, 1];

/** Raster pixels per canvas pixel along the most compressed direction (the edge fade's width). */
export function matrixScale(m) {
  return Math.max(1e-6, Math.min(Math.hypot(m[0], m[3]), Math.hypot(m[1], m[4])));
}

/**
 * Raster size an image layer needs at this canvas size: at least one raster pixel per canvas
 * pixel along each side of its box, never more than the source (no upscaling).
 */
export function rasterSize(layer, canvas, source = layer.source) {
  const f = layerFrame(layer, canvas);
  const k = Math.min(1, Math.max(f.width / source.width, f.height / source.height));
  return { width: Math.max(1, Math.min(source.width, Math.ceil(source.width * k))), height: Math.max(1, Math.min(source.height, Math.ceil(source.height * k))) };
}

/**
 * Canvas pixels a raster can touch, as a rectangle clipped to the canvas (the rest of the
 * canvas keeps the backdrop exactly), or null when the layer is entirely outside.
 */
export function rasterBounds(matrix, raster, canvas) {
  const det = matrix[0] * matrix[4] - matrix[1] * matrix[3];
  if (!det) return null;
  // Raster corners mapped forward through the inverse of the affine matrix.
  const forward = (u, v) => {
    const du = u - matrix[2];
    const dv = v - matrix[5];
    return [(matrix[4] * du - matrix[1] * dv) / det, (-matrix[3] * du + matrix[0] * dv) / det];
  };
  const points = [[0, 0], [raster.width, 0], [0, raster.height], [raster.width, raster.height]].map(([u, v]) => forward(u, v));
  const x0 = Math.max(0, Math.floor(Math.min(...points.map(([x]) => x))) - 2);
  const y0 = Math.max(0, Math.floor(Math.min(...points.map(([, y]) => y))) - 2);
  const x1 = Math.min(canvas.width, Math.ceil(Math.max(...points.map(([x]) => x))) + 2);
  const y1 = Math.min(canvas.height, Math.ceil(Math.max(...points.map(([, y]) => y))) + 2);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/** True when the matrix copies raster pixels one to one (a text sprite, an unscaled unrotated image). */
export const isExact = (matrix) => exactMapping(matrix) !== null;
