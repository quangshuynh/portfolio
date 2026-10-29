import React, { useMemo, useState } from 'react';
import { BUILT_IN_PRESETS, PRESET_GROUPS } from '../model/presets.mjs';
import { DEFAULT_SYNC_GROUPS, SYNC_GROUPS, planFilter, planLut, planPreset, planReset, planSync, sourceKind } from '../model/sync.mjs';
import { BUILT_IN_FILTERS, FILTER_CATEGORIES, customFilters } from '../model/filters.mjs';
import Dialog from './Dialog';
import PhotoThumb from './PhotoThumb';

/** Targets shown with before/after thumbnails (each renders on the main thread). */
export const PREVIEW_LIMIT = 12;
const groupLabel = (id) => SYNC_GROUPS.find((group) => group.id === id)?.label ?? id;
const TITLES = { sync: 'Sync edits', preset: 'Apply preset', filter: 'Apply filter', lut: 'Apply LUT', reset: 'Reset photos' };

/**
 * Batch change on the selected photos: Sync (chosen groups of the active photo's
 * settings), a preset, a Filter Library filter with strength, a LUT with intensity, or a reset. Shows what will change on each
 * photo, with before/after thumbnails, before anything is applied; Cancel changes nothing.
 * :param props: mode, source (active photo), targets (selected photos; for Sync without the
 *   source), presets (the visitor's), luts (loaded this session), thumbnailOf(id), lutFor(settings),
 *   onApply(plan, label), onClose
 */
