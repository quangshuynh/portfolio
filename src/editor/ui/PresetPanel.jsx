import React, { useRef, useState } from 'react';
import {
  BUILT_IN_PRESETS, PRESET_GROUPS, PresetError, changedPresetGroups, cleanPresetName, createPreset,
  parsePresetFile, serializePresets, uniquePresetName, MAX_PRESETS,
} from '../model/presets.mjs';

/**
 * Presets: built-in looks and the visitor's own, stored in this browser. Hovering or
 * focusing a preset previews it on the photo; clicking applies it (one undo step).
 * A preset replaces only the groups it contains.
 * :param userPresets: [{ id, name, groups, settings }]
 * :param onChange: (nextUserPresets) => void, persists them
 * :param onPreview: (preset | null) => void
 * :param onDownload: (blob, fileName) => void
 */
export default function PresetPanel({ adjustments, disabled, dispatch, userPresets = [], onChange, onPreview, onDownload, newId }) {
  const [saving, setSaving] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [message, setMessage] = useState(null);
  const importRef = useRef(null);

  const apply = (preset) => {
    onPreview?.(null);
    dispatch({ type: 'applyPreset', preset });
    setMessage({ tone: 'info', text: `Applied ${preset.name}.` });
  };
  const previewHandlers = (preset) => (disabled ? {} : {
    onPointerEnter: () => onPreview?.(preset),
    onPointerLeave: () => onPreview?.(null),
    onFocus: () => onPreview?.(preset),
    onBlur: () => onPreview?.(null),
  });

  const startSave = () => setSaving({ name: '', groups: changedPresetGroups(adjustments).filter((id) => id !== 'exposure' && id !== 'whiteBalance') });
  const save = (event) => {
    event.preventDefault();
    try {
      if (userPresets.length >= MAX_PRESETS) throw new PresetError(`You can keep up to ${MAX_PRESETS} presets.`);
      const preset = createPreset(uniquePresetName(saving.name, userPresets), adjustments, saving.groups);
      onChange([...userPresets, { ...preset, id: newId() }]);
      setSaving(null);
      setMessage({ tone: 'info', text: `Saved ${preset.name}.` });
    } catch (error) {
      setMessage({ tone: 'error', text: error.message });
    }
  };
  const rename = (event, preset) => {
    event.preventDefault();
    const name = cleanPresetName(renaming.name);
    if (!name) { setMessage({ tone: 'error', text: 'Give the preset a name.' }); return; }
    const finalName = name.toLowerCase() === preset.name.toLowerCase() ? name : uniquePresetName(name, userPresets.filter(({ id }) => id !== preset.id));
    onChange(userPresets.map((item) => (item.id === preset.id ? { ...item, name: finalName } : item)));
    setRenaming(null);
  };
  const remove = (preset) => {
    if (confirmDelete !== preset.id) { setConfirmDelete(preset.id); return; }
    onChange(userPresets.filter(({ id }) => id !== preset.id));
    setConfirmDelete(null);
    setMessage({ tone: 'info', text: `Deleted ${preset.name}.` });
  };
  const importFile = async (file) => {
    try {
      const incoming = parsePresetFile(await file.text());
      const room = MAX_PRESETS - userPresets.length;
      if (room <= 0) throw new PresetError(`You can keep up to ${MAX_PRESETS} presets.`);
      const added = [];
      incoming.slice(0, room).forEach((preset) => added.push({ ...preset, name: uniquePresetName(preset.name, [...userPresets, ...added]), id: newId() }));
      onChange([...userPresets, ...added]);
      setMessage({ tone: 'info', text: `Imported ${added.length} preset${added.length === 1 ? '' : 's'}${incoming.length > added.length ? `; ${incoming.length - added.length} did not fit` : ''}.` });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof PresetError ? error.message : 'The preset file could not be read.' });
    }
  };
  const exportAll = () => {
    onDownload(new Blob([serializePresets(userPresets)], { type: 'application/json' }), 'photo-editor-presets.json');
    setMessage({ tone: 'info', text: `Exported ${userPresets.length} preset${userPresets.length === 1 ? '' : 's'}.` });
  };

  const row = (preset) => (
    <li key={preset.id} className="pe-preset">
      {renaming?.id === preset.id ? (
        <form className="pe-preset__rename" onSubmit={(event) => rename(event, preset)}>
          <input aria-label={`New name for ${preset.name}`} value={renaming.name} maxLength={60} autoFocus onChange={(event) => setRenaming({ ...renaming, name: event.target.value })} onKeyDown={(event) => event.key === 'Escape' && setRenaming(null)} />
          <button type="submit" className="pe-text-button">Save</button>
          <button type="button" className="pe-text-button" onClick={() => setRenaming(null)}>Cancel</button>
        </form>
      ) : (
        <>
          <button type="button" className="pe-preset__apply" disabled={disabled} title={preset.description ?? `Replaces: ${preset.groups.map((id) => PRESET_GROUPS.find((g) => g.id === id).label).join(', ')}`} aria-label={`Apply ${preset.name}`} onClick={() => apply(preset)} {...previewHandlers(preset)}>
            {preset.name}
          </button>
          {!preset.builtIn && (
            <span className="pe-preset__actions">
              <button type="button" className="pe-text-button" onClick={() => { setRenaming({ id: preset.id, name: preset.name }); setConfirmDelete(null); }} aria-label={`Rename ${preset.name}`}>Rename</button>
              <button type="button" className="pe-text-button" data-danger={confirmDelete === preset.id || undefined} onClick={() => remove(preset)} onBlur={() => setConfirmDelete(null)} aria-label={confirmDelete === preset.id ? `Confirm deleting ${preset.name}` : `Delete ${preset.name}`}>
                {confirmDelete === preset.id ? 'Confirm' : 'Delete'}
              </button>
            </span>
          )}
        </>
      )}
    </li>
  );

  return (
    <div className="pe-presets">
      <p className="pe-note">Hover or focus a preset to preview it. Applying replaces only the groups it contains; built-in looks leave exposure and white balance alone.</p>
      <h4 className="pe-presets__title">Built-in</h4>
      <ul className="pe-presets__list">{BUILT_IN_PRESETS.map(row)}</ul>
      <h4 className="pe-presets__title">Yours</h4>
      {userPresets.length ? <ul className="pe-presets__list">{userPresets.map(row)}</ul> : <p className="pe-note">None yet. Presets are kept in this browser only.</p>}

      {saving ? (
        <form className="pe-preset-form" onSubmit={save}>
          <label className="pe-field">
            <span>Preset name</span>
            <input value={saving.name} maxLength={60} autoFocus onChange={(event) => setSaving({ ...saving, name: event.target.value })} />
          </label>
          <fieldset className="pe-preset-form__groups">
            <legend>Include</legend>
            {PRESET_GROUPS.map(({ id, label }) => (
              <label key={id}>
                <input
                  type="checkbox"
                  checked={saving.groups.includes(id)}
                  onChange={(event) => setSaving({ ...saving, groups: event.target.checked ? [...saving.groups, id] : saving.groups.filter((g) => g !== id) })}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <div className="pe-preset-form__actions">
            <button type="submit" className="pe-button pe-button--primary" disabled={!saving.name.trim() || !saving.groups.length}>Save preset</button>
            <button type="button" className="pe-text-button" onClick={() => setSaving(null)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="pe-presets__actions">
          <button type="button" className="pe-button" disabled={disabled} onClick={startSave}>Save current as preset…</button>
          <button type="button" className="pe-text-button" onClick={() => importRef.current?.click()}>Import</button>
          <button type="button" className="pe-text-button" disabled={!userPresets.length} onClick={exportAll}>Export</button>
          <input ref={importRef} type="file" accept="application/json,.json" hidden aria-label="Import presets" onChange={(event) => { const [file] = event.target.files; event.target.value = ''; if (file) importFile(file); }} />
        </div>
      )}
      {message && <p className={`pe-note${message.tone === 'error' ? ' pe-note--error' : ''}`} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</p>}
    </div>
  );
}
