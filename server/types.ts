// The server's own models. What the browser sees is in shared/api.ts; these extend it with what stays here.
import type { LogEntry, SessionInfo, SubagentInfo } from '../shared/api.ts';

export type {
  Asking,
  Backend,
  BgTask,
  Cost,
  CurrentTool,
  EntityState,
  FileSnapshot,
  LogEntry,
  Office,
  PendingPermission,
  SessionSnapshot,
  Skin,
  Snapshot,
  SubagentSnapshot,
} from '../shared/api.ts';
export type { HookEvent, ToolInput } from '../shared/hook.ts';

export interface PendingAgent {
  type: string | null;
  description: string;
  task: string;
  toolUseId: string | null;
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

export interface Subagent extends SubagentInfo {
  toolUseId: string | null;
  replyText: string | null;
  transcriptPath: string | null;
  metaRead?: boolean; // the .meta.json next to its transcript was read (transcript.ts)
}

/** Bounded activity log (see RingBuffer in domain/session.ts). */
export interface Log {
  push(x: LogEntry): void;
  toArray(): LogEntry[];
  last(k: number): LogEntry[];
}

export interface Session extends SessionInfo {
  nameSource: 'registry' | 'transcript' | null;
  replyText: string | null;
  pendingAgents: PendingAgent[];
  transcriptPath: string | null;
  log: Log;
  files: Map<string, FileEntry>;
  subagents: Map<string, Subagent>;
}

/** A session or subagent: what `setState`, `markEnded`… work on. */
export type Entity = Session | Subagent;

/** Where a session sits: remembered across restarts (state.json). */
export interface DeskMemory {
  desk: number;
  office?: string;
  at: number;
  terminal?: string;
}

/** A Node error with the fields child_process / fs add. */
export interface SysError extends Error {
  code?: string | number;
  stdout?: string;
}
