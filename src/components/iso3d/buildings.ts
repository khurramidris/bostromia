import * as THREE from 'three';
import type { LocationZone, WorldObject } from '../../simulation/types';
import type { ProceduralTextures } from './textures';

export interface BuildingEntry {
  locationId: string;
  root: THREE.Group;
  exteriorShell: THREE.Group;
  hitProxy: THREE.Mesh;
  baseShellY: number;
  currentCutaway: number; // 0 = closed roof, 1 = open cutaway
}

export interface LotOverlayEntry {
  locationId: string;
  fillMesh: THREE.Mesh;
  fillMat: THREE.MeshBasicMaterial;
  borderLine: THREE.LineLoop;
  borderMat: THREE.LineBasicMaterial;
}

export interface BuiltArchitecture {
  group: THREE.Group;
  buildings: Map<string, BuildingEntry>;
  lotOverlays: Map<string, LotOverlayEntry>;
  hitProxies: THREE.Mesh[];
  windowGlassMat: THREE.MeshStandardMaterial;
  warmLampMat: THREE.MeshStandardMaterial;
  applyLotOverlays: (
    overlays: Record<string, { colorHex: string; intensity: number }>,
    selectedLocId: string | null,
    hoveredLocId: string | null,
    elapsed: number,
  ) => void;
  dispose: () => void;
}

interface BuildingPalette {
  wall: number;
  trim: number;
  roof: number;
  accent: number;
  stories: number;
  roofStyle: 'pitched' | 'modern' | 'pediment' | 'mansard' | 'studio';
  awning?: 'warm' | 'green' | 'blue';
}

// Curated Designopolis-inspired architectural palette per landmark
const LANDMARK_PALETTES: Record<string, BuildingPalette> = {
  oak_hill_college: {
    wall: 0xeee5d5,
    trim: 0xd4c6b0,
    roof: 0x4c6b8a,
    accent: 0x3b82f6,
    stories: 2,
    roofStyle: 'modern',
  },
  lin_home: {
    wall: 0xf6e6cf,
    trim: 0xe3cfb2,
    roof: 0xc96b45,
    accent: 0xe89a3c,
    stories: 1,
    roofStyle: 'pitched',
  },
  oakridge_bakery: {
    wall: 0xf7e1c4,
    trim: 0xe8c49a,
    roof: 0xd97536,
    accent: 0xf59e0b,
    stories: 1,
    roofStyle: 'mansard',
    awning: 'warm',
  },
  rose_crown_pub: {
    wall: 0xe8d8c8,
    trim: 0x734436,
    roof: 0x8f3d3e,
    accent: 0xd9483b,
    stories: 2,
    roofStyle: 'pitched',
  },
  hobbs_cafe: {
    wall: 0xfbf0dc,
    trim: 0xe3c39d,
    roof: 0xe0643a,
    accent: 0xf6a623,
    stories: 1,
    roofStyle: 'modern',
    awning: 'warm',
  },
  willows_market: {
    wall: 0xe5f0e6,
    trim: 0xc7dcc9,
    roof: 0x3f8f6d,
    accent: 0x10b981,
    stories: 1,
    roofStyle: 'modern',
    awning: 'green',
  },
  town_hall: {
    wall: 0xf4f0e8,
    trim: 0xd9d2c5,
    roof: 0x456b7a,
    accent: 0x6366f1,
    stories: 2,
    roofStyle: 'pediment',
  },
  artist_cottages: {
    wall: 0xf2e4ee,
    trim: 0xdcc5d8,
    roof: 0x8e6699,
    accent: 0xa855f7,
    stories: 1,
    roofStyle: 'studio',
    awning: 'blue',
  },
  harvey_library: {
    wall: 0xeae0d2,
    trim: 0xcbbba6,
    roof: 0x3b658c,
    accent: 0x2563eb,
    stories: 2,
    roofStyle: 'pitched',
  },
  smallville_clinic: {
    wall: 0xf5f8fa,
    trim: 0xd5e3ec,
    roof: 0x3b8ac4,
    accent: 0x0ea5e9,
    stories: 1,
    roofStyle: 'modern',
    awning: 'blue',
  },
  willow_workshop: {
    wall: 0xead7c0,
    trim: 0x9b6542,
    roof: 0x9e5435,
    accent: 0xd97706,
    stories: 1,
    roofStyle: 'pitched',
  },
  moore_cottages: {
    wall: 0xeef2e2,
    trim: 0xd2dcc0,
    roof: 0x5c8556,
    accent: 0x65a30d,
    stories: 1,
    roofStyle: 'pitched',
  },
};

