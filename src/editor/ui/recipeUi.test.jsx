import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import RecipeDialog from './RecipeDialog';
import RecipePanel from './RecipePanel';
import BatchPanel from './BatchPanel';
import { createHistory } from '../model/history.mjs';
import { normalizeAdjustments } from '../model/adjustments.mjs';
import { RECIPE_FORMAT, parseRecipe } from '../model/recipes.mjs';
import editorCss from './editor.css?raw';

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((type) => (type === '2d' ? { putImageData: () => {} } : null));
  if (typeof ImageData === 'undefined') vi.stubGlobal('ImageData', class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } });
});


const photo = (id, values = {}, extra = {}) => ({
  id, name: `${id}.jpg`, status: 'ready', width: 600, height: 400, format: 'jpeg', exportStatus: { state: 'idle' }, history: createHistory(normalizeAdjustments(values)), ...extra,
});
const thumb = { width: 4, height: 3, data: new Uint8ClampedArray(48).fill(128) };
const LUT = { sha256: 'b'.repeat(64), name: 'night.cube', title: 'Night', size: 17 };
const recipeText = (fields = {}) => JSON.stringify({ format: RECIPE_FORMAT, version: 1, name: 'Soft Night', description: 'Cool and calm.', adjustments: { light: { contrast: 12 }, color: { vibrance: 10 } }, ...fields });
const common = { luts: [], thumbnailOf: () => thumb, lutFor: () => null, onLoadLut: vi.fn(), onSave: vi.fn(), onDownload: vi.fn(), onClose: vi.fn() };
const pasteInto = (dialog, text) => fireEvent.change(within(dialog).getByRole('textbox', { name: 'Recipe JSON' }), { target: { value: text } });

function mockClipboard(overrides = {}) {
  const clipboard = { writeText: vi.fn(() => Promise.resolve()), readText: vi.fn(() => Promise.resolve('')), ...overrides };
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
  return clipboard;
}

describe('Copy settings', () => {
  const adjustments = normalizeAdjustments({ contrast: 20, vibrance: 30, geometry: { quarterTurns: 1 }, grainSeed: 7, lut: LUT, lutIntensity: 50 });

  test('copies canonical recipe JSON of the chosen groups to the clipboard', async () => {
    const clipboard = mockClipboard();
    render(<RecipeDialog {...common} mode="copy" adjustments={adjustments} />);
    const dialog = screen.getByRole('dialog', { name: 'Copy settings' });
    const json = within(dialog).getByRole('textbox', { name: 'Recipe JSON' });
    const recipe = parseRecipe(json.value);
    expect(recipe.adjustments.light).toEqual({ contrast: 20 });
    expect(recipe.lut).toMatchObject({ sha256: LUT.sha256, intensity: 50 });
    expect(json.value).not.toMatch(/geometry|grainSeed|quarterTurns/);
    expect(within(dialog).getByRole('checkbox', { name: /Filter/ })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'None' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Color' }));
    expect(parseRecipe(json.value).adjustments).toEqual({ color: { vibrance: 30 } });
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Copy JSON' })));
    expect(clipboard.writeText).toHaveBeenCalledWith(json.value);
    expect(within(dialog).getByText('Copied the recipe JSON.')).toBeInTheDocument();
  });

  test('falls back to selecting the JSON when the clipboard is refused', async () => {
    mockClipboard({ writeText: vi.fn(() => Promise.reject(new Error('denied'))) });
    render(<RecipeDialog {...common} mode="copy" adjustments={adjustments} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy JSON' })));
    expect(screen.getByText(/the JSON is selected, press Ctrl\+C/)).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Recipe JSON' }));
  });

  test('saves and exports the recipe; nothing selected is an error, not a recipe', () => {
    const onSave = vi.fn();
    const onDownload = vi.fn();
    render(<RecipeDialog {...common} onSave={onSave} onDownload={onDownload} mode="copy" adjustments={adjustments} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Evening' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as recipe' }));
    expect(onSave.mock.calls[0][0].name).toBe('Evening');
    fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
    expect(onDownload.mock.calls[0][1]).toBe('evening.quangedit-recipe.json');
    fireEvent.click(screen.getByRole('button', { name: 'None' }));
    expect(screen.getByRole('button', { name: 'Copy JSON' })).toBeDisabled();
    expect(screen.getByText(/contains no settings/)).toBeInTheDocument();
  });
});

