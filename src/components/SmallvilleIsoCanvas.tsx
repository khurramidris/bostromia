import {
  Building2,
  ChevronDown,
  ChevronUp,
  Compass,
  Crosshair,
  Eye,
  EyeOff,
  Layers,
  Map as MapIcon,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  RotateCw,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { formatSimTime, getShortFirstName } from '../simulation/memory';
import {
  computeMapLensOverlay,
  MAP_LENSES,
  type MapLensId,
  type MapLensOverlayResult,
} from '../simulation/spatialAnalytics';
import type { WorldState } from '../simulation/types';
import { createAgents3DManager } from './iso3d/agents3d';
import { buildTownArchitecture } from './iso3d/buildings';
import { createProceduralTextures } from './iso3d/textures';
import { buildWorldProps } from './iso3d/worldProps';

export interface SmallvilleIsoCanvasProps {
  worldRef: React.MutableRefObject<WorldState>;
  selectedAgentId: string;
  onSelectAgent: (agentId: string) => void;
  selectedLocationId: string | null;
  onSelectLocation: (locationId: string | null) => void;
  activeLens?: MapLensId;
  lensMemeId?: string;
  lensProposalId?: string;
  onChangeLens?: (lens: MapLensId) => void;
  atlasOpen?: boolean;
  onToggleAtlas?: () => void;
  focusRequest?: { seq: number; agentId?: string; locationId?: string } | null;
  onSwitchTo2D?: () => void;
}

interface ProjectedBubble {
  id: string;
  speaker: string;
  text: string;
  x: number;
  y: number;
  isSelected: boolean;
}

interface ProjectedPin {
  id: string;
  label: string;
  sublabel?: string;
  x: number;
  y: number;
  kind: 'selected_agent' | 'hover_agent' | 'landmark' | 'hover_building';
}

// Module-scope reusable math helpers (zero GC inside animation loop)
const _projVec = new THREE.Vector3();
const _rayMouse = new THREE.Vector2();
const _sunColorDay = new THREE.Color(0xfff5df);
const _sunColorDawn = new THREE.Color(0xffb878);
const _sunColorNight = new THREE.Color(0x7c9ad6);
const _sunColorCur = new THREE.Color();

const _skyDay = new THREE.Color(0xdbeee4);
const _skyDawn = new THREE.Color(0xf4d4bc);
const _skyNight = new THREE.Color(0x1e2b45);
const _skyCur = new THREE.Color();

const _hemiSkyDay = new THREE.Color(0xcceaff);
const _hemiSkyNight = new THREE.Color(0x3a5280);
const _hemiGroundDay = new THREE.Color(0x7cb855);
const _hemiGroundNight = new THREE.Color(0x1f2d29);

function detectSoftwareWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function canCreateWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export function SmallvilleIsoCanvas({
  worldRef,
  selectedAgentId,
  onSelectAgent,
  selectedLocationId,
  onSelectLocation,
  activeLens = 'normal',
  lensMemeId,
  lensProposalId,
  onChangeLens,
  atlasOpen = false,
  onToggleAtlas,
  focusRequest,
  onSwitchTo2D,
}: SmallvilleIsoCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  // Refs synced with React props so the WebGL scene is NEVER torn down on React re-renders
  const selectedAgentRef = useRef(selectedAgentId);
  const selectedLocationRef = useRef(selectedLocationId);
  const onSelectAgentRef = useRef(onSelectAgent);
  const onSelectLocationRef = useRef(onSelectLocation);
  const activeLensRef = useRef<MapLensId>(activeLens);
  const lensMemeIdRef = useRef(lensMemeId);
  const lensProposalIdRef = useRef(lensProposalId);
  selectedAgentRef.current = selectedAgentId;
  selectedLocationRef.current = selectedLocationId;
  onSelectAgentRef.current = onSelectAgent;
  onSelectLocationRef.current = onSelectLocation;
  activeLensRef.current = activeLens;
  lensMemeIdRef.current = lensMemeId;
  lensProposalIdRef.current = lensProposalId;

  const [cutawayAll, setCutawayAll] = useState(false);
  const [showLandmarks, setShowLandmarks] = useState(true);
  const [followSelected, setFollowSelected] = useState(false);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [bubbles, setBubbles] = useState<ProjectedBubble[]>([]);
  const [pins, setPins] = useState<ProjectedPin[]>([]);

  const cutawayRef = useRef(cutawayAll);
  const showLandmarksRef = useRef(showLandmarks);
  const followRef = useRef(followSelected);
  cutawayRef.current = cutawayAll;
  showLandmarksRef.current = showLandmarks;
  followRef.current = followSelected;

  // Imperative camera action hooks exposed from the Three.js setup effect
  const cameraApiRef = useRef<{
    zoomBy: (factor: number) => void;
    rotateStep: (deltaRad: number) => void;
    resetView: () => void;
    focusAgent: (agentId: string) => void;
    focusLocation: (locationId: string) => void;
  } | null>(null);

  // React to external focus requests (e.g. clicking an Atlas Advisor, Pictogram, or Explorer dot)
  useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.locationId) {
      setFollowSelected(false);
      cameraApiRef.current?.focusLocation(focusRequest.locationId);
    } else if (focusRequest.agentId) {
      cameraApiRef.current?.focusAgent(focusRequest.agentId);
    }
  }, [focusRequest]);

  // Compute active lens legend/title cleanly for the compact top HUD strip
  const activeLensSummary = useMemo(() => {
    if (activeLens === 'normal') return null;
    return computeMapLensOverlay(worldRef.current, activeLens, {
      memeId: lensMemeId,
      proposalId: lensProposalId,
      focusAgentId: selectedAgentId,
    });
  }, [activeLens, lensMemeId, lensProposalId, selectedAgentId, worldRef, pins.length]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    if (!canCreateWebGL()) {
      setWebglError('WebGL is unavailable in this browser context.');
      return;
    }

    const isSoftwareGl = detectSoftwareWebGL();
    const initialWorld = worldRef.current;
    const mapW = initialWorld.tiles[0]?.length ?? 80;
    const mapH = initialWorld.tiles.length || 46;
    const townCenterX = mapW / 2;
    const townCenterZ = mapH / 2;

    // 1. Renderer setup with ACES Filmic tone mapping & software-GL safety guard
    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // 2. Scene, Sky Background, Fog & Mandatory RoomEnvironment PBR IBL
    const scene = new THREE.Scene();
    scene.background = _skyDay.clone();
    scene.fog = new THREE.Fog(_skyDay.getHex(), 115, 210);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envRT = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;
    pmremGenerator.dispose();

    // 3. True Isometric Orthographic Camera
    const initW = Math.max(container.clientWidth, 640);
    const initH = Math.max(container.clientHeight, 360);
    const aspect = initW / initH;
    const frustumSize = 46;
    const camera = new THREE.OrthographicCamera(
      (-frustumSize * aspect) / 2,
      (frustumSize * aspect) / 2,
      frustumSize / 2,
      -frustumSize / 2,
      0.5,
      360,
    );
    camera.zoom = 1.05;

    const ISO_DIST = 92;
    const DEFAULT_AZIMUTH = Math.PI / 4; // Classic 45° isometric diamond
    const ISO_ELEVATION = 0.615; // ~35.264° true isometric elevation

    let targetAzimuth = DEFAULT_AZIMUTH;
    let currentAzimuth = DEFAULT_AZIMUTH;
    let animatingAzimuth = false;
    let targetZoom = camera.zoom;
    let animatingZoom = false;
    let pendingFocusTarget: THREE.Vector3 | null = null;

    const setCameraFromAzimuth = (target: THREE.Vector3, az: number, dist = ISO_DIST) => {
      const horiz = Math.cos(ISO_ELEVATION) * dist;
      const vert = Math.sin(ISO_ELEVATION) * dist;
      camera.position.set(
        target.x + Math.sin(az) * horiz,
        target.y + vert,
        target.z + Math.cos(az) * horiz,
      );
      camera.lookAt(target);
      camera.updateProjectionMatrix();
    };

    const controls = new MapControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = false;
    controls.minPolarAngle = 0.42;
    controls.maxPolarAngle = 1.15;
    controls.minZoom = 0.55;
    controls.maxZoom = 3.6;
    controls.target.set(townCenterX, 0, townCenterZ);
    setCameraFromAzimuth(controls.target, DEFAULT_AZIMUTH);
    controls.update();

    const onControlStart = () => {
      animatingAzimuth = false;
      animatingZoom = false;
      pendingFocusTarget = null;
      if (followRef.current) {
        followRef.current = false;
        setFollowSelected(false);
      }
    };
    controls.addEventListener('start', onControlStart);

    // 4. Three-Point Warm/Cool Sunlit Lighting Rig (Designopolis crisp sunlit feel)
    const hemiLight = new THREE.HemisphereLight(_hemiSkyDay.getHex(), _hemiGroundDay.getHex(), 0.78);
    hemiLight.position.set(townCenterX, 60, townCenterZ);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfff5df, 1.55);
    sunLight.position.set(townCenterX + 44, 66, townCenterZ + 32);
    sunLight.target.position.set(townCenterX, 0, townCenterZ);
    sunLight.castShadow = !isSoftwareGl;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 180;
    const shadowSpan = 56;
    sunLight.shadow.camera.left = -shadowSpan;
    sunLight.shadow.camera.right = shadowSpan;
    sunLight.shadow.camera.top = shadowSpan;
    sunLight.shadow.camera.bottom = -shadowSpan;
    sunLight.shadow.bias = -0.0004;
    sunLight.shadow.normalBias = 0.03;
    scene.add(sunLight);
    scene.add(sunLight.target);

    const rimLight = new THREE.DirectionalLight(0xc2e2ff, 0.36);
    rimLight.position.set(townCenterX - 42, 28, townCenterZ - 36);
    scene.add(rimLight);

    // 5. Build Procedural Textures, Terrain/Props, Architecture & Articulated Residents
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const textures = createProceduralTextures(maxAniso);
    const worldProps = buildWorldProps(
      initialWorld.tiles,
      initialWorld.locations,
      initialWorld.objects,
      textures,
    );
    const architecture = buildTownArchitecture(
      initialWorld.locations,
      initialWorld.objects,
      textures,
    );
    const agentsMgr = createAgents3DManager(textures);

    scene.add(worldProps.group);
    scene.add(architecture.group);
    scene.add(agentsMgr.group);

    // Pooled 3D Spatial Arc lines (Trust Network & Rumor Spread lenses — zero per-frame allocations)
    const ARC_POOL_SIZE = 18;
    const ARC_SEGMENTS = 16;
    const arcGroup = new THREE.Group();
    const arcPool: Array<{
      line: THREE.Line;
      geo: THREE.BufferGeometry;
      mat: THREE.LineBasicMaterial;
      positions: Float32Array;
    }> = [];
    for (let i = 0; i < ARC_POOL_SIZE; i++) {
      const positions = new Float32Array((ARC_SEGMENTS + 1) * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0x10b981,
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
      });
      const line = new THREE.Line(geo, mat);
      line.visible = false;
      line.frustumCulled = false;
      arcGroup.add(line);
      arcPool.push({ line, geo, mat, positions });
    }
    scene.add(arcGroup);
    const _arcColor = new THREE.Color();

    // Pre-warm shaders once on GPU
    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // 6. Imperative Camera API for UI buttons
    cameraApiRef.current = {
      zoomBy: (factor: number) => {
        targetZoom = THREE.MathUtils.clamp((animatingZoom ? targetZoom : camera.zoom) * factor, 0.55, 3.6);
        animatingZoom = true;
      },
      rotateStep: (deltaRad: number) => {
        const dx = camera.position.x - controls.target.x;
        const dz = camera.position.z - controls.target.z;
        currentAzimuth = Math.atan2(dx, dz);
        targetAzimuth = (animatingAzimuth ? targetAzimuth : currentAzimuth) + deltaRad;
        animatingAzimuth = true;
      },
      resetView: () => {
        pendingFocusTarget = new THREE.Vector3(townCenterX, 0, townCenterZ);
        targetAzimuth = DEFAULT_AZIMUTH;
        animatingAzimuth = true;
        targetZoom = 1.05;
        animatingZoom = true;
      },
      focusAgent: (agentId: string) => {
        const ag = worldRef.current.agents.find((a) => a.id === agentId);
        if (!ag) return;
        pendingFocusTarget = new THREE.Vector3(ag.x + 0.5, 0, ag.y + 0.5);
        targetZoom = Math.max(camera.zoom, 1.75);
        animatingZoom = true;
      },
      focusLocation: (locationId: string) => {
        const loc = worldRef.current.locations.find((l) => l.id === locationId);
        if (!loc) return;
        pendingFocusTarget = new THREE.Vector3(loc.x + loc.w / 2, 0, loc.y + loc.h / 2);
        targetZoom = Math.max(camera.zoom, 1.55);
        animatingZoom = true;
      },
    };

    // 7. Throttled Raycasting for Click & Hover Picking (agents prioritized over buildings)
    const raycaster = new THREE.Raycaster();
    let pointerDownPos = { x: 0, y: 0 };
    let hoveredAgentId: string | null = null;
    let hoveredBuildingId: string | null = null;
    let lastHoverCheckMs = 0;

    const updateMouseNDC = (ev: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      _rayMouse.x = ((ev.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      _rayMouse.y = -((ev.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    };

    const onPointerDown = (ev: PointerEvent) => {
      pointerDownPos = { x: ev.clientX, y: ev.clientY };
    };

    const onPointerUp = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      const moved = Math.hypot(ev.clientX - pointerDownPos.x, ev.clientY - pointerDownPos.y);
      if (moved > 6) return; // Dragged camera, not a click

      updateMouseNDC(ev);
      raycaster.setFromCamera(_rayMouse, camera);

      const agentHits = raycaster.intersectObjects(agentsMgr.hitProxies, false);
      if (agentHits.length > 0) {
        const agentId = agentHits[0].object.userData?.agentId as string | undefined;
        if (agentId) {
          onSelectAgentRef.current(agentId);
          return;
        }
      }

      const bldgHits = raycaster.intersectObjects(architecture.hitProxies, false);
      if (bldgHits.length > 0) {
        const locId = bldgHits[0].object.userData?.locationId as string | undefined;
        if (locId) {
          onSelectLocationRef.current(selectedLocationRef.current === locId ? null : locId);
          return;
        }
      }

      onSelectLocationRef.current(null);
    };

    const onPointerMove = (ev: PointerEvent) => {
      const now = performance.now();
      if (now - lastHoverCheckMs < 65) return; // ~15Hz hover raycast throttle
      lastHoverCheckMs = now;

      updateMouseNDC(ev);
      raycaster.setFromCamera(_rayMouse, camera);

      const agentHits = raycaster.intersectObjects(agentsMgr.hitProxies, false);
      if (agentHits.length > 0) {
        hoveredAgentId = (agentHits[0].object.userData?.agentId as string) ?? null;
        hoveredBuildingId = null;
        renderer.domElement.style.cursor = 'pointer';
        return;
      }
      hoveredAgentId = null;

      const bldgHits = raycaster.intersectObjects(architecture.hitProxies, false);
      if (bldgHits.length > 0) {
        hoveredBuildingId = (bldgHits[0].object.userData?.locationId as string) ?? null;
        renderer.domElement.style.cursor = 'pointer';
        return;
      }
      hoveredBuildingId = null;
      renderer.domElement.style.cursor = 'grab';
    };

    const onContextLost = (ev: Event) => {
      ev.preventDefault();
      setWebglError('WebGL context was interrupted. You can switch to 2D Map or reload.');
    };
    const onContextRestored = () => {
      setWebglError(null);
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    // 8. Responsive ResizeObserver
    const resizeRenderer = () => {
      const w = Math.max(container.clientWidth, 1);
      const h = Math.max(container.clientHeight, 1);
      const asp = w / h;
      camera.left = (-frustumSize * asp) / 2;
      camera.right = (frustumSize * asp) / 2;
      camera.top = frustumSize / 2;
      camera.bottom = -frustumSize / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    resizeRenderer();
    const ro = new ResizeObserver(resizeRenderer);
    ro.observe(container);

    // 9. Animation Loop with Software-WebGL afterDraw Pacing & Throttled DOM Projections
    const clock = new THREE.Clock();
    let frameId = 0;
    let disposed = false;
    let lastOverlayUpdateMs = 0;

    function afterDraw(cb: () => void) {
      if (disposed) return;
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const status = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (status === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 6);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 6);
    }

    function updateTimeOfDayLighting(simMinutes: number) {
      const { hour24, minute } = formatSimTime(simMinutes);
      const hr = hour24 + minute / 60;

      // 0 = bright noon, 1 = deep night
      let nightFactor = 0;
      let dawnDuskFactor = 0;
      if (hr < 5.5 || hr >= 21.0) {
        nightFactor = 1;
      } else if (hr < 8.0) {
        const t = (hr - 5.5) / 2.5;
        nightFactor = 1 - t;
        dawnDuskFactor = Math.sin(t * Math.PI);
      } else if (hr >= 17.5 && hr < 21.0) {
        const t = (hr - 17.5) / 3.5;
        nightFactor = t;
        dawnDuskFactor = Math.sin(t * Math.PI);
      }

      // Smoothly grade sky, fog, sun color, and window night glow
      _skyCur.copy(_skyDay).lerp(_skyNight, nightFactor).lerp(_skyDawn, dawnDuskFactor * 0.55);
      (scene.background as THREE.Color).copy(_skyCur);
      if (scene.fog instanceof THREE.Fog) {
        scene.fog.color.copy(_skyCur);
      }

      _sunColorCur
        .copy(_sunColorDay)
        .lerp(_sunColorNight, nightFactor)
        .lerp(_sunColorDawn, dawnDuskFactor * 0.65);
      sunLight.color.copy(_sunColorCur);
      sunLight.intensity = THREE.MathUtils.lerp(1.55, 0.42, nightFactor);

      // Gentle sun arc across the sky during daytime
      const dayProgress = THREE.MathUtils.clamp((hr - 6) / 14, 0, 1);
      const sunAngle = (dayProgress - 0.5) * 1.1;
      sunLight.position.set(
        townCenterX + Math.sin(sunAngle) * 52 + 24,
        54 + Math.cos(sunAngle) * 18,
        townCenterZ + 34,
      );

      hemiLight.color.copy(_hemiSkyDay).lerp(_hemiSkyNight, nightFactor);
      hemiLight.groundColor.copy(_hemiGroundDay).lerp(_hemiGroundNight, nightFactor);
      hemiLight.intensity = THREE.MathUtils.lerp(0.8, 0.48, nightFactor);

      // Warm cozy illuminated windows & Town Hall clock at dusk/night!
      architecture.windowGlassMat.emissiveIntensity = 0.08 + nightFactor * 1.45 + dawnDuskFactor * 0.35;
      architecture.warmLampMat.emissiveIntensity = 0.25 + nightFactor * 1.8;

      return nightFactor;
    }

    function updateProjectedOverlays(world: WorldState) {
      const w = container?.clientWidth ?? 0;
      const h = container?.clientHeight ?? 0;
      if (w < 10 || h < 10) return;

      const nextBubbles: ProjectedBubble[] = [];
      const nextPins: ProjectedPin[] = [];

      const project = (wx: number, wy: number, wz: number): { x: number; y: number; visible: boolean } => {
        _projVec.set(wx, wy, wz).project(camera);
        const sx = ((_projVec.x + 1) * 0.5) * w;
        const sy = ((-_projVec.y + 1) * 0.5) * h;
        const visible =
          _projVec.z >= -1 &&
          _projVec.z <= 1 &&
          sx >= -40 &&
          sx <= w + 40 &&
          sy >= -30 &&
          sy <= h + 30;
        return { x: sx, y: sy, visible };
      };

      // 1. Speech bubbles (only active conversations, capped cleanly so viewport stays crisp)
      for (const ag of world.agents) {
        if (ag.speechBubble && nextBubbles.length < 4) {
          if (agentsMgr.getAgentHeadWorldPos(ag.id, _projVec)) {
            const p = project(_projVec.x, _projVec.y + 0.35, _projVec.z);
            if (p.visible) {
              nextBubbles.push({
                id: ag.id,
                speaker: getShortFirstName(ag.name),
                text:
                  ag.speechBubble.text.length > 76
                    ? `${ag.speechBubble.text.slice(0, 73)}…`
                    : ag.speechBubble.text,
                x: p.x,
                y: p.y,
                isSelected: ag.id === selectedAgentRef.current,
              });
            }
          }
        }
      }

      // 2. Selected resident pin (always clear so user can track them)
      const selAg = world.agents.find((a) => a.id === selectedAgentRef.current);
      if (selAg && agentsMgr.getAgentHeadWorldPos(selAg.id, _projVec)) {
        const p = project(_projVec.x, _projVec.y + 0.25, _projVec.z);
        if (p.visible) {
          nextPins.push({
            id: `sel_${selAg.id}`,
            label: getShortFirstName(selAg.name),
            sublabel: selAg.isThinking ? 'Thinking…' : selAg.actionEmoji,
            x: p.x,
            y: p.y,
            kind: 'selected_agent',
          });
        }
      }

      // 3. Hovered resident pin
      if (hoveredAgentId && hoveredAgentId !== selectedAgentRef.current) {
        const hovAg = world.agents.find((a) => a.id === hoveredAgentId);
        if (hovAg && agentsMgr.getAgentHeadWorldPos(hovAg.id, _projVec)) {
          const p = project(_projVec.x, _projVec.y + 0.25, _projVec.z);
          if (p.visible) {
            nextPins.push({
              id: `hov_${hovAg.id}`,
              label: hovAg.name,
              sublabel: hovAg.occupation,
              x: p.x,
              y: p.y,
              kind: 'hover_agent',
            });
          }
        }
      }

      // 4. Clean subtle Landmark labels (enriched with Map Lens values when a lens is active)
      if (showLandmarksRef.current || hoveredBuildingId || activeLensRef.current !== 'normal') {
        for (const loc of world.locations) {
          const isHovered = loc.id === hoveredBuildingId;
          const isSelected = loc.id === selectedLocationRef.current;
          const lensBadge = cachedLensOverlay?.locations[loc.id]?.badgeText;
          if (!showLandmarksRef.current && !isHovered && !isSelected && !lensBadge) continue;
          const roofH = loc.category === 'park' ? 0.8 : loc.category === 'civic' || loc.category === 'college' ? 5.6 : 4.2;
          const p = project(loc.x + loc.w / 2, roofH, loc.y + loc.h / 2);
          if (p.visible) {
            nextPins.push({
              id: `loc_${loc.id}`,
              label: loc.shortName,
              sublabel: lensBadge,
              x: p.x,
              y: p.y,
              kind: isHovered || isSelected ? 'hover_building' : 'landmark',
            });
          }
        }
      }

      setBubbles(nextBubbles);
      setPins(nextPins);
    }

    let cachedLensOverlay: MapLensOverlayResult | null = null;
    let lastLensKey = '';
    let lastLensComputeMs = 0;

    function refreshLensOverlayIfNeeded(world: WorldState, nowMs: number) {
      const lens = activeLensRef.current;
      const key = `${lens}|${lensMemeIdRef.current ?? ''}|${lensProposalIdRef.current ?? ''}|${selectedAgentRef.current}|${Math.floor(world.simMinutes)}`;
      if (key !== lastLensKey || nowMs - lastLensComputeMs >= 320) {
        lastLensKey = key;
        lastLensComputeMs = nowMs;
        cachedLensOverlay = computeMapLensOverlay(world, lens, {
          memeId: lensMemeIdRef.current,
          proposalId: lensProposalIdRef.current,
          focusAgentId: selectedAgentRef.current,
        });
      }
      return cachedLensOverlay;
    }

    function updateSpatialArcs(overlay: MapLensOverlayResult | null) {
      const arcs = overlay?.arcs ?? [];
      for (let i = 0; i < ARC_POOL_SIZE; i++) {
        const slot = arcPool[i];
        const arc = arcs[i];
        if (!arc) {
          slot.line.visible = false;
          continue;
        }
        const fromRec = agentsMgr.records.get(arc.fromAgentId);
        const toRec = agentsMgr.records.get(arc.toAgentId);
        if (!fromRec || !toRec) {
          slot.line.visible = false;
          continue;
        }
        const sx = fromRec.visualX;
        const sz = fromRec.visualZ;
        const ex = toRec.visualX;
        const ez = toRec.visualZ;
        const dist = Math.hypot(ex - sx, ez - sz);
        const peakY = Math.min(7.2, 2.2 + dist * 0.14);
        const pos = slot.positions;
        for (let s = 0; s <= ARC_SEGMENTS; s++) {
          const t = s / ARC_SEGMENTS;
          const x = sx + (ex - sx) * t;
          const z = sz + (ez - sz) * t;
          const y = 1.25 + Math.sin(t * Math.PI) * peakY;
          pos[s * 3] = x;
          pos[s * 3 + 1] = y;
          pos[s * 3 + 2] = z;
        }
        (slot.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        _arcColor.set(arc.colorHex);
        slot.mat.color.copy(_arcColor);
        slot.mat.opacity = 0.45 + arc.weight * 0.45;
        slot.line.visible = true;
      }
    }

    function tick() {
      if (disposed) return;

      const delta = Math.min(clock.getDelta(), 0.1);
      const elapsed = clock.getElapsedTime();
      const nowMs = performance.now();
      const world = worldRef.current;

      // Smooth time-of-day grading
      const nightFactor = updateTimeOfDayLighting(world.simMinutes);

      // Refresh active Map Lens overlay (zero-allocation cached updates)
      const lensOverlay = refreshLensOverlayIfNeeded(world, nowMs);

      // Animate world props (creek shimmer, fountain, cruising low-poly cars, night lamps)
      worldProps.update(delta, elapsed, nightFactor);

      // Sync & animate articulated 3D residents (18..100+) with active lens halos
      agentsMgr.syncAndAnimate(
        world.agents,
        selectedAgentRef.current,
        delta,
        elapsed,
        lensOverlay?.agents,
      );

      // Apply glowing Civ-style lot highlights (active lens + hovered/selected lot)
      architecture.applyLotOverlays(
        lensOverlay?.locations ?? {},
        selectedLocationRef.current,
        hoveredBuildingId,
        elapsed,
      );

      // Update pooled 3D connection arcs (Trust / Rumor lenses)
      updateSpatialArcs(lensOverlay);

      // Smoothly damp building roof cutaway shells (global toggle, selected building peek, or followed resident's building!)
      const followedLocId = followRef.current
        ? world.agents.find((a) => a.id === selectedAgentRef.current)?.currentLocationId ?? null
        : null;
      for (const entry of architecture.buildings.values()) {
        const wantOpen =
          cutawayRef.current ||
          selectedLocationRef.current === entry.locationId ||
          followedLocId === entry.locationId;
        const target = wantOpen ? 1 : 0;
        entry.currentCutaway = THREE.MathUtils.damp(entry.currentCutaway, target, 8.5, delta);
        if (entry.currentCutaway > 0.96) {
          entry.exteriorShell.visible = false;
        } else {
          entry.exteriorShell.visible = true;
          entry.exteriorShell.position.y = entry.currentCutaway * 6.5;
          const s = 1 - entry.currentCutaway * 0.12;
          entry.exteriorShell.scale.set(s, Math.max(0.05, 1 - entry.currentCutaway * 0.85), s);
        }
      }

      // Smooth follow-selected-agent camera tracking
      if (followRef.current) {
        const rec = agentsMgr.records.get(selectedAgentRef.current);
        if (rec) {
          const prevX = controls.target.x;
          const prevZ = controls.target.z;
          const nx = THREE.MathUtils.damp(prevX, rec.visualX, 5.5, delta);
          const nz = THREE.MathUtils.damp(prevZ, rec.visualZ, 5.5, delta);
          camera.position.x += nx - prevX;
          camera.position.z += nz - prevZ;
          controls.target.x = nx;
          controls.target.z = nz;
        }
      } else if (pendingFocusTarget) {
        const prevX = controls.target.x;
        const prevZ = controls.target.z;
        const nx = THREE.MathUtils.damp(prevX, pendingFocusTarget.x, 7, delta);
        const nz = THREE.MathUtils.damp(prevZ, pendingFocusTarget.z, 7, delta);
        camera.position.x += nx - prevX;
        camera.position.z += nz - prevZ;
        controls.target.x = nx;
        controls.target.z = nz;
        if (
          Math.abs(nx - pendingFocusTarget.x) < 0.08 &&
          Math.abs(nz - pendingFocusTarget.z) < 0.08
        ) {
          pendingFocusTarget = null;
        }
      }

      // Smooth azimuth rotation buttons
      if (animatingAzimuth) {
        currentAzimuth = THREE.MathUtils.damp(currentAzimuth, targetAzimuth, 8, delta);
        const curDist = camera.position.distanceTo(controls.target);
        setCameraFromAzimuth(controls.target, currentAzimuth, curDist);
        if (Math.abs(currentAzimuth - targetAzimuth) < 0.004) {
          currentAzimuth = targetAzimuth;
          animatingAzimuth = false;
        }
      }

      // Smooth button zoom
      if (animatingZoom) {
        camera.zoom = THREE.MathUtils.damp(camera.zoom, targetZoom, 9, delta);
        camera.updateProjectionMatrix();
        if (Math.abs(camera.zoom - targetZoom) < 0.005) {
          camera.zoom = targetZoom;
          camera.updateProjectionMatrix();
          animatingZoom = false;
        }
      }

      // Keep pan target within scenic woodland bounds
      controls.target.x = THREE.MathUtils.clamp(controls.target.x, -6, mapW + 6);
      controls.target.z = THREE.MathUtils.clamp(controls.target.z, -6, mapH + 6);
      controls.target.y = 0;
      controls.update();

      renderer.render(scene, camera);

      // Throttled projected HTML overlays (~12Hz) so React stays feather-light
      if (nowMs - lastOverlayUpdateMs >= 85) {
        lastOverlayUpdateMs = nowMs;
        updateProjectedOverlays(world);
      }

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    frameId = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      ro.disconnect();
      controls.removeEventListener('start', onControlStart);
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      for (const slot of arcPool) {
        slot.geo.dispose();
        slot.mat.dispose();
      }
      envRT.dispose();
      textures.dispose();
      worldProps.dispose();
      architecture.dispose();
      agentsMgr.dispose();
      renderer.dispose();
      cameraApiRef.current = null;
    };
  }, [worldRef]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#DBEEE4] select-none">
      {/* Dedicated isolated WebGL mount container */}
      <div ref={mountRef} className="h-full w-full" aria-label="Smallville 3D Isometric Town" />

      {/* Graceful WebGL fallback banner */}
      {webglError && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#F4F1EA] p-6 text-center">
          <p className="font-display text-sm font-semibold text-[#1D2420]">{webglError}</p>
          {onSwitchTo2D && (
            <button
              type="button"
              onClick={onSwitchTo2D}
              className="mt-3 rounded-md bg-[#2D6A4F] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#1B4332]"
            >
              Switch to 2D Top-Down View
            </button>
          )}
        </div>
      )}

      {/* Active Map Lens Legend Strip — smart-anchored so it NEVER collides with BuildingYieldCard or TownAtlasPanel */}
      {activeLensSummary && (
        <div
          aria-label="Active Map Lens Legend"
          className={`pointer-events-auto absolute top-3 z-20 max-w-[min(430px,calc(100%-2rem))] rounded-lg border border-[#D5D0C3] bg-[#FAF8F4] px-3 py-1.5 shadow-md ${
            selectedLocationId
              ? 'right-3'
              : atlasOpen
                ? 'left-3'
                : 'left-1/2 -translate-x-1/2'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-[#1B4332] whitespace-nowrap">
                  {activeLensSummary.title}
                </span>
                <span className="truncate text-[11px] text-[#5C645E]">
                  {activeLensSummary.subtitle}
                </span>
              </div>
              {activeLensSummary.legend.length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-[#4A544E]">
                  {activeLensSummary.legend.map((item) => (
                    <span key={item.label} className="inline-flex items-center gap-1 whitespace-nowrap">
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 rounded-xs"
                        style={{ backgroundColor: item.colorHex }}
                      />
                      <span>{item.label}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            {onChangeLens && (
              <button
                type="button"
                onClick={() => onChangeLens('normal')}
                className="shrink-0 rounded border border-[#D5D0C3] px-2 py-0.5 text-[10px] font-medium text-[#4A544E] hover:bg-[#EFECE3] whitespace-nowrap"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* Projected Semantic DOM Layer: Clean Landmark Labels, Selected Pin & Active Speech Bubbles */}
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
        {pins.map((pin) => {
          if (pin.kind === 'landmark') {
            return (
              <div
                key={pin.id}
                style={{ transform: `translate3d(${pin.x}px, ${pin.y}px, 0) translate(-50%, -100%)` }}
                className="absolute left-0 top-0 flex items-center gap-1 whitespace-nowrap rounded bg-[#FAF8F4]/95 px-1.5 py-0.5 text-[10px] font-semibold tracking-tight text-[#25302A] shadow-xs border border-[#D5D0C3]"
              >
                <span>{pin.label}</span>
                {pin.sublabel && (
                  <span className="font-mono text-[10px] font-semibold text-[#1B4332] tabular-nums">
                    {pin.sublabel}
                  </span>
                )}
              </div>
            );
          }
          if (pin.kind === 'hover_building') {
            return (
              <div
                key={pin.id}
                style={{ transform: `translate3d(${pin.x}px, ${pin.y}px, 0) translate(-50%, -100%)` }}
                className="absolute left-0 top-0 flex items-center gap-1.5 whitespace-nowrap rounded bg-[#1B4332] px-2 py-0.5 text-[11px] font-semibold text-[#FAF8F4] shadow-sm"
              >
                <span>{pin.label}</span>
                {pin.sublabel && (
                  <span className="font-mono text-[10px] text-[#D8F3DC] tabular-nums">
                    {pin.sublabel}
                  </span>
                )}
              </div>
            );
          }
          if (pin.kind === 'selected_agent') {
            return (
              <div
                key={pin.id}
                style={{ transform: `translate3d(${pin.x}px, ${pin.y}px, 0) translate(-50%, -100%)` }}
                className="absolute left-0 top-0 flex items-center gap-1 whitespace-nowrap rounded-md bg-[#1B4332] px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm"
              >
                <span>{pin.label}</span>
                {pin.sublabel && <span className="text-[10px] opacity-90">{pin.sublabel}</span>}
              </div>
            );
          }
          return (
            <div
              key={pin.id}
              style={{ transform: `translate3d(${pin.x}px, ${pin.y}px, 0) translate(-50%, -100%)` }}
              className="absolute left-0 top-0 whitespace-nowrap rounded-md border border-[#D5D0C3] bg-white/95 px-2 py-0.5 text-[10px] font-medium text-[#1D2420] shadow-sm"
            >
              <span className="font-semibold">{pin.label}</span>
              {pin.sublabel && <span className="ml-1 text-[#5C645E]">· {pin.sublabel}</span>}
            </div>
          );
        })}

        {bubbles.map((b) => (
          <div
            key={`bub_${b.id}`}
            style={{ transform: `translate3d(${b.x}px, ${b.y - 22}px, 0) translate(-50%, -100%)` }}
            className={`absolute left-0 top-0 max-w-[210px] rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug shadow-md ${
              b.isSelected
                ? 'border-[#2D6A4F] bg-[#FAF8F4] text-[#1D2420]'
                : 'border-[#D5D0C3] bg-white/95 text-[#25302A]'
            }`}
          >
            <div className="font-semibold text-[#2D6A4F]">{b.speaker}</div>
            <div className="mt-0.5">{b.text}</div>
          </div>
        ))}
      </div>

      {/* Collapsible Unified Bottom Camera Dock (Zero side-panel clutter, solid/opaque surfaces — no backdrop-blur over WebGL) */}
      <div className="pointer-events-auto absolute bottom-3 left-1/2 z-20 -translate-x-1/2 flex flex-col items-center">
        <button
          type="button"
          onClick={() => setDockCollapsed((v) => !v)}
          aria-label={dockCollapsed ? 'Show 3D camera controls' : 'Hide 3D camera controls'}
          className="mb-1 flex items-center gap-1 rounded-t-md border border-b-0 border-[#D5D0C3] bg-[#FAF8F4] px-2.5 py-0.5 text-[10px] font-medium text-[#4A544E] hover:bg-[#EFECE3] whitespace-nowrap"
        >
          {dockCollapsed ? (
            <>
              <ChevronUp className="h-3 w-3" aria-hidden="true" />
              <span>Camera</span>
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
              <span>Hide</span>
            </>
          )}
        </button>

        {!dockCollapsed && (
          <div className="flex flex-col items-center divide-y divide-[#E5E2D9] rounded-lg border border-[#D5D0C3] bg-[#FAF8F4] shadow-md">
            {/* Spatial Map Lenses Row */}
            {onChangeLens && (
              <div
                role="group"
                aria-label="Map Lenses"
                className="flex flex-wrap items-center justify-center gap-0.5 px-1.5 py-1"
              >
                {MAP_LENSES.map((lensDef) => {
                  const isActive = activeLens === lensDef.id;
                  return (
                    <button
                      key={lensDef.id}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => onChangeLens(lensDef.id)}
                      title={lensDef.description}
                      className={`h-6 rounded px-2 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                        isActive
                          ? 'bg-[#2D6A4F] text-white'
                          : 'text-[#3C4640] hover:bg-[#EFECE3] hover:text-[#1D2420]'
                      }`}
                    >
                      {lensDef.shortLabel}
                    </button>
                  );
                })}
                {onToggleAtlas && (
                  <>
                    <span aria-hidden="true" className="mx-1 h-4 w-px bg-[#DFDBD0]" />
                    <button
                      type="button"
                      aria-pressed={atlasOpen}
                      onClick={onToggleAtlas}
                      title="Open Town Atlas (Pictograms, Advisors & Linked Explorer)"
                      className={`flex h-6 items-center gap-1 rounded px-2 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
                        atlasOpen
                          ? 'bg-[#1B4332] text-white'
                          : 'bg-[#EAF2ED] text-[#1B4332] hover:bg-[#D8EAE0]'
                      }`}
                    >
                      <Compass className="h-3 w-3" aria-hidden="true" />
                      <span>Atlas</span>
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Camera & View Controls Row */}
            <div className="flex flex-wrap items-center justify-center gap-1 px-1.5 py-1">
              <button
                type="button"
                onClick={() => cameraApiRef.current?.zoomBy(1.25)}
                aria-label="Zoom in"
                title="Zoom in"
                className="flex h-7 w-7 items-center justify-center rounded text-[#2F3833] hover:bg-[#EFECE3] transition-colors"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => cameraApiRef.current?.zoomBy(0.8)}
                aria-label="Zoom out"
                title="Zoom out"
                className="flex h-7 w-7 items-center justify-center rounded text-[#2F3833] hover:bg-[#EFECE3] transition-colors"
              >
                <Minus className="h-3.5 w-3.5" aria-hidden="true" />
              </button>

              <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-[#DFDBD0]" />

              <button
                type="button"
                onClick={() => cameraApiRef.current?.rotateStep(-Math.PI / 4)}
                aria-label="Rotate camera left"
                title="Rotate 45° left"
                className="flex h-7 w-7 items-center justify-center rounded text-[#2F3833] hover:bg-[#EFECE3] transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => cameraApiRef.current?.rotateStep(Math.PI / 4)}
                aria-label="Rotate camera right"
                title="Rotate 45° right"
                className="flex h-7 w-7 items-center justify-center rounded text-[#2F3833] hover:bg-[#EFECE3] transition-colors"
              >
                <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => cameraApiRef.current?.resetView()}
                aria-label="Reset isometric view"
                title="Reset isometric overview"
                className="flex h-7 w-7 items-center justify-center rounded text-[#2F3833] hover:bg-[#EFECE3] transition-colors"
              >
                <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>

              <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-[#DFDBD0]" />

              <button
                type="button"
                aria-pressed={cutawayAll}
                onClick={() => setCutawayAll((v) => !v)}
                title="Lift building roofs to inspect interiors"
                className={`flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                  cutawayAll
                    ? 'bg-[#2D6A4F] text-white'
                    : 'text-[#2F3833] hover:bg-[#EFECE3]'
                }`}
              >
                {cutawayAll ? (
                  <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>{cutawayAll ? 'Interiors' : 'Roofs'}</span>
              </button>

              <button
                type="button"
                aria-pressed={showLandmarks}
                onClick={() => setShowLandmarks((v) => !v)}
                title="Toggle building labels"
                className={`flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                  showLandmarks
                    ? 'bg-[#EAF2ED] text-[#1B4332]'
                    : 'text-[#5C645E] hover:bg-[#EFECE3]'
                }`}
              >
                {showLandmarks ? (
                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>Labels</span>
              </button>

              <button
                type="button"
                aria-pressed={followSelected}
                onClick={() => {
                  const next = !followSelected;
                  setFollowSelected(next);
                  if (next) {
                    cameraApiRef.current?.focusAgent(selectedAgentId);
                  }
                }}
                title="Follow selected resident"
                className={`flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                  followSelected
                    ? 'bg-[#2D6A4F] text-white'
                    : 'text-[#2F3833] hover:bg-[#EFECE3]'
                }`}
              >
                <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Follow</span>
              </button>

              {onSwitchTo2D && (
                <>
                  <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-[#DFDBD0]" />
                  <button
                    type="button"
                    onClick={onSwitchTo2D}
                    title="Switch to classic 2D top-down canvas"
                    className="flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium text-[#5C645E] hover:bg-[#EFECE3] hover:text-[#1D2420] transition-colors whitespace-nowrap shrink-0"
                  >
                    <MapIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>2D</span>
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
