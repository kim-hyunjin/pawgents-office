// server/diff.ts against a throwaway git repo: every status it can answer, and the two refusals.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { changedFiles, fileDiff, parseStatus } from '../server/diff.ts';

test('parseStatus: porcelain -z entries, worktree column first, rename source skipped', () => {
  const z = [
    ' M a.js',
    'M  b.js',
    'MM c.js',
    '?? d.js',
    ' D e.js',
    'R  new.js',
    'old.js',
    'A  f.js',
    '',
  ].join('\0');
  assert.deepEqual(parseStatus(z), [
    { rel: 'a.js', status: 'M' },
    { rel: 'b.js', status: 'M' },
    { rel: 'c.js', status: 'M' },
    { rel: 'd.js', status: '?' },
    { rel: 'e.js', status: 'D' },
    { rel: 'new.js', status: 'R' },
    { rel: 'f.js', status: 'A' },
  ]);
  assert.deepEqual(parseStatus(''), []);
});

let hasGit = true;
try {
  execFileSync('git', ['--version'], { stdio: 'ignore' });
} catch {
  hasGit = false;
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

test('fileDiff: changed / untracked / committed / clean / missing, outside and not_repo', {
  skip: !hasGit && 'git not installed',
}, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pawgents-diff-'));
  try {
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo);
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'test');
    git(repo, 'config', 'commit.gpgsign', 'false');
    const a = path.join(repo, 'a.txt');
    fs.writeFileSync(a, 'one\ntwo\n');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-q', '-m', 'first');

    // tracked, modified in the working tree
    fs.writeFileSync(a, 'one\n2\nthree\n');
    let d = await fileDiff(repo, a);
    assert.equal(d.status, 'changed');
    assert.equal(d.rel, 'a.txt');
    assert.match(d.patch, /^-two$/m);
    assert.match(d.patch, /^\+three$/m);
    assert.equal(d.truncated, false);

    // untracked: shown whole as added
    const b = path.join(repo, 'sub', 'b.txt');
    fs.mkdirSync(path.dirname(b));
    fs.writeFileSync(b, 'hello\n');
    d = await fileDiff(repo, b);
    assert.equal(d.status, 'untracked');
    assert.equal(d.rel, 'sub/b.txt');
    assert.match(d.patch, /^new file mode/m);
    assert.match(d.patch, /^\+hello$/m);

    // git status of the worktree: the modified and the untracked file, absolute paths; none outside a repo
    const changed = await changedFiles(path.join(repo, 'sub'));
    assert.deepEqual(
      changed!.map((f) => [path.relative(repo, f.path), f.status]).sort(),
      [
        ['a.txt', 'M'],
        [path.join('sub', 'b.txt'), '?'],
      ],
    );
    assert.equal(await changedFiles(tmp), null);
    assert.equal(await changedFiles(''), null);

    // committed during the session (since in the past) vs clean (since in the future)
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-q', '-m', 'second change');
    d = await fileDiff(repo, a, { since: Date.now() - 60_000 });
    assert.equal(d.status, 'committed');
    assert.equal('commit' in d && d.commit.subject, 'second change');
    assert.match(d.patch, /^\+three$/m);
    d = await fileDiff(repo, a, { since: Date.now() + 3600_000 });
    assert.equal(d.status, 'clean');
    assert.equal(d.patch, '');
    assert.deepEqual(
      (await changedFiles(repo))!.map((f) => f.status),
      ['?'],
    ); // only b.txt is left

    // a path under the root that does not exist and was never tracked
    d = await fileDiff(repo, path.join(repo, 'gone.txt'));
    assert.equal(d.status, 'missing');

    // cwd inside a subdirectory still resolves the worktree root
    d = await fileDiff(path.join(repo, 'sub'), a, {
      since: Date.now() - 60_000,
    });
    assert.equal(d.status, 'committed');

    await assert.rejects(fileDiff(repo, path.join(tmp, 'elsewhere.txt')), {
      code: 'outside',
    });
    await assert.rejects(fileDiff(repo, path.join(repo, '.git', 'config')), {
      code: 'outside',
    });
    await assert.rejects(fileDiff(tmp, path.join(tmp, 'x.txt')), {
      code: 'not_repo',
    });
    await assert.rejects(fileDiff('', a), { code: 'not_repo' });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('store.setGitFiles merges git status with touched files', async () => {
  const { Store } = await import('../server/store.ts');
  const store = new Store({
    stateFile: path.join(os.tmpdir(), 'pawgents-nope', 'state.json'),
  });
  const s = store.getOrCreateSession('s1', { cwd: process.cwd() });
  const here = (n: string) => path.join(process.cwd(), n);
  store.touchFile(s, here('read.js')); // read only
  store.touchFile(s, here('edit.js'), { edited: true }); // edited, later committed
  assert.equal(
    store.setGitFiles(s, [
      { path: here('edit.js'), status: 'M' },
      { path: here('shell.js'), status: '?' },
    ]),
    true,
  );
  const names = () =>
    [...s.files.values()]
      .map((f) => `${f.name}:${f.git || '-'}${f.edited ? '*' : ''}`)
      .sort();
  assert.deepEqual(names(), ['edit.js:M*', 'read.js:-', 'shell.js:?*']);
  assert.equal(
    store.setGitFiles(s, [
      { path: here('edit.js'), status: 'M' },
      { path: here('shell.js'), status: '?' },
    ]),
    false,
  ); // unchanged
  // edit.js committed, shell.js reverted: the touched one stays (edited, no git mark), the shell-only one goes
  assert.equal(store.setGitFiles(s, []), true);
  assert.deepEqual(names(), ['edit.js:-*', 'read.js:-']);
  const sent = store.serializeSession(s).files;
  assert.deepEqual(Object.keys(sent[0]).sort(), [
    'edited',
    'git',
    'name',
    'path',
    't',
  ]);
});
