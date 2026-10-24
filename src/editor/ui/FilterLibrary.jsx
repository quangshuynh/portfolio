import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BUILT_IN_FILTERS, FILTER_CATEGORIES, FILTER_FAVORITES_KEY, FILTER_RECENT_KEY, customFilters, filterPatch, filterState,
  noFilterPatch, pushRecent, readFilterIds, searchFilters, writeFilterIds,
} from '../model/filters.mjs';
import { lookPatch } from '../model/looks.mjs';
import { createPreset, uniquePresetName } from '../model/presets.mjs';
import { THUMB_BATCH, thumbnailBase } from './filterThumbs.mjs';

const storage = () => { try { return window.localStorage; } catch { return null; } };
const TABS = [{ id: 'all', label: 'All' }, { id: 'favorites', label: 'Favorites' }, { id: 'recent', label: 'Recent' }, ...FILTER_CATEGORIES];
const SHORT_LABELS = { digicam: 'Digicam', vintage: 'Vintage', cinematic: 'Cinematic', experimental: 'Experimental', custom: 'Custom' };
const thumbKey = (filter) => `${filter.id}|${JSON.stringify(filter.settings)}`;

/** Draws one thumbnail (RGBA8 { width, height, data }) into a canvas. */
function Thumb({ image }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !image) return;
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  }, [image]);
  return image ? <canvas ref={ref} className="pe-filter__thumb" aria-hidden="true" /> : <span className="pe-filter__thumb pe-filter__thumb--empty" aria-hidden="true" />;
}

/**
 * Renders thumbnails of the shown filters on the photo, a few per worker call, newest
 * request first: a change of photo, settings or list drops the older work between batches.
 * Older thumbnails stay visible (and are replaced) while new ones render.
 */
function useThumbnails(thumbnails, adjustments, shown) {
  const [, setVersion] = useState(0);
  const cache = useRef({ key: null, images: new Map(), previous: new Map() });
  const base = useMemo(() => thumbnailBase(adjustments), [adjustments]);
  const key = thumbnails ? `${thumbnails.key}|${JSON.stringify(base)}` : null;
  const wanted = shown.map(thumbKey).join('\n');
  useEffect(() => {
    if (!key || !thumbnails) return undefined;
    const c = cache.current;
    let delay = 0;
    if (c.key !== key) {
      // Settings changed: render after they settle (slider drags), showing the old images meanwhile.
      if (c.key) { c.previous = new Map([...c.previous, ...c.images]); delay = 300; }
      Object.assign(c, { key, images: new Map() });
    }
    const todo = shown.filter((filter) => !c.images.has(thumbKey(filter)));
    if (!todo.length) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const source = await thumbnails.getSource();
        for (let i = 0; i < todo.length && !cancelled; i += THUMB_BATCH) {
          const batch = todo.slice(i, i + THUMB_BATCH);
          const results = await thumbnails.render({ ...source, adjustments: base, filters: batch.map((filter) => ({ id: thumbKey(filter), patch: lookPatch(filter, 100) })) });
          if (cancelled || c.key !== key) return;
          results.forEach((result) => { c.images.set(result.id, result); c.previous.delete(result.id); });
          setVersion((value) => value + 1);
          performance.mark?.('pe-filter-thumbs', { detail: { count: c.images.size } });
        }
        if (!cancelled) c.previous.clear();
      } catch {
        // No thumbnails (the photo left, or the worker failed): the cards keep their placeholders.
      }
    }, delay);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [key, wanted]); // eslint-disable-line react-hooks/exhaustive-deps
  return (filter) => cache.current.images.get(thumbKey(filter)) ?? cache.current.previous.get(thumbKey(filter)) ?? null;
}

const StarIcon = ({ filled }) => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
);

/**
 * The Filter Library: search, categories, favourites and recent filters as a grid of
 * thumbnails of the photo. One click applies a filter (replacing the Creative group, keeping
 * every other edit); strength scales it; Compare shows the photo without it.
 * :param thumbnails: { key, getSource(), render(payload) } or null (placeholders only)
 * :param presets: { userPresets, onChange, newId } to save and list custom filters
 */
