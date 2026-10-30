// Draws the HUYNH Photography mark (watermark.mjs) with the 2D canvas API. The preview, every
// export (single, batch, RAW, HDR) and the CMS render call these same functions; only the
// output size differs, and the mark is always rasterised at that size, never scaled up.
// The mark is drawn opaque into a sprite exactly the size of its box (whole pixels), then
// composited once with the chosen opacity, so the border, rules and letters never double
// their alpha where they meet, and the canvas's premultiplied source-over blend keeps thin
// strokes free of dark fringes.

import { loadTextFonts, fontFamily } from '../text/fonts.mjs';
import { DESIGN, layoutWatermark, regionLuminance, resolveWatermarkColor, sampleBox } from './watermark.mjs';

const FAMILY = fontFamily({ font: DESIGN.font });

/** Loads the bundled font once (shared with text layers); the mark is drawn only after it. */
export const loadWatermarkFonts = () => loadTextFonts();

const createSurface = (width, height) => {
  if (typeof document !== 'undefined') return Object.assign(document.createElement('canvas'), { width, height });
  return new OffscreenCanvas(width, height);
};

/**
 * Draws a layout opaque in `color` onto `context`, shifted by (offsetX, offsetY).
 * Letters are placed one by one from the fixed advance table, so their positions are the
 * same in every browser.
 */
export function drawMark(context, layout, color, { offsetX = 0, offsetY = 0 } = {}) {
  context.save();
  context.translate(offsetX, offsetY);
  context.fillStyle = color;
  if (layout.border) {
    const { x, y, width, height, stroke } = layout;
    context.fillRect(x, y, width, stroke);
    context.fillRect(x, y + height - stroke, width, stroke);
    context.fillRect(x, y + stroke, stroke, height - 2 * stroke);
    context.fillRect(x + width - stroke, y + stroke, stroke, height - 2 * stroke);
  }
  layout.rules.forEach((rule) => context.fillRect(rule.x, rule.y, rule.width, rule.height));
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  for (const line of layout.lines) {
    context.font = `${line.weight} ${line.px}px ${FAMILY}`;
    let x = line.x;
    [...line.text].forEach((char, i) => {
      context.fillText(char, x, line.baseline);
      x += line.advances[i] + line.tracking;
    });
  }
  context.restore();
}

/** The opaque mark in `color` on a transparent sprite of its box. */
export function renderMarkSprite(layout, color) {
  const sprite = createSurface(Math.max(1, Math.ceil(layout.width)), Math.max(1, Math.ceil(layout.height)));
  drawMark(sprite.getContext('2d'), layout, color, { offsetX: -layout.x, offsetY: -layout.y });
  return sprite;
}

/** Frees a sprite's pixels now rather than at the next collection. */
export const releaseSurface = (surface) => { surface.width = 0; surface.height = 0; };

/**
 * Composites the watermark over a finished frame in place (the export's last step before
 * encoding). Auto colour reads only the pixels behind the mark (getImageData of that region).
 * :param context: 2D context of the output canvas, `size` its { width, height }
 * :returns: { layout, variant: 'white' | 'dark', luminance } (luminance null unless auto)
 */
export function applyWatermark(context, settings, size) {
  const layout = layoutWatermark(settings, size.width, size.height);
  let luminance = null;
  if (settings.color === 'auto') {
    const box = sampleBox(layout);
    const x = Math.max(0, Math.floor(box.x));
    const y = Math.max(0, Math.floor(box.y));
    const width = Math.min(size.width, Math.ceil(box.x + box.width)) - x;
    const height = Math.min(size.height, Math.ceil(box.y + box.height)) - y;
    if (width > 0 && height > 0) luminance = regionLuminance(context.getImageData(x, y, width, height)).mean;
  }
  const variant = resolveWatermarkColor(settings, luminance ?? 0);
  const sprite = renderMarkSprite(layout, DESIGN.colors[variant]);
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = settings.opacity;
  context.globalCompositeOperation = 'source-over';
  context.imageSmoothingEnabled = false;
  context.drawImage(sprite, layout.x, layout.y);
  context.restore();
  releaseSurface(sprite);
  return { layout, variant, luminance };
}