export default function BatchDialog({ mode, source, targets, presets = [], luts = [], thumbnailOf, lutFor, onApply, onClose }) {
  const [groups, setGroups] = useState(DEFAULT_SYNC_GROUPS);
  const allPresets = useMemo(() => [...BUILT_IN_PRESETS, ...presets], [presets]);
  const [presetId, setPresetId] = useState(allPresets[0]?.id ?? '');
  const [lutSha, setLutSha] = useState(luts[0]?.sha256 ?? '');
  const [intensity, setIntensity] = useState(100);
  const filters = useMemo(() => [...BUILT_IN_FILTERS, ...customFilters(presets)], [presets]);
  const [filterId, setFilterId] = useState(BUILT_IN_FILTERS[0].id);
  const [strength, setStrength] = useState(100);
  const filter = filters.find(({ id }) => id === filterId) ?? null;
  const hasLut = (sha256) => luts.some((lut) => lut.sha256 === sha256);
  const preset = allPresets.find(({ id }) => id === presetId) ?? null;
  const lut = luts.find(({ sha256 }) => sha256 === lutSha) ?? null;

  const plan = useMemo(() => {
    if (mode === 'sync') return planSync(source.history.present, targets, { groups, hasLut, kind: sourceKind(source) });
    if (mode === 'preset') return preset ? planPreset(preset, targets, { hasLut }) : { items: [], changedCount: 0, errors: ['Choose a preset.'] };
    if (mode === 'filter') return filter ? planFilter(filter, strength, targets) : { items: [], changedCount: 0, errors: ['Choose a filter.'] };
    if (mode === 'lut') return planLut(lut, intensity, targets, { hasLut });
    return planReset(targets);
  }, [mode, source, targets, groups, preset, filter, strength, lut, intensity, luts]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = mode === 'sync' ? 'sync edits' : mode === 'preset' ? `preset ${preset?.name ?? ''}`.trim() : mode === 'filter' ? `filter ${filter?.name ?? ''}`.trim() : mode === 'lut' ? (lut ? `LUT ${lut.title || lut.name}` : 'LUT removal') : 'reset';
  const blocked = plan.errors.length > 0 || plan.changedCount === 0;
  return (
    <Dialog
      title={TITLES[mode]}
      onClose={onClose}
      className="pe-dialog--batch"
      footer={(
        <>
          <span className="pe-note pe-dialog__summary" role="status">
            {plan.errors[0] ?? (plan.changedCount ? `Changes ${plan.changedCount} of ${plan.items.length} photo${plan.items.length === 1 ? '' : 's'}.` : 'Nothing would change.')}
          </span>
          <button type="button" className="pe-button" onClick={onClose}>Cancel</button>
          <button type="button" className="pe-button pe-button--primary" disabled={blocked} onClick={() => onApply(plan, label)}>Apply to {plan.changedCount}</button>
        </>
      )}
    >
      {mode === 'sync' && (
        <>
          <p className="pe-note">From <strong>{source.name}</strong> (the active photo) to the other {targets.length} selected. Each chosen group is replaced exactly; groups left unticked keep each photo's own values. Undo restores every photo.</p>
          <fieldset className="pe-group pe-batch-groups">
            <legend>Copy these groups</legend>
            {SYNC_GROUPS.map(({ id, label: name, needs }) => (
              <label key={id}>
                <input type="checkbox" checked={groups.includes(id)} onChange={(event) => setGroups(event.target.checked ? [...groups, id] : groups.filter((g) => g !== id))} />
                {name}{needs ? <span className="pe-note"> (only {needs})</span> : null}
              </label>
            ))}
          </fieldset>
          <p className="pe-note">Never copied: a RAW file's as-shot white balance, camera colour and exposure data, and a merge's source files, roles and settings.</p>
        </>
      )}
      {mode === 'preset' && (
        <label className="pe-field">
          <span>Preset</span>
          <select value={presetId} onChange={(event) => setPresetId(event.target.value)}>
            <optgroup label="Built-in">{BUILT_IN_PRESETS.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}</optgroup>
            {presets.length > 0 && <optgroup label="Yours">{presets.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}</optgroup>}
          </select>
          {preset && <span className="pe-note">Replaces: {preset.groups.map((id) => PRESET_GROUPS.find((g) => g.id === id).label).join(', ')}. Other settings of each photo stay.</span>}
        </label>
      )}
      {mode === 'filter' && (
        <>
          <label className="pe-field">
            <span>Filter</span>
            <select value={filterId} onChange={(event) => setFilterId(event.target.value)}>
              {FILTER_CATEGORIES.map(({ id, label: name }) => {
                const inCategory = filters.filter(({ category }) => category === id);
                return inCategory.length ? <optgroup key={id} label={name}>{inCategory.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup> : null;
              })}
            </select>
          </label>
          <label className="pe-field">
            <span>Strength {strength}%</span>
            <input type="range" className="pe-range" min="0" max="100" step="1" value={strength} style={{ '--fill-from': '0%', '--fill-to': `${strength}%` }} onChange={(event) => setStrength(Number(event.target.value))} />
          </label>
          <p className="pe-note">Replaces each photo's Creative settings. Light, Color, HSL, Detail, curves, LUT, crop, RAW and HDR settings, text and the grain pattern of each photo stay.</p>
        </>
      )}
      {mode === 'lut' && (
        <>
          <label className="pe-field">
            <span>LUT</span>
            <select value={lutSha} onChange={(event) => setLutSha(event.target.value)}>
              <option value="">None (remove LUT)</option>
              {luts.map(({ sha256, name, title, size }) => <option key={sha256} value={sha256}>{title || name} ({size}³)</option>)}
            </select>
          </label>
          {!luts.length && <p className="pe-note">No LUT is loaded. Import a .cube file in the LUT section first.</p>}
          {lut && (
            <label className="pe-field">
              <span>Intensity {intensity}%</span>
              <input type="range" className="pe-range" min="0" max="100" step="1" value={intensity} style={{ '--fill-from': '0%', '--fill-to': `${intensity}%` }} onChange={(event) => setIntensity(Number(event.target.value))} />
            </label>
          )}
          <p className="pe-note">The same LUT colour assumptions as for one photo: sRGB display values in, sRGB out.</p>
        </>
      )}
      {mode === 'reset' && <p className="pe-note">Every setting of the selected photos returns to neutral. RAW files are developed as shot again; merged photos keep their merge. Undo brings the settings back.</p>}

      <PlanList plan={plan} targets={targets} thumbnailOf={thumbnailOf} lutFor={lutFor} />
    </Dialog>
  );
}

/**
 * What a batch plan changes on each photo, with before/after thumbnails for the first
 * PREVIEW_LIMIT (shared by the batch and recipe dialogs).
 */
export function PlanList({ plan, targets, thumbnailOf, lutFor }) {
  const byId = new Map(targets.map((photo) => [photo.id, photo]));
  return (
    <>
      <ul className="pe-batch-plan" aria-label="Photos affected">
        {plan.items.map((item, index) => {
          const photo = byId.get(item.id);
          const thumbnail = index < PREVIEW_LIMIT ? thumbnailOf(item.id) : null;
          return (
            <li key={item.id} className="pe-batch-plan__item" data-changed={item.changed.length > 0 || undefined}>
              {thumbnail && (
                <span className="pe-batch-plan__thumbs" aria-hidden="true">
                  <PhotoThumb thumbnail={thumbnail} adjustments={item.before} lut={lutFor(item.before)} raw={photo.raw} photoWidth={photo.width} />
                  <PhotoThumb thumbnail={thumbnail} adjustments={item.after} lut={lutFor(item.after)} raw={photo.raw} photoWidth={photo.width} />
                </span>
              )}
              <span className="pe-batch-plan__meta">
                <span className="pe-photo__name">{item.name}</span>
                <span className="pe-photo__detail">
                  {item.changed.length ? `Changes ${item.changed.map(groupLabel).join(', ')}` : 'No change'}
                  {item.skipped.length ? `. Skipped ${item.skipped.map(({ group, reason }) => `${groupLabel(group)} (${reason})`).join(', ')}` : ''}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {plan.items.length > PREVIEW_LIMIT && <p className="pe-note">Before/after thumbnails for the first {PREVIEW_LIMIT}. Thumbnails do not show Detail, which needs the full image.</p>}
    </>
  );
}
