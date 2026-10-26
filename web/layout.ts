// Office layouts as data. An office is a w×h grid of 16px tiles holding rooms (rectangles; walls are generated
// around them) and furniture items. compile() turns one into the geometry the office runs on: walls, doors,
// walkability, desks, meeting rooms and every spot a cat can go. Pure ESM with no DOM, so the server imports it too.
import { MAX_NAME_CHARS } from './limits.ts';

export interface Pt { x: number; y: number }
export interface Rect extends Pt { w: number; h: number }
export interface Door extends Pt { open?: boolean }
/** The front door: `x` along the top/bottom wall, `y` along the left/right one. */
export interface FrontDoor { side: string; x?: number; y?: number }
export interface Room extends Rect { id: string; type: string; name: string; glass?: boolean; walls?: boolean; doors: Door[] }
export interface Item extends Pt { id: string; kind: string }
/** An office as saved: what the server stores and the editor edits. */
export interface Layout { v: number; w: number; h: number; door: FrontDoor; rooms: Room[]; items: Item[] }
export interface RoomTypeDef { label: string; glass?: boolean; walls?: boolean }
export interface ItemKindDef { label: string; w: number; h: number; max?: number; floor?: boolean; wall?: boolean }
/** A tile a cat can go to (`on`: the cat sits on the item itself; `act`: what it does there). */
export interface Spot extends Pt { on?: boolean; act?: string; of?: string; sofa?: boolean }
export interface Wall extends Pt { v: boolean; h: boolean; glass: boolean }
export interface Desk { item: string; y: number; desk: Rect; chair: Pt & { face: string }; aisle: number; right?: boolean }
export interface Meeting extends Rect { item: string; name: string; table: Rect; head: Pt; seats: (Pt & { back?: boolean })[] }
export interface Reception { item: string; counter: Pt & { w: number }; cat: Pt }
export interface Placed extends Pt { item: string; w: number }
export interface WallError { msg: string; tiles: Pt[] }

export const TILE = 16;
/** Extra height above row 0 so the top wall's face stands two tiles tall (3/4 view). Purely visual: the grid starts below it. */
export const WALL_RISE = TILE;
/** 2: play rooms have walls by default (v1 play rooms without a `walls` field stay open), the front door has a side. */
const LAYOUT_VERSION = 2;
export const MIN_W = 20, MIN_H = 14, MAX_W = 64, MAX_H = 40;

/** Room types: floor colors live in tilemap.js. A room's walls are glass when `glass` (default: meeting rooms). */
export const ROOM_TYPES: Record<string, RoomTypeDef> = {
  meeting: { label: '회의실', glass: true },
  lobby: { label: '로비' },
  lounge: { label: '라운지' },
  plan: { label: '기획실' },
  library: { label: '서재' },
  play: { label: '놀이터' },
  office: { label: '사무 공간' },
};

/**
 * Furniture. w × h is the footprint the editor moves and overlap-checks; `floor` items (rugs) lie under the rest,
 * `wall` items hang on the top wall (row 0). Seats and spots are derived in compile().
 */
export const ITEM_KINDS: Record<string, ItemKindDef> = {
  deskPod: { label: '책상 (2인)', w: 4, h: 2 },
  meetingTable: { label: '회의 테이블', w: 6, h: 4 },
  reception: { label: '안내 데스크', w: 3, h: 2, max: 1 },
  sofa: { label: '소파', w: 3, h: 3 },
  coffee: { label: '커피 머신', w: 1, h: 1 },
  rug: { label: '러그', w: 5, h: 5, floor: true },
  whiteboard: { label: '화이트보드', w: 3, h: 1 },
  bookshelf: { label: '책장', w: 6, h: 1 },
  catTree: { label: '캣타워', w: 1, h: 1 },
  scratchPost: { label: '스크래처', w: 1, h: 1 },
  yarn: { label: '털실', w: 1, h: 1 },
  box: { label: '상자', w: 1, h: 1 },
  wheel: { label: '캣휠', w: 2, h: 1 },
  cushion: { label: '방석', w: 1, h: 1 },
  plant: { label: '화분', w: 1, h: 1 },
  window: { label: '창문', w: 6, h: 1, wall: true },
  sign: { label: '간판', w: 5, h: 1, wall: true, max: 1 },
};

