import fs from 'node:fs';
import path from 'node:path';
import { isRecord, safeJsonParse } from '../shared/json.ts';
import { isBusyState } from '../shared/model.ts';
import { isPidAlive, isProcessAlive } from '../shared/node/process.ts';
import { SESSIONS_DIR, STALE_TOOL_MS } from './config.ts';
import { transcriptPathOf } from './infra/claude-paths.ts';
import { readSafe } from './infra/fs.ts';
import type { Store } from './store.ts';
import { traitsOf } from './traits.ts';
import type { Session } from './types.ts';

/** One ~/.claude/sessions/<pid>.json, written by Claude Code: the fields read here. */
interface RegistryEntry {
  sessionId: string;
  pid: number;
  cwd?: string;
  name?: string;
  startedAt?: number;
  procStart?: unknown; // the process's creation time (a FILETIME on Windows), to tell it from a later owner of the pid
  status?: unknown;
  waitingFor?: unknown;
  statusUpdatedAt?: unknown;
}
/** What syncWaiting reads of an entry. */
export type RegistryStatus = Pick<
  RegistryEntry,
  'status' | 'waitingFor' | 'statusUpdatedAt'
>;

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** A parsed registry file as an entry, or null when it names no session or pid. */
function toEntry(d: unknown): RegistryEntry | null {
  if (!isRecord(d) || !d.sessionId || typeof d.pid !== 'number' || !d.pid)
    return null;
  return {
    sessionId: String(d.sessionId),
    pid: d.pid,
    cwd: str(d.cwd),
    name: str(d.name),
    startedAt: typeof d.startedAt === 'number' ? d.startedAt : undefined,
    procStart: d.procStart,
    status: d.status,
    waitingFor: d.waitingFor,
    statusUpdatedAt: d.statusUpdatedAt,
  };
}

/**
 * Claude Code writes status 'waiting' (+ waitingFor) to its registry file while a dialog is up, 'busy' / 'idle' otherwise.
 * That is the only sign of a dialog answered "no" or dismissed: a deny or Esc ends the turn without Stop or PostToolUse,
 * which used to leave the session 'waiting' (and the office refusing prompts) until the next prompt typed in the terminal.
 * Headless sessions have no dialogs; their waits are the parked pendingPermissions. Returns true if `s` changed.
 */
export function syncWaiting(
  store: Store,
  s: Session,
  d: RegistryStatus,
  now = Date.now(),
) {
  if (!traitsOf(s).terminalDialogs || s.ended) return false;
  if (d.status === 'waiting') {
    const label =
      typeof d.waitingFor === 'string' ? d.waitingFor.slice(0, 80) : null;
    if (s.state === 'waiting' && s.asking && s.asking.label === label)
      return false;
    s.asking = {
      tool: null,
      target: null,
      detail: null,
      at: now,
      ...s.asking,
      label,
    };
    store.setState(s, 'waiting');
    return true;
  }
  if (s.state !== 'waiting' && !s.asking) return false;
  // only a status written after the wait began: until the dialog opens, the file still holds the turn's earlier 'busy'
  if (!(Number(d.statusUpdatedAt) > (s.asking?.at ?? s.stateSince)))
    return false;
  s.asking = null;
  s.currentTool = null;
  store.setState(s, d.status === 'busy' ? 'thinking' : 'idle');
  return true;
}

/**
 * Registry entries by session id, split into live processes and dead ones (a file left behind by a claude that was
 * killed, whose pid may now be someone else's); null when the registry dir can't be read. Only *.json is opened.
 */
function readEntries(): {
  live: Map<string, RegistryEntry>;
  dead: Set<string>;
} | null {
  let files: string[];
  try {
    files = fs.readdirSync(SESSIONS_DIR);
  } catch {
    return null;
  }
  const live = new Map<string, RegistryEntry>();
  const dead = new Set<string>();
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const d = toEntry(safeJsonParse(readSafe(path.join(SESSIONS_DIR, f))));
    if (!d) continue;
    if (isProcessAlive(d.pid, d.procStart)) live.set(d.sessionId, d);
    else dead.add(d.sessionId);
  }
  return { live, dead };
}

/** State of a session no hook has reported on: straight from the registry status. */
const registryState = (status: unknown) =>
  status === 'waiting' ? 'waiting' : status === 'busy' ? 'working' : 'idle';

/** Fold one live registry entry into its session (creating it if hooks never reported it). Returns true if it changed. */
function syncEntry(store: Store, id: string, d: RegistryEntry, now: number) {
  const existed = store.sessions.get(id);
  const wasEnded = existed?.ended;
  const s = store.getOrCreateSession(id, {
    cwd: d.cwd,
    name: d.name,
    startedAt: d.startedAt,
    pid: d.pid,
  });
  return store.updateSession(s, () =>
    foldEntry(store, s, d, now, !existed || !!wasEnded),
  );
}

function foldEntry(
  store: Store,
  s: Session,
  d: RegistryEntry,
  now: number,
  isNew: boolean,
) {
  let changed = isNew;
  if (s.pid !== d.pid) {
    s.pid = d.pid;
    changed = true;
  }
  if (d.name && s.name !== d.name) {
    s.name = d.name;
    s.nameSource = 'registry';
    changed = true;
  }
  if (store.setCwd(s, d.cwd)) changed = true;
  if (d.startedAt && d.startedAt < s.startedAt) {
    s.startedAt = d.startedAt;
    changed = true;
  }
  if (!s.transcriptPath && d.cwd) {
    s.transcriptPath = transcriptPathOf(d.cwd, s.id);
  }
  // 'shell': the turn ended but a background shell will wake it. Works without our hooks too.
  const awaitingShell = d.status === 'shell';
  if (s.awaitingShell !== awaitingShell) {
    s.awaitingShell = awaitingShell;
    changed = true;
  }
  if (s.hookEvents === 0) {
    const want = registryState(d.status);
    if (s.state !== want) {
      store.setState(s, want);
      changed = true;
    }
  } else if (syncWaiting(store, s, d, now)) {
    changed = true;
  } else if (
    d.status === 'idle' &&
    isBusyState(s.state) &&
    now - s.stateSince > STALE_TOOL_MS
  ) {
    store.setState(s, 'idle');
    s.currentTool = null;
    changed = true;
  }
  return changed;
}

/**
 * Poll ~/.claude/sessions/<pid>.json. Creates sessions that hooks never reported
 * (started before hooks were installed), fills pid/name/cwd, and marks sessions
 * whose process is gone as off-duty. Only *.json is read; *.key files are never opened.
 */
export function pollRegistry(store: Store) {
  const entries = readEntries();
  if (!entries) return;
  const { live, dead } = entries;
  const now = Date.now();
  for (const [id, d] of live) syncEntry(store, id, d, now);

  for (const s of store.sessions.values()) {
    if (s.ended || !s.pid || live.has(s.id)) continue;
    // its own file says the process is gone, even when the pid now names another one
    if (dead.has(s.id) || !isPidAlive(s.pid)) {
      store.updateSession(s, () => store.endSession(s, 'process exited'));
    }
  }
}
