import type { TileKind } from './types';

export interface GridPoint {
  x: number;
  y: number;
}

export function isTileWalkable(tile: TileKind): boolean {
  return (
    tile === 'grass' ||
    tile === 'road' ||
    tile === 'path' ||
    tile === 'bridge' ||
    tile === 'floor_wood' ||
    tile === 'floor_tile' ||
    tile === 'floor_stone' ||
    tile === 'door' ||
    tile === 'flower'
  );
}

export function findNearestWalkableTile(
  tiles: TileKind[][],
  targetX: number,
  targetY: number,
): GridPoint {
  const h = tiles.length;
  const w = tiles[0]?.length ?? 0;
  const clampedX = Math.max(0, Math.min(w - 1, Math.round(targetX)));
  const clampedY = Math.max(0, Math.min(h - 1, Math.round(targetY)));

  if (isTileWalkable(tiles[clampedY][clampedX])) {
    return { x: clampedX, y: clampedY };
  }

  for (let radius = 1; radius <= 5; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = clampedX + dx;
        const ny = clampedY + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          if (isTileWalkable(tiles[ny][nx])) {
            return { x: nx, y: ny };
          }
        }
      }
    }
  }

  return { x: clampedX, y: clampedY };
}

const MAX_CACHED_PATHS_PER_GRID = 2000;
const gridPathCache = new WeakMap<TileKind[][], Map<string, GridPoint[]>>();

function getRouteCache(tiles: TileKind[][]): Map<string, GridPoint[]> {
  let cache = gridPathCache.get(tiles);
  if (!cache) {
    cache = new Map();
    gridPathCache.set(tiles, cache);
  }
  return cache;
}

/**
 * Deterministic A* grid pathfinder on Smallville's tile grid with per-grid route caching.
 */
export function findPath(
  tiles: TileKind[][],
  startX: number,
  startY: number,
  goalX: number,
  goalY: number,
): GridPoint[] {
  const h = tiles.length;
  const w = tiles[0]?.length ?? 0;
  if (w === 0 || h === 0) return [];

  const start = findNearestWalkableTile(tiles, startX, startY);
  const goal = findNearestWalkableTile(tiles, goalX, goalY);

  if (start.x === goal.x && start.y === goal.y) {
    return [];
  }

  const routeCache = getRouteCache(tiles);
  const routeKey = `${start.x},${start.y}>${goal.x},${goal.y}`;
  const cached = routeCache.get(routeKey);
  if (cached) {
    return cached.map((pt) => ({ x: pt.x, y: pt.y }));
  }

  const key = (x: number, y: number) => `${x},${y}`;
  const openSet: Array<{ x: number; y: number; f: number; g: number }> = [
    {
      x: start.x,
      y: start.y,
      g: 0,
      f: Math.abs(goal.x - start.x) + Math.abs(goal.y - start.y),
    },
  ];
  const gScore = new Map<string, number>([[key(start.x, start.y), 0]]);
  const cameFrom = new Map<string, GridPoint>();
  const closed = new Set<string>();

  const dirs = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];

  while (openSet.length > 0) {
    openSet.sort((a, b) => a.f - b.f);
    const current = openSet.shift()!;
    const cKey = key(current.x, current.y);

    if (current.x === goal.x && current.y === goal.y) {
      const path: GridPoint[] = [];
      let curr: GridPoint | undefined = goal;
      while (curr && !(curr.x === start.x && curr.y === start.y)) {
        path.unshift(curr);
        curr = cameFrom.get(key(curr.x, curr.y));
      }
      if (routeCache.size >= MAX_CACHED_PATHS_PER_GRID) {
        const firstKey = routeCache.keys().next().value;
        if (firstKey !== undefined) routeCache.delete(firstKey);
      }
      routeCache.set(routeKey, path);
      return path.map((pt) => ({ x: pt.x, y: pt.y }));
    }

    closed.add(cKey);

    for (const { dx, dy } of dirs) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      if (!isTileWalkable(tiles[ny][nx])) continue;

      const nKey = key(nx, ny);
      if (closed.has(nKey)) continue;

      // Slight preference for roads/paths over grass so residents use sidewalks naturally
      const tile = tiles[ny][nx];
      const stepCost = tile === 'road' || tile === 'path' || tile === 'bridge' ? 0.9 : 1.0;
      const tentativeG = current.g + stepCost;

      const prevG = gScore.get(nKey);
      if (prevG === undefined || tentativeG < prevG) {
        cameFrom.set(nKey, { x: current.x, y: current.y });
        gScore.set(nKey, tentativeG);
        const hCost = Math.abs(goal.x - nx) + Math.abs(goal.y - ny);
        const existing = openSet.find((item) => item.x === nx && item.y === ny);
        if (existing) {
          existing.g = tentativeG;
          existing.f = tentativeG + hCost;
        } else {
          openSet.push({ x: nx, y: ny, g: tentativeG, f: tentativeG + hCost });
        }
      }
    }
  }

  return [];
}
