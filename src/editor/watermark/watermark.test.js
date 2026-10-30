import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  AUTO_THRESHOLD, DESIGN, MARK_ASPECT, WATERMARK_DEFAULTS, WATERMARK_LIMITS, WatermarkConfigError, layoutWatermark, lineWidth, normalizeWatermark,
  parseWatermarkConfig, placementReport, regionLuminance, resolveWatermarkColor, sampleBox, serializeWatermarkConfig, watermarkActive,
  watermarkOverrides, watermarksEqual,
} from './watermark.mjs';
import { applyWatermark, drawMark } from './watermarkRender.mjs';
import { compactAdjustments, isNeutral, neutralAdjustments, normalizeAdjustments } from '../model/adjustments.mjs';
import { DOCUMENT_VERSION, createEditDocument, normalizeExportSettings, parseEditDocument, serializeEditDocument } from '../model/editDocument.mjs';
import { apply, createHistory, redo, undo } from '../model/history.mjs';
import { planSync } from '../model/sync.mjs';
import { applyRecipe, recipeFromAdjustments, serializeRecipe, validateRecipe } from '../model/recipes.mjs';
import { exportGeometry } from '../io/files.mjs';

const on = (patch = {}) => normalizeWatermark({ ...WATERMARK_DEFAULTS, ...patch });
const inside = (layout, width, height) => layout.x >= 0 && layout.y >= 0 && layout.x + layout.width <= width && layout.y + layout.height <= height;
const solid = (width, height, rgba) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width, height, data };
};

