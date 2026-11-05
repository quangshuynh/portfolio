// Groups and clipping over the flat layer list (model/layers.mjs keeps it valid): what is drawn
// and in which order (the render program), and the edits that keep the tree valid.
//
// Units: the Layers panel moves, groups and deletes whole units, so relationships survive:
// a group with all its descendants, or a base with the layers clipped to it (a "clip run").
// A clipped layer moves within its run; dragging it elsewhere releases it.
//
// Compositing (pipeline/composite.mjs runs the program; the GPU mirrors it):
// - A clip run with something to clip is isolated: the base is drawn at full opacity in Normal
//   mode onto transparency, each clipped layer is composited "atop" it (its colour mixes into
//   the base's by its own alpha, blend mode and opacity; the base's alpha is kept, so soft and
//   partly transparent edges of the base stay as they are), and the result is composited over
//   what lies below with the base's blend mode and opacity. A clipped adjustment layer changes
//   only its run, never the layers below the base. The base's mask is part of its alpha.
// - A pass-through group (the default) draws its children over what lies below as if they were
//   not grouped; its opacity and mask then fade between that result and what lay below. Any other
//   mode isolates the group: its children are drawn onto transparency (an adjustment inside
//   changes only the group's own content) and the result is composited with that mode, opacity
//   and mask. A group used as a clipping base is isolated in Normal mode, so it has an alpha to
//   clip to, and its own mode and opacity then apply to the whole run.
// - A hidden base or group hides what is clipped to it or inside it; a base or group that draws
//   nothing clips everything away.
//
// Steps: { op: 'layer', layer, clip }, { op: 'begin', id, isolate }, { op: 'end', id, isolate,
// blend, opacity, owner } (`owner`: the group whose mask applies, or null).

import { LAYER_LIMITS, PASS_THROUGH, canAddLayer, cleanName, layerDraws, normalizeLayer } from './layers.mjs';
import { maskActive } from './masks.mjs';

const key = (layer) => layer.parent ?? null;

/** Children of `parent` (null: the top level), bottom first. */
export const layerChildren = (layers, parent = null) => layers.filter((layer) => key(layer) === parent);

/** Ids of every layer inside group `id`, at any depth. */
export function descendantIds(layers, id) {
  const out = new Set();
  let added = true;
  while (added) {
    added = false;
    for (const layer of layers) if (!out.has(layer.id) && (layer.parent === id || out.has(layer.parent))) { out.add(layer.id); added = true; }
  }
  return out;
}

/** Groups containing layer `id`, innermost first. */
export function ancestors(layers, id) {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const out = [];
  for (let at = byId.get(byId.get(id)?.parent); at; at = byId.get(at.parent)) out.push(at);
  return out;
}

/** The base a clipped layer `id` clips to, or null. */
export function clipBase(layers, id) {
  const index = layers.findIndex((layer) => layer.id === id);
  const layer = layers[index];
  if (!layer?.clip) return null;
  // Walking down, a group sibling's entry comes before its descendants.
  for (let i = index - 1; i >= 0; i -= 1) if (key(layers[i]) === key(layer) && !layers[i].clip) return layers[i];
  return null;
}

/** Layers clipped to base `id`, bottom first. */
export function clippedTo(layers, id) {
  const siblings = layerChildren(layers, key(layers.find((layer) => layer.id === id) ?? {}));
  const at = siblings.findIndex((layer) => layer.id === id);
  const out = [];
  for (let i = at + 1; at !== -1 && i < siblings.length && siblings[i].clip; i += 1) out.push(siblings[i]);
  return out;
}

/** Whether layer `id` can be clipped to the layer below it (an unlocked image, text or adjustment layer above an image, text or group sibling). */
export function canClip(layers, id) {
  const layer = layers.find((entry) => entry.id === id);
  if (!layer || layer.type === 'group' || layer.locked) return false;
  if (layer.clip) return true;
  const siblings = layerChildren(layers, key(layer));
  const at = siblings.indexOf(layer);
  if (at <= 0) return false;
  let below = at - 1;
  while (below > 0 && siblings[below].clip) below -= 1;
  return siblings[below].type !== 'adjustment';
}