describe('Paste settings', () => {
  test('validates before anything else and lists every problem by field', () => {
    const onApply = vi.fn();
    render(<RecipeDialog {...common} mode="apply" targets={[photo('a')]} onApply={onApply} />);
    const dialog = screen.getByRole('dialog', { name: 'Paste settings' });
    expect(within(dialog).getByRole('button', { name: 'Apply' })).toBeDisabled();
    pasteInto(dialog, '{ not json');
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/not valid JSON/);
    pasteInto(dialog, recipeText({ adjustments: { light: { contrast: 400, sparkle: 1 } } }));
    const alert = within(dialog).getByRole('alert');
    expect(alert).toHaveTextContent('2 problems');
    expect(alert).toHaveTextContent('adjustments.light.contrast must be between -100 and 100 (got 400).');
    expect(alert).toHaveTextContent('Unknown field adjustments.light.sparkle.');
    expect(within(dialog).getByRole('textbox', { name: 'Recipe JSON' })).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(onApply).not.toHaveBeenCalled();
  });

  test('shows the summary, the settings that change and a before/after preview; Apply sends the plan', () => {
    const onApply = vi.fn();
    const target = photo('a', { contrast: 40, highlights: -20, saturation: 5, geometry: { quarterTurns: 1 } });
    render(<RecipeDialog {...common} mode="apply" targets={[target]} onApply={onApply} />);
    const dialog = screen.getByRole('dialog', { name: 'Paste settings' });
    pasteInto(dialog, recipeText());
    expect(within(dialog).getByRole('heading', { name: 'Soft Night' })).toBeInTheDocument();
    expect(within(dialog).getByText('Cool and calm.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Before and after preview').querySelectorAll('canvas')).toHaveLength(2);
    const rows = within(within(dialog).getByRole('table')).getAllByRole('row').slice(1).map((row) => row.textContent);
    expect(rows).toEqual(['Contrast+40+12', 'Highlights-200', 'Vibrance0+10', 'Saturation+50']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Merge settings' }));
    expect(within(within(dialog).getByRole('table')).getAllByRole('row').slice(1).map((row) => row.textContent)).toEqual(['Contrast+40+12', 'Vibrance0+10']);
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Color' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    const [plan, recipe] = onApply.mock.calls[0];
    expect(recipe.name).toBe('Soft Night');
    expect(plan.items[0].after).toMatchObject({ contrast: 12, highlights: -20, vibrance: 0, saturation: 5 });
    expect(plan.items[0].after.geometry.quarterTurns).toBe(1);
  });

  test('Cancel and Escape close without applying', () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(<RecipeDialog {...common} mode="apply" targets={[photo('a')]} onApply={onApply} onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    pasteInto(dialog, recipeText());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onApply).not.toHaveBeenCalled();
  });

  test('reads the clipboard and .json files; refuses an oversized file before reading it', async () => {
    mockClipboard({ readText: vi.fn(() => Promise.resolve(recipeText({ name: 'From clipboard' }))) });
    render(<RecipeDialog {...common} mode="apply" targets={[photo('a')]} onApply={vi.fn()} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Paste from clipboard' })));
    expect(screen.getByRole('heading', { name: 'From clipboard' })).toBeInTheDocument();
    const input = screen.getByLabelText('Open recipe file');
    const file = new File([recipeText({ name: 'From file' })], 'r.json', { type: 'application/json' });
    await act(async () => fireEvent.change(input, { target: { files: [file] } }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'From file' })).toBeInTheDocument());
    const big = new File(['x'], 'big.json');
    Object.defineProperty(big, 'size', { value: 1024 * 1024 });
    big.text = vi.fn();
    await act(async () => fireEvent.change(input, { target: { files: [big] } }));
    expect(big.text).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/larger than 64 KB/);
  });

  test('a missing LUT blocks Apply, offers reimport and refuses a file with another hash', async () => {
    const onLoadLut = vi.fn(() => Promise.resolve({ ...LUT, sha256: 'c'.repeat(64), name: 'other.cube' }));
    const props = { ...common, mode: 'apply', targets: [photo('a')], onApply: vi.fn(), onLoadLut };
    const { rerender } = render(<RecipeDialog {...props} />);
    pasteInto(screen.getByRole('dialog'), recipeText({ lut: { name: 'night.cube', sha256: LUT.sha256, intensity: 70 } }));
    expect(screen.getByRole('group', { name: 'Missing LUT' })).toHaveTextContent('“night.cube” is not loaded');
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    const cube = new File(['LUT_3D_SIZE 2'], 'other.cube');
    await act(async () => fireEvent.change(screen.getByLabelText("Import the recipe's LUT"), { target: { files: [cube] } }));
    expect(screen.getByRole('alert')).toHaveTextContent(/different LUT/);
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    // Unticking the LUT applies the rest.
    fireEvent.click(screen.getByRole('checkbox', { name: /LUT/ }));
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /LUT/ }));
    // With the right file loaded, the LUT applies.
    rerender(<RecipeDialog {...props} luts={[LUT]} />);
    expect(screen.queryByRole('group', { name: 'Missing LUT' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(props.onApply.mock.calls[0][0].items[0].after).toMatchObject({ lut: { sha256: LUT.sha256 }, lutIntensity: 70 });
  });

  test('several photos: one plan with per-photo changes and thumbnails', () => {
    const onApply = vi.fn();
    render(<RecipeDialog {...common} mode="apply" targets={[photo('a', { contrast: 12, vibrance: 10 }), photo('b'), photo('c')]} onApply={onApply} />);
    const dialog = screen.getByRole('dialog', { name: 'Paste settings to 3 photos' });
    pasteInto(dialog, recipeText());
    expect(within(dialog).getAllByText(/Changes Light, Color/)).toHaveLength(2);
    expect(within(dialog).getByText('No change')).toBeInTheDocument();
    expect(dialog.querySelectorAll('.pe-batch-plan__thumbs canvas')).toHaveLength(6);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply to 2' }));
    expect(onApply.mock.calls[0][0].changedCount).toBe(2);
  });

  test('a saved recipe opens straight to its review', () => {
    render(<RecipeDialog {...common} mode="apply" recipe={parseRecipe(recipeText())} targets={[photo('a')]} onApply={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Soft Night' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
  });

  test('recipe text is shown as text, never as markup', () => {
    render(<RecipeDialog {...common} mode="apply" targets={[photo('a')]} onApply={vi.fn()} />);
    pasteInto(screen.getByRole('dialog'), recipeText({ name: '<img src=x onerror=alert(1)>', description: '<b>bold</b>' }));
    expect(document.querySelector('.pe-dialog img, .pe-dialog b')).toBeNull();
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('<img src=x onerror=alert(1)>');
  });
});

describe('Recipe instructions', () => {
  test('copies the generated reference', async () => {
    const clipboard = mockClipboard();
    render(<RecipeDialog {...common} mode="instructions" />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy instructions' })));
    expect(clipboard.writeText.mock.calls[0][0]).toMatch(/^# QuangEdit Recipe v1/);
    expect(clipboard.writeText.mock.calls[0][0]).toContain('filter:classic-ccd');
  });
});

describe('RecipePanel', () => {
  const saved = [{ id: 'r1', ...parseRecipe(recipeText()) }];
  const props = { recipes: saved, onChange: vi.fn(), onOpen: vi.fn(), onDownload: vi.fn(), newId: () => 'new' };

  test('opens Copy, Paste and Instructions, and reviews a saved recipe before applying', () => {
    render(<RecipePanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy settings…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Paste settings…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Recipe instructions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review and apply Soft Night' }));
    expect(props.onOpen.mock.calls.map(([mode]) => mode)).toEqual(['copy', 'apply', 'instructions', 'apply']);
    expect(props.onOpen.mock.calls[3][1].name).toBe('Soft Night');
    // The saved recipe opens as a recipe: the library id is not a recipe field.
    expect(props.onOpen.mock.calls[3][1]).not.toHaveProperty('id');
    render(<RecipeDialog {...common} mode="apply" recipe={props.onOpen.mock.calls[3][1]} targets={[photo('a')]} onApply={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Soft Night', level: 3 })).toBeInTheDocument();
  });

  test('renames, duplicates, exports and deletes (with confirmation)', () => {
    const onChange = vi.fn();
    const onDownload = vi.fn();
    render(<RecipePanel {...props} onChange={onChange} onDownload={onDownload} />);
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Soft Night' }));
    expect(onChange.mock.calls[0][0].map(({ name }) => name)).toEqual(['Soft Night', 'Soft Night (2)']);
    fireEvent.click(screen.getByRole('button', { name: 'Export Soft Night' }));
    expect(onDownload.mock.calls[0][1]).toBe('soft-night.quangedit-recipe.json');
    fireEvent.click(screen.getByRole('button', { name: 'Rename Soft Night' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'New name for Soft Night' }), { target: { value: 'Night 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onChange.mock.calls[1][0][0].name).toBe('Night 2');
    fireEvent.click(screen.getByRole('button', { name: 'Delete Soft Night' }));
    expect(onChange).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deleting Soft Night' }));
    expect(onChange.mock.calls[2][0]).toEqual([]);
  });

  test('imports a recipe file into the library and reports invalid ones', async () => {
    const onChange = vi.fn();
    render(<RecipePanel {...props} recipes={[]} onChange={onChange} />);
    const input = screen.getByLabelText('Import recipe');
    await act(async () => fireEvent.change(input, { target: { files: [new File([recipeText({ name: 'Imported' })], 'a.json')] } }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[0][0][0]).toMatchObject({ id: 'new', name: 'Imported' });
    await act(async () => fireEvent.change(input, { target: { files: [new File([recipeText({ version: 9 })], 'b.json')] } }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/version 9/));
  });
});

test('a whole library moves to another editor by export and import, validated strictly', async () => {
  const saved = [parseRecipe(recipeText({ name: 'Soft Night' })), parseRecipe(recipeText({ name: 'Warm Day', adjustments: { color: { temperature: 20 } } }))].map((recipe, i) => ({ ...recipe, id: `local-${i}` }));
  const onDownload = vi.fn();
  const { unmount } = render(<RecipePanel recipes={saved} disabled={false} onChange={() => {}} onOpen={() => {}} onDownload={onDownload} newId={() => 'new'} />);
  fireEvent.click(screen.getByRole('button', { name: 'Export all…' }));
  const [blob, name] = onDownload.mock.calls[0];
  expect(name).toMatch(/\.quangedit-recipes\.json$/);
  const text = await blob.text();
  const library = JSON.parse(text);
  expect(library).toMatchObject({ format: 'quangedit-recipe-library', version: 1 });
  expect(library.recipes.map(({ name: n }) => n)).toEqual(['Soft Night', 'Warm Day']);
  // Recipes only: no browser ids, photos, file names or edit documents.
  expect(text).not.toMatch(/"id"|local-|"photos"|"source"|sha256/);
  unmount();

  // The other editor (here: one that already has a Soft Night) imports both.
  let ids = 0;
  const onChange = vi.fn();
  render(<RecipePanel recipes={[{ ...saved[0], id: 'cms-0' }]} disabled={false} onChange={onChange} onOpen={() => {}} onDownload={() => {}} newId={() => `cms-${(ids += 1)}`} />);
  const input = screen.getByLabelText('Import recipe');
  await act(async () => fireEvent.change(input, { target: { files: [new File([text], name)] } }));
  await waitFor(() => expect(onChange).toHaveBeenCalled());
  expect(onChange.mock.calls[0][0].map(({ name: n }) => n)).toEqual(['Soft Night', 'Soft Night (2)', 'Warm Day']);
  expect(screen.getByRole('status')).toHaveTextContent('Imported 2 recipes.');

  // One invalid recipe rejects the whole library, naming it.
  const bad = JSON.stringify({ ...library, recipes: [library.recipes[0], { ...library.recipes[1], adjustments: { light: { notAControl: 1 } } }] });
  onChange.mockClear();
  await act(async () => fireEvent.change(input, { target: { files: [new File([bad], 'bad.json')] } }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/^Recipe 2:/));
  expect(onChange).not.toHaveBeenCalled();
});

test('the batch panel opens the recipe dialog for the selection', () => {
  const onOpenRecipe = vi.fn();
  render(<BatchPanel readyCount={3} selectedCount={2} selecting={false} onToggleSelecting={() => {}} onSelectAll={() => {}} onClear={() => {}} clipboard={null} onCopy={() => {}} onPaste={() => {}} onOpen={() => {}} onOpenRecipe={onOpenRecipe} onExport={() => {}} batches={{ past: [], future: [], last: null }} dispatch={() => {}} canEdit busy={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Recipe…' }));
  expect(onOpenRecipe).toHaveBeenCalled();
});

test('the recipe dialog stacks its footer and fields at phone width', () => {
  const phone = editorCss.slice(editorCss.search(/@media \(max-width: 620px\) \{\s+\.pe-dialog-backdrop/));
  expect(phone).toMatch(/^@media[^@]*\.pe-dialog--recipe \.pe-dialog__foot \{ flex-wrap: wrap; \}/);
  expect(phone).toMatch(/^@media[^@]*\.pe-recipe__fields \{ grid-template-columns: minmax\(0, 1fr\); \}/);
});
