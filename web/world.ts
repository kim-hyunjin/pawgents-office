import type {
  Office,
  SessionSnapshot,
  SubagentSnapshot,
} from '../server/types.ts';
import { step } from './anim.ts';
import type { Geo, Layout, Pt, Spot } from './layout.ts';
import { compile, TILE } from './layout.ts';
import type { Palette } from './sprites.ts';
import { familyOf, hashStr, paletteFor } from './sprites.ts';
import { buildBackground } from './tilemap.ts';
import { awaitingBg } from './ui.ts';

const PLAY_AFTER_MS =
  Number(new URLSearchParams(location.search).get('playAfter') || 15) * 1000; // idle this long → off to play / lounge
const MEETING_LINGER_MS = 8000; // keep the meeting room this long after the last subagent finishes
const LIBRARY_LINGER_MS = 10000; // stay at the bookshelf this long after the last search, so back-to-back searches don't bounce

/** Sticky slot allocator: a key keeps its slot until released. */
export class Slots {
  spots: Pt[];
  owner = new Map<number, string>();
  of = new Map<string, number>();
  constructor(spots: Pt[]) {
    this.spots = spots;
  }
  take(key: string): number {
    if (this.of.has(key)) return this.of.get(key)!;
    for (let i = 0; i < this.spots.length; i++)
      if (!this.owner.has(i)) {
        this.owner.set(i, key);
        this.of.set(key, i);
        return i;
      }
    return -1;
  }
  release(key: string) {
    const i = this.of.get(key);
    if (i === undefined) return;
    this.of.delete(key);
    this.owner.delete(i);
  }
  /** Move key to a random free slot other than its current one; keeps the current slot if none is free. */
  takeRandom(key: string): number {
    const free: number[] = [];
    for (let i = 0; i < this.spots.length; i++)
      if (!this.owner.has(i)) free.push(i);
    if (!free.length) return this.of.get(key) ?? -1;
    this.release(key);
    const i = free[Math.floor(Math.random() * free.length)];
    this.owner.set(i, key);
    this.of.set(key, i);
    return i;
  }
  has(key: string) {
    return this.of.has(key);
  }
}

const dwellMs = (act?: string) =>
  act === 'nap' || act === 'lounge'
    ? 20000 + Math.random() * 20000
    : 7000 + Math.random() * 8000;

export type StationKind =
  | 'exit'
  | 'meeting'
  | 'plan'
  | 'library'
  | 'play'
  | 'lounge'
  | 'desk'
  | 'bullpen'
  | 'near';
/** Where a cat stands or sits: a tile plus what it does there (`back`/`face`: seat orientation, `act`: play activity). */
export interface Station extends Spot {
  kind: StationKind;
  room?: number;
  desk?: number | null;
  back?: boolean;
  face?: string;
}

interface EntBase {
  key: string;
  sessionId: string;
  desk: number | null;
  pal: Palette;
  seed: number;
  x: number;
  y: number;
  dir?: number;
  path: Pt[];
  onArrive?: (() => void) | null;
  phase: 'enter' | 'seated' | 'leave' | 'fade';
  alpha: number;
  station: Station | null;
  fadeAt?: number;
  headTop?: number;
  spriteH?: number; // set by the renderer: for the speech bubble and hit testing
}
export interface Employee extends EntBase {
  kind: 'employee';
  data: SessionSnapshot;
  lastLiveSub: number;
  lastSearch: number;
  playUntil?: number;
}
export interface Assistant extends EntBase {
  kind: 'assistant';
  agentId: string;
  data: SubagentSnapshot;
}
/** A cat on screen: a session's employee or one of its subagents' assistants. */
export type Ent = Employee | Assistant;