// The unit a layer moves with: a group and its descendants, a base and its clipped layers, or a clipped layer alone.
function unitIds(layers, id) {
  const layer = layers.find((entry) => entry.id === id);
  if (!layer) return [];
  if (layer.type === 'group') return [...descendantIds(layers, id), id];
  if (layer.clip) return [id];
  return [id, ...clippedTo(layers, id).map((entry) => entry.id)];
}

/** Sibling units of `parent`, bottom first: [{ head, ids }] where ids are in list order. */
function siblingUnits(layers, parent) {
  const units = [];
  for (const layer of layerChildren(layers, parent)) {
    if (layer.clip && units.length) units[units.length - 1].ids.push(layer.id);
    else units.push({ head: layer.id, ids: layer.type === 'group' ? [...descendantIds(layers, layer.id), layer.id] : [layer.id] });
  }
  return units;
}

// The list with the layers of `ids` (in their current order) taken out and put back at `at` of
// the remaining list, under `parent` (only their top-level members change parent).
function place(layers, ids, at, parent, { release = false } = {}) {
  const set = new Set(ids);
  const moving = layers.filter((layer) => set.has(layer.id));
  const tops = new Set(moving.filter((layer) => !set.has(layer.parent)).map((layer) => layer.id));
  const moved = moving.map((layer) => {
    if (!tops.has(layer.id)) return layer;
    const next = { ...layer };
    if (parent) next.parent = parent; else delete next.parent;
    if (release) delete next.clip;
    return next;
  });
  const rest = layers.filter((layer) => !set.has(layer.id));
  return [...rest.slice(0, at), ...moved, ...rest.slice(at)];
}

/**
 * Moves the unit of layer `id` one step up (+1) or down (−1) among its siblings. At the top or
 * bottom of a group it leaves the group (directly above or below it). A clipped layer moves within
 * its clip run only. Returns the same list when it cannot move.
 */
export function moveUnit(layers, id, direction) {
  const layer = layers.find((entry) => entry.id === id);
  if (!layer) return layers;
  if (layer.clip) {
    const base = clipBase(layers, id);
    if (!base) return layers;
    const run = clippedTo(layers, base.id);
    const at = run.indexOf(layer);
    const other = run[at + direction];
    if (!other) return layers;
    const i = layers.indexOf(layer);
    const j = layers.indexOf(other);
    const next = layers.slice();
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  }
  const units = siblingUnits(layers, key(layer));
  const index = units.findIndex((unit) => unit.head === id);
  const ids = units[index].ids;
  const rest = layers.filter((entry) => !ids.includes(entry.id));
  const neighbour = units[index + direction];
  if (neighbour) {
    const edge = direction > 0 ? rest.findIndex((entry) => entry.id === neighbour.ids[neighbour.ids.length - 1]) + 1 : rest.findIndex((entry) => entry.id === neighbour.ids[0]);
    return place(layers, ids, edge, key(layer));
  }
  if (!layer.parent) return layers;
  // Out of the group: directly above or below it, in its parent.
  const group = layers.find((entry) => entry.id === layer.parent);
  const groupIds = [...descendantIds(layers, group.id), group.id];
  const inRest = rest.filter((entry) => groupIds.includes(entry.id));
  const edge = direction > 0 ? rest.indexOf(inRest[inRest.length - 1]) + 1 : rest.indexOf(inRest[0]);
  return place(layers, ids, edge, key(group));
}

/** Whether moveUnit(layers, id, direction) changes anything. */
export const canMoveUnit = (layers, id, direction) => moveUnit(layers, id, direction) !== layers;

/**
 * Drops the unit of layer `id` directly above or below the unit of `targetId`, as its sibling.
 * A clipped layer dropped outside its own run is released. Groups never go inside themselves.
 */
export function dropUnit(layers, id, targetId, where) {
  if (id === targetId) return layers;
  const layer = layers.find((entry) => entry.id === id);
  const targetLayer = layers.find((entry) => entry.id === targetId);
  if (!layer || !targetLayer) return layers;
  const ids = unitIds(layers, id);
  if (ids.includes(targetId)) return layers;
  // The target's unit: a clipped target stands for its run.
  const head = targetLayer.clip ? clipBase(layers, targetId) : targetLayer;
  const targetIds = unitIds(layers, head.id);
  const parent = key(head);
  if (layer.type === 'group' && parent && ancestorsOf(layers, parent).length + 1 + groupHeight(layers, id) > LAYER_LIMITS.depth) return layers;
  const rest = layers.filter((entry) => !ids.includes(entry.id));
  const inRest = rest.filter((entry) => targetIds.includes(entry.id));
  if (!inRest.length) return layers;
  const at = where === 'above' ? rest.indexOf(inRest[inRest.length - 1]) + 1 : rest.indexOf(inRest[0]);
  return place(layers, ids, at, parent, { release: Boolean(layer.clip) });
}

