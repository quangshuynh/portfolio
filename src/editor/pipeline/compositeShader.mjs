// GLSL mirror of composite.mjs and blend.mjs for the WebGL2 preview. One pass per layer reads
// the composite so far (an RGBA8 texture in framebuffer orientation, fetched at the fragment)
// and either a layer raster (row 0 = top, sampled through the canvas → raster matrix with
// warp.mjs's Catmull-Rom arithmetic) or, for an adjustment layer, the composite after the main
// shader applied the layer's settings. The result is rounded to codes exactly as the CPU does,
// so every pass starts from the same 8-bit values on both. A masked pass also reads its mask's
// coverage codes (an R8 texture, row 0 = top, computed by pipeline/mask.mjs), which scale the
// layer's alpha or the adjustment's opacity as composite.mjs does.

import { POSITION_GRID, ROUNDING_BIAS } from './warp.mjs';

const f = (value) => {
  const text = String(value);
  return /[.e]/.test(text) ? text : `${text}.0`;
};

export const COMPOSITE_SHADER = `#version 300 es
precision highp float;
uniform sampler2D uBackdrop;
uniform sampler2D uLayer;
uniform bool uAdjust;
uniform mat3 uMatrix;
uniform vec2 uOutputSize;
uniform float uScale;
uniform bool uOpaque;
uniform float uOpacity;
uniform int uMode;
uniform sampler2D uMask;
uniform bool uMasked;
out vec4 outColor;

const float POSITION_GRID = ${f(POSITION_GRID)};
const float ROUNDING_BIAS = ${f(ROUNDING_BIAS)};

float roundCode(float v) { return floor(v + 0.5 + ROUNDING_BIAS); }
vec3 roundCode(vec3 v) { return floor(v + 0.5 + ROUNDING_BIAS); }
vec4 codes(vec4 texel) { return floor(texel * 255.0 + 0.5); }

vec4 cubicWeights(float t) {
  float t2 = t * t;
  float t3 = t2 * t;
  return vec4((-t3 + 2.0 * t2 - t) / 2.0, (3.0 * t3 - 5.0 * t2 + 2.0) / 2.0, (-3.0 * t3 + 4.0 * t2 + t) / 2.0, (t3 - t2) / 2.0);
}

// warpRows(): Catmull-Rom in whole codes, premultiplied unless opaque, rounded to 8 bits.
vec4 sampleLayer(vec2 at) {
  ivec2 size = textureSize(uLayer, 0);
  vec2 p = floor(at * POSITION_GRID + 0.5) / POSITION_GRID - 0.5;
  vec2 base = floor(p);
  vec4 wx = cubicWeights(p.x - base.x);
  vec4 wy = cubicWeights(p.y - base.y);
  vec3 color = vec3(0.0);
  float alpha = 0.0;
  for (int j = 0; j < 4; j++) {
    int y = clamp(int(base.y) - 1 + j, 0, size.y - 1);
    for (int k = 0; k < 4; k++) {
      int x = clamp(int(base.x) - 1 + k, 0, size.x - 1);
      vec4 texel = codes(texelFetch(uLayer, ivec2(x, y), 0));
      float weight = wy[j] * wx[k];
      if (uOpaque) {
        color += texel.rgb * weight;
      } else {
        float a = texel.a * weight;
        color += texel.rgb * a;
        alpha += a;
      }
    }
  }
  if (uOpaque) return vec4(min(roundCode(clamp(color, 0.0, 255.0)), 255.0), 255.0);
  float a = clamp(alpha, 0.0, 255.0);
  vec3 rgb = a > 0.0 ? min(roundCode(clamp(color / alpha, 0.0, 255.0)), 255.0) : vec3(0.0);
  return vec4(rgb, min(roundCode(a), 255.0));
}

float hardLight(float cb, float cs) { return cs <= 0.5 ? cb * 2.0 * cs : cb + (2.0 * cs - 1.0) - cb * (2.0 * cs - 1.0); }

float softLight(float cb, float cs) {
  if (cs <= 0.5) return cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb);
  float d = cb <= 0.25 ? ((16.0 * cb - 12.0) * cb + 4.0) * cb : sqrt(cb);
  return cb + (2.0 * cs - 1.0) * (d - cb);
}

float blendChannel(float cb, float cs) {
  if (uMode == 1) return cb * cs;
  if (uMode == 2) return cb + cs - cb * cs;
  if (uMode == 3) return hardLight(cs, cb);
  if (uMode == 4) return softLight(cb, cs);
  if (uMode == 5) return hardLight(cb, cs);
  if (uMode == 6) return min(cb, cs);
  if (uMode == 7) return max(cb, cs);
  if (uMode == 8) return cb == 0.0 ? 0.0 : cs >= 1.0 ? 1.0 : min(1.0, cb / (1.0 - cs));
  if (uMode == 9) return cb >= 1.0 ? 1.0 : cs <= 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - cb) / cs);
  if (uMode == 10) return abs(cb - cs);
  if (uMode == 11) return cb + cs - 2.0 * cb * cs;
  return cs;
}

float lum(vec3 c) { return 0.3 * c.r + 0.59 * c.g + 0.11 * c.b; }

vec3 setLum(vec3 c, float l) {
  c += l - lum(c);
  float L = lum(c);
  float n = min(min(c.r, c.g), c.b);
  float x = max(max(c.r, c.g), c.b);
  if (n < 0.0) c = L + (c - L) * (L / (L - n));
  if (x > 1.0) c = L + (c - L) * ((1.0 - L) / (x - L));
  return c;
}

float sat(vec3 c) { return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }

vec3 setSat(vec3 c, float s) {
  float n = min(min(c.r, c.g), c.b);
  float range = max(max(c.r, c.g), c.b) - n;
  return range > 0.0 ? (c - n) * s / range : vec3(0.0);
}

vec3 blendRgb(vec3 cb, vec3 cs) {
  if (uMode == 12) return setLum(setSat(cs, sat(cb)), lum(cb));
  if (uMode == 13) return setLum(setSat(cb, sat(cs)), lum(cb));
  if (uMode == 14) return setLum(cs, lum(cb));
  if (uMode == 15) return setLum(cb, lum(cs));
  return vec3(blendChannel(cb.r, cs.r), blendChannel(cb.g, cs.g), blendChannel(cb.b, cs.b));
}

vec4 stored(vec3 color, float alpha) {
  return vec4(clamp(roundCode(color * 255.0), 0.0, 255.0), clamp(roundCode(alpha * 255.0), 0.0, 255.0)) / 255.0;
}

void main() {
  ivec2 at = ivec2(gl_FragCoord.xy);
  vec4 backdrop = codes(texelFetch(uBackdrop, at, 0)) / 255.0;
  float masked = uOpacity;
  if (uMasked) masked = uOpacity * (codes(texelFetch(uMask, ivec2(at.x, int(uOutputSize.y) - 1 - at.y), 0)).r / 255.0);
  if (uAdjust) {
    if (masked <= 0.0) { outColor = backdrop; return; }
    vec3 adjusted = codes(texelFetch(uLayer, at, 0)).rgb / 255.0;
    outColor = stored(backdrop.rgb + masked * (blendRgb(backdrop.rgb, adjusted) - backdrop.rgb), backdrop.a);
    return;
  }
  // Canvas pixel centre in image coordinates (row 0 at the top), as composite.mjs.
  vec2 canvas = vec2(gl_FragCoord.x, uOutputSize.y - gl_FragCoord.y);
  vec2 position = (uMatrix * vec3(canvas, 1.0)).xy;
  vec2 size = vec2(textureSize(uLayer, 0));
  float d = min(min(position.x, size.x - position.x), min(position.y, size.y - position.y));
  float coverage = clamp(d / uScale + 0.5, 0.0, 1.0);
  if (coverage <= 0.0) { outColor = backdrop; return; }
  vec4 source = sampleLayer(position);
  float alpha = source.a / 255.0 * coverage * masked;
  if (alpha <= 0.0) { outColor = backdrop; return; }
  vec3 cs = source.rgb / 255.0;
  vec3 mixed = blendRgb(backdrop.rgb, cs);
  float ao = alpha + backdrop.a * (1.0 - alpha);
  float keep = backdrop.a * (1.0 - alpha);
  outColor = stored((alpha * ((1.0 - backdrop.a) * cs + backdrop.a * mixed) + keep * backdrop.rgb) / ao, ao);
}`;

export const COPY_SHADER = `#version 300 es
precision highp float;
uniform sampler2D uFrame;
out vec4 outColor;
void main() { outColor = texelFetch(uFrame, ivec2(gl_FragCoord.xy), 0); }`;
