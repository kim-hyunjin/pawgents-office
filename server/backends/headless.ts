// Headless backend: sessions run by `claude -p` (stream-json), each owned by a detached runner (server/headless-runner.ts).
// The server only talks to runners over their local socket, so it can restart without touching the sessions.

import { execFile, spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import type { ServerResponse } from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DECIDE_FLAG, headlessSettings } from '../../shared/decision.ts';
import { codedError, errCode, errMessage } from '../../shared/errors.ts';
import { safeJsonParse } from '../../shared/json.ts';
import { SEND_SCRIPT } from '../../shared/node/paths.ts';
import { isPidAlive } from '../../shared/node/process.ts';
import { sleep } from '../../shared/time.ts';
import {
  BACKEND_PROBE_TTL_MS,
  CLAUDE_BIN,
  CLAUDE_DIR,
  DATA_DIR,
  HEADLESS_EARLY_EXIT_MS,
  HEADLESS_LAUNCH_WAIT_MS,
  HEADLESS_SETTINGS_FILE,
  PERMISSION_HEARTBEAT_MS,
  PERMISSION_WAIT_MS,
  PORT,
  PROJECTS_DIR,
  RUN_DIR,
  RUNNER_CMD_TIMEOUT_MS,
  RUNNER_RECONNECT_MS,
  RUNNER_RECONNECT_TRIES,
} from '../config.ts';
import { JSON_HEADERS } from '../http.ts';
import type { Store } from '../store.ts';
import type { HookEvent, Session } from '../types.ts';
import {
  detailForTool,
  oneLine,
  projectDirName,
  readSafe,
  summarizeToolInput,
  truncate,
} from '../util.ts';
import type { ClaudeCmd, FeedState, Msg, RunnerSpec } from './protocol.ts';
import {
  encode,
  feed,
  newFeed,
  parseRunnerArgv,
  pipePath,
  runFile,
  runnerArgv,
  shellQuote,
} from './protocol.ts';

const RUNNER_PATH = fileURLToPath(
  new URL('../headless-runner.ts', import.meta.url),
);
const NOT_FOUND =
  'claude CLI를 찾을 수 없습니다 (PAWGENTS_OFFICE_CLAUDE_BIN 으로 경로를 지정할 수 있어요)';
export const DETACHED_MSG =
  '러너에 연결되지 않은 세션입니다. 잠시 후 다시 시도해주세요.';
const isWin = process.platform === 'win32';
/** The session's runner isn't connected (yet, or any more). */
const detachedError = () => codedError(DETACHED_MSG, 'detached');

