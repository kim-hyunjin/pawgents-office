import { summarizeToolInput, detailForTool, truncate, cleanText, replyText, oneLine } from './util.ts';
import { scheduleFileSync } from './files.ts';
import type { Store } from './store.ts';
import type { Asking, EntityState, HookEvent, Session, ToolInput } from './types.ts';

const TOOL_STATE: [RegExp, EntityState][] = [
  [/^(Read|Grep|Glob|LS)$/, 'reading'],
  [/^(Edit|Write|MultiEdit|NotebookEdit)$/, 'coding'],
  [/^Bash$/, 'terminal'],
  [/^(WebFetch|WebSearch)$/, 'searching'],
  [/^(Agent|Task)$/, 'delegating'],
  [/^AskUserQuestion$/, 'waiting'],
];
const EDIT_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit)$/;
const FILE_TOOLS = /^(Read|Edit|Write|MultiEdit|NotebookEdit)$/;
/** Remember the file a Read/Edit/Write… call names (the panel's "worked files", and what /diff may show). */
function touchFile(store: Store, s: Session, tool: string, input?: ToolInput) {
  const fp = FILE_TOOLS.test(tool) && input ? input.file_path || input.notebook_path : null;
  if (typeof fp === 'string' && fp) store.touchFile(s, fp, { edited: EDIT_TOOLS.test(tool) });
}
/**
 * Remember what an interactive session's terminal dialog asks, so the office can show it (it is answered in the terminal).
 * Headless sessions park their requests as pendingPermissions cards instead. Cleared by the asked call's PostToolUse,
 * the next prompt, Stop, or the registry reporting the dialog gone (a deny / Esc fires no hook: see syncWaiting).
 */
function ask(s: Session, { tool, target, detail, at }: { tool: string; target: string; detail?: string | null; at: number }) {
  if (s.backend === 'headless') return;
  s.asking = { tool, target, detail: detail || null, label: s.asking?.label ?? null, at };
}
function stateForTool(tool: string): EntityState {
  for (const [re, st] of TOOL_STATE) if (re.test(tool)) return st;
  return 'working';
}

/**
 * Apply one Claude Code hook payload to the store. Never throws.
 * Returns the affected session (or null).
 */
export function applyHook(store: Store, ev: HookEvent | null | undefined): Session | null {
  try { return apply(store, ev); }
  catch (e) { console.error('[reducer]', e); return null; }
}

