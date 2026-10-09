// Human-authored public content. Explicit null values suppress extracted metadata.
//
// Array order is the curated sequence of the full collection, with featured frames spread
// through it rather than repeated at the top; `featured` orders the smaller editorial
// selection shown first. Where each original lives is build-only data, kept in
// ../../scripts/photography-sources.mjs so it never ships to the browser.
// Captions stay short and factual: only what the frame or the original caption shows.
export const EXIF_CAPTURE_TIMEZONE = 'America/New_York';

// The opening frame of /photography, chosen for how it carries the title (the lit arch bridge's
// curves and dark sky), not its place in the sequence. The build also preloads it and uses it
// as the page's social preview image.
export const PHOTOGRAPHY_HERO_SLUG = '_DSC0003';

export const PHOTOGRAPHY_CATEGORIES = ['Automotive', 'Places', 'Landscape', 'Nature'];

export const photographOverrides = [
  { id: 'EJUT5331', slug: 'EJUT5331', sourceFilename: 'EJUT5331.PNG', alt: 'Warm reading lamps glowing inside the wood-paneled Rush Rhees Library', caption: 'Rush Rhees Library', shape: 'landscape', category: 'Places', featured: 1 },
  { id: 'IMGP0739', slug: 'IMGP0739', sourceFilename: 'IMGP0739.JPG', alt: 'Layered waterfalls flowing over a rocky cliff in Ithaca', caption: 'Ithaca Falls', shape: 'portrait', category: 'Landscape', tags: ['Water'] },
  { id: 'fog-parking-lot', slug: 'fog-parking-lot', sourceFilename: '_DSC0009.JPG', alt: 'Street lamps glowing through heavy fog over a wet, empty parking lot at night', caption: 'Fog', shape: 'landscape', category: 'Places', tags: ['Night'], featured: 9 },
  { id: 'bridge-lattice', slug: 'bridge-lattice', sourceFilename: '_DSC0019.JPG', alt: 'Riveted steel girders of a bridge converging into a dense lattice, seen from directly beneath', caption: 'Under the bridge', shape: 'portrait', category: 'Places', featured: 2 },
  { id: 'shore-curve', slug: 'shore-curve', sourceFilename: 'DSC09234.JPG', alt: 'The edge of a lake curving away along an empty beach toward a tree line, under a fan of clouds at dusk', caption: 'Lakeshore', shape: 'landscape', category: 'Landscape', tags: ['Dusk', 'Water'], featured: 7 },
  { id: 'suzuki-bandit', slug: 'suzuki-bandit', sourceFilename: 'DSC00358.JPG', alt: 'A red Suzuki Bandit motorcycle parked on its kickstand in front of autumn trees, two helmets resting on its mirrors', caption: 'Suzuki Bandit', shape: 'landscape', category: 'Automotive' },
  { id: 'letchworth-gorge', slug: 'letchworth-gorge', sourceFilename: '_DSC0051.JPG', alt: 'A river bending white through a deep gorge between sheer, layered rock walls', caption: 'Letchworth', shape: 'portrait', category: 'Landscape', tags: ['Water'], featured: 8 },
  { id: 'aero-wheel', slug: 'aero-wheel', sourceFilename: 'DSC00131.JPG', alt: 'A white aero wheel cover on a white car, seen from ground level on a cracked driveway', caption: 'Aero wheel', shape: 'landscape', category: 'Automotive' },
  { id: 'sun-between-trunks', slug: 'sun-between-trunks', sourceFilename: 'DSC00260.JPG', alt: 'The sun setting over a lake, seen through a narrow gap between two dark tree trunks', caption: 'Between trees', shape: 'portrait', category: 'Landscape', tags: ['Dusk', 'Water'] },
  { id: '_DSC0023', slug: '_DSC0023', sourceFilename: '_DSC0023.JPG', alt: 'A church spire rising between brick buildings at Cornell', caption: 'Cornell', shape: 'portrait', category: 'Places' },
  { id: 'neon-window-blue-hour', slug: 'neon-window-blue-hour', sourceFilename: 'DSC00153.JPG', alt: 'A pink neon sign glowing behind closed blinds in a storefront window at blue hour', caption: 'Blue hour', shape: 'landscape', category: 'Places', tags: ['Dusk'] },
  { id: 'lamp-and-tower', slug: 'lamp-and-tower', sourceFilename: 'DSC09311.JPG', alt: 'A glass globe street lamp on a curled iron post, a lattice radio tower rising behind it under a blue sky with white clouds', caption: 'Lamp and tower', shape: 'portrait', category: 'Places' },
  { id: 'red-sun', slug: 'red-sun', sourceFilename: '_DSC0012--3e197f2d.JPG', alt: 'A red sun setting behind bare tree branches above a dark city horizon', caption: 'Red sun', shape: 'landscape', category: 'Landscape', tags: ['Dusk'], featured: 5 },
  { id: 'DIBS2164', slug: 'DIBS2164', sourceFilename: 'DIBS2164.JPG', alt: 'A small bird standing in vivid green grass at Cornell', caption: 'On the grass', shape: 'portrait', category: 'Nature' },
  { id: '_DSC0003', slug: '_DSC0003', sourceFilename: '_DSC0003.JPG', alt: 'A white arch bridge lit up at night over a river, with downtown Rochester towers and their reflections behind it', caption: 'Rochester at night', shape: 'landscape', category: 'Places', tags: ['Night'], featured: 4 },
  { id: 'afterglow-road', slug: 'afterglow-road', sourceFilename: 'DSC00292.JPG', alt: 'A red afterglow sky above a dark road lined with silhouetted trees and power lines, headlights approaching', caption: 'Afterglow', shape: 'landscape', category: 'Places', tags: ['Dusk', 'Night'] },
  { id: 'waves-on-rocks', slug: 'waves-on-rocks', sourceFilename: 'DSC00240.JPG', alt: 'A wave breaking white over dark rocks at the edge of a lake, green plants in the foreground', caption: 'Waves', shape: 'landscape', category: 'Landscape', tags: ['Water'] },
  { id: 'IMG_0758', slug: 'IMG_0758', sourceFilename: 'IMG_0758.JPG', alt: 'A red metal bridge crossing the Genesee River', caption: 'Genesee River', shape: 'portrait', category: 'Places' },
  { id: 'orange-domes-close', slug: 'orange-domes-close', sourceFilename: 'IMGP0717.JPG', alt: 'Glossy orange half-domes receding in a line across a concrete floor beneath a covered walkway', caption: 'Orange domes', shape: 'portrait', category: 'Places', featured: 6 },
  { id: 'shoreline-gold-dusk', slug: 'shoreline-gold-dusk', sourceFilename: '_DSC9077.JPG', alt: 'A band of wet sand catching gold light along a dark beach as waves roll in at dusk', caption: 'Shoreline', shape: 'landscape', category: 'Landscape', tags: ['Dusk', 'Water'], featured: 3 },
  { id: 'bird-in-flight', slug: 'bird-in-flight', sourceFilename: '_DSC0041.JPG', alt: 'A large bird silhouetted mid-flight above bare branches against a pale sky', caption: 'Take-off', shape: 'portrait', category: 'Nature' },
  { id: 'YJMZ4301', slug: 'YJMZ4301', sourceFilename: 'YJMZ4301.PNG', alt: 'A colorful Blue Cactus sign on a brick street at the University of Rochester', caption: 'Blue Cactus', shape: 'landscape', category: 'Places' },
  { id: 'high-falls-mist', slug: 'high-falls-mist', sourceFilename: 'DSC09184.JPG', alt: 'A wide waterfall throwing up mist into a gorge below an old bridge and brick buildings', caption: 'High Falls', shape: 'landscape', category: 'Landscape', tags: ['Water'] },
  { id: 'mill-wheel', slug: 'mill-wheel', sourceFilename: 'DSC09155.JPG', alt: 'A weathered wooden waterwheel set in a narrow stone channel, overgrown with vines and leaves', caption: 'Waterwheel', shape: 'portrait', category: 'Places' },
  { id: 'impreza-fence', slug: 'impreza-fence', sourceFilename: '_DSC0120.JPG', alt: 'The front of a blue Subaru Impreza with a hood scoop, seen through a chain-link fence', caption: 'Subaru Impreza', shape: 'landscape', category: 'Automotive' },
  { id: 'colonnade-steps', slug: 'colonnade-steps', sourceFilename: 'DSC09308.JPG', alt: 'Wide stone steps climbing between two globe-topped columns toward a green-roofed colonnade on a grassy rise, under a deep blue sky', caption: 'Colonnade', shape: 'portrait', category: 'Places' },
  { id: 'IMG_0931', slug: 'IMG_0931', sourceFilename: 'IMG_0931.JPG', alt: 'A vivid pink and purple sunset above silhouetted trees and a parking lot in Rochester', caption: 'Pink sky', shape: 'landscape', category: 'Landscape', tags: ['Dusk'] },
  { id: '_DSC0033', slug: '_DSC0033', sourceFilename: '_DSC0033.JPG', alt: 'Train tracks curving around a bend in the distance', caption: 'The bend', shape: 'portrait', category: 'Places' },
  { id: 'downtown-rochester-dusk', slug: 'downtown-rochester-dusk', sourceFilename: '_DSC0032--c0c129d8.JPG', alt: 'Downtown Rochester towers silhouetted against a pink dusk sky above a band of trees', caption: 'Downtown Rochester', shape: 'portrait', category: 'Places', tags: ['Dusk'] },
  { id: 'streaked-sky', slug: 'streaked-sky', sourceFilename: 'DSC00280.JPG', alt: 'Gold-lit streaks of cloud across a deep blue evening sky above silhouetted street lights and trees', caption: 'Streaked sky', shape: 'landscape', category: 'Landscape', tags: ['Dusk'] },
  { id: 'IMGP0579', slug: 'IMGP0579', sourceFilename: 'IMGP0579.JPG', alt: 'Looking upward through a dense green forest canopy at Bristol Mountain', caption: 'Bristol Mountain', shape: 'portrait', category: 'Nature' },
  { id: 'taughannock-falls', slug: 'taughannock-falls', sourceFilename: 'IMGP0731.JPG', alt: 'A tall, thin waterfall dropping into a dark pool at the head of a deep rock amphitheater, forest along the rim', caption: 'Taughannock Falls', shape: 'portrait', category: 'Landscape', tags: ['Water'], lens: 'smc PENTAX-DA L 18-55mm F3.5-5.6 AL WR' },
  { id: 'DSC00266', slug: 'DSC00266', sourceFilename: 'DSC00266.jpeg', alt: 'Golden sunset above open water with sunlight reflecting across the surface', caption: 'Evening light', shape: 'landscape', category: 'Landscape', tags: ['Dusk', 'Water'] },
  { id: 'nissan-350z', slug: 'nissan-350z', sourceFilename: 'DSC09322.JPG', alt: 'A light blue Nissan 350Z with an aftermarket front bumper at the edge of a lawn beside a row of townhouses, seen from a low angle under a cloudy blue sky', caption: 'Nissan 350Z', shape: 'portrait', category: 'Automotive' },
  { id: 'PBTM8581', slug: 'PBTM8581', sourceFilename: 'PBTM8581.PNG', alt: 'Rush Rhees Library framed by bare winter branches', caption: 'Rush Rhees in winter', shape: 'landscape', category: 'Places' },
  { id: 'NTIO3912', slug: 'NTIO3912', sourceFilename: 'NTIO3912.JPG', alt: 'A narrow stream winding through a sunlit woodland at Cornell', caption: 'Stream', shape: 'portrait', category: 'Nature', tags: ['Water'] },
  { id: 'sundown-streaked-clouds', slug: 'sundown-streaked-clouds', sourceFilename: 'IMGP0594.JPG', alt: 'Streaked clouds lit orange above a lake at sundown, the shoreline trees in silhouette', caption: 'Sundown', shape: 'portrait', category: 'Landscape', tags: ['Dusk', 'Water'] },
  { id: 'TERM5977', slug: 'TERM5977', sourceFilename: 'TERM5977.JPG', alt: 'A stone building overlooking a wide valley at Cornell', caption: 'Stone and valley', shape: 'portrait', category: 'Places' },
  { id: 'IMG_0846', slug: 'IMG_0846', sourceFilename: 'IMG_0846.JPG', alt: 'A white 2011 Subaru WRX parked in a driveway at night', caption: 'Subaru WRX', shape: 'landscape', category: 'Automotive', tags: ['Night'] },
  { id: 'harbor-golden-hour', slug: 'harbor-golden-hour', sourceFilename: 'DSC09202.JPG', alt: 'A white waterfront building and radio mast in late gold light, reflected in rippled blue water', caption: 'Golden hour', shape: 'portrait', category: 'Places', tags: ['Dusk', 'Water'] },
  { id: 'IMG_0776', slug: 'IMG_0776', sourceFilename: 'IMG_0776.JPG', alt: 'The sun meeting a dark lake at the horizon', caption: 'Last light', shape: 'portrait', category: 'Landscape', tags: ['Dusk', 'Water'] },
  { id: 'IMG_0858', slug: 'IMG_0858', sourceFilename: 'IMG_0858.JPG', alt: 'A distant city skyline beyond a misty waterfall at Niagara Falls', caption: 'Niagara Falls', shape: 'portrait', category: 'Landscape', tags: ['Water'] },
  { id: 'beach-cloud-bank', slug: 'beach-cloud-bank', sourceFilename: '_DSC9015.JPG', alt: 'A bank of grey clouds over a wave-washed beach, the wet sand reflecting the pale dusk sky', caption: 'Cloud bank', shape: 'landscape', category: 'Landscape', tags: ['Dusk', 'Water'] },
  { id: 'IMG_0845', slug: 'IMG_0845', sourceFilename: 'IMG_0845.JPG', alt: 'Pink sunset clouds above a calm lakeshore in Irondequoit Bay', caption: 'Irondequoit Bay', shape: 'landscape', category: 'Landscape', tags: ['Dusk', 'Water'] },
  { id: 'IMG_0811', slug: 'IMG_0811', sourceFilename: 'IMG_0811.JPG', alt: 'A broad waterfall surrounded by summer greenery at Rochester Lower Falls', caption: 'Lower Falls', shape: 'landscape', category: 'Landscape', tags: ['Water'] },
].map((record, index) => ({ ...record, curatedOrder: index + 1 }));
