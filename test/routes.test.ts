// Characterization of the HTTP API over a real socket: status codes, guards and the store changes behind them.
// No Orca / claude needed: the routes exercised here answer before reaching a backend (or hit a detached one).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { PORT } from '../server/config.ts';
import { createApp } from '../server/index.ts';
import { Sse } from '../server/sse.ts';
import { Store } from '../server/store.ts';

const OWN = `127.0.0.1:${PORT}`; // what the same-origin guard expects in Host
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pawgents-routes-'));
const store = new Store({
  stateFile: path.join(dir, 'state.json'),
  skinsDir: path.join(dir, 'skins'),
});
let server: http.Server, port: number;

before(async () => {
  server = createApp({ store, sse: new Sse() });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
after(() => server.close());

interface Reply {
  status: number;
  body: string;
  // biome-ignore lint/suspicious/noExplicitAny: replies are read field by field in the pinned assertions below
  json: () => any;
}
function request(
  method: string,
  p: string,
  {
    body,
    page = true,
    headers = {},
  }: { body?: unknown; page?: boolean; headers?: Record<string, string> } = {},
) {
  // page: what our own browser page sends (Host + Origin + JSON); false: a hook / curl
  const h: Record<string, string> = page
    ? {
        host: OWN,
        origin: `http://${OWN}`,
        'content-type': 'application/json',
      }
    : {};
  return new Promise<Reply>((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: p,
        headers: { ...h, ...headers },
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () =>
          resolve({
            status: res.statusCode!,
            body: text,
            json: () => JSON.parse(text),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
const hook = (ev: Record<string, unknown>) =>
  request('POST', '/hook', { body: { cwd: dir, ...ev }, page: false });

test('healthz, state, unknown paths', async () => {
  const h = await request('GET', '/healthz', { page: false });
  assert.deepEqual([h.status, h.body], [200, 'ok']);
  const s = await request('GET', '/state', { page: false });
  assert.equal(s.status, 200);
  assert.ok(s.json().offices.some((o: { id: string }) => o.id === 'default'));
  assert.equal((await request('GET', '/nope', { page: false })).status, 404);
  // a malformed %-escape in a route param names nothing
  assert.equal((await request('GET', '/sessions/%E0%A4%A/log')).status, 404);
});

test('static: the page, its modules and the browser-safe shared/ modules', async () => {
  const get = (p: string) => request('GET', p, { page: false });
  const page = await get('/');
  assert.equal(page.status, 200);
  assert.match(page.body, /office\.ts/);
  for (const p of ['/office.ts', '/web/office.ts', '/shared/layout.ts']) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    assert.doesNotMatch(r.body, /^import type/m, p); // served type-stripped
  }
  assert.equal((await get('/shared/node/x.ts')).status, 403);
  // URL parsing folds the dot segments away: it asks for web/server/config.ts, which doesn't exist
  assert.equal((await get('/%2e%2e/server/config.ts')).status, 404);
});

test('POST /hook: browsers are refused, hooks create and advance a session', async () => {
  const sid = 'aaaaaaaa-0000-0000-0000-000000000001';
  const refused = await request('POST', '/hook', {
    body: { session_id: sid, hook_event_name: 'SessionStart' },
  });
  assert.equal(refused.status, 403); // carries Origin
  assert.equal(store.sessions.has(sid), false);

  assert.equal(
    (
      await hook({
        session_id: sid,
        hook_event_name: 'UserPromptSubmit',
        prompt: 'hi',
      })
    ).status,
    204,
  );
  assert.equal(store.sessions.get(sid)!.state, 'thinking');
  assert.equal(
    (await request('POST', '/hook', { body: 'x{', page: false })).status,
    204,
  ); // garbage is ignored
  const log = await request('GET', `/sessions/${sid}/log`);
  assert.equal(log.status, 200);
  assert.equal(log.json().log.at(-1).ev, 'UserPromptSubmit');
});

test('session actions: guards, validation, detached headless sessions', async () => {
  const sid = 'aaaaaaaa-0000-0000-0000-000000000002';
  store.getOrCreateSession(sid, { cwd: dir, backend: 'headless' });
  const at = (a: string) => `/sessions/${sid}/${a}`;

  // not our page: refused before anything else
  assert.equal(
    (await request('POST', at('prompt'), { body: { text: 'x' }, page: false }))
      .status,
    403,
  );
  assert.equal(
    (
      await request('POST', at('prompt'), {
        body: { text: 'x' },
        headers: { origin: 'http://evil' },
      })
    ).status,
    403,
  );
  const gone = await request('POST', '/sessions/nope/prompt', {
    body: { text: 'x' },
  });
  assert.equal(gone.status, 404);
  assert.equal(
    (await request('POST', at('prompt'), { body: { text: '  ' } })).status,
    400,
  );

  // a headless session with no runner attached
  for (const [a, body] of [
    ['prompt', { text: 'go' }],
    ['close', { force: true }],
    ['mode', { mode: 'plan' }],
  ] as const) {
    const r = await request('POST', at(a), { body });
    assert.equal(r.status, 409, a);
    assert.equal(r.json().code, 'detached', a);
  }
  assert.equal(
    (await request('POST', at('mode'), { body: { mode: 'bogus' } })).status,
    400,
  );
  assert.equal(
    (await request('POST', at('permission'), { body: { id: 1 } })).status,
    400,
  );
  const stale = await request('POST', at('permission'), {
    body: { id: 'p1', allow: true },
  });
  assert.deepEqual([stale.status, stale.json().code], [409, 'stale']);

  const reply = await request('GET', at('reply'));
  assert.deepEqual(reply.json(), { id: sid, agentId: null, text: '', at: 0 });
  assert.equal((await request('GET', `${at('reply')}?agent=x`)).status, 404);
  const diff = await request('GET', `${at('diff')}?file=a.txt`);
  assert.equal(diff.status, 404); // not a file this session touched
  assert.equal((await request('GET', at('diff'), { page: false })).status, 403); // Host not ours
});

test('offices: rename, layout, reset, delete, together', async () => {
  assert.equal(
    (await request('POST', '/offices/default', { body: { name: '본사' } }))
      .status,
    200,
  );
  assert.equal(store.office('default')!.name, '본사');
  assert.equal(
    (await request('POST', '/offices/default', { body: { name: '' } })).status,
    400,
  );
  assert.equal(
    (await request('POST', '/offices/none', { body: { name: 'x' } })).status,
    404,
  );
  assert.equal(
    (await request('DELETE', '/offices/default', { body: {} })).status,
    400,
  );

  const bad = await request('POST', '/offices/default/layout', {
    body: { layout: { w: 1, h: 1 } },
  });
  assert.equal(bad.status, 400);
  assert.equal(
    (await request('POST', '/offices/default/reset', { body: {} })).status,
    200,
  );

  assert.equal(
    (
      await request('POST', '/settings/together', {
        body: { officeId: 'none' },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request('POST', '/settings/together', {
        body: { officeId: 'default' },
      })
    ).status,
    200,
  );
  assert.equal(store.together, 'default');
  assert.equal(
    (await request('POST', '/settings/together', { body: { officeId: null } }))
      .status,
    200,
  );
  assert.equal(store.together, null);
});

test('settings and skins: validation', async () => {
  assert.equal(
    (await request('POST', '/settings/cats', { body: { family: 'gpt' } }))
      .status,
    400,
  );
  const ok = await request('POST', '/settings/cats', {
    body: { family: 'opus', breed: 'tabby' },
  });
  assert.deepEqual([ok.status, ok.json().cats.opus], [200, 'tabby']);
  assert.equal(
    (
      await request('POST', '/settings/cats', {
        body: { family: 'opus', breed: 'skin:0123456789' },
      })
    ).status,
    400, // no such skin
  );
  assert.equal(
    (
      await request('POST', '/skins', {
        body: { name: '', cellW: 16, cellH: 16 },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request('POST', '/skins', {
        body: { name: 'a', cellW: 2, cellH: 16 },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request('POST', '/skins', {
        body: { name: 'a', cellW: 16, cellH: 16, png: '' },
      })
    ).status,
    400,
  );
  assert.equal((await request('GET', '/skins/0123456789.png')).status, 404);
  assert.equal(
    (await request('POST', '/skins/0123456789/delete', { body: {} })).status,
    404,
  );
});

test('launch: request validation', async () => {
  for (const body of [
    { backend: 'x' },
    { backend: 'headless', count: 0 },
    { backend: 'headless', model: 'bad model!' },
    { backend: 'orca', newWorktree: { name: '../x' } },
  ])
    assert.equal(
      (await request('POST', '/launch', { body })).status,
      400,
      JSON.stringify(body),
    );
  assert.equal(
    (
      await request('POST', '/launch', {
        body: { backend: 'headless', cwd: 'rel' },
      })
    ).status,
    400,
  );
  assert.equal(
    (await request('POST', '/launch', { body: { backend: 'orca' } })).status,
    400,
  ); // no worktree
});
