// Compares the WebGL2 shader with the CPU reference on a synthetic chart for a set
// of edits. Results land on window.parityResult for scripts/check-editor-browser.mjs.
import { ADJUSTMENTS } from '../model/adjustments.mjs';
import { renderRgba8 } from '../pipeline/cpuRenderer.mjs';
import { GlRenderer, createEditorContext } from '../pipeline/glRenderer.mjs';
import { deriveParams } from '../pipeline/spec.mjs';

// 64×64 = every RGB value in steps of 17 (16 levels per channel), opaque.
function chart() {
  const data = new Uint8ClampedArray(64 * 64 * 4);
  let i = 0;
  for (let r = 0; r < 16; r += 1) for (let g = 0; g < 16; g += 1) for (let b = 0; b < 16; b += 1) {
    data.set([r * 17, g * 17, b * 17, 255], i);
    i += 4;
  }
  return { width: 64, height: 64, data };
}

const EDITS = [
  ['neutral', {}],
  ...ADJUSTMENTS.flatMap(({ key, min, max }) => [[`${key} ${min}`, { [key]: min }], [`${key} +${max}`, { [key]: max }]]),
  ['combined', { exposure: 0.35, contrast: 25, highlights: -60, shadows: 40, whites: 10, blacks: -15, temperature: 18, tint: -6, vibrance: 30, saturation: -10 }],
  ['strong', { exposure: 1.5, contrast: 80, highlights: -100, shadows: 100, temperature: -70, tint: 40, vibrance: 100, saturation: 60 }],
];

function run() {
  const canvas = document.createElement('canvas');
  const gl = createEditorContext(canvas);
  if (!gl) return { available: false };
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = new GlRenderer(canvas, gl);
  const source = chart();
  renderer.setSource(source);
  const results = EDITS.map(([name, adjustments]) => {
    const params = deriveParams(adjustments);
    const gpu = renderer.readPixels(params);
    const cpu = renderRgba8(source.data, params);
    let max = 0;
    let sum = 0;
    let over1 = 0;
    for (let i = 0; i < cpu.length; i += 4) {
      for (let c = 0; c < 3; c += 1) {
        const diff = Math.abs(gpu[i + c] - cpu[i + c]);
        max = Math.max(max, diff);
        sum += diff;
        if (diff > 1) over1 += 1;
      }
    }
    return { name, max, mean: sum / (cpu.length * 0.75), over1 };
  });
  // Split comparison: the left half must be the untouched source.
  const split = renderer.readPixels(deriveParams(EDITS.at(-1)[1]), { split: 0.5 });
  let splitSourceExact = true;
  for (let y = 0; y < 64; y += 1) for (let x = 0; x < 32; x += 1) {
    const i = (y * 64 + x) * 4;
    for (let c = 0; c < 4; c += 1) if (split[i + c] !== source.data[i + c]) splitSourceExact = false;
  }
  renderer.dispose();
  return {
    available: true,
    gpu: (debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER),
    results,
    splitSourceExact,
  };
}

window.parityResult = run();