export interface OfficeView {
  geo: Geo;
  bg: OffscreenCanvas;
}
export interface World {
  offices: Office[];
  officeId: string | null;
  together: string | null;
  layoutJson: string;
  geo: Geo;
  bg: OffscreenCanvas;
  view: OfficeView;
  editing: boolean;
  sessions: Map<string, SessionSnapshot>;
  ents: Map<string, Ent>;
  hoverKey: string | null;
  selectedKey: string | null;
  connected: boolean;
  rooms: (string | null)[];
  roomSeats: Slots[];
  plan: Slots;
  library: Slots;
  bullpen: Slots;
  funSpots: Spot[];
  play: Slots;
  near: Map<string, Slots>;
  hudBtn: { x: number; y: number; w: number; h: number } | null;
  rosterOpen: boolean;
}

// Also written elsewhere: hudBtn (render.js, each frame), rosterOpen (office.js), selectedKey (office.js / panel close).
// geo, bg, view and the slot allocators are set by applyLayout before anything reads them.
const unset = null as never;
export const world: World = {
  offices: [], // [{ id, name, repos, layout }] from the server, one per repo
  officeId: null, // the office on screen; only its sessions get cats
  together: null, // office everyone works in regardless of repo (server setting), or null
  layoutJson: '', // its layout as last applied, to spot changes
  geo: unset, // compiled layout (layout.js) of the office on screen
  bg: unset,
  view: unset, // what is drawn: { geo, bg } of the live office, or of the editor's draft
  editing: false,
  sessions: new Map(), // id -> server session object
  ents: new Map(), // key -> entity
  hoverKey: null,
  selectedKey: null,
  connected: false,
  // slot allocators over the layout's spots; rebuilt by applyLayout
  rooms: [], // meeting room index -> session id
  roomSeats: [],
  plan: unset,
  library: unset,
  bullpen: unset,
  funSpots: [], // idle cats roam between these: the play area plus the lounge (sofa, coffee machine)
  play: unset,
  hudBtn: null,
  rosterOpen: false,
  near: new Map(), // aisle -> Slots
};

/** Switch to a layout: rebuild the background and every slot, then send each cat to its (new) station. The caller resizes the canvas. */
export function applyLayout(office: Layout) {
  const geo = compile(office);
  world.geo = geo;
  world.bg = buildBackground(geo);
  if (!world.editing) world.view = { geo, bg: world.bg };
  world.rooms = geo.meetings.map(() => null);
  world.roomSeats = geo.meetings.map((r) => new Slots(r.seats));
  world.plan = new Slots(geo.planSpots);
  world.library = new Slots(geo.librarySpots);
  world.funSpots = [
    ...geo.playSpots,
    ...geo.loungeSpots.map((p) => ({ ...p, act: 'lounge' })),
  ];
  world.play = new Slots(world.funSpots);
  world.bullpen = new Slots(geo.bullpenSpots);
  world.near = new Map();
  const now = Date.now();
  for (const e of world.ents.values()) {
    e.station = null;
    if (e.phase === 'fade') continue;
    const s = world.sessions.get(e.sessionId);
    if (!s) goTo(e, { kind: 'exit', ...geo.spawn });
    else if (e.kind === 'employee') goTo(e, sessionStation(s, e, now));
    else if (e.data && !e.data.ended) goTo(e, assistantStation(s, e.data));
  }
}

// ---- stations ------------------------------------------------------------------
// Two desks of a pod share one aisle column, so near-desk slots are keyed by the aisle, not the desk.
const NO_SLOTS = new Slots([]);
const nearSlots = (desk: number | null) => {
  if (desk === null || !world.geo.desks[desk]) return NO_SLOTS; // no desk (overflow): assistants stand in the lobby
  const spots = world.geo.nearDeskSpots(desk);
  const key = `${spots[0].x}:${spots[0].y}`;
  let s = world.near.get(key);
  if (!s) {
    s = new Slots(spots);
    world.near.set(key, s);
  }
  return s;
};
const sameStation = (a: Station | null, b: Station) =>
  a && b && a.kind === b.kind && a.x === b.x && a.y === b.y;

