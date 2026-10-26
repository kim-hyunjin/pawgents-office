// The server's models as the browser sees them (shared/api.ts): SSE payloads and GET /state.
import { SEATS_PER_DESK, SNAPSHOT_FILES, SNAPSHOT_LOG } from '../config.ts';
import type {
  Office,
  Session,
  SessionSnapshot,
  Skin,
  Snapshot,
  Subagent,
  SubagentSnapshot,
} from '../types.ts';

export function serializeSubagent(a: Subagent): SubagentSnapshot {
  return {
    agentId: a.agentId,
    parentSessionId: a.parentSessionId,
    type: a.type,
    model: a.model,
    description: a.description,
    task: a.task,
    lastThinking: a.lastThinking,
    lastThinkingAt: a.lastThinkingAt,
    toolCount: a.toolCount,
    state: a.state,
    stateSince: a.stateSince,
    currentTool: a.currentTool,
    lastText: a.lastText,
    lastTextAt: a.lastTextAt,
    startedAt: a.startedAt,
    lastEventAt: a.lastEventAt,
    ended: a.ended,
    endedAt: a.endedAt,
    seat: a.seat,
  };
}

export function serializeSession(
  s: Session,
  logCount = SNAPSHOT_LOG,
): SessionSnapshot {
  return {
    id: s.id,
    pid: s.pid,
    name: s.name,
    title: s.title,
    cwd: s.cwd,
    model: s.model,
    state: s.state,
    stateSince: s.stateSince,
    currentTool: s.currentTool,
    lastText: s.lastText,
    lastTextAt: s.lastTextAt,
    lastPrompt: s.lastPrompt,
    lastThinking: s.lastThinking,
    lastThinkingAt: s.lastThinkingAt,
    turnStartedAt: s.turnStartedAt,
    turnTools: s.turnTools,
    cost: s.cost,
    startedAt: s.startedAt,
    lastEventAt: s.lastEventAt,
    ended: s.ended,
    endedAt: s.endedAt,
    officeId: s.officeId,
    desk: s.desk,
    permissionMode: s.permissionMode,
    hookEvents: s.hookEvents,
    orcaTerminal: s.orcaTerminal,
    backend: s.backend,
    pendingPermissions: s.pendingPermissions,
    asking: s.asking,
    bgTasks: s.bgTasks,
    awaitingShell: s.awaitingShell,
    subagents: [...s.subagents.values()].map(serializeSubagent),
    files: [...s.files.values()]
      .reverse()
      .slice(0, SNAPSHOT_FILES)
      .map(({ path: p, name, edited, git, t }) => ({
        path: p,
        name,
        edited,
        git,
        t,
      })), // newest first (see bumpFile)
    log: s.log.last(logCount),
  };
}

/** Everything the page needs at load (GET /state, the first SSE event). */
export function snapshot({
  offices,
  together,
  cats,
  skins,
  sessions,
}: {
  offices: Office[];
  together: string | null;
  cats: Record<string, string>;
  skins: Skin[];
  sessions: Iterable<Session>;
}): Snapshot {
  return {
    now: Date.now(),
    offices,
    together,
    seatsPerDesk: SEATS_PER_DESK,
    cats,
    skins,
    sessions: [...sessions].map((s) => serializeSession(s)),
  };
}
