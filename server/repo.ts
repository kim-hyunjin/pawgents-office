import { spawnSync } from 'node:child_process';
import path from 'node:path';

interface Repo { key: string; name: string }
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
  try {
    const out = spawnSync('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', timeout: 3000, windowsHide: true });
    const dir = out.status === 0 && out.stdout.trim();
    if (dir) {
      const root = path.basename(dir) === '.git' ? path.dirname(dir) : dir; // bare repos have no .git
      const norm = path.resolve(root);
      r = { key: process.platform === 'win32' ? norm.toLowerCase() : norm, name: path.basename(norm).replace(/\.git$/, '') };
    }
  } catch { /* git missing: default office */ }
  cache.set(cwd, r);
  return r;
}