function getPaletteForLocation(loc: LocationZone): BuildingPalette {
  if (LANDMARK_PALETTES[loc.id]) return LANDMARK_PALETTES[loc.id];
  const color = new THREE.Color(loc.roofColor || '#6B7280').getHex();
  const accent = new THREE.Color(loc.accentColor || '#3B82F6').getHex();
  return {
    wall: 0xf3ede1,
    trim: 0xd8cfc0,
    roof: color,
    accent,
    stories: loc.category === 'civic' || loc.category === 'college' ? 2 : 1,
    roofStyle: loc.category === 'home' ? 'pitched' : 'modern',
  };
}

function buildInteriorFurnitureMesh(
  obj: WorldObject,
  geosToDispose: THREE.BufferGeometry[],
  matsToDispose: THREE.Material[],
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(obj.tileX + 0.5, 0.14, obj.tileY + 0.5);

  const trackGeo = <T extends THREE.BufferGeometry>(geo: T): T => {
    geosToDispose.push(geo);
    return geo;
  };
  const makeMat = (color: number, roughness = 0.72, metalness = 0.05) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    matsToDispose.push(m);
    return m;
  };

  switch (obj.kind) {
    case 'fountain': {
      // Handled in worldProps for grand outdoor fountain
      break;
    }
    case 'bed': {
      const frame = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.84, 0.22, 0.86)), makeMat(0x7c5033, 0.78));
      frame.position.y = 0.11;
      const mattress = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.76, 0.16, 0.78)), makeMat(0xf8f6f0, 0.9));
      mattress.position.y = 0.26;
      const blanket = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.78, 0.12, 0.48)), makeMat(0x3a7d60, 0.88));
      blanket.position.set(0, 0.3, 0.14);
      const pillow = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.56, 0.1, 0.2)), makeMat(0xffffff, 0.92));
      pillow.position.set(0, 0.37, -0.24);
      g.add(frame, mattress, blanket, pillow);
      break;
    }
    case 'piano': {
      const body = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.86, 0.68, 0.46)), makeMat(0x23272a, 0.22, 0.15));
      body.position.set(0, 0.34, -0.1);
      const keys = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.76, 0.08, 0.24)), makeMat(0xfaf8f4, 0.35));
      keys.position.set(0, 0.42, 0.18);
      const stool = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.16, 0.18, 0.26, 8)), makeMat(0x4a3426, 0.7));
      stool.position.set(0, 0.13, 0.38);
      g.add(body, keys, stool);
      break;
    }
    case 'bookshelf':
    case 'archive': {
      const shelf = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.82, 0.92, 0.36)), makeMat(0x764c2e, 0.76));
      shelf.position.y = 0.46;
      const row1 = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.68, 0.16, 0.28)), makeMat(0xc84b31, 0.65));
      row1.position.set(0, 0.66, 0.06);
      const row2 = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.68, 0.16, 0.28)), makeMat(0x2d6aa3, 0.65));
      row2.position.set(0, 0.42, 0.06);
      const row3 = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.68, 0.16, 0.28)), makeMat(0x2f855a, 0.65));
      row3.position.set(0, 0.18, 0.06);
      g.add(shelf, row1, row2, row3);
      break;
    }
    case 'counter':
    case 'bar':
    case 'register': {
      const base = new THREE.Mesh(
        trackGeo(new THREE.BoxGeometry(0.92, 0.56, 0.52)),
        makeMat(obj.kind === 'bar' ? 0x623925 : 0x8a5b3b, 0.72),
      );
      base.position.y = 0.28;
      const top = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.96, 0.08, 0.58)), makeMat(0xf2e7d5, 0.4));
      top.position.y = 0.6;
      const machine = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.24, 0.2, 0.2)), makeMat(0xb8c2cc, 0.28, 0.65));
      machine.position.set(0.18, 0.74, 0);
      g.add(base, top, machine);
      break;
    }
    case 'oven': {
      const hearth = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.86, 0.8, 0.74)), makeMat(0x9a4829, 0.85));
      hearth.position.y = 0.4;
      const dome = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.24, 0.36, 0.36, 8)), makeMat(0x7c371f, 0.88));
      dome.position.y = 0.94;
      const fire = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.36, 0.24, 0.08)), makeMat(0xff9f1c, 0.3));
      fire.position.set(0, 0.42, 0.36);
      g.add(hearth, dome, fire);
      break;
    }
    case 'easel': {
      const leg = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.1, 0.84, 0.1)), makeMat(0x7c5332, 0.78));
      leg.position.y = 0.42;
      const canvas = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.56, 0.44, 0.06)), makeMat(0xfdfbf7, 0.88));
      canvas.position.set(0, 0.62, 0.08);
      canvas.rotation.x = -0.15;
      const paint = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.4, 0.26, 0.07)), makeMat(0x3a9470, 0.65));
      paint.position.set(0, 0.62, 0.09);
      paint.rotation.x = -0.15;
      g.add(leg, canvas, paint);
      break;
    }
    case 'medical': {
      const cab = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.76, 0.64, 0.5)), makeMat(0xf8fafc, 0.35));
      cab.position.y = 0.32;
      const crossV = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.12, 0.32, 0.06)), makeMat(0x0284c7, 0.4));
      crossV.position.set(0, 0.42, 0.26);
      const crossH = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.32, 0.12, 0.06)), makeMat(0x0284c7, 0.4));
      crossH.position.set(0, 0.42, 0.26);
      g.add(cab, crossV, crossH);
      break;
    }
    case 'garden': {
      const box = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.88, 0.24, 0.84)), makeMat(0x7a5136, 0.86));
      box.position.y = 0.12;
      const soil = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.76, 0.08, 0.72)), makeMat(0x4b3526, 0.95));
      soil.position.y = 0.24;
      const bush1 = new THREE.Mesh(trackGeo(new THREE.DodecahedronGeometry(0.18, 0)), makeMat(0x3e9e4c, 0.82));
      bush1.position.set(-0.18, 0.38, -0.1);
      const bush2 = new THREE.Mesh(trackGeo(new THREE.DodecahedronGeometry(0.16, 0)), makeMat(0x5bbf56, 0.82));
      bush2.position.set(0.18, 0.36, 0.12);
      g.add(box, soil, bush1, bush2);
      break;
    }
    case 'bench': {
      const seat = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.86, 0.1, 0.36)), makeMat(0x9a643b, 0.78));
      seat.position.y = 0.26;
      const back = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.86, 0.26, 0.08)), makeMat(0x82512d, 0.8));
      back.position.set(0, 0.42, -0.15);
      const legL = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.08, 0.26, 0.32)), makeMat(0x3a3f45, 0.45, 0.5));
      legL.position.set(-0.34, 0.13, 0);
      const legR = legL.clone();
      legR.position.x = 0.34;
      g.add(seat, back, legL, legR);
      break;
    }
    default: {
      // Desk / table / workbench
      const top = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.78, 0.08, 0.58)), makeMat(0xa5744a, 0.68));
      top.position.y = 0.46;
      const base = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.66, 0.44, 0.46)), makeMat(0x7c5334, 0.78));
      base.position.y = 0.22;
      const paper = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.28, 0.02, 0.22)), makeMat(0xfdfbf7, 0.9));
      paper.position.set(-0.1, 0.51, 0.04);
      g.add(top, base, paper);
      break;
    }
  }

  g.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  return g;
}

