// The --decide permission hook: shared/decision.ts's output and settings, and hooks/send.ts --decide end to end.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import type net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/** A decoded line as the tests read it: any field, each checked by the assertion that reads it. */
type Msg = Record<string, unknown>;

test('decision hook: output shapes, headless settings are synchronous, the plugin copy stays async', async () => {
  const { decisionOutput, headlessSettings, DECISION_TIMEOUT_S, DECIDE_FLAG } =
    await import('../shared/decision.ts');
  assert.deepEqual(decisionOutput(true), {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'allow' },
    },
  });
  assert.deepEqual(decisionOutput(false).hookSpecificOutput.decision, {
    behavior: 'deny',
    message: '사용자가 사무실에서 거부했습니다.',
  });
  assert.equal(
    decisionOutput(false, 'x').hookSpecificOutput.decision.message,
    'x',
  );
  const h = headlessSettings('node send.ts --decide').hooks.PermissionRequest[0]
    ?.hooks[0];
  assert.ok(h, 'one PermissionRequest hook');
  assert.deepEqual(h, {
    type: 'command',
    command: 'node send.ts --decide',
    timeout: 1800,
  });
  assert.equal(DECISION_TIMEOUT_S, 1800);
  assert.equal(DECIDE_FLAG, '--decide');
  assert.equal('async' in h, false); // an async hook can't decide
  // Design: the plugin's hook can't decide (async), so interactive sessions never wait on the office; only headless
  // claude gets the deciding copy, through --settings.
  const plugin = JSON.parse(
    fs.readFileSync(new URL('../hooks/hooks.json', import.meta.url), 'utf8'),
  );
  assert.equal(plugin.hooks.PermissionRequest[0].hooks[0].async, true);
  assert.equal(
    plugin.hooks.PermissionRequest[0].hooks[0].command.includes(DECIDE_FLAG),
    false,
  );
});

test('send.ts --decide: prints the office decision, nothing when there is none', async () => {
  const http = await import('node:http');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pawgents-decide-'));
  let answer = '{}',
    got: Msg = {};
  const srv = http.createServer((req, res) => {
    let b = '';
    req
      .on('data', (c: Buffer) => {
        b += c;
      })
      .on('end', () => {
        got = JSON.parse(b);
        res.writeHead(200);
        res.write(' ');
        res.end(answer);
      });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const run = (args: string[]) =>
    new Promise<{ code: number | null; out: string }>((resolve) => {
      const env = {
        ...process.env,
        PAWGENTS_OFFICE_PORT: String((srv.address() as net.AddressInfo).port),
        PAWGENTS_OFFICE_DATA: tmp,
        PAWGENTS_OFFICE_AUTOSTART: '0',
      };
      const c = spawn(
        process.execPath,
        [path.resolve(import.meta.dirname, '../hooks/send.ts'), ...args],
        { env },
      );
      let out = '';
      c.stdout.on('data', (d: Buffer) => {
        out += d;
      });
      c.on('exit', (code) => resolve({ code, out }));
      c.stdin.end(
        JSON.stringify({
          hook_event_name: 'PermissionRequest',
          session_id: randomUUID(),
          tool_name: 'Bash',
          tool_input: { command: 'echo hi' },
          permission_suggestions: [{}],
        }),
      );
    });
  try {
    answer = JSON.stringify({ decision: 'allow' });
    let r = await run(['--decide']);
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(r.out), {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'allow' },
      },
    });
    assert.equal(got.await_decision, true);
    assert.equal('permission_suggestions' in got, false);
    answer = JSON.stringify({ decision: 'deny', message: 'no' });
    r = await run(['--decide']);
    assert.deepEqual(JSON.parse(r.out).hookSpecificOutput.decision, {
      behavior: 'deny',
      message: 'no',
    });
    answer = '{}';
    assert.equal((await run(['--decide'])).out, '');
    answer = JSON.stringify({ decision: 'allow' });
    r = await run([]); // the plugin's async copy: fire and forget, never a decision
    assert.equal(r.out, '');
    assert.equal(got.await_decision, undefined);
  } finally {
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
