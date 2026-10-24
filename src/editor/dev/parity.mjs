// Compares the WebGL2 shader with the CPU reference on a synthetic chart for a set
// of edits. Results land on window.parityResult for scripts/check-editor-browser.mjs.
import { ADJUSTMENTS, neutralAdjustments } from '../model/adjustments.mjs';
import { renderRawRgba8, renderRgba8 } from '../pipeline/cpuRenderer.mjs';
import { renderDetailImage } from '../pipeline/detailRenderer.mjs';
import { GlRenderer, createEditorContext } from '../pipeline/glRenderer.mjs';
import { identityLut } from '../pipeline/lut.mjs';
import { deriveParams } from '../pipeline/spec.mjs';
import { geometryPlan, normalizeGeometry } from '../pipeline/geometry.mjs';
import { applyCoverage, warpImage, warpSpec } from '../pipeline/warp.mjs';
import { lookLut } from './lutFixtures.mjs';

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

// RAW: 64×64 camera RGB covering the 16-bit range, with saturated and clipped values,
// developed with the Sony ILCE-7M3 matrix and as-shot balance LibRaw reports.
function rawChart() {
  const data = new Uint16Array(64 * 64 * 3);
  for (let i = 0; i < 64 * 64; i += 1) {
    const r = i % 16;
    const g = (i >> 4) % 16;
    const b = i >> 8;
    data.set([r, g, b].map((v) => Math.round(((v / 15) ** 2.2) * 65535)), i * 3);
  }
  return { kind: 'raw', width: 64, height: 64, data };
}
const RAW_INFO = {
  asShot: [2.33984375, 1, 1.53515625],
  rgbCam: [1.635386, -0.421962, -0.213424, -0.131072, 1.542707, -0.411635, 0.01143, -0.419593, 1.408163],
  camXyz: [0.7374, -0.2389, -0.0551, -0.5435, 1.3162, 0.2519, -0.1006, 0.1795, 0.6552],
};

const ref = (name) => ({ sha256: name.padEnd(64, '0').replace(/[^0-9a-f]/g, '0').slice(0, 64), name });
const LUTS = { identity: identityLut(33), look17: lookLut(17), look33: lookLut(33), look65: lookLut(65) };
const COMBINED = { exposure: 0.35, contrast: 25, highlights: -60, shadows: 40, whites: 10, blacks: -15, temperature: 18, tint: -6, vibrance: 30, saturation: -10 };
const CURVES = { master: [[0, 10], [64, 50], [190, 210], [255, 245]], red: [[0, 0], [128, 150], [255, 255]], blue: [[30, 0], [200, 220], [255, 255]] };

// [name, adjustments, LUT key]
const EDITS = [
  ['neutral', {}],
  ...ADJUSTMENTS.filter(({ key }) => key !== 'lutIntensity').flatMap(({ key, min, max }) => [[`${key} ${min}`, { [key]: min }], [`${key} +${max}`, { [key]: max }]]),
  ['combined', COMBINED],
  ['strong', { exposure: 1.5, contrast: 80, highlights: -100, shadows: 100, temperature: -70, tint: 40, vibrance: 100, saturation: 60 }],
  ['curves', { curves: CURVES }],
  ['curves inverted', { curves: { master: [[0, 255], [255, 0]] } }],
  ['identity LUT 33', { lut: ref('identity') }, 'identity'],
  ['look LUT 17', { lut: ref('look17') }, 'look17'],
  ['look LUT 33 at 40%', { lut: ref('look33'), lutIntensity: 40 }, 'look33'],
  ['look LUT 65', { lut: ref('look65') }, 'look65'],
  ['HSL mixed', { redHue: 60, orangeSaturation: -40, yellowLuminance: 50, greenHue: -80, aquaSaturation: 70, blueLuminance: -60, purpleHue: 40, magentaSaturation: -100 }],
  ['everything', { ...COMBINED, curves: CURVES, orangeHue: -20, blueLuminance: -40, greenSaturation: -50, lut: ref('look33'), lutIntensity: 70 }, 'look33'],
];

const RAW_EDITS = [
  ['RAW neutral', {}],
  ['RAW exposure -2', { exposure: -2 }],
  ['RAW exposure +2 (rolloff)', { exposure: 2 }],
  ['RAW daylight', { raw: { whiteBalance: 'daylight' } }],
  ['RAW custom 3200 K +40', { raw: { whiteBalance: 'custom' }, rawTemperature: 3200, rawTint: 40 }],
  ['RAW combined', { ...COMBINED, raw: { whiteBalance: 'custom' }, rawTemperature: 7500, rawTint: -30 }],
  ['RAW everything', { ...COMBINED, exposure: 1.2, curves: CURVES, orangeHue: -20, blueLuminance: -40, lut: ref('look33'), lutIntensity: 70 }, 'look33'],
];

