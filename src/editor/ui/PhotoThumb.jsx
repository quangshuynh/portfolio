import React, { useEffect, useMemo, useRef } from 'react';
import { renderAnyImage } from '../pipeline/detailRenderer.mjs';
import { deriveParams } from '../pipeline/spec.mjs';
import { neutralGroup } from '../model/adjustments.mjs';
import { GeometryError, geometryPlan } from '../pipeline/geometry.mjs';
import { finishRows, warpImage, warpSpec } from '../pipeline/warp.mjs';

const THROTTLE_MS = 120;

/** The thumbnail with the photo's geometry (its proportions stand for the original's). */
function shaped(thumbnail, geometry) {
  if (!geometry) return { image: thumbnail, spec: null };
  try {
    const plan = geometryPlan(geometry, thumbnail);
    if (plan.identity) return { image: thumbnail, spec: null };
    const spec = warpSpec(plan, plan.native, thumbnail);
    return { image: warpImage(thumbnail, spec.matrix, spec), spec };
  } catch (error) {
    if (error instanceof GeometryError) return { image: thumbnail, spec: null };
    throw error;
  }
}

/**
 * Thumbnail rendered through the CPU pipeline, so it shows the photo's current edits
 * (geometry included). A RAW thumbnail is half-size sensor data scaled down, developed
 * like the preview.
 */
export default function PhotoThumb({ thumbnail, adjustments, lut = null, raw = null, photoWidth = 0 }) {
  const canvasRef = useRef(null);
  const lastRef = useRef(0);
  // What the thumbnail draws: neither local adjustments nor layers (so painting a mask does not
  // redraw it); Detail is left out too. A new object only when those settings change.
  const drawnKey = JSON.stringify({ ...adjustments, ...neutralGroup('detail'), local: null, layers: null });
  const drawn = useMemo(() => JSON.parse(drawnKey), [drawnKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !thumbnail) return undefined;
    const draw = () => {
      lastRef.current = performance.now();
      const { image, spec } = shaped(thumbnail, drawn.geometry);
      // Detail is left out (fine filters do not show at this size); creative effects are kept.
      const params = deriveParams(drawn, { lut, raw });
      // Grain and other scale-aware effects: the thumbnail is a downscale of the photo's output.
      const factor = photoWidth ? thumbnail.width / photoWidth : 1;
      const data = finishRows(spec, renderAnyImage(image, params, { nativeWidth: image.width / factor, nativeHeight: image.height / factor }), 0, image.height, false);
      canvas.width = image.width;
      canvas.height = image.height;
      canvas.getContext('2d').putImageData(new ImageData(data, image.width, image.height), 0, 0);
    };
    const wait = THROTTLE_MS - (performance.now() - lastRef.current);
    if (wait <= 0) { draw(); return undefined; }
    const timer = setTimeout(draw, wait);
    return () => clearTimeout(timer);
  }, [thumbnail, drawn, lut, raw, photoWidth]);

  // Unmounted (a closed dialog, a removed photo): the pixels go now. Chromium was seen keeping
  // a closed Merge HDR dialog's thumbnail canvases alive with no script reference to them.
  useEffect(() => {
    const canvas = canvasRef.current;
    return () => { if (canvas) { canvas.width = 0; canvas.height = 0; } };
  }, []);

  return <canvas ref={canvasRef} className="pe-thumb" aria-hidden="true" />;
}
