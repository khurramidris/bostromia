/**
 * Phase E — Deterministic Uniform Spatial Hash Grid for O(N) proximity & encounter queries.
 * Eliminates O(N^2) all-pairs checks so 50..200+ resident worlds run smoothly.
 */

export interface PositionedEntity {
  id: string;
  x: number;
  y: number;
}

export class SpatialHashGrid<T extends PositionedEntity> {
  private readonly cellSize: number;
  private readonly cells = new Map<number, Array<{ item: T; index: number }>>();

  constructor(cellSize = 4) {
    this.cellSize = Math.max(1, cellSize);
  }

  private cellKey(cx: number, cy: number): number {
    // Supports tile coordinates up to +-32,000 cleanly without string allocation
    return ((cx + 1024) << 12) | (cy + 1024);
  }

  insert(item: T, index: number): void {
    const cx = Math.floor(item.x / this.cellSize);
    const cy = Math.floor(item.y / this.cellSize);
    const key = this.cellKey(cx, cy);
    const bucket = this.cells.get(key);
    if (bucket) {
      bucket.push({ item, index });
    } else {
      this.cells.set(key, [{ item, index }]);
    }
  }

  /**
   * Returns all entities within `radius` tiles (plus their original array index),
   * deterministically sorted by array index so pair-discovery order matches brute force.
   */
  queryRadius(x: number, y: number, radius: number): Array<{ item: T; index: number }> {
    const minCx = Math.floor((x - radius) / this.cellSize);
    const maxCx = Math.floor((x + radius) / this.cellSize);
    const minCy = Math.floor((y - radius) / this.cellSize);
    const maxCy = Math.floor((y + radius) / this.cellSize);
    const r2 = radius * radius;
    const results: Array<{ item: T; index: number }> = [];

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.cells.get(this.cellKey(cx, cy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const entry = bucket[i];
          const dx = entry.item.x - x;
          const dy = entry.item.y - y;
          if (dx * dx + dy * dy <= r2) {
            results.push(entry);
          }
        }
      }
    }

    if (results.length > 1) {
      results.sort((a, b) => a.index - b.index);
    }
    return results;
  }
}

export function buildSpatialGrid<T extends PositionedEntity>(
  items: readonly T[],
  cellSize = 4,
): SpatialHashGrid<T> {
  const grid = new SpatialHashGrid<T>(cellSize);
  for (let i = 0; i < items.length; i++) {
    grid.insert(items[i], i);
  }
  return grid;
}