// Merged RAW HDR: float camera RGB up to 4x the sensor white (a -2 EV darkest frame).
const HDR_INFO = { ...RAW_INFO, hdrWhite: 4 };
function hdrChart() {
  const raw = rawChart();
  return { kind: 'hdr', width: 64, height: 64, data: Float32Array.from(raw.data, (v, i) => (v / 65535) * (i % 7 === 0 ? 4 : 1.7)) };
}
const HDR_EDITS = [
  ['HDR neutral', {}],
  ['HDR exposure -1', { exposure: -1 }],
  ['HDR exposure +1.5', { exposure: 1.5 }],
  ['HDR compression 0', { hdrHighlights: 0 }],
  ['HDR compression 100', { hdrHighlights: 100 }],
  ['HDR shadow lift 100', { hdrShadows: 100 }],
  ['HDR stronger look', { hdrHighlights: 85, hdrShadows: 45 }],
  ['HDR daylight', { raw: { whiteBalance: 'daylight' } }],
  ['HDR everything', { ...COMBINED, hdrHighlights: 70, hdrShadows: 30, curves: CURVES, orangeHue: -20, lut: ref('look33'), lutIntensity: 70 }, 'look33'],
];

// Geometry: the shader's warp against warpImage + the CPU renderer + applyCoverage.
const GEOMETRIES = [
  ['quarter turn, flip, crop', { quarterTurns: 1, flipH: true, crop: { x: 0.125, y: 0.25, width: 0.75, height: 0.5 } }],
  ['straighten 7.5°', { angle: 7.5, crop: { x: 0.15, y: 0.15, width: 0.7, height: 0.7 } }],
  ['perspective', { perspective: { vertical: 70, horizontal: -40 } }],
  ['stretch and resize', { stretch: { x: 160, y: 100 }, resize: { width: 40, height: 40, locked: true } }],
  ['rotated, transparent corners', { angle: -20, constrain: false }],
  ['rotated, white corners', { angle: 33, constrain: false, background: 'white' }],
];
const GEOMETRY_EDIT = { ...COMBINED, curves: CURVES };

function geometryCase(renderer, source, geometry, adjustments, info = null) {
  const plan = geometryPlan(normalizeGeometry(geometry), source);
  const spec = warpSpec(plan, plan.native, source);
  renderer.setSource(source);
  renderer.setGeometry(spec);
  const params = deriveParams(adjustments, { raw: info });
  const warped = warpImage(source, spec.matrix, spec);
  const cpu = source.kind ? renderRawRgba8(warped.data, params) : renderRgba8(warped.data, params);
  if (spec.coverage) applyCoverage(cpu, spec.width, 0, spec.height, spec);
  return compare(renderer.readPixels(params), cpu);
}

function compare(gpu, cpu) {
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
    if (gpu[i + 3] !== cpu[i + 3]) over1 += 1;
  }
  return { max, mean: sum / (cpu.length * 0.75), over1 };
}

