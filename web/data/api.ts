// Same-origin JSON calls, one named function per server route. The server answers errors as { error } (Korean, shown
// to the user as is).
import type {
  Backend,
  BackendsReply,
  DiffReply,
  LaunchReply,
  LogReply,
  ModeReply,
  OkReply,
  PromptReply,
  ReplyReply,
  Snapshot,
  WorktreesReply,
} from '../../shared/api.ts';
import type { Layout } from '../../shared/layout.ts';

/** body !== undefined: sent as JSON (some routes need the JSON content-type even with an empty body — CSRF guard). */
async function api<T>(
  url: string,
  { method = 'GET', body }: { method?: string; body?: unknown } = {},
): Promise<T> {
  const r = await fetch(
    url,
    body === undefined
      ? { method }
      : {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  let d: unknown = {}; // server JSON, shape depends on the route
  try {
    const text = await r.text();
    if (text) d = JSON.parse(text);
  } catch {
    /* empty or non-JSON body */
  }
  if (!r.ok)
    throw new Error(
      (d as { error?: string } | null)?.error || `HTTP ${r.status}`,
    );
  return (d ?? {}) as T;
}
const post = <T>(url: string, body: unknown = {}) =>
  api<T>(url, { method: 'POST', body });
const session = (id: string) => `/sessions/${encodeURIComponent(id)}`;

// ---- the office as a whole ---------------------------------------------------------
/** Everything at once, as the 'snapshot' event carries it (used after a reconnect). */
export const getState = () => api<Snapshot>('/state');

/** Gather everyone in one office (null: split up by repo). */
export const setTogether = (officeId: string | null) =>
  post<OkReply>('/settings/together', { officeId });

// ---- sessions ----------------------------------------------------------------------
export const getLog = (id: string) => api<LogReply>(`${session(id)}/log`);
/** The full last reply (SSE only carries a short preview). */
export const getReply = (id: string) => api<ReplyReply>(`${session(id)}/reply`);
export const getDiff = (id: string, file: string) =>
  api<DiffReply>(`${session(id)}/diff?file=${encodeURIComponent(file)}`);

/** Hand an instruction to the session: typed into its Orca terminal, or queued as the next headless turn. */
export const sendPrompt = (id: string, text: string) =>
  post<PromptReply>(`${session(id)}/prompt`, { text });

/** Send a session home. force: close its Orca terminal tab instead of typing /exit (it isn't idle). */
export const closeSession = (id: string, force?: boolean) =>
  post<OkReply>(`${session(id)}/close`, { force });

/** Switch a live session's permission mode (headless: control request; Orca: Shift+Tab until the footer shows it). */
export const setMode = (id: string, mode: string) =>
  post<ModeReply>(`${session(id)}/mode`, { mode });

/** Answer a headless session's parked permission request (reqId from s.pendingPermissions). */
export const decidePermission = (id: string, reqId: string, allow: boolean) =>
  post<OkReply>(`${session(id)}/permission`, { id: reqId, allow });

// ---- hiring ------------------------------------------------------------------------
export const getBackends = () => api<BackendsReply>('/backends');
export const getWorktrees = (backend: Backend) =>
  api<WorktreesReply>(`/worktrees?backend=${backend}`);

/** POST /launch body: an Orca worktree, or a headless folder + permission mode. */
export interface LaunchRequest {
  backend: Backend;
  worktreeId?: string;
  cwd?: string;
  permissionMode?: string;
  newWorktree: { name: string } | null;
  prompt: string;
  model: string;
  count: number;
}
export const launch = (req: LaunchRequest) => post<LaunchReply>('/launch', req);

// ---- offices -----------------------------------------------------------------------
const office = (id: string) => `/offices/${encodeURIComponent(id)}`;
export const renameOffice = (id: string, name: string) =>
  post<OkReply>(office(id), { name });
export const saveLayout = (id: string, layout: Layout) =>
  post<OkReply>(`${office(id)}/layout`, { layout });
/** Close an office: its repos and staff move to the default one. */
export const closeOffice = (id: string) =>
  api<OkReply>(office(id), { method: 'DELETE', body: {} }); // the server wants a JSON body here (CSRF guard)

// ---- cats and skins ----------------------------------------------------------------
/** A model family's breed (null: back to its default). */
export const setCatChoice = (family: string, breed: string | null) =>
  post<OkReply>('/settings/cats', { family, breed });

export const uploadSkin = (skin: {
  name: string;
  cellW: number;
  cellH: number;
  png: string | undefined;
}) => post<OkReply>('/skins', skin);
export const deleteSkin = (id: string) =>
  post<OkReply>(`/skins/${id}/delete`, {});

/** A skin's sprite sheet as uploaded. */
export async function getSkinPng(id: string) {
  const r = await fetch(`/skins/${id}.png`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.blob();
}
