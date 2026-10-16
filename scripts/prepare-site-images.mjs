// Writes display-sized WebP derivatives for the homepage's logos and screenshots.
// Components read them from src/assets/optimized.
// Run with `npm run prepare:images` after replacing a source image or bumping a
// project's pinned commit in src/data/githubAssets.mjs.
//
// Project logos are derived from the commit-pinned GitHub originals recorded as
// `logo.source` in src/data/projects.mjs, so the project repository stays the
// single source of truth (this step needs network access; the build does not).
// Private projects and non-project images use the local sources listed below.
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { projects } from '../src/data/projects.mjs';

const outDir = 'src/assets/optimized';

// Edges are ~3x the largest CSS display size so high-DPR screens stay sharp:
// nav cat <=132px, ledger logos 44px, featured logos <=260px tall, RIT 62px, KORE 112px wide.
const FEATURED_LOGO_EDGE = 780;
const LEDGER_LOGO_EDGE = 132;

// [source, output name, longest edge in px (null keeps full size), encoding]
const localImages = [
  ['src/assets/chi-the-cat.png', 'chi-the-cat', 400, 'lossless'],
  ['src/assets/logos/kore-logo.png', 'kore-logo', 336, 'lossless'],
  ['src/assets/logos/rit-logo.png', 'rit-logo', 192, 'lossless'],
  ['src/assets/logos/585photo585-logo.png', '585photo585-logo', LEDGER_LOGO_EDGE, 'lossless'],
  // Opened full size in the image viewer, so these keep every pixel.
  ['src/assets/585dashcam585/585dashcam585-storefront.png', '585dashcam585-storefront', null, 'lossless'],
  ['src/assets/585photo585-portfolio.png', '585photo585-portfolio', null, 'lossless'],
];

const projectLogos = projects
  .filter((project) => project.logo?.source)
  .map((project) => [
    project.logo.source,
    project.logo.file,
    project.featured ? FEATURED_LOGO_EDGE : LEDGER_LOGO_EDGE,
    project.featured ? 'lossy' : 'lossless',
    { trim: project.logo.trim },
  ]);

const encodings = {
  lossless: { lossless: true, effort: 6 },
  lossy: { quality: 90, alphaQuality: 100, smartSubsample: true, effort: 6 },
};

async function readSource(source) {
  if (!/^https:/.test(source)) return source;
  const response = await fetch(source);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${source}`);
  return Buffer.from(await response.arrayBuffer());
}

await mkdir(outDir, { recursive: true });
for (const [source, name, edge, encoding, options = {}] of [...localImages, ...projectLogos]) {
  let pipeline = sharp(await readSource(source));
  // Trim transparent padding so a small mark fills its 44px ledger slot.
  if (options.trim) pipeline = pipeline.trim();
  if (edge) pipeline = pipeline.resize(edge, edge, { fit: 'inside', withoutEnlargement: true });
  const output = path.join(outDir, `${name}.webp`);
  const { width, height, size } = await pipeline.webp(encodings[encoding]).toFile(output);
  console.log(`${output}  ${width}x${height}  ${(size / 1024).toFixed(1)} KB`);
}
