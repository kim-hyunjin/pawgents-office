import { TILE, WALL_RISE } from './layout.ts';
import type { Geo, Desk, Placed, Reception, Rect, Item } from './layout.ts';
import { drawReception, drawBox } from './tilemap.ts';
import type { Ctx } from './tilemap.ts';
import { sprite, spriteSize, outline, animFor, backAnim, sideAnim, RECEPTIONIST_PAL, drawGlyph, FAMILIES, familyOf } from './sprites.ts';
import { fmtTime } from './ui.ts';
import type { World, Ent } from './world.ts';

const FONT = '"Galmuri11", "DotumChe", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';
const SCREEN: Record<string, string> = {
  idle: '#1b1b24', offduty: '#1b1b24', thinking: '#263047', reading: '#2a2f3f', coding: '#2b6cff',
  terminal: '#0a120a', working: '#dfe6ee', searching: '#1e3a5f', delegating: '#3b4a7a', waiting: '#5a4a12',
};
const AUTO_MODES = new Set(['auto', 'bypassPermissions', 'dontAsk']);
const BUBBLE_MS = 15000;
/** Screen-space font size: scales with the canvas but never below a readable floor. */
const fpx = (k: number, S: number) => Math.max(13, k * S);

const NO_ENTS = new Map<string, Ent>();

/** Draws world.view (the live office, or the editor's draft); cats are hidden while editing. */
export function render(ctx: CanvasRenderingContext2D, S: number, world: World, now: number) {
  const { hoverKey, selectedKey } = world;
  const { bg, geo } = world.view;
  const ents = world.editing ? NO_ENTS : world.ents;
  // office space starts WALL_RISE below the canvas top; the band above is the raised top wall
  ctx.setTransform(S, 0, 0, S, 0, WALL_RISE * S);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bg, 0, -WALL_RISE);

  // who is at which desk right now
  const atDesk = new Map<number, Ent['data']>();
  for (const e of ents.values()) if (e.kind === 'employee' && e.station?.kind === 'desk' && e.phase !== 'leave') atDesk.set(e.station.desk!, e.data);
  geo.desks.forEach((d, i) => {
    const s = atDesk.get(i);
    drawDeskProps(ctx, d, s ? s.state : 'offduty', now, s && 'model' in s ? familyOf(s.model) : 'other', s && 'permissionMode' in s ? s.permissionMode : null);
  });
  // meeting rooms: laptops in front of seated people
  for (const e of ents.values()) {
    if (e.station?.kind !== 'meeting' || e.phase !== 'seated') continue;
    const r = geo.meetings[e.station.room!];
    if (!r) continue;
    const st = e.station;
    const state = e.data?.state || 'idle';
    if (st.y < r.table.y) drawMiniLaptop(ctx, st.x * TILE + 4, r.table.y * TILE + 1, state, now);
    else if (st.y >= r.table.y + r.table.h) drawMiniLaptop(ctx, st.x * TILE + 4, (r.table.y + r.table.h) * TILE - 13, state, now); // on the top surface, above the front face
    else if (st.x < r.table.x) drawMiniLaptop(ctx, r.table.x * TILE + 1, st.y * TILE + 2, state, now);
    else if (st.x >= r.table.x + r.table.w) drawMiniLaptop(ctx, (r.table.x + r.table.w) * TILE - 10, st.y * TILE + 2, state, now);
  }
  // whiteboard scribbles while someone is planning in front of it
  const seatedAt = (act: string | null, id: string) => [...ents.values()].some((e) => e.phase === 'seated' && e.station?.of === id && (!act || e.station.act === act));
  for (const b of geo.whiteboards) if (seatedAt(null, b.item)) drawWhiteboard(ctx, b, now);
  for (const r of geo.receptions) drawReceptionist(ctx, geo, r, ents, now);
  for (const y of geo.yarns) drawYarn(ctx, y, seatedAt('bat', y.id), now);
  for (const w of geo.wheels) drawWheel(ctx, w, seatedAt('wheel', w.id), now);

  const list = [...ents.values()].sort((a, b) => a.y - b.y);
  for (const e of list) drawEntity(ctx, geo, e, now, e.key === selectedKey, e.key === hoverKey);

  // screen-space text
  ctx.setTransform(1, 0, 0, 1, 0, WALL_RISE * S);
  drawSign(ctx, S, geo);
  const placed: Rect[] = [];
  for (const e of list) drawBubble(ctx, S, e, now, placed, geo.W);
  ctx.setTransform(1, 0, 0, 1, 0, 0); // HUD hangs on the raised wall
  drawHUD(ctx, S, world, now);
}

