import { ADJUSTMENTS, adjustmentSpec, adjustmentsEqual, neutralAdjustments, normalizeAdjustments } from './adjustments.mjs';
import { editorReducer, initialEditorState } from './editorState.mjs';
import { BUILT_IN_FILTERS, filterPatch, filterState } from './filters.mjs';
import { BUILT_IN_PRESETS, PRESET_TYPE, applyPreset } from './presets.mjs';
import {
  MAX_RECIPE_BYTES, RECIPE_FORMAT, RECIPE_GROUPS, RECIPE_VERSION, RecipeError, applyRecipe, changedRecipeGroups,
  parseRecipe, parseRecipeLibrary, recipeChanges, recipeFileName, recipeFromAdjustments, recipeFromPreset, recipeGroups,
  recipeResources, serializeRecipe, serializeRecipeLibrary, validateRecipe,
} from './recipes.mjs';
import { EXAMPLE_RECIPES, recipeReference } from './recipeReference.mjs';
import { planRecipe } from './sync.mjs';

const LUT = { sha256: 'b'.repeat(64), name: 'night.cube', title: 'Night', size: 33 };
const base = (fields = {}) => ({ format: RECIPE_FORMAT, version: RECIPE_VERSION, name: 'Test', ...fields });
const errorsOf = (input) => {
  try {
    parseRecipe(typeof input === 'string' ? input : JSON.stringify(input));
  } catch (error) {
    expect(error).toBeInstanceOf(RecipeError);
    return error.errors;
  }
  throw new Error('expected the recipe to be rejected');
};

// A photo with everything a recipe must never touch.
const SOURCE_SPECIFIC = normalizeAdjustments({
  rawTemperature: 4300,
  rawTint: 12,
  raw: { whiteBalance: 'custom' },
  hdrHighlights: 70,
  hdrShadows: 20,
  grainSeed: 4242,
  geometry: { quarterTurns: 1, angle: 3, crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.7 } },
  layers: [{ id: 'l1', type: 'text', text: 'Hi', x: 0.5, y: 0.5 }],
  local: [{ id: 'm1', name: 'Sky', mask: { space: 'image', components: [{ id: 'c1', type: 'linear', start: [0.5, 0], end: [0.5, 0.4] }] }, settings: { exposure: -0.5 } }],
  contrast: 20,
  vibrance: 30,
});