describe('settings', () => {
  test('defaults are the approved HUYNH preset, and photos start without a watermark', () => {
    expect(WATERMARK_DEFAULTS).toMatchObject({ preset: 'huynh-photography', position: 'bottom-right', size: 0.11, opacity: 0.65, color: 'white', margin: 0.025, border: true, rules: true, outline: true });
    expect(neutralAdjustments().watermark).toBeNull();
    expect(normalizeAdjustments({}).watermark).toBeNull();
    expect(watermarkActive(null)).toBe(false);
    expect(watermarkActive(on())).toBe(true);
    expect(watermarkActive(on({ enabled: false }))).toBe(false);
  });

  test('untrusted values are clamped or refused, never trusted', () => {
    expect(normalizeWatermark('HUYNH')).toBeNull();
    expect(normalizeWatermark([1])).toBeNull();
    expect(normalizeWatermark({ preset: 'someone-else' })).toBeNull();
    const wild = normalizeWatermark({ enabled: 'yes', position: 'middle', size: 1e9, opacity: -4, color: '#ff0000', margin: Number.NaN, border: 0, rules: 'no', text: 'NOT HUYNH', logo: 'http://x' });
    expect(wild).toEqual({ enabled: false, preset: 'huynh-photography', position: 'bottom-right', size: WATERMARK_LIMITS.size[1], opacity: WATERMARK_LIMITS.opacity[0], color: 'white', margin: 0.025, border: true, rules: true, outline: false });
    expect(Object.keys(wild)).not.toContain('text');
  });

  test('equality and overrides against a base', () => {
    expect(watermarksEqual(on(), on())).toBe(true);
    expect(watermarksEqual(on(), on({ opacity: 0.5 }))).toBe(false);
    expect(watermarksEqual(null, null)).toBe(true);
    expect(watermarksEqual(null, on())).toBe(false);
    expect(watermarkOverrides(on({ position: 'top-left', color: 'auto', enabled: false }), on())).toEqual(['position', 'color']);
  });

  test('portable configuration file: round trip and refusals', () => {
    const text = serializeWatermarkConfig(on({ position: 'top-left', enabled: false }), 'Night set');
    const parsed = parseWatermarkConfig(text);
    expect(parsed.name).toBe('Night set');
    expect(parsed.settings).toEqual(on({ position: 'top-left' }));
    expect(() => parseWatermarkConfig('{')).toThrow(WatermarkConfigError);
    expect(() => parseWatermarkConfig(JSON.stringify({ type: 'quanghuynh.watermark', version: 2, settings: {} }))).toThrow(/version 2/);
    expect(() => parseWatermarkConfig(JSON.stringify({ type: 'quangedit-recipe', version: 1 }))).toThrow(/not a watermark file/);
    expect(() => parseWatermarkConfig(JSON.stringify({ type: 'quanghuynh.watermark', version: 1, settings: { preset: 'other' } }))).toThrow(/preset/);
    expect(() => parseWatermarkConfig(`{"type":"quanghuynh.watermark","version":1,"settings":{},"pad":"${'x'.repeat(20000)}"}`)).toThrow(/16 KB/);
  });

  test('edit documents (version 11 and later) keep the watermark; older documents read without one', () => {
    const photo = { name: 'a.jpg', size: 10, lastModified: 0, sha256: 'a'.repeat(64), format: 'jpeg', width: 600, height: 400, adjustments: normalizeAdjustments({ exposure: 0.5, watermark: on({ position: 'top-left' }) }) };
    const text = serializeEditDocument(createEditDocument([photo], {}));
    expect(DOCUMENT_VERSION).toBeGreaterThanOrEqual(11);
    const parsed = parseEditDocument(text);
    expect(parsed.photos[0].adjustments.watermark).toEqual(on({ position: 'top-left' }));
    const v10 = JSON.stringify({ type: 'quanghuynh.photo-editor.edits', version: 10, photos: [{ source: { name: 'a.jpg', size: 3 }, adjustments: { exposure: 1 } }] });
    expect(parseEditDocument(v10).photos[0].adjustments.watermark).toBeNull();
    expect(compactAdjustments(normalizeAdjustments({})).watermark).toBeUndefined();
    expect(compactAdjustments(photo.adjustments).watermark).toEqual(on({ position: 'top-left' }));
    expect(isNeutral(normalizeAdjustments({ watermark: on() }))).toBe(false);
  });

  test('export settings: the watermark is included unless switched off for that export', () => {
    expect(normalizeExportSettings({}).includeWatermark).toBe(true);
    expect(normalizeExportSettings({ includeWatermark: false }).includeWatermark).toBe(false);
    expect(normalizeExportSettings({ includeWatermark: 'no' }).includeWatermark).toBe(true);
  });

  test('undo and redo restore watermark changes', () => {
    const start = normalizeAdjustments({});
    let history = createHistory(start);
    history = apply(history, normalizeAdjustments({ watermark: on() }));
    history = apply(history, normalizeAdjustments({ watermark: on({ position: 'center' }) }));
    expect(history.present.watermark.position).toBe('center');
    history = undo(history);
    expect(history.present.watermark.position).toBe('bottom-right');
    history = undo(history);
    expect(history.present.watermark).toBeNull();
    history = redo(history);
    expect(history.present.watermark).toEqual(on());
  });

  test('recipes never carry the watermark, and applying one keeps the target\'s', () => {
    const source = normalizeAdjustments({ exposure: 0.7, watermark: on({ color: 'dark' }) });
    const recipe = recipeFromAdjustments(source);
    expect(serializeRecipe(recipe)).not.toMatch(/watermark|HUYNH/i);
    expect(() => validateRecipe(JSON.parse(serializeRecipe(recipe)))).not.toThrow();
    expect(() => validateRecipe({ ...JSON.parse(serializeRecipe(recipe)), watermark: { enabled: true } })).toThrow();
    const target = normalizeAdjustments({ watermark: on({ position: 'top-left' }) });
    expect(applyRecipe(target, recipe).watermark).toEqual(on({ position: 'top-left' }));
  });

  test('sync copies the watermark only when its group is ticked', () => {
    const source = normalizeAdjustments({ exposure: 1, watermark: on({ position: 'top-right' }) });
    const target = { id: 't', name: 't.jpg', status: 'ready', width: 400, height: 600, history: { present: normalizeAdjustments({}) } };
    expect(planSync(source, [target]).items[0].after.watermark).toBeNull();
    expect(planSync(source, [target], { groups: ['watermark'] }).items[0].after.watermark).toEqual(on({ position: 'top-right' }));
  });
});

