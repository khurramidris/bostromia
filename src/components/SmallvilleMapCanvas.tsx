import { Crosshair, Maximize2, Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getShortFirstName } from '../simulation/memory';
import type { AgentState, LocationZone, TileKind, WorldObject, WorldState } from '../simulation/types';

interface SmallvilleMapCanvasProps {
  worldRef: React.MutableRefObject<WorldState>;
  selectedAgentId: string;
  onSelectAgent: (agentId: string) => void;
  selectedLocationId: string | null;
  onSelectLocation: (locationId: string | null) => void;
}

const TILE_PX = 28;

const TILE_COLORS: Record<TileKind, string> = {
  grass: '#DCE5C8',
  road: '#C8C1B2',
  path: '#E6DEC8',
  water: '#78A9C4',
  bridge: '#9C6F44',
  floor_wood: '#DEC39F',
  floor_tile: '#EAE6DC',
  floor_stone: '#D6D8DC',
  wall: '#4C4A43',
  door: '#9C6644',
  tree: '#DCE5C8',
  flower: '#DCE5C8',
};

function drawObject(ctx: CanvasRenderingContext2D, obj: WorldObject) {
  const px = obj.tileX * TILE_PX;
  const py = obj.tileY * TILE_PX;

  ctx.save();
  // Soft shadow
  ctx.fillStyle = 'rgba(29, 36, 32, 0.12)';
  ctx.fillRect(px + 3, py + 5, TILE_PX - 6, TILE_PX - 6);

  switch (obj.kind) {
    case 'fountain': {
      ctx.fillStyle = '#9CA3AF';
      ctx.beginPath();
      ctx.arc(px + TILE_PX / 2, py + TILE_PX / 2, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#60A5FA';
      ctx.beginPath();
      ctx.arc(px + TILE_PX / 2, py + TILE_PX / 2, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#E0F2FE';
      ctx.beginPath();
      ctx.arc(px + TILE_PX / 2, py + TILE_PX / 2, 3.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'counter':
    case 'bar':
    case 'register': {
      ctx.fillStyle = obj.kind === 'bar' ? '#5C3422' : '#7C4D30';
      ctx.fillRect(px + 2, py + 6, TILE_PX - 4, TILE_PX - 10);
      ctx.fillStyle = '#E7D8C3';
      ctx.fillRect(px + 4, py + 8, TILE_PX - 8, 4);
      break;
    }
    case 'piano': {
      ctx.fillStyle = '#1F2421';
      ctx.fillRect(px + 3, py + 4, TILE_PX - 6, TILE_PX - 8);
      ctx.fillStyle = '#FAF8F4';
      ctx.fillRect(px + 5, py + TILE_PX - 10, TILE_PX - 10, 4);
      break;
    }
    case 'bookshelf': {
      ctx.fillStyle = '#6E472B';
      ctx.fillRect(px + 3, py + 3, TILE_PX - 6, TILE_PX - 6);
      ctx.fillStyle = '#C2410C';
      ctx.fillRect(px + 5, py + 6, 4, 6);
      ctx.fillStyle = '#2563EB';
      ctx.fillRect(px + 10, py + 6, 4, 6);
      ctx.fillStyle = '#15803D';
      ctx.fillRect(px + 15, py + 6, 4, 6);
      break;
    }
    case 'bench': {
      ctx.fillStyle = '#8C5832';
      ctx.fillRect(px + 3, py + 8, TILE_PX - 6, 10);
      ctx.fillStyle = '#6B4223';
      ctx.fillRect(px + 3, py + 6, TILE_PX - 6, 3);
      break;
    }
    case 'easel': {
      ctx.fillStyle = '#7C5332';
      ctx.fillRect(px + 12, py + 4, 4, TILE_PX - 8);
      ctx.fillStyle = '#FAF8F4';
      ctx.fillRect(px + 6, py + 5, 16, 12);
      ctx.fillStyle = '#2D6A4F';
      ctx.fillRect(px + 8, py + 8, 6, 6);
      ctx.fillStyle = '#D97706';
      ctx.fillRect(px + 14, py + 7, 5, 5);
      break;
    }
    case 'oven': {
      ctx.fillStyle = '#78350F';
      ctx.fillRect(px + 2, py + 3, TILE_PX - 4, TILE_PX - 6);
      ctx.fillStyle = '#B45309';
      ctx.fillRect(px + 5, py + 6, TILE_PX - 10, 12);
      ctx.fillStyle = '#F59E0B';
      ctx.beginPath();
      ctx.arc(px + TILE_PX / 2, py + 14, 4, Math.PI, 0);
      ctx.fill();
      break;
    }
    case 'workbench': {
      ctx.fillStyle = '#854D27';
      ctx.fillRect(px + 2, py + 6, TILE_PX - 4, TILE_PX - 10);
      ctx.fillStyle = '#94A3B8';
      ctx.fillRect(px + 6, py + 9, 7, 3);
      ctx.fillStyle = '#D97706';
      ctx.fillRect(px + 16, py + 9, 6, 4);
      break;
    }
    case 'garden': {
      ctx.fillStyle = '#5C4033';
      ctx.fillRect(px + 2, py + 4, TILE_PX - 4, TILE_PX - 8);
      ctx.fillStyle = '#15803D';
      ctx.beginPath();
      ctx.arc(px + 9, py + 11, 3.5, 0, Math.PI * 2);
      ctx.arc(px + 18, py + 11, 3.5, 0, Math.PI * 2);
      ctx.arc(px + 13, py + 18, 3.8, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'archive': {
      ctx.fillStyle = '#4A3728';
      ctx.fillRect(px + 3, py + 3, TILE_PX - 6, TILE_PX - 6);
      ctx.fillStyle = '#EAB308';
      ctx.fillRect(px + 6, py + 7, 4, 7);
      ctx.fillStyle = '#3B82F6';
      ctx.fillRect(px + 12, py + 7, 4, 7);
      ctx.fillStyle = '#DC2626';
      ctx.fillRect(px + 18, py + 7, 4, 7);
      break;
    }
    case 'medical': {
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(px + 3, py + 4, TILE_PX - 6, TILE_PX - 8);
      ctx.fillStyle = '#0284C7';
      ctx.fillRect(px + 12, py + 7, 4, 14);
      ctx.fillRect(px + 7, py + 12, 14, 4);
      break;
    }
    case 'bed': {
      ctx.fillStyle = '#6E472B';
      ctx.fillRect(px + 3, py + 2, TILE_PX - 6, 5);
      ctx.fillStyle = '#FAF8F4';
      ctx.fillRect(px + 3, py + 7, TILE_PX - 6, 7);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(px + 6, py + 8, 7, 4);
      ctx.fillRect(px + 15, py + 8, 7, 4);
      ctx.fillStyle = '#2D6A4F';
      ctx.fillRect(px + 3, py + 14, TILE_PX - 6, TILE_PX - 16);
      break;
    }
    default: {
      ctx.fillStyle = '#8D6242';
      ctx.fillRect(px + 4, py + 5, TILE_PX - 8, TILE_PX - 10);
      ctx.fillStyle = '#FAF8F4';
      ctx.fillRect(px + 7, py + 8, TILE_PX - 14, TILE_PX - 16);
      break;
    }
  }
  ctx.restore();
}

function drawAgentSprite(
  ctx: CanvasRenderingContext2D,
  agent: AgentState,
  isSelected: boolean,
  timeMs: number,
) {
  const cx = (agent.x + 0.5) * TILE_PX;
  const isWalking = agent.path.length > 0;
  const bob = isWalking ? Math.abs(Math.sin(timeMs * 0.012)) * 2.5 : 0;
  const cy = (agent.y + 0.5) * TILE_PX - bob;

  ctx.save();

  // Selection ring
  if (isSelected) {
    ctx.strokeStyle = '#2D6A4F';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(cx, (agent.y + 0.78) * TILE_PX, 12, 6, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(45, 106, 79, 0.16)';
    ctx.fill();
  }

  // Ground shadow
  ctx.fillStyle = 'rgba(20, 26, 22, 0.22)';
  ctx.beginPath();
  ctx.ellipse(cx, (agent.y + 0.78) * TILE_PX, 8, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs
  const stride = isWalking ? Math.sin(timeMs * 0.015) * 2.5 : 0;
  ctx.fillStyle = agent.appearance.pants;
  ctx.fillRect(cx - 4.5, cy + 4 + stride * 0.4, 3.5, 6);
  ctx.fillRect(cx + 1, cy + 4 - stride * 0.4, 3.5, 6);

  // Torso / shirt
  ctx.fillStyle = agent.appearance.shirt;
  ctx.beginPath();
  ctx.roundRect(cx - 6.5, cy - 4, 13, 9.5, 3);
  ctx.fill();

  if (agent.appearance.accessory === 'apron') {
    ctx.fillStyle = '#FAF8F4';
    ctx.fillRect(cx - 4, cy - 2, 8, 7);
  }

  // Head
  ctx.fillStyle = agent.appearance.skin;
  ctx.beginPath();
  ctx.arc(cx, cy - 9, 6.2, 0, Math.PI * 2);
  ctx.fill();

  // Hair
  ctx.fillStyle = agent.appearance.hair;
  ctx.beginPath();
  ctx.arc(cx, cy - 11, 6.4, Math.PI, 0);
  ctx.fill();

  if (agent.appearance.accessory === 'hat') {
    ctx.fillStyle = '#334155';
    ctx.fillRect(cx - 7.5, cy - 14.5, 15, 2.2);
    ctx.fillRect(cx - 5, cy - 18, 10, 4);
  } else if (agent.appearance.accessory === 'beret') {
    ctx.fillStyle = '#581C87';
    ctx.beginPath();
    ctx.ellipse(cx + 1, cy - 14.5, 7, 2.8, -0.1, 0, Math.PI * 2);
    ctx.fill();
  }

  // Eyes (facing direction)
  ctx.fillStyle = '#1D2420';
  if (agent.facing !== 'up') {
    const eyeOffsetX = agent.facing === 'left' ? -1.5 : agent.facing === 'right' ? 1.5 : 0;
    ctx.fillRect(cx - 2.8 + eyeOffsetX, cy - 9.2, 1.4, 1.6);
    ctx.fillRect(cx + 1.4 + eyeOffsetX, cy - 9.2, 1.4, 1.6);
  }

  // Overhead Smallville Action Emoji Badge
  const badgeY = cy - 25;
  ctx.fillStyle = agent.isThinking ? '#FEF3C7' : 'rgba(255, 255, 255, 0.94)';
  ctx.strokeStyle = agent.isThinking ? '#D97706' : '#D5D0C3';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(cx - 10, badgeY - 9, 20, 16, 6);
  ctx.fill();
  ctx.stroke();

  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#1D2420';
  ctx.fillText(agent.isThinking ? '✨' : agent.actionEmoji, cx, badgeY - 0.5);

  // Animated "Zzz" indicator when resident is sleeping at home
  const activeBlock = agent.dailySchedule.find((b) => b.id === agent.activeScheduleId);
  const isSleeping = Boolean(activeBlock?.kind === 'sleep' && agent.path.length === 0);
  if (isSleeping) {
    const floatPhase = (timeMs * 0.0018) % 1;
    const zOffsetY = floatPhase * 11;
    const zAlpha = Math.sin(floatPhase * Math.PI);
    ctx.save();
    ctx.globalAlpha = Math.max(0.25, zAlpha);
    ctx.font = '700 10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#1E3A8A';
    ctx.fillText('z', cx + 10, badgeY - 11 - zOffsetY * 0.45);
    ctx.font = '700 12px "IBM Plex Mono", monospace';
    ctx.fillText('Zzz', cx + 17, badgeY - 18 - zOffsetY);
    ctx.restore();
  }

  // Name label beneath feet
  const firstName = getShortFirstName(agent.name);
  ctx.font = '600 10px "Plus Jakarta Sans", sans-serif';
  const nameWidth = ctx.measureText(firstName).width + 8;
  ctx.fillStyle = isSelected ? '#1B4332' : 'rgba(29, 36, 32, 0.78)';
  ctx.beginPath();
  ctx.roundRect(cx - nameWidth / 2, (agent.y + 0.88) * TILE_PX, nameWidth, 14, 4);
  ctx.fill();

  ctx.fillStyle = '#FAF8F4';
  ctx.fillText(firstName, cx, (agent.y + 0.88) * TILE_PX + 7.5);

  ctx.restore();
}

function drawSpeechBubble(ctx: CanvasRenderingContext2D, agent: AgentState) {
  if (!agent.speechBubble) return;
  const cx = (agent.x + 0.5) * TILE_PX;
  const topY = (agent.y + 0.5) * TILE_PX - 42;
  const text = agent.speechBubble.text;
  const clipped = text.length > 68 ? `${text.slice(0, 65)}…` : text;

  ctx.save();
  ctx.font = '500 10.5px "Plus Jakarta Sans", sans-serif';
  const maxWidth = 190;
  const words = clipped.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const w of words) {
    const next = current ? `${current} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth - 16) {
      if (current) lines.push(current);
      current = w;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);

  const boxW = Math.min(
    maxWidth,
    Math.max(84, ...lines.map((l) => ctx.measureText(l).width + 18)),
  );
  const boxH = lines.length * 13 + 12;
  const bx = cx - boxW / 2;
  const by = topY - boxH;

  ctx.fillStyle = '#FFFFFF';
  ctx.strokeStyle = '#2D6A4F';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(bx, by, boxW, boxH, 7);
  ctx.fill();
  ctx.stroke();

  // Pointer triangle
  ctx.beginPath();
  ctx.moveTo(cx - 5, by + boxH);
  ctx.lineTo(cx, by + boxH + 6);
  ctx.lineTo(cx + 5, by + boxH);
  ctx.closePath();
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#1D2420';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  lines.forEach((line, idx) => {
    ctx.fillText(line, bx + 9, by + 6 + idx * 13);
  });

  ctx.restore();
}

export function SmallvilleMapCanvas({
  worldRef,
  selectedAgentId,
  onSelectAgent,
  selectedLocationId,
  onSelectLocation,
}: SmallvilleMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraRef = useRef({ zoom: 1, offsetX: 0, offsetY: 0, initialized: false });
  const fitZoomRef = useRef(0.45);
  const dragRef = useRef<{
    active: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    origOffsetX: number;
    origOffsetY: number;
  }>({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    origOffsetX: 0,
    origOffsetY: 0,
  });

  const selectedAgentRef = useRef(selectedAgentId);
  selectedAgentRef.current = selectedAgentId;
  const selectedLocationRef = useRef(selectedLocationId);
  selectedLocationRef.current = selectedLocationId;

  const [followAgent, setFollowAgent] = useState(false);
  const followRef = useRef(followAgent);
  followRef.current = followAgent;

  const fitTownView = () => {
    const container = containerRef.current;
    const world = worldRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return;
    const mapPxW = world.mapWidth * TILE_PX;
    const mapPxH = world.mapHeight * TILE_PX;
    const padX = 24;
    const padY = 46;
    const zoom = Math.min((rect.width - padX) / mapPxW, (rect.height - padY) / mapPxH);
    const clampedZoom = Math.max(0.28, Math.min(1.6, zoom));
    fitZoomRef.current = clampedZoom;
    cameraRef.current = {
      zoom: clampedZoom,
      offsetX: (rect.width - mapPxW * clampedZoom) / 2,
      offsetY: (rect.height - mapPxH * clampedZoom) / 2,
      initialized: true,
    };
  };

  useEffect(() => {
    fitTownView();
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      if (!followRef.current) {
        fitTownView();
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let rafId = 0;
    let lastDrawMs = 0;

    // Build offscreen static layer once for instant per-frame blitting
    const buildStaticLayer = (world: WorldState) => {
      const offscreen = document.createElement('canvas');
      offscreen.width = world.mapWidth * TILE_PX;
      offscreen.height = world.mapHeight * TILE_PX;
      const sctx = offscreen.getContext('2d');
      if (!sctx) return offscreen;

      const waterTiles: Array<{ x: number; y: number }> = [];

      for (let y = 0; y < world.mapHeight; y++) {
        for (let x = 0; x < world.mapWidth; x++) {
          const kind = world.tiles[y][x];
          const px = x * TILE_PX;
          const py = y * TILE_PX;

          sctx.fillStyle = TILE_COLORS[kind];
          sctx.fillRect(px, py, TILE_PX + 0.5, TILE_PX + 0.5);

          if (kind === 'floor_wood') {
            sctx.fillStyle = 'rgba(139, 90, 60, 0.08)';
            sctx.fillRect(px, py + TILE_PX - 1, TILE_PX, 1);
            if (x % 2 === 0) {
              sctx.fillRect(px + TILE_PX - 1, py, 1, TILE_PX);
            }
          } else if (kind === 'floor_tile') {
            sctx.fillStyle = 'rgba(29, 36, 32, 0.05)';
            if ((x + y) % 2 === 0) {
              sctx.fillRect(px, py, TILE_PX, TILE_PX);
            }
          } else if (kind === 'road') {
            sctx.fillStyle = 'rgba(120, 113, 98, 0.14)';
            if ((x + y) % 2 === 0) {
              sctx.fillRect(px + 2, py + 2, TILE_PX - 4, TILE_PX - 4);
            }
          } else if (kind === 'water') {
            waterTiles.push({ x, y });
          } else if (kind === 'bridge') {
            sctx.fillStyle = '#7C5430';
            for (let b = 0; b < 4; b++) {
              sctx.fillRect(px + 2, py + 3 + b * 6.5, TILE_PX - 4, 4);
            }
          } else if (kind === 'wall') {
            sctx.fillStyle = '#6B675E';
            sctx.fillRect(px + 2, py + 2, TILE_PX - 4, TILE_PX - 6);
          } else if (kind === 'tree') {
            sctx.fillStyle = 'rgba(29, 36, 32, 0.14)';
            sctx.beginPath();
            sctx.ellipse(px + 14, py + 22, 10, 5, 0, 0, Math.PI * 2);
            sctx.fill();
            sctx.fillStyle = '#6D4C3D';
            sctx.fillRect(px + 12, py + 14, 4, 8);
            sctx.fillStyle = '#3B7A57';
            sctx.beginPath();
            sctx.arc(px + 14, py + 11, 10.5, 0, Math.PI * 2);
            sctx.fill();
            sctx.fillStyle = '#4E946C';
            sctx.beginPath();
            sctx.arc(px + 12, py + 8, 6.5, 0, Math.PI * 2);
            sctx.fill();
          } else if (kind === 'flower') {
            sctx.fillStyle = '#F59E0B';
            sctx.beginPath();
            sctx.arc(px + 9, py + 10, 2.5, 0, Math.PI * 2);
            sctx.fill();
            sctx.fillStyle = '#EC4899';
            sctx.beginPath();
            sctx.arc(px + 19, py + 17, 2.5, 0, Math.PI * 2);
            sctx.fill();
            sctx.fillStyle = '#FBBF24';
            sctx.beginPath();
            sctx.arc(px + 12, py + 20, 2.2, 0, Math.PI * 2);
            sctx.fill();
          }
        }
      }

      for (const loc of world.locations) {
        const lx = loc.x * TILE_PX;
        const ly = loc.y * TILE_PX;
        const lw = loc.w * TILE_PX;
        const lh = loc.h * TILE_PX;

        if (loc.category !== 'park') {
          sctx.fillStyle = loc.roofColor;
          sctx.fillRect(lx, ly, lw, 10);

          sctx.fillStyle = `${loc.accentColor}1C`;
          sctx.beginPath();
          sctx.roundRect(lx + lw * 0.25, ly + lh * 0.34, lw * 0.5, lh * 0.36, 6);
          sctx.fill();
        }
      }

      const corridorLabels = [
        { label: 'NORTH RIDGE', x: (world.mapWidth * TILE_PX) / 2, y: 13.4 * TILE_PX },
        { label: 'MAIN STREET', x: (world.mapWidth * TILE_PX) / 2, y: 15.6 * TILE_PX },
        { label: 'SOUTH LANE · WILLOWS CREEK', x: (world.mapWidth * TILE_PX) / 2, y: 30.6 * TILE_PX },
      ];
      sctx.save();
      sctx.font = '600 10px "IBM Plex Mono", monospace';
      sctx.textAlign = 'center';
      sctx.textBaseline = 'middle';
      for (const item of corridorLabels) {
        const w = sctx.measureText(item.label).width + 14;
        sctx.fillStyle = 'rgba(250, 248, 244, 0.86)';
        sctx.strokeStyle = 'rgba(201, 195, 180, 0.75)';
        sctx.lineWidth = 1;
        sctx.beginPath();
        sctx.roundRect(item.x - w / 2, item.y - 8, w, 16, 4);
        sctx.fill();
        sctx.stroke();
        sctx.fillStyle = '#4A534D';
        sctx.fillText(item.label, item.x, item.y);
      }
      sctx.restore();

      for (const obj of world.objects) {
        drawObject(sctx, obj);
      }

      return { offscreen, waterTiles };
    };

    const cached = buildStaticLayer(worldRef.current);

    const renderFrame = (timeMs: number) => {
      if (timeMs - lastDrawMs < 32) {
        rafId = requestAnimationFrame(renderFrame);
        return;
      }
      lastDrawMs = timeMs;

      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (canvas && container) {
        const rect = container.getBoundingClientRect();
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const targetW = Math.max(1, Math.floor(rect.width * dpr));
        const targetH = Math.max(1, Math.floor(rect.height * dpr));

        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }

        if (!cameraRef.current.initialized && rect.width > 50) {
          fitTownView();
        }

        const world = worldRef.current;
        const cam = cameraRef.current;

        if (followRef.current) {
          const targetAgent = world.agents.find((a) => a.id === selectedAgentRef.current);
          if (targetAgent) {
            const targetScreenX = rect.width / 2 - (targetAgent.x + 0.5) * TILE_PX * cam.zoom;
            const targetScreenY = rect.height / 2 - (targetAgent.y + 0.5) * TILE_PX * cam.zoom;
            cam.offsetX += (targetScreenX - cam.offsetX) * 0.16;
            cam.offsetY += (targetScreenY - cam.offsetY) * 0.16;
          }
        }

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.fillStyle = '#DCE5C8';
          ctx.fillRect(0, 0, rect.width, rect.height);

          ctx.save();
          ctx.translate(cam.offsetX, cam.offsetY);
          ctx.scale(cam.zoom, cam.zoom);

          // 1. Blit pre-rendered static world in one call
          if ('offscreen' in cached) {
            ctx.drawImage(cached.offscreen, 0, 0);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
            for (const wt of cached.waterTiles) {
              const wave = Math.sin(timeMs * 0.003 + wt.x * 0.7 + wt.y) * 2;
              ctx.fillRect(wt.x * TILE_PX + 5 + wave, wt.y * TILE_PX + 11, 10, 2);
            }
          }

          // 2. Building Selection Outline & Crisp Plaques
          for (const loc of world.locations) {
            const lx = loc.x * TILE_PX;
            const ly = loc.y * TILE_PX;
            const lw = loc.w * TILE_PX;
            const lh = loc.h * TILE_PX;

            if (loc.id === selectedLocationRef.current) {
              ctx.strokeStyle = '#2D6A4F';
              ctx.lineWidth = 3;
              ctx.strokeRect(lx - 2, ly - 2, lw + 4, lh + 4);
            }

            ctx.font = '700 12.5px "Plus Jakarta Sans", sans-serif';
            const labelW = ctx.measureText(loc.name).width + 18;
            const labelX = lx + lw / 2 - labelW / 2;
            const labelY = loc.y < 13 ? ly - 22 : ly + lh + 4;

            ctx.fillStyle = 'rgba(250, 248, 244, 0.96)';
            ctx.strokeStyle = '#C9C3B4';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.roundRect(labelX, labelY, labelW, 20, 5);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#1D2420';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(loc.name, lx + lw / 2, labelY + 10.5);
          }

          // 2b. Subtle active indicator on WorldObjects currently in use
          for (const obj of world.objects) {
            if (obj.occupiedByAgentId) {
              ctx.save();
              ctx.strokeStyle = 'rgba(217, 119, 6, 0.72)';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.roundRect(
                obj.tileX * TILE_PX + 1,
                obj.tileY * TILE_PX + 1,
                TILE_PX - 2,
                TILE_PX - 2,
                5,
              );
              ctx.stroke();
              ctx.restore();
            }
          }

          // 2c. Dashed link between conversing residents
          const agentById = new Map(world.agents.map((a) => [a.id, a]));
          ctx.save();
          ctx.strokeStyle = 'rgba(45, 106, 79, 0.85)';
          ctx.lineWidth = 1.8;
          ctx.setLineDash([4, 3]);
          for (const ag of world.agents) {
            if (!ag.inConversationWith || ag.id >= ag.inConversationWith) continue;
            const partner = agentById.get(ag.inConversationWith);
            if (!partner) continue;
            ctx.beginPath();
            ctx.moveTo((ag.x + 0.5) * TILE_PX, (ag.y + 0.5) * TILE_PX);
            ctx.lineTo((partner.x + 0.5) * TILE_PX, (partner.y + 0.5) * TILE_PX);
            ctx.stroke();
          }
          ctx.restore();

          // 3. Draw Agents sorted by Y with viewport frustum culling & LOD for 60..100+ resident scale
          const viewMinTileX = -cam.offsetX / (cam.zoom * TILE_PX) - 2;
          const viewMinTileY = -cam.offsetY / (cam.zoom * TILE_PX) - 2;
          const viewMaxTileX = (rect.width - cam.offsetX) / (cam.zoom * TILE_PX) + 2;
          const viewMaxTileY = (rect.height - cam.offsetY) / (cam.zoom * TILE_PX) + 2;
          const useCompactLod = world.agents.length > 30 && cam.zoom < 0.85;

          const visibleAgents = world.agents
            .filter(
              (a) =>
                a.x >= viewMinTileX &&
                a.x <= viewMaxTileX &&
                a.y >= viewMinTileY &&
                a.y <= viewMaxTileY,
            )
            .sort((a, b) => a.y - b.y);

          for (const agent of visibleAgents) {
            const isSel = agent.id === selectedAgentRef.current;
            if (useCompactLod && !isSel && (agent.tier ?? 'focal') === 'ambient') {
              const px = (agent.x + 0.5) * TILE_PX;
              const py = (agent.y + 0.5) * TILE_PX;
              ctx.save();
              ctx.fillStyle = agent.appearance.shirt;
              ctx.strokeStyle = agent.illness === 'mild_cold' ? '#B91C1C' : '#FAF8F4';
              ctx.lineWidth = 1.6;
              ctx.beginPath();
              ctx.arc(px, py, 6.2, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
              ctx.restore();
            } else {
              drawAgentSprite(ctx, agent, isSel, timeMs);
            }
          }

          // 4. Speech Bubbles on top (visible agents only; suppress ambient chatter at scale)
          let bubblesDrawn = 0;
          const maxBubbles = world.agents.length > 24 ? 6 : 18;
          for (const agent of visibleAgents) {
            if (!agent.speechBubble) continue;
            const isSel = agent.id === selectedAgentRef.current;
            if (!isSel && world.agents.length > 24 && (agent.tier ?? 'focal') === 'ambient') {
              continue;
            }
            if (!isSel && bubblesDrawn >= maxBubbles) continue;
            drawSpeechBubble(ctx, agent);
            bubblesDrawn += 1;
          }

          // 5. Golden Hour / Evening Ambient Tint & Weather Atmosphere
          const minOfDay = world.simMinutes % 1440;
          if (minOfDay >= 17 * 60 && minOfDay < 19 * 60) {
            ctx.fillStyle = 'rgba(217, 119, 6, 0.08)';
            ctx.fillRect(0, 0, world.mapWidth * TILE_PX, world.mapHeight * TILE_PX);
          } else if (minOfDay >= 19 * 60 || minOfDay < 6 * 60) {
            ctx.fillStyle = 'rgba(15, 23, 42, 0.22)';
            ctx.fillRect(0, 0, world.mapWidth * TILE_PX, world.mapHeight * TILE_PX);
          }

          if (world.weather === 'drizzle') {
            ctx.fillStyle = 'rgba(51, 65, 85, 0.09)';
            ctx.fillRect(0, 0, world.mapWidth * TILE_PX, world.mapHeight * TILE_PX);
            ctx.strokeStyle = 'rgba(224, 242, 254, 0.42)';
            ctx.lineWidth = 1;
            const shiftX = (timeMs * 0.05) % 40;
            const shiftY = (timeMs * 0.14) % 40;
            ctx.beginPath();
            for (let rx = -40; rx < world.mapWidth * TILE_PX; rx += 56) {
              for (let ry = -40; ry < world.mapHeight * TILE_PX; ry += 56) {
                const x0 = rx + shiftX;
                const y0 = ry + shiftY;
                ctx.moveTo(x0, y0);
                ctx.lineTo(x0 - 5, y0 + 14);
              }
            }
            ctx.stroke();
          }

          ctx.restore();

          // 6. Interactive Corner Minimap Radar (shown automatically when zoomed in or following)
          if (
            rect.width >= 520 &&
            (followRef.current || cam.zoom > fitZoomRef.current * 1.12)
          ) {
            const mmW = 148;
            const mmH = Math.round((world.mapHeight / world.mapWidth) * mmW);
            const mmX = rect.width - mmW - 12;
            const mmY = rect.height - mmH - 12;

            ctx.save();
            ctx.fillStyle = 'rgba(250, 248, 244, 0.94)';
            ctx.strokeStyle = '#C9C3B4';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.roundRect(mmX, mmY, mmW, mmH, 6);
            ctx.fill();
            ctx.stroke();

            const sx = mmW / world.mapWidth;
            const sy = mmH / world.mapHeight;

            // Main corridors
            ctx.fillStyle = '#D6D0C4';
            ctx.fillRect(mmX + 2, mmY + 14 * sy, mmW - 4, 3 * sy);
            ctx.fillRect(mmX + 2, mmY + 29 * sy, mmW - 4, 3 * sy);

            // Buildings
            for (const loc of world.locations) {
              ctx.fillStyle = loc.category === 'park' ? '#A7C4A0' : loc.roofColor;
              ctx.globalAlpha = 0.85;
              ctx.fillRect(
                mmX + loc.x * sx,
                mmY + loc.y * sy,
                Math.max(3, loc.w * sx),
                Math.max(3, loc.h * sy),
              );
            }
            ctx.globalAlpha = 1;

            // Resident dots
            for (const ag of world.agents) {
              const isSel = ag.id === selectedAgentRef.current;
              ctx.fillStyle = isSel ? '#2D6A4F' : '#1D2420';
              ctx.beginPath();
              ctx.arc(mmX + ag.x * sx, mmY + ag.y * sy, isSel ? 3.2 : 1.9, 0, Math.PI * 2);
              ctx.fill();
            }

            // Current camera viewport rect clamped inside minimap
            const viewTileX = Math.max(0, -cam.offsetX / (cam.zoom * TILE_PX));
            const viewTileY = Math.max(0, -cam.offsetY / (cam.zoom * TILE_PX));
            const viewTileW = Math.min(world.mapWidth - viewTileX, rect.width / (cam.zoom * TILE_PX));
            const viewTileH = Math.min(world.mapHeight - viewTileY, rect.height / (cam.zoom * TILE_PX));
            ctx.strokeStyle = '#2D6A4F';
            ctx.lineWidth = 1.2;
            ctx.strokeRect(
              mmX + viewTileX * sx,
              mmY + viewTileY * sy,
              Math.max(8, viewTileW * sx),
              Math.max(6, viewTileH * sy),
            );
            ctx.restore();
          }
        }
      }

      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, [worldRef]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      origOffsetX: cameraRef.current.offsetX,
      origOffsetY: cameraRef.current.offsetY,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      dragRef.current.moved = true;
      if (followAgent) setFollowAgent(false);
    }
    cameraRef.current.offsetX = dragRef.current.origOffsetX + dx;
    cameraRef.current.offsetY = dragRef.current.origOffsetY + dy;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const wasMoved = dragRef.current.moved;
    dragRef.current.active = false;
    if (wasMoved) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cam = cameraRef.current;
    const world = worldRef.current;

    // Click inside Minimap Radar pans camera cleanly to that coordinate
    if (
      rect.width >= 520 &&
      (followRef.current || cam.zoom > fitZoomRef.current * 1.12)
    ) {
      const mmW = 148;
      const mmH = Math.round((world.mapHeight / world.mapWidth) * mmW);
      const mmX = rect.width - mmW - 12;
      const mmY = rect.height - mmH - 12;
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      if (localX >= mmX && localX <= mmX + mmW && localY >= mmY && localY <= mmY + mmH) {
        const targetTileX = ((localX - mmX) / mmW) * world.mapWidth;
        const targetTileY = ((localY - mmY) / mmH) * world.mapHeight;
        setFollowAgent(false);
        cam.offsetX = rect.width / 2 - targetTileX * TILE_PX * cam.zoom;
        cam.offsetY = rect.height / 2 - targetTileY * TILE_PX * cam.zoom;
        return;
      }
    }

    const worldX = (e.clientX - rect.left - cam.offsetX) / (cam.zoom * TILE_PX);
    const worldY = (e.clientY - rect.top - cam.offsetY) / (cam.zoom * TILE_PX);

    // Hit-test agents first
    let closestAgent: AgentState | null = null;
    let bestDist = 1.4;
    for (const agent of world.agents) {
      const dist = Math.hypot(agent.x + 0.5 - worldX, agent.y + 0.5 - worldY);
      if (dist < bestDist) {
        bestDist = dist;
        closestAgent = agent;
      }
    }
    if (closestAgent) {
      onSelectAgent(closestAgent.id);
      return;
    }

    // Hit-test building / location zones
    const loc = world.locations.find(
      (l: LocationZone) =>
        worldX >= l.x && worldX <= l.x + l.w && worldY >= l.y && worldY <= l.y + l.h,
    );
    onSelectLocation(loc ? loc.id : null);
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.91;
    const cam = cameraRef.current;
    const nextZoom = Math.max(0.28, Math.min(2.4, cam.zoom * factor));
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    cam.offsetX = mx - ((mx - cam.offsetX) / cam.zoom) * nextZoom;
    cam.offsetY = my - ((my - cam.offsetY) / cam.zoom) * nextZoom;
    cam.zoom = nextZoom;
  };

  const zoomBy = (factor: number) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const cam = cameraRef.current;
    const nextZoom = Math.max(0.28, Math.min(2.4, cam.zoom * factor));
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    cam.offsetX = cx - ((cx - cam.offsetX) / cam.zoom) * nextZoom;
    cam.offsetY = cy - ((cy - cam.offsetY) / cam.zoom) * nextZoom;
    cam.zoom = nextZoom;
  };

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-[#CFD9B8] select-none"
    >
      <canvas
        ref={canvasRef}
        data-testid="smallville-canvas"
        aria-label="Interactive Smallville town map"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        className="block h-full w-full cursor-grab active:cursor-grabbing"
      />

      {/* Clean Map Camera Controls */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5 rounded-lg border border-[#D5D0C3] bg-[#FAF8F4]/95 p-1 shadow-xs">
        <button
          type="button"
          onClick={() => setFollowAgent((v) => !v)}
          aria-pressed={followAgent}
          aria-label="Follow selected resident"
          className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
            followAgent
              ? 'bg-[#2D6A4F] text-white'
              : 'text-[#2F3833] hover:bg-[#ECE8DD]'
          }`}
        >
          <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Follow</span>
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1.2)}
          aria-label="Zoom in map"
          className="rounded p-1.5 text-[#2F3833] hover:bg-[#ECE8DD] transition-colors"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => zoomBy(0.84)}
          aria-label="Zoom out map"
          className="rounded p-1.5 text-[#2F3833] hover:bg-[#ECE8DD] transition-colors"
        >
          <Minus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => {
            setFollowAgent(false);
            fitTownView();
          }}
          aria-label="Reset map view"
          className="rounded p-1.5 text-[#2F3833] hover:bg-[#ECE8DD] transition-colors"
        >
          <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