interface Waiter {
  resolve: (m: Msg) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
type Decision = 'allow' | 'deny' | null;
interface Parked {
  finish: (
    decision: Decision,
    o?: { silent?: boolean; message?: string },
  ) => void;
  tool: string;
  target: string;
}
interface Runner {
  sock: net.Socket;
  info: Msg;
  feedState: FeedState;
  waiters: Map<string, Waiter[]>;
  pending: Map<string, Parked>;
  retries: number;
  lastStderr: string | null;
  killing: boolean;
}
export type ProbeResult =
  | { available: true; version: string; bin: string }
  | { available: false; reason: string };

/** sid -> connected runner (socket, pending command waiters, parked permission requests...) */
export const runners = new Map<string, Runner>();
// Parked permission requests per session; kept apart from the runner entry so a dropped-and-reconnected socket keeps them.
const parked = new Map<string, Map<string, Parked>>();
const parkedOf = (sid: string): Map<string, Parked> =>
  parked.get(sid) ?? parked.set(sid, new Map()).get(sid)!;
let stopping = false; // shutdown(): sockets close on purpose, don't reconnect or end sessions

// ---- claude binary -----------------------------------------------------------------------------------------------
let resolved: ClaudeCmd | null = null;
const isShim = (f: string) => /\.(cmd|bat)$/i.test(f);
// An npm .cmd shim would make cmd.exe reparse argv; run its cli.js with node instead when it's there (not our own runtime: that is bun).
function fromShim(file: string): ClaudeCmd {
  const cli = path.join(
    path.dirname(file),
    'node_modules',
    '@anthropic-ai',
    'claude-code',
    'cli.js',
  );
  return fs.existsSync(cli)
    ? { file: 'node', prefix: [cli], shell: false }
    : { file, prefix: [], shell: true };
}
/** How to start claude: { file, prefix, shell }. Cached until a probe fails (so installing claude later is noticed). */
export function resolveClaude(): ClaudeCmd {
  if (resolved) return resolved;
  if (process.env.PAWGENTS_OFFICE_CLAUDE_BIN)
    resolved = isShim(CLAUDE_BIN)
      ? fromShim(CLAUDE_BIN)
      : { file: CLAUDE_BIN, prefix: [], shell: false };
  else if (isWin) {
    const hits = String(
      spawnSync('where.exe', ['claude'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
      }).stdout || '',
    )
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const exe = hits.find((h) => /\.exe$/i.test(h)),
      shim = hits.find(isShim);
    resolved = exe
      ? { file: exe, prefix: [], shell: false }
      : shim
        ? fromShim(shim)
        : { file: 'claude', prefix: [], shell: false };
  } else resolved = { file: CLAUDE_BIN, prefix: [], shell: false };
  return resolved;
}

let probed: { at: number; result: ProbeResult } | null = null;
/** Is claude runnable, and which version (gates --permission-prompts)? Cached for BACKEND_PROBE_TTL_MS. */
export async function probe(): Promise<ProbeResult> {
  if (probed && Date.now() - probed.at < BACKEND_PROBE_TTL_MS)
    return probed.result;
  const c = resolveClaude();
  const result = await new Promise<ProbeResult>((resolve) =>
    execFile(
      shellQuote(c, c.file), // same rule as the runner: shell:true joins argv with spaces
      [...c.prefix, '--version'].map((a) => shellQuote(c, a)),
      { timeout: 5000, windowsHide: true, shell: c.shell },
      (e, stdout, stderr) => {
        const v = /(\d+\.\d+\.\d+)/.exec(String(stdout));
        if (!e && v)
          resolve({
            available: true,
            version: v[1],
            bin: c.prefix[0] || c.file,
          });
        else
          resolve({
            available: false,
            reason:
              (e as NodeJS.ErrnoException | null)?.code === 'ENOENT'
                ? NOT_FOUND
                : truncate(
                    oneLine(stderr || e?.message || 'claude --version failed'),
                    300,
                  ),
          });
      },
    ),
  );
  if (!result.available) resolved = null;
  probed = { at: Date.now(), result };
  return result;
}

// ---- runner env --------------------------------------------------------------------------------------------------
// Set when the office server was started from inside a claude session (ensure-server hook): the child claude would think
// it's nested, and the headless session would be tied to that session's Orca terminal.
const STRIP_ENV = new Set([
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SSE_PORT',
  'ORCA_TERMINAL_HANDLE',
]);
export function stripClaudeEnv(env: NodeJS.ProcessEnv) {
  const out = { ...env };
  for (const k of Object.keys(out))
    if (STRIP_ENV.has(isWin ? k.toUpperCase() : k)) delete out[k]; // Windows env names are case-insensitive
  return out;
}
/** Env for the runner (and so claude and its hooks): our port and data dir, so the plugin hooks report to this server. */
export const childEnv = (
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv => ({
  ...stripClaudeEnv(env),
  PAWGENTS_OFFICE_PORT: String(PORT),
  PAWGENTS_OFFICE_DATA: DATA_DIR,
});

/**
 * The model claude picks when no --model is given: ANTHROPIC_MODEL, else the `model` of the project's local, project
 * and user settings (that order). null: claude's own account default, which only its init line reveals. stream-json
 * claude sends that line with its first turn, so without this a session hired with no first prompt has no model (a
 * '—' in the panel, and no cat family, so no skin) until it is given work.
 */
export function defaultModel(
  cwd: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  claudeDir: string = CLAUDE_DIR,
): string | null {
  if (env.ANTHROPIC_MODEL) return String(env.ANTHROPIC_MODEL);
  const files = [
    ...(cwd
      ? [
          path.join(cwd, '.claude', 'settings.local.json'),
          path.join(cwd, '.claude', 'settings.json'),
        ]
      : []),
    path.join(claudeDir, 'settings.json'),
  ];
  for (const f of files) {
    const m = safeJsonParse(readSafe(f))?.model;
    if (typeof m === 'string' && m.trim()) return m.trim();
  }
  return null;
}

// ---- runner connection -------------------------------------------------------------------------------------------
function attach(store: Store, h: Msg): Session {
  const s = store.getOrCreateSession(h.sid, {
    cwd: h.cwd,
    pid: h.claudePid,
    model: h.model,
    startedAt: h.startedAt,
    backend: 'headless',
    permissionMode: h.permissionMode,
  });
  s.model ||= h.model || defaultModel(h.cwd); // provisional: claude's init line replaces it with the exact model id
  store.setBackend(s, 'headless'); // registry or a hook may have created it first
  if (h.claudePid && !s.pid) s.pid = h.claudePid;
  s.transcriptPath ||= path.join(
    PROJECTS_DIR,
    projectDirName(h.cwd),
    `${h.sid}.jsonl`,
  );
  store.emitSession(s);
  return s;
}

function forgetRunFile(sid: string) {
  try {
    fs.unlinkSync(runFile(sid));
  } catch {}
  if (!isWin)
    try {
      fs.unlinkSync(pipePath(sid));
    } catch {}
}

function endIfLive(store: Store, sid: string, reason: string) {
  const s = store.sessions.get(sid);
  if (s && !s.ended) {
    store.endSession(s, reason);
    store.emitSession(s);
  }
}

function settle(r: Runner, key: string | null, fn: (w: Waiter) => void) {
  const q = key
    ? r.waiters.get(key)
    : [...r.waiters.values()].find((x) => x.length);
  const w = q?.shift();
  if (!w) return;
  clearTimeout(w.timer);
  fn(w);
}
function rejectAll(r: Runner, e: Error) {
  for (const q of r.waiters.values())
    for (const w of q.splice(0)) {
      clearTimeout(w.timer);
      w.reject(e);
    }
}

/** claude's own report of a denial the office just made (or timed out): parkPermission already logged it. */
function echoesOfficeDenial(s: Session, tool: string) {
  const [last] = s.log.last(1);
  return (
    last?.ev === 'PermissionRequest' &&
    last.tool === tool &&
    /^→ (거부|응답 없음)$/.test(last.text ?? '') &&
    Date.now() - last.t < 5000
  );
}

/** Fold one runner 'event' (claude stream-json, already parsed) into the live session. Returns true if it changed. */
function applyRunnerEvent(store: Store, s: Session, m: Msg) {
  if (m.kind === 'init' && m.model) {
    s.model = m.model; // exact id, over defaultModel's guess
    return true;
  }
  if (m.kind === 'mode') {
    if (s.permissionMode === m.mode) return false;
    s.permissionMode = m.mode;
    return true;
  }
  if (m.kind === 'result' && m.isError) {
    store.log(s, {
      ev: 'Notification',
      text: `오류: ${m.subtype || 'error'}`,
    });
    if (s.state !== 'idle') store.setState(s, 'idle'); // no Stop hook follows a failed turn
    return true;
  }
  if (m.kind === 'denied') {
    // claude reports every denial; one the office just made (or timed out) is already logged by parkPermission
    if (echoesOfficeDenial(s, m.tool || '?')) return false;
    store.log(s, {
      ev: 'PermissionRequest',
      tool: m.tool || '?',
      text: '→ 거부됨(응답 없음)',
    });
    return true;
  }
  return false;
}

/** Why a session ended, from the runner's exit message. */
function endReason(r: Runner, m: Msg) {
  if (r.killing) return 'killed';
  if (!m.code) return 'process exited';
  const tail = Array.isArray(m.stderrTail) ? m.stderrTail : [];
  return `claude 종료 (code ${m.code}): ${truncate(oneLine(tail.at(-1) || r.lastStderr || ''), 200)}`;
}

/** Connect to a runner's socket; resolves with its hello (attached to the store unless claude is already gone). */
function connect(
  store: Store,
  sid: string,
  info: Msg,
  { onExit }: { onExit?: (m: Msg) => void } = {},
): Promise<Msg> {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ path: pipePath(sid) });
    const r: Runner = {
      sock,
      info,
      feedState: newFeed(),
      waiters: new Map(),
      pending: parkedOf(sid),
      retries: 0,
      lastStderr: null,
      killing: false,
    };
    let helloed = false,
      gotExit = false;
    const helloTimer = setTimeout(() => {
      if (!helloed) {
        sock.destroy();
        reject(codedError('runner did not say hello', 'ETIMEDOUT'));
      }
    }, RUNNER_CMD_TIMEOUT_MS);
    const onMsg = (m: Msg) => {
      if (m.type === 'hello') {
        if (helloed) return;
        helloed = true;
        clearTimeout(helloTimer);
        r.info = { ...info, claudePid: m.claudePid ?? info.claudePid };
        if (m.alive !== false) {
          runners.set(sid, r);
          attach(store, m);
        } // a dead claude gets no cat; its exit follows
        resolve(m);
        return;
      }
      if (!helloed) return;
      const s = store.sessions.get(sid);
      if (m.type === 'event') {
        if (m.kind === 'stderr') {
          r.lastStderr = typeof m.line === 'string' ? m.line : r.lastStderr;
          return;
        }
        if (s && !s.ended && applyRunnerEvent(store, s, m))
          store.emitSession(s);
      } else if (m.type === 'exit') {
        gotExit = true;
        if (runners.get(sid) === r) runners.delete(sid);
        rejectAll(r, codedError('claude가 종료되었습니다.', 'headless_exit'));
        denyAll(sid, '세션이 종료되었습니다.'); // the hooks die with claude anyway; this clears the cards and logs it
        endIfLive(store, sid, endReason(r, m));
        onExit?.(m);
      } else if (m.type === 'ack')
        settle(r, m.for, (w) =>
          m.ok
            ? w.resolve(m)
            : w.reject(
                Object.assign(
                  codedError(m.error || 'runner refused', 'headless_exit'),
                  { claudeCode: m.code },
                ),
              ),
        );
      else if (m.type === 'status') settle(r, 'status', (w) => w.resolve(m));
      else if (m.type === 'error')
        settle(r, null, (w) =>
          w.reject(codedError(m.message || 'runner error', 'headless_exit')),
        );
    };
    sock.setEncoding('utf8');
    sock.on('data', (d: string) => feed(r.feedState, d, onMsg));
    sock.on('error', (e: Error) => {
      if (!helloed) {
        clearTimeout(helloTimer);
        reject(e);
      }
    });
    sock.on('close', () => {
      clearTimeout(helloTimer);
      rejectAll(r, detachedError());
      if (!helloed)
        return reject(codedError('runner closed the connection', 'ECONNRESET'));
      if (runners.get(sid) === r) runners.delete(sid);
      if (gotExit || stopping) return;
      reconnect(store, sid, r.info); // runner still up (we dropped, it didn't)? try again; otherwise the session is over
    });
  });
}

