// The adjustment registry: one entry per control. The UI, the edit document
// validator and the parameter derivation all read this list, so a control cannot
// exist in one place and not another. Every value is relative to neutral: 0 is
// the identity, so a missing key in a saved document means "no change".

export const ADJUSTMENTS = Object.freeze([
  { key: 'exposure', group: 'light', label: 'Exposure', min: -5, max: 5, step: 0.05, unit: 'EV', digits: 2 },
  { key: 'contrast', group: 'light', label: 'Contrast', min: -100, max: 100, step: 1 },
  { key: 'highlights', group: 'light', label: 'Highlights', min: -100, max: 100, step: 1 },
  { key: 'shadows', group: 'light', label: 'Shadows', min: -100, max: 100, step: 1 },
  { key: 'whites', group: 'light', label: 'Whites', min: -100, max: 100, step: 1 },
  { key: 'blacks', group: 'light', label: 'Blacks', min: -100, max: 100, step: 1 },
  { key: 'temperature', group: 'color', label: 'Temperature', min: -100, max: 100, step: 1, track: 'temperature' },
  { key: 'tint', group: 'color', label: 'Tint', min: -100, max: 100, step: 1, track: 'tint' },
  { key: 'vibrance', group: 'color', label: 'Vibrance', min: -100, max: 100, step: 1 },
  { key: 'saturation', group: 'color', label: 'Saturation', min: -100, max: 100, step: 1 },
].map((entry) => Object.freeze({ digits: 0, unit: '', default: 0, ...entry })));

export const ADJUSTMENT_GROUPS = Object.freeze([
  { id: 'light', label: 'Light' },
  { id: 'color', label: 'Color' },
]);

export const ADJUSTMENT_KEYS = Object.freeze(ADJUSTMENTS.map(({ key }) => key));
const byKey = new Map(ADJUSTMENTS.map((entry) => [entry.key, entry]));

export const adjustmentSpec = (key) => byKey.get(key);

/** A fresh all-neutral adjustment set. */
export function neutralAdjustments() {
  return Object.fromEntries(ADJUSTMENTS.map(({ key, default: value }) => [key, value]));
}

/** Rounds to the control's step and clamps to its range. Non-numbers become the default. */
export function clampAdjustment(key, value) {
  const spec = byKey.get(key);
  if (!spec) throw new Error(`Unknown adjustment: ${key}`);
  const number = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(number)) return spec.default;
  const stepped = Math.round(number / spec.step) * spec.step;
  const clamped = Math.min(spec.max, Math.max(spec.min, stepped));
  // Removes binary noise such as 0.15000000000000002 and normalises -0.
  return Number(clamped.toFixed(spec.digits)) + 0;
}

/** Fills missing keys with neutral values and clamps the rest; unknown keys are dropped. */
export function normalizeAdjustments(input = {}) {
  return Object.fromEntries(ADJUSTMENTS.map(({ key, default: value }) => [
    key,
    Object.hasOwn(input, key) ? clampAdjustment(key, input[key]) : value,
  ]));
}

export const isNeutral = (adjustments) => ADJUSTMENTS.every(({ key, default: value }) => (adjustments[key] ?? value) === value);

export const adjustmentsEqual = (a, b) => ADJUSTMENT_KEYS.every((key) => a[key] === b[key]);

/** Display string for a value: signed, fixed digits, with unit. */
export function formatAdjustment(key, value) {
  const spec = byKey.get(key);
  const fixed = value.toFixed(spec.digits);
  const signed = value > 0 ? `+${fixed}` : fixed;
  return spec.unit ? `${signed} ${spec.unit}` : signed;
}
