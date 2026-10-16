// Reads the WebP derivatives in src/assets/optimized for validateProjects():
// their names (does each referenced file exist?) and sizes (does projects.mjs
// record the size the browser will actually get?). Local files only.
import { readdirSync } from 'node:fs';
import sharp from 'sharp';

export const OPTIMIZED_DIR = 'src/assets/optimized';

/**
 * lists derivative names and their pixel sizes
 * :param dir: directory holding the .webp derivatives
 * :returns: { optimizedFiles: Set<name>, derivativeSizes: Map<name, { width, height }> }
 */
export async function readDerivatives(dir = OPTIMIZED_DIR) {
  const names = readdirSync(dir).filter((file) => file.endsWith('.webp')).map((file) => file.replace(/\.webp$/, ''));
  const sizes = await Promise.all(names.map(async (name) => {
    const { width, height } = await sharp(`${dir}/${name}.webp`).metadata();
    return [name, { width, height }];
  }));
  return { optimizedFiles: new Set(names), derivativeSizes: new Map(sizes) };
}
