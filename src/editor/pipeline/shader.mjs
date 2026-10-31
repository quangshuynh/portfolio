// GLSL mirror of spec.mjs. Constants come from the JS spec so the two cannot drift;
// the per-pixel steps follow processLinear(), toneCurve() and processDisplay() in the
// same order. Geometry: each output pixel is mapped back to the source by the matrix
// geometry.mjs builds and sampled with the Catmull-Rom kernel of warp.mjs (rounded to the
// source's precision, as the CPU stores warped pixels), then faded outside the photo as
// applyCoverage() does. Curve tables and LUTs are read with texelFetch and interpolated here,
// exactly as the CPU does, so no float-texture filtering extension is needed. The creative
// stage mirrors creative.applyCreative() with the parameters creativeParams() derived; its
// glow map (computed on the CPU from the guide grid) is a float texture sampled the same way.
// Channel shift and the capture of digital.mjs are not mirrored: photos using them are
// rendered on the CPU (params.cpuOnly); the per-pixel digital effects and noise are.

import { LUMA } from './colorMath.mjs';
import { CURVE_TABLE_SIZE } from './curves.mjs';
import { BLACK_EPSILON, HSL_CENTERS, HSL_LUMINANCE_EV, SHADOW_LIFT_SCALE, TONE_PIVOT } from './spec.mjs';
import { POSITION_GRID, ROUNDING_BIAS } from './warp.mjs';
import { CREATIVE } from './creative.mjs';
import { DIGITAL } from './digital.mjs';

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
// An adjustment layer's pass (compositeShader.mjs): the source is the composite so far, fetched
// at the fragment in framebuffer orientation.
uniform bool uDirect;
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
// Camera Natural RAW profile (raw/rawProfiles.mjs): contrast, pivot, shoulder, white.
uniform bool uProfileActive;
uniform vec4 uProfileCurve;
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
// Geometry (warp.mjs): output px -> source px, the output size, and edge coverage.
uniform bool uGeometry;
uniform mat3 uGeometryMatrix;
uniform vec2 uOutputSize;
uniform bool uCoverage;
uniform float uCoverageScale;
uniform vec2 uSourceSize;
uniform int uBackground;
uniform bool uOpaque;
// Creative stage (creative.mjs).
uniform bool uCreative;
uniform bool uBleach;
uniform vec4 uBleachParams;
uniform bool uFade;
uniform vec3 uFadeBlack;
uniform float uFadeShoulder;
uniform vec3 uFadeWhite;
uniform bool uGrade;
uniform vec3 uGradeTint[4];
uniform vec4 uGradeLum;
uniform float uGradeBalance;
uniform float uGradeExponent;
uniform bool uVignette;
uniform vec4 uVignetteParams;
uniform float uVignetteExponent;
uniform bool uGrain;
uniform vec4 uGrainParams;
uniform uint uGrainSeed;
uniform uint uGrainFineSeed;
uniform bool uBloom;
uniform float uBloomAmount;
uniform bool uHalation;
uniform float uHalationAmount;
uniform vec3 uHalationTint;
uniform sampler2D uGlow;
uniform bool uDiffusion;
uniform float uDiffusionAmount;
uniform sampler2D uDiffuse;
uniform bool uSensor;
uniform mat3 uSensorMatrix;
uniform bool uResponse;
uniform vec2 uResponseParams;
uniform bool uClip;
uniform float uClipGain;
uniform bool uQuantize;
uniform float uQuantizeSteps;
uniform bool uNoise;
uniform vec3 uNoiseParams;
uniform uint uNoiseSeed;
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
const float POSITION_GRID = ${f(POSITION_GRID)};
const float ROUNDING_BIAS = ${f(ROUNDING_BIAS)};
const float BLEACH_PROTECT_FROM = ${f(CREATIVE.bleachProtectFrom)};
const float SKIN_HUE = ${f(CREATIVE.skinHue)};
const float SKIN_WIDTH = ${f(CREATIVE.skinWidth)};
const float SKIN_PROTECT = ${f(CREATIVE.skinProtect)};
const float VIGNETTE_DARKEN = ${f(CREATIVE.vignetteDarken)};
const float VIGNETTE_LIGHTEN = ${f(CREATIVE.vignetteLighten)};
const float GRAIN_FLOOR = ${f(CREATIVE.grainFloor)};
const float GRADE_BLACK = ${f(CREATIVE.gradeBlack)};
const float SQRT6 = ${f(Math.sqrt(6))};
const float NOISE_FLOOR = ${f(DIGITAL.noiseFloor)};
const vec3 NOISE_GAIN = vec3(${DIGITAL.noiseChannelGain.map(f).join(', ')});

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