const ancestorsOf = (layers, id) => [layers.find((entry) => entry.id === id), ...ancestors(layers, id)].filter(Boolean);
// Levels of groups inside group `id` (1: no group inside).
function groupHeight(layers, id) {
  const inner = layerChildren(layers, id).filter((layer) => layer.type === 'group');
  return 1 + (inner.length ? Math.max(...inner.map((group) => groupHeight(layers, group.id))) : 0);
}

/** Groups the unit of layer `id` may move into (not its own group, not inside itself, within the depth limit). */
export function groupTargets(layers, id) {
  const layer = layers.find((entry) => entry.id === id);
  if (!layer || layer.clip) return [];
  const own = layer.type === 'group' ? descendantIds(layers, id) : new Set();
  const height = layer.type === 'group' ? groupHeight(layers, id) : 0;
  return layers.filter((group) => group.type === 'group' && group.id !== id && !own.has(group.id) && group.id !== layer.parent
    && ancestorsOf(layers, group.id).length + height <= LAYER_LIMITS.depth);
}

/** Moves the unit of layer `id` to the top of group `groupId`'s children, or (null) to the top level directly above its outermost group. */
export function moveIntoGroup(layers, id, groupId) {
  const layer = layers.find((entry) => entry.id === id);
  if (!layer || layer.clip) return layers;
  const ids = unitIds(layers, id);
  const rest = layers.filter((entry) => !ids.includes(entry.id));
  if (groupId) {
    if (!groupTargets(layers, id).some((group) => group.id === groupId)) return layers;
    return place(layers, ids, rest.findIndex((entry) => entry.id === groupId), groupId);
  }
  if (!layer.parent) return layers;
  const outer = ancestors(layers, id).pop();
  return place(layers, ids, rest.findIndex((entry) => entry.id === outer.id) + 1, null);
}

/**
 * Puts the units of `ids` (siblings; clipped layers stand for their runs) into a new group
 * `groupId` where the topmost of them was. Returns the same list when they cannot be grouped.
 */
export function groupUnits(layers, ids, groupId, patch = {}) {
  const heads = [...new Set(ids.map((id) => {
    const layer = layers.find((entry) => entry.id === id);
    return layer?.clip ? clipBase(layers, id)?.id : layer?.id;
  }).filter(Boolean))];
  if (!heads.length || !canAddLayer(layers, 'group')) return layers;
  const parent = key(layers.find((entry) => entry.id === heads[0]));
  if (heads.some((id) => key(layers.find((entry) => entry.id === id)) !== parent)) return layers;
  // Depth: the new group sits in `parent` and holds the units.
  const height = Math.max(0, ...heads.map((id) => (layers.find((entry) => entry.id === id).type === 'group' ? groupHeight(layers, id) : 0)));
  if ((parent ? ancestorsOf(layers, parent).length : 0) + 1 + height > LAYER_LIMITS.depth) return layers;
  const group = normalizeLayer({ id: groupId, type: 'group', name: '', ...patch, ...(parent ? { parent } : {}) });
  if (!group || layers.some((entry) => entry.id === groupId)) return layers;
  const moving = new Set(heads.flatMap((id) => unitIds(layers, id)));
  const lastIndex = Math.max(...[...moving].map((id) => layers.findIndex((entry) => entry.id === id)));
  const inside = layers.filter((entry) => moving.has(entry.id)).map((entry) => (key(entry) === parent ? { ...entry, parent: groupId } : entry));
  const before = layers.slice(0, lastIndex + 1).filter((entry) => !moving.has(entry.id));
  const after = layers.slice(lastIndex + 1);
  return [...before, ...inside, group, ...after];
}

