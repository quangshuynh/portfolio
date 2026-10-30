import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { parseEditDocument } from '../model/editDocument.mjs';
import { TEXT_FONTS } from '../model/overlays.mjs';
import { TEXT_FACES, fontString, loadTextFonts } from './fonts.mjs';

const fixture = (name) => readFileSync(join(process.cwd(), 'src/editor/model/fixtures', name), 'utf8');
const textLayers = (name) => parseEditDocument(fixture(name)).photos.flatMap(({ adjustments }) => adjustments.layers.filter(({ type }) => type === 'text'));

afterEach(() => vi.unstubAllGlobals());

// WebKit draws a variable face on a canvas at its default weight: every weight a text layer can
// use must come from its own static face, never a weight range.
test('every weight and style a text layer can use has a static face in each subset', () => {
  expect(TEXT_FACES.every(({ weight }) => /^\d+$/.test(weight))).toBe(true);
  expect(TEXT_FACES.some(({ url }) => /wght|variable/.test(url))).toBe(false);
  for (const font of TEXT_FONTS) {
    const styles = font.italic ? ['normal', 'italic'] : ['normal'];
    for (const weight of font.weights) {
      for (const style of styles) {
        const faces = TEXT_FACES.filter((face) => face.font === font.id && face.weight === String(weight) && face.style === style);
        expect(faces.length, `${font.id} ${weight} ${style}`).toBeGreaterThanOrEqual(2);
        expect(new Set(faces.map(({ url }) => url)).size).toBe(faces.length);
      }
    }
  }
});

test('saved documents keep their text weights, styles and canvas fonts', () => {
  const layers = [...textLayers('edits-v7.json'), ...textLayers('edits-v9.json')];
  expect(layers.length).toBeGreaterThan(0);
  const bold = layers.find(({ font, weight }) => font === 'sans' && weight === 700);
  expect(fontString(bold, 40)).toBe(`${bold.italic ? 'italic ' : ''}700 40px "PE Schibsted Grotesk", sans-serif`);
  const italic = layers.find(({ italic }) => italic);
  expect(italic).toMatchObject({ italic: true });
  expect(fontString(italic, 12)).toMatch(/^italic (400|700) 12px "PE /);
  for (const layer of layers) {
    expect(TEXT_FACES.some((face) => face.weight === String(layer.weight) && face.style === (layer.italic ? 'italic' : 'normal'))).toBe(true);
  }
});

test('the loader registers each static face with its own weight and subset', async () => {
  const added = [];
  vi.stubGlobal('FontFace', class {
    constructor(family, source, descriptors) { Object.assign(this, { family, source, descriptors }); }
    load() { return Promise.resolve(this); }
  });
  await expect(loadTextFonts({ add: (face) => added.push(face) })).resolves.toBe(true);
  expect(added).toHaveLength(TEXT_FACES.length);
  const bold = added.filter(({ family, descriptors }) => family === 'PE Schibsted Grotesk' && descriptors.weight === '700');
  expect(bold.map(({ descriptors }) => descriptors.style).sort()).toEqual(['italic', 'italic', 'normal', 'normal']);
});
