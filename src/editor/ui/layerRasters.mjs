// Preview rasters of image layers: each layer's source decoded (and developed with the layer's
// settings) at a size bucket just above what the preview canvas needs, so resizing a layer
// re-decodes only when it crosses a bucket, and a smaller raster is never stretched for long.
// Loads run one at a time through the caller's `load` (RAW in the RAW queue); the cache keeps
// a few rasters within a byte budget and drops the least recently used.

import { compactLayerSettings } from '../model/layers.mjs';
import { rasterSize } from '../pipeline/layerTransform.mjs';

export const RASTER_CACHE_BYTES = 384 * 1024 * 1024;
const MIN_BUCKET = 256;

/**
 * Size to load for a layer on a canvas: the long edge rounded up to a power of two (at least
 * MIN_BUCKET, at most `maxEdge` and the source), proportions of the source.
 */
export function rasterBucket(layer, canvas, maxEdge = 4096) {
  const needed = rasterSize(layer, canvas);
  const { width, height } = layer.source;
  const long = Math.max(width, height);
  let edge = MIN_BUCKET;
  while (edge < Math.max(needed.width, needed.height)) edge *= 2;
  edge = Math.min(edge, long, maxEdge);
  const scale = edge / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// A RAW layer's rendering profile changes its pixels as much as its settings do.
const settingsKey = (layer) => JSON.stringify([compactLayerSettings(layer.settings), layer.rawProfile ?? null]);

/**
 * :param load: async (layer, size) => { width, height, data } RGBA8
 * :param onChange: called when a raster arrives or fails (the preview redraws)
 */
export function createRasterCache({ load, onChange = () => {}, maxEdge = 4096, budget = RASTER_CACHE_BYTES }) {
  const entries = new Map();
  const queue = [];
  let busy = false;
  const errors = new Map();
  const bytes = () => [...entries.values()].reduce((sum, entry) => sum + (entry.raster ? entry.raster.data.byteLength : 0), 0);
  const prune = (keep) => {
    for (const [key, entry] of entries) {
      if (bytes() <= budget && entries.size <= 8) break;
      if (key !== keep && entry.raster) entries.delete(key);
    }
  };
  const pump = async () => {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const { key, layer, size } = queue.shift();
      const entry = entries.get(key);
      if (!entry || entry.raster) continue; // eslint-disable-line no-continue
      try {
        entry.raster = await load(layer, size);
        errors.delete(layer.source.sha256);
        entries.delete(key);
        entries.set(key, entry);
        prune(key);
      } catch (error) {
        entries.delete(key);
        if (error?.code !== 'cancelled') errors.set(layer.source.sha256, error?.message ?? String(error));
      }
      onChange();
    }
    busy = false;
  };
  return {
    /** The raster for this layer at this canvas, or the closest one already loaded; null until one is. */
    get(layer, canvas) {
      const size = rasterBucket(layer, canvas, maxEdge);
      const base = `${layer.source.sha256}|${settingsKey(layer)}`;
      const key = `${base}|${size.width}x${size.height}`;
      const entry = entries.get(key);
      if (entry?.raster) {
        entries.delete(key);
        entries.set(key, entry);
        return entry.raster;
      }
      if (!entry && !errors.has(layer.source.sha256)) {
        entries.set(key, { raster: null });
        queue.push({ key, layer, size });
        pump();
      }
      // Meanwhile, the same source with the same settings at another size.
      for (const [other, value] of entries) if (value.raster && other.startsWith(`${base}|`)) return value.raster;
      return null;
    },
    /** Why a source failed to load, by SHA-256. */
    error: (sha256) => errors.get(sha256) ?? null,
    retry(sha256) { errors.delete(sha256); },
    clear() { entries.clear(); queue.length = 0; errors.clear(); },
    get size() { return entries.size; },
    get bytes() { return bytes(); },
  };
}
