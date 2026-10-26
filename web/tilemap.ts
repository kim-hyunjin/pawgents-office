// Draws an office from its compiled layout (layout.ts): floors, walls, built-in furniture. Live props (monitors,
// the receptionist, yarn, wheel) are drawn every frame by render.ts; the drawing helpers it needs are exported.

import type { Door, Geo, Pt, Rect, Wall } from '../shared/layout.ts';
import { TILE, WALL_RISE } from '../shared/layout.ts';

/** A canvas context: the cached background is an OffscreenCanvas, props are drawn on the visible one. */
export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const C = {
  wallTop: '#2a2d45',
  wallEdge: '#4b5078',
  wallFace: '#4f5680',
  wallStripe: '#495079',
  wainscot: '#3b3f5c',
  trim: '#6b729c',
  floorShade: 'rgba(0,0,0,0.22)',
  wood: '#cdb089',
  wood2: '#c3a67f',
  woodLine: '#b4976f',
  meet: '#9fb3c8',
  meet2: '#97abc0',
  lobby: '#d6d9de',
  lobby2: '#ced1d6',
  plan: '#b9b0d6',
  plan2: '#b1a8ce',
  mat: '#a9c8a0',
  mat2: '#a1c098',
  lib: '#c9b8a3',
  lib2: '#c1b09b',
  lounge: '#d9a48d',
  lounge2: '#d19c85',
  rug: '#b5574e',
  rug2: '#a84e46',
  glass: 'rgba(190,230,255,0.75)',
  glassFrame: '#e8f4ff',
  glassDark: '#8fb6d4',
  desk: '#a0714f',
  deskLip: '#b88560',
  deskFace: '#7a5236',
  deskFaceDark: '#5e3d27',
  divider: '#8c6245',
  chair: '#4a4e69',
  chairLight: '#5c6088',
  table: '#8b5e3c',
  tableEdge: '#5e3d25',
  tableFace: '#6e4a2e',
  shadow: 'rgba(0,0,0,0.15)',
  board: '#f7f7f2',
  boardFrame: '#8a8a8a',
  tray: '#b0b0b0',
  sofa: '#c0392b',
  sofaDark: '#922b21',
  sofaLight: '#d35445',
  coffee: '#3d3d3d',
  coffee2: '#c0392b',
  shelf: '#7a4b2a',
  shelfDark: '#5a361d',
  book: ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22'],
  plant: '#2e8b57',
  plantDark: '#206b40',
  pot: '#b5651d',
  recept: '#6b7a99',
  receptTop: '#8ea0c4',
  receptDark: '#4f5b77',
  door: '#8b5a2b',
  doorDark: '#5c3a1a',
};
/** Floor of each room type (checkerboard pair); open office areas keep the wood planks. */
export const FLOOR: Record<string, [string, string]> = {
  meeting: [C.meet, C.meet2],
  lobby: [C.lobby, C.lobby2],
  plan: [C.plan, C.plan2],
  library: [C.lib, C.lib2],
  lounge: [C.lounge, C.lounge2],
  play: [C.mat, C.mat2],
};

