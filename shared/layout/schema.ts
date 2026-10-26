// Office layouts as data: the saved shape (an office is a w×h grid of 16px tiles holding rooms — rectangles; walls are
// generated around them — and furniture items), its vocabulary (room types, furniture kinds, the default office) and
// small geometry helpers. Pure, no DOM: the server imports it too.
import { field, isRecord } from '../json.ts';

export interface Pt {
  x: number;
  y: number;
}
export interface Rect extends Pt {
  w: number;
  h: number;
}
export interface Door extends Pt {
  open?: boolean;
}
/** The front door: `x` along the top/bottom wall, `y` along the left/right one. */
export interface FrontDoor {
  side: string;
  x?: number;
  y?: number;
}
export interface Room extends Rect {
  id: string;
  type: string;
  name: string;
  glass?: boolean;
  walls?: boolean;
  doors: Door[];
}
export interface Item extends Pt {
  id: string;
  kind: string;
}
/** An office as saved: what the server stores and the editor edits. */
export interface Layout {
  v: number;
  w: number;
  h: number;
  door: FrontDoor;
  rooms: Room[];
  items: Item[];
}
export interface RoomTypeDef {
  label: string;
  glass?: boolean;
  walls?: boolean;
}
export interface ItemKindDef {
  label: string;
  w: number;
  h: number;
  max?: number;
  floor?: boolean;
  wall?: boolean;
}
/** A tile a cat can go to (`on`: the cat sits on the item itself; `act`: what it does there). */
export interface Spot extends Pt {
  on?: boolean;
  act?: string;
  of?: string;
  sofa?: boolean;
}
export interface Wall extends Pt {
  v: boolean;
  h: boolean;
  glass: boolean;
}
export interface Desk {
  item: string;
  y: number;
  desk: Rect;
  chair: Pt & { face: string };
  aisle: number;
  right?: boolean;
}
export interface Meeting extends Rect {
  item: string;
  name: string;
  table: Rect;
  head: Pt;
  seats: (Pt & { back?: boolean })[];
}
export interface Reception {
  item: string;
  counter: Pt & { w: number };
  cat: Pt;
}
export interface Placed extends Pt {
  item: string;
  w: number;
}
export interface WallError {
  msg: string;
  tiles: Pt[];
}

export const TILE = 16;
/** Extra height above row 0 so the top wall's face stands two tiles tall (3/4 view). Purely visual: the grid starts below it. */
export const WALL_RISE = TILE;
/** 2: play rooms have walls by default (v1 play rooms without a `walls` field stay open), the front door has a side. */
const LAYOUT_VERSION = 2;
export const MIN_W = 20,
  MIN_H = 14,
  MAX_W = 64,
  MAX_H = 40;
/** Whole tiles, within MIN_W×MIN_H – MAX_W×MAX_H. */
export const isOfficeSize = (w: unknown, h: unknown) =>
  Number.isInteger(w) &&
  Number.isInteger(h) &&
  (w as number) >= MIN_W &&
  (h as number) >= MIN_H &&
  (w as number) <= MAX_W &&
  (h as number) <= MAX_H;

/** Room types: floor colors live in tilemap.ts. A room's walls are glass when `glass` (default: meeting rooms). */
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
  w: 32,
  h: 19,
  door: { side: 'bottom', x: 3 },
  rooms: [
    {
      id: 'r1',
      type: 'meeting',
      name: '회의실',
      x: 1,
      y: 1,
      w: 6,
      h: 7,
      doors: [{ x: 4, y: 8 }],
    },
    {
      id: 'r2',
      type: 'office',
      name: '사무 공간',
      x: 8,
      y: 1,
      w: 16,
      h: 7,
      doors: [
        { x: 13, y: 8 },
        { x: 18, y: 8 },
      ],
    },
    {
      id: 'r3',
      type: 'library',
      name: '서재',
      x: 25,
      y: 1,
      w: 6,
      h: 7,
      doors: [{ x: 24, y: 3 }],
    }, // opens into the office
    {
      id: 'r4',
      type: 'lobby',
      name: '로비',
      x: 1,
      y: 11,
      w: 7,
      h: 7,
      doors: [{ x: 6, y: 10, open: true }],
    },
    {
      id: 'r5',
      type: 'lounge',
      name: '라운지',
      x: 9,
      y: 11,
      w: 7,
      h: 7,
      doors: [{ x: 12, y: 10 }],
    },
    {
      id: 'r6',
      type: 'plan',
      name: '기획실',
      x: 17,
      y: 11,
      w: 5,
      h: 7,
      doors: [{ x: 19, y: 10 }],
    },
    {
      id: 'r7',
      type: 'play',
      name: '놀이터',
      x: 23,
      y: 11,
      w: 8,
      h: 7,
      doors: [{ x: 26, y: 10 }],
    },
  ],
  items: [
    ...[
      [9, 2],
      [14, 2],
      [19, 2],
      [9, 5],
      [14, 5],
      [19, 5],
    ].map(([x, y], i) => ({ id: `d${i + 1}`, kind: 'deskPod', x, y })),
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
    ...[
      [1, 11],
      [7, 17],
      [9, 17],
      [17, 17],
      [21, 17],
      [30, 11],
      [8, 7],
      [23, 7],
      [30, 1],
      [1, 7],
    ].map(([x, y], i) => ({ id: `p${i + 1}`, kind: 'plant', x, y })),
    { id: 'w1', kind: 'window', x: 14, y: 0 },
    { id: 'w2', kind: 'sign', x: 21, y: 0 },
  ],
};

