// The Filter Library: original, named starting points made only of the photo's Creative
// controls (pipeline/creative.mjs and digital.mjs), grouped by category. The Interval 11 looks
// (looks.mjs) are part of it with their ids. Every filter is an approximation of a look chosen
// by eye, not a measurement or reproduction of a camera, film stock or another application.
//
// Applying a filter replaces the Creative group (lookPatch: what the filter leaves out is
// neutral, the grain seed is kept) and records { id, strength } in `adjustments.filter`; every
// other group (Light, Color, HSL, Detail, curves, LUT, geometry, RAW, HDR, text) is kept.
// Strength scales the filter's amounts from neutral, so 0 is the photo without Creative effects.
// A second filter replaces the first. Changing a Creative control afterwards keeps the record
// but marks the filter as modified (filterState); such settings can be saved as a custom filter:
// a preset with only the Creative group, which the library lists under Custom.

import { BUILT_IN_LOOKS, lookMatches, lookPatch } from './looks.mjs';
import { groupKeys } from './adjustments.mjs';

export const FILTER_CATEGORIES = Object.freeze([
  { id: 'digicam', label: 'Digicam & early digital' },
  { id: 'vintage', label: 'Vintage & nostalgic' },
  { id: 'cinematic', label: 'Cinematic & dramatic' },
  { id: 'experimental', label: 'Experimental' },
  { id: 'custom', label: 'Custom' },
].map(Object.freeze));

const LOOK_CATEGORY = {
  'look:bleach-bypass': 'cinematic',
  'look:soft-print': 'vintage',
  'look:vintage-fade': 'vintage',
  'look:cinematic-cool': 'cinematic',
  'look:warm-analog': 'vintage',
  'look:black-and-white-film': 'vintage',
  'look:dreamy-glow': 'vintage',
};