/**
 * The default office: one room of each type. Meeting room, open office and library along the top; a corridor
 * (row 9); lobby, lounge, planning room and play room along the bottom.
 */
export const DEFAULT_OFFICE: Layout = {
  v: LAYOUT_VERSION,
  w: 32, h: 19,
  door: { side: 'bottom', x: 3 },
  rooms: [
    { id: 'r1', type: 'meeting', name: '회의실', x: 1, y: 1, w: 6, h: 7, doors: [{ x: 4, y: 8 }] },
    { id: 'r2', type: 'office', name: '사무 공간', x: 8, y: 1, w: 16, h: 7, doors: [{ x: 13, y: 8 }, { x: 18, y: 8 }] },
    { id: 'r3', type: 'library', name: '서재', x: 25, y: 1, w: 6, h: 7, doors: [{ x: 24, y: 3 }] }, // opens into the office
    { id: 'r4', type: 'lobby', name: '로비', x: 1, y: 11, w: 7, h: 7, doors: [{ x: 6, y: 10, open: true }] },
    { id: 'r5', type: 'lounge', name: '라운지', x: 9, y: 11, w: 7, h: 7, doors: [{ x: 12, y: 10 }] },
    { id: 'r6', type: 'plan', name: '기획실', x: 17, y: 11, w: 5, h: 7, doors: [{ x: 19, y: 10 }] },
    { id: 'r7', type: 'play', name: '놀이터', x: 23, y: 11, w: 8, h: 7, doors: [{ x: 26, y: 10 }] },
  ],
  items: [
    ...[[9, 2], [14, 2], [19, 2], [9, 5], [14, 5], [19, 5]].map(([x, y], i) => ({ id: `d${i + 1}`, kind: 'deskPod', x, y })),
    { id: 't1', kind: 'meetingTable', x: 1, y: 2 },
    { id: 'i1', kind: 'reception', x: 2, y: 11 },
    { id: 'i2', kind: 'rug', x: 10, y: 12 },
    { id: 'i3', kind: 'sofa', x: 11, y: 13 },
    { id: 'i4', kind: 'coffee', x: 15, y: 11 },
    { id: 'i5', kind: 'whiteboard', x: 18, y: 12 },
    { id: 'i6', kind: 'bookshelf', x: 25, y: 7 },
    { id: 'i7', kind: 'catTree', x: 24, y: 12 },
    { id: 'i8', kind: 'scratchPost', x: 27, y: 12 },
    { id: 'i9', kind: 'yarn', x: 25, y: 15 },
    { id: 'i10', kind: 'box', x: 29, y: 17 },
    { id: 'i11', kind: 'wheel', x: 28, y: 14 },
    { id: 'i12', kind: 'cushion', x: 24, y: 17 },
    ...[[1, 11], [7, 17], [9, 17], [17, 17], [21, 17], [30, 11], [8, 7], [23, 7], [30, 1], [1, 7]].map(([x, y], i) => ({ id: `p${i + 1}`, kind: 'plant', x, y })),
    { id: 'w1', kind: 'window', x: 14, y: 0 },
    { id: 'w2', kind: 'sign', x: 21, y: 0 },
  ],
};

export const cloneOffice = <T>(o: T): T => JSON.parse(JSON.stringify(o));

