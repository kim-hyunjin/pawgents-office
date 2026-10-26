// server/backends/headless.ts: the runner's env, the --settings file, the permission desk and the default model.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import type { ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createHeadlessBackend,
  createPermissionDesk,
} from '../server/backends/headless.ts';
import { buildClaudeArgs } from '../server/backends/protocol.ts';
import { holdForDecision } from '../server/http/common.ts';
import type { Store } from '../server/store.ts';
import type { HookEvent, LogEntry, Session } from '../server/types.ts';

test('childEnv drops the parent claude/Orca session vars and points hooks at this server', async () => {
  const { childEnv, stripClaudeEnv } = await import(
    '../server/backends/headless.ts'
  );
  const { PORT, DATA_DIR } = await import('../server/config.ts');
  const parent = {
    PATH: '/bin',
    CLAUDECODE: '1',
    CLAUDE_CODE_ENTRYPOINT: 'cli',
    CLAUDE_CODE_SSE_PORT: '123',
    ORCA_TERMINAL_HANDLE: 't1',
    PAWGENTS_OFFICE_PORT: '1',
    KEEP: 'x',
  };
  const env = childEnv(parent);
  for (const k of [
    'CLAUDECODE',
    'CLAUDE_CODE_ENTRYPOINT',
    'CLAUDE_CODE_SSE_PORT',
    'ORCA_TERMINAL_HANDLE',
  ])
    assert.equal(k in env, false, k);
  assert.equal(env.PAWGENTS_OFFICE_PORT, String(PORT));
  assert.equal(env.PAWGENTS_OFFICE_DATA, DATA_DIR);
  assert.equal(env.KEEP, 'x');
  assert.equal(env.PATH, '/bin');
  assert.equal('CLAUDECODE' in parent, true); // the caller's env is left alone
  if (process.platform === 'win32')
    assert.equal('ClaudeCode' in stripClaudeEnv({ ClaudeCode: '1' }), false);
});