/** Removes group `id`, keeping its children in place in its parent (they lose its opacity, mode and mask). */
export function ungroup(layers, id) {
  const group = layers.find((entry) => entry.id === id);
  if (!group || group.type !== 'group' || group.locked) return layers;
  return layers.filter((entry) => entry.id !== id).map((entry) => {
    if (entry.parent !== id) return entry;
    const next = { ...entry };
    if (group.parent) next.parent = group.parent; else delete next.parent;
    return next;
  });
}

/** Turns clipping of layer `id` on or off (only where canClip allows turning it on). */
export function setClip(layers, id, clip) {
  if (clip && !canClip(layers, id)) return layers;
  return layers.map((layer) => {
    if (layer.id !== id || layer.locked) return layer;
    const next = { ...layer };
    if (clip) next.clip = true; else delete next.clip;
    return next;
  });
}

/** Why layer `id` cannot be deleted, or null: it, or a layer inside the group, is locked. */
export function removeBlocked(layers, id) {
  const layer = layers.find((entry) => entry.id === id);
  if (!layer) return null;
  if (layer.locked) return 'locked';
  if (layer.type === 'group' && layers.some((entry) => entry.locked && descendantIds(layers, id).has(entry.id))) return 'locked-inside';
  return null;
}

/**
 * Removes layer `id` (a group with everything inside it). Layers clipped to it are released and
 * stay where they are. Locked layers, and groups holding one, are kept. Source files are never touched.
 */
export function removeUnit(layers, id) {
  if (removeBlocked(layers, id) || !layers.some((entry) => entry.id === id)) return layers;
  const gone = new Set([id, ...descendantIds(layers, id)]);
  const released = new Set(clippedTo(layers, id).map((entry) => entry.id));
  return layers.filter((entry) => !gone.has(entry.id)).map((entry) => {
    if (!released.has(entry.id)) return entry;
    const { clip, ...rest } = entry; // eslint-disable-line no-unused-vars
    return rest;
  });
}

/**
 * A copy of layer `id` (a group with copies of everything inside it) with ids from `makeId(type)`,
 * unlocked, directly above the original's unit (a clipped layer's copy stays in its run, clipped).
 * Image and text copies are nudged so they do not hide the original. Same list when over a limit.
 */
export function duplicateUnit(layers, id, makeId) {
  const original = layers.find((entry) => entry.id === id);
  if (!original) return { layers, id: null };
  const members = original.type === 'group' ? layers.filter((entry) => descendantIds(layers, id).has(entry.id) || entry.id === id) : [original];
  let check = layers;
  for (const member of members) {
    if (!canAddLayer(check, member.type)) return { layers, id: null };
    check = [...check, { type: member.type }];
  }
  const ids = new Map(members.map((member) => [member.id, makeId(member.type)]));
  const copies = members.map((member) => {
    const nudge = member.type === 'image' || member.type === 'text' ? { x: member.x + 0.03, y: member.y + 0.03 } : {};
    const copy = { ...member, ...nudge, id: ids.get(member.id), locked: false, name: member.name && member.id === id ? cleanName(`${member.name} copy`) : member.name };
    if (member.id !== id && ids.has(member.parent)) copy.parent = ids.get(member.parent);
    return normalizeLayer(copy) ?? copy;
  });
  const unit = original.clip ? [id] : unitIds(layers, id);
  const at = Math.max(...unit.map((entry) => layers.findIndex((layer) => layer.id === entry))) + 1;
  return { layers: [...layers.slice(0, at), ...copies, ...layers.slice(at)], id: ids.get(id) };
}

/**
 * Inserts `layer` (normalised here) next to layer `activeId`, in the same group: directly above
 * its unit (a clip run or a group with its contents), or with `clip` directly above `activeId`'s
 * run end, clipped to the same base. Without `activeId`, at the top. Same list when over a limit.
 */
export function insertAbove(layers, layer, activeId = null, { clip = false } = {}) {
  const active = layers.find((entry) => entry.id === activeId) ?? null;
  const parent = active ? key(active) : null;
  const normalized = normalizeLayer({ ...layer, ...(parent ? { parent } : {}), ...(clip ? { clip: true } : {}) });
  if (!normalized || !canAddLayer(layers, normalized.type) || layers.some(({ id }) => id === normalized.id)) return layers;
  if (!active) return [...layers, normalized];
  const head = active.clip ? clipBase(layers, active.id) : active;
  const unit = clip && active.clip ? [active.id] : unitIds(layers, head?.id ?? active.id);
  const at = Math.max(...unit.map((id) => layers.findIndex((entry) => entry.id === id))) + 1;
  return [...layers.slice(0, at), normalized, ...layers.slice(at)];
}

