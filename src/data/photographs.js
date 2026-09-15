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
import rochesterSkyline from '../assets/about/photography/_DSC0003.JPG';
import trainTracks from '../assets/about/photography/_DSC0033.JPG';

// Future ingestion should interpret offset-free EXIF capture times in this IANA zone.
export const EXIF_CAPTURE_TIMEZONE = 'America/New_York';

const records = [
  { id: '_DSC0023', slug: '_DSC0023', sourceFilename: '_DSC0023.JPG', src: architectureSpire, width: 933, height: 1400, alt: 'A church spire rising between brick buildings at Cornell', caption: "Looking up through Cornell's brick architecture", shape: 'portrait', capturedAt: null, curatedOrder: 1 },
  { id: 'DIBS2164', slug: 'DIBS2164', sourceFilename: 'DIBS2164.JPG', src: birdOnLawn, width: 933, height: 1400, alt: 'A small bird standing in vivid green grass at Cornell', caption: 'A quiet moment on the grass at Cornell', shape: 'portrait', capturedAt: null, curatedOrder: 2 },
  { id: 'EJUT5331', slug: 'EJUT5331', sourceFilename: 'EJUT5331.PNG', src: libraryReadingRoom, width: 1400, height: 933, alt: 'Warm reading lamps glowing inside the wood-paneled Rush Rhees Library', caption: 'Warm light inside Rush Rhees Library', shape: 'landscape', capturedAt: null, curatedOrder: 3 },
  { id: 'YJMZ4301', slug: 'YJMZ4301', sourceFilename: 'YJMZ4301.PNG', src: blueCactusSign, width: 1400, height: 933, alt: 'A colorful Blue Cactus sign on a brick street at the University of Rochester', caption: 'A little color at the University of Rochester', shape: 'landscape', capturedAt: null, curatedOrder: 4 },
  { id: 'IMG_0758', slug: 'IMG_0758', sourceFilename: 'IMG_0758.JPG', src: riversideBridge, width: 1050, height: 1400, alt: 'A red metal bridge crossing the Genesee River', caption: 'Red steel bridge over the Genesee River', shape: 'portrait', capturedAt: null, curatedOrder: 5 },
  { id: 'IMGP0739', slug: 'IMGP0739', sourceFilename: 'IMGP0739.JPG', src: waterfallCliffs, width: 927, height: 1400, alt: 'Layered waterfalls flowing over a rocky cliff in Ithaca', caption: 'Ithaca Falls in the summer', shape: 'portrait', capturedAt: null, curatedOrder: 6 },
  { id: 'IMG_0931', slug: 'IMG_0931', sourceFilename: 'IMG_0931.JPG', src: pinkSkySunset, width: 3648, height: 2736, alt: 'A vivid pink and purple sunset above silhouetted trees and a parking lot in Rochester', caption: 'Pink skies over Rochester at sunset', shape: 'landscape', capturedAt: null, curatedOrder: 7 },
  { id: '_DSC0003', slug: '_DSC0003', sourceFilename: '_DSC0003.JPG', src: rochesterSkyline, width: 4608, height: 3072, alt: 'Rochester skyline at night', caption: 'Rochester skyline at night', shape: 'landscape', capturedAt: null, curatedOrder: 8 },
  { id: '_DSC0033', slug: '_DSC0033', sourceFilename: '_DSC0033.JPG', src: trainTracks, width: 3072, height: 4608, alt: 'Train tracks curving around a bend in the distance', caption: 'Train tracks curving around a bend', shape: 'portrait', capturedAt: null, curatedOrder: 9 },
  { id: 'IMGP0579', slug: 'IMGP0579', sourceFilename: 'IMGP0579.JPG', src: forestCanopy, width: 927, height: 1400, alt: 'Looking upward through a dense green forest canopy at Bristol Mountain', caption: 'Looking up through the trees at Bristol Mountain', shape: 'portrait', capturedAt: null, curatedOrder: 10 },
  { id: 'IMG_0776', slug: 'IMG_0776', sourceFilename: 'IMG_0776.JPG', src: horizonSunset, width: 1050, height: 1400, alt: 'The sun meeting a dark lake at the horizon', caption: 'Watching the last light disappear over the water', shape: 'portrait', capturedAt: null, curatedOrder: 11 },
  { id: 'NTIO3912', slug: 'NTIO3912', sourceFilename: 'NTIO3912.JPG', src: woodlandStream, width: 933, height: 1400, alt: 'A narrow stream winding through a sunlit woodland at Cornell', caption: 'Following a stream through the woods at Cornell', shape: 'portrait', capturedAt: null, curatedOrder: 12 },
  { id: 'PBTM8581', slug: 'PBTM8581', sourceFilename: 'PBTM8581.PNG', src: historicBuilding, width: 1400, height: 933, alt: 'Rush Rhees Library framed by bare winter branches', caption: 'Rush Rhees Library through bare winter branches', shape: 'landscape', capturedAt: null, curatedOrder: 13 },
  { id: 'IMG_0845', slug: 'IMG_0845', sourceFilename: 'IMG_0845.JPG', src: lakesideSunset, width: 1400, height: 1050, alt: 'Pink sunset clouds above a calm lakeshore in Irondequoit Bay', caption: 'Pastel skies over Irondequoit Bay', shape: 'landscape', capturedAt: null, curatedOrder: 14 },
  { id: 'TERM5977', slug: 'TERM5977', sourceFilename: 'TERM5977.JPG', src: hilltopCastle, width: 933, height: 1400, alt: 'A stone building overlooking a wide valley at Cornell', caption: 'Looking out from Cornell stone architecture', shape: 'portrait', capturedAt: null, curatedOrder: 15 },
  { id: 'IMG_0858', slug: 'IMG_0858', sourceFilename: 'IMG_0858.JPG', src: niagaraOverlook, width: 1050, height: 1400, alt: 'A distant city skyline beyond a misty waterfall at Niagara Falls', caption: 'Mist and skyline at Niagara Falls', shape: 'portrait', capturedAt: null, curatedOrder: 16 },
  { id: 'IMG_0811', slug: 'IMG_0811', sourceFilename: 'IMG_0811.JPG', src: riversideWaterfall, width: 1400, height: 1050, alt: 'A broad waterfall surrounded by summer greenery at Rochester Lower Falls', caption: 'Rochester Lower Falls overlook', shape: 'landscape', capturedAt: null, curatedOrder: 17 },
  { id: 'IMG_0846', slug: 'IMG_0846', sourceFilename: 'IMG_0846.JPG', src: whiteCarAtNight, width: 1400, height: 1050, alt: '2011 Subaru WRX at night', caption: 'My 2011 Subaru WRX after dark', shape: 'landscape', capturedAt: null, curatedOrder: 18 },
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
