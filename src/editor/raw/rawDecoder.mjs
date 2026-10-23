// LibRaw (libraw-wasm 1.6.0, LibRaw 0.22.1) wrapped for the editor. It reads actual
// sensor data, never the embedded JPEG preview: LibRaw subtracts the black level,
// normalises to the white level, demosaics (AHD) and applies the as-shot white balance,
// and we take its 16-bit linear camera RGB. Colour conversion happens in our pipeline.
//
// Environment-free: the caller passes the loaded Emscripten module (worker or Node).

import { LIMITS } from '../io/files.mjs';
import { validColorMatrix } from './rawColor.mjs';

// 16-bit linear camera RGB, no auto-brightening, unclipped highlights (normalised by
// the largest multiplier) so any white balance can be re-applied exactly. libraw-wasm
// 1.6.0 ignores a two-element `gamm` (ybouane/LibRaw-Wasm#8), so all six are passed.
export const DECODE_SETTINGS = Object.freeze({
  outputBps: 16,
  outputColor: 0,
  gamm: [1, 1, 0, 0, 0, 0],
  noAutoBright: true,
  highlight: 1,
  useCameraWb: true,
  userQual: 3,
});

export class RawDecodeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const memoryError = (error) => /out of memory|memory access out of bounds|Cannot enlarge memory|allocation failed|OOM/i.test(String(error?.message ?? error));

// LibRaw throws C++ exceptions that reach JavaScript without a message; what it printed
// to stderr (the worker passes it as Module.lastMessage) says more, e.g. "Unexpected end of file".
function describeFailure(Module, error, stage) {
  const detail = String((typeof error?.message === 'string' && error.message) || Module.lastMessage || 'unknown error').replace(/^.*?: /, '').slice(0, 200);
  if (memoryError(error) || memoryError(detail)) {
    return new RawDecodeError('memory', 'This device ran out of memory while decoding the RAW file. Close other tabs, or use a computer with more memory.');
  }
  if (/end of file|truncat/i.test(detail)) return new RawDecodeError('corrupt', 'The RAW file is incomplete or damaged (it ends early).');
  return new RawDecodeError('corrupt', stage === 'open'
    ? `LibRaw could not read this RAW file. It may be damaged or an unsupported variant (${detail}).`
    : `LibRaw could not decode the sensor data. The file may be damaged (${detail}).`);
}

const flat3x3 = (rows) => (Array.isArray(rows) && rows.length >= 3 ? rows.slice(0, 3).flatMap((row) => Array.from(row ?? []).slice(0, 3)) : []);
const nonZero = (matrix) => matrix.length === 9 && matrix.some((value) => value !== 0);
const D65 = 21;

/**
 * XYZ -> camera matrix: LibRaw's built-in (Adobe-derived) table entry, or for a DNG
 * the file's own ColorMatrix, preferring the D65 calibration.
 */
function cameraMatrix(color) {
  const builtIn = flat3x3(color.cam_xyz);
  if (nonZero(builtIn)) return builtIn;
  const candidates = (color.dng_color ?? []).map((entry) => ({ illuminant: entry.illuminant, matrix: flat3x3(entry.colormatrix) })).filter(({ matrix }) => nonZero(matrix));
  return (candidates.find(({ illuminant }) => illuminant === D65) ?? candidates[0])?.matrix ?? builtIn;
}

/**
 * The photo facts the editor keeps: dimensions, camera and exposure details, and
 * the colour data development needs. No GPS, serial numbers or maker notes.
 */
export function summarizeMetadata(meta, format) {
  const color = meta.color_data ?? {};
  const camMul = Array.from(color.cam_mul ?? []).slice(0, 3);
  const asShotAvailable = camMul.length === 3 && camMul.every((value) => Number.isFinite(value) && value > 0);
  const preMul = Array.from(color.pre_mul ?? []).slice(0, 3);
  const daylight = preMul.every((value) => value > 0) ? preMul : [1, 1, 1];
  const multipliers = asShotAvailable ? camMul : daylight;
  // libraw-wasm reports the oriented size, and LibRaw rotates the decoded image to match.
  const number = (value) => (Number.isFinite(value) && value > 0 ? value : null);
  return {
    format,
    make: String(meta.camera_make ?? '').slice(0, 64),
    model: String(meta.camera_model ?? '').slice(0, 64),
    lens: String(meta.lens?.Lens ?? '').trim().slice(0, 96),
    iso: number(meta.iso_speed),
    shutter: number(meta.shutter),
    aperture: number(meta.aperture),
    focalLength: number(meta.focal_len),
    blackLevel: Number.isFinite(color.black) ? color.black : null,
    whiteLevel: number(color.maximum),
    flip: meta.flip ?? 0,
    width: meta.width,
    height: meta.height,
    asShotAvailable,
    asShot: multipliers.map((value) => value / multipliers[1]),
    rgbCam: flat3x3(color.rgb_cam),
    camXyz: cameraMatrix(color),
  };
}

