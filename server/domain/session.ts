// Sessions and subagents as plain data: how a new one looks, and the small state rules every caller shares.
// No store, no I/O: the store (server/store/) keeps them and tells the browser.
import path from 'node:path';
import { LOG_SIZE } from '../config.ts';
import type {
  Backend,
  Entity,
  EntityState,
  Log,
  LogEntry,
  Session,
  Subagent,
} from '../types.ts';

/** What a registry file / hook knows when a session is first seen. */
export interface SessionInit {
  pid?: number | null;
  name?: string;
  cwd?: string;
  model?: string | null;
  startedAt?: number;
  transcriptPath?: string | null;
  permissionMode?: string | null;
  backend?: Backend | null;
}
export interface SubagentInit {
  type?: string | null;
  model?: string | null;
  description?: string | null;
  task?: string | null;
  toolUseId?: string | null;
  transcriptPath?: string | null;
}

export class RingBuffer implements Log {
  n: number;
  buf: LogEntry[];
  constructor(n: number) {
    this.n = n;
    this.buf = [];
  }
  push(x: LogEntry) {
    this.buf.push(x);
    if (this.buf.length > this.n) this.buf.shift();
  }
  toArray() {
    return this.buf.slice();
  }
  last(k: number) {
    return this.buf.slice(-k);
  }
}

/** A session seen for the first time: idle, not placed yet (officeId / desk null). `terminal`: a remembered handle. */
export function newSession(
  id: string,
  init: SessionInit,
  terminal: string | null,
  now = Date.now(),
): Session {
  return {
    id,
    pid: init.pid ?? null,
    name: init.name || (init.cwd ? path.basename(init.cwd) : id.slice(0, 8)),
    nameSource: init.name ? 'registry' : null,
    title: null,
    cwd: init.cwd || '',
    model: init.model || null,
    state: 'idle',
    stateSince: now,
    currentTool: null,
    lastText: null,
    lastTextAt: 0,
    replyText: null, // full markdown of lastText, for the reply dialog
    lastPrompt: null,
    lastThinking: null,
    lastThinkingAt: 0,
    turnStartedAt: 0,
    turnTools: 0,
    cost: null, // { usd, linesAdded, linesRemoved, apiMs } from transcript
    pendingAgents: [], // Agent tool calls waiting for their SubagentStart
    bgTasks: [], // background work the idle session waits on, as of its last Stop
    awaitingShell: false, // registry status 'shell' (covers sessions without our hooks)
    startedAt: init.startedAt || now,
    lastEventAt: now,
    hookEvents: 0,
    ended: false,
    endedAt: null,
    officeId: null,
    desk: null,
    permissionMode: init.permissionMode ?? null,
    backend: init.backend ?? null, // 'headless' when a runner owns it; null: Orca or a terminal we don't control
    pendingPermissions: [], // headless permission requests parked for the browser (Step 5): [{ id, tool, target, detail, at }]
    asking: null, // interactive sessions: the dialog their terminal shows (answered there): { tool, target, detail, label, at }
    transcriptPath: init.transcriptPath || null,
    orcaTerminal: terminal, // Orca terminal handle (hook env or resolved) for sending prompts
    log: new RingBuffer(LOG_SIZE),
    files: new Map(), // normalized path -> { path, name, edited, touched, git, t }: files its tools touched (touched) and/or git status lists (git)
    subagents: new Map(),
  };
}

/** A subagent seen for the first time, sitting at `seat` of its parent's desk. */
export function newSubagent(
  parent: Session,
  agentId: string,
  init: SubagentInit,
  seat: number,
  now = Date.now(),
): Subagent {
  return {
    agentId,
    parentSessionId: parent.id,
    type: init.type || null,
    model: init.model || null,
    description: init.description || null,
    task: init.task || null, // prompt the parent gave this agent (head)
    toolUseId: init.toolUseId || null,
    lastThinking: null,
    lastThinkingAt: 0,
    toolCount: 0,
    state: 'thinking',
    stateSince: now,
    currentTool: null,
    lastText: null,
    lastTextAt: 0,
    replyText: null, // full markdown of lastText, for the reply dialog
    startedAt: now,
    lastEventAt: now,
    ended: false,
    endedAt: null,
    seat,
    transcriptPath: init.transcriptPath || null,
  };
}

/** Clock out a session or subagent (callers check `ended` first). */
export function markEnded(ent: Entity) {
  ent.ended = true;
  ent.endedAt = Date.now();
  ent.state = 'offduty';
  ent.stateSince = ent.endedAt;
  ent.currentTool = null;
}

/** Back to work after an end (its desk is assigned by the caller). */
export function markRevived(s: Session) {
  s.ended = false;
  s.endedAt = null;
  s.state = 'idle';
  s.stateSince = Date.now();
}

export function setState(ent: Entity, state: EntityState) {
  if (ent.state === state) return;
  ent.state = state;
  ent.stateSince = Date.now();
}

/** The lowest seat at `s`'s desk no live subagent holds; >= SEATS_PER_DESK overflows to the bullpen on the client. */
export function freeSeat(s: Session) {
  const used = new Set<number>();
  for (const a of s.subagents.values()) if (!a.ended) used.add(a.seat);
  let seat = 0;
  while (used.has(seat)) seat++;
  return seat;
}
