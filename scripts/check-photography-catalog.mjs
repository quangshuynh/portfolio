// npm run check:photography [-- --write]
// Validates the photography catalog against its schema, its canonical formatting, the
// generated manifest and the derivative files. Orphaned derivatives (files no record
// uses) are reported but are not an error. --write rewrites the catalog in canonical form.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assetReport, serializeCatalog } from './photography-catalog.mjs';
import { catalogPath, listDerivatives, projectRoot, readCatalog, readGeneratedManifest } from './photography-catalog-files.mjs';

const file = catalogPath();
const relative = path.relative(projectRoot, file);

try {
  const catalog = await readCatalog(file);
  const canonical = serializeCatalog(catalog);
  // Git may check the file out with CRLF line endings on Windows; content is what matters.
  const formatted = (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') === canonical;
  if (!formatted && process.argv.includes('--write')) {
    await writeFile(file, canonical, 'utf8');
    console.log(`Rewrote ${relative} in canonical form.`);
  }
  const { errors, orphans } = assetReport(catalog, await readGeneratedManifest(), await listDerivatives());
  if (!formatted && !process.argv.includes('--write')) {
    errors.push(`${relative} is not in canonical form; run npm run check:photography -- --write.`);
  }
  const published = catalog.photographs.filter(({ status }) => status === 'published').length;
  console.log(`${relative}: ${published} published, ${catalog.photographs.length - published} draft.`);
  if (orphans.length) console.log(`Orphaned derivatives (shipped, unused; not an error):\n${orphans.map((name) => `  ${name}`).join('\n')}`);
  if (errors.length) {
    console.error(`Problems:\n${errors.map((error) => `  - ${error}`).join('\n')}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
