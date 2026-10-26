// Tests for the headless backend: git worktree parsing, repo discovery, the runner protocol, and the runner itself (with a fake claude).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import type { ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { pipePath, runFile, encode, newFeed, feed, parseCommand, parseClaudeLine, buildClaudeArgs, versionAtLeast, userMessageLine, setModeLine, runnerArgv, parseRunnerArgv, MAX_LINE_BYTES } from '../server/backends/protocol.ts';
import type { Msg, RunnerSpec } from '../server/backends/protocol.ts';
import type { Store } from '../server/store.ts';
import type { Session, HookEvent, LogEntry } from '../server/types.ts';
import { RUN_DIR, MAX_PROMPT_CHARS } from '../server/config.ts';
import { parseWorktrees, repoRoots } from '../server/backends/git.ts';

const fixture = [
  'worktree C:/Users/x/repo', 'HEAD aaa111', 'branch refs/heads/main', '',
  'worktree C:/Users/x/repo-feature', 'HEAD bbb222', 'branch refs/heads/feature/x', '',
  'worktree C:/Users/x/repo-detached', 'HEAD ccc333', 'detached', '',
  'worktree C:/Users/x/repo.git', 'bare', '',
  'worktree C:/Users/x/repo-gone', 'HEAD ddd444', 'branch refs/heads/gone', 'prunable gitdir file points to non-existent location', '',
].join('\n');

test('parseWorktrees reads branches, detached heads and the main worktree; skips bare and prunable', () => {
  const ws = parseWorktrees(fixture, 'C:/Users/x/repo');
  assert.equal(ws.length, 3);
  assert.deepEqual(ws.map((w) => w.isMain), [true, false, false]);
  assert.deepEqual(ws.map((w) => w.branch), ['main', 'feature/x', '']);
  assert.deepEqual(ws.map((w) => w.head), ['aaa111', 'bbb222', 'ccc333']);
  assert.ok(ws.every((w) => w.repo === 'repo' && w.repoRoot === 'C:/Users/x/repo' && w.id === w.path && w.name === ''));
  assert.equal(ws[1].path, 'C:/Users/x/repo-feature');
});

test('repoRoots keeps only existing directories and drops the default bucket', () => {
  const here = process.cwd();
  const store = { offices: [{ repos: ['default', here.toLowerCase(), here + '-nope'] }], sessions: new Map() } as unknown as Store; // just what repoRoots reads
  const roots = repoRoots(store);
  assert.deepEqual(roots, [here.toLowerCase()]);
});

test('feed splits NDJSON across chunks, drops oversize and non-JSON lines', () => {
  const got: Msg[] = [], st = newFeed(), on = (o: Msg) => got.push(o);
  feed(st, '{"a":1}\n{"b"', on); feed(st, ':2}\n', on);
  feed(st, '{"c":3}\n{"d":4}\nnot json\n\n[1]\n', on);
  feed(st, '{"x":"' + 'y'.repeat(MAX_LINE_BYTES + 10), on); feed(st, 'zz"}\n{"e":5}\n', on); // oversize line spanning chunks
  feed(st, '{"big":"' + 'y'.repeat(MAX_LINE_BYTES) + '"}\n{"f":6}\n', on); // oversize line inside one chunk
  assert.equal(st.rem, '');
  assert.deepEqual(got, [{ a: 1 }, { b: 2 }, { c: 3 }, { d: 4 }, [1], { e: 5 }, { f: 6 }]);
  assert.equal(encode({ t: 1 }), '{"t":1}\n');
});

test('parseCommand accepts the four commands and rejects the rest', () => {
  assert.deepEqual(parseCommand({ type: 'prompt', text: '  hi  ' }), { type: 'prompt', text: 'hi' });
  for (const t of ['close', 'kill', 'status']) assert.deepEqual(parseCommand({ type: t, extra: 1 }), { type: t });
  for (const bad of [null, 'prompt', {}, { type: 'prompt' }, { type: 'prompt', text: '   ' }, { type: 'prompt', text: 5 }, { type: 'prompt', text: 'x'.repeat(MAX_PROMPT_CHARS + 1) }, { type: 'nope' }]) assert.equal(parseCommand(bad), null);
});