async function reconnect(store: Store, sid: string, info: Msg) {
  for (let i = 0; i < RUNNER_RECONNECT_TRIES && isPidAlive(info.pid); i++) {
    await sleep(RUNNER_RECONNECT_MS);
    if (stopping || runners.has(sid)) return;
    try {
      await connect(store, sid, info);
      return;
    } catch {}
  }
  if (stopping || runners.has(sid)) return;
  endIfLive(store, sid, 'runner exited');
  forgetRunFile(sid);
}

/** Send a command and wait for the runner's answer (ack / status). */
function command(sid: string, cmd: Msg): Promise<Msg> {
  const r = runners.get(sid);
  if (!r) return Promise.reject(detachedError());
  return new Promise<Msg>((resolve, reject) => {
    const key: string = cmd.type,
      q = r.waiters.get(key) ?? [];
    r.waiters.set(key, q);
    const w: Waiter = {
      resolve,
      reject,
      timer: setTimeout(() => {
        const i = q.indexOf(w);
        if (i >= 0) q.splice(i, 1);
        reject(codedError('러너가 응답하지 않습니다.', 'detached'));
      }, RUNNER_CMD_TIMEOUT_MS),
    };
    q.push(w); // acks come back in order, so per-type FIFO pairs them up
    try {
      r.sock.write(encode(cmd));
    } catch {
      clearTimeout(w.timer);
      q.splice(q.indexOf(w), 1);
      reject(detachedError());
    }
  });
}