const NEW_FILTERS = [
  // Digicam and early digital.
  {
    id: 'filter:classic-ccd', name: 'Classic CCD', category: 'digicam',
    description: 'Cool, punchy colour with hard highlights and fine sensor noise.',
    settings: { sensorColor: -55, cameraResponse: 50, highlightClip: 30, gradeShadowsHue: 175, gradeShadowsSat: 15, gradeHighlightsHue: 190, gradeHighlightsSat: 8, noiseAmount: 18, noiseColor: 60, jpegAmount: 25, vignetteAmount: -10 },
  },
  {
    id: 'filter:warm-digicam', name: 'Warm Digicam', category: 'digicam',
    description: 'Yellow-warm sensor colour, bright midtones, light compression.',
    settings: { sensorColor: 75, cameraResponse: 35, highlightClip: 20, gradeGlobalHue: 48, gradeGlobalSat: 22, gradeHighlightsHue: 45, gradeHighlightsSat: 20, noiseAmount: 15, jpegAmount: 20 },
  },
  {
    id: 'filter:cool-digicam', name: 'Cool Digicam', category: 'digicam',
    description: 'Blue-cyan cast with clean blacks and clipped skies.',
    settings: { sensorColor: -80, cameraResponse: 30, highlightClip: 30, gradeGlobalHue: 195, gradeGlobalSat: 12, noiseAmount: 12, jpegAmount: 20 },
  },
  {
    id: 'filter:y2k-flash', name: 'Y2K Flash', category: 'digicam',
    description: 'On-camera flash: bright faces, dark falloff and a pink cast.',
    settings: { highlightClip: 45, cameraResponse: 55, sensorColor: -15, gradeHighlightsHue: 335, gradeHighlightsSat: 30, gradeMidtonesHue: 340, gradeMidtonesSat: 14, vignetteAmount: -45, vignetteMidpoint: 35, bloomAmount: 15, noiseAmount: 20, jpegAmount: 35, captureResolution: 6 },
  },
  {
    id: 'filter:early-2000s', name: 'Early 2000s', category: 'digicam',
    description: 'A sub-megapixel capture with blocky JPEG and blue-leaning colour.',
    settings: { captureResolution: 10, jpegAmount: 50, sensorColor: -30, cameraResponse: 35, highlightClip: 25, noiseAmount: 25, noiseColor: 70 },
  },
  {
    id: 'filter:early-smartphone', name: 'Early Smartphone', category: 'digicam',
    description: 'Small plastic lens: soft corners, warm cast, lifted blacks, colour noise.',
    settings: { captureResolution: 6, jpegAmount: 40, noiseAmount: 35, noiseColor: 75, sensorColor: 30, highlightClip: 30, fade: 12, diffusionAmount: 18, diffusionRadius: 30, chromaticAberration: 25, vignetteAmount: -25 },
  },
  {
    id: 'filter:flip-phone', name: 'Flip Phone', category: 'digicam',
    description: 'A tiny, smeared, heavily compressed picture with few colours.',
    settings: { captureResolution: 42, pixelEdges: 25, jpegAmount: 70, noiseAmount: 45, noiseColor: 80, quantizeAmount: 35, sensorColor: 35, highlightClip: 35, vignetteAmount: -30 },
  },
  {
    id: 'filter:2014-social', name: '2014 Social', category: 'digicam',
    description: 'Matte teal shadows, warm yellow highlights, a soft vignette.',
    settings: { fade: 30, fadeShadowTint: 45, fadeShadowHue: 190, gradeHighlightsHue: 50, gradeHighlightsSat: 30, gradeMidtonesHue: 40, gradeMidtonesSat: 8, cameraResponse: 20, vignetteAmount: -30, vignetteFeather: 70 },
  },
  {
    id: 'filter:low-fi-digital', name: 'Low-Fi Digital', category: 'digicam',
    description: 'Visible pixels and compression blocks with a reduced palette.',
    settings: { captureResolution: 58, pixelEdges: 70, jpegAmount: 55, quantizeAmount: 35, noiseAmount: 20, cameraResponse: 25 },
  },
  {
    id: 'filter:disposable-digital', name: 'Disposable Digital', category: 'digicam',
    description: 'Cheap optics: green-yellow cast, fringed edges, flash falloff.',
    settings: { sensorColor: 40, gradeShadowsHue: 110, gradeShadowsSat: 25, highlightClip: 35, chromaticAberration: 45, diffusionAmount: 25, noiseAmount: 30, jpegAmount: 30, vignetteAmount: -45 },
  },
  {
    id: 'filter:soft-ccd-glow', name: 'Soft CCD Glow', category: 'digicam',
    description: 'Cool CCD colour with highlights blooming into the shadows.',
    settings: { sensorColor: -40, cameraResponse: 25, bloomAmount: 40, bloomThreshold: 45, bloomRadius: 50, diffusionAmount: 25, halationAmount: 10, noiseAmount: 12, jpegAmount: 15 },
  },
  {
    id: 'filter:harsh-direct-flash', name: 'Harsh Direct Flash', category: 'digicam',
    description: 'Hard, contrasty flash light with deep falloff toward the edges.',
    settings: { cameraResponse: 85, highlightClip: 55, sensorColor: -30, gradeHighlightsHue: 210, gradeHighlightsSat: 10, vignetteAmount: -60, vignetteMidpoint: 25, vignetteFeather: 70, noiseAmount: 15 },
  },
  // Vintage and nostalgic.
  {
    id: 'filter:warm-vintage', name: 'Warm Vintage', category: 'vintage',
    description: 'Rich, warm seventies colour with a strong red-yellow bias.',
    settings: { sensorColor: 60, cameraResponse: 30, gradeHighlightsHue: 40, gradeHighlightsSat: 30, gradeShadowsHue: 20, gradeShadowsSat: 20, fadeHighlights: 25, halationAmount: 15, grainAmount: 22, vignetteAmount: -25 },
  },
  {
    id: 'filter:creamy-vintage', name: 'Creamy Vintage', category: 'vintage',
    description: 'Cream-coloured whites, milky blacks and a gentle glow.',
    settings: { fade: 30, fadeHighlights: 55, fadeHighlightTint: 75, fadeHighlightHue: 48, fadeShadowTint: 35, fadeShadowHue: 35, gradeMidtonesHue: 40, gradeMidtonesSat: 18, bloomAmount: 15, diffusionAmount: 15, bleachAmount: 20, bleachContrast: 0, bleachDesaturation: 50, grainAmount: 15 },
  },
  {
    id: 'filter:sepia', name: 'Sepia', category: 'vintage',
    description: 'Brown-toned monochrome print with a soft fade and grain.',
    settings: { bleachAmount: 100, bleachContrast: 25, bleachDesaturation: 100, bleachProtect: 40, gradeGlobalHue: 32, gradeGlobalSat: 45, gradeHighlightsHue: 45, gradeHighlightsSat: 15, fade: 14, grainAmount: 22, vignetteAmount: -25 },
  },
  {
    id: 'filter:soft-nostalgia', name: 'Soft Nostalgia', category: 'vintage',
    description: 'Hazy, low-contrast memory: violet blacks, warm light, soft focus.',
    settings: { diffusionAmount: 55, diffusionRadius: 55, fade: 28, fadeShadowTint: 60, fadeShadowHue: 265, gradeShadowsHue: 265, gradeShadowsSat: 20, gradeHighlightsHue: 30, gradeHighlightsSat: 22, bleachAmount: 25, bleachContrast: 0, bleachDesaturation: 45, grainAmount: 15 },
  },
  {
    id: 'filter:faded-monochrome', name: 'Faded Monochrome', category: 'vintage',
    description: 'Grey, lifted black-and-white with a cool tone and grain.',
    settings: { bleachAmount: 100, bleachContrast: 10, bleachDesaturation: 100, bleachProtect: 40, fade: 40, fadeHighlights: 40, fadeShadowTint: 20, fadeShadowHue: 220, grainAmount: 30, grainSize: 45 },
  },
  {
    id: 'filter:pastel-memory', name: 'Pastel Memory', category: 'vintage',
    description: 'Muted pastel colour: aqua shadows, pink highlights, light haze.',
    settings: { fade: 35, fadeHighlights: 45, bleachAmount: 35, bleachContrast: 0, bleachDesaturation: 55, gradeShadowsHue: 180, gradeShadowsSat: 35, gradeHighlightsHue: 335, gradeHighlightsSat: 30, diffusionAmount: 15, grainAmount: 10 },
  },
  // Cinematic and dramatic.
  {
    id: 'filter:heavy-bleach', name: 'Heavy Bleach', category: 'cinematic',
    description: 'Harsh silver contrast with almost no colour left.',
    settings: { bleachAmount: 100, bleachContrast: 100, bleachDesaturation: 85, bleachProtect: 10, highlightClip: 15, vignetteAmount: -30, grainAmount: 25 },
  },
  {
    id: 'filter:cold-cinema', name: 'Cold Cinema', category: 'cinematic',
    description: 'Steel-blue, clean and restrained, with muted warm colours.',
    settings: { sensorColor: -60, gradeGlobalHue: 200, gradeGlobalSat: 30, gradeShadowsHue: 210, gradeShadowsSat: 35, bleachAmount: 35, bleachContrast: 40, bleachDesaturation: 45, fade: 6, vignetteAmount: -20 },
  },
  {
    id: 'filter:warm-cinema', name: 'Warm Cinema', category: 'cinematic',
    description: 'Golden highlights, amber midtones and a gentle halation.',
    settings: { gradeHighlightsHue: 40, gradeHighlightsSat: 35, gradeMidtonesHue: 32, gradeMidtonesSat: 12, gradeShadowsHue: 25, gradeShadowsSat: 12, fadeHighlights: 25, halationAmount: 22, vignetteAmount: -20, grainAmount: 10 },
  },
  {
    id: 'filter:deep-shadows', name: 'Deep Shadows', category: 'cinematic',
    description: 'Low-key: darker shadows and midtones, cool blacks, heavy edges.',
    settings: { gradeShadowsLum: -100, gradeMidtonesLum: -60, gradeGlobalLum: -30, gradeShadowsHue: 220, gradeShadowsSat: 30, cameraResponse: 25, bleachAmount: 30, bleachDesaturation: 35, vignetteAmount: -55 },
  },
  {
    id: 'filter:high-contrast', name: 'High Contrast', category: 'cinematic',
    description: 'A steep S-curve with dense blacks and bright whites.',
    settings: { cameraResponse: 55, bleachAmount: 60, bleachContrast: 100, bleachDesaturation: 0, bleachProtect: 30, vignetteAmount: -15 },
  },
  {
    id: 'filter:crushed-blacks', name: 'Crushed Blacks', category: 'cinematic',
    description: 'Shadow detail pressed into flat black under bright midtones.',
    settings: { cameraResponse: 90, gradeShadowsLum: -100, gradeBalance: 40, gradeBlending: 20, gradeMidtonesLum: 25, gradeShadowsHue: 200, gradeShadowsSat: 15, bleachAmount: 25, bleachContrast: 0, bleachDesaturation: 40 },
  },
  {
    id: 'filter:moody-blue', name: 'Moody Blue', category: 'cinematic',
    description: 'Dark, deep-blue night mood with muted colour.',
    settings: { gradeShadowsHue: 222, gradeShadowsSat: 65, gradeMidtonesHue: 215, gradeMidtonesSat: 35, gradeHighlightsHue: 205, gradeHighlightsSat: 15, gradeGlobalLum: -40, sensorColor: -40, bleachAmount: 35, bleachDesaturation: 45, fade: 8, vignetteAmount: -35 },
  },
  {
    id: 'filter:neon-night', name: 'Neon Night', category: 'cinematic',
    description: 'Violet shadows, magenta light and glowing highlights.',
    settings: { gradeShadowsHue: 265, gradeShadowsSat: 50, gradeHighlightsHue: 320, gradeHighlightsSat: 35, cameraResponse: 45, bloomAmount: 45, bloomThreshold: 40, bloomRadius: 50, halationAmount: 20, halationHue: 0, vignetteAmount: -30, noiseAmount: 15 },
  },
  {
    id: 'filter:gritty-street', name: 'Gritty Street', category: 'cinematic',
    description: 'Hard, desaturated contrast with rough grain.',
    settings: { bleachAmount: 65, bleachContrast: 85, bleachDesaturation: 55, cameraResponse: 30, highlightClip: 10, grainAmount: 45, grainSize: 50, grainRoughness: 85, vignetteAmount: -30 },
  },
  {
    id: 'filter:desaturated-film', name: 'Desaturated Film', category: 'cinematic',
    description: 'Quiet colour, soft contrast and fine grain.',
    settings: { bleachAmount: 55, bleachContrast: 20, bleachDesaturation: 70, bleachProtect: 40, fade: 12, gradeGlobalHue: 40, gradeGlobalSat: 6, grainAmount: 20 },
  },
  {
    id: 'filter:high-key-fade', name: 'High-Key Fade', category: 'cinematic',
    description: 'Bright, airy and low in contrast, with light edges.',
    settings: { gradeGlobalLum: 40, gradeShadowsLum: 45, fade: 40, fadeHighlights: 20, bleachAmount: 20, bleachContrast: 0, bleachDesaturation: 35, diffusionAmount: 15, vignetteAmount: 15 },
  },
  // Experimental and degraded digital.
  {
    id: 'filter:jpeg-damage', name: 'JPEG Damage', category: 'experimental',
    description: 'Saved too many times: 8 × 8 blocks, ringing and smeared colour.',
    settings: { jpegAmount: 85, captureResolution: 22, cameraResponse: 20 },
  },
  {
    id: 'filter:pixelated', name: 'Pixelated', category: 'experimental',
    description: 'A very low-resolution capture shown with hard square pixels.',
    settings: { captureResolution: 75, pixelEdges: 100 },
  },
  {
    id: 'filter:color-quantization', name: 'Color Quantization', category: 'experimental',
    description: 'Few colours per channel with an ordered dither pattern.',
    settings: { quantizeAmount: 70, quantizeDither: 100, captureResolution: 28, pixelEdges: 100 },
  },
  {
    id: 'filter:chromatic-fringing', name: 'Chromatic Fringing', category: 'experimental',
    description: 'Red and blue edges pulled apart toward the corners.',
    settings: { chromaticAberration: 100, channelShift: 15, channelShiftAngle: 0, diffusionAmount: 10, cameraResponse: 15 },
  },
  {
    id: 'filter:sensor-noise', name: 'Sensor Noise', category: 'experimental',
    description: 'High-ISO digital noise, strongest in the shadows and the blue channel.',
    settings: { noiseAmount: 85, noiseColor: 75, sensorColor: -15, cameraResponse: 15 },
  },
  {
    id: 'filter:heavy-grain', name: 'Heavy Grain', category: 'experimental',
    description: 'Coarse, rough film grain over muted colour.',
    settings: { grainAmount: 85, grainSize: 70, grainRoughness: 70, fade: 10, bleachAmount: 30, bleachDesaturation: 35 },
  },
  {
    id: 'filter:overexposed-flash', name: 'Overexposed Flash', category: 'experimental',
    description: 'Blown-out flash: clipped, glowing highlights fading to dark edges.',
    settings: { highlightClip: 85, cameraResponse: 30, bloomAmount: 30, bloomThreshold: 30, sensorColor: -20, vignetteAmount: -45 },
  },
  {
    id: 'filter:soft-focus', name: 'Soft Focus', category: 'experimental',
    description: 'A strong diffusion filter: light spreads, edges soften.',
    settings: { diffusionAmount: 75, diffusionRadius: 50, bloomAmount: 15, fadeHighlights: 15 },
  },
  {
    id: 'filter:posterized-color', name: 'Posterized Color', category: 'experimental',
    description: 'Flat bands of colour from very few levels per channel.',
    settings: { quantizeAmount: 72, cameraResponse: 40 },
  },
  {
    id: 'filter:saturation-blast', name: 'Saturation Blast', category: 'experimental',
    description: 'Colour pushed as far as it goes, with clipped highlights.',
    settings: { cameraResponse: 100, sensorColor: 30, highlightClip: 20 },
  },
  {
    id: 'filter:dark-grunge', name: 'Dark Grunge', category: 'experimental',
    description: 'Dark, brown, high-contrast and dirty with grain and noise.',
    settings: { bleachAmount: 70, bleachContrast: 90, bleachDesaturation: 60, gradeGlobalLum: -30, gradeShadowsHue: 35, gradeShadowsSat: 25, grainAmount: 55, grainRoughness: 90, noiseAmount: 20, vignetteAmount: -60 },
  },
  {
    id: 'filter:night-vision', name: 'Night Vision-inspired', category: 'experimental',
    description: 'Green monochrome with glowing lights, noise and a round vignette.',
    settings: { bleachAmount: 100, bleachContrast: 30, bleachDesaturation: 100, gradeGlobalHue: 120, gradeGlobalSat: 80, gradeGlobalLum: 15, cameraResponse: 40, noiseAmount: 45, noiseColor: 0, bloomAmount: 30, bloomThreshold: 40, captureResolution: 20, vignetteAmount: -70, vignetteRoundness: 100, vignetteMidpoint: 35 },
  },
];

