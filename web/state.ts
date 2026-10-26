// What the page knows: the server's sessions and offices, which office is on screen, and what the pointer is on.
// Changed only through the actions below, so whoever shows sessions (ticker, cats, panel, roster, tabs) can subscribe
// to `app` instead of being called by hand. The cats themselves are world.ts's.
import type { Office, SessionSnapshot } from '../shared/api.ts';
import { createStore } from './store.ts';

export interface AppState {
  sessions: Map<string, SessionSnapshot>; // id -> the server's session
  offices: Office[]; // [{ id, name, repos, layout }] from the server, one per repo
  officeId: string | null; // the office on screen; only its sessions get cats
  together: string | null; // office everyone works in regardless of repo (server setting), or null
  connected: boolean; // the event stream is up
  hoverKey: string | null; // cat (or HUD_BTN) under the pointer
  selectedKey: string | null; // cat whose session the panel shows
  rosterOpen: boolean;
}

export type Change =
  /** A session arrived or changed (`seated`: its cat appears at its place instead of walking in). */
  | {
      type: 'session';
      s: SessionSnapshot;
      prev: SessionSnapshot | undefined;
      seated: boolean;
      at: number;
    }
  /** A session is gone. */
  | { type: 'remove'; id: string; s: SessionSnapshot | undefined }
  /** Sessions known without anyone redrawing (the first snapshot, before an office is picked). */
  | { type: 'seed' }
  | { type: 'offices' }
  | { type: 'office' }
  | { type: 'ui' };

export const app = createStore<AppState, Change>({
  sessions: new Map(),
  offices: [],
  officeId: null,
  together: null,
  connected: false,
  hoverKey: null,
  selectedKey: null,
  rosterOpen: false,
});

/** The session works in the office on screen. */
export const here = (s: SessionSnapshot) => s.officeId === app.get().officeId;

// ---- actions -------------------------------------------------------------------------
export const putSession = (s: SessionSnapshot, seated = false) =>
  app.update((st) => {
    const at = Date.now(),
      prev = st.sessions.get(s.id);
    st.sessions.set(s.id, s);
    return { type: 'session', s, prev, seated, at };
  });
export const dropSession = (id: string) =>
  app.update((st) => {
    const s = st.sessions.get(id);
    st.sessions.delete(id);
    return { type: 'remove', id, s };
  });
export const seedSessions = (list: SessionSnapshot[]) =>
  app.update((st) => {
    for (const s of list) st.sessions.set(s.id, s);
    return { type: 'seed' };
  });

export const putOffices = (offices: Office[]) =>
  app.update((st) => {
    st.offices = offices;
    return { type: 'offices' };
  });
export const putTogether = (together: string | null) =>
  app.update((st) => {
    st.together = together;
    return { type: 'offices' };
  });
/** Another office on screen; the pointer was on something in the old one. */
export const putOfficeId = (officeId: string) =>
  app.update((st) => {
    st.officeId = officeId;
    st.hoverKey = null;
    return { type: 'office' };
  });

type Ui = Pick<
  AppState,
  'connected' | 'hoverKey' | 'selectedKey' | 'rosterOpen'
>;
export const setUi = (patch: Partial<Ui>) =>
  app.update((st) => {
    Object.assign(st, patch);
    return { type: 'ui' };
  });
