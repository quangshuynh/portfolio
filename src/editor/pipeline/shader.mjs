// GLSL mirror of spec.mjs. Constants come from the JS spec so the two cannot drift;
// the per-pixel steps follow processLinear(), toneCurve() and processDisplay() in the
// same order. Curve tables and LUTs are read with texelFetch and interpolated here,
// exactly as the CPU does, so no float-texture filtering extension is needed.

import { LUMA } from './colorMath.mjs';
import { CURVE_TABLE_SIZE } from './curves.mjs';
import { BLACK_EPSILON, HSL_CENTERS, HSL_LUMINANCE_EV, SHADOW_LIFT_SCALE, TONE_PIVOT } from './spec.mjs';

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
precision highp sampler3D;
precision highp usampler2D;
uniform sampler2D uSource;
// RAW sources: 16-bit camera RGB as an integer texture, developed by developRaw().
uniform bool uRaw;
uniform usampler2D uRawSource;
uniform vec3 uRawGain;
uniform mat3 uRawMatrix;
uniform float uRawWhite;
// Merged RAW HDR: float camera RGB (RGB32F), developed like RAW with a higher white.
uniform bool uHdr;
uniform sampler2D uHdrSource;
uniform float uShadowLift;
uniform float uRolloffWhite;
uniform float uRolloffKnee;
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
uniform bool uBaseNeutral;
// Tone curves: CURVE_SIZE RGBA32F texels; r, g, b = channel curves, a = master.
uniform bool uCurvesActive;
uniform bvec4 uCurveActive;
uniform sampler2D uCurves;
uniform bool uHslActive;
uniform float uHslHue[8];
uniform float uHslSat[8];
uniform float uHslLum[8];
uniform bool uLutActive;
uniform sampler3D uLut;
uniform int uLutSize;
uniform vec3 uLutDomainMin;
uniform vec3 uLutDomainMax;
uniform float uLutIntensity;
in vec2 vUv;
out vec4 outColor;

const vec3 LUMA = vec3(${f(LUMA[0])}, ${f(LUMA[1])}, ${f(LUMA[2])});
const float PIVOT = ${f(TONE_PIVOT)};
const float BLACK_EPSILON = ${f(BLACK_EPSILON)};
const int CURVE_SIZE = ${CURVE_TABLE_SIZE};
const float HSL_EV = ${f(HSL_LUMINANCE_EV)};
const float HSL_CENTERS[8] = float[8](${HSL_CENTERS.map(f).join(', ')});
const float PI = 3.141592653589793;
const float SHADOW_LIFT_SCALE = ${f(SHADOW_LIFT_SCALE)};

float toLinear(float v) {
  return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4);
}
float toSrgb(float v) {
  if (v <= 0.0) return 0.0;
  return v <= 0.0031308 ? v * 12.92 : 1.055 * pow(v, 1.0 / 2.4) - 0.055;
}
vec3 toLinear3(vec3 v) { return vec3(toLinear(v.r), toLinear(v.g), toLinear(v.b)); }
vec3 toSrgb3(vec3 v) { return vec3(toSrgb(v.r), toSrgb(v.g), toSrgb(v.b)); }

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

vec3 fitRange(vec3 rgb, float y) {
  float hi = max(rgb.r, max(rgb.g, rgb.b));
  if (hi > 1.0) rgb = y >= 1.0 ? vec3(1.0) : y + (rgb - y) * ((1.0 - y) / (hi - y));
  float lo = min(rgb.r, min(rgb.g, rgb.b));
  if (lo < 0.0) rgb = y <= 0.0 ? vec3(0.0) : y + (rgb - y) * (y / (y - lo));
  return clamp(rgb, 0.0, 1.0);
}

float highlightRolloff(float y) {
  float excess = y - uRolloffKnee;
  float a = (uRolloffWhite - 1.0) / ((1.0 - uRolloffKnee) * (uRolloffWhite - uRolloffKnee));
  return uRolloffKnee + excess / (1.0 + excess * a);
}

vec3 process(vec3 rgb) {
  if (uWhiteBalanceActive) rgb = max(uWhiteBalance * rgb, 0.0);
  rgb *= uExposureGain;
  float y = dot(LUMA, rgb);
  if (uShadowLift != 0.0 && y > BLACK_EPSILON) {
    float ratio = 1.0 + uShadowLift * SHADOW_LIFT_SCALE / (y + SHADOW_LIFT_SCALE);
    rgb *= ratio;
    y *= ratio;
  }
  if (uRolloffWhite > 0.0 && y > uRolloffKnee) {
    float ratio = highlightRolloff(y) / y;
    rgb *= ratio;
    y *= ratio;
  }
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
  return fitRange(rgb, y);
}

float curveAt(int c, float v) {
  float position = clamp(v, 0.0, 1.0) * float(CURVE_SIZE - 1);
  int index = min(CURVE_SIZE - 2, int(floor(position)));
  float a = texelFetch(uCurves, ivec2(index, 0), 0)[c];
  float b = texelFetch(uCurves, ivec2(index + 1, 0), 0)[c];
  return a + (b - a) * (position - float(index));
}

vec3 applyCurves(vec3 p) {
  for (int c = 0; c < 3; c++) {
    float v = p[c];
    if (uCurveActive.a) v = curveAt(3, v);
    if (uCurveActive[c]) v = curveAt(c, v);
    p[c] = v;
  }
  return p;
}

vec3 hsvToRgb(float hue, float s, float v) {
  vec3 k = mod(vec3(5.0, 3.0, 1.0) + hue / 60.0, 6.0);
  return v - v * s * max(vec3(0.0), min(min(k, 4.0 - k), vec3(1.0)));
}

