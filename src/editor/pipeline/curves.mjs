// Tone curves: a master RGB curve and one per channel, on sRGB-encoded values.
// Control points are integer pairs on 0–255 with strictly increasing x. Between
// points the curve is a monotone cubic (Fritsch–Carlson / PCHIP slopes), so it never
// overshoots its points; outside the first and last point it is flat. Both renderers
// sample the same tabulated curve (CURVE_TABLE_SIZE entries, linear between them), so
// the table is the specification of what a curve does to a pixel.

export const CURVE_CHANNELS = Object.freeze(['master', 'red', 'green', 'blue']);
export const MAX_CURVE_POINTS = 16;
export const CURVE_TABLE_SIZE = 1024;
export const NEUTRAL_CURVE = Object.freeze([Object.freeze([0, 0]), Object.freeze([255, 255])]);

const isPoint = (point) => Array.isArray(point) && point.length === 2 && point.every((v) => typeof v === 'number' && Number.isFinite(v));

/**
 * Validated control points: rounded and clamped to 0–255, sorted by x, duplicates of
 * x resolved to the last one given. Anything that is not 2–16 points becomes neutral.
 */
export function normalizeCurve(points) {
  if (!Array.isArray(points) || points.length < 2 || points.length > MAX_CURVE_POINTS || !points.every(isPoint)) return NEUTRAL_CURVE;
  const byX = new Map();
  points.forEach(([x, y]) => byX.set(Math.min(255, Math.max(0, Math.round(x))), Math.min(255, Math.max(0, Math.round(y)))));
  if (byX.size < 2) return NEUTRAL_CURVE;
  const sorted = [...byX.entries()].sort((a, b) => a[0] - b[0]);
  return isNeutralCurve(sorted) ? NEUTRAL_CURVE : sorted;
}

/** The identity: every point on y = x and the curve spans 0–255 (so no flat ends). */
export const isNeutralCurve = (points) => points[0][0] === 0 && points.at(-1)[0] === 255 && points.every(([x, y]) => x === y);

export const neutralCurves = () => Object.fromEntries(CURVE_CHANNELS.map((channel) => [channel, NEUTRAL_CURVE]));

export function normalizeCurves(input) {
  const source = input !== null && typeof input === 'object' ? input : {};
  return Object.fromEntries(CURVE_CHANNELS.map((channel) => [channel, normalizeCurve(source[channel])]));
}

const pointsEqual = (a, b) => a === b || (a.length === b.length && a.every(([x, y], i) => x === b[i][0] && y === b[i][1]));
export const curvesEqual = (a, b) => CURVE_CHANNELS.every((channel) => pointsEqual(a[channel], b[channel]));
export const curvesNeutral = (curves) => CURVE_CHANNELS.every((channel) => isNeutralCurve(curves[channel]));

/** Fritsch–Carlson slopes: zero at local extrema, weighted harmonic means elsewhere. */
function monotoneSlopes(xs, ys) {
  const n = xs.length;
  const h = [];
  const d = [];
  for (let k = 0; k < n - 1; k += 1) {
    h.push(xs[k + 1] - xs[k]);
    d.push((ys[k + 1] - ys[k]) / h[k]);
  }
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k += 1) {
    if (d[k - 1] * d[k] <= 0) {
      m[k] = 0;
    } else {
      const w1 = 2 * h[k] + h[k - 1];
      const w2 = h[k] + 2 * h[k - 1];
      m[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k]);
    }
  }
  return m;
}

/** Exact curve value at x (0–255 scale). Used to build tables and in tests. */
export function curveEvaluator(points) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const m = monotoneSlopes(xs, ys);
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs.at(-1)) return ys.at(-1);
    let k = 0;
    while (x > xs[k + 1]) k += 1;
    const h = xs[k + 1] - xs[k];
    const t = (x - xs[k]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    const y = (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1];
    return Math.min(255, Math.max(0, y));
  };
}

// Texture layout: one RGBA texel per entry, channels in this order.
export const CURVE_TABLE_ORDER = Object.freeze(['red', 'green', 'blue', 'master']);

const tableCache = new Map();

/**
 * Tabulates the four curves as CURVE_TABLE_SIZE RGBA float entries on 0–1.
 * :returns: { table: Float32Array, active: [red, green, blue, master] booleans }
 */
export function curveTables(curves) {
  const key = JSON.stringify(CURVE_TABLE_ORDER.map((channel) => curves[channel]));
  const cached = tableCache.get(key);
  if (cached) return cached;
  const table = new Float32Array(CURVE_TABLE_SIZE * 4);
  CURVE_TABLE_ORDER.forEach((channel, c) => {
    const evaluate = curveEvaluator(curves[channel]);
    for (let i = 0; i < CURVE_TABLE_SIZE; i += 1) table[i * 4 + c] = evaluate((i / (CURVE_TABLE_SIZE - 1)) * 255) / 255;
  });
  const result = { table, active: CURVE_TABLE_ORDER.map((channel) => !isNeutralCurve(curves[channel])) };
  tableCache.set(key, result);
  if (tableCache.size > 16) tableCache.delete(tableCache.keys().next().value);
  return result;
}

/** Table lookup with linear interpolation; `c` is the index in CURVE_TABLE_ORDER. */
export function sampleCurve(table, c, value) {
  const position = Math.min(1, Math.max(0, value)) * (CURVE_TABLE_SIZE - 1);
  const index = Math.min(CURVE_TABLE_SIZE - 2, Math.floor(position));
  const fraction = position - index;
  const a = table[index * 4 + c];
  return a + (table[(index + 1) * 4 + c] - a) * fraction;
}
