import { photographTiers } from '../../data/photographs';
import { initialViewerSource, isWiderSource, prefetchPlan, upgradeDelay, viewerNetworkTier } from './viewerLoading';

const photo = (name, { medium = true } = {}) => ({
  gallerySrc: `/${name}-gallery.jpg`, galleryWidth: 900,
  ...(medium ? { mediumSrc: `/${name}-medium.jpg`, mediumWidth: 1600 } : {}),
  viewerSrc: `/${name}-viewer.jpg`, viewerWidth: 2200, viewerHeight: 1467,
});
const a = photo('a');
const b = photo('b');
const c = photo('c');
const none = () => false;

test('a 2× desktop shows the 1600 px file first and needs the 2200 px one; 1× needs no upgrade', () => {
  expect(photographTiers(a, 2400)).toEqual({ step: '/a-medium.jpg', full: '/a-viewer.jpg' });
  expect(photographTiers(a, 1200)).toEqual({ step: '/a-medium.jpg', full: '/a-medium.jpg' });
  expect(photographTiers(a, 700)).toEqual({ step: '/a-gallery.jpg', full: '/a-gallery.jpg' });
  // Without a medium file (portraits, the CMS preview) nothing smaller covers 1600 px.
  expect(photographTiers(photo('p', { medium: false }), 2400)).toEqual({ step: '/p-viewer.jpg', full: '/p-viewer.jpg' });
  expect(isWiderSource(a, '/a-viewer.jpg', '/a-medium.jpg')).toBe(true);
  expect(isWiderSource(a, '/a-medium.jpg', '/a-viewer.jpg')).toBe(false);
  expect(isWiderSource(a, '/elsewhere.jpg', '/a-medium.jpg')).toBe(false);
});

test('the network tier is conservative without the Network Information API', () => {
  expect(viewerNetworkTier({})).toBe('normal'); // Safari, Firefox
  expect(viewerNetworkTier({ connection: { saveData: true, downlink: 10, rtt: 50 } })).toBe('save');
  expect(viewerNetworkTier({ connection: { effectiveType: '2g' } })).toBe('save');
  expect(viewerNetworkTier({ connection: { effectiveType: 'slow-2g' } })).toBe('save');
  expect(viewerNetworkTier({ connection: { effectiveType: '3g', downlink: 1.2 } })).toBe('slow');
  // Chromium's throttled "slow 4G" still reports 4g but a 1.5 Mbps downlink.
  expect(viewerNetworkTier({ connection: { effectiveType: '4g', downlink: 1.5, rtt: 150 } })).toBe('slow');
  expect(viewerNetworkTier({ connection: { effectiveType: '4g', downlink: 6, rtt: 350 } })).toBe('slow');
  expect(viewerNetworkTier({ connection: { effectiveType: '4g', downlink: 10, rtt: 50 } })).toBe('fast');
  expect(viewerNetworkTier({ connection: { effectiveType: '4g', downlink: 10, rtt: 0 } })).toBe('normal'); // rtt unknown
  expect(viewerNetworkTier({ connection: { effectiveType: '4g', downlink: 5, rtt: 50 } })).toBe('normal');
  expect(viewerNetworkTier({ deviceMemory: 2, connection: { downlink: 10, rtt: 50 } })).toBe('slow');
});

test('upgrade timing: dwell by tier, at once when zoomed, never automatic with Data Saver', () => {
  expect(upgradeDelay('fast', false)).toBe(0);
  expect(upgradeDelay('normal', false)).toBeGreaterThan(0);
  expect(upgradeDelay('slow', false)).toBeGreaterThan(upgradeDelay('normal', false));
  expect(upgradeDelay('save', false)).toBeNull();
  expect(upgradeDelay('save', true)).toBe(0);
});

test('the first file is the full one only when already loaded or the network is fast', () => {
  expect(initialViewerSource(a, 2400, 'normal', none)).toBe('/a-medium.jpg');
  expect(initialViewerSource(a, 2400, 'fast', none)).toBe('/a-viewer.jpg');
  expect(initialViewerSource(a, 2400, 'slow', (src) => src === '/a-viewer.jpg')).toBe('/a-viewer.jpg');
});

test('prefetch follows the direction of travel and the network', () => {
  const pixels = () => 2400;
  const neighbours = { previous: a, next: c };
  expect(prefetchPlan(neighbours, 1, 'normal', pixels, none)).toEqual(['/c-medium.jpg', '/a-medium.jpg']);
  expect(prefetchPlan(neighbours, -1, 'normal', pixels, none)).toEqual(['/a-medium.jpg', '/c-medium.jpg']);
  // Slow or Data Saver: only the photograph in the direction of travel, at the first size.
  expect(prefetchPlan(neighbours, 1, 'slow', pixels, none)).toEqual(['/c-medium.jpg']);
  expect(prefetchPlan(neighbours, -1, 'save', pixels, none)).toEqual(['/a-medium.jpg']);
  // Fast: the full-size files.
  expect(prefetchPlan(neighbours, 1, 'fast', pixels, none)).toEqual(['/c-viewer.jpg', '/a-viewer.jpg']);
  // Already loaded at either size: nothing to fetch (fast still wants the full file).
  const loaded = (src) => src === '/c-medium.jpg' || src === '/a-viewer.jpg';
  expect(prefetchPlan(neighbours, 1, 'normal', pixels, loaded)).toEqual([]);
  expect(prefetchPlan(neighbours, 1, 'fast', pixels, loaded)).toEqual(['/c-viewer.jpg']);
  // At the ends of the collection.
  expect(prefetchPlan({ previous: null, next: b }, -1, 'slow', pixels, none)).toEqual(['/b-medium.jpg']);
  expect(prefetchPlan({ previous: null, next: null }, 1, 'fast', pixels, none)).toEqual([]);
});
