import { describe, expect, test } from 'vitest';
import { GlRenderer } from './glRenderer.mjs';

// A recording WebGL2 stand-in: each texture holds a description of what was drawn into it (the
// pipeline draw is replaced by one that names its parameters and input), so frames drawn by
// different paths can be compared exactly.
function recordingRenderer({ lost = false } = {}) {
  const units = new Map();
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
    drawArrays() {
      // Units 8 and 7: the backdrop and the layer (glRenderer UNIT).
      const at = (index) => units.get(index)?.content;
      const content = program === 'composite' ? `mix(${at(8)},${at(7)})` : at(8);
      if (framebuffer) framebuffer.texture.content = content;
      else gl.canvas.content = content;
    },
  }, { get: (target, name) => (name in target ? target[name] : typeof name === 'string' && /^[A-Z_0-9]+$/.test(name) ? name : () => {}) });
  const renderer = Object.assign(Object.create(GlRenderer.prototype), {
    gl, texture: { id: 'source' }, uploaded: {}, creative: {}, width: 8, height: 6, targets: [], layerTextures: new Map(), maskTextures: new Map(), maskUploads: { full: 0, partial: 0 },
    compositor: { program: 'composite', copy: 'copy', uniforms: {}, frame: null },
    program: 'pipeline',
    retouchVersion: 0,
  });
  // The pipeline draw: what it would render, into the bound framebuffer (or the canvas).
  renderer.draw = (params, input = null) => {
    renderer.pipelineDraws = (renderer.pipelineDraws ?? 0) + 1;
    const content = `${params.tag}(${input?.content ?? `source${renderer.retouchVersion}`})`;
    if (framebuffer) framebuffer.texture.content = content;
    else gl.canvas.content = content;
  };
  return renderer;
}

const PARAMS = { tag: 'photo' };
const PASS = { kind: 'adjust', adjustments: { exposure: 1.5 }, lut: null, params: { tag: 'exposure' }, opacity: 1, mode: 0, mask: null };

describe('first-stroke frame warming', () => {
  test('a warmed stroke draws nothing through the pipeline and equals the uncached frame', () => {
    const uncached = recordingRenderer();
    uncached.render(PARAMS, { layers: [PASS] });
    const warmed = recordingRenderer();
    warmed.render(PARAMS, { baseKey: 'b', keepFrames: true });
    expect(warmed.warmFrames(PARAMS, 'b', PASS)).toBe(2);
    expect(warmed.gl.flushes).toBe(1);
    const draws = warmed.pipelineDraws;
    warmed.render(PARAMS, { layers: [PASS], baseKey: 'b' });
    expect(warmed.pipelineDraws).toBe(draws);
    expect(warmed.frameHits).toBe(2);
    expect(warmed.gl.canvas.content).toBe(uncached.gl.canvas.content);
    expect(warmed.gl.canvas.content).toBe('mix(photo(source0),exposure(photo(source0)))');
  });

  test('warming twice draws once, and a plain render without keepFrames releases the frames', () => {
    const renderer = recordingRenderer();
    expect(renderer.warmFrames(PARAMS, 'b', PASS)).toBe(2);
    expect(renderer.warmFrames(PARAMS, 'b', PASS)).toBe(0);
    expect(renderer.gl.flushes).toBe(1);
    renderer.render(PARAMS, { baseKey: 'b', keepFrames: true });
    expect(renderer.frames.size).toBe(2);
    renderer.render(PARAMS);
    expect(renderer.frames.size).toBe(0);
  });

  test('frames warmed before a retouch, new settings or a new source are not read', () => {
    const renderer = recordingRenderer();
    renderer.warmFrames(PARAMS, 'b', PASS);
    renderer.retouchVersion = 1;
    renderer.render(PARAMS, { layers: [PASS], baseKey: 'b' });
    expect(renderer.gl.canvas.content).toBe('mix(photo(source1),exposure(photo(source1)))');
    // New photo settings are a new baseKey; other adjustments a new pass key.
    renderer.warmFrames(PARAMS, 'b', PASS);
    renderer.render({ tag: 'brighter' }, { layers: [{ ...PASS, adjustments: { exposure: 2 }, params: { tag: 'more' } }], baseKey: 'c' });
    expect(renderer.gl.canvas.content).toBe('mix(brighter(source1),more(brighter(source1)))');
    renderer.texture = { id: 'another photo' };
    renderer.frameHits = 0;
    renderer.render(PARAMS, { layers: [PASS], baseKey: 'b' });
    expect(renderer.frameHits ?? 0).toBe(0);
  });

  test('the kept frames stay bounded however often a warm-up runs', () => {
    const renderer = recordingRenderer();
    for (let i = 0; i < 10; i += 1) renderer.warmFrames({ tag: `p${i}` }, `b${i}`, { ...PASS, adjustments: { exposure: i } });
    expect(renderer.frames.size).toBe(2);
    expect(renderer.targets.length).toBe(3);
    expect(renderer.gl.textures - renderer.gl.deletedTextures).toBe(5);
  });

  test('targets made by a warm-up are freed when the brush is put away unpainted; a stroke keeps them', () => {
    const renderer = recordingRenderer();
    renderer.warmFrames(PARAMS, 'b', PASS);
    renderer.render(PARAMS);
    expect(renderer.targets.length).toBe(0);
    expect(renderer.gl.textures - renderer.gl.deletedTextures).toBe(0);
    renderer.warmFrames(PARAMS, 'b', PASS);
    renderer.render(PARAMS, { layers: [PASS], baseKey: 'b' });
    renderer.render(PARAMS);
    expect(renderer.targets.length).toBe(3);
    expect(renderer.frames.size).toBe(0);
  });

  test('nothing is warmed on a lost context, without a photo or without a key', () => {
    expect(recordingRenderer({ lost: true }).warmFrames(PARAMS, 'b', PASS)).toBe(0);
    expect(Object.assign(recordingRenderer(), { texture: null }).warmFrames(PARAMS, 'b', PASS)).toBe(0);
    const renderer = recordingRenderer();
    expect(renderer.warmFrames(PARAMS, null, PASS)).toBe(0);
    expect(renderer.gl.textures).toBe(0);
  });
});
