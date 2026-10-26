// compile(): a layout → the geometry the office runs on, in passes: walls and doors, walkability, desks, meeting
// tables, reception counters, the rest of the furniture, then every spot a cat can go.
import type { Grid } from './grid.ts';
import { bfs, makeGrid } from './grid.ts';
import type {
  Desk,
  Door,
  Item,
  Layout,
  Meeting,
  Placed,
  Pt,
  Reception,
  Room,
  Spot,
  Wall,
} from './schema.ts';
import {
  doorTiles,
  hasWalls,
  ITEM_KINDS,
  inRect,
  isGlass,
  itemRect,
  ringRect,
  TILE,
  WALL_RISE,
} from './schema.ts';

type ByKind = (kind: string) => Item[];

/**
 * Walls: every non-border ring tile of a walled room that isn't inside a room. 'v' tiles sit on a ring's side columns
 * (only their top shows), 'h' tiles on its top/bottom rows (they show a face); corners are both.
 */
function wallPass(rooms: Room[], grid: Grid) {
  const { w: MAP_W, h: MAP_H, inMap } = grid;
  const border = (x: number, y: number) =>
    x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1;
  const doors: Required<Door>[] = [];
  for (const r of rooms)
    for (const d of r.doors || [])
      doors.push({ x: d.x, y: d.y, open: !!d.open });
  const walls = new Map<number, Wall>();
  for (const r of rooms) {
    if (!hasWalls(r)) continue;
    const g = ringRect(r);
    for (let y = g.y; y < g.y + g.h; y++)
      for (let x = g.x; x < g.x + g.w; x++) {
        if (inRect(r, x, y) || !inMap(x, y) || border(x, y)) continue;
        const k = y * MAP_W + x;
        const t = walls.get(k) || { x, y, v: false, h: false, glass: false };
        if (y === g.y || y === g.y + g.h - 1) t.h = true;
        else t.v = true;
        if (x === g.x || x === g.x + g.w - 1) t.v = true;
        t.glass ||= isGlass(r);
        walls.set(k, t);
      }
  }
  for (const [k, t] of walls)
    if (rooms.some((r) => inRect(r, t.x, t.y))) walls.delete(k);
  const wallTiles = [...walls.values()].sort((a, b) => a.y - b.y || a.x - b.x);
  return { doors, wallTiles };
}

/** Walkability: the outer wall and the partitions block, doorways don't. Furniture passes block their own tiles. */
function walkPass(grid: Grid, wallTiles: Wall[], doors: Door[]) {
  const { w, h } = grid;
  grid.block(0, 0, w, 1);
  grid.block(0, h - 1, w, 1);
  grid.block(0, 0, 1, h);
  grid.block(w - 1, 0, 1, h);
  for (const t of wallTiles) grid.block(t.x, t.y);
  for (const d of doors) grid.unblock(d.x, d.y);
}

/**
 * Desks: each pod is [chair][desk][desk][chair], the two cats facing each other in profile; the aisle beside a chair
 * holds the assistants when every meeting room is taken.
 */
function deskPass(pods: Item[], grid: Grid) {
  const { w, h } = ITEM_KINDS.deskPod;
  const desks: Desk[] = [];
  for (const p of pods) {
    desks.push({
      item: p.id,
      y: p.y,
      desk: { x: p.x + 1, y: p.y, w: 1, h },
      chair: { x: p.x, y: p.y, face: 'right' },
      aisle: p.x - 1,
    });
    desks.push({
      item: p.id,
      y: p.y,
      desk: { x: p.x + w - 2, y: p.y, w: 1, h },
      chair: { x: p.x + w - 1, y: p.y, face: 'left' },
      aisle: p.x + w,
      right: true,
    });
    grid.block(p.x + 1, p.y, w - 2, h);
  }
  return desks;
}

/**
 * Meeting tables: the table fills the footprint less a one-tile ring of seats — four above, four below (backs to the
 * viewer), two on the right, head + one on the left. Named after the room they stand in.
 */
function meetingPass(tables: Item[], rooms: Room[], grid: Grid): Meeting[] {
  return tables.map((t) => {
    const area0 = itemRect(t),
      table = { x: t.x + 1, y: t.y + 1, w: area0.w - 2, h: area0.h - 2 };
    const { x: tx, y: ty } = table;
    const room = rooms.find((r) => inRect(r, tx, ty));
    const seats: Meeting['seats'] = [];
    for (let i = 0; i < table.w; i++) seats.push({ x: tx + i, y: ty - 1 });
    for (let i = 0; i < table.w; i++)
      seats.push({ x: tx + i, y: ty + table.h, back: true });
    seats.push(
      { x: tx + table.w, y: ty },
      { x: tx + table.w, y: ty + 1 },
      { x: tx - 1, y: ty + 1 },
    );
    grid.block(tx, ty, table.w, table.h);
    const area = room || area0;
    return {
      item: t.id,
      name: room?.name || '회의 테이블',
      x: area.x,
      y: area.y,
      w: area.w,
      h: area.h,
      table,
      head: { x: tx - 1, y: ty },
      seats,
    };
  });
}

