// Export sprites of text overlays (textRender.rasterizeOverlays): drawn over the finished
// canvas just before encoding, on the page or in the image worker. No fonts are needed here:
// the text was rasterised on the page at the export's resolution.

/** Draws export sprites over a finished canvas (page or worker) and releases them. */
export function compositeSprites(context, sprites) {
  if (!sprites?.length) return;
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
  for (const { bitmap, x, y } of sprites) {
    context.drawImage(bitmap, x, y);
    bitmap.close?.();
  }
  context.restore();
}