describe('recipe schema', () => {
  test('valid recipes parse to a canonical form', () => {
    const recipe = parseRecipe(JSON.stringify(base({ adjustments: { color: { saturation: 5, temperature: -3 }, light: { contrast: 10 } } })));
    expect(Object.keys(recipe)).toEqual(['format', 'version', 'name', 'adjustments', 'filter', 'lut']);
    expect(Object.keys(recipe.adjustments)).toEqual(['light', 'color']);
    expect(Object.keys(recipe.adjustments.color)).toEqual(['temperature', 'saturation']);
    EXAMPLE_RECIPES.forEach((example) => expect(() => validateRecipe(example)).not.toThrow());
  });

  test('every reusable registry key belongs to exactly one recipe group; source-specific keys to none', () => {
    const keys = RECIPE_GROUPS.flatMap((group) => group.keys);
    expect(new Set(keys).size).toBe(keys.length);
    const expected = ADJUSTMENTS.filter(({ group, hidden }) => ['light', 'color', 'hsl', 'detail', 'creative'].includes(group) && !hidden).map(({ key }) => key);
    expect([...keys].sort()).toEqual([...expected].sort());
    ['rawTemperature', 'rawTint', 'hdrHighlights', 'hdrShadows', 'grainSeed', 'lutIntensity'].forEach((key) => expect(keys).not.toContain(key));
  });

  test('missing required fields and wrong format are named', () => {
    expect(errorsOf({ version: 1, name: 'x', adjustments: { light: {} } })[0]).toMatch(/format must be "quangedit-recipe"/);
    expect(errorsOf({ format: RECIPE_FORMAT, name: 'x' })[0]).toMatch(/version/);
    expect(errorsOf({ format: RECIPE_FORMAT, version: 1, adjustments: { light: {} } })).toContain('name must be a short title (1–60 characters).');
    expect(errorsOf(base())[0]).toMatch(/contains no settings/);
  });

  test('unknown fields and misplaced keys are rejected with their path', () => {
    const errors = errorsOf(base({ extra: 1, adjustments: { light: { contrast: 5, saturation: 3, sparkle: 1 }, geometry: {}, exposure: 1 } }));
    expect(errors).toEqual(expect.arrayContaining([
      'Unknown field "extra" at the top level.',
      'adjustments.light.saturation belongs in adjustments.color.',
      'Unknown field adjustments.light.sparkle.',
      expect.stringMatching(/^Unknown group adjustments.geometry/),
      'exposure must be inside adjustments.light.',
    ]));
    expect(errorsOf(base({ adjustments: { creative: { grainSeed: 3 } } }))[0]).toMatch(/Unknown field adjustments.creative.grainSeed/);
    expect(errorsOf(base({ adjustments: { light: { rawTemperature: 5000 } } }))[0]).toMatch(/rawTemperature/);
  });

  test('unsupported versions are rejected clearly; future versions name both', () => {
    expect(errorsOf(base({ version: 2, adjustments: { light: {} } }))[0]).toMatch(/version 2; this editor reads version 1/);
    expect(errorsOf(base({ version: 0, adjustments: { light: {} } }))[0]).toMatch(/version must be/);
    expect(errorsOf(base({ version: '1', adjustments: { light: {} } }))[0]).toMatch(/version must be/);
  });

  test('numbers must be finite and inside the range; they are never clamped', () => {
    expect(errorsOf(base({ adjustments: { light: { contrast: 101 } } }))[0]).toBe('adjustments.light.contrast must be between -100 and 100 (got 101).');
    expect(errorsOf(base({ adjustments: { light: { exposure: '1' } } }))[0]).toBe('adjustments.light.exposure must be a number.');
    expect(errorsOf('{"format":"quangedit-recipe","version":1,"name":"x","adjustments":{"light":{"exposure":1e999}}}')[0]).toMatch(/must be a number/);
    expect(errorsOf(base({ adjustments: { detail: { sharpening: -1 } } }))[0]).toMatch(/between 0 and 100/);
    // The editor's own rule: values round to the control's step.
    expect(parseRecipe(JSON.stringify(base({ adjustments: { light: { exposure: 0.33, contrast: 10.4 } } }))).adjustments.light).toEqual({ exposure: 0.35, contrast: 10 });
  });

  test('curves need 2–16 increasing whole-number points', () => {
    const curve = (points) => base({ adjustments: { toneCurve: { master: points } } });
    expect(parseRecipe(JSON.stringify(curve([[0, 10], [255, 245]]))).adjustments.toneCurve.master).toEqual([[0, 10], [255, 245]]);
    expect(errorsOf(curve([[0, 0]]))[0]).toMatch(/2 to 16/);
    expect(errorsOf(curve([[0, 0], [0, 10]]))[0]).toMatch(/must increase/);
    expect(errorsOf(curve([[0, 0], [300, 10]]))[0]).toMatch(/0 to 255/);
    expect(errorsOf(curve([[0, 0], [128.5, 10]]))[0]).toMatch(/whole numbers/);
    expect(errorsOf(base({ adjustments: { toneCurve: { alpha: [[0, 0], [255, 255]] } } }))[0]).toMatch(/channels are master, red, green, blue/);
  });

  test('filter ids must be built in; strength is a whole number 0–100', () => {
    expect(parseRecipe(JSON.stringify(base({ filter: { id: 'filter:classic-ccd' } }))).filter).toEqual({ id: 'filter:classic-ccd', strength: 100 });
    expect(errorsOf(base({ filter: { id: 'filter:nope' } }))[0]).toMatch(/filter.id "filter:nope" is not a built-in filter id/);
    expect(errorsOf(base({ filter: { id: 'preset:Mine' } }))[0]).toMatch(/not a built-in/);
    expect(errorsOf(base({ filter: { id: 'filter:classic-ccd', strength: 120 } }))[0]).toMatch(/strength/);
    expect(errorsOf(base({ filter: { id: 'filter:classic-ccd', script: 'x' } }))[0]).toMatch(/Unknown field filter.script/);
  });

  test('LUT references need a hash and a plain file name; data, paths and URLs are refused', () => {
    const lut = (fields) => base({ lut: { name: 'night.cube', sha256: LUT.sha256, ...fields } });
    expect(parseRecipe(JSON.stringify(lut({ sha256: LUT.sha256.toUpperCase(), intensity: 80 }))).lut).toEqual({ name: 'night.cube', sha256: LUT.sha256, intensity: 80, colorSpace: 'srgb' });
    expect(errorsOf(lut({ sha256: 'abc' }))[0]).toMatch(/SHA-256/);
    expect(errorsOf(lut({ name: 'C:\\LUTs\\night.cube' }))[0]).toMatch(/file name only/);
    expect(errorsOf(lut({ name: '/home/me/night.cube' }))[0]).toMatch(/file name only/);
    expect(errorsOf(lut({ data: 'LUT_3D_SIZE 2' }))[0]).toMatch(/never embed/);
    expect(errorsOf(lut({ url: 'https://example.com/x.cube' }))[0]).toMatch(/never embed, fetch/);
    expect(errorsOf(lut({ colorSpace: 'rec2020' }))[0]).toMatch(/srgb/);
    expect(errorsOf(lut({ size: 99 }))[0]).toMatch(/size/);
  });

  test('size, depth, entry count and strict JSON are enforced before validation', () => {
    expect(errorsOf(`{"name": "${'x'.repeat(MAX_RECIPE_BYTES)}"}`)[0]).toMatch(/larger than 64 KB/);
    expect(errorsOf('{"format": "quangedit-recipe", }')[0]).toMatch(/not valid JSON/);
    expect(errorsOf('// comment\n{}')[0]).toMatch(/not valid JSON/);
    expect(errorsOf(base({ adjustments: { light: { a: { b: { c: { d: { e: {} } } } } } } }))[0]).toMatch(/nested more than 6/);
    const many = Object.fromEntries(Array.from({ length: 1100 }, (_, i) => [`k${i}`, 0]));
    expect(errorsOf(base({ adjustments: { light: many } }))[0]).toMatch(/more than 1000 entries/);
    expect(errorsOf('[]')[0]).toMatch(/JSON object/);
    expect(errorsOf('  ')[0]).toMatch(/Paste a recipe/);
  });

  test('prototype pollution keys are rejected and never reach any object', () => {
    const text = '{"format":"quangedit-recipe","version":1,"name":"x","__proto__":{"polluted":1},"adjustments":{"light":{"__proto__":{"polluted":1},"contrast":1},"constructor":{"prototype":{"polluted":1}}}}';
    const errors = errorsOf(text);
    expect(errors).toEqual(expect.arrayContaining(['Unknown field "__proto__" at the top level.', 'Unknown field adjustments.light.__proto__.']));
    expect(errors.some((message) => message.includes('constructor'))).toBe(true);
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();
  });

  test('names and descriptions lose control characters; text is never interpreted', () => {
    const recipe = parseRecipe(JSON.stringify(base({ name: '<b>Hi</b>\u0000\nthere', description: '<script>alert(1)</script>', adjustments: { light: {} } })));
    expect(recipe.name).toBe('<b>Hi</b> there');
    expect(recipe.description).toBe('<script>alert(1)</script>');
  });

  test('serialization is deterministic and round-trips', () => {
    const shuffled = { lut: null, filter: { strength: 50, id: 'look:soft-print' }, adjustments: { color: { vibrance: 4 }, light: { shadows: 3, contrast: 2 } }, name: 'Same', version: 1, format: RECIPE_FORMAT };
    const ordered = base({ name: 'Same', adjustments: { light: { contrast: 2, shadows: 3 }, color: { vibrance: 4 } }, filter: { id: 'look:soft-print', strength: 50 }, lut: null });
    expect(serializeRecipe(shuffled)).toBe(serializeRecipe(ordered));
    const text = serializeRecipe(EXAMPLE_RECIPES[1]);
    expect(serializeRecipe(parseRecipe(text))).toBe(text);
    expect(text).toContain('"master": [[0, 6], [64, 58], [192, 200], [255, 248]]');
    expect(text.endsWith('}\n')).toBe(true);
  });

  test('edit documents and preset packs are pointed elsewhere', () => {
    expect(errorsOf({ type: 'quanghuynh.photo-editor.edits', version: 10, photos: [] })[0]).toMatch(/Open edits/);
    expect(errorsOf({ type: 'quanghuynh.photo-editor.presets', version: 1, presets: [] })[0]).toMatch(/pack of presets/);
  });
});