export function buildBackground(geo: Geo) {
  const { W, H, MAP_W, MAP_H, door: DOOR } = geo;
  const c = new OffscreenCanvas(W, H + WALL_RISE);
  const g = c.getContext('2d')!;
  g.translate(0, WALL_RISE); // y < 0 is the raised part of the top wall
  const tile = (x: number, y: number, a: string, b: string) => {
    g.fillStyle = (x + y) % 2 ? a : b;
    g.fillRect(x * TILE, y * TILE, TILE, TILE);
  };
  // base: wood planks in the open area
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      g.fillStyle = y % 2 ? C.wood : C.wood2;
      g.fillRect(x * TILE, y * TILE, TILE, TILE);
      g.fillStyle = C.woodLine;
      g.fillRect(x * TILE, y * TILE + TILE - 1, TILE, 1);
      if ((x * 7 + y * 3) % 5 === 0)
        g.fillRect(x * TILE + 7, y * TILE, 1, TILE - 1);
    }
  // zones, then rugs on top
  const fill = (z: Rect, a: string, b: string) => {
    for (let y = z.y; y < z.y + z.h; y++)
      for (let x = z.x; x < z.x + z.w; x++) tile(x, y, a, b);
  };
  for (const r of geo.rooms) if (FLOOR[r.type]) fill(r, ...FLOOR[r.type]);
  for (const r of geo.rugs) fill({ x: r.x, y: r.y, w: 5, h: 5 }, C.rug, C.rug2);
  // walls, Stardew-style 3/4 view: the top wall shows its face (cap, wallpaper, wainscot, baseboard) and casts
  // a shadow onto the floor; side and bottom walls face away, so only their dark caps are visible.
  const top = -WALL_RISE;
  g.fillStyle = C.wallFace;
  g.fillRect(0, top, W, TILE + WALL_RISE);
  g.fillStyle = C.wallStripe;
  for (let x = 0; x < W; x += 4) g.fillRect(x, top + 3, 1, 6 - top - 3);
  g.fillStyle = C.wainscot;
  g.fillRect(0, 6, W, 8);
  g.fillStyle = C.trim;
  g.fillRect(0, 6, W, 1);
  g.fillStyle = C.wallTop;
  g.fillRect(0, top, W, 3);
  g.fillRect(0, 14, W, 2);
  g.fillStyle = C.floorShade;
  g.fillRect(0, TILE, W, 3);
  g.fillRect(0, TILE + 3, W, 2);
  g.fillStyle = C.wallTop;
  g.fillRect(0, top, TILE, H - top);
  g.fillRect(W - TILE, top, TILE, H - top);
  g.fillRect(0, H - TILE, W, TILE);
  g.fillStyle = C.wallEdge;
  g.fillRect(TILE - 1, TILE, 1, H - 2 * TILE);
  g.fillRect(W - TILE, TILE, 1, H - 2 * TILE);
  g.fillRect(TILE, H - TILE, W - 2 * TILE, 1);
  // windows (2-tile panes) and the sign board on the top wall
  for (const wn of geo.windows)
    for (let x = wn.x; x < wn.x + 6; x += 2) {
      g.fillStyle = C.glassFrame;
      g.fillRect(x * TILE + 1, -10, 30, 14);
      g.fillStyle = '#9ad1f5';
      g.fillRect(x * TILE + 2, -9, 28, 12);
      g.fillStyle = '#c4e6fb';
      g.fillRect(x * TILE + 3, -8, 4, 1);
      g.fillRect(x * TILE + 3, -7, 2, 1);
      g.fillRect(x * TILE + 19, -8, 4, 1);
      g.fillRect(x * TILE + 19, -7, 2, 1);
      g.fillStyle = C.glassFrame;
      g.fillRect(x * TILE + 16, -9, 1, 12);
      g.fillRect(x * TILE + 2, -3, 28, 1);
      g.fillStyle = C.trim;
      g.fillRect(x * TILE, 4, 32, 1);
    }
  for (const s of geo.signs) {
    g.fillStyle = C.boardFrame;
    g.fillRect(s.x * TILE, -9, 5 * TILE, 12);
    g.fillStyle = C.board;
    g.fillRect(s.x * TILE + 1, -8, 5 * TILE - 2, 10);
  }
  // partitions: north–south tiles first, so east–west faces cover the junctions
  for (const t of geo.wallTiles) if (t.v) drawWallV(g, t, geo.doorAt(t.x, t.y));
  for (const t of geo.wallTiles) if (t.h) drawWallH(g, t, geo.doorAt(t.x, t.y));
  // meeting tables + chairs
  for (const r of geo.meetings) {
    drawMeetingTable(
      g,
      r.table.x * TILE,
      r.table.y * TILE,
      r.table.w * TILE,
      r.table.h * TILE,
    );
    for (const s of r.seats)
      drawChair(
        g,
        s.x * TILE,
        s.y * TILE,
        s.y < r.table.y ? 'down' : s.y >= r.table.y + r.table.h ? 'up' : 'side',
      );
    drawChair(g, r.head.x * TILE, r.head.y * TILE, 'side', true);
  }
  for (const r of geo.receptions)
    drawReception(
      g,
      r.counter.x * TILE,
      r.counter.y * TILE,
      r.counter.w * TILE,
    );
  drawEntrance(g, DOOR);
  for (const d of geo.desks) {
    drawDeskChair(
      g,
      d.chair.x * TILE,
      d.chair.y * TILE,
      d.chair.face === 'right',
    );
    drawDesk(
      g,
      d.desk.x * TILE,
      d.desk.y * TILE,
      d.desk.w * TILE,
      d.desk.h * TILE,
      !!d.right,
    );
  }
  // play area
  for (const p of geo.catTrees) drawCatTree(g, p.x * TILE, p.y * TILE);
  for (const p of geo.scratchPosts) drawScratchPost(g, p.x * TILE, p.y * TILE);
  for (const p of geo.boxes) drawBox(g, p.x * TILE, p.y * TILE);
  for (const p of geo.cushions) drawCushion(g, p.x * TILE, p.y * TILE);
  for (const b of geo.whiteboards)
    drawStandingBoard(g, b.x * TILE, b.y * TILE, b.w * TILE);
  for (const b of geo.bookshelves)
    drawBookshelf(g, b.x * TILE, b.y * TILE, b.w * TILE);
  // lounge: sofa with a coffee table in front, coffee machine
  for (const s of geo.sofas) {
    drawSofa(g, s.x * TILE, s.y * TILE, s.w * TILE);
    g.fillStyle = C.table;
    g.fillRect((s.x + 1) * TILE - 12, (s.y + 2) * TILE + 2, 24, 10);
    g.fillStyle = C.tableEdge;
    g.fillRect((s.x + 1) * TILE - 12, (s.y + 2) * TILE + 11, 24, 2);
  }
  for (const k of geo.coffees) {
    g.fillStyle = C.coffee;
    g.fillRect(k.x * TILE + 2, k.y * TILE + 1, 12, 14);
    g.fillStyle = C.coffee2;
    g.fillRect(k.x * TILE + 4, k.y * TILE + 3, 8, 4);
    g.fillStyle = '#fff';
    g.fillRect(k.x * TILE + 6, k.y * TILE + 10, 4, 3);
  }
  for (const p of geo.plants) drawPlant(g, p.x * TILE, p.y * TILE);
  return c;
}