// ---- furniture state ------------------------------------------------------------
/**
 * Props on a lengthwise desk (1 tile wide, 2 deep). Top tile: keyboard upright along the chair's edge, monitor beside
 * it (screen toward the viewer). Bottom tile: mouse under the keyboard, mug / papers / phone by state.
 */
function drawDeskProps(g: Ctx, d: Desk, state: string, t: number, fam = 'other', mode: string | null = null) {
  const x = d.desk.x * TILE, dy = d.desk.y * TILE;
  const kind = (FAMILIES[fam] || FAMILIES.other).monitor;
  const chairLeft = d.chair.face === 'right';
  const kx = chairLeft ? x + 1 : x + 12; // keyboard column (3 px)
  const mx = chairLeft ? x + 4 : x; // monitor box (12 px)
  // keyboard + mouse, upright
  g.fillStyle = '#50545e'; g.fillRect(kx, dy + 2, 3, 11);
  g.fillStyle = '#6b6f7a'; for (let i = 0; i < 5; i++) g.fillRect(kx + 1, dy + 3 + i * 2, 1, 1);
  g.fillStyle = '#50545e'; g.fillRect(kx, dy + 15, 3, 2);
  // monitor
  if (kind === 'wide-gold') {
    g.fillStyle = '#d4a017'; g.fillRect(mx, dy + 1, 12, 10);
    g.fillStyle = SCREEN[state] || SCREEN.idle; g.fillRect(mx + 1, dy + 2, 10, 8);
    g.fillStyle = '#d4a017'; g.fillRect(mx + 5, dy + 11, 2, 2);
  } else if (kind === 'silver') {
    g.fillStyle = '#c8d0d8'; g.fillRect(mx + 1, dy + 2, 11, 9);
    g.fillStyle = SCREEN[state] || SCREEN.idle; g.fillRect(mx + 2, dy + 3, 9, 7);
    g.fillStyle = '#9aa3b2'; g.fillRect(mx + 6, dy + 11, 2, 2);
  } else if (kind === 'laptop') {
    g.fillStyle = '#2c2c36'; g.fillRect(mx + 2, dy + 4, 9, 6);
    g.fillStyle = SCREEN[state] || SCREEN.idle; g.fillRect(mx + 3, dy + 5, 7, 4);
    g.fillStyle = '#44454f'; g.fillRect(mx + 1, dy + 10, 11, 2);
  } else {
    g.fillStyle = '#23242e'; g.fillRect(mx + 1, dy + 2, 11, 9);
    g.fillStyle = SCREEN[state] || SCREEN.idle; g.fillRect(mx + 2, dy + 3, 9, 7);
    g.fillStyle = '#3a3b47'; g.fillRect(mx + 6, dy + 11, 2, 2);
  }
  const sx = kind === 'wide-gold' ? mx + 2 : kind === 'laptop' ? mx + 4 : mx + 3;
  const sy = kind === 'wide-gold' ? dy + 3 : kind === 'laptop' ? dy + 6 : dy + 4;
  const rowsN = kind === 'laptop' ? 2 : 3;
  const maxW = kind === 'laptop' ? 4 : kind === 'wide-gold' ? 7 : 6;
  if (state === 'coding' || state === 'terminal' || state === 'working') {
    g.fillStyle = state === 'coding' ? '#bcd4ff' : state === 'terminal' ? '#5dff7a' : '#8a94a6';
    const sc = Math.floor(t / (AUTO_MODES.has(mode!) ? 200 : 350)) % 3;
    const widths = [6, 4, 7, 3, 5];
    for (let i = 0; i < rowsN; i++) g.fillRect(sx, sy + i * 2, Math.min(maxW, widths[(i + sc) % widths.length]), 1);
  } else if (state === 'searching') {
    g.fillStyle = '#9bd3ff'; g.fillRect(sx, sy + 1, Math.min(maxW, 5), 1); g.fillRect(sx, sy + 3, maxW, 1);
  } else if (state === 'reading') {
    g.fillStyle = '#4a5068'; g.fillRect(sx, sy + 1, maxW, 1); g.fillRect(sx, sy + 3, Math.min(maxW, 5), 1);
  } else if (state === 'waiting' && Math.floor(t / 400) % 2) {
    g.fillStyle = '#ffd166'; g.fillRect(sx + 3, sy, 1, 3); g.fillRect(sx + 3, sy + 4, 1, 1);
  }
  // bottom tile: mode / state props
  const px = mx + 2, py = dy + 15;
  if (mode === 'acceptEdits' && state !== 'offduty') drawGlyph(g, 'check', px + 4, py, t);
  if (state === 'idle' || state === 'offduty') {
    g.fillStyle = '#fafafa'; g.fillRect(px + 3, py + 2, 3, 3); g.fillStyle = '#6f4e37'; g.fillRect(px + 3, py + 2, 3, 1);
  } else if (state === 'reading' || state === 'searching') {
    g.fillStyle = '#fdfdfd'; g.fillRect(px, py + 1, 6, 5); g.fillStyle = '#9aa3b2'; g.fillRect(px + 1, py + 2, 3, 1); g.fillRect(px + 1, py + 4, 3, 1);
    if (state === 'searching') { const bob = Math.floor(t / 300) % 2; g.fillStyle = '#e8eef5'; g.fillRect(px + 6, py - bob, 3, 3); g.fillStyle = '#5a3825'; g.fillRect(px + 5, py + 3 - bob, 1, 2); }
  } else if (state === 'delegating') {
    g.fillStyle = '#2d2d2d'; g.fillRect(px, py + 2, 6, 3); g.fillStyle = '#ffd166'; g.fillRect(px + 1 + (Math.floor(t / 250) % 3) * 2, py + 3, 1, 1);
  } else if (state === 'waiting') {
    g.fillStyle = '#fdfdfd'; g.fillRect(px, py + 1, 6, 5); g.fillStyle = '#e74c3c'; g.fillRect(px + 1, py + 2, 4, 1);
  }
}