/** The front door sits on one of the outer walls: `x` along the top/bottom wall, `y` along the left/right one. */
export const DOOR_SIDES: Record<string, string> = { bottom: '아래', top: '위', left: '왼쪽', right: '오른쪽' };
const horizontal = (side: string) => side === 'top' || side === 'bottom';
/** The door's tile on the outer wall and the floor tile just inside it, where cats come in and leave. */
export function doorTiles(office: Layout) {
  const { w, h } = office, side = (office.door?.side && office.door.side in DOOR_SIDES ? office.door.side : 'bottom');
  const at = (horizontal(side) ? office.door?.x : office.door?.y) as number;
  const door = { side, x: side === 'left' ? 0 : side === 'right' ? w - 1 : at, y: side === 'top' ? 0 : side === 'bottom' ? h - 1 : at };
  const spawn = { x: door.x + (side === 'left' ? 1 : side === 'right' ? -1 : 0), y: door.y + (side === 'top' ? 1 : side === 'bottom' ? -1 : 0) };
  return { door, spawn };
}
/** Door data for a tile on (or near) the outer wall: the closest wall wins, corners excluded. */
export function doorFor(office: Layout, tx: number, ty: number): FrontDoor {
  const { w, h } = office;
  const x = Math.max(0, Math.min(w - 1, tx)), y = Math.max(0, Math.min(h - 1, ty));
  const side = Object.entries({ left: x, right: w - 1 - x, top: y, bottom: h - 1 - y }).sort((a, b) => a[1] - b[1])[0][0];
  return horizontal(side) ? { side, x: Math.max(1, Math.min(w - 2, x)) } : { side, y: Math.max(1, Math.min(h - 2, y)) };
}

