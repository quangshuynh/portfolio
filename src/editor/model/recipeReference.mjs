// The QuangEdit Recipe authoring reference: a compact, copyable contract for a person or an AI
// assistant writing recipes without the editor's code. Generated from the adjustment registry,
// the recipe groups and the Filter Library, so it cannot drift from what the editor accepts.

import { adjustmentSpec } from './adjustments.mjs';
import { BUILT_IN_FILTERS } from './filters.mjs';
import { MAX_RECIPE_BYTES, RECIPE_FORMAT, RECIPE_GROUPS, RECIPE_VERSION, serializeRecipe } from './recipes.mjs';
import { MAX_CURVE_POINTS } from '../pipeline/curves.mjs';

const range = (key) => {
  const { min, max, default: value, step, unit } = adjustmentSpec(key);
  return `${key} ${min}..${max}${unit ? ` ${unit}` : ''}, default ${value}${step !== 1 ? `, step ${step}` : ''}`;
};

export const EXAMPLE_RECIPES = Object.freeze([
  {
    format: RECIPE_FORMAT,
    version: RECIPE_VERSION,
    name: 'Natural Daylight',
    description: 'Opened shadows, held highlights and a little warmth.',
    adjustments: {
      light: { exposure: 0.15, contrast: 8, highlights: -30, shadows: 20 },
      color: { temperature: 6, vibrance: 12 },
      hsl: { blueSaturation: 10, orangeLuminance: 5 },
      detail: { clarity: 8, sharpening: 25 },
    },
    filter: null,
    lut: null,
  },
  {
    format: RECIPE_FORMAT,
    version: RECIPE_VERSION,
    name: 'Cinematic Night',
    description: 'Cool shadows, controlled highlights and subtle contrast.',
    adjustments: {
      light: { highlights: -35, blacks: -10 },
      toneCurve: { master: [[0, 6], [64, 58], [192, 200], [255, 248]] },
      colorGrading: { gradeShadowsHue: 210, gradeShadowsSat: 25, gradeHighlightsHue: 40, gradeHighlightsSat: 15 },
    },
    filter: { id: 'look:cinematic-cool', strength: 60 },
    lut: null,
  },
]);

/** The reference as plain text (Markdown), ready to paste into a conversation. */
export function recipeReference() {
  const groups = RECIPE_GROUPS.filter(({ keys, channels }) => keys.length || channels).map(({ id, label, keys, channels }) => (channels
    ? `- adjustments.${id} (${label}): channels ${channels.join(', ')}; each a list of 2–${MAX_CURVE_POINTS} [x, y] points, whole numbers 0..255, x strictly increasing. Neutral is [[0, 0], [255, 255]].`
    : `- adjustments.${id} (${label}): ${keys.map(range).join('; ')}.`));
  const filters = BUILT_IN_FILTERS.map(({ id, name, description }) => `- ${id}: ${name}. ${description}`);
  return [
    `# QuangEdit Recipe v${RECIPE_VERSION}`,
    '',
    'A JSON object of reusable photo settings for the editor at quanghuynh.com/photography/editor. Output only the JSON object: no comments, no trailing commas, no extra fields.',
    '',
    '## Shape',
    `{ "format": "${RECIPE_FORMAT}", "version": ${RECIPE_VERSION}, "name": "Short title", "description": "One sentence (optional)", "adjustments": { …groups… }, "filter": null, "lut": null }`,
    '- format, version and name (1–60 characters) are required; description is optional (up to 280).',
    '- Include only the groups you change; inside a group include only the settings you change. Values are relative to neutral (the default), so 0 usually means "no change".',
    '- Numbers must be inside their range (out-of-range values are rejected, not clamped); they are rounded to the control step.',
    '- Unknown fields are rejected with the field named.',
    '',
    '## Groups and settings (name min..max, default)',
    ...groups,
    '',
    '## Filter',
    '"filter": { "id": "<id>", "strength": 0..100 } or null. A filter sets the Creative effects and Color grading groups as a base; values you give in adjustments.creative or adjustments.colorGrading then override it. Built-in ids:',
    ...filters,
    '',
    '## LUT',
    '"lut": { "name": "file.cube", "sha256": "<64 hex characters of the .cube file>", "intensity": 0..100, "size": 2..65 (optional), "colorSpace": "srgb" } or null.',
    '- Use a LUT only when its SHA-256 is known (copied from the editor). The editor never fetches LUTs: the person reimports the .cube, and it must match the hash exactly.',
    '- No paths, URLs or embedded LUT data. LUT input is sRGB display values after the other adjustments.',
    '',
    '## How the editor applies a recipe',
    '- The person reviews it first and chooses groups and a mode. Replace: each chosen group is set exactly, settings left out become neutral. Merge: only the settings stated change.',
    '- Never changed by a recipe: crop, rotation and perspective, layers, text, masks and local adjustments, RAW white balance and development, HDR merges and tone mapping, the grain pattern, export settings.',
    '',
    '## Unsupported',
    'Geometry, masks, layers, text, RAW or HDR settings, healing or object removal, per-region edits, scripts or expressions, remote resources, image data. Write natural, moderate values unless asked for a strong look.',
    `- Limits: ${MAX_RECIPE_BYTES / 1024} KB, 6 levels deep.`,
    '',
    '## Examples',
    ...EXAMPLE_RECIPES.map((recipe) => `\`\`\`json\n${serializeRecipe(recipe).trim()}\n\`\`\``),
    '',
  ].join('\n');
}