test('mode: command, control request line, status and control_response parsing', () => {
  assert.deepEqual(parseCommand({ type: 'mode', mode: 'plan' }), { type: 'mode', mode: 'plan' });
  for (const bad of [{ type: 'mode' }, { type: 'mode', mode: 'yolo' }, { type: 'mode', mode: 5 }]) assert.equal(parseCommand(bad), null);
  assert.deepEqual(JSON.parse(setModeLine('r1', 'auto')), { type: 'control_request', request_id: 'r1', request: { subtype: 'set_permission_mode', mode: 'auto' } });
  assert.deepEqual(parseClaudeLine({ type: 'system', subtype: 'status', status: null, permissionMode: 'acceptEdits' }), { kind: 'mode', mode: 'acceptEdits' });
  assert.equal(parseClaudeLine({ type: 'system', subtype: 'status', status: 'compacting' }), null);
  assert.deepEqual(parseClaudeLine({ type: 'control_response', response: { subtype: 'success', request_id: 'r1', response: { mode: 'plan' } } }), { kind: 'control', requestId: 'r1', ok: true, error: null, errorCode: null });
  assert.deepEqual(parseClaudeLine({ type: 'control_response', response: { subtype: 'error', request_id: 'r2', error: 'nope', error_code: 'bypass_not_launched' } }), { kind: 'control', requestId: 'r2', ok: false, error: 'nope', errorCode: 'bypass_not_launched' });
});

test('Orca footerMode reads the mode line under the input box', async () => {
  const { footerMode } = await import('../server/backends/orca.ts');
  const box = ['● some answer that says plan mode on', '─'.repeat(60), '> ', '─'.repeat(60)];
  assert.equal(footerMode([...box, '  ⏵⏵ auto mode on (shift+tab to cycle) · ← 1 agent']), 'auto');
  assert.equal(footerMode([...box, '  ⏵⏵ accept edits on (shift+tab to cycle)']), 'acceptEdits');
  assert.equal(footerMode([...box, '  ⏸ plan mode on (shift+tab to cycle)']), 'plan');
  assert.equal(footerMode([...box, '  ⏵⏵ bypass permissions on (shift+tab to cycle)']), 'bypassPermissions');
  assert.equal(footerMode([...box, '  ⏸ manual mode on · ← 1 agent']), 'default');
  assert.equal(footerMode([...box, '  ? for shortcuts']), 'default'); // the answer above the box doesn't count
  assert.equal(footerMode(['Select model', '❯ 1. Opus']), null); // no input box on screen
});

test('parseClaudeLine keeps init, result and permission denials only', () => {
  assert.deepEqual(parseClaudeLine({ type: 'system', subtype: 'init', model: 'claude-x', session_id: 's', cwd: '/' }), { kind: 'init', model: 'claude-x', sessionId: 's' });
  assert.deepEqual(parseClaudeLine({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.5, permission_denials: [{ tool_name: 'Bash' }], result: 'x' }), { kind: 'result', isError: false, subtype: 'success', costUsd: 0.5, denials: ['Bash'] });
  assert.deepEqual(parseClaudeLine({ type: 'result', subtype: 'error_during_execution', is_error: true }), { kind: 'result', isError: true, subtype: 'error_during_execution', costUsd: null, denials: [] });
  assert.deepEqual(parseClaudeLine({ type: 'system', subtype: 'permission_denied', tool_name: 'Edit' }), { kind: 'denied', tool: 'Edit' });
  assert.deepEqual(parseClaudeLine({ type: 'system', subtype: 'permission_denied', tool: 'Write' }), { kind: 'denied', tool: 'Write' });
  for (const o of [null, 'x', { type: 'assistant' }, { type: 'user' }, { type: 'rate_limit_event' }, { type: 'system', subtype: 'hook_started' }]) assert.equal(parseClaudeLine(o), null);
});

