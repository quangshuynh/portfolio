// Text layer layout and drawing, shared by the preview and the export: rasterizeTextLayer draws
// a layer into a sprite at the render's own resolution (the preview canvas, or the export size),
// which the layer compositor (pipeline/composite.mjs) places one pixel to one pixel. Layout is
// computed in the output's own pixels, so the text box is the same in the preview, at any zoom
// and at any export size; only the rasterisation resolution differs.
// Each object is drawn as a layer: outline, then fill, then the layer over the target with
// the object's opacity and shadow, so the outline and fill never double their alpha.

import { LINE_HEIGHT, fontPixels } from '../model/overlays.mjs';
import { fontString } from './fonts.mjs';

let measureContext = null;
const measurer = () => {
  if (measureContext !== null) return measureContext;
  try {
    measureContext = (typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1) : document.createElement('canvas')).getContext('2d') || false;
  } catch {
    measureContext = false;
  }
  return measureContext;
};

const createLayer = (width, height) => {
  if (typeof document !== 'undefined') return Object.assign(document.createElement('canvas'), { width, height });
  return new OffscreenCanvas(width, height);
};

/**
 * Layout of an overlay in output pixels, relative to the box centre: the text box (lines
 * of LINE_HEIGHT, as wide as the widest line) and the ink bounds, which can reach beyond it
 * (italic overhang, accents); unrotated, before outline and shadow.
 * :returns: { fontPx, lineHeight, lines, width, height, anchorX, bounds: { left, top, right, bottom } }
 */
export function layoutText(overlay, width, height) {
  const fontPx = fontPixels(overlay, width, height);
  const lines = overlay.text.split('\n');
  const lineHeight = fontPx * LINE_HEIGHT;
  const context = measurer();
  const metrics = lines.map((line) => {
    if (!context) return { width: line.length * fontPx * 0.6, left: 0, right: line.length * fontPx * 0.6, ascent: fontPx * 0.5, descent: fontPx * 0.5 };
    context.font = fontString(overlay, fontPx);
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    const m = context.measureText(line);
    return { width: m.width, left: m.actualBoundingBoxLeft ?? 0, right: m.actualBoundingBoxRight ?? m.width, ascent: m.actualBoundingBoxAscent ?? fontPx / 2, descent: m.actualBoundingBoxDescent ?? fontPx / 2 };
  });
  const boxWidth = Math.max(fontPx * 0.3, ...metrics.map((m) => m.width));
  const boxHeight = lines.length * lineHeight;
  const bounds = { left: -boxWidth / 2, right: boxWidth / 2, top: -boxHeight / 2, bottom: boxHeight / 2 };
  metrics.forEach((m, i) => {
    // Each line starts where its alignment puts it inside the box.
    const start = overlay.align === 'left' ? -boxWidth / 2 : overlay.align === 'right' ? boxWidth / 2 - m.width : -m.width / 2;
    const y = (i - (lines.length - 1) / 2) * lineHeight;
    bounds.left = Math.min(bounds.left, start - m.left);
    bounds.right = Math.max(bounds.right, start + m.right);
    bounds.top = Math.min(bounds.top, y - m.ascent);
    bounds.bottom = Math.max(bounds.bottom, y + m.descent);
  });
  return { fontPx, lineHeight, lines, metrics, width: boxWidth, height: boxHeight, bounds };
}

/** Outline width and shadow reach of an overlay, in output pixels. */
function extras(overlay, fontPx) {
  const outline = overlay.outline ? overlay.outline.width * fontPx : 0;
  const shadow = overlay.shadow ? overlay.shadow.blur * fontPx * 1.5 + overlay.shadow.distance * fontPx : 0;
  return { outline, shadow };
}