describe('layout', () => {
  test('a 6000 × 4000 landscape: about 11% of the width, bottom right, equal margins, whole pixels', () => {
    const layout = layoutWatermark(on(), 6000, 4000);
    expect(layout.width).toBeGreaterThan(655);
    expect(layout.width).toBeLessThan(665);
    const margin = 0.025 * Math.sqrt(6000 * 4000);
    expect(6000 - layout.x - layout.width).toBeCloseTo(margin, -1);
    expect(4000 - layout.y - layout.height).toBeCloseTo(margin, -1);
    [layout.x, layout.y, layout.width, layout.height, layout.stroke].forEach((value) => expect(Number.isInteger(value)).toBe(true));
    expect(layout.width / layout.height).toBeCloseTo(MARK_ASPECT, 1);
  });

  test('the same share of the picture area on portrait, square and panorama frames', () => {
    const share = (width, height) => {
      const layout = layoutWatermark(on(), width, height);
      expect(inside(layout, width, height)).toBe(true);
      return (layout.width * layout.height) / (width * height);
    };
    const landscape = share(6000, 4000);
    expect(share(4000, 6000)).toBeCloseTo(landscape, 3);
    expect(share(4000, 4000)).toBeCloseTo(landscape, 3);
    expect(share(12000, 3000)).toBeCloseTo(landscape, 3);
  });

  test('extreme frames: never wider than half the frame or taller than 30%', () => {
    for (const [width, height] of [[20000, 1200], [1200, 20000], [400, 300]]) {
      const layout = layoutWatermark(on({ size: 0.3 }), width, height);
      expect(layout.width).toBeLessThanOrEqual(Math.ceil(width * WATERMARK_LIMITS.maxWidth));
      expect(layout.height).toBeLessThanOrEqual(Math.ceil(height * WATERMARK_LIMITS.maxHeight) + 1);
      expect(inside(layout, width, height)).toBe(true);
    }
  });

  test('reduced exports keep proportions; very small ones keep the web address legible', () => {
    const full = layoutWatermark(on(), 6000, 4000, { snap: false });
    const half = layoutWatermark(on(), 3000, 2000, { snap: false });
    expect(half.width).toBeCloseTo(full.width / 2, 6);
    expect(half.x).toBeCloseTo(full.x / 2, 6);
    const small = layoutWatermark(on({ size: 0.04 }), 900, 600);
    expect(small.width).toBeGreaterThanOrEqual(WATERMARK_LIMITS.minWidthPx);
    expect(small.lines[2].px).toBeGreaterThan(7);
  });

  test('the preview scale draws the export layout at another resolution', () => {
    const exported = layoutWatermark(on(), 2400, 1600, { snap: false });
    const preview = layoutWatermark(on(), 2400, 1600, { snap: false, scale: 0.37 });
    expect(preview.x).toBeCloseTo(exported.x * 0.37, 6);
    expect(preview.lines[0].baseline).toBeCloseTo(exported.lines[0].baseline * 0.37, 6);
    // Snapped at each resolution: within a pixel of the exact layout.
    const snapped = layoutWatermark(on(), 2400, 1600, { scale: 0.37 });
    expect(Math.abs(snapped.x - preview.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(snapped.width - preview.width)).toBeLessThanOrEqual(0.5);
  });

  test('every position stays inside the frame; centre is centred', () => {
    for (const position of ['bottom-right', 'bottom-left', 'top-right', 'top-left', 'center']) {
      expect(inside(layoutWatermark(on({ position, margin: 0.15 }), 3000, 2000), 3000, 2000)).toBe(true);
    }
    const centre = layoutWatermark(on({ position: 'center' }), 3001, 2001, { snap: false });
    expect(centre.x + centre.width / 2).toBeCloseTo(1500.5, 6);
    expect(centre.y + centre.height / 2).toBeCloseTo(1000.5, 6);
  });

  test('crop and rotation: the mark follows the final output frame', () => {
    const native = { width: 6000, height: 4000 };
    const geometry = { ...normalizeAdjustments({}).geometry, quarterTurns: 1, crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 } };
    const { output } = exportGeometry(normalizeAdjustments({ geometry }).geometry, native, { mode: 'original' });
    const layout = layoutWatermark(on(), output.width, output.height);
    expect(inside(layout, output.width, output.height)).toBe(true);
    expect(output.width - layout.x - layout.width).toBe(output.height - layout.y - layout.height);
  });

  test('typography: lines centred, in order, inside the border; rules symmetric and as thick as the border', () => {
    const layout = layoutWatermark(on(), 6000, 4000, { snap: false });
    const centre = layout.x + layout.width / 2;
    layout.lines.forEach((line, i) => {
      const width = lineWidth(DESIGN.lines[i]) * layout.s;
      expect(line.x + width / 2).toBeCloseTo(centre, 6);
      expect(line.x).toBeGreaterThan(layout.x + layout.stroke);
      expect(line.x + width).toBeLessThan(layout.x + layout.width - layout.stroke);
      const advance = line.advances.reduce((a, b) => a + b, 0) + line.tracking * (line.advances.length - 1);
      expect(advance).toBeCloseTo(width, 6);
    });
    const [name, title, site] = layout.lines;
    expect(name.baseline).toBeLessThan(title.baseline);
    expect(title.baseline).toBeLessThan(site.baseline);
    expect(name.baseline - name.px * DESIGN.capHeight).toBeCloseTo(layout.y + DESIGN.padding.top * layout.s, 6);
    expect(site.baseline + site.px * DESIGN.descender).toBeLessThan(layout.y + layout.height - layout.stroke);
    expect(title.px).toBeLessThan(name.px * 0.3);
    expect(title.tracking / title.px).toBeGreaterThan(name.tracking / name.px);
    const [left, right] = layout.rules;
    expect(left.width).toBeCloseTo(right.width, 6);
    expect(left.height).toBe(layout.stroke);
    expect(centre - (left.x + left.width / 2)).toBeCloseTo(right.x + right.width / 2 - centre, 6);
    expect(left.x).toBeCloseTo(name.x, 0);
    expect(layoutWatermark(on({ rules: false }), 6000, 4000).rules).toEqual([]);
  });
});

