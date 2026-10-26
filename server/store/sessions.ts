// The live sessions (and their subagents) by id, how a change reaches the browser, and when old ones go away.
import {
  ORPHAN_SESSION_MS,
  SESSION_TTL_MS,
  SUBAGENT_STALE_MS,
  SUBAGENT_TTL_MS,
} from '../config.ts';
import {
  freeSeat,
  markEnded,
  newSubagent,
  type SubagentInit,
} from '../domain/session.ts';
import { serializeSession } from '../http/dto.ts';
import type { Backend, LogEntry, Session, Subagent } from '../types.ts';
import type { EventBus } from './events.ts';

export class SessionRepo {
  sessions: Map<string, Session>;
  events: EventBus;

  constructor({ events }: { events: EventBus }) {
    this.sessions = new Map();
    this.events = events;
  }

  /** Push `s` as it is now to every listener (SSE 'session'). */
  emit(s: Session) {
    this.events.emit('session', serializeSession(s));
  }
  /**
   * Change `s` in `fn`, then push it: unless `fn` returns false (nothing changed). An async `fn` pushes once it
   * resolves, and not at all when it rejects. Returns what `fn` returned.
   */
  update<T>(s: Session, fn: (s: Session) => T): T {
    const r = fn(s);
    if (r instanceof Promise)
      return r.then((v) => {
        if (v !== false) this.emit(s);
        return v;
      }) as T;
    if (r !== false) this.emit(s);
    return r;
  }

  end(s: Session, reason = 'ended') {
    if (s.ended) return;
    markEnded(s);
    s.pendingPermissions = []; // nobody can answer them now (the backend settles the parked hooks)
    s.asking = null;
    for (const a of s.subagents.values()) this.endSubagent(a);
    this.log(s, { ev: 'SessionEnd', text: reason });
  }

  getOrCreateSubagent(
    s: Session,
    agentId: string,
    init: SubagentInit = {},
  ): Subagent {
    let a = s.subagents.get(agentId);
    if (a) {
      if (init.type && !a.type) a.type = init.type;
      return a;
    }
    a = newSubagent(s, agentId, init, freeSeat(s));
    s.subagents.set(agentId, a);
    return a;
  }
  endSubagent(a: Subagent) {
    if (a.ended) return;
    markEnded(a);
  }

  log(s: Session, entry: Omit<LogEntry, 't'>) {
    s.log.push({ t: Date.now(), ...entry });
  }

  /** Who drives the session (kept across revive: a runner outlives a server restart). */
  setBackend(s: Session, backend: Backend | null) {
    if (s.backend === backend) return false;
    s.backend = backend;
    return true;
  }

  /** Clock out what went quiet, drop what ended long enough ago (`released`: a session gone for good). */
  gc(released: (sessionId: string) => void) {
    const now = Date.now();
    for (const s of this.sessions.values()) {
      let changed = false;
      for (const a of s.subagents.values()) {
        if (!a.ended && now - a.lastEventAt > SUBAGENT_STALE_MS) {
          this.endSubagent(a);
          changed = true;
        }
        if (a.ended && now - a.endedAt! > SUBAGENT_TTL_MS) {
          s.subagents.delete(a.agentId);
          changed = true;
        }
      }
      if (!s.ended && !s.pid && now - s.lastEventAt > ORPHAN_SESSION_MS) {
        this.end(s, 'no events for 30 min');
        changed = true;
      }
      if (s.ended && now - s.endedAt! > SESSION_TTL_MS) {
        this.sessions.delete(s.id);
        released(s.id);
        this.events.emit('remove', { id: s.id });
        continue;
      }
      if (changed) this.emit(s);
    }
  }
}