/** Whether a clipped layer can be added above `activeId` (an image, text or group layer, or a layer clipped to one). */
export function canClipAbove(layers, activeId) {
  const active = layers.find((entry) => entry.id === activeId);
  if (!active) return false;
  const base = active.clip ? clipBase(layers, active.id) : active;
  return Boolean(base) && base.type !== 'adjustment';
}

/** Whether group `id` and every group around it are visible (a layer inside a hidden group is not shown). */
export function shownInTree(layers, id) {
  const layer = layers.find((entry) => entry.id === id);
  return Boolean(layer?.visible) && ancestors(layers, id).every((group) => group.visible);
}

// ── Render program ─────────────────────────────────────────────────────────

/**
 * What is drawn, bottom to top (see the comment at the top). For a stack without groups or clips
 * this is one 'layer' step per visibleLayers() entry, in order, so such stacks render as before.
 */
export function layerProgram(layers) {
  const groupSteps = (group, asBase) => {
    if (!group.visible || group.opacity <= 0) return [];
    const inner = siblingSteps(group.id);
    if (!inner.length) return [];
    const owner = maskActive(group.mask) ? group : null;
    if (asBase) return [{ op: 'begin', id: group.id, isolate: true }, ...inner, { op: 'end', id: group.id, isolate: true, blend: 'normal', opacity: 1, owner }];
    if (group.blend === PASS_THROUGH) {
      if (group.opacity >= 1 && !owner) return inner;
      return [{ op: 'begin', id: group.id, isolate: false }, ...inner, { op: 'end', id: group.id, isolate: false, blend: 'normal', opacity: group.opacity, owner }];
    }
    return [{ op: 'begin', id: group.id, isolate: true }, ...inner, { op: 'end', id: group.id, isolate: true, blend: group.blend, opacity: group.opacity, owner }];
  };
  const nodeSteps = (layer, asBase = false) => {
    if (layer.type === 'group') return groupSteps(layer, asBase);
    if (!layerDraws(layer)) return [];
    return [{ op: 'layer', layer: asBase ? { ...layer, opacity: 1, blend: 'normal' } : layer, clip: false }];
  };
  const siblingSteps = (parent) => {
    const steps = [];
    const kids = layerChildren(layers, parent);
    for (let i = 0; i < kids.length;) {
      const base = kids[i];
      const clipped = [];
      for (i += 1; i < kids.length && kids[i].clip; i += 1) clipped.push(kids[i]);
      const shown = clipped.filter(layerDraws);
      if (!shown.length || base.type === 'adjustment') {
        steps.push(...nodeSteps(base));
        continue; // eslint-disable-line no-continue
      }
      // A base that draws nothing (hidden, empty, fully transparent) clips everything away.
      if (!(base.type === 'group' ? base.visible && base.opacity > 0 : layerDraws(base))) continue; // eslint-disable-line no-continue
      const inner = nodeSteps(base, true);
      if (!inner.length) continue; // eslint-disable-line no-continue
      steps.push({ op: 'begin', id: `clip:${base.id}`, isolate: true }, ...inner);
      shown.forEach((layer) => steps.push({ op: 'layer', layer, clip: true }));
      steps.push({ op: 'end', id: `clip:${base.id}`, isolate: true, blend: base.blend === PASS_THROUGH ? 'normal' : base.blend, opacity: base.opacity, owner: null });
    }
    return steps;
  };
  return siblingSteps(null);
}

/** The layers a render draws (sources to load, LUTs to find), in program order. */
export const drawnLayers = (layers) => layerProgram(layers).filter(({ op }) => op === 'layer').map(({ layer }) => layer);

/** The deepest nesting of isolated buffers a program needs (each holds one canvas while it is drawn). */
export function programDepth(steps) {
  let depth = 0;
  let max = 0;
  for (const step of steps) {
    if (step.op === 'begin') { depth += 1; max = Math.max(max, depth); }
    if (step.op === 'end') depth -= 1;
  }
  return max;
}
