// Domain types shared by the server, the hooks and (type-only imports, erased when served) the browser.
import type { Layout } from '../web/layout.ts';

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
export interface PendingAgent {
  type: string | null;
  description: string;
  task: string;
  toolUseId: string | null;
  at: number;
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

/** A file a session's tools touched (`touched`) and/or git status lists (`git`: one status letter). */
export interface FileEntry {
  path: string;
  name: string;
  edited: boolean;
  touched: boolean;
  git: string | null;
  t: number;
}
export type FileSnapshot = Pick<
  FileEntry,
  'path' | 'name' | 'edited' | 'git' | 't'
>;

export interface Subagent {
  agentId: string;
  parentSessionId: string;
  type: string | null;
  model: string | null;
  description: string | null;
  task: string | null;
  toolUseId: string | null;
  lastThinking: string | null;
  lastThinkingAt: number;
  toolCount: number;
  state: EntityState;
  stateSince: number;
  currentTool: CurrentTool | null;
  lastText: string | null;
  lastTextAt: number;
  replyText: string | null;
  startedAt: number;
  lastEventAt: number;
  ended: boolean;
  endedAt: number | null;
  seat: number;
  transcriptPath: string | null;
  metaRead?: boolean; // the .meta.json next to its transcript was read (transcript.ts)
}

/** Bounded activity log (see RingBuffer in store.ts). */
export interface Log {
  push(x: LogEntry): void;
  toArray(): LogEntry[];
  last(k: number): LogEntry[];
}

export interface Session {
  id: string;
  pid: number | null;
  name: string;
  nameSource: 'registry' | 'transcript' | null;
  title: string | null;
  cwd: string;
  model: string | null;
  state: EntityState;
  stateSince: number;
  currentTool: CurrentTool | null;
  lastText: string | null;
  lastTextAt: number;
  replyText: string | null;
  lastPrompt: string | null;
  lastThinking: string | null;
  lastThinkingAt: number;
  turnStartedAt: number;
  turnTools: number;
  cost: Cost | null;
  pendingAgents: PendingAgent[];
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
  transcriptPath: string | null;
  orcaTerminal: string | null;
  log: Log;
  files: Map<string, FileEntry>;
  subagents: Map<string, Subagent>;
}

/** A session or subagent: what `setState`, `markEnded`… work on. */
export type Entity = Session | Subagent;

export type SubagentSnapshot = Omit<
  Subagent,
  'toolUseId' | 'replyText' | 'transcriptPath' | 'metaRead'
>;

/** A session as sent to the browser (serializeSession). */
export interface SessionSnapshot
  extends Omit<
    Session,
    | 'nameSource'
    | 'replyText'
    | 'pendingAgents'
    | 'transcriptPath'
    | 'log'
    | 'files'
    | 'subagents'
  > {
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
/** Where a session sits: remembered across restarts (state.json). */
export interface DeskMemory {
  desk: number;
  office?: string;
  at: number;
  terminal?: string;
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

/** A Claude Code hook payload (after hooks/send.ts shrank it). Only the fields the server reads are named. */
export interface HookEvent {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  transcript_path?: string;
  permission_mode?: string;
  orca_terminal?: string;
  agent_id?: string;
  agent_type?: string;
  agent_transcript_path?: string;
  tool_name?: string;
  tool_input?: Record<string, any>;
  tool_use_id?: string;
  tool_response_head?: string;
  tool_response_len?: number;
  duration_ms?: number;
  prompt?: string;
  message?: string;
  error?: string;
  reason?: string;
  trigger?: string;
  source?: string;
  model?: string;
  session_title?: string;
  notification_type?: string;
  last_assistant_message?: string;
  background_tasks?: {
    id?: string;
    type?: string;
    status?: string;
    description?: string;
    command?: string;
  }[];
  from_model?: string;
  to_model?: string;
  await_decision?: boolean;
  [key: string]: any;
}

/** A tool call's input as Claude Code sends it: dynamic JSON, shape depends on the tool. */
export type ToolInput = Record<string, any>;
/** A Node error with the fields child_process / fs add. */
export interface SysError extends Error {
  code?: string | number;
  stdout?: string;
}
