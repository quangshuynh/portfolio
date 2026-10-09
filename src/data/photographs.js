import generatedRecords from './photographs.generated.json';
import { EXIF_CAPTURE_TIMEZONE, PHOTOGRAPHY_CATEGORIES, PHOTOGRAPHY_HERO_SLUG, photographOverrides } from './photographs.overrides.mjs';
import { mergePhotographyMetadata } from '../../scripts/photography-utils.mjs';

const derivativeAssets = import.meta.glob('../assets/photography/generated/*.jpg', {
  eager: true,
  query: '?url',
  import: 'default',
});

function resolveDerivative(filename) {
  const asset = derivativeAssets[`../assets/photography/generated/${filename}`];
  if (!asset) throw new Error(`Generated photography derivative not found: ${filename}`);
  return asset;
}

const generatedById = new Map(generatedRecords.map((record) => [record.id, record]));
if (generatedById.size !== generatedRecords.length) throw new Error('Generated photography metadata contains duplicate IDs.');

const records = photographOverrides.map((override) => {
  const generated = generatedById.get(override.id);
  if (!generated) throw new Error(`Generated photography metadata not found for ${override.id}.`);
  if (generated.sourceFilename !== override.sourceFilename) throw new Error(`Source filename mismatch for ${override.id}.`);
  const merged = mergePhotographyMetadata(generated, override);
  if (!PHOTOGRAPHY_CATEGORIES.includes(merged.category)) throw new Error(`Unknown photography category for ${override.id}.`);
  return {
    ...merged,
    gallerySrc: resolveDerivative(generated.galleryFilename),
    viewerSrc: resolveDerivative(generated.viewerFilename),
  };
});

if (records.length !== generatedRecords.length) throw new Error('Generated photography metadata contains undeclared records.');

export { EXIF_CAPTURE_TIMEZONE, PHOTOGRAPHY_CATEGORIES, PHOTOGRAPHY_HERO_SLUG };
export const photographs = Object.freeze(records.map((record) => Object.freeze(record)));

// The editorial selection shown first; every photograph also stays in the full collection.
export const featuredPhotographs = Object.freeze(
  photographs.filter(({ featured }) => featured).sort((a, b) => a.featured - b.featured),
);

export function filterPhotographs(items, category = 'All') {
  return category === 'All' ? [...items] : items.filter((photograph) => photograph.category === category);
}

export function findPhotograph(slug) {
  return photographs.find((photograph) => photograph.slug === slug) ?? null;
}

export function sortPhotographs(items, sort = 'default') {
  const sorted = [...items];
  if (sort === 'default') return sorted.sort((a, b) => a.curatedOrder - b.curatedOrder);

  const direction = sort === 'oldest' ? 1 : -1;
  return sorted.sort((a, b) => {
    const firstTime = a.capturedAt ? Date.parse(a.capturedAt) : Number.NaN;
    const secondTime = b.capturedAt ? Date.parse(b.capturedAt) : Number.NaN;
    const firstHasDate = Number.isFinite(firstTime);
    const secondHasDate = Number.isFinite(secondTime);

    if (firstHasDate && secondHasDate && firstTime !== secondTime) return (firstTime - secondTime) * direction;
    if (firstHasDate !== secondHasDate) return firstHasDate ? -1 : 1;
    return a.curatedOrder - b.curatedOrder;
  });
}
