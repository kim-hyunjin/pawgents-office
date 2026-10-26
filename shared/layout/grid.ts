// The tile grid a layout compiles to: which tiles block walking, and the one breadth-first search over it that both
// path finding (compile) and the reachability check (validate) use.
import type { Pt } from './schema.ts';

/** Walkability of a w×h tile grid; everything off the map counts as blocked. */
export interface Grid {
  w: number;
  h: number;
  inMap(x: number, y: number): boolean;
  /** Block a w×h rectangle of tiles (the part on the map). */
  block(x: number, y: number, w?: number, h?: number): void;
  unblock(x: number, y: number): void;
  isBlocked(x: number, y: number): boolean;
}

export function makeGrid(w: number, h: number): Grid {
  const blocked = new Uint8Array(w * h);
  const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  return {
    w,
    h,
    inMap,
    block(x, y, bw = 1, bh = 1) {
      for (let j = y; j < y + bh; j++)
        for (let i = x; i < x + bw; i++)
          if (inMap(i, j)) blocked[j * w + i] = 1;
    },
    unblock(x, y) {
      if (inMap(x, y)) blocked[y * w + x] = 0;
    },
    isBlocked: (x, y) => !inMap(x, y) || blocked[y * w + x] === 1,
  };
}

const STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * Breadth-first search over a w×h grid from `from`, stepping onto the tiles `pass` allows. Returns every tile's
 * predecessor as an index (y * w + x; the start points at itself, -1: not reached). Given `to`, it stops there.
 */
export function bfs(
  w: number,
  h: number,
  from: Pt,
  pass: (x: number, y: number) => boolean,
  to?: Pt,
): Int32Array {
  const key = (x: number, y: number) => y * w + x;
  const prev = new Int32Array(w * h).fill(-1);
  const start = key(from.x, from.y);
  const q = [start];
  prev[start] = start;
  const target = to ? key(to.x, to.y) : -1;
  for (const k of q) {
    // the queue grows while it is walked: an array iterator sees the new tail
    if (k === target) break;
    const x = k % w,
      y = (k / w) | 0;
    for (const [dx, dy] of STEPS) {
      const nx = x + dx,
        ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || !pass(nx, ny)) continue;
      const nk = key(nx, ny);
      if (prev[nk] !== -1) continue;
      prev[nk] = k;
      q.push(nk);
    }
  }
  return prev;
}
