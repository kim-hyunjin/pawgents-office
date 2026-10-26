// The browser-facing API: what the server sends (snapshots, SSE events, JSON replies). Types only.
// The server's own models (server/types.ts) extend the *Info types with fields that never leave it.
import type { Layout } from './layout.ts';

export type EntityState =
  | 'idle'
  | 'thinking'
  | 'reading'
  | 'coding'
  | 'terminal'
  | 'searching'
  | 'delegating'
  | 'working'
  | 'waiting'
  | 'offduty';

export type Backend = 'headless' | 'orca';

export interface CurrentTool {
  name: string;
  target: string;
  detail: string | null;
  startedAt: number;
  toolUseId: string | null;
}

/** One line of a session's activity log (what the panel's feed shows). */
export interface LogEntry {
  t: number;
  ev: string;
  text?: string;
  tool?: string;
  target?: string;
  detail?: string | null;
  result?: string;
  ms?: number;
  len?: number;
}

export interface Cost {
  usd: number;
  linesAdded: number;
  linesRemoved: number;
  apiMs: number;
}
export interface BgTask {
  type: string;
  description: string;
  command: string;
}
export interface PendingPermission {
  id: string;
  tool: string;
  target: string;
  detail: string | null;
  at: number;
}
export interface Asking {
  tool: string | null;
  target: string | null;
  detail: string | null;
  label: string | null;
  at: number;
}

/** A worked file as the panel lists it (`git`: one status letter). */
export interface FileSnapshot {
  path: string;
  name: string;
  edited: boolean;
  git: string | null;
  t: number;
}

/** A subagent's public fields: exactly what a snapshot carries. */
export interface SubagentInfo {
  agentId: string;
  parentSessionId: string;
  type: string | null;
  model: string | null;
  description: string | null;
  task: string | null;
  lastThinking: string | null;
  lastThinkingAt: number;
  toolCount: number;
  state: EntityState;
  stateSince: number;
  currentTool: CurrentTool | null;
  lastText: string | null;
  lastTextAt: number;
  startedAt: number;
  lastEventAt: number;
  ended: boolean;
  endedAt: number | null;
  seat: number;
}
export type SubagentSnapshot = SubagentInfo;

/** A session's public fields; a snapshot adds its subagents, files and recent log as plain arrays. */
export interface SessionInfo {
  id: string;
  pid: number | null;
  name: string;
  title: string | null;
  cwd: string;
  model: string | null;
  state: EntityState;
  stateSince: number;
  currentTool: CurrentTool | null;
  lastText: string | null;
  lastTextAt: number;
  lastPrompt: string | null;
  lastThinking: string | null;
  lastThinkingAt: number;
  turnStartedAt: number;
  turnTools: number;
  cost: Cost | null;
  bgTasks: BgTask[];
  awaitingShell: boolean;
  startedAt: number;
  lastEventAt: number;
  hookEvents: number;
  ended: boolean;
  endedAt: number | null;
  officeId: string | null;
  desk: number | null;
  permissionMode: string | null;
  backend: Backend | null;
  pendingPermissions: PendingPermission[];
  asking: Asking | null;
  orcaTerminal: string | null;
}
export interface SessionSnapshot extends SessionInfo {
  subagents: SubagentSnapshot[];
  files: FileSnapshot[];
  log: LogEntry[];
}

export interface Office {
  id: string;
  name: string;
  repos: string[];
  layout: Layout;
}
export interface Skin {
  id: string;
  name: string;
  cellW: number;
  cellH: number;
}

export interface Snapshot {
  now: number;
  offices: Office[];
  together: string | null;
  seatsPerDesk: number;
  cats: Record<string, string>;
  skins: Skin[];
  sessions: SessionSnapshot[];
}

/** The /events stream: event name → its JSON payload. */
export interface ServerEvents {
  snapshot: Snapshot;
  session: SessionSnapshot;
  remove: { id: string };
  settings: { cats: Record<string, string>; skins: Skin[] };
  offices: { offices: Office[]; together: string | null };
}
export type ServerEventType = keyof ServerEvents;

// ---- JSON replies ----------------------------------------------------------

export interface ProbeInfo {
  available: boolean;
  reason?: string;
}
/** GET /backends */
export interface BackendsReply {
  orca: ProbeInfo;
  headless: ProbeInfo;
  default: Backend | null;
  forced: boolean;
}

/** A worktree the launcher offers: Orca's own list, or `git worktree list` for headless. */
export interface WorktreeInfo {
  id: string;
  repo: string;
  path: string;
  branch?: string;
  name?: string;
  head?: string;
  isMain?: boolean;
}
/** GET /worktrees */
export interface WorktreesReply {
  worktrees: WorktreeInfo[];
}

/** POST /launch */
export interface LaunchReply {
  ok: true;
  started: number;
  errors: string[];
  sessions: (string | undefined)[];
}

/** GET /sessions/:id/log */
export interface LogReply {
  id: string;
  log: LogEntry[];
}
/** GET /sessions/:id/reply */
export interface ReplyReply {
  id: string;
  agentId: string | null;
  text: string;
  at: number;
}

export type DiffStatus =
  | 'changed'
  | 'untracked'
  | 'committed'
  | 'clean'
  | 'missing';
/** GET /sessions/:id/diff */
export interface DiffReply {
  file: string;
  rel: string;
  status: DiffStatus;
  patch: string;
  truncated: boolean;
  commit?: { hash: string; subject: string };
}
