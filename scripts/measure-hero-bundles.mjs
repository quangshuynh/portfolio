import { readdir, readFile, stat } from 'node:fs/promises';
import { gzipSync, brotliCompressSync } from 'node:zlib';

// Measure emitted files, not the npm package's unpacked size.
const directories = process.argv.slice(2);
if (!directories.length) directories.push('dist');
for (const directory of directories) {
  const chunks = [];
  for (const name of await readdir(`${directory}/assets`)) {
    if (!/\.(js|css)$/.test(name)) continue;
    const bytes = await readFile(`${directory}/assets/${name}`);
    chunks.push({
      name,
      bytes: bytes.length,
      gzip: gzipSync(bytes).length,
      brotli: brotliCompressSync(bytes).length,
    });
  }
  const fallbacks = [];
  for (const name of [
    'desk-desktop.webp',
    'desk-compact.webp',
    'desk-tablet.webp',
    'desk-mobile.webp',
  ]) {
    try {
      fallbacks.push({
        name,
        bytes: (await stat(`${directory}/hero/${name}`)).size,
      });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  console.log(JSON.stringify({ directory, chunks, fallbacks }, null, 2));
}
