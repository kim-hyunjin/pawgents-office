import { h, render as mount } from 'preact';
import type { Office, Snapshot } from '../shared/api.ts';
import { DEFAULT_OFFICE, inRect } from '../shared/layout.ts';
import { App } from './app.tsx';
import { $, storage } from './common/ui.ts';
import { getState, setTogether } from './data/api.ts';
import { connectEvents } from './data/events.ts';
import {
  app,
  closePanel,
  dropSession,
  here,
  putLooks,
  putOfficeId,
  putOffices,
  putPointer,
  putSession,
  putTogether,
  seedSessions,
  setUi,
  showPanel,
  toggleRoster,
} from './data/state.ts';
import { drawEditorOverlay } from './editor/draw.ts';
import { Editor } from './editor/index.ts';
import { type Frame, HUD_BTN, render } from './scene/render.ts';
import { onSkinLoad, setBreedChoices, setSkins } from './scene/sprites.ts';
import {
  initViewport,
  officeXY,
  refit,
  resize,
  rosterAnchor,
  S,
  setZoom,
  zoomInfo,
} from './scene/viewport.ts';
import {
  applyLayout,
  entAt,
  enterOffice,
  fadeStep,
  placeOf,
  relayout,
  repaintCats as repaintEnts,
  retarget,
  world,
  followSessions as worldFollows,
} from './scene/world.ts';
import { followSessions as feedFollows } from './views/feed.tsx';

const params = new URLSearchParams(location.search);
const st = app.get(); // the page's state: read here, changed only through state.ts's actions

// The page around the canvas (app.tsx) draws itself from the state; mounting it puts the canvas in place.
mount(
  h(App, {
    editor: () => editor,
    entOf: (key) => world.ents.get(key),
    placeOf,
    rosterAnchor: () => (lastFrame ? rosterAnchor(lastFrame.hud) : null),
    onPick: (id) => {
      const s = st.sessions.get(id);
      if (!s) return;
      if (!here(s)) switchOffice(s.officeId);
      showPanel(s.id);
    },
    onPickOffice: (id) => {
      editor.close();
      switchOffice(id);
    },
    // the server moves the staff and pushes the result
    onTogether: (id) => setTogether(id).then(() => {}),
    onEdit: () => {
      // layout editor takes the panel's place
      const o = officeOf(st.officeId);
      if (editor.isOpen || !o) return;
      if (st.rosterOpen) toggleRoster();
      closePanel();
      editor.open(o);
    },
    onZoom: (z) => setZoom(z),
    onBarResize: () => resize(),
    onSideChange: () => refit(), // the panel slides in or out: ease the office to its new room
  }),
  $('stage'),
);
const canvas = $<HTMLCanvasElement>('office');
const ctx = canvas.getContext('2d')!;

initViewport({
  canvas,
  barEl: $('bar'), // office tabs + the tool buttons, above the office
  stageEl: $('stage'),
  sideOpen: () => !!st.panelId || editor.isOpen,
  onResized: () => setUi({ zoom: zoomInfo() }),
});
const editor = new Editor({
  world,
  canvas,
  officeXY,
  onResize: () => resize(),
});
applyLayout(DEFAULT_OFFICE);
resize();

// The ticker and the cats follow the session list, in this order; the panel, the roster and the office tabs
// (app.tsx) follow the whole state on their own.
app.subscribe(feedFollows);
app.subscribe(worldFollows);
app.subscribe((c) => {
  if (c.type !== 'remove') return;
  if (st.panelId === c.id) closePanel();
  else if (st.selectedKey === c.id) setUi({ selectedKey: null });
});

// The address names the session the panel shows (#s=<id>), so a reload opens it again.
let hashFor: string | null = null; // the session the address names
app.subscribe((c) => {
  if (c.type !== 'ui' || st.panelId === hashFor) return;
  hashFor = st.panelId;
  history.replaceState(
    null,
    '',
    hashFor
      ? `#s=${encodeURIComponent(hashFor)}`
      : location.pathname + location.search,
  );
});