// ---- launch ------------------------------------------------------------------------------------------------------
async function waitRunFile(sid: string): Promise<Msg | null> {
  const end = Date.now() + HEADLESS_LAUNCH_WAIT_MS;
  while (Date.now() < end) {
    const info = safeJsonParse(readSafe(runFile(sid))); // ENOENT / partial read -> null, keep polling
    if (info?.sid === sid) return info;
    await sleep(100);
  }
  return null;
}

const exitReason = (m: Msg | null) =>
  (Array.isArray(m?.stderrTail) ? m.stderrTail.join(' ') : '').slice(0, 300) ||
  'claude가 바로 종료되었습니다';

/** Start a runner + claude in `cwd`, wait until it's clearly up, then send the first prompt. Resolves with the session. */
export async function launch(
  store: Store,
  {
    cwd,
    prompt,
    model,
    permissionMode,
  }: {
    cwd: string;
    prompt?: string | null;
    model?: string | null;
    permissionMode?: string | null;
  },
) {
  const p = await probe();
  if (!p.available) throw codedError(p.reason, 'headless_unavailable');
  const sid = randomUUID();
  const spec: RunnerSpec = {
    sid,
    cwd,
    model: model || null,
    permissionMode: permissionMode || 'default',
    settingsFile: ensureSettingsFile(),
    claude: resolveClaude(),
    version: p.version,
  };
  parseRunnerArgv(runnerArgv(spec)); // fail here, with a stack, rather than in a detached runner nobody watches
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const child = spawn(process.execPath, [RUNNER_PATH, ...runnerArgv(spec)], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: childEnv(),
    cwd,
  });
  child.on('error', () => {}); // shows up as a missing run file below
  child.unref();
  const info = await waitRunFile(sid);
  if (!info) throw codedError('러너가 시작되지 않았습니다', 'headless_exit');
  let exited: Msg | null = null,
    wake: (() => void) | null = null;
  const hello = await connect(store, sid, info, {
    onExit: (m) => {
      exited = m;
      wake?.();
    },
  });
  if (hello.alive === false)
    throw codedError(exitReason(hello), 'headless_exit');
  if (!exited)
    await new Promise<void>((r) => {
      wake = r;
      setTimeout(r, HEADLESS_EARLY_EXIT_MS);
    }); // not logged in / bad flag: claude dies right away
  if (exited) throw codedError(exitReason(exited), 'headless_exit');
  if (prompt) await command(sid, { type: 'prompt', text: prompt });
  return store.sessions.get(sid);
}

