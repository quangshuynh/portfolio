// Route entry for /photography/editor. Lazily loaded, so the editor's code and
// workers never reach the gallery or homepage bundles.
export { default } from '../../editor/ui/EditorApp';