const freeze = (filter) => Object.freeze({ ...filter, settings: Object.freeze({ ...filter.settings }) });

/** Built-in filters in display order: the Interval 11 looks in their categories, then the rest. */
export const BUILT_IN_FILTERS = Object.freeze([
  ...BUILT_IN_LOOKS.map((look) => freeze({ ...look, category: LOOK_CATEGORY[look.id] })),
  ...NEW_FILTERS.map(freeze),
].sort((a, b) => FILTER_CATEGORIES.findIndex(({ id }) => id === a.category) - FILTER_CATEGORIES.findIndex(({ id }) => id === b.category)));

const CREATIVE_KEYS = new Set(groupKeys('creative'));

/** Custom filters: the visitor's presets that contain only the Creative group. */
export function customFilters(presets = []) {
  return presets
    .filter((preset) => preset.groups?.length === 1 && preset.groups[0] === 'creative')
    .map((preset) => freeze({
      id: `preset:${preset.name}`,
      name: preset.name,
      category: 'custom',
      description: 'Your saved Creative settings.',
      settings: Object.fromEntries(Object.entries(preset.settings ?? {}).filter(([key]) => CREATIVE_KEYS.has(key) && key !== 'grainSeed')),
    }));
}

const normalize = (text) => String(text).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Filters whose name, description or category label contain every word of `query`. */
export function searchFilters(filters, query) {
  const words = normalize(query).split(' ').filter(Boolean);
  if (!words.length) return filters;
  return filters.filter((filter) => {
    const label = FILTER_CATEGORIES.find(({ id }) => id === filter.category)?.label ?? '';
    const text = normalize(`${filter.name} ${filter.description} ${label}`);
    return words.every((word) => text.includes(word));
  });
}