test('buildClaudeArgs: exact argv, permission-mode and version gates, validation', () => {
  const sid = '11111111-2222-3333-4444-555555555555';
  const base = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--session-id', sid];
  assert.deepEqual(buildClaudeArgs({ sid, version: '2.1.258' }), base);
  assert.deepEqual(buildClaudeArgs({ sid, version: '2.1.259 (Claude Code)', permissionMode: 'default' }), [...base, '--permission-prompts', 'none']);
  const settings = path.resolve('s.json');
  assert.deepEqual(buildClaudeArgs({ sid, version: '2.1.309', model: 'opus[1m]', permissionMode: 'acceptEdits', settingsFile: settings }),
    [...base, '--model', 'opus[1m]', '--permission-mode', 'acceptEdits', '--permission-prompts', 'none', '--settings', settings]);
  assert.equal(versionAtLeast('3.0.0', '2.1.259'), true);
  assert.equal(versionAtLeast('2.0.999', '2.1.259'), false);
  assert.equal(versionAtLeast(null, '2.1.259'), false);
  assert.throws(() => buildClaudeArgs({ sid: '../x' }));
  assert.throws(() => buildClaudeArgs({ sid, model: 'a b' }));
  assert.throws(() => buildClaudeArgs({ sid, model: 'x&calc' }));
  assert.throws(() => buildClaudeArgs({ sid, permissionMode: 'yolo' }));
  assert.throws(() => buildClaudeArgs({ sid, settingsFile: 'relative.json' }));
  assert.equal(userMessageLine('hi'), '{"type":"user","message":{"role":"user","content":"hi"}}\n');
});

test('runner argv round-trips and rejects garbage', () => {
  const spec: RunnerSpec = { sid: randomUUID(), cwd: process.cwd(), model: null, permissionMode: 'auto', settingsFile: null, claude: { file: 'claude', prefix: [], shell: false }, version: '2.1.309' };
  assert.deepEqual(parseRunnerArgv(runnerArgv(spec)), spec);
  assert.throws(() => parseRunnerArgv(['{nope']));
  assert.throws(() => parseRunnerArgv([]));
  assert.throws(() => parseRunnerArgv(runnerArgv({ ...spec, sid: '..\\..\\evil' })));
  assert.throws(() => parseRunnerArgv(runnerArgv({ ...spec, claude: { file: 'claude', prefix: [1], shell: false } } as unknown as RunnerSpec)));
  assert.throws(() => parseRunnerArgv(runnerArgv({ ...spec, cwd: 3 } as unknown as RunnerSpec)));
});

test('pipePath and runFile per platform', () => {
  const sid = randomUUID();
  if (process.platform === 'win32') assert.equal(pipePath(sid), `\\\\.\\pipe\\pawgents-office-${sid}`);
  else assert.equal(pipePath(sid), path.join(RUN_DIR, `${sid}.sock`));
  assert.equal(runFile(sid), path.join(RUN_DIR, `${sid}.json`));
  assert.throws(() => pipePath('x'));
});

