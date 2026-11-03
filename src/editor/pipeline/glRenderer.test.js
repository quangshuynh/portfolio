import { describe, expect, test } from 'vitest';
import { GlRenderer } from './glRenderer.mjs';

// A recording WebGL2 stand-in: each texture holds a description of what was drawn into it (the
// pipeline draw is replaced by one that names its parameters and input), so frames drawn by
// different paths can be compared exactly.
function recordingRenderer({ lost = false, width = 8, height = 6, fences = 'signalled' } = {}) {
  const units = new Map();
  let scissor = null;
  let unit = 0;
  let framebuffer = null;
  let program = null;
  const gl = new Proxy({
    canvas: { content: null },
    textures: 0,
    deletedTextures: 0,
    flushes: 0,
    FRAMEBUFFER_COMPLETE: 'complete',
    TEXTURE0: 0,
    isContextLost: () => lost,
    createTexture() { gl.textures += 1; return { content: null }; },
    deleteTexture() { gl.deletedTextures += 1; },
    createFramebuffer: () => ({ texture: null }),
    deleteFramebuffer() {},
    framebufferTexture2D(target, attachment, textarget, texture) { framebuffer.texture = texture; },
    bindFramebuffer(target, next) { framebuffer = next; },
    checkFramebufferStatus: () => 'complete',
    activeTexture(next) { unit = next; },
    bindTexture(target, texture) { units.set(unit, texture); },
    useProgram(next) { program = next; },
    flush() { gl.flushes += 1; },
    enable() { scissor = scissor ?? 'all'; },
    disable() { scissor = null; },
    scissor(x, y, w, h) { scissor = [y, h]; },
    // Fences: signalled at once, or (fences: 'manual') when the test calls gl.finishGpu().
    pending: [],
    fenceSync() { const fence = { signalled: fences === 'signalled' }; gl.pending.push(fence); return fence; },
    getSyncParameter: (fence) => (fence.signalled ? 'SIGNALED' : 'UNSIGNALED'),
    deleteSync() {},
    finishGpu() { gl.pending.forEach((fence) => { fence.signalled = true; }); },
    drawArrays() {
      // Units 8 and 7: the backdrop and the layer (glRenderer UNIT).
      const at = (index) => units.get(index)?.content;
      const content = program === 'composite' ? `mix(${at(8)},${at(7)})` : at(8);
      if (framebuffer) framebuffer.texture.content = content;
      else gl.canvas.content = content;
    },
  }, { get: (target, name) => (name in target ? target[name] : typeof name === 'string' && /^[A-Z_0-9]+$/.test(name) ? name : () => {}) });
  const renderer = Object.assign(Object.create(GlRenderer.prototype), {
    gl, texture: { id: 'source' }, uploaded: {}, creative: {}, width, height, targets: [], layerTextures: new Map(), maskTextures: new Map(), maskUploads: { full: 0, partial: 0 },
    compositor: { program: 'composite', copy: 'copy', uniforms: {}, frame: null },
    program: 'pipeline',
    retouchVersion: 0,
  });
  // The pipeline draw: what it would render, into the bound framebuffer (or the canvas).
  renderer.draw = (params, input = null) => {
    renderer.pipelineDraws = (renderer.pipelineDraws ?? 0) + 1;
    const content = `${params.tag}(${input?.content ?? `source${renderer.retouchVersion}`})`;
    const into = framebuffer ? framebuffer.texture : gl.canvas;
    // Bands (scissored rows) of one content are recorded; a full draw records none.
    if (Array.isArray(scissor)) into.bands = [...(into.content === content ? into.bands ?? [] : []), scissor];
    else into.bands = null;
    into.content = content;
  };
  return renderer;
}

const PARAMS = { tag: 'photo' };
const PASS = { kind: 'adjust', adjustments: { exposure: 1.5 }, lut: null, params: { tag: 'exposure' }, opacity: 1, mode: 0, mask: null };
// 2^18 px wide: the first band is two rows (WARM_BAND_PIXELS = 2^19), then bands double while the
// GPU keeps up: a 6-row photo frame takes bands of 2 and 4 rows, the adjustment frame one of 6.
const BANDS = [[[0, 2], [2, 4]], [[0, 6]]];
const WIDE = { width: 1 << 18, height: 6 };

