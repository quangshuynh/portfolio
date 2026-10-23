// WebGL2 preview renderer. Draws the preview proxy into a canvas of the same size,
// one texel per pixel, so CSS zoom and pan never resample inside the pipeline.
// Sources are RGBA8 (JPEG, PNG, WebP) or 16-bit camera RGB from a RAW decode, kept
// as an integer texture so no precision is lost before the shader develops it.

import { CURVE_TABLE_SIZE } from './curves.mjs';
import { FRAGMENT_SHADER, VERTEX_SHADER } from './shader.mjs';

const UNIFORMS = ['uSource', 'uWhiteBalanceActive', 'uWhiteBalance', 'uExposureGain', 'uToneActive', 'uContrast',
  'uHighlights', 'uShadows', 'uWhites', 'uBlacks', 'uVibrance', 'uSaturation', 'uNeutral',
  'uRaw', 'uRawSource', 'uRawGain', 'uRawMatrix', 'uRolloffWhite',
  'uBaseNeutral', 'uCurvesActive', 'uCurveActive', 'uCurves', 'uHslActive', 'uHslHue', 'uHslSat', 'uHslLum',
  'uLutActive', 'uLut', 'uLutSize', 'uLutDomainMin', 'uLutDomainMax', 'uLutIntensity'];

