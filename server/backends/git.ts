// Worktrees without Orca: plain `git worktree` over the repos the office already knows.

import path from 'node:path';
import { git, gitFailed } from '../infra/git.ts';
import { normalizePath, samePath as samePathKey } from '../infra/path.ts';
import { repoOf } from '../repo.ts';
import type { Store } from '../store.ts';
import { isDir } from '../util.ts';

export interface WorktreeRow {
  id: string;
  path: string;
  repoRoot: string;
  repo: string;
  branch: string;
  head: string;
  isMain: boolean;
  name: string;
}

const ADD_TIMEOUT_MS = 60_000; // `worktree add` checks out a whole tree
// git prints forward slashes; compare ignoring slash style, trailing slash and (on Windows) case
const norm = (p: unknown) => normalizePath(p);

/** Parse `git worktree list --porcelain` into launcher rows; bare and prunable entries can't host a session. */
export function parseWorktrees(text: unknown, repoRoot: string): WorktreeRow[] {
  const out: WorktreeRow[] = [];
  String(text || '')
    .split(/\r?\n\s*\r?\n/)
    .forEach((block, i) => {
      const w = { path: '', head: '', branch: '', skip: false };
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('worktree ')) w.path = line.slice(9);
        else if (line.startsWith('HEAD ')) w.head = line.slice(5);
        else if (line.startsWith('branch '))
          w.branch = line.slice(7).replace(/^refs\/heads\//, '');
        else if (line === 'bare' || line.startsWith('prunable')) w.skip = true;
      }
      if (!w.path || w.skip) return;
      out.push({
        id: w.path,
        path: w.path,
        repoRoot,
        repo: path.basename(repoRoot),
        branch: w.branch,
        head: w.head,
        isMain: i === 0 || norm(w.path) === norm(repoRoot),
        name: '',
      });
    });
  return out;
}

/** `git worktree list --porcelain` of the repo containing `dir`, as launcher rows. */
async function readWorktrees(dir: string) {
  const { out } = await git(dir, ['worktree', 'list', '--porcelain']); // GIT_TIMEOUT_MS (5 s)
  return parseWorktrees(out, dir);
}

/** Repo roots to list: the offices' repos (minus the 'default' bucket) plus live sessions' repos, if they still exist. */
export function repoRoots(store: Store): string[] {
  const keys = new Set(
    store.offices
      .flatMap((o: { repos: string[] }) => o.repos)
      .filter((k: string) => k !== 'default'),
  );
  for (const s of store.sessions.values())
    if (!s.ended && s.cwd) {
      const k = repoOf(s.cwd).key;
      if (k !== 'default') keys.add(k);
    }
  return [...keys].filter(isDir);
}

export async function listGitWorktrees(roots: string[]) {
  const results = await Promise.allSettled(roots.map(readWorktrees));
  const seen = new Set<string>(),
    all: WorktreeRow[] = [];
  for (const r of results)
    if (r.status === 'fulfilled')
      for (const w of r.value)
        if (!seen.has(norm(w.path))) {
          seen.add(norm(w.path));
          all.push(w);
        }
  return all.sort(
    (a, b) =>
      a.repo.localeCompare(b.repo) ||
      +b.isMain - +a.isMain ||
      a.path.localeCompare(b.path),
  );
}

export const samePath = (a: unknown, b: unknown) => samePathKey(a, b);

/** Worktrees of the repo containing `dir`, in git's order: the main worktree (real-case path) comes first unless bare. */
export async function worktreesAt(dir: string) {
  try {
    return await readWorktrees(dir);
  } catch (e) {
    throw gitFailed(e, 'git worktree list failed');
  }
}

/** New worktree on a new branch `name`, next to the repo as `<repo>-<name>`. */
export async function addWorktree({
  repoRoot,
  name,
  base,
}: {
  repoRoot: string;
  name: string;
  base: string;
}) {
  const dir = path.join(
    path.dirname(repoRoot),
    `${path.basename(repoRoot)}-${name}`,
  );
  try {
    await git(repoRoot, ['worktree', 'add', '-b', name, dir, base], {
      timeoutMs: ADD_TIMEOUT_MS,
    });
  } catch (e) {
    throw gitFailed(e);
  }
  return { path: dir, branch: name };
}
