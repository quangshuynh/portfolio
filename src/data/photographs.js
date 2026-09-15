import architectureSpire from '../assets/about/photography/optimized/architecture-spire-web.jpg';
import birdOnLawn from '../assets/about/photography/optimized/bird-on-lawn-web.jpg';
import blueCactusSign from '../assets/about/photography/optimized/blue-cactus-sign-web.jpg';
import forestCanopy from '../assets/about/photography/optimized/forest-canopy-web.jpg';
import hilltopCastle from '../assets/about/photography/optimized/hilltop-castle-web.jpg';
import historicBuilding from '../assets/about/photography/optimized/historic-building-web.jpg';
import horizonSunset from '../assets/about/photography/optimized/horizon-sunset-web.jpg';
import lakesideSunset from '../assets/about/photography/optimized/lakeside-sunset-web.jpg';
import libraryReadingRoom from '../assets/about/photography/optimized/library-reading-room-web.jpg';
import niagaraOverlook from '../assets/about/photography/optimized/niagara-overlook-web.jpg';
import riversideBridge from '../assets/about/photography/optimized/riverside-bridge-web.jpg';
import riversideWaterfall from '../assets/about/photography/optimized/riverside-waterfall-web.jpg';
import waterfallCliffs from '../assets/about/photography/optimized/waterfall-cliffs-web.jpg';
import whiteCarAtNight from '../assets/about/photography/optimized/white-car-at-night-web.jpg';
import woodlandStream from '../assets/about/photography/optimized/woodland-stream-web.jpg';
import pinkSkySunset from '../assets/about/photography/IMG_0931.JPG';
import rochesterSkyline from '../assets/about/photography/rochester-skyline.jpg';
import trainTracks from '../assets/about/photography/around-the-bend.jpg';

// Future ingestion should interpret offset-free EXIF capture times in this IANA zone.
export const EXIF_CAPTURE_TIMEZONE = 'America/New_York';