function drawMiniLaptop(g: Ctx, x: number, y: number, state: string, t: number) {
  g.fillStyle = '#2c2c36'; g.fillRect(x, y, 8, 5);
  g.fillStyle = SCREEN[state] || SCREEN.idle; g.fillRect(x + 1, y + 1, 6, 3);
  g.fillStyle = '#44454f'; g.fillRect(x - 1, y + 5, 10, 1);
  if ((state === 'coding' || state === 'terminal' || state === 'working') && Math.floor(t / 350) % 2) { g.fillStyle = state === 'terminal' ? '#5dff7a' : '#bcd4ff'; g.fillRect(x + 2, y + 2, 3, 1); }
}

function drawWhiteboard(g: Ctx, board: Placed, t: number) {
  const bx = board.x * TILE + 2, by = board.y * TILE - 6;
  const k = (board.w * TILE - 4) / 76; // strokes are laid out for a 76px-wide board
  const phase = (t % 9000) / 9000;
  const strokes: [string, number, number, number, number][] = [
    ['#2563eb', 0, 1, 18, 1], ['#2563eb', 0, 3, 12, 1], ['#dc2626', 22, 1, 10, 1], ['#dc2626', 22, 3, 14, 1],
    ['#16a34a', 40, 1, 8, 1], ['#16a34a', 40, 3, 16, 1], ['#2563eb', 0, 6, 26, 1], ['#dc2626', 30, 6, 20, 1], ['#16a34a', 54, 6, 20, 1],
    ['#111827', 58, 1, 1, 4], ['#111827', 70, 1, 1, 4], ['#111827', 58, 1, 13, 1], ['#111827', 58, 4, 13, 1],
  ];
  const n = Math.floor(phase * (strokes.length + 2));
  strokes.slice(0, n).forEach(([c, x, y, w, h]) => { g.fillStyle = c; g.fillRect(bx + Math.round(x * k), by + y, Math.max(1, Math.round(w * k)), h); });
}

