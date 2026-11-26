import type { LocationZone, TileKind, WorldObject } from './types';

export const MAP_WIDTH = 80;
export const MAP_HEIGHT = 46;

export const SMALLVILLE_LOCATIONS: LocationZone[] = [
  // District 1: North Ridge (y: 2..12)
  {
    id: 'oak_hill_college',
    name: 'Oak Hill College',
    shortName: 'Oak Hill',
    district: 'North Ridge',
    category: 'college',
    x: 2,
    y: 2,
    w: 15,
    h: 10,
    doorX: 9,
    doorY: 11,
    roofColor: '#4A5D73',
    accentColor: '#3B82F6',
    description:
      'Smallville’s local college campus with a lecture room, research library stacks, and student dorm study desks.',
  },
  {
    id: 'johnson_park',
    name: 'Johnson Park',
    shortName: 'Park',
    district: 'North Ridge',
    category: 'park',
    x: 19,
    y: 2,
    w: 23,
    h: 11,
    doorX: 30,
    doorY: 12,
    roofColor: '#2D6A4F',
    accentColor: '#10B981',
    description:
      'Central town park featuring a stone fountain, wooden footbridge over Willows Creek, flower meadows, and shaded benches.',
  },
  {
    id: 'lin_home',
    name: 'Lin Family Home',
    shortName: 'Lin Home',
    district: 'North Ridge',
    category: 'home',
    x: 44,
    y: 2,
    w: 14,
    h: 10,
    doorX: 50,
    doorY: 11,
    roofColor: '#8B5A3C',
    accentColor: '#D97706',
    description:
      'Warm residence of John, Mei, and Eddy Lin, complete with family kitchen, philosophy study desk, and Eddy’s upright piano.',
  },
  {
    id: 'oakridge_bakery',
    name: 'Oakridge Hilltop Bakery',
    shortName: 'Bakery',
    district: 'North Ridge',
    category: 'cafe',
    x: 60,
    y: 2,
    w: 18,
    h: 10,
    doorX: 68,
    doorY: 11,
    roofColor: '#B45309',
    accentColor: '#F59E0B',
    description:
      'Mateo Silva’s wood-fired artisan bakery supplying Smallville with sourdough loaves, morning croissants, and celebration tortes.',
  },

  // District 2: Main Street Commercial Square (y: 18..27)
  {
    id: 'rose_crown_pub',
    name: 'The Rose & Crown Pub',
    shortName: 'Pub',
    district: 'Main Street',
    category: 'pub',
    x: 2,
    y: 18,
    w: 10,
    h: 10,
    doorX: 6,
    doorY: 18,
    roofColor: '#6B3438',
    accentColor: '#B91C1C',
    description:
      'Cozy neighborhood tavern run by Arthur Burton where neighbors unwind for dinner, drinks, and civic debates.',
  },
  {
    id: 'hobbs_cafe',
    name: 'Hobbs Cafe',
    shortName: 'Hobbs Cafe',
    district: 'Main Street',
    category: 'cafe',
    x: 13,
    y: 18,
    w: 11,
    h: 10,
    doorX: 18,
    doorY: 18,
    roofColor: '#9C4221',
    accentColor: '#EA580C',
    description:
      'Isabella Rodriguez’s bustling espresso and pastry shop — the social crossroads of Smallville.',
  },
  {
    id: 'willows_market',
    name: 'Willows Market & Pharmacy',
    shortName: 'Market',
    district: 'Main Street',
    category: 'shop',
    x: 25,
    y: 18,
    w: 12,
    h: 10,
    doorX: 30,
    doorY: 18,
    roofColor: '#3B6E5C',
    accentColor: '#0D9488',
    description:
      'Corner pharmacy and grocer managed by John Lin, stocking local produce, medicinal remedies, and fresh bouquets.',
  },
  {
    id: 'town_hall',
    name: 'Town Hall & Gazette',
    shortName: 'Town Hall',
    district: 'Main Street',
    category: 'civic',
    x: 38,
    y: 18,
    w: 12,
    h: 10,
    doorX: 43,
    doorY: 18,
    roofColor: '#4F5565',
    accentColor: '#6366F1',
    description:
      'Civic hall, public notice podium, and Smallville Gazette newsroom where town politics and events take shape.',
  },
  {
    id: 'artist_cottages',
    name: 'Artist Cottages',
    shortName: 'Studio',
    district: 'Main Street',
    category: 'home',
    x: 51,
    y: 18,
    w: 12,
    h: 10,
    doorX: 56,
    doorY: 18,
    roofColor: '#6C4F77',
    accentColor: '#9333EA',
    description:
      'Sunlit painting loft and animation studio shared by Abigail Chen and Rajiv Patel.',
  },
  {
    id: 'harvey_library',
    name: 'Harvey Oak Library',
    shortName: 'Library',
    district: 'Main Street',
    category: 'college',
    x: 64,
    y: 18,
    w: 14,
    h: 10,
    doorX: 70,
    doorY: 18,
    roofColor: '#375A7F',
    accentColor: '#2563EB',
    description:
      'Historic brick library curated by Clara Beaumont, housing town archives, quiet reading alcoves, and evening book circles.',
  },

  // District 3: Southside Creek & Workshops (y: 33..42)
  {
    id: 'smallville_clinic',
    name: 'Smallville Clinic & Greenhouse',
    shortName: 'Clinic',
    district: 'Southside Creek',
    category: 'civic',
    x: 2,
    y: 33,
    w: 18,
    h: 10,
    doorX: 10,
    doorY: 33,
    roofColor: '#2B6CB0',
    accentColor: '#0284C7',
    description:
      'Dr. Elena Vance’s welcoming community health clinic paired with a glasshouse apothecary for botanical tinctures.',
  },
  {
    id: 'community_garden',
    name: 'St. Jude Community Plaza & Garden',
    shortName: 'Plaza Garden',
    district: 'Southside Creek',
    category: 'park',
    x: 22,
    y: 33,
    w: 20,
    h: 10,
    doorX: 31,
    doorY: 33,
    roofColor: '#3F7D4E',
    accentColor: '#16A34A',
    description:
      'Lush raised vegetable beds, rain barrels, and a timber market stall overseen by agronomist Priya Nair.',
  },
  {
    id: 'willow_workshop',
    name: 'Willow Workshop & Forge',
    shortName: 'Workshop',
    district: 'Southside Creek',
    category: 'shop',
    x: 44,
    y: 33,
    w: 17,
    h: 10,
    doorX: 52,
    doorY: 33,
    roofColor: '#7C4A2D',
    accentColor: '#C2410C',
    description:
      'Devon Brooks’s carpentry shop and bicycle repair bay crafting timber street lanterns and town furniture.',
  },
  {
    id: 'moore_cottages',
    name: 'Moore & Nair Cottages',
    shortName: 'South Homes',
    district: 'Southside Creek',
    category: 'home',
    x: 63,
    y: 33,
    w: 15,
    h: 10,
    doorX: 69,
    doorY: 33,
    roofColor: '#5B6B5C',
    accentColor: '#4D7C0F',
    description:
      'Quiet tree-lined residential cottages overlooking Southside Meadow where Sam Moore and Priya Nair live.',
  },
];

