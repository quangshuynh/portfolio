// GLSL mirror of spec.mjs. Constants come from the JS spec so the two cannot drift;
// the per-pixel steps follow processLinear() and toneCurve() in the same order.

import { LUMA } from './colorMath.mjs';
import { BLACK_EPSILON, TONE_PIVOT } from './spec.mjs';

const f = (value) => {
  const text = String(value);
  return /[.e]/.test(text) ? text : `${text}.0`;
};

export const VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main() {
  // Texture row 0 is the top of the image; clip space y = +1 is the top of the canvas.
  vUv = vec2(aPosition.x * 0.5 + 0.5, 0.5 - aPosition.y * 0.5);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform bool uWhiteBalanceActive;
uniform mat3 uWhiteBalance;
uniform float uExposureGain;
uniform bool uToneActive;
uniform float uContrast;
uniform float uHighlights;
uniform float uShadows;
uniform float uWhites;
uniform float uBlacks;
uniform float uVibrance;
uniform float uSaturation;
uniform bool uNeutral;
// Split comparison: pixels with x below uSplit (0..1 of the width) show the source.
uniform float uSplit;
in vec2 vUv;
out vec4 outColor;

const vec3 LUMA = vec3(${f(LUMA[0])}, ${f(LUMA[1])}, ${f(LUMA[2])});
const float PIVOT = ${f(TONE_PIVOT)};
const float BLACK_EPSILON = ${f(BLACK_EPSILON)};

float toLinear(float v) {
  return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4);
}
float toSrgb(float v) {
  if (v <= 0.0) return 0.0;
  return v <= 0.0031308 ? v * 12.92 : 1.055 * pow(v, 1.0 / 2.4) - 0.055;
}

float toneCurve(float p) {
  float x = clamp(p, 0.0, 1.0);
  float excess = max(0.0, p - 1.0);
  float s = x < PIVOT ? PIVOT * pow(x / PIVOT, 2.0) : 1.0 - (1.0 - PIVOT) * pow((1.0 - x) / (1.0 - PIVOT), 2.0);
  x += uContrast * (s - x);
  float x2 = x * x;
  x += uHighlights * x2 * x2 * x * (1.0 - x);
  float inv = 1.0 - x;
  float inv2 = inv * inv;
  x += uShadows * x * inv2 * inv2 * inv;
  x *= 1.0 + uWhites * x * x;
  float below = max(0.0, 1.0 - x);
  x += uBlacks * below * below;
  return x + excess;
}

float toneLuminance(float y) {
  return toLinear(toneCurve(toSrgb(y)));
}

vec3 process(vec3 rgb) {
  if (uWhiteBalanceActive) rgb = max(uWhiteBalance * rgb, 0.0);
  rgb *= uExposureGain;
  float y = dot(LUMA, rgb);
  if (uToneActive) {
    if (y > BLACK_EPSILON) {
      float ratio = toneLuminance(y) / y;
      rgb *= ratio;
      y *= ratio;
    } else {
      y = toneLuminance(0.0);
      rgb = vec3(y);
    }
  }
  if (uVibrance != 0.0) {
    float hi = max(rgb.r, max(rgb.g, rgb.b));
    float chroma = hi > BLACK_EPSILON ? (hi - min(rgb.r, min(rgb.g, rgb.b))) / hi : 0.0;
    rgb = y + (rgb - y) * max(0.0, 1.0 + uVibrance * (1.0 - chroma));
  }
  if (uSaturation != 1.0) rgb = y + (rgb - y) * uSaturation;
  float hi = max(rgb.r, max(rgb.g, rgb.b));
  if (hi > 1.0) rgb = y >= 1.0 ? vec3(1.0) : y + (rgb - y) * ((1.0 - y) / (hi - y));
  float lo = min(rgb.r, min(rgb.g, rgb.b));
  if (lo < 0.0) rgb = y <= 0.0 ? vec3(0.0) : y + (rgb - y) * (y / (y - lo));
  return clamp(rgb, 0.0, 1.0);
}

void main() {
  vec4 source = texture(uSource, vUv);
  if (uNeutral || vUv.x < uSplit) {
    outColor = source;
    return;
  }
  vec3 linear = vec3(toLinear(source.r), toLinear(source.g), toLinear(source.b));
  vec3 rgb = process(linear);
  outColor = vec4(toSrgb(rgb.r), toSrgb(rgb.g), toSrgb(rgb.b), source.a);
}`;
