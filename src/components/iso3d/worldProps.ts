import * as THREE from 'three';
import type { LocationZone, TileKind, WorldObject } from '../../simulation/types';
import type { ProceduralTextures } from './textures';

export interface AnimatedCar {
  group: THREE.Group;
  laneZ: number;
  dir: 1 | -1;
  speed: number;
  minX: number;
  maxX: number;
  x: number;
  headlightMat: THREE.MeshStandardMaterial;
}

export interface BuiltWorldProps {
  group: THREE.Group;
  lampBulbMat: THREE.MeshStandardMaterial;
  carHeadlightMat: THREE.MeshStandardMaterial;
  waterTexture: THREE.CanvasTexture;
  fountainJet: THREE.Group | null;
  cars: AnimatedCar[];
  update: (delta: number, elapsed: number, nightFactor: number) => void;
  dispose: () => void;
}

// Pre-allocated scratch helpers (zero GC in loop)
const _dummy = new THREE.Object3D();
const _color = new THREE.Color();

function seededRand(seedRef: { v: number }): number {
  seedRef.v = (seedRef.v * 16807) % 2147483647;
  return (seedRef.v - 1) / 2147483646;
}

function buildToyCar(
  bodyHex: number,
  geos: THREE.BufferGeometry[],
  mats: THREE.Material[],
  headlightMat: THREE.MeshStandardMaterial,
): THREE.Group {
  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geos.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    mats.push(m);
    return m;
  };

  const g = new THREE.Group();
  const bodyMat = trackMat(
    new THREE.MeshStandardMaterial({ color: bodyHex, roughness: 0.3, metalness: 0.15 }),
  );
  const glassMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0xb7e4f9, roughness: 0.14, metalness: 0.3 }),
  );
  const wheelMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x262b31, roughness: 0.85, metalness: 0.05 }),
  );
  const bumperMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4, metalness: 0.4 }),
  );

  // Lower chassis
  const chassis = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.38, 0.34, 0.7)), bodyMat);
  chassis.position.y = 0.28;
  chassis.castShadow = true;
  chassis.receiveShadow = true;
  g.add(chassis);

  // Sculpted cabin
  const cabin = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.76, 0.3, 0.6)), bodyMat);
  cabin.position.set(-0.06, 0.56, 0);
  cabin.castShadow = true;
  g.add(cabin);

  // Wrap windshield
  const glass = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.8, 0.2, 0.62)), glassMat);
  glass.position.set(-0.06, 0.55, 0);
  g.add(glass);

  // Bumpers
  const frontBumper = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.08, 0.12, 0.66)), bumperMat);
  frontBumper.position.set(0.7, 0.18, 0);
  const backBumper = frontBumper.clone();
  backBumper.position.x = -0.7;
  g.add(frontBumper, backBumper);

  // Headlights (+X front)
  const hlGeo = trackGeo(new THREE.BoxGeometry(0.06, 0.1, 0.14));
  const hlL = new THREE.Mesh(hlGeo, headlightMat);
  hlL.position.set(0.7, 0.31, -0.2);
  const hlR = new THREE.Mesh(hlGeo, headlightMat);
  hlR.position.set(0.7, 0.31, 0.2);
  g.add(hlL, hlR);

  // 4 Wheels
  const wheelGeo = trackGeo(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 10));
  wheelGeo.rotateX(Math.PI / 2);
  const wheelCoords: Array<[number, number]> = [
    [0.42, 0.36],
    [0.42, -0.36],
    [-0.42, 0.36],
    [-0.42, -0.36],
  ];
  for (const [wx, wz] of wheelCoords) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(wx, 0.16, wz);
    g.add(w);
  }

  return g;
}

/**
 * Builds the entire outdoor world diorama: expansive meadow & perimeter hills,
 * asphalt roads & crosswalks, instanced raised sidewalks, shimmering creek & wooden bridge,
 * grand park fountain, instanced broadleaf & conifer woodland, streetlamps, café patios, and toy cars.
 */
