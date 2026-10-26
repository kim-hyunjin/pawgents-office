// Keeps each session's worked-file list in step with `git status` of its worktree, so the list survives a server
// restart and includes files changed from a shell or by hand. Hook events still add the files a session only read.

import { FILES_DEBOUNCE_MS } from './config.ts';
import { changedFiles } from './diff.ts';
import type { Store } from './store.ts';
import type { Session, SysError } from './types.ts';

interface Pending {
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  again: boolean;
}
const pending = new Map<string, Pending>(); // session id -> { timer, running, again }

function pendingFor(sessionId: string): Pending {
  const p = pending.get(sessionId) || {
    timer: null,
    running: false,
    again: false,
  };
  pending.set(sessionId, p);
  return p;
}

/** Sync soon (debounced per session): called after edits, shell commands and when the panel opens. */
export function scheduleFileSync(store: Store, s: Session) {
  const p = pendingFor(s.id);
  if (p.running) {
    p.again = true;
    return;
  }
  if (p.timer) clearTimeout(p.timer);
  p.timer = setTimeout(() => {
    p.timer = null;
    syncFiles(store, s);
  }, FILES_DEBOUNCE_MS);
}

/** Run git status for the session's worktree and fold the result into its file list. Emits the session if it changed. */
export async function syncFiles(store: Store, s: Session) {
  const p = pendingFor(s.id);
  if (p.running) {
    p.again = true;
    return;
  }
  p.running = true;
  try {
    const list = await changedFiles(s.cwd);
    if (list && store.sessions.get(s.id) === s)
      store.updateSession(s, () => store.setGitFiles(s, list));
  } catch (err) {
    const e = err as SysError;
    if (e.code !== 'ENOENT') console.error('[files]', s.name, e.message); // no git at all: stay quiet
  } finally {
    p.running = false;
    if (p.again) {
      p.again = false;
      scheduleFileSync(store, s);
    } else if (!p.timer) pending.delete(s.id);
  }
}

/** Every live session, one after another (boot, and the periodic safety net for changes no hook announces). */
export async function syncAllFiles(store: Store) {
  for (const s of [...store.sessions.values()])
    if (!s.ended && s.cwd) await syncFiles(store, s);
}
