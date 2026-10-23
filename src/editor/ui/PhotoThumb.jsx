import React, { useEffect, useRef } from 'react';
import { renderImage } from '../pipeline/cpuRenderer.mjs';
import { deriveParams } from '../pipeline/spec.mjs';

const THROTTLE_MS = 120;

/**
 * Thumbnail rendered through the CPU pipeline, so it shows the photo's current edits.
 * A RAW thumbnail is half-size sensor data scaled down, developed like the preview.
 */
export default function PhotoThumb({ thumbnail, adjustments, lut = null, raw = null }) {
  const canvasRef = useRef(null);
  const lastRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !thumbnail) return undefined;
    const draw = () => {
      lastRef.current = performance.now();
      const data = renderImage(thumbnail, deriveParams(adjustments, { lut, raw }));
      canvas.width = thumbnail.width;
      canvas.height = thumbnail.height;
      canvas.getContext('2d').putImageData(new ImageData(data, thumbnail.width, thumbnail.height), 0, 0);
    };
    const wait = THROTTLE_MS - (performance.now() - lastRef.current);
    if (wait <= 0) { draw(); return undefined; }
    const timer = setTimeout(draw, wait);
    return () => clearTimeout(timer);
  }, [thumbnail, adjustments, lut, raw]);

  return <canvas ref={canvasRef} className="pe-thumb" aria-hidden="true" />;
}