/**
 * Front entrance on an outer wall. Bottom / left / right walls face away, so it's an opening in the cap with frame
 * posts on either side and a doormat on the sill; on the top wall, whose face shows, it's a wooden door in the face.
 */
function drawEntrance(g: Ctx, d: Pt & { side: string }) {
  const x = d.x * TILE,
    y = d.y * TILE;
  if (d.side === 'top') {
    g.fillStyle = C.doorDark;
    g.fillRect(x - 1, -11, TILE + 2, TILE + 11);
    g.fillStyle = C.door;
    g.fillRect(x + 1, -9, TILE - 2, TILE + 9);
    g.fillStyle = C.doorDark;
    g.fillRect(x + 3, -7, TILE - 6, 7);
    g.fillRect(x + 3, 3, TILE - 6, 9); // panels
    g.fillStyle = C.door;
    g.fillRect(x + 4, -6, TILE - 8, 5);
    g.fillRect(x + 4, 4, TILE - 8, 7);
    g.fillStyle = '#e8c35a';
    g.fillRect(x + TILE - 4, 1, 2, 2); // knob
    return;
  }
  g.fillStyle = C.lobby;
  g.fillRect(x, y, TILE, TILE);
  g.fillStyle = C.doorDark;
  if (d.side === 'bottom') {
    g.fillRect(x - 2, y, 2, TILE);
    g.fillRect(x + TILE, y, 2, TILE);
    g.fillStyle = C.door;
    g.fillRect(x + 1, y + 3, TILE - 2, 10);
    g.fillStyle = C.doorDark;
    for (let i = 0; i < 4; i++) g.fillRect(x + 3, y + 5 + i * 2, TILE - 6, 1);
  } else {
    g.fillRect(x, y - 2, TILE, 2);
    g.fillRect(x, y + TILE, TILE, 2);
    g.fillStyle = C.door;
    g.fillRect(x + 3, y + 1, 10, TILE - 2);
    g.fillStyle = C.doorDark;
    for (let i = 0; i < 4; i++) g.fillRect(x + 5 + i * 2, y + 3, 1, TILE - 6);
  }
}