/**
 * Builds all Smallville 3D isometric low-poly buildings, bespoke architectural landmarks,
 * cutaway shells, and interior furniture props.
 */
export function buildTownArchitecture(
  locations: readonly LocationZone[],
  objects: readonly WorldObject[],
  textures: ProceduralTextures,
): BuiltArchitecture {
  const group = new THREE.Group();
  const buildings = new Map<string, BuildingEntry>();
  const hitProxies: THREE.Mesh[] = [];
  const geosToDispose: THREE.BufferGeometry[] = [];
  const matsToDispose: THREE.Material[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(geo: T): T => {
    geosToDispose.push(geo);
    return geo;
  };
  const trackMat = <T extends THREE.Material>(mat: T): T => {
    matsToDispose.push(mat);
    return mat;
  };

  // Shared materials for glass windows (dynamically illuminated at dusk/night) & glowing signage
  const windowGlassMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x8cc9e8,
      emissive: 0xffc86b,
      emissiveIntensity: 0.08,
      roughness: 0.16,
      metalness: 0.25,
    }),
  );
  const windowFrameMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0xf7f5f0, roughness: 0.65, metalness: 0.05 }),
  );
  const darkDoorMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x5c3c28, roughness: 0.72, metalness: 0.05 }),
  );
  const warmLampMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xfff5d6,
      emissive: 0xffc456,
      emissiveIntensity: 0.25,
      roughness: 0.25,
    }),
  );
  const metalRoofTrimMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.35, metalness: 0.55 }),
  );
  const stoneStepMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0xd9d4c7, roughness: 0.88, metalness: 0.02 }),
  );
  const floorWoodMat = trackMat(
    new THREE.MeshStandardMaterial({ map: textures.woodFloor, roughness: 0.78 }),
  );
  const floorTileMat = trackMat(
    new THREE.MeshStandardMaterial({ map: textures.tileFloor, roughness: 0.62 }),
  );
  const floorStoneMat = trackMat(
    new THREE.MeshStandardMaterial({ map: textures.stoneFloor, roughness: 0.82 }),
  );

  const lotOverlays = new Map<string, LotOverlayEntry>();
  const _lotColor = new THREE.Color();

  const createLotOverlay = (loc: LocationZone, padW: number, padD: number, cx: number, cz: number) => {
    const fillGeo = trackGeo(new THREE.PlaneGeometry(padW, padD));
    fillGeo.rotateX(-Math.PI / 2);
    const fillMat = trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x2d6a4f,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    const fillMesh = new THREE.Mesh(fillGeo, fillMat);
    fillMesh.position.set(cx, 0.045, cz);
    fillMesh.visible = false;

    const hw = padW / 2;
    const hd = padD / 2;
    const borderPts = new Float32Array([
      -hw, 0, -hd,
      hw, 0, -hd,
      hw, 0, hd,
      -hw, 0, hd,
    ]);
    const borderGeo = trackGeo(new THREE.BufferGeometry());
    borderGeo.setAttribute('position', new THREE.BufferAttribute(borderPts, 3));
    const borderMat = trackMat(
      new THREE.LineBasicMaterial({
        color: 0x2d6a4f,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    const borderLine = new THREE.LineLoop(borderGeo, borderMat);
    borderLine.position.set(cx, 0.075, cz);
    borderLine.visible = false;

    group.add(fillMesh, borderLine);
    lotOverlays.set(loc.id, {
      locationId: loc.id,
      fillMesh,
      fillMat,
      borderLine,
      borderMat,
    });
  };

  // Build each location (parks get lot overlays + clickable hit proxy; buildings get full 3D architecture)
  for (const loc of locations) {
    const cx = loc.x + loc.w / 2;
    const cz = loc.y + loc.h / 2;
    createLotOverlay(loc, loc.w + 0.55, loc.h + 0.55, cx, cz);

    if (loc.category === 'park') {
      const parkProxy = new THREE.Mesh(
        trackGeo(new THREE.BoxGeometry(loc.w, 0.6, loc.h)),
        trackMat(new THREE.MeshBasicMaterial({ visible: false })),
      );
      parkProxy.position.set(cx, 0.3, cz);
      parkProxy.userData = { locationId: loc.id };
      group.add(parkProxy);
      hitProxies.push(parkProxy);
      continue;
    }

    const pal = getPaletteForLocation(loc);
    const root = new THREE.Group();
    root.position.set(cx, 0, cz);

    const wallMat = trackMat(
      new THREE.MeshStandardMaterial({ color: pal.wall, roughness: 0.84, metalness: 0.02 }),
    );
    const trimMat = trackMat(
      new THREE.MeshStandardMaterial({ color: pal.trim, roughness: 0.75, metalness: 0.04 }),
    );
    const roofMat = trackMat(
      new THREE.MeshStandardMaterial({ color: pal.roof, roughness: 0.62, metalness: 0.08 }),
    );
    const accentMat = trackMat(
      new THREE.MeshStandardMaterial({ color: pal.accent, roughness: 0.45, metalness: 0.12 }),
    );

    const bw = loc.w - 0.3;
    const bd = loc.h - 0.3;
    const totalHeight = pal.stories === 2 ? 4.35 : 2.95;

    // 1. Stone foundation plinth + interior floor slab (always visible even in cutaway)
    const plinth = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(bw + 0.25, 0.16, bd + 0.25)), stoneStepMat);
    plinth.position.y = 0.08;
    plinth.receiveShadow = true;
    root.add(plinth);

    const floorMat =
      loc.category === 'cafe' || loc.category === 'home' || loc.category === 'pub'
        ? floorWoodMat
        : loc.category === 'civic'
          ? floorStoneMat
          : floorTileMat;
    const floorMesh = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(bw - 0.35, 0.04, bd - 0.35)), floorMat);
    floorMesh.position.y = 0.16;
    floorMesh.receiveShadow = true;
    root.add(floorMesh);

    // Low cutaway perimeter wainscot walls (height 0.58, visible when roof is lifted!)
    const lowH = 0.55;
    const wallT = 0.24;
    const backWall = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(bw, lowH, wallT)), wallMat);
    backWall.position.set(0, 0.16 + lowH / 2, -bd / 2 + wallT / 2);
    const frontWall = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(bw, lowH, wallT)), wallMat);
    frontWall.position.set(0, 0.16 + lowH / 2, bd / 2 - wallT / 2);
    const leftWall = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(wallT, lowH, bd - wallT * 2)), wallMat);
    leftWall.position.set(-bw / 2 + wallT / 2, 0.16 + lowH / 2, 0);
    const rightWall = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(wallT, lowH, bd - wallT * 2)), wallMat);
    rightWall.position.set(bw / 2 - wallT / 2, 0.16 + lowH / 2, 0);
    for (const m of [backWall, frontWall, leftWall, rightWall]) {
      m.castShadow = true;
      m.receiveShadow = true;
      root.add(m);
    }

    // Entrance stoop steps aligned to actual simulation door tile!
    const doorLocalX = loc.doorX + 0.5 - cx;
    const doorOnSouth = loc.doorY >= loc.y + loc.h / 2;
    const doorZSide = doorOnSouth ? 1 : -1;
    const stoop = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.7, 0.14, 0.7)), stoneStepMat);
    stoop.position.set(doorLocalX, 0.07, doorZSide * (bd / 2 + 0.32));
    stoop.receiveShadow = true;
    root.add(stoop);

    // 2. Full Architectural Exterior Shell (slides smoothly upward / hides when cutaway is active!)
    const exteriorShell = new THREE.Group();
    const shellBaseY = 0.16;

    // Main sculpted facade massing
    const mainBody = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(bw, totalHeight, bd)),
      wallMat,
    );
    mainBody.position.y = shellBaseY + totalHeight / 2;
    mainBody.castShadow = true;
    mainBody.receiveShadow = true;
    exteriorShell.add(mainBody);

    // Horizontal architectural cornice & belt course bands
    const cornice = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(bw + 0.34, 0.24, bd + 0.34)),
      trimMat,
    );
    cornice.position.y = shellBaseY + totalHeight;
    cornice.castShadow = true;
    cornice.receiveShadow = true;
    exteriorShell.add(cornice);

    if (pal.stories >= 2) {
      const belt = new THREE.Mesh(
        trackGeo(new THREE.BoxGeometry(bw + 0.18, 0.16, bd + 0.18)),
        trimMat,
      );
      belt.position.y = shellBaseY + totalHeight * 0.5;
      exteriorShell.add(belt);
    }

    // Corner pilasters for crisp tactile architectural silhouettes
    const pilasterGeo = trackGeo(new THREE.BoxGeometry(0.32, totalHeight + 0.06, 0.32));
    const corners: Array<[number, number]> = [
      [-bw / 2, -bd / 2],
      [bw / 2, -bd / 2],
      [-bw / 2, bd / 2],
      [bw / 2, bd / 2],
    ];
    for (const [px, pz] of corners) {
      const pil = new THREE.Mesh(pilasterGeo, trimMat);
      pil.position.set(px, shellBaseY + totalHeight / 2, pz);
      exteriorShell.add(pil);
    }

    // Entrance door frame + warm entrance lantern
    const doorFrame = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.36, 1.85, 0.26)), trimMat);
    doorFrame.position.set(doorLocalX, shellBaseY + 0.92, doorZSide * (bd / 2 + 0.04));
    const doorPanel = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.06, 1.65, 0.28)), darkDoorMat);
    doorPanel.position.set(doorLocalX, shellBaseY + 0.84, doorZSide * (bd / 2 + 0.07));
    const doorTransom = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.02, 0.28, 0.3)), windowGlassMat);
    doorTransom.position.set(doorLocalX, shellBaseY + 1.58, doorZSide * (bd / 2 + 0.07));
    exteriorShell.add(doorFrame, doorPanel, doorTransom);

    // Crisp recessed/framed window rows on all 4 facades
    const winW = 0.88;
    const winH = 0.98;
    const winFrameGeo = trackGeo(new THREE.BoxGeometry(winW + 0.14, winH + 0.14, 0.16));
    const winPaneGeo = trackGeo(new THREE.BoxGeometry(winW, winH, 0.2));
    const sillGeo = trackGeo(new THREE.BoxGeometry(winW + 0.22, 0.1, 0.24));

    const addWindow = (wx: number, wy: number, wz: number, rotY: number) => {
      const wg = new THREE.Group();
      wg.position.set(wx, wy, wz);
      wg.rotation.y = rotY;
      const fr = new THREE.Mesh(winFrameGeo, windowFrameMat);
      const pn = new THREE.Mesh(winPaneGeo, windowGlassMat);
      const sl = new THREE.Mesh(sillGeo, trimMat);
      sl.position.set(0, -winH / 2 - 0.06, 0.04);
      wg.add(fr, pn, sl);
      exteriorShell.add(wg);
    };

    const storyHeights = pal.stories === 2 ? [1.32, 3.18] : [1.46];
    const colsX = Math.max(2, Math.floor((bw - 1.6) / 2.2));
    const colsZ = Math.max(2, Math.floor((bd - 1.6) / 2.2));

    for (const sy of storyHeights) {
      // Front & Back facades (South +Z and North -Z)
      for (let i = 0; i < colsX; i++) {
        const t = colsX === 1 ? 0 : (i / (colsX - 1) - 0.5) * (bw - 2.4);
        // Skip ground-floor window overlapping doorway
        const skipSouth = sy < 2 && doorOnSouth && Math.abs(t - doorLocalX) < 1.3;
        const skipNorth = sy < 2 && !doorOnSouth && Math.abs(t - doorLocalX) < 1.3;
        if (!skipSouth) addWindow(t, shellBaseY + sy, bd / 2 + 0.02, 0);
        if (!skipNorth) addWindow(t, shellBaseY + sy, -bd / 2 - 0.02, Math.PI);
      }
      // East (+X) & West (-X) facades
      for (let j = 0; j < colsZ; j++) {
        const t = colsZ === 1 ? 0 : (j / (colsZ - 1) - 0.5) * (bd - 2.4);
        addWindow(bw / 2 + 0.02, shellBaseY + sy, t, Math.PI / 2);
        addWindow(-bw / 2 - 0.02, shellBaseY + sy, t, -Math.PI / 2);
      }
    }

    // 3. Striped Storefront Awning where applicable (Hobbs Café, Bakery, Market, Clinic, Studio)
    if (pal.awning) {
      const awnTex =
        pal.awning === 'warm'
          ? textures.awningWarm
          : pal.awning === 'green'
            ? textures.awningGreen
            : textures.awningBlue;
      const awnMat = trackMat(new THREE.MeshStandardMaterial({ map: awnTex, roughness: 0.65 }));
      const awningW = Math.min(bw - 1.2, 5.2);
      const awning = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(awningW, 0.14, 1.1)), awnMat);
      awning.position.set(
        THREE.MathUtils.clamp(doorLocalX, -bw / 2 + awningW / 2 + 0.3, bw / 2 - awningW / 2 - 0.3),
        shellBaseY + 2.15,
        doorZSide * (bd / 2 + 0.48),
      );
      awning.rotation.x = doorOnSouth ? 0.28 : -0.28;
      awning.castShadow = true;
      exteriorShell.add(awning);
    }

    // 4. Roof Silhouettes (Pitched Gable, Modernist Parapet, Neoclassical Pediment, Mansard, Studio Skylight)
    const roofBaseY = shellBaseY + totalHeight + 0.12;

    if (pal.roofStyle === 'pitched') {
      // True extruded triangular gable roof running along the longer axis
      const alongX = bw >= bd;
      const span = alongX ? bd + 0.65 : bw + 0.65;
      const length = alongX ? bw + 0.55 : bd + 0.55;
      const ridgeH = Math.min(2.2, span * 0.24);

      const roofShape = new THREE.Shape();
      roofShape.moveTo(-span / 2, 0);
      roofShape.lineTo(span / 2, 0);
      roofShape.lineTo(0, ridgeH);
      roofShape.closePath();

      const extrudeGeo = trackGeo(
        new THREE.ExtrudeGeometry(roofShape, {
          depth: length,
          bevelEnabled: true,
          bevelThickness: 0.08,
          bevelSize: 0.06,
          bevelSegments: 2,
        }),
      );
      extrudeGeo.center();
      const roofMesh = new THREE.Mesh(extrudeGeo, roofMat);
      roofMesh.position.y = roofBaseY + ridgeH / 2;
      if (alongX) {
        roofMesh.rotation.y = Math.PI / 2;
      }
      roofMesh.castShadow = true;
      roofMesh.receiveShadow = true;
      exteriorShell.add(roofMesh);

      // Brick chimney on cottages / homes / pub / bakery
      const chimney = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.65, 1.5, 0.65)), trimMat);
      chimney.position.set(bw * 0.24, roofBaseY + ridgeH * 0.72, -bd * 0.16);
      chimney.castShadow = true;
      const chimneyCap = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.8, 0.14, 0.8)), roofMat);
      chimneyCap.position.set(bw * 0.24, roofBaseY + ridgeH * 0.72 + 0.78, -bd * 0.16);
      exteriorShell.add(chimney, chimneyCap);
    } else if (pal.roofStyle === 'pediment') {
      // Town Hall: flat terrace + classical columns + triangular pediment + iconic clock cupola!
      const parapet = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(bw + 0.1, 0.42, bd + 0.1)), roofMat);
      parapet.position.y = roofBaseY + 0.21;
      parapet.castShadow = true;
      exteriorShell.add(parapet);

      // Clock tower cupola in center
      const towerBase = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(2.4, 1.7, 2.4)), wallMat);
      towerBase.position.y = roofBaseY + 1.2;
      towerBase.castShadow = true;
      const clockFace = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.62, 0.62, 0.16, 16)), warmLampMat);
      clockFace.rotation.x = Math.PI / 2;
      clockFace.position.set(0, roofBaseY + 1.35, 1.22);
      const clockFaceN = clockFace.clone();
      clockFaceN.position.z = -1.22;
      const spire = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(1.75, 1.65, 4)), roofMat);
      spire.position.y = roofBaseY + 2.85;
      spire.rotation.y = Math.PI / 4;
      spire.castShadow = true;
      exteriorShell.add(towerBase, clockFace, clockFaceN, spire);

      // 4 Neoclassical front columns along door facade
      const colGeo = trackGeo(new THREE.CylinderGeometry(0.18, 0.21, 2.5, 10));
      for (const offset of [-2.4, -1.0, 1.0, 2.4]) {
        const col = new THREE.Mesh(colGeo, windowFrameMat);
        col.position.set(doorLocalX + offset * 0.7, shellBaseY + 1.25, doorZSide * (bd / 2 + 0.48));
        col.castShadow = true;
        exteriorShell.add(col);
      }
      const porticoRoof = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(4.4, 0.28, 1.1)), trimMat);
      porticoRoof.position.set(doorLocalX, shellBaseY + 2.58, doorZSide * (bd / 2 + 0.48));
      porticoRoof.castShadow = true;
      exteriorShell.add(porticoRoof);
    } else if (pal.roofStyle === 'studio') {
      // Artist Cottages: pitched studio roof with glowing north-facing glass skylight
      const deck = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(bw + 0.14, 0.35, bd + 0.14)), roofMat);
      deck.position.y = roofBaseY + 0.18;
      deck.castShadow = true;
      const skylightFrame = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(bw * 0.58, 0.72, bd * 0.46)), trimMat);
      skylightFrame.position.y = roofBaseY + 0.65;
      skylightFrame.castShadow = true;
      const skylightGlass = new THREE.Mesh(
        trackGeo(new THREE.BoxGeometry(bw * 0.52, 0.14, bd * 0.4)),
        windowGlassMat,
      );
      skylightGlass.position.y = roofBaseY + 1.02;
      exteriorShell.add(deck, skylightFrame, skylightGlass);
    } else if (pal.roofStyle === 'mansard') {
      // Oakridge Bakery: beveled mansard roof + wood-fired brick chimney
      const mansard = new THREE.Mesh(
        trackGeo(new THREE.CylinderGeometry(Math.min(bw, bd) * 0.48, Math.min(bw, bd) * 0.64, 1.15, 4)),
        roofMat,
      );
      mansard.rotation.y = Math.PI / 4;
      mansard.scale.set(bw / Math.min(bw, bd), 1, bd / Math.min(bw, bd));
      mansard.position.y = roofBaseY + 0.58;
      mansard.castShadow = true;
      const bakeChimney = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.85, 1.9, 0.85)), accentMat);
      bakeChimney.position.set(-bw * 0.28, roofBaseY + 1.1, -bd * 0.15);
      bakeChimney.castShadow = true;
      exteriorShell.add(mansard, bakeChimney);
    } else {
      // Modern Designopolis flat architectural roof with parapet rim + mechanical/terrace accents
      const parapetOuter = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(bw + 0.12, 0.4, bd + 0.12)), roofMat);
      parapetOuter.position.y = roofBaseY + 0.2;
      parapetOuter.castShadow = true;
      parapetOuter.receiveShadow = true;
      const roofDeck = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(bw - 0.5, 0.12, bd - 0.5)), trimMat);
      roofDeck.position.y = roofBaseY + 0.36;
      roofDeck.receiveShadow = true;
      exteriorShell.add(parapetOuter, roofDeck);

      // Rooftop sculptural details (HVAC / stairwell / garden planter)
      const pent = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(2.1, 0.85, 1.7)), wallMat);
      pent.position.set(bw * 0.22, roofBaseY + 0.78, -bd * 0.18);
      pent.castShadow = true;
      const acBox = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.9, 0.52, 0.9)), metalRoofTrimMat);
      acBox.position.set(-bw * 0.24, roofBaseY + 0.62, bd * 0.15);
      acBox.castShadow = true;
      exteriorShell.add(pent, acBox);
    }

    // 5. Iconic Landmark Rooftop Accents (instant Designopolis silhouette recognition!)
    if (loc.id === 'hobbs_cafe') {
      // Iconic oversized sculptural terracotta coffee cup sign on the roof!
      const cup = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.68, 0.52, 0.95, 12)), accentMat);
      cup.position.set(0, roofBaseY + 0.95, 0);
      cup.castShadow = true;
      const saucer = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.95, 0.85, 0.14, 12)), windowFrameMat);
      saucer.position.set(0, roofBaseY + 0.45, 0);
      const handle = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.32, 0.09, 8, 12)), accentMat);
      handle.position.set(0.66, roofBaseY + 0.95, 0);
      const coffeeTop = new THREE.Mesh(
        trackGeo(new THREE.CylinderGeometry(0.58, 0.58, 0.05, 12)),
        darkDoorMat,
      );
      coffeeTop.position.set(0, roofBaseY + 1.42, 0);
      exteriorShell.add(cup, saucer, handle, coffeeTop);
    } else if (loc.id === 'smallville_clinic') {
      // Crisp bright medical cross rooftop emblem + glass greenhouse wing!
      const signBack = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.75, 1.45, 0.28)), accentMat);
      signBack.position.set(0, roofBaseY + 1.15, -bd * 0.22);
      signBack.castShadow = true;
      const cV = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.32, 0.92, 0.34)), windowFrameMat);
      cV.position.copy(signBack.position);
      const cH = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.92, 0.32, 0.34)), windowFrameMat);
      cH.position.copy(signBack.position);
      exteriorShell.add(signBack, cV, cH);
    } else if (loc.id === 'oak_hill_college') {
      // Academic clock crest banner on the front parapet
      const badge = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(2.8, 0.85, 0.3)), accentMat);
      badge.position.set(0, roofBaseY + 0.65, bd / 2 + 0.08);
      badge.castShadow = true;
      const emblem = new THREE.Mesh(trackGeo(new THREE.OctahedronGeometry(0.32, 0)), warmLampMat);
      emblem.position.set(0, roofBaseY + 0.65, bd / 2 + 0.28);
      exteriorShell.add(badge, emblem);
    }

    root.add(exteriorShell);

    // 6. Invisible simplified raycast hit proxy for effortless building click/hover
    const hitProxy = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(bw + 0.2, totalHeight + 1.4, bd + 0.2)),
      trackMat(new THREE.MeshBasicMaterial({ visible: false })),
    );
    hitProxy.position.y = (totalHeight + 1.4) / 2;
    hitProxy.userData = { locationId: loc.id };
    root.add(hitProxy);
    hitProxies.push(hitProxy);

    group.add(root);
    buildings.set(loc.id, {
      locationId: loc.id,
      root,
      exteriorShell,
      hitProxy,
      baseShellY: 0,
      currentCutaway: 0,
    });
  }

  // Build 3D interior & park furniture objects (visible inside buildings on cutaway & outdoors in parks)
  for (const obj of objects) {
    if (obj.kind === 'fountain') continue;
    const meshGroup = buildInteriorFurnitureMesh(obj, geosToDispose, matsToDispose);
    group.add(meshGroup);
  }

  const applyLotOverlays = (
    overlays: Record<string, { colorHex: string; intensity: number }>,
    selectedLocId: string | null,
    hoveredLocId: string | null,
    elapsed: number,
  ) => {
    const pulse = 0.88 + Math.sin(elapsed * 3.4) * 0.12;
    for (const [locId, entry] of lotOverlays.entries()) {
      const style = overlays[locId];
      const isSelected = locId === selectedLocId;
      const isHovered = locId === hoveredLocId;
      if (!style && !isSelected && !isHovered) {
        entry.fillMesh.visible = false;
        entry.borderLine.visible = false;
        continue;
      }

      const hex = isSelected ? '#1B4332' : style ? style.colorHex : '#2D6A4F';
      _lotColor.set(hex);
      entry.fillMat.color.copy(_lotColor);
      entry.borderMat.color.copy(_lotColor);

      const baseOpacity = isSelected
        ? 0.36 * pulse
        : isHovered
          ? 0.24
          : Math.min(0.34, (style?.intensity ?? 0.4) * 0.42);
      const borderOpacity = isSelected
        ? 0.95
        : isHovered
          ? 0.82
          : Math.min(0.88, (style?.intensity ?? 0.5) * 0.95);

      entry.fillMat.opacity = baseOpacity;
      entry.borderMat.opacity = borderOpacity;
      entry.fillMesh.visible = true;
      entry.borderLine.visible = true;
    }
  };

  return {
    group,
    buildings,
    lotOverlays,
    hitProxies,
    windowGlassMat,
    warmLampMat,
    applyLotOverlays,
    dispose: () => {
      for (const g of geosToDispose) g.dispose();
      for (const m of matsToDispose) m.dispose();
    },
  };
}
