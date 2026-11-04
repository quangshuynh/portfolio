// How eagerly the photography viewer loads files: a tier read from the Network Information API
// (Chromium; Safari and Firefox expose none and get the conservative default), the neighbours to
// prefetch and at which size, and how long a photograph must stay before its full-size file loads.
import { photographTiers, photographSourceWidth } from '../../data/photographs';

/**
 * 'save' (Data Saver or 2G), 'slow' (under 3 Mbps, high latency or a low-memory device), 'fast'
 * (at least 8 Mbps at under 100 ms) or 'normal', which is also the answer without the API.
 */
export function viewerNetworkTier(nav = typeof navigator === 'undefined' ? {} : navigator) {
  const connection = nav.connection;
  if (connection?.saveData || /2g$/.test(connection?.effectiveType ?? '')) return 'save';
  const downlink = connection?.downlink;
  const rtt = connection?.rtt;
  if (connection?.effectiveType === '3g' || (downlink > 0 && downlink < 3) || rtt >= 300) return 'slow';
  if (nav.deviceMemory && nav.deviceMemory <= 2) return 'slow';
  if (downlink >= 8 && rtt > 0 && rtt < 100) return 'fast';
  return 'normal';
}

// Milliseconds a photograph must stay shown before its full-size file replaces the first file;
// null: only zooming loads it (Data Saver). Zooming always upgrades at once.
export const UPGRADE_DELAY = Object.freeze({ fast: 0, normal: 250, slow: 700, save: null });

export function upgradeDelay(tier, zoomed) {
  return zoomed ? 0 : UPGRADE_DELAY[tier];
}

/** The file to show first: the full-size one when it is already loaded or the network is fast. */
export function initialViewerSource(photograph, devicePixels, tier, isLoaded) {
  const { step, full } = photographTiers(photograph, devicePixels);
  return tier === 'fast' || isLoaded(full) ? full : step;
}

/** Whether `candidate` is wider than `current` (the viewer never swaps to a narrower file). */
export function isWiderSource(photograph, candidate, current) {
  return photographSourceWidth(photograph, candidate) > photographSourceWidth(photograph, current);
}

/**
 * Neighbour files to prefetch, most likely next first: the one in the direction of travel, and
 * the other one too unless the network is slow. Files already loaded (at either size) are left
 * out; a fast network prefetches the full-size files.
 * :param neighbours: { previous, next } photographs (either may be null)
 * :param direction: 1 after moving forward (or on opening), -1 after moving back
 * :param pixelsFor: photograph -> device pixels it needs fitted into the stage
 */
export function prefetchPlan({ previous, next }, direction, tier, pixelsFor, isLoaded) {
  const ordered = direction < 0 ? [previous, next] : [next, previous];
  const wanted = ordered.filter(Boolean).slice(0, tier === 'save' || tier === 'slow' ? 1 : 2);
  return wanted.flatMap((photograph) => {
    const { step, full } = photographTiers(photograph, pixelsFor(photograph));
    if (isLoaded(full) || (tier !== 'fast' && isLoaded(step))) return [];
    return [tier === 'fast' ? full : step];
  });
}
