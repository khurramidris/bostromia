import * as THREE from 'three';

export interface ProceduralTextures {
  grass: THREE.CanvasTexture;
  sidewalk: THREE.CanvasTexture;
  roadHoriz: THREE.CanvasTexture;
  woodFloor: THREE.CanvasTexture;
  tileFloor: THREE.CanvasTexture;
  stoneFloor: THREE.CanvasTexture;
  water: THREE.CanvasTexture;
  awningWarm: THREE.CanvasTexture;
  awningGreen: THREE.CanvasTexture;
  awningBlue: THREE.CanvasTexture;
  contactShadow: THREE.CanvasTexture;
  dispose: () => void;
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function configureTexture(
  canvas: HTMLCanvasElement,
  anisotropy: number,
  repeatX = 1,
  repeatY = 1,
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = Math.max(1, anisotropy);
  tex.needsUpdate = true;
  return tex;
}

export function createProceduralTextures(maxAnisotropy: number): ProceduralTextures {
  const aniso = Math.min(8, Math.max(1, maxAnisotropy));

  // 1. Lush Designopolis-style manicured meadow grass with subtle sunlit mowing bands & clover speckles
  const [grassC, gCtx] = makeCanvas(256, 256);
  gCtx.fillStyle = '#7DC052';
  gCtx.fillRect(0, 0, 256, 256);
  // Subtle alternating meadow bands
  gCtx.fillStyle = 'rgba(148, 206, 98, 0.35)';
  gCtx.fillRect(0, 0, 128, 256);
  // Deterministic soft blades & light speckles
  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let i = 0; i < 420; i++) {
    const x = rand() * 256;
    const y = rand() * 256;
    const r = 1.5 + rand() * 3.5;
    gCtx.fillStyle = i % 3 === 0 ? 'rgba(98, 162, 60, 0.28)' : 'rgba(176, 224, 118, 0.25)';
    gCtx.beginPath();
    gCtx.arc(x, y, r, 0, Math.PI * 2);
    gCtx.fill();
  }
  const grass = configureTexture(grassC, aniso, 18, 12);

  // 2. Crisp architectural concrete/limestone sidewalk slabs with clean beveled grid lines
  const [swC, swCtx] = makeCanvas(128, 128);
  swCtx.fillStyle = '#E6E1D6';
  swCtx.fillRect(0, 0, 128, 128);
  swCtx.strokeStyle = 'rgba(164, 156, 142, 0.45)';
  swCtx.lineWidth = 2;
  swCtx.strokeRect(1, 1, 62, 62);
  swCtx.strokeRect(65, 1, 62, 62);
  swCtx.strokeRect(1, 65, 62, 62);
  swCtx.strokeRect(65, 65, 62, 62);
  swCtx.fillStyle = 'rgba(255, 253, 248, 0.35)';
  swCtx.fillRect(3, 3, 58, 4);
  swCtx.fillRect(67, 67, 58, 4);
  const sidewalk = configureTexture(swC, aniso, 1, 1);

