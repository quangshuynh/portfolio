// Draws the HUYNH Photography mark (watermark.mjs) with the 2D canvas API. The preview, every
// export (single, batch, RAW, HDR) and the CMS render call these same functions; only the
// output size differs, and the mark is always rasterised at that size, never scaled up.
// The mark is drawn opaque into a sprite exactly the size of its box (whole pixels), then
// composited once with the chosen opacity, so the border, rules and letters never double
// their alpha where they meet, and the canvas's premultiplied source-over blend keeps thin
// strokes free of dark fringes.
//
// Fonts: the static Schibsted Grotesk 500 and 800 instances (OFL 1.1, latin subset, about 25 kB
// each, from this site), not the variable font text layers use: WebKit draws a variable face
// at its default weight on a canvas whatever weight is asked for (checked in Playwright WebKit),
// while static faces draw the same weights in every engine. Their advances equal the table in
// watermark.mjs (measured in Chromium, Firefox and WebKit).

import mark500 from '@fontsource/schibsted-grotesk/files/schibsted-grotesk-latin-500-normal.woff2?url';
import mark800 from '@fontsource/schibsted-grotesk/files/schibsted-grotesk-latin-800-normal.woff2?url';
import { DESIGN, layoutWatermark, regionLuminance, resolveWatermarkColor, sampleBox } from './watermark.mjs';

export const MARK_FAMILY = 'PE HUYNH Mark';
const FAMILY = `"${MARK_FAMILY}", sans-serif`;

let loading = null;
/** Loads the mark's two faces once; the mark is drawn only after they are ready. */
export function loadWatermarkFonts(fontSet = globalThis.document?.fonts) {
  if (!fontSet || typeof FontFace !== 'function') return Promise.resolve(false);
  loading ??= Promise.all([[mark500, '500'], [mark800, '800']].map(async ([url, weight]) => {
    const face = new FontFace(MARK_FAMILY, `url(${url}) format('woff2')`, { weight, style: 'normal' });
    fontSet.add(face);
    await face.load();
  })).then(() => true).catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}

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
  const rects = [];
  if (layout.border) {
    const { x, y, width, height, stroke } = layout;
    rects.push([x, y, width, stroke], [x, y + height - stroke, width, stroke], [x, y + stroke, stroke, height - 2 * stroke], [x + width - stroke, y + stroke, stroke, height - 2 * stroke]);
  }
  layout.rules.forEach((rule) => rects.push([rule.x, rule.y, rule.width, rule.height]));
  const letters = (paint) => {
    for (const line of layout.lines) {
      context.font = `${line.weight} ${line.px}px ${FAMILY}`;
      let x = line.x;
      [...line.text].forEach((char, i) => {
        paint(char, x, line.baseline);
        x += line.advances[i] + line.tracking;
      });
    }
  };
  context.save();
  context.translate(offsetX, offsetY);
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  const halo = layout.halo ?? 0;
  if (halo > 0) {
    // The outline first, in the other colour; the mark is filled over it at full strength.
    const outline = color === DESIGN.colors.white ? DESIGN.colors.dark : DESIGN.colors.white;
    context.globalAlpha = DESIGN.outline.alpha;
    context.fillStyle = outline;
    context.strokeStyle = outline;
    context.lineWidth = 2 * halo;
    context.lineJoin = 'round';
    rects.forEach(([x, y, width, height]) => context.fillRect(x - halo, y - halo, width + 2 * halo, height + 2 * halo));
    letters((char, x, y) => context.strokeText(char, x, y));
    context.globalAlpha = 1;
  }
  context.fillStyle = color;
  rects.forEach(([x, y, width, height]) => context.fillRect(x, y, width, height));
  letters((char, x, y) => context.fillText(char, x, y));
  context.restore();
}

/** The painted area of a layout: its box, grown by the outline (older layouts have no bounds). */
export const markBounds = (layout) => layout.bounds ?? { x: layout.x, y: layout.y, width: layout.width, height: layout.height };

/** The opaque mark in `color` on a transparent sprite of its painted area (`markBounds`). */
export function renderMarkSprite(layout, color) {
  const bounds = markBounds(layout);
  const sprite = createSurface(Math.max(1, Math.ceil(bounds.width)), Math.max(1, Math.ceil(bounds.height)));
  drawMark(sprite.getContext('2d'), layout, color, { offsetX: -bounds.x, offsetY: -bounds.y });
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
  const bounds = markBounds(layout);
  context.drawImage(sprite, bounds.x, bounds.y);
  context.restore();
  releaseSurface(sprite);
  return { layout, variant, luminance };
}
