// Pure edits on a layout draft for the editor (editor.js): door upkeep, moving rooms and furniture, hit testing and
// room names. Every function takes the draft and touches nothing else, so plain Node imports this file too (tests).
// Editor-only: the server imports layout.js, not this.

import type { Item, Layout, Pt, Room } from '../shared/layout.ts';
import {
  hasWalls,
  ITEM_KINDS,
  inRect,
  itemRect,
  ROOM_TYPES,
  ringRect,
} from '../shared/layout.ts';
import { clamp } from './anim.ts';

export interface Contained {
  it: Item;
  dx: number;
  dy: number;
}

// ---- geometry ---------------------------------------------------------------------------
/** Where a new or reshaped room gets its door: middle of its bottom wall, else the top, else a side. */
export function autoDoor(draft: Layout, r: Room): Pt {
  const { h, w } = draft;
  const mx = r.x + Math.floor(r.w / 2),
    my = r.y + Math.floor(r.h / 2);
  if (r.y + r.h < h - 1) return { x: mx, y: r.y + r.h };
  if (r.y - 1 > 0) return { x: mx, y: r.y - 1 };
  if (r.x + r.w < w - 1) return { x: r.x + r.w, y: my };
  return { x: r.x - 1, y: my };
}
/** Keep only doors still on the room's ring (corners excluded); a walled room always keeps one. */
export function fixDoors(draft: Layout, r: Room) {
  const g = ringRect(r);
  r.doors = r.doors.filter(
    (d) =>
      inRect(g, d.x, d.y) &&
      !inRect(r, d.x, d.y) &&
      !(
        (d.x === g.x || d.x === g.x + g.w - 1) &&
        (d.y === g.y || d.y === g.y + g.h - 1)
      ),
  );
  if (hasWalls(r) && !r.doors.length) r.doors.push(autoDoor(draft, r));
}
/** Furniture standing entirely inside a room moves with it. */
export function contents(draft: Layout, r: Room) {
  return draft.items
    .filter((it) => {
      if (ITEM_KINDS[it.kind].wall) return false;
      const b = itemRect(it);
      return (
        b.x >= r.x &&
        b.y >= r.y &&
        b.x + b.w <= r.x + r.w &&
        b.y + b.h <= r.y + r.h
      );
    })
    .map((it) => ({ it, dx: it.x - r.x, dy: it.y - r.y }));
}
export function moveRoom(
  draft: Layout,
  r: Room,
  x: number,
  y: number,
  inside: Contained[],
) {
  const { w, h } = draft;
  x = clamp(x, 1, w - 1 - r.w);
  y = clamp(y, 1, h - 1 - r.h);
  const dx = x - r.x,
    dy = y - r.y;
  r.x = x;
  r.y = y;
  for (const d of r.doors) {
    d.x += dx;
    d.y += dy;
  }
  for (const c of inside) {
    c.it.x = x + c.dx;
    c.it.y = y + c.dy;
  }
}
export function moveItem(draft: Layout, it: Item, x: number, y: number) {
  const k = ITEM_KINDS[it.kind],
    { w, h } = draft;
  it.x = clamp(x, 1, w - 1 - k.w);
  it.y = k.wall ? 0 : clamp(y, 1, h - 1 - k.h);
}

// ---- hit testing (tile coords) ------------------------------------------------------------
export function itemAt(draft: Layout, tx: number, ty: number): Item | null {
  const layer = (it: Item) =>
    ITEM_KINDS[it.kind].wall ? 2 : ITEM_KINDS[it.kind].floor ? 0 : 1;
  let best: Item | null = null;
  for (const it of draft.items) {
    const k = ITEM_KINDS[it.kind];
    if (!k) continue;
    const y = k.wall && ty < 0 ? 0 : ty; // wall items also catch clicks on the raised wall above row 0
    if (inRect(itemRect(it), tx, y) && (!best || layer(it) >= layer(best)))
      best = it;
  }
  return best;
}
export function roomAt(draft: Layout, tx: number, ty: number): Room | null {
  let best: Room | null = null;
  for (const r of draft.rooms)
    if (inRect(r, tx, ty) && (!best || r.w * r.h < best.w * best.h)) best = r;
  return best;
}
/** Walled rooms whose wall runs through this tile (not a corner, not the outer wall, not inside a room). */
export function wallRoomsAt(draft: Layout, tx: number, ty: number): Room[] {
  const { w, h } = draft;
  if (tx <= 0 || ty <= 0 || tx >= w - 1 || ty >= h - 1 || roomAt(draft, tx, ty))
    return [];
  return draft.rooms.filter((r) => {
    if (!hasWalls(r)) return false;
    const g = ringRect(r);
    return (
      inRect(g, tx, ty) &&
      !(
        (tx === g.x || tx === g.x + g.w - 1) &&
        (ty === g.y || ty === g.y + g.h - 1)
      )
    );
  });
}

// ---- front door ---------------------------------------------------------------------------
/** On the outer wall (or the raised part of the top wall above it), where the front door can go. */
export function onOuterWall(draft: Layout, tx: number, ty: number) {
  const { w, h } = draft;
  return (
    tx >= 0 &&
    tx < w &&
    ty >= -1 &&
    ty < h &&
    (tx === 0 || ty <= 0 || tx === w - 1 || ty === h - 1)
  );
}
/** Keep the front door on its wall when the office is resized. */
export function fixFrontDoor(draft: Layout) {
  const d = draft;
  const side = d.door?.side || 'bottom',
    top = side === 'top' || side === 'bottom';
  const at = top ? d.door?.x : d.door?.y,
    len = top ? d.w : d.h;
  if (Number.isInteger(at) && Number.isInteger(len))
    d.door = top
      ? { side, x: clamp(at!, 1, len - 2) }
      : { side, y: clamp(at!, 1, len - 2) };
}

/** A new room's name: the type's label; meeting rooms get the first free letter ("회의실 A", "회의실 B", …). */
export function roomName(draft: Layout, type: string) {
  const label = ROOM_TYPES[type].label;
  if (type !== 'meeting') return label;
  const used = new Set(draft.rooms.map((r) => r.name));
  for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')
    if (!used.has(`${label} ${c}`)) return `${label} ${c}`;
  return label;
}
