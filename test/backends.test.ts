// The Backend port seen from the HTTP API: fake backends behind the real registry and routes, over a real socket.
// Covers what needs a live Orca / runner otherwise: picking the default, the prompt rule, permissions, worktrees.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { Backend, ProbeResult } from '../server/app/ports.ts';
import { createPermissionDesk } from '../server/backends/headless.ts';
import {
  type Backends,
  createBackendRegistry,
} from '../server/backends/index.ts';
import { PORT } from '../server/config.ts';
import { createApp } from '../server/index.ts';
import { Sse } from '../server/sse.ts';
import { Store } from '../server/store.ts';
import { traitsOf } from '../server/traits.ts';
import type { Session } from '../server/types.ts';

const OWN = `127.0.0.1:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pawgents-backends-'));
const store = new Store({
  stateFile: path.join(dir, 'state.json'),
  skinsDir: path.join(dir, 'skins'),
});
const calls: string[] = [];
const desk = createPermissionDesk(store);

/** A backend that records what it's asked; `over` replaces any method. */
function fake(id: 'orca' | 'headless', over: Partial<Backend> = {}): Backend {
  return {
    id,
    probe: async (): Promise<ProbeResult> => ({ available: true }),
    owns: (s) => (id === 'headless') === (s.backend === 'headless'),
    ensureAttached: () => {},
    canPromptWhile: () => true,
    sendPrompt: async (s, text) => {
      calls.push(`${id} prompt ${s.id} ${text}`);
      return {};
    },
    close: async (s, { force }) => calls.push(`${id} close ${s.id} ${force}`),
    setMode: async (s, mode) => {
      s.permissionMode = mode;
    },
    answerPermission: async (s, reqId, allow) => desk.answer(s, reqId, allow),
    parkPermission: () => null,
    listWorktrees: async () => [{ id: `${id}-wt`, repo: 'r', path: '/r' }],
    ...over,
  };
}
const orca = fake('orca', {
  probe: async () => ({ available: false, reason: 'no orca' }),
  canPromptWhile: (state) => state !== 'waiting',
});
const headless = fake('headless', {
  probe: async () => ({ available: true, version: '2.1.309', bin: 'claude' }),
  parkPermission: (s, ev) => desk.park(s, ev),
});
const backends = createBackendRegistry(
  { orca, headless } as unknown as Backends,
  { choice: 'orca' },
);

let server: http.Server, port: number;
before(async () => {
  server = createApp({ store, sse: new Sse(), backends });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
after(() => server.close());

function request(method: string, p: string, body?: unknown, page = true) {
  const headers: Record<string, string> = page
    ? { host: OWN, origin: `http://${OWN}`, 'content-type': 'application/json' }
    : {};
  return new Promise<{ status: number; type: string; body: string }>(
    (resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, method, path: p, headers },
        (res) => {
          let text = '';
          res.on('data', (c) => (text += c));
          res.on('end', () =>
            resolve({
              status: res.statusCode!,
              type: String(res.headers['content-type']),
              body: text,
            }),
          );
        },
      );
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    },
  );
}
const session = (id: string, backend: Session['backend']) =>
  store.getOrCreateSession(id, { cwd: dir, backend });

test('GET /backends: every probe, a forced backend that is down falls back', async () => {
  const r = await request('GET', '/backends', undefined, false);
  assert.deepEqual(JSON.parse(r.body), {
    orca: { available: false, reason: 'no orca' },
    headless: { available: true, version: '2.1.309', bin: 'claude' },
    default: 'headless',
    forced: true,
  });
});

test('the registry: owner, driver, find', () => {
  const t = session('bbbbbbbb-0000-0000-0000-000000000001', null);
  const h = session('bbbbbbbb-0000-0000-0000-000000000002', 'headless');
  assert.equal(backends.ownerOf(t), orca);
  assert.equal(backends.ownerOf(h), headless);
  assert.equal(backends.driverOf(h), headless);
  assert.equal(backends.find('headless'), headless);
  assert.equal(backends.find('toString'), null);
  assert.deepEqual(
    [traitsOf(t).terminalDialogs, traitsOf(h).terminalDialogs],
    [true, false],
  );
});

test('prompt: the owner decides whether a waiting session takes it', async () => {
  const t = session('bbbbbbbb-0000-0000-0000-000000000003', null);
  const h = session('bbbbbbbb-0000-0000-0000-000000000004', 'headless');
  t.state = h.state = 'waiting';
  const refused = await request('POST', `/sessions/${t.id}/prompt`, {
    text: 'go',
  });
  assert.equal(refused.status, 409);
  assert.equal(JSON.parse(refused.body).code, 'waiting');
  const ok = await request('POST', `/sessions/${h.id}/prompt`, { text: 'go' });
  assert.deepEqual(JSON.parse(ok.body), { ok: true, accepted: true });
  assert.ok(calls.includes(`headless prompt ${h.id} go`));
});

test('a --decide hook is held open until the browser answers', async () => {
  const sid = 'bbbbbbbb-0000-0000-0000-000000000005';
  session(sid, 'headless');
  const hook = request(
    'POST',
    '/hook',
    {
      session_id: sid,
      cwd: dir,
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      await_decision: true,
    },
    false,
  );
  const s = store.sessions.get(sid)!;
  for (let i = 0; !s.pendingPermissions.length && i < 100; i++)
    await new Promise((r) => setTimeout(r, 20));
  const [p] = s.pendingPermissions;
  assert.ok(p, 'a parked request');
  assert.equal(p.tool, 'Bash');
  const ans = await request('POST', `/sessions/${sid}/permission`, {
    id: p.id,
    allow: true,
  });
  assert.equal(ans.status, 200);
  const r = await hook;
  assert.equal(r.status, 200);
  assert.match(r.type, /application\/json/);
  assert.deepEqual(JSON.parse(r.body.trim()), { decision: 'allow' });
  const stale = await request('POST', `/sessions/${sid}/permission`, {
    id: p.id,
    allow: false,
  });
  assert.deepEqual(
    [stale.status, JSON.parse(stale.body)],
    [409, { error: '이미 처리된 요청입니다.', code: 'stale' }],
  );
  // a session whose owner parks nothing: the hook just gets its 204
  const t = session('bbbbbbbb-0000-0000-0000-000000000006', null);
  const plain = await request(
    'POST',
    '/hook',
    {
      session_id: t.id,
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      await_decision: true,
    },
    false,
  );
  assert.equal(plain.status, 204);
});

test('GET /worktrees: the named backend, else the default; unknown names are 400', async () => {
  const get = async (q: string) =>
    request('GET', `/worktrees${q}`, undefined, false);
  assert.equal(
    JSON.parse((await get('?backend=orca')).body).worktrees[0].id,
    'orca-wt',
  );
  assert.equal(JSON.parse((await get('')).body).worktrees[0].id, 'headless-wt');
  assert.equal((await get('?backend=nope')).status, 400);
});