export const has = (sid: string) => runners.has(sid);
export const sendPrompt = (store: Store, s: Session, text: string) =>
  command(s.id, { type: 'prompt', text });

const MODE_REFUSED: Record<string, string> = {
  bypass_not_launched:
    'bypass 모드는 --dangerously-skip-permissions 로 시작한 세션에서만 켤 수 있습니다.',
  invalid_mode: '이 claude가 모르는 권한 모드입니다.',
};
/** Switch the running claude's permission mode; it confirms with a status line (handled in connect) as well as the ack. */
export async function setMode(store: Store, s: Session, mode: string) {
  try {
    await command(s.id, { type: 'mode', mode });
  } catch (e) {
    const cc = (e as { claudeCode?: string }).claudeCode;
    if (cc) throw codedError(MODE_REFUSED[cc] || errMessage(e), 'mode_refused');
    throw e;
  }
  s.permissionMode = mode;
  return { mode };
}

/** Default: close claude's stdin (it finishes the turn, runs SessionEnd, exits). force: kill the process tree now. */
export function closeSession(
  store: Store,
  s: Session,
  { force = false }: { force?: boolean } = {},
) {
  if (!force) return command(s.id, { type: 'close' });
  denyAll(s.id, '사무실에서 강제 종료했습니다.'); // first, or the turn stays blocked on the hook
  const r = runners.get(s.id);
  if (r) r.killing = true;
  return command(s.id, { type: 'kill' });
}