export default function FilterLibrary({ adjustments, disabled, dispatch, onPreview, presets = null, thumbnails = null }) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('all');
  const [favorites, setFavorites] = useState(() => readFilterIds(storage(), FILTER_FAVORITES_KEY));
  const [recent, setRecent] = useState(() => readFilterIds(storage(), FILTER_RECENT_KEY));
  const [saving, setSaving] = useState(null);
  const [comparing, setComparing] = useState(false);
  const dragging = useRef(false);
  const userPresets = presets?.userPresets ?? [];
  const filters = useMemo(() => [...BUILT_IN_FILTERS, ...customFilters(userPresets)], [userPresets]);
  const byId = useMemo(() => new Map(filters.map((filter) => [filter.id, filter])), [filters]);
  const current = filterState(adjustments, filters);
  const shown = useMemo(() => {
    let list = filters;
    if (tab === 'favorites') list = favorites.map((id) => byId.get(id)).filter(Boolean);
    else if (tab === 'recent') list = recent.map((id) => byId.get(id)).filter(Boolean);
    else if (tab !== 'all') list = filters.filter(({ category }) => category === tab);
    return searchFilters(list, query);
  }, [filters, byId, tab, favorites, recent, query]);
  const thumbOf = useThumbnails(thumbnails, adjustments, shown);

  useEffect(() => {
    const end = () => {
      if (!dragging.current) return;
      dragging.current = false;
      dispatch({ type: 'commitAdjustment' });
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [dispatch]);
  // Leaving the library (or the photo) ends a comparison.
  useEffect(() => () => onPreview?.(null), [onPreview]);

  const withoutFilter = { name: 'Without filter', groups: ['creative'], settings: { grainSeed: adjustments.grainSeed } };
  // Hovering or focusing a filter previews it; leaving returns to the comparison, if one is on.
  const preview = (filter) => onPreview?.(filter ? { name: filter.name, groups: ['creative'], settings: { ...lookPatch(filter, 100), grainSeed: adjustments.grainSeed } } : comparing ? withoutFilter : null);
  const apply = (filter) => {
    onPreview?.(null);
    setComparing(false);
    dispatch({ type: 'applySettings', patch: filterPatch(filter, 100) });
    const next = pushRecent(recent, filter.id);
    setRecent(next);
    writeFilterIds(storage(), FILTER_RECENT_KEY, next);
  };
  const toggleFavorite = (filter) => {
    const next = favorites.includes(filter.id) ? favorites.filter((id) => id !== filter.id) : [...favorites, filter.id];
    setFavorites(next);
    writeFilterIds(storage(), FILTER_FAVORITES_KEY, next);
  };
  const setStrength = (value) => {
    const patch = filterPatch(current.filter, value);
    if (dragging.current) dispatch({ type: 'previewSettings', patch });
    else dispatch({ type: 'applySettings', patch, coalesceKey: `filter:${current.id}` });
  };
  const compare = (on) => {
    setComparing(on);
    onPreview?.(on ? withoutFilter : null);
  };
  const reset = () => {
    compare(false);
    dispatch({ type: 'applySettings', patch: noFilterPatch() });
  };
  const saveCustom = (event) => {
    event.preventDefault();
    const name = uniquePresetName(saving, userPresets);
    const preset = createPreset(name, adjustments, ['creative']);
    presets.onChange([...userPresets, { ...preset, id: presets.newId() }]);
    dispatch({ type: 'applySettings', patch: { filter: { id: `preset:${preset.name}`, strength: 100 } } });
    setSaving(null);
  };

  const strength = current?.strength ?? 100;
  return (
    <div className="pe-filters">
      <label className="pe-filters__search">
        <span className="visually-hidden">Search filters</span>
        <input type="search" placeholder="Search filters" value={query} onChange={(event) => setQuery(event.target.value)} disabled={disabled} />
      </label>
      <div className="pe-filters__tabs" role="group" aria-label="Filter category">
        {TABS.filter(({ id }) => id !== 'custom' || filters.some(({ category }) => category === 'custom')).map(({ id, label }) => (
          <button key={id} type="button" className="pe-text-button" aria-pressed={tab === id} title={label} onClick={() => setTab(id)}>
            {SHORT_LABELS[id] ?? label}
          </button>
        ))}
      </div>
      {shown.length ? (
        <ul className="pe-filters__grid" aria-label="Filters">
          {shown.map((filter) => {
            const favorite = favorites.includes(filter.id);
            return (
              <li key={filter.id} className="pe-filter">
                <button
                  type="button"
                  className="pe-filter__apply"
                  disabled={disabled}
                  aria-pressed={current?.id === filter.id}
                  title={filter.description}
                  onClick={() => apply(filter)}
                  {...(disabled ? {} : { onPointerEnter: (event) => event.pointerType === 'mouse' && preview(filter), onPointerLeave: () => preview(null), onFocus: () => preview(filter), onBlur: () => preview(null) })}
                >
                  <Thumb image={thumbOf(filter)} />
                  <span className="pe-filter__name">{filter.name}</span>
                </button>
                <button type="button" className="pe-filter__star" aria-pressed={favorite} aria-label={`Favorite ${filter.name}`} title={favorite ? 'Remove from favorites' : 'Add to favorites'} onClick={() => toggleFavorite(filter)}>
                  <StarIcon filled={favorite} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="pe-note">
          {tab === 'favorites' && !query ? 'No favorites yet. Use the star on a filter to add it.' : tab === 'recent' && !query ? 'Filters you apply appear here.' : 'No filter matches.'}
        </p>
      )}
      {current && (
        <div className="pe-filters__current">
          <p className="pe-filters__title">
            <span>{current.filter?.name ?? 'Unknown filter'}</span>
            {current.modified && <span className="pe-filters__badge">Modified</span>}
          </p>
          <div className="pe-adjust">
            <div className="pe-adjust__head">
              <label htmlFor="pe-filter-strength">Filter strength</label>
              <output className="pe-adjust__value mono" htmlFor="pe-filter-strength">{strength}%</output>
            </div>
            <input
              id="pe-filter-strength"
              className="pe-range"
              type="range"
              min={0}
              max={100}
              step={1}
              value={strength}
              disabled={disabled || current.modified}
              aria-valuetext={`${strength}%`}
              style={{ '--fill-from': '0%', '--fill-to': `${strength}%` }}
              onPointerDown={() => { dragging.current = true; }}
              onInput={(event) => setStrength(Number(event.target.value))}
              onChange={() => {}}
            />
          </div>
          <div className="pe-filters__actions">
            <button type="button" className="pe-text-button" aria-pressed={comparing} disabled={disabled} onClick={() => compare(!comparing)}>Compare</button>
            {current.modified && current.filter && (
              <button type="button" className="pe-text-button" disabled={disabled} onClick={() => dispatch({ type: 'applySettings', patch: filterPatch(current.filter, strength) })}>Revert changes</button>
            )}
            {presets && <button type="button" className="pe-text-button" disabled={disabled} onClick={() => setSaving(current.filter ? `${current.filter.name} (custom)` : 'Custom filter')}>Save as custom</button>}
            <button type="button" className="pe-text-button" disabled={disabled} onClick={reset}>Remove filter</button>
          </div>
          {saving !== null && (
            <form className="pe-filters__save" onSubmit={saveCustom}>
              <label>
                <span className="visually-hidden">Custom filter name</span>
                <input value={saving} maxLength={60} autoFocus onChange={(event) => setSaving(event.target.value)} onKeyDown={(event) => event.key === 'Escape' && setSaving(null)} />
              </label>
              <button type="submit" className="pe-button" disabled={!saving.trim()}>Save</button>
              <button type="button" className="pe-text-button" onClick={() => setSaving(null)}>Cancel</button>
            </form>
          )}
          <p className="pe-note">
            {current.modified
              ? 'The Creative settings were changed after the filter was applied. Save them as a custom filter to reuse them with a strength, or revert the changes.'
              : 'Strength scales the filter from none (0%) to full. Compare shows the photo without it.'}
          </p>
        </div>
      )}
      <p className="pe-note">A filter replaces the Creative settings below and keeps every other edit. All filters are original approximations of a look, not reproductions of a camera, film or app.</p>
    </div>
  );
}
