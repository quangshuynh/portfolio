// Batch edits: copying settings from one photo to others (paste, sync), and applying a
// preset, a LUT or a reset to several photos. Everything here is parameters, never
// pixels: a plan lists, per target, the settings it will have afterwards and which groups
// change, so the editor can preview it and apply it in one step that can be undone.
//
// Source-specific data is never copied: a RAW photo's as-shot multipliers, camera matrix
// and exposure live in `photo.raw`, a merge's inputs, roles and settings in `photo.hdr`;
// neither is an adjustment. The RAW white balance and HDR tone mapping groups copy only
// between photos they apply to (RAW-developed, merged RAW HDR) and are off by default.
// Geometry is split in two groups, both off by default (paste never copies them): Output
// size (the resize box, reusable on any photo) and Crop & transform (crop, rotation, flips,
// perspective, stretch: source-specific, so only to photos of the same proportions).
// Layers (image, text, adjustment) belong to one photo's composition: they are copied only when
// Layers is ticked in Sync (paste never copies them) and then replace the target's whole stack;
// an image or adjustment layer's colour settings are never part of the colour groups.
// Local adjustments (masks) are copied only when "Local gradients" is ticked: their linear and
// radial gradients and settings replace the target's local adjustments; brush strokes follow
// one photo's content and are never copied (a brush-only adjustment is left out).
// The watermark (placement, size, colour, enabled) is copied only when Watermark is ticked; it is
// relative to each target's own output frame, so it lands in the same place on any photo.

import { adjustmentsEqual, developmentBase, groupKeys, neutralAdjustments, normalizeAdjustments } from './adjustments.mjs';
import { presetPatch } from './presets.mjs';
import { filterPatch } from './filters.mjs';
import { gradientLocals } from './masks.mjs';
import { applyRecipe, recipeGroups } from './recipes.mjs';

/** Kinds of source a group needs on both sides. */
const developed = (photo) => Boolean(photo?.raw);
const radianceHdr = (photo) => photo?.hdr?.mode === 'radiance';
/** Width / height of a photo as imported (before its own geometry). */
const proportions = (photo) => (photo?.width && photo?.height ? photo.width / photo.height : null);
const sameProportions = (a, b) => a !== null && b !== null && Math.abs(a / b - 1) < 0.005;

const TRANSFORM_PARTS = ['quarterTurns', 'flipH', 'flipV', 'angle', 'perspective', 'quad', 'stretch', 'crop', 'aspect', 'constrain', 'background'];

export const SYNC_GROUPS = Object.freeze([
  { id: 'light', label: 'Light', keys: groupKeys('light') },
  { id: 'color', label: 'Color', keys: groupKeys('color') },
  { id: 'hsl', label: 'HSL', keys: groupKeys('hsl') },
  { id: 'detail', label: 'Detail', keys: groupKeys('detail') },
  { id: 'curves', label: 'Tone curve', keys: [], structured: 'curves' },
  { id: 'lut', label: 'LUT', keys: groupKeys('lut'), structured: 'lut' },
  { id: 'creative', label: 'Creative', keys: groupKeys('creative'), structured: 'filter' },
  { id: 'raw', label: 'RAW white balance and profile', keys: groupKeys('raw'), structured: 'raw', applies: developed, needs: 'RAW photos' },
  { id: 'hdr', label: 'HDR tone mapping', keys: groupKeys('hdr'), applies: radianceHdr, needs: 'merged RAW HDR photos' },
  { id: 'outputSize', label: 'Output size (resize)', keys: [], geometry: ['resize'] },
  {
    id: 'transform',
    label: 'Crop & transform',
    keys: [],
    geometry: TRANSFORM_PARTS,
    needs: 'photos with the same proportions',
    compatible: (source, photo) => sameProportions(source.proportions ?? null, proportions(photo)),
  },
  { id: 'layers', label: 'Layers (whole stack, with their masks)', keys: [], structured: 'layers' },
  { id: 'localGradients', label: 'Local gradients (masks without brush strokes)', keys: [], structured: 'local', reuse: gradientLocals },
  { id: 'watermark', label: 'Watermark (HUYNH Photography settings)', keys: [], structured: 'watermark' },
].map(Object.freeze));
const groupById = new Map(SYNC_GROUPS.map((group) => [group.id, group]));