/** The settings patch of a filter at a strength (0–100), with its record. */
export function filterPatch(filter, strength = 100) {
  const value = Math.min(100, Math.max(0, Math.round(strength)));
  return { ...lookPatch(filter, value), filter: { id: filter.id, strength: value } };
}

/** Removes the filter: every Creative control neutral (the grain seed kept), no record. */
export const noFilterPatch = () => ({ ...lookPatch({ settings: {} }, 0), filter: null });

/**
 * The library's view of a photo's filter: the filter (if it is still known), its strength and
 * whether the Creative controls were changed since it was applied.
 * :returns: { filter, strength, modified } or null
 */
export function filterState(adjustments, filters) {
  const ref = adjustments.filter;
  if (!ref) return null;
  const filter = filters.find(({ id }) => id === ref.id) ?? null;
  return { filter, id: ref.id, strength: ref.strength, modified: !filter || !lookMatches(adjustments, filter, ref.strength) };
}

/** Recently used and favourite filters: ids kept in this browser only (per-viewer conveniences). */
export const FILTER_FAVORITES_KEY = 'photo-editor:filters:favorites:v1';
export const FILTER_RECENT_KEY = 'photo-editor:filters:recent:v1';
export const MAX_RECENT_FILTERS = 8;

export function readFilterIds(storage, key) {
  try {
    const value = JSON.parse(storage?.getItem(key) ?? '[]');
    return Array.isArray(value) ? value.filter((id) => typeof id === 'string' && id.length <= 100).slice(0, 200) : [];
  } catch {
    return [];
  }
}

export function writeFilterIds(storage, key, ids) {
  try { storage?.setItem(key, JSON.stringify(ids)); } catch { /* private mode or storage full: not remembered */ }
}

/** Puts `id` first in a recent list, without duplicates, capped. */
export const pushRecent = (ids, id) => [id, ...ids.filter((other) => other !== id)].slice(0, MAX_RECENT_FILTERS);