// Real runner over a real pipe, with test/fixtures/fake-claude.ts as claude. DATA_DIR points at a temp dir via env.
test('runner: hello, prompt -> ack + result, status, close -> exit 0, run file removed', { timeout: 30_000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', 'po-')); // short: POSIX sun_path is ~104 bytes
  const sid = randomUUID(), run = path.join(tmp, 'run', `${sid}.json`);
  const fixture = path.resolve(import.meta.dirname, 'fixtures/fake-claude.ts');
  const spec: RunnerSpec = { sid, cwd: tmp, model: null, permissionMode: 'default', settingsFile: null, claude: { file: process.execPath, prefix: [fixture], shell: false }, version: '2.1.309' };
  const runner = spawn(process.execPath, [path.resolve(import.meta.dirname, '../server/headless-runner.ts'), ...runnerArgv(spec)], { env: { ...process.env, PAWGENTS_OFFICE_DATA: tmp }, stdio: 'ignore' });
  const runnerExit = new Promise<number | null>((r) => runner.on('exit', (code) => r(code)));
  const until = async <T>(fn: () => T | null | undefined | false, what: string, ms = 10_000): Promise<T> => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) throw new Error(`timeout: ${what}`); await new Promise((r) => setTimeout(r, 50)); } };
  let sock: net.Socket | undefined;
  try {
    const info = await until(() => { try { return JSON.parse(fs.readFileSync(run, 'utf8')); } catch { return null; } }, 'run file');
    assert.equal(info.sid, sid); assert.equal(info.pid, runner.pid); assert.equal(typeof info.claudePid, 'number');
    if (process.platform !== 'win32') assert.equal(info.pipe, path.join(tmp, 'run', `${sid}.sock`));
    const msgs: Msg[] = [], st = newFeed();
    sock = net.connect({ path: info.pipe });
    sock.setEncoding('utf8');
    sock.on('data', (d: string) => feed(st, d, (o) => msgs.push(o)));
    sock.on('error', () => {});
    const waitFor = (pred: (m: Msg) => unknown, what: string) => until(() => msgs.find(pred), what);
    const hello = await waitFor((m) => m.type === 'hello', 'hello');
    assert.equal(hello.alive, true); assert.equal(typeof hello.claudePid, 'number'); assert.equal(hello.sid, sid);
    sock.write(encode({ type: 'prompt', text: 'hi' }));
    assert.equal((await waitFor((m) => m.type === 'ack' && m.for === 'prompt', 'ack')).ok, true);
    const res = await waitFor((m) => m.type === 'event' && m.kind === 'result', 'result');
    assert.equal(res.isError, false); assert.equal(res.costUsd, 0.001);
    assert.ok([...hello.recent, ...msgs.filter((m) => m.type === 'event')].some((e: Msg) => e.kind === 'init' && e.sessionId === sid)); // init may predate our connection: then it's in hello.recent
    sock.write(encode({ type: 'mode', mode: 'plan' }));
    assert.equal((await waitFor((m) => m.type === 'ack' && m.for === 'mode', 'mode ack')).ok, true);
    await waitFor((m) => m.type === 'event' && m.kind === 'mode' && m.mode === 'plan', 'mode event');
    sock.write(encode({ type: 'mode', mode: 'bypassPermissions' }));
    const refused = await waitFor((m) => m.type === 'ack' && m.for === 'mode' && !m.ok, 'mode refusal');
    assert.equal(refused.code, 'bypass_not_launched');
    assert.equal(msgs.some((m) => m.type === 'event' && m.kind === 'control'), false); // answers go to the asker only
    sock.write(encode({ type: 'status' }));
    assert.equal((await waitFor((m) => m.type === 'status', 'status')).alive, true);
    sock.write(encode({ type: 'bogus' }));
    await waitFor((m) => m.type === 'error', 'error');
    sock.write(encode({ type: 'close' }));
    assert.equal((await waitFor((m) => m.type === 'exit', 'exit')).code, 0);
    assert.equal(await Promise.race([runnerExit, new Promise((r) => setTimeout(() => r('timeout'), 10_000).unref())]), 0);
    assert.equal(fs.existsSync(run), false);
  } finally {
    sock?.destroy();
    if (runner.exitCode === null && runner.signalCode === null) runner.kill();
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('childEnv drops the parent claude/Orca session vars and points hooks at this server', async () => {
  const { childEnv, stripClaudeEnv } = await import('../server/backends/headless.ts');
  const { PORT, DATA_DIR } = await import('../server/config.ts');
  const parent = { PATH: '/bin', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CODE_SSE_PORT: '123', ORCA_TERMINAL_HANDLE: 't1', PAWGENTS_OFFICE_PORT: '1', KEEP: 'x' };
  const env = childEnv(parent);
  for (const k of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'ORCA_TERMINAL_HANDLE']) assert.equal(k in env, false, k);
  assert.equal(env.PAWGENTS_OFFICE_PORT, String(PORT)); assert.equal(env.PAWGENTS_OFFICE_DATA, DATA_DIR);
  assert.equal(env.KEEP, 'x'); assert.equal(env.PATH, '/bin');
  assert.equal('CLAUDECODE' in parent, true); // the caller's env is left alone
  if (process.platform === 'win32') assert.equal('ClaudeCode' in stripClaudeEnv({ ClaudeCode: '1' }), false);
});

