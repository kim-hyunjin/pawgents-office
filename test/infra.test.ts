// server/infra: the git runner against real git in a throwaway dir, and path keys on both platforms
// (by passing the platform in).

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  type GitError,
  git,
  gitErr,
  gitFailed,
  gitSync,
} from '../server/infra/git.ts';
import {
  foldCase,
  normalizePath,
  samePath,
  slashPath,
} from '../server/infra/path.ts';
import { isWindows } from '../server/infra/platform.ts';
import { repoOf } from '../server/repo.ts';

// ---- paths ----------------------------------------------------------------------------------------------------------

test('isWindows: only win32', () => {
  assert.equal(isWindows('win32'), true);
  assert.equal(isWindows('linux'), false);
  assert.equal(isWindows('darwin'), false);
});

test('slashPath: forward slashes, no trailing slash, case kept, nullish → empty', () => {
  assert.equal(slashPath('C:\\Repo\\Sub\\'), 'C:/Repo/Sub');
  assert.equal(slashPath('/home/me/Repo//'), '/home/me/Repo');
  assert.equal(slashPath(undefined), '');
  assert.equal(slashPath(null), '');
  assert.equal(slashPath(''), '');
});

test('normalizePath: case folded on win32 only', () => {
  assert.equal(normalizePath('C:\\Repo\\Sub\\', 'win32'), 'c:/repo/sub');
  assert.equal(normalizePath('C:\\Repo\\Sub\\', 'linux'), 'C:/Repo/Sub');
  assert.equal(normalizePath('/Home/Me/', 'darwin'), '/Home/Me');
});

test('samePath: slash style and trailing slash never matter, case only on win32', () => {
  assert.equal(samePath('C:\\Repo\\a', 'c:/repo/a/', 'win32'), true);
  assert.equal(samePath('C:\\Repo\\a', 'c:/repo/a/', 'linux'), false);
  assert.equal(samePath('/x/Repo', '/x/Repo/', 'linux'), true);
  assert.equal(samePath('/x/a', '/x/b', 'win32'), false);
  assert.equal(samePath(undefined, '', 'linux'), true);
});

test('foldCase: keeps separators, lowercases on win32 only', () => {
  assert.equal(foldCase('C:\\Repo\\', 'win32'), 'c:\\repo\\');
  assert.equal(foldCase('/Home/Repo', 'linux'), '/Home/Repo');
});

// ---- the git runner -------------------------------------------------------------------------------------------------

let hasGit = true;
try {
  execFileSync('git', ['--version'], { stdio: 'ignore' });
} catch {
  hasGit = false;
}
const skip = !hasGit && 'git not installed';

/** A temp dir with a one-commit repo in `repo/` and a plain folder `plain/`; removed after `fn`. */
async function withRepo(fn: (repo: string, plain: string) => Promise<void>) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pawgents-infra-'));
  try {
    const repo = path.join(tmp, 'repo'),
      plain = path.join(tmp, 'plain');
    fs.mkdirSync(repo);
    fs.mkdirSync(plain);
    const g = (...args: string[]) =>
      execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
    g('init', '-q');
    g('config', 'user.email', 'test@example.com');
    g('config', 'user.name', 'test');
    g('config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
    fs.writeFileSync(path.join(repo, 'big.txt'), 'x'.repeat(10_000));
    g('add', '.');
    g('commit', '-q', '-m', 'first');
    await fn(repo, plain);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const failure = (p: Promise<unknown>) =>
  p.then(
    () => assert.fail('expected git to fail'),
    (e) => e as GitError,
  );

test('git: stdout on exit 0, runs in cwd', { skip }, () =>
  withRepo(async (repo) => {
    const r = await git(repo, ['ls-files']);
    assert.deepEqual(r.out.trim().split('\n').sort(), ['a.txt', 'big.txt']);
    assert.equal(r.truncated, false);
  }),
);

test(
  'git: other exit codes throw the execFile error (numeric code, stderr)',
  { skip },
  () =>
    withRepo(async (_repo, plain) => {
      const e = await failure(git(plain, ['rev-parse', '--show-toplevel']));
      assert.ok(e instanceof Error);
      assert.equal(e.code, 128);
      assert.match(String(e.stderr), /not a git repository/i);
      assert.match(gitErr(e), /not a git repository/i);
      const coded = gitFailed(e) as Error & { code?: string };
      assert.equal(coded.code, 'git_failed');
      assert.equal(coded.message, String(e.stderr).trim().slice(0, 300));
    }),
);

test(
  'git: okCodes answer with stdout (diff --no-index exits 1)',
  { skip },
  () =>
    withRepo(async (repo) => {
      fs.writeFileSync(path.join(repo, 'b.txt'), 'two\n');
      const args = ['diff', '--no-index', '--no-color', '--', 'a.txt', 'b.txt'];
      assert.equal((await failure(git(repo, args))).code, 1);
      const r = await git(repo, args, { okCodes: [1] });
      assert.match(r.out, /^\+two$/m);
      assert.equal(r.truncated, false);
    }),
);

test(
  'git: past maxBuffer it throws, or with `truncate` answers what it read',
  { skip },
  () =>
    withRepo(async (repo) => {
      const args = ['show', 'HEAD:big.txt'];
      const e = await failure(git(repo, args, { maxBuffer: 100 }));
      assert.equal(e.code, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
      const r = await git(repo, args, { maxBuffer: 100, truncate: true });
      assert.equal(r.truncated, true);
      assert.ok(r.out.length > 0 && r.out.length < 10_000);
      assert.equal((await git(repo, args)).out.length, 10_000);
    }),
);

test('git: a timeout kills git and throws with `killed`', { skip }, () =>
  withRepo(async (repo) => {
    // hash-object --stdin waits on stdin, which execFile leaves open
    const e = await failure(
      git(repo, ['hash-object', '--stdin'], { timeoutMs: 200 }),
    );
    assert.ok(e instanceof Error);
    assert.equal(e.killed, true);
    assert.equal(gitFailed(e, 'fallback').code, 'git_failed');
  }),
);

test('gitSync: stdout on exit 0, null otherwise', { skip }, () =>
  withRepo(async (repo, plain) => {
    assert.equal(
      gitSync(repo, ['rev-parse', '--is-inside-work-tree']),
      'true\n',
    );
    assert.equal(gitSync(plain, ['rev-parse', '--is-inside-work-tree']), null);
    assert.equal(gitSync(path.join(plain, 'missing'), ['status']), null);
  }),
);

test(
  'repoOf (on gitSync): a worktree lands in its main repo, a plain dir in the default office',
  { skip },
  () =>
    withRepo(async (repo, plain) => {
      const wt = path.join(path.dirname(repo), 'repo-wt');
      execFileSync(
        'git',
        ['-C', repo, 'worktree', 'add', '-q', '-b', 'wt', wt],
        {
          stdio: 'ignore',
        },
      );
      const main = repoOf(repo);
      assert.deepEqual(main, {
        key: foldCase(path.resolve(fs.realpathSync.native(repo))),
        name: 'repo',
      });
      assert.deepEqual(repoOf(wt), main);
      assert.deepEqual(repoOf(plain), { key: 'default', name: '' });
      assert.deepEqual(repoOf(undefined), { key: 'default', name: '' });
    }),
);