const records = [
  { id: 'cornell-architecture-spire', slug: 'cornell-architecture-spire', src: architectureSpire, width: 933, height: 1400, alt: 'A church spire rising between brick buildings at Cornell', caption: "Looking up through Cornell's brick architecture", shape: 'portrait', capturedAt: null, curatedOrder: 1 },
  { id: 'cornell-bird-on-lawn', slug: 'cornell-bird-on-lawn', src: birdOnLawn, width: 933, height: 1400, alt: 'A small bird standing in vivid green grass at Cornell', caption: 'A quiet moment on the grass at Cornell', shape: 'portrait', capturedAt: null, curatedOrder: 2 },
  { id: 'rush-rhees-reading-room', slug: 'rush-rhees-reading-room', src: libraryReadingRoom, width: 1400, height: 933, alt: 'Warm reading lamps glowing inside the wood-paneled Rush Rhees Library', caption: 'Warm light inside Rush Rhees Library', shape: 'landscape', capturedAt: null, curatedOrder: 3 },
  { id: 'blue-cactus-rochester', slug: 'blue-cactus-rochester', src: blueCactusSign, width: 1400, height: 933, alt: 'A colorful Blue Cactus sign on a brick street at the University of Rochester', caption: 'A little color at the University of Rochester', shape: 'landscape', capturedAt: null, curatedOrder: 4 },
  { id: 'genesee-red-bridge', slug: 'genesee-red-bridge', src: riversideBridge, width: 1050, height: 1400, alt: 'A red metal bridge crossing the Genesee River', caption: 'Red steel bridge over the Genesee River', shape: 'portrait', capturedAt: null, curatedOrder: 5 },
  { id: 'ithaca-falls', slug: 'ithaca-falls', src: waterfallCliffs, width: 927, height: 1400, alt: 'Layered waterfalls flowing over a rocky cliff in Ithaca', caption: 'Ithaca Falls in the summer', shape: 'portrait', capturedAt: null, curatedOrder: 6 },
  { id: 'rochester-pink-sunset', slug: 'rochester-pink-sunset', src: pinkSkySunset, width: 3648, height: 2736, alt: 'A vivid pink and purple sunset above silhouetted trees and a parking lot in Rochester', caption: 'Pink skies over Rochester at sunset', shape: 'landscape', capturedAt: null, curatedOrder: 7 },
  { id: 'rochester-skyline-at-night', slug: 'rochester-skyline-at-night', src: rochesterSkyline, width: 1400, height: 1050, alt: 'Rochester skyline at night', caption: 'Rochester skyline at night', shape: 'landscape', capturedAt: null, curatedOrder: 8 },
  { id: 'train-tracks-around-the-bend', slug: 'train-tracks-around-the-bend', src: trainTracks, width: 1400, height: 1050, alt: 'Train tracks curving around a bend in the distance', caption: 'Train tracks curving around a bend', shape: 'portrait', capturedAt: null, curatedOrder: 9 },
  { id: 'bristol-mountain-forest-canopy', slug: 'bristol-mountain-forest-canopy', src: forestCanopy, width: 927, height: 1400, alt: 'Looking upward through a dense green forest canopy at Bristol Mountain', caption: 'Looking up through the trees at Bristol Mountain', shape: 'portrait', capturedAt: null, curatedOrder: 10 },
  { id: 'last-light-over-the-water', slug: 'last-light-over-the-water', src: horizonSunset, width: 1050, height: 1400, alt: 'The sun meeting a dark lake at the horizon', caption: 'Watching the last light disappear over the water', shape: 'portrait', capturedAt: null, curatedOrder: 11 },
  { id: 'cornell-woodland-stream', slug: 'cornell-woodland-stream', src: woodlandStream, width: 933, height: 1400, alt: 'A narrow stream winding through a sunlit woodland at Cornell', caption: 'Following a stream through the woods at Cornell', shape: 'portrait', capturedAt: null, curatedOrder: 12 },
  { id: 'rush-rhees-in-winter', slug: 'rush-rhees-in-winter', src: historicBuilding, width: 1400, height: 933, alt: 'Rush Rhees Library framed by bare winter branches', caption: 'Rush Rhees Library through bare winter branches', shape: 'landscape', capturedAt: null, curatedOrder: 13 },
  { id: 'irondequoit-bay-sunset', slug: 'irondequoit-bay-sunset', src: lakesideSunset, width: 1400, height: 1050, alt: 'Pink sunset clouds above a calm lakeshore in Irondequoit Bay', caption: 'Pastel skies over Irondequoit Bay', shape: 'landscape', capturedAt: null, curatedOrder: 14 },
  { id: 'cornell-hilltop-stone-architecture', slug: 'cornell-hilltop-stone-architecture', src: hilltopCastle, width: 933, height: 1400, alt: 'A stone building overlooking a wide valley at Cornell', caption: 'Looking out from Cornell stone architecture', shape: 'portrait', capturedAt: null, curatedOrder: 15 },
  { id: 'niagara-mist-and-skyline', slug: 'niagara-mist-and-skyline', src: niagaraOverlook, width: 1050, height: 1400, alt: 'A distant city skyline beyond a misty waterfall at Niagara Falls', caption: 'Mist and skyline at Niagara Falls', shape: 'portrait', capturedAt: null, curatedOrder: 16 },
  { id: 'rochester-lower-falls', slug: 'rochester-lower-falls', src: riversideWaterfall, width: 1400, height: 1050, alt: 'A broad waterfall surrounded by summer greenery at Rochester Lower Falls', caption: 'Rochester Lower Falls overlook', shape: 'landscape', capturedAt: null, curatedOrder: 17 },
  { id: 'subaru-wrx-after-dark', slug: 'subaru-wrx-after-dark', src: whiteCarAtNight, width: 1400, height: 1050, alt: '2011 Subaru WRX at night', caption: 'My 2011 Subaru WRX after dark', shape: 'landscape', capturedAt: null, curatedOrder: 18 },
];

export const photographs = Object.freeze(records.map((record) => Object.freeze(record)));

export function findPhotograph(slug) {
  return photographs.find((photograph) => photograph.slug === slug) ?? null;
}

export function sortPhotographs(items, sort = 'default') {
  const sorted = [...items];
  if (sort === 'default') return sorted.sort((a, b) => a.curatedOrder - b.curatedOrder);

  const direction = sort === 'oldest' ? 1 : -1;
  return sorted.sort((a, b) => {
    const firstTime = a.capturedAt ? Date.parse(a.capturedAt) : Number.NaN;
    const secondTime = b.capturedAt ? Date.parse(b.capturedAt) : Number.NaN;
    const firstHasDate = Number.isFinite(firstTime);
    const secondHasDate = Number.isFinite(secondTime);

    if (firstHasDate && secondHasDate && firstTime !== secondTime) return (firstTime - secondTime) * direction;
    if (firstHasDate !== secondHasDate) return firstHasDate ? -1 : 1;
    return a.curatedOrder - b.curatedOrder;
  });
}
