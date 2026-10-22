// Serves `virtual:photography-catalog` to the app: the public view of the catalog (and of
// photographs.generated.json), computed at build time. The catalog file itself is never
// imported by browser code, so draft records and their metadata cannot reach the bundle.
import { assetReport, CatalogError } from './photography-catalog.mjs';
import {
  GENERATED_MANIFEST_PATH,
  catalogPath,
  listDerivatives,
  loadPublicCollection,
  readCatalog,
  readGeneratedManifest,
} from './photography-catalog-files.mjs';

const VIRTUAL_ID = 'virtual:photography-catalog';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

export { RESOLVED_ID as PHOTOGRAPHY_CATALOG_MODULE_ID };

/**
 * :param options.loadPreview: CMS preview only (never the site build): returns the
 *   collection to show instead of the repository's, with `assetUrls` mapping derivative
 *   file names that are not in the repository to URLs on the local CMS server.
 */
export default function photographyCatalogPlugin({ loadPreview } = {}) {
  return {
    name: 'photography-catalog',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    async load(id) {
      if (id !== RESOLVED_ID) return null;
      if (loadPreview) return `export default ${JSON.stringify(await loadPreview())};`;
      this.addWatchFile(catalogPath());
      this.addWatchFile(GENERATED_MANIFEST_PATH);
      // Every derivative in the folder ships (import.meta.glob), so a draft's derivative
      // or manifest entry would leak: fail the build instead.
      const { errors } = assetReport(await readCatalog(), await readGeneratedManifest(), await listDerivatives());
      if (errors.length) throw new CatalogError(errors);
      const { captureTimeZone, categories, heroSlug, photographs, generated } = await loadPublicCollection();
      return `export default ${JSON.stringify({ captureTimeZone, categories, heroSlug, photographs, generated })};`;
    },
  };
}