// ---- permission requests (the --decide hook long-polls POST /hook) -------------------------------------------------
const SETTINGS_COMMAND = `"${process.execPath}" "${SEND_SCRIPT}" ${DECIDE_FLAG}`;
/** Write the --settings file headless claude gets (our synchronous PermissionRequest hook); rewritten if bun or the repo moved. */
export function ensureSettingsFile() {
  const text =
    JSON.stringify(headlessSettings(SETTINGS_COMMAND), null, 2) + '\n';
  if (readSafe(HEADLESS_SETTINGS_FILE) !== text) {
    fs.mkdirSync(path.dirname(HEADLESS_SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(HEADLESS_SETTINGS_FILE, text);
  }
  return HEADLESS_SETTINGS_FILE;
}

const RESULT_TEXT: Record<string, string> = { allow: '→ 허용', deny: '→ 거부' };
/**
 * Hold the hook's request open until the browser answers (decidePermission), the wait runs out (no decision: claude
 * denies), or the hook goes away. Headers go out at once and a space every PERMISSION_HEARTBEAT_MS, because undici
 * (the hook's fetch) gives up on a silent response after 300 s.
 */
export function parkPermission(
  store: Store,
  s: Session,
  ev: HookEvent,
  res: ServerResponse,
) {
  const id = randomUUID().slice(0, 8),
    tool = String(ev.tool_name || ''),
    target = summarizeToolInput(tool, ev.tool_input),
    detail = truncate(detailForTool(tool, ev.tool_input), 200);
  const pending = parkedOf(s.id);
  s.pendingPermissions.push({ id, tool, target, detail, at: Date.now() });
  res.writeHead(200, JSON_HEADERS);
  res.flushHeaders();
  let done = false;
  const hb = setInterval(() => {
    if (!res.writableEnded) res.write(' ');
  }, PERMISSION_HEARTBEAT_MS);
  const timer = setTimeout(() => finish(null), PERMISSION_WAIT_MS);
  /** decision: 'allow' | 'deny' | null (no answer). silent: the hook is gone, nothing to tell anyone. */
  function finish(
    decision: Decision,
    { silent = false, message }: { silent?: boolean; message?: string } = {},
  ) {
    if (done) return;
    done = true;
    clearInterval(hb);
    clearTimeout(timer);
    if (!res.writableEnded)
      res.end(
        decision
          ? JSON.stringify({ decision, ...(message ? { message } : {}) })
          : '{}',
      );
    s.pendingPermissions = s.pendingPermissions.filter((p) => p.id !== id);
    pending.delete(id);
    if (!pending.size) parked.delete(s.id);
    if (!silent)
      store.log(s, {
        ev: 'PermissionRequest',
        tool,
        target,
        text: RESULT_TEXT[decision ?? ''] || '→ 응답 없음',
      });
    if (!s.pendingPermissions.length && s.state === 'waiting' && !s.ended)
      store.setState(s, 'thinking');
    store.emitSession(s);
  }
  res.on('close', () => finish(null, { silent: true }));
  pending.set(id, { finish, tool, target });
  store.emitSession(s);
}

/** The browser's answer to request reqId; false when it's already settled (answered, timed out, session gone). */
export function decidePermission(
  store: Store,
  s: Session,
  reqId: string,
  allow: boolean,
) {
  const p = parked.get(s.id)?.get(reqId);
  if (!p) return false;
  p.finish(allow ? 'allow' : 'deny');
  return true;
}

/** Deny every parked request of a session (it's ending or being killed). */
function denyAll(sid: string, message: string) {
  for (const p of [...(parked.get(sid)?.values() ?? [])])
    p.finish('deny', { message });
}

// ---- server lifecycle --------------------------------------------------------------------------------------------
/** Boot: reconnect to every runner that outlived the previous server. Returns how many sessions came back. */
export async function restore(store: Store) {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const files = fs
    .readdirSync(RUN_DIR)
    .filter((f) => /^[0-9a-f-]{36}\.json$/i.test(f));
  const results = await Promise.all(
    files.map(async (f): Promise<number> => {
      const sid = f.slice(0, -5),
        info = safeJsonParse(readSafe(path.join(RUN_DIR, f)));
      if (!info || info.sid !== sid || !Number.isInteger(info.pid)) return 0; // half-written or foreign: leave it
      if (!isPidAlive(info.pid)) {
        forgetRunFile(sid);
        return 0;
      }
      for (let i = 0; ; i++) {
        try {
          return (await connect(store, sid, info)).alive === false ? 0 : 1;
        } catch (e) {
          // no pipe / nobody listening: the pid was reused by something else, so retrying won't help
          const code = errCode(e);
          if (
            code === 'ENOENT' ||
            code === 'ECONNREFUSED' ||
            i + 1 >= RUNNER_RECONNECT_TRIES
          ) {
            forgetRunFile(sid);
            console.error(
              `[headless] ${sid.slice(0, 8)}: runner unreachable (${code || errMessage(e)}), forgotten`,
            );
            return 0;
          }
          await sleep(RUNNER_RECONNECT_MS);
        }
      }
    }),
  );
  return results.reduce((a, b) => a + b, 0);
}

/** Server exit: drop our sockets only. Runners and their claude keep going until the next server reconnects. */
export function shutdown() {
  stopping = true;
  for (const r of runners.values()) r.sock?.destroy();
}
