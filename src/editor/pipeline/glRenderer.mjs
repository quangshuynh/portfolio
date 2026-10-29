// WebGL2 preview renderer. Draws the preview proxy into a canvas of the same size,
// one texel per pixel, so CSS zoom and pan never resample inside the pipeline.
// Sources are RGBA8 (JPEG, PNG, WebP), 16-bit camera RGB from a RAW decode, kept
// as an integer texture so no precision is lost before the shader develops it, or
// float camera RGB of a merged RAW HDR (RGB32F, read with texelFetch).
// Photos with Detail settings are rendered on the CPU (detailRenderer.mjs, the export
// engine) and drawn from that frame here; only the "before" side still runs the shader.
// The creative stage runs here; it needs the photo's native output size (grain scale) and,
// for bloom and halation, the glow map computed on the CPU (setCreative).
// Layers (compositeShader.mjs): with visible layers the photo is drawn into an RGBA8
// framebuffer, each layer is one pass between two such framebuffers (an adjustment layer is
// first run through this shader in direct mode), and the result is copied to the canvas.

import { CURVE_TABLE_SIZE } from './curves.mjs';
import { FRAGMENT_SHADER, VERTEX_SHADER } from './shader.mjs';
import { COMPOSITE_SHADER, COPY_SHADER } from './compositeShader.mjs';
import { FINE_SEED, grainScale } from './creative.mjs';
import { noiseCell } from './digital.mjs';

const UNIFORMS = ['uSource', 'uDirect', 'uWhiteBalanceActive', 'uWhiteBalance', 'uExposureGain', 'uToneActive', 'uContrast',
  'uHighlights', 'uShadows', 'uWhites', 'uBlacks', 'uVibrance', 'uSaturation', 'uNeutral',
  'uRaw', 'uRawSource', 'uRawGain', 'uRawMatrix', 'uRawWhite', 'uRolloffWhite', 'uRolloffKnee', 'uShadowLift', 'uHdr', 'uHdrSource',
  'uBaseNeutral', 'uCurvesActive', 'uCurveActive', 'uCurves', 'uHslActive', 'uHslHue', 'uHslSat', 'uHslLum',
  'uLutActive', 'uLut', 'uLutSize', 'uLutDomainMin', 'uLutDomainMax', 'uLutIntensity',
  'uGeometry', 'uGeometryMatrix', 'uOutputSize', 'uCoverage', 'uCoverageScale', 'uSourceSize', 'uBackground', 'uOpaque',
  'uCreative', 'uBleach', 'uBleachParams', 'uFade', 'uFadeBlack', 'uFadeShoulder', 'uFadeWhite', 'uGrade', 'uGradeTint', 'uGradeLum',
  'uGradeBalance', 'uGradeExponent', 'uVignette', 'uVignetteParams', 'uVignetteExponent', 'uGrain', 'uGrainParams', 'uGrainSeed',
  'uGrainFineSeed', 'uBloom', 'uBloomAmount', 'uHalation', 'uHalationAmount', 'uHalationTint', 'uGlow',
  'uDiffusion', 'uDiffusionAmount', 'uDiffuse', 'uSensor', 'uSensorMatrix', 'uResponse', 'uResponseParams', 'uClip', 'uClipGain',
  'uQuantize', 'uQuantizeSteps', 'uNoise', 'uNoiseParams', 'uNoiseSeed'];
const BACKGROUND_CODES = { transparent: 0, white: 1, black: 2 };

function opaqueRgba({ kind, data }) {
  if (kind === 'raw' || kind === 'hdr') return true;
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return false;
  return true;
}

// Texture units: the photo, the curve table, the 3D LUT, a RAW photo, a merged HDR, the glow map, soft focus,
// and for layer passes the layer (or adjusted composite) and the composite so far.
const UNIT = { source: 0, curves: 1, lut: 2, raw: 3, hdr: 4, glow: 5, diffuse: 6, layer: 7, backdrop: 8, mask: 9 };
const COMPOSITE_UNIFORMS = ['uBackdrop', 'uLayer', 'uAdjust', 'uMatrix', 'uOutputSize', 'uScale', 'uOpaque', 'uOpacity', 'uMode', 'uMask', 'uMasked'];

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

/** An RGB32F texture of merged HDR camera values (not filterable, so NEAREST and texelFetch). */
function hdrTexture(gl, width, height, data) {
  gl.activeTexture(gl.TEXTURE0 + UNIT.hdr);
  const texture = floatTexture(gl, gl.TEXTURE_2D);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, width, height, 0, gl.RGB, gl.FLOAT, data);
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