/** Only the fields a layout has (anything else from a client is dropped), upgraded to this version. Validate the result. */
export function normalize(o: any): Layout | null { // o: untrusted JSON from a client
  if (!o || typeof o !== 'object') return null;
  const pick = (src: any, keys: string[]) => Object.fromEntries(keys.filter((k) => src?.[k] !== undefined).map((k) => [k, src[k]]));
  const old = !(o.v >= 2);
  const side = DOOR_SIDES[o.door?.side] ? o.door.side : 'bottom';
  return {
    v: LAYOUT_VERSION, w: o.w, h: o.h, door: horizontal(side) ? { side, x: o.door?.x } : { side, y: o.door?.y },
    rooms: Array.isArray(o.rooms) ? o.rooms.map((r: any) => ({
      ...pick(r, ['id', 'type', 'name', 'x', 'y', 'w', 'h', 'glass', 'walls']),
      ...(old && r?.type === 'play' && r.walls === undefined ? { walls: false } : {}), // v1 play rooms had no walls
      doors: Array.isArray(r?.doors) ? r.doors.map((d: any) => ({ x: d?.x, y: d?.y, ...(d?.open ? { open: true } : {}) })) : r?.doors,
    })) : o.rooms,
    items: Array.isArray(o.items) ? o.items.map((it: any) => pick(it, ['id', 'kind', 'x', 'y'])) : o.items,
  };
}
export const inRect = (r: Rect, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
export const hasWalls = (r: Room) => (ROOM_TYPES[r.type]?.walls ?? true) && r.walls !== false;
const isGlass = (r: Room) => r.glass ?? ROOM_TYPES[r.type]?.glass ?? false;
const itemSize = (it: Item) => ITEM_KINDS[it.kind] || { w: 1, h: 1 };
export const itemRect = (it: Item): Rect => ({ x: it.x, y: it.y, ...(({ w, h }) => ({ w, h }))(itemSize(it)) });
/** The ring of tiles around a room, where its walls stand. */
export const ringRect = (r: Rect): Rect => ({ x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 });

// ---- compile -------------------------------------------------------------------------
/** Office data → runtime geometry. Assumes a validated office, but tolerates junk (clips to the map, drops unknown kinds). */
export function compile(office: Layout) {
  const MAP_W = office.w, MAP_H = office.h;
  const W = MAP_W * TILE, H = MAP_H * TILE;
  const { door, spawn } = doorTiles({ ...office, door: { x: 3, ...office.door } });
  const rooms = office.rooms || [];
  const items = (office.items || []).filter((it) => ITEM_KINDS[it.kind]);
  const byKind = (k: string) => items.filter((it) => it.kind === k);
  const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
  const border = (x: number, y: number) => x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1;

  // walls: every non-border ring tile of a walled room that isn't inside a room. 'v' tiles sit on a ring's side
  // columns (only their top shows), 'h' tiles on its top/bottom rows (they show a face); corners are both.
  const doors: Required<Door>[] = [];
  for (const r of rooms) for (const d of r.doors || []) doors.push({ x: d.x, y: d.y, open: !!d.open });
  const doorAt = (x: number, y: number) => doors.find((d) => d.x === x && d.y === y);
  const walls = new Map<number, Wall>();
  for (const r of rooms) {
    if (!hasWalls(r)) continue;
    const g = ringRect(r);
    for (let y = g.y; y < g.y + g.h; y++) for (let x = g.x; x < g.x + g.w; x++) {
      if (inRect(r, x, y) || !inMap(x, y) || border(x, y)) continue;
      const k = y * MAP_W + x;
      const t = walls.get(k) || { x, y, v: false, h: false, glass: false };
      if (y === g.y || y === g.y + g.h - 1) t.h = true; else t.v = true;
      if (x === g.x || x === g.x + g.w - 1) t.v = true;
      t.glass ||= isGlass(r);
      walls.set(k, t);
    }
  }
  for (const [k, t] of walls) if (rooms.some((r) => inRect(r, t.x, t.y))) walls.delete(k);
  const wallTiles = [...walls.values()].sort((a, b) => a.y - b.y || a.x - b.x);

  // walkability
  const blocked = new Uint8Array(MAP_W * MAP_H);
  const block = (x: number, y: number, w = 1, h = 1) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (inMap(i, j)) blocked[j * MAP_W + i] = 1; };
  block(0, 0, MAP_W, 1); block(0, MAP_H - 1, MAP_W, 1); block(0, 0, 1, MAP_H); block(MAP_W - 1, 0, 1, MAP_H);
  for (const t of wallTiles) block(t.x, t.y);
  for (const d of doors) if (inMap(d.x, d.y)) blocked[d.y * MAP_W + d.x] = 0;

  // desks: each pod is [chair][desk][desk][chair], the two cats facing each other in profile; the aisle beside a chair
  // holds the assistants when every meeting room is taken.
  const desks: Desk[] = [];
  for (const p of byKind('deskPod')) {
    desks.push({ item: p.id, y: p.y, desk: { x: p.x + 1, y: p.y, w: 1, h: 2 }, chair: { x: p.x, y: p.y, face: 'right' }, aisle: p.x - 1 });
    desks.push({ item: p.id, y: p.y, desk: { x: p.x + 2, y: p.y, w: 1, h: 2 }, chair: { x: p.x + 3, y: p.y, face: 'left' }, aisle: p.x + 4, right: true });
    block(p.x + 1, p.y, 2, 2);
  }

  // meeting tables: a 4×2 table inside a 6×4 footprint, four seats above, four below (backs to the viewer), two on
  // the right, head + one on the left. Named after the room they stand in.
  const meetings: Meeting[] = byKind('meetingTable').map((t) => {
    const tx = t.x + 1, ty = t.y + 1;
    const room = rooms.find((r) => inRect(r, tx, ty));
    const seats: Meeting['seats'] = [];
    for (let i = 0; i < 4; i++) seats.push({ x: tx + i, y: ty - 1 });
    for (let i = 0; i < 4; i++) seats.push({ x: tx + i, y: ty + 2, back: true });
    seats.push({ x: tx + 4, y: ty }, { x: tx + 4, y: ty + 1 }, { x: tx - 1, y: ty + 1 });
    block(tx, ty, 4, 2);
    const area = room || { x: t.x, y: t.y, w: 6, h: 4 };
    return { item: t.id, name: room?.name || '회의 테이블', x: area.x, y: area.y, w: area.w, h: area.h, table: { x: tx, y: ty, w: 4, h: 2 }, head: { x: tx - 1, y: ty }, seats };
  });

  const receptions: Reception[] = byKind('reception').map((r) => ({ item: r.id, counter: { x: r.x, y: r.y + 1, w: 3 }, cat: { x: r.x + 1, y: r.y } }));
  for (const r of receptions) { block(r.counter.x, r.counter.y, r.counter.w, 1); block(r.cat.x, r.cat.y); }
  const sofas: Placed[] = byKind('sofa').map((s) => ({ item: s.id, x: s.x, y: s.y, w: 3 }));
  const coffees = byKind('coffee');
  const whiteboards: Placed[] = byKind('whiteboard').map((b) => ({ item: b.id, x: b.x, y: b.y, w: 3 }));
  const bookshelves: Placed[] = byKind('bookshelf').map((b) => ({ item: b.id, x: b.x, y: b.y, w: 6 }));
  for (const c of coffees) block(c.x, c.y);
  for (const b of [...whiteboards, ...bookshelves]) block(b.x, b.y, b.w, 1);
  for (const k of ['catTree', 'scratchPost', 'box', 'plant']) for (const it of byKind(k)) block(it.x, it.y);
  for (const it of byKind('wheel')) block(it.x, it.y, 2, 1);

  const isBlocked = (x: number, y: number) => !inMap(x, y) || blocked[y * MAP_W + x] === 1;
  // spots on walkable floor only (`on`: the cat sits on the item itself, which blocks walking through)
  const keep = (spots: Spot[]) => spots.filter((p) => inMap(p.x, p.y) && (p.on || !isBlocked(p.x, p.y)));

  // where idle cats hang out, and what they do there
  const play: Spot[] = [];
  for (const it of byKind('catTree')) play.push({ x: it.x, y: it.y, act: 'perch', of: it.id, on: true });   // on top of the cat tree
  for (const it of byKind('scratchPost')) play.push({ x: it.x - 1, y: it.y, act: 'scratch', of: it.id }); // clawing the post's left side
  for (const it of byKind('yarn')) play.push({ x: it.x - 1, y: it.y, act: 'bat', of: it.id });           // batting the yarn ball
  for (const it of byKind('box')) play.push({ x: it.x, y: it.y, act: 'box', of: it.id, on: true });       // sitting in the box
  for (const it of byKind('wheel')) play.push({ x: it.x, y: it.y, act: 'wheel', of: it.id, on: true });   // running in the wheel
  for (const it of byKind('cushion')) play.push({ x: it.x, y: it.y, act: 'nap', of: it.id });            // curled up on the cushion
  // a few lookout spots spread along each play area's top row
  for (const r of rooms) {
    if (r.type !== 'play') continue;
    const row: number[] = [];
    for (let x = r.x; x < r.x + r.w; x++) if (!isBlocked(x, r.y)) row.push(x);
    const n = Math.min(3, row.length);
    for (let i = 0; i < n; i++) play.push({ x: row[n === 1 ? 0 : Math.round((i * (row.length - 1)) / (n - 1))], y: r.y, act: 'look' });
  }
  const lounge: Spot[] = [];
  for (const s of sofas) for (let i = 0; i < s.w; i++) lounge.push({ x: s.x + i, y: s.y, sofa: true });
  for (const c of coffees) lounge.push({ x: c.x - 1, y: c.y }, { x: c.x - 1, y: c.y + 1 });
  const plan: Spot[] = [];
  for (const b of whiteboards) for (let x = b.x - 1; x <= b.x + b.w; x++) plan.push({ x, y: b.y + 1, of: b.item }); // in front of the board
  const library: Spot[] = [];
  for (const b of bookshelves) for (let x = b.x; x < b.x + b.w - 1; x++) library.push({ x, y: b.y - 1 }); // in front of the shelf

  // overflow standing room: the lobby's open floor below the reception counter, above its bottom row
  const lobbies = rooms.filter((r) => r.type === 'lobby');
  const bullpen: Pt[] = [];
  for (const r of lobbies) {
    const rc = receptions.find((c) => inRect(r, c.counter.x, c.counter.y));
    const top = rc ? rc.counter.y + 2 : r.y;
    for (let y = top; y < r.y + r.h - 1; y++) for (let x = r.x; x < r.x + r.w; x++) if (!isBlocked(x, y)) bullpen.push({ x, y });
  }
  if (!bullpen.length) bullpen.push({ ...spawn });

  const geo = {
    office, TILE, MAP_W, MAP_H, W, H, VIEW_H: H + WALL_RISE, WALL_RISE,
    door, spawn, rooms, items, wallTiles, doors,
    desks, meetings, receptions, sofas, coffees, whiteboards, bookshelves,
    rugs: byKind('rug'), plants: byKind('plant'), windows: byKind('window'), signs: byKind('sign'),
    yarns: byKind('yarn'), boxes: byKind('box'), wheels: byKind('wheel'), catTrees: byKind('catTree'), scratchPosts: byKind('scratchPost'), cushions: byKind('cushion'),
    lobby: lobbies[0] || null,
    playSpots: keep(play), loungeSpots: keep(lounge), planSpots: keep(plan), librarySpots: keep(library), bullpenSpots: bullpen,
    isBlocked,
    isDoor: (x: number, y: number) => !!doorAt(x, y),
    doorAt,
    /** Standing spots in the aisle beside a desk's chair. */
    nearDeskSpots(i: number): Pt[] {
      const d = desks[i];
      return [{ x: d.aisle, y: d.y }, { x: d.aisle, y: d.y - 1 }, { x: d.aisle, y: d.y + 1 }];
    },
    /** BFS shortest path on the tile grid. Returns tiles after `from` ending at `to`, [] if equal, null if unreachable. */
    findPath(from: Pt, to: Pt): Pt[] | null {
      if (from.x === to.x && from.y === to.y) return [];
      const key = (x: number, y: number) => y * MAP_W + x;
      const prev = new Int32Array(MAP_W * MAP_H).fill(-1);
      const q = [key(from.x, from.y)];
      prev[q[0]] = q[0];
      const target = key(to.x, to.y);
      let head = 0, found = false;
      while (head < q.length) {
        const k = q[head++];
        if (k === target) { found = true; break; }
        const x = k % MAP_W, y = (k / MAP_W) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (!inMap(nx, ny) || (isBlocked(nx, ny) && !(nx === to.x && ny === to.y))) continue;
          const nk = key(nx, ny);
          if (prev[nk] !== -1) continue;
          prev[nk] = k;
          q.push(nk);
        }
      }
      if (!found) return null;
      const path: Pt[] = [];
      for (let k = target; k !== key(from.x, from.y); k = prev[k]) path.push({ x: k % MAP_W, y: (k / MAP_W) | 0 });
      return path.reverse();
    },
  };
  return geo;
}