function apply(store: Store, ev: HookEvent | null | undefined): Session | null {
  if (!ev || typeof ev !== 'object') return null;
  const name = String(ev.hook_event_name || '');
  const sid = ev.session_id;
  if (!sid || !name) return null;
  delete ev.tool_response;

  const now = Date.now();
  const s = store.getOrCreateSession(sid, { cwd: ev.cwd, transcriptPath: ev.transcript_path });
  s.hookEvents++;
  s.lastEventAt = now;
  if (ev.permission_mode) s.permissionMode = ev.permission_mode;
  // a headless session inherits no terminal; a stray handle (server started inside Orca) must not bind it to one
  if (typeof ev.orca_terminal === 'string' && ev.orca_terminal && s.backend !== 'headless') store.setTerminal(s, ev.orca_terminal);

  const agentId = ev.agent_id ? String(ev.agent_id) : null;
  const agent = agentId ? store.getOrCreateSubagent(s, agentId, { type: ev.agent_type }) : null;
  if (agent) agent.lastEventAt = now;
  const ent = agent || s;
  const who = agent ? `[${agent.type || 'agent'}] ` : '';

  switch (name) {
    case 'SessionStart': {
      if (ev.model) s.model = ev.model;
      if (ev.session_title) s.title = oneLine(ev.session_title);
      if (!agent) store.setState(s, 'idle');
      store.log(s, { ev: name, text: ev.source || '' });
      break;
    }
    case 'UserPromptSubmit': {
      const prompt = cleanText(ev.prompt || '', 400);
      if (!agent) { s.asking = null; store.setState(s, 'thinking'); s.bgTasks = []; s.lastPrompt = prompt; s.turnStartedAt = now; s.turnTools = 0; }
      if (ev.session_title) s.title = oneLine(ev.session_title);
      store.log(s, { ev: name, text: prompt });
      break;
    }
    case 'PreToolUse': {
      const tool = String(ev.tool_name || '');
      const target = summarizeToolInput(tool, ev.tool_input);
      const detail = detailForTool(tool, ev.tool_input);
      ent.currentTool = { name: tool, target, detail, startedAt: now, toolUseId: ev.tool_use_id || null };
      if (agent) agent.toolCount++; else s.turnTools++;
      touchFile(store, s, tool, ev.tool_input); // subagents' files count as the session's
      if (!agent && /^(Agent|Task)$/.test(tool) && ev.tool_input) {
        const inp = ev.tool_input;
        s.pendingAgents.push({ type: inp.subagent_type || null, description: oneLine(inp.description || ''), task: cleanText(inp.prompt || '', 600), toolUseId: ev.tool_use_id || null, at: now });
        if (s.pendingAgents.length > 20) s.pendingAgents.shift();
      }
      if (!agent && tool === 'AskUserQuestion') ask(s, { tool, target, detail, at: now });
      store.setState(ent, stateForTool(tool));
      store.log(s, { ev: name, tool, target, detail, text: who });
      break;
    }
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      const tool = String(ev.tool_name || '');
      const target = summarizeToolInput(tool, ev.tool_input);
      ent.currentTool = null;
      if (s.asking?.tool === tool && s.asking.target === target) s.asking = null; // the asked call ran (or failed): answered
      if (ent.state !== 'offduty') store.setState(ent, 'thinking');
      touchFile(store, s, tool, ev.tool_input); // again now that the file is written: an open diff dialog reloads on the new time
      if (EDIT_TOOLS.test(tool) || tool === 'Bash') scheduleFileSync(store, s); // git status catches what the shell changed
      const err = name === 'PostToolUseFailure' ? truncate(oneLine(ev.error || 'failed'), 200) : '';
      const result = typeof ev.tool_response_head === 'string' ? truncate(oneLine(ev.tool_response_head), 240) : '';
      store.log(s, { ev: name, tool, target, text: who + err, result, ms: ev.duration_ms, len: ev.tool_response_len });
      break;
    }
    case 'PermissionRequest': {
      const tool = String(ev.tool_name || '');
      const target = summarizeToolInput(tool, ev.tool_input);
      ask(s, { tool, target, detail: detailForTool(tool, ev.tool_input), at: now });
      store.setState(s, 'waiting');
      // headless sessions get each request twice (the plugin's async hook + our --decide one): log it once
      const [last] = s.log.last(1);
      if (!(last?.ev === name && last.tool === tool && last.target === target && last.text === 'permission' && now - last.t < 2000)) store.log(s, { ev: name, tool, target, text: 'permission' });
      break;
    }
    case 'Notification': {
      const kind = String(ev.notification_type || '');
      if (kind === 'permission_prompt' || kind === 'elicitation_dialog') store.setState(s, 'waiting');
      else if (kind === 'idle_prompt') store.setState(s, 'idle');
      store.log(s, { ev: name, text: truncate(oneLine(`${kind} ${ev.message || ''}`), 160) });
      break;
    }
    case 'Stop': {
      const text = cleanText(ev.last_assistant_message || '', 280);
      ent.currentTool = null;
      if (!agent) s.asking = null;
      store.setState(ent, 'idle');
      if (!agent && Array.isArray(ev.background_tasks)) s.bgTasks = ev.background_tasks.map((t) => ({
        type: String(t.type || ''), description: oneLine(t.description || ''), command: oneLine(t.command || ''),
      }));
      if (text) { ent.lastText = text; ent.lastTextAt = now; ent.replyText = replyText(ev.last_assistant_message); }
      store.log(s, { ev: name, text: who + truncate(text, 200) });
      if (!agent) scheduleFileSync(store, s);
      break;
    }
    case 'SubagentStart': {
      if (agent) {
        store.setState(agent, 'thinking');
        // Attach the Agent tool call that most likely spawned this subagent (same type, oldest first).
        let idx = s.pendingAgents.findIndex((p) => !p.type || !agent.type || p.type === agent.type);
        if (idx < 0 && s.pendingAgents.length) idx = 0;
        if (idx >= 0) {
          const p = s.pendingAgents.splice(idx, 1)[0];
          if (!agent.description) agent.description = p.description || null;
          agent.task = p.task || null;
          agent.toolUseId = p.toolUseId;
        }
      }
      store.log(s, { ev: name, text: `${agent?.type || ''} ${agentId || ''}`.trim() });
      break;
    }
    case 'SubagentStop': {
      if (agent) {
        const text = cleanText(ev.last_assistant_message || '', 280);
        if (text) { agent.lastText = text; agent.lastTextAt = now; agent.replyText = replyText(ev.last_assistant_message); }
        if (ev.agent_transcript_path) agent.transcriptPath = ev.agent_transcript_path;
        store.endSubagent(agent);
      }
      const live = [...s.subagents.values()].some((a) => !a.ended);
      if (!live && s.state === 'delegating') store.setState(s, 'thinking');
      store.log(s, { ev: name, text: `${agent?.type || ''} ${agentId || ''}`.trim() });
      break;
    }
    case 'SessionEnd': {
      if (!agent) store.endSession(s, ev.reason || 'ended');
      break;
    }
    case 'PreModelSwitch':
    case 'PostModelSwitch': {
      if (ev.to_model) s.model = String(ev.to_model);
      store.log(s, { ev: name, text: `${ev.from_model || ''} → ${ev.to_model || ''}` });
      break;
    }
    default: {
      store.log(s, { ev: name, text: truncate(oneLine(ev.message || ev.reason || ev.trigger || ''), 120) });
    }
  }
  // a dialog stays up while parallel tool calls start and finish: their events must not hide it
  if (s.asking && !s.ended) store.setState(s, 'waiting');
  store.emitSession(s);
  return s;
}