/** Resident cat behind the lobby counter; waves while someone is walking in. The counter is redrawn over its lower body. */
function drawReceptionist(g: Ctx, geo: Geo, rc: Reception, ents: Map<string, Ent>, t: number) {
  const lobbyY = (geo.lobby ? geo.lobby.y : rc.cat.y) * TILE;
  const greeting = [...ents.values()].some((e) => e.phase === 'enter' && e.y >= lobbyY);
  const RECEPTIONIST = rc.cat, RECEPTION = rc.counter;
  const img = sprite(RECEPTIONIST_PAL, greeting ? 'wait' : 'idle', Math.floor(t / (greeting ? 400 : 450)));
  const x = RECEPTIONIST.x * TILE + Math.round((TILE - img.width) / 2);
  const y = (RECEPTIONIST.y + 1) * TILE + 5 - img.height; // its lower body tucks behind the counter
  g.drawImage(img, x, y);
  drawReception(g, RECEPTION.x * TILE, RECEPTION.y * TILE, RECEPTION.w * TILE, false); // shadow is already in the background
}

/** Yarn ball in the play area; it rolls back and forth while someone bats at it. */
function drawYarn(g: Ctx, YARN: Item, batting: boolean, t: number) {
  const x = YARN.x * TILE + 2 + (batting ? Math.round(Math.abs(Math.sin(t / 260)) * 6) : 0), y = YARN.y * TILE + 10;
  g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(x, y + 4, 5, 1);
  g.fillStyle = '#e05a7a'; g.fillRect(x, y + 1, 5, 3); g.fillRect(x + 1, y, 3, 5);
  g.fillStyle = '#f29ab0'; g.fillRect(x + 1, y + 1, 2, 1); g.fillRect(x + 2, y + 3, 2, 1);
  g.fillStyle = '#e05a7a'; g.fillRect(x + 5, y + 4, 3, 1); // loose strand
}