function link(gl, fragmentSource) {
  const program = gl.createProgram();
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, 'aPosition');
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Shader link failed: ${gl.getProgramInfoLog(program)}`);
  return program;
}

/** An RGBA8 texture read with texelFetch (NEAREST, clamped), optionally filled with straight RGBA8 rows. */
function rgbaTexture(gl, width, height, data = null) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  const pixels = data && (data instanceof Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach((name) => gl.texParameteri(gl.TEXTURE_2D, name, gl.NEAREST));
  [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach((name) => gl.texParameteri(gl.TEXTURE_2D, name, gl.CLAMP_TO_EDGE));
  return texture;
}

/** A single-channel 8-bit texture (mask coverage codes), sampled with texelFetch. */
function r8Texture(gl, width, height, data) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, data instanceof Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach((name) => gl.texParameteri(gl.TEXTURE_2D, name, gl.NEAREST));
  [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach((name) => gl.texParameteri(gl.TEXTURE_2D, name, gl.CLAMP_TO_EDGE));
  return texture;
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
    const program = link(gl, FRAGMENT_SHADER);
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
    this.hdrPlaceholder = hdrTexture(gl, 1, 1, new Float32Array(3));
    gl.activeTexture(gl.TEXTURE0);
    this.sourcePlaceholder = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.sourcePlaceholder);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.activeTexture(gl.TEXTURE0 + UNIT.glow);
    this.glowTexture = floatTexture(gl, gl.TEXTURE_2D);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(4));
    this.glowData = null;
    gl.activeTexture(gl.TEXTURE0 + UNIT.diffuse);
    this.diffuseTexture = floatTexture(gl, gl.TEXTURE_2D);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(4));
    this.diffuseData = null;
    this.creative = { nativeWidth: 0, nativeHeight: 0, glow: null };
    gl.activeTexture(gl.TEXTURE0);
    this.raw = false;
    this.hdr = false;
    this.renderedTexture = null;
    this.geometry = null;
    // Layer compositing, created when a photo first shows layers.
    this.compositor = null;
    this.targets = [];
    this.layerTextures = new Map();
    // Mask coverage (R8) of masked passes, by the pass's mask key.
    this.maskTextures = new Map();
  }

  /**
   * Context of the creative stage: the photo's output size at full resolution (grain is
   * scaled as a downscale of it) and the glow map ({ width, height, data } RGBA float,
   * creative.packGlow, with `diffuse` for soft focus), or null while it is not computed
   * (bloom, halation and soft focus are left out).
   */
  setCreative({ nativeWidth = 0, nativeHeight = 0, glow = null } = {}) {
    this.creative = { nativeWidth, nativeHeight, glow };
    if (!glow) return;
    const { gl } = this;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (glow.data !== this.glowData) {
      gl.activeTexture(gl.TEXTURE0 + UNIT.glow);
      gl.bindTexture(gl.TEXTURE_2D, this.glowTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, glow.width, glow.height, 0, gl.RGBA, gl.FLOAT, glow.data);
      this.glowData = glow.data;
    }
    if (glow.diffuse && glow.diffuse !== this.diffuseData) {
      gl.activeTexture(gl.TEXTURE0 + UNIT.diffuse);
      gl.bindTexture(gl.TEXTURE_2D, this.diffuseTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, glow.width, glow.height, 0, gl.RGBA, gl.FLOAT, glow.diffuse);
      this.diffuseData = glow.diffuse;
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Output size: the geometry's when one is set, else the source's. */
  get outWidth() { return this.geometry?.width ?? this.width; }

  get outHeight() { return this.geometry?.height ?? this.height; }

  /**
   * Sets the preview geometry (warp.mjs warpSpec for the current source), or null. The
   * canvas takes the output size.
   */
  setGeometry(spec) {
    this.geometry = spec ?? null;
    if (this.geometry && this.opaque === undefined) this.opaque = Boolean(this.uploaded?.data) && opaqueRgba(this.uploaded);
    if (this.canvas.width !== this.outWidth) this.canvas.width = this.outWidth;
    if (this.canvas.height !== this.outHeight) this.canvas.height = this.outHeight;
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
   * { width, height, data } RGBA8, { kind: 'raw', width, height, data } RGB16, or
   * { kind: 'hdr', width, height, data } float RGB.
   */
  setSource(source) {
    const { gl } = this;
    this.releaseSource();
    const { width, height } = source;
    if (width > this.maxTextureSize || height > this.maxTextureSize) {
      throw new Error(`Preview ${width}×${height} exceeds this GPU's ${this.maxTextureSize}px texture limit.`);
    }
    this.raw = source.kind === 'raw';
    this.hdr = source.kind === 'hdr';
    this.geometry = null;
    // The warp interpolates opaque sources without premultiplying, as warpRows() does;
    // checked when a geometry first needs it.
    this.opaque = undefined;
    this.uploaded = source;
    if (this.raw || this.hdr) {
      this.texture = this.raw ? rawTexture(gl, width, height, source.data) : hdrTexture(gl, width, height, source.data);
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
   *   settings with the same RAW info); `rendered` is a CPU-rendered RGBA8 frame
   *   { width, height, data } (the Detail preview) drawn instead of the pipeline, scaled
   *   to the canvas when it is smaller
   */
  render(params, { split = 0, before = null, rendered = null, layers = null } = {}) {
    const { gl } = this;
    if (!this.texture) return;
    this.last = [params, { split, before, rendered, layers }];
    const width = this.outWidth;
    const height = this.outHeight;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    if (layers?.length) {
      this.composite(params, rendered, layers);
    } else {
      gl.viewport(0, 0, width, height);
      if (rendered) this.draw({ ...params, neutral: true }, this.uploadRendered(rendered));
      else this.draw(params);
    }
    // Pixel x is "before" when its centre lies left of the split, (x + 0.5) / width < split.
    const columns = Math.min(width, Math.max(0, Math.ceil(split * width - 0.5)));
    if (columns > 0) {
      gl.useProgram(this.program);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, 0, columns, height);
      this.draw(before ?? { ...params, neutral: true });
      gl.disable(gl.SCISSOR_TEST);
    }
  }

  /**
   * Draws the photo into a framebuffer, applies each layer pass (composite.mjs raster passes
   * with a `key`, adjustment passes with derived `params`) and copies the result to the canvas.
   */
  composite(params, rendered, layers) {
    const { gl } = this;
    const width = this.outWidth;
    const height = this.outHeight;
    const c = this.ensureCompositor();
    const targets = this.ensureTargets(width, height, layers.some(({ kind }) => kind === 'adjust') ? 3 : 2);
    gl.viewport(0, 0, width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets[0].framebuffer);
    gl.useProgram(this.program);
    if (rendered) this.draw({ ...params, neutral: true }, this.uploadRendered(rendered));
    else this.draw(params);
    let [current, next] = targets;
    const used = new Set();
    const usedMasks = new Set();
    for (const pass of layers) {
      let layerTexture;
      if (pass.kind === 'adjust') {
        gl.bindFramebuffer(gl.FRAMEBUFFER, targets[2].framebuffer);
        gl.useProgram(this.program);
        this.draw(pass.params, current.texture, true);
        layerTexture = targets[2].texture;
      } else {
        layerTexture = this.layerTexture(pass);
        used.add(pass.key);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, next.framebuffer);
      gl.useProgram(c.program);
      const u = c.uniforms;
      gl.activeTexture(gl.TEXTURE0 + UNIT.backdrop);
      gl.bindTexture(gl.TEXTURE_2D, current.texture);
      gl.uniform1i(u.uBackdrop, UNIT.backdrop);
      gl.activeTexture(gl.TEXTURE0 + UNIT.layer);
      gl.bindTexture(gl.TEXTURE_2D, layerTexture);
      gl.uniform1i(u.uLayer, UNIT.layer);
      gl.uniform1i(u.uAdjust, pass.kind === 'adjust' ? 1 : 0);
      gl.uniformMatrix3fv(u.uMatrix, true, new Float32Array(pass.matrix ?? IDENTITY));
      gl.uniform2f(u.uOutputSize, width, height);
      gl.uniform1f(u.uScale, pass.scale ?? 1);
      gl.uniform1i(u.uOpaque, pass.opaque ? 1 : 0);
      gl.uniform1f(u.uOpacity, pass.opacity);
      gl.uniform1i(u.uMode, pass.mode);
      gl.activeTexture(gl.TEXTURE0 + UNIT.mask);
      gl.bindTexture(gl.TEXTURE_2D, pass.mask ? this.maskTexture(pass.mask) : this.maskPlaceholder());
      gl.uniform1i(u.uMask, UNIT.mask);
      gl.uniform1i(u.uMasked, pass.mask ? 1 : 0);
      if (pass.mask) usedMasks.add(pass.mask.key);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      [current, next] = [next, current];
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(c.copy);
    gl.activeTexture(gl.TEXTURE0 + UNIT.backdrop);
    gl.bindTexture(gl.TEXTURE_2D, current.texture);
    gl.uniform1i(c.frame, UNIT.backdrop);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.activeTexture(gl.TEXTURE0);
    // Rasters of layers no longer shown are released.
    for (const [key, entry] of this.layerTextures) {
      if (!used.has(key)) { gl.deleteTexture(entry.texture); this.layerTextures.delete(key); }
    }
    for (const [key, entry] of this.maskTextures) {
      if (!usedMasks.has(key)) { gl.deleteTexture(entry.texture); this.maskTextures.delete(key); }
    }
  }

  /** The R8 coverage texture of a pass's mask ({ key, raster }), uploaded once per raster. */
  maskTexture({ key, raster }) {
    const cached = this.maskTextures.get(key);
    if (cached?.raster === raster) return cached.texture;
    const { gl } = this;
    if (cached) gl.deleteTexture(cached.texture);
    const texture = r8Texture(gl, raster.width, raster.height, raster.data);
    this.maskTextures.set(key, { texture, raster });
    return texture;
  }

  /** A 1 × 1 texture bound to the mask unit by unmasked passes. */
  maskPlaceholder() {
    this.emptyMask ??= r8Texture(this.gl, 1, 1, new Uint8Array([255]));
    return this.emptyMask;
  }

  ensureCompositor() {
    if (this.compositor) return this.compositor;
    const { gl } = this;
    const program = link(gl, COMPOSITE_SHADER);
    const copy = link(gl, COPY_SHADER);
    this.compositor = {
      program,
      uniforms: Object.fromEntries(COMPOSITE_UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)])),
      copy,
      frame: gl.getUniformLocation(copy, 'uFrame'),
    };
    return this.compositor;
  }

  /** `count` RGBA8 framebuffers of the output size (made or resized as needed). */
  ensureTargets(width, height, count) {
    const { gl } = this;
    if (this.targets.length && (this.targets[0].width !== width || this.targets[0].height !== height)) this.releaseTargets();
    while (this.targets.length < count) {
      gl.activeTexture(gl.TEXTURE0 + UNIT.layer);
      const texture = rgbaTexture(gl, width, height);
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('This GPU cannot render layers into a framebuffer.');
      this.targets.push({ texture, framebuffer, width, height });
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return this.targets;
  }

  releaseTargets() {
    const { gl } = this;
    this.targets.forEach(({ texture, framebuffer }) => { gl.deleteFramebuffer(framebuffer); gl.deleteTexture(texture); });
    this.targets = [];
  }

  /** The texture of a raster pass, uploaded once per raster. */
  layerTexture({ key, raster }) {
    const cached = this.layerTextures.get(key);
    if (cached?.raster === raster) return cached.texture;
    const { gl } = this;
    if (cached) gl.deleteTexture(cached.texture);
    if (raster.width > this.maxTextureSize || raster.height > this.maxTextureSize) throw new Error(`A layer of ${raster.width}×${raster.height} exceeds this GPU's ${this.maxTextureSize}px texture limit.`);
    gl.activeTexture(gl.TEXTURE0 + UNIT.layer);
    const texture = rgbaTexture(gl, raster.width, raster.height, raster.data);
    this.layerTextures.set(key, { texture, raster });
    return texture;
  }

  /** Frees the layer framebuffers and rasters (while no layer is shown). */
  releaseLayers() {
    this.releaseTargets();
    this.layerTextures.forEach(({ texture }) => this.gl.deleteTexture(texture));
    this.layerTextures.clear();
    this.maskTextures.forEach(({ texture }) => this.gl.deleteTexture(texture));
    this.maskTextures.clear();
  }

  /** Uploads a CPU-rendered RGBA8 frame into its own texture (linear filtering for scaling). */
  uploadRendered({ width, height, data }) {
    const { gl } = this;
    if (!this.renderedTexture) this.renderedTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.renderedTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data instanceof Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return this.renderedTexture;
  }

  /**
   * :param frame: a texture drawn as is (neutral) instead of the photo's source, or with
   *   `direct` the composite an adjustment layer's `params` apply to
   */
  draw(params, frame = null, direct = false) {
    const { gl, uniforms: u } = this;
    const raw = this.raw && !frame;
    const hdr = this.hdr && !frame;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, frame ?? (raw || hdr ? this.sourcePlaceholder : this.texture));
    gl.uniform1i(u.uSource, 0);
    gl.uniform1i(u.uDirect, direct ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0 + UNIT.raw);
    gl.bindTexture(gl.TEXTURE_2D, raw ? this.texture : this.rawPlaceholder);
    gl.uniform1i(u.uRawSource, UNIT.raw);
    gl.uniform1i(u.uRaw, raw ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0 + UNIT.hdr);
    gl.bindTexture(gl.TEXTURE_2D, hdr ? this.texture : this.hdrPlaceholder);
    gl.uniform1i(u.uHdrSource, UNIT.hdr);
    gl.uniform1i(u.uHdr, hdr ? 1 : 0);
    // A CPU-rendered frame is already in output coordinates.
    const geometry = frame ? null : this.geometry;
    gl.uniform1i(u.uGeometry, geometry ? 1 : 0);
    gl.uniformMatrix3fv(u.uGeometryMatrix, true, new Float32Array(geometry?.matrix ?? IDENTITY));
    gl.uniform2f(u.uOutputSize, this.outWidth, this.outHeight);
    gl.uniform1i(u.uCoverage, geometry?.coverage ? 1 : 0);
    gl.uniform1f(u.uCoverageScale, geometry?.scale ?? 1);
    gl.uniform2f(u.uSourceSize, geometry?.src.width ?? this.width, geometry?.src.height ?? this.height);
    gl.uniform1i(u.uBackground, BACKGROUND_CODES[geometry?.background] ?? 0);
    gl.uniform1i(u.uOpaque, this.opaque ? 1 : 0);
    gl.uniform3fv(u.uRawGain, params.raw?.gain ?? [1, 1, 1]);
    gl.uniformMatrix3fv(u.uRawMatrix, true, new Float32Array(params.raw?.matrix ?? IDENTITY));
    gl.uniform1f(u.uRawWhite, params.raw?.white ?? 1);
    gl.uniform1f(u.uRolloffWhite, params.rolloffWhite ?? 0);
    gl.uniform1f(u.uRolloffKnee, params.rolloffKnee ?? 0.5);
    gl.uniform1f(u.uShadowLift, params.shadowLift ?? 0);
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
    this.setCreativeUniforms(frame && !direct ? null : params.creative);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  setCreativeUniforms(c) {
    const { gl, uniforms: u } = this;
    const active = Boolean(c?.active);
    gl.uniform1i(u.uCreative, active ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0 + UNIT.glow);
    gl.bindTexture(gl.TEXTURE_2D, this.glowTexture);
    gl.uniform1i(u.uGlow, UNIT.glow);
    gl.activeTexture(gl.TEXTURE0 + UNIT.diffuse);
    gl.bindTexture(gl.TEXTURE_2D, this.diffuseTexture);
    gl.uniform1i(u.uDiffuse, UNIT.diffuse);
    gl.activeTexture(gl.TEXTURE0);
    if (!active) return;
    const { bleach, fade, grading, vignette, grain, bloom, halation, diffusion, sensor, response, clip, quantize, noise } = c;
    gl.uniform1i(u.uSensor, sensor ? 1 : 0);
    if (sensor) gl.uniformMatrix3fv(u.uSensorMatrix, true, new Float32Array(sensor));
    gl.uniform1i(u.uResponse, response ? 1 : 0);
    if (response) gl.uniform2f(u.uResponseParams, response.exponent, response.saturation);
    gl.uniform1i(u.uClip, clip ? 1 : 0);
    if (clip) gl.uniform1f(u.uClipGain, clip);
    gl.uniform1i(u.uQuantize, quantize ? 1 : 0);
    if (quantize) gl.uniform1f(u.uQuantizeSteps, quantize.levels - 1);
    gl.uniform1i(u.uBleach, bleach ? 1 : 0);
    if (bleach) gl.uniform4f(u.uBleachParams, bleach.amount, bleach.contrast, bleach.desaturation, bleach.protect);
    gl.uniform1i(u.uFade, fade ? 1 : 0);
    if (fade) {
      gl.uniform3fv(u.uFadeBlack, fade.black);
      gl.uniform1f(u.uFadeShoulder, fade.shoulder);
      gl.uniform3fv(u.uFadeWhite, fade.white);
    }
    gl.uniform1i(u.uGrade, grading ? 1 : 0);
    if (grading) {
      gl.uniform3fv(u.uGradeTint, grading.tints.flat());
      gl.uniform4fv(u.uGradeLum, grading.luminance);
      gl.uniform1f(u.uGradeBalance, grading.balance);
      gl.uniform1f(u.uGradeExponent, grading.exponent);
    }
    gl.uniform1i(u.uVignette, vignette ? 1 : 0);
    if (vignette) {
      gl.uniform4f(u.uVignetteParams, vignette.amount, vignette.start, vignette.width, vignette.round);
      gl.uniform1f(u.uVignetteExponent, vignette.exponent);
    }
    // Grain is scaled as a downscale of the full-resolution output (detailRenderer's `scale`).
    const { nativeWidth, nativeHeight, glow } = this.creative;
    const scale = Math.min(1, Math.max(this.outWidth, this.outHeight) / Math.max(nativeWidth || this.outWidth, nativeHeight || this.outHeight));
    gl.uniform1i(u.uGrain, grain ? 1 : 0);
    if (grain) {
      gl.uniform4f(u.uGrainParams, grain.amount * grainScale(grain.spacing, scale), grain.spacing, grain.roughness, scale);
      gl.uniform1ui(u.uGrainSeed, grain.seed);
      gl.uniform1ui(u.uGrainFineSeed, FINE_SEED(grain.seed));
    }
    gl.uniform1i(u.uBloom, bloom && glow ? 1 : 0);
    if (bloom) gl.uniform1f(u.uBloomAmount, bloom.amount);
    gl.uniform1i(u.uDiffusion, diffusion && glow?.diffuse ? 1 : 0);
    if (diffusion) gl.uniform1f(u.uDiffusionAmount, diffusion.amount);
    gl.uniform1i(u.uNoise, noise ? 1 : 0);
    if (noise) {
      const unit = scale * (noise.cell || noiseCell(Math.max(nativeWidth || this.outWidth, nativeHeight || this.outHeight)));
      gl.uniform3f(u.uNoiseParams, noise.amount * Math.min(1, unit), noise.chroma, unit);
      gl.uniform1ui(u.uNoiseSeed, noise.seed);
    }
    gl.uniform1i(u.uHalation, halation && glow ? 1 : 0);
    if (halation) {
      gl.uniform1f(u.uHalationAmount, halation.amount);
      gl.uniform3fv(u.uHalationTint, halation.tint);
    }
  }

  /** Renders and reads back RGBA8 rows top to bottom (tests and parity checks). */
  readPixels(params, options) {
    const { gl } = this;
    this.render(params, options);
    const [width, height] = [this.outWidth, this.outHeight];
    const out = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, out);
    // The default framebuffer's row 0 is the bottom; flip to image order.
    const row = width * 4;
    const flipped = new Uint8Array(out.length);
    for (let y = 0; y < height; y += 1) flipped.set(out.subarray(y * row, (y + 1) * row), (height - 1 - y) * row);
    return flipped;
  }

  /** The frame last drawn, drawn again and read back (browser checks; never sent anywhere). */
  snapshot() {
    return this.last && this.texture ? { width: this.outWidth, height: this.outHeight, data: this.readPixels(...this.last) } : null;
  }

  releaseSource() {
    this.uploaded = null;
    if (this.texture) this.gl.deleteTexture(this.texture);
    if (this.renderedTexture) this.gl.deleteTexture(this.renderedTexture);
    this.texture = null;
    this.renderedTexture = null;
    this.raw = false;
    this.hdr = false;
  }

  /** Frees the texture and shrinks the drawing buffer while no photo is shown. */
  clear() {
    this.releaseSource();
    this.releaseLayers();
    this.geometry = null;
    this.canvas.width = 1;
    this.canvas.height = 1;
  }

  dispose() {
    const { gl } = this;
    this.releaseSource();
    this.releaseLayers();
    if (this.compositor) { gl.deleteProgram(this.compositor.program); gl.deleteProgram(this.compositor.copy); }
    gl.deleteTexture(this.curveTexture);
    gl.deleteTexture(this.lutTexture);
    gl.deleteTexture(this.glowTexture);
    gl.deleteTexture(this.diffuseTexture);
    gl.deleteTexture(this.rawPlaceholder);
    gl.deleteTexture(this.hdrPlaceholder);
    gl.deleteTexture(this.sourcePlaceholder);
    if (this.emptyMask) gl.deleteTexture(this.emptyMask);
    gl.deleteBuffer(this.buffer);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
