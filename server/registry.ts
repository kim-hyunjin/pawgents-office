import fs from 'node:fs';
import path from 'node:path';
import { safeJsonParse } from '../shared/json.ts';
import { isBusyState } from '../shared/model.ts';
import { isPidAlive } from '../shared/node/process.ts';
import { PROJECTS_DIR, SESSIONS_DIR, STALE_TOOL_MS } from './config.ts';
import type { Store } from './store.ts';
import type { Session } from './types.ts';
import { projectDirName, readSafe } from './util.ts';

/** One ~/.claude/sessions/<pid>.json: dynamic JSON written by Claude Code. */
type RegistryEntry = Record<string, any>;

/**
 * Claude Code writes status 'waiting' (+ waitingFor) to its registry file while a dialog is up, 'busy' / 'idle' otherwise.
 * That is the only sign of a dialog answered "no" or dismissed: a deny or Esc ends the turn without Stop or PostToolUse,
 * which used to leave the session 'waiting' (and the office refusing prompts) until the next prompt typed in the terminal.
 * Headless sessions have no dialogs; their waits are the parked pendingPermissions. Returns true if `s` changed.
 */
export function syncWaiting(
  store: Store,
  s: Session,
  d: RegistryEntry,
  now = Date.now(),
) {
  if (s.backend === 'headless' || s.ended) return false;
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

/** Registry entries of live processes, by session id; null when the registry dir can't be read. Only *.json is opened. */
function readLiveEntries(): Map<string, RegistryEntry> | null {
  let files: string[];
  try {
    files = fs.readdirSync(SESSIONS_DIR);
  } catch {
    return null;
  }
  const live = new Map<string, RegistryEntry>();
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const d = safeJsonParse(readSafe(path.join(SESSIONS_DIR, f)));
    if (!d || !d.sessionId || !d.pid) continue;
    if (!isPidAlive(d.pid)) continue;
    live.set(String(d.sessionId), d);
  }
  return live;
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
  let changed = !existed || !!wasEnded;
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
    s.transcriptPath = path.join(
      PROJECTS_DIR,
      projectDirName(d.cwd),
      `${id}.jsonl`,
    );
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
  if (changed) store.emitSession(s);
  return changed;
}

/**
 * Poll ~/.claude/sessions/<pid>.json. Creates sessions that hooks never reported
 * (started before hooks were installed), fills pid/name/cwd, and marks sessions
 * whose process is gone as off-duty. Only *.json is read; *.key files are never opened.
 */
export function pollRegistry(store: Store) {
  const live = readLiveEntries();
  if (!live) return;
  const now = Date.now();
  for (const [id, d] of live) syncEntry(store, id, d, now);

  for (const s of store.sessions.values()) {
    if (s.ended || !s.pid) continue;
    if (!live.has(s.id) && !isPidAlive(s.pid)) {
      store.endSession(s, 'process exited');
      store.emitSession(s);
    }
  }
}
