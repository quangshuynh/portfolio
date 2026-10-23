// Synthetic exposure brackets for HDR tests: a scene with known radiance (a bright
// window far above the reference's sensor white, deep shadows, textured detail for
// alignment), rendered like LibRaw's decoded camera RGB at several exposures with shot
// and read noise, optional handheld motion (sub-pixel shift and rotation) and a moving
// object. Deterministic. Never real photographs.

const AS_SHOT = [2.2, 1, 1.5];

/** Deterministic pseudo-random numbers (mulberry32). */
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (x, y) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * White-balanced scene radiance at (x, y) for a width × height frame, in units of the
 * reference exposure's sensor white. `object` places a moving dark block.
 */
export function sceneRadiance(x, y, width, height, { object = null } = {}) {
  const u = x / width;
  const v = y / height;
  // Textured mid-tones: blocks of varying reflectance, so edges exist everywhere.
  const cell = hash(Math.floor(u * 24), Math.floor(v * 16));
  let base = 0.04 + 0.35 * cell;
  let color = [1, 0.95 + 0.1 * hash(Math.floor(u * 7), 3), 0.85 + 0.2 * hash(5, Math.floor(v * 5))];
  // A bright window (up to 6x the reference white) with structure inside.
  if (u > 0.6 && u < 0.9 && v > 0.12 && v < 0.45) {
    base = 1.5 + 4.5 * hash(Math.floor(u * 40), Math.floor(v * 30));
    color = [1, 0.97, 0.9];
  }
  // Deep shadows (around 7 stops below the window) with faint detail.
  if (u < 0.35 && v > 0.6) {
    base = 0.003 + 0.004 * hash(Math.floor(u * 30), Math.floor(v * 30));
    color = [0.9, 1, 1.1];
  }
  if (object && Math.abs(x - object.x) < object.size && Math.abs(y - object.y) < object.size) {
    // Dark enough that the +2 EV frame does not clip it, so the motion is measurable.
    base = 0.1;
    color = [0.3, 0.6, 1];
  }
  return color.map((c) => base * c);
}

/** Scene radiance averaged over the area of pixel (x, y), as the frames record it (3×3 samples). */
export function pixelRadiance(x, y, width, height, options = {}) {
  const out = [0, 0, 0];
  for (let sy = -1; sy <= 1; sy += 1) {
    for (let sx = -1; sx <= 1; sx += 1) {
      const value = sceneRadiance(x + sx / 3, y + sy / 3, width, height, options);
      for (let c = 0; c < 3; c += 1) out[c] += value[c] / 9;
    }
  }
  return out;
}

/**
 * One decoded RAW frame: { kind: 'raw', width, height, data: Uint16Array RGB }.
 * :param options: exposure (relative to reference), transform { tx, ty, angle } from
 *   reference to frame pixels, noise (photon count at the sensor white), object, seed
 */
export function syntheticRawFrame(width, height, { exposure = 1, transform = { tx: 0, ty: 0, angle: 0 }, noise = 4000, object = null, seed = 1 } = {}) {
  const data = new Uint16Array(width * height * 3);
  const rand = random(seed);
  const aMax = Math.max(...AS_SHOT);
  const cos = Math.cos((transform.angle * Math.PI) / 180);
  const sin = Math.sin((transform.angle * Math.PI) / 180);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // The frame at pixel q shows the reference scene at p with q = R(p - c) + c + t.
      // Averaged over the pixel area (3×3 samples), as a sensor integrates light.
      const radiance = [0, 0, 0];
      for (let sy = -1; sy <= 1; sy += 1) {
        for (let sx = -1; sx <= 1; sx += 1) {
          const dx = x + sx / 3 - cx - transform.tx;
          const dy = y + sy / 3 - cy - transform.ty;
          const value = sceneRadiance(cos * dx + sin * dy + cx, -sin * dx + cos * dy + cy, width, height, { object });
          for (let c = 0; c < 3; c += 1) radiance[c] += value[c] / 9;
        }
      }
      for (let c = 0; c < 3; c += 1) {
        const signal = Math.min(1, radiance[c] * exposure);
        // Shot noise (Poisson, Gaussian approximation) plus read noise, at the sensor.
        const gauss = Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
        const noisy = signal + gauss * Math.sqrt(signal / noise + 1e-7);
        const clipped = Math.min(1, Math.max(0, noisy));
        data[(y * width + x) * 3 + c] = Math.round(clipped * (AS_SHOT[c] / aMax) * 65535);
      }
    }
  }
  return { kind: 'raw', width, height, data };
}

/** The colour info a decoder reports for these frames (as-shot multipliers, green 1). */
export const SYNTHETIC_RAW_INFO = Object.freeze({
  asShot: AS_SHOT,
  rgbCam: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  camXyz: [3.2404542, -1.5371385, -0.4985314, -0.969266, 1.8760108, 0.041556, 0.0556434, -0.2040259, 1.0572252],
  asShotAvailable: true,
  width: 0,
  height: 0,
  format: 'dng',
});

/** An 8-bit sRGB rendering of a frame (a simple camera JPEG: clip, gamma 1/2.2), RGBA. */
export function syntheticRasterFrame(width, height, options = {}) {
  const raw = syntheticRawFrame(width, height, options);
  const data = new Uint8ClampedArray(width * height * 4);
  const aMax = Math.max(...AS_SHOT);
  for (let i = 0; i < width * height; i += 1) {
    for (let c = 0; c < 3; c += 1) data[i * 4 + c] = Math.round(255 * ((raw.data[i * 3 + c] / 65535) * (aMax / AS_SHOT[c])) ** (1 / 2.2));
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}