function run() {
  const canvas = document.createElement('canvas');
  const gl = createEditorContext(canvas);
  if (!gl) return { available: false };
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = new GlRenderer(canvas, gl);
  const source = chart();
  renderer.setSource(source);
  const results = EDITS.map(([name, adjustments, lutKey]) => {
    const params = deriveParams(adjustments, { lut: lutKey ? LUTS[lutKey] : null });
    return { name, ...compare(renderer.readPixels(params), renderRgba8(source.data, params)) };
  });
  // Split comparison: the left half must be the untouched source.
  const split = renderer.readPixels(deriveParams(EDITS.at(-1)[1], { lut: LUTS.look33 }), { split: 0.5 });
  let splitSourceExact = true;
  for (let y = 0; y < 64; y += 1) for (let x = 0; x < 32; x += 1) {
    const i = (y * 64 + x) * 4;
    for (let c = 0; c < 4; c += 1) if (split[i + c] !== source.data[i + c]) splitSourceExact = false;
  }
  // RAW sources: 16-bit integer texture, developed in the shader.
  const raw = rawChart();
  renderer.setSource(raw);
  const rawResults = RAW_EDITS.map(([name, adjustments, lutKey]) => {
    const params = deriveParams(adjustments, { lut: lutKey ? LUTS[lutKey] : null, raw: RAW_INFO });
    return { name, ...compare(renderer.readPixels(params), renderRawRgba8(raw.data, params)) };
  });
  // RAW split: the left half is the neutral development, not undeveloped sensor data.
  const before = deriveParams(neutralAdjustments(), { raw: RAW_INFO });
  const rawSplit = renderer.readPixels(deriveParams(RAW_EDITS.at(-1)[1], { lut: LUTS.look33, raw: RAW_INFO }), { split: 0.5, before });
  const neutralCpu = renderRawRgba8(raw.data, before);
  let rawSplitMax = 0;
  for (let y = 0; y < 64; y += 1) for (let x = 0; x < 32; x += 1) {
    const i = (y * 64 + x) * 4;
    for (let c = 0; c < 3; c += 1) rawSplitMax = Math.max(rawSplitMax, Math.abs(rawSplit[i + c] - neutralCpu[i + c]));
  }
  // Merged HDR sources: RGB32F texture, developed with the HDR tone stage.
  const hdr = hdrChart();
  renderer.setSource(hdr);
  const hdrResults = HDR_EDITS.map(([name, adjustments, lutKey]) => {
    const params = deriveParams(adjustments, { lut: lutKey ? LUTS[lutKey] : null, raw: HDR_INFO });
    return { name, ...compare(renderer.readPixels(params), renderRawRgba8(hdr.data, params)) };
  });
  const hdrBefore = deriveParams(neutralAdjustments(), { raw: HDR_INFO });
  const hdrSplit = renderer.readPixels(deriveParams(HDR_EDITS.at(-1)[1], { lut: LUTS.look33, raw: HDR_INFO }), { split: 0.5, before: hdrBefore });
  const hdrNeutral = renderRawRgba8(hdr.data, hdrBefore);
  let hdrSplitMax = 0;
  for (let y = 0; y < 64; y += 1) for (let x = 0; x < 32; x += 1) {
    const i = (y * 64 + x) * 4;
    for (let c = 0; c < 3; c += 1) hdrSplitMax = Math.max(hdrSplitMax, Math.abs(hdrSplit[i + c] - hdrNeutral[i + c]));
  }
  // Detail: the CPU frame drawn by the GPU must come out unchanged, the split side being
  // the shader's neutral development (RAW) or the source.
  const DETAIL = { clarity: 40, sharpening: 60, texture: -30, luminanceNoise: 20 };
  const detailFrame = { width: 64, height: 64, data: renderDetailImage(raw, deriveParams(DETAIL, { raw: RAW_INFO })) };
  renderer.setSource(raw);
  const drawn = renderer.readPixels(deriveParams(DETAIL, { raw: RAW_INFO }), { rendered: detailFrame, split: 0.5, before });
  let detailFrameMax = 0;
  let detailSplitMax = 0;
  for (let y = 0; y < 64; y += 1) for (let x = 0; x < 64; x += 1) {
    const i = (y * 64 + x) * 4;
    for (let c = 0; c < 3; c += 1) {
      if (x < 32) detailSplitMax = Math.max(detailSplitMax, Math.abs(drawn[i + c] - neutralCpu[i + c]));
      else detailFrameMax = Math.max(detailFrameMax, Math.abs(drawn[i + c] - detailFrame.data[i + c]));
    }
  }
  const transparent = chart();
  for (let i = 3; i < transparent.data.length; i += 4) transparent.data[i] = (i >> 2) % 64 < 16 ? 0 : 255;
  const geometryResults = [
    ...GEOMETRIES.map(([name, geometry]) => ({ name: `RGBA ${name}`, ...geometryCase(renderer, source, geometry, GEOMETRY_EDIT) })),
    ...GEOMETRIES.slice(0, 3).map(([name, geometry]) => ({ name: `alpha ${name}`, ...geometryCase(renderer, transparent, geometry, GEOMETRY_EDIT) })),
    ...GEOMETRIES.map(([name, geometry]) => ({ name: `RAW ${name}`, ...geometryCase(renderer, raw, geometry, GEOMETRY_EDIT, RAW_INFO) })),
    ...GEOMETRIES.slice(1, 3).map(([name, geometry]) => ({ name: `HDR ${name}`, ...geometryCase(renderer, hdr, geometry, { hdrHighlights: 70 }, HDR_INFO) })),
  ];
  renderer.setSource(source);
  // Rendering many frames back to back with changing curves and LUTs (texture reuse).
  const started = performance.now();
  for (let frame = 0; frame < 30; frame += 1) renderer.render(deriveParams({ ...EDITS.at(-1)[1], lutIntensity: frame * 3 }, { lut: LUTS.look33 }));
  gl.finish();
  const frameMs = (performance.now() - started) / 30;
  renderer.dispose();
  return {
    available: true,
    gpu: (debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER),
    results,
    splitSourceExact,
    rawResults,
    rawSplitMax,
    hdrResults,
    hdrSplitMax,
    detailFrameMax,
    detailSplitMax,
    geometryResults,
    frameMs64: Number(frameMs.toFixed(3)),
  };
}

window.parityResult = run();