/** Reception: a counter along the footprint's bottom row, the receptionist's tile in the middle above it. */
function receptionPass(items: Item[], grid: Grid) {
  const receptions: Reception[] = items.map((r) => ({
    item: r.id,
    counter: { x: r.x, y: r.y + 1, w: ITEM_KINDS.reception.w },
    cat: { x: r.x + 1, y: r.y },
  }));
  for (const r of receptions) {
    grid.block(r.counter.x, r.counter.y, r.counter.w, 1);
    grid.block(r.cat.x, r.cat.y);
  }
  return receptions;
}

// furniture that blocks its whole footprint (sofas don't: cats sit on them)
const SOLID = [
  'coffee',
  'whiteboard',
  'bookshelf',
  'catTree',
  'scratchPost',
  'box',
  'plant',
  'wheel',
];
/** The rest of the furniture: placed pieces the background and the spots need, each blocking its footprint. */
function furniturePass(byKind: ByKind, grid: Grid) {
  const placed = (k: string): Placed[] =>
    byKind(k).map((it) => ({
      item: it.id,
      x: it.x,
      y: it.y,
      w: itemRect(it).w,
    }));
  const sofas = placed('sofa');
  const whiteboards = placed('whiteboard');
  const bookshelves = placed('bookshelf');
  for (const k of SOLID)
    for (const it of byKind(k)) {
      const r = itemRect(it);
      grid.block(r.x, r.y, r.w, r.h);
    }
  return { sofas, coffees: byKind('coffee'), whiteboards, bookshelves };
}

/** Where cats go besides desks and meeting rooms, on walkable floor only (`on`: the cat sits on the item itself). */
function spotPass(
  rooms: Room[],
  byKind: ByKind,
  grid: Grid,
  f: ReturnType<typeof furniturePass>,
  receptions: Reception[],
  spawn: Pt,
) {
  const { inMap, isBlocked } = grid;
  const keep = (spots: Spot[]) =>
    spots.filter((p) => inMap(p.x, p.y) && (p.on || !isBlocked(p.x, p.y)));

  // where idle cats hang out, and what they do there
  const play: Spot[] = [];
  for (const it of byKind('catTree'))
    play.push({ x: it.x, y: it.y, act: 'perch', of: it.id, on: true }); // on top of the cat tree
  for (const it of byKind('scratchPost'))
    play.push({ x: it.x - 1, y: it.y, act: 'scratch', of: it.id }); // clawing the post's left side
  for (const it of byKind('yarn'))
    play.push({ x: it.x - 1, y: it.y, act: 'bat', of: it.id }); // batting the yarn ball
  for (const it of byKind('box'))
    play.push({ x: it.x, y: it.y, act: 'box', of: it.id, on: true }); // sitting in the box
  for (const it of byKind('wheel'))
    play.push({ x: it.x, y: it.y, act: 'wheel', of: it.id, on: true }); // running in the wheel
  for (const it of byKind('cushion'))
    play.push({ x: it.x, y: it.y, act: 'nap', of: it.id }); // curled up on the cushion
  // a few lookout spots spread along each play area's top row
  for (const r of rooms) {
    if (r.type !== 'play') continue;
    const row: number[] = [];
    for (let x = r.x; x < r.x + r.w; x++) if (!isBlocked(x, r.y)) row.push(x);
    const n = Math.min(3, row.length);
    for (let i = 0; i < n; i++) {
      const x = row[n === 1 ? 0 : Math.round((i * (row.length - 1)) / (n - 1))];
      if (x !== undefined) play.push({ x, y: r.y, act: 'look' }); // always: the index is within row
    }
  }
  const lounge: Spot[] = [];
  for (const s of f.sofas)
    for (let i = 0; i < s.w; i++)
      lounge.push({ x: s.x + i, y: s.y, sofa: true });
  for (const c of f.coffees)
    lounge.push({ x: c.x - 1, y: c.y }, { x: c.x - 1, y: c.y + 1 });
  const plan: Spot[] = [];
  for (const b of f.whiteboards)
    for (let x = b.x - 1; x <= b.x + b.w; x++)
      plan.push({ x, y: b.y + 1, of: b.item }); // in front of the board
  const library: Spot[] = [];
  for (const b of f.bookshelves)
    for (let x = b.x; x < b.x + b.w - 1; x++) library.push({ x, y: b.y - 1 }); // in front of the shelf

  // overflow standing room: the lobby's open floor below the reception counter, above its bottom row
  const lobbies = rooms.filter((r) => r.type === 'lobby');
  const bullpen: Pt[] = [];
  for (const r of lobbies) {
    const rc = receptions.find((c) => inRect(r, c.counter.x, c.counter.y));
    const top = rc ? rc.counter.y + 2 : r.y;
    for (let y = top; y < r.y + r.h - 1; y++)
      for (let x = r.x; x < r.x + r.w; x++)
        if (!isBlocked(x, y)) bullpen.push({ x, y });
  }
  if (!bullpen.length) bullpen.push({ ...spawn });
  return {
    lobby: lobbies[0] || null,
    playSpots: keep(play),
    loungeSpots: keep(lounge),
    planSpots: keep(plan),
    librarySpots: keep(library),
    bullpenSpots: bullpen,
  };
}

