// The launch use case without HTTP: request parsing, per-backend refusals, partial failures and the log lines.

import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../server/app/errors.ts';
import {
  createLaunch,
  type Launchers,
  parseLaunchBody,
} from '../server/app/launch.ts';

function fixture(over: Partial<Launchers['orca']> = {}) {
  const lines: string[] = [];
  const started: string[] = [];
  const launchers = {
    orca: {
      listWorktrees: async () => [
        { id: 'w1', repo: 'r', path: '/r', branch: 'main' },
      ],
      launchClaude: async (o: { worktreeId: string }) => {
        started.push(o.worktreeId);
      },
      createWorktreeWithClaude: async (o: { name: string }) => {
        if (o.name.endsWith('-2')) throw new Error('taken');
        started.push(o.name);
      },
      ...over,
    },
    headless: {
      probe: async () => ({ available: false, reason: 'no claude' }),
      launch: async () => undefined,
    },
  } as unknown as Launchers;
  const launch = createLaunch({
    launchers,
    logger: { info: (l) => lines.push(l) },
  });
  return { launch, lines, started };
}

test('parseLaunchBody: defaults, and null for anything malformed', () => {
  assert.deepEqual(parseLaunchBody({ backend: 'headless', cwd: '/x' }), {
    backend: 'headless',
    prompt: '',
    model: '',
    count: 1,
    name: null,
    cwd: '/x',
    permissionMode: 'default',
  });
  assert.deepEqual(
    parseLaunchBody({
      backend: 'orca',
      worktreeId: 'w1',
      prompt: ' hi ',
      count: 2,
      newWorktree: { name: ' feat ' },
    }),
    {
      backend: 'orca',
      prompt: 'hi',
      model: '',
      count: 2,
      name: 'feat',
      worktreeId: 'w1',
    },
  );
  for (const body of [
    { backend: 'x' },
    { backend: 'orca', count: 1.5 },
    { backend: 'orca', model: 'a b' },
    { backend: 'orca', newWorktree: { name: '' } },
  ])
    assert.equal(parseLaunchBody(body), null, JSON.stringify(body));
});

test('launch (orca): refusals, and a failed hire does not hide the others', async () => {
  const { launch, lines, started } = fixture();
  const hire = parseLaunchBody({
    backend: 'orca',
    worktreeId: 'w1',
    count: 3,
    newWorktree: { name: 'feat' },
    prompt: 'go',
  })!;
  assert.deepEqual(await launch(hire), {
    ok: true,
    started: 2,
    errors: ['feat-2: taken'],
    sessions: [],
  });
  assert.deepEqual(started, ['feat-1', 'feat-3']);
  assert.deepEqual(lines, [
    '[web] launch claude in new worktree feat-1 (from main): go',
    '[web] launch claude in new worktree feat-3 (from main): go',
  ]);

  const refused = async (body: Record<string, unknown>, msg: string) =>
    assert.rejects(launch(parseLaunchBody({ backend: 'orca', ...body })!), {
      refusal: 'invalid',
      message: msg,
    });
  await refused({}, '잘못된 요청입니다.');
  await refused({ worktreeId: 'nope' }, '알 수 없는 워크트리입니다.');

  const { launch: down } = fixture({
    launchClaude: async () => {
      throw new Error('orca down');
    },
  });
  const err = await down(
    parseLaunchBody({ backend: 'orca', worktreeId: 'w1' })!,
  ).catch((e) => e);
  assert.ok(err instanceof AppError);
  assert.deepEqual([err.refusal, err.message], ['failed', '#1: orca down']);
});

test('launch (headless): a missing folder is refused, an unavailable claude keeps its code', async () => {
  const { launch } = fixture();
  await assert.rejects(
    launch(parseLaunchBody({ backend: 'headless', cwd: 'rel' })!),
    { refusal: 'invalid', message: '작업 폴더가 없습니다.' },
  );
  await assert.rejects(
    launch(
      parseLaunchBody({
        backend: 'headless',
        cwd: process.cwd(),
        permissionMode: 'bogus',
      })!,
    ),
    { refusal: 'invalid', message: '알 수 없는 권한 모드입니다.' },
  );
  await assert.rejects(
    launch(parseLaunchBody({ backend: 'headless', cwd: process.cwd() })!),
    { code: 'headless_unavailable', message: 'no claude' },
  );
});