/** Groups copied unless the visitor changes the choice: everything that is not source-specific. */
export const DEFAULT_SYNC_GROUPS = Object.freeze(['light', 'color', 'hsl', 'detail', 'curves', 'lut', 'creative']);

// Every adjustment belongs to exactly one sync group (tested), so "all groups" is everything.
export const syncGroupOf = (key) => SYNC_GROUPS.find(({ keys }) => keys.includes(key))?.id ?? null;

/**
 * The settings of the given groups from `source`, as a patch over `target` (geometry groups
 * replace their parts of the target's geometry and keep the rest).
 */
export function groupPatch(source, groups, target = neutralAdjustments()) {
  const values = normalizeAdjustments(source);
  const patch = {};
  groups.forEach((id) => {
    const group = groupById.get(id);
    if (!group) throw new Error(`Unknown sync group: ${id}`);
    group.keys.forEach((key) => { patch[key] = values[key]; });
    if (group.structured) patch[group.structured] = group.reuse ? group.reuse(values[group.structured]) : values[group.structured];
    // An accepted Auto Exposure belongs to its photo: the target keeps its own.
    if (id === 'raw') patch.raw = { ...patch.raw, autoExposure: normalizeAdjustments(target).raw.autoExposure };
    if (group.geometry) {
      const base = patch.geometry ?? normalizeAdjustments(target).geometry;
      patch.geometry = { ...base, ...Object.fromEntries(group.geometry.map((part) => [part, values.geometry[part]])) };
    }
  });
  return patch;
}

/** Groups whose values differ between two settings objects. */
export function changedGroups(before, after) {
  const a = normalizeAdjustments(before);
  const b = normalizeAdjustments(after);
  const neutral = neutralAdjustments();
  return SYNC_GROUPS.filter(({ id }) => !adjustmentsEqual({ ...neutral, ...groupPatch(a, [id]) }, { ...neutral, ...groupPatch(b, [id]) }))
    .map(({ id }) => id);
}

const lutName = (ref) => ref.title || ref.name;

/**
 * A plan for a batch change: the settings every target will have and what changes.
 * :param targets: editor photos ({ id, name, status, raw, hdr, history })
 * :param change: (photo, present) => { patch, skipped: [{ group, reason }] }
 * :returns: { items: [{ id, name, before, after, changed, skipped }], changedCount }
 */
function plan(targets, change) {
  const items = targets.filter((photo) => photo.status === 'ready').map((photo) => {
    const before = photo.history.present;
    const { patch, skipped = [] } = change(photo, before);
    const after = normalizeAdjustments({ ...before, ...patch });
    return { id: photo.id, name: photo.name, before, after, changed: changedGroups(before, after), skipped };
  });
  return { items, changedCount: items.filter(({ changed }) => changed.length).length };
}

/** LUTs a set of settings needs that are not loaded in this session. */
const missingLut = (settings, hasLut) => (settings.lut && !hasLut(settings.lut.sha256) ? settings.lut : null);

/**
 * Copies groups of `source` settings to targets (paste and sync). Selected groups are
 * replaced exactly; other groups of each target are kept.
 * :param sourcePhoto: the photo the settings come from (null for a pasted copy, see `kind`)
 * :param options: { groups, hasLut(sha256), kind: { raw, hdr } of the source when copied }
 * :returns: plan plus `errors` (nothing may be applied while there are errors)
 */