export const SMALLVILLE_OBJECTS: WorldObject[] = [
  // Oak Hill College
  {
    id: 'obj_college_bookshelf',
    name: 'Sociology & Physics Stacks',
    locationId: 'oak_hill_college',
    tileX: 4,
    tileY: 4,
    kind: 'bookshelf',
    state: 'stocked with research journals',
    defaultState: 'stocked with research journals',
    emoji: '📚',
  },
  {
    id: 'obj_college_desk_klaus',
    name: 'Research Study Table',
    locationId: 'oak_hill_college',
    tileX: 7,
    tileY: 6,
    kind: 'desk',
    state: 'open notebooks on gentrification',
    defaultState: 'open notebooks waiting for students',
    emoji: '📝',
  },
  {
    id: 'obj_college_desk_maria',
    name: 'Physics & Astronomy Terminal',
    locationId: 'oak_hill_college',
    tileX: 13,
    tileY: 6,
    kind: 'desk',
    state: 'running physics & orbital simulations',
    defaultState: 'idle campus workstation',
    emoji: '💻',
  },
  // Johnson Park
  {
    id: 'obj_park_fountain',
    name: 'Town Plaza Fountain',
    locationId: 'johnson_park',
    tileX: 30,
    tileY: 9,
    kind: 'fountain',
    state: 'flowing peacefully',
    defaultState: 'flowing peacefully',
    emoji: '⛲',
  },
  {
    id: 'obj_park_bench_west',
    name: 'Willow Creek Bench',
    locationId: 'johnson_park',
    tileX: 22,
    tileY: 8,
    kind: 'bench',
    state: 'sunlit and quiet',
    defaultState: 'sunlit and quiet',
    emoji: '🪑',
  },
  {
    id: 'obj_park_bench_east',
    name: 'Blossom Grove Bench',
    locationId: 'johnson_park',
    tileX: 38,
    tileY: 8,
    kind: 'bench',
    state: 'surrounded by blossoms',
    defaultState: 'surrounded by blossoms',
    emoji: '🌸',
  },
  // Lin Family Home
  {
    id: 'obj_lin_kitchen',
    name: 'Lin Family Kitchen',
    locationId: 'lin_home',
    tileX: 47,
    tileY: 4,
    kind: 'stove',
    state: 'kettle simmering gently',
    defaultState: 'tidy family kitchen',
    emoji: '🍳',
  },
  {
    id: 'obj_lin_piano',
    name: 'Eddy’s Upright Piano',
    locationId: 'lin_home',
    tileX: 54,
    tileY: 4,
    kind: 'piano',
    state: 'sheet music resting on stand',
    defaultState: 'upright piano closed quietly',
    emoji: '🎹',
  },
  {
    id: 'obj_lin_study',
    name: 'Mei’s Lecture Desk',
    locationId: 'lin_home',
    tileX: 54,
    tileY: 8,
    kind: 'desk',
    state: 'philosophy syllabus open',
    defaultState: 'neat mahogany study desk',
    emoji: '📖',
  },
  // Oakridge Hilltop Bakery
  {
    id: 'obj_bakery_oven',
    name: 'Brick Hearth Bake Oven',
    locationId: 'oakridge_bakery',
    tileX: 63,
    tileY: 4,
    kind: 'oven',
    state: 'crusty sourdough loaves baking warm',
    defaultState: 'stone hearth embers glowing low',
    emoji: '🥖',
  },
  {
    id: 'obj_bakery_counter',
    name: 'Pastry Rack & Glaze Counter',
    locationId: 'oakridge_bakery',
    tileX: 69,
    tileY: 6,
    kind: 'counter',
    state: 'displaying brioche, rye loaves, and berry tarts',
    defaultState: 'timber pastry display rack',
    emoji: '🥐',
  },
  {
    id: 'obj_bakery_table',
    name: 'Bakery Tasting Table',
    locationId: 'oakridge_bakery',
    tileX: 74,
    tileY: 8,
    kind: 'table',
    state: 'warm cinnamon buns & coffee carafes',
    defaultState: 'sunlit corner bread table',
    emoji: '🍞',
  },
  // Rose & Crown Pub
  {
    id: 'obj_pub_bar',
    name: 'Mahogany Bar Counter',
    locationId: 'rose_crown_pub',
    tileX: 5,
    tileY: 21,
    kind: 'bar',
    state: 'glasses polished and ready',
    defaultState: 'mahogany bar counter ready',
    emoji: '🍺',
  },
  {
    id: 'obj_pub_table',
    name: 'Corner Booth Table',
    locationId: 'rose_crown_pub',
    tileX: 9,
    tileY: 24,
    kind: 'table',
    state: 'candlelit evening table',
    defaultState: 'quiet corner booth table',
    emoji: '🕯️',
  },
  // Hobbs Cafe
  {
    id: 'obj_cafe_espresso',
    name: 'Espresso & Pastry Counter',
    locationId: 'hobbs_cafe',
    tileX: 17,
    tileY: 21,
    kind: 'counter',
    state: 'brewing fresh espresso & prepping party banner',
    defaultState: 'espresso machine humming softly',
    emoji: '☕',
  },
  {
    id: 'obj_cafe_table',
    name: 'Window Cafe Table',
    locationId: 'hobbs_cafe',
    tileX: 21,
    tileY: 24,
    kind: 'table',
    state: 'fresh croissants on tray',
    defaultState: 'sunlit window table',
    emoji: '🥐',
  },
  // Willows Market & Pharmacy
  {
    id: 'obj_market_counter',
    name: 'Pharmacy & Supply Counter',
    locationId: 'willows_market',
    tileX: 30,
    tileY: 21,
    kind: 'register',
    state: 'open for neighbors',
    defaultState: 'pharmacy counter tidy',
    emoji: '💊',
  },
  {
    id: 'obj_market_shelves',
    name: 'Groceries & Bouquet Display',
    locationId: 'willows_market',
    tileX: 28,
    tileY: 25,
    kind: 'table',
    state: 'fresh roses and pantry goods stocked',
    defaultState: 'fresh produce and bouquets stocked',
    emoji: '💐',
  },
  // Town Hall
  {
    id: 'obj_hall_podium',
    name: 'Civic Podium & Board',
    locationId: 'town_hall',
    tileX: 43,
    tileY: 21,
    kind: 'podium',
    state: 'election notices pinned to board',
    defaultState: 'civic board displaying notices',
    emoji: '🏛️',
  },
  {
    id: 'obj_hall_gazette',
    name: 'Smallville Gazette Press Desk',
    locationId: 'town_hall',
    tileX: 46,
    tileY: 24,
    kind: 'desk',
    state: 'drafting front-page town notes',
    defaultState: 'typewriter and press proofs ready',
    emoji: '🗞️',
  },
  // Artist Cottages
  {
    id: 'obj_studio_easel',
    name: 'Painting Easel & Canvas',
    locationId: 'artist_cottages',
    tileX: 55,
    tileY: 22,
    kind: 'easel',
    state: 'half-finished Smallville oil canvas',
    defaultState: 'sunlit canvas on wooden easel',
    emoji: '🎨',
  },
  {
    id: 'obj_studio_desk',
    name: 'Animation Drafting Desk',
    locationId: 'artist_cottages',
    tileX: 59,
    tileY: 24,
    kind: 'desk',
    state: 'storyboards and lightbox active',
    defaultState: 'neat drawing lightbox desk',
    emoji: '✏️',
  },
  // Harvey Oak Library
  {
    id: 'obj_library_archive',
    name: 'Town History Oak Archives',
    locationId: 'harvey_library',
    tileX: 67,
    tileY: 21,
    kind: 'archive',
    state: 'cataloging Smallville parish ledgers',
    defaultState: 'tall oak bookshelves neatly indexed',
    emoji: '🗂️',
  },
  {
    id: 'obj_library_desk',
    name: 'Reading Alcove Table',
    locationId: 'harvey_library',
    tileX: 73,
    tileY: 24,
    kind: 'desk',
    state: 'brass reading lamps lit for visitors',
    defaultState: 'quiet walnut reading table',
    emoji: '📖',
  },
  // Smallville Clinic & Greenhouse
  {
    id: 'obj_clinic_exam',
    name: 'Clinic Wellness Exam Bay',
    locationId: 'smallville_clinic',
    tileX: 6,
    tileY: 36,
    kind: 'medical',
    state: 'stethoscope and charts prepared for patients',
    defaultState: 'sanitized medical exam station',
    emoji: '🩺',
  },
  {
    id: 'obj_clinic_apothecary',
    name: 'Medicinal Herb Greenhouse Bench',
    locationId: 'smallville_clinic',
    tileX: 14,
    tileY: 37,
    kind: 'counter',
    state: 'drying chamomile & peppermint bundles',
    defaultState: 'potted medicinal herbs arranged neatly',
    emoji: '🌿',
  },
  // Community Plaza & Garden
  {
    id: 'obj_garden_beds',
    name: 'Raised Heirloom Vegetable Beds',
    locationId: 'community_garden',
    tileX: 26,
    tileY: 37,
    kind: 'garden',
    state: 'heirloom greens irrigated and thriving',
    defaultState: 'loamy raised beds tending winter crops',
    emoji: '🌱',
  },
  {
    id: 'obj_garden_stall',
    name: 'Weekend Harvest Market Stall',
    locationId: 'community_garden',
    tileX: 36,
    tileY: 36,
    kind: 'counter',
    state: 'baskets arranged for the town harvest table',
    defaultState: 'timber market stall awning',
    emoji: '🧺',
  },
  // Willow Workshop & Forge
  {
    id: 'obj_workshop_bench',
    name: 'Carpentry Joinery Bench',
    locationId: 'willow_workshop',
    tileX: 48,
    tileY: 36,
    kind: 'workbench',
    state: 'planing cedar lantern posts for Johnson Park',
    defaultState: 'maple workbench with planes and chisels',
    emoji: '🪚',
  },
  {
    id: 'obj_workshop_bikerack',
    name: 'Town Bicycle Tune-Up Stand',
    locationId: 'willow_workshop',
    tileX: 55,
    tileY: 38,
    kind: 'workbench',
    state: 'spokes & brass bells lined for maintenance',
    defaultState: 'clean bike repair hoist',
    emoji: '🚲',
  },
  // Moore & Nair Cottages
  {
    id: 'obj_moore_desk',
    name: 'Sam’s Civic Drafting Desk',
    locationId: 'moore_cottages',
    tileX: 67,
    tileY: 36,
    kind: 'desk',
    state: 'reviewing park lantern budgets & campaign notes',
    defaultState: 'home oak study desk',
    emoji: '📋',
  },
  {
    id: 'obj_moore_porch',
    name: 'Southside Meadow Porch Table',
    locationId: 'moore_cottages',
    tileX: 73,
    tileY: 38,
    kind: 'table',
    state: 'herbal tea mugs & seed catalogs',
    defaultState: 'quiet shaded porch table',
    emoji: '🍵',
  },
  // Residential Sleeping Quarters Beds inside Mixed-Use Buildings
  {
    id: 'obj_college_dorm_bed',
    name: 'Student Dormitory Bunk',
    locationId: 'oak_hill_college',
    tileX: 14,
    tileY: 8,
    kind: 'bed',
    state: 'neatly tucked quilt on dorm bunk',
    defaultState: 'neatly tucked quilt on dorm bunk',
    emoji: '🛏️',
  },
  {
    id: 'obj_bakery_bed',
    name: 'Baker’s Loft Bed',
    locationId: 'oakridge_bakery',
    tileX: 75,
    tileY: 4,
    kind: 'bed',
    state: 'warm flour-dusted quilt upstairs',
    defaultState: 'warm flour-dusted quilt upstairs',
    emoji: '🛏️',
  },
  {
    id: 'obj_pub_bed',
    name: 'Innkeeper’s Upstairs Bed',
    locationId: 'rose_crown_pub',
    tileX: 9,
    tileY: 20,
    kind: 'bed',
    state: 'quiet innkeeper bed above the tavern',
    defaultState: 'quiet innkeeper bed above the tavern',
    emoji: '🛏️',
  },
  {
    id: 'obj_cafe_bed',
    name: 'Hobbs Apartment Bed',
    locationId: 'hobbs_cafe',
    tileX: 15,
    tileY: 24,
    kind: 'bed',
    state: 'soft linen quilt above the cafe',
    defaultState: 'soft linen quilt above the cafe',
    emoji: '🛏️',
  },
  {
    id: 'obj_hall_bed',
    name: 'Reporter’s Cot at Town Hall',
    locationId: 'town_hall',
    tileX: 40,
    tileY: 24,
    kind: 'bed',
    state: 'tidy folding cot beside Gazette press files',
    defaultState: 'tidy folding cot beside Gazette press files',
    emoji: '🛏️',
  },
  {
    id: 'obj_library_bed',
    name: 'Librarian’s Study Quarters Bed',
    locationId: 'harvey_library',
    tileX: 74,
    tileY: 20,
    kind: 'bed',
    state: 'reading blanket folded by the alcove bed',
    defaultState: 'reading blanket folded by the alcove bed',
    emoji: '🛏️',
  },
  {
    id: 'obj_clinic_bed',
    name: 'Physician’s Quarters Bed',
    locationId: 'smallville_clinic',
    tileX: 16,
    tileY: 39,
    kind: 'bed',
    state: 'crisp cotton sheets in clinic quarters',
    defaultState: 'crisp cotton sheets in clinic quarters',
    emoji: '🛏️',
  },
  {
    id: 'obj_workshop_bed',
    name: 'Workshop Loft Bunk',
    locationId: 'willow_workshop',
    tileX: 57,
    tileY: 35,
    kind: 'bed',
    state: 'cedar-framed loft bunk in quiet corner',
    defaultState: 'cedar-framed loft bunk in quiet corner',
    emoji: '🛏️',
  },
];

