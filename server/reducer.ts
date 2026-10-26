// Hook payloads → store changes. No I/O: what a hook asks of the outside world (a git status) comes back as effects.

import { cleanText, oneLine, truncate } from '../shared/text.ts';
import { replyText } from './domain/text.ts';
import { detailForTool, summarizeToolInput } from './domain/tools.ts';
import type { Store } from './store.ts';
import { traitsOf } from './traits.ts';
import type {
  Entity,
  EntityState,
  HookEvent,
  Session,
  Subagent,
  ToolInput,
} from './types.ts';

const EDIT_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit)$/;
const FILE_TOOLS = /^(Read|Edit|Write|MultiEdit|NotebookEdit)$/;
const AGENT_TOOLS = /^(Agent|Task)$/;
const TOOL_STATE: [RegExp, EntityState][] = [
  [/^(Read|Grep|Glob|LS)$/, 'reading'],
  [EDIT_TOOLS, 'coding'],
  [/^Bash$/, 'terminal'],
  [/^(WebFetch|WebSearch)$/, 'searching'],
  [AGENT_TOOLS, 'delegating'],
  [/^AskUserQuestion$/, 'waiting'],
];
const MAX_PENDING_AGENTS = 20;
/** Remember the file a Read/Edit/Write… call names (the panel's "worked files", and what /diff may show). */
function touchFile(store: Store, s: Session, tool: string, input?: ToolInput) {
  const fp =
    FILE_TOOLS.test(tool) && input
      ? input.file_path || input.notebook_path
      : null;
  if (typeof fp === 'string' && fp)
    store.touchFile(s, fp, { edited: EDIT_TOOLS.test(tool) });
}
/**
 * Remember what an interactive session's terminal dialog asks, so the office can show it (it is answered in the terminal).
 * Headless sessions park their requests as pendingPermissions cards instead. Cleared by the asked call's PostToolUse,
 * the next prompt, Stop, or the registry reporting the dialog gone (a deny / Esc fires no hook: see syncWaiting).
 */
function ask(
  s: Session,
  {
    tool,
    target,
    detail,
    at,
  }: { tool: string; target: string; detail?: string | null; at: number },
) {
  if (!traitsOf(s).terminalDialogs) return;
  s.asking = {
    tool,
    target,
    detail: detail || null,
    label: s.asking?.label ?? null,
    at,
  };
}
function stateForTool(tool: string): EntityState {
  for (const [re, st] of TOOL_STATE) if (re.test(tool)) return st;
  return 'working';
}

/** The tool an event is about, and its short target (file name, command head…). */
function toolOf(ev: HookEvent) {
  const tool = String(ev.tool_name || '');
  return { tool, target: summarizeToolInput(tool, ev.tool_input) };
}

/** Keep the final assistant message of a Stop / SubagentStop: a bubble-sized line plus the full markdown. */
function recordReply(ent: Entity, message: unknown, now: number) {
  const text = cleanText(message || '', 280);
  if (text) {
    ent.lastText = text;
    ent.lastTextAt = now;
    ent.replyText = replyText(message);
  }
  return text;
}

/** `type agentId` for the SubagentStart / SubagentStop log line. */
const agentLabel = (agent: Subagent | null, agentId: string | null) =>
  `${agent?.type || ''} ${agentId || ''}`.trim();

/** Fill a new subagent in from the Agent tool call that most likely spawned it (same type, oldest first). */
function claimPendingAgent(s: Session, agent: Subagent) {
  let idx = s.pendingAgents.findIndex(
    (p) => !p.type || !agent.type || p.type === agent.type,
  );
  if (idx < 0 && s.pendingAgents.length) idx = 0;
  if (idx < 0) return;
  const [p] = s.pendingAgents.splice(idx, 1);
  if (!p) return;
  if (!agent.description) agent.description = p.description || null;
  agent.task = p.task || null;
  agent.toolUseId = p.toolUseId;
}

/** Headless sessions get each request twice (the plugin's async hook + our --decide one): true for the second copy. */
function isRepeatedPermission(
  s: Session,
  tool: string,
  target: string,
  now: number,
) {
  const [last] = s.log.last(1);
  return (
    last?.ev === 'PermissionRequest' &&
    last.tool === tool &&
    last.target === target &&
    last.text === 'permission' &&
    now - last.t < 2000
  );
}

/** What a hook asks of the outside world once the store is updated; the caller runs them (app/sessions.ts). */
export type HookEffect = { type: 'syncFiles' }; // git status of the session's worktree, soon
export interface HookOutcome {
  session: Session;
  effects: HookEffect[];
}

