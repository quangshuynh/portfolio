// Creative looks: curated starting points made only of the photo's own creative controls
// (pipeline/creative.mjs), run through the same engine as any edit. Applying a look
// replaces the whole Creative group (every creative control the look leaves out becomes
// neutral) and keeps everything else, including the grain pattern's seed, in one undo step.
// Intensity scales the look's amounts (controls marked `scales`) from neutral; character
// settings such as hues, radii and thresholds stay as the look sets them. After applying,
// the controls are ordinary settings: change them and save the result as a preset.

import { adjustmentSpec, clampAdjustment, groupKeys } from './adjustments.mjs';

const LOOK_KEYS = groupKeys('creative').filter((key) => key !== 'grainSeed');

export const BUILT_IN_LOOKS = Object.freeze([
  {
    id: 'look:bleach-bypass',
    name: 'Bleach Bypass',
    description: 'Muted colour, dense shadows and a hard, silvery contrast.',
    settings: { bleachAmount: 80, bleachContrast: 60, bleachDesaturation: 65, bleachProtect: 35, vignetteAmount: -20, grainAmount: 15 },
  },
  {
    id: 'look:soft-print',
    name: 'Soft Print',
    description: 'Lifted cool blacks, gentle highlights and fine grain.',
    settings: { fade: 25, fadeHighlights: 35, fadeShadowTint: 30, fadeShadowHue: 210, gradeHighlightsHue: 40, gradeHighlightsSat: 12, halationAmount: 10, grainAmount: 20, grainSize: 30 },
  },
  {
    id: 'look:vintage-fade',
    name: 'Vintage Fade',
    description: 'Brown faded blacks, warm whites, muted colour and coarse grain.',
    settings: {
      bleachAmount: 25, bleachContrast: 0, bleachDesaturation: 80, fade: 45, fadeHighlights: 40, fadeShadowTint: 45, fadeShadowHue: 30,
      fadeHighlightTint: 35, fadeHighlightHue: 50, gradeGlobalHue: 35, gradeGlobalSat: 10, grainAmount: 30, grainSize: 55, grainRoughness: 65, vignetteAmount: -25,
    },
  },
  {
    id: 'look:cinematic-cool',
    name: 'Cinematic Cool',
    description: 'Teal shadows, warm highlights, slightly muted.',
    settings: {
      gradeShadowsHue: 200, gradeShadowsSat: 35, gradeMidtonesHue: 190, gradeMidtonesSat: 8, gradeHighlightsHue: 35, gradeHighlightsSat: 20,
      gradeBalance: -10, gradeBlending: 55, bleachAmount: 20, bleachDesaturation: 40, fade: 8, vignetteAmount: -15,
    },
  },
  {
    id: 'look:warm-analog',
    name: 'Warm Analog',
    description: 'Warm colour, soft highlights, red halation and grain.',
    settings: {
      gradeShadowsHue: 25, gradeShadowsSat: 18, gradeHighlightsHue: 45, gradeHighlightsSat: 25, gradeGlobalHue: 35, gradeGlobalSat: 8,
      fade: 18, fadeHighlights: 25, fadeShadowTint: 25, fadeShadowHue: 25, halationAmount: 25, halationRadius: 35, grainAmount: 25, grainSize: 40, vignetteAmount: -15,
    },
  },
  {
    id: 'look:black-and-white-film',
    name: 'Black & White Film',
    description: 'Monochrome silver image with grain and a slight fade.',
    settings: { bleachAmount: 100, bleachContrast: 45, bleachDesaturation: 100, bleachProtect: 40, fade: 10, grainAmount: 35, grainSize: 45, grainRoughness: 60, vignetteAmount: -20 },
  },
  {
    id: 'look:dreamy-glow',
    name: 'Dreamy Glow',
    description: 'Soft bloom around light, rolled-off whites, pastel tints.',
    settings: { bloomAmount: 55, bloomRadius: 55, bloomThreshold: 45, fade: 12, fadeHighlights: 30, gradeHighlightsHue: 330, gradeHighlightsSat: 10, gradeShadowsHue: 260, gradeShadowsSat: 10 },
  },
].map((look) => Object.freeze({ ...look, settings: Object.freeze(look.settings) })));

/**
 * The settings patch of a look at an intensity (0–100): every creative control except the
 * grain seed, from the look or neutral, amounts scaled from neutral.
 */
export function lookPatch(look, intensity = 100) {
  const t = Math.min(100, Math.max(0, intensity)) / 100;
  return Object.fromEntries(LOOK_KEYS.map((key) => {
    const spec = adjustmentSpec(key);
    const target = look.settings[key] ?? spec.default;
    return [key, clampAdjustment(key, spec.scales ? spec.default + (target - spec.default) * t : target)];
  }));
}

/** True when the creative settings are exactly a look at that intensity. */
export const lookMatches = (adjustments, look, intensity) => Object.entries(lookPatch(look, intensity)).every(([key, value]) => adjustments[key] === value);