// ---- offices ---------------------------------------------------------------------
const OFFICE_KEY = 'pawgents-office:office';
const officeOf = (id?: string | null) => st.offices.find((o) => o.id === id);
/** Server list changed: keep the current office (or pick one), re-lay it out if its layout changed, redraw the tabs. */
function setOffices(list: Office[], together: string | null = null) {
  putOffices(list);
  putTogether(officeOf(together) ? together : null);
  if (st.together && st.officeId !== st.together) {
    editor.close();
    switchOffice(st.together);
    return;
  }
  const cur = officeOf(st.officeId);
  if (!cur) {
    switchOffice(preferredOffice());
    return;
  }
  if (relayout(cur.layout)) resize();
}
function preferredOffice() {
  let want = params.get('office');
  if (!want) want = storage.get(OFFICE_KEY);
  if (officeOf(want)) return want;
  // otherwise the busiest office
  const n = (o: Office) =>
    [...st.sessions.values()].filter((s) => !s.ended && s.officeId === o.id)
      .length;
  return [...st.offices].sort((a, b) => n(b) - n(a))[0]?.id;
}
/** Show another office: its layout, with its staff already at their places. */
function switchOffice(id?: string | null) {
  const o = officeOf(id);
  if (!o) return;
  putOfficeId(o.id);
  storage.set(OFFICE_KEY, o.id);
  if (params.has('office')) {
    params.set('office', o.id);
    history.replaceState(null, '', `?${params}${location.hash}`);
  }
  enterOffice(o.layout);
  resize();
  for (const s of st.sessions.values())
    if (here(s) && !s.ended) putSession(s, true);
}
let firstSnapshot = true;
/** Breed or skin choices changed (snapshot or a 'settings' push): redraw every cat with its family's look. */
function applyCatChoices({ cats, skins }: Pick<Snapshot, 'cats' | 'skins'>) {
  setBreedChoices(cats);
  setSkins(skins);
  repaintCats();
}
// a skin finished loading: families picking it switch from their default breed to it
onSkinLoad(() => repaintCats());
function repaintCats() {
  repaintEnts();
  putLooks();
}
function applySnapshot(snap: Snapshot) {
  applyCatChoices(snap);
  const seated = firstSnapshot;
  firstSnapshot = false;
  if (seated) seedSessions(snap.sessions); // so the first office pick sees who works where
  const m = seated ? location.hash.match(/^#s=([^&]+)/) : null;
  const prefix = m?.[1];
  const picked =
    prefix &&
    snap.sessions.find((x) => x.id.startsWith(decodeURIComponent(prefix)));
  putOffices(snap.offices);
  if (picked && officeOf(picked.officeId)) {
    putTogether(officeOf(snap.together) ? snap.together : null);
    switchOffice(picked.officeId);
  } else setOffices(snap.offices, snap.together);
  const ids = new Set();
  for (const s of snap.sessions) {
    ids.add(s.id);
    putSession(s, seated && !s.ended);
  }
  for (const id of [...st.sessions.keys()]) if (!ids.has(id)) dropSession(id);
  if (picked) {
    hashFor = picked.id; // the address already names it (maybe by a prefix): leave it as typed
    showPanel(picked.id);
  }
}
// Re-evaluate stations once a second (lounge timing, meeting/library linger).
setInterval(() => retarget(Date.now()), 1000);

// ---- SSE -----------------------------------------------------------------------
connectEvents(
  {
    snapshot: (snap) => {
      setUi({ connected: true });
      applySnapshot(snap);
    },
    session: (s) => putSession(s),
    remove: ({ id }) => dropSession(id),
    settings: (d) => applyCatChoices(d),
    offices: (d) => setOffices(d.offices, d.together),
  },
  {
    onOpen: (reconnected) => {
      setUi({ connected: true });
      // events may have been missed while away: start over from a fresh snapshot
      if (reconnected)
        getState()
          .then(applySnapshot)
          .catch(() => {});
    },
    onError: () => setUi({ connected: false }),
  },
);

// ---- input ---------------------------------------------------------------------
/** What the last frame drew where: the HUD button and the cats' sprite heights, for hit testing. */
let lastFrame: Frame | null = null;
/** The HUD on the top wall is the one canvas-drawn button. */
const buttonAt = ([x, y]: [number, number]) =>
  lastFrame && inRect(lastFrame.hud, x, y) ? HUD_BTN : null;
const catAt = ([x, y]: [number, number]) =>
  lastFrame ? entAt(lastFrame.heads, x, y) : null;

canvas.addEventListener('mousemove', (ev) => {
  if (editor.isOpen) {
    setUi({ hoverKey: null });
    return;
  } // the editor handles the pointer
  const xy = officeXY(ev);
  const btn = buttonAt(xy);
  if (btn) {
    setUi({ hoverKey: btn });
    canvas.style.cursor = 'pointer';
    return;
  }
  const e = catAt(xy);
  putPointer(ev.clientX, ev.clientY);
  setUi({ hoverKey: e ? e.key : null });
  canvas.style.cursor = e ? 'pointer' : 'default';
});
canvas.addEventListener('mouseleave', () => {
  setUi({ hoverKey: null });
});
canvas.addEventListener('click', (ev) => {
  if (editor.isOpen) return;
  const xy = officeXY(ev);
  const btn = buttonAt(xy);
  if (btn === HUD_BTN) {
    toggleRoster();
    return;
  }
  const e = catAt(xy);
  if (!e) {
    closePanel();
    return;
  }
  const s = st.sessions.get(e.sessionId);
  if (s) showPanel(s.id, e.key);
  else setUi({ selectedKey: e.key });
});

// ---- loop ----------------------------------------------------------------------
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // rAF time is page-relative; fadeAt and everything else use wall-clock ms
  const wall = Date.now();
  fadeStep(wall, dt);
  lastFrame = render(ctx, S, world, st, wall);
  if (editor.isOpen) drawEditorOverlay(ctx, S, editor);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