export const cloneOffice = <T>(o: T): T => JSON.parse(JSON.stringify(o));

/** The front door sits on one of the outer walls: `x` along the top/bottom wall, `y` along the left/right one. */
export const DOOR_SIDES: Record<string, string> = {
  bottom: '아래',
  top: '위',
  left: '왼쪽',
  right: '오른쪽',
};
/** A door on the top or bottom wall (placed by `x`); left / right ones are placed by `y`. */
export const isHorizontal = (side: string) =>
  side === 'top' || side === 'bottom';
/** The door's tile on the outer wall and the floor tile just inside it, where cats come in and leave. */
export function doorTiles(office: Layout) {
  const { w, h } = office,
    side =
      office.door?.side && office.door.side in DOOR_SIDES
        ? office.door.side
        : 'bottom';
  const at = (isHorizontal(side) ? office.door?.x : office.door?.y) as number;
  const door = {
    side,
    x: side === 'left' ? 0 : side === 'right' ? w - 1 : at,
    y: side === 'top' ? 0 : side === 'bottom' ? h - 1 : at,
  };
  const spawn = {
    x: door.x + (side === 'left' ? 1 : side === 'right' ? -1 : 0),
    y: door.y + (side === 'top' ? 1 : side === 'bottom' ? -1 : 0),
  };
  return { door, spawn };
}
/** Door data for a tile on (or near) the outer wall: the closest wall wins, corners excluded. */
export function doorFor(office: Layout, tx: number, ty: number): FrontDoor {
  const { w, h } = office;
  const x = Math.max(0, Math.min(w - 1, tx)),
    y = Math.max(0, Math.min(h - 1, ty));
  const side = Object.entries({
    left: x,
    right: w - 1 - x,
    top: y,
    bottom: h - 1 - y,
  }).sort((a, b) => a[1] - b[1])[0][0];
  return isHorizontal(side)
    ? { side, x: Math.max(1, Math.min(w - 2, x)) }
    : { side, y: Math.max(1, Math.min(h - 2, y)) };
}

/**
 * Only the fields a layout has (anything else from a client is dropped), upgraded to this version. The values are not
 * checked here: the result has a Layout's shape only, and validate() decides whether it is one.
 */
export function normalize(o: unknown): Layout | null {
  // o: untrusted JSON from a client
  if (!isRecord(o)) return null;
  const pick = (src: unknown, keys: string[]) =>
    Object.fromEntries(
      keys
        .filter((k) => field(src, k) !== undefined)
        .map((k) => [k, field(src, k)]),
    );
  const old = !(Number(o.v) >= 2);
  const doorSide = field(o.door, 'side');
  const side =
    typeof doorSide === 'string' && DOOR_SIDES[doorSide] ? doorSide : 'bottom';
  const door = isHorizontal(side)
    ? { side, x: field(o.door, 'x') }
    : { side, y: field(o.door, 'y') };
  const room = (r: unknown) => {
    const doors = field(r, 'doors');
    return {
      ...pick(r, ['id', 'type', 'name', 'x', 'y', 'w', 'h', 'glass', 'walls']),
      ...(old && field(r, 'type') === 'play' && field(r, 'walls') === undefined
        ? { walls: false }
        : {}), // v1 play rooms had no walls
      doors: Array.isArray(doors)
        ? doors.map((d: unknown) => ({
            x: field(d, 'x'),
            y: field(d, 'y'),
            ...(field(d, 'open') ? { open: true } : {}),
          }))
        : doors,
    };
  };
  const shaped = {
    v: LAYOUT_VERSION,
    w: o.w,
    h: o.h,
    door,
    rooms: Array.isArray(o.rooms) ? o.rooms.map(room) : o.rooms,
    items: Array.isArray(o.items)
      ? o.items.map((it: unknown) => pick(it, ['id', 'kind', 'x', 'y']))
      : o.items,
  };
  return shaped as Layout; // shape only, see above
}
export const inRect = (r: Rect, x: number, y: number) =>
  x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
export const hasWalls = (r: Room) =>
  (ROOM_TYPES[r.type]?.walls ?? true) && r.walls !== false;
export const isGlass = (r: Room) =>
  r.glass ?? ROOM_TYPES[r.type]?.glass ?? false;
const itemSize = (it: Item) => ITEM_KINDS[it.kind] || { w: 1, h: 1 };
export const itemRect = (it: Item): Rect => ({
  x: it.x,
  y: it.y,
  ...(({ w, h }) => ({ w, h }))(itemSize(it)),
});
/** The ring of tiles around a room, where its walls stand. */
export const ringRect = (r: Rect): Rect => ({
  x: r.x - 1,
  y: r.y - 1,
  w: r.w + 2,
  h: r.h + 2,
});

/** Number of desks an office has (the server assigns them). */
export const deskCount = (office: Layout) =>
  (office.items || []).filter((it) => it.kind === 'deskPod').length * 2;