// Texture units: the photo, the curve table, the 3D LUT, a RAW photo.
const UNIT = { source: 0, curves: 1, lut: 2, raw: 3 };

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** An RGB16UI texture; integer textures are only read with texelFetch, so NEAREST. */
function rawTexture(gl, width, height, data) {
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + UNIT.raw);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB16UI, width, height, 0, gl.RGB_INTEGER, gl.UNSIGNED_SHORT, data);
  [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach((name) => gl.texParameteri(gl.TEXTURE_2D, name, gl.NEAREST));
  [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach((name) => gl.texParameteri(gl.TEXTURE_2D, name, gl.CLAMP_TO_EDGE));
  return texture;
}

/** A float texture read only with texelFetch: NEAREST, so no filtering extension is needed. */
function floatTexture(gl, target) {
  const texture = gl.createTexture();
  gl.bindTexture(target, texture);
  [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach((name) => gl.texParameteri(target, name, gl.NEAREST));
  [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, ...(target === gl.TEXTURE_3D ? [gl.TEXTURE_WRAP_R] : [])].forEach((name) => gl.texParameteri(target, name, gl.CLAMP_TO_EDGE));
  return texture;
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return shader;
}

/**
 * Tries to create a WebGL2 context suitable for the editor.
 * :returns: { gl, reason } where gl is null and reason says why when it is unsuitable.
 *   A canvas that returned a context (even an unsuitable one) cannot be reused for 2D.
 */
export function probeEditorContext(canvas) {
  try {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) return { gl: null, reason: 'WebGL2 is not available in this browser.' };
    const format = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    // highp float with a 23-bit mantissa is what the parity tolerances assume.
    if (!format || format.precision < 23) return { gl: null, reason: `The GPU's high-precision float has ${format?.precision ?? 0} bits; 23 are needed.` };
    return { gl, reason: null };
  } catch (error) {
    return { gl: null, reason: `WebGL2 failed to start: ${error.message}` };
  }
}

/** Returns a WebGL2 context suitable for the editor, or null. */
export const createEditorContext = (canvas) => probeEditorContext(canvas).gl;

export class GlRenderer {
  constructor(canvas, gl = createEditorContext(canvas)) {
    if (!gl) throw new Error('WebGL2 is not available.');
    this.canvas = canvas;
    this.gl = gl;
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const program = gl.createProgram();
    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, 0, 'aPosition');
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Shader link failed: ${gl.getProgramInfoLog(program)}`);
    this.program = program;
    this.uniforms = Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)]));
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.texture = null;
    this.width = 0;
    this.height = 0;
    // Curve table and LUT start as tiny placeholders so every sampler is always complete.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.activeTexture(gl.TEXTURE0 + UNIT.curves);
    this.curveTexture = floatTexture(gl, gl.TEXTURE_2D);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(4));
    this.curveTable = null;
    gl.activeTexture(gl.TEXTURE0 + UNIT.lut);
    this.lutTexture = floatTexture(gl, gl.TEXTURE_3D);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB32F, 1, 1, 1, 0, gl.RGB, gl.FLOAT, new Float32Array(3));
    this.lutData = null;
    // Placeholders keep both photo samplers complete whichever kind of source is shown.
    this.rawPlaceholder = rawTexture(gl, 1, 1, new Uint16Array(3));
    gl.activeTexture(gl.TEXTURE0);
    this.sourcePlaceholder = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.sourcePlaceholder);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this.raw = false;
  }

  /** Uploads the curve table when it changed (tables are cached per curve set). */
  setCurves(table) {
    if (table === this.curveTable) return;
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0 + UNIT.curves);
    gl.bindTexture(gl.TEXTURE_2D, this.curveTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, CURVE_TABLE_SIZE, 1, 0, gl.RGBA, gl.FLOAT, table);
    this.curveTable = table;
  }

  /** Uploads a LUT's grid (red along x, green along y, blue along z) when it changed. */
  setLut(lut) {
    if (lut.data === this.lutData) return;
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0 + UNIT.lut);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB32F, lut.size, lut.size, lut.size, 0, gl.RGB, gl.FLOAT, lut.data);
    this.lutData = lut.data;
  }

  get lost() {
    return this.gl.isContextLost();
  }

  /**
   * Uploads the source pixels: an ImageBitmap (decoded with premultiplyAlpha 'none'),
   * { width, height, data } RGBA8, or { kind: 'raw', width, height, data } RGB16.
   */
  setSource(source) {
    const { gl } = this;
    this.releaseSource();
    const { width, height } = source;
    if (width > this.maxTextureSize || height > this.maxTextureSize) {
      throw new Error(`Preview ${width}×${height} exceeds this GPU's ${this.maxTextureSize}px texture limit.`);
    }
    this.raw = source.kind === 'raw';
    if (this.raw) {
      this.texture = rawTexture(gl, width, height, source.data);
      this.width = width;
      this.height = height;
      this.canvas.width = width;
      this.canvas.height = height;
      return;
    }
    this.texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (source.data) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.data);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  /**
   * Draws the source through the pipeline.
   * :param params: deriveParams() result
   * :param options: { split, before } `split` is the fraction of the width (from the
   *   left) drawn with `before` instead: the untouched source by default, which a RAW
   *   photo does not have, so it passes its neutral development (deriveParams of neutral
   *   settings with the same RAW info)
   */
  render(params, { split = 0, before = null } = {}) {
    const { gl } = this;
    if (!this.texture) return;
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    this.draw(params);
    // Pixel x is "before" when its centre lies left of the split, (x + 0.5) / width < split.
    const columns = Math.min(this.width, Math.max(0, Math.ceil(split * this.width - 0.5)));
    if (columns > 0) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, 0, columns, this.height);
      this.draw(before ?? { ...params, neutral: true });
      gl.disable(gl.SCISSOR_TEST);
    }
  }

  draw(params) {
    const { gl, uniforms: u } = this;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.raw ? this.sourcePlaceholder : this.texture);
    gl.uniform1i(u.uSource, 0);
    gl.activeTexture(gl.TEXTURE0 + UNIT.raw);
    gl.bindTexture(gl.TEXTURE_2D, this.raw ? this.texture : this.rawPlaceholder);
    gl.uniform1i(u.uRawSource, UNIT.raw);
    gl.uniform1i(u.uRaw, this.raw ? 1 : 0);
    gl.uniform3fv(u.uRawGain, params.raw?.gain ?? [1, 1, 1]);
    gl.uniformMatrix3fv(u.uRawMatrix, true, new Float32Array(params.raw?.matrix ?? IDENTITY));
    gl.uniform1f(u.uRolloffWhite, params.rolloffWhite ?? 0);
    gl.uniform1i(u.uNeutral, params.neutral ? 1 : 0);
    gl.uniform1i(u.uWhiteBalanceActive, params.whiteBalanceActive ? 1 : 0);
    // GLSL matrices are column-major; ours are row-major.
    gl.uniformMatrix3fv(u.uWhiteBalance, true, new Float32Array(params.whiteBalance));
    gl.uniform1f(u.uExposureGain, params.exposureGain);
    gl.uniform1i(u.uToneActive, params.toneActive ? 1 : 0);
    gl.uniform1f(u.uContrast, params.tone.contrast);
    gl.uniform1f(u.uHighlights, params.tone.highlights);
    gl.uniform1f(u.uShadows, params.tone.shadows);
    gl.uniform1f(u.uWhites, params.tone.whites);
    gl.uniform1f(u.uBlacks, params.tone.blacks);
    gl.uniform1f(u.uVibrance, params.vibrance);
    gl.uniform1f(u.uSaturation, params.saturation);
    gl.uniform1i(u.uBaseNeutral, params.baseNeutral ? 1 : 0);
    gl.uniform1i(u.uCurvesActive, params.curvesActive ? 1 : 0);
    if (params.curvesActive) this.setCurves(params.curves.table);
    gl.uniform4i(u.uCurveActive, ...params.curves.active.map(Number));
    gl.uniform1i(u.uHslActive, params.hslActive ? 1 : 0);
    gl.uniform1fv(u.uHslHue, params.hsl.hue);
    gl.uniform1fv(u.uHslSat, params.hsl.saturation);
    gl.uniform1fv(u.uHslLum, params.hsl.luminance);
    gl.uniform1i(u.uLutActive, params.lutActive ? 1 : 0);
    if (params.lutActive) {
      this.setLut(params.lut);
      gl.uniform1i(u.uLutSize, params.lut.size);
      gl.uniform3fv(u.uLutDomainMin, params.lut.domainMin);
      gl.uniform3fv(u.uLutDomainMax, params.lut.domainMax);
      gl.uniform1f(u.uLutIntensity, params.lutIntensity);
    }
    gl.activeTexture(gl.TEXTURE0 + UNIT.curves);
    gl.bindTexture(gl.TEXTURE_2D, this.curveTexture);
    gl.uniform1i(u.uCurves, UNIT.curves);
    gl.activeTexture(gl.TEXTURE0 + UNIT.lut);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTexture);
    gl.uniform1i(u.uLut, UNIT.lut);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Renders and reads back RGBA8 rows top to bottom (tests and parity checks). */
  readPixels(params, options) {
    const { gl } = this;
    this.render(params, options);
    const out = new Uint8Array(this.width * this.height * 4);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
    // The default framebuffer's row 0 is the bottom; flip to image order.
    const row = this.width * 4;
    const flipped = new Uint8Array(out.length);
    for (let y = 0; y < this.height; y += 1) flipped.set(out.subarray(y * row, (y + 1) * row), (this.height - 1 - y) * row);
    return flipped;
  }

  releaseSource() {
    if (this.texture) this.gl.deleteTexture(this.texture);
    this.texture = null;
    this.raw = false;
  }

  /** Frees the texture and shrinks the drawing buffer while no photo is shown. */
  clear() {
    this.releaseSource();
    this.canvas.width = 1;
    this.canvas.height = 1;
  }

  dispose() {
    const { gl } = this;
    this.releaseSource();
    gl.deleteTexture(this.curveTexture);
    gl.deleteTexture(this.lutTexture);
    gl.deleteTexture(this.rawPlaceholder);
    gl.deleteTexture(this.sourcePlaceholder);
    gl.deleteBuffer(this.buffer);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