export function buildWorldProps(
  tiles: TileKind[][],
  locations: readonly LocationZone[],
  objects: readonly WorldObject[],
  textures: ProceduralTextures,
): BuiltWorldProps {
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const seedRef = { v: 4242 };

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geos.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    mats.push(m);
    return m;
  };

  const mapH = tiles.length;
  const mapW = tiles[0]?.length ?? 80;

  // 1. Expansive sunlit meadow ground plane extending far beyond the town (no floating void!)
  const groundMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.grass,
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0.0,
    }),
  );
  const extendedGround = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(240, 190)), groundMat);
  extendedGround.rotation.x = -Math.PI / 2;
  extendedGround.position.set(mapW / 2, -0.02, mapH / 2);
  extendedGround.receiveShadow = true;
  group.add(extendedGround);

  // Subtle elevated manicured town lawn base slab with crisp bevelled border
  const townGrassMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.grass,
      color: 0xeffae2,
      roughness: 0.88,
      metalness: 0.0,
    }),
  );
  const townBase = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(mapW + 2, 0.04, mapH + 2)), townGrassMat);
  townBase.position.set(mapW / 2, 0.0, mapH / 2);
  townBase.receiveShadow = true;
  group.add(townBase);

  // Soft low-poly rolling hills far outside the perimeter for natural diorama horizon
  const hillMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x6cb349, roughness: 0.92, flatShading: true }),
  );
  const hillConfigs: Array<[number, number, number, number, number]> = [
    [-22, 14, 18, 4.5, 22],
    [104, 16, 20, 5.2, 26],
    [40, -22, 34, 4.2, 16],
    [12, 68, 24, 3.8, 16],
    [72, 66, 26, 4.6, 18],
    [-16, -16, 16, 5.5, 16],
    [98, -14, 18, 5.0, 18],
  ];
  for (const [hx, hz, sx, sy, sz] of hillConfigs) {
    const hill = new THREE.Mesh(trackGeo(new THREE.DodecahedronGeometry(1, 1)), hillMat);
    hill.scale.set(sx, sy, sz);
    hill.position.set(hx, -sy * 0.42, hz);
    hill.receiveShadow = true;
    group.add(hill);
  }

  // 2. Crisp Asphalt Roads (Main Street y=14..15, South Lane y=30) + Zebra Crosswalks
  const mainRoadTex = textures.roadHoriz.clone();
  mainRoadTex.needsUpdate = true;
  mainRoadTex.repeat.set(Math.max(1, Math.round((mapW - 2) / 4)), 1);
  const mainRoadMat = trackMat(
    new THREE.MeshStandardMaterial({ map: mainRoadTex, roughness: 0.85, metalness: 0.04 }),
  );
  const mainRoad = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(mapW + 28, 0.04, 2.12)), mainRoadMat);
  mainRoad.position.set(mapW / 2, 0.025, 15.0);
  mainRoad.receiveShadow = true;
  group.add(mainRoad);

  const southRoadTex = textures.roadHoriz.clone();
  southRoadTex.needsUpdate = true;
  southRoadTex.repeat.set(Math.max(1, Math.round((mapW - 2) / 4)), 1);
  const southRoadMat = trackMat(
    new THREE.MeshStandardMaterial({ map: southRoadTex, roughness: 0.86, metalness: 0.04 }),
  );
  const southRoad = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(mapW + 28, 0.04, 1.18)), southRoadMat);
  southRoad.position.set(mapW / 2, 0.025, 30.5);
  southRoad.receiveShadow = true;
  group.add(southRoad);

  // Zebra crosswalk stripes at key pedestrian crossings (instanced!)
  const stripeMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xf4f5f7,
      roughness: 0.78,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  );
  const crosswalkXs = [9.5, 18.0, 30.5, 43.0, 58.5, 70.0];
  const stripeGeo = trackGeo(new THREE.BoxGeometry(1.4, 0.015, 0.22));
  const stripeCount = crosswalkXs.length * (5 + 3);
  const stripeInst = new THREE.InstancedMesh(stripeGeo, stripeMat, stripeCount);
  let sIdx = 0;
  for (const cx of crosswalkXs) {
    // Main Street 5-bar crosswalk
    for (let k = 0; k < 5; k++) {
      _dummy.position.set(cx, 0.052, 14.22 + k * 0.39);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      stripeInst.setMatrixAt(sIdx++, _dummy.matrix);
    }
    // South Lane 3-bar crosswalk
    for (let k = 0; k < 3; k++) {
      _dummy.position.set(cx, 0.052, 30.18 + k * 0.32);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.set(0.9, 1, 0.85);
      _dummy.updateMatrix();
      stripeInst.setMatrixAt(sIdx++, _dummy.matrix);
    }
  }
  stripeInst.instanceMatrix.needsUpdate = true;
  stripeInst.computeBoundingSphere();
  group.add(stripeInst);

  // 3. Raised Beveled Sidewalks (`path` tiles) via single InstancedMesh (ultra-scalable!)
  const pathCoords: Array<[number, number]> = [];
  const waterCoords: Array<[number, number]> = [];
  const bridgeCoords: Array<[number, number]> = [];
  const inTownTreeCoords: Array<[number, number]> = [];
  const flowerCoords: Array<[number, number]> = [];

  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      const t = tiles[y][x];
      if (t === 'path') pathCoords.push([x, y]);
      else if (t === 'water') waterCoords.push([x, y]);
      else if (t === 'bridge') bridgeCoords.push([x, y]);
      else if (t === 'tree') inTownTreeCoords.push([x, y]);
      else if (t === 'flower') flowerCoords.push([x, y]);
    }
  }

  if (pathCoords.length > 0) {
    const swGeo = trackGeo(new THREE.BoxGeometry(1.01, 0.1, 1.01));
    const swMat = trackMat(
      new THREE.MeshStandardMaterial({
        map: textures.sidewalk,
        color: 0xf4efe5,
        roughness: 0.86,
        metalness: 0.02,
      }),
    );
    const swInst = new THREE.InstancedMesh(swGeo, swMat, pathCoords.length);
    swInst.receiveShadow = true;
    for (let i = 0; i < pathCoords.length; i++) {
      const [x, y] = pathCoords[i];
      _dummy.position.set(x + 0.5, 0.05, y + 0.5);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      swInst.setMatrixAt(i, _dummy.matrix);
    }
    swInst.instanceMatrix.needsUpdate = true;
    swInst.computeBoundingSphere();
    group.add(swInst);
  }

  // 4. Shimmering Willows Creek Pond & Wooden Footbridge
  if (waterCoords.length > 0) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [x, y] of [...waterCoords, ...bridgeCoords]) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const pw = maxX - minX + 1;
    const ph = maxY - minY + 1;
    const pcx = minX + pw / 2;
    const pcz = minY + ph / 2;

    const rimMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xc9c2b2, roughness: 0.86 }));
    const pondRim = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(pw + 0.45, 0.12, ph + 0.45)), rimMat);
    pondRim.position.set(pcx, 0.04, pcz);
    pondRim.receiveShadow = true;
    group.add(pondRim);

    const waterMat = trackMat(
      new THREE.MeshStandardMaterial({
        map: textures.water,
        color: 0x8be0f7,
        roughness: 0.14,
        metalness: 0.18,
      }),
    );
    const waterSurface = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(pw, 0.08, ph)), waterMat);
    waterSurface.position.set(pcx, 0.075, pcz);
    waterSurface.receiveShadow = true;
    group.add(waterSurface);
  }

  if (bridgeCoords.length > 0) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [x, y] of bridgeCoords) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const bcx = minX + bw / 2;
    const bcz = minY + bh / 2;

    const bridgeGroup = new THREE.Group();
    const deckMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xa66f42, roughness: 0.78 }));
    const railMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x7a4e2c, roughness: 0.82 }));
    const deck = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(bw + 0.1, 0.14, bh + 0.45)), deckMat);
    deck.position.set(bcx, 0.17, bcz);
    deck.castShadow = true;
    deck.receiveShadow = true;
    bridgeGroup.add(deck);

    // Side posts & timber handrails
    const postGeo = trackGeo(new THREE.BoxGeometry(0.14, 0.52, 0.14));
    const railGeo = trackGeo(new THREE.BoxGeometry(0.1, 0.08, bh + 0.3));
    for (const side of [-1, 1]) {
      const rx = bcx + side * (bw / 2 - 0.1);
      const rail = new THREE.Mesh(railGeo, railMat);
      rail.position.set(rx, 0.58, bcz);
      rail.castShadow = true;
      bridgeGroup.add(rail);
      for (const pz of [minY, bcz, maxY + 1]) {
        const post = new THREE.Mesh(postGeo, railMat);
        post.position.set(rx, 0.42, pz);
        post.castShadow = true;
        bridgeGroup.add(post);
      }
    }
    group.add(bridgeGroup);
  }

  // 5. Grand Sculpted Stone Park Fountain (Johnson Park centerpiece)
  let fountainJet: THREE.Group | null = null;
  const fountainObj = objects.find((o) => o.kind === 'fountain');
  if (fountainObj) {
    const fg = new THREE.Group();
    fg.position.set(fountainObj.tileX + 0.5, 0.05, fountainObj.tileY + 0.5);
    const stoneMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xddd9ce, roughness: 0.82 }));
    const waterMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x70d2f0, roughness: 0.12, metalness: 0.22 }),
    );
    const basin = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(1.15, 1.25, 0.34, 12)), stoneMat);
    basin.position.y = 0.17;
    basin.castShadow = true;
    basin.receiveShadow = true;
    const pool = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.95, 0.95, 0.1, 12)), waterMat);
    pool.position.y = 0.31;
    const pillar = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.22, 0.3, 0.85, 10)), stoneMat);
    pillar.position.y = 0.65;
    pillar.castShadow = true;
    const upperBowl = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.55, 0.32, 0.18, 10)), stoneMat);
    upperBowl.position.y = 1.05;
    upperBowl.castShadow = true;

    fountainJet = new THREE.Group();
    fountainJet.position.y = 1.22;
    const sprayMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xe0f7ff,
        emissive: 0x7dd3fc,
        emissiveIntensity: 0.15,
        roughness: 0.18,
      }),
    );
    const dropGeo = trackGeo(new THREE.OctahedronGeometry(0.11, 0));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const d = new THREE.Mesh(dropGeo, sprayMat);
      d.position.set(Math.cos(a) * 0.28, (i % 2) * 0.18, Math.sin(a) * 0.28);
      fountainJet.add(d);
    }
    fg.add(basin, pool, pillar, upperBowl, fountainJet);
    group.add(fg);
  }

  // 6. Stylized Low-Poly Trees (Instanced Broadleaf & Conifer — In-Town + Lush Perimeter Forest!)
  interface TreeSpot {
    x: number;
    z: number;
    scale: number;
    rot: number;
    kind: 'broadleaf' | 'pine';
    tint: number;
  }
  const treeSpots: TreeSpot[] = [];

  // In-town park & sidewalk trees
  const broadleafTints = [0x6cc24a, 0x7fd14e, 0x59b040, 0x8fd65a, 0x4ca642];
  const pineTints = [0x3d8f44, 0x2f7c3c, 0x4b9e48, 0x358240];

  for (const [tx, ty] of inTownTreeCoords) {
    const r = seededRand(seedRef);
    const isPine = r > 0.62;
    treeSpots.push({
      x: tx + 0.5,
      z: ty + 0.5,
      scale: 0.92 + seededRand(seedRef) * 0.3,
      rot: seededRand(seedRef) * Math.PI * 2,
      kind: isPine ? 'pine' : 'broadleaf',
      tint: isPine
        ? pineTints[Math.floor(seededRand(seedRef) * pineTints.length)]
        : broadleafTints[Math.floor(seededRand(seedRef) * broadleafTints.length)],
    });
  }

  // Lush perimeter woodland framing all 4 edges (Designopolis signature!) — skipping road extensions
  const addForestBelt = (
    xMin: number,
    xMax: number,
    zMin: number,
    zMax: number,
    count: number,
  ) => {
    for (let i = 0; i < count; i++) {
      const x = xMin + seededRand(seedRef) * (xMax - xMin);
      const z = zMin + seededRand(seedRef) * (zMax - zMin);
      // Keep Main Street & South Lane approach corridors clear
      if ((z > 13.0 && z < 17.2) || (z > 29.0 && z < 32.0)) continue;
      const isPine = seededRand(seedRef) > 0.38;
      treeSpots.push({
        x,
        z,
        scale: 0.85 + seededRand(seedRef) * 0.52,
        rot: seededRand(seedRef) * Math.PI * 2,
        kind: isPine ? 'pine' : 'broadleaf',
        tint: isPine
          ? pineTints[Math.floor(seededRand(seedRef) * pineTints.length)]
          : broadleafTints[Math.floor(seededRand(seedRef) * broadleafTints.length)],
      });
    }
  };

  addForestBelt(-14, mapW + 14, -12, 0.5, 95); // North ridge woodland
  addForestBelt(-14, mapW + 14, mapH + 0.5, mapH + 13, 95); // South woodland
  addForestBelt(-15, -0.8, 0, mapH, 55); // West woods
  addForestBelt(mapW + 0.8, mapW + 15, 0, mapH, 55); // East woods

  const broadleafs = treeSpots.filter((t) => t.kind === 'broadleaf');
  const pines = treeSpots.filter((t) => t.kind === 'pine');

  const trunkMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x7c5335, roughness: 0.9 }));
  const leafMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, flatShading: true }),
  );

  // Build Broadleaf InstancedMeshes (Trunk + Lower Crown + Upper Crown + Side Puff = 4-part composite!)
  if (broadleafs.length > 0) {
    const trunkGeo = trackGeo(new THREE.CylinderGeometry(0.14, 0.22, 1.05, 7));
    const crownA = trackGeo(new THREE.DodecahedronGeometry(0.76, 0));
    const crownB = trackGeo(new THREE.DodecahedronGeometry(0.56, 0));
    const crownC = trackGeo(new THREE.DodecahedronGeometry(0.46, 0));

    const instTrunk = new THREE.InstancedMesh(trunkGeo, trunkMat, broadleafs.length);
    const instA = new THREE.InstancedMesh(crownA, leafMat, broadleafs.length);
    const instB = new THREE.InstancedMesh(crownB, leafMat, broadleafs.length);
    const instC = new THREE.InstancedMesh(crownC, leafMat, broadleafs.length);
    instTrunk.castShadow = true;
    instA.castShadow = true;
    instA.receiveShadow = true;
    instB.castShadow = true;

    for (let i = 0; i < broadleafs.length; i++) {
      const t = broadleafs[i];
      _color.setHex(t.tint);

      _dummy.position.set(t.x, 0.52 * t.scale, t.z);
      _dummy.rotation.set(0, t.rot, 0);
      _dummy.scale.setScalar(t.scale);
      _dummy.updateMatrix();
      instTrunk.setMatrixAt(i, _dummy.matrix);

      _dummy.position.set(t.x, 1.48 * t.scale, t.z);
      _dummy.rotation.set(0.2, t.rot, 0.1);
      _dummy.scale.set(t.scale, t.scale * 1.05, t.scale);
      _dummy.updateMatrix();
      instA.setMatrixAt(i, _dummy.matrix);
      instA.setColorAt(i, _color);

      _dummy.position.set(
        t.x + Math.cos(t.rot) * 0.34 * t.scale,
        1.92 * t.scale,
        t.z + Math.sin(t.rot) * 0.34 * t.scale,
      );
      _dummy.rotation.set(0.1, t.rot + 1.1, 0);
      _dummy.scale.setScalar(t.scale);
      _dummy.updateMatrix();
      instB.setMatrixAt(i, _dummy.matrix);
      instB.setColorAt(i, _color.clone().offsetHSL(0.015, 0.04, 0.06));

      _dummy.position.set(
        t.x - Math.cos(t.rot) * 0.3 * t.scale,
        1.32 * t.scale,
        t.z - Math.sin(t.rot) * 0.3 * t.scale,
      );
      _dummy.scale.setScalar(t.scale);
      _dummy.updateMatrix();
      instC.setMatrixAt(i, _dummy.matrix);
      instC.setColorAt(i, _color.clone().offsetHSL(-0.01, 0, -0.05));
    }

    for (const im of [instTrunk, instA, instB, instC]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      group.add(im);
    }
  }

  // Build Layered Conifer/Pine InstancedMeshes (Trunk + 3 Stacked Faceted Cones = 4-part composite!)
  if (pines.length > 0) {
    const pTrunkGeo = trackGeo(new THREE.CylinderGeometry(0.12, 0.19, 0.72, 6));
    const cone1Geo = trackGeo(new THREE.ConeGeometry(0.82, 1.25, 7));
    const cone2Geo = trackGeo(new THREE.ConeGeometry(0.64, 1.08, 7));
    const cone3Geo = trackGeo(new THREE.ConeGeometry(0.42, 0.86, 7));

    const instPT = new THREE.InstancedMesh(pTrunkGeo, trunkMat, pines.length);
    const instC1 = new THREE.InstancedMesh(cone1Geo, leafMat, pines.length);
    const instC2 = new THREE.InstancedMesh(cone2Geo, leafMat, pines.length);
    const instC3 = new THREE.InstancedMesh(cone3Geo, leafMat, pines.length);
    instPT.castShadow = true;
    instC1.castShadow = true;
    instC1.receiveShadow = true;
    instC2.castShadow = true;
    instC3.castShadow = true;

    for (let i = 0; i < pines.length; i++) {
      const t = pines[i];
      _color.setHex(t.tint);

      _dummy.position.set(t.x, 0.36 * t.scale, t.z);
      _dummy.rotation.set(0, t.rot, 0);
      _dummy.scale.setScalar(t.scale);
      _dummy.updateMatrix();
      instPT.setMatrixAt(i, _dummy.matrix);

      _dummy.position.set(t.x, 1.12 * t.scale, t.z);
      _dummy.updateMatrix();
      instC1.setMatrixAt(i, _dummy.matrix);
      instC1.setColorAt(i, _color);

      _dummy.position.set(t.x, 1.82 * t.scale, t.z);
      _dummy.rotation.set(0, t.rot + 0.5, 0);
      _dummy.updateMatrix();
      instC2.setMatrixAt(i, _dummy.matrix);
      instC2.setColorAt(i, _color.clone().offsetHSL(0.01, 0.03, 0.04));

      _dummy.position.set(t.x, 2.42 * t.scale, t.z);
      _dummy.rotation.set(0, t.rot + 1.0, 0);
      _dummy.updateMatrix();
      instC3.setMatrixAt(i, _dummy.matrix);
      instC3.setColorAt(i, _color.clone().offsetHSL(0.02, 0.04, 0.08));
    }

    for (const im of [instPT, instC1, instC2, instC3]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      group.add(im);
    }
  }

  // 7. Instanced Meadow Flowers (`flower` tiles)
  if (flowerCoords.length > 0) {
    const flGeo = trackGeo(new THREE.DodecahedronGeometry(0.14, 0));
    const flMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72 }));
    const flColors = [0xf59e0b, 0xf43f5e, 0xa855f7, 0xfde047, 0xfb7185];
    const flInst = new THREE.InstancedMesh(flGeo, flMat, flowerCoords.length * 3);
    let fi = 0;
    for (const [fx, fy] of flowerCoords) {
      for (let k = 0; k < 3; k++) {
        _dummy.position.set(
          fx + 0.25 + k * 0.25,
          0.16,
          fy + 0.3 + ((k * 7) % 3) * 0.2,
        );
        _dummy.rotation.set(0, k * 1.1, 0);
        _dummy.scale.setScalar(0.85 + (k % 2) * 0.25);
        _dummy.updateMatrix();
        flInst.setMatrixAt(fi, _dummy.matrix);
        _color.setHex(flColors[(fi + fx) % flColors.length]);
        flInst.setColorAt(fi, _color);
        fi++;
      }
    }
    flInst.instanceMatrix.needsUpdate = true;
    if (flInst.instanceColor) flInst.instanceColor.needsUpdate = true;
    flInst.computeBoundingSphere();
    group.add(flInst);
  }

  // 8. Architectural Streetlamps lining Main Street & South Lane (warm glowing bulbs at dusk/night!)
  const lampPostMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x333c44, roughness: 0.45, metalness: 0.55 }),
  );
  const lampBulbMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xfff8e1,
      emissive: 0xffb946,
      emissiveIntensity: 0.2,
      roughness: 0.2,
    }),
  );
  const lampPositions: Array<[number, number]> = [];
  for (let lx = 5; lx <= mapW - 5; lx += 9) {
    lampPositions.push([lx, 13.7]);
    lampPositions.push([lx + 4.5, 16.3]);
  }
  for (let lx = 8; lx <= mapW - 6; lx += 12) {
    lampPositions.push([lx, 29.6]);
  }

  const poleGeo = trackGeo(new THREE.CylinderGeometry(0.05, 0.08, 2.0, 6));
  const armGeo = trackGeo(new THREE.BoxGeometry(0.32, 0.06, 0.06));
  const bulbGeo = trackGeo(new THREE.SphereGeometry(0.15, 8, 8));
  const instPole = new THREE.InstancedMesh(poleGeo, lampPostMat, lampPositions.length);
  const instArm = new THREE.InstancedMesh(armGeo, lampPostMat, lampPositions.length);
  const instBulb = new THREE.InstancedMesh(bulbGeo, lampBulbMat, lampPositions.length);
  instPole.castShadow = true;

  for (let i = 0; i < lampPositions.length; i++) {
    const [lx, lz] = lampPositions[i];
    _dummy.position.set(lx, 1.05, lz);
    _dummy.rotation.set(0, 0, 0);
    _dummy.scale.set(1, 1, 1);
    _dummy.updateMatrix();
    instPole.setMatrixAt(i, _dummy.matrix);

    _dummy.position.set(lx, 2.02, lz);
    _dummy.updateMatrix();
    instArm.setMatrixAt(i, _dummy.matrix);

    _dummy.position.set(lx, 2.15, lz);
    _dummy.updateMatrix();
    instBulb.setMatrixAt(i, _dummy.matrix);
  }
  for (const im of [instPole, instArm, instBulb]) {
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    group.add(im);
  }

  // 9. Outdoor Café Patio Umbrellas & Bistro Tables outside Hobbs Café & Plaza!
  const hobbs = locations.find((l) => l.id === 'hobbs_cafe');
  if (hobbs) {
    const umbPoleMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.7 }));
    const umbTopMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xe6643a, roughness: 0.65, flatShading: true }));
    const umbTopMat2 = trackMat(new THREE.MeshStandardMaterial({ color: 0xf5b027, roughness: 0.65, flatShading: true }));
    const tblMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xfaf7f0, roughness: 0.5 }));
    const patioSpots: Array<[number, number]> = [
      [hobbs.x + 2.2, hobbs.y - 1.1],
      [hobbs.x + 8.8, hobbs.y - 1.1],
    ];
    patioSpots.forEach(([px, pz], idx) => {
      const pg = new THREE.Group();
      pg.position.set(px, 0.1, pz);
      const tbl = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.42, 0.36, 0.06, 10)), tblMat);
      tbl.position.y = 0.52;
      tbl.castShadow = true;
      const pole = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.04, 0.05, 1.45, 6)), umbPoleMat);
      pole.position.y = 0.72;
      const canopy = new THREE.Mesh(
        trackGeo(new THREE.ConeGeometry(0.86, 0.36, 8)),
        idx % 2 === 0 ? umbTopMat : umbTopMat2,
      );
      canopy.position.y = 1.45;
      canopy.castShadow = true;
      pg.add(tbl, pole, canopy);
      group.add(pg);
    });
  }

  // 10. Animated Low-Poly Toy Cars cruising Main Street & South Lane (Designopolis signature!)
  const carHeadlightMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xfff8dc,
      emissive: 0xffe49c,
      emissiveIntensity: 0.25,
      roughness: 0.2,
    }),
  );
  const carSpecs: Array<{ color: number; laneZ: number; dir: 1 | -1; speed: number; startX: number }> = [
    { color: 0xf6c93b, laneZ: 15.5, dir: 1, speed: 3.1, startX: 12 },
    { color: 0xe64d3d, laneZ: 14.5, dir: -1, speed: 2.8, startX: 64 },
    { color: 0x3ba8c4, laneZ: 15.5, dir: 1, speed: 2.6, startX: 46 },
    { color: 0x8b6be6, laneZ: 14.5, dir: -1, speed: 3.3, startX: 28 },
    { color: 0x45b864, laneZ: 30.5, dir: 1, speed: 2.4, startX: 22 },
    { color: 0xf27d3b, laneZ: 30.5, dir: 1, speed: 2.4, startX: 62 },
  ];

  const cars: AnimatedCar[] = carSpecs.map((spec) => {
    const cg = buildToyCar(spec.color, geos, mats, carHeadlightMat);
    cg.position.set(spec.startX, 0.045, spec.laneZ);
    cg.rotation.y = spec.dir === 1 ? 0 : Math.PI;
    group.add(cg);
    return {
      group: cg,
      laneZ: spec.laneZ,
      dir: spec.dir,
      speed: spec.speed,
      minX: -10,
      maxX: mapW + 10,
      x: spec.startX,
      headlightMat: carHeadlightMat,
    };
  });

  return {
    group,
    lampBulbMat,
    carHeadlightMat,
    waterTexture: textures.water,
    fountainJet,
    cars,
    update: (delta: number, elapsed: number, nightFactor: number) => {
      // Gentle water shimmer flow
      textures.water.offset.x = (elapsed * 0.08) % 1;
      textures.water.offset.y = Math.sin(elapsed * 0.6) * 0.03;

      // Fountain sparkle animation
      if (fountainJet) {
        fountainJet.rotation.y = elapsed * 1.4;
        fountainJet.position.y = 1.2 + Math.sin(elapsed * 4.5) * 0.06;
      }

      // Warm glowing streetlamps & car headlights at dusk/night
      lampBulbMat.emissiveIntensity = 0.15 + nightFactor * 2.2;
      carHeadlightMat.emissiveIntensity = 0.2 + nightFactor * 2.0;

      // Smooth ambient cruising toy cars
      const dt = Math.min(delta, 0.1);
      for (const car of cars) {
        car.x += car.dir * car.speed * dt;
        if (car.dir === 1 && car.x > car.maxX) car.x = car.minX;
        else if (car.dir === -1 && car.x < car.minX) car.x = car.maxX;
        car.group.position.x = car.x;
        // Subtle suspension bounce
        car.group.position.y = 0.045 + Math.abs(Math.sin(elapsed * 9 + car.laneZ * 3.1)) * 0.012;
      }
    },
    dispose: () => {
      mainRoadTex.dispose();
      southRoadTex.dispose();
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
