export interface IdAllocator {
  next(prefix: string): string;
  seq(): number;
}

/**
 * Pure deterministic ID allocator backed by WorldState.idSeq.
 * Produces unique readable IDs with zero Math.random() or Date.now().
 */
export function makeIdAllocator(initialSeq = 1): IdAllocator {
  let counter = Number.isFinite(initialSeq) && initialSeq > 0 ? Math.floor(initialSeq) : 1;
  return {
    next(prefix: string): string {
      const cleanPrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '_');
      const id = `${cleanPrefix}_${counter}`;
      counter += 1;
      return id;
    },
    seq(): number {
      return counter;
    },
  };
}