describe('colour', () => {
  test('auto reads the luminance behind the mark', () => {
    expect(regionLuminance(solid(10, 10, [255, 255, 255, 255])).mean).toBeCloseTo(1, 6);
    expect(regionLuminance(solid(10, 10, [0, 0, 0, 255])).mean).toBe(0);
    expect(regionLuminance(solid(10, 10, [255, 255, 255, 0])).mean).toBe(0);
    expect(resolveWatermarkColor(on({ color: 'auto' }), 0.9)).toBe('dark');
    expect(resolveWatermarkColor(on({ color: 'auto' }), 0.05)).toBe('white');
    expect(resolveWatermarkColor(on({ color: 'auto' }), AUTO_THRESHOLD)).toBe('white');
    expect(resolveWatermarkColor(on({ color: 'dark' }), 0)).toBe('dark');
    expect(resolveWatermarkColor(on({ color: 'white' }), 1)).toBe('white');
  });

  test('only the region behind the mark decides', () => {
    const image = solid(600, 400, [0, 0, 0, 255]);
    const layout = layoutWatermark(on(), 600, 400);
    const box = sampleBox(layout);
    for (let y = Math.floor(box.y); y < box.y + box.height; y += 1) {
      for (let x = Math.floor(box.x); x < box.x + box.width; x += 1) image.data.set([250, 250, 250, 255], (y * 600 + x) * 4);
    }
    expect(regionLuminance(image, box).mean).toBeGreaterThan(0.9);
    expect(regionLuminance(image).mean).toBeLessThan(0.2);
  });

  test('placement heuristic flags a busy corner and suggests a calmer one', () => {
    const image = solid(600, 400, [90, 110, 130, 255]);
    for (let y = 250; y < 400; y += 1) for (let x = 380; x < 600; x += 1) if ((x + y) % 4 < 2) image.data.set([255, 255, 255, 255], (y * 600 + x) * 4);
    const report = placementReport(image, on());
    expect(report.flags).toContain('busy');
    expect(report.suggestion).not.toBe('bottom-right');
    expect(placementReport(image, on({ position: 'top-left' })).flags).toEqual([]);
  });
});

