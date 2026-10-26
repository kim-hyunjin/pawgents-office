// server/backends/protocol.ts: the runner protocol (NDJSON framing, commands, claude's stream-json lines, argv).

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import test from 'node:test';
import type { RunnerSpec } from '../server/backends/protocol.ts';
import {
  buildClaudeArgs,
  encode,
  feed,
  MAX_LINE_BYTES,
  newFeed,
  parseClaudeLine,
  parseCommand,
  parseRunnerArgv,
  pipePath,
  runFile,
  runnerArgv,
  setModeLine,
  userMessageLine,
  versionAtLeast,
} from '../server/backends/protocol.ts';
import { MAX_PROMPT_CHARS, RUN_DIR } from '../server/config.ts';

/** A decoded line as the tests read it: any field, each checked by the assertion that reads it. */
type Msg = Record<string, unknown>;

test('feed splits NDJSON across chunks, drops oversize and non-JSON lines', () => {
  const got: Msg[] = [],
    st = newFeed(),
    on = (o: Msg) => got.push(o);
  feed(st, '{"a":1}\n{"b"', on);
  feed(st, ':2}\n', on);
  feed(st, '{"c":3}\n{"d":4}\nnot json\n\n[1]\n', on);
  feed(st, '{"x":"' + 'y'.repeat(MAX_LINE_BYTES + 10), on);
  feed(st, 'zz"}\n{"e":5}\n', on); // oversize line spanning chunks
  feed(st, '{"big":"' + 'y'.repeat(MAX_LINE_BYTES) + '"}\n{"f":6}\n', on); // oversize line inside one chunk
  assert.equal(st.rem, '');
  assert.deepEqual(got, [
    { a: 1 },
    { b: 2 },
    { c: 3 },
    { d: 4 },
    [1],
    { e: 5 },
    { f: 6 },
  ]);
  assert.equal(encode({ t: 1 }), '{"t":1}\n');
});

test('parseCommand accepts the four commands and rejects the rest', () => {
  assert.deepEqual(parseCommand({ type: 'prompt', text: '  hi  ' }), {
    type: 'prompt',
    text: 'hi',
  });
  for (const t of ['close', 'kill', 'status'])
    assert.deepEqual(parseCommand({ type: t, extra: 1 }), { type: t });
  for (const bad of [
    null,
    'prompt',
    {},
    { type: 'prompt' },
    { type: 'prompt', text: '   ' },
    { type: 'prompt', text: 5 },
    { type: 'prompt', text: 'x'.repeat(MAX_PROMPT_CHARS + 1) },
    { type: 'nope' },
  ])
    assert.equal(parseCommand(bad), null);
});

test('mode: command, control request line, status and control_response parsing', () => {
  assert.deepEqual(parseCommand({ type: 'mode', mode: 'plan' }), {
    type: 'mode',
    mode: 'plan',
  });
  for (const bad of [
    { type: 'mode' },
    { type: 'mode', mode: 'yolo' },
    { type: 'mode', mode: 5 },
  ])
    assert.equal(parseCommand(bad), null);
  assert.deepEqual(JSON.parse(setModeLine('r1', 'auto')), {
    type: 'control_request',
    request_id: 'r1',
    request: { subtype: 'set_permission_mode', mode: 'auto' },
  });
  assert.deepEqual(
    parseClaudeLine({
      type: 'system',
      subtype: 'status',
      status: null,
      permissionMode: 'acceptEdits',
    }),
    { kind: 'mode', mode: 'acceptEdits' },
  );
  assert.equal(
    parseClaudeLine({
      type: 'system',
      subtype: 'status',
      status: 'compacting',
    }),
    null,
  );
  assert.deepEqual(
    parseClaudeLine({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'r1',
        response: { mode: 'plan' },
      },
    }),
    {
      kind: 'control',
      requestId: 'r1',
      ok: true,
      error: null,
      errorCode: null,
    },
  );
  assert.deepEqual(
    parseClaudeLine({
      type: 'control_response',
      response: {
        subtype: 'error',
        request_id: 'r2',
        error: 'nope',
        error_code: 'bypass_not_launched',
      },
    }),
    {
      kind: 'control',
      requestId: 'r2',
      ok: false,
      error: 'nope',
      errorCode: 'bypass_not_launched',
    },
  );
});

