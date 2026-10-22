// Serves `virtual:photography-catalog` to the app: the public view of the catalog (and of
// photographs.generated.json), computed at build time. The catalog file itself is never
// imported by browser code, so draft records and their metadata cannot reach the bundle.
import { GENERATED_MANIFEST_PATH, catalogPath, loadPublicCollection } from './photography-catalog-files.mjs';

const VIRTUAL_ID = 'virtual:photography-catalog';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

export default function photographyCatalogPlugin() {
  return {
    name: 'photography-catalog',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    async load(id) {
      if (id !== RESOLVED_ID) return null;
      this.addWatchFile(catalogPath());
      this.addWatchFile(GENERATED_MANIFEST_PATH);
      const { captureTimeZone, categories, heroSlug, photographs, generated } = await loadPublicCollection();
      return `export default ${JSON.stringify({ captureTimeZone, categories, heroSlug, photographs, generated })};`;
    },
  };
}
