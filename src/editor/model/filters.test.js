import { describe, expect, test } from 'vitest';
import {
  BUILT_IN_FILTERS, FILTER_CATEGORIES, MAX_RECENT_FILTERS, customFilters, filterPatch, filterState, noFilterPatch, pushRecent,
  readFilterIds, searchFilters, writeFilterIds,
} from './filters.mjs';
import { BUILT_IN_LOOKS } from './looks.mjs';
import { adjustmentSpec, clampAdjustment, compactAdjustments, groupKeys, normalizeAdjustments } from './adjustments.mjs';
import { applyPreset, createPreset, parsePreset } from './presets.mjs';
import { changedGroups, groupPatch, planFilter } from './sync.mjs';
import { DOCUMENT_VERSION, createEditDocument, parseEditDocument, serializeEditDocument } from './editDocument.mjs';
import { createTextOverlay } from './overlays.mjs';
import { deriveParams } from '../pipeline/spec.mjs';
import { renderAnyImage } from '../pipeline/detailRenderer.mjs';

const CREATIVE = new Set(groupKeys('creative'));

function scene(width = 120, height = 80) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const i = (y * width + x) * 4;
    const t = x / (width - 1);
    const s = y / (height - 1);
    // Fine detail (foliage, fabric) as well as smooth gradients.
    const texture = 45 * Math.sin(x * 1.3) * Math.sin(y * 0.9);
    let rgb = [40 + 200 * t + texture, 60 + 150 * s + texture, 220 - 180 * t + texture];
    if (y > height * 0.6 && x < width * 0.35) rgb = [214, 168, 140];
    if (y > height * 0.6 && x > width * 0.65) rgb = [50, 150, 70];
    if (y < height * 0.15) rgb = [12, 14, 20];
    if ((x - width * 0.5) ** 2 + (y - height * 0.3) ** 2 < 49) rgb = [255, 252, 245];
    data.set([...rgb.map((v) => Math.max(0, Math.min(255, Math.round(v)))), 255], i);
  }
  return { width, height, data };
}
const meanAbs = (a, b) => {
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c += 1) sum += Math.abs(a[i + c] - b[i + c]);
  return sum / ((a.length / 4) * 3);
};