describe('copying settings', () => {
  test('copies reusable groups only, with no source-specific data', () => {
    const recipe = recipeFromAdjustments(SOURCE_SPECIFIC, { name: 'Mine' });
    const text = serializeRecipe(recipe);
    ['geometry', 'layers', 'local', 'raw', 'grainSeed', 'rawTemperature', 'hdrHighlights', 'quarterTurns', 'Sky', '"id"'].forEach((word) => expect(text).not.toContain(word));
    expect(recipe.adjustments.light).toEqual({ contrast: 20 });
    expect(recipe.adjustments.color).toEqual({ vibrance: 30 });
    expect(recipeGroups(recipe)).toEqual(['light', 'color', 'hsl', 'detail', 'toneCurve', 'colorGrading', 'creative']);
  });

  test('one group only, and the default selection is what differs from neutral', () => {
    const recipe = recipeFromAdjustments(SOURCE_SPECIFIC, { groups: ['color'] });
    expect(recipe.adjustments).toEqual({ color: { vibrance: 30 } });
    expect(changedRecipeGroups(SOURCE_SPECIFIC)).toEqual(['light', 'color']);
  });

  test('an unchanged built-in filter is copied by id; a modified one as its values', () => {
    const filter = BUILT_IN_FILTERS.find(({ id }) => id === 'filter:classic-ccd');
    const filtered = normalizeAdjustments({ ...filterPatch(filter, 70) });
    expect(recipeFromAdjustments(filtered).filter).toEqual({ id: filter.id, strength: 70 });
    const modified = normalizeAdjustments({ ...filtered, noiseAmount: 99 });
    expect(recipeFromAdjustments(modified).filter).toBeNull();
    expect(recipeFromAdjustments(modified).adjustments.creative.noiseAmount).toBe(99);
  });

  test('the LUT is copied as a reference with its intensity', () => {
    const recipe = recipeFromAdjustments(normalizeAdjustments({ lut: LUT, lutIntensity: 60 }), { groups: ['lut'] });
    expect(recipe.lut).toEqual({ name: 'night.cube', title: 'Night', sha256: LUT.sha256, intensity: 60, size: 33, colorSpace: 'srgb' });
  });

  test('copy then apply reproduces every reusable setting on another photo', () => {
    const filter = BUILT_IN_FILTERS.find(({ id }) => id === 'look:soft-print');
    const source = normalizeAdjustments({ ...filterPatch(filter, 80), exposure: 0.5, orangeHue: 7, clarity: 12, curves: { blue: [[0, 5], [255, 250]] }, lut: LUT, lutIntensity: 40, gradeBalance: 10 });
    const recipe = parseRecipe(serializeRecipe(recipeFromAdjustments(source)));
    const target = normalizeAdjustments({ ...SOURCE_SPECIFIC, saturation: -40, texture: 50 });
    const after = applyRecipe(target, recipe, { lut: LUT });
    const reusable = (a) => Object.fromEntries(RECIPE_GROUPS.flatMap(({ keys }) => keys).map((key) => [key, a[key]]));
    expect(reusable(after)).toEqual(reusable(source));
    expect(after.curves).toEqual(source.curves);
    expect(after.lut.sha256).toBe(LUT.sha256);
    expect(after.lutIntensity).toBe(40);
    // The source's filter was modified (gradeBalance), so it travels as values, not as a record.
    expect(after.filter).toBeNull();
  });
});

