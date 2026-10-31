// Retouch operations (`adjustments.retouch`, edit document v12): Clone Stamp and Spot Healing,
// kept as data, never as pixels. Each operation is one stroke (a single click is a one-point
// stroke) in the photo's own space before Crop & Transform: points are normalised to the
// photo's oriented width and height (0–1), the radius is a share of its short edge, and the
// source is an offset from the stroke in the same units. So an operation keeps its place at
// any preview, zoom or export size and after any crop, rotation or perspective change; it is
// rendered from the source pixels of whatever size is being rendered (pipeline/retouch.mjs).
// Retouch belongs to one photograph: presets, recipes, copy/paste and sync never carry it.

export const RETOUCH_TYPES = Object.freeze(['clone', 'heal', 'remove']);

export const RETOUCH_LIMITS = Object.freeze({
  operations: 200,
  // Points per stroke, and for the whole photo (a stroke is resampled to stay under these).
  points: 1000,
  photoPoints: 20000,
  radius: Object.freeze([0.002, 0.25]),
  hardness: Object.freeze([0, 1]),
  opacity: Object.freeze([0.01, 1]),
  spacing: Object.freeze([0.05, 1]),
  offset: 2,
});

/** Brush defaults: a small soft brush, full strength, a stamp every quarter radius. */
export const RETOUCH_DEFAULTS = Object.freeze({ radius: 0.02, hardness: 0.5, opacity: 1, spacing: 0.25 });

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, [min, max], fallback) => (finite(value) ? Math.min(max, Math.max(min, value)) : fallback);
const round = (value, digits = 6) => Number(value.toFixed(digits)) + 0;
const cleanId = (value, index) => (typeof value === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(value) ? value : `r${index + 1}`);

/** Every `step`-th point, keeping the last, so a stroke stays within `limit` points. */
function thin(points, limit) {
  if (points.length <= limit) return points;
  const step = points.length / limit;
  const out = [];
  for (let i = 0; i < limit - 1; i += 1) out.push(points[Math.floor(i * step)]);
  out.push(points[points.length - 1]);
  return out;
}

/**
 * One operation from untrusted input, or null.
 * :returns: { id, type, enabled, points: [[x, y]], radius, hardness, opacity, spacing, offset: { x, y } }
 */
export function normalizeRetouchOperation(input, index = 0, budget = { points: RETOUCH_LIMITS.photoPoints }) {
  if (!isObject(input) || !RETOUCH_TYPES.includes(input.type) || !Array.isArray(input.points)) return null;
  let points = input.points
    .filter((point) => Array.isArray(point) && finite(point[0]) && finite(point[1]))
    .map(([x, y]) => [round(clamp(x, [-0.5, 1.5], 0)), round(clamp(y, [-0.5, 1.5], 0))]);
  points = thin(points, Math.min(RETOUCH_LIMITS.points, Math.max(1, budget.points)));
  if (!points.length) return null;
  budget.points -= points.length;
  const offset = isObject(input.offset) ? input.offset : {};
  return {
    id: cleanId(input.id, index),
    type: input.type,
    enabled: input.enabled !== false,
    points,
    radius: round(clamp(input.radius, RETOUCH_LIMITS.radius, RETOUCH_DEFAULTS.radius)),
    hardness: round(clamp(input.hardness, RETOUCH_LIMITS.hardness, RETOUCH_DEFAULTS.hardness), 4),
    opacity: round(clamp(input.opacity, RETOUCH_LIMITS.opacity, RETOUCH_DEFAULTS.opacity), 4),
    spacing: round(clamp(input.spacing, RETOUCH_LIMITS.spacing, RETOUCH_DEFAULTS.spacing), 4),
    offset: input.type === 'remove' ? { x: 0, y: 0 } : { x: round(clamp(offset.x, [-RETOUCH_LIMITS.offset, RETOUCH_LIMITS.offset], 0)), y: round(clamp(offset.y, [-RETOUCH_LIMITS.offset, RETOUCH_LIMITS.offset], 0)) },
    // Remove: an optional source area (normalised rectangle) the fill may copy from.
    ...(input.type === 'remove' ? { source: normalizeArea(input.source) } : {}),
  };
}

/** A normalised source rectangle inside the photo, at least 1% across, or null. */
function normalizeArea(input) {
  if (!isObject(input) || ![input.x, input.y, input.width, input.height].every(finite)) return null;
  const x = clamp(input.x, [0, 1], 0); const y = clamp(input.y, [0, 1], 0);
  const width = Math.min(1 - x, clamp(input.width, [0, 1], 0)); const height = Math.min(1 - y, clamp(input.height, [0, 1], 0));
  return width >= 0.01 && height >= 0.01 ? { x: round(x), y: round(y), width: round(width), height: round(height) } : null;
}

/** The operations list from untrusted input: valid entries only, unique ids, within the limits. */
export function normalizeRetouch(input) {
  if (!Array.isArray(input)) return [];
  const budget = { points: RETOUCH_LIMITS.photoPoints };
  const seen = new Set();
  const out = [];
  for (const [index, entry] of input.slice(0, RETOUCH_LIMITS.operations).entries()) {
    const operation = normalizeRetouchOperation(entry, index, budget);
    if (!operation) continue;
    if (seen.has(operation.id)) operation.id = `${operation.id}-${index}`;
    seen.add(operation.id);
    out.push(operation);
    if (budget.points <= 0) break;
  }
  return out;
}

const operationKey = (op) => JSON.stringify([op.id, op.type, op.enabled, op.points, op.radius, op.hardness, op.opacity, op.spacing, op.offset.x, op.offset.y, op.source ?? null]);
export const retouchEqual = (a, b) => a.length === b.length && a.every((op, i) => operationKey(op) === operationKey(b[i]));
export const activeRetouch = (operations) => (operations ?? []).filter(({ enabled }) => enabled);

/** A new operation (normalised): `points` in the photo's normalised space, `offset` source − target. */
export const createRetouchOperation = (id, type, points, settings, offset) => normalizeRetouchOperation({ id, type, points, offset, ...RETOUCH_DEFAULTS, ...settings });

export const updateRetouchOperation = (operations, id, patch) => operations.map((op, index) => (op.id === id ? normalizeRetouchOperation({ ...op, ...patch, id }, index) ?? op : op));
export const removeRetouchOperation = (operations, id) => operations.filter((op) => op.id !== id);

export const RETOUCH_LABELS = Object.freeze({ clone: 'Clone', heal: 'Heal', remove: 'Remove' });