/** Office data → runtime geometry. Assumes a validated office, but tolerates junk (clips to the map, drops unknown kinds). */
export function compile(office: Layout) {
  const MAP_W = office.w,
    MAP_H = office.h;
  const W = MAP_W * TILE,
    H = MAP_H * TILE;
  const { door, spawn } = doorTiles({
    ...office,
    door: { x: 3, ...office.door },
  });
  const rooms = office.rooms || [];
  const items = (office.items || []).filter((it) => ITEM_KINDS[it.kind]);
  const byKind = (k: string) => items.filter((it) => it.kind === k);
  const grid = makeGrid(MAP_W, MAP_H);

  const { doors, wallTiles } = wallPass(rooms, grid);
  const doorAt = (x: number, y: number) =>
    doors.find((d) => d.x === x && d.y === y);
  walkPass(grid, wallTiles, doors);
  const desks = deskPass(byKind('deskPod'), grid);
  const meetings = meetingPass(byKind('meetingTable'), rooms, grid);
  const receptions = receptionPass(byKind('reception'), grid);
  const furniture = furniturePass(byKind, grid);
  const spots = spotPass(rooms, byKind, grid, furniture, receptions, spawn);
  const { isBlocked } = grid;

  const geo = {
    office,
    TILE,
    MAP_W,
    MAP_H,
    W,
    H,
    VIEW_H: H + WALL_RISE,
    WALL_RISE,
    door,
    spawn,
    rooms,
    items,
    wallTiles,
    doors,
    desks,
    meetings,
    receptions,
    sofas: furniture.sofas,
    coffees: furniture.coffees,
    whiteboards: furniture.whiteboards,
    bookshelves: furniture.bookshelves,
    rugs: byKind('rug'),
    plants: byKind('plant'),
    windows: byKind('window'),
    signs: byKind('sign'),
    yarns: byKind('yarn'),
    boxes: byKind('box'),
    wheels: byKind('wheel'),
    catTrees: byKind('catTree'),
    scratchPosts: byKind('scratchPost'),
    cushions: byKind('cushion'),
    lobby: spots.lobby,
    playSpots: spots.playSpots,
    loungeSpots: spots.loungeSpots,
    planSpots: spots.planSpots,
    librarySpots: spots.librarySpots,
    bullpenSpots: spots.bullpenSpots,
    isBlocked,
    isDoor: (x: number, y: number) => !!doorAt(x, y),
    doorAt,
    /** Standing spots in the aisle beside a desk's chair. */
    nearDeskSpots(i: number): Pt[] {
      const d = desks[i];
      if (!d) return [];
      return [
        { x: d.aisle, y: d.y },
        { x: d.aisle, y: d.y - 1 },
        { x: d.aisle, y: d.y + 1 },
      ];
    },
    /** BFS shortest path on the tile grid. Returns tiles after `from` ending at `to`, [] if equal, null if unreachable. */
    findPath(from: Pt, to: Pt): Pt[] | null {
      if (from.x === to.x && from.y === to.y) return [];
      // the destination may be a blocked tile (a seat on furniture): step onto it, never through one
      const prev = bfs(
        MAP_W,
        MAP_H,
        from,
        (x, y) => !isBlocked(x, y) || (x === to.x && y === to.y),
        to,
      );
      const key = (x: number, y: number) => y * MAP_W + x;
      const target = key(to.x, to.y);
      if (!((prev[target] ?? -1) >= 0)) return null;
      const path: Pt[] = [];
      const start = key(from.x, from.y);
      // every reached tile's predecessor is reached too, back to the start (which points at itself)
      for (let k = target; k !== start; k = prev[k] ?? start)
        path.push({ x: k % MAP_W, y: (k / MAP_W) | 0 });
      return path.reverse();
    },
  };
  return geo;
}

/** The runtime geometry of an office (what compile() returns). */
export type Geo = ReturnType<typeof compile>;
