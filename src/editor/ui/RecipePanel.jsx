import React, { useRef, useState } from 'react';
import { cleanPresetName, uniquePresetName } from '../model/presets.mjs';
import { MAX_RECIPES, RecipeError, readRecipeImport, recipeFileName, recipeGroupLabel, recipeGroups, recipeLibraryFileName, serializeRecipe, serializeRecipeLibrary } from '../model/recipes.mjs';

// The library's id is this browser's handle, not part of the recipe.
const withoutId = ({ id, ...recipe }) => recipe;

/**
 * QuangEdit Recipes: Copy and Paste settings, the authoring instructions, and the visitor's saved
 * recipes (kept in this browser). Applying a saved recipe opens the review dialog first. Unlike
 * presets (one click, replace only), recipes are portable JSON, reviewed before they apply.
 * :param recipes: [{ id, ...recipe }]
 * :param onChange: (nextRecipes) => void, persists them
 * :param onOpen: (mode, recipe?) => void opens RecipeDialog ('copy' | 'apply' | 'instructions')
 */
export default function RecipePanel({ recipes = [], disabled, onChange, onOpen, onDownload, newId }) {
  const [renaming, setRenaming] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [message, setMessage] = useState(null);
  const importRef = useRef(null);
  const names = (except = null) => recipes.filter(({ id }) => id !== except);

  const rename = (event, recipe) => {
    event.preventDefault();
    const name = cleanPresetName(renaming.name);
    if (!name) { setMessage({ tone: 'error', text: 'Give the recipe a name.' }); return; }
    onChange(recipes.map((item) => (item.id === recipe.id ? { ...item, name: uniquePresetName(name, names(recipe.id)) } : item)));
    setRenaming(null);
  };
  const duplicate = (recipe) => {
    if (recipes.length >= MAX_RECIPES) { setMessage({ tone: 'error', text: `You can keep up to ${MAX_RECIPES} recipes.` }); return; }
    const index = recipes.indexOf(recipe);
    const copy = { ...recipe, id: newId(), name: uniquePresetName(recipe.name, recipes) };
    onChange([...recipes.slice(0, index + 1), copy, ...recipes.slice(index + 1)]);
    setMessage({ tone: 'info', text: `Duplicated as ${copy.name}.` });
  };
  const remove = (recipe) => {
    if (confirmDelete !== recipe.id) { setConfirmDelete(recipe.id); return; }
    onChange(recipes.filter(({ id }) => id !== recipe.id));
    setConfirmDelete(null);
    setMessage({ tone: 'info', text: `Deleted ${recipe.name}.` });
  };
  const exportOne = (saved) => onDownload(new Blob([serializeRecipe(withoutId(saved))], { type: 'application/json' }), recipeFileName(saved));
  // Every recipe, without this browser's ids: for another editor (another browser, or the CMS
  // editor, whose storage is separate from the public editor's).
  const exportAll = () => onDownload(new Blob([serializeRecipeLibrary(recipes.map(withoutId))], { type: 'application/json' }), recipeLibraryFileName());
  const importFile = async (file) => {
    try {
      const incoming = await readRecipeImport(file);
      if (recipes.length + incoming.length > MAX_RECIPES) throw new RecipeError(`You can keep up to ${MAX_RECIPES} recipes.`);
      const added = [];
      for (const recipe of incoming) added.push({ ...recipe, id: newId(), name: uniquePresetName(recipe.name, [...recipes, ...added]) });
      onChange([...recipes, ...added]);
      setMessage({ tone: 'info', text: added.length === 1 ? `Imported ${added[0].name}. Choose it to review and apply it.` : `Imported ${added.length} recipes. Choose one to review and apply it.` });
    } catch (error) {
      const errors = error instanceof RecipeError ? error.errors : ['The recipe file could not be read.'];
      setMessage({ tone: 'error', text: errors.length > 1 ? `${errors[0]} (and ${errors.length - 1} more; open it with Paste settings to see all)` : errors[0] });
    }
  };

  return (
    <div className="pe-presets pe-recipes">
      <p className="pe-note">Recipes are portable JSON settings you can copy, share, or have an assistant write. Each is reviewed before it applies. Crop, layers, masks, RAW and HDR settings stay with each photo.</p>
      <div className="pe-presets__actions">
        <button type="button" className="pe-button" disabled={disabled} onClick={() => onOpen('copy')}>Copy settings…</button>
        <button type="button" className="pe-button" disabled={disabled} onClick={() => onOpen('apply')}>Paste settings…</button>
        <button type="button" className="pe-text-button" onClick={() => onOpen('instructions')}>Recipe instructions</button>
      </div>
      <h4 className="pe-presets__title">Saved recipes</h4>
      {recipes.length ? (
        <ul className="pe-presets__list">
          {recipes.map((recipe) => (
            <li key={recipe.id} className="pe-preset">
              {renaming?.id === recipe.id ? (
                <form className="pe-preset__rename" onSubmit={(event) => rename(event, recipe)}>
                  <input aria-label={`New name for ${recipe.name}`} value={renaming.name} maxLength={60} autoFocus onChange={(event) => setRenaming({ ...renaming, name: event.target.value })} onKeyDown={(event) => event.key === 'Escape' && setRenaming(null)} />
                  <button type="submit" className="pe-text-button">Save</button>
                  <button type="button" className="pe-text-button" onClick={() => setRenaming(null)}>Cancel</button>
                </form>
              ) : (
                <>
                  <button type="button" className="pe-preset__apply" disabled={disabled} title={recipe.description || `Contains: ${recipeGroups(recipe).map(recipeGroupLabel).join(', ')}`} aria-label={`Review and apply ${recipe.name}`} onClick={() => onOpen('apply', withoutId(recipe))}>
                    {recipe.name}
                  </button>
                  <span className="pe-preset__actions">
                    <button type="button" className="pe-text-button" onClick={() => { setRenaming({ id: recipe.id, name: recipe.name }); setConfirmDelete(null); }} aria-label={`Rename ${recipe.name}`}>Rename</button>
                    <button type="button" className="pe-text-button" onClick={() => duplicate(recipe)} aria-label={`Duplicate ${recipe.name}`}>Duplicate</button>
                    <button type="button" className="pe-text-button" onClick={() => exportOne(recipe)} aria-label={`Export ${recipe.name}`}>Export</button>
                    <button type="button" className="pe-text-button" data-danger={confirmDelete === recipe.id || undefined} onClick={() => remove(recipe)} onBlur={() => setConfirmDelete(null)} aria-label={confirmDelete === recipe.id ? `Confirm deleting ${recipe.name}` : `Delete ${recipe.name}`}>
                      {confirmDelete === recipe.id ? 'Confirm' : 'Delete'}
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="pe-note">None yet. Save one from Copy settings or Paste settings; recipes are kept in this browser only.</p>}
      <p className="pe-note">Recipes stay in this browser and this editor. To use them elsewhere (the CMS editor keeps its own library), Export all here and Import recipes there.</p>
      <div className="pe-presets__actions">
        <button type="button" className="pe-text-button" onClick={() => importRef.current?.click()}>Import recipes…</button>
        <button type="button" className="pe-text-button" disabled={!recipes.length} onClick={exportAll}>Export all…</button>
        <input ref={importRef} type="file" accept="application/json,.json" hidden aria-label="Import recipe" onChange={(event) => { const [file] = event.target.files; event.target.value = ''; if (file) importFile(file); }} />
      </div>
      {message && <p className={`pe-note${message.tone === 'error' ? ' pe-note--error' : ''}`} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</p>}
    </div>
  );
}
