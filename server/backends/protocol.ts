// Wire formats for the headless backend, shared by the runner, the server and tests (pure: no I/O, no state).
// Server <-> runner speak NDJSON over a local socket; runner <-> claude speak claude's stream-json.
import path from 'node:path';
import { isRecord } from '../../shared/json.ts';
import { MODEL_RE, PERMISSION_MODES } from '../../shared/permission.ts';
import { MAX_PROMPT_CHARS, RUN_DIR } from '../config.ts';
import { isWindows } from '../infra/platform.ts';

/** A decoded JSON line (NDJSON, claude stream-json), shape not checked yet. */
export type Json = Record<string, unknown>;
export type FeedState = { rem: string; skipping: boolean };

/** Server -> runner command (what parseCommand lets through). */
export type ClientCmd =
  | { type: 'prompt'; text: string }
  | { type: 'mode'; mode: string }
  | { type: 'close' | 'kill' | 'status' };
export type CmdType = ClientCmd['type'];

/** The claude stream-json lines the office reads (parseClaudeLine). */
export type ClaudeEvent =
  | { kind: 'init'; model: string | null; sessionId: string | null }
  | { kind: 'denied'; tool: string | null }
  | { kind: 'mode'; mode: string }
  | {
      kind: 'control';
      requestId: string;
      ok: boolean;
      error: string | null;
      errorCode: string | null;
    }
  | {
      kind: 'result';
      isError: boolean;
      subtype: string | null;
      costUsd: number | null;
      denials: string[];
    };
/** What the runner broadcasts as an `event`: claude's events (control answers go to the asker as acks) and its stderr. */
export type RunnerEvent =
  | Exclude<ClaudeEvent, { kind: 'control' }>
  | { kind: 'stderr'; line: string };

export interface Exited {
  code: number | null;
  signal: string | null;
}
/** run/<sid>.json: how the server finds a runner (written once it listens). */
export interface RunInfo {
  sid: string;
  pid: number;
  claudePid: number | null;
  cwd: string;
  model: string | null;
  permissionMode: string | null;
  startedAt: number;
  pipe: string;
  version: string | null;
}
/** A parsed run file that names session `sid` (our own runner wrote it, so the rest of its shape follows). */
export const isRunInfoOf = (x: unknown, sid: string): x is RunInfo =>
  isRecord(x) && x.sid === sid;
export type HelloMsg = { type: 'hello' } & Omit<RunInfo, 'pipe' | 'version'> & {
    alive: boolean;
    exited: Exited | null;
    stderrTail?: string[];
    recent: RunnerEvent[];
  };
export type ExitMsg = { type: 'exit'; stderrTail: string[] } & Exited;
export interface AckMsg {
  type: 'ack';
  for: CmdType;
  ok: boolean;
  error?: string;
  code?: string;
}
/** Runner -> server message. */
export type RunnerMsg =
  | HelloMsg
  | ({ type: 'event' } & RunnerEvent)
  | ExitMsg
  | AckMsg
  | {
      type: 'status';
      alive: boolean;
      claudePid: number | null;
      exited: Exited | null;
    }
  | { type: 'error'; message: string };
export interface ClaudeCmd {
  file: string;
  prefix: string[];
  shell: boolean;
}
export interface RunnerSpec {
  sid: string;
  cwd: string;
  model?: string | null;
  permissionMode?: string | null;
  settingsFile?: string | null;
  claude: ClaudeCmd;
  version?: string | null;
}
export interface ClaudeArgsSpec {
  sid: string;
  model?: string | null;
  permissionMode?: string | null;
  settingsFile?: string | null;
  version?: string | null;
}

export const MAX_LINE_BYTES = 1024 * 1024; // one NDJSON line; anything longer is garbage or an attack, not a message
export const PROMPTS_NONE_SINCE = '2.1.259'; // first claude that knows --permission-prompts
const UUID_RE = /^[0-9a-f-]{36}$/i;

/** The session id ends up in a pipe name and a file path, so only a UUID shape is allowed. */
export function checkSid(sid: unknown): string {
  if (typeof sid !== 'string' || !UUID_RE.test(sid))
    throw new Error(`bad session id: ${String(sid).slice(0, 60)}`);
  return sid;
}