test('parseClaudeLine keeps init, result and permission denials only', () => {
  assert.deepEqual(
    parseClaudeLine({
      type: 'system',
      subtype: 'init',
      model: 'claude-x',
      session_id: 's',
      cwd: '/',
    }),
    {
      kind: 'init',
      model: 'claude-x',
      sessionId: 's',
    },
  );
  assert.deepEqual(
    parseClaudeLine({
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0.5,
      permission_denials: [{ tool_name: 'Bash' }],
      result: 'x',
    }),
    {
      kind: 'result',
      isError: false,
      subtype: 'success',
      costUsd: 0.5,
      denials: ['Bash'],
    },
  );
  assert.deepEqual(
    parseClaudeLine({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
    }),
    {
      kind: 'result',
      isError: true,
      subtype: 'error_during_execution',
      costUsd: null,
      denials: [],
    },
  );
  assert.deepEqual(
    parseClaudeLine({
      type: 'system',
      subtype: 'permission_denied',
      tool_name: 'Edit',
    }),
    { kind: 'denied', tool: 'Edit' },
  );
  assert.deepEqual(
    parseClaudeLine({
      type: 'system',
      subtype: 'permission_denied',
      tool: 'Write',
    }),
    { kind: 'denied', tool: 'Write' },
  );
  for (const o of [
    null,
    'x',
    { type: 'assistant' },
    { type: 'user' },
    { type: 'rate_limit_event' },
    { type: 'system', subtype: 'hook_started' },
  ])
    assert.equal(parseClaudeLine(o), null);
});

test('buildClaudeArgs: exact argv, permission-mode and version gates, validation', () => {
  const sid = '11111111-2222-3333-4444-555555555555';
  const base = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--session-id',
    sid,
  ];
  assert.deepEqual(buildClaudeArgs({ sid, version: '2.1.258' }), base);
  assert.deepEqual(
    buildClaudeArgs({
      sid,
      version: '2.1.259 (Claude Code)',
      permissionMode: 'default',
    }),
    [...base, '--permission-prompts', 'none'],
  );
  const settings = path.resolve('s.json');
  assert.deepEqual(
    buildClaudeArgs({
      sid,
      version: '2.1.309',
      model: 'opus[1m]',
      permissionMode: 'acceptEdits',
      settingsFile: settings,
    }),
    [
      ...base,
      '--model',
      'opus[1m]',
      '--permission-mode',
      'acceptEdits',
      '--permission-prompts',
      'none',
      '--settings',
      settings,
    ],
  );
  assert.equal(versionAtLeast('3.0.0', '2.1.259'), true);
  assert.equal(versionAtLeast('2.0.999', '2.1.259'), false);
  assert.equal(versionAtLeast(null, '2.1.259'), false);
  assert.throws(() => buildClaudeArgs({ sid: '../x' }));
  assert.throws(() => buildClaudeArgs({ sid, model: 'a b' }));
  assert.throws(() => buildClaudeArgs({ sid, model: 'x&calc' }));
  assert.throws(() => buildClaudeArgs({ sid, permissionMode: 'yolo' }));
  assert.throws(() => buildClaudeArgs({ sid, settingsFile: 'relative.json' }));
  assert.equal(
    userMessageLine('hi'),
    '{"type":"user","message":{"role":"user","content":"hi"}}\n',
  );
});

test('runner argv round-trips and rejects garbage', () => {
  const spec: RunnerSpec = {
    sid: randomUUID(),
    cwd: process.cwd(),
    model: null,
    permissionMode: 'auto',
    settingsFile: null,
    claude: { file: 'claude', prefix: [], shell: false },
    version: '2.1.309',
  };
  assert.deepEqual(parseRunnerArgv(runnerArgv(spec)), spec);
  assert.throws(() => parseRunnerArgv(['{nope']));
  assert.throws(() => parseRunnerArgv([]));
  assert.throws(() =>
    parseRunnerArgv(runnerArgv({ ...spec, sid: '..\\..\\evil' })),
  );
  assert.throws(() =>
    parseRunnerArgv(
      runnerArgv({
        ...spec,
        claude: { file: 'claude', prefix: [1], shell: false },
      } as unknown as RunnerSpec),
    ),
  );
  assert.throws(() =>
    parseRunnerArgv(runnerArgv({ ...spec, cwd: 3 } as unknown as RunnerSpec)),
  );
});

test('pipePath and runFile per platform', () => {
  const sid = randomUUID();
  if (process.platform === 'win32')
    assert.equal(pipePath(sid), `\\\\.\\pipe\\pawgents-office-${sid}`);
  else assert.equal(pipePath(sid), path.join(RUN_DIR, `${sid}.sock`));
  assert.equal(runFile(sid), path.join(RUN_DIR, `${sid}.json`));
  assert.throws(() => pipePath('x'));
});
