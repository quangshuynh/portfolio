import React, { useMemo, useRef, useState } from 'react';
import {
  MAX_RECIPE_BYTES, RECIPE_GROUPS, RecipeError, changedRecipeGroups, parseRecipe, recipeChanges, recipeFileName,
  recipeFromAdjustments, recipeGroupLabel, recipeGroups, recipeResources, serializeRecipe,
} from '../model/recipes.mjs';
import { recipeReference } from '../model/recipeReference.mjs';
import { planRecipe } from '../model/sync.mjs';
import Dialog from './Dialog';
import PhotoThumb from './PhotoThumb';
import { PlanList } from './BatchDialog';

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** Copies text; without Clipboard API access, selects it in `field` so the visitor can copy it. */
export async function writeClipboard(text, field = null) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    field?.focus();
    field?.select();
    return false;
  }
}

const MODE_NOTES = {
  replace: 'Each ticked group is set exactly as the recipe says; settings it leaves out of that group return to neutral.',
  merge: 'Only the settings the recipe states change; everything else of each photo stays.',
};

function CopySettings({ adjustments, onSave, onDownload, onClose }) {
  const available = useMemo(() => {
    const changed = changedRecipeGroups(adjustments);
    return RECIPE_GROUPS.filter(({ id }) => (id === 'filter' || id === 'lut' ? changed.includes(id) : true)).map(({ id }) => id);
  }, [adjustments]);
  const [groups, setGroups] = useState(available);
  const [name, setName] = useState('My recipe');
  const [description, setDescription] = useState('');
  const [message, setMessage] = useState(null);
  const field = useRef(null);
  const built = useMemo(() => {
    try {
      const recipe = recipeFromAdjustments(adjustments, { groups, name, description });
      return { recipe, text: serializeRecipe(recipe) };
    } catch (error) {
      return { error: error instanceof RecipeError ? error.message : 'These settings could not be copied.' };
    }
  }, [adjustments, groups, name, description]);
  const copy = async () => {
    const ok = await writeClipboard(built.text, field.current);
    setMessage(ok ? { tone: 'info', text: 'Copied the recipe JSON.' } : { tone: 'info', text: 'The clipboard is not available here: the JSON is selected, press Ctrl+C (⌘C) to copy it.' });
  };
  return (
    <Dialog
      title="Copy settings"
      onClose={onClose}
      className="pe-dialog--recipe"
      footer={(
        <>
          <span className="pe-note pe-dialog__summary" role="status">{built.error ?? message?.text ?? `${plural(recipeGroups(built.recipe).length, 'group')}, ${built.text.length.toLocaleString()} characters.`}</span>
          <button type="button" className="pe-button" disabled={!built.recipe} onClick={() => { onSave(built.recipe); setMessage({ tone: 'info', text: `Saved ${built.recipe.name} to your recipes.` }); }}>Save as recipe</button>
          <button type="button" className="pe-button" disabled={!built.recipe} onClick={() => onDownload(new Blob([built.text], { type: 'application/json' }), recipeFileName(built.recipe))}>Export JSON</button>
          <button type="button" className="pe-button pe-button--primary" disabled={!built.recipe} onClick={copy}>Copy JSON</button>
        </>
      )}
    >
      <p className="pe-note">A QuangEdit Recipe of this photo&apos;s reusable settings. Crop, layers, text, masks, RAW and HDR settings stay with the photo.</p>
      <div className="pe-recipe__fields">
        <label className="pe-field"><span>Name</span><input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} /></label>
        <label className="pe-field"><span>Description (optional)</span><input value={description} maxLength={280} onChange={(event) => setDescription(event.target.value)} /></label>
      </div>
      <fieldset className="pe-group pe-batch-groups pe-recipe__groups">
        <legend>Include</legend>
        <span className="pe-recipe__quick">
          <button type="button" className="pe-text-button" onClick={() => setGroups(available)}>All</button>
          <button type="button" className="pe-text-button" onClick={() => setGroups([])}>None</button>
        </span>
        {RECIPE_GROUPS.map(({ id, label }) => (
          <label key={id}>
            <input type="checkbox" disabled={!available.includes(id)} checked={groups.includes(id)} onChange={(event) => setGroups(event.target.checked ? [...groups, id] : groups.filter((g) => g !== id))} />
            {label}{!available.includes(id) && <span className="pe-note"> ({id === 'lut' ? 'no LUT' : 'no unchanged built-in filter'})</span>}
          </label>
        ))}
      </fieldset>
      <textarea ref={field} className="pe-recipe__json mono" readOnly value={built.text ?? ''} aria-label="Recipe JSON" rows={10} spellCheck={false} />
      {message?.tone === 'error' && <p className="pe-note pe-note--error" role="alert">{message.text}</p>}
    </Dialog>
  );
}