describe('drawing', () => {
  afterEach(() => vi.restoreAllMocks());

  const recorder = () => {
    const calls = [];
    const context = new Proxy({ calls }, {
      get(target, key) {
        if (key in target) return target[key];
        return (...args) => { calls.push([key, ...args]); return { data: new Uint8ClampedArray(4 * (args[2] ?? 1) * (args[3] ?? 1)).fill(255), width: args[2], height: args[3] }; };
      },
      set(target, key, value) { calls.push([`=${String(key)}`, value]); return true; },
    });
    return context;
  };

  test('border, rules and every letter, placed from the fixed advances', () => {
    const layout = layoutWatermark(on({ outline: false }), 6000, 4000);
    const context = recorder();
    drawMark(context, layout, '#ffffff');
    const rects = context.calls.filter(([name]) => name === 'fillRect');
    const letters = context.calls.filter(([name]) => name === 'fillText');
    expect(rects).toHaveLength(4 + 2);
    expect(letters.map(([, char]) => char).join('')).toBe('HUYNHPHOTOGRAPHYquanghuynh.com');
    const huynh = letters.slice(0, 5).map(([, , x]) => x);
    expect(huynh[1] - huynh[0]).toBeCloseTo(layout.lines[0].advances[0] + layout.lines[0].tracking, 6);
    const none = recorder();
    drawMark(none, layoutWatermark(on({ border: false, rules: false, outline: false }), 6000, 4000), '#ffffff');
    expect(none.calls.filter(([name]) => name === 'fillRect')).toHaveLength(0);
  });

  test('the outline: the other colour behind every stroke and letter, then the mark at full strength', () => {
    const layout = layoutWatermark(on(), 6000, 4000);
    expect(layout.halo).toBe(Math.max(1, Math.round(DESIGN.outline.width * layout.s)));
    expect(layout.bounds).toEqual({ x: layout.x - layout.halo, y: layout.y - layout.halo, width: layout.width + 2 * layout.halo, height: layout.height + 2 * layout.halo });
    // Never thinner than one output pixel, even for the smallest mark.
    expect(layoutWatermark(on({ size: 0.04 }), 600, 400).halo).toBeGreaterThanOrEqual(1);
    for (const [color, outline] of [[DESIGN.colors.white, DESIGN.colors.dark], [DESIGN.colors.dark, DESIGN.colors.white]]) {
      const context = recorder();
      drawMark(context, layout, color);
      const fills = context.calls.filter(([name]) => name === '=fillStyle').map(([, value]) => value);
      expect(fills).toEqual([outline, color]);
      const strokes = context.calls.filter(([name]) => name === 'strokeText');
      expect(strokes.map(([, char]) => char).join('')).toBe('HUYNHPHOTOGRAPHYquanghuynh.com');
      expect(context.calls).toContainEqual(['=lineWidth', 2 * layout.halo]);
      expect(context.calls).toContainEqual(['=globalAlpha', DESIGN.outline.alpha]);
      // Outline rectangles first (grown by the halo), then the mark's own, then its letters.
      const rects = context.calls.filter(([name]) => name === 'fillRect');
      expect(rects).toHaveLength(2 * (4 + 2));
      expect(rects[0].slice(1)).toEqual([layout.x - layout.halo, layout.y - layout.halo, layout.width + 2 * layout.halo, layout.stroke + 2 * layout.halo]);
      const lastStroke = context.calls.lastIndexOf(strokes.at(-1));
      expect(context.calls.findIndex(([name]) => name === 'fillText')).toBeGreaterThan(lastStroke);
    }
    // Marks saved before the outline existed keep drawing without one.
    const saved = normalizeWatermark({ enabled: true, preset: 'huynh-photography', position: 'top-right', color: 'auto' });
    expect(saved.outline).toBe(false);
    expect(layoutWatermark(saved, 6000, 4000).halo).toBe(0);
    const plain = recorder();
    drawMark(plain, layoutWatermark(saved, 6000, 4000), '#ffffff');
    expect(plain.calls.some(([name]) => name === 'strokeText')).toBe(false);
  });

  test('applyWatermark composites one sprite at the opacity, reading pixels only for auto', () => {
    const sprites = [];
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const sprite = { tag, width: 0, height: 0, context: recorder(), getContext() { return this.context; } };
      sprites.push(sprite);
      return sprite;
    });
    const target = recorder();
    const result = applyWatermark(target, on({ opacity: 0.4 }), { width: 3000, height: 2000 });
    expect(sprites[0]).toBeDefined();
    expect(result.variant).toBe('white');
    expect(result.luminance).toBeNull();
    expect(target.calls.some(([name]) => name === 'getImageData')).toBe(false);
    expect(target.calls).toContainEqual(['=globalAlpha', 0.4]);
    const draw = target.calls.find(([name]) => name === 'drawImage');
    // The sprite covers the box and its outline.
    expect(draw.slice(2)).toEqual([result.layout.bounds.x, result.layout.bounds.y]);
    expect(result.layout.bounds.x).toBe(result.layout.x - result.layout.halo);
    expect(sprites[0].width).toBe(0);

    const auto = recorder();
    const picked = applyWatermark(auto, on({ color: 'auto' }), { width: 3000, height: 2000 });
    const read = auto.calls.find(([name]) => name === 'getImageData');
    expect(read[3] * read[4]).toBeLessThan(3000 * 2000 * 0.05);
    expect(picked.variant).toBe('dark');
    expect(picked.luminance).toBeCloseTo(1, 3);
  });
});
