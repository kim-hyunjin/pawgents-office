// server/backends/git.ts: `git worktree list --porcelain` parsing and repo discovery for the headless launcher.

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWorktrees, repoRoots } from '../server/backends/git.ts';
import type { Store } from '../server/store.ts';

const fixture = [
  'worktree C:/Users/x/repo',
  'HEAD aaa111',
  'branch refs/heads/main',
  '',
  'worktree C:/Users/x/repo-feature',
  'HEAD bbb222',
  'branch refs/heads/feature/x',
  '',
  'worktree C:/Users/x/repo-detached',
  'HEAD ccc333',
  'detached',
  '',
  'worktree C:/Users/x/repo.git',
  'bare',
  '',
  'worktree C:/Users/x/repo-gone',
  'HEAD ddd444',
  'branch refs/heads/gone',
  'prunable gitdir file points to non-existent location',
  '',
].join('\n');

test('parseWorktrees reads branches, detached heads and the main worktree; skips bare and prunable', () => {
  const ws = parseWorktrees(fixture, 'C:/Users/x/repo');
  assert.equal(ws.length, 3);
  assert.deepEqual(
    ws.map((w) => w.isMain),
    [true, false, false],
  );
  assert.deepEqual(
    ws.map((w) => w.branch),
    ['main', 'feature/x', ''],
  );
  assert.deepEqual(
    ws.map((w) => w.head),
    ['aaa111', 'bbb222', 'ccc333'],
  );
  assert.ok(
    ws.every(
      (w) =>
        w.repo === 'repo' &&
        w.repoRoot === 'C:/Users/x/repo' &&
        w.id === w.path &&
        w.name === '',
    ),
  );
  assert.equal(ws[1].path, 'C:/Users/x/repo-feature');
});

test('repoRoots keeps only existing directories and drops the default bucket', () => {
  const here = process.cwd();
  const store = {
    offices: [{ repos: ['default', here.toLowerCase(), here + '-nope'] }],
    sessions: new Map(),
  } as unknown as Store; // just what repoRoots reads
  const roots = repoRoots(store);
  assert.deepEqual(roots, [here.toLowerCase()]);
});