function releaseRoom(sid: string) {
  const r = world.rooms.indexOf(sid);
  if (r >= 0) {
    world.rooms[r] = null;
    world.roomSeats[r] = new Slots(world.geo.meetings[r].seats);
  }
}

/** Where should this session's employee be right now? */
function sessionStation(s: SessionSnapshot, e: Employee, now: number): Station {
  const geo = world.geo;
  if (s.ended) {
    world.plan.release(s.id);
    world.library.release(s.id);
    world.play.release(s.id);
    releaseRoom(s.id);
    return { kind: 'exit', ...geo.spawn };
  }
  const live = (s.subagents || []).filter((a) => !a.ended);
  if (live.length) e.lastLiveSub = now;
  const wantsRoom =
    live.length > 0 ||
    (e.lastLiveSub && now - e.lastLiveSub < MEETING_LINGER_MS);
  if (wantsRoom) {
    let r = world.rooms.indexOf(s.id);
    if (r < 0) {
      r = world.rooms.indexOf(null);
      if (r >= 0) world.rooms[r] = s.id;
    }
    if (r >= 0) {
      world.plan.release(s.id);
      world.library.release(s.id);
      world.play.release(s.id);
      return { kind: 'meeting', room: r, ...geo.meetings[r].head };
    }
  } else releaseRoom(s.id);
  const busyWithSubs = live.length > 0; // rooms full: stay at the desk with the assistants around
  if (s.permissionMode === 'plan') {
    const i = world.plan.take(s.id);
    if (i >= 0) {
      world.library.release(s.id);
      world.play.release(s.id);
      return { kind: 'plan', ...geo.planSpots[i] };
    }
  } else world.plan.release(s.id);
  if (s.state === 'searching') e.lastSearch = now;
  if (
    e.lastSearch &&
    now - e.lastSearch < LIBRARY_LINGER_MS &&
    s.state !== 'idle'
  ) {
    const i = world.library.take(s.id);
    if (i >= 0) {
      world.play.release(s.id);
      return { kind: 'library', ...geo.librarySpots[i] };
    }
  } else world.library.release(s.id);
  const idleFor = s.state === 'idle' ? now - s.stateSince : 0;
  // Turn ended but a background shell/monitor will wake it — waiting at the desk, not on a break.
  if (!busyWithSubs && !awaitingBg(s) && idleFor > PLAY_AFTER_MS) {
    if (!world.play.has(s.id) || now >= (e.playUntil ?? Infinity)) {
      // time to wander to another spot
      const i = world.play.takeRandom(s.id);
      if (i >= 0) e.playUntil = now + dwellMs(world.funSpots[i].act);
    }
    const i = world.play.of.get(s.id);
    if (i !== undefined) {
      const p = world.funSpots[i];
      return { kind: p.act === 'lounge' ? 'lounge' : 'play', ...p };
    }
  } else world.play.release(s.id);
  const d = geo.desks[s.desk ?? -1];
  if (d) {
    world.bullpen.release(`s:${s.id}`);
    return { kind: 'desk', desk: s.desk, ...d.chair };
  }
  const i = world.bullpen.take(`s:${s.id}`);
  return { kind: 'bullpen', ...geo.bullpenSpots[Math.max(0, i)] };
}

/** Where should this subagent's assistant be? null = stay and fade. */
function assistantStation(s: SessionSnapshot, a: SubagentSnapshot): Station {
  const key = a.agentId;
  const r = world.rooms.indexOf(s.id);
  if (r >= 0) {
    nearSlots(s.desk).release(key);
    world.bullpen.release(`a:${key}`);
    const i = world.roomSeats[r].take(key);
    const room = world.geo.meetings[r];
    if (i >= 0) return { kind: 'meeting', room: r, ...room.seats[i] };
    return {
      kind: 'meeting',
      room: r,
      x: room.x + room.w - 1,
      y: room.y + (hashStr(key) % room.h),
    };
  }
  for (const rs of world.roomSeats) rs.release(key);
  const i = nearSlots(s.desk).take(key);
  if (i >= 0) {
    world.bullpen.release(`a:${key}`);
    return { kind: 'near', ...world.geo.nearDeskSpots(s.desk!)[i] };
  }
  const b = world.bullpen.take(`a:${key}`);
  return { kind: 'bullpen', ...world.geo.bullpenSpots[Math.max(0, b)] };
}