test('ensureSettingsFile writes the --decide hook command (into its own data dir)', async () => {
  const { SEND_SCRIPT } = await import('../shared/node/paths.ts');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pawgents-settings-'));
  try {
    // a child process: config reads PAWGENTS_OFFICE_DATA at import, and the real data dir must stay untouched
    const code =
      'const m = await import(process.argv[1]); const f = m.ensureSettingsFile(); m.ensureSettingsFile(); console.log(f);';
    const out = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        code,
        new URL('../server/backends/headless.ts', import.meta.url).href,
      ],
      {
        env: { ...process.env, PAWGENTS_OFFICE_DATA: tmp },
        encoding: 'utf8',
      },
    ).trim();
    assert.equal(out, path.join(tmp, 'headless-settings.json'));
    const h = JSON.parse(fs.readFileSync(out, 'utf8')).hooks
      .PermissionRequest[0].hooks[0];
    assert.equal(h.command, `"${process.execPath}" "${SEND_SCRIPT}" --decide`);
    assert.equal(h.timeout, 1800);
    assert.ok(
      buildClaudeArgs({ sid: randomUUID(), settingsFile: out }).includes(out),
    ); // passes the argv validation
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/** A store / session / response just big enough for parkPermission. */
function permFixture() {
  const logs: LogEntry[] = [],
    s = {
      id: randomUUID(),
      state: 'waiting',
      ended: false,
      pendingPermissions: [],
    } as unknown as Session;
  const store = {
    log: (_s: Session, e: LogEntry) => logs.push(e),
    setState: (x: Session, st: Session['state']) => {
      x.state = st;
    },
    updateSession: <T>(x: Session, fn: (s: Session) => T) => fn(x),
  } as unknown as Store;
  return { logs, s, store };
}
class FakeRes {
  listeners: Record<string, (() => void)[]> = {};
  chunks: string[] = [];
  writableEnded = false;
  status = 0;
  headers: unknown;
  flushed = false;
  on(ev: string, fn: () => void) {
    (this.listeners[ev] ??= []).push(fn);
    return this;
  }
  emit(ev: string) {
    for (const fn of this.listeners[ev] ?? []) fn();
  }
  writeHead(status: number, headers: unknown) {
    this.status = status;
    this.headers = headers;
  }
  flushHeaders() {
    this.flushed = true;
  }
  write(c: string) {
    this.chunks.push(c);
  }
  end(c?: string) {
    if (c !== undefined) this.chunks.push(c);
    this.writableEnded = true;
    this.emit('close');
  }
  get body() {
    return this.chunks.join('');
  }
}
const writeEv = (file: string): HookEvent => ({
  hook_event_name: 'PermissionRequest',
  tool_name: 'Write',
  tool_input: { file_path: `/tmp/${file}`, content: 'ok' },
});

/** Park a request and hold a (fake) hook response open for it, the way the /hook route does. */
const parkOver = (
  desk: ReturnType<typeof createPermissionDesk>,
  s: Session,
  ev: HookEvent,
  res: FakeRes,
) => holdForDecision(res as unknown as ServerResponse, desk.park(s, ev));

test('parkPermission: allow, deny, stale, and two requests at once', async () => {
  const { logs, s, store } = permFixture();
  const desk = createPermissionDesk(store);
  const a = new FakeRes(),
    b = new FakeRes();
  const da = parkOver(desk, s, writeEv('a.txt'), a);
  const db = parkOver(desk, s, writeEv('b.txt'), b);
  assert.equal(a.status, 200);
  assert.ok(a.flushed);
  assert.equal(a.writableEnded, false);
  assert.equal(s.pendingPermissions.length, 2);
  const [pa, pb] = s.pendingPermissions;
  assert.ok(pa && pb);
  assert.deepEqual(
    { tool: pa.tool, target: pa.target },
    { tool: 'Write', target: 'a.txt' },
  );
  assert.match(pa.detail!, /a\.txt/);
  assert.equal(typeof pa.at, 'number');
  assert.equal(pa.id.length, 8);
  assert.equal(desk.answer(s, pa.id, true), 'Write');
  await da;
  assert.deepEqual(JSON.parse(a.body.trim()), { decision: 'allow' });
  assert.equal(s.state, 'waiting'); // b is still asking
  assert.throws(() => desk.answer(s, pa.id, false), { code: 'stale' });
  desk.answer(s, pb.id, false);
  await db;
  assert.deepEqual(JSON.parse(b.body.trim()), { decision: 'deny' });
  assert.equal(s.state, 'thinking');
  assert.deepEqual(s.pendingPermissions, []);
  assert.deepEqual(
    logs.map((l) => l.text),
    ['→ 허용', '→ 거부'],
  );
});

test('parkPermission: heartbeat, no answer in time -> {} (claude denies), hook gone -> silent', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { PERMISSION_WAIT_MS, PERMISSION_HEARTBEAT_MS } = await import(
    '../server/config.ts'
  );
  const { logs, s, store } = permFixture();
  const desk = createPermissionDesk(store);
  const res = new FakeRes();
  const done = parkOver(desk, s, writeEv('c.txt'), res);
  t.mock.timers.tick(PERMISSION_HEARTBEAT_MS);
  assert.equal(res.body, ' ');
  t.mock.timers.tick(PERMISSION_WAIT_MS);
  await done;
  assert.equal(res.body.trim(), '{}');
  assert.deepEqual(
    logs.map((l) => l.text),
    ['→ 응답 없음'],
  );
  assert.equal(s.state, 'thinking');
  const gone = new FakeRes();
  s.state = 'waiting';
  const left = parkOver(desk, s, writeEv('d.txt'), gone);
  gone.emit('close'); // the hook was killed / the server is going away
  await left;
  assert.deepEqual(s.pendingPermissions, []);
  assert.equal(logs.length, 1);
});

test('a headless backend parks only the requests of sessions it runs', async () => {
  const { s, store } = permFixture();
  const h = createHeadlessBackend({ store });
  assert.equal(h.parkPermission(s, writeEv('e.txt')), null); // no runner attached
  assert.deepEqual(s.pendingPermissions, []);
  assert.throws(() => h.ensureAttached(s), { code: 'detached' });
  await assert.rejects(h.answerPermission(s, 'nope', true), { code: 'stale' });
});

test('defaultModel: ANTHROPIC_MODEL, then local, project and user settings', async () => {
  const { defaultModel } = await import('../server/backends/headless.ts');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pawgents-model-'));
  const user = path.join(tmp, 'user'),
    proj = path.join(tmp, 'proj');
  fs.mkdirSync(user);
  fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
  assert.equal(defaultModel(proj, {}, user), null); // nothing set: claude's account default, unknown until init
  fs.writeFileSync(
    path.join(user, 'settings.json'),
    JSON.stringify({ model: 'opus' }),
  );
  assert.equal(defaultModel(proj, {}, user), 'opus');
  fs.writeFileSync(
    path.join(proj, '.claude', 'settings.json'),
    JSON.stringify({ model: 'sonnet' }),
  );
  assert.equal(defaultModel(proj, {}, user), 'sonnet');
  fs.writeFileSync(
    path.join(proj, '.claude', 'settings.local.json'),
    '{ not json',
  );
  assert.equal(defaultModel(proj, {}, user), 'sonnet'); // a broken file is skipped
  fs.writeFileSync(
    path.join(proj, '.claude', 'settings.local.json'),
    JSON.stringify({ model: 'haiku' }),
  );
  assert.equal(defaultModel(proj, {}, user), 'haiku');
  assert.equal(
    defaultModel(proj, { ANTHROPIC_MODEL: 'claude-fable-5-1' }, user),
    'claude-fable-5-1',
  );
});
