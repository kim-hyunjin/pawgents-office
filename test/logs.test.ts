// The activity log through an injected Logger: the exact lines the server prints for hooks and office changes.

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

const OWN = `127.0.0.1:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pawgents-logs-'));
const store = new Store({
  stateFile: path.join(dir, 'state.json'),
  skinsDir: path.join(dir, 'skins'),
});
const lines: string[] = [];
let server: http.Server, port: number;

before(async () => {
  server = createApp({
    store,
    sse: new Sse(),
    logger: { info: (l) => lines.push(l) },
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
after(() => server.close());

function post(p: string, body: unknown, page = true) {
  const headers: Record<string, string> = page
    ? { host: OWN, origin: `http://${OWN}`, 'content-type': 'application/json' }
    : {};
  return new Promise<number>((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: 'POST', path: p, headers },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode!));
      },
    );
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

test('logs: hook lines and office changes, word for word', async () => {
  const sid = 'bbbbbbbb-0000-0000-0000-000000000001';
  const hook = (ev: Record<string, unknown>) =>
    post('/hook', { session_id: sid, cwd: dir, ...ev }, false);
  assert.equal(await hook({ hook_event_name: 'SessionStart' }), 204);
  await hook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Read',
    tool_input: { file_path: path.join(dir, 'a.ts') },
  });
  await hook({
    hook_event_name: 'SubagentStart',
    agent_id: 'abcdef0123456789',
  });
  const name = store.sessions.get(sid)!.name;
  assert.equal(await post('/settings/together', { officeId: 'default' }), 200);
  assert.equal(await post('/settings/together', { officeId: null }), 200);
  assert.equal(await post('/offices/default', { name: 'HQ' }), 200);
  assert.deepEqual(lines, [
    `[hook] SessionStart  ${name} (bbbbbbbb) → idle`,
    `[hook] PreToolUse Read · a.ts  ${name} (bbbbbbbb) → reading`,
    `[hook] SubagentStart  ${name} (bbbbbbbb) [agent abcdef01] → thinking`,
    '[web] everyone works in 사무실',
    '[web] back to one office per repo',
  ]);
});
