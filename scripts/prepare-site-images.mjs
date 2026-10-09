// Writes display-sized WebP derivatives for the homepage's logos and screenshots.
// Sources stay untouched in src/assets; components import from src/assets/optimized.
// Run with `npm run prepare:images` after replacing a source image.
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const outDir = 'src/assets/optimized';

// [source, output name, longest edge in px (null keeps full size), encoding]
// Edges are ~3x the largest CSS display size so high-DPR screens stay sharp:
// nav cat <=132px, ledger logos 44px, featured logos <=260px tall, RIT 62px, KORE 112px wide.
const images = [
  ['src/assets/chi-the-cat.png', 'chi-the-cat', 400, 'lossless'],
  ['src/assets/logos/kore-logo.png', 'kore-logo', 336, 'lossless'],
  ['src/assets/logos/rit-logo.png', 'rit-logo', 192, 'lossless'],
  ['src/assets/logos/flipper-logo.png', 'flipper-logo', 780, 'lossy'],
  ['src/assets/logos/gitprofilelens-logo.png', 'gitprofilelens-logo', 780, 'lossy'],
  ['src/assets/logos/scribekit-logo.png', 'scribekit-logo', 780, 'lossy'],
  ['src/assets/logos/dashpilot-logo.png', 'dashpilot-logo', 780, 'lossy'],
  ['src/assets/logos/hymical-forms-logo.png', 'hymical-forms-logo', 132, 'lossless'],
  ['src/assets/logos/business-data-automation-logo.png', 'business-data-automation-logo', 132, 'lossless'],
  ['src/assets/logos/repo-radar-logo.png', 'repo-radar-logo', 132, 'lossless'],
  ['src/assets/logos/chessed-logo.png', 'chessed-logo', 132, 'lossless'],
  ['src/assets/logos/casenotes-logo.png', 'casenotes-logo', 132, 'lossless'],
  ['src/assets/logos/inboxsweep-logo.png', 'inboxsweep-logo', 132, 'lossless'],
  ['src/assets/logos/585photo585-logo.png', '585photo585-logo', 132, 'lossless'],
  ['src/assets/logos/salonflow-logo.png', 'salonflow-logo', 132, 'lossless'],
  // Opened full size in the image viewer, so it keeps every pixel.
  ['src/assets/585dashcam585/585dashcam585-storefront.png', '585dashcam585-storefront', null, 'lossless'],
];

const encodings = {
  lossless: { lossless: true, effort: 6 },
  lossy: { quality: 90, alphaQuality: 100, smartSubsample: true, effort: 6 },
};

await mkdir(outDir, { recursive: true });
for (const [source, name, edge, encoding] of images) {
  let pipeline = sharp(source);
  if (edge) pipeline = pipeline.resize(edge, edge, { fit: 'inside', withoutEnlargement: true });
  const output = path.join(outDir, `${name}.webp`);
  const { width, height, size } = await pipeline.webp(encodings[encoding]).toFile(output);
  console.log(`${output}  ${width}x${height}  ${(size / 1024).toFixed(1)} KB`);
}
