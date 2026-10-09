import generatedRecords from './photographs.generated.json';
import { photographOverrides } from './photographs.overrides.mjs';
import {
  derivativeFilenames,
  mergePhotographyMetadata,
  parseExifTimestamp,
} from '../../scripts/photography-utils.mjs';


test('normalizes explicit and America/New_York capture timestamps', () => {
  expect(
    parseExifTimestamp('2026:07:11 14:54:16', null),
  ).toBe('2026-07-11T18:54:16.000Z');

  expect(
    parseExifTimestamp('2026:01:11 14:54:16', null),
  ).toBe('2026-01-11T19:54:16.000Z');

  expect(
    parseExifTimestamp('2026:04:04 12:56:19', '-04:00'),
  ).toBe('2026-04-04T16:56:19.000Z');

  expect(
    parseExifTimestamp('2026:02:31 12:00:00', null),
  ).toBeNull();

  expect(
    parseExifTimestamp('not-an-exif-date', null),
  ).toBeNull();

  expect(
    parseExifTimestamp('2026:04:04 12:00:00', 'EDT'),
  ).toBeNull();
});


test('manual metadata overrides extracted values and null suppresses a field', () => {
  const merged = mergePhotographyMetadata(
    {
      id: 'IMGP0579',
      camera: 'Extracted camera',
      lens: 'Extracted lens',
      iso: 100,
    },
    {
      id: 'IMGP0579',
      camera: 'Corrected camera',
      lens: null,
    },
  );

  expect(merged).toMatchObject({
    id: 'IMGP0579',
    camera: 'Corrected camera',
    iso: 100,
  });

  expect(merged).not.toHaveProperty('lens');
});


test('derivative names are deterministic and reject unsafe IDs', () => {
  expect(
    derivativeFilenames('_DSC0023'),
  ).toEqual({
    galleryFilename: '_DSC0023-gallery.jpg',
    viewerFilename: '_DSC0023-viewer.jpg',
  });

  expect(
    () => derivativeFilenames('../photo'),
  ).toThrow(/Unsafe photography ID/);
});


test('generated records match declared sources without exposing coordinates', () => {
  expect(generatedRecords).toHaveLength(
    photographOverrides.length,
  );

  expect(
    generatedRecords
      .map(({ id }) => id)
      .sort(),
  ).toEqual(
    photographOverrides
      .map(({ id }) => id)
      .sort(),
  );

  for (const record of generatedRecords) {
    const override = photographOverrides.find(
      ({ id }) => id === record.id,
    );

    expect(override).toBeDefined();

    expect(
      record.sourceFilename,
    ).toBe(
      override.sourceFilename,
    );

    expect(
      record.galleryFilename,
    ).toBe(
      `${record.id}-gallery.jpg`,
    );

    expect(
      record.viewerFilename,
    ).toBe(
      `${record.id}-viewer.jpg`,
    );
  }

  expect(
    JSON.stringify(generatedRecords),
  ).not.toMatch(
    /latitude|longitude|coordinates/i,
  );
});

// Published photographs keep their IDs (and lightbox links) for good; additions are fine.
const PUBLISHED_PHOTOGRAPH_IDS = [
  'EJUT5331', 'IMGP0739', 'fog-parking-lot', 'bridge-lattice', 'shore-curve', 'suzuki-bandit',
  'letchworth-gorge', 'aero-wheel', '_DSC0023', 'neon-window-blue-hour', 'red-sun', 'DIBS2164',
  '_DSC0003', 'afterglow-road', 'waves-on-rocks', 'IMG_0758', 'orange-domes-close',
  'shoreline-gold-dusk', 'bird-in-flight', 'YJMZ4301', 'high-falls-mist', 'impreza-fence',
  'IMG_0931', '_DSC0033', 'downtown-rochester-dusk', 'streaked-sky', 'IMGP0579', 'impreza-grass',
  'DSC00266', 'PBTM8581', 'NTIO3912', 'sundown-streaked-clouds', 'TERM5977', 'harbor-golden-hour',
  'IMG_0776', 'IMG_0858', 'beach-cloud-bank', 'IMG_0845', 'IMG_0811', 'IMG_0846',
  'sun-between-trunks', 'mill-wheel', 'taughannock-falls',
];


test('every published photograph is still declared exactly once', () => {
  const ids = photographOverrides.map(({ id }) => id);

  for (const id of PUBLISHED_PHOTOGRAPH_IDS) {
    expect(ids.filter((declared) => declared === id)).toHaveLength(1);
  }
});
