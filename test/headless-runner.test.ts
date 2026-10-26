// server/headless-runner.ts: a real runner over a real pipe, with test/fixtures/fake-claude.ts as claude.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { RunnerSpec } from '../server/backends/protocol.ts';
import {
  encode,
  feed,
  newFeed,
  runnerArgv,
} from '../server/backends/protocol.ts';

/** A decoded line as the tests read it: any field, each checked by the assertion that reads it. */
type Msg = Record<string, unknown>;

// Real runner over a real pipe, with test/fixtures/fake-claude.ts as claude. DATA_DIR points at a temp dir via env.
test('runner: hello, prompt -> ack + result, status, close -> exit 0, run file removed', {
  timeout: 30_000,
}, async () => {
  const tmp = fs.mkdtempSync(
    path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', 'po-'),
  ); // short: POSIX sun_path is ~104 bytes
  const sid = randomUUID(),
    run = path.join(tmp, 'run', `${sid}.json`);
  const fixture = path.resolve(import.meta.dirname, 'fixtures/fake-claude.ts');
  const spec: RunnerSpec = {
    sid,
    cwd: tmp,
    model: null,
    permissionMode: 'default',
    settingsFile: null,
    claude: { file: process.execPath, prefix: [fixture], shell: false },
    version: '2.1.309',
  };
  const runner = spawn(
    process.execPath,
    [
      path.resolve(import.meta.dirname, '../server/headless-runner.ts'),
      ...runnerArgv(spec),
    ],
    {
      env: { ...process.env, PAWGENTS_OFFICE_DATA: tmp },
      stdio: 'ignore',
    },
  );
  const runnerExit = new Promise<number | null>((r) =>
    runner.on('exit', (code) => r(code)),
  );
  const until = async <T>(
    fn: () => T | null | undefined | false,
    what: string,
    ms = 10_000,
  ): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() > end) throw new Error(`timeout: ${what}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  let sock: net.Socket | undefined;
  try {
    const info = await until(() => {
      try {
        return JSON.parse(fs.readFileSync(run, 'utf8'));
      } catch {
        return null;
      }
    }, 'run file');
    assert.equal(info.sid, sid);
    assert.equal(info.pid, runner.pid);
    assert.equal(typeof info.claudePid, 'number');
    if (process.platform !== 'win32')
      assert.equal(info.pipe, path.join(tmp, 'run', `${sid}.sock`));
    const msgs: Msg[] = [],
      st = newFeed();
    sock = net.connect({ path: info.pipe });
    sock.setEncoding('utf8');
    sock.on('data', (d: string) => feed(st, d, (o) => msgs.push(o)));
    sock.on('error', () => {});
    const waitFor = (pred: (m: Msg) => unknown, what: string) =>
      until(() => msgs.find(pred), what);
    const hello = await waitFor((m) => m.type === 'hello', 'hello');
    assert.equal(hello.alive, true);
    assert.equal(typeof hello.claudePid, 'number');
    assert.equal(hello.sid, sid);
    sock.write(encode({ type: 'prompt', text: 'hi' }));
    assert.equal(
      (await waitFor((m) => m.type === 'ack' && m.for === 'prompt', 'ack')).ok,
      true,
    );
    const res = await waitFor(
      (m) => m.type === 'event' && m.kind === 'result',
      'result',
    );
    assert.equal(res.isError, false);
    assert.equal(res.costUsd, 0.001);
    const recent = hello.recent as Msg[]; // what the runner saw before we connected
    assert.ok(
      [...recent, ...msgs.filter((m) => m.type === 'event')].some(
        (e: Msg) => e.kind === 'init' && e.sessionId === sid,
      ),
    ); // init may predate our connection: then it's in hello.recent
    sock.write(encode({ type: 'mode', mode: 'plan' }));
    assert.equal(
      (await waitFor((m) => m.type === 'ack' && m.for === 'mode', 'mode ack'))
        .ok,
      true,
    );
    await waitFor(
      (m) => m.type === 'event' && m.kind === 'mode' && m.mode === 'plan',
      'mode event',
    );
    sock.write(encode({ type: 'mode', mode: 'bypassPermissions' }));
    const refused = await waitFor(
      (m) => m.type === 'ack' && m.for === 'mode' && !m.ok,
      'mode refusal',
    );
    assert.equal(refused.code, 'bypass_not_launched');
    assert.equal(
      msgs.some((m) => m.type === 'event' && m.kind === 'control'),
      false,
    ); // answers go to the asker only
    sock.write(encode({ type: 'status' }));
    assert.equal(
      (await waitFor((m) => m.type === 'status', 'status')).alive,
      true,
    );
    sock.write(encode({ type: 'bogus' }));
    await waitFor((m) => m.type === 'error', 'error');
    sock.write(encode({ type: 'close' }));
    assert.equal((await waitFor((m) => m.type === 'exit', 'exit')).code, 0);
    assert.equal(
      await Promise.race([
        runnerExit,
        new Promise((r) => setTimeout(() => r('timeout'), 10_000).unref()),
      ]),
      0,
    );
    assert.equal(fs.existsSync(run), false);
  } finally {
    sock?.destroy();
    if (runner.exitCode === null && runner.signalCode === null) runner.kill();
    fs.rmSync(tmp, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});