export const pipePath = (sid: unknown) =>
  isWindows()
    ? `\\\\.\\pipe\\pawgents-office-${checkSid(sid)}`
    : path.join(RUN_DIR, `${checkSid(sid)}.sock`);
export const runFile = (sid: unknown) =>
  path.join(RUN_DIR, `${checkSid(sid)}.json`);

/** With shell:true the runtime joins argv with spaces; args are validated (no quotes), so quoting ones with spaces is enough. */
export const shellQuote = (c: ClaudeCmd, arg: string) =>
  c.shell && /\s/.test(arg) ? `"${arg}"` : arg;

export const encode = (msg: unknown) => JSON.stringify(msg) + '\n';
export const newFeed = (): FeedState => ({ rem: '', skipping: false });

/** NDJSON splitter: calls onMsg(obj) per complete JSON line; drops oversize lines (to their newline) and non-JSON lines. */
export function feed(
  state: FeedState,
  chunk: unknown,
  onMsg: (m: Json) => void,
) {
  const lines = (state.rem + String(chunk)).split('\n');
  state.rem = lines.pop()!;
  for (const [i, line] of lines.entries()) {
    if (i === 0 && state.skipping) {
      state.skipping = false;
      continue;
    } // tail of a line already dropped as oversize
    if (line.length > MAX_LINE_BYTES || !line.trim()) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj && typeof obj === 'object') onMsg(obj as Json);
  }
  if (state.rem.length > MAX_LINE_BYTES) {
    state.rem = '';
    state.skipping = true;
  } // never buffer an unbounded line
}

/** Client -> runner command, or null when it isn't one we accept. */
export function parseCommand(raw: unknown): ClientCmd | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Json;
  if (obj.type === 'prompt') {
    if (typeof obj.text !== 'string') return null;
    const text = obj.text.trim();
    return text.length >= 1 && text.length <= MAX_PROMPT_CHARS
      ? { type: 'prompt', text }
      : null;
  }
  if (obj.type === 'mode')
    return typeof obj.mode === 'string' && PERMISSION_MODES.includes(obj.mode)
      ? { type: 'mode', mode: obj.mode }
      : null;
  return obj.type === 'close' || obj.type === 'kill' || obj.type === 'status'
    ? { type: obj.type }
    : null;
}

/** The few claude stream-json lines the office cares about; the rest (assistant, user, hooks) arrive through hooks anyway. */
export function parseClaudeLine(raw: unknown): ClaudeEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Json;
  if (o.type === 'system' && o.subtype === 'init')
    return {
      kind: 'init',
      model: typeof o.model === 'string' ? o.model : null,
      sessionId: typeof o.session_id === 'string' ? o.session_id : null,
    };
  if (o.type === 'system' && o.subtype === 'permission_denied') {
    const tool = (o.tool_name ?? o.tool ?? o.toolName) as
      | { name?: unknown }
      | string
      | null
      | undefined;
    return {
      kind: 'denied',
      tool:
        typeof tool === 'string'
          ? tool
          : typeof tool?.name === 'string'
            ? tool.name
            : null,
    };
  }
  // the mode in effect (after set_permission_mode, or when plan mode is left); null status lines carry it too
  if (
    o.type === 'system' &&
    o.subtype === 'status' &&
    typeof o.permissionMode === 'string' &&
    PERMISSION_MODES.includes(o.permissionMode)
  )
    return { kind: 'mode', mode: o.permissionMode };
  const r = o.response as Json | null | undefined;
  if (o.type === 'control_response' && r && typeof r.request_id === 'string') {
    const ok = r.subtype === 'success';
    return {
      kind: 'control',
      requestId: r.request_id,
      ok,
      error: ok
        ? null
        : String(r.error || 'control request failed').slice(0, 300),
      errorCode: typeof r.error_code === 'string' ? r.error_code : null,
    };
  }
  if (o.type === 'result')
    return {
      kind: 'result',
      isError: o.is_error === true,
      subtype: typeof o.subtype === 'string' ? o.subtype : null,
      costUsd: typeof o.total_cost_usd === 'number' ? o.total_cost_usd : null,
      denials: Array.isArray(o.permission_denials)
        ? (o.permission_denials as (Json | null)[])
            .slice(0, 20)
            .map((d) => String(d?.tool_name ?? d?.tool ?? '?'))
        : [],
    };
  return null;
}

