// @vitest-environment node
import { MAX_DETAIL_HALO, MAX_REGION, covers, extractRect, regionAt, renderRegion, sourceRect } from './detailRegion.mjs';
import { guideSource, renderDetailImage } from './detailRenderer.mjs';
import { renderImage } from './cpuRenderer.mjs';
import { deriveParams } from './spec.mjs';
import { SYNTHETIC_RAW_INFO } from '../dev/hdrFixtures.mjs';

const ALL = { texture: 60, clarity: 40, dehaze: 25, sharpening: 70, luminanceNoise: 35, colorNoise: 50, exposure: 0.2, contrast: 10 };

function rgba(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 11;
  for (let i = 0; i < data.length; i += 4) {
    seed = (seed * 16807) % 2147483647;
    const x = (i / 4) % width;
    const y = Math.floor(i / 4 / width);
    const v = 110 + 60 * Math.sin(x / 6) * Math.cos(y / 9) + (x > width / 2 ? 40 : 0) + (seed / 2147483647 - 0.5) * 30;
    data[i] = v + 20; data[i + 1] = v; data[i + 2] = v - 20;
    data[i + 3] = x < 20 && y < 20 ? 0 : 255;
  }
  return { width, height, data };
}

const raw = (width, height) => {
  const data = new Uint16Array(width * height * 3);
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.sin(i * 0.13) * 0.35 + Math.cos(i * 0.0021) * 0.1 + 0.45) * 65535;
  return { kind: 'raw', width, height, data };
};

/** The region of a whole rendered image. */
const cut = (full, width, region) => extractRect({ width, height: full.length / width / 4, data: full }, region).data;
const keep = (image, region, transparent = false) => ({ source: extractRect(image, sourceRect(region, image)), guideImage: guideSource(image), transparent, native: { width: image.width, height: image.height } });

describe('1:1 regions', () => {
  test('a region is the requested size, capped, and kept inside the image', () => {
    const image = { width: 6000, height: 4000 };
    expect(regionAt({ x: 3000, y: 2000 }, { width: 800, height: 600 }, image)).toEqual({ x: 2600, y: 1700, width: 800, height: 600 });
    expect(regionAt({ x: 10, y: 3990 }, { width: 800, height: 600 }, image)).toEqual({ x: 0, y: 3400, width: 800, height: 600 });
    expect(regionAt({ x: 0, y: 0 }, { width: 9000, height: 9000 }, image)).toMatchObject({ width: MAX_REGION.width, height: MAX_REGION.height });
    expect(regionAt({ x: 50, y: 50 }, { width: 800, height: 600 }, { width: 300, height: 200 })).toEqual({ x: 0, y: 0, width: 300, height: 200 });
  });

  test('the kept crop covers the region with room to pan and the largest halo', () => {
    const image = { width: 6000, height: 4000 };
    const region = { x: 2600, y: 1700, width: 800, height: 600 };
    const source = sourceRect(region, image);
    const kept = { x0: source.x, y0: source.y, width: source.width, height: source.height };
    expect(covers(kept, region, image)).toBe(true);
    expect(covers(kept, { ...region, x: region.x + 400 }, image)).toBe(true);
    expect(covers(kept, { ...region, x: region.x + 401 + MAX_DETAIL_HALO }, image)).toBe(false);
    expect(MAX_DETAIL_HALO).toBeGreaterThan(10);
  });

  test('equals the same pixels of a full-size render, inside and at the image edges', () => {
    const image = rgba(700, 500);
    const full = renderDetailImage(image, deriveParams(ALL));
    for (const region of [{ x: 300, y: 200, width: 120, height: 90 }, { x: 0, y: 0, width: 150, height: 100 }, { x: 600, y: 430, width: 100, height: 70 }]) {
      const { after, before } = renderRegion(keep(image, region, true), region, { adjustments: ALL });
      expect(Buffer.compare(Buffer.from(after), Buffer.from(cut(full, image.width, region)))).toBe(0);
      expect(Buffer.compare(Buffer.from(before), Buffer.from(cut(image.data, image.width, region)))).toBe(0);
    }
  });

  test('equals the full-size render for RAW data, and the before side is the neutral development', () => {
    const image = raw(400, 300);
    const params = deriveParams(ALL, { raw: SYNTHETIC_RAW_INFO });
    const full = renderDetailImage(image, params);
    const region = { x: 150, y: 100, width: 90, height: 70 };
    const { after, before } = renderRegion(keep(image, region), region, { adjustments: ALL, raw: SYNTHETIC_RAW_INFO });
    expect(Buffer.compare(Buffer.from(after), Buffer.from(cut(full, image.width, region)))).toBe(0);
    const neutral = renderImage(image, deriveParams({}, { raw: SYNTHETIC_RAW_INFO }));
    expect(Buffer.compare(Buffer.from(before), Buffer.from(cut(neutral, image.width, region)))).toBe(0);
  });

  test('without Detail it is the per-pixel render of the region', () => {
    const image = rgba(300, 200);
    const region = { x: 40, y: 30, width: 100, height: 80 };
    const { after } = renderRegion(keep(image, region), region, { adjustments: { exposure: 0.5, saturation: 20 } });
    const full = renderImage(image, deriveParams({ exposure: 0.5, saturation: 20 }));
    expect(Buffer.compare(Buffer.from(after), Buffer.from(cut(full, image.width, region)))).toBe(0);
  });
});