export function buildSmallvilleTiles(): TileKind[][] {
  const tiles: TileKind[][] = Array.from({ length: MAP_HEIGHT }, () =>
    Array.from({ length: MAP_WIDTH }, () => 'grass' as TileKind),
  );

  const fillRect = (
    x: number,
    y: number,
    w: number,
    h: number,
    kind: TileKind,
  ) => {
    for (let ry = y; ry < y + h; ry++) {
      for (let rx = x; rx < x + w; rx++) {
        if (ry >= 0 && ry < MAP_HEIGHT && rx >= 0 && rx < MAP_WIDTH) {
          tiles[ry][rx] = kind;
        }
      }
    }
  };

  // Main Street (horizontal cobblestone avenue + sidewalks)
  fillRect(1, 12, MAP_WIDTH - 2, 2, 'path'); // North ridge promenade & upper sidewalk
  fillRect(1, 14, MAP_WIDTH - 2, 2, 'road'); // Main Street roadway
  fillRect(1, 16, MAP_WIDTH - 2, 2, 'path'); // Lower Main St sidewalk & Commercial Square promenade

  // South Lane (connects Mid-Town to Southside Creek District)
  fillRect(1, 28, MAP_WIDTH - 2, 2, 'path'); // South Commercial walk
  fillRect(1, 30, MAP_WIDTH - 2, 1, 'road'); // South Lane roadway
  fillRect(1, 31, MAP_WIDTH - 2, 2, 'path'); // Southside Creek promenade

  // North District vertical lanes
  fillRect(1, 2, 1, 41, 'path'); // Outer West trail
  fillRect(17, 2, 2, 11, 'path'); // Oak Hill <-> Johnson Park avenue
  fillRect(42, 2, 2, 11, 'path'); // Johnson Park <-> Lin Home avenue
  fillRect(58, 2, 2, 11, 'path'); // Lin Home <-> Bakery avenue
  fillRect(78, 2, 1, 41, 'path'); // Outer East trail

  // Mid-Town vertical alleys connecting Main Street (y=17) to South Lane (y=28)
  fillRect(12, 17, 1, 12, 'path');
  fillRect(24, 17, 1, 12, 'path');
  fillRect(37, 17, 1, 12, 'path');
  fillRect(50, 17, 1, 12, 'path');
  fillRect(63, 17, 1, 12, 'path');

  // Southside vertical lanes
  fillRect(20, 32, 2, 11, 'path'); // Clinic <-> Community Plaza
  fillRect(42, 32, 2, 11, 'path'); // Community Plaza <-> Workshop
  fillRect(61, 32, 2, 11, 'path'); // Workshop <-> South Cottages

  // Johnson Park interiors (paths, creek pond, bridge, trees, flowers)
  fillRect(19, 2, 23, 10, 'grass');
  fillRect(19, 12, 23, 1, 'path');
  fillRect(29, 3, 3, 10, 'path'); // Central N-S park promenade
  fillRect(20, 8, 21, 1, 'path'); // E-W park bench path

  // Willows Creek Pond & Wooden Bridge in Johnson Park
  fillRect(23, 4, 15, 2, 'water');
  fillRect(29, 4, 3, 2, 'bridge');

  // St. Jude Community Plaza & Garden walkable walkways
  fillRect(22, 33, 20, 10, 'grass');
  fillRect(30, 33, 3, 10, 'path');
  fillRect(23, 36, 18, 2, 'path');

  // Park & Southside trees & flowers
  const parkTrees: Array<[number, number]> = [
    [20, 3],
    [40, 3],
    [20, 10],
    [40, 10],
    [25, 10],
    [35, 10],
    [23, 34],
    [40, 34],
    [23, 41],
    [40, 41],
    [10, 44],
    [31, 44],
    [52, 44],
    [70, 44],
    [1, 1],
    [78, 1],
  ];
  for (const [tx, ty] of parkTrees) {
    if (tiles[ty]?.[tx]) tiles[ty][tx] = 'tree';
  }

  const flowers: Array<[number, number]> = [
    [21, 7],
    [24, 7],
    [36, 7],
    [39, 7],
    [27, 10],
    [33, 10],
    [24, 39],
    [28, 39],
    [35, 39],
    [38, 39],
    [17, 11],
    [58, 11],
  ];
  for (const [fx, fy] of flowers) {
    if (tiles[fy]?.[fx]) tiles[fy][fx] = 'flower';
  }

  // Stamp all enclosed buildings with walls, floor, and door
  const buildStructure = (loc: LocationZone, floorKind: TileKind) => {
    fillRect(loc.x, loc.y, loc.w, loc.h, 'wall');
    fillRect(loc.x + 1, loc.y + 1, loc.w - 2, loc.h - 2, floorKind);
    tiles[loc.doorY][loc.doorX] = 'door';
    if (loc.doorY === loc.y + loc.h - 1 && tiles[loc.doorY + 1]?.[loc.doorX]) {
      tiles[loc.doorY + 1][loc.doorX] = 'path';
    } else if (loc.doorY === loc.y && tiles[loc.doorY - 1]?.[loc.doorX]) {
      tiles[loc.doorY - 1][loc.doorX] = 'path';
    }
  };

  for (const loc of SMALLVILLE_LOCATIONS) {
    if (loc.category === 'park') continue;
    const floor: TileKind =
      loc.category === 'cafe' || loc.category === 'home' || loc.category === 'pub'
        ? 'floor_wood'
        : loc.category === 'civic'
          ? 'floor_stone'
          : 'floor_tile';
    buildStructure(loc, floor);
  }

  return tiles;
}

