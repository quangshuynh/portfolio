// Blend modes and alpha compositing for layers: the reference definition, mirrored line for
// line by the GLSL in compositeShader.mjs. Formulas are those of the W3C "Compositing and
// Blending Level 1" recommendation (separable modes §9.1, non-separable §9.2, the general
// formula §5.8), which CSS mix-blend-mode and canvas globalCompositeOperation also follow.
//
// Colour space: blending runs on sRGB-encoded (display-referred, gamma-encoded) values in
// [0, 1], as in that recommendation and in most image editors' 8-bit modes, not in linear
// light. Multiply, Screen and the light modes therefore look as they do in those tools; a
// linear-light blend would make Screen and Soft Light noticeably brighter. Colours are
// straight (not premultiplied); the backdrop's alpha takes part through the general formula,
// so a layer over transparency keeps its own colour and nothing darkens at soft edges.
//
// Non-separable modes use the recommendation's luminosity weights (0.3, 0.59, 0.11), not the
// Rec.709 weights of the rest of the pipeline, so they match the published definition.

export const BLEND_CODES = Object.freeze({
  normal: 0,
  multiply: 1,
  screen: 2,
  overlay: 3,
  'soft-light': 4,
  'hard-light': 5,
  darken: 6,
  lighten: 7,
  'color-dodge': 8,
  'color-burn': 9,
  difference: 10,
  exclusion: 11,
  hue: 12,
  saturation: 13,
  color: 14,
  luminosity: 15,
});
export const NON_SEPARABLE = 12;

const hardLight = (cb, cs) => (cs <= 0.5 ? cb * 2 * cs : cb + (2 * cs - 1) - cb * (2 * cs - 1));

function softLight(cb, cs) {
  if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
  const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
  return cb + (2 * cs - 1) * (d - cb);
}

/** B(cb, cs) of a separable mode for one channel. */
export function blendChannel(code, cb, cs) {
  switch (code) {
    case 1: return cb * cs;
    case 2: return cb + cs - cb * cs;
    case 3: return hardLight(cs, cb);
    case 4: return softLight(cb, cs);
    case 5: return hardLight(cb, cs);
    case 6: return Math.min(cb, cs);
    case 7: return Math.max(cb, cs);
    case 8: return cb === 0 ? 0 : cs >= 1 ? 1 : Math.min(1, cb / (1 - cs));
    case 9: return cb >= 1 ? 1 : cs <= 0 ? 0 : 1 - Math.min(1, (1 - cb) / cs);
    case 10: return Math.abs(cb - cs);
    case 11: return cb + cs - 2 * cb * cs;
    default: return cs;
  }
}

const lum = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;

/** ClipColor(SetLum(C, l)) into `out`. */
function setLum(r, g, b, l, out) {
  const d = l - lum(r, g, b);
  let cr = r + d;
  let cg = g + d;
  let cb = b + d;
  const L = lum(cr, cg, cb);
  const n = Math.min(cr, cg, cb);
  const x = Math.max(cr, cg, cb);
  if (n < 0) {
    const k = L / (L - n);
    cr = L + (cr - L) * k; cg = L + (cg - L) * k; cb = L + (cb - L) * k;
  }
  if (x > 1) {
    const k = (1 - L) / (x - L);
    cr = L + (cr - L) * k; cg = L + (cg - L) * k; cb = L + (cb - L) * k;
  }
  out[0] = cr; out[1] = cg; out[2] = cb;
  return out;
}

const sat = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b);

/**
 * SetSat(C, s) into `out`. The recommendation's max/mid/min assignment in closed form:
 * (C − min) · s / (max − min), 0 for a grey (equal components stay equal).
 */
function setSat(r, g, b, s, out) {
  const n = Math.min(r, g, b);
  const range = Math.max(r, g, b) - n;
  if (range > 0) {
    out[0] = ((r - n) * s) / range; out[1] = ((g - n) * s) / range; out[2] = ((b - n) * s) / range;
  } else {
    out[0] = 0; out[1] = 0; out[2] = 0;
  }
  return out;
}

