// A session's "worked files": what its tools touched, folded together with `git status` of its worktree.
// Map order is touch order (newest last); the newest MAX_FILES are kept.
import path from 'node:path';
import { MAX_FILES } from '../config.ts';
import type { FileEntry, Session } from '../types.ts';

/** `fp`'s entry in `s.files` (relative paths resolve against the session's cwd), or a fresh one not yet added. */
export function fileEntry(s: Session, fp: string): FileEntry {
  const key = path.normalize(
    path.isAbsolute(fp) ? fp : path.resolve(s.cwd || '', fp),
  );
  return (
    s.files.get(key) || {
      path: key,
      name: path.basename(key),
      edited: false,
      touched: false,
      git: null,
      t: 0,
    }
  );
}

/** Move a file to the newest end with time `t`, dropping the oldest past MAX_FILES. */
export function bumpFile(s: Session, f: FileEntry, t: number) {
  f.t = Math.max(f.t, t);
  s.files.delete(f.path);
  s.files.set(f.path, f);
  if (s.files.size > MAX_FILES) s.files.delete(s.files.keys().next().value!);
}

/** Note a file a tool call touched. */
export function touchFile(
  s: Session,
  fp: string,
  { edited = false }: { edited?: boolean } = {},
) {
  const f = fileEntry(s, fp);
  f.edited ||= edited;
  f.touched = true;
  bumpFile(s, f, Date.now());
  return f;
}

/**
 * Fold `git status` of the session's worktree into its files: [{ path, status }] with one letter each
 * (M, A, D, ?, …). Files git no longer lists lose their mark, or go entirely if no tool of this session touched
 * them. A file git alone knows is ordered by `mtimeOf` (null: deleted, so now). Returns true if anything changed.
 */
export function setGitFiles(
  s: Session,
  list: { path: string; status: string }[],
  mtimeOf: (file: string) => number | null,
) {
  let changed = false;
  const seen = new Set<string>();
  for (const { path: fp, status } of list) {
    const f = fileEntry(s, fp);
    seen.add(f.path);
    if (f.git === status && s.files.has(f.path)) continue;
    changed = true;
    f.git = status;
    f.edited = true;
    bumpFile(s, f, f.t || (mtimeOf(f.path) ?? Date.now()));
  }
  for (const f of [...s.files.values()]) {
    if (!f.git || seen.has(f.path)) continue;
    changed = true;
    if (f.touched) f.git = null;
    else s.files.delete(f.path);
  }
  return changed;
}
