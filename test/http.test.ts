// server/http/common.ts: how backend and git error codes become HTTP statuses.

import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import test from 'node:test';

test('backend errors map to HTTP statuses', async () => {
  const { errorStatus, sendError } = await import('../server/http/common.ts');
  for (const c of [
    'terminal_not_found',
    'not_claude',
    'headless_exit',
    'detached',
    'headless_unavailable',
    'git_failed',
    'not_repo',
  ])
    assert.equal(errorStatus(c), 409, c);
  assert.equal(errorStatus('outside'), 400);
  assert.equal(errorStatus('ENOENT'), 502);
  assert.equal(errorStatus('orca_failed'), 502);
  assert.equal(errorStatus(128), 502); // a git exit code
  assert.equal(errorStatus('constructor'), 502);
  assert.equal(errorStatus(undefined), 502);
  const res = {
    status: 0,
    body: null as unknown,
    writeHead(status: number) {
      this.status = status;
    },
    end(body: string) {
      this.body = JSON.parse(body);
    },
  };
  sendError(
    res as unknown as ServerResponse,
    Object.assign(new Error('gone'), { code: 'detached' }),
  );
  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: 'gone', code: 'detached' });
});