export function getLocationAt(
  locations: LocationZone[],
  x: number,
  y: number,
): LocationZone | undefined {
  const rx = Math.round(x);
  const ry = Math.round(y);
  return locations.find(
    (loc) => rx >= loc.x && rx < loc.x + loc.w && ry >= loc.y && ry < loc.y + loc.h,
  );
}

export function getAreaLabelAt(
  locations: LocationZone[],
  x: number,
  y: number,
): string {
  const loc = getLocationAt(locations, x, y);
  if (loc) return loc.name;
  const ry = Math.round(y);
  if (ry <= 13) return 'North Ridge Path';
  if (ry <= 15) return 'Main Street';
  if (ry <= 17) return 'Main Street Walk';
  if (ry <= 28) return 'Main Street Alley';
  if (ry <= 32) return 'South Lane';
  return 'Southside Trail';
}

export function hasLineOfSightOverTiles(
  tiles: TileKind[][],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): boolean {
  let x = Math.round(x1);
  let y = Math.round(y1);
  const tx = Math.round(x2);
  const ty = Math.round(y2);
  const dx = Math.abs(tx - x);
  const dy = Math.abs(ty - y);
  const sx = x < tx ? 1 : -1;
  const sy = y < ty ? 1 : -1;
  let err = dx - dy;

  while (true) {
    const tile = tiles[y]?.[x];
    if (!tile || tile === 'wall') {
      return false;
    }
    if (x === tx && y === ty) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return true;
}
