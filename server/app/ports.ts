// What the application needs from the outside, as interfaces. The backends (server/backends/) implement Backend;
// routes and main only ever talk to them through it (and the registry in server/backends/index.ts).
import type {
  Backend as BackendId,
  EntityState,
  WorktreeInfo,
} from '../../shared/api.ts';
import type { DecisionReply, HookEvent } from '../../shared/hook.ts';
import type { Session } from '../types.ts';

export type { BackendId };

/** Can this backend run sessions here? Sent as is in GET /backends (shared/api.ts ProbeInfo). */
export type ProbeResult =
  | { available: true; version?: string; bin?: string }
  | { available: false; reason: string };

/** A `--decide` hook's PermissionRequest held for the browser's answer. */
export interface ParkedPermission {
  /** The hook's reply: a decision, or {} when there is none (no answer in time: claude denies). */
  reply: Promise<DecisionReply>;
  /** The hook went away: drop the request quietly. */
  cancel(): void;
}

/** How sessions are run (claude in an Orca terminal, or headless behind a runner). Failures are codedError()s. */
export interface Backend {
  readonly id: BackendId;
  /** Usable here (CLI installed, app reachable)? Cached for a while by the backend. */
  probe(): Promise<ProbeResult>;
  /** `s` is this backend's to drive (every session has exactly one owner). */
  owns(s: Session): boolean;
  /** Throws a 'detached' error when the backend can't act on `s` right now (a headless runner not connected). */
  ensureAttached(s: Session): void;
  /** A prompt sent while `s` is in `state` lands as a prompt (Orca: a dialog would take its Enter as the answer). */
  canPromptWhile(state: EntityState): boolean;
  sendPrompt(s: Session, text: string): Promise<{ accepted?: boolean }>;
  /** End `s`: politely (`/exit`, stdin closed) or, with force, right now. */
  close(s: Session, o: { force: boolean }): Promise<unknown>;
  /** Switch the permission mode; `s.permissionMode` holds the new mode once it resolves. */
  setMode(s: Session, mode: string): Promise<unknown>;
  /**
   * The browser's allow / deny for request `id` (a pendingPermissions id, or the `asking.at` of a terminal dialog).
   * Resolves with how the server log names the request; a request already settled or changed throws 'stale'.
   */
  answerPermission(s: Session, id: string, allow: boolean): Promise<string>;
  /** Hold a `--decide` hook's request until the browser answers; null when `s` takes no such requests here. */
  parkPermission(s: Session, ev: HookEvent): ParkedPermission | null;
  /** Worktrees the launcher offers for this backend. */
  listWorktrees(): Promise<WorktreeInfo[]>;
  /** Boot: reattach to sessions that outlived the previous server; how many came back. */
  restore?(): Promise<number>;
  /** Server exit: let go of connections (sessions keep running). */
  shutdown?(): void;
}

/** The server's activity log: one line per thing done (`[web] …`, `[hook] …`). The console, unless a test listens. */
export interface Logger {
  info(line: string): void;
}
