import path from 'node:path';
import { gitSync } from './infra/git.ts';
import { foldCase } from './infra/path.ts';

const REPO_TIMEOUT_MS = 3000; // blocks the caller, so shorter than GIT_TIMEOUT_MS

interface Repo {
  key: string;
  name: string;
}
const cache = new Map<string, Repo>(); // cwd -> { key, name }

/**
 * Which repo a session works in, so it goes to that repo's office. Worktrees share their main repo's git dir,
 * so they land in the same office. Not a git repo (or no cwd) → the shared default office.
 */
export function repoOf(cwd?: string | null) {
  if (!cwd) return { key: 'default', name: '' };
  let r = cache.get(cwd);
  if (r) return r;
  r = { key: 'default', name: '' };
  // sync: callers place the session right away. null (not a repo, git missing) → default office
  const dir = gitSync(
    cwd,
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { timeoutMs: REPO_TIMEOUT_MS },
  )?.trim();
  if (dir) {
    const root = path.basename(dir) === '.git' ? path.dirname(dir) : dir; // bare repos have no .git
    const norm = path.resolve(root);
    r = {
      key: foldCase(norm),
      name: path.basename(norm).replace(/\.git$/, ''),
    };
  }
  cache.set(cwd, r);
  return r;
}