function RecipeReview({ initial, targets, luts, thumbnailOf, lutFor, onLoadLut, onApply, onSave, onClose }) {
  // A saved recipe that no longer validates is shown as text with its errors, never thrown.
  const [text, setText] = useState(() => {
    if (!initial) return '';
    try { return serializeRecipe(initial); } catch { return JSON.stringify(initial, null, 2); }
  });
  const [excluded, setExcluded] = useState([]);
  const [mode, setMode] = useState('replace');
  const [message, setMessage] = useState(null);
  const fileRef = useRef(null);
  const cubeRef = useRef(null);
  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    try {
      return { recipe: parseRecipe(text) };
    } catch (error) {
      return { errors: error instanceof RecipeError ? error.errors : ['The recipe could not be read.'] };
    }
  }, [text]);
  const recipe = parsed?.recipe ?? null;
  const present = recipe ? recipeGroups(recipe) : [];
  const groups = present.filter((id) => !excluded.includes(id));
  const lutOf = (sha256) => luts.find((lut) => lut.sha256 === sha256) ?? null;
  const missing = recipe ? recipeResources(recipe, { hasLut: (sha256) => Boolean(lutOf(sha256)) }).lut : null;
  const plan = useMemo(() => (recipe ? planRecipe(recipe, targets, { groups, mode, lutOf }) : null), [recipe, targets, groups.join(), mode, luts]); // eslint-disable-line react-hooks/exhaustive-deps
  const single = targets.length === 1 && plan?.items[0];
  const photo = targets[0];
  const thumbnail = single ? thumbnailOf(photo.id) : null;
  const changes = single ? recipeChanges(single.before, single.after) : [];
  const blocked = !plan || plan.errors.length > 0 || plan.changedCount === 0;

  const pasteClipboard = async () => {
    try {
      const value = await navigator.clipboard.readText();
      if (!value.trim()) { setMessage({ tone: 'error', text: 'The clipboard is empty.' }); return; }
      setText(value.slice(0, MAX_RECIPE_BYTES + 1));
      setExcluded([]);
      setMessage(null);
    } catch {
      setMessage({ tone: 'error', text: 'This browser did not allow reading the clipboard. Paste into the box with Ctrl+V (⌘V).' });
    }
  };
  const openFile = async (file) => {
    if (file.size > MAX_RECIPE_BYTES) { setMessage({ tone: 'error', text: `The file is larger than ${MAX_RECIPE_BYTES / 1024} KB.` }); return; }
    setText(await file.text());
    setExcluded([]);
    setMessage(null);
  };
  const reimport = async (file) => {
    try {
      const lut = await onLoadLut(file);
      setMessage(lut.sha256 === recipe.lut.sha256
        ? { tone: 'info', text: `Loaded ${lut.title || lut.name}; it matches the recipe.` }
        : { tone: 'error', text: `${file.name} is a different LUT (its SHA-256 does not match the recipe), so it is not used.` });
    } catch (error) {
      setMessage({ tone: 'error', text: error.message });
    }
  };

  return (
    <Dialog
      title={targets.length > 1 ? `Paste settings to ${targets.length} photos` : 'Paste settings'}
      onClose={onClose}
      className="pe-dialog--recipe"
      footer={(
        <>
          <span className="pe-note pe-dialog__summary" role="status">
            {!recipe ? 'Paste or open a recipe to review it.' : plan.errors[0] ?? (plan.changedCount ? `Changes ${plan.changedCount} of ${plural(plan.items.length, 'photo')}.` : 'Nothing would change.')}
          </span>
          {recipe && <button type="button" className="pe-button" onClick={() => { onSave(recipe); setMessage({ tone: 'info', text: `Saved ${recipe.name} to your recipes.` }); }}>Save as recipe</button>}
          <button type="button" className="pe-button" onClick={onClose}>Cancel</button>
          <button type="button" className="pe-button pe-button--primary" disabled={blocked} onClick={() => onApply(plan, recipe)}>Apply{targets.length > 1 ? ` to ${plan?.changedCount ?? 0}` : ''}</button>
        </>
      )}
    >
      <details className="pe-recipe__source" open={!initial}>
        <summary>Recipe JSON</summary>
        <textarea
          className="pe-recipe__json mono"
          value={text}
          rows={8}
          spellCheck={false}
          aria-label="Recipe JSON"
          aria-invalid={Boolean(parsed?.errors) || undefined}
          aria-describedby="pe-recipe-errors"
          placeholder='{ "format": "quangedit-recipe", "version": 1, "name": "…", "adjustments": { … } }'
          onChange={(event) => { setText(event.target.value); setExcluded([]); }}
        />
        <span className="pe-presets__actions">
          <button type="button" className="pe-button" onClick={pasteClipboard}>Paste from clipboard</button>
          <button type="button" className="pe-text-button" onClick={() => fileRef.current?.click()}>Open .json file…</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden aria-label="Open recipe file" onChange={(event) => { const [file] = event.target.files; event.target.value = ''; if (file) openFile(file); }} />
        </span>
      </details>

      {parsed?.errors && (
        <div id="pe-recipe-errors" className="pe-recipe__errors" role="alert">
          <p className="pe-note pe-note--error">The recipe was not applied: {plural(parsed.errors.length, 'problem')}.</p>
          <ul>{parsed.errors.map((error) => <li key={error} className="mono">{error}</li>)}</ul>
        </div>
      )}

      {recipe && (
        <>
          <div className="pe-recipe__summary">
            <h3>{recipe.name}</h3>
            {recipe.description && <p className="pe-note">{recipe.description}</p>}
          </div>
          <fieldset className="pe-group pe-batch-groups pe-recipe__groups">
            <legend>Apply these groups</legend>
            {present.map((id) => (
              <label key={id}>
                <input type="checkbox" checked={!excluded.includes(id)} onChange={(event) => setExcluded(event.target.checked ? excluded.filter((g) => g !== id) : [...excluded, id])} />
                {recipeGroupLabel(id)}
                {id === 'filter' && <span className="pe-note"> {recipe.filter.id}, {recipe.filter.strength}%</span>}
                {id === 'lut' && <span className="pe-note"> {recipe.lut.title || recipe.lut.name}, {recipe.lut.intensity}%{missing ? ' (not loaded)' : ''}</span>}
              </label>
            ))}
          </fieldset>
          {missing && !excluded.includes('lut') && (
            <div className="pe-recipe__missing" role="group" aria-label="Missing LUT">
              <p className="pe-note pe-note--error">The LUT “{missing.title || missing.name}” is not loaded. Import that .cube file again (it must have the SHA-256 <span className="mono">{missing.sha256.slice(0, 12)}…</span>), or untick LUT.</p>
              <button type="button" className="pe-button" onClick={() => cubeRef.current?.click()}>Import {missing.name}…</button>
              <input ref={cubeRef} type="file" accept=".cube" hidden aria-label="Import the recipe's LUT" onChange={(event) => { const [file] = event.target.files; event.target.value = ''; if (file) reimport(file); }} />
            </div>
          )}
          <fieldset className="pe-group pe-recipe__mode">
            <legend>Mode</legend>
            <div className="pe-segmented pe-segmented--two">
              {[['replace', 'Replace groups'], ['merge', 'Merge settings']].map(([value, label]) => (
                <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}>{label}</button>
              ))}
            </div>
            <p className="pe-note">{MODE_NOTES[mode]} Crop, layers, text, masks, RAW and HDR settings are never changed.</p>
          </fieldset>

          {single ? (
            <>
              {thumbnail && (
                <div className="pe-recipe__compare" aria-label="Before and after preview">
                  <figure><PhotoThumb thumbnail={thumbnail} adjustments={single.before} lut={lutFor(single.before)} raw={photo.raw} photoWidth={photo.width} /><figcaption>Before</figcaption></figure>
                  <figure><PhotoThumb thumbnail={thumbnail} adjustments={single.after} lut={lutFor(single.after)} raw={photo.raw} photoWidth={photo.width} /><figcaption>After</figcaption></figure>
                </div>
              )}
              {changes.length ? (
                <table className="pe-recipe__changes">
                  <caption className="visually-hidden">Settings that change</caption>
                  <thead><tr><th scope="col">Setting</th><th scope="col">Now</th><th scope="col">After</th></tr></thead>
                  <tbody>{changes.map(({ group, label, from, to }) => <tr key={`${group}:${label}`}><th scope="row">{label}</th><td>{from}</td><td>{to}</td></tr>)}</tbody>
                </table>
              ) : <p className="pe-note">These settings are already the photo&apos;s.</p>}
              <p className="pe-note">The preview does not show Detail, which needs the full image; the photo itself will.</p>
            </>
          ) : <PlanList plan={plan} targets={targets} thumbnailOf={thumbnailOf} lutFor={lutFor} />}
        </>
      )}
      {message && <p className={`pe-note${message.tone === 'error' ? ' pe-note--error' : ''}`} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</p>}
    </Dialog>
  );
}