export function versionAtLeast(v: unknown, min: string) {
  const a = /(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? '')),
    b = /(\d+)\.(\d+)\.(\d+)/.exec(min);
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i++)
    if (Number(a[i]) !== Number(b[i])) return Number(a[i]) > Number(b[i]);
  return true;
}

/** argv for claude (after any prefix); every user-influenced value is validated because it may go through a shell. */
export function buildClaudeArgs({
  sid,
  model,
  permissionMode,
  settingsFile,
  version,
}: ClaudeArgsSpec): string[] {
  checkSid(sid);
  if (
    model != null &&
    model !== '' &&
    (typeof model !== 'string' || !MODEL_RE.test(model))
  )
    throw new Error('bad model');
  if (
    permissionMode != null &&
    permissionMode !== '' &&
    !PERMISSION_MODES.includes(permissionMode)
  )
    throw new Error('bad permission mode');
  if (
    settingsFile != null &&
    settingsFile !== '' &&
    (typeof settingsFile !== 'string' ||
      !path.isAbsolute(settingsFile) ||
      /["\r\n]/.test(settingsFile))
  )
    throw new Error('bad settings file');
  return [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--session-id',
    sid,
    ...(model ? ['--model', model] : []),
    ...(permissionMode && permissionMode !== 'default'
      ? ['--permission-mode', permissionMode]
      : []),
    ...(versionAtLeast(version, PROMPTS_NONE_SINCE)
      ? ['--permission-prompts', 'none']
      : []),
    ...(settingsFile ? ['--settings', settingsFile] : []),
  ];
}

export const userMessageLine = (text: string) =>
  encode({ type: 'user', message: { role: 'user', content: text } });
/** Switch a running claude's permission mode (stream-json control request; answered by a control_response). */
export const setModeLine = (requestId: string, mode: string) =>
  encode({
    type: 'control_request',
    request_id: requestId,
    request: { subtype: 'set_permission_mode', mode },
  });

// Runner spec travels as one argv token (JSON) so nothing is reparsed by a shell.
export const runnerArgv = (spec: RunnerSpec) => [JSON.stringify(spec)];

export function parseRunnerArgv(
  argv: string[],
): Required<Omit<RunnerSpec, 'version'>> & { version: string | null } {
  let spec: unknown;
  try {
    spec = JSON.parse(argv?.[0] as string);
  } catch {
    throw new Error('runner spec is not JSON');
  }
  if (!isRecord(spec)) throw new Error('runner spec is not an object');
  const sid = checkSid(spec.sid);
  const cwd = spec.cwd;
  if (typeof cwd !== 'string' || !cwd) throw new Error('runner spec: bad cwd');
  const c = spec.claude;
  const prefix: unknown = isRecord(c) ? c.prefix : undefined;
  if (
    !isRecord(c) ||
    typeof c.file !== 'string' ||
    !c.file ||
    !Array.isArray(prefix) ||
    !prefix.every((p): p is string => typeof p === 'string') ||
    typeof c.shell !== 'boolean'
  )
    throw new Error('runner spec: bad claude');
  // the same checks and messages as buildClaudeArgs, which then checks the values themselves
  const model = optionalString(spec.model, 'bad model'),
    permissionMode = optionalString(spec.permissionMode, 'bad permission mode'),
    settingsFile = optionalString(spec.settingsFile, 'bad settings file'),
    version = typeof spec.version === 'string' ? spec.version : null;
  buildClaudeArgs({ sid, model, permissionMode, settingsFile, version });
  return {
    sid,
    cwd,
    model,
    permissionMode: permissionMode || 'default',
    settingsFile,
    claude: { file: c.file, prefix, shell: c.shell },
    version,
  };
}

/** A spec field that may be left out (null / ''): the string, or null; anything else throws `msg`. */
function optionalString(v: unknown, msg: string): string | null {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') throw new Error(msg);
  return v;
}