/** Pixel ring + spokes; the spokes turn while a cat runs inside. The runner is drawn over it, on the rim's bottom. */
function drawWheel(g: Ctx, WHEEL: Item, running: boolean, t: number) {
  const cx = (WHEEL.x + 1) * TILE, cy = WHEEL.y * TILE + 1, r = 13;
  const px = (x: number, y: number, w = 1, h = 1) => g.fillRect(Math.round(x), Math.round(y), w, h);
  g.fillStyle = 'rgba(0,0,0,0.15)'; px(cx - 11, WHEEL.y * TILE + 14, 22, 2);
  g.fillStyle = '#6b6f7a'; // A-frame stand
  for (let k = 0; k <= 13; k++) { px(cx - k * 0.7, cy + k); px(cx + k * 0.7, cy + k); }
  px(cx - 11, WHEEL.y * TILE + 14, 6, 1); px(cx + 5, WHEEL.y * TILE + 14, 6, 1);
  const spin = running ? t / 140 : 0;
  g.fillStyle = '#9fd3f0';
  for (let s = 0; s < 6; s++) {
    const a = spin + (s * Math.PI) / 3;
    for (let k = 2; k < r - 1; k++) px(cx + Math.cos(a) * k, cy + Math.sin(a) * k);
  }
  for (let a = 0; a < Math.PI * 2; a += 0.04) { // rim: outer band + inner track
    g.fillStyle = '#4aa3d8'; px(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    g.fillStyle = '#2f7fb0'; px(cx + Math.cos(a) * (r - 1), cy + Math.sin(a) * (r - 1));
  }
  g.fillStyle = '#e8f4ff'; px(cx - 1, cy - 1, 3, 3);
}

// what an idle cat does at each play spot
const PLAY_ANIM: Record<string, string> = { perch: 'idle', scratch: 'scratch', bat: 'bat', box: 'idle', nap: 'sit', look: 'idle', wheel: 'walk' };
// where the sprite's bottom sits within its tile: on a desk chair's seat, on top of the cat tree, low in the box, on the wheel's rim
const SEAT_Y: Record<string, number> = { desk: 10, perch: -11, box: 12, wheel: 13 };

// ---- entities ------------------------------------------------------------------
function drawEntity(g: Ctx, geo: Geo, e: Ent, t: number, selected: boolean, hovered: boolean) {
  const emp = e.kind === 'employee' ? e.data : null;
  const state = e.phase === 'leave' ? 'offduty' : (e.data.state || 'idle');
  const moving = e.path && e.path.length > 0;
  const st = e.phase === 'seated' ? e.station : null;
  const stationKind = st?.kind ?? null;
  const act = st?.kind === 'play' ? st.act : null;
  const anim = act ? PLAY_ANIM[act] : animFor(state, moving, stationKind);
  const auto = !!emp && AUTO_MODES.has(emp.permissionMode!);
  const rate = anim === 'walk' ? 90 : anim === 'type' ? (auto ? 100 : 160) : anim === 'bat' ? 260 : act === 'scratch' ? 240 : anim === 'write' ? 500 : 450;
  const frame = Math.floor((t + e.seed) / rate);
  // pacing follows the base animation; seats facing away from the viewer swap in back-view frames, desk chairs profile ones
  const look = !st ? anim : st.back ? backAnim(e.pal, anim) : st.face ? sideAnim(e.pal, anim) : anim;
  const img = sprite(e.pal, look, frame);
  const { w, h } = spriteSize(img); // world size: uploaded skins are scaled to a cat's height
  const flip = (anim === 'walk' && (e.dir ?? 0) < 0 && act !== 'wheel') || st?.face === 'left';
  const isAsst = e.kind === 'assistant';
  // centered on the tile, feet on the shadow line, unless it sits on something (SEAT_Y)
  const seatY = SEAT_Y[act || stationKind || ''] ?? 14;
  // horizontally centered, except: paws against the post on the next tile, or centered in the 2-tile wheel
  const ox = act === 'scratch' ? TILE + 5 - w : act === 'wheel' ? TILE - Math.round(w / 2) : Math.round((TILE - w) / 2);
  const oy = seatY - h;
  e.headTop = oy; e.spriteH = h; // for the speech bubble and hit testing (skins can be taller than a cat)
  const bob = !moving && (anim === 'idle' || anim === 'read' || anim === 'sit') && Math.floor((t + e.seed) / 700) % 2 ? 1 : 0;
  g.globalAlpha = e.alpha;
  if (seatY === 14) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(e.x + ox, e.y + 14, w, 2); } // furniture casts its own
  const ring = selected ? outline(img, '#ffd166') : hovered ? outline(img, 'rgba(255,255,255,0.7)') : null;
  const rs = ring ? spriteSize(ring) : { w, h }, rp = (rs.w - w) / 2; // the ring's margin, in world px
  if (flip) {
    g.save(); g.translate(e.x + ox + w, e.y + oy + bob); g.scale(-1, 1);
    if (ring) g.drawImage(ring, -rp, -rp, rs.w, rs.h);
    g.drawImage(img, 0, 0, w, h); g.restore();
  } else {
    if (ring) g.drawImage(ring, e.x + ox - rp, e.y + oy + bob - rp, rs.w, rs.h);
    g.drawImage(img, e.x + ox, e.y + oy + bob, w, h);
  }
  if (act === 'box') { const b = geo.boxes.find((x) => x.id === st?.of); if (b) drawBox(g, b.x * TILE, b.y * TILE, true); } // box front over the cat's lower body
  if (stationKind === 'lounge') drawGlyph(g, 'cup', e.x + ox + w, e.y + oy + h - 4 + bob, t + e.seed);
  // indicators above the head
  const gx = e.x + ox + Math.floor(w / 2) - 3, gy = e.y + oy - 4;
  if (!moving) {
    if (state === 'thinking') drawGlyph(g, 'dots', gx, gy, t + e.seed);
    else if (state === 'waiting') drawGlyph(g, 'bang', gx + 2, gy - 3, t);
    else if (state === 'terminal' || (state === 'idle' && (emp?.bgTasks?.length || emp?.awaitingShell))) drawGlyph(g, 'term', gx - 1, gy - 4, t + e.seed);
    else if (act === 'nap') drawGlyph(g, 'zzz', gx + 4, gy - 2, t + e.seed);
  }
  if (!isAsst && e.phase !== 'leave') {
    if (emp?.permissionMode === 'acceptEdits') drawGlyph(g, 'check', e.x + ox - 6, e.y + oy + 1, t);
  }
  g.globalAlpha = 1;
}