/** Corners of the overlay's ink rectangle (plus `pad`), mirrored by its flips and rotated, in output pixels. */
function corners(overlay, layout, width, height, pad) {
  const cx = overlay.x * width;
  const cy = overlay.y * height;
  const angle = (overlay.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const fx = overlay.flipH ? -1 : 1;
  const fy = overlay.flipV ? -1 : 1;
  const { left, top, right, bottom } = layout.bounds;
  return [[left - pad, top - pad], [right + pad, top - pad], [right + pad, bottom + pad], [left - pad, bottom + pad]]
    .map(([x, y]) => [cx + x * fx * cos - y * fy * sin, cy + x * fx * sin + y * fy * cos]);
}

/** The text box (unrotated layout box) and its rotated corners, in output pixels, for hit areas and handles. */
export function textBox(overlay, width, height) {
  const layout = layoutText(overlay, width, height);
  return { layout, width: layout.width, height: layout.height, center: [overlay.x * width, overlay.y * height] };
}

/**
 * Draws one overlay onto a 2D context.
 * :param view: { scale, offsetX, offsetY, width, height } maps output pixels to the target:
 *   target = offset + output × scale; `width`, `height` are the output size in pixels
 */
export function paintText(target, overlay, view) {
  if (!overlay.text.trim() || overlay.opacity <= 0) return;
  const { scale, offsetX, offsetY, width, height } = view;
  const layout = layoutText(overlay, width, height);
  const { outline, shadow } = extras(overlay, layout.fontPx);
  const ink = corners(overlay, layout, width, height, outline + 2 / scale).map(([x, y]) => [offsetX + x * scale, offsetY + y * scale]);
  const margin = shadow * scale;
  const canvasWidth = target.canvas.width;
  const canvasHeight = target.canvas.height;
  // The layer: the ink's bounding box, cut to the target plus the shadow's reach.
  const x0 = Math.max(-margin, Math.floor(Math.min(...ink.map(([x]) => x))));
  const y0 = Math.max(-margin, Math.floor(Math.min(...ink.map(([, y]) => y))));
  const x1 = Math.min(canvasWidth + margin, Math.ceil(Math.max(...ink.map(([x]) => x))));
  const y1 = Math.min(canvasHeight + margin, Math.ceil(Math.max(...ink.map(([, y]) => y))));
  if (x1 <= x0 || y1 <= y0) return;
  const layer = createLayer(Math.ceil(x1 - x0), Math.ceil(y1 - y0));
  const context = layer.getContext('2d');
  context.setTransform(scale, 0, 0, scale, offsetX + overlay.x * width * scale - x0, offsetY + overlay.y * height * scale - y0);
  context.rotate((overlay.rotation * Math.PI) / 180);
  if (overlay.flipH || overlay.flipV) context.scale(overlay.flipH ? -1 : 1, overlay.flipV ? -1 : 1);
  context.font = fontString(overlay, layout.fontPx);
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.miterLimit = 2;
  const lineStarts = layout.metrics.map((m) => (overlay.align === 'left' ? -layout.width / 2 : overlay.align === 'right' ? layout.width / 2 - m.width : -m.width / 2));
  const lineY = (i) => (i - (layout.lines.length - 1) / 2) * layout.lineHeight;
  if (overlay.outline) {
    context.strokeStyle = overlay.outline.color;
    context.lineWidth = outline * 2;
    layout.lines.forEach((line, i) => context.strokeText(line, lineStarts[i], lineY(i)));
  }
  context.fillStyle = overlay.color;
  layout.lines.forEach((line, i) => context.fillText(line, lineStarts[i], lineY(i)));
  target.save();
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.globalAlpha = overlay.opacity;
  if (overlay.shadow) {
    const { color, opacity, blur, distance, angle } = overlay.shadow;
    const radians = (angle * Math.PI) / 180;
    const rgb = [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16));
    target.shadowColor = `rgba(${rgb.join(', ')}, ${opacity})`;
    // Canvas shadows ignore the transform; σ = shadowBlur / 2.
    target.shadowBlur = blur * layout.fontPx * scale * 2;
    target.shadowOffsetX = Math.cos(radians) * distance * layout.fontPx * scale;
    target.shadowOffsetY = Math.sin(radians) * distance * layout.fontPx * scale;
  }
  target.drawImage(layer, x0, y0);
  target.restore();
  layer.width = 0;
  layer.height = 0;
}

/**
 * Rasterises a text layer for a render of `width` × `height` as straight RGBA8: a sprite just
 * large enough for its ink, outline and shadow, cut to the canvas, drawn at full opacity (the
 * compositor applies the layer's opacity and blend mode to text and shadow together).
 * :returns: { x, y, width, height, data } in canvas pixels, or null when nothing is drawn
 */
export function rasterizeTextLayer(layer, { width, height }) {
  if (!layer.text.trim()) return null;
  const layout = layoutText(layer, width, height);
  const { outline, shadow } = extras(layer, layout.fontPx);
  const points = corners(layer, layout, width, height, outline + shadow + 2);
  const x0 = Math.max(0, Math.floor(Math.min(...points.map(([x]) => x))));
  const y0 = Math.max(0, Math.floor(Math.min(...points.map(([, y]) => y))));
  const x1 = Math.min(width, Math.ceil(Math.max(...points.map(([x]) => x))));
  const y1 = Math.min(height, Math.ceil(Math.max(...points.map(([, y]) => y))));
  if (x1 <= x0 || y1 <= y0) return null;
  const canvas = createLayer(x1 - x0, y1 - y0);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  paintText(context, { ...layer, opacity: 1 }, { scale: 1, offsetX: -x0, offsetY: -y0, width, height });
  const { data } = context.getImageData(0, 0, x1 - x0, y1 - y0);
  canvas.width = 0;
  canvas.height = 0;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0, data };
}
