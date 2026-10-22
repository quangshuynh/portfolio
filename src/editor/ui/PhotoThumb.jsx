import React, { useEffect, useRef } from 'react';
import { renderRgba8 } from '../pipeline/cpuRenderer.mjs';
import { deriveParams } from '../pipeline/spec.mjs';

const THROTTLE_MS = 120;

/** Thumbnail rendered through the CPU pipeline, so it shows the photo's current edits. */
export default function PhotoThumb({ thumbnail, adjustments, lut = null }) {
  const canvasRef = useRef(null);
  const lastRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !thumbnail) return undefined;
    const draw = () => {
      lastRef.current = performance.now();
      const data = renderRgba8(thumbnail.data, deriveParams(adjustments, { lut }));
      canvas.width = thumbnail.width;
      canvas.height = thumbnail.height;
      canvas.getContext('2d').putImageData(new ImageData(data, thumbnail.width, thumbnail.height), 0, 0);
    };
    const wait = THROTTLE_MS - (performance.now() - lastRef.current);
    if (wait <= 0) { draw(); return undefined; }
    const timer = setTimeout(draw, wait);
    return () => clearTimeout(timer);
  }, [thumbnail, adjustments, lut]);

  return <canvas ref={canvasRef} className="pe-thumb" aria-hidden="true" />;
}