function releaseAll(e: Ent) {
  const s = e.sessionId;
  if (e.kind === 'employee') {
    world.plan.release(s);
    world.library.release(s);
    world.play.release(s);
    world.bullpen.release(`s:${s}`);
    releaseRoom(s);
  } else {
    for (const rs of world.roomSeats) rs.release(e.agentId);
    nearSlots(e.desk).release(e.agentId);
    world.bullpen.release(`a:${e.agentId}`);
  }
}

function goTo(e: Ent, station: Station, teleport = false) {
  if (sameStation(e.station, station)) return;
  e.station = station;
  if (teleport) {
    e.x = station.x * TILE;
    e.y = station.y * TILE;
    e.path = [];
    e.phase = 'seated';
    return;
  }
  const cur = { x: Math.round(e.x / TILE), y: Math.round(e.y / TILE) };
  e.path = world.geo.findPath(cur, station) || [station];
  e.phase = station.kind === 'exit' ? 'leave' : 'enter';
  e.onArrive = () => {
    if (e.station!.kind === 'exit') {
      releaseAll(e);
      world.ents.delete(e.key);
    } else e.phase = 'seated';
  };
}

// ---- entities ------------------------------------------------------------------
function spawnEmployee(s: SessionSnapshot, seated: boolean, now: number) {
  const e: Employee = {
    key: s.id,
    kind: 'employee',
    sessionId: s.id,
    desk: s.desk,
    data: s,
    pal: paletteFor(s.id, 'employee', s.model),
    seed: hashStr(s.id) % 1000,
    x: world.geo.spawn.x * TILE,
    y: world.geo.spawn.y * TILE,
    path: [],
    phase: 'enter',
    alpha: 1,
    station: null,
    lastLiveSub: 0,
    lastSearch: 0,
  };
  world.ents.set(e.key, e);
  goTo(e, sessionStation(s, e, now), seated);
  return e;
}
function spawnAssistant(
  s: SessionSnapshot,
  a: SubagentSnapshot,
  parent: Ent | undefined,
  seated: boolean,
) {
  const e: Assistant = {
    key: `${s.id}/${a.agentId}`,
    kind: 'assistant',
    sessionId: s.id,
    agentId: a.agentId,
    desk: s.desk,
    data: a,
    pal: paletteFor(a.agentId, 'assistant', a.model || s.model),
    seed: hashStr(a.agentId) % 1000,
    x: parent ? parent.x : world.geo.spawn.x * TILE,
    y: parent ? parent.y : world.geo.spawn.y * TILE,
    path: [],
    phase: 'enter',
    alpha: 1,
    station: null,
  };
  world.ents.set(e.key, e);
  goTo(e, assistantStation(s, a), seated);
  return e;
}
function fade(e: Ent, now: number) {
  if (e.phase === 'fade') return;
  e.phase = 'fade';
  e.fadeAt = now;
  e.path = [];
  releaseAll(e);
}

export const here = (s: SessionSnapshot) => s.officeId === world.officeId;

