// compile(): a layout → the geometry the office runs on: walls, doors, walkability, desks, meeting rooms and every spot
// a cat can go.
import type {
  Desk,
  Door,
  Layout,
  Meeting,
  Placed,
  Pt,
  Reception,
  Spot,
  Wall,
} from './schema.ts';
import {
  doorTiles,
  hasWalls,
  ITEM_KINDS,
  inRect,
  isGlass,
  ringRect,
  TILE,
  WALL_RISE,
} from './schema.ts';

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
  const inMap = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
  const border = (x: number, y: number) =>
    x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1;

  // walls: every non-border ring tile of a walled room that isn't inside a room. 'v' tiles sit on a ring's side
  // columns (only their top shows), 'h' tiles on its top/bottom rows (they show a face); corners are both.
  const doors: Required<Door>[] = [];
  for (const r of rooms)
    for (const d of r.doors || [])
      doors.push({ x: d.x, y: d.y, open: !!d.open });
  const doorAt = (x: number, y: number) =>
    doors.find((d) => d.x === x && d.y === y);
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

  // walkability
  const blocked = new Uint8Array(MAP_W * MAP_H);
  const block = (x: number, y: number, w = 1, h = 1) => {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++)
        if (inMap(i, j)) blocked[j * MAP_W + i] = 1;
  };
  block(0, 0, MAP_W, 1);
  block(0, MAP_H - 1, MAP_W, 1);
  block(0, 0, 1, MAP_H);
  block(MAP_W - 1, 0, 1, MAP_H);
  for (const t of wallTiles) block(t.x, t.y);
  for (const d of doors) if (inMap(d.x, d.y)) blocked[d.y * MAP_W + d.x] = 0;

  // desks: each pod is [chair][desk][desk][chair], the two cats facing each other in profile; the aisle beside a chair
  // holds the assistants when every meeting room is taken.
  const desks: Desk[] = [];
  for (const p of byKind('deskPod')) {
    desks.push({
      item: p.id,
      y: p.y,
      desk: { x: p.x + 1, y: p.y, w: 1, h: 2 },
      chair: { x: p.x, y: p.y, face: 'right' },
      aisle: p.x - 1,
    });
    desks.push({
      item: p.id,
      y: p.y,
      desk: { x: p.x + 2, y: p.y, w: 1, h: 2 },
      chair: { x: p.x + 3, y: p.y, face: 'left' },
      aisle: p.x + 4,
      right: true,
    });
    block(p.x + 1, p.y, 2, 2);
  }

  // meeting tables: a 4×2 table inside a 6×4 footprint, four seats above, four below (backs to the viewer), two on
  // the right, head + one on the left. Named after the room they stand in.
  const meetings: Meeting[] = byKind('meetingTable').map((t) => {
    const tx = t.x + 1,
      ty = t.y + 1;
    const room = rooms.find((r) => inRect(r, tx, ty));
    const seats: Meeting['seats'] = [];
    for (let i = 0; i < 4; i++) seats.push({ x: tx + i, y: ty - 1 });
    for (let i = 0; i < 4; i++)
      seats.push({ x: tx + i, y: ty + 2, back: true });
    seats.push(
      { x: tx + 4, y: ty },
      { x: tx + 4, y: ty + 1 },
      { x: tx - 1, y: ty + 1 },
    );
    block(tx, ty, 4, 2);
    const area = room || { x: t.x, y: t.y, w: 6, h: 4 };
    return {
      item: t.id,
      name: room?.name || '회의 테이블',
      x: area.x,
      y: area.y,
      w: area.w,
      h: area.h,
      table: { x: tx, y: ty, w: 4, h: 2 },
      head: { x: tx - 1, y: ty },
      seats,
    };
  });

  const receptions: Reception[] = byKind('reception').map((r) => ({
    item: r.id,
    counter: { x: r.x, y: r.y + 1, w: 3 },
    cat: { x: r.x + 1, y: r.y },
  }));
  for (const r of receptions) {
    block(r.counter.x, r.counter.y, r.counter.w, 1);
    block(r.cat.x, r.cat.y);
  }
  const sofas: Placed[] = byKind('sofa').map((s) => ({
    item: s.id,
    x: s.x,
    y: s.y,
    w: 3,
  }));
  const coffees = byKind('coffee');
  const whiteboards: Placed[] = byKind('whiteboard').map((b) => ({
    item: b.id,
    x: b.x,
    y: b.y,
    w: 3,
  }));
  const bookshelves: Placed[] = byKind('bookshelf').map((b) => ({
    item: b.id,
    x: b.x,
    y: b.y,
    w: 6,
  }));
  for (const c of coffees) block(c.x, c.y);
  for (const b of [...whiteboards, ...bookshelves]) block(b.x, b.y, b.w, 1);
  for (const k of ['catTree', 'scratchPost', 'box', 'plant'])
    for (const it of byKind(k)) block(it.x, it.y);
  for (const it of byKind('wheel')) block(it.x, it.y, 2, 1);

  const isBlocked = (x: number, y: number) =>
    !inMap(x, y) || blocked[y * MAP_W + x] === 1;
  // spots on walkable floor only (`on`: the cat sits on the item itself, which blocks walking through)
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
    for (let i = 0; i < n; i++)
      play.push({
        x: row[n === 1 ? 0 : Math.round((i * (row.length - 1)) / (n - 1))],
        y: r.y,
        act: 'look',
      });
  }
  const lounge: Spot[] = [];
  for (const s of sofas)
    for (let i = 0; i < s.w; i++)
      lounge.push({ x: s.x + i, y: s.y, sofa: true });
  for (const c of coffees)
    lounge.push({ x: c.x - 1, y: c.y }, { x: c.x - 1, y: c.y + 1 });
  const plan: Spot[] = [];
  for (const b of whiteboards)
    for (let x = b.x - 1; x <= b.x + b.w; x++)
      plan.push({ x, y: b.y + 1, of: b.item }); // in front of the board
  const library: Spot[] = [];
  for (const b of bookshelves)
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
    sofas,
    coffees,
    whiteboards,
    bookshelves,
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
    lobby: lobbies[0] || null,
    playSpots: keep(play),
    loungeSpots: keep(lounge),
    planSpots: keep(plan),
    librarySpots: keep(library),
    bullpenSpots: bullpen,
    isBlocked,
    isDoor: (x: number, y: number) => !!doorAt(x, y),
    doorAt,
    /** Standing spots in the aisle beside a desk's chair. */
    nearDeskSpots(i: number): Pt[] {
      const d = desks[i];
      return [
        { x: d.aisle, y: d.y },
        { x: d.aisle, y: d.y - 1 },
        { x: d.aisle, y: d.y + 1 },
      ];
    },
    /** BFS shortest path on the tile grid. Returns tiles after `from` ending at `to`, [] if equal, null if unreachable. */
    findPath(from: Pt, to: Pt): Pt[] | null {
      if (from.x === to.x && from.y === to.y) return [];
      const key = (x: number, y: number) => y * MAP_W + x;
      const prev = new Int32Array(MAP_W * MAP_H).fill(-1);
      const q = [key(from.x, from.y)];
      prev[q[0]] = q[0];
      const target = key(to.x, to.y);
      let head = 0,
        found = false;
      while (head < q.length) {
        const k = q[head++];
        if (k === target) {
          found = true;
          break;
        }
        const x = k % MAP_W,
          y = (k / MAP_W) | 0;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + dx,
            ny = y + dy;
          if (
            !inMap(nx, ny) ||
            (isBlocked(nx, ny) && !(nx === to.x && ny === to.y))
          )
            continue;
          const nk = key(nx, ny);
          if (prev[nk] !== -1) continue;
          prev[nk] = k;
          q.push(nk);
        }
      }
      if (!found) return null;
      const path: Pt[] = [];
      for (let k = target; k !== key(from.x, from.y); k = prev[k])
        path.push({ x: k % MAP_W, y: (k / MAP_W) | 0 });
      return path.reverse();
    },
  };
  return geo;
}

/** The runtime geometry of an office (what compile() returns). */
export type Geo = ReturnType<typeof compile>;
