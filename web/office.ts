import { h, render as mount } from 'preact';
import type { Office, SessionSnapshot, Snapshot } from '../shared/api.ts';
import { DEFAULT_OFFICE, inRect } from '../shared/layout.ts';
import { getState, setTogether } from './api.ts';
import { initDiff } from './diff.tsx';
import { Editor } from './editor.ts';
import { drawEditorOverlay } from './editor-draw.ts';
import { followSessions as feedFollows, renderFeed } from './feed.tsx';
import { initLauncher, openLauncher } from './launcher.tsx';
import { initLegend, openLegend, refreshLegend } from './legend.tsx';
import { connectEvents } from './net/events.ts';
import { Panel } from './panel.tsx';
import { type Frame, HUD_BTN, render } from './render.ts';
import { initReply } from './reply.tsx';
import { Roster } from './roster.tsx';
import { onSkinLoad, setBreedChoices, setSkins } from './sprites.ts';
import {
  app,
  dropSession,
  here,
  putOfficeId,
  putOffices,
  putSession,
  putTogether,
  seedSessions,
  setUi,
} from './state.ts';
import { Tabs } from './tabs.tsx';
import { CatTip } from './tip.tsx';
import { Toolbar } from './toolbar.tsx';
import { $, storage } from './ui.ts';
import {
  initViewport,
  officeXY,
  refit,
  resize,
  rosterAnchor,
  S,
  setZoom,
  zoomInfo,
} from './viewport.ts';
import type { Ent } from './world.ts';
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
} from './world.ts';

const params = new URLSearchParams(location.search);
const st = app.get(); // the page's state: read here, changed only through state.ts's actions

const canvas = $<HTMLCanvasElement>('office');
const tabsEl = $('tabs');
const barEl = $('bar'); // office tabs + the tool buttons, above the office
const toolsEl = $('tools');
const stageEl = $('stage');
const ctx = canvas.getContext('2d')!;
const tip = $('tip');
// dialogs first: the reply dialog notes where the panel's composer lives before anything can move it
initLauncher();
initLegend();
initDiff();
initReply({ composer: (host) => panel.setComposerHost(host) });
const panel = new Panel($('panel'), {
  onOpen: () => refit(),
  onClose: () => {
    setUi({ selectedKey: null });
    history.replaceState(null, '', location.pathname + location.search);
    refit();
  },
});

initViewport({
  canvas,
  barEl,
  toolsEl,
  stageEl,
  sideOpen: () => panel.isOpen || editor.isOpen,
  editorOpen: () => editor.isOpen,
  onZoom: () => drawToolbar(),
});
const editor = new Editor({
  world,
  canvas,
  officeXY,
  onResize: () => resize(),
});
applyLayout(DEFAULT_OFFICE);
resize();

const refreshLists = () => {
  showRoster();
  renderTabs();
};
// Everything that shows sessions follows the session list, in this order: the ticker, the cats, the panel, then the
// roster and the office tabs.
app.subscribe(feedFollows);
app.subscribe(worldFollows);
app.subscribe((c) => {
  if (c.type === 'session') panel.update(c.s);
  else if (c.type === 'remove') panel.remove(c.id);
});
app.subscribe((c) => {
  if (c.type !== 'session' && c.type !== 'remove') return;
  refreshLists();
  if (c.type === 'remove' && st.selectedKey === c.id)
    setUi({ selectedKey: null });
});

/** Show a session in the panel; `key` is the cat to highlight (an assistant's, when it was clicked). */
function select(
  s: SessionSnapshot,
  { key = s.id, hash = true }: { key?: string; hash?: boolean } = {},
) {
  setUi({ selectedKey: key });
  panel.open(s);
  if (hash) history.replaceState(null, '', `#s=${encodeURIComponent(s.id)}`);
}
function deselect() {
  setUi({ selectedKey: null });
  panel.close();
}

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
  renderTabs();
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
  renderFeed(false);
  refreshLists();
}
/** The office tabs (tabs.tsx), hidden with one office; showing or hiding them changes the room the office has. */
let tabsShown = false;
function renderTabs() {
  const show = st.offices.length > 1 || !!st.together;
  tabsEl.hidden = !show;
  mount(
    show
      ? h(Tabs, {
          offices: st.offices,
          sessions: st.sessions,
          officeId: st.officeId,
          together: st.together,
          onPick: (id) => {
            editor.close();
            switchOffice(id);
          },
          // the server moves the staff and pushes the result
          onTogether: (id) => setTogether(id).then(() => {}),
        })
      : null,
    tabsEl,
  );
  if (show !== tabsShown) {
    tabsShown = show;
    resize();
  }
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
  showRoster();
  refreshLegend();
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
  if (picked) select(st.sessions.get(picked.id)!, { hash: false });
}
// Re-evaluate stations once a second (lounge timing, meeting/library linger).
setInterval(() => {
  retarget(Date.now());
  refreshLists(); // places change as cats walk around
}, 1000);

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