export function planSync(source, targets, { groups = DEFAULT_SYNC_GROUPS, hasLut = () => true, kind = {} } = {}) {
  const values = normalizeAdjustments(source);
  const errors = [];
  const chosen = SYNC_GROUPS.filter(({ id }) => groups.includes(id));
  if (!chosen.length) errors.push('Choose at least one group of settings.');
  const lut = chosen.some(({ id }) => id === 'lut') ? missingLut(values, hasLut) : null;
  if (lut) errors.push(`The LUT "${lutName(lut)}" is not loaded. Import it again, or leave LUT out.`);
  const sourceIs = { raw: Boolean(kind.raw), hdr: Boolean(kind.hdr) };
  const result = plan(targets, (photo, before) => {
    const skipped = [];
    const usable = chosen.filter((group) => {
      if (group.compatible) {
        if (group.compatible(kind, photo)) return true;
        skipped.push({ group: group.id, reason: `only for ${group.needs}` });
        return false;
      }
      if (!group.applies) return true;
      const sourceFits = group.id === 'raw' ? sourceIs.raw : sourceIs.hdr;
      if (!sourceFits) { skipped.push({ group: group.id, reason: `the source is not one of the ${group.needs}` }); return false; }
      if (!group.applies(photo)) { skipped.push({ group: group.id, reason: `only for ${group.needs}` }); return false; }
      return true;
    });
    return { patch: groupPatch(values, usable.map(({ id }) => id), before), skipped };
  });
  return { ...result, errors };
}

/** Applies a preset to every target (the groups it contains, exactly as for one photo). */
export function planPreset(preset, targets, { hasLut = () => true } = {}) {
  const patch = presetPatch(preset);
  const lut = missingLut(patch, hasLut);
  const errors = lut ? [`The preset uses the LUT "${lutName(lut)}", which is not loaded. Import it first.`] : [];
  return { ...plan(targets, () => ({ patch })), errors };
}

/**
 * Applies a Filter Library filter at a strength to every target: each target's Creative group
 * is replaced and everything else (including its grain seed, text and geometry) is kept.
 */
export const planFilter = (filter, strength, targets) => ({ ...plan(targets, () => ({ patch: filterPatch(filter, strength) })), errors: [] });

/**
 * Sets a LUT (or none) and its intensity on every target.
 * :param lut: { sha256, name, title, size } of a LUT loaded this session, or null to remove
 */
export function planLut(lut, intensity, targets, { hasLut = () => true } = {}) {
  const errors = lut && !hasLut(lut.sha256) ? [`The LUT "${lutName(lut)}" is not loaded.`] : [];
  const patch = { lut: lut ? { sha256: lut.sha256, name: lut.name, title: lut.title, size: lut.size } : null, lutIntensity: intensity };
  return { ...plan(targets, () => ({ patch })), errors };
}

/**
 * Applies chosen groups of a QuangEdit Recipe to every target (model/recipes.mjs), in replace
 * or merge mode. Without its LUT loaded, the plan leaves the LUT group out and has an error,
 * so the rest can be previewed but nothing is applied.
 * :param options: { groups, mode, lutOf(sha256) => loaded LUT or null }
 */
export function planRecipe(recipe, targets, { groups = recipeGroups(recipe), mode = 'replace', lutOf = () => null } = {}) {
  const chosen = recipeGroups(recipe).filter((id) => groups.includes(id));
  const errors = [];
  if (!chosen.length) errors.push('Choose at least one group of settings.');
  const lut = chosen.includes('lut') ? lutOf(recipe.lut.sha256) : null;
  if (chosen.includes('lut') && !lut) errors.push(`The LUT "${lutName(recipe.lut)}" is not loaded. Import that .cube file again, or leave LUT out.`);
  const usable = lut ? chosen : chosen.filter((id) => id !== 'lut');
  return { ...plan(targets, (photo, before) => ({ patch: applyRecipe(before, recipe, { groups: usable, mode, lut }) })), errors };
}

/** Resets every target to neutral settings (its RAW and merge data and RAW profile are untouched). */
export const planReset = (targets) => ({ ...plan(targets, (photo, before) => ({ patch: developmentBase(before) })), errors: [] });

/** What a photo's source is, for compatibility with copied settings. */
export const sourceKind = (photo) => ({ raw: developed(photo), hdr: radianceHdr(photo), proportions: proportions(photo) });