test('backend errors map to HTTP statuses', async () => {
  const { backendStatus, backendError } = await import('../server/http.ts');
  for (const c of ['terminal_not_found', 'not_claude', 'headless_exit', 'detached', 'headless_unavailable', 'git_failed']) assert.equal(backendStatus(c), 409, c);
  assert.equal(backendStatus('ENOENT'), 502); assert.equal(backendStatus('orca_failed'), 502); assert.equal(backendStatus(undefined), 502);
  const res = { status: 0, body: null as unknown, writeHead(status: number) { this.status = status; }, end(body: string) { this.body = JSON.parse(body); } };
  backendError(res as unknown as ServerResponse, Object.assign(new Error('gone'), { code: 'detached' }));
  assert.equal(res.status, 409); assert.deepEqual(res.body, { error: 'gone', code: 'detached' });
});

// ---- Step 5: permission requests answered from the office ---------------------------------------------------------
test('decision hook: output shapes, headless settings are synchronous, the plugin copy stays async', async () => {
  const { decisionOutput, headlessSettings, DECISION_TIMEOUT_S, DECIDE_FLAG } = await import('../hooks/decision.ts');
  assert.deepEqual(decisionOutput(true), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
  assert.deepEqual(decisionOutput(false).hookSpecificOutput.decision, { behavior: 'deny', message: '사용자가 사무실에서 거부했습니다.' });
  assert.equal(decisionOutput(false, 'x').hookSpecificOutput.decision.message, 'x');
  const h = headlessSettings('node send.ts --decide').hooks.PermissionRequest[0].hooks[0];
  assert.deepEqual(h, { type: 'command', command: 'node send.ts --decide', timeout: 1800 });
  assert.equal(DECISION_TIMEOUT_S, 1800); assert.equal(DECIDE_FLAG, '--decide');
  assert.equal('async' in h, false); // an async hook can't decide
  // Design: the plugin's hook can't decide (async), so interactive sessions never wait on the office; only headless
  // claude gets the deciding copy, through --settings.
  const plugin = JSON.parse(fs.readFileSync(new URL('../hooks/hooks.json', import.meta.url), 'utf8'));
  assert.equal(plugin.hooks.PermissionRequest[0].hooks[0].async, true);
  assert.equal(plugin.hooks.PermissionRequest[0].hooks[0].command.includes(DECIDE_FLAG), false);
});

test('ensureSettingsFile writes the --decide hook command (into its own data dir)', async () => {
  const { SEND_SCRIPT } = await import('../hooks/_common.ts');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pawgents-settings-'));
  try {
    // a child process: config reads PAWGENTS_OFFICE_DATA at import, and the real data dir must stay untouched
    const code = "const m = await import(process.argv[1]); const f = m.ensureSettingsFile(); m.ensureSettingsFile(); console.log(f);";
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', code, new URL('../server/backends/headless.ts', import.meta.url).href], { env: { ...process.env, PAWGENTS_OFFICE_DATA: tmp }, encoding: 'utf8' }).trim();
    assert.equal(out, path.join(tmp, 'headless-settings.json'));
    const h = JSON.parse(fs.readFileSync(out, 'utf8')).hooks.PermissionRequest[0].hooks[0];
    assert.equal(h.command, `"${process.execPath}" "${SEND_SCRIPT}" --decide`);
    assert.equal(h.timeout, 1800);
    assert.ok(buildClaudeArgs({ sid: randomUUID(), settingsFile: out }).includes(out)); // passes the argv validation
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/** A store / session / response just big enough for parkPermission. */
function permFixture() {
  const logs: LogEntry[] = [], s = { id: randomUUID(), state: 'waiting', ended: false, pendingPermissions: [] } as unknown as Session;
  const store = { log: (_s: Session, e: LogEntry) => logs.push(e), setState: (x: Session, st: Session['state']) => { x.state = st; }, emitSession: () => {} } as unknown as Store;
  return { logs, s, store };
}
class FakeRes {
  listeners: Record<string, (() => void)[]> = {};
  chunks: string[] = [];
  writableEnded = false;
  status = 0;
  headers: unknown;
  flushed = false;
  on(ev: string, fn: () => void) { (this.listeners[ev] ??= []).push(fn); return this; }
  emit(ev: string) { for (const fn of this.listeners[ev] ?? []) fn(); }
  writeHead(status: number, headers: unknown) { this.status = status; this.headers = headers; }
  flushHeaders() { this.flushed = true; }
  write(c: string) { this.chunks.push(c); }
  end(c?: string) { if (c !== undefined) this.chunks.push(c); this.writableEnded = true; this.emit('close'); }
  get body() { return this.chunks.join(''); }
}
const writeEv = (file: string): HookEvent => ({ hook_event_name: 'PermissionRequest', tool_name: 'Write', tool_input: { file_path: `/tmp/${file}`, content: 'ok' } });

test('parkPermission: allow, deny, stale, and two requests at once', async () => {
  const { parkPermission, decidePermission } = await import('../server/backends/headless.ts');
  const { logs, s, store } = permFixture();
  const a = new FakeRes(), b = new FakeRes();
  parkPermission(store, s, writeEv('a.txt'), a as unknown as ServerResponse);
  parkPermission(store, s, writeEv('b.txt'), b as unknown as ServerResponse);
  assert.equal(a.status, 200); assert.ok(a.flushed); assert.equal(a.writableEnded, false);
  assert.equal(s.pendingPermissions.length, 2);
  const [pa, pb] = s.pendingPermissions;
  assert.deepEqual({ tool: pa.tool, target: pa.target }, { tool: 'Write', target: 'a.txt' });
  assert.match(pa.detail!, /a\.txt/); assert.equal(typeof pa.at, 'number'); assert.equal(pa.id.length, 8);
  assert.equal(decidePermission(store, s, pa.id, true), true);
  assert.deepEqual(JSON.parse(a.body.trim()), { decision: 'allow' });
  assert.equal(s.state, 'waiting'); // b is still asking
  assert.equal(decidePermission(store, s, pa.id, false), false); // stale
  assert.equal(decidePermission(store, s, pb.id, false), true);
  assert.deepEqual(JSON.parse(b.body.trim()), { decision: 'deny' });
  assert.equal(s.state, 'thinking'); assert.deepEqual(s.pendingPermissions, []);
  assert.deepEqual(logs.map((l) => l.text), ['→ 허용', '→ 거부']);
});

test('parkPermission: heartbeat, no answer in time -> {} (claude denies), hook gone -> silent', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { parkPermission } = await import('../server/backends/headless.ts');
  const { PERMISSION_WAIT_MS, PERMISSION_HEARTBEAT_MS } = await import('../server/config.ts');
  const { logs, s, store } = permFixture();
  const res = new FakeRes();
  parkPermission(store, s, writeEv('c.txt'), res as unknown as ServerResponse);
  t.mock.timers.tick(PERMISSION_HEARTBEAT_MS);
  assert.equal(res.body, ' ');
  t.mock.timers.tick(PERMISSION_WAIT_MS);
  assert.equal(res.body.trim(), '{}');
  assert.deepEqual(logs.map((l) => l.text), ['→ 응답 없음']);
  assert.equal(s.state, 'thinking');
  const gone = new FakeRes();
  s.state = 'waiting';
  parkPermission(store, s, writeEv('d.txt'), gone as unknown as ServerResponse);
  gone.emit('close'); // the hook was killed / the server is going away
  assert.deepEqual(s.pendingPermissions, []); assert.equal(logs.length, 1);
});

test('send.ts --decide: prints the office decision, nothing when there is none', async () => {
  const http = await import('node:http');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pawgents-decide-'));
  let answer = '{}', got: any = null;
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c: Buffer) => { b += c; }).on('end', () => { got = JSON.parse(b); res.writeHead(200); res.write(' '); res.end(answer); });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const run = (args: string[]) => new Promise<{ code: number | null; out: string }>((resolve) => {
    const env = { ...process.env, PAWGENTS_OFFICE_PORT: String((srv.address() as net.AddressInfo).port), PAWGENTS_OFFICE_DATA: tmp, PAWGENTS_OFFICE_AUTOSTART: '0' };
    const c = spawn(process.execPath, [path.resolve(import.meta.dirname, '../hooks/send.ts'), ...args], { env });
    let out = ''; c.stdout.on('data', (d: Buffer) => { out += d; });
    c.on('exit', (code) => resolve({ code, out }));
    c.stdin.end(JSON.stringify({ hook_event_name: 'PermissionRequest', session_id: randomUUID(), tool_name: 'Bash', tool_input: { command: 'echo hi' }, permission_suggestions: [{}] }));
  });
  try {
    answer = JSON.stringify({ decision: 'allow' });
    let r = await run(['--decide']);
    assert.equal(r.code, 0); assert.deepEqual(JSON.parse(r.out), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
    assert.equal(got.await_decision, true); assert.equal('permission_suggestions' in got, false);
    answer = JSON.stringify({ decision: 'deny', message: 'no' });
    r = await run(['--decide']);
    assert.deepEqual(JSON.parse(r.out).hookSpecificOutput.decision, { behavior: 'deny', message: 'no' });
    answer = '{}';
    assert.equal((await run(['--decide'])).out, '');
    answer = JSON.stringify({ decision: 'allow' });
    r = await run([]); // the plugin's async copy: fire and forget, never a decision
    assert.equal(r.out, ''); assert.equal(got.await_decision, undefined);
  } finally {
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('defaultModel: ANTHROPIC_MODEL, then local, project and user settings', async () => {
  const { defaultModel } = await import('../server/backends/headless.ts');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pawgents-model-'));
  const user = path.join(tmp, 'user'), proj = path.join(tmp, 'proj');
  fs.mkdirSync(user); fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
  assert.equal(defaultModel(proj, {}, user), null); // nothing set: claude's account default, unknown until init
  fs.writeFileSync(path.join(user, 'settings.json'), JSON.stringify({ model: 'opus' }));
  assert.equal(defaultModel(proj, {}, user), 'opus');
  fs.writeFileSync(path.join(proj, '.claude', 'settings.json'), JSON.stringify({ model: 'sonnet' }));
  assert.equal(defaultModel(proj, {}, user), 'sonnet');
  fs.writeFileSync(path.join(proj, '.claude', 'settings.local.json'), '{ not json');
  assert.equal(defaultModel(proj, {}, user), 'sonnet'); // a broken file is skipped
  fs.writeFileSync(path.join(proj, '.claude', 'settings.local.json'), JSON.stringify({ model: 'haiku' }));
  assert.equal(defaultModel(proj, {}, user), 'haiku');
  assert.equal(defaultModel(proj, { ANTHROPIC_MODEL: 'claude-fable-5-1' }, user), 'claude-fable-5-1');
});