describe('applying recipes', () => {
  const recipe = parseRecipe(JSON.stringify(base({ adjustments: { light: { contrast: 10 }, hsl: { blueHue: 5 }, toneCurve: { red: [[0, 0], [128, 140], [255, 255]] } } })));

  test('replace sets each chosen group exactly; unstated keys of the group become neutral', () => {
    const before = normalizeAdjustments({ contrast: 40, highlights: -30, exposure: 1, saturation: 20, curves: { blue: [[0, 10], [255, 255]] } });
    const after = applyRecipe(before, recipe, { mode: 'replace' });
    expect([after.contrast, after.highlights, after.exposure]).toEqual([10, 0, 0]);
    expect(after.saturation).toBe(20);
    expect(after.curves.blue).toEqual([[0, 0], [255, 255]]);
    expect(after.curves.red).toEqual([[0, 0], [128, 140], [255, 255]]);
  });

  test('merge changes only the stated keys and channels', () => {
    const before = normalizeAdjustments({ contrast: 40, highlights: -30, curves: { blue: [[0, 10], [255, 255]] } });
    const after = applyRecipe(before, recipe, { mode: 'merge' });
    expect([after.contrast, after.highlights]).toEqual([10, -30]);
    expect(after.curves.blue).toEqual([[0, 10], [255, 255]]);
    expect(after.curves.red).toEqual([[0, 0], [128, 140], [255, 255]]);
  });

  test('only chosen groups apply; an empty group in replace mode resets that group', () => {
    const before = normalizeAdjustments({ contrast: 40, blueHue: -20 });
    expect(applyRecipe(before, recipe, { groups: ['hsl'] }).contrast).toBe(40);
    const reset = parseRecipe(JSON.stringify(base({ adjustments: { light: {} } })));
    expect(applyRecipe(before, reset).contrast).toBe(0);
    expect(applyRecipe(before, reset, { mode: 'merge' }).contrast).toBe(40);
  });

  test('a filter sets Creative and Color grading at its strength; recipe values override it', () => {
    const filter = BUILT_IN_FILTERS.find(({ id }) => id === 'filter:classic-ccd');
    const withFilter = parseRecipe(JSON.stringify(base({ filter: { id: filter.id, strength: 50 }, adjustments: { creative: { vignetteAmount: -40 } } })));
    const before = normalizeAdjustments({ bloomAmount: 60, grainSeed: 9, contrast: 12 });
    const after = applyRecipe(before, withFilter);
    const expected = normalizeAdjustments({ ...before, ...filterPatch(filter, 50), vignetteAmount: -40 });
    expect(after).toEqual(expected);
    expect(after.bloomAmount).toBe(0);
    expect(after.grainSeed).toBe(9);
    const filterOnly = applyRecipe(before, withFilter, { groups: ['filter'] });
    expect(filterState(filterOnly, BUILT_IN_FILTERS)).toMatchObject({ id: filter.id, strength: 50, modified: false });
  });

  test('replacing Creative without a filter clears the filter record; merge keeps it', () => {
    const filter = BUILT_IN_FILTERS[0];
    const before = normalizeAdjustments(filterPatch(filter, 100));
    const creative = parseRecipe(JSON.stringify(base({ adjustments: { creative: { fade: 10 } } })));
    expect(applyRecipe(before, creative).filter).toBeNull();
    expect(applyRecipe(before, creative, { mode: 'merge' }).filter).toEqual(before.filter);
  });

  test('a LUT applies only with the loaded file of the same hash', () => {
    const withLut = parseRecipe(JSON.stringify(base({ lut: { name: 'night.cube', sha256: LUT.sha256, intensity: 70 } })));
    expect(() => applyRecipe(neutralAdjustments(), withLut)).toThrow(/not loaded/);
    expect(() => applyRecipe(neutralAdjustments(), withLut, { lut: { ...LUT, sha256: 'c'.repeat(64) } })).toThrow(/not loaded/);
    const after = applyRecipe(neutralAdjustments(), withLut, { lut: LUT });
    expect(after.lut).toEqual({ sha256: LUT.sha256, name: 'night.cube', title: 'Night', size: 33 });
    expect(after.lutIntensity).toBe(70);
    expect(recipeResources(withLut, { hasLut: () => false }).lut.name).toBe('night.cube');
    expect(recipeResources(withLut, { hasLut: (sha) => sha === LUT.sha256 }).lut).toBeNull();
  });

  test('source-specific state is preserved in both modes', () => {
    ['replace', 'merge'].forEach((mode) => {
      const after = applyRecipe(SOURCE_SPECIFIC, EXAMPLE_RECIPES[1] && parseRecipe(serializeRecipe(EXAMPLE_RECIPES[1])), { mode });
      ['geometry', 'layers', 'local', 'raw', 'rawTemperature', 'rawTint', 'hdrHighlights', 'hdrShadows', 'grainSeed'].forEach((key) => expect(after[key]).toEqual(SOURCE_SPECIFIC[key]));
    });
  });

  test('recipeChanges lists individual settings with display values', () => {
    const after = applyRecipe(neutralAdjustments(), recipe);
    expect(recipeChanges(neutralAdjustments(), after)).toEqual([
      { group: 'light', label: 'Contrast', from: '0', to: '+10' },
      { group: 'hsl', label: 'Blue hue', from: '0', to: '+5' },
      { group: 'toneCurve', label: 'Red curve', from: '2 points', to: '3 points' },
    ]);
  });

  test('unknown modes are refused', () => {
    expect(() => applyRecipe(neutralAdjustments(), recipe, { mode: 'overwrite' })).toThrow(RecipeError);
  });
});