/**
 * Apply one Claude Code hook payload to the store. Never throws. Returns the affected session and the effects
 * it asks for (or null).
 */
export function reduceHook(
  store: Store,
  ev: HookEvent | null | undefined,
): HookOutcome | null {
  try {
    return apply(store, ev);
  } catch (e) {
    console.error('[reducer]', e);
    return null;
  }
}

/** reduceHook, for callers that only want the store updated: the effects are dropped. Returns the session. */
export const applyHook = (
  store: Store,
  ev: HookEvent | null | undefined,
): Session | null => reduceHook(store, ev)?.session ?? null;

function apply(
  store: Store,
  ev: HookEvent | null | undefined,
): HookOutcome | null {
  if (!ev || typeof ev !== 'object') return null;
  const name = String(ev.hook_event_name || '');
  const sid = ev.session_id;
  if (!sid || !name) return null;
  delete ev.tool_response;

  const s = store.getOrCreateSession(sid, {
    cwd: ev.cwd,
    transcriptPath: ev.transcript_path,
  });
  const effects: HookEffect[] = [];
  store.updateSession(s, () => reduce(store, s, ev, name, effects));
  return { session: s, effects };
}

/** One hook, as its handler sees it. `ent` is the subagent the event is about, or the session itself. */
interface HookCtx {
  store: Store;
  s: Session;
  ev: HookEvent;
  name: string;
  now: number;
  agentId: string | null;
  agent: Subagent | null;
  ent: Entity;
  /** `[type] ` for a subagent's event, in front of log texts. */
  who: string;
  effects: HookEffect[];
}
type Handler = (c: HookCtx) => void;

const postToolUse: Handler = ({ store, s, ev, name, ent, who, effects }) => {
  const { tool, target } = toolOf(ev);
  ent.currentTool = null;
  if (s.asking?.tool === tool && s.asking.target === target) s.asking = null; // the asked call ran (or failed): answered
  if (ent.state !== 'offduty') store.setState(ent, 'thinking');
  touchFile(store, s, tool, ev.tool_input); // again now that the file is written: an open diff dialog reloads on the new time
  if (EDIT_TOOLS.test(tool) || tool === 'Bash')
    effects.push({ type: 'syncFiles' }); // git status catches what the shell changed
  const err =
    name === 'PostToolUseFailure'
      ? truncate(oneLine(ev.error || 'failed'), 200)
      : '';
  const result =
    typeof ev.tool_response_head === 'string'
      ? truncate(oneLine(ev.tool_response_head), 240)
      : '';
  store.log(s, {
    ev: name,
    tool,
    target,
    text: who + err,
    result,
    ms: ev.duration_ms,
    len: ev.tool_response_len,
  });
};

const modelSwitch: Handler = ({ store, s, ev, name }) => {
  if (ev.to_model) s.model = String(ev.to_model);
  store.log(s, {
    ev: name,
    text: `${ev.from_model || ''} → ${ev.to_model || ''}`,
  });
};

/** Events without a handler of their own: just a log line. */
const other: Handler = ({ store, s, ev, name }) => {
  store.log(s, {
    ev: name,
    text: truncate(oneLine(ev.message || ev.reason || ev.trigger || ''), 120),
  });
};