function RecipeInstructions({ onClose }) {
  const text = useMemo(recipeReference, []);
  const field = useRef(null);
  const [message, setMessage] = useState(null);
  const copy = async () => {
    const ok = await writeClipboard(text, field.current);
    setMessage(ok ? 'Copied the recipe instructions.' : 'The clipboard is not available here: the text is selected, press Ctrl+C (⌘C) to copy it.');
  };
  return (
    <Dialog
      title="Recipe instructions"
      onClose={onClose}
      className="pe-dialog--recipe"
      footer={(
        <>
          <span className="pe-note pe-dialog__summary" role="status">{message ?? `${text.length.toLocaleString()} characters, generated from this editor's controls and filters.`}</span>
          <button type="button" className="pe-button pe-button--primary" onClick={copy}>Copy instructions</button>
        </>
      )}
    >
      <p className="pe-note">Give these to an assistant with your photo and ask, for example: “Recommend natural edits and output only a valid QuangEdit Recipe JSON object.” Then paste its answer with Paste settings and review it before applying.</p>
      <textarea ref={field} className="pe-recipe__json mono" readOnly value={text} rows={14} aria-label="Recipe instructions" spellCheck={false} />
    </Dialog>
  );
}

/**
 * QuangEdit Recipes: Copy settings (mode 'copy'), review and apply a pasted, opened or saved recipe
 * on the targets (mode 'apply'), and the authoring instructions (mode 'instructions').
 * Nothing changes until Apply; Cancel leaves every photo as it was.
 * :param props: mode, adjustments (copy: the active photo's), recipe (apply: a saved one, optional),
 *   targets (ready photos), luts (loaded), thumbnailOf(id), lutFor(settings), onLoadLut(file) => lut,
 *   onApply(plan, recipe), onSave(recipe), onDownload(blob, name), onClose
 */
export default function RecipeDialog({ mode, adjustments, recipe = null, ...props }) {
  if (mode === 'copy') return <CopySettings adjustments={adjustments} {...props} />;
  if (mode === 'instructions') return <RecipeInstructions onClose={props.onClose} />;
  return <RecipeReview initial={recipe} {...props} />;
}
