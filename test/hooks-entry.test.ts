// The other command-line entry points: scripts/stop.ts and the SessionStart hook (hooks/ensure-server.ts),
// run as subprocesses against a temp data dir and a stand-in office server.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readPid } from '../scripts/stop.ts';

const root = path.resolve(import.meta.dirname, '..');

function run(script: string, env: Record<string, string>, input = '') {
  const r = spawnSync(process.execPath, [path.join(root, script)], {
    env: { ...process.env, ...env },
    input,
    encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout };
}

function withTmp(fn: (dir: string) => Promise<void> | void) {
  return async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pawgents-entry-'));
    try {
      await fn(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

test(
  'readPid reads a number, NaN for junk, undefined for no file',
  withTmp((dir) => {
    const f = path.join(dir, 'server.pid');
    assert.equal(readPid(f), undefined);
    fs.writeFileSync(f, '123');
    assert.equal(readPid(f), 123);
    fs.writeFileSync(f, 'x');
    assert.ok(Number.isNaN(readPid(f)));
  }),
);

test(
  'stop.ts: no pid file, a stale pid, a live server',
  withTmp(async (dir) => {
    const env = { PAWGENTS_OFFICE_DATA: dir, PAWGENTS_OFFICE_PORT: '17999' };
    const pidFile = path.join(dir, 'server.pid');

    let r = run('scripts/stop.ts', env);
    assert.equal(r.code, 0);
    assert.equal(r.out, `pawgents-office is not running (no ${pidFile}).\n`);

    const gone = spawnSync(process.execPath, ['-e', '0']).pid;
    fs.writeFileSync(pidFile, String(gone));
    r = run('scripts/stop.ts', env);
    assert.equal(r.code, 0);
    assert.equal(r.out, `pawgents-office (pid ${gone}) was not running.\n`);
    assert.equal(fs.existsSync(pidFile), false);

    const live = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
    const exited = new Promise((resolve) => live.on('exit', resolve));
    try {
      fs.writeFileSync(pidFile, String(live.pid));
      r = run('scripts/stop.ts', env);
      assert.equal(r.code, 0);
      assert.equal(
        r.out,
        `Stopped pawgents-office (pid ${live.pid}, port 17999).\n`,
      );
      assert.equal(fs.existsSync(pidFile), false);
      await exited;
    } finally {
      live.kill();
    }
  }),
);

test(
  'ensure-server.ts forwards the SessionStart event and prints nothing',
  withTmp(async (dir) => {
    const got: unknown[] = [];
    const srv = http.createServer((req, res) => {
      let b = '';
      req
        .on('data', (c: Buffer) => {
          b += c;
        })
        .on('end', () => {
          got.push({ url: req.url, body: JSON.parse(b) });
          res.end('ok');
        });
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as net.AddressInfo).port;
    const env = {
      PAWGENTS_OFFICE_DATA: dir,
      PAWGENTS_OFFICE_PORT: String(port),
      PAWGENTS_OFFICE_AUTOSTART: '0',
      ORCA_TERMINAL_HANDLE: '', // these tests may run inside Orca
    };
    try {
      const ev = { hook_event_name: 'SessionStart', session_id: 's1' };
      // spawnSync would block this process's server; run the hook asynchronously
      const result = await new Promise<{ code: number | null; out: string }>(
        (resolve) => {
          const c = spawn(
            process.execPath,
            [path.join(root, 'hooks/ensure-server.ts')],
            { env: { ...process.env, ...env } },
          );
          let out = '';
          c.stdout.on('data', (d: Buffer) => {
            out += d;
          });
          c.on('exit', (code) => resolve({ code, out }));
          c.stdin.end(JSON.stringify(ev));
        },
      );
      assert.deepEqual(result, { code: 0, out: '' });
      assert.deepEqual(got, [{ url: '/hook', body: ev }]);

      const bad = run('hooks/ensure-server.ts', env, '{ nope');
      assert.deepEqual(bad, { code: 0, out: '' });
      assert.equal(got.length, 1);
    } finally {
      srv.close();
    }
  }),
);
