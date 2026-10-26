import { TILE } from '../shared/layout.ts';

/** What step() moves: anything with a position and a tile path. */
export interface Walker {
  x: number;
  y: number;
  dir?: number;
  path?: { x: number; y: number }[] | null;
  onArrive?: (() => void) | null;
}

const SPEED = 64; // logical px per second (cats run)

/** Advance an entity along its path. Returns true if it moved. */
export function step(ent: Walker, dt: number) {
  const path = ent.path,
    next = path?.[0];
  if (!path || !next) return false;
  const tx = next.x * TILE,
    ty = next.y * TILE;
  const dx = tx - ent.x,
    dy = ty - ent.y;
  const dist = Math.hypot(dx, dy);
  const d = SPEED * dt;
  if (Math.abs(dx) > 0.5) ent.dir = dx < 0 ? -1 : 1; // facing for the side-on run sprite
  if (dist <= d) {
    ent.x = tx;
    ent.y = ty;
    path.shift();
    if (path.length === 0 && ent.onArrive) {
      const f = ent.onArrive;
      ent.onArrive = null;
      f();
    }
  } else {
    ent.x += (dx / dist) * d;
    ent.y += (dy / dist) * d;
  }
  return true;
}