/** Bring a session's cats (employee + assistants) in the office on screen in line with the server's view of it. */
export function syncSession(s: SessionSnapshot, seated: boolean, now: number) {
  let e = world.ents.get(s.id) as Employee | undefined;
  if (!e) {
    if (!s.ended) e = spawnEmployee(s, seated, now);
  } else {
    e.data = s;
    e.desk = s.desk;
    if (e.pal.fam !== familyOf(s.model))
      e.pal = paletteFor(s.id, 'employee', s.model); // model switched mid-session
    goTo(e, sessionStation(s, e, now));
  }
  const seen = new Set();
  for (const a of s.subagents || []) {
    seen.add(a.agentId);
    const key = `${s.id}/${a.agentId}`;
    let ae = world.ents.get(key);
    if (!a.ended) {
      if (!ae) ae = spawnAssistant(s, a, e, seated);
      else {
        ae.data = a;
        ae.desk = s.desk;
        if (ae.pal.fam !== familyOf(a.model || s.model))
          ae.pal = paletteFor(a.agentId, 'assistant', a.model || s.model);
        if (ae.phase !== 'fade') goTo(ae, assistantStation(s, a));
      }
    } else if (ae) {
      ae.data = a;
      fade(ae, now);
    }
  }
  for (const ae of world.ents.values()) {
    if (
      ae.kind === 'assistant' &&
      ae.sessionId === s.id &&
      !seen.has(ae.agentId)
    )
      fade(ae, now);
  }
}
/** Remove a session's cats at once (it works in another office now, or we switched away). */
export function dropCats(id: string) {
  for (const e of [...world.ents.values()])
    if (e.sessionId === id) {
      releaseAll(e);
      world.ents.delete(e.key);
    }
}
/** The session is gone: its employee walks out the door, its assistants fade. */
export function exitSession(id: string) {
  const e = world.ents.get(id);
  if (e) goTo(e, { kind: 'exit', ...world.geo.spawn });
  for (const ae of world.ents.values())
    if (ae.kind === 'assistant' && ae.sessionId === id) fade(ae, Date.now());
}
/** Re-evaluate every station on screen (lounge timing, meeting/library linger); called once a second. */
export function retarget(now: number) {
  for (const s of world.sessions.values()) {
    if (!here(s)) continue;
    const e = world.ents.get(s.id) as Employee | undefined;
    if (e && e.phase !== 'leave') goTo(e, sessionStation(s, e, now));
    for (const a of s.subagents || []) {
      const ae = world.ents.get(`${s.id}/${a.agentId}`);
      if (ae && !a.ended && ae.phase !== 'fade')
        goTo(ae, assistantStation(s, a));
    }
  }
}
/** Per frame: walk every cat, fade out the leaving assistants. `wall` is wall-clock ms (fadeAt uses it), `dt` seconds. */
export function fadeStep(wall: number, dt: number) {
  for (const e of [...world.ents.values()]) {
    step(e, dt);
    if (e.phase === 'fade') {
      e.alpha = 1 - (wall - e.fadeAt!) / 1500;
      if (e.alpha <= 0) world.ents.delete(e.key);
    }
  }
}

// ---- hit test ------------------------------------------------------------------
export function entAt(lx: number, ly: number) {
  let best: Ent | null = null;
  for (const e of world.ents.values()) {
    const isA = e.kind === 'assistant';
    const x0 = e.x + (isA ? 4 : 3),
      x1 = e.x + (isA ? 12 : 13),
      y0 = e.y + Math.min(isA ? 3 : 0, e.headTop ?? 0),
      y1 = e.y + 16;
    if (lx >= x0 && lx <= x1 && ly >= y0 && ly <= y1 && (!best || e.y > best.y))
      best = e;
  }
  return best;
}
const PLACE: Record<string, string> = {
  desk: '자리',
  meeting: '회의실',
  plan: '기획 보드',
  library: '서가',
  lounge: '라운지',
  play: '놀이터',
  bullpen: '로비',
  near: '책상 옆',
  exit: '퇴근 중',
};
export function placeOf(e: Ent) {
  if (!e.station) return '';
  const k = e.station.kind;
  if (k === 'meeting')
    return world.geo.meetings[e.station.room!]?.name || PLACE.meeting;
  return PLACE[k] || '';
}