  // 3. Clean slate asphalt road with subtle aggregate grain & crisp white dashed centerline
  const [rdC, rdCtx] = makeCanvas(256, 128);
  rdCtx.fillStyle = '#60666E';
  rdCtx.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 360; i++) {
    const x = rand() * 256;
    const y = rand() * 128;
    rdCtx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(20,24,28,0.08)';
    rdCtx.fillRect(x, y, 2, 2);
  }
  // Edge curb stripes
  rdCtx.fillStyle = 'rgba(235, 237, 240, 0.35)';
  rdCtx.fillRect(0, 5, 256, 3);
  rdCtx.fillRect(0, 120, 256, 3);
  // Crisp dashed center divider
  rdCtx.fillStyle = '#F4F5F7';
  rdCtx.fillRect(16, 61, 64, 6);
  rdCtx.fillRect(144, 61, 64, 6);
  const roadHoriz = configureTexture(rdC, aniso, 1, 1);

  // 4. Warm interior hardwood planks
  const [wdC, wdCtx] = makeCanvas(128, 128);
  wdCtx.fillStyle = '#D9B88C';
  wdCtx.fillRect(0, 0, 128, 128);
  for (let row = 0; row < 8; row++) {
    wdCtx.fillStyle = row % 2 === 0 ? 'rgba(182, 134, 82, 0.22)' : 'rgba(244, 222, 188, 0.16)';
    wdCtx.fillRect(0, row * 16, 128, 15);
    wdCtx.fillStyle = 'rgba(122, 82, 46, 0.28)';
    wdCtx.fillRect(0, row * 16 + 15, 128, 1);
  }
  const woodFloor = configureTexture(wdC, aniso, 1, 1);

  // 5. Clean checkerboard cream/sage shop tile floor
  const [tlC, tlCtx] = makeCanvas(128, 128);
  tlCtx.fillStyle = '#EFECE4';
  tlCtx.fillRect(0, 0, 128, 128);
  tlCtx.fillStyle = '#DFDDD4';
  tlCtx.fillRect(0, 0, 64, 64);
  tlCtx.fillRect(64, 64, 64, 64);
  const tileFloor = configureTexture(tlC, aniso, 1, 1);

  // 6. Civic limestone floor
  const [stC, stCtx] = makeCanvas(128, 128);
  stCtx.fillStyle = '#D8DBE0';
  stCtx.fillRect(0, 0, 128, 128);
  stCtx.strokeStyle = 'rgba(110, 118, 130, 0.28)';
  stCtx.lineWidth = 2;
  stCtx.strokeRect(2, 2, 124, 124);
  stCtx.strokeRect(2, 2, 62, 62);
  stCtx.strokeRect(64, 64, 62, 62);
  const stoneFloor = configureTexture(stC, aniso, 1, 1);

  // 7. Shimmering bright creek water
  const [wtC, wtCtx] = makeCanvas(256, 256);
  wtCtx.fillStyle = '#5BB4D6';
  wtCtx.fillRect(0, 0, 256, 256);
  wtCtx.strokeStyle = 'rgba(220, 248, 255, 0.45)';
  wtCtx.lineWidth = 3;
  for (let i = 0; i < 16; i++) {
    const y = i * 16 + 6;
    wtCtx.beginPath();
    wtCtx.moveTo(0, y);
    wtCtx.bezierCurveTo(64, y - 5, 128, y + 5, 256, y);
    wtCtx.stroke();
  }
  const water = configureTexture(wtC, aniso, 3, 1);

  // 8. Striped café / market awnings
  const makeAwning = (c1: string, c2: string) => {
    const [ac, actx] = makeCanvas(128, 64);
    for (let i = 0; i < 8; i++) {
      actx.fillStyle = i % 2 === 0 ? c1 : c2;
      actx.fillRect(i * 16, 0, 16, 64);
    }
    return configureTexture(ac, aniso, 2, 1);
  };
  const awningWarm = makeAwning('#E05A3A', '#FFF8F0');
  const awningGreen = makeAwning('#2F855A', '#F7FAFC');
  const awningBlue = makeAwning('#3B74B8', '#F8FAFC');

  // 9. Soft radial contact shadow disc for agents & props
  const [shC, shCtx] = makeCanvas(64, 64);
  const grad = shCtx.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, 'rgba(20, 28, 22, 0.48)');
  grad.addColorStop(0.6, 'rgba(20, 28, 22, 0.22)');
  grad.addColorStop(1, 'rgba(20, 28, 22, 0)');
  shCtx.fillStyle = grad;
  shCtx.fillRect(0, 0, 64, 64);
  const contactShadow = new THREE.CanvasTexture(shC);
  contactShadow.colorSpace = THREE.SRGBColorSpace;
  contactShadow.needsUpdate = true;

  const all = [
    grass,
    sidewalk,
    roadHoriz,
    woodFloor,
    tileFloor,
    stoneFloor,
    water,
    awningWarm,
    awningGreen,
    awningBlue,
    contactShadow,
  ];

  return {
    grass,
    sidewalk,
    roadHoriz,
    woodFloor,
    tileFloor,
    stoneFloor,
    water,
    awningWarm,
    awningGreen,
    awningBlue,
    contactShadow,
    dispose: () => {
      for (const t of all) t.dispose();
    },
  };
}