// ---- text -------------------------------------------------------------------------
function drawSign(ctx: CanvasRenderingContext2D, S: number, geo: Geo) {
  ctx.font = `bold ${6.5 * S}px ${FONT}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.fillStyle = '#2a2d45';
  for (const s of geo.signs) ctx.fillText('PAWGENTS OFFICE', (s.x * TILE + 5 * TILE / 2) * S, -3 * S);
  ctx.textAlign = 'left';
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1; }
  return text.slice(0, lo) + '…';
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number) {
  const lines: string[] = [];
  let line: string | null = '', lastSpace = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const cand: string = line + ch;
    if (ctx.measureText(cand).width > maxW && line) {
      if (ch !== ' ' && lastSpace > 0 && line.length - lastSpace < 12) { lines.push(line.slice(0, lastSpace)); line = line.slice(lastSpace + 1) + ch; }
      else { lines.push(line); line = ch === ' ' ? '' : ch; }
      lastSpace = -1;
      if (lines.length === maxLines) { line = null; break; }
    } else { line = cand; if (ch === ' ') lastSpace = line.length - 1; }
  }
  if (line === null) lines[maxLines - 1] = fitText(ctx, lines[maxLines - 1] + '…', maxW);
  else if (line) lines.push(line);
  return lines;
}

function drawBubble(ctx: CanvasRenderingContext2D, S: number, e: Ent, now: number, placed: Rect[], W: number) {
  const data = e.data;
  if (!data || !data.lastText || now - data.lastTextAt > BUBBLE_MS || e.phase === 'leave') return;
  const age = now - data.lastTextAt;
  const alpha = Math.min(1, age / 200) * (age > BUBBLE_MS - 600 ? (BUBBLE_MS - age) / 600 : 1) * e.alpha;
  if (alpha <= 0) return;
  const fs = fpx(4.4, S);
  ctx.font = `${fs}px ${FONT}`;
  const maxW = 70 * S;
  const lines = wrapText(ctx, data.lastText, maxW, 3);
  const lh = fs * 1.25, pad = 2 * S;
  const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
  const bh = lines.length * lh + pad * 2;
  const isAsst = e.kind === 'assistant';
  const lift = -Math.max(0, (e.spriteH ?? 0) - (isAsst ? 8 : 10)); // taller than a cat: raise the bubble by the difference
  const headX = (e.x + 8) * S, headY = (e.y + (isAsst ? 5 : 2) - 7 + lift) * S;
  let bx = Math.round(headX - bw / 2), by = Math.round(headY - bh - 3 * S);
  bx = Math.max(2 * S, Math.min(W * S - bw - 2 * S, bx));
  if (by < 18 * S) by = 18 * S;
  for (const r of placed) if (bx < r.x + r.w && bx + bw > r.x && by < r.y + r.h && by + bh > r.y) by = r.y - bh - S;
  placed.push({ x: bx, y: by, w: bw, h: bh });
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; roundRect(ctx, bx + S, by + S, bw, bh, 3 * S); ctx.fill();
  ctx.fillStyle = '#fffdf7'; roundRect(ctx, bx, by, bw, bh, 3 * S); ctx.fill();
  ctx.strokeStyle = '#2a2d45'; ctx.lineWidth = Math.max(1, S / 2); ctx.stroke();
  const tx = Math.max(bx + 4 * S, Math.min(bx + bw - 4 * S, headX));
  ctx.fillStyle = '#fffdf7';
  ctx.beginPath(); ctx.moveTo(tx - 2 * S, by + bh); ctx.lineTo(tx + 2 * S, by + bh); ctx.lineTo(tx, by + bh + 3 * S); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#2a2d45'; ctx.beginPath(); ctx.moveTo(tx - 2 * S, by + bh); ctx.lineTo(tx, by + bh + 3 * S); ctx.lineTo(tx + 2 * S, by + bh); ctx.stroke();
  ctx.fillStyle = '#1f2233'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  for (const [i, l] of lines.entries()) ctx.fillText(l, bx + pad, by + pad + i * lh);
  ctx.globalAlpha = 1;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

function drawHUD(ctx: CanvasRenderingContext2D, S: number, world: World, now: number) {
  const { sessions, connected } = world;
  let emp = 0, asst = 0, busy = 0;
  for (const s of sessions.values()) {
    if (s.ended || s.officeId !== world.officeId) continue; // this office only
    emp++;
    if (s.state !== 'idle') busy++;
    for (const a of s.subagents) if (!a.ended) asst++;
  }
  const meetings = world.rooms.filter(Boolean).length;
  const fs = fpx(4.6, S);
  ctx.font = `bold ${fs}px ${FONT}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const text = `직원 ${emp}  ·  보조 ${asst}  ·  일하는 중 ${busy}${meetings ? `  ·  회의 ${meetings}` : ''}`;
  const toggle = world.rosterOpen ? '목록 ▴' : '목록 ▾';
  const tw = ctx.measureText(text).width, gw = ctx.measureText(toggle).width;
  const x0 = 1.5 * TILE * S, w = tw + gw + 16 * S;
  ctx.fillStyle = world.hoverKey === HUD_BTN ? 'rgba(52,56,92,0.95)' : 'rgba(20,22,40,0.85)'; roundRect(ctx, x0, 2 * S, w, 10 * S, 2 * S); ctx.fill();
  ctx.fillStyle = connected ? '#22c55e' : '#ef4444'; ctx.fillRect(x0 + 2.5 * S, 5.5 * S, 3 * S, 3 * S);
  ctx.fillStyle = '#f3f4f6'; ctx.fillText(text, x0 + 7 * S, 7 * S);
  ctx.fillStyle = '#ffd166'; ctx.fillText(toggle, x0 + 7 * S + tw + 5 * S, 7 * S);
  world.hudBtn = { x: x0 / S, y: 2 - WALL_RISE, w: w / S, h: 10 }; // office px (the HUD hangs above the office origin)
  const clock = fmtTime(now);
  ctx.textAlign = 'right';
  const cw = ctx.measureText(clock).width + 6 * S;
  const cx = (world.view.geo.W - TILE) * S - 2 * S;
  ctx.fillStyle = 'rgba(20,22,40,0.85)'; roundRect(ctx, cx - cw, 2 * S, cw, 10 * S, 2 * S); ctx.fill();
  ctx.fillStyle = '#f3f4f6'; ctx.fillText(clock, cx - 3 * S, 7 * S);
  ctx.textAlign = 'left';
}

export const HUD_BTN = '__hud__';