vec3 applyHsl(vec3 p) {
  float hi = max(p.r, max(p.g, p.b));
  float chroma = hi - min(p.r, min(p.g, p.b));
  if (chroma <= 0.0) return p;
  float hue = hi == p.r ? (p.g - p.b) / chroma : hi == p.g ? (p.b - p.r) / chroma + 2.0 : (p.r - p.g) / chroma + 4.0;
  hue *= 60.0;
  if (hue < 0.0) hue += 360.0;
  float s = chroma / hi;
  int k = 0;
  for (int i = 1; i < 8; i++) if (hue >= HSL_CENTERS[i]) k = i;
  int n = k == 7 ? 0 : k + 1;
  float end = n == 0 ? 360.0 : HSL_CENTERS[n];
  float wn = 0.5 - 0.5 * cos(PI * ((hue - HSL_CENTERS[k]) / (end - HSL_CENTERS[k])));
  float wk = 1.0 - wn;
  float shift = wk * uHslHue[k] + wn * uHslHue[n];
  float saturation = 1.0 + wk * uHslSat[k] + wn * uHslSat[n];
  float luminance = wk * uHslLum[k] + wn * uHslLum[n];
  if (shift == 0.0 && saturation == 1.0 && luminance == 0.0) return p;
  vec3 lin = toLinear3(p);
  float y = dot(LUMA, lin);
  if (shift != 0.0) {
    float turned = hue + shift;
    lin = toLinear3(hsvToRgb(turned - 360.0 * floor(turned / 360.0), s, hi));
    float turnedY = dot(LUMA, lin);
    if (turnedY > BLACK_EPSILON) lin *= y / turnedY;
  }
  if (saturation != 1.0) lin = y + (lin - y) * max(0.0, saturation);
  if (luminance != 0.0) {
    float gain = exp2(HSL_EV * luminance * s);
    lin *= gain;
    y *= gain;
  }
  return toSrgb3(fitRange(lin, y));
}

vec3 lutAt(ivec3 i) { return texelFetch(uLut, i, 0).rgb; }

// Tetrahedral interpolation, as sampleLut() in lut.mjs.
vec3 applyLut(vec3 p) {
  vec3 t = clamp((p - uLutDomainMin) / (uLutDomainMax - uLutDomainMin), 0.0, 1.0);
  vec3 position = t * float(uLutSize - 1);
  ivec3 base = min(ivec3(floor(position)), ivec3(uLutSize - 2));
  vec3 fr = position - vec3(base);
  vec3 c000 = lutAt(base);
  vec3 c111 = lutAt(base + ivec3(1));
  vec3 v;
  if (fr.r > fr.g) {
    if (fr.g > fr.b) v = (1.0 - fr.r) * c000 + (fr.r - fr.g) * lutAt(base + ivec3(1, 0, 0)) + (fr.g - fr.b) * lutAt(base + ivec3(1, 1, 0)) + fr.b * c111;
    else if (fr.r > fr.b) v = (1.0 - fr.r) * c000 + (fr.r - fr.b) * lutAt(base + ivec3(1, 0, 0)) + (fr.b - fr.g) * lutAt(base + ivec3(1, 0, 1)) + fr.g * c111;
    else v = (1.0 - fr.b) * c000 + (fr.b - fr.r) * lutAt(base + ivec3(0, 0, 1)) + (fr.r - fr.g) * lutAt(base + ivec3(1, 0, 1)) + fr.g * c111;
  } else if (fr.b > fr.g) {
    v = (1.0 - fr.b) * c000 + (fr.b - fr.g) * lutAt(base + ivec3(0, 0, 1)) + (fr.g - fr.r) * lutAt(base + ivec3(0, 1, 1)) + fr.r * c111;
  } else if (fr.b > fr.r) {
    v = (1.0 - fr.g) * c000 + (fr.g - fr.b) * lutAt(base + ivec3(0, 1, 0)) + (fr.b - fr.r) * lutAt(base + ivec3(0, 1, 1)) + fr.r * c111;
  } else {
    v = (1.0 - fr.g) * c000 + (fr.g - fr.r) * lutAt(base + ivec3(0, 1, 0)) + (fr.r - fr.b) * lutAt(base + ivec3(1, 1, 0)) + fr.b * c111;
  }
  return p + (clamp(v, 0.0, 1.0) - p) * uLutIntensity;
}

void main() {
  vec3 p;
  float alpha = 1.0;
  if (uRaw) {
    ivec2 size = textureSize(uRawSource, 0);
    ivec2 at = min(ivec2(vUv * vec2(size)), size - 1);
    vec3 camera = min(vec3(texelFetch(uRawSource, at, 0).rgb) / 65535.0 * uRawGain, uRawWhite);
    p = toSrgb3(process(uRawMatrix * camera));
  } else if (uHdr) {
    ivec2 size = textureSize(uHdrSource, 0);
    ivec2 at = min(ivec2(vUv * vec2(size)), size - 1);
    vec3 camera = min(texelFetch(uHdrSource, at, 0).rgb * uRawGain, uRawWhite);
    p = toSrgb3(process(uRawMatrix * camera));
  } else {
    vec4 source = texture(uSource, vUv);
    if (uNeutral) {
      outColor = source;
      return;
    }
    alpha = source.a;
    p = uBaseNeutral ? source.rgb : toSrgb3(process(toLinear3(source.rgb)));
  }
  if (uCurvesActive) p = applyCurves(p);
  if (uHslActive) p = applyHsl(p);
  if (uLutActive) p = applyLut(p);
  outColor = vec4(p, alpha);
}`;