/** Checks the opened file before any pixels are allocated. Throws RawDecodeError. */
export function checkDecodable(meta, info) {
  if ((meta.colors ?? 3) !== 3 || !info.width || !info.height) {
    throw new RawDecodeError('unsupported', 'This RAW variant is not supported: it is not a three-colour sensor image.');
  }
  if (!validColorMatrix(info.rgbCam) || info.camXyz.every((value) => value === 0)) {
    throw new RawDecodeError('unsupported', `LibRaw has no colour data for ${info.model || 'this camera'}, so it cannot be developed accurately.`);
  }
  if (Math.max(info.width, info.height) > LIMITS.maxSide || info.width * info.height > LIMITS.maxPixels) {
    throw new RawDecodeError('too-large', `${info.width}×${info.height} px is larger than this editor can develop.`);
  }
}

/**
 * Decodes a RAW file.
 * :param Module: the loaded libraw-wasm Emscripten module
 * :param bytes: Uint8Array of the whole file
 * :param options: { halfSize } half size takes each 2×2 sensor block as one pixel
 *   (genuine sensor data at half resolution, about 5x faster); else full AHD demosaic
 * :returns: { info, image: { kind: 'raw', width, height, data: Uint16Array RGB } }
 */
export function decodeRaw(Module, bytes, { format, halfSize = false } = {}) {
  const raw = new Module.LibRaw();
  Module.lastMessage = '';
  try {
    let meta;
    try {
      raw.open(bytes, { ...DECODE_SETTINGS, halfSize });
      meta = raw.metadata(true);
    } catch (error) {
      throw describeFailure(Module, error, 'open');
    }
    const info = summarizeMetadata(meta, format);
    checkDecodable(meta, info);
    let image;
    try {
      image = raw.imageData();
    } catch (error) {
      throw describeFailure(Module, error, 'decode');
    }
    if (!image?.data || image.bits !== 16 || image.colors !== 3 || image.data.length !== image.width * image.height * 3) {
      throw new RawDecodeError('corrupt', 'LibRaw returned no usable image for this file.');
    }
    // 1.6.0 returns a copy; a view into the (shared) wasm heap could not be transferred.
    const data = image.data.buffer instanceof ArrayBuffer ? image.data : image.data.slice();
    return { info, image: { kind: 'raw', width: image.width, height: image.height, data } };
  } finally {
    raw.delete();
  }
}

/**
 * Area-averaging downscale of RGB16 data in linear light (never upscales).
 * :returns: { kind: 'raw', width, height, data }
 */
export function downsampleRaw(image, width, height) {
  if (width >= image.width && height >= image.height) return image;
  const { width: sw, height: sh, data: src } = image;
  const out = new Uint16Array(width * height * 3);
  const sums = new Float64Array(width * 3);
  const counts = new Float64Array(width);
  const columnOf = new Uint32Array(sw);
  for (let x = 0; x < sw; x += 1) columnOf[x] = Math.min(width - 1, Math.floor((x * width) / sw));
  let sy = 0;
  for (let y = 0; y < height; y += 1) {
    const end = Math.max(sy + 1, Math.min(sh, Math.round(((y + 1) * sh) / height)));
    sums.fill(0);
    counts.fill(0);
    for (; sy < end; sy += 1) {
      const row = sy * sw * 3;
      for (let x = 0; x < sw; x += 1) {
        const tx = columnOf[x];
        const i = row + x * 3;
        sums[tx * 3] += src[i]; sums[tx * 3 + 1] += src[i + 1]; sums[tx * 3 + 2] += src[i + 2];
        counts[tx] += 1;
      }
    }
    const at = y * width * 3;
    for (let x = 0; x < width; x += 1) {
      for (let c = 0; c < 3; c += 1) out[at + x * 3 + c] = Math.round(sums[x * 3 + c] / counts[x]);
    }
  }
  return { kind: 'raw', width, height, data: out };
}