describe('batches, history and compatibility', () => {
  function workspace() {
    const ids = ['a', 'b', 'c'];
    let state = editorReducer(initialEditorState(), { type: 'photosAdded', photos: ids.map((id) => ({ id, name: `${id}.jpg`, size: 1, lastModified: 0 })) });
    ids.forEach((id, index) => {
      const info = { format: index === 1 ? 'arw' : 'jpeg', width: 10, height: 10, orientation: 1, sha256: null, ...(index === 1 ? { raw: { asShot: [2, 1, 1.5] } } : {}) };
      state = editorReducer(state, { type: 'importSucceeded', id, info });
    });
    return editorReducer(state, { type: 'applySettings', patch: SOURCE_SPECIFIC });
  }
  const present = (state, id) => state.photos.find((photo) => photo.id === id).history.present;
  const recipe = parseRecipe(serializeRecipe(EXAMPLE_RECIPES[0]));

  test('planning changes nothing; applying records one batch and one history entry per photo', () => {
    const state = workspace();
    const plan = planRecipe(recipe, state.photos, { mode: 'merge' });
    expect(plan.errors).toEqual([]);
    expect(plan.changedCount).toBe(3);
    expect(present(state, 'b')).toEqual(normalizeAdjustments({}));
    const next = editorReducer(state, { type: 'applyBatch', label: 'recipe', changes: plan.items.map(({ id, after }) => ({ id, after })) });
    expect(present(next, 'a').geometry).toEqual(SOURCE_SPECIFIC.geometry);
    expect(present(next, 'a').contrast).toBe(8);
    expect(present(next, 'a').vibrance).toBe(12);
    expect(present(next, 'b').exposure).toBe(0.15);
    const undone = editorReducer(next, { type: 'undoBatch' });
    ['a', 'b', 'c'].forEach((id) => expect(adjustmentsEqual(present(undone, id), present(state, id))).toBe(true));
    const single = editorReducer(next, { type: 'undo' });
    expect(adjustmentsEqual(present(single, 'a'), SOURCE_SPECIFIC)).toBe(true);
    expect(present(single, 'b').exposure).toBe(0.15);
  });

  test('a missing LUT blocks the plan but still previews the other groups', () => {
    const withLut = parseRecipe(JSON.stringify({ ...EXAMPLE_RECIPES[0], lut: { name: 'night.cube', sha256: LUT.sha256 } }));
    const plan = planRecipe(withLut, workspace().photos);
    expect(plan.errors[0]).toMatch(/"night.cube" is not loaded/);
    expect(plan.items[0].after.lut).toBeNull();
    expect(plan.items[0].after.contrast).toBe(8);
    const ok = planRecipe(withLut, workspace().photos, { lutOf: (sha) => (sha === LUT.sha256 ? LUT : null) });
    expect(ok.errors).toEqual([]);
    expect(ok.items[1].after.lut.sha256).toBe(LUT.sha256);
  });

  test('old presets convert to recipes that reproduce them in merge mode', () => {
    BUILT_IN_PRESETS.forEach((preset) => {
      const converted = parseRecipe(JSON.stringify({ type: PRESET_TYPE, version: 1, preset }));
      expect(applyRecipe(SOURCE_SPECIFIC, converted, { mode: 'merge' })).toEqual(applyPreset(SOURCE_SPECIFIC, preset));
    });
    expect(recipeFromPreset({ name: 'Exposure', groups: ['exposure'], settings: { exposure: 1 } }).adjustments).toEqual({ light: { exposure: 1 } });
    expect(() => recipeFromPreset({ name: 'x', groups: ['nope'] })).toThrow(RecipeError);
  });

  test('saved libraries keep valid recipes and drop invalid ones', () => {
    const text = serializeRecipeLibrary([recipe]);
    expect(parseRecipeLibrary(text)).toEqual([recipe]);
    const tampered = JSON.parse(text);
    tampered.recipes.push({ ...recipe, adjustments: { light: { contrast: 500 } } });
    expect(parseRecipeLibrary(JSON.stringify(tampered))).toEqual([recipe]);
    expect(parseRecipeLibrary('not json')).toEqual([]);
    expect(recipeFileName({ name: 'Cinematic Night / v2' })).toBe('cinematic-night-v2.quangedit-recipe.json');
  });
});

describe('authoring reference', () => {
  const reference = recipeReference();

  test('lists every recipe key with the registry range and default, and every built-in filter id', () => {
    RECIPE_GROUPS.flatMap(({ keys }) => keys).forEach((key) => {
      const { min, max, default: value } = adjustmentSpec(key);
      expect(reference).toContain(`${key} ${min}..${max}`);
      expect(reference).toMatch(new RegExp(`${key} [^;]*default ${value}`));
    });
    BUILT_IN_FILTERS.forEach(({ id }) => expect(reference).toContain(`- ${id}:`));
  });

  test('its examples are valid recipes', () => {
    const blocks = [...reference.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => match[1]);
    expect(blocks).toHaveLength(EXAMPLE_RECIPES.length);
    blocks.forEach((block) => expect(() => parseRecipe(block)).not.toThrow());
  });

  test('stays compact', () => {
    expect(reference.length).toBeLessThan(16 * 1024);
  });
});