// ---- roster (opened from the HUD) ----------------------------------------------------
/** Draw the roster from the current state (Preact keeps what didn't change); closed, it renders nothing. */
function showRoster() {
  mount(
    h(Roster, {
      sessions: st.sessions,
      anchor: st.rosterOpen && lastFrame ? rosterAnchor(lastFrame.hud) : null,
      onClose: toggleRoster,
      onPick: (id) => {
        const s = st.sessions.get(id);
        if (!s) return;
        if (!here(s)) switchOffice(s.officeId);
        select(s);
      },
      placeOf: (id) => {
        const s = st.sessions.get(id);
        if (s && !here(s)) return officeOf(s.officeId)?.name || ''; // works in another office
        const e = world.ents.get(id);
        return e && e.station?.kind !== 'desk' ? placeOf(e) : '';
      },
      palOf: (id) => world.ents.get(id)?.pal,
    }),
    $('roster-root'),
  );
}
function toggleRoster() {
  setUi({ rosterOpen: !st.rosterOpen });
  showRoster();
}
window.addEventListener('resize', () => {
  if (st.rosterOpen) showRoster();
});

// ---- input ---------------------------------------------------------------------
/** The tooltip over cat `e`, or nothing when its session is gone. */
function showTip(e: Ent) {
  const s = st.sessions.get(e.sessionId);
  mount(s ? h(CatTip, { e, s, where: placeOf(e) }) : null, tip);
}

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
    tip.hidden = true;
    return;
  } // the editor handles the pointer
  const xy = officeXY(ev);
  const btn = buttonAt(xy);
  if (btn) {
    setUi({ hoverKey: btn });
    canvas.style.cursor = 'pointer';
    tip.hidden = true;
    return;
  }
  const e = catAt(xy);
  setUi({ hoverKey: e ? e.key : null });
  canvas.style.cursor = e ? 'pointer' : 'default';
  if (e) {
    showTip(e);
    tip.hidden = false;
    const r = canvas.getBoundingClientRect();
    let tx = r.left + ev.offsetX + 14,
      ty = r.top + ev.offsetY + 14;
    if (tx + tip.offsetWidth > window.innerWidth - 8)
      tx = r.left + ev.offsetX - tip.offsetWidth - 8;
    if (ty + tip.offsetHeight > window.innerHeight - 8)
      ty = r.top + ev.offsetY - tip.offsetHeight - 8;
    tip.style.left = `${tx}px`;
    tip.style.top = `${ty}px`;
  } else tip.hidden = true;
});
canvas.addEventListener('mouseleave', () => {
  setUi({ hoverKey: null });
  tip.hidden = true;
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
    deselect();
    return;
  }
  const s = st.sessions.get(e.sessionId);
  if (s) select(s, { key: e.key });
  else setUi({ selectedKey: e.key });
});

// ---- tool buttons (above the office) ---------------------------------------------------
function drawToolbar() {
  mount(
    h(Toolbar, {
      zoom: zoomInfo(),
      onNew: () => openLauncher(),
      onLegend: () => openLegend(st.sessions),
      onEdit: () => {
        // layout editor takes the panel's place
        const o = officeOf(st.officeId);
        if (editor.isOpen || !o) return;
        if (st.rosterOpen) toggleRoster();
        deselect();
        editor.open(o);
      },
      onZoom: setZoom,
    }),
    toolsEl,
  );
}
drawToolbar();

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