describe('built-in filters', () => {
  test('unique ids and names, known categories, the Interval 11 looks kept with their ids', () => {
    expect(new Set(BUILT_IN_FILTERS.map(({ id }) => id)).size).toBe(BUILT_IN_FILTERS.length);
    expect(new Set(BUILT_IN_FILTERS.map(({ name }) => name.toLowerCase())).size).toBe(BUILT_IN_FILTERS.length);
    BUILT_IN_LOOKS.forEach(({ id }) => expect(BUILT_IN_FILTERS.some((filter) => filter.id === id)).toBe(true));
    const categories = FILTER_CATEGORIES.map(({ id }) => id);
    BUILT_IN_FILTERS.forEach((filter) => {
      expect(categories).toContain(filter.category);
      expect(filter.category).not.toBe('custom');
      expect(filter.description.length).toBeGreaterThan(10);
    });
    ['digicam', 'vintage', 'cinematic', 'experimental'].forEach((category) => expect(BUILT_IN_FILTERS.filter((f) => f.category === category).length).toBeGreaterThanOrEqual(8));
    // Grouped by category in display order.
    const order = BUILT_IN_FILTERS.map(({ category }) => categories.indexOf(category));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test('settings are Creative controls within their ranges, never the grain pattern', () => {
    BUILT_IN_FILTERS.forEach((filter) => Object.entries(filter.settings).forEach(([key, value]) => {
      expect(CREATIVE.has(key), `${filter.name}: ${key}`).toBe(true);
      expect(key).not.toBe('grainSeed');
      expect(clampAdjustment(key, value), `${filter.name}: ${key}`).toBe(value);
      if (adjustmentSpec(key).scales) expect(value, `${filter.name}: ${key} is neutral`).not.toBe(adjustmentSpec(key).default);
    }));
  });

  test('every filter visibly changes a photo, and no two filters look nearly the same', { timeout: 30000 }, () => {
    const image = scene(360, 240);
    const neutral = renderAnyImage(image, deriveParams({}), { nativeWidth: 6000, nativeHeight: 4000 });
    const renders = BUILT_IN_FILTERS.map((filter) => renderAnyImage(image, deriveParams({ ...filterPatch(filter, 100), grainSeed: 11 }), { nativeWidth: 6000, nativeHeight: 4000 }));
    renders.forEach((out, i) => expect(meanAbs(out, neutral), BUILT_IN_FILTERS[i].name).toBeGreaterThan(3));
    const close = [];
    for (let i = 0; i < renders.length; i += 1) for (let j = i + 1; j < renders.length; j += 1) {
      const d = meanAbs(renders[i], renders[j]);
      if (d < 2.5) close.push(`${BUILT_IN_FILTERS[i].name} / ${BUILT_IN_FILTERS[j].name}: ${d.toFixed(2)}`);
    }
    expect(close).toEqual([]);
  });
});

describe('applying filters', () => {
  const filter = BUILT_IN_FILTERS.find(({ id }) => id === 'filter:classic-ccd');

  test('the patch replaces the Creative group, records the filter and keeps the grain pattern', () => {
    const before = normalizeAdjustments({ exposure: 0.7, grainSeed: 321, vignetteRoundness: 50, bloomAmount: 30, overlays: [createTextOverlay('t1', { text: 'A' })] });
    const after = normalizeAdjustments({ ...before, ...filterPatch(filter, 100) });
    expect(after.filter).toEqual({ id: filter.id, strength: 100 });
    expect(after).toMatchObject({ exposure: 0.7, grainSeed: 321, vignetteRoundness: 0, bloomAmount: 0, ...filter.settings });
    expect(after.layers).toHaveLength(1);
    expect(filterState(after, BUILT_IN_FILTERS)).toMatchObject({ filter, strength: 100, modified: false });
    // Strength scales amounts from neutral; 0 is no Creative effect at all.
    const half = normalizeAdjustments({ ...before, ...filterPatch(filter, 50) });
    expect(half.sensorColor).toBe(Math.round(filter.settings.sensorColor / 2));
    expect(deriveParams({ ...before, ...filterPatch(filter, 0) }).creativeActive).toBe(false);
    expect(filterState(half, BUILT_IN_FILTERS).modified).toBe(false);
    // A hand edit marks the filter modified; removing it leaves no record and a neutral Creative group.
    expect(filterState({ ...after, jpegAmount: 90 }, BUILT_IN_FILTERS).modified).toBe(true);
    const removed = normalizeAdjustments({ ...after, ...noFilterPatch() });
    expect(removed.filter).toBeNull();
    expect(removed.grainSeed).toBe(321);
    expect(deriveParams(removed).creativeActive).toBe(false);
    expect(filterState({ ...after, filter: { id: 'filter:gone', strength: 40 } }, BUILT_IN_FILTERS)).toMatchObject({ filter: null, modified: true });
  });

  test('search matches every word in names, descriptions and categories, ignoring case and accents', () => {
    const names = (query) => searchFilters(BUILT_IN_FILTERS, query).map(({ name }) => name);
    expect(names('FLASH')).toEqual(expect.arrayContaining(['Y2K Flash', 'Harsh Direct Flash', 'Overexposed Flash']));
    expect(names('cinéma cold')).toEqual(['Cold Cinema']);
    expect(names('digicam')).toHaveLength(BUILT_IN_FILTERS.filter(({ category }) => category === 'digicam').length);
    expect(names('  ')).toHaveLength(BUILT_IN_FILTERS.length);
    expect(names('no such filter')).toEqual([]);
  });

  test('custom filters are presets with only Creative settings', () => {
    const adjustments = normalizeAdjustments({ ...filterPatch(filter, 80), exposure: 1, grainSeed: 9 });
    const mine = createPreset('Mine', adjustments, ['creative']);
    const mixed = createPreset('Mixed', adjustments, ['creative', 'tone']);
    const [custom] = customFilters([mine, mixed]);
    expect(customFilters([mine, mixed])).toHaveLength(1);
    expect(custom).toMatchObject({ id: 'preset:Mine', name: 'Mine', category: 'custom' });
    expect(custom.settings.grainSeed).toBeUndefined();
    expect(custom.settings.exposure).toBeUndefined();
    const applied = normalizeAdjustments({ grainSeed: 2, ...filterPatch(custom, 100) });
    groupKeys('creative').filter((key) => key !== 'grainSeed').forEach((key) => expect(applied[key]).toBe(adjustments[key]));
  });

  test('presets replace the record with their own values; sync copies it with the Creative group', () => {
    const filtered = normalizeAdjustments({ ...filterPatch(filter, 60), grainSeed: 4 });
    const preset = parsePreset(createPreset('Look', filtered, ['creative']));
    expect(preset.settings.filter).toBeUndefined();
    expect(applyPreset(filtered, preset).filter).toBeNull();
    expect(groupPatch(filtered, ['creative']).filter).toEqual({ id: filter.id, strength: 60 });
    expect(groupPatch(filtered, ['light']).filter).toBeUndefined();
    expect(changedGroups({}, { filter: { id: filter.id, strength: 60 } })).toEqual(['creative']);
  });

  test('a batch filter changes only the Creative group of each photo', () => {
    const photo = (id, adjustments, extra = {}) => ({ id, name: `${id}.jpg`, status: 'ready', width: 300, height: 200, history: { present: normalizeAdjustments(adjustments) }, ...extra });
    const targets = [
      photo('a', { exposure: 0.5, grainSeed: 10, geometry: { angle: 4 }, overlays: [createTextOverlay('t2', { text: 'keep' })] }),
      photo('b', { grainSeed: 20, bleachAmount: 50, curves: { master: [[0, 10], [255, 245]] } }, { raw: { asShot: [2, 1, 1.5] } }),
      photo('c', {}, { status: 'importing' }),
    ];
    const plan = planFilter(filter, 70, targets);
    expect(plan.items.map(({ id }) => id)).toEqual(['a', 'b']);
    plan.items.forEach((item) => expect(item.changed).toEqual(['creative']));
    const [a, b] = plan.items.map(({ after }) => after);
    expect(a).toMatchObject({ exposure: 0.5, grainSeed: 10, filter: { id: filter.id, strength: 70 } });
    expect(a.geometry.angle).toBe(4);
    expect(a.layers.map(({ text }) => text)).toEqual(['keep']);
    expect(b).toMatchObject({ grainSeed: 20, bleachAmount: 0, filter: { id: filter.id, strength: 70 } });
    expect(b.curves.master).toEqual([[0, 10], [255, 245]]);
  });
});

describe('documents and per-viewer lists', () => {
  test('version 8+ documents keep the digital controls and the filter; older ones open without them', () => {
    const adjustments = normalizeAdjustments({ ...filterPatch(BUILT_IN_FILTERS.find(({ id }) => id === 'filter:pixelated'), 90), grainSeed: 5 });
    const photo = { name: 'a.jpg', size: 10, lastModified: 1, sha256: null, format: 'jpeg', width: 300, height: 200, orientation: 1, history: { present: adjustments }, adjustments };
    const text = serializeEditDocument(createEditDocument([photo], {}, new Date(0)));
    const saved = JSON.parse(text);
    expect(saved.version).toBe(DOCUMENT_VERSION);
    expect(saved.photos[0].adjustments).toMatchObject({ captureResolution: 77, pixelEdges: 100, filter: { id: 'filter:pixelated', strength: 90 } });
    const [restored] = parseEditDocument(text).photos;
    expect(normalizeAdjustments(restored.adjustments)).toMatchObject({ captureResolution: 77, filter: { id: 'filter:pixelated', strength: 90 } });
    const older = parseEditDocument(JSON.stringify({ ...saved, version: 7, photos: [{ ...saved.photos[0], adjustments: { exposure: 0.2, grainAmount: 10 } }] }));
    expect(normalizeAdjustments(older.photos[0].adjustments)).toMatchObject({ exposure: 0.2, grainAmount: 10, captureResolution: 0, filter: null });
    // A malformed record is dropped, never trusted.
    expect(normalizeAdjustments({ filter: { id: 'javascript:alert(1)', strength: 50 } }).filter).toBeNull();
    expect(normalizeAdjustments({ filter: { id: 'filter:sepia', strength: 400 } }).filter).toEqual({ id: 'filter:sepia', strength: 100 });
    expect(compactAdjustments({}).filter).toBeUndefined();
  });

  test('favourites and recent filters survive bad storage', () => {
    const store = new Map();
    const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
    expect(readFilterIds(storage, 'k')).toEqual([]);
    writeFilterIds(storage, 'k', ['filter:sepia']);
    expect(readFilterIds(storage, 'k')).toEqual(['filter:sepia']);
    store.set('k', '{not json');
    expect(readFilterIds(storage, 'k')).toEqual([]);
    store.set('k', JSON.stringify([1, 'filter:a', null]));
    expect(readFilterIds(storage, 'k')).toEqual(['filter:a']);
    expect(readFilterIds({ getItem() { throw new Error('blocked'); } }, 'k')).toEqual([]);
    expect(() => writeFilterIds({ setItem() { throw new Error('full'); } }, 'k', [])).not.toThrow();
    let recent = [];
    for (let i = 0; i < 12; i += 1) recent = pushRecent(recent, `filter:${i % 10}`);
    expect(recent).toHaveLength(MAX_RECENT_FILTERS);
    expect(recent[0]).toBe('filter:1');
    expect(new Set(recent).size).toBe(recent.length);
  });
});
