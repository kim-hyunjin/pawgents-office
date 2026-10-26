// Wire formats for the headless backend, shared by the runner, the server and tests (pure: no I/O, no state).
// Server <-> runner speak NDJSON over a local socket; runner <-> claude speak claude's stream-json.
import path from 'node:path';
import { MAX_PROMPT_CHARS, RUN_DIR } from '../config.ts';

export type Msg = Record<string, any>; // a decoded JSON payload (NDJSON line, claude stream-json line)
export type FeedState = { rem: string; skipping: boolean };
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

/** Message / code of a caught value (errors from child_process carry stderr and code too). */
export const errMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);
export const errCode = (e: unknown): string | undefined => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : undefined;
};

export const PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'plan',
  'auto',
  'dontAsk',
  'bypassPermissions',
];
export const MAX_LINE_BYTES = 1024 * 1024; // one NDJSON line; anything longer is garbage or an attack, not a message
export const PROMPTS_NONE_SINCE = '2.1.259'; // first claude that knows --permission-prompts
const UUID_RE = /^[0-9a-f-]{36}$/i;
const MODEL_RE = /^[\w.\-[\]]{1,80}$/;

/** The session id ends up in a pipe name and a file path, so only a UUID shape is allowed. */
export function checkSid(sid: unknown): string {
  if (typeof sid !== 'string' || !UUID_RE.test(sid))
    throw new Error(`bad session id: ${String(sid).slice(0, 60)}`);
  return sid;
}

export const pipePath = (sid: unknown) =>
  process.platform === 'win32'
    ? `\\\\.\\pipe\\pawgents-office-${checkSid(sid)}`
    : path.join(RUN_DIR, `${checkSid(sid)}.sock`);
export const runFile = (sid: unknown) =>
  path.join(RUN_DIR, `${checkSid(sid)}.json`);

export const encode = (msg: unknown) => JSON.stringify(msg) + '\n';
export const newFeed = (): FeedState => ({ rem: '', skipping: false });

/** NDJSON splitter: calls onMsg(obj) per complete JSON line; drops oversize lines (to their newline) and non-JSON lines. */
export function feed(
  state: FeedState,
  chunk: unknown,
  onMsg: (m: Msg) => void,
) {
  const lines = (state.rem + String(chunk)).split('\n');
  state.rem = lines.pop()!;
  for (const [i, line] of lines.entries()) {
    if (i === 0 && state.skipping) {
      state.skipping = false;
      continue;
    } // tail of a line already dropped as oversize
    if (line.length > MAX_LINE_BYTES || !line.trim()) continue;
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj && typeof obj === 'object') onMsg(obj);
  }
  if (state.rem.length > MAX_LINE_BYTES) {
    state.rem = '';
    state.skipping = true;
  } // never buffer an unbounded line
}

/** Client -> runner command, or null when it isn't one we accept. */
export function parseCommand(
  obj: any,
): { type: string; text?: string; mode?: string } | null {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.type === 'prompt') {
    if (typeof obj.text !== 'string') return null;
    const text = obj.text.trim();
    return text.length >= 1 && text.length <= MAX_PROMPT_CHARS
      ? { type: 'prompt', text }
      : null;
  }
  if (obj.type === 'mode')
    return PERMISSION_MODES.includes(obj.mode)
      ? { type: 'mode', mode: obj.mode }
      : null;
  return ['close', 'kill', 'status'].includes(obj.type)
    ? { type: obj.type }
    : null;
}

/** The few claude stream-json lines the office cares about; the rest (assistant, user, hooks) arrive through hooks anyway. */
export function parseClaudeLine(o: any): Msg | null {
  if (!o || typeof o !== 'object') return null;
  if (o.type === 'system' && o.subtype === 'init')
    return {
      kind: 'init',
      model: typeof o.model === 'string' ? o.model : null,
      sessionId: typeof o.session_id === 'string' ? o.session_id : null,
    };
  if (o.type === 'system' && o.subtype === 'permission_denied') {
    const tool = o.tool_name ?? o.tool ?? o.toolName;
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
    PERMISSION_MODES.includes(o.permissionMode)
  )
    return { kind: 'mode', mode: o.permissionMode };
  if (
    o.type === 'control_response' &&
    o.response &&
    typeof o.response.request_id === 'string'
  ) {
    const r = o.response,
      ok = r.subtype === 'success';
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
        ? o.permission_denials
            .slice(0, 20)
            .map((d: any) => String(d?.tool_name ?? d?.tool ?? '?'))
        : [],
    };
  return null;
}

export function versionAtLeast(v: unknown, min: string) {
  const a = /(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? '')),
    b = /(\d+)\.(\d+)\.(\d+)/.exec(min);
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i++) if (+a[i] !== +b[i]) return +a[i] > +b[i];
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
  let spec: any;
  try {
    spec = JSON.parse(argv?.[0] as string);
  } catch {
    throw new Error('runner spec is not JSON');
  }
  if (!spec || typeof spec !== 'object')
    throw new Error('runner spec is not an object');
  checkSid(spec.sid);
  if (typeof spec.cwd !== 'string' || !spec.cwd)
    throw new Error('runner spec: bad cwd');
  const c = spec.claude;
  if (
    !c ||
    typeof c.file !== 'string' ||
    !c.file ||
    !Array.isArray(c.prefix) ||
    !c.prefix.every((p: unknown) => typeof p === 'string') ||
    typeof c.shell !== 'boolean'
  )
    throw new Error('runner spec: bad claude');
  buildClaudeArgs(spec); // validates model, permissionMode, settingsFile
  return {
    sid: spec.sid,
    cwd: spec.cwd,
    model: spec.model || null,
    permissionMode: spec.permissionMode || 'default',
    settingsFile: spec.settingsFile || null,
    claude: { file: c.file, prefix: c.prefix, shell: c.shell },
    version: typeof spec.version === 'string' ? spec.version : null,
  };
}
