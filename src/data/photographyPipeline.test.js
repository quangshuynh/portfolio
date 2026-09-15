import generatedRecords from './photographs.generated.json';
import { photographOverrides } from './photographs.overrides.mjs';
import {
  derivativeFilenames,
  mergePhotographyMetadata,
  parseExifTimestamp,
} from '../../scripts/photography-utils.mjs';

test('normalizes explicit and America/New_York capture timestamps', () => {
  expect(parseExifTimestamp('2026:07:11 14:54:16', null)).toBe('2026-07-11T18:54:16.000Z');
  expect(parseExifTimestamp('2026:01:11 14:54:16', null)).toBe('2026-01-11T19:54:16.000Z');
  expect(parseExifTimestamp('2026:04:04 12:56:19', '-04:00')).toBe('2026-04-04T16:56:19.000Z');
  expect(parseExifTimestamp('2026:02:31 12:00:00', null)).toBeNull();
  expect(parseExifTimestamp('not-an-exif-date', null)).toBeNull();
  expect(parseExifTimestamp('2026:04:04 12:00:00', 'EDT')).toBeNull();
});

test('manual metadata overrides extracted values and null explicitly suppresses a field', () => {
  const merged = mergePhotographyMetadata(
    { id: 'IMGP0579', camera: 'Extracted camera', lens: 'Extracted lens', iso: 100 },
    { id: 'IMGP0579', camera: 'Corrected camera', lens: null },
  );
  expect(merged).toMatchObject({ id: 'IMGP0579', camera: 'Corrected camera', iso: 100 });
  expect(merged).not.toHaveProperty('lens');
});

test('derivative names are deterministic and reject unsafe IDs', () => {
  expect(derivativeFilenames('_DSC0023')).toEqual({
    galleryFilename: '_DSC0023-gallery.jpg',
    viewerFilename: '_DSC0023-viewer.jpg',
  });
  expect(() => derivativeFilenames('../photo')).toThrow(/Unsafe photography ID/);
});

test('generated records match every declared source without exposing exact coordinates', () => {
  expect(generatedRecords).toHaveLength(photographOverrides.length);
  expect(generatedRecords.map(({ id }) => id)).toEqual(photographOverrides.map(({ id }) => id));
  for (const [index, record] of generatedRecords.entries()) {
    expect(record.sourceFilename).toBe(photographOverrides[index].sourceFilename);
    expect(record.galleryFilename).toBe(`${record.id}-gallery.jpg`);
    expect(record.viewerFilename).toBe(`${record.id}-viewer.jpg`);
  }
  expect(JSON.stringify(generatedRecords)).not.toMatch(/latitude|longitude|coordinates/i);
});