/** Runs warm-up steps until done (fences signal at once); returns how many there were. */
function warmAll(renderer, params = PARAMS, baseKey = 'b', pass = PASS) {
  let steps = 1;
  while (renderer.warmStep(params, baseKey, pass)) steps += 1;
  return steps;
}

describe('first-stroke frame warming', () => {
  test('a warmed stroke draws nothing through the pipeline and equals the uncached frame', () => {
    const uncached = recordingRenderer(WIDE);
    uncached.render(PARAMS, { layers: [PASS] });
    const warmed = recordingRenderer(WIDE);
    warmed.render(PARAMS, { baseKey: 'b', keepFrames: true });
    // Three bands, then one step that finds both frames kept.
    expect(warmAll(warmed)).toBe(4);
    expect(warmed.gl.flushes).toBe(3);
    // The bands of each kept frame cover its rows once each.
    expect([...warmed.frames.values()].map(({ texture }) => texture.bands)).toEqual(BANDS);
    const draws = warmed.pipelineDraws;
    warmed.render(PARAMS, { layers: [PASS], baseKey: 'b' });
    expect(warmed.pipelineDraws).toBe(draws);
    expect(warmed.frameHits).toBe(2);
    expect(warmed.gl.canvas.content).toBe(uncached.gl.canvas.content);
    expect(warmed.gl.canvas.content).toBe('mix(photo(source0),exposure(photo(source0)))');
  });

  test('the next band waits until the GPU has finished the last one', () => {
    const renderer = recordingRenderer({ ...WIDE, fences: 'manual' });
    expect(renderer.warmStep(PARAMS, 'b', PASS)).toBe(true);
    const draws = renderer.pipelineDraws;
    expect(renderer.warmStep(PARAMS, 'b', PASS)).toBe(true);
    expect(renderer.warmStep(PARAMS, 'b', PASS)).toBe(true);
    expect(renderer.pipelineDraws).toBe(draws);
    renderer.gl.finishGpu();
    expect(renderer.warmStep(PARAMS, 'b', PASS)).toBe(true);
    expect(renderer.pipelineDraws).toBe(draws + 1);
  });

  test('bands shrink while the GPU is slow and grow while it keeps up', () => {
    const renderer = recordingRenderer({ width: 1 << 16, height: 64, fences: 'manual' });
    const band = () => renderer.warmJob.rows;
    renderer.warmStep(PARAMS, 'b', PASS);
    expect(band()).toBe(8);
    // Three steps found the band unfinished: the next is half as high, never under a quarter.
    for (let round = 0; round < 3; round += 1) {
      for (let i = 0; i < 3; i += 1) renderer.warmStep(PARAMS, 'b', PASS);
      renderer.gl.finishGpu();
      renderer.warmStep(PARAMS, 'b', PASS);
    }
    expect(band()).toBe(2);
    // One unfinished step keeps the size; a band done by the next step doubles it.
    renderer.warmStep(PARAMS, 'b', PASS);
    renderer.gl.finishGpu();
    renderer.warmStep(PARAMS, 'b', PASS);
    expect(band()).toBe(2);
    renderer.gl.finishGpu();
    renderer.warmStep(PARAMS, 'b', PASS);
    expect(band()).toBe(4);
  });

  test('a stroke during a warm-up drops the unfinished frame and draws its own, equal to uncached', () => {
    const uncached = recordingRenderer(WIDE);
    uncached.render(PARAMS, { layers: [PASS] });
    const renderer = recordingRenderer({ ...WIDE, fences: 'manual' });
    // Each band found unfinished once, so bands stay two rows: the photo's frame in three, then
    // the adjustment's first band.
    for (let i = 0; i < 4; i += 1) {
      renderer.warmStep(PARAMS, 'b', PASS);
      renderer.warmStep(PARAMS, 'b', PASS);
      renderer.gl.finishGpu();
    }
    expect(renderer.frames.size).toBe(1);
    expect(renderer.warmJob.target.texture.bands).toEqual([[0, 2]]);
    const textures = renderer.gl.textures - renderer.gl.deletedTextures;
    renderer.render(PARAMS, { layers: [PASS], baseKey: 'b' });
    expect(renderer.warmJob).toBeNull();
    expect(renderer.frameHits).toBe(1);
    expect(renderer.gl.canvas.content).toBe(uncached.gl.canvas.content);
    // The unfinished frame's target was freed and the stroke's adjustment frame made anew: three
    // layer targets, two kept frames and the 1 × 1 mask placeholder.
    expect(textures).toBe(5);
    expect(renderer.gl.textures - renderer.gl.deletedTextures).toBe(6);
    expect(renderer.frames.size).toBe(2);
  });

  test('warming kept frames does nothing; a plain render without keepFrames releases them', () => {
    const renderer = recordingRenderer();
    warmAll(renderer);
    const draws = renderer.pipelineDraws;
    expect(renderer.warmStep(PARAMS, 'b', PASS)).toBe(false);
    expect(renderer.pipelineDraws).toBe(draws);
    renderer.render(PARAMS, { baseKey: 'b', keepFrames: true });
    expect(renderer.frames.size).toBe(2);
    renderer.render(PARAMS);
    expect(renderer.frames.size).toBe(0);
  });

  test('frames warmed before a retouch, new settings or a new source are not read', () => {
    const renderer = recordingRenderer();
    warmAll(renderer);
    renderer.retouchVersion = 1;
    renderer.render(PARAMS, { layers: [PASS], baseKey: 'b' });
    expect(renderer.gl.canvas.content).toBe('mix(photo(source1),exposure(photo(source1)))');
    // New photo settings are a new baseKey; other adjustments a new pass key.
    warmAll(renderer);
    renderer.render({ tag: 'brighter' }, { layers: [{ ...PASS, adjustments: { exposure: 2 }, params: { tag: 'more' } }], baseKey: 'c' });
    expect(renderer.gl.canvas.content).toBe('mix(brighter(source1),more(brighter(source1)))');
    renderer.texture = { id: 'another photo' };
    renderer.frameHits = 0;
    renderer.render(PARAMS, { layers: [PASS], baseKey: 'b' });
    expect(renderer.frameHits ?? 0).toBe(0);
  });

  test('a warm-up whose settings change midway starts again and never keeps a mixed frame', () => {
    const renderer = recordingRenderer(WIDE);
    renderer.warmStep(PARAMS, 'b', PASS);
    warmAll(renderer, { tag: 'brighter' }, 'c');
    // Every row of each kept frame was drawn with the new settings.
    const frames = [...renderer.frames.values()].map(({ texture }) => [texture.content, texture.bands]);
    expect(frames).toEqual([['brighter(source0)', BANDS[0]], ['exposure(brighter(source0))', BANDS[1]]]);
  });

  test('the kept frames stay bounded however often a warm-up runs or restarts', () => {
    const renderer = recordingRenderer(WIDE);
    for (let i = 0; i < 10; i += 1) {
      const pass = { ...PASS, adjustments: { exposure: i } };
      renderer.warmStep({ tag: `p${i}` }, `b${i}`, pass);
      if (i % 2) warmAll(renderer, { tag: `p${i}` }, `b${i}`, pass);
    }
    expect(renderer.frames.size).toBe(2);
    expect(renderer.targets.length).toBe(3);
    expect(renderer.gl.textures - renderer.gl.deletedTextures).toBe(5);
    for (const { texture } of renderer.frames.values()) expect(texture.bands.reduce((rows, [, h]) => rows + h, 0)).toBe(6);
  });

  test('targets made by a warm-up are freed when the brush is put away unpainted; a stroke keeps them', () => {
    const renderer = recordingRenderer(WIDE);
    renderer.warmStep(PARAMS, 'b', PASS);
    renderer.render(PARAMS);
    expect(renderer.targets.length).toBe(0);
    expect(renderer.gl.textures - renderer.gl.deletedTextures).toBe(0);
    warmAll(renderer);
    renderer.render(PARAMS, { layers: [PASS], baseKey: 'b' });
    renderer.render(PARAMS);
    expect(renderer.targets.length).toBe(3);
    expect(renderer.frames.size).toBe(0);
  });

  test('nothing is warmed on a lost context, without a photo or without a key', () => {
    expect(recordingRenderer({ lost: true }).warmStep(PARAMS, 'b', PASS)).toBe(false);
    expect(Object.assign(recordingRenderer(), { texture: null }).warmStep(PARAMS, 'b', PASS)).toBe(false);
    const renderer = recordingRenderer();
    expect(renderer.warmStep(PARAMS, null, PASS)).toBe(false);
    expect(renderer.gl.textures).toBe(0);
  });
});