const HANDLERS: Record<string, Handler> = {
  SessionStart({ store, s, ev, name, agent }) {
    if (ev.model) s.model = ev.model;
    if (ev.session_title) s.title = oneLine(ev.session_title);
    if (!agent) store.setState(s, 'idle');
    store.log(s, { ev: name, text: ev.source || '' });
  },
  UserPromptSubmit({ store, s, ev, name, now, agent }) {
    const prompt = cleanText(ev.prompt || '', 400);
    if (!agent) {
      s.asking = null;
      store.setState(s, 'thinking');
      s.bgTasks = [];
      s.lastPrompt = prompt;
      s.turnStartedAt = now;
      s.turnTools = 0;
    }
    if (ev.session_title) s.title = oneLine(ev.session_title);
    store.log(s, { ev: name, text: prompt });
  },
  PreToolUse({ store, s, ev, name, now, agent, ent, who }) {
    const { tool, target } = toolOf(ev);
    const detail = detailForTool(tool, ev.tool_input);
    ent.currentTool = {
      name: tool,
      target,
      detail,
      startedAt: now,
      toolUseId: ev.tool_use_id || null,
    };
    if (agent) agent.toolCount++;
    else s.turnTools++;
    touchFile(store, s, tool, ev.tool_input); // subagents' files count as the session's
    if (!agent && AGENT_TOOLS.test(tool) && ev.tool_input) {
      const inp = ev.tool_input;
      s.pendingAgents.push({
        type:
          typeof inp.subagent_type === 'string'
            ? inp.subagent_type || null
            : null,
        description: oneLine(inp.description || ''),
        task: cleanText(inp.prompt || '', 600),
        toolUseId: ev.tool_use_id || null,
        at: now,
      });
      if (s.pendingAgents.length > MAX_PENDING_AGENTS) s.pendingAgents.shift();
    }
    if (!agent && tool === 'AskUserQuestion')
      ask(s, { tool, target, detail, at: now });
    store.setState(ent, stateForTool(tool));
    store.log(s, { ev: name, tool, target, detail, text: who });
  },
  PostToolUse: postToolUse,
  PostToolUseFailure: postToolUse,
  PermissionRequest({ store, s, ev, name, now }) {
    const { tool, target } = toolOf(ev);
    ask(s, {
      tool,
      target,
      detail: detailForTool(tool, ev.tool_input),
      at: now,
    });
    store.setState(s, 'waiting');
    if (!isRepeatedPermission(s, tool, target, now))
      store.log(s, { ev: name, tool, target, text: 'permission' });
  },
  Notification({ store, s, ev, name }) {
    const kind = String(ev.notification_type || '');
    if (kind === 'permission_prompt' || kind === 'elicitation_dialog')
      store.setState(s, 'waiting');
    else if (kind === 'idle_prompt') store.setState(s, 'idle');
    store.log(s, {
      ev: name,
      text: truncate(oneLine(`${kind} ${ev.message || ''}`), 160),
    });
  },
  Stop({ store, s, ev, name, now, agent, ent, who, effects }) {
    ent.currentTool = null;
    if (!agent) s.asking = null;
    store.setState(ent, 'idle');
    if (!agent && Array.isArray(ev.background_tasks))
      s.bgTasks = ev.background_tasks.map((t) => ({
        type: String(t.type || ''),
        description: oneLine(t.description || ''),
        command: oneLine(t.command || ''),
      }));
    const text = recordReply(ent, ev.last_assistant_message, now);
    store.log(s, { ev: name, text: who + truncate(text, 200) });
    if (!agent) effects.push({ type: 'syncFiles' });
  },
  SubagentStart({ store, s, name, agent, agentId }) {
    if (agent) {
      store.setState(agent, 'thinking');
      claimPendingAgent(s, agent);
    }
    store.log(s, { ev: name, text: agentLabel(agent, agentId) });
  },
  SubagentStop({ store, s, ev, name, now, agent, agentId }) {
    if (agent) {
      recordReply(agent, ev.last_assistant_message, now);
      if (ev.agent_transcript_path)
        agent.transcriptPath = ev.agent_transcript_path;
      store.endSubagent(agent);
    }
    const live = [...s.subagents.values()].some((a) => !a.ended);
    if (!live && s.state === 'delegating') store.setState(s, 'thinking');
    store.log(s, { ev: name, text: agentLabel(agent, agentId) });
  },
  SessionEnd({ store, s, ev, agent }) {
    if (!agent) store.endSession(s, ev.reason || 'ended');
  },
  PreModelSwitch: modelSwitch,
  PostModelSwitch: modelSwitch,
};

/** Fold hook `ev` (named `name`) into session `s`; what must happen outside the store goes to `effects`. */
function reduce(
  store: Store,
  s: Session,
  ev: HookEvent,
  name: string,
  effects: HookEffect[],
) {
  const now = Date.now();
  s.hookEvents++;
  s.lastEventAt = now;
  if (ev.permission_mode) s.permissionMode = ev.permission_mode;
  // a headless session inherits no terminal; a stray handle (server started inside Orca) must not bind it to one
  if (
    typeof ev.orca_terminal === 'string' &&
    ev.orca_terminal &&
    traitsOf(s).bindsTerminal
  )
    store.bindTerminal(s, ev.orca_terminal);

  const agentId = ev.agent_id ? String(ev.agent_id) : null;
  const agent = agentId
    ? store.getOrCreateSubagent(s, agentId, { type: ev.agent_type })
    : null;
  if (agent) agent.lastEventAt = now;
  const ent = agent || s;
  const who = agent ? `[${agent.type || 'agent'}] ` : '';

  const handler =
    (Object.hasOwn(HANDLERS, name) ? HANDLERS[name] : undefined) ?? other;
  handler({ store, s, ev, name, now, agentId, agent, ent, who, effects });
  // a dialog stays up while parallel tool calls start and finish: their events must not hide it
  if (s.asking && !s.ended) store.setState(s, 'waiting');
}