const scratch = [0, 0, 0];

/** B(Cb, Cs) for RGB into `out` (any mode). */
export function blendRgb(code, br, bg, bb, sr, sg, sb, out) {
  if (code < NON_SEPARABLE) {
    out[0] = blendChannel(code, br, sr);
    out[1] = blendChannel(code, bg, sg);
    out[2] = blendChannel(code, bb, sb);
    return out;
  }
  if (code === 12) {
    setSat(sr, sg, sb, sat(br, bg, bb), scratch);
    return setLum(scratch[0], scratch[1], scratch[2], lum(br, bg, bb), out);
  }
  if (code === 13) {
    setSat(br, bg, bb, sat(sr, sg, sb), scratch);
    return setLum(scratch[0], scratch[1], scratch[2], lum(br, bg, bb), out);
  }
  if (code === 14) return setLum(sr, sg, sb, lum(br, bg, bb), out);
  return setLum(br, bg, bb, lum(sr, sg, sb), out);
}

// Results are stored as 8-bit codes, rounded with the warp's tie bias (warp.mjs) so the GPU's
// float32 and the CPU's float64 agree at exact halves.
const BIAS = 1 / 1024;
const code8 = (v) => Math.min(255, Math.max(0, Math.floor(v * 255 + 0.5 + BIAS)));

const mixed = [0, 0, 0];

/**
 * Composites one source pixel over one backdrop pixel, in place.
 * :param out: RGBA8 array holding the backdrop at `o`; receives the result
 * :param s: source straight RGB codes [r, g, b] (0–255) at `i` of `src`
 * :param alpha: source alpha in [0, 1] (its own alpha × coverage × layer opacity)
 *
 * Co = (αs·((1 − αb)·Cs + αb·B(Cb, Cs)) + αb·(1 − αs)·Cb) / αo,  αo = αs + αb·(1 − αs)
 */
export function compositePixel(code, out, o, src, i, alpha) {
  if (alpha <= 0) return;
  const ab = out[o + 3] / 255;
  const br = out[o] / 255;
  const bg = out[o + 1] / 255;
  const bb = out[o + 2] / 255;
  const sr = src[i] / 255;
  const sg = src[i + 1] / 255;
  const sb = src[i + 2] / 255;
  blendRgb(code, br, bg, bb, sr, sg, sb, mixed);
  const ao = alpha + ab * (1 - alpha);
  const keep = ab * (1 - alpha);
  out[o] = code8((alpha * ((1 - ab) * sr + ab * mixed[0]) + keep * br) / ao);
  out[o + 1] = code8((alpha * ((1 - ab) * sg + ab * mixed[1]) + keep * bg) / ao);
  out[o + 2] = code8((alpha * ((1 - ab) * sb + ab * mixed[2]) + keep * bb) / ao);
  out[o + 3] = code8(ao);
}

/**
 * An adjustment layer's result at one pixel, in place: the backdrop moved toward
 * B(Cb, adjusted) by the layer's opacity; alpha is the backdrop's.
 * :param adjusted: RGBA8 codes of the backdrop after the layer's settings, at `i`
 */
export function adjustPixel(code, out, o, adjusted, i, opacity) {
  if (opacity <= 0) return;
  const br = out[o] / 255;
  const bg = out[o + 1] / 255;
  const bb = out[o + 2] / 255;
  blendRgb(code, br, bg, bb, adjusted[i] / 255, adjusted[i + 1] / 255, adjusted[i + 2] / 255, mixed);
  out[o] = code8(br + opacity * (mixed[0] - br));
  out[o + 1] = code8(bg + opacity * (mixed[1] - bg));
  out[o + 2] = code8(bb + opacity * (mixed[2] - bb));
}