/** Number of desks an office has (the server assigns them). */
export const deskCount = (office: Layout) => (office.items || []).filter((it) => it.kind === 'deskPod').length * 2;

/** The runtime geometry of an office (what compile() returns). */
export type Geo = ReturnType<typeof compile>;

// ---- validate -------------------------------------------------------------------------
/**
 * Problems that would break the office, as [{ msg, tiles: [{x,y}] }] (empty = fine). Shapes are checked first;
 * reachability only once the shape is sound. The server runs the same check before saving.
 */
export function validate(office: Layout | null | undefined): WallError[] {
  const errs: WallError[] = [];
  const err = (msg: string, tiles: Pt[] = []) => errs.push({ msg, tiles });
  const int = (n: unknown): n is number => Number.isInteger(n);
  if (!office || typeof office !== 'object') return [{ msg: '배치 데이터가 없습니다.', tiles: [] }];
  const { w, h } = office;
  if (!int(w) || !int(h) || w < MIN_W || h < MIN_H || w > MAX_W || h > MAX_H) return [{ msg: `사무실 크기는 ${MIN_W}×${MIN_H} – ${MAX_W}×${MAX_H} 칸이어야 합니다.`, tiles: [] }];
  const side = office.door?.side ?? 'bottom', along = horizontal(side) ? office.door?.x : office.door?.y;
  if (!DOOR_SIDES[side] || !int(along) || along < 1 || along > (horizontal(side) ? w : h) - 2) err('정문 위치가 사무실 밖입니다.');
  const rooms = Array.isArray(office.rooms) ? office.rooms : [];
  const items = Array.isArray(office.items) ? office.items : [];
  if (rooms.length > 40 || items.length > 300) return [{ msg: '방이나 가구가 너무 많습니다.', tiles: [] }];
  const ids = new Set();
  const cells = (r: Rect) => { const t: Pt[] = []; for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) t.push({ x, y }); return t; };
  const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const both = (a: Rect, b: Rect) => cells(a).filter((c) => inRect(b, c.x, c.y));

  for (const r of rooms) {
    if (typeof r?.id !== 'string' || !r.id || ids.has(r.id)) { err('방 id가 잘못되었습니다.'); continue; }
    ids.add(r.id);
    if (!ROOM_TYPES[r.type]) { err(`알 수 없는 방 종류: ${r.type}`); continue; }
    if (typeof r.name !== 'string' || r.name.length > MAX_NAME_CHARS) err(`방 이름은 ${MAX_NAME_CHARS}자 이하여야 합니다.`);
    if (![r.x, r.y, r.w, r.h].every(int) || r.w < 2 || r.h < 2 || r.x < 1 || r.y < 1 || r.x + r.w > w - 1 || r.y + r.h > h - 1) { err(`${r.name || '방'}이(가) 사무실 밖으로 나갔습니다.`, cells(r)); continue; }
    if (!Array.isArray(r.doors)) { err('문 데이터가 잘못되었습니다.'); continue; }
    const g = ringRect(r);
    for (const d of r.doors) {
      const onRing = int(d?.x) && int(d?.y) && inRect(g, d.x, d.y) && !inRect(r, d.x, d.y);
      const corner = onRing && (d.x === g.x || d.x === g.x + g.w - 1) && (d.y === g.y || d.y === g.y + g.h - 1);
      if (!onRing || corner || d.x <= 0 || d.y <= 0 || d.x >= w - 1 || d.y >= h - 1) err(`${r.name}의 문은 방 테두리(모서리 제외, 바깥벽 제외)에 있어야 합니다.`, onRing ? [d] : []);
    }
    if (hasWalls(r) && !r.doors.length) err(`${r.name}에 문이 없습니다.`, cells(r));
  }
  const good = rooms.filter((r) => ROOM_TYPES[r?.type] && [r.x, r.y, r.w, r.h].every(int));
  for (let i = 0; i < good.length; i++) for (let j = i + 1; j < good.length; j++) {
    const a = good[i], b = good[j];
    if (overlap(a, b)) { err(`${a.name}과(와) ${b.name}이(가) 겹칩니다.`, both(a, b)); continue; }
    // a walled room's ring can't run through another room
    for (const [x, y] of [[a, b], [b, a]]) if (hasWalls(x) && overlap(ringRect(x), y)) err(`${x.name}의 벽이 ${y.name}을(를) 지나갑니다.`, both(ringRect(x), y));
  }
  if (!good.some((r) => r.type === 'lobby')) err('로비가 하나는 있어야 합니다.');

  const count: Record<string, number> = {};
  for (const it of items) {
    if (typeof it?.id !== 'string' || !it.id || ids.has(it.id)) { err('가구 id가 잘못되었습니다.'); continue; }
    ids.add(it.id);
    const k = ITEM_KINDS[it.kind];
    if (!k) { err(`알 수 없는 가구: ${it.kind}`); continue; }
    count[it.kind] = (count[it.kind] || 0) + 1;
    if (!int(it.x) || !int(it.y)) { err('가구 위치가 잘못되었습니다.'); continue; }
    const r = itemRect(it);
    if (k.wall) { if (it.y !== 0 || it.x < 1 || it.x + r.w > w - 1) err(`${k.label}은(는) 위쪽 벽에만 걸 수 있습니다.`, cells({ ...r, y: 0 })); }
    else if (it.x < 1 || it.y < 1 || it.x + r.w > w - 1 || it.y + r.h > h - 1) err(`${k.label}이(가) 사무실 밖으로 나갔습니다.`, cells(r).filter((c) => c.x >= 0 && c.y >= 0 && c.x < w && c.y < h));
  }
  for (const [kind, n] of Object.entries(count)) if (ITEM_KINDS[kind].max && n > ITEM_KINDS[kind].max) err(`${ITEM_KINDS[kind].label}은(는) ${ITEM_KINDS[kind].max}개까지 둘 수 있습니다.`);
  if (!count.deskPod) err('책상이 하나는 있어야 합니다.');
  if (errs.length) return errs;

  // furniture vs furniture (same layer), and vs walls
  const solid = items.filter((it) => !ITEM_KINDS[it.kind].floor);
  for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) {
    const a = itemRect(solid[i]), b = itemRect(solid[j]);
    if (overlap(a, b)) err(`${ITEM_KINDS[solid[i].kind].label}과(와) ${ITEM_KINDS[solid[j].kind].label}이(가) 겹칩니다.`, both(a, b));
  }
  const geo = compile(office);
  const wallAt = new Set(geo.wallTiles.filter((t) => !geo.isDoor(t.x, t.y)).map((t) => `${t.x},${t.y}`));
  for (const it of items) {
    if (ITEM_KINDS[it.kind].wall) {
      if (geo.door.side === 'top' && inRect(itemRect(it), geo.door.x, 0)) err(`${ITEM_KINDS[it.kind].label}이(가) 정문을 가립니다.`, [geo.door]);
      continue;
    }
    const hit = cells(itemRect(it)).filter((c) => wallAt.has(`${c.x},${c.y}`) || geo.isDoor(c.x, c.y));
    if (hit.length) err(`${ITEM_KINDS[it.kind].label}이(가) 벽이나 문 위에 있습니다.`, hit);
  }
  if (geo.isBlocked(geo.spawn.x, geo.spawn.y)) err('정문 앞이 막혀 있습니다.', [geo.spawn]);
  if (errs.length) return errs;

  // everyone must be able to walk from the front door to every seat and spot
  const seen = new Uint8Array(w * h);
  const q = [[geo.spawn.x, geo.spawn.y]];
  seen[geo.spawn.y * w + geo.spawn.x] = 1;
  while (q.length) {
    const [x, y] = q.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny * w + nx] || geo.isBlocked(nx, ny)) continue;
      seen[ny * w + nx] = 1; q.push([nx, ny]);
    }
  }
  const reach = (p: Pt) => (!geo.isBlocked(p.x, p.y) ? seen[p.y * w + p.x] : [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen[(p.y + dy) * w + p.x + dx]));
  const cut = (label: string, spots: Pt[]) => { const bad = spots.filter((p) => !reach(p)); if (bad.length) err(`정문에서 갈 수 없는 ${label}이(가) 있습니다.`, bad); };
  cut('책상 자리', geo.desks.map((d) => d.chair));
  cut('회의실 자리', geo.meetings.flatMap((m) => [m.head, ...m.seats]));
  cut('놀이·라운지 자리', [...geo.playSpots, ...geo.loungeSpots]);
  cut('기획·서재 자리', [...geo.planSpots, ...geo.librarySpots]);
  return errs;
}