/** North–south partition tile: only its top shows. Glass is a rail with panes; plaster is a dark cap like the outer walls. */
function drawWallV(g: Ctx, t: Wall, door: Door | undefined) {
  const x = t.x * TILE,
    py = t.y * TILE;
  if (door) {
    // doorway: just the jambs (an open one has none)
    if (!door.open) {
      g.fillStyle = C.doorDark;
      g.fillRect(x + 4, py, 8, 2);
      g.fillRect(x + 4, py + TILE - 2, 8, 2);
    }
    return;
  }
  if (t.glass) {
    g.fillStyle = C.glass;
    g.fillRect(x + 5, py, 6, TILE);
    g.fillStyle = C.glassFrame;
    g.fillRect(x + 5, py, 1, TILE);
    g.fillRect(x + 10, py, 1, TILE);
    g.fillStyle = C.glassDark;
    g.fillRect(x + 5, py, 6, 1);
  } else {
    g.fillStyle = C.wallTop;
    g.fillRect(x + 4, py, 8, TILE);
    g.fillStyle = C.wallEdge;
    g.fillRect(x + 4, py, 1, TILE);
    g.fillRect(x + 11, py, 1, TILE);
  }
}
/** East–west partition tile, facing the viewer: rail or cap on top, glass pane or wallpaper face, base, shadow on the floor. */
function drawWallH(g: Ctx, t: Wall, door: Door | undefined) {
  const tx = t.x,
    x = tx * TILE,
    y = t.y * TILE;
  if (door) {
    // doorway: jambs + threshold (an open one has none)
    if (!door.open) {
      g.fillStyle = C.doorDark;
      g.fillRect(x, y, 2, 14);
      g.fillRect(x + TILE - 2, y, 2, 14);
      g.fillStyle = C.door;
      g.fillRect(x + 2, y + 13, TILE - 4, 2);
    }
    return;
  }
  if (t.glass) {
    g.fillStyle = C.glass;
    g.fillRect(x, y + 2, TILE, 11);
    if (tx % 3 === 0) {
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fillRect(x + 8, y + 4, 2, 1);
      g.fillRect(x + 7, y + 5, 2, 1);
      g.fillRect(x + 6, y + 6, 2, 1);
    }
    g.fillStyle = C.glassDark;
    g.fillRect(x, y + 2, 1, 11);
    g.fillStyle = C.glassFrame;
    g.fillRect(x, y, TILE, 2);
    g.fillStyle = C.glassDark;
    g.fillRect(x, y + 13, TILE, 2);
  } else {
    g.fillStyle = C.wallFace;
    g.fillRect(x, y, TILE, 14);
    g.fillStyle = C.wallStripe;
    for (let k = 0; k < TILE; k += 4) g.fillRect(x + k, y + 3, 1, 5);
    g.fillStyle = C.wainscot;
    g.fillRect(x, y + 8, TILE, 6);
    g.fillStyle = C.trim;
    g.fillRect(x, y + 8, TILE, 1);
    g.fillStyle = C.wallTop;
    g.fillRect(x, y, TILE, 3);
    g.fillRect(x, y + 14, TILE, 2);
  }
  g.fillStyle = C.floorShade;
  g.fillRect(x, y + TILE, TILE, 2);
}
function drawPlant(g: Ctx, x: number, y: number) {
  g.fillStyle = C.pot;
  g.fillRect(x + 5, y + 10, 6, 5);
  g.fillStyle = C.plantDark;
  g.fillRect(x + 3, y + 4, 10, 7);
  g.fillStyle = C.plant;
  g.fillRect(x + 4, y + 2, 8, 7);
  g.fillRect(x + 2, y + 6, 3, 3);
  g.fillRect(x + 11, y + 5, 3, 3);
}
/** Cat tree: carpeted base, sisal post, a low side shelf and a top perch rising above its tile (a perched cat sits at y - 11). */
function drawCatTree(g: Ctx, x: number, y: number) {
  g.fillStyle = C.shadow;
  g.fillRect(x + 1, y + 14, 14, 2);
  g.fillStyle = '#d9c7a3';
  g.fillRect(x + 6, y - 9, 4, 22);
  g.fillStyle = '#b8a47e';
  for (let k = -8; k < 13; k += 3) g.fillRect(x + 6, y + k, 4, 1);
  g.fillStyle = '#8f74b8';
  g.fillRect(x + 1, y + 12, 14, 3);
  g.fillRect(x, y - 12, 16, 3);
  g.fillRect(x + 9, y + 2, 6, 2);
  g.fillStyle = '#a58bc8';
  g.fillRect(x + 1, y + 12, 14, 1);
  g.fillRect(x, y - 12, 16, 1);
  g.fillRect(x + 9, y + 2, 6, 1);
  g.fillStyle = '#e05a7a';
  g.fillRect(x + 3, y - 9, 1, 4);
  g.fillRect(x + 2, y - 5, 3, 2); // dangling toy
}
/** Scratching post on a square base. */
function drawScratchPost(g: Ctx, x: number, y: number) {
  g.fillStyle = C.shadow;
  g.fillRect(x + 2, y + 14, 12, 2);
  g.fillStyle = '#7a5236';
  g.fillRect(x + 2, y + 11, 12, 4);
  g.fillStyle = '#d9c7a3';
  g.fillRect(x + 5, y - 4, 6, 15);
  g.fillStyle = '#b8a47e';
  for (let k = -3; k < 11; k += 2) g.fillRect(x + 5, y + k, 6, 1);
  g.fillStyle = '#7a5236';
  g.fillRect(x + 4, y - 6, 8, 2);
}
/** Cardboard box with open flaps. frontOnly redraws just the front panel, over a cat sitting inside. */
export function drawBox(g: Ctx, x: number, y: number, frontOnly = false) {
  if (!frontOnly) {
    g.fillStyle = C.shadow;
    g.fillRect(x + 1, y + 14, 14, 2);
    g.fillStyle = '#d9a86c';
    g.fillRect(x - 1, y + 3, 3, 4);
    g.fillRect(x + 14, y + 3, 3, 4); // flaps
    g.fillStyle = '#6e4a2e';
    g.fillRect(x + 2, y + 4, 12, 4); // inside
  }
  g.fillStyle = '#c08a55';
  g.fillRect(x + 1, y + 7, 14, 8);
  g.fillStyle = '#d9a86c';
  g.fillRect(x + 1, y + 7, 14, 1);
  g.fillStyle = '#e8d3a8';
  g.fillRect(x + 7, y + 8, 2, 6); // tape
}
/** Round floor cushion. */
function drawCushion(g: Ctx, x: number, y: number) {
  g.fillStyle = C.shadow;
  g.fillRect(x + 2, y + 14, 12, 2);
  g.fillStyle = '#a8435a';
  g.fillRect(x + 2, y + 7, 12, 7);
  g.fillRect(x + 1, y + 9, 14, 3);
  g.fillStyle = '#c7546b';
  g.fillRect(x + 3, y + 8, 10, 4);
  g.fillStyle = '#d97a8e';
  g.fillRect(x + 5, y + 9, 6, 2);
}
/** Office chair in profile: backrest behind the cat, seat cushion at y + 10 (the seated cat rests on it), post + base below. */
function drawDeskChair(g: Ctx, x: number, y: number, backLeft: boolean) {
  g.fillStyle = C.shadow;
  g.fillRect(x + 2, y + 14, 12, 2);
  g.fillStyle = C.chair;
  g.fillRect(backLeft ? x + 2 : x + 11, y + 4, 3, 9);
  g.fillRect(x + 3, y + 10, 10, 3);
  g.fillStyle = C.chairLight;
  g.fillRect(x + 4, y + 10, 8, 1);
  g.fillStyle = '#3a3d55';
  g.fillRect(x + 7, y + 13, 2, 2);
  g.fillRect(x + 4, y + 15, 8, 1);
}
function drawChair(
  g: Ctx,
  x: number,
  y: number,
  facing = 'down',
  head = false,
) {
  g.fillStyle = C.shadow;
  g.fillRect(x + 2, y + 13, 12, 3);
  g.fillStyle = head ? '#6b4c9a' : C.chair;
  if (facing === 'down') {
    g.fillRect(x + 3, y + 1, 10, 3);
    g.fillRect(x + 3, y + 4, 10, 9);
  } else if (facing === 'up') {
    g.fillRect(x + 3, y + 2, 10, 9);
    g.fillRect(x + 3, y + 11, 10, 3);
  } else {
    g.fillRect(x + 2, y + 3, 3, 10);
    g.fillRect(x + 5, y + 3, 9, 10);
  }
  g.fillStyle = head ? '#8e6cc4' : C.chairLight;
  g.fillRect(x + 5, y + 5, 7, 6);
}
/** Desk in 3/4 view: top surface, a lit lip, then a 5px front face with a drawer. w × h is its footprint in px. */
function drawDesk(
  g: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  rightHalf: boolean,
) {
  const top = h - 6;
  g.fillStyle = C.shadow;
  g.fillRect(x + 1, y + h, w, 3);
  g.fillStyle = C.desk;
  g.fillRect(x, y, w, top);
  g.fillStyle = C.deskFaceDark;
  g.fillRect(x, y, w, 1);
  g.fillStyle = C.deskLip;
  g.fillRect(x, y + top, w, 1);
  g.fillStyle = C.deskFace;
  g.fillRect(x, y + top + 1, w, 5);
  g.fillStyle = C.deskFaceDark;
  g.fillRect(x, y + h - 1, w, 1);
  // drawer, legs at both ends
  const dxr = x + Math.floor((w - 12) / 2),
    fy = y + top + 2;
  g.fillRect(dxr, fy, 12, 1);
  g.fillRect(dxr, fy, 1, 3);
  g.fillRect(dxr + 11, fy, 1, 3);
  g.fillStyle = C.deskLip;
  g.fillRect(dxr + 5, fy + 1, 2, 1);
  g.fillStyle = C.deskFaceDark;
  g.fillRect(x, y + top + 1, 1, 5);
  g.fillRect(x + w - 1, y + top + 1, 1, 5);
  if (!rightHalf) {
    g.fillStyle = C.divider;
    g.fillRect(x + w - 1, y, 1, top);
  }
}
/** Meeting table in 3/4 view: top surface with an inset, a lit lip, then a 5px front face. */
function drawMeetingTable(g: Ctx, x: number, y: number, w: number, h: number) {
  g.fillStyle = C.shadow;
  g.fillRect(x + 2, y + h, w - 2, 3);
  g.fillStyle = C.table;
  g.fillRect(x + 1, y, w - 2, h - 6);
  g.fillStyle = C.tableEdge;
  g.fillRect(x + 1, y, w - 2, 1);
  g.fillStyle = '#a6744c';
  g.fillRect(x + 4, y + 3, w - 8, h - 12);
  g.fillStyle = '#b8845a';
  g.fillRect(x + 1, y + h - 6, w - 2, 1);
  g.fillStyle = C.tableFace;
  g.fillRect(x + 1, y + h - 5, w - 2, 5);
  g.fillStyle = C.tableEdge;
  g.fillRect(x + 1, y + h - 1, w - 2, 1);
  g.fillRect(x + 1, y + h - 5, 1, 5);
  g.fillRect(x + w - 2, y + h - 5, 1, 5);
}
/** Reception counter: tiled top with a monitor and a lamp, then a paneled front face. */
export function drawReception(
  g: Ctx,
  x: number,
  y: number,
  w: number,
  shadow = true,
) {
  if (shadow) {
    g.fillStyle = C.shadow;
    g.fillRect(x + 1, y + TILE, w, 3);
  }
  g.fillStyle = C.receptTop;
  g.fillRect(x, y + 1, w, 7);
  g.fillStyle = C.recept;
  g.fillRect(x, y + 1, w, 1);
  g.fillStyle = '#b3c2df';
  g.fillRect(x, y + 8, w, 1);
  g.fillStyle = C.recept;
  g.fillRect(x, y + 9, w, 7);
  g.fillStyle = C.receptDark;
  g.fillRect(x, y + 15, w, 1);
  for (let i = 0; i < w; i += 12) {
    g.fillRect(x + i + 2, y + 10, 8, 1);
    g.fillRect(x + i + 2, y + 10, 1, 4);
  }
  g.fillStyle = '#fff';
  g.fillRect(x + w - 9, y + 2, 6, 4);
  g.fillStyle = '#2ecc71';
  g.fillRect(x + 4, y + 3, 3, 2);
}
/** Low bookshelf seen from the front: top board, two rows of spines, plinth. Fits its tile row so readers above it stay clear. */
function drawBookshelf(g: Ctx, x: number, y: number, w: number) {
  g.fillStyle = '#9a6538';
  g.fillRect(x, y, w, 2);
  g.fillStyle = C.shelfDark;
  g.fillRect(x, y + 2, w, 14);
  g.fillStyle = C.shelf;
  g.fillRect(x + 1, y + 3, w - 2, 5);
  g.fillRect(x + 1, y + 9, w - 2, 5);
  for (const [ry, rh] of [
    [3, 5],
    [9, 5],
  ]) {
    for (let bx = x + 2, i = (ry * 7) % C.book.length; bx < x + w - 3; i++) {
      const bw = 2 + (i % 3 === 0 ? 1 : 0),
        bh = rh - (i % 4 === 1 ? 1 : 0);
      g.fillStyle = C.book[i % C.book.length];
      g.fillRect(bx, y + ry + rh - bh, bw, bh);
      bx += bw + (i % 5 === 4 ? 2 : 0);
    }
  }
  for (let k = TILE; k < w; k += TILE * 2) {
    g.fillStyle = C.shelfDark;
    g.fillRect(x + k, y + 2, 1, 12);
  } // uprights
  g.fillStyle = C.shelfDark;
  g.fillRect(x, y + 14, w, 2);
}
/** Free-standing whiteboard on two legs, rising above its tile (planners stand on the row below). */
function drawStandingBoard(g: Ctx, x: number, y: number, w: number) {
  g.fillStyle = C.shadow;
  g.fillRect(x + 1, y + 14, w - 2, 2);
  g.fillStyle = '#6f6f6f';
  g.fillRect(x + 4, y + 7, 2, 8);
  g.fillRect(x + w - 6, y + 7, 2, 8);
  g.fillRect(x + 2, y + 14, 6, 1);
  g.fillRect(x + w - 8, y + 14, 6, 1);
  g.fillStyle = C.boardFrame;
  g.fillRect(x, y - 9, w, 16);
  g.fillStyle = C.board;
  g.fillRect(x + 1, y - 8, w - 2, 13);
  g.fillStyle = C.tray;
  g.fillRect(x + 1, y + 6, w - 2, 2);
  g.fillStyle = '#e74c3c';
  g.fillRect(x + 4, y + 6, 3, 1);
  g.fillStyle = '#2563eb';
  g.fillRect(x + 9, y + 6, 3, 1);
}
/** Sofa from the front: backrest on top, seat cushions, then the seat's front face, with armrests at both ends. */
function drawSofa(g: Ctx, x: number, y: number, w: number) {
  g.fillStyle = C.shadow;
  g.fillRect(x + 1, y + TILE, w, 3);
  g.fillStyle = C.sofaDark;
  g.fillRect(x, y, w, 2);
  g.fillStyle = C.sofa;
  g.fillRect(x + 1, y + 1, w - 2, 6);
  g.fillStyle = C.sofaLight;
  g.fillRect(x + 4, y + 7, w - 8, 4);
  g.fillStyle = C.sofaDark;
  g.fillRect(x + 4, y + 11, w - 8, 1);
  for (let i = 1; i < w / 16; i++) g.fillRect(x + i * 16, y + 7, 1, 4);
  g.fillStyle = C.sofa;
  g.fillRect(x + 4, y + 12, w - 8, 4);
  g.fillStyle = C.sofaDark;
  g.fillRect(x + 4, y + 15, w - 8, 1);
  for (const ax of [x, x + w - 4]) {
    g.fillStyle = C.sofaLight;
    g.fillRect(ax, y + 4, 4, 2);
    g.fillStyle = C.sofa;
    g.fillRect(ax, y + 6, 4, 10);
    g.fillStyle = C.sofaDark;
    g.fillRect(ax, y + 15, 4, 1);
  }
}