float naturalTone(float y) {
  float q = uProfileCurve.y * pow(y / uProfileCurve.y, uProfileCurve.x) / uProfileCurve.z;
  float w = uProfileCurve.y * pow(uProfileCurve.w / uProfileCurve.y, uProfileCurve.x) / uProfileCurve.z;
  return q * (1.0 + q / (w * w)) / (1.0 + q);
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
  if (uProfileActive && y > BLACK_EPSILON) {
    float ratio = naturalTone(y) / y;
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

vec4 cubicWeights(float t) {
  float t2 = t * t;
  float t3 = t2 * t;
  return vec4((-t3 + 2.0 * t2 - t) * 0.5, (3.0 * t3 - 5.0 * t2 + 2.0) * 0.5, (-3.0 * t3 + 4.0 * t2 + t) * 0.5, (t3 - t2) * 0.5);
}

// Source position (px) of this output pixel's centre: gl_FragCoord holds exact centres
// (row 0 at the bottom).
vec2 sourcePosition() {
  vec3 s = uGeometryMatrix * vec3(gl_FragCoord.x, uOutputSize.y - gl_FragCoord.y, 1.0);
  return s.xy / s.z;
}

float roundCode(float v) { return floor(v + 0.5 + ROUNDING_BIAS); }
vec3 roundCode(vec3 v) { return floor(v + 0.5 + ROUNDING_BIAS); }
vec2 snapPosition(vec2 at) { return floor(at * POSITION_GRID + 0.5) / POSITION_GRID - 0.5; }

// Catmull-Rom of an RGBA8 texture in whole code values, premultiplied unless the source is
// opaque, and rounded to 8 bits: the same arithmetic as warpRows(), so ties round alike.
vec4 rgbaCubic(vec2 at) {
  ivec2 size = textureSize(uSource, 0);
  vec2 p = snapPosition(at);
  vec2 base = floor(p);
  vec4 wx = cubicWeights(p.x - base.x);
  vec4 wy = cubicWeights(p.y - base.y);
  vec3 color = vec3(0.0);
  float alpha = 0.0;
  for (int j = 0; j < 4; j++) {
    int y = clamp(int(base.y) - 1 + j, 0, size.y - 1);
    for (int k = 0; k < 4; k++) {
      int x = clamp(int(base.x) - 1 + k, 0, size.x - 1);
      vec4 texel = floor(texelFetch(uSource, ivec2(x, y), 0) * 255.0 + 0.5);
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
  if (uOpaque) return vec4(min(roundCode(clamp(color, 0.0, 255.0)), 255.0) / 255.0, 1.0);
  float a = clamp(alpha, 0.0, 255.0);
  vec3 rgb = a > 0.0 ? min(roundCode(clamp(color / alpha, 0.0, 255.0)), 255.0) : vec3(0.0);
  return vec4(rgb, min(roundCode(a), 255.0)) / 255.0;
}

// Catmull-Rom of 16-bit camera RGB, rounded to whole values like warpRows().
vec3 rawCubic(vec2 at) {
  ivec2 size = textureSize(uRawSource, 0);
  vec2 p = snapPosition(at);
  vec2 base = floor(p);
  vec4 wx = cubicWeights(p.x - base.x);
  vec4 wy = cubicWeights(p.y - base.y);
  vec3 sum = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    int y = clamp(int(base.y) - 1 + j, 0, size.y - 1);
    for (int k = 0; k < 4; k++) {
      int x = clamp(int(base.x) - 1 + k, 0, size.x - 1);
      sum += vec3(texelFetch(uRawSource, ivec2(x, y), 0).rgb) * (wy[j] * wx[k]);
    }
  }
  return min(roundCode(clamp(sum, 0.0, 65535.0)), 65535.0);
}

vec3 hdrCubic(vec2 at) {
  ivec2 size = textureSize(uHdrSource, 0);
  vec2 p = snapPosition(at);
  vec2 base = floor(p);
  vec4 wx = cubicWeights(p.x - base.x);
  vec4 wy = cubicWeights(p.y - base.y);
  vec3 sum = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    int y = clamp(int(base.y) - 1 + j, 0, size.y - 1);
    for (int k = 0; k < 4; k++) {
      int x = clamp(int(base.x) - 1 + k, 0, size.x - 1);
      sum += texelFetch(uHdrSource, ivec2(x, y), 0).rgb * (wy[j] * wx[k]);
    }
  }
  return max(sum, 0.0);
}

// Fades pixels outside the photo to the background (applyCoverage in warp.mjs).
vec4 finish(vec4 color, vec2 at) {
  if (!uGeometry || !uCoverage) return color;
  float d = min(min(at.x, uSourceSize.x - at.x), min(at.y, uSourceSize.y - at.y));
  float coverage = clamp(d / uCoverageScale + 0.5, 0.0, 1.0);
  if (coverage >= 1.0) return color;
  float alpha = color.a * coverage;
  if (uBackground == 0) return vec4(color.rgb, alpha);
  float solid = uBackground == 1 ? 1.0 : 0.0;
  return vec4(toSrgb3(toLinear3(color.rgb) * alpha + solid * (1.0 - alpha)), 1.0);
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

// ---- Creative stage (creative.mjs) ----

// Output pixel indices (row 0 at the top) of this fragment.
vec2 outputPixel() { return vec2(gl_FragCoord.x - 0.5, uOutputSize.y - gl_FragCoord.y - 0.5); }

float skinWeight(vec3 p) {
  float hi = max(p.r, max(p.g, p.b));
  float chroma = hi - min(p.r, min(p.g, p.b));
  if (chroma <= 0.0) return 0.0;
  float hue = hi == p.r ? (p.g - p.b) / chroma : hi == p.g ? (p.b - p.r) / chroma + 2.0 : (p.r - p.g) / chroma + 4.0;
  hue *= 60.0;
  if (hue < 0.0) hue += 360.0;
  float s = chroma / hi;
  float away = abs(hue - SKIN_HUE);
  float d = min(away, 360.0 - away);
  if (d >= SKIN_WIDTH) return 0.0;
  return (0.5 + 0.5 * cos(PI * d / SKIN_WIDTH)) * smoothstep(0.08, 0.2, s) * (1.0 - smoothstep(0.55, 0.75, s));
}

vec3 bleachBypass(vec3 p) {
  float l = clamp(dot(LUMA, p), 0.0, 1.0);
  float curve = l < 0.5 ? 2.0 * l * l : 1.0 - 2.0 * (1.0 - l) * (1.0 - l);
  float s = l + uBleachParams.y * (curve - l);
  float desaturation = uBleachParams.x * uBleachParams.z * (1.0 - SKIN_PROTECT * skinWeight(p) * (1.0 - uBleachParams.z * uBleachParams.z));
  float k = uBleachParams.x * (1.0 - uBleachParams.w * smoothstep(BLEACH_PROTECT_FROM, 1.0, l));
  vec3 silver = p + ((1.0 - 2.0 * s) * p * p + 2.0 * s * p - p) * k;
  float y = dot(LUMA, silver);
  return clamp(y + (silver - y) * (1.0 - desaturation), 0.0, 1.0);
}

vec3 filmFade(vec3 p) {
  vec3 v = clamp(p, 0.0, 1.0);
  vec3 g = uFadeShoulder > 0.0 ? v / pow(1.0 + uFadeShoulder * v * v * v * v, vec3(0.25)) : v;
  return clamp(uFadeBlack + (1.0 - uFadeBlack) * g + uFadeWhite * g * g, 0.0, 1.0);
}

vec3 fitEncoded(vec3 p, float y) {
  if (y >= 1.0 || y <= 0.0) return vec3(y);
  float hi = max(p.r, max(p.g, p.b));
  float lo = min(p.r, min(p.g, p.b));
  float t = 1.0;
  if (hi > 1.0) t = min(t, (1.0 - y) / (hi - y));
  if (lo < 0.0) t = min(t, y / (y - lo));
  return clamp(y + (p - y) * t, 0.0, 1.0);
}

float powPositive(float x, float e) { return x <= 0.0 ? 0.0 : pow(x, e); }

vec3 colorGrade(vec3 p) {
  float l = dot(LUMA, p);
  float x = clamp(l, 0.0, 1.0);
  float shifted = x + uGradeBalance * x * (1.0 - x);
  float ws = powPositive(1.0 - shifted, uGradeExponent);
  float wh = powPositive(shifted, uGradeExponent);
  float wm = 1.0 - ws - wh;
  float offset = ws * uGradeLum.x + wm * uGradeLum.y + wh * uGradeLum.z + uGradeLum.w;
  float tint = min(1.0, max(0.0, l) / GRADE_BLACK);
  p += (ws * uGradeTint[0] + wm * uGradeTint[1] + wh * uGradeTint[2] + uGradeTint[3]) * tint + offset;
  return fitEncoded(p, clamp(dot(LUMA, p), 0.0, 1.0));
}

float vignetteFalloff(vec2 at) {
  vec2 uv = (at + 0.5) / uOutputSize * 2.0 - 1.0;
  if (uVignetteParams.w > 0.0) uv *= 1.0 + uVignetteParams.w * (uOutputSize / max(uOutputSize.x, uOutputSize.y) - 1.0);
  float d = uVignetteExponent == 2.0 ? sqrt(uv.x * uv.x + uv.y * uv.y)
    : powPositive(powPositive(abs(uv.x), uVignetteExponent) + powPositive(abs(uv.y), uVignetteExponent), 1.0 / uVignetteExponent);
  return smoothstep(uVignetteParams.y - uVignetteParams.z / 2.0, uVignetteParams.y + uVignetteParams.z / 2.0, d);
}

// The same 32 bits as creative.grainHash().
uint grainHash(int i, int j, uint seed) {
  uint h = (uint(i) * 0x27d4eb2du) ^ (uint(j) * 0x165667b1u) ^ seed;
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = (h ^ (h >> 13u)) * 0xc2b2ae35u;
  return h ^ (h >> 16u);
}

float latticeValue(int i, int j, uint seed) {
  uint h = grainHash(i, j, seed);
  return (float(h & 0xffffu) / 65536.0 + float(h >> 16u) / 65536.0 - 1.0) * SQRT6;
}

vec4 bspline(float t) {
  float t2 = t * t;
  float t3 = t2 * t;
  float u = 1.0 - t;
  return vec4(u * u * u / 6.0, (3.0 * t3 - 6.0 * t2 + 4.0) / 6.0, (-3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0) / 6.0, t3 / 6.0);
}

float valueNoise(vec2 at, uint seed) {
  vec2 base = floor(at);
  vec4 wx = bspline(at.x - base.x);
  vec4 wy = bspline(at.y - base.y);
  int ix = int(base.x);
  int iy = int(base.y);
  float sum = 0.0;
  for (int j = 0; j < 4; j++) {
    float row = 0.0;
    for (int i = 0; i < 4; i++) row += wx[i] * latticeValue(ix - 1 + i, iy - 1 + j, seed);
    sum += wy[j] * row;
  }
  return sum / sqrt(dot(wx, wx) * dot(wy, wy));
}

float grainValue(vec2 at) {
  vec2 g = (at + 0.5) / uGrainParams.w / uGrainParams.y;
  float coarse = valueNoise(g, uGrainSeed);
  float r = uGrainParams.z;
  if (r == 0.0) return coarse;
  float fine = valueNoise(g * 2.0 + vec2(17.31, 5.77), uGrainFineSeed);
  return ((1.0 - r) * coarse + r * fine) / sqrt((1.0 - r) * (1.0 - r) + r * r);
}

// Bilinear sample of the glow map (or the soft focus map) at an output pixel (creative.sampleGlow).
vec4 glowAt(sampler2D map, vec2 at) {
  ivec2 size = textureSize(map, 0);
  vec2 g = clamp((at + 0.5) * vec2(size) / uOutputSize - 0.5, vec2(0.0), vec2(size - 1));
  ivec2 i0 = ivec2(floor(g));
  ivec2 i1 = min(i0 + 1, size - 1);
  vec2 t = g - vec2(i0);
  vec4 a = texelFetch(map, i0, 0);
  vec4 b = texelFetch(map, ivec2(i1.x, i0.y), 0);
  vec4 c = texelFetch(map, ivec2(i0.x, i1.y), 0);
  vec4 d = texelFetch(map, i1, 0);
  return a * (1.0 - t.x) * (1.0 - t.y) + b * t.x * (1.0 - t.y) + c * (1.0 - t.x) * t.y + d * t.x * t.y;
}

vec3 screen(vec3 a, vec3 b) { return a + b - a * b; }

// ---- Digital effects (digital.mjs) ----

vec3 diffuse(vec3 lin, vec3 blurred) {
  return lin + uDiffusionAmount * (blurred - lin) * mix(vec3(0.5), vec3(1.0), vec3(greaterThan(blurred, lin)));
}

vec3 cameraResponse(vec3 p) {
  vec3 v = clamp(p, 0.0, 1.0);
  vec3 lo = 0.5 * pow(2.0 * v, vec3(uResponseParams.x));
  vec3 hi = 1.0 - 0.5 * pow(max(2.0 - 2.0 * v, 0.0), vec3(uResponseParams.x));
  p = mix(hi, lo, vec3(lessThan(v, vec3(0.5))));
  float y = dot(LUMA, p);
  return clamp(y + (p - y) * uResponseParams.y, 0.0, 1.0);
}

float triangular(uint h) { return (float(h & 0xffffu) / 65536.0 + float(h >> 16u) / 65536.0 - 1.0) * SQRT6; }

// digital.applyNoise: uNoiseParams = (amplitude × min(1, unit), chroma share, unit).
vec3 sensorNoise(vec3 p, vec2 at) {
  int ix = int(floor((at.x + 0.5) / uNoiseParams.z));
  int iy = int(floor((at.y + 0.5) / uNoiseParams.z));
  float n0 = triangular(grainHash(ix, iy, uNoiseSeed));
  vec3 n = vec3(triangular(grainHash(ix, iy, uNoiseSeed + 0x632be5abu)), triangular(grainHash(ix, iy, uNoiseSeed + 0xc657cb56u)), triangular(grainHash(ix, iy, uNoiseSeed + 0x2983b101u)));
  float l = clamp(dot(LUMA, p), 0.0, 1.0);
  float sigma = uNoiseParams.x * (NOISE_FLOOR + (1.0 - NOISE_FLOOR) * (1.0 - l) * (1.0 - l));
  float c = uNoiseParams.y;
  float norm = 1.0 / sqrt((1.0 - c) * (1.0 - c) + c * c);
  return clamp(p + sigma * norm * ((1.0 - c) * n0 + c * NOISE_GAIN * n), 0.0, 1.0);
}

vec3 applyCreative(vec3 p) {
  vec2 at = outputPixel();
  if (uBloom || uHalation || uDiffusion) {
    vec3 lin = toLinear3(clamp(p, 0.0, 1.0));
    if (uBloom || uHalation) {
      vec4 glow = glowAt(uGlow, at);
      if (uBloom) lin = screen(lin, min(vec3(1.0), uBloomAmount * glow.rgb));
      if (uHalation) lin = screen(lin, min(vec3(1.0), uHalationAmount * glow.a * uHalationTint));
    }
    if (uDiffusion) lin = diffuse(lin, glowAt(uDiffuse, at).rgb);
    p = toSrgb3(lin);
  }
  if (uSensor) p = clamp(uSensorMatrix * p, 0.0, 1.0);
  if (uResponse) p = cameraResponse(p);
  if (uClip) p = min(vec3(1.0), max(p, 0.0) * uClipGain);
  if (uBleach) p = bleachBypass(p);
  if (uFade) p = filmFade(p);
  if (uGrade) p = colorGrade(p);
  if (uQuantize) p = clamp(floor(clamp(p, 0.0, 1.0) * uQuantizeSteps + 0.5), 0.0, uQuantizeSteps) / uQuantizeSteps;
  if (uVignette) {
    float fall = vignetteFalloff(at);
    if (fall > 0.0) {
      if (uVignetteParams.x < 0.0) p = toSrgb3(toLinear3(clamp(p, 0.0, 1.0)) * (1.0 + uVignetteParams.x * VIGNETTE_DARKEN * fall));
      else p += (1.0 - p) * (uVignetteParams.x * VIGNETTE_LIGHTEN * fall);
    }
  }
  if (uNoise) p = sensorNoise(p, at);
  if (uGrain) {
    float l = clamp(dot(LUMA, p), 0.0, 1.0);
    float tone = GRAIN_FLOOR + (1.0 - GRAIN_FLOOR) * 4.0 * l * (1.0 - l);
    p = clamp(p + uGrainParams.x * tone * grainValue(at), 0.0, 1.0);
  }
  return p;
}

void main() {
  vec3 p;
  float alpha = 1.0;
  vec2 position = uGeometry ? sourcePosition() : vec2(0.0);
  if (uRaw) {
    ivec2 size = textureSize(uRawSource, 0);
    ivec2 at = min(ivec2(vUv * vec2(size)), size - 1);
    vec3 sensor = uGeometry ? rawCubic(position) : vec3(texelFetch(uRawSource, at, 0).rgb);
    vec3 camera = min(sensor / 65535.0 * uRawGain, uRawWhite);
    p = toSrgb3(process(uRawMatrix * camera));
  } else if (uHdr) {
    ivec2 size = textureSize(uHdrSource, 0);
    ivec2 at = min(ivec2(vUv * vec2(size)), size - 1);
    vec3 camera = min((uGeometry ? hdrCubic(position) : texelFetch(uHdrSource, at, 0).rgb) * uRawGain, uRawWhite);
    p = toSrgb3(process(uRawMatrix * camera));
  } else {
    vec4 source = uDirect ? texelFetch(uSource, ivec2(gl_FragCoord.xy), 0) : uGeometry ? rgbaCubic(position) : texture(uSource, vUv);
    if (uNeutral) {
      outColor = finish(source, position);
      return;
    }
    alpha = source.a;
    p = uBaseNeutral ? source.rgb : toSrgb3(process(toLinear3(source.rgb)));
  }
  if (uCurvesActive) p = applyCurves(p);
  if (uHslActive) p = applyHsl(p);
  if (uLutActive) p = applyLut(p);
  if (uCreative) p = applyCreative(p);
  outColor = finish(vec4(p, alpha), position);
}`;
